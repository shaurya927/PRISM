import React from "react";
import { Reveal } from "../motion.jsx";
import { Code, NextLink, PageHero, Pill, Tabs } from "../components.jsx";
import { REPO_URL } from "../data/content.js";

const SETUP = `git clone ${REPO_URL}.git && cd PRISM
uv venv .venv --python 3.11
uv pip install --python .venv\\Scripts\\python.exe torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv\\Scripts\\python.exe -r requirements.txt

git clone https://github.com/ankandrew/fast-alpr.git vendor/fast-alpr
git clone https://github.com/baudm/parseq.git vendor/parseq
git clone https://github.com/valfride/lpsr-lacd.git vendor/lpsr-lacd
git clone https://github.com/kHarshit/vehicle-reidentification.git vendor/vehicle-reidentification`;

const PREP = `.venv\\Scripts\\python.exe scripts\\download_weights.py          # add --with-sr for the 1.97 GB SR checkpoint
.venv\\Scripts\\python.exe -m playwright install chromium       # PDF export (HTML works without it)
.venv\\Scripts\\python.exe data\\generate_registry.py            # 50,000 synthetic records
.venv\\Scripts\\python.exe scripts\\make_demo_clips.py           # labelled demo clips
cd frontend && npm install && npm run build && cd ..`;

const RUN = `.venv\\Scripts\\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
# website:      http://127.0.0.1:8000
# investigator: http://127.0.0.1:8000/app`;

const CLI = `.venv\\Scripts\\python.exe -m prism analyze data\\test_clips\\day_clear_white.mp4 --report pdf
.venv\\Scripts\\python.exe -m prism analyze data\\test_clips\\night_partial_white.mp4 --hint "CG04????2?"
.venv\\Scripts\\python.exe -m prism crosscam data\\test_clips\\night_partial_white.mp4 data\\test_clips\\camB_white.mp4 --report pdf
.venv\\Scripts\\python.exe -m prism search "CG04MX48??" --color white --body car`;

const EVAL = `.venv\\Scripts\\python.exe -m pytest -v                          # unit + Hypothesis property tests
.venv\\Scripts\\python.exe scripts\\make_degraded.py               # 6 degraded versions of every clip
.venv\\Scripts\\python.exe scripts\\evaluate.py --clips --degraded  # OCR benchmark, ablation, tau sweep, clip metrics
.venv\\Scripts\\python.exe scripts\\batch_report.py                # one report per clip + reports/index.html
.venv\\Scripts\\python.exe scripts\\build_site_media.py            # refresh this website's images and numbers`;

const API = [
  ["POST", "/api/jobs", "Upload a clip (multipart: file, optional hint, threshold). Returns job_id."],
  ["GET", "/api/jobs", "List jobs."],
  ["GET", "/api/jobs/{job_id}", "Status, per-stage progress and the full result."],
  ["POST", "/api/jobs/{job_id}/rescore", "New threshold, hint or target track. Reruns Stage 5 only."],
  ["DELETE", "/api/jobs/{job_id}", "Delete a job and its artifacts."],
  ["POST", "/api/search", "Hint-only registry search (plate pattern, colour, body, make/model)."],
  ["POST", "/api/crosscam", "Two clips (file_a, file_b), optional distance_km and gap_s."],
  ["GET", "/api/report/{job_id}", "?format=pdf|html. Falls back to HTML without Chromium."],
  ["GET", "/api/config", "Active config, colours, body types, make/model list."],
  ["GET", "/artifacts/{path}", "Saved crops (png/jpg only)."],
  ["GET", "/health", "Device, GPU, loaded models, registry size, config hash, versions."],
];

const REQUIREMENTS = [
  ["Python 3.11", "with PyTorch: the CUDA 12.8 wheel for RTX 50-series GPUs, or the CPU wheel"],
  ["GPU", "optional; on CPU PRISM processes every second frame"],
  ["Node.js and npm", "to build this website and the investigator app"],
  ["Chromium", "optional, installed by Playwright for PDF reports; HTML reports work without it"],
  ["Disk", "the super-resolution checkpoint is an optional 1.97 GB download"],
];

const DOCKER = `docker compose up --build                                                    # CPU
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build    # NVIDIA GPU (needs the NVIDIA Container Toolkit)
docker run -p 8000:8000 -v prism-weights:/app/weights ghcr.io/shaurya927/prism:latest   # prebuilt CPU image from CI`;

