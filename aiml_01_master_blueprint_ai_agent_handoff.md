# Hackasol 5.0 — AIML-01: Vehicle Identification & Traceability from CCTV Footage
## Master Technical Blueprint & AI Coding Agent Handoff Specification

---

## 1. Problem Statement & Strict Compliance Matrix

**Track:** Track 2 — AIML (Option A: `AIML-01`)  
**Goal:** Turn blurry CCTV footage and a partial number plate into a ranked, explainable shortlist of possible vehicles from a vehicle registry.

Every requirement from the Hackasol 5.0 Problem Statement is mapped below to a concrete technical component in our combined pipeline:

| Hackasol 5.0 Requirement | Type | Architectural Solution | Strict Constraint / Guardrail |
| :--- | :--- | :--- | :--- |
| **Multi-frame plate recovery** | Must-have | `YOLOv11 + ByteTrack` $\rightarrow$ `fast-alpr` (YOLOv9 plate detector) $\rightarrow$ `PARSeq` OCR $\rightarrow$ Position-weighted multi-frame fusion | Unreadable or low-confidence characters ($p < \tau_{\text{char}}$) **MUST** be marked as `?` (`unknown`) and **NEVER** invented or hallucinated. |
| **Attribute extraction** | Must-have | `OpenCLIP` (`ViT-B-32`) zero-shot classification on the top-3 sharpest vehicle crops per track | Must detect vehicle **colour** and **body type** (`car`, `SUV`, `two-wheeler`, `auto-rickshaw`, `truck`, `bus`). |
| **Registry matching & ranking** | Must-have | Custom wildcard-aware multi-attribute scoring engine | Must return a ranked **top-5 shortlist** with a numeric **confidence score** and explicit **human-readable reasons** per candidate. |
| **No-match handling** | Must-have | Minimum confidence cutoff ($\tau_{\text{match}}$) & margin check | If no registry entry exceeds $\tau_{\text{match}}$, return `"no confident match"` instead of forcing a false positive. |
| **Investigator UI & Report** | Must-have | FastAPI backend + React/Next.js (or Streamlit) UI + `WeasyPrint` HTML-to-PDF exporter | Must allow clip upload, live result review, and export a **PDF/HTML report** showing: (1) exact frames used, (2) per-frame recovered characters with confidence, (3) match reasoning. |
| **Make & model recognition** | Bonus | Secondary `OpenCLIP` prompt bank over common Indian vehicle makes/models | Optional additive score boost; must not break base scoring if uncertain. |
| **Cross-camera vehicle tracking** | Bonus | `OpenCLIP` / `OSNet` visual embeddings + cosine similarity across two uploaded clips | Match identical vehicle appearances across different camera angles/lighting. |

---

## 2. Research Foundation & Architecture Justification

### 2.1 Why a Hybrid (CNN + Transformer + Vision-Language) Architecture?
Pure Vision Transformers (ViTs) are computationally heavy for real-time frame-by-frame CCTV processing and require large domain-specific datasets to generalize. Pure CNNs excel at fast spatial localization but struggle with occluded/blurry character sequences and zero-shot fine-grained attributes (like distinguishing Indian auto-rickshaws from hatchbacks or SUVs).

Our combined system uses **each paradigm where it is strongest**:
* **CNNs** for fast frame-level vehicle detection (`YOLOv11`) and license plate localization (`YOLOv9` via `fast-alpr`).
* **Transformers** for sequence-aware, uncertainty-calibrated license plate OCR (`PARSeq`).
* **Vision-Language Models** (`OpenCLIP`) for lighting-robust color, body-type, and make/model classification without training custom classifiers from scratch.

### 2.2 Referenced Research Papers & Key Takeaways

1. **Hybrid Vehicle Detection — Tian et al. (2025)**  
   * *Paper:* "A Dynamic Transformer Network for Vehicle Detection" (*arXiv:2506.02765*).  
   * *Insight:* Demonstrates that combining convolutional spatial locality with attention mechanisms significantly improves vehicle detection under varying traffic density, occlusion, and CCTV angles.
