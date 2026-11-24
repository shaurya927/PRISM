"""Stage 2: plate detection inside each vehicle crop + frame-quality filtering.

* Detector: fast-alpr's YOLOv9-t (`yolo-v9-t-384-license-plate-end2end`, ONNX), imported from
  vendor/fast-alpr first, then the pip package. Without a detector the pipeline stops with a
  setup error: it never runs without plate detection.
* The detector only ever sees a Stage 1 vehicle crop, never the full frame.
* Sharpness S_t = Var(Laplacian(gray)); crops with S_t < 45 or width < 30 px are dropped and the
  12 sharpest frames per track are kept.
* Two-line plates (width/height < 2.2) are split at the horizontal brightness gap.
* A CLAHE copy of each crop is also read. CLAHE only rescales existing brightness, so it cannot
  draw a stroke; each copy is its own, labelled vote.
"""

from __future__ import annotations

import heapq
import itertools
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal, Optional

import cv2
import numpy as np

from prism.config import PlateConfig
from prism.runtime import import_vendor_first
from prism.stages.track import iter_frames

log = logging.getLogger("prism.plate_detect")


class PlateDetectorUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class PlateCrop:
    """The only image type the OCR stage accepts. `source` must be 'raw' or 'clahe'."""

    image: np.ndarray
    source: Literal["raw", "clahe"]
    path: Optional[str] = None


@dataclass
class PlateSample:
    track_id: int
    frame_idx: int
    timestamp_sec: float
    sharpness: float
    plate_bbox: list[int]            # frame coordinates
    raw: PlateCrop
    clahe: PlateCrop
    vehicle_crop: np.ndarray
    two_line: bool


@dataclass
class VehicleCrop:
    frame_idx: int
    timestamp_sec: float
    sharpness: float
    image: np.ndarray


@dataclass
class TrackPlates:
    samples: list[PlateSample] = field(default_factory=list)
    vehicle_crops: list[VehicleCrop] = field(default_factory=list)
    checked: int = 0
    no_plate: int = 0
    too_small: int = 0
    too_blurry: int = 0


# --------------------------------------------------------------------------- image helpers
def plate_quality(width_px: int, sharpness: float, cfg: PlateConfig) -> float:
    """Rank key for plate frames: pixels across the plate, discounted only when the crop is blurry."""
    return float(width_px) * min(1.0, sharpness / cfg.quality_sharpness_ref)


def laplacian_sharpness(img: np.ndarray) -> float:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def clahe_copy(img: np.ndarray, cfg: PlateConfig) -> np.ndarray:
    clahe = cv2.createCLAHE(clipLimit=cfg.clahe_clip_limit, tileGridSize=tuple(cfg.clahe_tile))
    if img.ndim == 2:
        return clahe.apply(img)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    lab[:, :, 0] = clahe.apply(lab[:, :, 0])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def is_two_line(img: np.ndarray, cfg: PlateConfig) -> bool:
    h, w = img.shape[:2]
    return h > 0 and (w / h) < cfg.two_line_aspect


def split_two_line(img: np.ndarray, cfg: PlateConfig) -> Optional[tuple[np.ndarray, np.ndarray]]:
    """Split a two-row plate at the low-energy row between the text lines; None if no clear gap."""
    h = img.shape[0]
    if h < 8:
        return None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    energy = np.abs(cv2.Sobel(gray.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3)).mean(axis=1)
    lo, hi = int(h * 0.3), int(h * 0.7)
    if hi - lo < 2:
        return None
    r = lo + int(np.argmin(energy[lo:hi]))
    med = float(np.median(energy))
    if med <= 0 or energy[r] >= cfg.two_line_gap_ratio * med:
        return None
    top, bottom = img[:r], img[r:]
    if top.shape[0] < 4 or bottom.shape[0] < 4:
        return None
    return top, bottom


# --------------------------------------------------------------------------- detector
class PlateDetector:
    """fast-alpr YOLOv9-t plate detector, run on vehicle crops only."""

    def __init__(self, cfg: PlateConfig):
        self.cfg = cfg
        try:
            mod, origin = import_vendor_first("fast_alpr.default_detector", "fast-alpr")
            self._det = mod.DefaultDetector(model_name=cfg.detector_model, conf_thresh=cfg.det_conf)
            self.origin = origin
        except Exception as exc:
            raise PlateDetectorUnavailable(
                "fast-alpr plate detector unavailable. Clone vendor/fast-alpr or run "
                "`pip install fast-alpr[onnx]`, and make sure the model can be downloaded once "
                f"({cfg.detector_model}). Details: {exc}"
            ) from exc
        self.name = f"fast-alpr {cfg.detector_model} ({origin})"

    def detect(self, vehicle_crop: np.ndarray) -> list[tuple[list[int], float]]:
        """Plate boxes in crop coordinates, best first."""
        if vehicle_crop.size == 0:
            return []
        out = []
        for d in self._det.predict(vehicle_crop):
            bb = d.bounding_box
            out.append(([int(bb.x1), int(bb.y1), int(bb.x2), int(bb.y2)], float(d.confidence)))
        out.sort(key=lambda t: -t[1])
        return out


