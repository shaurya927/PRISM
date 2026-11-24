"""Within-clip track merging (one vehicle, one track) and the dashboard visibility rule.

ByteTrack can give one vehicle several IDs: a second box on the same car, or a new ID after the car
is hidden for a moment. Each ID was then read, scored and listed separately. Three kinds of evidence
say two tracks are the same vehicle:

  plate    both fused plates look like full number plates, Indian or foreign (at least
           `merge_min_plate_len` characters, not a word or phone number) and agree on at least
           `merge_min_plate_agree` known characters,
  box      they are on screen together for at least `merge_min_shared_frames` frames and, in at
           least `merge_dup_frac` of those frames, one box covers `merge_dup_box_overlap` of the
           other with the bottom edges level (a duplicate box on the same car, plate or not),
  handoff  one track ends and the other starts within `merge_max_gap_sec`, at the place the first
           was heading (`merge_handoff_max_dist` box widths), with a similar box size: the tracker
           lost the vehicle and gave it a new ID.

Two tracks are never merged when ANY of these holds (a conflict):
  * their YOLO classes are in different groups (a two-wheeler never merges with a car),
  * both plates have at least `merge_conflict_min_known` known characters and a known character
    conflicts after alignment (the usual OCR mix-ups such as 0/O are tolerated),
  * in some frame where both are visible their boxes are apart: the intersection covers less than
    `merge_min_box_overlap` of the smaller box. Two vehicles on screen at the same time never merge.

Merging is greedy, strongest evidence first (plate, then box, then handoff). Two groups join only if
no member of one conflicts with any member of the other. Appearance is not used.

The visibility rule decides which tracks the dashboard lists: a track is hidden when no plate
character was read with confidence (fewer than `display_min_known_chars`), when the text read cannot
be a number plate from any country (a shop sign such as MARKET, a painted phone number), or when the vehicle was never bigger than
`display_min_vehicle_px` on its short side. Hidden tracks are reported with their
reason; nothing is deleted.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

from prism.config import MatchConfig, TrackConfig
from prism.plate_grammar import is_indian_like, plate_shaped
from prism.reid import plate_agreement, plate_compatible

CLASS_GROUP = {"car": "4w", "truck": "4w", "bus": "4w", "motorcycle": "2w"}
_RANK = {"plate": 2, "box": 1, "handoff": 0}


def box_overlap(a: Sequence[int], b: Sequence[int]) -> float:
    """Intersection area divided by the smaller box's area (1.0 when one box contains the other)."""
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return (ix * iy) / small if small > 0 else 0.0


def boxes_consistent(boxes_a: dict[int, Sequence[int]], boxes_b: dict[int, Sequence[int]], min_overlap: float) -> bool:
    """True if the two tracks never appear as separate boxes in the same frame."""
    shared = boxes_a.keys() & boxes_b.keys()
    return all(box_overlap(boxes_a[f], boxes_b[f]) >= min_overlap for f in shared)


def _known(plate: str) -> int:
    return sum(ch != "?" for ch in plate)


def _center(b: Sequence[int]) -> tuple[float, float]:
    return (b[0] + b[2]) / 2, (b[1] + b[3]) / 2


def _area(b: Sequence[int]) -> float:
    return max(0, b[2] - b[0]) * max(0, b[3] - b[1])


def same_box_frames(boxes_a: dict[int, Sequence[int]], boxes_b: dict[int, Sequence[int]], tcfg: TrackConfig) -> tuple[int, int]:
    """(shared frames, shared frames where one box sits on the other with level bottom edges)."""
    shared = sorted(boxes_a.keys() & boxes_b.keys())
    same = 0
    for f in shared:
        a, b = boxes_a[f], boxes_b[f]
        h = max(a[3] - a[1], b[3] - b[1], 1)
        if box_overlap(a, b) >= tcfg.merge_dup_box_overlap and abs(a[3] - b[3]) <= tcfg.merge_dup_bottom_tol * h:
            same += 1
    return len(shared), same


