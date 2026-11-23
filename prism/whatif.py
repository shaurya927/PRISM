"""Counterfactual "what-if" analysis for a finished case (Hypothesis & Sensitivity Matrix).

An investigator states a hypothesis: "position 9 is a 2", "the 8 at position 7 is really a B",
"sodium street lights made the silver car look white", "use tau = 0.60". PRISM re-ranks the
registry under that hypothesis and reports

  * the hypothetical shortlist and status (same scoring and guardrails as Stage 5),
  * a Hypothesis Stability Score: the share of perturbations of every uncertain slot and of the
    colour/lighting assumption in which the hypothesis leader stays the #1 candidate,
  * a sensitivity matrix (which slot or assumption, set to which value, hands #1 to someone else),
  * a differential justification of why #1 leads #2 and #3, component by component.

Guardrails
  * Read-only. Nothing here is evidence: the case result, its report and its custody record are
    never changed, and assumed characters are labelled "hypothesis" everywhere.
  * Assumptions the investigator pins (a slot they set, a colour they chose) stay fixed; only the
    remaining uncertain slots and the colour reading are varied.
  * Every scenario is ranked by prism.matcher.match itself. A vectorised pass over the whole
    registry only picks each scenario's contenders (every record that could reach the top
    ``CONTENDERS`` by match()'s own ordering); match() then scores those exactly, so the ranks,
    scores and statuses are identical to scoring the full registry.

Perturbation space
  * unknown slot ('?'): stays unknown, or each character the OCR model itself offered there (its
    second choices, across the track's reads), then those the leading contenders have there, then
    any a frame half-read (sub-threshold votes), limited to characters the Indian plate layout allows;
  * a read character with an OCR look-alike (0/O, 1/I, 8/B, 5/S, 2/Z, 6/G, 4/A): either of the pair;
  * a weakly supported read character (fusion share below ``WEAK_SHARE``): it, or unreadable;
  * colour: as recorded, unreliable (ignored), and, for light shades, sodium-vapour lighting.
All combinations are scored when there are at most ``MAX_SCENARIOS``; otherwise a fixed-seed random
sample of that size (always including the hypothesis itself). Each scenario counts equally.
"""

from __future__ import annotations

import dataclasses
import hashlib
import itertools
import random
import time
from collections import Counter
from typing import Optional, Sequence

import numpy as np

from prism.config import BODY_TYPES, COLORS, MatchConfig, PrismConfig
from prism.matcher import match, plate_similarity
from prism.plate_grammar import ALNUM, UNKNOWN, template_violations, templates_for_length
from prism.schemas import (
    AttributeValue,
    CaseResult,
    MatchResult,
    MatchStatus,
    RegistryRecord,
    TrackResult,
    WhatIfAxis,
    WhatIfCell,
    WhatIfComponent,
    WhatIfDifferential,
    WhatIfPosition,
    WhatIfRequest,
    WhatIfResult,
    WhatIfStability,
    WhatIfWinShare,
)

MAX_SCENARIOS = 512
CONTENDERS = 24            # records rescored exactly per scenario (match() keeps top_n of them)
MAX_UNKNOWN_OPTIONS = 5    # characters tried at an unknown slot (plus "stays unknown")
WEAK_SHARE = 0.75          # a read character with less fusion support is also tried as unreadable
N_DIFFERENTIALS = 2        # #1 vs #2 and #1 vs #3
SODIUM_FAMILY = ("white", "silver", "grey", "yellow")
COLOR_MODES = ("recorded", "ignore", "sodium")
BODY_MODES = ("recorded", "ignore")
NOTICE = ("Hypothetical analysis. Assumed characters and lighting are not evidence: nothing here changes "
          "the case result, the report or the chain of custody.")


class WhatIfError(ValueError):
    """Invalid hypothesis (bad slot, colour or body type)."""


# --------------------------------------------------------------------------- registry index
class RegistryIndex:
    """The registry as arrays, for scoring every record against many plate scenarios at once."""

    def __init__(self, registry: Sequence[RegistryRecord]):
        self.records = list(registry)
        n = len(self.records)
        lmax = max((len(r.plate) for r in self.records), default=1)
        self.lmax = lmax
        self.chars = np.zeros((n, lmax), dtype=np.uint8)
        for i, r in enumerate(self.records):
            b = r.plate.encode("ascii", "replace")
            self.chars[i, : len(b)] = np.frombuffer(b, dtype=np.uint8)
        self.lens = np.array([len(r.plate) for r in self.records], dtype=np.int16)
        self.colors = np.array([r.color for r in self.records], dtype=object)
        self.bodies = np.array([r.body_type for r in self.records], dtype=object)
        self.make_models = np.array([f"{r.make} {r.model}".lower() for r in self.records], dtype=object)
        # rank of each registry_id in sorted order: match()'s final tie-breaker
        order = sorted(range(n), key=lambda i: self.records[i].registry_id)
        self.id_rank = np.empty(n, dtype=np.int64)
        self.id_rank[order] = np.arange(n)

    def __len__(self) -> int:
        return len(self.records)


