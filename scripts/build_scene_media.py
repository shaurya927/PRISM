"""Build the real-footage background and intro media for the website and app.

Writes to frontend/public/media/:

* highway.mp4 / .webm / .jpg  12 s seamless loop of night freeway traffic (H.264 and VP9), plus poster.
                              Source: Wikimedia Commons, CC BY 3.0 (downloaded by this script).
* highway_tracks.json         YOLO11 + ByteTrack boxes for every second frame of highway.mp4, so the
                              site's tracking overlay shows real detections, not drawn ones
* verna_spin.mp4 / .webm / .jpg
                              A Hyundai Verna turning about one and a quarter times and stopping face-on,
                              cut from the team's 360-view screen recording in video_assets/. The mouse
                              cursor is painted out and PRISM's plate read is drawn onto the car's blanked
                              (red) plates. Poster = last frame.
* verna_spin.json             Per frame of verna_spin.mp4: car box and plate box, so the intro's tracking
                              brackets follow the car while it turns

Sources and licences are listed in frontend/public/media/CREDITS.md.

Needs ffmpeg (``pip install imageio-ffmpeg`` or ffmpeg on PATH), Pillow, and for the tracks the detector
weights (``python scripts/download_weights.py``).

Usage:  python scripts/build_scene_media.py [--spin-only] [--spin-src PATH]
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "artifacts" / "scene_src"
MEDIA = ROOT / "frontend" / "public" / "media"
UA = {"User-Agent": "PRISM-site-media/1.0 (https://github.com/shaurya927/PRISM)"}

NIGHT_URL = ("https://upload.wikimedia.org/wikipedia/commons/transcoded/8/82/Cars_driving_at_night.webm/"
             "Cars_driving_at_night.webm.1080p.vp9.webm")
WIDTH = 1600

LOOP_START = 128.0  # seconds into the source: dense traffic in every lane
LOOP_LEN = 12.0
FADE = 1.0  # crossfade between the loop's end and start
VEHICLE_CLASSES = {2: "car", 3: "bike", 5: "bus", 7: "truck"}

SPIN_SRC = ROOT / "video_assets" / "Screen Recording 2026-11-23 152327.mp4"
# Frames of the recording to use: 88-170 is one full turn, 171-183 turns on until the car faces the
# camera (183 is the first frame of the final pose). Later frames are the same pose with a moving cursor.
SPIN_FRAMES = (88, 186)
SPIN_WIDTH = 1440
# The recording's mouse cursor: a frame and box where it sits on plain background, and the rows it moves
# along while dragging the 360 view during SPIN_FRAMES.
CURSOR_REF = (218, (888, 121, 926, 167))
CURSOR_BAND = (660, 800)
PLATE = "CG04MX4821"  # PRISM's fused read for day_clear_white (frontend/src/site/data/cases.json)
FONTS = ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
         "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]


def ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
    except ImportError:
        sys.exit("ffmpeg not found: install it or `pip install imageio-ffmpeg`")
    return imageio_ffmpeg.get_ffmpeg_exe()


def fetch(url: str, dst: Path) -> Path:
    if dst.exists() and dst.stat().st_size > 10_000:
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {dst.name} ...")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=600) as r, open(dst, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    return dst


def run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"command failed ({r.returncode}): {' '.join(cmd)}\n{r.stderr[-2000:]}")


def build_loop(ff: str, src: Path) -> Path:
    """Loop where the last FADE seconds dissolve into the first, so playback wraps without a cut."""
    out = MEDIA / "highway.mp4"
    a, n, f = LOOP_START, LOOP_LEN, FADE
    graph = (
        f"[0:v]trim=start={a + f}:end={a + n},setpts=PTS-STARTPTS[body];"
        f"[0:v]trim=start={a + n}:end={a + n + f},setpts=PTS-STARTPTS[tail];"
        f"[0:v]trim=start={a}:end={a + f},setpts=PTS-STARTPTS[head];"
        f"[tail][head]xfade=transition=fade:duration={f}:offset=0[seam];"
        f"[body][seam]concat=n=2:v=1:a=0,scale={WIDTH}:-2:flags=lanczos,format=yuv420p[v]"
    )
    run([ff, "-y", "-i", str(src), "-filter_complex", graph, "-map", "[v]", "-an",
         "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-profile:v", "high",
         "-movflags", "+faststart", str(out)])
    # VP9 copy for browsers without H.264 (some Chromium builds); same frames, so the tracks fit both
    run([ff, "-y", "-i", str(out), "-an", "-c:v", "libvpx-vp9", "-crf", "38", "-b:v", "0", "-row-mt", "1",
         "-deadline", "good", "-cpu-used", "2", str(MEDIA / "highway.webm")])
    run([ff, "-y", "-i", str(out), "-frames:v", "1", "-q:v", "4", str(MEDIA / "highway.jpg")])
    return out


def build_tracks(video: Path) -> None:
    sys.path.insert(0, str(ROOT))
    import cv2
    from ultralytics import YOLO

    from prism.config import WEIGHTS_DIR

    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    model = YOLO(str(WEIGHTS_DIR / "yolo11s.pt"))
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
    (MEDIA / "highway_tracks.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    n = sum(len(b) for b in frames)
    print(f"highway_tracks.json: {len(frames)} frames, {n} boxes")


# ------------------------------------------------------------------ Verna spin

def _plate_texture(text: str):
    """Indian number plate (white, black text, blue IND strip) as a 1000x220 BGR image."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    w, h = 1000, 220
    im = Image.new("RGB", (w, h), (244, 244, 238))
    d = ImageDraw.Draw(im)
    d.rectangle([4, 4, w - 5, h - 5], outline=(20, 20, 20), width=10)
    d.rectangle([12, 12, 104, h - 13], fill=(29, 79, 168))
    t = f"{text[:2]} {text[2:4]} {text[4:6]} {text[6:]}"
    path = next((f for f in FONTS if Path(f).exists()), None)
    avail = w - 104 - 44
    size = 150
    while True:  # largest size whose text fits beside the IND strip
        font = ImageFont.truetype(path, size) if path else ImageFont.load_default()
        box = d.textbbox((0, 0), t, font=font)
        if box[2] - box[0] <= avail or size <= 40 or not path:
            break
        size -= 4
    small = ImageFont.truetype(path, 34) if path else font
    d.text((58, h - 30), "IND", fill=(255, 255, 255), font=small, anchor="ms")
    tw = box[2] - box[0]
    d.text((104 + (w - 104 - tw) / 2 - box[0], h / 2), t, fill=(18, 18, 18), font=font, anchor="lm")
    return np.asarray(im)[:, :, ::-1].copy()  # RGB -> BGR


