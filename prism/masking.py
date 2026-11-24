"""Confidence masking + format masking of a single OCR read.

Neither OCR backend applies a threshold itself. Every raw read goes through
`mask_read`, which:
  1. drops layout separators (spaces, dashes) and their confidences,
  2. upper-cases letters (Indian plates are upper-case only; the letter is unchanged),
  3. turns any character with confidence < tau_char, or outside A-Z/0-9, into '?',
  4. runs the plate format check, which can only turn more characters into '?',
  5. if the OCR model's per-position distributions are available, runs layout-constrained
     decoding (prism.layout_decode) on the positions whose top character the plate layouts rule
     out. It can fill such a '?' only with a character the model itself offered there, and labels
     it; a character that fits the layout is never changed.

`cross_check` then compares the result with an independent second OCR model reading the same
crop. A committed character that the second model reads differently (with confidence) becomes
'?'. Like every other step it can only remove characters, never add or change one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

from prism.config import OCRConfig
from prism.layout_decode import layout_decode
from prism.plate_grammar import ALNUM, UNKNOWN, format_mask


@dataclass
class MaskedRead:
    raw_text: str                 # raw OCR string as returned by the backend
    raw_chars: list[str]          # after separator removal + upper-casing
    raw_confs: list[float]
    chars: list[str]              # masked (and layout-decoded)
    reasons: list[str | None]
    conflicts: list[str] = field(default_factory=list)
    layout: str | None = None
    # per position, None unless layout-constrained decoding wrote the character
    layout_from: list[Optional[str]] = field(default_factory=list)   # OCR's top character it replaced
    model_probs: list[Optional[float]] = field(default_factory=list)  # model probability of the written char
    layout_probs: list[Optional[float]] = field(default_factory=list) # its probability given the layouts
    alts: list[dict[str, float]] = field(default_factory=list)        # model's top alternatives (for audit)
    # OCR cross-check (cross_check): the second model's aligned character and confidence per position
    check_backend: Optional[str] = None
    check_text: Optional[str] = None
    check_chars: list[Optional[str]] = field(default_factory=list)
    check_confs: list[Optional[float]] = field(default_factory=list)

    @property
    def masked_text(self) -> str:
        return "".join(self.chars)

    @property
    def confs(self) -> list[float]:
        return self.raw_confs

    @property
    def vote_confs(self) -> list[float]:
        """Fusion weight per position: the model's own probability of the character that votes."""
        return [m if m is not None else p for p, m in zip(self.raw_confs, self.model_probs or [None] * len(self.raw_confs))]

    @property
    def format_masked(self) -> int:
        """Confident characters that broke the layout (masked, or re-decided by the layout)."""
        return sum(1 for r in self.reasons if r in ("format", "layout"))


def char_reads(m: "MaskedRead") -> list:
    """CharRead audit records for a masked read (one per plate character)."""
    from prism.schemas import CharRead

    n = len(m.chars)
    lf = m.layout_from or [None] * n
    mp = m.model_probs or [None] * n
    lp = m.layout_probs or [None] * n
    al = m.alts or [{}] * n
    cc = m.check_chars or [None] * n
    cp = m.check_confs or [None] * n
    return [
        CharRead(char=c, raw_char=r, conf=round(p, 4), reason=why, layout_from=f, model_prob=pm, layout_prob=pl, alts=a,
                 check_char=k, check_conf=None if kp is None else round(kp, 4))
        for c, r, p, why, f, pm, pl, a, k, kp in zip(m.chars, m.raw_chars, m.raw_confs, m.reasons, lf, mp, lp, al, cc, cp)
    ]


def observation(read_id: str, m: "MaskedRead", sharpness: float):
    """A fusion ReadObservation from a masked read, carrying the layout-constrained weights."""
    from prism.fusion import ReadObservation

    return ReadObservation(read_id, list(m.chars), list(m.raw_chars), list(m.raw_confs), float(sharpness),
                           format_masked=m.format_masked, layout_probs=list(m.model_probs) or None)


def confidence_mask(chars: Sequence[str], confs: Sequence[float], tau: float) -> tuple[list[str], list[str | None]]:
    out: list[str] = []
    reasons: list[str | None] = []
    for c, p in zip(chars, confs):
        if c not in ALNUM:
            out.append(UNKNOWN)
            reasons.append("non_alphanumeric")
        elif p < tau:
            out.append(UNKNOWN)
            reasons.append("low_confidence")
        else:
            out.append(c)
            reasons.append(None)
    return out, reasons


def _alts(d: Optional[dict[str, float]], n: int = 4) -> dict[str, float]:
    if not d:
        return {}
    return {c: round(float(p), 4) for c, p in sorted(d.items(), key=lambda kv: -kv[1])[:n]}


