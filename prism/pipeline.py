"""Runs every PRISM stage and returns one CaseResult.

Order (the visual-aid super-resolution runs only after Stage 3 is complete):
  0 ingest (SHA-256, metadata, low-light flag)
  1 YOLO11 + ByteTrack tracks
  2 plate detection inside vehicle crops, sharpness filter, top-12 frames, raw + CLAHE copies
  3 OCR -> confidence + format masking -> multi-frame fusion
    (visual aid) super-resolution previews saved as *_sr.png, never read back
  4 OpenCLIP colour / body type / make-model (+ Re-ID embeddings for cross-camera)
  5 hint merge, matching, statuses, advisor, evidence-checked summary, chain of custody

`rescore_case` reruns only step 5, so the threshold slider updates instantly.
"""

from __future__ import annotations

import datetime as _dt
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional, Sequence

import cv2
import numpy as np

from prism.advisor import advise
from prism.config import (
    PRISM_VERSION,
    REGISTRY_PATH,
    PrismConfig,
    load_config,
    set_seeds,
)
from prism.custody import CustodyLog, build_custody, sha256_file
from prism.fusion import fuse_frame_reads, fuse_reads, merge_hint, normalize_hint, ReadObservation
from prism.masking import mask_read
from prism.matcher import match
from prism.narrative import summarize
from prism.registry import load_registry
from prism.reid import implied_speed_kmh, link_tracks, make_encoder
from prism.runtime import gpu_name, resolve_device
from prism.stages.plate_detect import plate_quality
from prism.track_merge import find_merge_groups
from prism.schemas import (
    AttributeValue,
    Attributes,
    CaseResult,
    CharRead,
    ClipMeta,
    CrossCamPair,
    CrossCamResult,
    FrameRead,
    FusedPlate,
    MatchStatus,
    RegistryRecord,
    TrackResult,
)

log = logging.getLogger("prism.pipeline")

STAGES = ("ingest", "tracking", "plates", "ocr", "attributes", "matching")
ProgressCB = Callable[[str, float], None]
_STATUS_RANK = {MatchStatus.NO_CONFIDENT_MATCH: 0, MatchStatus.AMBIGUOUS: 1, MatchStatus.MATCHED: 2}


def _noop(stage: str, frac: float) -> None:
    pass


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).astimezone().isoformat(timespec="seconds")


# --------------------------------------------------------------------------- model hub
class ModelHub:
    """Lazily loads and caches every model; safe to share across jobs."""

    def __init__(self, cfg: PrismConfig):
        self.cfg = cfg
        self.device = resolve_device(cfg.device)
        self._lock = threading.RLock()
        self._plate = None
        self._ocr = None
        self._ocr_warn: list[str] = []
        self._attr = None
        self._sr = None
        self._reid = None
        self._reid_warn: list[str] = []
        self.versions: dict[str, str] = {}

    def plate_detector(self):
        with self._lock:
            if self._plate is None:
                from prism.stages.plate_detect import PlateDetector

                self._plate = PlateDetector(self.cfg.plate)
                self.versions["plate_detector"] = self._plate.name
            return self._plate

    def ocr(self):
        with self._lock:
            if self._ocr is None:
                from prism.stages.ocr import make_ocr

                self._ocr, self._ocr_warn = make_ocr(self.cfg.ocr, self.device)
                self.versions["ocr"] = f"{self._ocr.name} ({getattr(self._ocr, 'origin', '')})"
            return self._ocr, list(self._ocr_warn)

    def attributes(self):
        with self._lock:
            if self._attr is None:
                from prism.stages.attributes import AttributeExtractor

                self._attr = AttributeExtractor(self.cfg.attributes, self.device)
                self.versions["attributes"] = self._attr.name
            return self._attr

    def super_res(self):
        with self._lock:
            if self._sr is None:
                from prism.stages.super_res import SuperResolver

                self._sr = SuperResolver(self.cfg.super_res, self.device)
                self.versions["super_resolution"] = (
                    f"{self._sr.name} (visual aid only)" if self._sr.available else f"not installed: {self._sr.reason}"
                )
            return self._sr

    def reid(self):
        with self._lock:
            if self._reid is None:
                self._reid, self._reid_warn = make_encoder(self.cfg.reid, self.attributes(), self.device)
                self.versions["reid"] = self._reid.name
            return self._reid, list(self._reid_warn)