def _order(pts):
    import numpy as np

    pts = np.asarray(pts, np.float32).reshape(-1, 2)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]], np.float32)


def _red_mask(im):
    import cv2

    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    m = (((hsv[..., 0] < 8) | (hsv[..., 0] > 172)) & (hsv[..., 1] > 120) & (hsv[..., 2] > 110)).astype("uint8") * 255
    return cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))


def _cursor_template(cap):
    """The mouse cursor cut from a still frame where it sits on plain background: (gray, edges, shape mask)."""
    import cv2
    import numpy as np

    cap.set(cv2.CAP_PROP_POS_FRAMES, CURSOR_REF[0])
    ok, ref = cap.read()
    x0, y0, x1, y1 = CURSOR_REF[1]
    tpl = ref[y0 - 4:y1 + 5, x0 - 4:x1 + 5]
    g = cv2.cvtColor(tpl, cv2.COLOR_BGR2GRAY)
    bg = np.median(g[:3])
    shape = cv2.dilate((np.abs(g.astype(np.int16) - bg) > 22).astype(np.uint8) * 255, np.ones((5, 5), np.uint8))
    return g, cv2.Canny(g, 60, 160), shape


def _remove_cursor(im, cursor):
    """Paint out the cursor where it overlaps the car (it moves along a horizontal band while dragging)."""
    import cv2
    import numpy as np

    g, edges, shape = cursor
    y0, y1 = CURSOR_BAND
    band = cv2.cvtColor(im[y0:y1], cv2.COLOR_BGR2GRAY)
    r = cv2.matchTemplate(cv2.Canny(band, 60, 160), edges, cv2.TM_CCORR_NORMED)
    _, score, _, (x, y) = cv2.minMaxLoc(r)
    if score < 0.36:
        return im
    mask = np.zeros(im.shape[:2], np.uint8)
    th, tw = shape.shape
    mask[y0 + y:y0 + y + th, x:x + tw] = shape
    return cv2.inpaint(im, mask, 7, cv2.INPAINT_TELEA)


