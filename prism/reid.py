"""Bonus B2: cross-camera tracking.

Two tracks from different clips are the same vehicle only when ALL hold:
  1. cosine similarity of their appearance embeddings >= the encoder's own threshold
     (0.82 for the default CLIP encoder; scores are not comparable across encoders),
  2. plate compatibility: no known position conflicts, apart from known OCR mix-ups,
  3. matching body type.
Appearance alone can never link two tracks. An optional time check flags pairs that would
need an impossible city speed (> 120 km/h). Linked tracks' plate reads are fused together,
which can fill positions one camera could not read.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Optional, Sequence

import numpy as np

from prism.config import MatchConfig, ReIDConfig
from prism.fusion import align
from prism.plate_grammar import UNKNOWN
from prism.runtime import vendor_on_path, vendor_path
from prism.schemas import AttributeValue

log = logging.getLogger("prism.reid")


class BaseReIDEncoder(ABC):
    name: str = "base"
    key: str = "clip"

    @abstractmethod
    def encode(self, crops: list[np.ndarray]) -> np.ndarray:
        """Return one L2-normalized embedding for a track (averaged over its crops)."""


def _avg_norm(rows: np.ndarray) -> np.ndarray:
    v = np.asarray(rows, dtype=np.float32).reshape(len(rows), -1).mean(0)
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


class ClipReIDEncoder(BaseReIDEncoder):
    """512-d OpenCLIP ViT-B-32 image embedding averaged over the track's sharpest crops."""

    key = "clip"

    def __init__(self, attribute_extractor):
        self.ax = attribute_extractor
        self.name = f"ClipReIDEncoder ({attribute_extractor.name})"

    def encode(self, crops: list[np.ndarray]) -> np.ndarray:
        if not crops:
            return np.zeros(512, dtype=np.float32)
        return _avg_norm(self.ax.encode_images(crops).cpu().numpy())


class VendorReIDEncoder(BaseReIDEncoder):
    """OSNet (torchreid) or ImageNet ResNet-50 feature extractor from vendor/vehicle-reidentification."""

    def __init__(self, kind: str = "osnet", device: str = "cpu"):
        if kind not in ("osnet", "resnet"):
            raise ValueError(kind)
        self.key = kind
        repo = vendor_path("vehicle-reidentification")
        if not repo.exists():
            raise RuntimeError("vendor/vehicle-reidentification not present")
        with vendor_on_path("vehicle-reidentification"):
            import feature_extraction as fe  # vendor module (read-only)

        self._fe = fe
        if kind == "osnet":
            from torchreid.utils import FeatureExtractor  # optional dependency

            weights = repo / "models" / "osnet_x1_0_imagenet.pth"
            self._model = FeatureExtractor(model_name="osnet_x1_0", model_path=str(weights), device=device)
            self._fn = lambda img: fe.extract_torchreid_features(self._model, img[:, :, ::-1].copy())
        else:
            from torchvision import models

            m = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V1)
            m.fc = __import__("torch").nn.Identity()
            self._model = m.eval()
            self._fn = lambda img: fe.extract_dnn_features(self._model, img[:, :, ::-1].copy())
        self.name = f"VendorReIDEncoder ({kind}, vendor/vehicle-reidentification)"

    def encode(self, crops: list[np.ndarray]) -> np.ndarray:
        rows = []
        for c in crops:
            f = self._fn(c)
            f = f.detach().cpu().numpy() if hasattr(f, "detach") else np.asarray(f)
            f = f.reshape(-1).astype(np.float32)
            n = float(np.linalg.norm(f))
            rows.append(f / n if n > 0 else f)
        return _avg_norm(np.stack(rows)) if rows else np.zeros(512, dtype=np.float32)


def make_encoder(cfg: ReIDConfig, attribute_extractor, device: str) -> tuple[BaseReIDEncoder, list[str]]:
    warnings: list[str] = []
    if cfg.encoder in ("osnet", "resnet"):
        try:
            return VendorReIDEncoder(cfg.encoder, device), warnings
        except Exception as exc:
            msg = f"Re-ID encoder '{cfg.encoder}' unavailable ({exc}); falling back to ClipReIDEncoder"
            log.warning(msg)
            warnings.append(msg)
    return ClipReIDEncoder(attribute_extractor), warnings


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    return float(np.dot(a, b) / (na * nb)) if na > 0 and nb > 0 else 0.0


