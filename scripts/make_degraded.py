"""Make 6 harder versions of every test clip for the evaluation.

Versions: gaussian blur, motion blur, 2x downscale, 4x downscale, JPEG quality 20, sensor noise + darkening.
Output: data/test_clips/degraded/<clip>__<kind>.mp4 plus degraded/labels.json (ground truth copied).

Usage:  python scripts/make_degraded.py [--src data/test_clips] [--only gauss,jpeg20] [--skip-existing]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from prism.config import SEED, TEST_CLIPS_DIR  # noqa: E402


def gauss(f: np.ndarray, rng) -> np.ndarray:
    return cv2.GaussianBlur(f, (0, 0), 2.2)


def motion(f: np.ndarray, rng) -> np.ndarray:
    k = 11
    kern = np.zeros((k, k), np.float32)
    kern[k // 2, :] = 1.0 / k
    return cv2.filter2D(f, -1, kern)


def down(factor: int) -> Callable:
    def fn(f: np.ndarray, rng) -> np.ndarray:
        h, w = f.shape[:2]
        return cv2.resize(f, (w // factor, h // factor), interpolation=cv2.INTER_AREA)

    return fn


def jpeg20(f: np.ndarray, rng) -> np.ndarray:
    ok, buf = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 20])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def noise_dark(f: np.ndarray, rng) -> np.ndarray:
    x = f.astype(np.float32) * 0.45
    x += rng.normal(0, 12, f.shape)
    return np.clip(x, 0, 255).astype(np.uint8)


KINDS: dict[str, Callable] = {
    "gauss": gauss, "motion": motion, "down2x": down(2), "down4x": down(4), "jpeg20": jpeg20, "noise_dark": noise_dark,
}
# The original six clips, in the sorted order that set their noise seeds.
LEGACY_ORDER = ["camB_white.mp4", "day_black_suv.mp4", "day_blue_twoline.mp4", "day_clear_white.mp4",
                "night_partial_white.mp4", "unregistered_white.mp4"]


def degrade_clip(src: Path, dst: Path, fn: Callable, seed: int) -> None:
    rng = np.random.default_rng(seed)
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    writer = None
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        out = fn(frame, rng)
        if writer is None:
            writer = cv2.VideoWriter(str(dst), cv2.VideoWriter_fourcc(*"mp4v"), fps, (out.shape[1], out.shape[0]))
        writer.write(out)
    cap.release()
    if writer is not None:
        writer.release()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=TEST_CLIPS_DIR)
    ap.add_argument("--skip-existing", action="store_true", help="keep degraded clips that already exist")
    ap.add_argument("--only", default=",".join(KINDS))
    args = ap.parse_args()
    out_dir = args.src / "degraded"
    out_dir.mkdir(parents=True, exist_ok=True)
    labels_path = args.src / "labels.json"
    labels = json.loads(labels_path.read_text())["clips"] if labels_path.exists() else []
    by_clip = {l["clip"]: l for l in labels}
    new_labels = []
    kinds = [k for k in args.only.split(",") if k in KINDS]
    clips = sorted(args.src.glob("*.mp4"))
    # Seed index per clip: the first six clips keep the indices they had (sorted order at the time), so
    # adding clips never changes the degraded versions of existing ones.
    order = LEGACY_ORDER + sorted(c.name for c in clips if c.name not in LEGACY_ORDER)
    for clip in clips:
        i = order.index(clip.name)
        for j, kind in enumerate(kinds):
            dst = out_dir / f"{clip.stem}__{kind}.mp4"
            if not (args.skip_existing and dst.exists()):
                degrade_clip(clip, dst, KINDS[kind], SEED + 100 * i + j)
                print(f"wrote {dst}")
            if clip.name in by_clip:
                lab = dict(by_clip[clip.name])
                lab.update(clip=dst.name, source_clip=clip.name, degradation=kind)
                new_labels.append(lab)
    (out_dir / "labels.json").write_text(json.dumps({"clips": new_labels, "crosscam_pairs": []}, indent=2))


if __name__ == "__main__":
    main()