2. **Blurry License Plate Super-Resolution — Nascimento et al. (2023) & Hamdi et al. (2021)**  
   * *Papers:* Nascimento et al., "Super-resolution of license plate images using attention modules and sub-pixel convolution layers" (*Computers & Graphics*, 113, 69–76, 2023); Hamdi et al., "A New Image Enhancement and Super Resolution technique for license plate recognition" (*Heliyon*, 7, e08341, 2021).  
   * *Insight & Critical Safety Decision:* Super-resolution (SR) networks can reconstruct strokes on severely downsampled plates, boosting visual legibility. **However**, generative/SR networks risk *hallucinating* plausible characters (e.g., turning a blurry `8` into `B` or `3`), which directly violates the AIML-01 rule: *"Characters that cannot be read must be marked unknown, never invented."* Therefore, **SR is kept strictly as an optional visual-aid preview for human investigators**, never as the primary input to the OCR confidence pipeline.
3. **Transformer-Based Scene Text Recognition — Bautista & Atienza (2022)**  
   * *Paper:* "Scene Text Recognition with Permuted Autoregressive Sequence Models" (PARSeq, *ECCV 2022*).  
   * *Insight:* Uses Permutation Language Modeling within a Transformer decoder to model bidirectional character context and outputs calibrated **per-character softmax probabilities**, enabling strict `unknown` (`?`) masking.
4. **Surveillance Vehicle Color & Attribute Recognition — Rachmadi & Purnama (2015) & Su et al. (2015)**  
   * *Papers:* Rachmadi & Purnama, "Vehicle Color Recognition using Convolutional Neural Network" (*arXiv:1510.07391*); Su et al., "Vehicle Color Recognition in The Surveillance with Deep Convolutional Neural Networks" (*JIMET 2015*).  
   * *Insight:* Deep visual feature extractors outperform raw HSV/RGB color histograms under harsh city surveillance shadows, glare, and night-time lighting. Upgrading this principle to pre-trained `OpenCLIP` preserves lighting invariance while adding zero-shot support for Indian vehicle body types.

---

## 3. Pre-Flight Setup: Repositories to Clone Before Running the AI Agent

Before giving the Problem Statement PDF and this document to your AI coding agent, create a clean project folder and clone the following repositories into a `./vendor/` directory. This gives the agent direct local access to the exact model APIs, inference scripts, and codebases.

### 3.1 Clone Commands

```bash
mkdir -p hackasol-aiml01/vendor
cd hackasol-aiml01/vendor

# 1. Core ALPR (YOLOv9 ONNX License Plate Detector + Modular OCR Pipeline)
git clone https://github.com/ankandrew/fast-alpr.git

# 2. Core OCR (PARSeq Transformer with Per-Character Confidence Scores)
git clone https://github.com/baudm/parseq.git

# 3. Core Vehicle Detection & ByteTrack Multi-Object Tracking
git clone https://github.com/ultralytics/ultralytics.git

# 4. Core Attribute Extraction (Zero-Shot Color, Body Type, Make/Model)
git clone https://github.com/mlfoundations/open_clip.git

# 5. Optional Visual Aid Reference (License Plate Super-Resolution - Visual Preview Only)
git clone https://github.com/valfride/lpr-rsr-ext.git

# 6. Optional Bonus Reference (Cross-Camera Vehicle Re-Identification)
git clone https://github.com/kHarshit/vehicle-reidentification.git
```

### 3.2 Recommended Workspace Directory Structure

Keep this folder structure ready before invoking the AI coding agent:

