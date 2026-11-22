"""Download every model PRISM needs ahead of time (so the demo works offline).

  python scripts/download_weights.py            # YOLO11s/n, fast-alpr detector + OCR, PARSeq, OpenCLIP
  python scripts/download_weights.py --with-sr  # also the optional 1.97 GB super-resolution checkpoint

Every model is optional except the plate detector; anything that fails is reported, not fatal.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from prism.config import WEIGHTS_DIR, PrismConfig  # noqa: E402

SR_URL = "https://github.com/valfride/lpsr-lacd/releases/download/pre_trained_model_SR/best_model_cgnetV2_deformable_Epoch_82.pth"


def step(name, fn):
    try:
        fn()
        print(f"[ok]   {name}")
    except Exception as exc:
        print(f"[fail] {name}: {exc}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-sr", action="store_true")
    args = ap.parse_args()
    cfg = PrismConfig()
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)

    def yolo(name):
        def f():
            from ultralytics import YOLO

            target = WEIGHTS_DIR / name
            if not target.exists():
                m = YOLO(name)
                src = Path(m.ckpt_path)
                shutil.move(str(src), target) if src.resolve() != target.resolve() else None
        return f

    step("YOLO11s", yolo(cfg.track.model_gpu))
    step("YOLO11n", yolo(cfg.track.model_cpu))

    def plate():
        from prism.stages.plate_detect import PlateDetector

        PlateDetector(cfg.plate)

    step("fast-alpr plate detector", plate)

    def fpo():
        from prism.stages.ocr import FastPlateOCR

        FastPlateOCR(cfg.ocr.fast_plate_ocr_model)

    step("fast-plate-ocr", fpo)

    def parseq():
        from prism.stages.ocr import ParseqOCR

        ParseqOCR(cfg.ocr.parseq_variant)

    step("PARSeq", parseq)

    def clip():
        from prism.stages.attributes import AttributeExtractor

        ax = AttributeExtractor(cfg.attributes)
        import numpy as np

        ax.classify([np.zeros((64, 64, 3), np.uint8)], "car")  # builds the text-embedding cache

    step("OpenCLIP ViT-B-32 + prompt cache", clip)

    if args.with_sr:
        def sr():
            dst = WEIGHTS_DIR / cfg.super_res.weights_file
            if not dst.exists():
                tmp = dst.with_suffix(".part")
                urllib.request.urlretrieve(SR_URL, tmp)
                tmp.rename(dst)

        step("lpsr-lacd super-resolution (visual aid)", sr)


if __name__ == "__main__":
    main()
