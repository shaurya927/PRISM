"""Every PRISM threshold, weight, model name and path, in one place.

The config is a tree of frozen dataclasses. `config_dict()` gives the canonical
JSON form that is hashed into the chain of custody and printed in every report.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PRISM_VERSION = "1.0.0"
SEED = 42

ROOT = Path(__file__).resolve().parents[1]
VENDOR_DIR = ROOT / "vendor"
DATA_DIR = ROOT / "data"
# The bundled registry is 500 synthetic records. Point PRISM_REGISTRY_PATH at an authorised
# registry export (same JSON fields as data/registry.json) to match against real vehicles.
REGISTRY_PATH = Path(os.environ.get("PRISM_REGISTRY_PATH", DATA_DIR / "registry.json"))
TEST_CLIPS_DIR = DATA_DIR / "test_clips"
RUNS_DIR = Path(os.environ.get("PRISM_RUNS_DIR", ROOT / "runs"))
REPORTS_DIR = ROOT / "reports"
WEIGHTS_DIR = Path(os.environ.get("PRISM_WEIGHTS_DIR", ROOT / "weights"))
FRONTEND_DIST = ROOT / "frontend" / "dist"

# Valid Indian RTO state / union-territory codes (old and new).
STATE_CODES: tuple[str, ...] = (
    "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ", "HP", "HR",
    "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD", "OR",
    "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK", "UA", "UP", "WB",
)

COLORS: tuple[str, ...] = (
    "white", "black", "silver", "grey", "red", "blue", "green", "yellow", "brown", "orange",
)
BODY_TYPES: tuple[str, ...] = ("car", "SUV", "two-wheeler", "auto-rickshaw", "truck", "bus")

# 60+ common Indian makes/models: (make, model, body_type, body_style). Shared by the
# registry generator and the OpenCLIP make/model prompt bank (Bonus B1).
VEHICLE_MODELS: tuple[tuple[str, str, str, str], ...] = (
    # --- Cars: Hatchbacks ---
    ("Maruti Suzuki", "Swift", "car", "hatchback"),
    ("Maruti Suzuki", "Baleno", "car", "hatchback"),
    ("Maruti Suzuki", "Alto", "car", "hatchback"),
    ("Maruti Suzuki", "WagonR", "car", "hatchback"),
    ("Maruti Suzuki", "Celerio", "car", "hatchback"),
    ("Maruti Suzuki", "S-Presso", "car", "hatchback"),
    ("Hyundai", "i20", "car", "hatchback"),
    ("Hyundai", "i10 Grand", "car", "hatchback"),
    ("Tata", "Tiago", "car", "hatchback"),
    ("Tata", "Altroz", "car", "hatchback"),
    ("Renault", "Kwid", "car", "hatchback"),
    ("Citroen", "C3", "car", "hatchback"),
    # --- Cars: Sedans ---
    ("Maruti Suzuki", "Dzire", "car", "sedan"),
    ("Hyundai", "Verna", "car", "sedan"),
    ("Hyundai", "Aura", "car", "sedan"),
    ("Honda", "City", "car", "sedan"),
    ("Honda", "Amaze", "car", "sedan"),
    ("Tata", "Tigor", "car", "sedan"),
    ("Skoda", "Slavia", "car", "sedan"),
    ("Volkswagen", "Virtus", "car", "sedan"),
    ("Toyota", "Camry", "car", "sedan"),
    # --- SUVs ---
    ("Maruti Suzuki", "Ertiga", "SUV", "MPV"),
    ("Maruti Suzuki", "Brezza", "SUV", "compact SUV"),
    ("Maruti Suzuki", "Grand Vitara", "SUV", "SUV"),
    ("Maruti Suzuki", "Jimny", "SUV", "off-roader"),
    ("Maruti Suzuki", "Invicto", "SUV", "MPV"),
    ("Hyundai", "Creta", "SUV", "SUV"),
    ("Hyundai", "Venue", "SUV", "compact SUV"),
    ("Hyundai", "Tucson", "SUV", "SUV"),
    ("Hyundai", "Alcazar", "SUV", "SUV"),
    ("Tata", "Nexon", "SUV", "compact SUV"),
    ("Tata", "Punch", "SUV", "micro SUV"),
    ("Tata", "Harrier", "SUV", "SUV"),
    ("Tata", "Safari", "SUV", "SUV"),
    ("Mahindra", "Scorpio", "SUV", "SUV"),
    ("Mahindra", "Scorpio-N", "SUV", "SUV"),
    ("Mahindra", "Bolero", "SUV", "SUV"),
    ("Mahindra", "XUV700", "SUV", "SUV"),
    ("Mahindra", "XUV400", "SUV", "compact SUV"),
    ("Mahindra", "Thar", "SUV", "off-roader"),
    ("Mahindra", "XUV300", "SUV", "compact SUV"),
    ("Toyota", "Innova", "SUV", "MPV"),
    ("Toyota", "Innova Hycross", "SUV", "MPV"),
    ("Toyota", "Fortuner", "SUV", "SUV"),
    ("Toyota", "Urban Cruiser Hyryder", "SUV", "SUV"),
    ("Kia", "Seltos", "SUV", "SUV"),
    ("Kia", "Sonet", "SUV", "compact SUV"),
    ("Kia", "Carens", "SUV", "MPV"),
    ("MG", "Hector", "SUV", "SUV"),
    ("MG", "Astor", "SUV", "compact SUV"),
    ("Nissan", "Magnite", "SUV", "compact SUV"),
    ("Renault", "Kiger", "SUV", "compact SUV"),
    ("Skoda", "Kushaq", "SUV", "compact SUV"),
    ("Volkswagen", "Taigun", "SUV", "compact SUV"),
    ("Jeep", "Compass", "SUV", "SUV"),
    ("Citroen", "C3 Aircross", "SUV", "compact SUV"),
    # --- Two-Wheelers ---
    ("Honda", "Activa", "two-wheeler", "scooter"),
    ("Honda", "Shine", "two-wheeler", "motorcycle"),
    ("Honda", "Unicorn", "two-wheeler", "motorcycle"),
    ("Hero", "Splendor", "two-wheeler", "motorcycle"),
    ("Hero", "HF Deluxe", "two-wheeler", "motorcycle"),
    ("Hero", "Glamour", "two-wheeler", "motorcycle"),
    ("Hero", "Xtreme", "two-wheeler", "motorcycle"),
    ("Bajaj", "Pulsar", "two-wheeler", "motorcycle"),
    ("Bajaj", "Platina", "two-wheeler", "motorcycle"),
    ("Bajaj", "Dominar", "two-wheeler", "motorcycle"),
    ("Royal Enfield", "Classic 350", "two-wheeler", "motorcycle"),
    ("Royal Enfield", "Hunter 350", "two-wheeler", "motorcycle"),
    ("Royal Enfield", "Bullet 350", "two-wheeler", "motorcycle"),
    ("TVS", "Jupiter", "two-wheeler", "scooter"),
    ("TVS", "Apache", "two-wheeler", "motorcycle"),
    ("TVS", "Raider", "two-wheeler", "motorcycle"),
    ("TVS", "Ntorq", "two-wheeler", "scooter"),
    ("Yamaha", "FZ", "two-wheeler", "motorcycle"),
    ("Yamaha", "R15", "two-wheeler", "motorcycle"),
    ("Suzuki", "Access", "two-wheeler", "scooter"),
    ("KTM", "Duke 200", "two-wheeler", "motorcycle"),
    ("Ola Electric", "S1 Pro", "two-wheeler", "scooter"),
    ("Ather", "450X", "two-wheeler", "scooter"),
    # --- Auto-Rickshaws ---
    ("Bajaj", "RE auto-rickshaw", "auto-rickshaw", "three-wheeler"),
    ("Piaggio", "Ape auto", "auto-rickshaw", "three-wheeler"),
    ("Mahindra", "Treo", "auto-rickshaw", "three-wheeler"),
    # --- Trucks ---
    ("Tata", "Ace", "truck", "mini truck"),
    ("Tata", "LPT 1613", "truck", "medium truck"),
    ("Ashok Leyland", "Dost", "truck", "light truck"),
    ("Ashok Leyland", "Ecomet", "truck", "medium truck"),
    ("Eicher", "Pro 2049", "truck", "medium truck"),
    ("Mahindra", "Bolero Pickup", "truck", "pickup truck"),
    # --- Buses ---
    ("Tata", "Starbus", "bus", "bus"),
    ("Ashok Leyland", "Viking", "bus", "bus"),
    ("Eicher", "Skyline", "bus", "bus"),
    ("Force", "Traveller", "bus", "minibus"),
)


# Makes/models common on Indian roads that are NOT in the synthetic registry. They are only in the
# OpenCLIP prompt bank, so a Volvo is not forced onto the closest registry model. They can never
# earn the make/model bonus, because no registry record has them.
EXTRA_CLIP_MODELS: tuple[tuple[str, str, str, str], ...] = (
    ("Volvo", "XC60", "SUV", "SUV"),
    ("Volvo", "XC90", "SUV", "SUV"),
    ("Volvo", "S90", "car", "sedan"),
    ("BMW", "3 Series", "car", "sedan"),
    ("BMW", "5 Series", "car", "sedan"),
    ("BMW", "X1", "SUV", "SUV"),
    ("BMW", "X5", "SUV", "SUV"),
    ("Mercedes-Benz", "C-Class", "car", "sedan"),
    ("Mercedes-Benz", "E-Class", "car", "sedan"),
    ("Mercedes-Benz", "GLC", "SUV", "SUV"),
    ("Audi", "A4", "car", "sedan"),
    ("Audi", "A6", "car", "sedan"),
    ("Audi", "Q5", "SUV", "SUV"),
    ("Skoda", "Slavia", "car", "sedan"),
    ("Skoda", "Kushaq", "SUV", "compact SUV"),
    ("Volkswagen", "Virtus", "car", "sedan"),
    ("Volkswagen", "Taigun", "SUV", "compact SUV"),
    ("MG", "Hector", "SUV", "SUV"),
    ("Jeep", "Compass", "SUV", "SUV"),
    ("Kia", "Sonet", "SUV", "compact SUV"),
    ("Toyota", "Camry", "car", "sedan"),
    ("Honda", "Amaze", "car", "sedan"),
    ("Renault", "Kwid", "car", "hatchback"),
    ("Nissan", "Magnite", "SUV", "compact SUV"),
    ("TVS", "Apache", "two-wheeler", "motorcycle"),
    ("Yamaha", "FZ", "two-wheeler", "motorcycle"),
    ("Suzuki", "Access", "two-wheeler", "scooter"),
)


@dataclass(frozen=True)
class IngestConfig:
    low_light_brightness: float = 60.0      # median frame brightness (0-255) below this = low light
    brightness_sample_every: int = 5        # sample every Nth frame for the brightness median


@dataclass(frozen=True)
class TrackConfig:
    model_gpu: str = "yolo11s.pt"
    model_cpu: str = "yolo11n.pt"
    tracker: str = "bytetrack.yaml"
    # COCO class id -> name. Only these are kept.
    classes: dict[int, str] = field(
        default_factory=lambda: {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
    )
    det_conf: float = 0.25
    crop_pad: float = 0.05                  # 5% padding on every side
    min_track_frames: int = 5
    frame_stride_cpu: int = 2               # process every 2nd frame on CPU
    frame_stride_gpu: int = 1
    imgsz: int = 640
    # ByteTrack can give one vehicle several IDs (a second box on the same car, or a new ID after
    # an occlusion). Tracks of the same clip are merged when their fused plates agree on at least
    # this many known characters with no conflict (prism.track_merge). 0 disables merging.
    merge_min_plate_agree: int = 6
    merge_min_plate_len: int = 8            # both plates must look like full plates, not a sign or sticker
    merge_min_box_overlap: float = 0.5      # in shared frames, intersection / smaller box must reach this


@dataclass(frozen=True)
class PlateConfig:
    detector_model: str = "yolo-v9-t-384-license-plate-end2end"
    det_conf: float = 0.35
    min_sharpness: float = 45.0             # Laplacian variance
    # Frames are ranked by plate width x min(1, sharpness / ref). Laplacian variance alone is higher
    # for small, distant crops (noise and downscaling add edges), so it kept far frames over clear
    # close-ups. Above `ref` a crop counts as sharp and its pixel width decides.
    quality_sharpness_ref: float = 1000.0
    min_width_px: int = 30
    top_k_frames: int = 12
    two_line_aspect: float = 2.2            # width/height below this = two-line plate
    two_line_gap_ratio: float = 0.6         # gap row energy must be below this x median
    clahe_clip_limit: float = 2.0
    clahe_tile: tuple[int, int] = (8, 8)
    read_clahe_copy: bool = True
    vehicle_crops_for_attributes: int = 3
    max_obs_per_track: int = 60             # evenly sampled detections per track searched for plates
    plate_pad_px: int = 2


@dataclass(frozen=True)
class OCRConfig:
    backend: str = "parseq"                 # parseq | fast_plate_ocr
    parseq_variant: str = "parseq"          # parseq | parseq_tiny
    fast_plate_ocr_model: str = "cct-s-v2-global-model"
    char_conf: float = 0.70                 # tau_char
    # Layout separators dropped before masking (they are not plate characters).
    separators: str = " -.\u00b7_|"
    # Layout-constrained decoding (prism.layout_decode). Only a position whose top OCR character
    # the Indian plate layouts rule out is re-decided, and only to a character the model itself
    # gave at least `layout_min_model_prob`, whose probability given the layouts is at least
    # `char_conf`, and that the likely layouts agree on (`layout_min_agreement`).
    layout_decode: bool = True
    layout_min_model_prob: float = 0.15
    layout_min_agreement: float = 0.90
    layout_cut_prior: float = 0.05          # prior weight of a layout that lost its first/last character
    layout_max_ruled_out: int = 1           # a read breaking the layout in more places is only masked


@dataclass(frozen=True)
class FusionConfig:
    s_ref: float = 100.0
    sharpness_cap: float = 2.0
    vote_min_weight: float = 0.9            # W_k(a*) >= 0.9
    vote_min_share: float = 0.60            # W_k(a*) / sum_a W_k(a) >= 0.60
    # Extra guardrail beyond the two-condition vote (it can only add '?'): the winner must be
    # read confidently in at least this share of the reads that saw a character at the position.
    # Stops a few confident hallucinations (e.g. a half-hidden '2' read as '8' at 0.85 in 4 of
    # 24 reads, the other 20 below 0.70) from becoming a committed character. 0 disables it.
    vote_min_consistency: float = 0.40


@dataclass(frozen=True)
class MatchConfig:
    tau: float = 0.55
    w_plate: float = 0.65
    w_color: float = 0.20
    w_body: float = 0.15
    mm_bonus: float = 0.05
    mm_min_conf: float = 0.50
    low_light_w_plate: float = 0.75
    low_light_w_color: float = 0.10
    no_plate_cap: float = 0.45
    min_known_for_match: int = 3
    # A top candidate that contradicts a confidently read plate character (no shift or
    # OCR mix-up explains it) cannot be MATCHED. Without this, a one-character decoy
    # scores ~0.93 and the "true vehicle removed" false-match test fails.
    mismatch_blocks_match: bool = True
    # Rank candidates that contradict a confidently read character below every candidate
    # that does not, so a colour misread (0.20) cannot outrank hard plate evidence.
    rank_contradictions_last: bool = True
    ambiguity_gap: float = 0.05
    coverage_full: int = 6                  # |K| at which coverage factor reaches 1
    confusable_credit: float = 0.35
    shift_penalty: float = 0.05
    shifts: tuple[int, ...] = (-1, 0, 1)
    top_n: int = 5
    confusable_pairs: tuple[tuple[str, str], ...] = (
        ("0", "O"), ("1", "I"), ("8", "B"), ("5", "S"), ("2", "Z"), ("6", "G"), ("4", "A"),
    )
    adjacent_colors: tuple[tuple[str, str], ...] = (("silver", "grey"), ("white", "silver"))
    adjacent_colors_low_light: tuple[tuple[str, str], ...] = (("grey", "black"),)
    adjacent_color_credit: float = 0.5


@dataclass(frozen=True)
class AttributeConfig:
    clip_model: str = "ViT-B-32"
    clip_pretrained: str = "laion2b_s34b_b79k"
    n_crops: int = 3
    uncertain_below: float = 0.40
    logit_scale: float = 100.0


@dataclass(frozen=True)
class SuperResConfig:
    enabled: bool = True
    weights_file: str = "lpsr_cgnetV2_deformable.pth"
    pad_color: tuple[int, int, int] = (127, 127, 127)
    aspect_ratio: float = 3.0
    in_h: int = 16
    in_w: int = 48


@dataclass(frozen=True)
class ReIDConfig:
    encoder: str = "clip"                   # clip | osnet | resnet
    # Cosine thresholds are not comparable between encoders; each has its own.
    thresholds: dict[str, float] = field(
        default_factory=lambda: {"clip": 0.82, "osnet": 0.80, "resnet": 0.85}
    )
    max_city_speed_kmh: float = 120.0
    n_crops: int = 3
    # Appearance alone never links two tracks: at least this many known plate positions must
    # agree (and none may conflict).
    min_plate_agree: int = 3


@dataclass(frozen=True)
class NarrativeConfig:
    backend: str = "template"               # template | ollama
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.2:3b"
    ollama_timeout_s: float = 45.0
    max_failed_sentences: int = 1          # more failures than this -> fall back to template


@dataclass(frozen=True)
class PrismConfig:
    seed: int = SEED
    device: str = "auto"                    # auto | cuda | cpu
    ingest: IngestConfig = field(default_factory=IngestConfig)
    track: TrackConfig = field(default_factory=TrackConfig)
    plate: PlateConfig = field(default_factory=PlateConfig)
    ocr: OCRConfig = field(default_factory=OCRConfig)
    fusion: FusionConfig = field(default_factory=FusionConfig)
    match: MatchConfig = field(default_factory=MatchConfig)
    attributes: AttributeConfig = field(default_factory=AttributeConfig)
    super_res: SuperResConfig = field(default_factory=SuperResConfig)
    reid: ReIDConfig = field(default_factory=ReIDConfig)
    narrative: NarrativeConfig = field(default_factory=NarrativeConfig)


def _jsonable(obj: Any) -> Any:
    if dataclasses.is_dataclass(obj):
        return {f.name: _jsonable(getattr(obj, f.name)) for f in dataclasses.fields(obj)}
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    return obj


def config_dict(cfg: PrismConfig) -> dict[str, Any]:
    return _jsonable(cfg)


def config_hash(cfg: PrismConfig) -> str:
    blob = json.dumps(config_dict(cfg), sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()


def with_overrides(cfg: PrismConfig, **sections: dict[str, Any]) -> PrismConfig:
    """Return a copy with selected fields replaced, e.g. with_overrides(cfg, match={"tau": 0.6})."""
    updates = {}
    for name, values in sections.items():
        updates[name] = dataclasses.replace(getattr(cfg, name), **values)
    return dataclasses.replace(cfg, **updates)


def load_config() -> PrismConfig:
    """Default config with a few environment overrides for deployment."""
    cfg = PrismConfig()
    env_device = os.environ.get("PRISM_DEVICE")
    env_ocr = os.environ.get("PRISM_OCR_BACKEND")
    env_narr = os.environ.get("PRISM_NARRATIVE")
    env_reid = os.environ.get("PRISM_REID_ENCODER")
    if env_device:
        cfg = dataclasses.replace(cfg, device=env_device)
    if env_ocr:
        cfg = with_overrides(cfg, ocr={"backend": env_ocr})
    if env_narr:
        cfg = with_overrides(cfg, narrative={"backend": env_narr})
    if env_reid:
        cfg = with_overrides(cfg, reid={"encoder": env_reid})
    return cfg


def set_seeds(seed: int = SEED) -> None:
    """Fix every random source PRISM touches, for reproducible runs."""
    random.seed(seed)
    os.environ.setdefault("PYTHONHASHSEED", str(seed))
    try:
        import numpy as np

        np.random.seed(seed)
    except ImportError:
        pass
    try:
        import torch

        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
    except ImportError:
        pass
