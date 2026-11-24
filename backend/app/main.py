"""PRISM FastAPI backend.

Endpoints
  POST /api/jobs                    upload a clip (+ hint, threshold) -> job_id
  GET  /api/jobs                    list jobs
  GET  /api/jobs/{job_id}           status, stage progress and result
  POST /api/jobs/{job_id}/rescore   new threshold / hint / target track, Stage 5 only
  POST /api/jobs/{job_id}/whatif    hypothetical re-ranking + stability analysis (read-only, not saved)
  DELETE /api/jobs/{job_id}         delete a job and its artifacts
  POST /api/search                  hint-only registry search
  POST /api/crosscam                two clips -> cross-camera job
  GET  /api/report/{job_id}         ?format=pdf|html
  GET  /artifacts/{path}            saved crops
  GET  /reports/{path}              pre-built batch reports (.html/.pdf/.png) linked from the website
  GET  /health                      device, models, versions
  GET  /                            project website; /app is the investigator (frontend/dist)

Run:  python -m uvicorn backend.app.main:app --port 8000
"""

from __future__ import annotations

import datetime as _dt
import json
import logging
import shutil
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from backend.app import auth  # noqa: E402  (loads .env before the config is read)
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from prism.config import (  # noqa: E402
    BODY_TYPES,
    COLORS,
    FRONTEND_DIST,
    PRISM_VERSION,
    REGISTRY_PATH,
    REPORTS_DIR,
    RUNS_DIR,
    VEHICLE_MODELS,
    config_dict,
    config_hash,
    load_config,
)
from prism.custody import package_versions, prism_commit, vendor_commits  # noqa: E402
from prism.pipeline import STAGES, get_hub, hint_only_search, rescore_case, run_crosscam, run_pipeline  # noqa: E402
from prism.registry import cached_registry, load_registry  # noqa: E402
from prism.report import write_report  # noqa: E402
from prism.whatif import WhatIfError, run_whatif  # noqa: E402
from prism.runtime import gpu_name, resolve_device  # noqa: E402
from prism.schemas import CaseResult, JobState, RescoreRequest, SearchRequest, WhatIfRequest, WhatIfResult  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("prism.api")

CFG = load_config()
RUNS_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXT = {".mp4", ".avi", ".mov", ".mkv", ".m4v", ".webm"}
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024  # 1 GB

# OpenAPI docs live under /api so the website can use /docs.
app = FastAPI(title="PRISM", version=PRISM_VERSION, description="Plate Recovery & Identification from Surveillance Media",
              docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")
@app.middleware("http")
async def clerk_auth(request: Request, call_next):
    """Uploaded footage and its results need a signed-in Clerk user (backend/app/auth.py)."""
    if request.method != "OPTIONS" and auth.enabled() and auth.needs_auth(request.url.path):
        token = auth.token_from(request.headers, request.cookies)
        claims = await run_in_threadpool(auth.verify, token) if token else None
        if claims is None:
            return JSONResponse({"detail": "Sign in to use the investigator."}, status_code=401)
        request.state.user_id = claims.get("sub")
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_jobs: dict[str, JobState] = {}
_jobs_lock = threading.Lock()
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="prism-job")  # one GPU job at a time


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def _job_dir(job_id: str) -> Path:
    if not job_id.isalnum() and not job_id.replace("-", "").isalnum():
        raise HTTPException(400, "invalid job id")
    return RUNS_DIR / job_id


def _save_job(job: JobState) -> None:
    d = _job_dir(job.job_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "job.json").write_text(job.model_dump_json(), encoding="utf-8")


def _load_jobs() -> None:
    for p in RUNS_DIR.glob("*/job.json"):
        try:
            job = JobState.model_validate_json(p.read_text(encoding="utf-8"))
            if job.status in ("queued", "running"):
                job.status, job.error = "error", "server restarted while the job was running"
            _jobs[job.job_id] = job
        except Exception as exc:
            log.warning("skipping unreadable job file %s: %s", p, exc)


_load_jobs()


def _get(job_id: str) -> JobState:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"job {job_id} not found")
    return job


def _progress_cb(job: JobState):
    def cb(stage: str, frac: float) -> None:
        job.stage = stage
        job.progress[stage] = round(max(job.progress.get(stage, 0.0), min(1.0, frac)), 3)
        if stage in STAGES:
            for s in STAGES[: STAGES.index(stage)]:
                job.progress[s] = max(job.progress.get(s, 0.0), 1.0) if job.kind == "clip" else job.progress.get(s, 0.0)

    return cb