def mask_read(raw_text: str, confs: Sequence[float], cfg: OCRConfig,
              dists: Optional[Sequence[Optional[dict[str, float]]]] = None) -> MaskedRead:
    conflicts: list[str] = []
    confs = [float(x) for x in confs]
    if len(confs) != len(raw_text):
        conflicts.append(
            f"OCR returned {len(confs)} confidences for {len(raw_text)} characters; "
            "missing confidences treated as 0"
        )
        confs = (confs + [0.0] * len(raw_text))[: len(raw_text)]
    dists = list(dists) if dists is not None else []
    dists = (dists + [None] * len(raw_text))[: len(raw_text)]

    raw_chars: list[str] = []
    raw_confs: list[float] = []
    raw_dists: list[Optional[dict[str, float]]] = []
    for c, p, d in zip(raw_text, confs, dists):
        if c in cfg.separators:
            continue
        raw_chars.append(c.upper())
        raw_confs.append(p)
        raw_dists.append(d)

    chars, reasons = confidence_mask(raw_chars, raw_confs, cfg.char_conf)
    fmt = format_mask(chars)
    for i in fmt.masked_positions:
        reasons[i] = "format"
    n = len(raw_chars)
    layout_from: list[Optional[str]] = [None] * n
    model_probs: list[Optional[float]] = [None] * n
    layout_probs: list[Optional[float]] = [None] * n
    out_chars = list(fmt.chars)
    fmt_conflicts = {i: msg for i, msg in zip(fmt.masked_positions, fmt.conflicts)}
    if any(raw_dists):
        dec = layout_decode(raw_chars, raw_confs, out_chars, raw_dists, cfg)
        for ch in dec.choices:
            if ch.accepted:
                out_chars[ch.index] = ch.char
                reasons[ch.index] = "layout"
                layout_from[ch.index] = ch.top
                model_probs[ch.index] = ch.model_prob
                layout_probs[ch.index] = ch.layout_prob
                fmt_conflicts[ch.index] = (
                    f"position {ch.index + 1}: '{ch.top}' does not fit the Indian plate layout; layout-constrained "
                    f"read '{ch.char}' (OCR model {ch.model_prob:.2f}, after the layout {ch.layout_prob:.2f})"
                )
            elif ch.committed:
                # a confident character that only the probabilistic layout check could place: masked
                out_chars[ch.index] = UNKNOWN
                reasons[ch.index] = "format"
                fmt_conflicts[ch.index] = (
                    f"position {ch.index + 1}: '{ch.top}' does not fit the likely Indian plate layout "
                    f"(allowed by {ch.top_agreement:.0%} of it); masked to '?'"
                    + (f" (no layout-constrained read: {ch.note})" if ch.note else "")
                )
            elif ch.index in fmt_conflicts and ch.note:
                fmt_conflicts[ch.index] += f"; no layout-constrained read: {ch.note}"
    conflicts.extend(fmt_conflicts[i] for i in sorted(fmt_conflicts))
    return MaskedRead(
        raw_text=raw_text,
        raw_chars=raw_chars,
        raw_confs=raw_confs,
        chars=out_chars,
        reasons=reasons,
        conflicts=conflicts,
        layout=fmt.layout,
        layout_from=layout_from,
        model_probs=model_probs,
        layout_probs=layout_probs,
        alts=[_alts(d) for d in raw_dists],
    )


def cross_check(m: MaskedRead, check_text: str, check_confs: Sequence[float], cfg: OCRConfig,
                check_backend: str = "second OCR") -> MaskedRead:
    """Second opinion from an independent OCR model that read the same crop. Only adds '?'.

    The second read is cleaned the same way (separators dropped, upper-cased) and aligned to the
    primary read. For every committed character of the primary read:

    * the second model read the same character: kept;
    * it read a different letter or digit with confidence >= cross_check_veto_conf: masked to '?'
      (reason "ocr_disagreement"), because two models that disagree are not "high certainty";
    * otherwise (no aligned character, or a low-confidence one): kept in "veto" mode; in "agree" mode
      kept only if the primary confidence is at least cross_check_keep_conf.

    A second read whose length differs from the primary by more than cross_check_max_len_diff
    cannot be aligned reliably: it vetoes nothing, and in "agree" mode it confirms nothing."""
    from prism.fusion import align

    n = len(m.chars)
    confs = (list(map(float, check_confs)) + [0.0] * len(check_text))[: len(check_text)]
    chars2: list[str] = []
    confs2: list[float] = []
    for c, p in zip(check_text, confs):
        if c in cfg.separators:
            continue
        chars2.append(c.upper())
        confs2.append(p)
    m.check_backend = check_backend
    m.check_text = check_text
    m.check_chars = [None] * n
    m.check_confs = [None] * n
    if abs(len(chars2) - len(m.raw_chars)) > cfg.cross_check_max_len_diff:
        m.conflicts.append(
            f"cross-check: {check_backend} read '{check_text}' ({len(chars2)} characters against {len(m.raw_chars)}); "
            "too different in length to compare" + ("; no character is confirmed" if cfg.cross_check_mode == "agree" else "")
        )
        chars2, confs2 = [], []  # nothing aligned: "veto" keeps every character, "agree" confirms none
    mapping = align(chars2, m.raw_chars) if chars2 else [None] * n
    for k, idx in enumerate(mapping):
        if idx is not None:
            m.check_chars[k] = chars2[idx]
            m.check_confs[k] = confs2[idx]
    for k in range(n):
        c = m.chars[k]
        if c == UNKNOWN:
            continue
        c2, p2 = m.check_chars[k], m.check_confs[k]
        if c2 == c:
            continue
        if c2 is not None and c2 in ALNUM and p2 is not None and p2 >= cfg.cross_check_veto_conf:
            why = f"{check_backend} read '{c2}' at {p2:.2f}"
        elif cfg.cross_check_mode == "agree" and m.raw_confs[k] < cfg.cross_check_keep_conf:
            why = f"{check_backend} did not confirm it" + (f" (read '{c2}' at {p2:.2f})" if c2 is not None else "")
        else:
            continue
        m.chars[k] = UNKNOWN
        m.reasons[k] = "ocr_disagreement"
        if m.layout_from:
            m.layout_from[k] = None
        if m.model_probs:
            m.model_probs[k] = None
        if m.layout_probs:
            m.layout_probs[k] = None
        m.conflicts.append(f"position {k + 1}: '{c}' masked to '?': {why}")
    return m
