"""Analyse every clip in data/test_clips and write one forensic report per clip + reports/index.html.

This produces the "analysis report for each test clip" deliverable. Cross-camera pairs listed in
labels.json get their own combined report.

Usage:  python scripts/batch_report.py [--clips data/test_clips] [--format pdf|html] [--no-crosscam]
"""

from __future__ import annotations

import argparse
import html
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from prism.config import REPORTS_DIR, TEST_CLIPS_DIR, load_config  # noqa: E402
from prism.custody import sha256_file  # noqa: E402
from prism.pipeline import run_crosscam, run_pipeline  # noqa: E402
from prism.report import write_report  # noqa: E402

STATUS_COLOR = {"MATCHED": "#15803d", "AMBIGUOUS": "#b45309", "NO CONFIDENT MATCH": "#b91c1c"}


def _row(case, report_path: Path, label: dict | None, kind: str) -> dict:
    tr = next((t for t in case.tracks if t.track_id == case.primary_track_id), None)
    status, plate, top, score = "NO TRACK", "", "", None
    if case.crosscam:
        linked = [p for p in case.crosscam.pairs if p.same_vehicle and p.combined_match]
        if linked:
            p = linked[0]
            status, plate = p.combined_match.status.value, p.combined.text
            top, score = p.combined_match.top_candidates[0].registry_id, p.combined_match.top_candidates[0].score
    if tr is not None and not plate:
        status, plate = tr.match.status.value, tr.fused.text
        if tr.match.top_candidates:
            top, score = tr.match.top_candidates[0].registry_id, tr.match.top_candidates[0].score
    expected = (label or {}).get("expected_status")
    truth = (label or {}).get("registry_id")
    return {
        "name": (label or {}).get("clip") or case.clip.name, "kind": kind, "plate": plate, "status": status,
        "top": top, "score": score, "tracks": len(case.tracks), "expected": expected, "truth": truth,
        "correct": (status == "MATCHED" and top == truth) if status == "MATCHED" else (status == expected),
        "report": report_path.relative_to(REPORTS_DIR).as_posix(), "sha": sha256_file(report_path),
        "clip_sha": case.clip.sha256 if case.clip else "", "seconds": case.stage_timings.get("total"),
    }


def write_index(rows: list[dict], fmt: str) -> Path:
    tr = []
    for r in rows:
        col = STATUS_COLOR.get(r["status"], "#374151")
        score_txt = "" if r["score"] is None else f" ({r['score']:.2f})"
        tr.append(
            f"<tr><td>{html.escape(r['name'])}<div class=m>{r['kind']} &middot; {r['tracks']} track(s) &middot; {r['seconds']} s</div></td>"
            f"<td class=p>{html.escape(r['plate'] or '(none)')}</td>"
            f"<td style='color:{col};font-weight:700'>{r['status']}</td>"
            f"<td>{html.escape(r['top'] or '-')}{score_txt}</td>"
            f"<td>{html.escape(str(r['expected'] or '-'))}{' / ' + r['truth'] if r['truth'] else ''}</td>"
            f"<td>{'&#10004;' if r['correct'] else '&#10008;'}</td>"
            f"<td><a href='{r['report']}'>{fmt.upper() if r['report'].endswith(fmt) else 'HTML'}</a><div class=h>{r['sha'][:16]}&hellip;</div></td></tr>"
        )
    eval_md = REPORTS_DIR / "evaluation.md"
    eval_html = ""
    if eval_md.exists():
        eval_html = "<h2>Evaluation</h2><pre>" + html.escape(eval_md.read_text(encoding="utf-8")) + "</pre>"
        if (REPORTS_DIR / "tau_sweep.png").exists():
            eval_html += "<img src='tau_sweep.png' style='max-width:600px'>"
    page = f"""<!doctype html><html><head><meta charset=utf-8><title>PRISM analysis reports</title>
<style>body{{font-family:Segoe UI,Arial,sans-serif;margin:28px;color:#1f2937}}table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top}}th{{background:#f9fafb}}
.p{{font-family:Consolas,monospace;font-size:16px;letter-spacing:2px}}.m{{color:#6b7280;font-size:11px}}
.h{{font-family:Consolas,monospace;font-size:10px;color:#6b7280}}pre{{background:#f9fafb;padding:12px;white-space:pre-wrap}}</style></head>
<body><h1>PRISM analysis reports</h1>
<p>One forensic report per test clip (frames used, characters per frame with confidence, scoring and reasons, chain of custody).
Generated {time.strftime('%Y-%m-%d %H:%M')}. <b>PRISM output supports an investigator's decision. It does not identify a vehicle on its own.</b></p>
<table><tr><th>Clip</th><th>Combined plate</th><th>Status</th><th>Top candidate</th><th>Expected / truth</th><th>As expected</th><th>Report (SHA-256)</th></tr>
{''.join(tr)}</table>{eval_html}</body></html>"""
    out = REPORTS_DIR / "index.html"
    out.write_text(page, encoding="utf-8")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", type=Path, default=TEST_CLIPS_DIR)
    ap.add_argument("--format", choices=["pdf", "html"], default="pdf")
    ap.add_argument("--no-crosscam", action="store_true")
    args = ap.parse_args()
    cfg = load_config()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    labels_path = args.clips / "labels.json"
    meta = json.loads(labels_path.read_text()) if labels_path.exists() else {"clips": [], "crosscam_pairs": []}
    labels = {l["clip"]: l for l in meta["clips"]}
    rows = []
    for clip in sorted(args.clips.glob("*.mp4")):
        print(f"analysing {clip.name}")
        case = run_pipeline(clip, cfg=cfg)
        out = REPORTS_DIR / clip.stem
        out.mkdir(parents=True, exist_ok=True)
        (out / "result.json").write_text(case.model_dump_json(indent=2), encoding="utf-8")
        path, fmt = write_report(case, args.format, out)
        if fmt != "html":
            write_report(case, "html", out)
        rows.append(_row(case, path, labels.get(clip.name), "single clip"))
        print(f"  -> {rows[-1]['plate']} {rows[-1]['status']} ({path.name})")
    if not args.no_crosscam:
        for pair in meta.get("crosscam_pairs", []):
            a, b = args.clips / pair["clip_a"], args.clips / pair["clip_b"]
            if not (a.exists() and b.exists()):
                continue
            print(f"cross-camera {a.name} + {b.name}")
            case = run_crosscam(a, b, cfg=cfg)
            out = REPORTS_DIR / f"crosscam_{a.stem}__{b.stem}"
            out.mkdir(parents=True, exist_ok=True)
            (out / "result.json").write_text(case.model_dump_json(indent=2), encoding="utf-8")
            path, fmt = write_report(case, args.format, out)
            label = {"clip": f"{a.name} + {b.name}", "registry_id": pair["registry_id"], "expected_status": "MATCHED"}
            rows.append(_row(case, path, label, "cross-camera"))
            print(f"  -> {rows[-1]['plate']} {rows[-1]['status']}")
    idx = write_index(rows, args.format)
    print(f"index: {idx}")


if __name__ == "__main__":
    main()
