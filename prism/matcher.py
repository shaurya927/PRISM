"""Stage 5b: coverage-aware registry matching, ranking and statuses.

Score = w_p * Sim_plate * min(1, |K|/6) + w_c * Sim_color + w_b * Sim_body + 0.05 * MM

Guardrails
  * |K| == 0                      -> score capped at 0.45
  * |K| < 3                       -> MATCHED not allowed
  * make/model bonus              -> cannot lift a candidate over tau by itself
  * known char contradicts plate  -> listed as a mismatch in the reasons
Statuses: MATCHED (top >= tau, |K| >= 3, gap >= 0.05), AMBIGUOUS (gap < 0.05),
NO CONFIDENT MATCH (with a written explanation).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional, Sequence

from prism.config import MatchConfig
from prism.plate_grammar import UNKNOWN
from prism.schemas import (
    AttributeValue,
    Candidate,
    MatchResult,
    MatchStatus,
    RegistryRecord,
    ScoreBreakdown,
)


# --------------------------------------------------------------------------- plate similarity
def _confusable_set(cfg: MatchConfig) -> set[frozenset[str]]:
    return {frozenset(p) for p in cfg.confusable_pairs}


def char_match(a: str, b: str, cfg: MatchConfig, conf: Optional[set[frozenset[str]]] = None) -> float:
    if a == b:
        return 1.0
    conf = conf if conf is not None else _confusable_set(cfg)
    if frozenset((a, b)) in conf:
        return cfg.confusable_credit
    return 0.0


@dataclass
class PlateSim:
    sim: float                      # after shift penalty, before coverage
    shift: int
    known: list[int]
    exact: list[int] = field(default_factory=list)       # positions (0-based, video plate) matched exactly
    confusable: list[tuple[int, str, str]] = field(default_factory=list)
    mismatch: list[tuple[int, str, Optional[str]]] = field(default_factory=list)


def plate_similarity(pv: str, pr: str, cfg: MatchConfig) -> PlateSim:
    known = [k for k, c in enumerate(pv) if c != UNKNOWN]
    if not known or abs(len(pr) - len(pv)) > 1:
        return PlateSim(0.0, 0, known)
    conf = _confusable_set(cfg)
    best: Optional[PlateSim] = None
    for delta in sorted(cfg.shifts, key=lambda d: (abs(d), d)):
        exact, confus, mism = [], [], []
        total = 0.0
        for k in known:
            j = k + delta
            rc = pr[j] if 0 <= j < len(pr) else None
            m = char_match(pv[k], rc, cfg, conf) if rc is not None else 0.0
            total += m
            if m == 1.0:
                exact.append(k)
            elif m > 0:
                confus.append((k, pv[k], rc))
            else:
                mism.append((k, pv[k], rc))
        s = total / len(known) - cfg.shift_penalty * abs(delta)
        cand = PlateSim(max(0.0, s), delta, known, exact, confus, mism)
        # Strictly greater: an unshifted match wins ties.
        if best is None or cand.sim > best.sim + 1e-12:
            best = cand
    assert best is not None
    return best


def coverage_factor(known_count: int, cfg: MatchConfig) -> float:
    return min(1.0, known_count / cfg.coverage_full)


def wildcard_regex(pv: str) -> re.Pattern[str]:
    return re.compile("^" + "".join("." if c == UNKNOWN else re.escape(c) for c in pv) + "$")


def specificity(pv: str, registry: Sequence[RegistryRecord]) -> int:
    """How many registry plates fit every known character exactly (same length, no shift)."""
    if not pv:
        return len(registry)
    rx = wildcard_regex(pv)
    return sum(1 for r in registry if rx.match(r.plate))


# --------------------------------------------------------------------------- attributes
def color_similarity(obs: Optional[AttributeValue], reg_color: str, cfg: MatchConfig, low_light: bool) -> float:
    if obs is None or obs.uncertain:
        return 0.0
    if obs.value == reg_color:
        return 1.0
    pairs = list(cfg.adjacent_colors) + (list(cfg.adjacent_colors_low_light) if low_light else [])
    if frozenset((obs.value, reg_color)) in {frozenset(p) for p in pairs}:
        return cfg.adjacent_color_credit
    return 0.0


def body_similarity(obs: Optional[AttributeValue], reg_body: str) -> float:
    if obs is None or obs.uncertain:
        return 0.0
    return 1.0 if obs.value == reg_body else 0.0


def make_model_match(obs: Optional[AttributeValue], rec: RegistryRecord, cfg: MatchConfig) -> float:
    if obs is None or obs.uncertain or obs.confidence < cfg.mm_min_conf:
        return 0.0
    return 1.0 if obs.value.lower() == f"{rec.make} {rec.model}".lower() else 0.0


def weights(cfg: MatchConfig, low_light: bool) -> tuple[float, float, float]:
    if low_light:
        return cfg.low_light_w_plate, cfg.low_light_w_color, cfg.w_body
    return cfg.w_plate, cfg.w_color, cfg.w_body


# --------------------------------------------------------------------------- scoring
def _fmt_positions(ps: Sequence[int]) -> str:
    ps = [p + 1 for p in ps]
    if not ps:
        return ""
    if len(ps) == 1:
        return f"position {ps[0]}"
    return "positions " + ", ".join(str(p) for p in ps[:-1]) + f" and {ps[-1]}"


def score_candidate(
    pv: str,
    rec: RegistryRecord,
    color: Optional[AttributeValue],
    body: Optional[AttributeValue],
    make_model: Optional[AttributeValue],
    cfg: MatchConfig,
    tau: float,
    low_light: bool = False,
    hint_positions: Sequence[int] = (),
) -> tuple[float, ScoreBreakdown, list[str], list[str], int]:
    wp, wc, wb = weights(cfg, low_light)
    ps = plate_similarity(pv, rec.plate, cfg)
    K = len(ps.known)
    cov = coverage_factor(K, cfg)
    plate_part = wp * ps.sim * cov
    csim = color_similarity(color, rec.color, cfg, low_light)
    bsim = body_similarity(body, rec.body_type)
    mm = make_model_match(make_model, rec, cfg)
    base = plate_part + wc * csim + wb * bsim
    raw_total = base + cfg.mm_bonus * mm
    total = min(1.0, max(0.0, raw_total))
    capped = None
    if K == 0 and total > cfg.no_plate_cap:
        total = cfg.no_plate_cap
        capped = f"no readable plate characters: score capped at {cfg.no_plate_cap:.2f}"
    base_c = min(base, cfg.no_plate_cap) if K == 0 else min(1.0, base)
    if mm > 0 and base_c < tau <= total:
        total = round(tau - 0.001, 3)
        capped = "make/model bonus cannot lift a candidate over the threshold by itself"

    reasons: list[str] = []
    mismatches: list[str] = []
    unknown = [k for k, c in enumerate(pv) if c == UNKNOWN]
    if K == 0:
        reasons.append(f"Plate (0.00 of {wp:.2f}): no plate characters were readable.")
    else:
        parts = [f"{len(ps.exact)} of {K} known characters match"]
        if ps.shift:
            parts.append(
                f"best alignment shifts the reading by {ps.shift:+d} (a lost "
                f"{'first' if ps.shift > 0 else 'last'} character), penalty {cfg.shift_penalty * abs(ps.shift):.2f}"
            )
        for k, a, b in ps.confusable:
            parts.append(
                f"position {k + 1} shows '{a}' in the video and '{b}' in the registry, "
                f"a known OCR mix-up given {cfg.confusable_credit:.2f} credit"
            )
        if unknown:
            parts.append(f"{_fmt_positions(unknown)} unknown")
        if cov < 1.0:
            parts.append(f"coverage factor {cov:.2f} ({K} of {cfg.coverage_full} characters needed for full weight)")
        if hint_positions:
            parts.append(f"{_fmt_positions(hint_positions)} investigator-supplied")
        reasons.append(f"Plate ({plate_part:.2f} of {wp:.2f}): " + "; ".join(parts) + ".")
        for k, a, b in ps.mismatch:
            msg = (
                f"Mismatch at position {k + 1}: video shows '{a}', registry has "
                f"'{b if b is not None else '(nothing)'}'"
            )
            mismatches.append(msg)

    if color is None or color.uncertain:
        top = ", ".join(f"{l} {p:.2f}" for l, p in (color.top2 if color else []))
        reasons.append(f"Colour (0.00 of {wc:.2f}): uncertain{f' ({top})' if top else ''}, adds nothing.")
    elif csim == 1.0:
        reasons.append(f"Colour ({wc * csim:.2f} of {wc:.2f}): exact match ({color.value}, {color.confidence:.2f}).")
    elif csim > 0:
        reasons.append(
            f"Colour ({wc * csim:.2f} of {wc:.2f}): similar shade under CCTV "
            f"(video {color.value}, registry {rec.color})."
        )
    else:
        reasons.append(f"Colour (0.00 of {wc:.2f}): video {color.value}, registry {rec.color}.")
        mismatches.append(f"Colour mismatch: video {color.value}, registry {rec.color}")
    if low_light:
        reasons.append(
            f"Low-light clip: colour weight lowered to {wc:.2f} and plate weight raised to {wp:.2f}."
        )

    if body is None or body.uncertain:
        reasons.append(f"Body type (0.00 of {wb:.2f}): uncertain, adds nothing.")
    elif bsim == 1.0:
        reasons.append(f"Body type ({wb:.2f} of {wb:.2f}): exact match ({body.value}, {body.confidence:.2f}).")
    else:
        reasons.append(f"Body type (0.00 of {wb:.2f}): video {body.value}, registry {rec.body_type}.")
        mismatches.append(f"Body type mismatch: video {body.value}, registry {rec.body_type}")

    if make_model is not None and not make_model.uncertain:
        if mm > 0:
            reasons.append(
                f"Make/model (+{cfg.mm_bonus:.2f}): {make_model.value} ({make_model.confidence:.2f}) "
                "matches the registry; tie-breaker only."
            )
        elif make_model.confidence < cfg.mm_min_conf:
            reasons.append(f"Make/model: {make_model.value} ({make_model.confidence:.2f}) below "
                           f"{cfg.mm_min_conf:.2f}, not used.")
    if capped:
        reasons.append(f"Guardrail: {capped}.")

    bd = ScoreBreakdown(
        plate_sim=round(ps.sim, 4),
        coverage=round(cov, 4),
        plate=round(plate_part, 4),
        color_sim=csim,
        color=round(wc * csim, 4),
        body_sim=bsim,
        body=round(wb * bsim, 4),
        make_model=round(cfg.mm_bonus * mm, 4),
        raw_total=round(raw_total, 4),
        total=round(total, 4),
        w_plate=wp,
        w_color=wc,
        w_body=wb,
        capped=capped,
        shift=ps.shift,
    )
    return round(total, 4), bd, reasons, mismatches, len(ps.exact)


def match(
    plate: str,
    registry: Sequence[RegistryRecord],
    cfg: MatchConfig,
    color: Optional[AttributeValue] = None,
    body: Optional[AttributeValue] = None,
    make_model: Optional[AttributeValue] = None,
    tau: Optional[float] = None,
    low_light: bool = False,
    hint_positions: Sequence[int] = (),
) -> MatchResult:
    tau = cfg.tau if tau is None else float(tau)
    scored = []
    for rec in registry:
        s, bd, reasons, mism, n_exact = score_candidate(
            plate, rec, color, body, make_model, cfg, tau, low_light, hint_positions
        )
        contra = cfg.rank_contradictions_last and any(m.startswith("Mismatch at position") for m in mism)
        scored.append((s, bd.plate, rec.registry_id, rec, bd, reasons, mism, n_exact, contra))
    # Sort: candidates without plate contradictions first, then score desc, then unclipped
    # total (so the make/model tie-breaker still orders scores that saturate at 1.0), then
    # plate evidence, then registry id (deterministic).
    scored.sort(key=lambda t: (t[8], -t[0], -t[4].raw_total, -t[1], t[2]))
    K = sum(1 for c in plate if c != UNKNOWN)
    top = []
    for rank, (s, _, _, rec, bd, reasons, mism, n_exact, contra) in enumerate(scored[: cfg.top_n], start=1):
        if contra and rank > 1 and not scored[0][8]:
            reasons = reasons + [
                "Ranked below every candidate without a plate contradiction: the video confidently shows a "
                "different character."
            ]
        top.append(
            Candidate(
                rank=rank,
                registry_id=rec.registry_id,
                plate=rec.plate,
                color=rec.color,
                body_type=rec.body_type,
                make=rec.make,
                model=rec.model,
                owner_region=rec.owner_region,
                score=s,
                breakdown=bd,
                reasons=reasons,
                mismatches=mism,
                matched_known=n_exact,
                known_count=K,
            )
        )
    spec = specificity(plate, registry) if K else len(registry)
    spec_text = (
        f"{spec} of {len(registry)} registry plates fit the known characters of '{plate}'"
        if K
        else f"no known characters: all {len(registry)} registry plates fit"
    )
    status, explanation, gap = decide_status(top, K, tau, cfg, plate, color)
    return MatchResult(
        status=status,
        threshold_used=tau,
        top_candidates=top,
        explanation=explanation,
        known_count=K,
        specificity=spec,
        specificity_text=spec_text,
        low_light=low_light,
        gap=gap,
        registry_size=len(registry),
    )


def decide_status(
    top: Sequence[Candidate],
    K: int,
    tau: float,
    cfg: MatchConfig,
    plate: str,
    color: Optional[AttributeValue],
) -> tuple[MatchStatus, str, Optional[float]]:
    if not top:
        return MatchStatus.NO_CONFIDENT_MATCH, "The registry is empty, so there is nothing to match.", None
    best = top[0]

    def contradicts(c: Candidate) -> bool:
        return any(m.startswith("Mismatch at position") for m in c.mismatches)

    # The ambiguity gap is measured against the next candidate the video does not rule out:
    # a candidate that contradicts a confidently read character is not a rival.
    rivals = [c for c in top[1:] if not contradicts(c)] if not contradicts(best) else list(top[1:])
    gap = round(best.score - rivals[0].score, 4) if rivals else None
    if best.score < tau or K < cfg.min_known_for_match:
        parts = []
        if best.score < tau:
            parts.append(
                f"Best candidate {best.registry_id} scored {best.score:.2f}, below the {tau:.2f} threshold."
            )
        else:
            parts.append(f"Best candidate {best.registry_id} scored {best.score:.2f}.")
        known_pos = [k for k, c in enumerate(plate) if c != UNKNOWN]
        wp = best.breakdown.w_plate
        if K == 0:
            parts.append(
                f"No plate characters were readable, so the score is capped at {cfg.no_plate_cap:.2f} "
                "and colour and body type alone can never produce a match."
            )
        else:
            max_plate = wp * coverage_factor(K, cfg)
            pos_txt = _fmt_positions(known_pos)
            parts.append(
                f"Only {K} plate character{'s' if K != 1 else ''} {'were' if K != 1 else 'was'} readable "
                f"({pos_txt}), so plate evidence counts for at most {max_plate:.2f}"
                + (
                    f", and at least {cfg.min_known_for_match} known characters are needed for a match."
                    if K < cfg.min_known_for_match
                    else "."
                )
            )
        if color is None or color.uncertain:
            top2 = ", ".join(f"{l} {p:.2f}" for l, p in (color.top2 if color else []))
            parts.append(f"Colour was uncertain{f' ({top2})' if top2 else ''}, so it added nothing.")
        if best.mismatches:
            parts.append("Contradictions with the best candidate: " + "; ".join(best.mismatches) + ".")
        return MatchStatus.NO_CONFIDENT_MATCH, " ".join(parts), gap
    plate_mism = [m for m in best.mismatches if m.startswith("Mismatch at position")]
    if cfg.mismatch_blocks_match and plate_mism:
        clean = next((c for c in top[1:] if not any(m.startswith("Mismatch at position") for m in c.mismatches)), None)
        alt = (
            f" The best candidate with no plate contradiction is {clean.registry_id} (rank {clean.rank}, "
            f"{clean.score:.2f}); review it by hand."
            if clean is not None
            else " No shortlisted candidate is free of plate contradictions, so the true vehicle may not be in the registry."
        )
        return (
            MatchStatus.NO_CONFIDENT_MATCH,
            f"Best candidate {best.registry_id} scored {best.score:.2f}, but it contradicts a confidently read "
            f"plate character ({'; '.join(plate_mism)}). PRISM will not call a vehicle a match when the video "
            f"clearly shows a different character.{alt}",
            gap,
        )
    if gap is not None and gap < cfg.ambiguity_gap:
        second = rivals[0]
        return (
            MatchStatus.AMBIGUOUS,
            f"{best.registry_id} ({best.score:.2f}) and {second.registry_id} ({second.score:.2f}) are within "
            f"{cfg.ambiguity_gap:.2f} of each other, so PRISM cannot separate them. See the advisor note.",
            gap,
        )
    gap_txt = f", {gap:.2f} ahead of the next candidate the video does not rule out" if gap is not None else ""
    ruled_out = [c for c in top[1:] if contradicts(c) and c.score > best.score]
    extra = (
        " Higher-scoring " + ", ".join(c.registry_id for c in ruled_out)
        + " contradict a confidently read plate character and are ranked below it."
        if ruled_out
        else ""
    )
    return (
        MatchStatus.MATCHED,
        f"{best.registry_id} ({best.plate}) scored {best.score:.2f}, above the {tau:.2f} threshold{gap_txt}, "
        f"with {K} known plate characters.{extra}",
        gap,
    )
