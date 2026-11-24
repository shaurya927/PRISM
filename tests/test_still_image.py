"""A still photo runs through the same stages as a one-frame clip (no models needed here)."""

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from prism.config import IngestConfig, PlateConfig, PrismConfig, TrackConfig
from prism.narrative import summarize
from prism.stages import track as track_stage
from prism.stages.plate_detect import collect_plate_samples
from prism.stages.track import detect_still, is_image, iter_frames, read_image, run_tracking
from tests.helpers import make_case, night_frames


def photo(tmp_path, name="photo.png", w=640, h=360):
    img = np.full((h, w, 3), 90, np.uint8)
    rng = np.random.default_rng(0)
    img[200:240, 260:380] = rng.integers(0, 255, (40, 120, 3), dtype=np.uint8)  # a busy, sharp "plate"
    path = tmp_path / name
    assert cv2.imwrite(str(path), img)
    return path


class _Arr:
    def __init__(self, a):
        self.a = np.asarray(a)

    def cpu(self):
        return self

    def numpy(self):
        return self.a


class _Boxes:
    def __init__(self, xyxy, conf, cls):
        self.xyxy, self.conf, self.cls = _Arr(xyxy), _Arr(conf), _Arr(cls)

    def __len__(self):
        return len(self.xyxy.a)


class FakeYOLO:
    """Stands in for ultralytics: a car, a bigger truck and a person (not a vehicle class)."""

    def __init__(self):
        self.kwargs = None

    def predict(self, img, **kwargs):
        self.kwargs = kwargs
        boxes = _Boxes([[200, 120, 440, 300], [10, 10, 330, 350], [500, 50, 560, 200]], [0.9, 0.8, 0.7], [2, 7, 0])
        return [type("R", (), {"boxes": boxes})()]


def test_photo_is_one_frame(tmp_path):
    p = photo(tmp_path)
    assert is_image(p) and is_image("X.JPEG") and not is_image("clip.mp4")
    frames = list(iter_frames(p))
    assert [i for i, _ in frames] == [0] and frames[0][1].shape == (360, 640, 3)


def test_unreadable_photo_is_a_clear_error(tmp_path):
    bad = tmp_path / "broken.jpg"
    bad.write_bytes(b"not an image")
    with pytest.raises(ValueError, match="Cannot read image"):
        read_image(bad)


def test_photo_gives_one_track_per_vehicle_largest_first(tmp_path, monkeypatch):
    fake = FakeYOLO()
    monkeypatch.setattr(track_stage, "load_detector", lambda cfg, device: (fake, "yolo11n.pt"))
    stats, tracks, name = run_tracking(photo(tmp_path), TrackConfig(), IngestConfig(), "cpu")
    assert sorted(tracks) == [1, 2]                      # the person is not a vehicle
    assert tracks[1].cls == "truck" and tracks[2].cls == "car"  # largest box first
    for t in tracks.values():                            # one observation each, at frame 0 and time 0
        assert [(o.frame_idx, o.timestamp_sec) for o in t.observations] == [(0, 0.0)]
    assert (stats.fps, stats.frame_count, stats.duration_sec) == (0.0, 1, 0.0)
    assert fake.kwargs["agnostic_nms"] is True           # one vehicle is not boxed as both car and truck


def test_plate_samples_come_from_the_photo(tmp_path, monkeypatch):
    monkeypatch.setattr(track_stage, "load_detector", lambda cfg, device: (FakeYOLO(), "yolo11n.pt"))
    path = photo(tmp_path)
    _, tracks, _ = detect_still(path, TrackConfig(), IngestConfig(), "cpu")

    class FakePlateDetector:
        def detect(self, crop):  # the busy patch, in crop coordinates of the car box (200, 120)
            return [([60, 80, 180, 120], 0.9)]

    plates = collect_plate_samples(path, {2: tracks[2]}, FakePlateDetector(), PlateConfig(), 3)
    s = plates[2].samples
    assert len(s) == 1 and s[0].frame_idx == 0 and s[0].plate_bbox[0] >= 200 and s[0].raw.source == "raw"


def test_summary_of_a_photo_says_in_the_photo(small_registry):
    case = make_case(small_registry, night_frames())
    case.clip = case.clip.model_copy(update={"media": "image", "fps": 0.0, "frame_count": 1, "duration_sec": 0.0})
    n = summarize(case, PrismConfig())
    assert "in the photo" in n.text and "seen 00:" not in n.text and n.removed == 0


def test_upload_accepts_a_photo(tmp_path, monkeypatch):
    from backend.app import main

    queued = []
    monkeypatch.setattr(main._worker, "submit", lambda *a, **k: queued.append(a))
    client = TestClient(main.app)
    data = photo(tmp_path, "car.jpg").read_bytes()
    r = client.post("/api/jobs", files={"file": ("car.jpg", data, "image/jpeg")})
    assert r.status_code == 200, r.text
    job = r.json()["job_id"]
    assert queued and str(queued[0][3]).endswith("clip.jpg")  # submit(_run, job, run_pipeline, path, ...)
    assert client.delete(f"/api/jobs/{job}").status_code == 200
