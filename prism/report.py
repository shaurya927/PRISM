"""Forensic report: Jinja2 HTML (self-contained, images embedded) + PDF via headless Chromium.

PDF is printed with Playwright/Chromium (WeasyPrint needs GTK, which is painful on Windows).
If Chromium is unavailable, the HTML report is returned instead with a clear note.
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import re
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup, escape

from prism.config import RUNS_DIR
from prism.custody import sha256_bytes, sha256_file
from prism.plate_grammar import pretty
from prism.schemas import CaseResult, FrameRead, FusedPlate, TrackResult

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
            if c.layout:  # layout-constrained read: dashed frame and a small "L"
                for xx in range(x + 2, x + cw - 2, 6):
                    cv2.line(img, (xx, y + 2), (min(xx + 3, x + cw - 2), y + 2), (140, 70, 150), 1)
                    cv2.line(img, (xx, y + ch - 2), (min(xx + 3, x + cw - 2), y + ch - 2), (140, 70, 150), 1)
                cv2.putText(img, "L", (x + cw - 10, y + 10), font, 0.28, (140, 70, 150), 1, cv2.LINE_AA)
    for r, rid in enumerate(reads):
        cv2.putText(img, rid, (6, hh + r * ch + 20), font, 0.45, (80, 80, 80), 1, cv2.LINE_AA)
    cv2.putText(img, "fused", (6, 30), font, 0.45, (80, 80, 80), 1, cv2.LINE_AA)
    ok, buf = cv2.imencode(".png", img)
    return buf.tobytes() if ok else None


# --------------------------------------------------------------------------- text helpers for the template
def _q_html(s: str) -> str:
    """Escaped text with every '?' shown in amber (unknown characters)."""
    return "".join('<span class="q">?</span>' if ch == "?" else escape(ch) for ch in s)


def _qtext(s: Optional[str]) -> Markup:
    return Markup(_q_html(s or ""))


def _ticks(s: Optional[str]) -> Markup:
    """`CG04?X48?1` spans become bold monospace plates; everything else is escaped."""
    out = []
    for i, part in enumerate(re.split(r"`([^`]*)`", s or "")):
        out.append(f'<span class="plate">{_q_html(part)}</span>' if i % 2 else str(escape(part)))
    return Markup("".join(out))


def _narrative(text: Optional[str]) -> list[Markup]:
    """One paragraph per vehicle track, with "Vehicle track N" in bold."""
    paras = [p.strip() for p in re.split(r"(?=\bVehicle track \d+)", text or "") if p.strip()]
    out = []
    for p in paras:
        m = re.match(r"(Vehicle track \d+)(.*)", p, re.S)
        out.append(Markup(f"<b>{escape(m.group(1))}</b>") + _ticks(m.group(2)) if m else _ticks(p))
    return out


def _mismatch(s: str) -> Markup:
    """'Mismatch at position 5: video shows ...' -> bold red label, plain detail."""
    head, sep, tail = s.partition(":")
    if not sep:
        return Markup(f'<span class="mm">{escape(s)}</span>')
    return Markup(f'<span class="mm">{escape(head)}:</span>{escape(tail)}')


def _thousands(s: str) -> str:
    return re.sub(r"\b(\d{4,})\b", lambda m: f"{int(m.group(1)):,}", s or "")


def _frame_audit(f: FrameRead, tau_char: float) -> list[str]:
    """Plain-language masking audit for one read: format/layout decisions, then the OCR cross-check."""
    out: list[str] = []
    for msg in f.format_conflicts:
        if re.match(r"position \d+: '.' masked to '\?': ", msg):
            continue  # cross-check masks are summarised below, position by position
        m = re.match(r"cross-check: (.*?) read '(.*)' \((\d+) characters against (\d+)\); too different in length to compare(.*)$", msg)
        if m:
            confirmed = "; no character confirmed" if m.group(5) else ""
            out.append(f"Cross-check read '{m.group(2)}' ({m.group(3)} vs {m.group(4)} chars; too different in length "
                       f"to compare{confirmed}).")
            continue
        msg = re.sub(r"^position (\d+): ", r"Pos \1 ", msg)
        out.append(msg[0].upper() + msg[1:] + ("" if msg.endswith(".") else "."))
    masked = [(i, c) for i, c in enumerate(f.chars) if c.reason == "ocr_disagreement"]
    if masked:
        if all(c.check_char is None for _, c in masked):
            names = ", ".join(f"pos {i + 1} '{c.raw_char}'" for i, c in masked)
            out.append(f"{names[0].upper()}{names[1:]} masked to '?': not confirmed by the cross-check model.")
        else:
            parts = []
            for i, c in masked:
                if c.check_char is None:
                    why = "not confirmed"
                elif c.check_conf is not None and c.check_char != c.raw_char:
                    why = f"check read '{c.check_char}' at {c.check_conf:.2f}"
                else:
                    why = "not confirmed"
                parts.append(f"pos {i + 1} '{c.raw_char}' masked ({why})")
            s = "; ".join(parts)
            out.append(s[0].upper() + s[1:] + ".")
    bad = [f"pos {i + 1} '{c.raw_char}'" for i, c in enumerate(f.chars) if c.reason == "non_alphanumeric"]
    if bad:
        s = ", ".join(bad)
        out.append(f"{s[0].upper()}{s[1:]}: not A-Z/0-9, masked to '?'.")
    if f.chars and not out and all(c.reason == "low_confidence" for c in f.chars):
        out.append(f"All characters below confidence threshold (\u03c4char = {tau_char:.2f}).")
    return out


def _strip_rows(fp: FusedPlate) -> tuple[list[dict], bool]:
    """Evidence strip as table rows: one row per read, one cell per plate position."""
    reads: list[str] = []
    for p in fp.positions:
        for c in p.cells:
            if c.read_id not in reads:
                reads.append(c.read_id)
    has_layout = False
    rows = []
    for rid in reads:
        cells = []
        for p in fp.positions:
            c = next((x for x in p.cells if x.read_id == rid), None)
            if c is None or c.char is None:
                cells.append({"text": "\u2014", "cls": "gap"})
            elif c.char == "?":
                cells.append({"text": (c.raw_char or "?").upper(), "cls": "masked"})
            else:
                cls = "dis" if (p.char != "?" and c.char != p.char) else ("vote" if c.weight > 0 else "masked")
                if c.layout:
                    cls += " lay"
                    has_layout = True
                cells.append({"text": c.char, "cls": cls})
        rows.append({"read_id": rid, "cells": cells})
    return rows, has_layout


# --------------------------------------------------------------------------- render
def _env() -> Environment:
    env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)), autoescape=select_autoescape(["html", "j2"]))
    env.filters["pct"] = lambda v: f"{100 * float(v):.0f}%"
    env.filters["f2"] = lambda v: "-" if v is None else f"{float(v):.2f}"
    env.filters["pretty"] = pretty
    env.filters["ts"] = lambda t: f"{int(t // 60):02d}:{t % 60:04.1f}"
    env.filters["qtext"] = _qtext
    env.filters["ticks"] = _ticks
    env.filters["narrative"] = _narrative
    env.filters["mismatch"] = _mismatch
    env.filters["specificity"] = _thousands
    return env


def _track_view(t: TrackResult, runs_dir: Path, extra: list[dict], tau_char: float = 0.70) -> dict:
    # The PNG strip is still generated and hashed into the custody list; the report shows the same data as a table.
    strip = evidence_strip_png(t.fused)
    if strip:
        extra.append({"path": f"report:evidence_strip_track{t.track_id}_{t.clip_role}.png",
                      "sha256": sha256_bytes(strip), "kind": "evidence_strip (generated for this report)"})
    rows, has_layout = _strip_rows(t.fused) if t.fused.positions else ([], False)
    frames = [{"f": f, "audit": _frame_audit(f, tau_char)} for f in t.frames]
    return {"t": t, "strip_rows": rows, "strip_has_layout": has_layout, "frames": frames,
            "n_keyframes": len({f.frame_idx for f in t.frames})}


def render_html(case: CaseResult, runs_dir: Path = RUNS_DIR, cfg_table: Optional[dict] = None) -> str:
    extra: list[dict] = []
    cfg = case.custody.config if case.custody else (cfg_table or {})
    tau_char = float((cfg.get("ocr") or {}).get("char_conf", 0.70)) if cfg else 0.70
    tracks = [_track_view(t, runs_dir, extra, tau_char) for t in _ordered(case)]
    tracks_b = [_track_view(t, runs_dir, extra, tau_char) for t in (case.crosscam.tracks_b if case.crosscam else [])]
    tpl = _env().get_template("report.html.j2")
    return tpl.render(case=case, tracks=tracks, tracks_b=tracks_b, extra_hashes=extra, limitations=LIMITATIONS,
                      thresholds=_threshold_table(cfg, case.threshold))


def _ordered(case: CaseResult) -> list[TrackResult]:
    prim = [t for t in case.tracks if t.track_id == case.primary_track_id]
    return prim + [t for t in case.tracks if t.track_id != case.primary_track_id]


def _threshold_table(cfg: dict, tau: float) -> list[tuple[str, str]]:
    if not cfg:
        return [(Markup("Match threshold &tau;"), f"{tau:.2f}")]
    m, o, p, f, a, r, i = (cfg.get(k, {}) for k in ("match", "ocr", "plate", "fusion", "attributes", "reid", "ingest"))
    rows = [
        (Markup("Match threshold &tau; (used)"), f"{tau:.2f}"),
        (Markup("OCR character confidence &tau;<sub>char</sub>"), f"{o.get('char_conf')}"),
    ]
    if o.get("cross_check"):
        rows.append(("OCR cross-check (mode, veto / keep confidence)",
                     f"{o.get('cross_check_mode')}, {o.get('cross_check_veto_conf')} / {o.get('cross_check_keep_conf')}"))
    return rows + [
        ("Plate sharpness minimum (Laplacian var.)", f"{p.get('min_sharpness')}"),
        ("Plate minimum width (px)", f"{p.get('min_width_px')}"),
        ("Frames kept per track", f"{p.get('top_k_frames')}"),
        (Markup("Fusion vote: min evidence W(a<sup>*</sup>)"), f"{f.get('vote_min_weight')}"),
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
        ("Attribute \u2018uncertain\u2019 below", f"{a.get('uncertain_below')}"),
        ("Re-ID thresholds", ", ".join(f"{k} {v}" for k, v in (r.get("thresholds") or {}).items())),
    ]


REPORT_SUBTITLE = "Plate Recovery &amp; Identification from Surveillance Media"


def _footer_html(case_id: Optional[str]) -> str:
    """Chromium page footer: report name and case on the left, page N of M on the right."""
    case = f" &middot; Case {escape(case_id)}" if case_id else ""
    return (
        '<div style="width:100%; margin:0 18mm; padding-top:5px; border-top:1px solid #c9d3de; display:flex; '
        'justify-content:space-between; font-family:Helvetica, Arial, sans-serif; font-size:8px; color:#5f6e7e;">'
        f"<span>PRISM Forensic Report{case} &middot; {REPORT_SUBTITLE}</span>"
        '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'
    )


def html_to_pdf(html: str, out_path: Path, case_id: Optional[str] = None) -> bool:
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
                     display_header_footer=True, header_template="<span></span>",
                     footer_template=_footer_html(case_id),
                     margin={"top": "18mm", "bottom": "22mm", "left": "18mm", "right": "18mm"})
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
        if html_to_pdf(html, pdf_path, case.case_id):
            return pdf_path, "pdf"
    return html_path, "html"


def report_sha256(path: Path) -> str:
    return sha256_file(path)