# --------------------------------------------------------------------------- stage runner
def _evenly(items: list, k: int) -> list:
    if len(items) <= k:
        return items
    idx = np.linspace(0, len(items) - 1, k).round().astype(int)
    return [items[i] for i in sorted(set(idx.tolist()))]


def collect_plate_samples(
    video_path: Path,
    tracks: dict,
    detector: PlateDetector,
    cfg: PlateConfig,
    n_vehicle_crops: int,
    progress: Optional[Callable[[float], None]] = None,
) -> dict[int, TrackPlates]:
    """Second pass over the video (or the photo): crop each tracked vehicle, find its plate, keep the sharpest."""
    wanted: dict[int, list[tuple[int, object]]] = {}
    for tid, tr in tracks.items():
        for ob in _evenly(tr.observations, cfg.max_obs_per_track):
            wanted.setdefault(ob.frame_idx, []).append((tid, ob))
    out: dict[int, TrackPlates] = {tid: TrackPlates() for tid in tracks}
    if not wanted:
        return out
    plate_heaps: dict[int, list] = {tid: [] for tid in tracks}
    veh_heaps: dict[int, list] = {tid: [] for tid in tracks}
    counter = itertools.count()
    last = max(wanted)
    frames = iter_frames(video_path)  # a still photo is frame 0
    try:
        for idx, frame in frames:
            if idx > last:
                break
            if idx not in wanted:
                continue
            H, W = frame.shape[:2]
            for tid, ob in wanted[idx]:
                x1, y1, x2, y2 = ob.bbox
                x1, y1, x2, y2 = max(0, x1), max(0, y1), min(W, x2), min(H, y2)
                if x2 - x1 < 8 or y2 - y1 < 8:
                    continue
                crop = frame[y1:y2, x1:x2].copy()
                tp = out[tid]
                tp.checked += 1
                vs = laplacian_sharpness(crop)
                item = (vs, next(counter), VehicleCrop(idx, ob.timestamp_sec, vs, crop))
                h = veh_heaps[tid]
                (heapq.heappush if len(h) < n_vehicle_crops else heapq.heappushpop)(h, item)

                dets = detector.detect(crop)
                if not dets:
                    tp.no_plate += 1
                    continue
                (px1, py1, px2, py2), _ = dets[0]
                pad = cfg.plate_pad_px
                ch, cw = crop.shape[:2]
                px1, py1 = max(0, px1 - pad), max(0, py1 - pad)
                px2, py2 = min(cw, px2 + pad), min(ch, py2 + pad)
                plate = crop[py1:py2, px1:px2].copy()
                if plate.size == 0 or plate.shape[1] < cfg.min_width_px:
                    tp.too_small += 1
                    continue
                s = laplacian_sharpness(plate)
                if s < cfg.min_sharpness:
                    tp.too_blurry += 1
                    continue
                sample = PlateSample(
                    track_id=tid,
                    frame_idx=idx,
                    timestamp_sec=ob.timestamp_sec,
                    sharpness=round(s, 2),
                    plate_bbox=[x1 + px1, y1 + py1, x1 + px2, y1 + py2],
                    raw=PlateCrop(plate, "raw"),
                    clahe=PlateCrop(clahe_copy(plate, cfg), "clahe"),
                    vehicle_crop=crop,
                    two_line=is_two_line(plate, cfg),
                )
                ph = plate_heaps[tid]
                entry = (plate_quality(plate.shape[1], s, cfg), next(counter), sample)
                (heapq.heappush if len(ph) < cfg.top_k_frames else heapq.heappushpop)(ph, entry)
            if progress:
                progress(min(1.0, idx / max(1, last)))
    finally:
        frames.close()  # releases the video reader even when we stop before the last frame
    for tid in tracks:
        out[tid].samples = sorted((e[2] for e in plate_heaps[tid]), key=lambda s: s.frame_idx)
        out[tid].vehicle_crops = sorted((e[2] for e in veh_heaps[tid]), key=lambda v: -v.sharpness)
    if progress:
        progress(1.0)
    return out
