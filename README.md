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
.venv\Scripts\python.exe data\generate_registry.py              # 500 synthetic records -> data/registry.json
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
| `frontend/` | React + Vite + Tailwind investigator app (`/app`) and project website (`/`, `src/site/`) |
| `data/generate_registry.py` | 500 synthetic records with decoys |
| `scripts/` | Demo clips, degradation, evaluation, batch reports, weight download |

### The matching algorithm (team-designed)

* **Fusion.** Reads are aligned (edit distance, `?` matches anything) to the most confident read of the modal
  plate length. Evidence `W_k(a) = Σ I(c=a) · p · min(S/100, 2.0)`. A character is accepted only if
  `W ≥ 0.9` **and** it holds `≥ 60%` of the evidence. A third, stricter check (`vote_min_consistency`, 40%)
  requires the winner to be read confidently in a reasonable share of one camera's reads that saw the position;
  it was added after a night test where a half-hidden `2` was read as `8` at 0.85 in 4 of 24 reads. Reads that
  are not plate readings at all (PARSeq returning scene words such as `WATER` off a heavily blurred plate:
  wrong length, or more than a third of the confident characters breaking every Indian layout) cast no votes.
  Both checks only remove evidence, so they can only add `?`.
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

## Project website

The same build serves a project website at `/` (the investigator app lives at `/app`):
landing page, How it works, Cases (one page per batch-report case), Evaluation, Guardrails, Docs and About.
It uses React Router, framer-motion, Lenis smooth scrolling and a small WebGL shader, with Geist fonts.
The colour palette, type scale and easings follow melon.studio's public design tokens (`#0f0000` black,
`#f6efed` paper, pure red, `#ffb3b3` pink, `#45e0ea → #1497ac` wordmark gradient); layout and motion are
recreated in our own code, and no code, images or text were taken from melon.studio.