_INDEX_CACHE: dict[int, tuple[Sequence[RegistryRecord], RegistryIndex]] = {}


def registry_index(registry: Sequence[RegistryRecord]) -> RegistryIndex:
    key = id(registry)
    hit = _INDEX_CACHE.get(key)
    if hit is not None and hit[0] is registry and len(hit[1]) == len(registry):
        return hit[1]
    idx = RegistryIndex(registry)
    _INDEX_CACHE.clear()  # keep one registry in memory
    _INDEX_CACHE[key] = (registry, idx)
    return idx


# --------------------------------------------------------------------------- vectorised scorer
def _partners(cfg: MatchConfig) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for a, b in cfg.confusable_pairs:
        out.setdefault(a, set()).add(b)
        out.setdefault(b, set()).add(a)
    return out


def _partner(cfg: MatchConfig) -> dict[str, str]:
    """One OCR look-alike per character (the configured pairs are disjoint)."""
    return {c: sorted(p)[0] for c, p in _partners(cfg).items()}


class _PlateScorer:
    """Plate part of score_candidate for every record, with per-(position, char) vectors cached."""

    def __init__(self, index: RegistryIndex, length: int, cfg: MatchConfig):
        self.ix, self.L, self.cfg = index, length, cfg
        self.partners = _partners(cfg)
        self.shifts = sorted(cfg.shifts, key=lambda d: (abs(d), d))
        self.len_ok = np.abs(index.lens.astype(np.int32) - length) <= 1
        self._cache: dict[tuple[int, int, str], tuple[np.ndarray, np.ndarray]] = {}

    def _vec(self, k: int, d: int, ch: str) -> tuple[np.ndarray, np.ndarray]:
        """(match credit, is-mismatch) of the video's `ch` at position k against registry position k+d."""
        key = (k, d, ch)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        n = len(self.ix)
        j = k + d
        if 0 <= j < self.ix.lmax:
            col = self.ix.chars[:, j]
            valid = j < self.ix.lens
            exact = valid & (col == ord(ch))
            conf = np.zeros(n, dtype=bool)
            for p in self.partners.get(ch, ()):
                conf |= valid & (col == ord(p))
            m = np.where(exact, 1.0, np.where(conf, self.cfg.confusable_credit, 0.0))
        else:
            m = np.zeros(n, dtype=np.float64)
        out = (m, m == 0.0)
        self._cache[key] = out
        return out

    def fixed_sums(self, plate: str, varying: set[int]) -> dict[int, tuple[np.ndarray, np.ndarray, int]]:
        """Per shift: summed credit and mismatch count of the known positions that never vary."""
        n = len(self.ix)
        known = [(k, c) for k, c in enumerate(plate) if c != UNKNOWN and k not in varying]
        out = {}
        for d in self.shifts:
            tot = np.zeros(n)
            mis = np.zeros(n, dtype=np.int16)
            for k, c in known:
                m, z = self._vec(k, d, c)
                tot = tot + m
                mis = mis + z
            out[d] = (tot, mis, len(known))
        return out

    def plate_sim(self, plate: str, fixed: Optional[dict] = None, varying: Sequence[int] = ()) -> tuple[np.ndarray, np.ndarray, int]:
        """(best similarity after shift penalty, has-mismatch at the best shift, known count).

        With `fixed` (from fixed_sums) only the `varying` positions are added per call."""
        n = len(self.ix)
        if fixed is None:
            fixed = self.fixed_sums(plate, set())
            varying = ()
        extra = [(k, plate[k]) for k in varying if plate[k] != UNKNOWN]
        K = next(iter(fixed.values()))[2] + len(extra)
        if K == 0:
            return np.zeros(n), np.zeros(n, dtype=bool), 0
        best = None
        best_mis = None
        for d in self.shifts:
            tot, mis, _ = fixed[d]
            for k, c in extra:
                m, z = self._vec(k, d, c)
                tot = tot + m
                mis = mis + z
            s = np.maximum(0.0, tot / K - self.cfg.shift_penalty * abs(d))
            if best is None:
                best, best_mis = s, mis
            else:
                upd = s > best + 1e-12
                best = np.where(upd, s, best)
                best_mis = np.where(upd, mis, best_mis)
        best = np.where(self.len_ok, best, 0.0)
        contra = self.len_ok & (best_mis > 0)
        return best, contra, K


@dataclasses.dataclass
class _Attrs:
    color: Optional[AttributeValue]
    body: Optional[AttributeValue]
    make_model: Optional[AttributeValue]
    cfg: MatchConfig                     # carries the colour-adjacency assumption (sodium)


