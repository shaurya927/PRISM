"""Super-resolution output must never reach BasePlateOCR.read (or anything downstream)."""

import hashlib
from pathlib import Path

import numpy as np
import pytest

from prism.config import PrismConfig
from prism.custody import CustodyLog
from prism.schemas import Attributes, AttributeValue
from prism.stages import ocr as ocr_mod
from prism.stages import plate_detect, super_res
from prism.stages import track as track_mod
from prism.stages.ocr import BasePlateOCR, SuperResolutionLeakError, read_plate_crop
from prism.stages.plate_detect import PlateCrop, PlateSample, TrackPlates, VehicleCrop
from prism.stages.super_res import SRImage, pad_to_ratio, sr_filename


def _h(a: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()


class SpyOCR(BasePlateOCR):
    name = "spy"

    def __init__(self, events):
        self.seen: list[str] = []
        self.events = events

    def read(self, plate_crop):
        assert isinstance(plate_crop, np.ndarray)
        self.seen.append(_h(plate_crop))
        self.events.append("ocr")
        return "CG04MX4821", [0.95] * 10


SR_MARK = 77


class FakeSR:
    available = True
    name = "fake-sr"

    def __init__(self, events):
        self.events = events
        self.outputs: list[str] = []

    def upscale(self, img):
        self.events.append("sr")
        out = np.full((img.shape[0] * 2, img.shape[1] * 2, 3), SR_MARK, np.uint8)
        self.outputs.append(_h(out))
        return SRImage(out)


class FakeAttr:
    name = "fake-clip"

    def classify(self, crops, yolo_class):
        v = AttributeValue(value="white", confidence=0.9, top2=[("white", 0.9)])
        return Attributes(color=v, body_type=AttributeValue(value="car", confidence=0.9), yolo_class=yolo_class)


class FakeHub:
    device = "cpu"

    def __init__(self, events):
        self.versions = {}
        self.spy = SpyOCR(events)
        self.sr = FakeSR(events)

    def plate_detector(self):
        return object()

    def ocr(self):
        return self.spy, []

    def super_res(self):
        return self.sr

    def attributes(self):
        return FakeAttr()

    def reid(self):
        raise AssertionError("not used")


def test_gate_rejects_sr_image_and_sr_paths():
    spy = SpyOCR([])
    cfg = PrismConfig()
    img = np.zeros((20, 80, 3), np.uint8)
    with pytest.raises(SuperResolutionLeakError):
        read_plate_crop(spy, SRImage(img), False, cfg.plate)
    with pytest.raises(SuperResolutionLeakError):
        read_plate_crop(spy, PlateCrop(img, "super_res"), False, cfg.plate)  # type: ignore[arg-type]
    with pytest.raises(SuperResolutionLeakError):
        read_plate_crop(spy, PlateCrop(img, "raw", path="runs/x/track1_f3_sr.png"), False, cfg.plate)
    with pytest.raises(SuperResolutionLeakError):
        read_plate_crop(spy, img, False, cfg.plate)  # bare arrays are refused too
    assert spy.seen == []
    text, confs, _ = read_plate_crop(spy, PlateCrop(img, "clahe"), False, cfg.plate)
    assert len(spy.seen) == 1 and len(confs) == len(text)


def test_pipeline_never_feeds_sr_to_ocr(tmp_path, monkeypatch):
    from prism.pipeline import analyze_clip

    events: list[str] = []
    hub = FakeHub(events)
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"not really a video")
    rng = np.random.default_rng(0)

    obs = [track_mod.TrackObs(i, i / 25, [0, 0, 200, 150], 0.9, "car") for i in range(6)]
    tracks = {7: track_mod.Track(7, obs)}
    stats = track_mod.VideoStats(1280, 720, 25.0, 6, 0.24, 120.0, False)
    monkeypatch.setattr(track_mod, "run_tracking", lambda *a, **k: (stats, tracks, "yolo11s.pt"))

    def fake_collect(*a, **k):
        tp = TrackPlates()
        for i in (1, 3, 5):
            raw = rng.integers(0, 255, (24, 96, 3), dtype=np.uint8)
            tp.samples.append(PlateSample(7, i, i / 25, 150.0, [10, 10, 106, 34], PlateCrop(raw, "raw"),
                                          PlateCrop(plate_detect.clahe_copy(raw, PrismConfig().plate), "clahe"),
                                          rng.integers(0, 255, (150, 200, 3), dtype=np.uint8), False))
        tp.vehicle_crops = [VehicleCrop(1, 0.04, 300.0, rng.integers(0, 255, (150, 200, 3), dtype=np.uint8))]
        return {7: tp}

    monkeypatch.setattr(plate_detect, "collect_plate_samples", fake_collect)
    out_dir = tmp_path / "run"
    custody = CustodyLog(out_dir, "/artifacts/run")
    an = analyze_clip(video, out_dir, PrismConfig(), hub, custody)

    # OCR ran on 3 frames x (raw + CLAHE); SR made 3 previews, all strictly after OCR finished.
    assert events.count("ocr") == 6 and events.count("sr") == 3
    assert max(i for i, e in enumerate(events) if e == "ocr") < min(i for i, e in enumerate(events) if e == "sr")
    # No SR output array ever reached BasePlateOCR.read.
    assert not set(hub.spy.seen) & set(hub.sr.outputs)
    # SR files exist with the *_sr.png name and are only referenced as sr_url.
    t = an.tracks[0]
    for f in t.frames:
        assert not (f.plate_crop_url or "").endswith("_sr.png")
        assert not (f.plate_clahe_url or "").endswith("_sr.png")
    sr_urls = [f.sr_url for f in t.frames if f.sr_url]
    assert len(sr_urls) == 3 and all(u.endswith("_sr.png") for u in sr_urls)
    assert all((out_dir / sr_filename(7, i)).exists() for i in (1, 3, 5))
    assert all(f.sr_url is None for f in t.frames if f.source == "clahe")
    # Fusion only used OCR reads.
    assert t.fused.text == "CG04MX4821"
    assert any(a.kind == "super_res_visual_aid_not_evidence" for a in custody.items())


def test_super_res_disables_cleanly_without_weights(tmp_path):
    sr = super_res.SuperResolver(PrismConfig().super_res, "cpu", weights=tmp_path / "missing.pth")
    assert not sr.available and "not found" in sr.reason
    assert sr.upscale(np.zeros((16, 48, 3), np.uint8)) is None
    assert super_res.write_sr_artifact(sr, np.zeros((16, 48, 3), np.uint8), tmp_path, 1, 2) is None


def test_pad_to_ratio():
    out = pad_to_ratio(np.zeros((20, 40, 3), np.uint8), 3.0, (127, 127, 127))
    assert out.shape[:2] == (20, 60) and out[0, 0, 0] == 127
    out = pad_to_ratio(np.zeros((10, 60, 3), np.uint8), 3.0, (127, 127, 127))
    assert out.shape[:2] == (20, 60)


def test_ocr_module_has_no_super_res_import():
    src = Path(ocr_mod.__file__).read_text()
    assert "super_res" not in src.replace("SuperResolutionLeakError", "").replace("super-resolution", "")