const ENV = [
  ["PRISM_DEVICE", "auto | cuda | cpu"], ["PRISM_OCR_BACKEND", "parseq | fast_plate_ocr"], ["PRISM_NARRATIVE", "template | ollama"],
  ["PRISM_REID_ENCODER", "clip | osnet | resnet"], ["PRISM_RUNS_DIR", "where job outputs are written"], ["PRISM_WEIGHTS_DIR", "where model weights live"],
];

const TABS = [
  {
    id: "setup", label: "Setup",
    render: () => (
      <div className="space-y-12">
        <Block title="Requirements" text="What you need before installing. Everything runs locally.">
          <table className="tbl">
            <tbody>
              {REQUIREMENTS.map(([k, v]) => (
                <tr key={k}><td className="whitespace-nowrap align-top w-[1%] pr-8">{k}</td><td className="text-muted">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </Block>
        <Block title="Install" text="Python 3.11 with PyTorch (cu128 for RTX 50-series, or the CPU wheel), then the four read-only research repos PRISM wraps.">
          <Code>{SETUP}</Code>
        </Block>
        <Block title="Models & data" text="Downloads YOLO11, the plate detector, PARSeq, fast-plate-ocr and OpenCLIP weights; generates the registry and the demo clips; builds this website and the investigator.">
          <Code>{PREP}</Code>
        </Block>
        <Block title="Run" text="One process serves the API, this website and the investigator app on the same port. For hot reload, keep the API running and use npm run dev in frontend/ (port 5173).">
          <Code>{RUN}</Code>
        </Block>
        <Block title="Docker" text="The image builds the frontend and installs PyTorch and Chromium. Model weights are not baked in: with Compose they download into the prism-weights volume on first start. lpsr-lacd has no licence file, so super-resolution is left out of the image; results are identical without it.">
          <Code>{DOCKER}</Code>
        </Block>
      </div>
    ),
  },
  {
    id: "cli", label: "Command line",
    render: () => (
      <Block title="Command line" text="The same pipeline without the browser. --hint accepts ? or * for unknown characters.">
        <Code>{CLI}</Code>
      </Block>
    ),
  },
  {
    id: "eval", label: "Tests & evaluation",
    render: () => (
      <Block title="Tests & evaluation" text="The unit and property tests need no models. The evaluation and batch reports reproduce every number on the Evaluation page.">
        <Code>{EVAL}</Code>
      </Block>
    ),
  },
  {
    id: "api", label: "HTTP API",
    render: () => (
      <Block title="HTTP API" text="FastAPI. Interactive OpenAPI docs are served at /api/docs on the same port.">
        <div className="mb-6"><Pill to="/api/docs" external ghost>Open /api/docs</Pill></div>
        <div className="overflow-x-auto">
          <table className="tbl min-w-[640px]">
            <thead><tr><th>Method</th><th>Path</th><th>What it does</th></tr></thead>
            <tbody>
              {API.map(([m, p, d]) => (
                <tr key={m + p}>
                  <td><span className={`chip ${m === "GET" ? "chip--ok" : m === "DELETE" ? "chip--bad" : "chip--warn"}`}>{m}</span></td>
                  <td className="mono text-[13px] whitespace-nowrap">{p}</td>
                  <td className="text-muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    ),
  },
  {
    id: "config", label: "Configuration",
    render: () => (
      <Block title="Configuration" text="Every threshold, weight, model name and path lives in prism/config.py as frozen dataclasses, and the config hash is written into each report. A few environment variables override the defaults.">
        <div className="overflow-x-auto">
          <table className="tbl min-w-[560px]">
            <thead><tr><th>Variable</th><th>Values</th></tr></thead>
            <tbody>
              {ENV.map(([k, v]) => (
                <tr key={k}><td className="mono text-[13px]">{k}</td><td className="text-muted">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    ),
  },
];

export default function Docs() {
  return (
    <>
      <PageHero index={5} label="Docs" lines={["Run it", "yourself"]}
        lead="Windows commands shown; on Linux or macOS use .venv/bin/python and forward slashes. A CUDA GPU is optional; on CPU PRISM processes every second frame.">
        <Reveal className="mt-8"><Pill to={REPO_URL} external>Repository on GitHub</Pill></Reveal>
      </PageHero>
      <section className="gutter pb-16 md:pb-20">
        <Tabs id="docs" label="Docs sections" tabs={TABS} />
      </section>
      <NextLink to="/about" label="Next" title="About the project" />
    </>
  );
}

function Block({ title, text, children }) {
  return (
    <Reveal>
      <h2 className="row-title">{title}</h2>
      <p className="text-muted text-[15px] mt-2 mb-5 leading-relaxed">{text}</p>
      {children}
    </Reveal>
  );
}