def _color_vec(ix: RegistryIndex, color: Optional[AttributeValue], cfg: MatchConfig, low_light: bool) -> np.ndarray:
    n = len(ix)
    if color is None or color.uncertain:
        return np.zeros(n)
    out = np.where(ix.colors == color.value, 1.0, 0.0)
    pairs = list(cfg.adjacent_colors) + (list(cfg.adjacent_colors_low_light) if low_light else [])
    adj = {b for a, b in pairs if a == color.value} | {a for a, b in pairs if b == color.value}
    adj.discard(color.value)
    if adj:
        out = np.where(np.isin(ix.colors, list(adj)), cfg.adjacent_color_credit, out)
    return out


def _body_vec(ix: RegistryIndex, body: Optional[AttributeValue]) -> np.ndarray:
    if body is None or body.uncertain:
        return np.zeros(len(ix))
    return np.where(ix.bodies == body.value, 1.0, 0.0)


def _mm_vec(ix: RegistryIndex, mm: Optional[AttributeValue], cfg: MatchConfig) -> np.ndarray:
    if mm is None or mm.uncertain or mm.confidence < cfg.mm_min_conf:
        return np.zeros(len(ix))
    return np.where(ix.make_models == mm.value.lower(), 1.0, 0.0)


def _weights(cfg: MatchConfig, low_light: bool) -> tuple[float, float, float]:
    if low_light:
        return cfg.low_light_w_plate, cfg.low_light_w_color, cfg.w_body
    return cfg.w_plate, cfg.w_color, cfg.w_body


def vector_scores(ix: RegistryIndex, scorer: _PlateScorer, plate: str, attrs: _Attrs, tau: float,
                  low_light: bool, attr_vecs: Optional[tuple[np.ndarray, np.ndarray, np.ndarray]] = None,
                  fixed: Optional[dict] = None, varying: Sequence[int] = ()):
    """score_candidate's total, raw total, plate part and plate-contradiction flag for every record.

    Totals can differ from score_candidate in the 4th decimal (numpy rounds half-way values
    differently); they are only used to pick contenders, which match() then scores exactly."""
    cfg = attrs.cfg
    wp, wc, wb = _weights(cfg, low_light)
    sim, contra, K = scorer.plate_sim(plate, fixed, varying)
    cov = min(1.0, K / cfg.coverage_full)
    plate_part = wp * sim * cov
    if attr_vecs is None:
        attr_vecs = (_color_vec(ix, attrs.color, cfg, low_light), _body_vec(ix, attrs.body),
                     _mm_vec(ix, attrs.make_model, cfg))
    csim, bsim, mm = attr_vecs
    base = plate_part + wc * csim + wb * bsim
    raw = base + cfg.mm_bonus * mm
    total = np.clip(raw, 0.0, 1.0)
    if K == 0:
        total = np.minimum(total, cfg.no_plate_cap)
        base_c = np.minimum(base, cfg.no_plate_cap)
    else:
        base_c = np.minimum(base, 1.0)
    lifted = (mm > 0) & (base_c < tau) & (tau <= total)
    total = np.where(lifted, round(tau - 0.001, 3), total)
    return np.round(total, 4), raw, plate_part, contra, K


def _specificity(ix: RegistryIndex, plate: str) -> int:
    if not any(c != UNKNOWN for c in plate):
        return len(ix)
    ok = ix.lens == len(plate)
    for k, c in enumerate(plate):
        if c != UNKNOWN and k < ix.lmax:
            ok &= ix.chars[:, k] == ord(c)
    return int(ok.sum())


def _contenders(ix: RegistryIndex, total, raw, plate_part, contra, m: int = CONTENDERS) -> np.ndarray:
    """Indices of every record that can reach match()'s top `m` (its sort: contradiction last, then
    score, raw total, plate part, registry id)."""
    n = len(ix)
    if n <= m:
        return np.arange(n)
    comp = contra.astype(np.float64) * 2.0 + (1.0 - total)
    part = np.argpartition(comp, m - 1)[:m]
    bound = comp[part].max()
    # everything as good as the m-th record, with a margin for rounding at the 4th decimal
    cand = np.nonzero(comp <= bound + 2e-4)[0]
    if len(cand) > 8 * m:
        keys = np.lexsort((ix.id_rank[cand], -plate_part[cand], -raw[cand], comp[cand]))
        cand = cand[keys[: 8 * m]]
    return cand


# --------------------------------------------------------------------------- one scenario
def _rank(ix: RegistryIndex, scorer: _PlateScorer, plate: str, attrs: _Attrs, tau: float, low_light: bool,
          hint_positions: Sequence[int], attr_vecs=None, fixed=None, varying: Sequence[int] = ()) -> MatchResult:
    total, raw, pp, contra, _ = vector_scores(ix, scorer, plate, attrs, tau, low_light, attr_vecs, fixed, varying)
    pool = [ix.records[i] for i in _contenders(ix, total, raw, pp, contra)]
    return match(plate, pool, attrs.cfg, attrs.color, attrs.body, attrs.make_model, tau, low_light,
                 hint_positions, specificity_override=_specificity(ix, plate), n_registry=len(ix))


