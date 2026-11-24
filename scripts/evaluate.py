"""PRISM evaluation: OCR benchmark, ablation table, threshold sweep and clip benchmark.

Part A (always runs) - synthetic plate sequences, Stages 3 + 5 with the REAL OCR models:
  N registry vehicles are rendered as Indian plates and degraded per frame (downscale, blur,
  noise, JPEG, darkening, mud over 0-2 characters, cut-off first/last character), 8 frames each,
  at three difficulty levels. Each frame goes through the same raw + CLAHE reads as the pipeline.
  * OCR benchmark: ParseqOCR vs FastPlateOCR with full PRISM fusion + matching.
  * Ablation: best single frame -> majority vote -> + confidence masking -> + two-condition vote
    -> + format check + coverage factor (full PRISM).
  * Threshold sweep: false-match rate (true vehicle removed from the registry) vs top-1 accuracy.
  Observed colour/body come from the ground truth with 20% random corruption, because this part
  measures plate recovery and matching, not the attribute model.

Part B (--clips) - end-to-end pipeline on labelled clips in data/test_clips (and degraded/ with
  --degraded): status, top-1/top-5, committed error, recovery, colour/body accuracy, seconds.

Outputs reports/evaluation.json, reports/evaluation.md, reports/tau_sweep.png and refreshes the
metrics block in README.md.

Usage:  python scripts/evaluate.py [--n 120] [--clips] [--degraded]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from prism.config import REPORTS_DIR, SEED, TEST_CLIPS_DIR, PrismConfig, set_seeds, with_overrides  # noqa: E402
from prism.fusion import ReadObservation, align, fuse_reads  # noqa: E402
from prism.masking import confidence_mask, cross_check, mask_read, observation  # noqa: E402
from prism.matcher import match  # noqa: E402
from prism.plate_grammar import ALNUM, UNKNOWN, pretty  # noqa: E402
from prism.registry import load_registry  # noqa: E402
from prism.runtime import resolve_device  # noqa: E402
from prism.schemas import AttributeValue, MatchStatus, RegistryRecord  # noqa: E402
from prism.stages.plate_detect import PlateCrop, clahe_copy, is_two_line, laplacian_sharpness  # noqa: E402
from prism.stages.ocr import FastPlateOCR, ParseqOCR, read_plate_crop_dist  # noqa: E402

FRAMES_PER_VEHICLE = 8
LEVELS = {
    "easy": dict(width=(150, 200), sigma=(0.5, 1.0), noise=4, jpeg=(60, 85), occl=(0, 0), dark=0.0),
    "medium": dict(width=(100, 140), sigma=(0.9, 1.5), noise=8, jpeg=(35, 60), occl=(0, 1), dark=0.4),
    "hard": dict(width=(70, 100), sigma=(1.4, 2.2), noise=12, jpeg=(20, 40), occl=(1, 2), dark=0.7),
}


# --------------------------------------------------------------------------- synthetic data
def plate_lines(rec: RegistryRecord) -> list[str]:
    p = pretty(rec.plate)
    if rec.body_type == "two-wheeler":
        parts = p.split(" ")
        return [" ".join(parts[:-1]), parts[-1]]
    return [p]


def degrade_plate(img: np.ndarray, lvl: dict, rng: np.random.Generator, two: bool) -> np.ndarray:
    w = int(rng.integers(*lvl["width"])) if lvl["width"][0] < lvl["width"][1] else lvl["width"][0]
    if two:
        w = int(w * 0.6)
    h = max(8, int(round(w * img.shape[0] / img.shape[1])))
    small = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
    s = float(rng.uniform(*lvl["sigma"]))
    small = cv2.GaussianBlur(small, (0, 0), s)
    if rng.random() < 0.4:
        k = int(rng.integers(3, 6))
        kern = np.zeros((k, k), np.float32)
        kern[k // 2, :] = 1.0 / k
        small = cv2.filter2D(small, -1, kern)
    x = small.astype(np.float32)
    if lvl["dark"] and rng.random() < lvl["dark"]:
        x *= float(rng.uniform(0.35, 0.6))
    x += rng.normal(0, lvl["noise"], x.shape)
    small = np.clip(x, 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(*lvl["jpeg"]))])
    out = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if not two and rng.random() < 0.12:  # plate edge cut off by the crop: lose the first or last character
        cut = int(out.shape[1] * 0.085)
        out = out[:, cut:] if rng.random() < 0.5 else out[:, :-cut]
    return out


@dataclass
class Read:
    text: str
    confs: list[float]
    sharpness: float
    source: str
    frame: int
    dists: Optional[list] = None  # OCR model's per-position character distributions (PARSeq)


@dataclass
class Vehicle:
    rec: RegistryRecord
    level: str
    color_obs: AttributeValue
    body_obs: AttributeValue
    reads: dict[str, list[Read]] = field(default_factory=dict)  # backend -> reads
    ms: dict[str, float] = field(default_factory=dict)


def noisy_attr(true: str, choices: list[str], rng: random.Random) -> AttributeValue:
    r = rng.random()
    if r < 0.10:
        wrong = rng.choice([c for c in choices if c != true])
        return AttributeValue(value=wrong, confidence=0.55, top2=[(wrong, 0.55), (true, 0.3)])
    if r < 0.20:
        return AttributeValue(value="uncertain", confidence=0.33, uncertain=True, top2=[(true, 0.33), (choices[0], 0.3)])
    return AttributeValue(value=true, confidence=0.85, top2=[(true, 0.85)])


def build_vehicles(registry: list[RegistryRecord], n: int, ocrs: dict, cfg: PrismConfig) -> list[Vehicle]:
    from make_demo_clips import render_plate
    from prism.config import BODY_TYPES, COLORS

    rng_py = random.Random(SEED)
    rng = np.random.default_rng(SEED)
    picks = rng_py.sample(registry, n)
    levels = list(LEVELS)
    out = []
    for i, rec in enumerate(picks):
        level = levels[i % 3]
        lvl = LEVELS[level]
        lines = plate_lines(rec)
        n_chars = len(rec.plate)
        k = int(rng.integers(lvl["occl"][0], lvl["occl"][1] + 1))
        occl = sorted(rng.choice(n_chars, size=k, replace=False).tolist()) if k else []
        base = render_plate(lines, occl, rng)
        v = Vehicle(rec, level, noisy_attr(rec.color, list(COLORS), rng_py), noisy_attr(rec.body_type, list(BODY_TYPES), rng_py))
        crops = []
        for f in range(FRAMES_PER_VEHICLE):
            img = degrade_plate(base, lvl, rng, len(lines) == 2)
            s = laplacian_sharpness(img)
            if s < cfg.plate.min_sharpness or img.shape[1] < cfg.plate.min_width_px:
                continue  # same quality filter as Stage 2
            crops.append((f, img, s))
        for name, ocr in ocrs.items():
            reads = []
            t = time.perf_counter()
            for f, img, s in crops:
                for crop in (PlateCrop(img, "raw"), PlateCrop(clahe_copy(img, cfg.plate), "clahe")):
                    text, confs, dists, _ = read_plate_crop_dist(ocr, crop, is_two_line(img, cfg.plate), cfg.plate)
                    reads.append(Read(text, confs, s, crop.source, f, dists))
            v.reads[name] = reads
            v.ms[name] = 1000 * (time.perf_counter() - t) / max(1, len(reads))
        out.append(v)
        if (i + 1) % 20 == 0:
            print(f"  rendered and read {i + 1}/{n} vehicles")
    return out


# --------------------------------------------------------------------------- variants
def _clean(text: str, confs: list[float], cfg: PrismConfig) -> tuple[list[str], list[float]]:
    ch, cs = [], []
    confs = (list(confs) + [0.0] * len(text))[: len(text)]
    for c, p in zip(text, confs):
        if c in cfg.ocr.separators:
            continue
        ch.append(c.upper())
        cs.append(p)
    return ch, cs


def _modal_align(seqs: list[list[str]]) -> tuple[int, list[list[Optional[str]]]]:
    seqs = [s for s in seqs if s]
    if not seqs:
        return 0, []
    L = Counter(len(s) for s in seqs).most_common(1)[0][0]
    ref = next(s for s in seqs if len(s) == L)
    cols: list[list[Optional[str]]] = [[] for _ in range(L)]
    for s in seqs:
        m = align(s, ref)
        for k, idx in enumerate(m):
            cols[k].append(s[idx] if idx is not None else None)
    return L, cols


def variant_plate(variant: str, reads: list[Read], cfg: PrismConfig, check_reads: Optional[list[Read]] = None,
                  check_name: str = "second OCR") -> str:
    """Fused plate for one ablation variant. `check_reads` are the other backend's reads of the same
    crops in the same order; the "full" variant cross-checks against them when cfg.ocr.cross_check."""
    if not reads:
        return ""
    if variant == "single":
        best = max((r for r in reads if r.source == "raw"), key=lambda r: r.sharpness, default=reads[0])
        ch, _ = _clean(best.text, best.confs, cfg)
        return "".join(c if c in ALNUM else UNKNOWN for c in ch)
    if variant == "majority":
        L, cols = _modal_align([_clean(r.text, r.confs, cfg)[0] for r in reads])
        out = []
        for col in cols:
            cnt = Counter(c for c in col if c and c in ALNUM)
            out.append(cnt.most_common(1)[0][0] if cnt else UNKNOWN)
        return "".join(out)
    if variant == "conf_mask":
        seqs = []
        for r in reads:
            ch, cs = _clean(r.text, r.confs, cfg)
            seqs.append(confidence_mask(ch, cs, cfg.ocr.char_conf)[0])
        L, cols = _modal_align(seqs)
        out = []
        for col in cols:
            cnt = Counter(c for c in col if c and c != UNKNOWN)
            out.append(cnt.most_common(1)[0][0] if cnt else UNKNOWN)
        return "".join(out)
    obs = []
    for i, r in enumerate(reads):
        if variant == "two_condition":
            ch, cs = _clean(r.text, r.confs, cfg)
            masked = confidence_mask(ch, cs, cfg.ocr.char_conf)[0]
            obs.append(ReadObservation(f"R{i}", masked, ch, cs, r.sharpness))
        else:  # full / no_cross_check (layout-constrained decoding when the backend exposes distributions) / no_layout
            m = mask_read(r.text, r.confs, cfg.ocr, r.dists if variant != "no_layout" else None)
            if variant == "full" and cfg.ocr.cross_check and check_reads and i < len(check_reads):
                c = check_reads[i]
                assert (c.frame, c.source) == (r.frame, r.source), "cross-check reads must pair crop by crop"
                m = cross_check(m, c.text, c.confs, cfg.ocr, check_name)
            obs.append(observation(f"R{i}", m, r.sharpness))
    return fuse_reads(obs, cfg.fusion, apply_format=variant in FULL_VARIANTS).text


def char_scores(fused: str, truth: str) -> tuple[int, int, int]:
    """(committed, wrong committed, correct) with fused aligned to the truth."""
    if not fused:
        return 0, 0, 0
    mapping = align(list(fused), list(truth)) if len(fused) != len(truth) else list(range(len(truth)))
    committed = sum(1 for c in fused if c != UNKNOWN)
    correct = 0
    for k, idx in enumerate(mapping):
        if idx is not None and fused[idx] != UNKNOWN and fused[idx] == truth[k]:
            correct += 1
    return committed, committed - correct, correct


VARIANTS = [
    ("single", "Best single frame, no fusion"),
    ("majority", "Majority vote, no confidence masking"),
    ("conf_mask", "+ confidence masking"),
    ("two_condition", "+ two-condition vote"),
    ("no_layout", "+ format check + coverage factor, format violations masked only"),
    ("no_cross_check", "+ layout-constrained decoding"),
    ("full", "+ OCR cross-check (full PRISM)"),
]
FULL_VARIANTS = ("full", "no_cross_check", "no_layout")  # variants with the format check + coverage factor


def evaluate_variant(vehicles: list[Vehicle], backend: str, variant: str, registry: list[RegistryRecord],
                     cfg: PrismConfig, tau: float) -> dict:
    mcfg = cfg.match if variant in FULL_VARIANTS else with_overrides(cfg, match={"coverage_full": 1}).match
    tot = dict(committed=0, wrong=0, correct=0, chars=0, top1=0, top5=0, matched_correct=0, fm=0, n=0)
    per_level: dict[str, dict] = {}
    errors: list[dict] = []
    other = next((b for b in (vehicles[0].reads if vehicles else {}) if b != backend), None)
    for v in vehicles:
        plate = variant_plate(variant, v.reads.get(backend, []), cfg, v.reads.get(other) if other else None,
                              other or "second OCR")
        c, w, ok = char_scores(plate, v.rec.plate)
        if w:
            errors.append({"truth": v.rec.plate, "fused": plate, "level": v.level,
                           "reads": [r.text for r in v.reads.get(backend, [])][:8]})
        r = match(plate, registry, mcfg, v.color_obs, v.body_obs, None, tau)
        ids = [x.registry_id for x in r.top_candidates]
        without = [x for x in registry if x.registry_id != v.rec.registry_id]
        r2 = match(plate, without, mcfg, v.color_obs, v.body_obs, None, tau)
        upd = dict(committed=c, wrong=w, correct=ok, chars=len(v.rec.plate),
                   top1=int(ids[:1] == [v.rec.registry_id]), top5=int(v.rec.registry_id in ids),
                   matched_correct=int(r.status == MatchStatus.MATCHED and ids[:1] == [v.rec.registry_id]),
                   fm=int(r2.status == MatchStatus.MATCHED), n=1)
        for d in (tot, per_level.setdefault(v.level, Counter())):
            for k, val in upd.items():
                d[k] = d.get(k, 0) + val

    def summary(d):
        n = max(1, d["n"])
        return {
            "committed_char_error": round(d["wrong"] / max(1, d["committed"]), 4),
            "recovery_rate": round(d["correct"] / max(1, d["chars"]), 4),
            "top1": round(d["top1"] / n, 4), "top5": round(d["top5"] / n, 4),
            "matched_correct": round(d["matched_correct"] / n, 4),
            "false_match_rate": round(d["fm"] / n, 4), "n": d["n"],
        }

    out = summary(tot)
    out["by_level"] = {k: summary(d) for k, d in per_level.items()}
    out["error_samples"] = errors[:15]
    return out


def tau_sweep(vehicles, backend, registry, cfg) -> list[dict]:
    rows = []
    for tau in np.round(np.arange(0.30, 0.96, 0.05), 2):
        m = evaluate_variant(vehicles, backend, "full", registry, cfg, float(tau))
        rows.append({"tau": float(tau), "top1_matched": m["matched_correct"], "false_match_rate": m["false_match_rate"]})
    return rows


def plot_sweep(rows: list[dict], path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    t = [r["tau"] for r in rows]
    fig, ax = plt.subplots(figsize=(6, 3.4), dpi=120)
    ax.plot(t, [r["top1_matched"] for r in rows], "o-", label="correct MATCHED (top-1)")
    ax.plot(t, [r["false_match_rate"] for r in rows], "s-", color="crimson", label="false-match rate (true vehicle removed)")
    ax.axhline(0.05, ls="--", color="grey", lw=1)
    ax.set_xlabel("match threshold tau")
    ax.set_ylim(0, 1.02)
    ax.legend(fontsize=8, loc="center left")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


# --------------------------------------------------------------------------- part B: clips
CASE_CACHE = ROOT / "runs" / "eval_cache"
RESCORE_CACHED = False


def evaluate_clips(label_files: list[Path], cfg: PrismConfig) -> list[dict]:
    from prism.pipeline import rescore_case, run_pipeline
    from prism.schemas import CaseResult

    registry = load_registry()
    rows = []
    for lf in label_files:
        labels = json.loads(lf.read_text())["clips"]
        for lab in labels:
            clip = lf.parent / lab["clip"]
            if not clip.exists():
                continue
            cache = CASE_CACHE / f"{clip.stem}.json"
            t = time.perf_counter()
            if RESCORE_CACHED and cache.exists():
                # Stage 5 only: reuse the vision results, rerun matching with the current code.
                old = CaseResult.model_validate_json(cache.read_text(encoding="utf-8"))
                secs = old.stage_timings.get("total", 0.0)
                case = rescore_case(old, cfg, registry=registry)
            else:
                case = run_pipeline(clip, cfg=cfg)
                secs = time.perf_counter() - t
                CASE_CACHE.mkdir(parents=True, exist_ok=True)
                cache.write_text(case.model_dump_json(), encoding="utf-8")
            tr = next((x for x in case.tracks if x.track_id == case.primary_track_id), None)
            row = {"clip": lab["clip"], "degradation": lab.get("degradation", "none"), "expected": lab["expected_status"],
                   "seconds": round(secs, 1), "tracks": len(case.tracks), "body_type": lab["body_type"]}
            if tr is None:
                row.update(status="NO TRACK", plate="", top1=False, top5=False)
                rows.append(row)
                continue
            c, w, ok = char_scores(tr.fused.text, lab["plate"])
            ids = [x.registry_id for x in tr.match.top_candidates]
            row.update(
                plate=tr.fused.text, truth=lab["plate"], status=tr.match.status.value,
                top_candidate=ids[0] if ids else None, top_score=tr.match.top_candidates[0].score if ids else None,
                committed=c, wrong=w, correct=ok, n_chars=len(lab["plate"]),
                top1=bool(lab["registry_id"]) and ids[:1] == [lab["registry_id"]],
                top5=bool(lab["registry_id"]) and lab["registry_id"] in ids,
                color_ok=tr.attributes.color.value == lab["color"], body_ok=tr.attributes.body_type.value == lab["body_type"],
                night=lab.get("night", False),
            )
            if lab["registry_id"]:
                without = [r for r in registry if r.registry_id != lab["registry_id"]]
                fm = rescore_case(case, cfg, registry=without)
                ftr = next(x for x in fm.tracks if x.track_id == case.primary_track_id)
                row["false_match"] = ftr.match.status == MatchStatus.MATCHED
            else:
                row["false_match"] = tr.match.status == MatchStatus.MATCHED
            rows.append(row)
            print(f"  {lab['clip']}: {row.get('plate')} -> {row.get('status')} ({row['seconds']} s)")
    return rows


# --------------------------------------------------------------------------- output
def pct(x: float) -> str:
    return f"{100 * x:.1f}%"


def write_outputs(res: dict) -> str:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "evaluation.json").write_text(json.dumps(res, indent=2))
    md = [f"Synthetic plate-sequence benchmark: {res['n_vehicles']} registry vehicles x {FRAMES_PER_VEHICLE} degraded "
          f"frames (raw + CLAHE reads), easy/medium/hard thirds, tau = {res['tau']:.2f}. Device: {res['device']}.", ""]
    md += ["**OCR benchmark** (full PRISM fusion + matching; each backend is cross-checked by the other, "
           "ms/read is the backend's own time)", "",
           "| OCR backend | Committed-char error | Recovery | Top-1 | Top-5 | False-match | ms/read |",
           "|---|---|---|---|---|---|---|"]
    for name, m in res["ocr_benchmark"].items():
        md.append(f"| {name} | {pct(m['committed_char_error'])} | {pct(m['recovery_rate'])} | {pct(m['top1'])} | "
                  f"{pct(m['top5'])} | {pct(m['false_match_rate'])} | {m['ms_per_read']:.1f} |")
    md += ["", f"Winner: **{res['ocr_winner']}** (highest top-1 with false-match <= 5%, then lowest committed error).", ""]
    md += [f"**Ablation** ({res['ocr_winner']})", "",
           "| Variant | Committed error | Recovery | Top-5 | False-match |", "|---|---|---|---|---|"]
    for key, label in VARIANTS:
        m = res["ablation"][key]
        md.append(f"| {label} | {pct(m['committed_char_error'])} | {pct(m['recovery_rate'])} | {pct(m['top5'])} | {pct(m['false_match_rate'])} |")
    md += ["", "**Full PRISM by difficulty**", "", "| Level | Committed error | Recovery | Top-1 | Top-5 | False-match |",
           "|---|---|---|---|---|---|"]
    for lvl, m in sorted(res["ablation"]["full"]["by_level"].items(), key=lambda kv: list(LEVELS).index(kv[0])):
        md.append(f"| {lvl} | {pct(m['committed_char_error'])} | {pct(m['recovery_rate'])} | {pct(m['top1'])} | {pct(m['top5'])} | {pct(m['false_match_rate'])} |")
    s = res["tau_choice"]
    md += ["", f"**Threshold sweep**: lowest tau with false-match rate <= 5% is **{s['tau']:.2f}** "
               f"(false-match {pct(s['false_match_rate'])}, correct MATCHED {pct(s['top1_matched'])}). "
               "Plot: `reports/tau_sweep.png`."]
    if res.get("clips"):
        rows = res["clips"]
        md += ["", "**End-to-end clips** (full pipeline: YOLO11 + ByteTrack + fast-alpr + OCR + OpenCLIP)", "",
               "| Clip | Degradation | Fused plate | Status (expected) | Top-1 | Committed wrong | Colour/body | False-match | s |",
               "|---|---|---|---|---|---|---|---|---|"]
        for r in rows:
            md.append(f"| {r['clip']} | {r['degradation']} | `{r.get('plate', '')}` | {r.get('status')} ({r['expected']}) | "
                      f"{'yes' if r.get('top1') else 'no'} | {r.get('wrong', '-')}/{r.get('committed', '-')} | "
                      f"{'ok' if r.get('color_ok') else 'x'}/{'ok' if r.get('body_ok') else 'x'} | "
                      f"{'YES' if r.get('false_match') else 'no'} | {r['seconds']} |")
        cs = res["clip_summary"]
        md += ["", f"Clips ({len(rows)}): status as designed {pct(cs.get('status_as_designed', 0))}, "
                   f"committed-char error {pct(cs['committed_char_error'])}, recovery {pct(cs['recovery_rate'])}, "
                   f"top-1 {pct(cs['top1'])}, top-5 {pct(cs['top5'])}, MATCHED to the wrong vehicle "
                   f"{cs.get('wrong_matched', 0)}, false-match with true vehicle removed {pct(cs['false_match_rate'])}, "
                   f"colour {pct(cs['color_acc'])}, body {pct(cs['body_acc'])}, mean {cs['mean_seconds']:.1f} s/clip."]
        if cs.get("body_by_type"):
            md += ["", "By body type (clips incl. degraded versions): " + "; ".join(
                f"{b} {d['n']} clips, body type {pct(d['acc'])}, top-1 {pct(d['top1'])}"
                for b, d in cs["body_by_type"].items()) + "."]
    text = "\n".join(md)
    (REPORTS_DIR / "evaluation.md").write_text(text + "\n", encoding="utf-8")
    readme = ROOT / "README.md"
    if readme.exists():
        body = readme.read_text(encoding="utf-8")
        a, b = "<!-- EVAL:START -->", "<!-- EVAL:END -->"
        if a in body and b in body:
            pre, rest = body.split(a, 1)
            _, post = rest.split(b, 1)
            readme.write_text(pre + a + "\n" + text + "\n" + b + post, encoding="utf-8")
    return text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=120)
    ap.add_argument("--clips", action="store_true")
    ap.add_argument("--degraded", action="store_true")
    ap.add_argument("--reuse-synthetic", action="store_true",
                    help="keep Part A from reports/evaluation.json and rerun only the clip benchmark")
    ap.add_argument("--rescore-cached", action="store_true",
                    help="reuse cached vision results in runs/eval_cache and rerun only Stage 5 (matching)")
    args = ap.parse_args()
    global RESCORE_CACHED
    RESCORE_CACHED = args.rescore_cached
    cfg = PrismConfig()
    set_seeds(cfg.seed)
    device = resolve_device(cfg.device)
    registry = load_registry()
    prev = REPORTS_DIR / "evaluation.json"
    if args.reuse_synthetic and prev.exists():
        res = json.loads(prev.read_text())
        files = [TEST_CLIPS_DIR / "labels.json"]
        if args.degraded and (TEST_CLIPS_DIR / "degraded" / "labels.json").exists():
            files.append(TEST_CLIPS_DIR / "degraded" / "labels.json")
        rows = evaluate_clips([f for f in files if f.exists()], cfg)
        res["clips"], res["clip_summary"] = rows, clip_summary(rows)
        print(write_outputs(res))
        return
    ocrs = {}
    for name, ctor in (("parseq", lambda: ParseqOCR(cfg.ocr.parseq_variant, device)),
                       ("fast_plate_ocr", lambda: FastPlateOCR(cfg.ocr.fast_plate_ocr_model, device))):
        try:
            ocrs[name] = ctor()
        except Exception as exc:
            print(f"[warn] {name} unavailable: {exc}")
    print(f"Part A: {args.n} synthetic vehicles, backends {list(ocrs)}")
    vehicles = build_vehicles(registry, args.n, ocrs, cfg)
    tau = cfg.match.tau
    bench = {}
    for name in ocrs:
        m = evaluate_variant(vehicles, name, "full", registry, cfg, tau)
        m["ms_per_read"] = round(float(np.mean([v.ms[name] for v in vehicles])), 2)
        bench[name] = m
    # "Keep the more accurate one": highest top-1 among backends whose false-match rate is within
    # the 5% budget; ties broken by lower committed-character error.
    safe = [k for k in bench if bench[k]["false_match_rate"] <= 0.05] or list(bench)
    winner = max(safe, key=lambda k: (bench[k]["top1"], -bench[k]["committed_char_error"]))
    if cfg.ocr.cross_check and len(ocrs) > 1:
        # the same backends without the cross-check, for comparison (not candidates for the winner)
        for name in list(ocrs):
            m = evaluate_variant(vehicles, name, "no_cross_check", registry, cfg, tau)
            m["ms_per_read"] = bench[name]["ms_per_read"]
            bench[f"{name} alone (no cross-check)"] = m
    ablation = {key: evaluate_variant(vehicles, winner, key, registry, cfg, tau) for key, _ in VARIANTS}
    sweep = tau_sweep(vehicles, winner, registry, cfg)
    ok = [r for r in sweep if r["false_match_rate"] <= 0.05]
    choice = min(ok, key=lambda r: r["tau"]) if ok else max(sweep, key=lambda r: r["tau"])
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    plot_sweep(sweep, REPORTS_DIR / "tau_sweep.png")
    res = {"n_vehicles": len(vehicles), "tau": tau, "device": device, "ocr_benchmark": bench, "ocr_winner": winner,
           "ablation": ablation, "tau_sweep": sweep, "tau_choice": choice}
    if args.clips:
        files = [TEST_CLIPS_DIR / "labels.json"]
        if args.degraded and (TEST_CLIPS_DIR / "degraded" / "labels.json").exists():
            files.append(TEST_CLIPS_DIR / "degraded" / "labels.json")
        print("Part B: clips")
        rows = evaluate_clips([f for f in files if f.exists()], cfg)
        res["clips"], res["clip_summary"] = rows, clip_summary(rows)
    print(write_outputs(res))


def clip_summary(rows: list[dict]) -> dict:
    n = max(1, len(rows))
    reg = [r for r in rows if r["expected"] != "NO CONFIDENT MATCH"]
    return {
        "committed_char_error": sum(r.get("wrong", 0) for r in rows) / max(1, sum(r.get("committed", 0) for r in rows)),
        "recovery_rate": sum(r.get("correct", 0) for r in rows) / max(1, sum(r.get("n_chars", 0) for r in rows)),
        "top1": sum(bool(r.get("top1")) for r in reg) / max(1, len(reg)),
        "top5": sum(bool(r.get("top5")) for r in reg) / max(1, len(reg)),
        "false_match_rate": sum(bool(r.get("false_match")) for r in rows) / n,
        "wrong_matched": sum(1 for r in rows if r.get("status") == "MATCHED" and not r.get("top1")),
        "status_as_designed": sum(1 for r in rows if r.get("status") == r["expected"]) / n,
        "color_acc": sum(bool(r.get("color_ok")) for r in rows) / n,
        "body_acc": sum(bool(r.get("body_ok")) for r in rows) / n,
        "body_by_type": {b: {"n": len(g), "acc": sum(bool(r.get("body_ok")) for r in g) / len(g),
                             "top1": sum(bool(r.get("top1")) for r in g if r["expected"] != "NO CONFIDENT MATCH")
                             / max(1, sum(1 for r in g if r["expected"] != "NO CONFIDENT MATCH"))}
                         for b in sorted({r.get("body_type", "?") for r in rows})
                         for g in [[r for r in rows if r.get("body_type", "?") == b]]},
        "mean_seconds": float(np.mean([r["seconds"] for r in rows])) if rows else 0.0,
    }


if __name__ == "__main__":
    main()
