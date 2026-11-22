"""Forensic report: Jinja2 HTML (self-contained, images embedded) + PDF via headless Chromium.

PDF is printed with Playwright/Chromium (WeasyPrint needs GTK, which is painful on Windows).
If Chromium is unavailable, the HTML report is returned instead with a clear note.
"""

from __future__ import annotations

import base64
import logging
import mimetypes
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from jinja2 import Environment, FileSystemLoader, select_autoescape

from prism.config import RUNS_DIR
from prism.custody import sha256_bytes, sha256_file
from prism.plate_grammar import pretty
from prism.schemas import CaseResult, FusedPlate, TrackResult

log = logging.getLogger("prism.report")
TEMPLATE_DIR = Path(__file__).parent / "templates"
LIMITATIONS = "PRISM output supports an investigator's decision. It does not identify a vehicle on its own."


def artifact_path(url: Optional[str], runs_dir: Path = RUNS_DIR) -> Optional[Path]:
    if not url or not url.startswith("/artifacts/"):
        return None
    p = (runs_dir / url[len("/artifacts/"):]).resolve()
    try:
        p.relative_to(runs_dir.resolve())
    except ValueError:
        return None
    return p if p.exists() else None


def data_uri(url: Optional[str], runs_dir: Path = RUNS_DIR) -> Optional[str]:
    p = artifact_path(url, runs_dir)
    if p is None:
        return None
    mime = mimetypes.guess_type(p.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"


# --------------------------------------------------------------------------- evidence strip image
def evidence_strip_png(fp: FusedPlate, max_rows: int = 24) -> Optional[bytes]:
    """One column per plate position, one row per read; cell shade = vote weight."""
    if not fp.length or not fp.positions:
        return None
    reads: list[str] = []
    for p in fp.positions:
        for c in p.cells:
            if c.read_id not in reads:
                reads.append(c.read_id)
    reads = reads[:max_rows]
    cw, ch, lw, hh = 46, 30, 70, 60
    W, H = lw + cw * fp.length, hh + ch * len(reads) + 6
    img = np.full((H, W, 3), 255, np.uint8)
    font = cv2.FONT_HERSHEY_SIMPLEX
    maxw = max((c.weight for p in fp.positions for c in p.cells), default=1.0) or 1.0
    for k, p in enumerate(fp.positions):
        x = lw + k * cw
        color = {"video": (60, 60, 60), "video+hint": (60, 60, 60), "investigator-supplied": (200, 110, 30),
                 "unknown": (0, 150, 230), "conflict": (40, 40, 220)}[p.source]
        cv2.putText(img, p.char, (x + 14, 30), font, 0.9, color, 2, cv2.LINE_AA)
        share = p.confidence if p.char != "?" else (max(p.votes.values()) / p.total_weight if p.total_weight else 0)
        cv2.rectangle(img, (x + 4, 42), (x + cw - 4, 50), (230, 230, 230), -1)
        cv2.rectangle(img, (x + 4, 42), (x + 4 + int((cw - 8) * share), 50), (90, 160, 60), -1)
        cv2.putText(img, str(k + 1), (x + 18, H - 0), font, 0.3, (150, 150, 150), 1)
        cells = {c.read_id: c for c in p.cells}
        for r, rid in enumerate(reads):
            y = hh + r * ch
            c = cells.get(rid)
            if c is None or c.char is None:
                cv2.rectangle(img, (x + 1, y + 1), (x + cw - 1, y + ch - 1), (245, 245, 245), -1)
                continue
            if c.char == "?":
                cv2.rectangle(img, (x + 1, y + 1), (x + cw - 1, y + ch - 1), (215, 240, 255), -1)
                cv2.putText(img, (c.raw_char or "?").upper(), (x + 16, y + 21), font, 0.55, (0, 140, 230), 1, cv2.LINE_AA)
                continue
            t = min(1.0, c.weight / maxw)
            shade = (int(255 - 150 * t), int(245 - 110 * t), int(235 - 40 * t))
            cv2.rectangle(img, (x + 1, y + 1), (x + cw - 1, y + ch - 1), shade, -1)
            txt_col = (30, 30, 30) if c.char == p.char or p.char == "?" else (40, 40, 200)
            cv2.putText(img, c.char, (x + 15, y + 21), font, 0.6, txt_col, 2, cv2.LINE_AA)
    for r, rid in enumerate(reads):
        cv2.putText(img, rid, (6, hh + r * ch + 20), font, 0.45, (80, 80, 80), 1, cv2.LINE_AA)
    cv2.putText(img, "fused", (6, 30), font, 0.45, (80, 80, 80), 1, cv2.LINE_AA)
    ok, buf = cv2.imencode(".png", img)
    return buf.tobytes() if ok else None


# --------------------------------------------------------------------------- render
def _env() -> Environment:
    env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)), autoescape=select_autoescape(["html", "j2"]))
    env.filters["pct"] = lambda v: f"{100 * float(v):.0f}%"
    env.filters["f2"] = lambda v: "-" if v is None else f"{float(v):.2f}"
    env.filters["pretty"] = pretty
    env.filters["ts"] = lambda t: f"{int(t // 60):02d}:{t % 60:04.1f}"
    return env


