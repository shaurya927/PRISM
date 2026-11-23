"""Layout-constrained decoding: a Bayesian Indian plate grammar over the OCR model's own probabilities.

OCR reads each position on its own, so look-alikes (0/O, 8/B, 1/I, 5/S, 2/Z, 6/G, 4/A) are common.
Two shortcuts are both wrong for evidence:
  * a fixed rule "B in a digit slot means 8" writes characters the camera never showed;
  * masking every impossible character to '?' (prism.plate_grammar.format_mask) throws away what the
    model did see: PARSeq often ranks the right character second.

This module combines the two. The supported layouts (MoRTH standard SS DD L{1,3} DDDD with the state
code checked as a pair against the state/UT list, old Delhi, Bharat series BH, and reads that lost
their first or last character at the plate edge) act as a finite-state grammar. For one read with
per-position distributions p_k(c):

    likelihood of layout t   L(t) = prod_k sum_{c in slot_k(t)} p_k(c)      (state code: joint over valid pairs)
    layout posterior         P(t) = prior(t) * L(t) / sum_t' prior(t') * L(t')
    character posterior      q_k(c) = sum_t P(t) * p_k(c) * [c in slot_k(t)] / sum_{c' in slot_k(t)} p_k(c')
    slot agreement           A_k(c) = sum_t P(t) * [c in slot_k(t)]

Decision rule (only positions whose top OCR character the likely layouts rule out, A_k(top) <= 1 -
layout_min_agreement): the position becomes c* = argmax_{c != top} q_k(c) only if
    p_k(c*) >= layout_min_model_prob     (the model itself saw c* there),
    q_k(c*) >= char_conf                  (same bar as any directly read character),
    A_k(c*) >= layout_min_agreement       (the likely layouts agree on the slot type),
and the full reading then passes the plate format check at that position. Otherwise it becomes '?'.
Nothing is re-decided (ruled-out characters are only masked) when the read breaks the layout in more
than `layout_max_ruled_out` places, or when it only fits as a plate that lost an edge character: on
the benchmark those reads were mostly misaligned or hallucinated text, where the model's runner-up is
no better than its top choice.
That includes a confident top character the count-based format check could not place (e.g.
"CG0BMX4821" fits two layouts with one violation each, so format_mask keeps the B; with the model's
probabilities the single-digit-RTO layout is ruled out because RTO 0 does not exist, so B is in a
digit slot): it is re-decided or masked, never kept.

Guarantees
  * A character that fits the likely layouts is never changed. A ruled-out character is replaced only
    by the model's own alternative, or masked to '?'.
  * Every character written here was given at least `layout_min_model_prob` by the OCR model. Its vote
    weight in fusion is the model's own probability, not the layout posterior, so one frame is never
    enough: the multi-frame two-condition vote and the consistency check still apply.
  * Every such character is labelled (CharRead.layout_from, model_prob, layout_prob).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional, Sequence

from prism.config import STATE_CODES, OCRConfig
from prism.plate_grammar import ALNUM, UNKNOWN, Template, _cut_templates, format_mask, templates_for_length

_STATES = tuple(sorted(set(STATE_CODES)))
_EPS = 1e-9


@dataclass
class LayoutChoice:
    index: int
    top: str                      # OCR's top character (ruled out by the layouts)
    char: str                     # character written (or '?' if the rule did not accept one)
    model_prob: float             # p_k(char)
    layout_prob: float            # q_k(char)
    agreement: float              # A_k(char)
    accepted: bool
    note: str
    committed: bool = False       # the top character had passed confidence and format masking
    top_agreement: float = 0.0    # A_k(top): share of the layout posterior that allows the top character


@dataclass
class LayoutDecode:
    chars: list[str]                                  # characters after decoding
    choices: list[LayoutChoice] = field(default_factory=list)
    layout_posterior: dict[str, float] = field(default_factory=dict)

    @property
    def accepted(self) -> list[LayoutChoice]:
        return [c for c in self.choices if c.accepted]


def _candidate_templates(n: int, cut_prior: float) -> list[tuple[Template, float, bool]]:
    return ([(t, 1.0, False) for t in templates_for_length(n)]
            + [(t, cut_prior, True) for t in _cut_templates(n)])


def _dist(raw: str, conf: float, d: Optional[dict[str, float]]) -> dict[str, float]:
    """The position's distribution over plate characters; a point mass on the top char if unknown."""
    if d:
        return {c: max(0.0, float(p)) for c, p in d.items() if c in ALNUM}
    return {raw: float(conf)} if raw in ALNUM else {}


def _state_mass(d0: dict[str, float], d1: dict[str, float], pos0: frozenset, pos1: frozenset) -> float:
    return sum(d0.get(s[0], 0.0) * d1.get(s[1], 0.0) for s in _STATES if s[0] in pos0 and s[1] in pos1)


def _slot_mass(d: dict[str, float], slot: frozenset) -> float:
    return sum(p for c, p in d.items() if c in slot)


def _template_terms(t: Template, dists: list[dict[str, float]]) -> Optional[list[float]]:
    """Per-position slot mass under template t (state pair folded into position 0, 1.0 at position 1)."""
    out = []
    for k, slot in enumerate(t.slots):
        if t.state_code and k == 0:
            out.append(_state_mass(dists[0], dists[1], t.slots[0], t.slots[1]))
        elif t.state_code and k == 1:
            out.append(1.0)
        else:
            out.append(_slot_mass(dists[k], slot))
    return out


