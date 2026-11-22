# PRISM: Plate Recovery & Identification from Surveillance Media

Hackasol 5.0 · Track 2 (AIML) · **AIML-01** Vehicle Identification and Traceability from CCTV Footage.

Upload blurry CCTV footage and, optionally, the part of the plate you already know. PRISM returns a ranked
top-5 shortlist of registry vehicles. Every candidate has a confidence score, a written reason for every
part of that score, and links back to the exact frames the evidence came from. Characters PRISM cannot read
stay `?`; it never guesses them.

> PRISM output supports an investigator's decision. It does not identify a vehicle on its own.

---

## Quick start (Windows, one command after setup)

```powershell
# 1. Python 3.11 environment (uv shown; plain venv + pip works too)
uv venv .venv --python 3.11
uv pip install --python .venv\Scripts\python.exe torch torchvision --index-url https://download.pytorch.org/whl/cu128   # GPU (RTX 50xx needs cu128)
#   CPU only:  ... --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv\Scripts\python.exe -r requirements.txt

# 2. Read-only research repos
git clone https://github.com/ankandrew/fast-alpr.git vendor/fast-alpr
git clone https://github.com/baudm/parseq.git vendor/parseq
git clone https://github.com/valfride/lpsr-lacd.git vendor/lpsr-lacd
git clone https://github.com/kHarshit/vehicle-reidentification.git vendor/vehicle-reidentification

# 3. Models, PDF engine, registry, demo clips, UI
.venv\Scripts\python.exe scripts\download_weights.py            # add --with-sr for the optional 1.97 GB SR checkpoint
.venv\Scripts\python.exe -m playwright install chromium         # PDF export (HTML works without it)
.venv\Scripts\python.exe data\generate_registry.py              # 500 synthetic records -> data/registry.json
.venv\Scripts\python.exe scripts\make_demo_clips.py             # labelled demo clips -> data/test_clips/
cd frontend; npm install; npm run build; cd ..

# 4. Launch the full app (API + built UI on one port)
.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>. On Linux/macOS use `.venv/bin/python` and forward slashes.

**Frontend dev mode** (hot reload): run the API as above, then `cd frontend && npm run dev` and open
<http://localhost:5173> (Vite proxies `/api`, `/artifacts` and `/health` to port 8000).

### Command line

```powershell
.venv\Scripts\python.exe -m prism analyze data\test_clips\day_clear_white.mp4 --report pdf
.venv\Scripts\python.exe -m prism analyze data\test_clips\night_partial_white.mp4 --hint "CG04????2?"
.venv\Scripts\python.exe -m prism crosscam data\test_clips\night_partial_white.mp4 data\test_clips\camB_white.mp4 --report pdf
.venv\Scripts\python.exe -m prism search "CG04MX48??" --color white --body car
```

### Tests, evaluation, batch reports

```powershell
.venv\Scripts\python.exe -m pytest -v                         # unit + Hypothesis property tests (no models needed)
.venv\Scripts\python.exe scripts\make_degraded.py              # 6 degraded versions of every clip
.venv\Scripts\python.exe scripts\evaluate.py --clips --degraded # OCR benchmark, ablation, tau sweep, clip metrics
.venv\Scripts\python.exe scripts\batch_report.py               # one PDF/HTML report per clip + reports/index.html
```

---

## How it works

```
clip ─► Stage 0 ingest (SHA-256, metadata, low-light flag)
     ─► Stage 1 YOLO11 + ByteTrack vehicle tracks (car / motorcycle / bus / truck, 5% padding, >= 5 frames)
     ─► Stage 2 fast-alpr YOLOv9-t plate detector INSIDE each vehicle crop, Laplacian sharpness >= 45,
               width >= 30 px, 12 sharpest frames, two-line split, raw + CLAHE copies
     ─► Stage 3 OCR (PARSeq default, fast-plate-ocr benchmarked) -> confidence mask (< 0.70 -> ?)
               -> Indian format mask (can only add ?) -> multi-frame fusion (two-condition vote)
     ·· visual aid: lpsr-lacd super-resolution saved as *_sr.png AFTER Stage 3, never read back
     ─► Stage 4 OpenCLIP ViT-B-32 colour / body type / make-model on the 3 sharpest crops
     ─► Stage 5 hint merge -> coverage-aware matcher -> MATCHED / AMBIGUOUS / NO CONFIDENT MATCH
               -> next-best-evidence advisor -> evidence-checked summary -> chain of custody