```text
hackasol-aiml01/
├── docs/
│   ├── Hackasol_5.0_Problem_Statement.pdf
│   └── AIML_01_Master_Blueprint.md          <-- This file
├── vendor/                                  <-- Pre-cloned reference repos (read-only)
│   ├── fast-alpr/
│   ├── parseq/
│   ├── ultralytics/
│   ├── open_clip/
│   ├── lpr-rsr-ext/
│   └── vehicle-reidentification/
├── data/
│   ├── registry.json                        <-- Synthetic Indian vehicle registry (500-1000 rows)
│   └── sample_clips/                        <-- Test CCTV clips (.mp4)
├── backend/                                 <-- Agent will generate code here
│   ├── app/
│   │   ├── main.py                          <-- FastAPI server
│   │   ├── pipeline.py                      <-- Combined 5-stage CV pipeline
│   │   ├── fusion.py                        <-- Multi-frame plate alignment & voting
│   │   ├── matcher.py                       <-- Custom registry matching & ranking algorithm
│   │   ├── reid.py                          <-- Bonus: Cross-camera matching
│   │   └── report_generator.py              <-- HTML/PDF report builder
│   └── requirements.txt
└── frontend/                                <-- Agent will generate Investigator UI here
```

### 3.3 Base Python Dependencies (`backend/requirements.txt`)

```text
ultralytics>=8.3.0
fast-alpr[onnx-gpu]
torch>=2.1.0
torchvision>=0.16.0
open-clip-torch>=2.24.0
opencv-python-headless>=4.9.0
pillow>=10.0.0
numpy>=1.26.0
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-multipart>=0.0.9
pydantic>=2.7.0
jinja2>=3.1.4
weasyprint>=62.0
```
*(Note: If running on CPU without CUDA, replace `fast-alpr[onnx-gpu]` with `fast-alpr[onnx]`.)*

---

## 4. Combined 5-Stage Hybrid Model Architecture

The AI coding agent must integrate the pre-trained models from the cloned repositories into one cohesive, modular inference pipeline (`backend/app/pipeline.py`).

### Stage 1: Vehicle Detection & Multi-Frame Tracking (CNN)
* **Model:** `YOLO("yolo11s.pt")` with `tracker="bytetrack.yaml"` (from `ultralytics`).
* **Filter Classes:** Retain only COCO vehicle classes (`2: car`, `3: motorcycle`, `5: bus`, `7: truck`) and optionally expand crops slightly ($+5\%$ padding) to avoid clipping license plates near bumper edges.
* **Output:** A dictionary keyed by `track_id`, storing frame index $t$, bounding box $(x_1, y_1, x_2, y_2)$, detection confidence, and vehicle crop $V_t$.

### Stage 2: License Plate Localization & Blur Filtering (CNN)
* **Model:** `fast-alpr` detector (`yolo-v9-t-384-license-plate-end2end`).
* **Sharpness Metric:** For every detected plate crop $I_t$ (converted to grayscale), compute the Laplacian variance:
  $$S_t = \mathrm{Var}\left(\nabla^2 I_t\right)$$
* **Filtering Rule:** Discard plate crops with $S_t < \tau_{\text{blur}}$ (default $\tau_{\text{blur}} = 45.0$) or width $< 30\text{ px}$. Retain up to the top $K = 12$ sharpest frames per `track_id` for OCR and audit reporting.

### Stage 3: Uncertainty-Aware Plate OCR (Transformer)
* **Model:** `PARSeq` (`torch.hub.load('baudm/parseq', 'parseq', pretrained=True)` or imported from `vendor/parseq`).
* **Per-Character Confidence Masking:** Let $\hat{c}_{t,k}$ be the predicted character at position $k$ in frame $t$ with softmax probability $p_{t,k}$, and let $\mathcal{A} = \{\text{A--Z}, \text{0--9}\}$. Apply strict masking:
  $$c_{t,k} = \begin{cases} \hat{c}_{t,k} & \text{if } p_{t,k} \ge \tau_{\text{char}} \text{ and } \hat{c}_{t,k} \in \mathcal{A} \\ \text{?} & \text{otherwise} \end{cases}$$
  where default $\tau_{\text{char}} = 0.70$.
* **Audit Logging:** Store the exact frame thumbnail, raw `PARSeq` string, masked string, per-character probabilities, and $S_t$ so every decision is visible in the final Investigator Report.

