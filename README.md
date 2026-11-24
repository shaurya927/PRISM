# PRISM: Plate Recovery & Identification from Surveillance Media

[![CI/CD](https://github.com/shaurya927/PRISM/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/shaurya927/PRISM/actions/workflows/ci-cd.yml)

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
.venv\Scripts\python.exe data\generate_registry.py              # 50,000 synthetic records -> data/registry.json
.venv\Scripts\python.exe scripts\make_demo_clips.py             # labelled demo clips -> data/test_clips/
cd frontend; npm install; npm run build; cd ..

# 4. Launch the full app (API + built UI on one port)
.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000> for the project website and <http://127.0.0.1:8000/app> for the investigator app.
On Linux/macOS use `.venv/bin/python` and forward slashes.

**Frontend dev mode** (hot reload): run the API as above, then `cd frontend && npm run dev` and open
<http://localhost:5173> (Vite proxies `/api`, `/artifacts`, `/reports` and `/health` to port 8000).

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

### Docker

```bash
docker compose up --build                                                    # CPU
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build    # NVIDIA GPU (needs the NVIDIA Container Toolkit)
docker run -p 8000:8000 -v prism-weights:/app/weights ghcr.io/shaurya927/prism:latest   # prebuilt CPU image from CI
```

The image builds the frontend, installs CPU PyTorch (or CUDA 12.8 with `--build-arg TORCH_INDEX=...cu128`),
Chromium for PDF reports, and `vendor/fast-alpr`, `vendor/parseq` and `vendor/vehicle-reidentification` at
the pinned commits. `vendor/lpsr-lacd` has no licence file, so it is left out and super-resolution shows
"not installed"; results are identical without it. Model weights are not baked in: Compose sets
`PRISM_PREFETCH_WEIGHTS=1`, which downloads them into the `prism-weights` volume on first start (a few
minutes, once). Jobs are kept in the `prism-runs` volume. The container runs as a non-root user and has a
`/health` health check.

### CI/CD

`.github/workflows/ci-cd.yml` runs on every push and pull request:

| Job | What it checks |
|---|---|
| Python tests | `pytest` on Ubuntu with CPU PyTorch and Chromium (PDF path exercised) |
| Frontend build | `npm ci` + `npm run build`; the `dist/` folder is uploaded as an artifact |
| Docker image | Builds the image, starts it, checks `/health` (registry loaded, commit recorded, vendor repos present), `/`, `/app`, `/api/config` and `/reports/`, then runs `pytest` inside the container |

On pushes to `main` and `v*` tags, the tested image is published to `ghcr.io/shaurya927/prism`
(`latest`, `sha-<commit>`, and the version for tags).

---

## How it works

```
clip ─► Stage 0 ingest (SHA-256, metadata, low-light flag)
     ─► Stage 1 YOLO11 + ByteTrack vehicle tracks (car / motorcycle / bus / truck, 5% padding, >= 5 frames)
     ─► Stage 2 fast-alpr YOLOv9-t plate detector INSIDE each vehicle crop, Laplacian sharpness >= 45,
               width >= 30 px, 12 sharpest frames, two-line split, raw + CLAHE copies
     ─► Stage 3 OCR (PARSeq default, fast-plate-ocr benchmarked) -> confidence mask (< 0.70 -> ?)
               -> Indian format mask (can only add ?) -> OCR cross-check: fast-plate-ocr reads the same
               crop and must confirm each character (can only add ?) -> multi-frame fusion (two-condition vote)
     ·· visual aid: lpsr-lacd super-resolution saved as *_sr.png AFTER Stage 3, never read back
     ─► Stage 4 OpenCLIP ViT-B-32 colour (on a denoised copy) / body type / make-model on the 3 sharpest crops
     ─► Stage 5 hint merge -> coverage-aware matcher -> MATCHED / AMBIGUOUS / NO CONFIDENT MATCH
               -> next-best-evidence advisor -> evidence-checked summary -> chain of custody
```

| Module | Role |
|---|---|
| `prism/config.py` | Every threshold, weight, model name and path; fixed seeds; config hash |
| `prism/schemas.py` | Pydantic v2 models for results, API and report |
| `prism/stages/track.py` | Stage 0 + 1: ingest stats, YOLO11 + ByteTrack |
| `prism/stages/plate_detect.py` | Stage 2: wraps `vendor/fast-alpr` detector (pip fallback), sharpness, two-line split, CLAHE |
| `prism/stages/ocr.py` | Stage 3: `BasePlateOCR`, `ParseqOCR` (`vendor/parseq`, torch.hub fallback), `FastPlateOCR`; cross-check backend; source gate |
| `prism/stages/super_res.py` | Visual aid only: `cgnetV2_deformable` from `vendor/lpsr-lacd`; disables itself without weights |
| `prism/stages/attributes.py` | Stage 4: OpenCLIP prompt ensembles, colour on a bilateral-filtered crop, YOLO + CLIP body type, constrained make/model |
| `prism/plate_grammar.py` | Indian layouts (standard, old Delhi, Bharat series); masks, never adds or changes |
| `prism/masking.py` | Confidence + format masking with reasons; OCR cross-check (`cross_check`) |
| `prism/fusion.py` | Alignment, quality-weighted evidence, two-condition vote, evidence strip data, hint merge |
| `prism/matcher.py` | Shift-tolerant plate similarity, confusable credit, coverage, composite score, guardrails, statuses |
| `prism/advisor.py` | Names the unknown position that best separates candidates and the closest sub-threshold frame |
| `prism/narrative.py` | Template (default) or Ollama summary, rule-based verifier, fallback |
| `prism/reid.py` | `BaseReIDEncoder`: `ClipReIDEncoder` (default), `VendorReIDEncoder` (OSNet/ResNet); linking rules |
| `prism/custody.py` | SHA-256 of clip, crops, registry; config hash; package versions; git commits of PRISM and vendor repos |
| `prism/report.py` + `templates/report.html.j2` | Self-contained HTML report, evidence-strip image, Playwright PDF with HTML fallback |
| `prism/pipeline.py` | `run_pipeline`, `run_crosscam`, `rescore_case`, `hint_only_search` |
| `prism/whatif.py` | Counterfactual what-if: hypothetical re-ranking, Hypothesis Stability Score, sensitivity matrix, differential justification |
| `backend/app/main.py` | FastAPI: jobs, rescore, search, crosscam, report, artifacts, health, static UI |
| `frontend/` | React + Vite + Tailwind investigator app (`/app`) and project website (`/`, `src/site/`) |
| `data/generate_registry.py` | 50,000 synthetic records with decoys |
| `scripts/` | Demo clips, degradation, evaluation, batch reports, weight download |

### The matching algorithm (team-designed)

* **Fusion.** Reads are aligned (edit distance, `?` matches anything) to the most confident read of the modal
  plate length. Evidence `W_k(a) = Σ I(c=a) · p · min(S/100, 2.0)`. A character is accepted only if
  `W ≥ 0.9` **and** it holds `≥ 60%` of the evidence. A third, stricter check (`vote_min_consistency`, 40%)
  requires the winner to be read confidently in a reasonable share of one camera's reads that saw the position;
  it was added after a night test where a half-hidden `2` was read as `8` at 0.85 in 4 of 24 reads. Reads that
  are not plate readings at all (PARSeq returning scene words such as `WATER` off a heavily blurred plate:
  a length no Indian layout has, i.e. outside 7–11 characters, or more than a third of the confident characters
  breaking every Indian layout) cast no votes. Both checks only remove evidence, so they can only add `?`.
* **OCR cross-check.** Before fusion, fast-plate-ocr (a plate-trained model) reads the same raw/CLAHE crop
  through the same source gate. Its read is aligned to PARSeq's, and a committed character stays only if
  fast-plate-ocr read the same character there, or PARSeq's own confidence is at least 0.95; otherwise it
  becomes `?` (reason `ocr_disagreement`, both reads shown in the evidence table and report). On the synthetic
  benchmark it cut committed-character error from 4.4% to 1.2% (hard plates 41% to 23%) for 3.8 points of
  recovery (ablation table below). `OCRConfig.cross_check_mode = "veto"` masks only confident contradictions
  instead (almost no effect in tuning); `cross_check = False` turns it off.
* **Plate similarity.** Best of shifts −1/0/+1 (−0.05 per shift), 0.35 credit for `0/O 1/I 8/B 5/S 2/Z 6/G 4/A`,
  times coverage `min(1, |K|/6)`. Specificity = registry plates that fit the known characters exactly.
* **Score.** `0.65·plate + 0.20·colour + 0.15·body + 0.05·make/model`; low light → `0.75 / 0.10`.
  Adjacent shades (silver/grey, white/silver; grey/black at night) get half colour credit; uncertain
  attributes (`< 0.40`) get none.
* **Guardrails.** `|K| = 0` caps the score at 0.45; `< 3` known characters cannot be `MATCHED`; the make/model
  bonus cannot lift a candidate over τ; a candidate that contradicts a confidently read character is listed
  with a mismatch, ranked below every candidate that does not, cannot be `MATCHED`, and is not counted as a
  rival for the ambiguity gap. If the top two candidates have identical plate and body evidence and differ only
  by similar shades (white/silver, silver/grey, grey/black), the result is `AMBIGUOUS`: the evaluation showed a
  white car read as silver deciding a match on its own.
* **Statuses.** `MATCHED` (top ≥ τ, `|K| ≥ 3`, gap ≥ 0.05), `AMBIGUOUS` (gap < 0.05), `NO CONFIDENT MATCH`
  (with a written explanation). τ defaults to 0.55 and can be moved live in the UI.

### Guarantees and how they are enforced

| Rule | Enforcement | Test |
|---|---|---|
| Never invent characters | Only masked (`≥ 0.70`, alphanumeric, format-valid) characters carry weight; two-condition vote | `test_every_fused_char_was_read_confidently_in_a_real_frame` (Hypothesis) |
| Format check only removes | `format_mask` returns the input or `?` per position | `test_format_check_never_invents_or_changes` (Hypothesis) |
| OCR cross-check only removes | `cross_check` returns the input or `?` per position | `test_cross_check_never_invents_or_changes` (Hypothesis) |
| Disagreement stays unknown | `8` vs `B` with similar weight fails the share test | `test_disagreement_8_vs_B_stays_unknown` |
| Super-resolution isolation | SR runs after Stage 3; outputs are `SRImage`, not `PlateCrop`; the OCR gate (used by both OCR backends) refuses other sources and `*_sr.png` paths | `test_pipeline_never_feeds_sr_to_ocr`, `test_gate_rejects_sr_image_and_sr_paths` |
| Matcher guardrails | see above | `tests/test_matcher.py` incl. a Hypothesis bound test and a "true vehicle removed" test |
| Appearance alone never links cameras | Linking needs similarity ≥ threshold, no plate conflict, ≥ 3 agreeing characters, matching body | `test_link_requires_appearance_and_plate_and_body` |
| Graceful degradation | Missing SR weights, vendor Re-ID, Ollama, Chromium or one OCR backend → warning + fallback | `test_super_res_disables_cleanly_without_weights`, `test_ollama_unavailable_falls_back`, `test_pdf_export_or_clean_fallback` |

---

## Investigator app

1. **New case**: one clip, two clips (cross-camera) or hint-only search; plate-hint mask helper; τ slider; CPU/GPU badge.
2. **Live progress** per stage.
3. **Vehicles found**: track cards; amber `?` unknown, blue investigator-supplied, red conflicts; colour/body chips.
4. **Evidence**: plate evidence strip (votes per position and read), frame-by-frame table with raw + CLAHE crops,
   sharpness, raw/masked OCR, the cross-check read, and confidence pills (dashed orange = masked because the
   second OCR model did not confirm it); super-resolution toggle labelled
   *"Visual aid only. Not used for identification."* (or "not installed").
5. **Shortlist**: top-5 cards with stacked score bars, match/mismatch badges, specificity, status banner, advisor.
   **What-if**: edit any plate slot (fill a `?`, flip a look-alike such as 8/B, mark a character unreadable), assume the
   colour is unreliable or seen under sodium street lighting, assume a colour or body type, or move τ. PRISM re-ranks
   the registry under that hypothesis, then varies every slot and the lighting assumption you did not pin and reports
   the **Hypothesis Stability Score** (share of perturbations in which the #1 candidate stays the sole #1), a
   sensitivity matrix of which value hands #1 to whom (click a cell to adopt it), and a **differential justification**
   of why #1 leads #2 and #3 component by component. Read-only: hypotheses are labelled as such and never change the
   case result, report or custody.
6. **Summary & report**: evidence-checked summary with citations; PDF and HTML download; custody hashes.
7. **Cross-camera**: linked pairs with similarity, plate/body checks, speed flag and combined-evidence result.

The threshold slider and the hint box call `POST /api/jobs/{id}/rescore`, which reruns only Stage 5.

## Project website

The same build serves a project website at `/` (the investigator app lives at `/app`):
landing page, How it works, Cases (one page per batch-report case), Evaluation, Guardrails and About.
It uses React Router, framer-motion and Lenis smooth scrolling, with Geist and Instrument Serif fonts, plus
three.js for the cube in the menu (loaded only when the menu opens on a screen at least 1024 px wide).
The theme takes its look from resend.com: a pure black page, display-serif headlines that fade from white to
grey, glass buttons with hairline rings, cards lit along their top edge and by the pointer, and text that blurs
in as it scrolls into view. The earlier layout followed melon.studio. Both are recreated in our own code with
open fonts, and no code, images, fonts or text were taken from resend.com or melon.studio.

Effects: a first-visit intro (about 3 s) in which PRISM's real plate for the night clip decodes on black: each
position flickers through what the clip's 24 frames read there, locks in from left to right, and the position
the frames never agreed on turns into the red `?`; then the page fades up behind the plate and it dissolves;
a full-screen menu whose right side holds a black 3×3×3 puzzle cube (WebGL, after the cube on resend.com, in
our own code) with mixed satin, gloss, perforated and grained faces: it opens scrambled and turns itself back
until its front face reads the night plate's first nine characters, `CG0 4MX 48?`, with the unresolved `?` as
its one red face, then scrambles and solves again (still and solved under reduced motion);
a hero of real night-freeway footage with PRISM's own
YOLO11 + ByteTrack boxes drawn over it, where the car nearest the pointer is tracked; a full-width split wordmark whose letters rise toward the pointer and
drift apart on scroll; centred 16:9 feature cards that scale in, tilt toward the pointer, skew with scroll speed
and keep their caption pinned beside them; a trailing cursor ring that grows over links and shows "View"/"Open"
labels; words that fill red from the pointer; list rows whose red fill enters from the side the pointer came in;
cells that light up; magnetic buttons; scroll-scrubbed text; a scroll-driven cross-camera story.

`scripts/build_site_shots.py` (server running) uploads a demo clip through the API and saves real screenshots
of the investigator app and a report page for the feature cards.

Every image and number on the site is real PRISM output. `scripts/build_site_media.py` copies crops and
evidence strips from the batch-report runs into `frontend/public/media/`, writes
`frontend/src/site/data/cases.json` and `evaluation.json`, and re-runs the real masking + fusion code on the
night clip's 24 reads at τ_char 0.50–0.95 for the interactive fusion demo. Re-run it after
`scripts/batch_report.py` or `scripts/evaluate.py`, then `npm run build`. Report links on the site are served
from `reports/` by `GET /reports/{path}` (`.html`, `.pdf`, `.png` only).

### Third-party media

The highway footage is [Cars driving at night](https://commons.wikimedia.org/wiki/File:Cars_driving_at_night.webm)
by Editor (YouTube), Wikimedia Commons, CC BY 3.0. The turning Verna (`verna_spin.*`, used by the earlier intro and
no longer shown on the site) is cut from a team screen
recording of a 360° studio view (`video_assets/`, git-ignored); its rights are **not verified**, so replace
`verna_spin.*` before any public or commercial use unless you hold them. Its plates were blanked in the source,
and the plate drawn on them is the one PRISM read from day_clear_white. Details are in
`frontend/public/media/CREDITS.md`. `scripts/build_scene_media.py` cuts the 12 s highway loop (H.264 and VP9),
runs the detector on it to write `highway_tracks.json`, and builds `verna_spin.*` and its per-frame boxes.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/jobs` | multipart `file`, optional `hint`, `threshold` → `job_id` |
| GET | `/api/jobs/{job_id}` | status, per-stage progress, result |
| POST | `/api/jobs/{job_id}/rescore` | JSON `{threshold, hint}`; query `track_id`, `clear_hint` |
| POST | `/api/jobs/{job_id}/whatif` | JSON `{track_id, slots: {position: char}, color, body_type, threshold}` → hypothetical shortlist, stability, differentials (read-only) |
| POST | `/api/search` | JSON `{hint, color, body_type, make_model, threshold, low_light}` |
| POST | `/api/crosscam` | multipart `file_a`, `file_b`, optional `hint`, `threshold`, `distance_km`, `gap_s` |
| GET | `/api/report/{job_id}?format=pdf\|html` | forensic report |
| GET | `/artifacts/{path}` | saved crops (path-traversal safe) |
| GET | `/reports/{path}` | pre-built batch reports for the website (`.html`/`.pdf`/`.png`, path-traversal safe) |
| GET | `/health` | device, GPU, models, registry size, config hash, vendor commits |
| GET | `/api/docs` | interactive OpenAPI docs |

## Data

* `data/registry.json`: 50,000 synthetic records from 38 states and UTs (incl. old Delhi `DL3CAB1234` and BH series),
  make/model fixes body type, realistic colour frequencies. Demo vehicles have 3–5 near-duplicate decoys.
* `data/test_clips/`: 9 synthetic CCTV clips built from real vehicle photos, with the original plates covered
  by rendered Indian plates, motion blur, sensor noise, JPEG and night darkening; `labels.json` holds ground truth.
  The 6 car/SUV clips use `vendor/vehicle-reidentification/reference_vehicles`. The two-wheeler
  (`day_scooter_twoline`, two-line rear plate), auto-rickshaw (`day_auto_rickshaw`, yellow commercial plate; COCO
  has no auto-rickshaw class, so CLIP must override YOLO) and truck (`day_white_truck`) clips use the Wikimedia
  Commons photos in `data/vehicle_photos/` (licences and authors in `data/vehicle_photos/CREDITS.md`; the
  auto-rickshaw clip is CC BY-SA 4.0). `scripts/make_degraded.py` makes 6 harder versions of each clip.
  Replace or extend them with team-recorded footage (add the plates to the registry and to `labels.json`).

## Evaluation

<!-- EVAL:START -->
Synthetic plate-sequence benchmark: 120 registry vehicles x 8 degraded frames (raw + CLAHE reads), easy/medium/hard thirds, tau = 0.55. Device: cuda.

**OCR benchmark** (full PRISM fusion + matching; each backend is cross-checked by the other, ms/read is the backend's own time)

| OCR backend | Committed-char error | Recovery | Top-1 | Top-5 | False-match | ms/read |
|---|---|---|---|---|---|---|
| parseq | 1.2% | 64.0% | 67.5% | 68.3% | 1.7% | 25.6 |
| fast_plate_ocr | 0.6% | 40.9% | 39.2% | 41.7% | 1.7% | 17.1 |
| parseq alone (no cross-check) | 4.4% | 67.8% | 68.3% | 69.2% | 0.8% | 25.6 |
| fast_plate_ocr alone (no cross-check) | 1.9% | 42.7% | 39.2% | 42.5% | 0.8% | 17.1 |

Winner: **parseq** (highest top-1 with false-match <= 5%, then lowest committed error).

**Ablation** (parseq)

| Variant | Committed error | Recovery | Top-5 | False-match |
|---|---|---|---|---|
| Best single frame, no fusion | 17.2% | 70.4% | 64.2% | 0.0% |
| Majority vote, no confidence masking | 16.3% | 67.2% | 60.8% | 0.0% |
| + confidence masking | 17.1% | 66.5% | 61.7% | 0.0% |
| + two-condition vote | 11.0% | 66.6% | 65.8% | 4.2% |
| + format check + coverage factor, format violations masked only | 4.8% | 67.9% | 72.5% | 0.0% |
| + layout-constrained decoding | 4.4% | 67.8% | 69.2% | 0.8% |
| + OCR cross-check (full PRISM) | 1.2% | 64.0% | 68.3% | 1.7% |

**Full PRISM by difficulty**

| Level | Committed error | Recovery | Top-1 | Top-5 | False-match |
|---|---|---|---|---|---|
| easy | 0.0% | 99.2% | 100.0% | 100.0% | 0.0% |
| medium | 0.9% | 87.4% | 97.5% | 97.5% | 0.0% |
| hard | 23.1% | 5.1% | 5.0% | 7.5% | 5.0% |

**Threshold sweep**: lowest tau with false-match rate <= 5% is **0.30** (false-match 1.7%, correct MATCHED 65.0%). Plot: `reports/tau_sweep.png`.

**End-to-end clips** (full pipeline: YOLO11 + ByteTrack + fast-alpr + OCR + OpenCLIP)

| Clip | Degradation | Fused plate | Status (expected) | Top-1 | Committed wrong | Colour/body | False-match | s |
|---|---|---|---|---|---|---|---|---|
| day_clear_white.mp4 | none | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 14.4 |
| night_partial_white.mp4 | none | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 10.5 |
| camB_white.mp4 | none | `G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | ok/ok | no | 9.8 |
| day_black_suv.mp4 | none | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 7.8 |
| day_blue_twoline.mp4 | none | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 8.3 |
| unregistered_white.mp4 | none | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | ok/ok | no | 9.8 |
| day_scooter_twoline.mp4 | none | `CG07BK3519` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 14.0 |
| day_auto_rickshaw.mp4 | none | `KA01AH7350` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 13.1 |
| day_white_truck.mp4 | none | `CG04LQ2290` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 7.4 |
| camB_white__gauss.mp4 | gauss | `??04MX4821` | MATCHED (MATCHED) | yes | 0/8 | x/ok | no | 9.3 |
| camB_white__motion.mp4 | motion | `??0??X4?2?` | AMBIGUOUS (MATCHED) | no | 0/4 | x/ok | no | 9.3 |
| camB_white__down2x.mp4 | down2x | `G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | ok/ok | no | 8.8 |
| camB_white__down4x.mp4 | down4x | `??0?MX4?21` | AMBIGUOUS (MATCHED) | yes | 0/6 | x/ok | YES | 8.6 |
| camB_white__jpeg20.mp4 | jpeg20 | `G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | ok/ok | no | 10.7 |
| camB_white__noise_dark.mp4 | noise_dark | `G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 9.7 |
| day_auto_rickshaw__gauss.mp4 | gauss | `KA01AH7350` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 14.4 |
| day_auto_rickshaw__motion.mp4 | motion | `` | NO CONFIDENT MATCH (MATCHED) | yes | 0/0 | ok/ok | no | 15.0 |
| day_auto_rickshaw__down2x.mp4 | down2x | `KA01AH7350` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 12.3 |
| day_auto_rickshaw__down4x.mp4 | down4x | `KA01AH7350` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 12.3 |
| day_auto_rickshaw__jpeg20.mp4 | jpeg20 | `KA01AH7350` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 11.3 |
| day_auto_rickshaw__noise_dark.mp4 | noise_dark | `KA01AH7350` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 10.5 |
| day_black_suv__gauss.mp4 | gauss | `M?12DE5678` | MATCHED (MATCHED) | yes | 0/9 | ok/x | no | 7.7 |
| day_black_suv__motion.mp4 | motion | `???2?E?67?` | AMBIGUOUS (MATCHED) | yes | 0/4 | ok/ok | YES | 8.5 |
| day_black_suv__down2x.mp4 | down2x | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 7.1 |
| day_black_suv__down4x.mp4 | down4x | `?H?2DE5?7?` | AMBIGUOUS (MATCHED) | yes | 0/6 | ok/ok | no | 6.7 |
| day_black_suv__jpeg20.mp4 | jpeg20 | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 7.8 |
| day_black_suv__noise_dark.mp4 | noise_dark | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 7.6 |
| day_blue_twoline__gauss.mp4 | gauss | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 7.7 |
| day_blue_twoline__motion.mp4 | motion | `` | NO CONFIDENT MATCH (MATCHED) | no | 0/0 | ok/ok | no | 6.9 |
| day_blue_twoline__down2x.mp4 | down2x | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 7.3 |
| day_blue_twoline__down4x.mp4 | down4x | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 7.0 |
| day_blue_twoline__jpeg20.mp4 | jpeg20 | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 8.5 |
| day_blue_twoline__noise_dark.mp4 | noise_dark | `` | NO CONFIDENT MATCH (MATCHED) | no | 0/0 | ok/ok | no | 7.0 |
| day_clear_white__gauss.mp4 | gauss | `C??4MX4???` | AMBIGUOUS (MATCHED) | yes | 0/5 | x/ok | no | 8.8 |
| day_clear_white__motion.mp4 | motion | `C?04?X4?21` | AMBIGUOUS (MATCHED) | yes | 0/7 | x/ok | no | 9.2 |
| day_clear_white__down2x.mp4 | down2x | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.0 |
| day_clear_white__down4x.mp4 | down4x | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 8.5 |
| day_clear_white__jpeg20.mp4 | jpeg20 | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.7 |
| day_clear_white__noise_dark.mp4 | noise_dark | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 9.6 |
| day_scooter_twoline__gauss.mp4 | gauss | `CG07BK3519` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 11.7 |
| day_scooter_twoline__motion.mp4 | motion | `CG07BK351?` | AMBIGUOUS (MATCHED) | yes | 0/9 | x/ok | YES | 10.2 |
| day_scooter_twoline__down2x.mp4 | down2x | `CG07BK3519` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 15.1 |
| day_scooter_twoline__down4x.mp4 | down4x | `CG07BK3519` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 10.8 |
| day_scooter_twoline__jpeg20.mp4 | jpeg20 | `` | NO CONFIDENT MATCH (MATCHED) | no | 0/0 | x/ok | no | 15.0 |
| day_scooter_twoline__noise_dark.mp4 | noise_dark | `` | NO CONFIDENT MATCH (MATCHED) | no | 0/0 | x/ok | no | 9.2 |
| day_white_truck__gauss.mp4 | gauss | `CG04LQ2290` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 7.7 |
| day_white_truck__motion.mp4 | motion | `C?04LQ2290` | MATCHED (MATCHED) | yes | 0/9 | ok/ok | no | 7.9 |
| day_white_truck__down2x.mp4 | down2x | `CG04LQ2290` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 6.8 |
| day_white_truck__down4x.mp4 | down4x | `CG04LQ2290` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 7.0 |
| day_white_truck__jpeg20.mp4 | jpeg20 | `CG04LQ2290` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 7.7 |
| day_white_truck__noise_dark.mp4 | noise_dark | `CG04LQ2290` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 7.6 |
| night_partial_white__gauss.mp4 | gauss | `C?04MX4??1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/7 | x/ok | no | 9.6 |
| night_partial_white__motion.mp4 | motion | `??04?X4???` | AMBIGUOUS (AMBIGUOUS) | no | 0/4 | x/ok | no | 9.1 |
| night_partial_white__down2x.mp4 | down2x | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 8.5 |
| night_partial_white__down4x.mp4 | down4x | `CG04MX4??1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/8 | x/ok | no | 8.5 |
| night_partial_white__jpeg20.mp4 | jpeg20 | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 9.2 |
| night_partial_white__noise_dark.mp4 | noise_dark | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 9.1 |
| unregistered_white__gauss.mp4 | gauss | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 9.6 |
| unregistered_white__motion.mp4 | motion | `?H?4XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/8 | x/ok | no | 9.4 |
| unregistered_white__down2x.mp4 | down2x | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | ok/ok | no | 9.0 |
| unregistered_white__down4x.mp4 | down4x | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 9.0 |
| unregistered_white__jpeg20.mp4 | jpeg20 | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | ok/ok | no | 10.3 |
| unregistered_white__noise_dark.mp4 | noise_dark | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 9.8 |

Clips (63): status as designed 81.0%, committed-char error 0.0%, recovery 83.5%, top-1 89.3%, top-5 92.9%, MATCHED to the wrong vehicle 0, false-match with true vehicle removed 11.1%, colour 52.4%, body 93.7%, mean 9.5 s/clip.

By body type (clips incl. degraded versions): SUV 7 clips, body type 42.9%, top-1 100.0%; auto-rickshaw 7 clips, body type 100.0%, top-1 100.0%; car 35 clips, body type 100.0%, top-1 85.7%; truck 7 clips, body type 100.0%, top-1 100.0%; two-wheeler 7 clips, body type 100.0%, top-1 71.4%.
<!-- EVAL:END -->

## Configuration and degradation

Everything is in `prism/config.py`. Environment overrides: `PRISM_DEVICE=cpu|cuda`,
`PRISM_OCR_BACKEND=parseq|fast_plate_ocr`, `PRISM_NARRATIVE=template|ollama`,
`PRISM_REID_ENCODER=clip|osnet|resnet`, `PRISM_RUNS_DIR`, `PRISM_WEIGHTS_DIR`, `PRISM_REGISTRY_PATH`.

**Using a real registry.** The bundled `data/registry.json` is 50,000 synthetic records, so a real plate such as
`KA02MN1826` gets `NO CONFIDENT MATCH` with "this vehicle is not in the loaded registry". PRISM has no access to
VAHAN or any government database; that needs authorisation from MoRTH / NIC. To match real vehicles, export
the records you are authorised to use into the same JSON fields (`registry_id`, `plate`, `color`,
`body_type`, `make`, `model`, `owner_region`) and start the server with `PRISM_REGISTRY_PATH=path\to\file.json`.

**One vehicle, one track.** ByteTrack sometimes gives one vehicle several IDs (a second box on the same car,
or a new ID after an occlusion). `prism/track_merge.py` folds them into one track when their plates agree on
at least 6 known characters with no conflict, both are plate-length (8+ characters), they are the same class
group (two-wheelers never merge with cars), and their boxes never appear apart in the same frame. The card
then shows "merged tracker IDs …". Plate frames are ranked by plate width × `min(1, sharpness / 1000)`, so
clear close-ups are kept over small far crops whose Laplacian variance is inflated by noise.

**Make/model outside the registry.** OpenCLIP also scores 27 common makes that are not in the synthetic
registry (Volvo, BMW, Mercedes-Benz, Audi, Skoda, MG and others; `EXTRA_CLIP_MODELS`), so an unlisted car is no
longer forced onto the nearest registry model. Those labels never add score. Below 0.40 confidence the UI shows
"not recognised" rather than naming the closest guess.

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

## Known limitations (from the evaluation above)

* **Hard plates.** On the hardest synthetic third (70–100 px wide, heavy blur, 1–2 smeared characters) PARSeq,
  a general scene-text model, often returns confident wrong characters. The read-length rule and the OCR
  cross-check bring committed-character error there down to 23% (0% easy, 0.9% medium; 54% before these changes,
  measured on a slightly different vehicle sample because the registry was regenerated). PRISM now recovers only
  about 5% of the characters on those plates, and 23% wrong is still too many to trust. A plate-specific OCR
  fine-tuned on Indian plates is the main improvement still open.
* **The cross-check trades recovery for safety.** On the original 42 clips (6 clips and their degraded versions,
  compared with the previous code on the same 50,000-record registry), committed wrong characters went from 2 to
  0: the two night clips that read a half-hidden `2` as `8` now leave it as `?` and return `AMBIGUOUS` as designed.
  In exchange, recovery fell from 90.7% to 82.9%, and 5 blurred or downscaled clips that were `MATCHED` are now
  `AMBIGUOUS` (the true vehicle is still #1 in 4 of them). If recovery matters more than safety for a deployment,
  `cross_check_mode = "veto"` only masks confident contradictions; on the synthetic benchmark it behaved almost
  like no cross-check.
* **"True vehicle removed".** When the true record is removed from the registry, 7 of the 63 clips (11.1%) report
  a decoy as `MATCHED`. In each, the characters PRISM could read fit that decoy exactly (for the night clips,
  REG-0002 `CG04MX4851` differs from REG-0001 only at the smeared position), so no system could separate them from
  that evidence. Across the 63 clips no vehicle was `MATCHED` to the wrong registry entry while the true one was present.
* **Colour.** Reading colour from a denoised crop raised colour accuracy from 33% to 57% on the original 42 clips
  (52% across all 63). The white Tata Ace is still read as yellow in 4 of its 7 versions, the grey scooter as
  silver (half credit) in most, and the white car at night as grey or silver. Similar-shade credit, the uncertain rule and the
  similar-shade guardrail keep colour from deciding matches.
* **Two-line plates under heavy degradation.** The scooter's two-line plate is lost completely in the JPEG-20 and
  noise + dark versions (two-wheeler top-1 71%, against 100% for the auto-rickshaw and truck clips). The black
  Innova (registry body type SUV/MPV) is read as a car in 4 of its 7 versions.
* **Synthetic data.** The demo clips are composites built from real vehicle photos; real CCTV is harder.
  Add team-recorded clips to `data/test_clips/labels.json` and rerun `scripts/evaluate.py --clips`.

The specification used is `docs/proposed_solution.md` (the final version of the proposed solution) together
with `docs/Hackasol_5.0_Problem_Statement.pdf`, page 5.