def plate_agreement(pa: str, pb: str, mcfg: MatchConfig) -> tuple[bool, int, str]:
    """(compatible, agreeing known positions, note)."""
    ok, note = plate_compatible(pa, pb, mcfg)
    agree = 0
    if pa and pb:
        ref, rd = (pa, pb) if len(pa) >= len(pb) else (pb, pa)
        for k, i in enumerate(align(list(rd), list(ref))):
            if i is not None and ref[k] != UNKNOWN and ref[k] == rd[i]:
                agree += 1
    return ok, agree, note


def plate_compatible(pa: str, pb: str, mcfg: MatchConfig) -> tuple[bool, str]:
    """No known-vs-known conflict after alignment, except known OCR mix-ups."""
    if not pa or not pb:
        return True, "one or both plates unread; no conflict possible"
    ref, rd = (pa, pb) if len(pa) >= len(pb) else (pb, pa)
    mapping = align(list(rd), list(ref))
    confus = {frozenset(p) for p in mcfg.confusable_pairs}
    conflicts, mixups, agree = [], [], 0
    for k, i in enumerate(mapping):
        if i is None:
            continue
        a, b = ref[k], rd[i]
        if a == UNKNOWN or b == UNKNOWN:
            continue
        if a == b:
            agree += 1
        elif frozenset((a, b)) in confus:
            mixups.append(f"position {k + 1} {a}/{b}")
        else:
            conflicts.append(f"position {k + 1} {a} vs {b}")
    if conflicts:
        return False, "plate conflict: " + ", ".join(conflicts)
    note = f"{agree} known positions agree"
    if mixups:
        note += "; OCR mix-ups tolerated at " + ", ".join(mixups)
    return True, note


def body_compatible(a: AttributeValue, b: AttributeValue) -> bool:
    """Same body type. If either side is uncertain, the other's value must be in its top 2."""
    if not a.uncertain and not b.uncertain:
        return a.value == b.value
    if a.uncertain and b.uncertain:
        return bool({l for l, _ in a.top2} & {l for l, _ in b.top2})
    sure, unsure = (a, b) if not a.uncertain else (b, a)
    return sure.value in {l for l, _ in unsure.top2}


def implied_speed_kmh(distance_km: Optional[float], gap_s: Optional[float]) -> Optional[float]:
    if distance_km is None or gap_s is None or gap_s <= 0:
        return None
    return distance_km / (gap_s / 3600.0)


def link_tracks(
    emb_a: dict[int, np.ndarray],
    emb_b: dict[int, np.ndarray],
    plates_a: dict[int, str],
    plates_b: dict[int, str],
    body_a: dict[int, AttributeValue],
    body_b: dict[int, AttributeValue],
    threshold: float,
    mcfg: MatchConfig,
    min_agree: int = 3,
) -> list[dict]:
    """Score every A x B pair, then pick a greedy one-to-one assignment by similarity."""
    pairs = []
    for ta, ea in emb_a.items():
        for tb, eb in emb_b.items():
            sim = cosine(ea, eb)
            ok_plate, agree, note = plate_agreement(plates_a.get(ta, ""), plates_b.get(tb, ""), mcfg)
            if ok_plate and agree < min_agree:
                ok_plate = False
                note = (f"only {agree} known plate position(s) agree; at least {min_agree} are needed, because "
                        "appearance alone never links two tracks")
            ok_body = body_compatible(body_a[ta], body_b[tb])
            pairs.append(
                {"track_a": ta, "track_b": tb, "similarity": round(sim, 4), "plate_compatible": ok_plate,
                 "plate_note": note, "body_match": ok_body,
                 "same_vehicle": sim >= threshold and ok_plate and ok_body}
            )
    pairs.sort(key=lambda p: (-int(p["same_vehicle"]), -p["similarity"], p["track_a"], p["track_b"]))
    used_a, used_b, out = set(), set(), []
    for p in pairs:
        if p["track_a"] in used_a or p["track_b"] in used_b:
            continue
        used_a.add(p["track_a"])
        used_b.add(p["track_b"])
        out.append(p)
    return out
