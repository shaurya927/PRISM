"""Stage 3: plate OCR behind one interface.

Both backends return RAW output only: (raw_text, one confidence per character in raw_text).
Neither applies a threshold; every read goes through prism.masking.mask_read.

`read_plate_crop` is the single entry point used by the pipeline. It only accepts a
`PlateCrop` tagged source="raw" or "clahe", so super-resolution output (an `SRImage`
or a *_sr.png path) can never reach `BasePlateOCR.read`.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Optional

import cv2
import numpy as np

from prism.config import OCRConfig, PlateConfig
from prism.runtime import import_vendor_first, vendor_on_path
from prism.stages.plate_detect import PlateCrop, split_two_line

log = logging.getLogger("prism.ocr")

ALLOWED_SOURCES = ("raw", "clahe")
TOP_K = 8  # candidate characters kept per position (PARSeq's charset has 94)
_ALNUM = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")


class SuperResolutionLeakError(RuntimeError):
    """Raised if anything other than a raw/CLAHE plate crop is sent to OCR."""


class OCRUnavailable(RuntimeError):
    pass


CharDist = Optional[dict[str, float]]  # model probability of each candidate character at one position


class BasePlateOCR(ABC):
    name: str = "base"

    @abstractmethod
    def read(self, plate_crop: np.ndarray) -> tuple[str, list[float]]:
        """Return (raw_text, char_confidences), one confidence per character in raw_text."""

    def read_dist(self, plate_crop: np.ndarray) -> tuple[str, list[float], list[CharDist]]:
        """Like read(), plus the model's probability for the top candidate characters at each position.

        Backends that cannot expose the full distribution return None per position; layout-
        constrained decoding (prism.layout_decode) is then simply not applied to their reads."""
        text, confs = self.read(plate_crop)
        return text, confs, [None] * len(text)


# --------------------------------------------------------------------------- PARSeq
class ParseqOCR(BasePlateOCR):
    """PARSeq (Bautista & Atienza, ECCV 2022) from vendor/parseq, or torch.hub as fallback."""

    def __init__(self, variant: str = "parseq", device: str = "cpu"):
        import torch

        self.torch = torch
        self.device = device
        model = None
        origin = None
        err: Optional[Exception] = None
        with vendor_on_path("parseq") as p:
            if p is not None:
                try:
                    from strhub.models.utils import create_model

                    model = create_model(variant.replace("_", "-"), pretrained=True)
                    origin = "vendor/parseq"
                except Exception as exc:  # missing deps or weights download failure
                    err = exc
                    log.warning("vendor/parseq load failed (%s); trying torch.hub", exc)
        if model is None:
            try:
                model = torch.hub.load("baudm/parseq", variant, pretrained=True, trust_repo=True)
                origin = "torch.hub baudm/parseq"
            except Exception as exc:
                raise OCRUnavailable(f"PARSeq unavailable: vendor ({err}); torch.hub ({exc})") from exc
        self.model = model.eval().to(device)
        hp = getattr(self.model, "hparams", None)
        size = None
        if hp is not None:
            size = hp.get("img_size") if hasattr(hp, "get") else getattr(hp, "img_size", None)
        self.img_size = tuple(size) if size else (32, 128)  # (H, W)
        self.tokenizer = self.model.tokenizer
        self.name = f"parseq:{variant}"
        self.origin = origin

    def _prep(self, img: np.ndarray):
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB) if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
        h, w = self.img_size
        rgb = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_CUBIC)
        x = self.torch.from_numpy(rgb).float().div(255.0).permute(2, 0, 1)
        x = (x - 0.5) / 0.5  # same normalisation as SceneTextDataModule.get_transform
        return x.unsqueeze(0).to(self.device)

    def _forward(self, plate_crop: np.ndarray):
        with self.torch.inference_mode():
            logits = self.model(self._prep(plate_crop))
            probs = logits.softmax(-1)
            labels, confs = self.tokenizer.decode(probs)
        text = labels[0]
        c = confs[0].detach().float().cpu().tolist()
        # decode() appends the EOS probability when EOS was emitted; drop it so there is
        # exactly one confidence per character.
        return text, [float(v) for v in c[: len(text)]], probs

    def read(self, plate_crop: np.ndarray) -> tuple[str, list[float]]:
        text, confs, _ = self._forward(plate_crop)
        return text, confs

    def read_dist(self, plate_crop: np.ndarray) -> tuple[str, list[float], list[CharDist]]:
        """PARSeq's softmax over its charset at every decoded position, folded to upper-case A-Z/0-9."""
        text, confs, probs = self._forward(plate_crop)
        itos = getattr(self.tokenizer, "_itos", None)
        if itos is None:
            return text, confs, [None] * len(text)
        k = min(TOP_K, probs.shape[-1])
        dists: list[CharDist] = []
        top_p, top_i = probs[0, : len(text)].float().topk(k, dim=-1)
        for ps, ids in zip(top_p.cpu().tolist(), top_i.cpu().tolist()):
            d: dict[str, float] = {}
            for p, i in zip(ps, ids):
                tok = itos[i] if 0 <= i < len(itos) else ""
                if len(tok) == 1 and tok.upper() in _ALNUM:
                    u = tok.upper()
                    d[u] = d.get(u, 0.0) + float(p)  # 'b' and 'B' are one plate character
            dists.append({c: round(p, 5) for c, p in d.items()})
        return text, confs, dists


