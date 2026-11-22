"""Stage 5a: multi-frame plate fusion.

1. Take the modal read length L; the most confident read of that length is the reference.
2. Align every read to the reference with edit-distance alignment where '?' matches
   anything. This handles frames that lost the first or last character.
3. W_k(a) = sum_t I(c_tk = a) * p_tk * min(S_t / S_ref, cap)
4. Two-condition vote: accept a* only if W_k(a*) >= 0.9 AND W_k(a*) / sum_a W_k(a) >= 0.60.

Only characters that survived masking (confidence >= tau_char, valid format) carry
weight, so every fused character was read with confidence in at least one real frame.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from prism.config import FusionConfig
from prism.plate_grammar import ALNUM, UNKNOWN, format_mask
from prism.schemas import FrameRead, FusedPlate, FusedPosition, VoteCell


@dataclass
class ReadObservation:
    read_id: str
    chars: list[str]          # masked characters
    raw_chars: list[str]
    raw_confs: list[float]
    sharpness: float
    format_masked: int = 0    # confident characters the plate format check turned into '?'

    @classmethod
    def from_frame_read(cls, fr: FrameRead) -> "ReadObservation":
        return cls(
            read_id=fr.read_id,
            chars=[c.char for c in fr.chars],
            raw_chars=[c.raw_char for c in fr.chars],
            raw_confs=[float(c.conf) for c in fr.chars],
            sharpness=float(fr.sharpness),
            format_masked=sum(1 for c in fr.chars if c.reason == "format"),
        )

    @property
    def plausible(self) -> bool:
        """False if the format check had to mask too many confident characters: the OCR read
        something that is not a plate (a word, a logo). Such reads cast no votes."""
        n = len(self.chars)
        if n < min(PLAUSIBLE_LENGTHS) - MAX_LENGTH_DIFF or n > max(PLAUSIBLE_LENGTHS) + MAX_LENGTH_DIFF:
            return False
        kept = sum(1 for c in self.chars if c != UNKNOWN)
        confident = kept + self.format_masked
        return confident == 0 or self.format_masked / confident <= MAX_FORMAT_MASKED_SHARE

    @property
    def known_conf_sum(self) -> float:
        return sum(p for c, p in zip(self.chars, self.raw_confs) if c != UNKNOWN)


def quality_weight(sharpness: float, cfg: FusionConfig) -> float:
    return min(max(sharpness, 0.0) / cfg.s_ref, cfg.sharpness_cap)


def _sub_cost(a: str, b: str) -> int:
    return 0 if (a == b or a == UNKNOWN or b == UNKNOWN) else 1


def align(read: Sequence[str], ref: Sequence[str]) -> list[Optional[int]]:
    """Edit-distance alignment. Returns, for each reference position, the read index or None."""
    n, m = len(read), len(ref)
    INF = 10**9
    d = [[INF] * (m + 1) for _ in range(n + 1)]
    d[0][0] = 0
    for i in range(n + 1):
        for j in range(m + 1):
            if i == 0 and j == 0:
                continue
            best = INF
            if i > 0 and j > 0:
                best = min(best, d[i - 1][j - 1] + _sub_cost(read[i - 1], ref[j - 1]))
            if i > 0:
                best = min(best, d[i - 1][j] + 1)
            if j > 0:
                best = min(best, d[i][j - 1] + 1)
            d[i][j] = best
    mapping: list[Optional[int]] = [None] * m
    i, j = n, m
    while i > 0 or j > 0:
        # Deterministic preference: diagonal, then skip a read char, then a gap in the read.
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + _sub_cost(read[i - 1], ref[j - 1]):
            mapping[j - 1] = i - 1
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            i -= 1
        else:
            j -= 1
    return mapping


PLAUSIBLE_LENGTHS = range(8, 12)  # every supported Indian layout is 8-11 characters
MAX_LENGTH_DIFF = 2
MAX_FORMAT_MASKED_SHARE = 1 / 3


def _camera(read_id: str) -> str:
    """Read IDs are F<frame>[c] for clip A and <role>F<frame>[c] for other clips (e.g. BF42)."""
    return read_id[0] if read_id and read_id[0] != "F" and len(read_id) > 1 and read_id[1] == "F" else "A"


def _pick_reference(reads: Sequence[ReadObservation]) -> tuple[int, Optional[ReadObservation]]:
    # Truncated reads (e.g. OCR stopping after "CG" on a dark frame) still vote after alignment,
    # but they must not set the plate length when plate-length reads exist.
    plausible = [r for r in reads if len(r.chars) in PLAUSIBLE_LENGTHS]
    lengths = Counter(len(r.chars) for r in (plausible or reads) if r.chars)
    if not lengths:
        return 0, None
    reads = plausible or list(reads)
    conf_by_len: dict[int, float] = {}
    fmt_by_len: dict[int, int] = {}
    for r in reads:
        if r.chars:
            n = len(r.chars)
            conf_by_len[n] = conf_by_len.get(n, 0.0) + r.known_conf_sum
            fmt_by_len[n] = fmt_by_len.get(n, 0) + r.format_masked
    # Mode; ties broken by fewer format-check violations (the length whose reads fit an Indian
    # layout), then total confident evidence, then length (deterministic).
    L = max(lengths, key=lambda n: (lengths[n], -fmt_by_len.get(n, 0), conf_by_len[n], n))
    same = [r for r in reads if len(r.chars) == L]
    ref = max(same, key=lambda r: (r.known_conf_sum, -same.index(r)))
    return L, ref


def fuse_reads(reads: Sequence[ReadObservation], cfg: FusionConfig, apply_format: bool = True) -> FusedPlate:
    """Fuse reads. `apply_format=False` skips the format-based checks (ablation only)."""
    reads = [r for r in reads if r.chars]
    # Reads that are not plate readings at all (most confident characters break the layout)
    # are listed but cast no votes. Removing evidence can only produce more '?'.
    excluded = [r.read_id for r in reads if apply_format and not r.plausible]
    reads = [r for r in reads if not apply_format or r.plausible]
    L, ref = _pick_reference(reads)
    if ref is None:
        return FusedPlate(text="", video_text="", length=0, n_reads=0, positions=[],
                          excluded_reads=excluded + [r.read_id for r in reads])
    # Alignment can recover a lost first/last character; a read that is 3+ characters off the
    # plate length cannot be placed reliably, so it is listed but does not vote.
    excluded += [r.read_id for r in reads if abs(len(r.chars) - L) > MAX_LENGTH_DIFF]
    reads = [r for r in reads if abs(len(r.chars) - L) <= MAX_LENGTH_DIFF]

    cells: list[list[VoteCell]] = [[] for _ in range(L)]
    for r in reads:
        mapping = align(r.chars, ref.chars) if r is not ref else list(range(L))
        q = quality_weight(r.sharpness, cfg)
        for k, idx in enumerate(mapping):
            if idx is None:
                cells[k].append(VoteCell(read_id=r.read_id, char=None))
                continue
            c = r.chars[idx]
            p = r.raw_confs[idx]
            w = p * q if c != UNKNOWN else 0.0
            cells[k].append(
                VoteCell(
                    read_id=r.read_id,
                    char=c,
                    raw_char=r.raw_chars[idx],
                    raw_conf=round(p, 4),
                    weight=round(w, 4),
                )
            )

    positions: list[FusedPosition] = []
    for k in range(L):
        votes: dict[str, float] = {}
        for cell in cells[k]:
            if cell.char and cell.char != UNKNOWN and cell.char in ALNUM:
                votes[cell.char] = votes.get(cell.char, 0.0) + cell.weight
        total = sum(votes.values())
        if votes:
            ranked = sorted(votes.items(), key=lambda kv: (-kv[1], kv[0]))
            a_star, w_star = ranked[0]
        else:
            a_star, w_star = UNKNOWN, 0.0
        share = (w_star / total) if total > 0 else 0.0
        # Consistency is measured per camera: a camera with a clear view must not be outvoted by
        # a camera that could not see the position (cross-camera combined evidence).
        per_cam: dict[str, list[int]] = {}
        for c in cells[k]:
            if c.raw_char and c.raw_char.upper() in ALNUM:
                stat = per_cam.setdefault(_camera(c.read_id), [0, 0])
                stat[1] += 1
                stat[0] += int(c.char == a_star and a_star != UNKNOWN)
        best_cam = max(per_cam.values(), key=lambda s: (s[0] / s[1], s[0]), default=[0, 0])
        confident, covering = best_cam
        consistency = confident / covering if covering else 0.0
        accepted = (
            bool(votes)
            and w_star >= cfg.vote_min_weight
            and share >= cfg.vote_min_share
            and consistency >= cfg.vote_min_consistency
        )
        note = None
        if not votes:
            note = "no frame read this position with confidence"
        elif not accepted:
            parts = []
            if w_star < cfg.vote_min_weight:
                parts.append(f"evidence {w_star:.2f} < {cfg.vote_min_weight}")
            if share < cfg.vote_min_share:
                parts.append(f"winner share {share:.2f} < {cfg.vote_min_share}")
            if consistency < cfg.vote_min_consistency:
                parts.append(
                    f"'{a_star}' read confidently in only {confident} of {covering} reads "
                    f"({consistency:.0%} < {cfg.vote_min_consistency:.0%})"
                )
            note = "vote failed: " + ", ".join(parts)
        char = a_star if accepted else UNKNOWN
        supporting = [c.read_id for c in cells[k] if c.char == a_star and a_star != UNKNOWN]
        dissenting = [c.read_id for c in cells[k] if c.char not in (None, UNKNOWN) and c.char != a_star]
        positions.append(
            FusedPosition(
                index=k,
                char=char,
                confidence=round(share if accepted else 0.0, 4),
                weight=round(w_star, 4),
                total_weight=round(total, 4),
                source="video" if accepted else "unknown",
                votes={a: round(w, 4) for a, w in sorted(votes.items())},
                supporting=supporting,
                dissenting=dissenting,
                cells=cells[k],
                note=note,
            )
        )

    chars = [p.char for p in positions]
    fmt = format_mask(chars if apply_format else [])
    if not apply_format:
        fmt.chars = chars
    for i in fmt.masked_positions:
        positions[i].char = UNKNOWN
        positions[i].source = "unknown"
        positions[i].confidence = 0.0
        positions[i].note = "masked by the plate format check after fusion"
    text = "".join(p.char for p in positions)
    return FusedPlate(
        text=text,
        video_text=text,
        length=L,
        reference_read=ref.read_id,
        n_reads=len(reads),
        positions=positions,
        format_conflicts=fmt.conflicts,
        excluded_reads=excluded,
    )


def fuse_frame_reads(frames: Iterable[FrameRead], cfg: FusionConfig) -> FusedPlate:
    return fuse_reads([ReadObservation.from_frame_read(f) for f in frames], cfg)


def normalize_hint(hint: Optional[str]) -> Optional[str]:
    """Upper-case, drop separators; '*', '_' and any non-alphanumeric become '?'."""
    if hint is None:
        return None
    out = []
    for c in hint.strip().upper():
        if c in " -.":
            continue
        out.append(c if c in ALNUM else UNKNOWN)
    s = "".join(out)
    return s or None


def merge_hint(fused: FusedPlate, hint: Optional[str]) -> FusedPlate:
    """Merge an investigator hint into a video-derived plate.

    * video '?' + hint char        -> hint char, labelled investigator-supplied
    * video char + hint '?'/absent -> video char
    * both agree                   -> video char, labelled video+hint
    * both known and disagree      -> '?', conflict listed
    """
    hint = normalize_hint(hint)
    merged = fused.model_copy(deep=True)
    merged.hint = hint
    merged.hint_conflicts = []
    if not hint:
        return merged

    if merged.length == 0:
        merged.positions = [
            FusedPosition(
                index=i,
                char=c,
                confidence=1.0 if c != UNKNOWN else 0.0,
                weight=0.0,
                total_weight=0.0,
                source="investigator-supplied" if c != UNKNOWN else "unknown",
                note="no video reading; value comes from the investigator hint" if c != UNKNOWN else None,
            )
            for i, c in enumerate(hint)
        ]
        merged.length = len(hint)
        merged.text = hint
        return merged

    video = [p.char for p in merged.positions]
    if len(hint) == len(video):
        mapping: list[Optional[int]] = list(range(len(video)))
    else:
        mapping = align(list(hint), video)
        merged.hint_conflicts.append(
            f"hint has {len(hint)} characters but the video plate has {len(video)}; hint aligned to the video reading"
        )
    for k, idx in enumerate(mapping):
        if idx is None:
            continue
        h = hint[idx]
        pos = merged.positions[k]
        v = pos.char
        if h == UNKNOWN:
            continue
        if v == UNKNOWN:
            pos.char = h
            pos.source = "investigator-supplied"
            pos.note = "filled from the investigator hint; not read from the video"
        elif v == h:
            pos.source = "video+hint"
        else:
            pos.char = UNKNOWN
            pos.source = "conflict"
            pos.confidence = 0.0
            msg = f"position {k + 1}: video shows '{v}' but the hint says '{h}'; set to '?'"
            pos.note = msg
            merged.hint_conflicts.append(msg)
    merged.text = "".join(p.char for p in merged.positions)
    return merged