def _run(job: JobState, fn, *args, **kwargs) -> None:
    job.status = "running"
    _save_job(job)
    try:
        result: CaseResult = fn(*args, progress=_progress_cb(job), case_id=job.job_id,
                                out_dir=_job_dir(job.job_id), url_prefix=f"/artifacts/{job.job_id}", **kwargs)
        job.result = result
        job.progress = {s: 1.0 for s in STAGES}
        job.stage = "done"
        job.status = "done"
    except Exception as exc:  # report any failure to the UI instead of crashing the worker
        log.exception("job %s failed", job.job_id)
        job.status, job.error = "error", f"{type(exc).__name__}: {exc}"
    _save_job(job)


async def _store_upload(upload: UploadFile, dest_dir: Path, stem: str) -> Path:
    name = Path(upload.filename or "clip.mp4").name
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"unsupported file type {ext!r}; use one of {sorted(ALLOWED_EXT)}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{stem}{ext}"
    size = 0
    with open(dest, "wb") as f:
        while chunk := await upload.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                f.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, "file too large")
            f.write(chunk)
    return dest


def _threshold(v: Optional[float]) -> Optional[float]:
    if v is None:
        return None
    if not 0.0 <= v <= 1.0:
        raise HTTPException(422, "threshold must be between 0 and 1")
    return v


# --------------------------------------------------------------------------- routes
@app.get("/health")
def health() -> dict:
    device = resolve_device(CFG.device)
    hub = get_hub(CFG)
    try:
        registry_size = len(load_registry())
    except FileNotFoundError:
        registry_size = 0
    from prism.config import WEIGHTS_DIR

    return {
        "status": "ok",
        "prism_version": PRISM_VERSION,
        "device": device,
        "gpu": gpu_name(),
        "ocr_backend": CFG.ocr.backend,
        "reid_encoder": CFG.reid.encoder,
        "narrative_backend": CFG.narrative.backend,
        "super_resolution_installed": (WEIGHTS_DIR / CFG.super_res.weights_file).exists(),
        "loaded_models": hub.versions,
        "registry_size": registry_size,
        "config_hash": config_hash(CFG),
        "thresholds": {"tau": CFG.match.tau, "char_conf": CFG.ocr.char_conf, "min_sharpness": CFG.plate.min_sharpness},
        "prism_commit": prism_commit(),
        "vendor_commits": vendor_commits(),
        "packages": package_versions(("torch", "ultralytics", "open_clip_torch", "fast-alpr", "fastapi")),
        "stages": list(STAGES),
        "auth": "clerk" if auth.enabled() else "off",
    }


@app.get("/api/config")
def get_config() -> dict:
    return {
        "config": config_dict(CFG),
        "colors": list(COLORS),
        "body_types": list(BODY_TYPES),
        "make_models": [f"{m[0]} {m[1]}" for m in VEHICLE_MODELS],
    }


@app.post("/api/jobs")
async def create_job(
    file: UploadFile = File(...),
    hint: Optional[str] = Form(None),
    threshold: Optional[float] = Form(None),
) -> dict:
    job_id = uuid.uuid4().hex[:12]
    clip = await _store_upload(file, _job_dir(job_id) / "input", "clip")
    job = JobState(job_id=job_id, kind="clip", status="queued", created_at=_now(), progress={s: 0.0 for s in STAGES})
    with _jobs_lock:
        _jobs[job_id] = job
    _save_job(job)
    _worker.submit(_run, job, run_pipeline, clip, hint=hint or None, threshold=_threshold(threshold), cfg=CFG)
    return {"job_id": job_id, "status": job.status}


@app.post("/api/crosscam")
async def create_crosscam(
    file_a: UploadFile = File(...),
    file_b: UploadFile = File(...),
    hint: Optional[str] = Form(None),
    threshold: Optional[float] = Form(None),
    distance_km: Optional[float] = Form(None),
    gap_s: Optional[float] = Form(None),
) -> dict:
    job_id = uuid.uuid4().hex[:12]
    a = await _store_upload(file_a, _job_dir(job_id) / "input", "clip_a")
    b = await _store_upload(file_b, _job_dir(job_id) / "input", "clip_b")
    job = JobState(job_id=job_id, kind="crosscam", status="queued", created_at=_now(), progress={s: 0.0 for s in STAGES})
    with _jobs_lock:
        _jobs[job_id] = job
    _save_job(job)
    _worker.submit(_run, job, run_crosscam, a, b, hint=hint or None, threshold=_threshold(threshold),
                   distance_km=distance_km, gap_s=gap_s, cfg=CFG)
    return {"job_id": job_id, "status": job.status}