# --------------------------------------------------------------------------- fast-plate-ocr
class FastPlateOCR(BasePlateOCR):
    """fast-plate-ocr (installed by fast-alpr) via vendor/fast-alpr's DefaultOCR."""

    def __init__(self, model_name: str = "cct-s-v2-global-model", device: str = "cpu"):
        try:
            mod, origin = import_vendor_first("fast_alpr.default_ocr", "fast-alpr")
            # "auto" lets ONNX Runtime use CUDA only if onnxruntime-gpu is installed.
            wrapper = mod.DefaultOCR(hub_ocr_model=model_name, device="auto" if device == "cuda" else "cpu")
            self._rec = wrapper.ocr_model
        except Exception as exc:
            raise OCRUnavailable(f"fast-plate-ocr unavailable: {exc}") from exc
        self.pad = self._rec.config.pad_char
        self.color_mode = self._rec.config.image_color_mode
        self.name = f"fast_plate_ocr:{model_name}"
        self.origin = origin

    def read(self, plate_crop: np.ndarray) -> tuple[str, list[float]]:
        img = plate_crop
        if self.color_mode == "grayscale" and img.ndim == 3:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        elif self.color_mode == "rgb" and img.ndim == 3:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        pred = self._rec.run_one(img, return_confidence=True, remove_pad_char=False)
        slots = pred.plate
        probs = [] if pred.char_probs is None else [float(p) for p in np.asarray(pred.char_probs).tolist()]
        text, confs = [], []
        for ch, p in zip(slots, probs):
            if ch == self.pad:  # padding slot, not a character
                continue
            text.append(ch)
            confs.append(p)
        return "".join(text), confs


# --------------------------------------------------------------------------- factory + gate
def make_ocr(cfg: OCRConfig, device: str) -> tuple[BasePlateOCR, list[str]]:
    """Build the configured backend, falling back to the other one with a warning."""
    warnings: list[str] = []
    order = ["parseq", "fast_plate_ocr"] if cfg.backend == "parseq" else ["fast_plate_ocr", "parseq"]
    last: Optional[Exception] = None
    for b in order:
        try:
            ocr = ParseqOCR(cfg.parseq_variant, device) if b == "parseq" else FastPlateOCR(cfg.fast_plate_ocr_model, device)
            if b != cfg.backend:
                warnings.append(f"OCR backend '{cfg.backend}' unavailable ({last}); using '{ocr.name}' instead")
            return ocr, warnings
        except Exception as exc:
            last = exc
            log.warning("OCR backend %s failed: %s", b, exc)
    raise OCRUnavailable(f"No OCR backend could be loaded: {last}")


def _check_source(crop: PlateCrop) -> None:
    if not isinstance(crop, PlateCrop):
        raise SuperResolutionLeakError(
            f"OCR accepts only PlateCrop(source='raw'|'clahe'); got {type(crop).__name__}"
        )
    if crop.source not in ALLOWED_SOURCES:
        raise SuperResolutionLeakError(f"OCR refused a crop with source={crop.source!r}")
    if crop.path and str(crop.path).lower().endswith("_sr.png"):
        raise SuperResolutionLeakError(f"OCR refused a super-resolution artifact: {crop.path}")


def read_plate_crop(ocr: BasePlateOCR, crop: PlateCrop, two_line: bool, plate_cfg: PlateConfig) -> tuple[str, list[float], bool]:
    """Read one tagged crop. Two-line plates are read row by row (top first) and joined.

    Returns (raw_text, confidences, was_split). If splitting fails, the whole crop is read;
    masking still applies, so a bad split only produces more '?'.
    """
    text, confs, _, split = read_plate_crop_dist(ocr, crop, two_line, plate_cfg)
    return text, confs, split


def read_plate_crop_dist(ocr: BasePlateOCR, crop: PlateCrop, two_line: bool,
                         plate_cfg: PlateConfig) -> tuple[str, list[float], list[CharDist], bool]:
    """read_plate_crop plus the per-position character distributions (None where unavailable).

    Goes through the same source gate: super-resolution output is refused here too."""
    _check_source(crop)
    if two_line:
        rows = split_two_line(crop.image, plate_cfg)
        if rows is not None:
            parts = [ocr.read_dist(r) for r in rows]
            text = "".join(t for t, _, _ in parts)
            confs = [c for _, cs, _ in parts for c in cs]
            dists = [d for _, _, ds in parts for d in ds]
            if text:
                return text, confs, dists, True
    text, confs, dists = ocr.read_dist(crop.image)
    return text, confs, dists, False