```

| Module | Role |
|---|---|
| `prism/config.py` | Every threshold, weight, model name and path; fixed seeds; config hash |
| `prism/schemas.py` | Pydantic v2 models for results, API and report |
| `prism/stages/track.py` | Stage 0 + 1: ingest stats, YOLO11 + ByteTrack |
| `prism/stages/plate_detect.py` | Stage 2: wraps `vendor/fast-alpr` detector (pip fallback), sharpness, two-line split, CLAHE |
| `prism/stages/ocr.py` | Stage 3: `BasePlateOCR`, `ParseqOCR` (`vendor/parseq`, torch.hub fallback), `FastPlateOCR`; source gate |
| `prism/stages/super_res.py` | Visual aid only: `cgnetV2_deformable` from `vendor/lpsr-lacd`; disables itself without weights |
| `prism/stages/attributes.py` | Stage 4: OpenCLIP prompt ensembles, YOLO + CLIP body type, constrained make/model |
| `prism/plate_grammar.py` | Indian layouts (standard, old Delhi, Bharat series); masks, never adds or changes |
| `prism/masking.py` | Confidence + format masking with reasons |
| `prism/fusion.py` | Alignment, quality-weighted evidence, two-condition vote, evidence strip data, hint merge |
| `prism/matcher.py` | Shift-tolerant plate similarity, confusable credit, coverage, composite score, guardrails, statuses |
| `prism/advisor.py` | Names the unknown position that best separates candidates and the closest sub-threshold frame |
| `prism/narrative.py` | Template (default) or Ollama summary, rule-based verifier, fallback |
| `prism/reid.py` | `BaseReIDEncoder`: `ClipReIDEncoder` (default), `VendorReIDEncoder` (OSNet/ResNet); linking rules |
| `prism/custody.py` | SHA-256 of clip, crops, registry; config hash; package versions; git commits of PRISM and vendor repos |
| `prism/report.py` + `templates/report.html.j2` | Self-contained HTML report, evidence-strip image, Playwright PDF with HTML fallback |
| `prism/pipeline.py` | `run_pipeline`, `run_crosscam`, `rescore_case`, `hint_only_search` |
| `backend/app/main.py` | FastAPI: jobs, rescore, search, crosscam, report, artifacts, health, static UI |
| `frontend/` | React + Vite + Tailwind investigator app |
| `data/generate_registry.py` | 500 synthetic records with decoys |
| `scripts/` | Demo clips, degradation, evaluation, batch reports, weight download |

### The matching algorithm (team-designed)

* **Fusion.** Reads are aligned (edit distance, `?` matches anything) to the most confident read of the modal
  plate length. Evidence `W_k(a) = Σ I(c=a) · p · min(S/100, 2.0)`. A character is accepted only if
  `W ≥ 0.9` **and** it holds `≥ 60%` of the evidence. A third, stricter check (`vote_min_consistency`, 40%)
  requires the winner to be read confidently in a reasonable share of the reads that saw the position; it was
  added after a night test where a half-hidden `2` was read as `8` at 0.85 in 4 of 24 reads. It can only add `?`.
* **Plate similarity.** Best of shifts −1/0/+1 (−0.05 per shift), 0.35 credit for `0/O 1/I 8/B 5/S 2/Z 6/G 4/A`,
  times coverage `min(1, |K|/6)`. Specificity = registry plates that fit the known characters exactly.
* **Score.** `0.65·plate + 0.20·colour + 0.15·body + 0.05·make/model`; low light → `0.75 / 0.10`.
  Adjacent shades (silver/grey, white/silver; grey/black at night) get half colour credit; uncertain
  attributes (`< 0.40`) get none.
* **Guardrails.** `|K| = 0` caps the score at 0.45; `< 3` known characters cannot be `MATCHED`; the make/model
  bonus cannot lift a candidate over τ; a candidate that contradicts a confidently read character is listed
  with a mismatch, ranked below every candidate that does not, cannot be `MATCHED`, and is not counted as a
  rival for the ambiguity gap.
* **Statuses.** `MATCHED` (top ≥ τ, `|K| ≥ 3`, gap ≥ 0.05), `AMBIGUOUS` (gap < 0.05), `NO CONFIDENT MATCH`
  (with a written explanation). τ defaults to 0.55 and can be moved live in the UI.

### Guarantees and how they are enforced

| Rule | Enforcement | Test |
|---|---|---|
| Never invent characters | Only masked (`≥ 0.70`, alphanumeric, format-valid) characters carry weight; two-condition vote | `test_every_fused_char_was_read_confidently_in_a_real_frame` (Hypothesis) |
| Format check only removes | `format_mask` returns the input or `?` per position | `test_format_check_never_invents_or_changes` (Hypothesis) |
| Disagreement stays unknown | `8` vs `B` with similar weight fails the share test | `test_disagreement_8_vs_B_stays_unknown` |
| Super-resolution isolation | SR runs after Stage 3; outputs are `SRImage`, not `PlateCrop`; OCR gate refuses other sources and `*_sr.png` paths | `test_pipeline_never_feeds_sr_to_ocr`, `test_gate_rejects_sr_image_and_sr_paths` |
| Matcher guardrails | see above | `tests/test_matcher.py` incl. a Hypothesis bound test and a "true vehicle removed" test |
| Appearance alone never links cameras | Linking needs similarity ≥ threshold, no plate conflict, ≥ 3 agreeing characters, matching body | `test_link_requires_appearance_and_plate_and_body` |
| Graceful degradation | Missing SR weights, vendor Re-ID, Ollama, Chromium or one OCR backend → warning + fallback | `test_super_res_disables_cleanly_without_weights`, `test_ollama_unavailable_falls_back`, `test_pdf_export_or_clean_fallback` |

---

## Investigator app

1. **New case**: one clip, two clips (cross-camera) or hint-only search; plate-hint mask helper; τ slider; CPU/GPU badge.
2. **Live progress** per stage.
3. **Vehicles found**: track cards; amber `?` unknown, blue investigator-supplied, red conflicts; colour/body chips.
4. **Evidence**: plate evidence strip (votes per position and read), frame-by-frame table with raw + CLAHE crops,
   sharpness, raw/masked OCR and confidence pills; super-resolution toggle labelled
   *"Visual aid only. Not used for identification."* (or "not installed").
5. **Shortlist**: top-5 cards with stacked score bars, match/mismatch badges, specificity, status banner, advisor.
6. **Summary & report**: evidence-checked summary with citations; PDF and HTML download; custody hashes.
7. **Cross-camera**: linked pairs with similarity, plate/body checks, speed flag and combined-evidence result.

The threshold slider and the hint box call `POST /api/jobs/{id}/rescore`, which reruns only Stage 5.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/jobs` | multipart `file`, optional `hint`, `threshold` → `job_id` |
| GET | `/api/jobs/{job_id}` | status, per-stage progress, result |
| POST | `/api/jobs/{job_id}/rescore` | JSON `{threshold, hint}`; query `track_id`, `clear_hint` |
| POST | `/api/search` | JSON `{hint, color, body_type, make_model, threshold, low_light}` |
| POST | `/api/crosscam` | multipart `file_a`, `file_b`, optional `hint`, `threshold`, `distance_km`, `gap_s` |
| GET | `/api/report/{job_id}?format=pdf\|html` | forensic report |
| GET | `/artifacts/{path}` | saved crops (path-traversal safe) |
| GET | `/health` | device, GPU, models, registry size, config hash, vendor commits |