Effects: loader with a filling mark and counter; a red-and-black sheet page transition; a WebGL liquid hero
that bends and glows around the pointer; a full-width split wordmark whose letters rise toward the pointer and
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
| GET | `/reports/{path}` | pre-built batch reports for the website (`.html`/`.pdf`/`.png`, path-traversal safe) |
| GET | `/health` | device, GPU, models, registry size, config hash, vendor commits |
| GET | `/api/docs` | interactive OpenAPI docs (moved from `/docs`, which is the website's Docs page) |

## Data

* `data/registry.json`: 500 synthetic records (CG, MH, KA, DL incl. old Delhi `DL3CAB1234`, BH series),
  make/model fixes body type, realistic colour frequencies. Demo vehicles have 3–5 near-duplicate decoys.
* `data/test_clips/`: synthetic CCTV clips built from the real vehicle photos in
  `vendor/vehicle-reidentification/reference_vehicles`, with the original plates covered by rendered Indian
  plates, motion blur, sensor noise, JPEG and night darkening; `labels.json` holds ground truth.
  Replace or extend them with team-recorded footage (add the plates to the registry and to `labels.json`).

## Evaluation

<!-- EVAL:START -->
Synthetic plate-sequence benchmark: 120 registry vehicles x 8 degraded frames (raw + CLAHE reads), easy/medium/hard thirds, tau = 0.55. Device: cuda.

**OCR benchmark** (full PRISM fusion + matching)

| OCR backend | Committed-char error | Recovery | Top-1 | Top-5 | False-match | ms/read |
|---|---|---|---|---|---|---|
| parseq | 6.4% | 69.1% | 72.5% | 79.2% | 0.8% | 56.1 |
| fast_plate_ocr | 3.0% | 44.8% | 51.7% | 62.5% | 0.8% | 28.9 |

Winner: **parseq** (highest top-1 with false-match <= 5%, then lowest committed error).

**Ablation** (parseq)

| Variant | Committed error | Recovery | Top-5 | False-match |
|---|---|---|---|---|
| Best single frame, no fusion | 15.6% | 73.3% | 75.8% | 0.0% |
| Majority vote, no confidence masking | 13.9% | 68.3% | 72.5% | 0.0% |
| + confidence masking | 14.9% | 67.4% | 73.3% | 0.0% |
| + two-condition vote | 10.3% | 69.1% | 76.7% | 0.8% |
| + format check + coverage factor (full PRISM) | 6.4% | 69.1% | 79.2% | 0.8% |

**Full PRISM by difficulty**

| Level | Committed error | Recovery | Top-1 | Top-5 | False-match |
|---|---|---|---|---|---|
| easy | 0.0% | 99.2% | 97.5% | 97.5% | 0.0% |
| medium | 2.2% | 93.5% | 95.0% | 97.5% | 2.5% |
| hard | 44.3% | 15.1% | 25.0% | 42.5% | 0.0% |

**Threshold sweep**: lowest tau with false-match rate <= 5% is **0.30** (false-match 3.3%, correct MATCHED 62.5%). Plot: `reports/tau_sweep.png`.

**End-to-end clips** (full pipeline: YOLO11 + ByteTrack + fast-alpr + OCR + OpenCLIP)

| Clip | Degradation | Fused plate | Status (expected) | Top-1 | Committed wrong | Colour/body | False-match | s |
|---|---|---|---|---|---|---|---|---|
| day_clear_white.mp4 | none | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 27.5 |
| night_partial_white.mp4 | none | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 11.0 |
| camB_white.mp4 | none | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 11.8 |
| day_black_suv.mp4 | none | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 10.1 |
| day_blue_twoline.mp4 | none | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.9 |
| unregistered_white.mp4 | none | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 11.1 |
| camB_white__gauss.mp4 | gauss | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 11.1 |
| camB_white__motion.mp4 | motion | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 11.3 |
| camB_white__down2x.mp4 | down2x | `G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 10.0 |
| camB_white__down4x.mp4 | down4x | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 10.2 |
| camB_white__jpeg20.mp4 | jpeg20 | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 11.8 |
| camB_white__noise_dark.mp4 | noise_dark | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 11.2 |
| day_black_suv__gauss.mp4 | gauss | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 9.2 |
| day_black_suv__motion.mp4 | motion | `` | NO CONFIDENT MATCH (MATCHED) | yes | 0/0 | ok/ok | no | 9.2 |
| day_black_suv__down2x.mp4 | down2x | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.4 |
| day_black_suv__down4x.mp4 | down4x | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.1 |
| day_black_suv__jpeg20.mp4 | jpeg20 | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 10.0 |
| day_black_suv__noise_dark.mp4 | noise_dark | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 9.2 |
| day_blue_twoline__gauss.mp4 | gauss | `??????` | NO CONFIDENT MATCH (MATCHED) | yes | 0/0 | ok/ok | no | 8.8 |
| day_blue_twoline__motion.mp4 | motion | `???P00?3` | NO CONFIDENT MATCH (MATCHED) | no | 2/4 | ok/ok | no | 9.5 |
| day_blue_twoline__down2x.mp4 | down2x | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.3 |
| day_blue_twoline__down4x.mp4 | down4x | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.9 |
| day_blue_twoline__jpeg20.mp4 | jpeg20 | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 10.6 |
| day_blue_twoline__noise_dark.mp4 | noise_dark | `KA05MN` | NO CONFIDENT MATCH (MATCHED) | yes | 0/6 | ok/ok | no | 9.4 |
| day_clear_white__gauss.mp4 | gauss | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 11.0 |
| day_clear_white__motion.mp4 | motion | `??????4?2?` | NO CONFIDENT MATCH (MATCHED) | no | 0/2 | x/ok | no | 10.5 |
| day_clear_white__down2x.mp4 | down2x | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 10.1 |
| day_clear_white__down4x.mp4 | down4x | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 9.6 |
| day_clear_white__jpeg20.mp4 | jpeg20 | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 10.7 |
| day_clear_white__noise_dark.mp4 | noise_dark | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 11.0 |
| night_partial_white__gauss.mp4 | gauss | `CG04MX4???` | AMBIGUOUS (AMBIGUOUS) | no | 0/7 | x/ok | no | 11.3 |
| night_partial_white__motion.mp4 | motion | `` | NO CONFIDENT MATCH (AMBIGUOUS) | no | 0/0 | x/ok | no | 10.6 |
| night_partial_white__down2x.mp4 | down2x | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 9.5 |
| night_partial_white__down4x.mp4 | down4x | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 9.5 |
| night_partial_white__jpeg20.mp4 | jpeg20 | `CG04MX4881` | NO CONFIDENT MATCH (AMBIGUOUS) | yes | 1/10 | x/ok | no | 10.6 |
| night_partial_white__noise_dark.mp4 | noise_dark | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 9.8 |
| unregistered_white__gauss.mp4 | gauss | `M??4XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/8 | x/ok | no | 9.8 |
| unregistered_white__motion.mp4 | motion | `?H?4XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/8 | x/ok | no | 9.2 |
| unregistered_white__down2x.mp4 | down2x | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 9.2 |
| unregistered_white__down4x.mp4 | down4x | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 9.9 |
| unregistered_white__jpeg20.mp4 | jpeg20 | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 11.4 |
| unregistered_white__noise_dark.mp4 | noise_dark | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 11.2 |

Clips (42): status as designed 83.3%, committed-char error 0.8%, recovery 83.6%, top-1 88.6%, top-5 97.1%, MATCHED to the wrong vehicle 0, false-match with true vehicle removed 9.5%, colour 33.3%, body 90.5%, mean 10.6 s/clip.
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

## Known limitations (from the evaluation above)

* **Hard plates.** On the hardest synthetic third (70–100 px wide, heavy blur, 1–2 smeared characters) PARSeq,
  a general scene-text model, often returns confident wrong characters, and committed-character error is
  about 44% there (0% easy, 2% medium). Those reads mostly end in `NO CONFIDENT MATCH` rather than a false
  match (false-match 0% on the hard third), but the committed characters themselves are not trustworthy.
  A plate-specific OCR fine-tuned on Indian plates is the main improvement still open.
* **Consistent OCR errors.** In the JPEG-20 night clip a half-hidden `2` was read as `8` consistently enough to
  pass every vote check. PRISM then reported `NO CONFIDENT MATCH` (the true plate contradicts the `8`), which
  is safe but not useful.
* **"True vehicle removed" on the night clips.** When REG-0001 is removed, its decoy REG-0002 (`CG04MX4851`)
  fits every character the night clip shows, so PRISM reports it as `MATCHED`. No system could separate them
  from that evidence; this accounts for all 4 such cases (9.5%) in the clip benchmark. Across the 42 clips,
  no vehicle was `MATCHED` to the wrong registry entry while the true one was present.
* **Colour.** OpenCLIP read the white demo car as grey or silver in most clips (colour accuracy 33%). Similar-
  shade credit, the uncertain rule and the similar-shade guardrail keep this from deciding matches.
* **Synthetic data.** The demo clips are composites built from real vehicle photos; real CCTV is harder.
  Add team-recorded clips to `data/test_clips/labels.json` and rerun `scripts/evaluate.py --clips`.

The specification used is `docs/proposed_solution.md` (the final version of the proposed solution) together
with `docs/Hackasol_5.0_Problem_Statement.pdf`, page 5.
