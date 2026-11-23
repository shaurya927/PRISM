"""Build the daytime highway loop used by the landing-page hero.

* highway_day.mp4 / .webm / .jpg   12 s seamless loop of daytime freeway traffic (H.264 and VP9), plus poster.
                                   Source: Wikimedia Commons, CC BY 4.0 (downloaded by this script).
* highway_day_tracks.json          YOLO11 + ByteTrack boxes for every second frame of highway_day.mp4, in
                                   the same format as highway_tracks.json, so the hero overlay shows real
                                   detections.

Sources and licences are listed in frontend/public/media/CREDITS.md.

Needs PyAV (``pip install av``) with libx264 and libvpx-vp9, Pillow, numpy, and for the tracks
ultralytics + opencv (both in requirements.txt). The YOLO11 weights are downloaded into weights/ if missing.

Usage:  python scripts/build_day_media.py [--tracks-only]
"""
from __future__ import annotations

import json
import shutil
import sys
import urllib.request
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "artifacts" / "scene_src"
MEDIA = ROOT / "frontend" / "public" / "media"
UA = {"User-Agent": "PRISM-site-media/1.0 (https://github.com/shaurya927/PRISM)"}

DAY_URL = ("https://upload.wikimedia.org/wikipedia/commons/transcoded/d/d6/"
           "I495_towards_i270_spur_from_bradley_blvd_20201123_171152609.webm/"
           "I495_towards_i270_spur_from_bradley_blvd_20201123_171152609.webm.1080p.vp9.webm")
WIDTH, HEIGHT = 1600, 900
FPS = 30
LOOP_START = 14.0  # seconds into the source: steady framing, traffic in every lane, no truck filling the frame
LOOP_LEN = 12.0
FADE = 1.0  # the loop's last second dissolves into its first, so playback wraps without a cut
VEHICLE_CLASSES = {2: "car", 3: "bike", 5: "bus", 7: "truck"}


def fetch(url: str, dst: Path) -> Path:
    if dst.exists() and dst.stat().st_size > 10_000:
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {dst.name} ...")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=600) as r, open(dst, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    return dst


def _encoder(path: Path, codec: str, options: dict[str, str], container_options: dict[str, str] | None = None):
    import av

    out = av.open(str(path), "w", options=container_options or {})
    st = out.add_stream(codec, rate=FPS)
    st.width, st.height, st.pix_fmt = WIDTH, HEIGHT, "yuv420p"
    st.time_base = Fraction(1, FPS)
    st.options = options
    return out, st


def build_loop(src: Path) -> Path:
    """Stream the source once: keep the first FADE seconds, write the body, then blend the tail into the kept head."""
    import av
    import numpy as np
    from PIL import Image

    mp4, webm = MEDIA / "highway_day.mp4", MEDIA / "highway_day.webm"
    outs = [
        _encoder(mp4, "libx264", {"crf": "31", "preset": "slow", "profile": "high"}, {"movflags": "+faststart"}),
        _encoder(webm, "libvpx-vp9", {"crf": "41", "b": "0", "row-mt": "1", "deadline": "good", "cpu-used": "2"}),
    ]
    n_fade = round(FADE * FPS)
    a, body_end, end = LOOP_START, LOOP_START + LOOP_LEN, LOOP_START + LOOP_LEN + FADE
    head: list = []
    written = 0
    poster = None

    def write(rgb) -> None:
        nonlocal written
        for out, st in outs:
            frame = av.VideoFrame.from_ndarray(rgb, format="rgb24")
            frame.pts = written
            for pkt in st.encode(frame):
                out.mux(pkt)
        written += 1

    with av.open(str(src)) as c:
        s = c.streams.video[0]
        tail_i = 0
        for f in c.decode(s):
            t = float(f.pts * s.time_base)
            if t < a:
                continue
            if t >= end or tail_i >= n_fade:
                break
            rgb = np.asarray(f.to_image().resize((WIDTH, HEIGHT), Image.LANCZOS))
            if t < a + FADE:
                head.append(rgb)  # becomes the end of the loop, blended with the tail
            elif t < body_end:
                if poster is None:
                    poster = rgb
                write(rgb)
            else:
                k = min(tail_i, len(head) - 1)
                w = (tail_i + 1) / (n_fade + 1)
                write((rgb.astype(np.float32) * (1 - w) + head[k].astype(np.float32) * w).round().astype(np.uint8))
                tail_i += 1
    for out, st in outs:
        for pkt in st.encode():
            out.mux(pkt)
        out.close()
    Image.fromarray(poster).save(MEDIA / "highway_day.jpg", quality=84)
    print(f"highway_day.mp4: {written} frames ({written / FPS:.1f} s), {mp4.stat().st_size / 1e6:.2f} MB; "
          f"webm {webm.stat().st_size / 1e6:.2f} MB")
    return mp4


def build_tracks(video: Path) -> None:
    sys.path.insert(0, str(ROOT))
    import cv2
    from ultralytics import YOLO

    from prism.config import WEIGHTS_DIR

    weights = WEIGHTS_DIR / "yolo11s.pt"
    weights.parent.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or FPS
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    model = YOLO(str(weights))  # ultralytics downloads the official weights to this path if they are missing
    frames = []
    for i, r in enumerate(model.track(source=str(video), tracker="bytetrack.yaml", classes=list(VEHICLE_CLASSES),
                                      conf=0.25, persist=True, stream=True, verbose=False)):
        if i % 2:
            continue
        boxes = []
        if r.boxes is not None and r.boxes.id is not None:
            for (x1, y1, x2, y2), tid, c, p in zip(r.boxes.xyxy.tolist(), r.boxes.id.tolist(),
                                                    r.boxes.cls.tolist(), r.boxes.conf.tolist()):
                if (x2 - x1) < w * 0.012:
                    continue
                # integers in 1/1000 of the frame keep the file small
                boxes.append([int(tid), VEHICLE_CLASSES[int(c)][0], round(x1 / w * 1000), round(y1 / h * 1000),
                              round((x2 - x1) / w * 1000), round((y2 - y1) / h * 1000), round(p * 100)])
        frames.append(boxes)
    doc = {"fps": fps / 2, "w": w, "h": h, "detector": "yolo11s + bytetrack", "frames": frames}
    (MEDIA / "highway_day_tracks.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    n = sum(len(b) for b in frames)
    print(f"highway_day_tracks.json: {len(frames)} frames, {n} boxes")


def main() -> None:
    MEDIA.mkdir(parents=True, exist_ok=True)
    video = MEDIA / "highway_day.mp4"
    if "--tracks-only" not in sys.argv:
        src = fetch(DAY_URL, SRC / "i495_bradley_blvd_1080p.webm")
        video = build_loop(src)
    build_tracks(video)


if __name__ == "__main__":
    main()