### Stage 4: Vehicle Attribute Extraction (Vision-Language)
* **Model:** `OpenCLIP` (`ViT-B-32`, pretrained `laion2b_s34b_b79k`).
* **Execution:** Run on the top-3 sharpest vehicle crops of each `track_id` and average the softmax probability vectors across the 3 crops to suppress single-frame glare/shadow noise.
* **Prompt Banks:**
  * **Color:** `white`, `black`, `silver`, `grey`, `red`, `blue`, `green`, `yellow`, `brown`, `orange`.
  * **Body Type:** `sedan car`, `SUV`, `hatchback`, `two-wheeler motorcycle or scooter`, `auto-rickshaw`, `truck`, `bus`.
  * **Bonus (Make & Model):** Common Indian makes/models (e.g., `Maruti Suzuki Swift`, `Hyundai Creta`, `Tata Nexon`, `Mahindra Scorpio`, `Honda Activa`, `Bajaj Auto-Rickshaw`, `Toyota Innova`, `Tata Ace`).

### Stage 5: Multi-Frame Plate Fusion & Explainable Registry Ranking (Custom Algorithm)

#### 5.1 Position-Weighted Multi-Frame Character Fusion (`fusion.py`)
Given the set of valid frames $\mathcal{T}$ for a tracked vehicle:
1. Determine the consensus plate length $L$ via the mode of non-empty OCR read lengths (or align reads to the longest high-confidence read using sequence alignment).
2. For each character slot $k \in \{0, \dots, L-1\}$ and candidate alphanumeric character $a \in \mathcal{A}$, compute the accumulated evidence weight:
   $$W_k(a) = \sum_{t \in \mathcal{T}} \mathbb{I}(c_{t,k} = a) \cdot p_{t,k} \cdot \min\left(\frac{S_t}{S_{\text{ref}}}, 2.0\right)$$
   where $S_{\text{ref}} = 100.0$ normalizes frame sharpness and caps extreme outlier weights at $2.0$.
3. Select the winning character at position $k$:
   $$c^*_k = \begin{cases} \arg\max_{a \in \mathcal{A}} W_k(a) & \text{if } \max_{a} W_k(a) \ge \tau_{\text{vote}} \\ \text{?} & \text{otherwise} \end{cases}$$
   If no frame had a confident character at slot $k$, $c^*_k$ **remains `?`**.

#### 5.2 Wildcard-Aware Registry Matching & Ranking (`matcher.py`)
For a tracked vehicle $v$ with fused partial plate $P_v$ (containing `?` wildcards), color $C_v$, body type $B_v$, and optional investigator-provided partial plate hint $P_{\text{hint}}$:

1. **Plate Similarity ($\text{Sim}_{\text{plate}}$):**
   Let $\mathcal{K} = \{k \mid P_v[k] \neq \text{?}\}$ be the set of known character indices. Using sliding-window alignment (to tolerate 1-character prefix/suffix drops on occluded plates), compute the best normalized match against registry plate $P_r$:
   $$\text{Sim}_{\text{plate}}(P_v, P_r) = \begin{cases} \max_{\delta \in \{-1, 0, 1\}} \frac{1}{|\mathcal{K}|} \sum_{k \in \mathcal{K}} \mathbb{I}\!\left(P_r[k+\delta] = P_v[k]\right) & \text{if } |\mathcal{K}| > 0 \\ 0.0 & \text{if } |\mathcal{K}| = 0 \end{cases}$$
   *Optional Confusable-Pair Soft Credit:* Award $0.35$ partial credit (instead of $0.0$) for known CCTV OCR confusable pairs such as `(0, O)`, `(1, I)`, `(8, B)`, `(5, S)`, `(2, Z)`, and log this explicitly in the match reason.
2. **Attribute Similarities:**
   * $\text{Sim}_{\text{color}}(C_v, C_r) \in \{0.0, 0.5, 1.0\}$ (1.0 for exact match, 0.5 for visually adjacent colors like `silver`/`grey` or `white`/`silver` under night CCTV, 0.0 otherwise).
   * $\text{Sim}_{\text{body}}(B_v, B_r) \in \{0.0, 1.0\}$ (exact normalized body-type category match).