def handoff_gap(boxes_a: dict[int, Sequence[int]], boxes_b: dict[int, Sequence[int]], tcfg: TrackConfig,
                fps: float) -> Optional[float]:
    """Seconds between one track ending and the other starting at the same place, or None."""
    if not boxes_a or not boxes_b or boxes_a.keys() & boxes_b.keys():
        return None
    first, second = (boxes_a, boxes_b) if min(boxes_a) < min(boxes_b) else (boxes_b, boxes_a)
    end, start = max(first), min(second)
    gap_frames = start - end
    if gap_frames <= 0 or gap_frames > tcfg.merge_max_gap_sec * fps:
        return None
    last, nxt = first[end], second[start]
    ra = _area(nxt) / max(1.0, _area(last))
    if not (1 / tcfg.merge_handoff_max_scale <= ra <= tcfg.merge_handoff_max_scale):
        return None
    # where the first track was heading: its velocity over its last few frames, carried across the gap
    tail = sorted(first)[-6:]
    (x0, y0), (x1, y1) = _center(first[tail[0]]), _center(last)
    span = max(1, tail[-1] - tail[0])
    vx, vy = (x1 - x0) / span, (y1 - y0) / span
    cx, cy = _center(nxt)
    px, py = x1 + vx * gap_frames, y1 + vy * gap_frames
    dist = min(((cx - x1) ** 2 + (cy - y1) ** 2) ** 0.5, ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5)
    width = max(last[2] - last[0], nxt[2] - nxt[0], 1)
    if dist > tcfg.merge_handoff_max_dist * width:
        return None
    return gap_frames / fps


@dataclass
class MergeGroup:
    keep: int
    others: list[int]
    agree: int                                   # most agreeing plate characters behind the merge (0 if none)
    evidence: dict[str, list[tuple[int, int]]] = field(default_factory=dict)  # kind -> track id pairs
    detail: dict[tuple[int, int], str] = field(default_factory=dict)


def explain_merge_groups(
    plates: dict[int, str],
    classes: dict[int, str],
    boxes: dict[int, dict[int, Sequence[int]]],
    sizes: dict[int, int],
    tcfg: TrackConfig,
    mcfg: MatchConfig,
    fps: float = 25.0,
) -> list[MergeGroup]:
    """Every group of 2+ tracks that are one vehicle, with the evidence for each joined pair.

    plates: fused plate text per track ('' if unread); classes: YOLO class per track;
    boxes: frame_idx -> bbox per track; sizes: detections per track (the biggest track keeps its ID).
    """
    if tcfg.merge_min_plate_agree <= 0:
        return []
    ids = sorted(plates)

    def conflict(a: int, b: int) -> bool:
        if CLASS_GROUP.get(classes[a], classes[a]) != CLASS_GROUP.get(classes[b], classes[b]):
            return True
        pa, pb = plates[a], plates[b]
        if _known(pa) >= tcfg.merge_conflict_min_known and _known(pb) >= tcfg.merge_conflict_min_known:
            if not plate_compatible(pa, pb, mcfg)[0]:
                return True
        return not boxes_consistent(boxes.get(a, {}), boxes.get(b, {}), tcfg.merge_min_box_overlap)

    edges = []   # (rank, strength, a, b, kind, agree, detail)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if conflict(a, b):
                continue
            pa, pb = plates[a], plates[b]
            _, agree, _ = plate_agreement(pa, pb, mcfg)
            # text that is not a number plate (a phone number or a sign painted on a truck) is no evidence
            if (len(pa) >= tcfg.merge_min_plate_len and len(pb) >= tcfg.merge_min_plate_len
                    and agree >= tcfg.merge_min_plate_agree and looks_like_plate(pa) and looks_like_plate(pb)):
                edges.append((_RANK["plate"], agree, a, b, "plate", agree,
                              f"plates agree on {agree} known characters with no conflict"))
                continue
            ba, bb = boxes.get(a, {}), boxes.get(b, {})
            shared, same = same_box_frames(ba, bb, tcfg)
            if shared >= tcfg.merge_min_shared_frames and same >= tcfg.merge_dup_frac * shared:
                edges.append((_RANK["box"], shared, a, b, "box", agree,
                              f"boxes sit on the same vehicle in {same} of {shared} shared frames"))
                continue
            gap = handoff_gap(ba, bb, tcfg, fps)
            if gap is not None:
                edges.append((_RANK["handoff"], -gap, a, b, "handoff", agree,
                              f"one ID ended and the other began {gap:.2f} s later where the vehicle was heading"))
    edges.sort(key=lambda e: (-e[0], -e[1], e[2], e[3]))

    group_of: dict[int, int] = {t: t for t in ids}
    members: dict[int, list[int]] = {t: [t] for t in ids}
    info: dict[int, MergeGroup] = {}
    for _, _, a, b, kind, agree, detail in edges:
        ga, gb = group_of[a], group_of[b]
        if ga == gb:
            continue
        if any(conflict(x, y) for x in members[ga] for y in members[gb]):
            continue
        gid = min(ga, gb)
        old = [info.pop(g, None) for g in (ga, gb)]
        mg = MergeGroup(keep=gid, others=[], agree=max([agree] + [o.agree for o in old if o]))
        for o in old:
            if o:
                for k, v in o.evidence.items():
                    mg.evidence.setdefault(k, []).extend(v)
                mg.detail.update(o.detail)
        mg.evidence.setdefault(kind, []).append((a, b))
        mg.detail[(a, b)] = detail
        merged = members.pop(ga) + members.pop(gb)
        members[gid] = merged
        info[gid] = mg
        for t in merged:
            group_of[t] = gid

    out = []
    for gid, mg in info.items():
        group = members[gid]
        keep = max(group, key=lambda t: (sizes.get(t, 0), -t))
        mg.keep, mg.others = keep, sorted(t for t in group if t != keep)
        out.append(mg)
    return sorted(out, key=lambda g: g.keep)