def _char_prob_under(t: Template, k: int, c: str, dists: list[dict[str, float]], terms: list[float]) -> float:
    """P(char at k = c | layout t, model distributions)."""
    if t.state_code and k in (0, 1):
        m = terms[0]
        if m <= _EPS:
            return 0.0
        d0, d1 = dists[0], dists[1]
        if k == 0:
            num = sum(d0.get(c, 0.0) * d1.get(s[1], 0.0) for s in _STATES if s[0] == c and s[1] in t.slots[1])
        else:
            num = sum(d0.get(s[0], 0.0) * d1.get(c, 0.0) for s in _STATES if s[1] == c and s[0] in t.slots[0])
        return num / m
    if c not in t.slots[k]:
        return 0.0
    m = terms[k]
    return dists[k].get(c, 0.0) / m if m > _EPS else 0.0


def _allowed(t: Template, k: int, c: str) -> bool:
    if c not in t.slots[k]:
        return False
    if t.state_code and k in (0, 1):
        return any(s[k] == c for s in _STATES)
    return True


def layout_decode(raw_chars: Sequence[str], raw_confs: Sequence[float], masked_chars: Sequence[str],
                  dists: Sequence[Optional[dict[str, float]]], cfg: OCRConfig) -> LayoutDecode:
    """Fill positions that masking left as '?' because their top character breaks the layout."""
    chars = list(masked_chars)
    n = len(chars)
    if not cfg.layout_decode or n == 0 or not any(dists):
        return LayoutDecode(chars)
    ds = [_dist(r, p, d) for r, p, d in zip(raw_chars, raw_confs, dists)]
    tpls = _candidate_templates(n, cfg.layout_cut_prior)
    scored = []
    cut = []
    for t, prior, is_cut in tpls:
        if prior <= 0:
            continue
        terms = _template_terms(t, ds)
        logl = sum(math.log(max(x, _EPS)) for x in terms) + math.log(prior)
        scored.append((t, terms, logl))
        cut.append(is_cut)
    if not scored:
        return LayoutDecode(chars)
    mx = max(s[2] for s in scored)
    ws = [math.exp(s[2] - mx) for s in scored]
    z = sum(ws)
    post = [(t, terms, w / z) for (t, terms, _), w in zip(scored, ws)]
    cut_mass = sum(w for (_, _, w), c in zip(post, cut) if c)
    out = LayoutDecode(chars, layout_posterior={})
    for t, _, w in post:
        if w >= 0.01:
            out.layout_posterior[t.name] = round(out.layout_posterior.get(t.name, 0.0) + w, 4)

    def agreement(k: int, c: str) -> float:
        return sum(w for t, _, w in post if _allowed(t, k, c))

    def qprob(k: int, c: str) -> float:
        return sum(w * _char_prob_under(t, k, c, ds, terms) for t, terms, w in post)

    ruled_out = []
    for k in range(n):
        top = raw_chars[k] if k < len(raw_chars) else UNKNOWN
        if top not in ALNUM or not ds[k] or chars[k] not in (UNKNOWN, top):
            continue
        a_top = agreement(k, top)
        if a_top > 1.0 - cfg.layout_min_agreement:
            continue  # the top character fits a likely layout: never changed (if '?', it was low confidence)
        ruled_out.append((k, top, a_top))

    # A read that breaks the layout in several places, or that only fits as a plate with a lost edge
    # character, is too unreliable to re-decide: its ruled-out characters are only masked.
    refuse = ""
    if len(ruled_out) > cfg.layout_max_ruled_out:
        refuse = f"{len(ruled_out)} characters break the layout (more than {cfg.layout_max_ruled_out}); masked only"
    elif cut_mass > 1.0 - cfg.layout_min_agreement:
        refuse = "the read only fits a plate with a lost edge character; masked only"

    for k, top, a_top in ruled_out:
        committed = chars[k] == top
        if refuse:
            out.choices.append(LayoutChoice(k, top, UNKNOWN, 0.0, 0.0, 0.0, False, refuse, committed, round(a_top, 4)))
            chars[k] = UNKNOWN
            continue
        cands = [c for c in ds[k] if c != top]
        if not cands:
            out.choices.append(LayoutChoice(k, top, UNKNOWN, 0.0, 0.0, 0.0, False,
                                            f"'{top}' does not fit the likely layouts and the model offered no alternative",
                                            committed, round(a_top, 4)))
            if committed:
                chars[k] = UNKNOWN
            continue
        best = max(cands, key=lambda c: (qprob(k, c), ds[k][c], c))
        p, q, a = ds[k][best], qprob(k, best), agreement(k, best)
        reasons = []
        if p < cfg.layout_min_model_prob:
            reasons.append(f"model gave '{best}' only {p:.2f} < {cfg.layout_min_model_prob:.2f}")
        if q < cfg.char_conf:
            reasons.append(f"after the layout '{best}' reaches only {q:.2f} < {cfg.char_conf:.2f}")
        if a < cfg.layout_min_agreement:
            reasons.append(f"the likely layouts disagree on this slot ({a:.2f} < {cfg.layout_min_agreement:.2f})")
        ok = not reasons
        out.choices.append(LayoutChoice(k, top, best if ok else UNKNOWN, round(p, 4), round(q, 4), round(a, 4), ok,
                                        "; ".join(reasons), committed, round(a_top, 4)))
        chars[k] = best if ok else UNKNOWN

    # The decoded reading must itself pass the format check at every position it wrote.
    if out.accepted:
        fmt = format_mask(chars)
        for ch in out.accepted:
            if ch.index in fmt.masked_positions:
                ch.accepted = False
                ch.note = f"'{ch.char}' would still break the plate layout"
                ch.char = UNKNOWN
                chars[ch.index] = UNKNOWN
    out.chars = chars
    return out