@app.get("/api/jobs")
def list_jobs() -> list[dict]:
    with _jobs_lock:
        jobs = list(_jobs.values())
    jobs.sort(key=lambda j: j.created_at, reverse=True)
    return [
        {"job_id": j.job_id, "kind": j.kind, "status": j.status, "created_at": j.created_at,
         "clip": j.result.clip.name if j.result and j.result.clip else None}
        for j in jobs
    ]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> JobState:
    return _get(job_id)


@app.post("/api/jobs/{job_id}/rescore")
def rescore(job_id: str, req: RescoreRequest, track_id: Optional[int] = Query(None), clear_hint: bool = False) -> CaseResult:
    job = _get(job_id)
    if job.status != "done" or job.result is None:
        raise HTTPException(409, "job has no result yet")
    job.result = rescore_case(job.result, CFG, threshold=req.threshold, hint=req.hint, target_track_id=track_id,
                              clear_hint=clear_hint)
    _save_job(job)
    return job.result


@app.post("/api/jobs/{job_id}/whatif")
def whatif(job_id: str, req: WhatIfRequest) -> WhatIfResult:
    """Test a hypothesis (assumed characters, colour/lighting, threshold) against a finished case.

    Read-only: the case result, its report and its custody record are not changed."""
    job = _get(job_id)
    if job.status != "done" or job.result is None:
        raise HTTPException(409, "job has no result yet")
    try:
        return run_whatif(job.result, req, cached_registry(str(REGISTRY_PATH)), CFG)
    except WhatIfError as exc:
        raise HTTPException(422, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str) -> dict:
    _get(job_id)
    with _jobs_lock:
        _jobs.pop(job_id, None)
    shutil.rmtree(_job_dir(job_id), ignore_errors=True)
    return {"deleted": job_id}


@app.post("/api/search")
def search(req: SearchRequest) -> CaseResult:
    if req.color and req.color not in COLORS:
        raise HTTPException(422, f"unknown colour {req.color!r}")
    if req.body_type and req.body_type not in BODY_TYPES:
        raise HTTPException(422, f"unknown body type {req.body_type!r}")
    case = hint_only_search(req.hint, req.color, req.body_type, req.make_model, req.threshold, req.low_light, CFG)
    job = JobState(job_id=case.case_id.replace("search-", "s"), kind="clip", status="done", created_at=_now(),
                   stage="done", progress={s: 1.0 for s in STAGES}, result=case)
    case.case_id = job.job_id
    with _jobs_lock:
        _jobs[job.job_id] = job
    _save_job(job)
    return case


@app.get("/api/report/{job_id}")
def report(job_id: str, format: str = Query("html", pattern="^(pdf|html)$")):
    job = _get(job_id)
    if job.result is None:
        raise HTTPException(409, "job has no result yet")
    path, actual = write_report(job.result, format, _job_dir(job_id) / "report")
    headers = {}
    if format == "pdf" and actual != "pdf":
        headers["X-PRISM-Report-Fallback"] = "Chromium unavailable; returned HTML. Run: playwright install chromium"
    media = "application/pdf" if actual == "pdf" else "text/html"
    return FileResponse(path, media_type=media, filename=path.name, headers=headers)


@app.get("/artifacts/{path:path}")
def artifact(path: str):
    p = (RUNS_DIR / path).resolve()
    try:
        p.relative_to(RUNS_DIR.resolve())
    except ValueError:
        raise HTTPException(404, "not found")
    if not p.is_file() or p.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        raise HTTPException(404, "not found")
    return FileResponse(p)


@app.get("/reports/{path:path}", include_in_schema=False)
def batch_report_file(path: str):
    """Pre-built batch reports (scripts/batch_report.py), linked from the project website."""
    root = REPORTS_DIR.resolve()
    p = (REPORTS_DIR / path).resolve()
    if not p.is_relative_to(root) or not p.is_file() or p.suffix.lower() not in {".html", ".pdf", ".png"}:
        raise HTTPException(404, "not found")
    return FileResponse(p)


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith(("api/", "artifacts/", "reports/", "health")):
            raise HTTPException(404, "not found")
        f = (FRONTEND_DIST / full_path).resolve()
        if full_path and f.is_file() and f.is_relative_to(FRONTEND_DIST.resolve()):
            return FileResponse(f)
        return FileResponse(FRONTEND_DIST / "index.html")
else:

    @app.get("/", include_in_schema=False)
    def no_ui():
        return JSONResponse({"message": "PRISM API is running. Build the UI with: cd frontend && npm install && npm run build"})
