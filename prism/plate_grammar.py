"""Indian number-plate format rules.

Supported layouts (separators removed):
  * Standard:      SS D{1,2} L{1,3} DDDD     e.g. CG04MX4821, MH12DE5678
                   (a single-digit RTO is 1-9; two-digit RTOs are 01-99)
  * Delhi (old):   DL D{1,2} C L{0,2} DDDD   e.g. DL1CAB1234 (a sub-case of Standard)
  * Bharat series: YY BH DDDD L{1,2}        e.g. 22BH1234AA

`format_mask` is the only function used by the pipeline. It can turn a character
into '?' but it never adds, removes or changes a character. If the reading length
fits no layout, nothing is masked (we cannot tell which position is wrong).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Sequence

from prism.config import STATE_CODES

UNKNOWN = "?"
LETTERS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGITS = frozenset("0123456789")
ALNUM = LETTERS | DIGITS

_STATE_SET = frozenset(STATE_CODES)


@dataclass(frozen=True)
class Template:
    name: str
    slots: tuple[frozenset[str], ...]  # allowed characters per position
    state_code: bool                   # positions 0-1 must form a valid state code
    cut: str = ""                      # "" | "first" | "last": a character lost at the plate edge

    def __len__(self) -> int:
        return len(self.slots)


def _cut_templates(n: int) -> list[Template]:
    """Layouts of length n+1 with the first or last slot removed (plate edge cut off)."""
    out = []
    for t in all_templates():
        if len(t) != n + 1:
            continue
        out.append(Template(t.name + " (first character lost)", t.slots[1:], False, "first"))
        out.append(Template(t.name + " (last character lost)", t.slots[:-1], t.state_code, "last"))
    return out


NONZERO = DIGITS - {"0"}


@lru_cache(maxsize=1)
def all_templates() -> tuple[Template, ...]:
    out: list[Template] = []
    for d in (1, 2):
        # RTO codes start at 1: a single-digit RTO (Delhi's DL 3 C ...) is 1-9, never 0.
        rto = (NONZERO,) if d == 1 else (DIGITS, DIGITS)
        for l in (1, 2, 3):
            slots = (LETTERS, LETTERS) + rto + (LETTERS,) * l + (DIGITS,) * 4
            out.append(Template(f"standard SS D{{{d}}} L{{{l}}} DDDD", slots, True))
    for l in (1, 2):
        slots = (DIGITS, DIGITS, frozenset("B"), frozenset("H")) + (DIGITS,) * 4 + (LETTERS,) * l
        out.append(Template(f"bharat YY BH DDDD L{{{l}}}", slots, False))
    return tuple(out)


def templates_for_length(n: int) -> list[Template]:
    return [t for t in all_templates() if len(t) == n]


def _state_violations(chars: Sequence[str]) -> set[int]:
    """Positions (0/1) whose known letters cannot be part of any valid state code."""
    a, b = chars[0], chars[1]
    if a == UNKNOWN and b == UNKNOWN:
        return set()
    if a != UNKNOWN and b != UNKNOWN:
        return set() if (a + b) in _STATE_SET else {0, 1}
    if a != UNKNOWN:
        return set() if any(s[0] == a for s in _STATE_SET) else {0}
    return set() if any(s[1] == b for s in _STATE_SET) else {1}


def template_violations(chars: Sequence[str], tpl: Template) -> set[int]:
    bad = {i for i, (c, allowed) in enumerate(zip(chars, tpl.slots)) if c != UNKNOWN and c not in allowed}
    if tpl.state_code:
        # Only check the state code where the slot test passed (letters).
        st = [c if i not in bad else UNKNOWN for i, c in enumerate(chars[:2])]
        bad |= _state_violations(st)
    elif tpl.cut == "first" and tpl.slots and tpl.slots[0] == LETTERS and chars and chars[0] != UNKNOWN \
            and 0 not in bad and not any(s[1] == chars[0] for s in _STATE_SET):
        bad.add(0)  # remaining first char is the second letter of a state code
    return bad


@dataclass
class FormatCheck:
    chars: list[str]
    masked_positions: list[int]
    conflicts: list[str]
    layout: str | None


def format_mask(chars: Sequence[str]) -> FormatCheck:
    """Mask (never add or change) characters that break every best-fitting layout."""
    chars = list(chars)
    if not chars:
        return FormatCheck(chars, [], [], None)
    tpls = templates_for_length(len(chars))
    scored = [(template_violations(chars, t), t) for t in tpls]
    # A read that lost its first or last character at the plate edge is checked against the
    # cut layouts too, but only when they fit strictly better than every full layout.
    cut = [(template_violations(chars, t), t) for t in _cut_templates(len(chars))]
    if cut:
        best_full = min((len(v) for v, _ in scored), default=10**9)
        best_cut = min(len(v) for v, _ in cut)
        if best_cut < best_full:
            scored = cut
    if not scored:
        return FormatCheck(chars, [], [], None)
    best = min(len(v) for v, _ in scored)
    best_sets = [(v, t) for v, t in scored if len(v) == best]
    # Only mask positions that violate *every* equally good layout, so the check
    # never removes a character that one plausible layout would accept.
    to_mask = set.intersection(*(v for v, _ in best_sets)) if best_sets else set()
    layout = best_sets[0][1].name if len(best_sets) == 1 else " | ".join(t.name for _, t in best_sets)
    conflicts: list[str] = []
    out = list(chars)
    for i in sorted(to_mask):
        conflicts.append(
            f"position {i + 1}: '{chars[i]}' does not fit the Indian plate layout ({layout}); masked to '?'"
        )
        out[i] = UNKNOWN
    return FormatCheck(out, sorted(to_mask), conflicts, layout)


_FULL_RE = re.compile(
    r"^(?:(?P<state>[A-Z]{2})(?P<rto>[1-9]|\d{2})(?P<series>[A-Z]{1,3})(?P<num>\d{4})"
    r"|(?P<yy>\d{2})BH(?P<bnum>\d{4})(?P<bser>[A-Z]{1,2}))$"
)


def is_valid_plate(plate: str) -> bool:
    """True if a complete plate (no '?') fits a supported layout with a valid state code."""
    m = _FULL_RE.match(plate)
    if not m:
        return False
    if m.group("state"):
        return m.group("state") in _STATE_SET
    return True


def pretty(plate: str) -> str:
    """Insert spaces for display: CG04MX4821 -> CG 04 MX 4821."""
    m = _FULL_RE.match(plate.replace(UNKNOWN, "X")) if plate else None
    if not m:
        return plate
    if m.group("state"):
        spans = [m.span("state"), m.span("rto"), m.span("series"), m.span("num")]
    else:
        spans = [m.span("yy"), (m.end("yy"), m.end("yy") + 2), m.span("bnum"), m.span("bser")]
    return " ".join(plate[a:b] for a, b in spans)
