"""Stage 0 (ingest stats) + Stage 1: vehicle detection and ByteTrack tracking.

* Ultralytics `yolo11s.pt` (`yolo11n.pt` on CPU) with `tracker="bytetrack.yaml"`.
* Keeps COCO car / motorcycle / bus / truck; pads each crop box by 5%.
* Drops tracks seen in fewer than 5 processed frames.
* On CPU every 2nd frame is processed (ByteTrack copes with the gap).
* Median frame brightness < 60 flags the clip as low light.

A still photo (IMAGE_EXTS) goes through the same stages as a one-frame clip: the detector runs once
(class-agnostic NMS, so one vehicle is not boxed twice as car and truck), every vehicle it finds is a
one-frame track (the five-frame minimum is for video), and its time is 0. Nothing is duplicated to
look like more frames: a photo gives each plate one read plus its CLAHE copy, like any single frame.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np

from prism.config import WEIGHTS_DIR, IngestConfig, TrackConfig

log = logging.getLogger("prism.track")


@dataclass
class TrackObs:
    frame_idx: int
    timestamp_sec: float
    bbox: list[int]          # padded, frame coordinates
    conf: float
    cls: str


@dataclass
class Track:
    track_id: int
    observations: list[TrackObs] = field(default_factory=list)

    @property
    def cls(self) -> str:
        return Counter(o.cls for o in self.observations).most_common(1)[0][0]

    @property
    def first_seen(self) -> float:
        return self.observations[0].timestamp_sec

    @property
    def last_seen(self) -> float:
        return self.observations[-1].timestamp_sec


@dataclass
class VideoStats:
    width: int
    height: int
    fps: float
    frame_count: int
    duration_sec: float
    median_brightness: float
    low_light: bool


IMAGE_EXTS = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"})
VIDEO_EXTS = frozenset({".mp4", ".avi", ".mov", ".mkv", ".m4v", ".webm"})


def is_image(path: Path | str) -> bool:
    return Path(path).suffix.lower() in IMAGE_EXTS


def read_image(path: Path | str) -> np.ndarray:
    """A still photo as a BGR array, turned upright by its EXIF orientation (phone photos)."""
    img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Cannot read image: {Path(path).name} (not a JPEG, PNG, BMP, WebP or TIFF image?)")
    return img


def iter_frames(path: Path | str):
    """(frame index, BGR frame) for every frame of a video, or the single frame 0 of a still photo."""
    if is_image(path):
        yield 0, read_image(path)
        return
    cap = cv2.VideoCapture(str(path))
    try:
        idx = -1
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            idx += 1
            yield idx, frame
    finally:
        cap.release()


def probe_video(path: Path) -> tuple[int, int, float, int]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {path}")
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    return w, h, fps, n


def pad_box(x1: float, y1: float, x2: float, y2: float, pad: float, W: int, H: int) -> list[int]:
    bw, bh = x2 - x1, y2 - y1
    return [
        max(0, int(round(x1 - pad * bw))),
        max(0, int(round(y1 - pad * bh))),
        min(W, int(round(x2 + pad * bw))),
        min(H, int(round(y2 + pad * bh))),
    ]


def load_detector(cfg: TrackConfig, device: str):
    from ultralytics import YOLO

    name = cfg.model_gpu if device == "cuda" else cfg.model_cpu
    local = WEIGHTS_DIR / name
    model = YOLO(str(local) if local.exists() else name)
    return model, name


def detect_still(
    image_path: Path,
    track_cfg: TrackConfig,
    ingest_cfg: IngestConfig,
    device: str,
    progress: Optional[Callable[[float], None]] = None,
) -> tuple[VideoStats, dict[int, Track], str]:
    """Stage 1 for a photo: one detection pass; each vehicle becomes a one-frame track, largest first."""
    img = read_image(image_path)
    H, W = img.shape[:2]
    model, model_name = load_detector(track_cfg, device)
    res = model.predict(
        img,
        classes=list(track_cfg.classes),
        conf=track_cfg.det_conf,
        imgsz=track_cfg.imgsz,
        agnostic_nms=True,
        device=0 if device == "cuda" else "cpu",
        verbose=False,
    )[0]
    dets = []
    boxes = res.boxes
    if boxes is not None and len(boxes):
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        cls = boxes.cls.cpu().numpy().astype(int)
        for (x1, y1, x2, y2), c, k in zip(xyxy, confs, cls):
            name = track_cfg.classes.get(int(k))
            if name is not None:
                dets.append(((x2 - x1) * (y2 - y1), pad_box(x1, y1, x2, y2, track_cfg.crop_pad, W, H), float(c), name))
    dets.sort(key=lambda d: -d[0])
    tracks = {i: Track(i, [TrackObs(0, 0.0, box, conf, name)]) for i, (_, box, conf, name) in enumerate(dets, start=1)}
    log.info("still image: %d vehicle(s) detected", len(tracks))
    small = cv2.resize(img, (160, 90))
    med = float(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).mean())
    stats = VideoStats(width=W, height=H, fps=0.0, frame_count=1, duration_sec=0.0,
                       median_brightness=round(med, 2), low_light=med < ingest_cfg.low_light_brightness)
    if progress:
        progress(1.0)
    return stats, tracks, model_name


def run_tracking(
    video_path: Path,
    track_cfg: TrackConfig,
    ingest_cfg: IngestConfig,
    device: str,
    progress: Optional[Callable[[float], None]] = None,
) -> tuple[VideoStats, dict[int, Track], str]:
    if is_image(video_path):
        return detect_still(Path(video_path), track_cfg, ingest_cfg, device, progress)
    W, H, fps, n_frames = probe_video(video_path)
    model, model_name = load_detector(track_cfg, device)
    stride = track_cfg.frame_stride_gpu if device == "cuda" else track_cfg.frame_stride_cpu
    classes = list(track_cfg.classes)
    tracks: dict[int, Track] = {}
    brightness: list[float] = []
    cap = cv2.VideoCapture(str(video_path))
    idx = -1
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            idx += 1
            if idx % ingest_cfg.brightness_sample_every == 0:
                small = cv2.resize(frame, (160, 90))
                brightness.append(float(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).mean()))
            if idx % stride:
                continue
            res = model.track(
                frame,
                persist=True,
                tracker=track_cfg.tracker,
                classes=classes,
                conf=track_cfg.det_conf,
                imgsz=track_cfg.imgsz,
                device=0 if device == "cuda" else "cpu",
                verbose=False,
            )[0]
            boxes = res.boxes
            if boxes is not None and boxes.id is not None:
                xyxy = boxes.xyxy.cpu().numpy()
                ids = boxes.id.cpu().numpy().astype(int)
                confs = boxes.conf.cpu().numpy()
                cls = boxes.cls.cpu().numpy().astype(int)
                for (x1, y1, x2, y2), tid, c, k in zip(xyxy, ids, confs, cls):
                    name = track_cfg.classes.get(int(k))
                    if name is None:
                        continue
                    tracks.setdefault(int(tid), Track(int(tid))).observations.append(
                        TrackObs(idx, round(idx / fps, 3), pad_box(x1, y1, x2, y2, track_cfg.crop_pad, W, H),
                                 float(c), name)
                    )
            if progress and n_frames:
                progress(min(1.0, idx / n_frames))
    finally:
        cap.release()
    n_read = idx + 1
    kept = {t: tr for t, tr in tracks.items() if len(tr.observations) >= track_cfg.min_track_frames}
    log.info("tracking: %d raw tracks, %d kept (>= %d frames)", len(tracks), len(kept), track_cfg.min_track_frames)
    med = float(np.median(brightness)) if brightness else 0.0
    stats = VideoStats(
        width=W, height=H, fps=round(fps, 3), frame_count=n_read or n_frames,
        duration_sec=round((n_read or n_frames) / fps, 3), median_brightness=round(med, 2),
        low_light=med < ingest_cfg.low_light_brightness,
    )
    if progress:
        progress(1.0)
    return stats, kept, model_name