def _track_view(t: TrackResult, runs_dir: Path, extra: list[dict]) -> dict:
    strip = evidence_strip_png(t.fused)
    strip_uri = None
    if strip:
        strip_uri = "data:image/png;base64," + base64.b64encode(strip).decode()
        extra.append({"path": f"report:evidence_strip_track{t.track_id}_{t.clip_role}.png",
                      "sha256": sha256_bytes(strip), "kind": "evidence_strip (generated for this report)"})
    frames = []
    for f in t.frames:
        frames.append({"f": f, "plate": data_uri(f.plate_crop_url, runs_dir),
                       "veh": data_uri(f.vehicle_crop_url, runs_dir) if f.source == "raw" else None})
    return {"t": t, "best": data_uri(t.best_crop_url, runs_dir), "strip": strip_uri, "frames": frames}


def render_html(case: CaseResult, runs_dir: Path = RUNS_DIR, cfg_table: Optional[dict] = None) -> str:
    extra: list[dict] = []
    tracks = [_track_view(t, runs_dir, extra) for t in _ordered(case)]
    tracks_b = [_track_view(t, runs_dir, extra) for t in (case.crosscam.tracks_b if case.crosscam else [])]
    tpl = _env().get_template("report.html.j2")
    cfg = case.custody.config if case.custody else (cfg_table or {})
    return tpl.render(case=case, tracks=tracks, tracks_b=tracks_b, extra_hashes=extra, limitations=LIMITATIONS,
                      thresholds=_threshold_table(cfg, case.threshold))


def _ordered(case: CaseResult) -> list[TrackResult]:
    prim = [t for t in case.tracks if t.track_id == case.primary_track_id]
    return prim + [t for t in case.tracks if t.track_id != case.primary_track_id]


def _threshold_table(cfg: dict, tau: float) -> list[tuple[str, str]]:
    if not cfg:
        return [("Match threshold tau", f"{tau:.2f}")]
    m, o, p, f, a, r, i = (cfg.get(k, {}) for k in ("match", "ocr", "plate", "fusion", "attributes", "reid", "ingest"))
    return [
        ("Match threshold tau (used)", f"{tau:.2f}"),
        ("OCR character confidence tau_char", f"{o.get('char_conf')}"),
        ("Plate sharpness minimum (Laplacian var.)", f"{p.get('min_sharpness')}"),
        ("Plate minimum width (px)", f"{p.get('min_width_px')}"),
        ("Frames kept per track", f"{p.get('top_k_frames')}"),
        ("Fusion vote: min evidence W(a*)", f"{f.get('vote_min_weight')}"),
        ("Fusion vote: min winner share", f"{f.get('vote_min_share')}"),
        ("Sharpness reference / cap", f"{f.get('s_ref')} / {f.get('sharpness_cap')}"),
        ("Weights plate / colour / body", f"{m.get('w_plate')} / {m.get('w_color')} / {m.get('w_body')}"),
        ("Low-light weights plate / colour", f"{m.get('low_light_w_plate')} / {m.get('low_light_w_color')}"),
        ("Low-light brightness threshold", f"{i.get('low_light_brightness')}"),
        ("Make/model bonus (min conf)", f"+{m.get('mm_bonus')} ({m.get('mm_min_conf')})"),
        ("No-plate score cap", f"{m.get('no_plate_cap')}"),
        ("Min known characters for MATCHED", f"{m.get('min_known_for_match')}"),
        ("Ambiguity gap", f"{m.get('ambiguity_gap')}"),
        ("Coverage: chars for full weight", f"{m.get('coverage_full')}"),
        ("Confusable-pair credit", f"{m.get('confusable_credit')}"),
        ("Attribute 'uncertain' below", f"{a.get('uncertain_below')}"),
        ("Re-ID thresholds", ", ".join(f"{k} {v}" for k, v in (r.get("thresholds") or {}).items())),
    ]


def html_to_pdf(html: str, out_path: Path) -> bool:
    """Print HTML to PDF with headless Chromium. Returns False if Chromium is unavailable."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.warning("Playwright not installed; PDF unavailable")
        return False
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page()
            page.set_content(html, wait_until="load")
            page.pdf(path=str(out_path), format="A4", print_background=True,
                     margin={"top": "14mm", "bottom": "14mm", "left": "10mm", "right": "10mm"})
            browser.close()
        return out_path.exists() and out_path.stat().st_size > 0
    except Exception as exc:
        log.warning("Chromium PDF export failed (%s); falling back to HTML", exc)
        return False


def write_report(case: CaseResult, fmt: str = "html", out_dir: Optional[Path] = None,
                 runs_dir: Path = RUNS_DIR) -> tuple[Path, str]:
    """Write the report. Returns (path, actual_format); actual_format is 'html' if PDF failed."""
    out_dir = Path(out_dir) if out_dir else runs_dir / case.case_id
    out_dir.mkdir(parents=True, exist_ok=True)
    html = render_html(case, runs_dir)
    html_path = out_dir / f"PRISM_report_{case.case_id}.html"
    html_path.write_text(html, encoding="utf-8")
    if fmt == "pdf":
        pdf_path = out_dir / f"PRISM_report_{case.case_id}.pdf"
        if html_to_pdf(html, pdf_path):
            return pdf_path, "pdf"
    return html_path, "html"


def report_sha256(path: Path) -> str:
    return sha256_file(path)
