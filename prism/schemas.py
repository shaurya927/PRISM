"""Pydantic v2 models for PRISM results, the API and the report."""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class MatchStatus(str, Enum):
    MATCHED = "MATCHED"
    AMBIGUOUS = "AMBIGUOUS"
    NO_CONFIDENT_MATCH = "NO CONFIDENT MATCH"


# --------------------------------------------------------------------------- registry
class RegistryRecord(BaseModel):
    registry_id: str
    plate: str
    color: str
    body_type: str
    make: str
    model: str
    owner_region: str
    body_style: Optional[str] = None  # hatchback / sedan / MPV ... (informational only)


# --------------------------------------------------------------------------- per-frame OCR
class CharRead(BaseModel):
    char: str                     # masked character ('?' if unknown)
    raw_char: str                 # character the OCR produced (before masking)
    conf: float                   # OCR confidence for raw_char
    reason: Optional[str] = None  # why it was masked: low_confidence | non_alphanumeric | format


class FrameRead(BaseModel):
    """Audit record of one OCR read of one plate crop copy (raw or CLAHE)."""

    read_id: str                  # e.g. "F42" or "F42c" (CLAHE copy)
    frame_idx: int
    timestamp_sec: float
    sharpness: float
    source: Literal["raw", "clahe"]
    ocr_backend: str
    raw_text: str
    masked_text: str
    chars: list[CharRead]
    format_conflicts: list[str] = Field(default_factory=list)
    two_line: bool = False
    plate_bbox: list[int] = Field(default_factory=list)  # frame coordinates x1,y1,x2,y2
    plate_crop_url: Optional[str] = None
    plate_clahe_url: Optional[str] = None
    vehicle_crop_url: Optional[str] = None
    sr_url: Optional[str] = None  # visual aid only, never evidence


# --------------------------------------------------------------------------- fusion
class VoteCell(BaseModel):
    read_id: str
    char: Optional[str]           # masked char at this position, '?' if unknown, None if gap
    raw_char: Optional[str] = None
    raw_conf: float = 0.0
    weight: float = 0.0


class FusedPosition(BaseModel):
    index: int                    # 0-based
    char: str                     # final char or '?'
    confidence: float             # winner share W(a*)/sum W
    weight: float                 # W(a*)
    total_weight: float
    source: Literal["video", "investigator-supplied", "video+hint", "unknown", "conflict"]
    votes: dict[str, float] = Field(default_factory=dict)
    supporting: list[str] = Field(default_factory=list)
    dissenting: list[str] = Field(default_factory=list)
    cells: list[VoteCell] = Field(default_factory=list)
    note: Optional[str] = None


class FusedPlate(BaseModel):
    text: str                     # e.g. "CG04?X48?1"
    video_text: str               # video-only result before any hint merge
    length: int
    reference_read: Optional[str] = None
    n_reads: int = 0
    positions: list[FusedPosition] = Field(default_factory=list)
    hint: Optional[str] = None
    hint_conflicts: list[str] = Field(default_factory=list)
    format_conflicts: list[str] = Field(default_factory=list)
    excluded_reads: list[str] = Field(default_factory=list)  # too short/long to align; no vote

    @property
    def known_count(self) -> int:
        return sum(1 for c in self.text if c != "?")


# --------------------------------------------------------------------------- attributes
class AttributeValue(BaseModel):
    value: str                    # label or "uncertain"
    confidence: float
    uncertain: bool = False
    top2: list[tuple[str, float]] = Field(default_factory=list)
    source: Optional[str] = None


class Attributes(BaseModel):
    color: AttributeValue
    body_type: AttributeValue
    make_model: Optional[AttributeValue] = None
    yolo_class: Optional[str] = None


# --------------------------------------------------------------------------- matching
class ScoreBreakdown(BaseModel):
    plate_sim: float
    coverage: float
    plate: float                  # weighted contribution w_p * sim * coverage
    color_sim: float
    color: float
    body_sim: float
    body: float
    make_model: float
    raw_total: float
    total: float
    w_plate: float
    w_color: float
    w_body: float
    capped: Optional[str] = None
    shift: int = 0