# --------------------------------------------------------------------------- assumptions
def _sodium_cfg(cfg: MatchConfig) -> MatchConfig:
    pairs = set(frozenset(p) for p in cfg.adjacent_colors)
    extra = [(a, b) for a, b in itertools.combinations(SODIUM_FAMILY, 2) if frozenset((a, b)) not in pairs]
    return dataclasses.replace(cfg, adjacent_colors=tuple(cfg.adjacent_colors) + tuple(extra))


def _attrs_for(track: TrackResult, color_mode: str, body_mode: str, cfg: MatchConfig) -> _Attrs:
    a = track.attributes
    mcfg = cfg
    if color_mode == "recorded":
        color = a.color
    elif color_mode == "ignore":
        color = None
    elif color_mode == "sodium":
        color, mcfg = a.color, _sodium_cfg(cfg)
    else:
        color = AttributeValue(value=color_mode, confidence=1.0, uncertain=False, top2=[(color_mode, 1.0)],
                               source="hypothesis")
    if body_mode == "recorded":
        body = a.body_type
    elif body_mode == "ignore":
        body = None
    else:
        body = AttributeValue(value=body_mode, confidence=1.0, uncertain=False, top2=[(body_mode, 1.0)],
                              source="hypothesis")
    return _Attrs(color, body, a.make_model, mcfg)


def _color_label(mode: str, track: TrackResult) -> str:
    c = track.attributes.color
    if mode == "recorded":
        return f"as recorded ({c.value})" if not c.uncertain else "as recorded (uncertain)"
    if mode == "ignore":
        return "colour unreliable (ignored)"
    if mode == "sodium":
        return "sodium lighting (" + "/".join(SODIUM_FAMILY) + " alike)"
    return f"assume {mode}"


def _layout_chars(plate: str, k: int) -> frozenset[str]:
    """Characters allowed at position k by the Indian layouts that best fit the rest of the reading.

    "CG04..." only fits the standard layouts, so position 2 may be a letter only (no '6' for 'G'),
    and a state code must stay a valid state code."""
    tpls = templates_for_length(len(plate))
    if not tpls:
        return ALNUM
    rest = list(plate)
    rest[k] = UNKNOWN
    best = min(len(template_violations(rest, t)) for t in tpls)
    fits = [t for t in tpls if len(template_violations(rest, t)) == best]
    allowed = set()
    for c in ALNUM:
        chars = list(rest)
        chars[k] = c
        if any(k not in template_violations(chars, t) for t in fits):
            allowed.add(c)
    return frozenset(allowed)


# --------------------------------------------------------------------------- perturbation space
@dataclasses.dataclass
class _Axis:
    kind: str                 # "position" | "colour"
    index: Optional[int]
    label: str
    values: list[str]
    labels: list[str]


def _model_alternatives(track: TrackResult, length: int) -> dict[int, list[str]]:
    """Per plate position, the characters the OCR model offered across this track's reads (summed
    model probability, most probable first). Only reads of the plate's length are used, so positions
    line up without alignment."""
    mass: dict[int, dict[str, float]] = {}
    for fr in track.frames:
        if len(fr.chars) != length:
            continue
        for k, c in enumerate(fr.chars):
            cand = c.alts or ({c.raw_char.upper(): c.conf} if c.raw_char else {})
            for ch, p in cand.items():
                if ch in ALNUM:
                    mass.setdefault(k, {})[ch] = mass.get(k, {}).get(ch, 0.0) + float(p)
    return {k: [c for c, _ in sorted(m.items(), key=lambda kv: (-kv[1], kv[0]))] for k, m in mass.items()}


def _position_axes(track: TrackResult, plate: str, pinned: set[int], contenders: Sequence[str],
                   cfg: MatchConfig) -> list[_Axis]:
    partner = _partner(cfg)
    pos = {p.index: p for p in track.fused.positions}
    model_alts = _model_alternatives(track, len(plate))
    axes: list[_Axis] = []
    for k, ch in enumerate(plate):
        if k in pinned:
            continue
        fp = pos.get(k)
        if fp is not None and fp.source == "investigator-supplied" and ch != UNKNOWN:
            continue  # the investigator's own hint is an assumption they made; it stays fixed
        allowed = _layout_chars(plate, k)
        if ch == UNKNOWN:
            seen: list[str] = []
            for c in model_alts.get(k, []):  # the OCR model's own candidates here, most probable first
                if c in allowed and c not in seen:
                    seen.append(c)
            for plate_r in contenders:  # characters the leading contenders have here
                if k < len(plate_r) and plate_r[k] in allowed and plate_r[k] not in seen:
                    seen.append(plate_r[k])
            if fp is not None:  # characters a frame half-read here (sub-threshold votes)
                for c, _w in sorted(fp.votes.items(), key=lambda kv: -kv[1]):
                    if c in allowed and c not in seen:
                        seen.append(c)
            seen = seen[:MAX_UNKNOWN_OPTIONS]
            if not seen:
                continue
            vals = [UNKNOWN] + seen
            labels = ["unknown"] + [f"'{c}'" for c in seen]
            axes.append(_Axis("position", k, f"Position {k + 1} (unread)", vals, labels))
            continue
        vals, labels = [ch], [f"'{ch}' as read"]
        p = partner.get(ch)
        if p is not None and p in allowed:
            vals.append(p)
            labels.append(f"'{p}' (look-alike)")
        weak = fp is not None and fp.source in ("video", "video+hint") and fp.confidence < WEAK_SHARE
        if weak:
            vals.append(UNKNOWN)
            labels.append("unreadable")
        if len(vals) > 1:
            why = []
            if p is not None and p in allowed:
                why.append(f"{ch}/{p}")
            if weak:
                why.append(f"weak read {fp.confidence:.2f}")
            axes.append(_Axis("position", k, f"Position {k + 1} ({', '.join(why)})", vals, labels))
    return axes