def find_merge_groups(
    plates: dict[int, str],
    classes: dict[int, str],
    boxes: dict[int, dict[int, Sequence[int]]],
    sizes: dict[int, int],
    tcfg: TrackConfig,
    mcfg: MatchConfig,
    fps: float = 25.0,
) -> list[tuple[int, list[int], int]]:
    """(kept_track_id, [merged track ids], agreeing plate characters) for every group of 2+ tracks."""
    return [(g.keep, g.others, g.agree) for g in explain_merge_groups(plates, classes, boxes, sizes, tcfg, mcfg, fps)]


def merge_note(group: MergeGroup) -> str:
    """One sentence for the investigator on why these tracker IDs are one vehicle."""
    ids = ", ".join(map(str, group.others))
    why = "; ".join(f"{a} and {b}: {group.detail[(a, b)]}" for pairs in group.evidence.values() for a, b in pairs)
    return f"Tracker IDs {ids} were the same vehicle as {group.keep} ({why}). Their boxes never appear apart in the same frame."


def looks_like_plate(text: str) -> bool:
    """True if the read could be a number plate from any country: an Indian layout, or 4-12
    characters mixing letters and digits (AB12CDE, 7ABC123, B-MW 1234), or a short digit run.
    Shop signs (MARKET, POLICE) and painted phone numbers (1134486324) fail this."""
    if not text:
        return False
    return is_indian_like(text) or plate_shaped(text)


def visibility_reason(plate_text: str, boxes: Sequence[Sequence[int]], tcfg: TrackConfig) -> Optional[str]:
    """Why a track is left off the dashboard, or None if it is shown."""
    known_chars = _known(plate_text)
    if known_chars < tcfg.display_min_known_chars:
        return "no readable plate" if known_chars == 0 else f"only {known_chars} plate character{'s' if known_chars != 1 else ''} read"
    if not looks_like_plate(plate_text):
        return "text read is not a number plate"
    if not boxes or max(min(b[2] - b[0], b[3] - b[1]) for b in boxes) < tcfg.display_min_vehicle_px:
        return "vehicle too small in frame"
    return None