class Candidate(BaseModel):
    rank: int
    registry_id: str
    plate: str
    color: str
    body_type: str
    make: str
    model: str
    owner_region: str
    score: float
    breakdown: ScoreBreakdown
    reasons: list[str]
    mismatches: list[str] = Field(default_factory=list)
    matched_known: int = 0
    known_count: int = 0


class MatchResult(BaseModel):
    status: MatchStatus
    threshold_used: float
    top_candidates: list[Candidate]
    explanation: str
    known_count: int
    specificity: int
    specificity_text: str
    low_light: bool = False
    gap: Optional[float] = None
    registry_size: int = 0


class AdvisorNote(BaseModel):
    needed: bool
    position: Optional[int] = None            # 0-based
    candidate_chars: dict[str, str] = Field(default_factory=dict)
    lead_read_id: Optional[str] = None
    lead_frame_idx: Optional[int] = None
    lead_char: Optional[str] = None
    lead_conf: Optional[float] = None
    text: str


# --------------------------------------------------------------------------- narrative
class NarrativeSentence(BaseModel):
    text: str
    passed: bool
    problems: list[str] = Field(default_factory=list)


class Narrative(BaseModel):
    text: str
    method: str                               # "template" | "ollama:<model>" | "template (fallback)"
    sentences: list[NarrativeSentence]
    checked: int
    removed: int


# --------------------------------------------------------------------------- tracks / case
class TrackResult(BaseModel):
    track_id: int
    clip_role: Literal["A", "B"] = "A"
    yolo_class: str
    first_seen_sec: float
    last_seen_sec: float
    n_detections: int
    best_crop_url: Optional[str] = None
    frames: list[FrameRead] = Field(default_factory=list)
    fused: FusedPlate
    attributes: Attributes
    match: Optional[MatchResult] = None
    advisor: Optional[AdvisorNote] = None
    sr_available: bool = False
    # Other tracker IDs of the same vehicle, folded into this track by prism.track_merge.
    merged_track_ids: list[int] = Field(default_factory=list)
    merge_note: Optional[str] = None


class ClipMeta(BaseModel):
    name: str
    sha256: str
    width: int
    height: int
    fps: float
    frame_count: int
    duration_sec: float
    median_brightness: float
    low_light: bool


class ArtifactHash(BaseModel):
    path: str
    sha256: str
    kind: str


class Custody(BaseModel):
    clip_sha256: Optional[str] = None
    clips: list[ClipMeta] = Field(default_factory=list)
    models: dict[str, str] = Field(default_factory=dict)
    packages: dict[str, str] = Field(default_factory=dict)
    vendor_commits: dict[str, str] = Field(default_factory=dict)
    prism_commit: Optional[str] = None
    config_hash: str
    config: dict
    artifacts: list[ArtifactHash] = Field(default_factory=list)
    registry_sha256: Optional[str] = None


class CaseResult(BaseModel):
    case_id: str
    created_at: str
    prism_version: str
    mode: Literal["clip", "hint-only", "crosscam"] = "clip"
    clip: Optional[ClipMeta] = None
    hint: Optional[str] = None
    threshold: float
    device: str
    ocr_backend: str
    tracks: list[TrackResult] = Field(default_factory=list)
    narrative: Optional[Narrative] = None
    custody: Optional[Custody] = None
    warnings: list[str] = Field(default_factory=list)
    stage_timings: dict[str, float] = Field(default_factory=dict)
    crosscam: Optional["CrossCamResult"] = None
    primary_track_id: Optional[int] = None


# --------------------------------------------------------------------------- cross-camera
class CrossCamPair(BaseModel):
    track_a: int
    track_b: int
    similarity: float
    threshold: float
    plate_compatible: bool
    plate_note: str
    body_match: bool
    same_vehicle: bool
    speed_kmh: Optional[float] = None
    speed_flag: bool = False
    combined: Optional[FusedPlate] = None
    combined_match: Optional[MatchResult] = None
    status_before: Optional[MatchStatus] = None
    status_after: Optional[MatchStatus] = None
    upgraded: bool = False
    reasons: list[str] = Field(default_factory=list)


class CrossCamResult(BaseModel):
    encoder: str
    threshold: float
    clip_a: Optional[ClipMeta] = None
    clip_b: Optional[ClipMeta] = None
    tracks_b: list[TrackResult] = Field(default_factory=list)
    pairs: list[CrossCamPair] = Field(default_factory=list)


