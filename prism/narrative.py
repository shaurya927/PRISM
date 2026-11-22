"""Evidence-checked plain-English case summary.

Generation:  an offline template (default), or a small local LLM via Ollama.
Checking:    every sentence must cite at least one valid evidence ID ([F42], [REG-0001],
             [POS-5], [T4]); every plate string, registry ID, frame index, time and
             number in it must appear in the result data. Failing sentences are removed;
             if more than `max_failed_sentences` fail, PRISM falls back to the template.
The language step sees only the structured result, never the video.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Optional, Sequence

from prism.config import NarrativeConfig, PrismConfig
from prism.plate_grammar import UNKNOWN
from prism.schemas import CaseResult, MatchStatus, Narrative, NarrativeSentence, TrackResult

log = logging.getLogger("prism.narrative")


# --------------------------------------------------------------------------- evidence index
@dataclass
class Evidence:
    citations: set[str] = field(default_factory=set)
    plates: set[str] = field(default_factory=set)
    registry_ids: set[str] = field(default_factory=set)
    frames: set[int] = field(default_factory=set)
    tracks: set[int] = field(default_factory=set)
    times: list[float] = field(default_factory=list)
    numbers: list[float] = field(default_factory=list)

    def add_num(self, *xs: Optional[float]) -> None:
        for x in xs:
            if x is not None:
                self.numbers.append(float(x))


def build_evidence(case: CaseResult, cfg: PrismConfig) -> Evidence:
    ev = Evidence()
    ev.add_num(case.threshold, cfg.ocr.char_conf, cfg.match.tau, cfg.match.min_known_for_match)
    if case.hint:
        ev.plates.add(case.hint)
    tracks = list(case.tracks) + (list(case.crosscam.tracks_b) if case.crosscam else [])
    for t in tracks:
        ev.citations.add(f"T{t.track_id}")
        ev.tracks.add(t.track_id)
        ev.times += [t.first_seen_sec, t.last_seen_sec]
        ev.add_num(t.track_id, t.n_detections, len(t.frames))
        for f in t.frames:
            ev.citations.add(f.read_id)
            ev.frames.add(f.frame_idx)
            ev.times.append(f.timestamp_sec)
            ev.add_num(f.frame_idx, f.sharpness)
            ev.add_num(*(c.conf for c in f.chars))
        fp = t.fused
        for p in (fp.text, fp.video_text, fp.hint):
            if p:
                ev.plates.add(p)
        ev.add_num(fp.length, fp.n_reads, fp.known_count, len(fp.text) - fp.known_count)
        for i in range(1, fp.length + 1):
            ev.citations.add(f"POS-{i}")
            ev.add_num(i)
        for p in fp.positions:
            ev.add_num(p.confidence, p.weight)
        a = t.attributes
        for av in (a.color, a.body_type, a.make_model):
            if av is not None:
                ev.add_num(av.confidence, *(p for _, p in av.top2))
        if t.match:
            m = t.match
            ev.add_num(m.threshold_used, m.known_count, m.specificity, m.registry_size, m.gap)
            for c in m.top_candidates:
                ev.citations.add(c.registry_id)
                ev.registry_ids.add(c.registry_id)
                ev.plates.add(c.plate)
                ev.add_num(c.rank, c.score, c.matched_known, c.known_count, c.breakdown.plate,
                           c.breakdown.color, c.breakdown.body, c.breakdown.make_model)
        if t.advisor and t.advisor.needed:
            ev.add_num(t.advisor.lead_conf, t.advisor.lead_frame_idx)
            if t.advisor.position is not None:
                ev.add_num(t.advisor.position + 1)
    if case.crosscam:
        for pr in case.crosscam.pairs:
            ev.add_num(pr.similarity, pr.threshold, pr.speed_kmh, pr.track_a, pr.track_b)
            if pr.combined:
                ev.plates.add(pr.combined.text)
            if pr.combined_match:
                for c in pr.combined_match.top_candidates:
                    ev.citations.add(c.registry_id)
                    ev.registry_ids.add(c.registry_id)
                    ev.plates.add(c.plate)
                    ev.add_num(c.score, c.matched_known, c.known_count)
    return ev


# --------------------------------------------------------------------------- verifier
_CIT_RE = re.compile(r"\[([^\]]+)\]")
_REG_RE = re.compile(r"\bREG-\d{3,5}\b")
_TICK_RE = re.compile(r"`([^`]*)`")
_PLATE_RE = re.compile(r"\b(?=[A-Z0-9?]*\d)(?=[A-Z0-9?]*[A-Z?])[A-Z0-9?]{6,11}\b")
_TIME_RE = re.compile(r"\b(\d{1,2}):(\d{2}(?:\.\d+)?)\b")
_FRAME_RE = re.compile(r"\bframes?\s+(\d+)", re.I)
_TRACK_RE = re.compile(r"\btracks?\s+(\d+)", re.I)
_NUM_RE = re.compile(r"(?<![A-Za-z])\d+(?:\.\d+)?")


def _num_ok(x: float, allowed: Sequence[float], tol: float = 0.006) -> bool:
    return any(abs(x - a) <= tol for a in allowed)


def check_sentence(s: str, ev: Evidence) -> list[str]:
    problems: list[str] = []
    cites = [c.strip() for grp in _CIT_RE.findall(s) for c in grp.split(",")]
    if not cites:
        problems.append("no evidence citation")
    for c in cites:
        if c not in ev.citations:
            problems.append(f"unknown citation [{c}]")
    body = _CIT_RE.sub(" ", s)
    for rid in _REG_RE.findall(body):
        if rid not in ev.registry_ids:
            problems.append(f"registry ID {rid} not in the result")
    body = _REG_RE.sub(" ", body)
    for p in _TICK_RE.findall(body):
        if len(p) >= 4 and p not in ev.plates and not (len(p) == 1):
            problems.append(f"plate `{p}` not in the result")
    body_nt = _TICK_RE.sub(" ", body)
    for p in _PLATE_RE.findall(body_nt):
        if p not in ev.plates:
            problems.append(f"plate {p} not in the result")
    body_nt = _PLATE_RE.sub(" ", body_nt)
    for mm, ss in _TIME_RE.findall(body_nt):
        t = int(mm) * 60 + float(ss)
        if not any(abs(t - a) <= 0.15 for a in ev.times):
            problems.append(f"time {mm}:{ss} not in the result")
    body_nt = _TIME_RE.sub(" ", body_nt)
    for fr in _FRAME_RE.findall(body_nt):
        if int(fr) not in ev.frames:
            problems.append(f"frame {fr} not in the result")
    for tr in _TRACK_RE.findall(body_nt):
        if int(tr) not in ev.tracks:
            problems.append(f"track {tr} not in the result")
    for n in _NUM_RE.findall(body_nt):
        if not _num_ok(float(n), ev.numbers):
            problems.append(f"number {n} not in the result")
    return problems


def split_sentences(text: str) -> list[str]:
    text = " ".join(text.split())
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z`\[])", text)
    return [p.strip() for p in parts if p.strip()]


# --------------------------------------------------------------------------- template
def _ts(t: float) -> str:
    m, s = divmod(t, 60.0)
    return f"{int(m):02d}:{s:04.1f}"


def _positions(ps: Sequence[int]) -> tuple[str, str]:
    """('Position 5' | 'Positions 5 and 9', 'POS-5, POS-9')"""
    ps1 = [p + 1 for p in ps]
    if len(ps1) == 1:
        txt = f"Position {ps1[0]}"
    else:
        txt = "Positions " + ", ".join(map(str, ps1[:-1])) + f" and {ps1[-1]}"
    return txt, ", ".join(f"POS-{p}" for p in ps1)


def _track_sentences(t: TrackResult) -> list[str]:
    out: list[str] = []
    a = t.attributes
    desc = " ".join(
        x for x in (a.color.value if not a.color.uncertain else "", a.body_type.value if not a.body_type.uncertain else "vehicle") if x
    )
    fp = t.fused
    support: list[str] = []
    for p in fp.positions:
        for rid in p.supporting:
            if rid not in support:
                support.append(rid)
    cites = ", ".join(support[:3] or [f.read_id for f in t.frames[:3]]) or f"T{t.track_id}"
    hint_only = t.n_detections == 0 and t.yolo_class.startswith("n/a")
    if hint_only:
        out.append(f"This is a hint-only search for `{fp.text or '(empty)'}` with no video evidence [T{t.track_id}].")
    elif fp.length and fp.n_reads:
        out.append(
            f"Vehicle track {t.track_id} ({desc}, seen {_ts(t.first_seen_sec)}-{_ts(t.last_seen_sec)}) showed the "
            f"plate `{fp.video_text}` across {fp.n_reads} plate reads [{cites}]."
        )
    else:
        out.append(
            f"Vehicle track {t.track_id} ({desc}, seen {_ts(t.first_seen_sec)}-{_ts(t.last_seen_sec)}) gave no "
            f"readable plate [T{t.track_id}]."
        )
    hint_pos = [p.index for p in fp.positions if p.source == "investigator-supplied"]
    if hint_pos and not hint_only:
        txt, cit = _positions(hint_pos)
        out.append(f"{txt} {'was' if len(hint_pos) == 1 else 'were'} supplied by the investigator, not read from "
                   f"the video, giving `{fp.text}` [{cit}].")
    conflicts = [p.index for p in fp.positions if p.source == "conflict"]
    if conflicts:
        txt, cit = _positions(conflicts)
        out.append(f"{txt} conflicted between the video and the hint and {'was' if len(conflicts) == 1 else 'were'} "
                   f"set to unknown [{cit}].")
    m = t.match
    if m and m.top_candidates:
        best = m.top_candidates[0]
        if m.status == MatchStatus.MATCHED:
            out.append(
                f"The best registry candidate is {best.registry_id}, `{best.plate}`, scoring {best.score:.2f} with "
                f"{best.matched_known} of {best.known_count} known characters matching [{best.registry_id}]."
            )
        elif m.status == MatchStatus.AMBIGUOUS:
            sec = m.top_candidates[1]
            out.append(
                f"{best.registry_id} and {sec.registry_id} scored {best.score:.2f} and {sec.score:.2f}, too close "
                f"to separate [{best.registry_id}, {sec.registry_id}]."
            )
        else:
            out.append(
                f"No registry entry cleared the {m.threshold_used:.2f} threshold; the best, {best.registry_id}, "
                f"scored {best.score:.2f} [{best.registry_id}]."
            )
    unknown = [p.index for p in fp.positions if p.char == UNKNOWN and p.source == "unknown"]
    if unknown and fp.length and not hint_only:
        txt, cit = _positions(unknown)
        out.append(f"{txt} {'was' if len(unknown) == 1 else 'were'} never read with confidence [{cit}].")
    adv = t.advisor
    if adv and adv.needed and adv.position is not None and adv.lead_read_id and adv.lead_frame_idx is not None:
        out.append(
            f"Frame {adv.lead_frame_idx} came closest to reading position {adv.position + 1} (`{adv.lead_char}` at "
            f"{adv.lead_conf:.2f}) and is a lead only [{adv.lead_read_id}, POS-{adv.position + 1}]."
        )
    return out


def _primary_tracks(case: CaseResult, limit: int = 3) -> list[TrackResult]:
    if case.primary_track_id is not None:
        prim = [t for t in case.tracks if t.track_id == case.primary_track_id]
        rest = [t for t in case.tracks if t.track_id != case.primary_track_id]
    else:
        prim, rest = [], list(case.tracks)
    rest.sort(key=lambda t: (-(t.match.top_candidates[0].score if t.match and t.match.top_candidates else 0),
                             t.track_id))
    return (prim + rest)[:limit]


def template_summary(case: CaseResult) -> list[str]:
    sents: list[str] = []
    for t in _primary_tracks(case):
        sents += _track_sentences(t)
    if case.crosscam:
        for pr in case.crosscam.pairs:
            if pr.same_vehicle and pr.combined_match and pr.combined_match.top_candidates:
                best = pr.combined_match.top_candidates[0]
                sents.append(
                    f"Track {pr.track_a} in clip A and track {pr.track_b} in clip B look like the same vehicle "
                    f"(similarity {pr.similarity:.2f}); combining both cameras gives `{pr.combined.text}` and "
                    f"{best.registry_id} at {best.score:.2f} [T{pr.track_a}, {best.registry_id}]."
                )
    if not sents:
        sents.append("No vehicle tracks were found in this case [T0].")
    return sents


# --------------------------------------------------------------------------- ollama
def _facts(case: CaseResult) -> dict:
    out = {"threshold": case.threshold, "hint": case.hint, "tracks": []}
    for t in _primary_tracks(case):
        out["tracks"].append(
            {
                "track_id": t.track_id,
                "cite_track": f"T{t.track_id}",
                "color": t.attributes.color.value,
                "body_type": t.attributes.body_type.value,
                "first_seen": _ts(t.first_seen_sec),
                "last_seen": _ts(t.last_seen_sec),
                "plate": t.fused.text,
                "plate_reads": [f.read_id for f in t.frames],
                "unknown_positions": [f"POS-{p.index + 1}" for p in t.fused.positions if p.char == UNKNOWN],
                "status": t.match.status.value if t.match else None,
                "candidates": [
                    {"registry_id": c.registry_id, "plate": c.plate, "score": round(c.score, 2),
                     "matched_known": c.matched_known, "known": c.known_count}
                    for c in (t.match.top_candidates[:3] if t.match else [])
                ],
                "advisor": t.advisor.text if t.advisor and t.advisor.needed else None,
            }
        )
    return out


def ollama_summary(case: CaseResult, cfg: NarrativeConfig) -> Optional[str]:
    try:
        import requests
    except ImportError:
        return None
    prompt = (
        "You write short, factual summaries for police investigators. Use ONLY the facts in the JSON. "
        "Write 3 to 5 sentences. Every sentence MUST end with one or more evidence IDs in square brackets taken "
        "from the JSON (plate_reads like [F42], registry_id like [REG-0001], unknown_positions like [POS-5], "
        "or cite_track like [T4]). Copy plate strings exactly, including '?'. Do not guess any character. "
        "Round scores to 2 decimals.\n\nFACTS:\n" + json.dumps(_facts(case))
    )
    try:
        r = requests.post(
            f"{cfg.ollama_url}/api/generate",
            json={"model": cfg.ollama_model, "prompt": prompt, "stream": False, "options": {"temperature": 0, "seed": 42}},
            timeout=cfg.ollama_timeout_s,
        )
        r.raise_for_status()
        return r.json().get("response", "").strip() or None
    except Exception as exc:  # network, model missing, timeout
        log.warning("Ollama unavailable (%s); using the template summary", exc)
        return None


# --------------------------------------------------------------------------- entry
def summarize(case: CaseResult, cfg: PrismConfig) -> Narrative:
    ev = build_evidence(case, cfg)
    template = template_summary(case)

    def checked(sents: list[str]) -> list[NarrativeSentence]:
        return [NarrativeSentence(text=s, passed=not (p := check_sentence(s, ev)), problems=p) for s in sents]

    method = "template"
    results: list[NarrativeSentence]
    if cfg.narrative.backend == "ollama":
        text = ollama_summary(case, cfg.narrative)
        if text:
            results = checked(split_sentences(text))
            failed = sum(1 for r in results if not r.passed)
            if failed > cfg.narrative.max_failed_sentences or not any(r.passed for r in results):
                log.warning("%d LLM sentences failed the evidence check; falling back to the template", failed)
                results = checked(template)
                method = "template (LLM output failed the evidence check)"
            else:
                method = f"ollama:{cfg.narrative.ollama_model}"
        else:
            results = checked(template)
            method = "template (Ollama unavailable)"
    else:
        results = checked(template)
    kept = [r for r in results if r.passed]
    return Narrative(
        text=" ".join(r.text for r in kept),
        method=method,
        sentences=results,
        checked=len(results),
        removed=len(results) - len(kept),
    )