def _color_axis(track: TrackResult, req_color: Optional[str]) -> Optional[_Axis]:
    if req_color not in (None, "recorded"):
        return None  # pinned by the investigator
    c = track.attributes.color
    if c is None or c.uncertain or (c.source or "") == "investigator-supplied":
        return None
    vals = ["recorded", "ignore"] + (["sodium"] if c.value in SODIUM_FAMILY else [])
    return _Axis("colour", None, "Colour / lighting", vals, [_color_label(v, track) for v in vals])


def _scenarios(axes: list[_Axis], seed: str) -> tuple[list[tuple[int, ...]], int, bool]:
    sizes = [len(a.values) for a in axes]
    total = 1
    for s in sizes:
        total *= s
    if total <= MAX_SCENARIOS:
        return list(itertools.product(*[range(s) for s in sizes])), total, False
    rng = random.Random(int(hashlib.sha256(seed.encode()).hexdigest()[:12], 16))
    picked = {tuple(0 for _ in sizes)}  # index 0 of every axis is the hypothesis itself
    while len(picked) < MAX_SCENARIOS:
        picked.add(tuple(rng.randrange(s) for s in sizes))
    return sorted(picked), total, True


# --------------------------------------------------------------------------- differential justification
def _pct(v: float) -> str:
    """A score difference in points of the 0-1 score (0.185 -> "18.5 points")."""
    return f"{abs(v) * 100:.1f} points"


def _join(items: Sequence[str]) -> str:
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _subs(plate: str, rec_plate: str, cfg: MatchConfig) -> tuple[list[str], int]:
    """What the registry plate needs beyond the (hypothetical) reading, as readable phrases."""
    ps = plate_similarity(plate, rec_plate, cfg)
    out = []
    for k, a, b in ps.confusable:
        out.append(f"position {k + 1} '{a}'→'{b}' (look-alike, partial credit)")
    for k, a, b in ps.mismatch:
        out.append(f"position {k + 1} '{a}'→'{b if b is not None else 'nothing'}'")
    if ps.shift:
        out.append(f"a {ps.shift:+d} character shift")
    return out, len(ps.confusable) + len(ps.mismatch)


