"""Within-clip track merging: one vehicle, one track.

ByteTrack can give one vehicle several IDs: a second, smaller box on the same car, or a new ID
after the car is hidden for a moment. Each ID was then read, scored and listed separately.

Two tracks of the same clip are merged only when ALL hold:
  1. both fused plates look like full plates (at least `merge_min_plate_len` characters),
  2. after alignment they agree on at least `merge_min_plate_agree` known characters and no known
     character conflicts (the usual OCR mix-ups such as 0/O are tolerated),
  3. their YOLO classes are in the same group (a two-wheeler never merges with a car),
  4. in every frame where both are visible, their boxes overlap: the intersection covers at least
     `merge_min_box_overlap` of the smaller box. Two separate vehicles on screen at the same time
     are never merged, however similar their plates.
Appearance is not used. Merging is greedy, most agreeing characters first, and a track joins a
group only if it is compatible with every track already in it.
"""

from __future__ import annotations

from typing import Sequence

from prism.config import MatchConfig, TrackConfig
from prism.reid import plate_agreement

CLASS_GROUP = {"car": "4w", "truck": "4w", "bus": "4w", "motorcycle": "2w"}


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


def find_merge_groups(
    plates: dict[int, str],
    classes: dict[int, str],
    boxes: dict[int, dict[int, Sequence[int]]],
    sizes: dict[int, int],
    tcfg: TrackConfig,
    mcfg: MatchConfig,
) -> list[tuple[int, list[int], int]]:
    """Return (kept_track_id, [merged track ids], agreeing characters) for every group of 2+ tracks.

    plates: fused plate text per track ('' if unread); classes: YOLO class per track;
    boxes: frame_idx -> bbox per track; sizes: detections per track (the biggest track keeps its ID).
    """
    if tcfg.merge_min_plate_agree <= 0:
        return []
    ids = [t for t in plates if len(plates[t]) >= tcfg.merge_min_plate_len]

    def compatible(a: int, b: int) -> tuple[bool, int]:
        if CLASS_GROUP.get(classes[a], classes[a]) != CLASS_GROUP.get(classes[b], classes[b]):
            return False, 0
        ok, agree, _ = plate_agreement(plates[a], plates[b], mcfg)
        if not ok or agree < tcfg.merge_min_plate_agree:
            return False, agree
        return boxes_consistent(boxes[a], boxes[b], tcfg.merge_min_box_overlap), agree

    pairs = []
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            ok, agree = compatible(a, b)
            if ok:
                pairs.append((agree, a, b))
    pairs.sort(key=lambda p: (-p[0], p[1], p[2]))

    group_of: dict[int, int] = {}
    groups: dict[int, list[int]] = {}
    best_agree: dict[int, int] = {}
    for agree, a, b in pairs:
        ga, gb = group_of.get(a), group_of.get(b)
        if ga is not None and ga == gb:
            continue
        members_a = groups[ga] if ga is not None else [a]
        members_b = groups[gb] if gb is not None else [b]
        if not all(compatible(x, y)[0] for x in members_a for y in members_b):
            continue
        new = members_a + members_b
        gid = min(new)
        prior = max([agree] + [best_agree.get(g, 0) for g in (ga, gb) if g is not None])
        for g in (ga, gb):
            if g is not None:
                groups.pop(g, None)
                best_agree.pop(g, None)
        groups[gid] = new
        best_agree[gid] = prior
        for t in new:
            group_of[t] = gid

    out = []
    for gid, members in groups.items():
        keep = max(members, key=lambda t: (sizes.get(t, 0), -t))
        out.append((keep, sorted(t for t in members if t != keep), best_agree[gid]))
    return sorted(out)