3. **Weighted Composite Confidence Score:**
   $$\text{Score}(v, r) = w_p \cdot \text{Sim}_{\text{plate}}(P_v, P_r) + w_c \cdot \text{Sim}_{\text{color}}(C_v, C_r) + w_b \cdot \text{Sim}_{\text{body}}(B_v, B_r)$$
   Default weights: $w_p = 0.65$, $w_c = 0.20$, $w_b = 0.15$. *(If $|\mathcal{K}| = 0$, i.e., plate is completely unreadable, cap the maximum achievable score at $0.45$ so attribute-only matches cannot falsely trigger a high-confidence match.)*
4. **No-Match Handling Rule:**
   Sort all registry entries descending by $\text{Score}(v, r)$ and take the top 5.
   * If $\max_r \text{Score}(v, r) < \tau_{\text{match}}$ (default $\tau_{\text{match}} = 0.55$), return:
     `status: "no confident match"` with an explicit explanation (e.g., *"Highest candidate scored 0.41, below confidence threshold 0.55 due to insufficient readable plate characters and color mismatch."*).

---

## 5. Data Schemas & Synthetic Registry Specification

### 5.1 Sample Vehicle Registry (`data/registry.json`)
Generate 500–1,000 realistic Indian vehicle records (including Chhattisgarh `CG04`, `CG07`, Maharashtra `MH12`, Delhi `DL01`, etc.) following this schema:

```json
[
  {
    "registry_id": "REG-0001",
    "plate": "CG04MX4821",
    "color": "white",
    "body_type": "SUV",
    "make": "Hyundai",
    "model": "Creta",
    "owner_region": "Raipur, CG"
  }
]
```

### 5.2 Analysis Result Schema (API Response & Report Input)

```json
{
  "clip_name": "cctv_junction_01.mp4",
  "vehicles": [
    {
      "track_id": 4,
      "fused_plate": "CG04?X48?1",
      "fused_char_confidences": [0.96, 0.94, 0.91, 0.88, 0.0, 0.85, 0.93, 0.89, 0.0, 0.95],
      "attributes": {
        "color": "white",
        "color_confidence": 0.87,
        "body_type": "SUV",
        "body_type_confidence": 0.91,
        "make_model": "Hyundai Creta",
        "make_model_confidence": 0.68
      },
      "frames_used": [
        {
          "frame_idx": 42,
          "timestamp_sec": 1.4,
          "sharpness": 142.5,
          "vehicle_crop_url": "/artifacts/track4_f42_veh.jpg",
          "plate_crop_url": "/artifacts/track4_f42_plate.jpg",
          "recovered_chars": [
            {"char": "C", "conf": 0.96},
            {"char": "G", "conf": 0.94},
            {"char": "0", "conf": 0.91},
            {"char": "4", "conf": 0.88},
            {"char": "?", "conf": 0.41}
          ]
        }
      ],
      "matching_result": {
        "status": "matched",
        "threshold_used": 0.55,
        "top_candidates": [
          {
            "rank": 1,
            "registry_id": "REG-0001",
            "plate": "CG04MX4821",
            "score": 0.935,
            "reasons": [
              "Plate: 8/8 known characters matched (positions 5, 9 marked unknown '?')",
              "Color: Exact match (white)",
              "Body Type: Exact match (SUV)"
            ]
          }
        ]
      }
    }
  ]
}
```

---

## 6. Investigator Interface & Exportable Report Requirements

1. **Upload & Optional Hint Panel:** Upload a CCTV `.mp4` clip (or two clips for the Cross-Camera Bonus), plus an optional text box for an investigator's partial plate hint (e.g., `CG04??48??`) and tunable confidence threshold slider.
2. **Evidence Explorer View:**
   * Displays each tracked vehicle with its best vehicle crop, fused partial plate (highlighting `?` unknown slots in amber/red), and detected attributes.
   * Expandable **Frame-by-Frame Breakdown Table** showing each keyframe image, plate crop, sharpness score, and color-coded per-character confidence pills.
3. **Ranked Shortlist & No-Match Banner:**
   * Displays the top-5 registry candidates with visual confidence bars and itemized match/mismatch badges.
   * Clearly displays a prominent **"No Confident Match"** alert card when `status == "no confident match"`.