CaseResult.model_rebuild()


# --------------------------------------------------------------------------- API
class JobState(BaseModel):
    job_id: str
    kind: Literal["clip", "crosscam"]
    status: Literal["queued", "running", "done", "error"]
    stage: str = "queued"
    progress: dict[str, float] = Field(default_factory=dict)
    error: Optional[str] = None
    created_at: str
    result: Optional[CaseResult] = None


class RescoreRequest(BaseModel):
    threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    hint: Optional[str] = None


class WhatIfRequest(BaseModel):
    """A hypothesis to test against a finished case. Nothing here is evidence or saved to the case."""
    track_id: Optional[int] = None
    # 0-based plate position -> assumed character ('?' = treat as unreadable)
    slots: dict[int, str] = Field(default_factory=dict)
    # None or "recorded": the colour PRISM saw. "ignore": colour unreliable. "sodium": sodium-vapour
    # street lighting (white/silver/grey/yellow look alike). A colour name: assume that colour.
    color: Optional[str] = None
    # None or "recorded" | "ignore" | a body type
    body_type: Optional[str] = None
    threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class WhatIfPosition(BaseModel):
    index: int
    char: str                     # character used in this hypothesis ('?' if unknown)
    video_char: str               # what the case result has at this position
    source: Literal["video", "unknown", "investigator-supplied", "hypothesis"]


class WhatIfComponent(BaseModel):
    name: Literal["plate", "colour", "body", "make/model"]
    leader: float
    rival: float
    delta: float                  # leader - rival


class WhatIfDifferential(BaseModel):
    leader_id: str
    rival_id: str
    rival_rank: int
    leader_score: float
    rival_score: float
    gap: float                    # leader - rival (can be <= 0 when the rival contradicts the plate)
    components: list[WhatIfComponent]
    substitutions: list[str] = Field(default_factory=list)
    rival_contradicts: bool = False
    text: str


class WhatIfWinShare(BaseModel):
    registry_id: str
    plate: str
    share: float                  # share of scenarios in which this record is the sole #1
    clear_share: float            # ... and is MATCHED (>= tau, enough known characters, gap >= 0.05)


class WhatIfCell(BaseModel):
    value: str                    # character, or colour/lighting mode
    label: str
    n: int                        # scenarios with this value
    keeps_leader_share: float     # share of those in which the hypothesis leader is the sole #1
    leader_id: Optional[str]      # most frequent sole #1 among those scenarios (None: most often a tie)
    tie_share: float = 0.0        # share of those in which #1 is tied


class WhatIfAxis(BaseModel):
    kind: Literal["position", "colour"]
    index: Optional[int] = None   # plate position (0-based) for kind == "position"
    label: str
    cells: list[WhatIfCell]
    pivotal: bool = False         # some value of this axis hands #1 to another record


class WhatIfStability(BaseModel):
    leader_id: Optional[str]
    leader_tied_with: list[str] = Field(default_factory=list)  # records level with the leader in this hypothesis
    n_scenarios: int
    n_combinations: int
    sampled: bool
    leader_share: float           # Hypothesis Stability Score: share in which the leader is the sole #1
    tie_share: float = 0.0        # share in which #1 is tied (the order is then only the registry ID)
    clear_share: float            # share in which the leader is MATCHED
    win_shares: list[WhatIfWinShare]
    axes: list[WhatIfAxis]
    text: str


class WhatIfResult(BaseModel):
    hypothetical: bool = True
    track_id: int
    plate: str
    positions: list[WhatIfPosition]
    assumptions: list[str]
    match: MatchResult
    actual_leader_id: Optional[str] = None
    actual_status: Optional[MatchStatus] = None
    leader_changed: bool = False
    status_changed: bool = False
    stability: WhatIfStability
    differentials: list[WhatIfDifferential]
    contenders: int               # registry records scored exactly for every scenario
    notice: str
    elapsed_ms: float


class SearchRequest(BaseModel):
    hint: str
    color: Optional[str] = None
    body_type: Optional[str] = None
    make_model: Optional[str] = None
    threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    low_light: bool = False
