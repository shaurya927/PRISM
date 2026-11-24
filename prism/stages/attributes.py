"""Stage 4: vehicle colour, body type and make/model with OpenCLIP (ViT-B-32, laion2b_s34b_b79k).

* Input: the 3 sharpest vehicle crops of a track; per-crop probabilities are averaged so one
  frame's glare or shadow has less effect. Colour is read from a bilateral-filtered copy of each
  crop (sensor noise and JPEG blocks made CLIP call white cars grey or silver).
* Each label is a prompt ensemble (several phrasings, embeddings averaged); text embeddings
  are computed once and cached in memory and on disk.
* Body type combines the YOLO class with CLIP. CLIP may override YOLO for auto-rickshaws,
  which COCO has no class for.
* Top probability < 0.40 -> reported as `uncertain` with its two most likely values; uncertain
  attributes add nothing to the score.
* Make/model is predicted only among models that fit the detected body type.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from typing import Optional, Sequence

import cv2
import numpy as np

from prism.config import (BODY_TYPES, COLORS, EXTRA_CLIP_MODELS, REGISTRY_FIELD_MODELS, VEHICLE_MODELS,
                          WEIGHTS_DIR, AttributeConfig)
from prism.schemas import Attributes, AttributeValue

log = logging.getLogger("prism.attributes")

COLOR_TEMPLATES = (
    "a CCTV photo of a {} car.",
    "a {} vehicle at night.",
    "a {} vehicle on a road.",
    "a photo of a {} colored vehicle.",
    "a surveillance camera image of a {} vehicle.",
)

# Sub-labels -> body category. "car" comes from the hatchback and sedan prompts.
BODY_PROMPTS: dict[str, tuple[str, tuple[str, ...]]] = {
    "hatchback": ("car", ("a photo of a hatchback car.", "a CCTV photo of a small hatchback.",
                          "a small passenger car on an Indian road.")),
    "sedan": ("car", ("a photo of a sedan car.", "a CCTV photo of a saloon car.", "a four-door sedan on a road.")),
    "SUV": ("SUV", ("a photo of an SUV.", "a CCTV photo of a sport utility vehicle.", "a photo of an MPV people carrier.")),
    "two-wheeler": ("two-wheeler", ("a photo of a motorcycle.", "a photo of a scooter.",
                                    "a CCTV photo of a person riding a two-wheeler.")),
    "auto-rickshaw": ("auto-rickshaw", ("a photo of an auto-rickshaw.", "a photo of an Indian three-wheeler tuk-tuk.",
                                        "a CCTV photo of an autorickshaw.")),
    "truck": ("truck", ("a photo of a truck.", "a photo of a lorry.", "a CCTV photo of a goods carrier truck.")),
    "bus": ("bus", ("a photo of a bus.", "a CCTV photo of a city bus.", "a photo of a passenger bus.")),
}

MAKE_MODEL_TEMPLATES = ("a photo of a {}.", "a {} on an Indian road.", "a CCTV photo of a {}.")

YOLO_TO_BODY: dict[str, tuple[str, ...]] = {
    "car": ("car", "SUV"),
    "motorcycle": ("two-wheeler",),
    "bus": ("bus",),
    "truck": ("truck",),
}
CLIP_WEIGHT, YOLO_WEIGHT = 0.6, 0.4


def denoise_for_color(crop: np.ndarray, cfg: AttributeConfig) -> np.ndarray:
    """Edge-preserving bilateral filter for the colour step. It smooths sensor noise and JPEG blocks
    inside flat paint areas; it adds no colour that was not in the crop."""
    return cv2.bilateralFilter(crop, cfg.color_denoise_d, cfg.color_denoise_sigma_color, cfg.color_denoise_sigma_space)


def make_model_label(make: str, model: str) -> str:
    return model if model.lower().startswith(make.lower()) else f"{make} {model}"


class AttributeExtractor:
    def __init__(self, cfg: AttributeConfig, device: str = "cpu"):
        import open_clip
        import torch

        self.torch = torch
        self.cfg = cfg
        self.device = device
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            cfg.clip_model, pretrained=cfg.clip_pretrained, device=device
        )
        self.model.eval()
        self.tokenizer = open_clip.get_tokenizer(cfg.clip_model)
        self.name = f"OpenCLIP {cfg.clip_model} ({cfg.clip_pretrained})"
        self._cache: dict[str, "torch.Tensor"] = {}
        self._lock = threading.Lock()
        self._disk = WEIGHTS_DIR / "clip_text_cache"
        self._disk.mkdir(parents=True, exist_ok=True)
        # Banks
        self.colors = list(COLORS)
        self.color_prompts = [[t.format(c) for t in COLOR_TEMPLATES] for c in self.colors]
        self.body_sub = list(BODY_PROMPTS)
        self.body_prompts = [list(BODY_PROMPTS[k][1]) for k in self.body_sub]
        # Registry models plus common makes that are not in the registry, so an unlisted car
        # (e.g. a Volvo) is not forced onto the closest registry model.
        bank = list(VEHICLE_MODELS) + [m for m in EXTRA_CLIP_MODELS if m not in VEHICLE_MODELS]
        self.mm = [(make_model_label(mk, md), body) for mk, md, body, _ in bank]
        self.mm_labels = [f"{mk} {md}" for mk, md, _, _ in bank]
        self.mm_in_registry = [i < len(VEHICLE_MODELS) or (m[0], m[1]) in REGISTRY_FIELD_MODELS
                               for i, m in enumerate(bank)]
        self.mm_prompts = [[t.format(lbl) for t in MAKE_MODEL_TEMPLATES] for lbl, _ in self.mm]

    # ------------------------------------------------------------------ embeddings
    def _text_bank(self, key: str, prompts: list[list[str]]):
        torch = self.torch
        digest = hashlib.sha256(json.dumps([self.cfg.clip_model, self.cfg.clip_pretrained, prompts]).encode()).hexdigest()[:16]
        with self._lock:
            if digest in self._cache:
                return self._cache[digest]
            path = self._disk / f"{key}_{digest}.pt"
            if path.exists():
                bank = torch.load(str(path), map_location=self.device)
            else:
                rows = []
                with torch.inference_mode():
                    for group in prompts:
                        e = self.model.encode_text(self.tokenizer(group).to(self.device)).float()
                        e = e / e.norm(dim=-1, keepdim=True)
                        m = e.mean(0)
                        rows.append(m / m.norm())
                bank = torch.stack(rows)
                torch.save(bank.cpu(), str(path))
                bank = bank.to(self.device)
            self._cache[digest] = bank
            return bank

    def encode_images(self, crops: Sequence[np.ndarray]):
        """L2-normalised image embeddings, one row per crop (BGR input)."""
        from PIL import Image

        torch = self.torch
        ims = [self.preprocess(Image.fromarray(cv2.cvtColor(c, cv2.COLOR_BGR2RGB))) for c in crops]
        with torch.inference_mode():
            f = self.model.encode_image(torch.stack(ims).to(self.device)).float()
        return f / f.norm(dim=-1, keepdim=True)

    def _probs(self, feats, bank) -> np.ndarray:
        logits = self.cfg.logit_scale * feats @ bank.T
        return logits.softmax(-1).mean(0).cpu().numpy()

    # ------------------------------------------------------------------ classification
    def _value(self, labels: Sequence[str], probs: np.ndarray, source: str) -> AttributeValue:
        order = np.argsort(-probs)
        top = [(labels[i], round(float(probs[i]), 4)) for i in order[:2]]
        best, p = top[0]
        if p < self.cfg.uncertain_below:
            return AttributeValue(value="uncertain", confidence=round(p, 4), uncertain=True, top2=top, source=source)
        return AttributeValue(value=best, confidence=round(p, 4), uncertain=False, top2=top, source=source)

    def classify(self, crops: Sequence[np.ndarray], yolo_class: Optional[str]) -> Attributes:
        crops = [c for c in crops if c is not None and c.size][: self.cfg.n_crops]
        if not crops:
            unk = AttributeValue(value="uncertain", confidence=0.0, uncertain=True, top2=[])
            return Attributes(color=unk, body_type=unk.model_copy(), make_model=None, yolo_class=yolo_class)
        feats = self.encode_images(crops)
        color_feats, color_src = feats, "clip"
        if self.cfg.color_denoise_d > 0:
            color_feats = self.encode_images([denoise_for_color(c, self.cfg) for c in crops])
            color_src = "clip (denoised crop)"
        color = self._value(self.colors, self._probs(color_feats, self._text_bank("color", self.color_prompts)), color_src)

        sub = self._probs(feats, self._text_bank("body", self.body_prompts))
        clip_body = np.zeros(len(BODY_TYPES))
        for p, key in zip(sub, self.body_sub):
            clip_body[BODY_TYPES.index(BODY_PROMPTS[key][0])] += p
        prior = np.zeros(len(BODY_TYPES))
        mapped = YOLO_TO_BODY.get(yolo_class or "", ())
        for b in mapped:
            prior[BODY_TYPES.index(b)] = 1.0 / len(mapped)
        ar = BODY_TYPES.index("auto-rickshaw")
        if int(np.argmax(clip_body)) == ar and clip_body[ar] >= self.cfg.uncertain_below:
            body = self._value(BODY_TYPES, clip_body, "clip override (COCO has no auto-rickshaw class)")
        elif mapped:
            body = self._value(BODY_TYPES, CLIP_WEIGHT * clip_body + YOLO_WEIGHT * prior, f"clip+yolo({yolo_class})")
        else:
            body = self._value(BODY_TYPES, clip_body, "clip")

        mm_probs = self._probs(feats, self._text_bank("make_model", self.mm_prompts))
        if not body.uncertain:
            # Only models that fit the body type; probabilities are NOT renormalised, so the
            # confidence stays an honest share of all 30 models.
            mask = np.array([1.0 if b == body.value else 0.0 for _, b in self.mm])
            if mask.sum() > 0:
                mm_probs = mm_probs * mask
        make_model = self._value(self.mm_labels, mm_probs, "clip (body-type constrained)")
        if not make_model.uncertain and not self.mm_in_registry[self.mm_labels.index(make_model.value)]:
            make_model.source = "clip (body-type constrained); not a registry model, adds nothing to the score"
        return Attributes(color=color, body_type=body, make_model=make_model, yolo_class=yolo_class)
