"""Copy real PRISM outputs into the marketing site (frontend/public/media, frontend/src/site/data).

Uses the batch-report runs (reports/<clip>/result.json -> runs/<case_id>/...), so every image and
number on the site is genuine system output. Re-run after scripts/batch_report.py.

Usage:  python scripts/build_site_media.py
"""

from __future__ import annotations

import dataclasses
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from prism.config import REPORTS_DIR, RUNS_DIR, load_config  # noqa: E402
from prism.fusion import fuse_reads  # noqa: E402
from prism.masking import mask_read, observation  # noqa: E402
from prism.report import artifact_path, evidence_strip_png  # noqa: E402
from prism.schemas import CaseResult  # noqa: E402

MEDIA = ROOT / "frontend" / "public" / "media"
DATA = ROOT / "frontend" / "src" / "site" / "data"
# registry records by id, for the extra vehicle details the site shows (body style, region)
REGISTRY = {r["registry_id"]: r for r in json.loads((ROOT / "data" / "registry.json").read_text(encoding="utf-8"))}
CASES = ["day_clear_white", "night_partial_white", "camB_white", "day_black_suv", "day_blue_twoline",
         "unregistered_white", "crosscam_night_partial_white__camB_white"]


def copy(url: str | None, dst: Path) -> str | None:
    p = artifact_path(url, RUNS_DIR)
    if p is None:
        return None
    shutil.copyfile(p, dst)
    return f"/media/{dst.name}"


def fusion_sweep(frames) -> list[dict]:
    """Re-run masking + fusion on the real reads at several tau_char values (site demo slider)."""
    base = load_config()
    out = []
    for i in range(10):
        tau = round(0.50 + 0.05 * i, 2)
        ocr_cfg = dataclasses.replace(base.ocr, char_conf=tau)
        obs = []
        for f in frames:
            raw = [c.raw_char for c in f.chars]
            confs = [float(c.conf) for c in f.chars]
            # the model's saved top candidates (cases analysed with layout-constrained decoding)
            dists = [c.alts or None for c in f.chars]
            m = mask_read("".join(raw), confs, ocr_cfg, dists)
            obs.append(observation(f.read_id, m, float(f.sharpness)))
        fused = fuse_reads(obs, base.fusion)
        out.append({
            "tau": tau,
            "text": fused.text,
            "kept": sum(1 for o in obs for c in o.chars if c != "?"),
            "total": sum(len(o.chars) for o in obs),
            "positions": [{"char": p.char, "weight": p.weight, "total": p.total_weight,
                           "share": round(p.weight / p.total_weight, 3) if p.total_weight else 0.0,
                           "note": p.note} for p in fused.positions],
        })
    return out


def main() -> None:
    MEDIA.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    out: dict = {}
    for name in CASES:
        res = REPORTS_DIR / name / "result.json"
        if not res.exists():
            print(f"skip {name}: no result.json")
            continue
        case = CaseResult.model_validate_json(res.read_text(encoding="utf-8"))
        t = next((x for x in case.tracks if x.track_id == case.primary_track_id), case.tracks[0] if case.tracks else None)
        if t is None:
            continue
        reports = sorted((REPORTS_DIR / name).glob("PRISM_report_*"))
        entry = {
            "clip": case.clip.name if case.clip else name,
            "mode": case.mode,
            "best": copy(t.best_crop_url, MEDIA / f"{name}_best.jpg"),
            "plates": [u for i, f in enumerate([f for f in t.frames if f.source == "raw"][:3])
                       if (u := copy(f.plate_crop_url, MEDIA / f"{name}_plate{i}.png"))],
            "fused": t.fused.text,
            "status": t.match.status.value if t.match else None,
            "explanation": t.match.explanation if t.match else "",
            "top": [{"id": c.registry_id, "plate": c.plate, "score": c.score, "color": c.color,
                     "body": c.body_type, "model": f"{c.make} {c.model}", "mismatches": c.mismatches,
                     "style": REGISTRY.get(c.registry_id, {}).get("body_style"),
                     "region": REGISTRY.get(c.registry_id, {}).get("owner_region")}
                    for c in (t.match.top_candidates[:3] if t.match else [])],
            "advisor": t.advisor.text if t.advisor and t.advisor.needed else None,
            "color": t.attributes.color.value, "body": t.attributes.body_type.value,
            "reads": len(t.frames),
            "summary": case.narrative.text if case.narrative else "",
            "clip_sha256": case.clip.sha256 if case.clip else None,
            "reports": {f.suffix.lstrip("."): f"/reports/{name}/{f.name}" for f in reports},
        }
        strip = evidence_strip_png(t.fused)
        if strip:
            (MEDIA / f"{name}_strip.png").write_bytes(strip)
            entry["strip"] = f"/media/{name}_strip.png"
        if case.crosscam:
            linked = [p for p in case.crosscam.pairs if p.same_vehicle and p.combined_match]
            if linked:
                p = linked[0]
                tb = next(x for x in case.crosscam.tracks_b if x.track_id == p.track_b)
                entry["crosscam"] = {
                    "similarity": p.similarity, "a": t.fused.text, "b": tb.fused.text, "combined": p.combined.text,
                    "before": p.status_before.value if p.status_before else None,
                    "after": p.status_after.value if p.status_after else None,
                    "best_b": copy(tb.best_crop_url, MEDIA / f"{name}_b_best.jpg"),
                }
        if name == "night_partial_white":
            # Real per-read evidence for the interactive fusion demo.
            entry["evidence"] = [
                {"id": f.read_id, "frame": f.frame_idx, "sharpness": round(f.sharpness, 1), "source": f.source,
                 "chars": [[c.raw_char, round(c.conf, 3), c.reason == "format"] for c in f.chars]}
                for f in t.frames
            ]
            entry["fusion_sweep"] = fusion_sweep(t.frames)
        out[name] = entry
        print(f"{name}: {entry['fused']} -> {entry['status']}")
    (DATA / "cases.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    ev = REPORTS_DIR / "evaluation.json"
    if ev.exists():
        e = json.loads(ev.read_text())
        slim = {k: e[k] for k in ("n_vehicles", "tau", "device", "ocr_benchmark", "ocr_winner", "tau_sweep", "tau_choice",
                                   "clip_summary") if k in e}
        slim["ablation"] = {k: {m: v[m] for m in ("committed_char_error", "recovery_rate", "top5", "false_match_rate")}
                            for k, v in e.get("ablation", {}).items()}
        slim["by_level"] = {k: v for k, v in e.get("ablation", {}).get("full", {}).get("by_level", {}).items()}
        for b in slim.get("ocr_benchmark", {}).values():
            b.pop("error_samples", None)
            b.pop("by_level", None)
        slim["clips"] = [{k: r.get(k) for k in ("clip", "degradation", "plate", "status", "expected", "top1", "wrong",
                                                "committed", "color_ok", "body_ok", "false_match", "seconds")}
                         for r in e.get("clips", [])]
        (DATA / "evaluation.json").write_text(json.dumps(slim, indent=1), encoding="utf-8")
        print("evaluation.json written")


if __name__ == "__main__":
    main()