4. **One-Click Report Export (`GET /api/report/{job_id}?format=pdf|html`):**
   * Uses `Jinja2` + `WeasyPrint` to generate a clean, printable forensic report containing the clip metadata, frames used, per-frame character recovery table with confidences, final fused plate, and candidate match reasoning.

---

## 7. Bonus Features Integration Guide

* **Bonus 1 — Make & Model Recognition:** Already integrated into Stage 4 via `OpenCLIP` zero-shot prompt bank. Display predicted Make & Model with its confidence score in the UI and award a small optional tie-breaker bonus ($+0.05$) when matching registry entries.
* **Bonus 2 — Cross-Camera Tracking (`reid.py`):** Allow uploading `Clip A` and `Clip B`. For each tracked vehicle, extract the normalized 512-D `OpenCLIP` image embedding averaged over its top-3 crops. Compute pairwise cosine similarity between tracks in Clip A and Clip B combined with partial-plate compatibility; flag pairs above similarity $0.82$ as the same vehicle across cameras.

---

## 8. Master Prompt for Your AI Coding Agent

Copy and paste the prompt below into your AI coding agent (Cursor, Claude Code, Windsurf, Copilot Workspace, etc.) once you have placed `Hackasol_5.0_Problem_Statement.pdf`, this blueprint, and the cloned `./vendor/` repositories into your workspace:

```text
You are an expert ML Systems Engineer and Full-Stack Developer building our submission for Hackasol 5.0 Track 2 — AIML-01 ("Vehicle Identification and Traceability from CCTV Footage").

Read the following two files in `./docs/` carefully before writing any code:
1. `./docs/Hackasol_5.0_Problem_Statement.pdf` (Page 5: AIML-01)
2. `./docs/AIML_01_Master_Blueprint.md`

Reference model repositories have already been cloned into `./vendor/` (`fast-alpr`, `parseq`, `ultralytics`, `open_clip`, `lpr-rsr-ext`, `vehicle-reidentification`). Inspect their interfaces as needed and reuse these pre-trained models cleanly—do NOT train models from scratch.

Build the complete, runnable end-to-end application with:
1. `backend/app/pipeline.py`: 5-stage hybrid pipeline (YOLOv11 + ByteTrack -> fast-alpr YOLOv9 plate detector + Laplacian blur filter -> PARSeq OCR with strict per-character confidence masking -> OpenCLIP color/body-type/make-model extraction).
2. `backend/app/fusion.py`: Multi-frame position-weighted character voting that preserves `?` for any unreadable/low-confidence character and NEVER invents characters.
3. `backend/app/matcher.py`: Custom wildcard-aware registry matching and top-5 ranking algorithm with explainable per-attribute reasons and strict `"no confident match"` handling below the confidence threshold.
4. `backend/app/reid.py`: Bonus cross-camera vehicle matching using averaged OpenCLIP embeddings across two clips.
5. `backend/app/report_generator.py`: HTML and PDF forensic report generator showing exact frames used, per-frame recovered characters with confidence scores, and candidate match reasoning.
6. `backend/app/main.py`: FastAPI backend exposing video upload, analysis job results, artifact serving, and PDF/HTML report download.
7. `data/generate_registry.py` & `data/registry.json`: Script generating 500 realistic Indian vehicle registry records (including CG, MH, DL plates, colors, body types, and make/model).
8. `frontend/`: Clean Investigator Web UI (React/Vite or Streamlit—pick whichever is fastest to run reliably) supporting clip upload, frame-by-frame plate recovery inspection, top-5 shortlist with reasons, no-match banner, cross-camera tab, and one-click PDF/HTML report download.
9. `README.md`: Clear setup, run commands, architecture overview, and how every AIML-01 constraint is satisfied.

Start by verifying the folder structure and dependencies, then implement the backend modules, synthetic registry, frontend UI, and an automated smoke test script (`tests/test_pipeline.py`) that verifies unknown-character masking, top-5 ranking, no-match handling, and report generation.
```