"""Build realistic CaseResults without running any model."""

from __future__ import annotations

from prism.advisor import advise
from prism.config import PrismConfig
from prism.fusion import fuse_frame_reads
from prism.masking import mask_read
from prism.matcher import match
from prism.schemas import (
    Attributes,
    AttributeValue,
    CaseResult,
    CharRead,
    ClipMeta,
    Custody,
    FrameRead,
    TrackResult,
)


def frame_read(frame_idx: int, text: str, confs: list[float], sharp: float = 120.0, source: str = "raw") -> FrameRead:
    cfg = PrismConfig()
    m = mask_read(text, confs, cfg.ocr)
    return FrameRead(
        read_id=f"F{frame_idx}" + ("c" if source == "clahe" else ""), frame_idx=frame_idx,
        timestamp_sec=round(frame_idx / 25, 3), sharpness=sharp, source=source, ocr_backend="test", raw_text=text,
        masked_text=m.masked_text,
        chars=[CharRead(char=c, raw_char=r, conf=p, reason=w) for c, r, p, w in zip(m.chars, m.raw_chars, m.raw_confs, m.reasons)],
        format_conflicts=m.conflicts,
    )


def av(value: str, conf: float = 0.9) -> AttributeValue:
    return AttributeValue(value=value, confidence=conf, top2=[(value, conf), ("grey", 0.05)])


def make_case(registry, frames: list[FrameRead], color="white", body="car", tau=0.55) -> CaseResult:
    cfg = PrismConfig()
    fused = fuse_frame_reads(frames, cfg.fusion)
    attrs = Attributes(color=av(color), body_type=av(body), make_model=AttributeValue(value="Hyundai Verna", confidence=0.3, uncertain=True, top2=[("Hyundai Verna", 0.3)]), yolo_class="car")
    m = match(fused.text, registry, cfg.match, attrs.color, attrs.body_type, attrs.make_model, tau)
    t = TrackResult(
        track_id=4, yolo_class="car", first_seen_sec=1.4, last_seen_sec=4.2, n_detections=60, frames=frames,
        fused=fused, attributes=attrs, match=m,
        advisor=advise(fused, m, cfg.match, cfg.ocr, {f.read_id: f.frame_idx for f in frames}),
    )
    clip = ClipMeta(name="test.mp4", sha256="ab" * 32, width=1280, height=720, fps=25.0, frame_count=150,
                    duration_sec=6.0, median_brightness=120.0, low_light=False)
    from prism.config import config_dict, config_hash

    return CaseResult(
        case_id="testcase01", created_at="2026-01-01T00:00:00+05:30", prism_version="1.0.0", clip=clip,
        threshold=tau, device="cpu", ocr_backend="test", tracks=[t], primary_track_id=4,
        custody=Custody(clip_sha256=clip.sha256, clips=[clip], models={"ocr": "test"}, config_hash=config_hash(cfg),
                        config=config_dict(cfg), vendor_commits={"parseq": "deadbeef"}),
    )


def night_frames() -> list[FrameRead]:
    """Positions 5 and 9 never read with confidence; frame 57 came closest at position 5."""
    hi = 0.95
    out = []
    for i, idx in enumerate([42, 47, 51]):
        confs = [hi] * 10
        confs[4] = 0.40
        confs[8] = 0.30
        out.append(frame_read(idx, "CG04MX4821", confs, sharp=130))
    confs = [hi] * 10
    confs[4] = 0.62
    confs[8] = 0.20
    out.append(frame_read(57, "CG04MX4821", confs, sharp=110))
    return out