def _differential(plate: str, res: MatchResult, rival_rank: int, cfg: MatchConfig) -> Optional[WhatIfDifferential]:
    top = res.top_candidates
    if len(top) < rival_rank:
        return None
    a, b = top[0], top[rival_rank - 1]
    ba, bb = a.breakdown, b.breakdown
    comps = [
        WhatIfComponent(name="plate", leader=ba.plate, rival=bb.plate, delta=round(ba.plate - bb.plate, 4)),
        WhatIfComponent(name="colour", leader=ba.color, rival=bb.color, delta=round(ba.color - bb.color, 4)),
        WhatIfComponent(name="body", leader=ba.body, rival=bb.body, delta=round(ba.body - bb.body, 4)),
        WhatIfComponent(name="make/model", leader=ba.make_model, rival=bb.make_model,
                        delta=round(ba.make_model - bb.make_model, 4)),
    ]
    gap = round(a.score - b.score, 4)
    subs_a, na = _subs(plate, a.plate, cfg)
    subs_b, nb = _subs(plate, b.plate, cfg)
    contra_b = any(m.startswith("Mismatch at position") for m in b.mismatches)
    contra_a = any(m.startswith("Mismatch at position") for m in a.mismatches)

    reasons: list[str] = []
    if nb > na:
        what = f"{nb} character substitution{'s' if nb != 1 else ''}" if nb != 2 else "a double-character substitution"
        reasons.append(f"{b.registry_id} needs {what} ({'; '.join(subs_b)})"
                       + (f" while {a.registry_id} needs {na}" if na else f" while {a.registry_id} fits every known character"))
    elif nb < na:
        reasons.append(f"{a.registry_id} needs more substitutions ({na}) than {b.registry_id} ({nb})")
    colour = next(c for c in comps if c.name == "colour")
    body = next(c for c in comps if c.name == "body")
    if body.delta > 0:
        reasons.append(f"its body type differs ({b.body_type} vs {a.body_type})" if nb > na
                       else f"{b.registry_id}'s body type differs ({b.body_type} vs {a.body_type})")
    elif body.delta < 0:
        reasons.append(f"{a.registry_id}'s body type fits worse ({a.body_type} vs {b.body_type})")
    if colour.delta > 0:
        reasons.append(f"{b.registry_id}'s colour fits worse ({b.color} vs {a.color})")
    elif colour.delta < 0:
        reasons.append(f"{a.registry_id}'s colour fits worse ({a.color} vs {b.color})")
    mmc = next(c for c in comps if c.name == "make/model")
    if mmc.delta > 0:
        reasons.append(f"only {a.registry_id} earns the make/model tie-breaker")
    plate_c = next(c for c in comps if c.name == "plate")
    if not reasons and abs(plate_c.delta) > 1e-9:
        reasons.append(f"its plate evidence is {_pct(plate_c.delta)} {'lower' if plate_c.delta > 0 else 'higher'}")

    unknown_diff = [k + 1 for k, c in enumerate(plate) if c == UNKNOWN and k < len(a.plate) and k < len(b.plate)
                    and a.plate[k] != b.plate[k]]
    if contra_b and not contra_a and gap <= 0:
        text = (f"{a.registry_id} ranks above {b.registry_id} although it scores {b.score - a.score:.2f} lower, because "
                f"{b.registry_id} contradicts a confidently read character ({'; '.join(subs_b) or 'plate mismatch'}). "
                "A plate contradiction always ranks below every candidate without one.")
    elif abs(gap) < 1e-9 and not reasons:
        text = (f"{a.registry_id} and {b.registry_id} score the same ({a.score:.2f}): nothing in the evidence "
                "separates them, so they are listed in registry-ID order.")
    else:
        lead = f"{a.registry_id} leads {b.registry_id} by {_pct(gap)} ({a.score:.2f} vs {b.score:.2f})"
        text = lead + (" because " + _join(reasons) if reasons else "") + "."
        same = [c.name for c in comps if abs(c.delta) < 1e-9 and (c.leader > 0 or c.name == "plate")]
        if same and reasons:
            text += f" {_join(same).capitalize()} evidence is equal for both."
    if unknown_diff:
        text += (f" They also differ at unknown position{'s' if len(unknown_diff) > 1 else ''} "
                 f"{_join([str(p) for p in unknown_diff])}, which the video could not read, so that difference adds nothing.")
    if 0 < gap < cfg.ambiguity_gap:
        text += f" The gap is below {cfg.ambiguity_gap:.2f}, so PRISM cannot separate them."
    return WhatIfDifferential(
        leader_id=a.registry_id, rival_id=b.registry_id, rival_rank=rival_rank, leader_score=a.score,
        rival_score=b.score, gap=gap, components=comps, substitutions=subs_b, rival_contradicts=contra_b, text=text,
    )


# --------------------------------------------------------------------------- stability helpers
def _contradicts(c) -> bool:
    return any(m.startswith("Mismatch at position") for m in c.mismatches)


def _tied_with(res: MatchResult) -> list[str]:
    """Records level with #1: the same score and the same plate-contradiction standing."""
    top = res.top_candidates
    if not top:
        return []
    a = top[0]
    return [c.registry_id for c in top[1:] if abs(c.score - a.score) < 1e-9 and _contradicts(c) == _contradicts(a)]


def _sole_leader(res: MatchResult) -> Optional[str]:
    """The #1 record, or None when #1 is tied (the evidence does not pick one; only the ID order does)."""
    if not res.top_candidates or _tied_with(res):
        return None
    return res.top_candidates[0].registry_id


def _stability_text(leader, tied_with, hyp: MatchResult, axes, n, n_comb, sampled, share, clear, tie, pivots) -> str:
    if not leader:
        return "The registry is empty, so there is nothing to rank."
    what = f"{n} sampled character and lighting permutations (of {n_comb} possible)" if sampled \
        else f"{n} character and lighting permutation{'s' if n != 1 else ''}"
    parts = []
    if tied_with:
        parts.append(f"Under this hypothesis {leader} is tied with {_join(tied_with)} at {hyp.top_candidates[0].score:.2f}: "
                     "the evidence does not choose between them.")
    if not axes:
        parts.append(("" if tied_with else f"{leader} is the #1 candidate. ")
                     + "Every slot is read or pinned and the colour is fixed, so there is nothing left to perturb.")
        return " ".join(parts)
    parts.append(f"{leader} remains the sole #1 candidate across {share * 100:.0f}% of {what}"
                 + (f", and is MATCHED in {clear * 100:.0f}%." if share else "."))
    if tie:
        parts.append(f"In {tie * 100:.0f}% the top candidates tie.")
    parts.append("Pivotal: " + "; ".join(pivots[:3]) + "." if pivots
                 else "No single slot or lighting value hands #1 to another record.")
    return " ".join(parts)


