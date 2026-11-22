"""Next-best-evidence advisor.

When the result is AMBIGUOUS or NO CONFIDENT MATCH, find the unknown plate
position where the top candidates differ most (weighted by their scores), and
point to the frame that came closest to reading it (highest confidence that was
still below tau_char). That frame is a lead for a human to check, never evidence:
nothing here feeds back into scoring.
"""

from __future__ import annotations

import math
from typing import Optional

from prism.config import MatchConfig, OCRConfig
from prism.plate_grammar import ALNUM, UNKNOWN
from prism.schemas import AdvisorNote, Candidate, FusedPlate, MatchResult, MatchStatus


def _cand_char(c: Candidate, k: int) -> Optional[str]:
    j = k + c.breakdown.shift
    return c.plate[j] if 0 <= j < len(c.plate) else None


def _separation(cands: list[Candidate], k: int) -> float:
    s = 0.0
    for i in range(len(cands)):
        for j in range(i + 1, len(cands)):
            a, b = _cand_char(cands[i], k), _cand_char(cands[j], k)
            if a != b:
                # Pairs involving the leaders matter most.
                s += min(cands[i].score, cands[j].score) * (2.0 if i == 0 else 1.0)
    return s


def advise(
    fused: FusedPlate,
    result: MatchResult,
    match_cfg: MatchConfig,
    ocr_cfg: OCRConfig,
    frame_lookup: Optional[dict[str, int]] = None,
) -> AdvisorNote:
    if result.status == MatchStatus.MATCHED:
        return AdvisorNote(needed=False, text="Not needed: the top candidate is clearly ahead.")
    cands = [c for c in result.top_candidates if c.score > 0][: match_cfg.top_n]
    if len(cands) < 2:
        return AdvisorNote(
            needed=True,
            text="Fewer than two candidates have any support, so no plate position separates them. "
            "Look for footage where more of the plate is visible.",
        )
    plate = fused.text
    unknown = [k for k, ch in enumerate(plate) if ch == UNKNOWN]
    if not unknown:
        diffs = [m for c in cands[:2] for m in c.mismatches]
        detail = f" They differ on: {'; '.join(diffs[:3])}." if diffs else ""
        return AdvisorNote(
            needed=True,
            text="Every plate position was read, so the candidates are separated by colour, body type or "
            f"OCR mix-ups rather than by an unknown position.{detail} Check the attribute chips and the "
            "confusable characters by eye.",
        )

    best_k = max(unknown, key=lambda k: (_separation(cands, k), -k))
    if _separation(cands, best_k) == 0.0:
        return AdvisorNote(
            needed=True,
            text="The top candidates agree at every unknown position, so reading more of the plate would not "
            "separate them. Compare colour, body type and make/model instead.",
        )
    leaders = cands[:2]
    chars = {c.registry_id: (_cand_char(c, best_k) or "(none)") for c in cands}
    lead_txt = (
        f"Position {best_k + 1} separates the top two: {leaders[0].registry_id} has "
        f"`{chars[leaders[0].registry_id]}`, {leaders[1].registry_id} has `{chars[leaders[1].registry_id]}`."
    )

    best_cell = None
    if best_k < len(fused.positions):
        for cell in fused.positions[best_k].cells:
            if cell.raw_char and cell.raw_char.upper() in ALNUM and cell.char == UNKNOWN:
                if cell.raw_conf < ocr_cfg.char_conf and (best_cell is None or cell.raw_conf > best_cell.raw_conf):
                    best_cell = cell
    if best_cell is None:
        return AdvisorNote(
            needed=True,
            position=best_k,
            candidate_chars=chars,
            text=lead_txt + " No frame came close to reading it. Look for footage from another angle.",
        )
    # Floor (not round) so a 0.6996 lead never displays as "0.70, below the 0.70 threshold".
    lead_conf = math.floor(best_cell.raw_conf * 100) / 100
    fidx = (frame_lookup or {}).get(best_cell.read_id)
    fname = f"frame {fidx}" if fidx is not None else f"read {best_cell.read_id}"
    copy = " (CLAHE copy)" if best_cell.read_id.endswith("c") else ""
    return AdvisorNote(
        needed=True,
        position=best_k,
        candidate_chars=chars,
        lead_read_id=best_cell.read_id,
        lead_frame_idx=fidx,
        lead_char=best_cell.raw_char.upper(),
        lead_conf=lead_conf,
        text=(
            f"{lead_txt} {fname.capitalize()}{copy} read it as `{best_cell.raw_char.upper()}` at "
            f"{lead_conf:.2f}, below the {ocr_cfg.char_conf:.2f} threshold, so it wasn't used. "
            f"Check {fname} by eye, or look for footage from another angle. This is a lead, not evidence."
        ),
    )
