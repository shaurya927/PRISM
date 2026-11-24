import React from "react";
import { Label, Reveal } from "../motion.jsx";
import { Accordion, Arrow, HoverPreviewList, PageHero, SectionHead } from "../components.jsx";
import { evaluation, REPO_URL, STATUS_INFO } from "../data/content.js";

const BUILT_ON = [
  ["Ultralytics YOLO11", "Vehicle detection", "https://github.com/ultralytics/ultralytics"],
  ["ByteTrack", "Multi-object tracking", "https://github.com/ifzhang/ByteTrack"],
  ["fast-alpr", "Plate detector and fast-plate-ocr", "https://github.com/ankandrew/fast-alpr"],
  ["PARSeq", "Scene-text OCR with per-character confidence", "https://github.com/baudm/parseq"],
  ["OpenCLIP", "Colour, body type, make/model, appearance Re-ID", "https://github.com/mlfoundations/open_clip"],
  ["lpsr-lacd", "Plate super-resolution (visual aid only)", "https://github.com/valfride/lpsr-lacd"],
  ["vehicle-reidentification", "Optional OSNet / ResNet Re-ID encoders", "https://github.com/kHarshit/vehicle-reidentification"],
  ["FastAPI · React · Playwright", "API, interfaces, PDF export", "https://fastapi.tiangolo.com"],
];

const DELIVERABLES = [
  ["Investigator app", "Upload a clip, watch each stage, inspect every read, move τ, add a witness hint, compare cameras, export the report."],
  ["Command line", "analyze, crosscam and search, with PDF or HTML reports."],
  ["HTTP API", "Jobs, rescoring, search, cross-camera, reports and health, documented with OpenAPI."],
  ["Evaluation suite", `OCR benchmark, ablation, threshold sweep and ${evaluation.clips.length} clip runs, all reproducible from scripts.`],
  ["144 tests", "Unit and Hypothesis property tests for the guardrails, runnable without any model weights."],
  ["Chain of custody", "SHA-256 of the clip, crops, registry and config, plus model, package and repo versions in every report."],
];

const FAQ = [
  { t: "Does PRISM identify the vehicle?", d: "No. Its output supports an investigator's decision. Every candidate comes with its reasons, and every ? comes with the frame that came closest to reading it." },
  { t: "What does a ? on the plate mean?", d: "No frame read that character with at least 0.70 confidence, a second OCR model did not confirm it, or the frames disagreed. It stays unknown in the plate, the score and the report, and the advisor names the frame that came closest to reading it." },
  { t: "What do the three results mean?", d: `MATCHED: ${STATUS_INFO.MATCHED} AMBIGUOUS: ${STATUS_INFO.AMBIGUOUS} NO CONFIDENT MATCH: ${STATUS_INFO["NO CONFIDENT MATCH"]}` },
  { t: "Can I add what a witness saw?", d: "Yes. A plate hint such as CG04????2? fills only the positions the video could not read. Where the video and the hint disagree, the position becomes ? and the conflict is written into the report." },
  { t: "Which plates can it read?", d: "Indian layouts: standard, old Delhi and Bharat (BH) series. Square two-line plates are split into their rows before OCR and read as one registration." },
  { t: "Do I need a GPU?", d: `No. A CUDA GPU is optional; on CPU PRISM processes every second frame. On the ${evaluation.clips.length} evaluation clips the mean time was ${evaluation.clip_summary.mean_seconds.toFixed(1)} s per clip on ${evaluation.device === "cuda" ? "an RTX 4060 laptop GPU" : "CPU"}.` },
  { t: "Is any real personal data used?", d: "No. The registry is 50,000 synthetic records (plates from 38 states and UTs, including old Delhi and BH series) and the demo clips are generated. Once set up, PRISM runs offline." },
  { t: "Does super-resolution help it read plates?", d: "No. The upscaled plate is a visual aid for people only. It is saved after OCR has finished and is never read back, because upscalers can draw characters that were never there." },
];

export default function About() {
  return (
    <>
      <PageHero index={6} label="About" lines={["A plate reader", "that admits doubt"]}
        lead="PRISM was built for Hackasol 5.0, Track 2 (AIML), problem AIML-01: vehicle identification and traceability from CCTV footage." />

      <section className="gutter pb-16 md:pb-20 grid md:grid-cols-12 gap-8">
        <div className="md:col-span-4"><Label index={1}>The brief</Label></div>
        <div className="md:col-span-8 space-y-5">
          <Reveal><p className="text-[clamp(1.25rem,1.8vw,1.625rem)] leading-[1.35] tracking-[-0.015em]">CCTV footage is blurry, dark and often shows only part of a plate. Investigators still need to know which registered vehicles it could be, and how far to trust that answer.</p></Reveal>
          <Reveal><p className="lead">Most automatic plate readers return one string and hide their doubt. PRISM returns a ranked shortlist, marks every character it could not read, explains every part of every score, and links each claim back to the frames it came from.</p></Reveal>
          <ul className="flex flex-wrap gap-2 pt-2">
            {["Synthetic registry · 50,000 records", "Generated demo clips", "No real personal data", "Runs offline once set up"].map((t) => <li key={t} className="chip">{t}</li>)}
          </ul>
        </div>
      </section>

      <section className="gutter py-16 md:py-20 border-t rule">
        <SectionHead index={2} label="What's in the repo" title="Six deliverables" />
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-8 mt-10">
          {DELIVERABLES.map(([t, d], i) => (
            <Reveal key={t} className="border-t rule pt-5">
              <div className="tag">({String(i + 1).padStart(2, "0")})</div>
              <h3 className="row-title mt-2">{t}</h3>
              <p className="text-muted text-[15px] mt-2 leading-relaxed">{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="gutter py-16 md:py-20 border-t rule">
        <SectionHead index={3} label="Built on" title="Open research, wrapped carefully"
          aside="The research repos are cloned read-only into vendor/ and wrapped, never edited. Their commits are recorded in each report." />
        <div className="mt-10">
          <HoverPreviewList
            rows={BUILT_ON}
            renderRow={([name, role, url]) => (
              <a href={url} target="_blank" rel="noreferrer" className="hlist__row grid grid-cols-[1fr_auto] md:grid-cols-[1.2fr_1fr_auto] items-center gap-4 py-5">
                <span className="row-title">{name}</span>
                <span className="hidden md:block text-muted text-[15px]">{role}</span>
                <Arrow />
              </a>
            )}
          />
          <div className="border-t rule" />
        </div>
      </section>

      <section className="gutter py-16 md:py-20 border-t rule">
        <SectionHead index={4} label="Questions" title="Frequently asked" />
        <div className="mt-8"><Accordion items={FAQ} defaultOpen={-1} /></div>
      </section>

      <section className="gutter py-16 md:py-20 border-t rule grid md:grid-cols-12 gap-8 items-end">
        <div className="md:col-span-7">
          <Label index={5}>Source</Label>
          <h2 className="h-sec mt-3">Read the code</h2>
        </div>
        <Reveal className="md:col-span-5 md:text-right">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[17px] ulink">github.com/shaurya927/PRISM <Arrow /></a>
          <p className="tag mt-4 md:ml-auto">Website theme inspired by resend.com, layout by melon.studio. Our own code, open fonts.</p>
        </Reveal>
      </section>
    </>
  );
}