# --------------------------------------------------------------------------- entry point
def _track(case: CaseResult, track_id: Optional[int]) -> TrackResult:
    if not case.tracks:
        raise WhatIfError("this case has no vehicle tracks")
    if track_id is None:
        track_id = case.primary_track_id if case.primary_track_id is not None else case.tracks[0].track_id
    for t in case.tracks:
        if t.track_id == track_id:
            return t
    raise WhatIfError(f"track {track_id} not found in this case")


def _validate(req: WhatIfRequest, length: int) -> dict[int, str]:
    slots: dict[int, str] = {}
    for k, v in req.slots.items():
        k = int(k)
        if not 0 <= k < length:
            raise WhatIfError(f"slot {k + 1} is outside the {length}-character plate")
        c = (v or "").strip().upper()
        if c != UNKNOWN and (len(c) != 1 or c not in ALNUM):
            raise WhatIfError(f"slot {k + 1}: use one letter A-Z, a digit 0-9 or '?'")
        slots[k] = c
    if req.color not in (None, *COLOR_MODES, *COLORS):
        raise WhatIfError(f"unknown colour assumption {req.color!r}")
    if req.body_type not in (None, *BODY_MODES, *BODY_TYPES):
        raise WhatIfError(f"unknown body type {req.body_type!r}")
    return slots


