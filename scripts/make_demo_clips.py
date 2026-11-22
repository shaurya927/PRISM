"""Build synthetic CCTV demo clips with known Indian plates (ground truth in labels.json).

Real vehicle photos from vendor/vehicle-reidentification/reference_vehicles are composited onto
a road, the original (foreign) plate is located with the real fast-alpr detector and covered
by a rendered Indian plate, and the vehicle is animated towards the camera. Each frame then
gets CCTV-style degradation: motion blur, sensor noise and JPEG compression; night clips are
darkened. Some plates have characters hidden by a mud smear, so PRISM must report them as '?'.

Usage:  python scripts/make_demo_clips.py [--out data/test_clips]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from prism.config import PlateConfig, TEST_CLIPS_DIR  # noqa: E402
from prism.registry import load_registry  # noqa: E402

REF = ROOT / "vendor" / "vehicle-reidentification" / "reference_vehicles"
W, H, FPS = 1280, 720, 25


@dataclass
class ClipSpec:
    name: str
    image: str
    plate: str
    lines: list[str]
    registry_id: str | None
    color: str
    body_type: str
    expected: str
    night: bool = False
    occlude: list[int] = field(default_factory=list)   # 0-based plate positions hidden by mud
    seconds: float = 6.0
    blur: int = 5
    noise: float = 6.0
    jpeg: int = 45
    mirror: bool = False
    seed: int = 0
    note: str = ""


SPECS = [
    ClipSpec("day_clear_white.mp4", "vid_front2_white_car.jpg", "CG04MX4821", ["CG 04 MX 4821"], "REG-0001",
             "white", "car", "MATCHED", seed=1, note="Clear daytime approach; full plate readable."),
    ClipSpec("night_partial_white.mp4", "vid_front2_white_car.jpg", "CG04MX4821", ["CG 04 MX 4821"], "REG-0001",
             "white", "car", "AMBIGUOUS", night=True, occlude=[8], blur=4, noise=7, jpeg=45, seed=2,
             note="Night, position 9 smeared with mud. REG-0002 (CG04MX4851) differs only at position 9."),
    ClipSpec("camB_white.mp4", "vid_front2_white_car.jpg", "CG04MX4821", ["CG 04 MX 4821"], "REG-0001",
             "white", "car", "MATCHED", occlude=[0], mirror=True, seed=3, blur=5,
             note="Second camera for the cross-camera demo: position 1 is smeared, position 9 is visible."),
    ClipSpec("day_black_suv.mp4", "vid_front2_black_car.jpg", "MH12DE5678", ["MH 12 DE 5678"], "REG-0010",
             "black", "SUV", "MATCHED", seed=4, note="Black Toyota Innova (MPV/SUV)."),
    ClipSpec("day_blue_twoline.mp4", "vid_back_blue_car.jpg", "KA05MN2023", ["KA 05 MN", "2023"], "REG-0020",
             "blue", "car", "MATCHED", seed=5, blur=3, note="Rear view, two-line plate."),
    ClipSpec("unregistered_white.mp4", "vid_front2_white_car.jpg", "MH14XY0042", ["MH 14 XY 0042"], None,
             "white", "car", "NO CONFIDENT MATCH", seed=6, mirror=True,
             note="Plate not in the registry: PRISM must not force a match."),
]


def font(size: int) -> ImageFont.FreeTypeFont:
    import matplotlib

    path = Path(matplotlib.get_data_path()) / "fonts" / "ttf" / "DejaVuSans-Bold.ttf"
    return ImageFont.truetype(str(path), size)


def render_plate(lines: list[str], occlude_chars: list[int], rng: np.random.Generator) -> np.ndarray:
    """High-res white Indian plate (BGR). Characters at `occlude_chars` (plate index) get mud."""
    two = len(lines) == 2
    pw, ph = (560, 300) if two else (900, 190)
    img = Image.new("RGB", (pw, ph), (242, 242, 236))
    d = ImageDraw.Draw(img)
    d.rectangle([4, 4, pw - 5, ph - 5], outline=(20, 20, 20), width=8)
    line_h = ph / len(lines)
    fs = int(line_h * 0.78)
    # Shrink until the widest line fits inside the border with a margin.
    while fs > 20 and max(d.textlength(l, font=font(fs)) for l in lines) > pw * 0.88:
        fs -= 4
    f = font(fs)
    boxes: list[tuple[int, int, int, int]] = []  # bbox of each non-space char, in plate order
    for li, line in enumerate(lines):
        tw = d.textlength(line, font=f)
        x0 = (pw - tw) / 2
        y0 = li * line_h + (line_h - fs) / 2 - 8
        d.text((x0, y0), line, font=f, fill=(15, 15, 15))
        for i, ch in enumerate(line):
            if ch == " ":
                continue
            a = x0 + d.textlength(line[:i], font=f)
            b = x0 + d.textlength(line[: i + 1], font=f)
            boxes.append((int(a), int(y0 + 10), int(b), int(y0 + fs + 14)))
    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    for k in occlude_chars:
        # Light-brown mud smear over exactly one character: the glyph is unreadable, but the
        # plate still looks like a plate, so OCR keeps reading the characters after it.
        # Dark mud band over the middle of the glyph; only its top and bottom edges stay visible,
        # so OCR either skips it or reads it at low confidence (the "almost readable" case).
        x1, y1, x2, y2 = boxes[k]
        h = y2 - y1
        mud = np.array([60, 80, 100], np.float32)  # dark brown (BGR)
        ya, yb = y1 + int(h * 0.2), y2 - int(h * 0.2)
        patch = np.empty((yb - ya, x2 - x1 + 4, 3), np.float32)
        patch[:] = mud
        patch += rng.normal(0, 8, patch.shape)
        xa = max(0, x1 - 2)
        arr[ya:yb, xa:xa + patch.shape[1]] = np.clip(patch[:, : arr.shape[1] - xa], 0, 255).astype(np.uint8)
    return arr


def find_plate_box(car: np.ndarray) -> tuple[int, int, int, int]:
    from prism.stages.plate_detect import PlateDetector

    det = PlateDetector(PlateConfig(det_conf=0.2))
    found = det.detect(car)
    if not found:
        raise RuntimeError("no plate found on reference image")
    x1, y1, x2, y2 = found[0][0]
    w, h = x2 - x1, y2 - y1
    return max(0, int(x1 - 0.08 * w)), max(0, int(y1 - 0.12 * h)), int(x2 + 0.08 * w), int(y2 + 0.12 * h)


def compose_vehicle(spec: ClipSpec, rng: np.random.Generator) -> np.ndarray:
    car = cv2.imread(str(REF / spec.image))
    if spec.mirror:
        car = cv2.flip(car, 1)  # flip the car only; the new plate is drawn un-mirrored
    x1, y1, x2, y2 = find_plate_box(car)
    plate = render_plate(spec.lines, spec.occlude, rng)
    car[y1:y2, x1:x2] = cv2.resize(plate, (x2 - x1, y2 - y1), interpolation=cv2.INTER_AREA)
    # Upscale the (small) reference photo so the plate is CCTV-legible near the camera.
    target_h = 560
    s = target_h / car.shape[0]
    return cv2.resize(car, (int(car.shape[1] * s), target_h), interpolation=cv2.INTER_CUBIC)


def road_background(rng: np.random.Generator) -> np.ndarray:
    bg = np.zeros((H, W, 3), np.uint8)
    for y in range(H):
        v = int(95 + 50 * y / H)
        bg[y, :] = (v, v, v + 4)
    pts = np.array([[W * 0.38, 0], [W * 0.62, 0], [W * 1.0, H], [0, H]], np.int32)
    cv2.fillPoly(bg, [pts], (88, 90, 92))
    for i in range(8):  # dashed centre line
        y0 = int(i * H / 8)
        cv2.line(bg, (W // 2, y0), (W // 2, y0 + 40), (210, 210, 200), 6)
    bg[: int(H * 0.18)] = (170, 160, 140)  # far background
    noise = rng.normal(0, 4, bg.shape)
    return np.clip(bg + noise, 0, 255).astype(np.uint8)


def degrade(frame: np.ndarray, spec: ClipSpec, rng: np.random.Generator) -> np.ndarray:
    k = int(rng.integers(max(1, spec.blur - 2), spec.blur + 1))
    if k > 1:
        kern = np.zeros((k, k), np.float32)
        kern[k // 2, :] = 1.0 / k  # horizontal camera shake / motion blur
        frame = cv2.filter2D(frame, -1, kern)
    if spec.night:
        # Night: dark scene; the plate (lit by its own lamp and headlights) stays the brightest
        # surface, which a gamma curve preserves.
        f = frame.astype(np.float32) / 255.0
        f = np.power(f, 1.6) * 0.62
        f[..., 0] *= 1.12  # bluish LED street lighting
        frame = np.clip(f * 255, 0, 255).astype(np.uint8)
    frame = np.clip(frame + rng.normal(0, spec.noise, frame.shape), 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, spec.jpeg])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def make_clip(spec: ClipSpec, out: Path) -> None:
    rng = np.random.default_rng(spec.seed)
    vehicle = compose_vehicle(spec, rng)
    bg = road_background(rng)
    n = int(spec.seconds * FPS)
    vw = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    for i in range(n):
        t = i / max(1, n - 1)
        scale = 0.42 + 0.58 * t
        v = cv2.resize(vehicle, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        vh, vw_ = v.shape[:2]
        cx = int(W * (0.47 + 0.06 * np.sin(t * 2.0)))
        cy = int(H * 0.30 + (H * 0.62 - H * 0.30) * t)
        x0, y0 = cx - vw_ // 2, cy - vh // 2
        frame = bg.copy()
        xa, ya = max(0, x0), max(0, y0)
        xb, yb = min(W, x0 + vw_), min(H, y0 + vh)
        frame[ya:yb, xa:xb] = v[ya - y0: yb - y0, xa - x0: xb - x0]
        vw.write(degrade(frame, spec, rng))
    vw.release()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=TEST_CLIPS_DIR)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    reg_plates = {r.plate for r in load_registry()}
    labels = []
    for spec in SPECS:
        if spec.registry_id is None:
            assert spec.plate not in reg_plates, f"{spec.plate} must not be in the registry"
        else:
            assert spec.plate in reg_plates, f"{spec.plate} missing from the registry"
        out = args.out / spec.name
        make_clip(spec, out)
        labels.append({
            "clip": spec.name, "plate": spec.plate, "registry_id": spec.registry_id, "color": spec.color,
            "body_type": spec.body_type, "expected_status": spec.expected, "night": spec.night,
            "occluded_positions": [k + 1 for k in spec.occlude], "note": spec.note,
        })
        print(f"wrote {out}")
    pairs = [{"clip_a": "night_partial_white.mp4", "clip_b": "camB_white.mp4", "registry_id": "REG-0001"}]
    (args.out / "labels.json").write_text(json.dumps({"clips": labels, "crosscam_pairs": pairs}, indent=2))
    print(f"wrote {args.out / 'labels.json'}")


if __name__ == "__main__":
    main()
