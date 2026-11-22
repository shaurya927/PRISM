import React from "react";
import { Label, Marquee, Reveal, SplitLines } from "../motion.jsx";
import { Arrow, BigCTA, HoverPreviewList, PageHero, SectionHead } from "../components.jsx";
import { REPO_URL } from "../data/content.js";

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
  ["Evaluation suite", "OCR benchmark, ablation, threshold sweep and 42 clip runs, all reproducible from scripts."],
  ["87 tests", "Unit and Hypothesis property tests for the guardrails, runnable without any model weights."],
  ["Chain of custody", "SHA-256 of the clip, crops, registry and config, plus model, package and repo versions in every report."],
];

export default function About() {
  return (
    <>
      <PageHero index={6} label="About" lines={["A plate reader", "that admits doubt."]}
        lead="PRISM was built for Hackasol 5.0, Track 2 (AIML), problem AIML-01: vehicle identification and traceability from CCTV footage." />

      <section className="gutter pb-[12vh] grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4"><Label index={1}>The brief</Label></div>
        <div className="md:col-span-8 space-y-6">
          <Reveal><p className="text-[clamp(1.4rem,2.6vw,2.25rem)] leading-[1.2] tracking-[-0.03em]">CCTV footage is blurry, dark and often shows only part of a plate. Investigators still need to know which registered vehicles it could be, and how far to trust that answer.</p></Reveal>
          <Reveal delay={0.1}><p className="lead">Most automatic plate readers return one string and hide their doubt. PRISM returns a ranked shortlist, marks every character it could not read, explains every part of every score, and links each claim back to the frames it came from.</p></Reveal>
        </div>
      </section>

      <Marquee items={["Synthetic registry · 500 records", "Generated demo clips", "No real personal data", "Runs offline once set up"]} speed={30} />

      <section className="gutter py-[12vh]">
        <SectionHead index={2} label="What's in the repo" title={["Six deliverables."]} />
        <div className="grid md:grid-cols-3 gap-x-6 gap-y-10 mt-14">
          {DELIVERABLES.map(([t, d], i) => (
            <Reveal key={t} delay={(i % 3) * 0.08} className="border-t rule pt-5">
              <div className="tag">({String(i + 1).padStart(2, "0")})</div>
              <div className="text-[24px] tracking-[-0.03em] font-medium mt-3">{t}</div>
              <p className="text-muted text-[15px] mt-2 leading-relaxed">{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="gutter py-[12vh] border-t rule">
        <SectionHead index={3} label="Built on" title={["Open research,", "wrapped carefully."]}
          aside="The research repos are cloned read-only into vendor/ and wrapped, never edited. Their commits are recorded in each report." />
        <div className="mt-14">
          <HoverPreviewList
            rows={BUILT_ON}
            renderRow={([name, role, url]) => (
              <a href={url} target="_blank" rel="noreferrer" className="hlist__row grid grid-cols-[1fr_auto] md:grid-cols-[1.2fr_1fr_auto] items-center gap-4 py-6">
                <span className="text-[clamp(1.4rem,2.6vw,2.25rem)] tracking-[-0.04em] font-medium leading-none">{name}</span>
                <span className="hidden md:block text-muted">{role}</span>
                <Arrow />
              </a>
            )}
          />
          <div className="border-t rule" />
        </div>
      </section>

      <section className="gutter py-[12vh] border-t rule grid md:grid-cols-12 gap-10 items-end">
        <div className="md:col-span-7">
          <Label index={4}>Source</Label>
          <SplitLines as="h2" lines={["Read the code."]} className="display-2 mt-5" />
        </div>
        <Reveal className="md:col-span-5 md:text-right">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-[clamp(1.1rem,2vw,1.6rem)] ulink">github.com/shaurya927/PRISM ↗</a>
          <p className="tag mt-6">Website layout and motion inspired by melon.studio</p>
        </Reveal>
      </section>

      <BigCTA />
    </>
  );
}
