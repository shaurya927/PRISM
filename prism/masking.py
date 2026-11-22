"""Confidence masking + format masking of a single OCR read.

Neither OCR backend applies a threshold itself. Every raw read goes through
`mask_read`, which:
  1. drops layout separators (spaces, dashes) and their confidences,
  2. upper-cases letters (Indian plates are upper-case only; the letter is unchanged),
  3. turns any character with confidence < tau_char, or outside A-Z/0-9, into '?',
  4. runs the plate format check, which can only turn more characters into '?'.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from prism.config import OCRConfig
from prism.plate_grammar import ALNUM, UNKNOWN, format_mask


@dataclass
class MaskedRead:
    raw_text: str                 # raw OCR string as returned by the backend
    raw_chars: list[str]          # after separator removal + upper-casing
    raw_confs: list[float]
    chars: list[str]              # masked
    reasons: list[str | None]
    conflicts: list[str] = field(default_factory=list)
    layout: str | None = None

    @property
    def masked_text(self) -> str:
        return "".join(self.chars)

    @property
    def confs(self) -> list[float]:
        return self.raw_confs


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


def mask_read(raw_text: str, confs: Sequence[float], cfg: OCRConfig) -> MaskedRead:
    conflicts: list[str] = []
    confs = [float(x) for x in confs]
    if len(confs) != len(raw_text):
        conflicts.append(
            f"OCR returned {len(confs)} confidences for {len(raw_text)} characters; "
            "missing confidences treated as 0"
        )
        confs = (confs + [0.0] * len(raw_text))[: len(raw_text)]

    raw_chars: list[str] = []
    raw_confs: list[float] = []
    for c, p in zip(raw_text, confs):
        if c in cfg.separators:
            continue
        raw_chars.append(c.upper())
        raw_confs.append(p)

    chars, reasons = confidence_mask(raw_chars, raw_confs, cfg.char_conf)
    fmt = format_mask(chars)
    for i in fmt.masked_positions:
        reasons[i] = "format"
    conflicts.extend(fmt.conflicts)
    return MaskedRead(
        raw_text=raw_text,
        raw_chars=raw_chars,
        raw_confs=raw_confs,
        chars=fmt.chars,
        reasons=reasons,
        conflicts=conflicts,
        layout=fmt.layout,
    )