_HUBS: dict[tuple, ModelHub] = {}
_HUB_LOCK = threading.Lock()


def get_hub(cfg: PrismConfig) -> ModelHub:
    from prism.config import config_hash

    key = (config_hash(cfg),)
    with _HUB_LOCK:
        if key not in _HUBS:
            _HUBS[key] = ModelHub(cfg)
        return _HUBS[key]


# --------------------------------------------------------------------------- stage 0-4
@dataclass
class ClipAnalysis:
    meta: ClipMeta
    tracks: list[TrackResult]
    embeddings: dict[int, np.ndarray] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    timings: dict[str, float] = field(default_factory=dict)


def _write(path: Path, img: np.ndarray, custody: CustodyLog, kind: str) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img)
    return custody.record(path, kind)


def _merge_tracks(keep: int, others: list[int], agree: int, tracks: dict, plates: dict,
                  results: dict[int, TrackResult], cfg: PrismConfig) -> None:
    """Fold `others` into track `keep`: union of detections, plate samples, vehicle crops and reads,
    then fuse again. A frame seen by two of the tracks is counted once (the sharper read)."""
    members = [keep, *others]
    obs = {}
    for tid in members:
        for o in tracks[tid].observations:
            if o.frame_idx not in obs or o.conf > obs[o.frame_idx].conf:
                obs[o.frame_idx] = o
    tracks[keep].observations = [obs[f] for f in sorted(obs)]

    samples = {}
    for tid in members:
        for s in plates[tid].samples:
            if s.frame_idx not in samples or s.sharpness > samples[s.frame_idx].sharpness:
                samples[s.frame_idx] = s
    # Same rule as Stage 2 for any single track: the vehicle keeps its top_k best plate frames.
    # Otherwise many distant frames from one tracker ID outvote the clear close-ups of another.
    best = sorted(samples.values(), key=lambda s: -plate_quality(s.raw.image.shape[1], s.sharpness, cfg.plate))
    best = best[: cfg.plate.top_k_frames]
    kept_frames = {s.frame_idx for s in best}
    plates[keep].samples = sorted(best, key=lambda s: s.frame_idx)
    crops = sorted((v for tid in members for v in plates[tid].vehicle_crops), key=lambda v: -v.sharpness)
    plates[keep].vehicle_crops = crops[: cfg.attributes.n_crops]

    reads: dict[str, FrameRead] = {}
    for tid in members:
        for fr in results[tid].frames:
            if fr.frame_idx not in kept_frames:
                continue
            if fr.read_id not in reads or fr.sharpness > reads[fr.read_id].sharpness:
                reads[fr.read_id] = fr
    frames = sorted(reads.values(), key=lambda f: (f.frame_idx, f.source != "raw"))
    tr = tracks[keep]
    results[keep] = results[keep].model_copy(update={
        "yolo_class": tr.cls,
        "first_seen_sec": tr.first_seen,
        "last_seen_sec": tr.last_seen,
        "n_detections": len(tr.observations),
        "frames": frames,
        "fused": fuse_frame_reads(frames, cfg.fusion),
        "merged_track_ids": sorted(others),
        "merge_note": (f"Tracker IDs {', '.join(map(str, sorted(others)))} were the same vehicle: their plates agree on "
                       f"{agree} known characters with no conflict, and their boxes never appear apart in the same frame."),
    })
    for tid in others:
        results.pop(tid, None)