## Data

* `data/registry.json`: 500 synthetic records (CG, MH, KA, DL incl. old Delhi `DL3CAB1234`, BH series),
  make/model fixes body type, realistic colour frequencies. Demo vehicles have 3–5 near-duplicate decoys.
* `data/test_clips/`: synthetic CCTV clips built from the real vehicle photos in
  `vendor/vehicle-reidentification/reference_vehicles`, with the original plates covered by rendered Indian
  plates, motion blur, sensor noise, JPEG and night darkening; `labels.json` holds ground truth.
  Replace or extend them with team-recorded footage (add the plates to the registry and to `labels.json`).

## Evaluation

<!-- EVAL:START -->
Run `python scripts/evaluate.py --clips` to fill this section.
<!-- EVAL:END -->

## Configuration and degradation

Everything is in `prism/config.py`. Environment overrides: `PRISM_DEVICE=cpu|cuda`,
`PRISM_OCR_BACKEND=parseq|fast_plate_ocr`, `PRISM_NARRATIVE=template|ollama`,
`PRISM_REID_ENCODER=clip|osnet|resnet`, `PRISM_RUNS_DIR`, `PRISM_WEIGHTS_DIR`.

| Missing | Behaviour |
|---|---|
| `vendor/fast-alpr` | pip `fast-alpr`; without any detector the job fails with a setup error (never runs without plate detection) |
| `vendor/parseq` | `torch.hub` PARSeq; then `FastPlateOCR`, recorded in the report |
| `vendor/lpsr-lacd` or SR weights | super-resolution off, UI shows "not installed", results identical |
| `vendor/vehicle-reidentification` / `torchreid` | `ClipReIDEncoder` |
| Ollama | template summary |
| Chromium | HTML report returned with `X-PRISM-Report-Fallback` header |

## Privacy and responsible use

Decision support only; synthetic registry; all models run locally; only vehicle and plate crops are stored;
cases can be deleted from the UI (`DELETE /api/jobs/{id}`); every run is hashed and reproducible.
`vendor/` and weights are git-ignored; check each repository's licence before redistribution
(the lpsr-lacd training data is licensed for non-commercial academic use).

## Known limitations

* PARSeq is a general scene-text model. On the synthetic night clip it read a half-hidden `2` as `8` with
  0.85 confidence in some frames; the consistency check keeps that position `?`, but OCR errors that are
  confident *and* consistent across frames would still pass and would show up as a plate mismatch.
* OpenCLIP colour is zero-shot: a white car under overcast or bluish light is often reported as grey or silver.
  The adjacent-shade credit and the "uncertain" rule limit the damage; reported colour accuracy is in the
  evaluation section.
* The demo clips are synthetic composites; real CCTV is harder.

The specification used is `docs/proposed_solution.md` (the final version of the proposed solution) together
with `docs/Hackasol_5.0_Problem_Statement.pdf`, page 5.
