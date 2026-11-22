"""Command-line entry point.

  python -m prism analyze data/test_clips/day_clear_white.mp4 [--hint CG04??48??] [--tau 0.55] [--report pdf]
  python -m prism crosscam clipA.mp4 clipB.mp4 [--report html]
  python -m prism search CG04??48?? --color white --body car
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from prism.config import RUNS_DIR, load_config


def _print_case(case) -> None:
    print(f"case {case.case_id}  mode={case.mode}  threshold={case.threshold:.2f}  device={case.device}")
    for t in case.tracks:
        m = t.match
        best = m.top_candidates[0] if m and m.top_candidates else None
        print(
            f"  track {t.track_id:>4}  plate {t.fused.text or '(none)':<12} reads {len(t.frames):>2}  "
            f"{t.attributes.color.value}/{t.attributes.body_type.value:<12} -> {m.status.value if m else '-':<18} "
            + (f"top {best.registry_id} {best.plate} {best.score:.2f}" if best else "")
        )
    if case.crosscam:
        for p in case.crosscam.pairs:
            extra = f" combined {p.combined.text} -> {p.status_after.value}" if p.combined else ""
            print(f"  pair A{p.track_a}-B{p.track_b} sim {p.similarity:.2f} same={p.same_vehicle}{extra}")
    if case.narrative:
        print("summary:", case.narrative.text)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(prog="prism")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("clip")
    c = sub.add_parser("crosscam")
    c.add_argument("clip_a")
    c.add_argument("clip_b")
    c.add_argument("--distance-km", type=float)
    c.add_argument("--gap-s", type=float)
    s = sub.add_parser("search")
    s.add_argument("hint")
    s.add_argument("--color")
    s.add_argument("--body")
    s.add_argument("--make-model")
    s.set_defaults(hint_opt=None)
    for p in (a, c, s):
        if p is not s:
            p.add_argument("--hint", dest="hint_opt", default=None, help="partial plate, e.g. CG04??48??")
        p.add_argument("--tau", type=float, default=None)
        p.add_argument("--report", choices=["html", "pdf"], default=None)
        p.add_argument("--json", action="store_true", help="print the full result JSON")
    args = ap.parse_args(argv)
    cfg = load_config()

    from prism.pipeline import hint_only_search, run_crosscam, run_pipeline
    from prism.report import write_report

    if args.cmd == "analyze":
        case = run_pipeline(args.clip, hint=args.hint_opt, threshold=args.tau, cfg=cfg)
    elif args.cmd == "crosscam":
        case = run_crosscam(args.clip_a, args.clip_b, hint=args.hint_opt, threshold=args.tau,
                            distance_km=args.distance_km, gap_s=args.gap_s, cfg=cfg)
    else:
        case = hint_only_search(args.hint, args.color, args.body, args.make_model, args.tau, cfg=cfg)
    out = RUNS_DIR / case.case_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "result.json").write_text(case.model_dump_json(indent=2), encoding="utf-8")
    if args.json:
        print(json.dumps(json.loads(case.model_dump_json()), indent=2))
    else:
        _print_case(case)
    if args.report:
        path, fmt = write_report(case, args.report, out / "report")
        print(f"report ({fmt}): {path}")
    print(f"result: {out / 'result.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