def run_whatif(case: CaseResult, req: WhatIfRequest, registry: Sequence[RegistryRecord],
               cfg: Optional[PrismConfig] = None) -> WhatIfResult:
    t0 = time.perf_counter()
    cfg = cfg or PrismConfig()
    mcfg = cfg.match
    track = _track(case, req.track_id)
    base = track.fused.text
    slots = _validate(req, len(base))
    plate = "".join(slots.get(k, c) for k, c in enumerate(base))
    tau = case.threshold if req.threshold is None else float(req.threshold)
    low_light = bool(case.clip and case.clip.low_light) or track.attributes.yolo_class == "low-light"
    color_mode = req.color or "recorded"
    body_mode = req.body_type or "recorded"
    pos_src = {p.index: p.source for p in track.fused.positions}

    def hint_positions(pl: str) -> list[int]:
        return [k for k, c in enumerate(pl) if c != UNKNOWN and k not in slots
                and pos_src.get(k) == "investigator-supplied"]

    positions = []
    for k, c in enumerate(plate):
        if k in slots and slots[k] != base[k]:
            src = "hypothesis"
        else:
            s = pos_src.get(k, "unknown")
            src = "investigator-supplied" if s == "investigator-supplied" else "video" if c != UNKNOWN else "unknown"
        positions.append(WhatIfPosition(index=k, char=c, video_char=base[k], source=src))

    ix = registry_index(registry)
    scorer = _PlateScorer(ix, len(plate), mcfg)
    attrs = _attrs_for(track, color_mode, body_mode, mcfg)
    hyp = _rank(ix, scorer, plate, attrs, tau, low_light, hint_positions(plate))
    leader = hyp.top_candidates[0].registry_id if hyp.top_candidates else None

    actual = track.match
    actual_leader = actual.top_candidates[0].registry_id if actual and actual.top_candidates else None

    # ---- assumptions, in words
    assumptions = []
    for k in sorted(slots):
        if slots[k] != base[k]:
            was = "unread" if base[k] == UNKNOWN else f"read as '{base[k]}'"
            now = "unreadable" if slots[k] == UNKNOWN else f"'{slots[k]}'"
            assumptions.append(f"Position {k + 1} assumed {now} (video: {was}).")
    if color_mode != "recorded":
        assumptions.append(f"Colour: {_color_label(color_mode, track)}.")
    if body_mode != "recorded":
        assumptions.append("Body type: ignored." if body_mode == "ignore" else f"Body type: assume {body_mode}.")
    if abs(tau - case.threshold) > 1e-9:
        assumptions.append(f"Threshold τ = {tau:.2f} (case: {case.threshold:.2f}).")
    if not assumptions:
        assumptions.append("No assumptions changed: this is the evidence as recorded, re-ranked against the current registry.")

    # ---- perturbation space around the hypothesis
    contenders = [c.plate for c in hyp.top_candidates]
    wild = "".join(UNKNOWN if (c == UNKNOWN and k not in slots) else c for k, c in enumerate(plate))
    if any(c == UNKNOWN for c in wild):  # contenders for the unread slots: rank with them left open
        open_res = _rank(ix, scorer, wild, attrs, tau, low_light, hint_positions(wild))
        contenders = [c.plate for c in open_res.top_candidates] + [p for p in contenders]
    pinned = {k for k in slots}
    axes = _position_axes(track, plate, pinned, contenders, mcfg)
    cax = _color_axis(track, req.color)
    if cax is not None:
        axes.append(cax)
    seed = f"{case.case_id}|{track.track_id}|{plate}|{color_mode}|{body_mode}|{tau:.3f}"
    combos, n_comb, sampled = _scenarios(axes, seed)

    # colour/body/make-model vectors per colour mode (shared by every scenario)
    vec_cache: dict[str, tuple[_Attrs, tuple]] = {}

    def attrs_mode(mode: str):
        if mode not in vec_cache:
            at = _attrs_for(track, mode, body_mode, mcfg)
            vec_cache[mode] = (at, (_color_vec(ix, at.color, at.cfg, low_light), _body_vec(ix, at.body),
                                    _mm_vec(ix, at.make_model, at.cfg)))
        return vec_cache[mode]

    varying = [a.index for a in axes if a.kind == "position"]
    fixed = scorer.fixed_sums(plate, set(varying))
    wins: Counter[str] = Counter()     # scenarios in which a record is the sole #1
    clear: Counter[str] = Counter()    # ... and MATCHED
    ties = 0
    plates_by_id: dict[str, str] = {}
    cell_n = [[0] * len(a.values) for a in axes]
    cell_keep = [[0] * len(a.values) for a in axes]
    cell_tie = [[0] * len(a.values) for a in axes]
    cell_lead: list[list[Counter[str]]] = [[Counter() for _ in a.values] for a in axes]
    for combo in combos:
        chars = list(plate)
        mode = color_mode
        for ai, vi in enumerate(combo):
            ax = axes[ai]
            if ax.kind == "position":
                chars[ax.index] = ax.values[vi]
            else:
                mode = ax.values[vi]
        sp = "".join(chars)
        at, vecs = attrs_mode(mode)
        res = _rank(ix, scorer, sp, at, tau, low_light, hint_positions(sp), vecs, fixed, varying)
        sole = _sole_leader(res)
        if sole is None and res.top_candidates:
            ties += 1
        elif sole is not None:
            plates_by_id.setdefault(sole, res.top_candidates[0].plate)
            wins[sole] += 1
            if res.status == MatchStatus.MATCHED:
                clear[sole] += 1
        for ai, vi in enumerate(combo):
            cell_n[ai][vi] += 1
            if sole is None:
                cell_tie[ai][vi] += 1
            else:
                cell_keep[ai][vi] += sole == leader
                cell_lead[ai][vi][sole] += 1

    n = max(1, len(combos))
    tied_with = _tied_with(hyp)
    leader_share = round(wins[leader] / n, 4) if leader else 0.0
    clear_share = round(clear[leader] / n, 4) if leader else 0.0
    tie_share = round(ties / n, 4)
    win_shares = [
        WhatIfWinShare(registry_id=rid, plate=plates_by_id.get(rid, ""), share=round(c / n, 4),
                       clear_share=round(clear[rid] / n, 4))
        for rid, c in wins.most_common(6)
    ]
    out_axes = []
    pivots = []
    for ai, ax in enumerate(axes):
        cells = []
        for vi, v in enumerate(ax.values):
            nn = cell_n[ai][vi]
            top = cell_lead[ai][vi].most_common(1)
            tie = cell_tie[ai][vi]
            # the cell's leader: the most frequent sole #1, unless a tie is more common still
            lead_id = top[0][0] if top and top[0][1] >= tie else None
            cells.append(WhatIfCell(value=v, label=ax.labels[vi], n=nn,
                                    keeps_leader_share=round(cell_keep[ai][vi] / nn, 4) if nn else 0.0,
                                    leader_id=lead_id, tie_share=round(tie / nn, 4) if nn else 0.0))
        flips = [c for c in cells if c.n and c.leader_id is not None and c.leader_id != leader]
        piv = bool(flips)
        if piv:
            f = flips[0]
            pivots.append(f"{ax.label.split(' (')[0].lower()} as {f.label} hands #1 to {f.leader_id}")
        out_axes.append(WhatIfAxis(kind=ax.kind, index=ax.index, label=ax.label, cells=cells, pivotal=piv))

    stext = _stability_text(leader, tied_with, hyp, axes, len(combos), n_comb, sampled, leader_share,
                            clear_share, tie_share, pivots)
    stability = WhatIfStability(
        leader_id=leader, leader_tied_with=tied_with, n_scenarios=len(combos), n_combinations=n_comb,
        sampled=sampled, leader_share=leader_share, tie_share=tie_share, clear_share=clear_share,
        win_shares=win_shares, axes=out_axes, text=stext,
    )
    diffs = [d for r in range(2, 2 + N_DIFFERENTIALS) if (d := _differential(plate, hyp, r, attrs.cfg)) is not None]
    return WhatIfResult(
        track_id=track.track_id, plate=plate, positions=positions, assumptions=assumptions, match=hyp,
        actual_leader_id=actual_leader, actual_status=actual.status if actual else None,
        leader_changed=bool(actual_leader and leader and actual_leader != leader),
        status_changed=bool(actual and actual.status != hyp.status),
        stability=stability, differentials=diffs, contenders=CONTENDERS, notice=NOTICE,
        elapsed_ms=round((time.perf_counter() - t0) * 1000, 1),
    )