def analyze_clip(
    video_path: Path,
    out_dir: Path,
    cfg: PrismConfig,
    hub: ModelHub,
    custody: CustodyLog,
    progress: ProgressCB = _noop,
    role: str = "A",
    compute_embeddings: bool = False,
) -> ClipAnalysis:
    from prism.stages.ocr import read_plate_crop
    from prism.stages.plate_detect import collect_plate_samples
    from prism.stages.super_res import write_sr_artifact
    from prism.stages.track import run_tracking

    video_path = Path(video_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    timings: dict[str, float] = {}
    warnings: list[str] = []
    rid_prefix = "" if role == "A" else role
    sfx = f" ({role})" if role != "A" else ""

    t = time.perf_counter()
    progress("ingest", 0.1)
    clip_hash = sha256_file(video_path)
    progress("ingest", 1.0)
    timings["ingest" + sfx] = round(time.perf_counter() - t, 2)

    t = time.perf_counter()
    stats, tracks, yolo_name = run_tracking(
        video_path, cfg.track, cfg.ingest, hub.device, lambda f: progress("tracking", f)
    )
    hub.versions["tracker"] = f"ultralytics {yolo_name} + {cfg.track.tracker}"
    timings["tracking" + sfx] = round(time.perf_counter() - t, 2)
    meta = ClipMeta(
        name=video_path.name, sha256=clip_hash, width=stats.width, height=stats.height, fps=stats.fps,
        frame_count=stats.frame_count, duration_sec=stats.duration_sec,
        median_brightness=stats.median_brightness, low_light=stats.low_light,
    )
    if not tracks:
        warnings.append(f"No vehicle tracks of at least {cfg.track.min_track_frames} frames were found in {meta.name}.")

    t = time.perf_counter()
    detector = hub.plate_detector()
    plates = collect_plate_samples(video_path, tracks, detector, cfg.plate, cfg.attributes.n_crops,
                                   lambda f: progress("plates", f))
    timings["plates" + sfx] = round(time.perf_counter() - t, 2)

    # ---------------------------------------------------------------- Stage 3
    t = time.perf_counter()
    ocr, ocr_warn = hub.ocr()
    warnings += ocr_warn
    results: dict[int, TrackResult] = {}
    order = sorted(tracks)
    for n, tid in enumerate(order):
        tr, tp = tracks[tid], plates[tid]
        frames: list[FrameRead] = []
        for s in tp.samples:
            base = f"track{tid}_f{s.frame_idx}"
            raw_url = _write(out_dir / f"{base}_plate.png", s.raw.image, custody, "plate_crop_raw")
            clahe_url = _write(out_dir / f"{base}_plate_clahe.png", s.clahe.image, custody, "plate_crop_clahe")
            veh_url = _write(out_dir / f"{base}_veh.jpg", s.vehicle_crop, custody, "vehicle_crop")
            copies = [(s.raw, f"{rid_prefix}F{s.frame_idx}")]
            if cfg.plate.read_clahe_copy:
                copies.append((s.clahe, f"{rid_prefix}F{s.frame_idx}c"))
            for crop, read_id in copies:
                text, confs, split = read_plate_crop(ocr, crop, s.two_line, cfg.plate)
                m = mask_read(text, confs, cfg.ocr)
                frames.append(
                    FrameRead(
                        read_id=read_id, frame_idx=s.frame_idx, timestamp_sec=s.timestamp_sec,
                        sharpness=s.sharpness, source=crop.source, ocr_backend=ocr.name, raw_text=text,
                        masked_text=m.masked_text,
                        chars=[CharRead(char=c, raw_char=r, conf=round(p, 4), reason=why)
                               for c, r, p, why in zip(m.chars, m.raw_chars, m.raw_confs, m.reasons)],
                        format_conflicts=m.conflicts, two_line=split, plate_bbox=s.plate_bbox,
                        plate_crop_url=raw_url, plate_clahe_url=clahe_url, vehicle_crop_url=veh_url,
                    )
                )
        fused = fuse_frame_reads(frames, cfg.fusion)
        unk = AttributeValue(value="uncertain", confidence=0.0, uncertain=True)
        results[tid] = TrackResult(
            track_id=tid, clip_role=role if role in ("A", "B") else "A", yolo_class=tr.cls,
            first_seen_sec=tr.first_seen, last_seen_sec=tr.last_seen, n_detections=len(tr.observations),
            frames=frames, fused=fused, attributes=Attributes(color=unk, body_type=unk, yolo_class=tr.cls),
        )
        progress("ocr", (n + 1) / max(1, len(order)))

    # ---------------------------------------------------------------- one vehicle, one track
    groups = find_merge_groups(
        plates={tid: results[tid].fused.text for tid in order},
        classes={tid: tracks[tid].cls for tid in order},
        boxes={tid: {o.frame_idx: o.bbox for o in tracks[tid].observations} for tid in order},
        sizes={tid: len(tracks[tid].observations) for tid in order},
        tcfg=cfg.track, mcfg=cfg.match,
    )
    for keep, others, agree in groups:
        _merge_tracks(keep, others, agree, tracks, plates, results, cfg)
    merged_away = {t for _, others, _ in groups for t in others}
    order = [tid for tid in order if tid not in merged_away]
    progress("ocr", 1.0)
    timings["ocr" + sfx] = round(time.perf_counter() - t, 2)

    # ---------------------------------------------------------------- visual aid (after Stage 3)
    sr = hub.super_res()
    if sr.available:
        try:
            for tid in order:
                for s in plates[tid].samples:
                    p = write_sr_artifact(sr, s.raw.image, out_dir, tid, s.frame_idx)
                    if p is None:
                        continue
                    url = custody.record(p, "super_res_visual_aid_not_evidence")
                    for fr in results[tid].frames:
                        if fr.frame_idx == s.frame_idx and fr.source == "raw":
                            fr.sr_url = url
                results[tid].sr_available = True
        except Exception as exc:  # a visual aid must never fail the case; OCR has already run
            log.warning("super-resolution failed (%s); visual aid skipped for this clip", exc)
            warnings.append(f"Super-resolution preview skipped ({exc.__class__.__name__}); results are unaffected.")

    # ---------------------------------------------------------------- Stage 4
    t = time.perf_counter()
    ax = hub.attributes()
    embeddings: dict[int, np.ndarray] = {}
    enc = None
    if compute_embeddings:
        enc, rw = hub.reid()
        warnings += rw
    for n, tid in enumerate(order):
        crops = [v.image for v in plates[tid].vehicle_crops]
        results[tid].attributes = ax.classify(crops, tracks[tid].cls)
        if crops:
            results[tid].best_crop_url = _write(out_dir / f"track{tid}_best.jpg", crops[0], custody, "vehicle_best_crop")
        if enc is not None:
            embeddings[tid] = enc.encode(crops)
        progress("attributes", (n + 1) / max(1, len(order)))
    progress("attributes", 1.0)
    timings["attributes" + sfx] = round(time.perf_counter() - t, 2)
    return ClipAnalysis(meta, [results[t] for t in order], embeddings, warnings, timings)


# --------------------------------------------------------------------------- Stage 5
def _hint_agreement(fused: FusedPlate, hint: str) -> tuple[int, int]:
    agree = conflict = 0
    if fused.length != len(hint):
        return 0, 0
    for v, h in zip(fused.text, hint):
        if v == "?" or h == "?":
            continue
        agree += v == h
        conflict += v != h
    return agree, conflict


def choose_hint_target(tracks: Sequence[TrackResult], hint: Optional[str]) -> Optional[int]:
    """The investigator hint describes one vehicle: the track whose video plate agrees most."""
    hint = normalize_hint(hint)
    if not hint or not tracks:
        return None

    def key(t: TrackResult):
        a, c = _hint_agreement(t.fused, hint)
        return (a - 2 * c, t.fused.known_count, len(t.frames), -t.track_id)

    return max(tracks, key=key).track_id


def score_track(
    t: TrackResult,
    registry: Sequence[RegistryRecord],
    cfg: PrismConfig,
    tau: float,
    low_light: bool,
    hint: Optional[str],
) -> None:
    video = fuse_frame_reads(t.frames, cfg.fusion)
    t.fused = merge_hint(video, hint) if hint else video
    hint_pos = [p.index for p in t.fused.positions if p.source == "investigator-supplied"]
    a = t.attributes
    t.match = match(t.fused.text, registry, cfg.match, a.color, a.body_type, a.make_model, tau, low_light, hint_pos)
    t.advisor = advise(t.fused, t.match, cfg.match, cfg.ocr, {f.read_id: f.frame_idx for f in t.frames})


def _primary(tracks: Sequence[TrackResult], target: Optional[int]) -> Optional[int]:
    if target is not None:
        return target
    if not tracks:
        return None

    def key(t: TrackResult):
        top = t.match.top_candidates[0].score if t.match and t.match.top_candidates else 0.0
        return (t.fused.known_count, _STATUS_RANK.get(t.match.status, 0) if t.match else 0, top, len(t.frames))

    return max(tracks, key=key).track_id


def score_case(case: CaseResult, registry: Sequence[RegistryRecord], cfg: PrismConfig,
               target_track_id: Optional[int] = None) -> CaseResult:
    tau = case.threshold
    low_light = bool(case.clip and case.clip.low_light)
    hint = normalize_hint(case.hint)
    target = target_track_id if target_track_id is not None else choose_hint_target(case.tracks, hint)
    for t in case.tracks:
        score_track(t, registry, cfg, tau, low_light, hint if t.track_id == target else None)
    if case.crosscam:
        cc = case.crosscam
        low_b = bool(cc.clip_b and cc.clip_b.low_light)
        for t in cc.tracks_b:
            score_track(t, registry, cfg, tau, low_b, None)
        _score_pairs(case, registry, cfg, target)
    case.primary_track_id = _primary(case.tracks, target)
    case.narrative = summarize(case, cfg)
    return case


def _score_pairs(case: CaseResult, registry: Sequence[RegistryRecord], cfg: PrismConfig, target: Optional[int]) -> None:
    cc = case.crosscam
    assert cc is not None
    by_a = {t.track_id: t for t in case.tracks}
    by_b = {t.track_id: t for t in cc.tracks_b}
    hint = normalize_hint(case.hint)
    for pr in cc.pairs:
        pr.combined = pr.combined_match = None
        pr.upgraded = False
        ta, tb = by_a.get(pr.track_a), by_b.get(pr.track_b)
        if ta is None or tb is None:
            continue
        before = ta.match.status  # the clip-A result the investigator is working from
        pr.status_before = before
        if not pr.same_vehicle:
            pr.status_after = before
            continue
        combined = fuse_reads([ReadObservation.from_frame_read(f) for f in ta.frames + tb.frames], cfg.fusion)
        if hint and pr.track_a == target:
            combined = merge_hint(combined, hint)
        low_light = bool((case.clip and case.clip.low_light) or (cc.clip_b and cc.clip_b.low_light))
        attrs = ta.attributes if ta.attributes.color.confidence >= tb.attributes.color.confidence else tb.attributes
        hint_pos = [p.index for p in combined.positions if p.source == "investigator-supplied"]
        m = match(combined.text, registry, cfg.match, attrs.color, attrs.body_type, attrs.make_model,
                  case.threshold, low_light, hint_pos)
        pr.combined, pr.combined_match = combined, m
        pr.status_after = m.status
        pr.upgraded = _STATUS_RANK[m.status] > _STATUS_RANK[before]
        filled = [p.index + 1 for p, pa in zip(combined.positions, ta.fused.positions)
                  if p.char != "?" and pa.char == "?"] if combined.length == ta.fused.length else []
        pr.reasons = [r for r in pr.reasons if not r.startswith("Combined")]
        pr.reasons.append(
            f"Combined evidence from both cameras gives '{combined.text}' (clip A alone: '{ta.fused.text}', "
            f"clip B alone: '{tb.fused.text}')"
            + (f"; camera B filled position(s) {', '.join(map(str, filled))}" if filled else "")
            + f". Status {before.value} -> {m.status.value}."
        )


# --------------------------------------------------------------------------- entry points
def _custody_models(hub: ModelHub) -> dict[str, str]:
    v = dict(hub.versions)
    v["device"] = hub.device + (f" ({gpu_name()})" if hub.device == "cuda" and gpu_name() else "")
    return v


def run_pipeline(
    video_path: Path | str,
    hint: Optional[str] = None,
    threshold: Optional[float] = None,
    cfg: Optional[PrismConfig] = None,
    registry_path: Path | str = REGISTRY_PATH,
    out_dir: Optional[Path | str] = None,
    url_prefix: Optional[str] = None,
    progress: ProgressCB = _noop,
    case_id: Optional[str] = None,
) -> CaseResult:
    """Run the full PRISM pipeline on one clip."""
    from prism.config import RUNS_DIR

    cfg = cfg or load_config()
    set_seeds(cfg.seed)
    case_id = case_id or uuid.uuid4().hex[:12]
    out_dir = Path(out_dir) if out_dir else RUNS_DIR / case_id
    url_prefix = url_prefix or f"/artifacts/{case_id}"
    hub = get_hub(cfg)
    custody = CustodyLog(out_dir, url_prefix)
    t0 = time.perf_counter()
    an = analyze_clip(Path(video_path), out_dir, cfg, hub, custody, progress)
    registry = load_registry(registry_path)
    case = CaseResult(
        case_id=case_id, created_at=_now(), prism_version=PRISM_VERSION, mode="clip", clip=an.meta,
        hint=normalize_hint(hint), threshold=cfg.match.tau if threshold is None else float(threshold),
        device=hub.device, ocr_backend=hub.ocr()[0].name, tracks=an.tracks, warnings=an.warnings,
        stage_timings=an.timings,
    )
    t = time.perf_counter()
    progress("matching", 0.2)
    score_case(case, registry, cfg)
    progress("matching", 1.0)
    case.stage_timings["matching"] = round(time.perf_counter() - t, 2)
    case.stage_timings["total"] = round(time.perf_counter() - t0, 2)
    case.custody = build_custody(cfg, [an.meta], _custody_models(hub), custody.items(), Path(registry_path))
    return case


def run_crosscam(
    video_a: Path | str,
    video_b: Path | str,
    hint: Optional[str] = None,
    threshold: Optional[float] = None,
    distance_km: Optional[float] = None,
    gap_s: Optional[float] = None,
    cfg: Optional[PrismConfig] = None,
    registry_path: Path | str = REGISTRY_PATH,
    out_dir: Optional[Path | str] = None,
    url_prefix: Optional[str] = None,
    progress: ProgressCB = _noop,
    case_id: Optional[str] = None,
) -> CaseResult:
    """Bonus B2: analyse two clips and link the same vehicle across cameras."""
    from prism.config import RUNS_DIR

    cfg = cfg or load_config()
    set_seeds(cfg.seed)
    case_id = case_id or uuid.uuid4().hex[:12]
    out_dir = Path(out_dir) if out_dir else RUNS_DIR / case_id
    url_prefix = url_prefix or f"/artifacts/{case_id}"
    hub = get_hub(cfg)
    custody = CustodyLog(out_dir, url_prefix)
    t0 = time.perf_counter()

    def half(offset: float) -> ProgressCB:
        return lambda s, f: progress(s, min(1.0, offset + f / 2))

    an_a = analyze_clip(Path(video_a), out_dir / "A", cfg, hub, custody, half(0.0), "A", True)
    an_b = analyze_clip(Path(video_b), out_dir / "B", cfg, hub, custody, half(0.5), "B", True)
    registry = load_registry(registry_path)
    enc, _ = hub.reid()
    thr = cfg.reid.thresholds.get(enc.key, cfg.reid.thresholds["clip"])
    raw_pairs = link_tracks(
        an_a.embeddings, an_b.embeddings,
        {t.track_id: fuse_frame_reads(t.frames, cfg.fusion).text for t in an_a.tracks},
        {t.track_id: fuse_frame_reads(t.frames, cfg.fusion).text for t in an_b.tracks},
        {t.track_id: t.attributes.body_type for t in an_a.tracks},
        {t.track_id: t.attributes.body_type for t in an_b.tracks},
        thr, cfg.match, cfg.reid.min_plate_agree,
    )
    speed = implied_speed_kmh(distance_km, gap_s)
    pairs = []
    for p in raw_pairs:
        reasons = [
            f"Appearance similarity {p['similarity']:.2f} ({'>=' if p['similarity'] >= thr else '<'} {thr:.2f}, {enc.name})",
            f"Plate check: {p['plate_note']}",
            f"Body type {'matches' if p['body_match'] else 'differs'}",
        ]
        flag = speed is not None and speed > cfg.reid.max_city_speed_kmh
        if speed is not None:
            reasons.append(
                f"Implied speed {speed:.0f} km/h between cameras"
                + (f" exceeds {cfg.reid.max_city_speed_kmh:.0f} km/h: flagged as implausible" if flag else "")
            )
        pairs.append(CrossCamPair(threshold=thr, speed_kmh=None if speed is None else round(speed, 1),
                                  speed_flag=flag, reasons=reasons, **p))
    case = CaseResult(
        case_id=case_id, created_at=_now(), prism_version=PRISM_VERSION, mode="crosscam", clip=an_a.meta,
        hint=normalize_hint(hint), threshold=cfg.match.tau if threshold is None else float(threshold),
        device=hub.device, ocr_backend=hub.ocr()[0].name, tracks=an_a.tracks,
        warnings=an_a.warnings + an_b.warnings, stage_timings={**an_a.timings, **an_b.timings},
        crosscam=CrossCamResult(encoder=enc.name, threshold=thr, clip_a=an_a.meta, clip_b=an_b.meta,
                                tracks_b=an_b.tracks, pairs=pairs),
    )
    t = time.perf_counter()
    progress("matching", 0.2)
    score_case(case, registry, cfg)
    progress("matching", 1.0)
    case.stage_timings["matching"] = round(time.perf_counter() - t, 2)
    case.stage_timings["total"] = round(time.perf_counter() - t0, 2)
    case.custody = build_custody(cfg, [an_a.meta, an_b.meta], _custody_models(hub), custody.items(), Path(registry_path))
    return case


def rescore_case(
    case: CaseResult,
    cfg: Optional[PrismConfig] = None,
    threshold: Optional[float] = None,
    hint: Optional[str] = None,
    registry: Optional[Sequence[RegistryRecord]] = None,
    target_track_id: Optional[int] = None,
    clear_hint: bool = False,
) -> CaseResult:
    """Rerun only Stage 5 (hint merge, matching, advisor, summary). Vision stages are not rerun."""
    cfg = cfg or load_config()
    new = case.model_copy(deep=True)
    if threshold is not None:
        new.threshold = float(threshold)
    if clear_hint:
        new.hint = None
    elif hint is not None:
        new.hint = normalize_hint(hint)
    registry = list(registry) if registry is not None else load_registry()
    if new.mode == "hint-only":
        t = new.tracks[0]
        t.fused = merge_hint(FusedPlate(text="", video_text="", length=0), new.hint)
        hint_pos = [p.index for p in t.fused.positions if p.source == "investigator-supplied"]
        a = t.attributes
        low = bool(new.clip and new.clip.low_light) or a.yolo_class == "low-light"
        t.match = match(t.fused.text, registry, cfg.match, a.color, a.body_type, a.make_model, new.threshold, low, hint_pos)
        t.advisor = advise(t.fused, t.match, cfg.match, cfg.ocr)
        new.primary_track_id = t.track_id
        new.narrative = summarize(new, cfg)
        return new
    return score_case(new, registry, cfg, target_track_id)


def _investigator_attr(value: Optional[str]) -> Optional[AttributeValue]:
    if not value:
        return None
    return AttributeValue(value=value, confidence=1.0, uncertain=False, top2=[(value, 1.0)],
                          source="investigator-supplied")


def hint_only_search(
    hint: str,
    color: Optional[str] = None,
    body_type: Optional[str] = None,
    make_model: Optional[str] = None,
    threshold: Optional[float] = None,
    low_light: bool = False,
    cfg: Optional[PrismConfig] = None,
    registry: Optional[Sequence[RegistryRecord]] = None,
    registry_path: Path | str = REGISTRY_PATH,
) -> CaseResult:
    """Registry search from an investigator hint (+ optional colour/body/make-model), no clip."""
    cfg = cfg or load_config()
    set_seeds(cfg.seed)
    registry = list(registry) if registry is not None else load_registry(registry_path)
    tau = cfg.match.tau if threshold is None else float(threshold)
    fused = merge_hint(FusedPlate(text="", video_text="", length=0), hint)
    unk = AttributeValue(value="uncertain", confidence=0.0, uncertain=True)
    attrs = Attributes(
        color=_investigator_attr(color) or unk,
        body_type=_investigator_attr(body_type) or unk.model_copy(),
        make_model=_investigator_attr(make_model),
        yolo_class="low-light" if low_light else "n/a",
    )
    hint_pos = [p.index for p in fused.positions if p.source == "investigator-supplied"]
    m = match(fused.text, registry, cfg.match, attrs.color, attrs.body_type, attrs.make_model, tau, low_light, hint_pos)
    track = TrackResult(
        track_id=0, yolo_class="n/a (hint-only search)", first_seen_sec=0.0, last_seen_sec=0.0, n_detections=0,
        fused=fused, attributes=attrs, match=m, advisor=advise(fused, m, cfg.match, cfg.ocr),
    )
    case = CaseResult(
        case_id="search-" + uuid.uuid4().hex[:8], created_at=_now(), prism_version=PRISM_VERSION,
        mode="hint-only", hint=fused.hint, threshold=tau, device="n/a", ocr_backend="n/a",
        tracks=[track], primary_track_id=0,
    )
    case.narrative = summarize(case, cfg)
    case.custody = build_custody(cfg, [], {"mode": "hint-only search (no video)"}, [], Path(registry_path))
    return case