def _process_frame(im, tex, cursor=None):
    """Paint out the cursor, draw the plate on the red blanked plate. Returns (frame, car_box, plate_box)."""
    import cv2
    import numpy as np

    h, w = im.shape[:2]
    if cursor is not None:
        im = _remove_cursor(im, cursor)
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    dark = cv2.morphologyEx((gray < 150).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(dark)
    car = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])) if n > 1 else 0
    cx, cy, cw, ch = stats[car, :4] if car else (0, 0, w, h)
    # cursor: small dark blobs well clear of the car
    cursor = np.zeros_like(dark)
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if i != car and area < 3000 and bw < 60 and bh < 60 and \
                (x > cx + cw + 4 or x + bw < cx - 4 or y + bh < cy - 4 or y > cy + ch + 4):
            cursor[lab == i] = 255
    if cursor.any():
        im = cv2.inpaint(im, cv2.dilate(cursor, np.ones((7, 7), np.uint8)), 5, cv2.INPAINT_TELEA)

    red = _red_mask(im)
    plate_box = None
    cnts, _ = cv2.findContours(red, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    def plate_like(c):
        # the blanked plate is a flat, filled, wide rectangle; red tail lamps are not
        (_, _), (rw, rh), _ = cv2.minAreaRect(c)
        long, short = max(rw, rh), max(1.0, min(rw, rh))
        area = cv2.contourArea(c)
        solid = area / max(1.0, cv2.contourArea(cv2.convexHull(c)))
        upright = area > 120 and area / max(1.0, rw * rh) > 0.72 and 1.6 < long / short < 7
        slanted = area > 500 and solid > 0.65 and long / short < 5  # plate seen at a steep angle
        return upright or slanted

    cnts = [c for c in cnts if plate_like(c)]
    if cnts:
        c = max(cnts, key=cv2.contourArea)
        x, y, bw, bh = cv2.boundingRect(c)
        approx = cv2.approxPolyDP(c, 0.04 * cv2.arcLength(c, True), True)
        quad = _order(approx if len(approx) == 4 else cv2.boxPoints(cv2.minAreaRect(c)))
        centre = quad.mean(0)
        quad = centre + (quad - centre) * np.array([1.04, 1.12], np.float32)  # cover the red edge
        th, tw = tex.shape[:2]
        src = np.array([[0, 0], [tw, 0], [tw, th], [0, th]], np.float32)
        M = cv2.getPerspectiveTransform(src, quad)
        warped = cv2.warpPerspective(tex, M, (w, h), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_CONSTANT)
        alpha = cv2.warpPerspective(np.full((th, tw), 255, np.uint8), M, (w, h), flags=cv2.INTER_LINEAR)
        warped = cv2.GaussianBlur(warped, (0, 0), 0.7)
        a = (alpha.astype(np.float32) / 255)[..., None]
        im = (im * (1 - a) + warped * 0.93 * a).astype(np.uint8)
        # any red fringe the quad missed
        left = cv2.bitwise_and(cv2.dilate(red, np.ones((3, 3), np.uint8)), cv2.bitwise_not(alpha))
        if left.any():
            im = cv2.inpaint(im, left, 3, cv2.INPAINT_TELEA)
        if bw > 18:
            plate_box = [x, y, bw, bh]
    return im, [int(cx), int(cy), int(cw), int(ch)], plate_box


def build_spin(ff: str, src: Path) -> None:
    import cv2
    import numpy as np

    if not src.exists():
        sys.exit(f"Verna recording not found: {src}")
    cap = cv2.VideoCapture(str(src))
    a, b = SPIN_FRAMES
    cursor = _cursor_template(cap)
    cap.set(cv2.CAP_PROP_POS_FRAMES, a)
    tex = _plate_texture(PLATE)
    kept, boxes, prev = [], [], None
    for _ in range(a, b):
        ok, im = cap.read()
        if not ok:
            break
        g = cv2.resize(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), (478, 262)).astype(np.float32)
        # the screen recording repeats frames; dropping them keeps the turn smooth
        if prev is not None and float(np.abs(g - prev).mean()) < 0.6:
            continue
        prev = g
        out, car, plate = _process_frame(im, tex, cursor)
        kept.append(out)
        boxes.append((car, plate))
    cap.release()
    h, w = kept[0].shape[:2]
    with tempfile.TemporaryDirectory() as tmp:
        for i, im in enumerate(kept):
            cv2.imwrite(str(Path(tmp) / f"f{i:04d}.png"), im)
        pattern = str(Path(tmp) / "f%04d.png")
        vf = f"scale={SPIN_WIDTH}:-2:flags=lanczos,format=yuv420p"
        run([ff, "-y", "-framerate", "30", "-i", pattern, "-vf", vf, "-c:v", "libx264", "-preset", "slow",
             "-crf", "24", "-profile:v", "high", "-movflags", "+faststart", str(MEDIA / "verna_spin.mp4")])
        run([ff, "-y", "-framerate", "30", "-i", pattern, "-vf", vf, "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0",
             "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", str(MEDIA / "verna_spin.webm")])
    last = cv2.resize(kept[-1], (SPIN_WIDTH, round(SPIN_WIDTH * h / w / 2) * 2), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(MEDIA / "verna_spin.jpg"), last, [cv2.IMWRITE_JPEG_QUALITY, 86])
    f = lambda r: None if r is None else [round(r[0] / w * 1000), round(r[1] / h * 1000),  # noqa: E731
                                          round(r[2] / w * 1000), round(r[3] / h * 1000)]
    doc = {"fps": 30, "w": w, "h": h, "frames": [[f(c), f(p)] for c, p in boxes]}
    (MEDIA / "verna_spin.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    print(f"verna_spin.mp4: {len(kept)} frames ({len(kept) / 30:.2f} s), "
          f"{(MEDIA / 'verna_spin.mp4').stat().st_size / 1e6:.2f} MB")


def main() -> None:
    MEDIA.mkdir(parents=True, exist_ok=True)
    ff = ffmpeg()
    spin_src = Path(sys.argv[sys.argv.index("--spin-src") + 1]) if "--spin-src" in sys.argv else SPIN_SRC
    build_spin(ff, spin_src)
    if "--spin-only" in sys.argv:
        return
    night = fetch(NIGHT_URL, SRC / "cars_driving_at_night_1080p.webm")
    video = build_loop(ff, night)
    print(f"highway.mp4: {video.stat().st_size / 1e6:.2f} MB")
    build_tracks(video)


if __name__ == "__main__":
    main()
