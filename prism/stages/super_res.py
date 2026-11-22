"""Optional plate super-resolution. VISUAL AID ONLY, NEVER EVIDENCE.

Wraps `cgnetV2_deformable` from vendor/lpsr-lacd (Nascimento et al., SIBGRAPI 2024).
Pre-processing matches the repo's config: pad the low-res crop with grey (127,127,127) to a
3:1 width:height ratio, resize to 16x48 (HxW), RGB in [0,1]. Output is 2x upscaled.

Guardrail: outputs are `SRImage` objects (not `PlateCrop`) and are saved only as
`track{id}_f{frame}_sr.png` for the UI toggle "Visual aid only. Not used for identification."
They are never passed to OCR, fusion, matching, the advisor or the summary. The pipeline calls
this module only after Stage 3 has finished.

If the checkpoint is missing, the module logs a warning and disables itself.
"""

from __future__ import annotations

import importlib.util
import logging
import sys
import types
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from prism.config import WEIGHTS_DIR, SuperResConfig
from prism.runtime import vendor_path

log = logging.getLogger("prism.super_res")


@dataclass(frozen=True)
class SRImage:
    """Super-resolved image. Deliberately NOT a PlateCrop, so OCR rejects it."""

    image: np.ndarray
    source: str = "super_res"


def pad_to_ratio(img: np.ndarray, ratio: float, color: tuple[int, int, int]) -> np.ndarray:
    """Centre-pad to width/height == ratio (within the repo's +-0.15 tolerance)."""
    h, w = img.shape[:2]
    cur = w / h
    if abs(cur - ratio) <= 0.15:
        return img
    if cur < ratio:
        new_w = int(round(h * ratio))
        bw = (new_w - w) // 2
        return cv2.copyMakeBorder(img, 0, 0, bw, new_w - w - bw, cv2.BORDER_CONSTANT, value=color)
    new_h = int(round(w / ratio))
    bh = (new_h - h) // 2
    return cv2.copyMakeBorder(img, bh, new_h - h - bh, 0, 0, cv2.BORDER_CONSTANT, value=color)


def _load_arch(repo: Path):
    """Import only cgnet_deformable2d_arch.py from the vendor repo, without running
    vendor/lpsr-lacd/models/__init__.py (which imports TensorFlow OCR baselines)."""
    registry: dict = {}

    def register(name):
        def deco(fn):
            registry[name] = fn
            return fn

        return deco

    stub = types.ModuleType("models")
    stub.register = register  # type: ignore[attr-defined]
    saved = sys.modules.get("models")
    sys.modules["models"] = stub
    try:
        path = repo / "models" / "cgnet_deformable2d_arch.py"
        spec = importlib.util.spec_from_file_location("prism_vendor_lpsr_cgnet", path)
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(mod)
    finally:
        if saved is not None:
            sys.modules["models"] = saved
        else:
            sys.modules.pop("models", None)
    return registry["cgnetV2_deformable"]


class SuperResolver:
    def __init__(self, cfg: SuperResConfig, device: str = "cpu", weights: Optional[Path] = None):
        self.cfg = cfg
        self.device = device
        self.available = False
        self.reason = ""
        self.model = None
        if not cfg.enabled:
            self.reason = "disabled in config"
            return
        repo = vendor_path("lpsr-lacd")
        weights = Path(weights) if weights else WEIGHTS_DIR / cfg.weights_file
        if not repo.exists():
            self.reason = "vendor/lpsr-lacd not present"
        elif not weights.exists():
            self.reason = f"checkpoint not found at {weights}"
        elif device != "cuda":
            # vendor/lpsr-lacd builds a layer with .cuda() inside forward(), so it cannot run on CPU.
            self.reason = "needs a CUDA GPU (the vendor model calls .cuda() inside forward)"
        if self.reason:
            log.warning("Super-resolution not installed (%s); visual aid disabled", self.reason)
            return
        try:
            import torch

            build = _load_arch(repo)
            ck = torch.load(str(weights), map_location="cpu", weights_only=False)
            spec = ck.get("model", ck) if isinstance(ck, dict) else ck
            if isinstance(spec, dict) and "sd" in spec:
                args = spec.get("args", {"in_channels": 3, "out_channels": 3})
                sd = spec["sd"]
            else:
                args, sd = {"in_channels": 3, "out_channels": 3}, spec
            model = build(**args)
            model.load_state_dict(sd)
            self.model = model.eval().to(device)
            self.torch = torch
            self.available = True
            self.name = "lpsr-lacd cgnetV2_deformable"
        except Exception as exc:
            self.reason = f"failed to load: {exc}"
            log.warning("Super-resolution disabled: %s", exc)

    def upscale(self, plate_bgr: np.ndarray) -> Optional[SRImage]:
        if not self.available:
            return None
        img = pad_to_ratio(plate_bgr, self.cfg.aspect_ratio, tuple(self.cfg.pad_color))
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(rgb, (self.cfg.in_w, self.cfg.in_h), interpolation=cv2.INTER_CUBIC)
        x = self.torch.from_numpy(rgb).float().div(255.0).permute(2, 0, 1).unsqueeze(0).to(self.device)
        with self.torch.inference_mode():
            y = self.model(x)[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy()
        out = cv2.cvtColor((y * 255).round().astype(np.uint8), cv2.COLOR_RGB2BGR)
        return SRImage(out)


def sr_filename(track_id: int, frame_idx: int) -> str:
    return f"track{track_id}_f{frame_idx}_sr.png"


def write_sr_artifact(sr: SuperResolver, plate_bgr: np.ndarray, out_dir: Path, track_id: int,
                      frame_idx: int) -> Optional[Path]:
    """Upscale and save `track{id}_f{frame}_sr.png`. Returns the path, or None if disabled."""
    res = sr.upscale(plate_bgr)
    if res is None:
        return None
    out = Path(out_dir) / sr_filename(track_id, frame_idx)
    # Shown next to the raw crop at a readable size; nearest-neighbour keeps it honest.
    big = cv2.resize(res.image, (res.image.shape[1] * 3, res.image.shape[0] * 3), interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(out), big)
    return out
