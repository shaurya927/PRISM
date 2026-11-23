import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useSpring } from "framer-motion";
import { HighwayCanvas } from "../site/fx.jsx";

const EASE = [0.18, 0.66, 0.18, 1];

// One entry per backend stage (prism.pipeline.STAGES), in pipeline order.
const STAGES = [
  ["ingest", "Ingest & hash", "SHA-256 · brightness",
    "Hashes the clip with SHA-256 for the chain of custody and measures the median frame brightness to decide whether this is a low-light clip."],
  ["tracking", "Vehicle tracking", "YOLO11 + ByteTrack",
    "YOLO11 finds cars, motorcycles, buses and trucks in each frame. ByteTrack keeps one ID per vehicle so its frames can be read together."],
  ["plates", "Plate detection", "fast-alpr YOLOv9-t · sharpness",
    "Finds the plate inside each vehicle crop. Crops with Laplacian sharpness below 45 or narrower than 30 px are dropped; the 12 sharpest per vehicle are kept."],
  ["ocr", "OCR, masking & fusion", "PARSeq · τ_char 0.70",
    "Reads every kept crop and a CLAHE copy. A character read below 0.70 confidence becomes ?, then all reads are aligned and voted position by position."],
  ["attributes", "Colour, body, make", "OpenCLIP ViT-B-32",
    "Scores colour, body type and make/model on the three sharpest vehicle crops. Anything below 0.40 confidence is reported as uncertain and adds nothing to the score."],
  ["matching", "Registry matching", "plate + colour + body",
    "Scores the fused plate, colour and body type against every registry record and applies τ: MATCHED, AMBIGUOUS or NO CONFIDENT MATCH."],
];

function useElapsed(startIso, running) {
  const start = useMemo(() => {
    const t = startIso ? Date.parse(startIso) : NaN;
    return Number.isFinite(t) && t <= Date.now() ? t : Date.now();
  }, [startIso]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  const s = Math.max(0, Math.floor((now - start) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Big percentage that springs toward the real value instead of jumping between polls. */
function Count({ value }) {
  const sp = useSpring(0, { stiffness: 70, damping: 20 });
  const [shown, setShown] = useState(0);
  useEffect(() => { sp.set(value); }, [value, sp]);
  useMotionValueEvent(sp, "change", (v) => setShown(Math.round(v)));
  return (
    <div className="aload__count" aria-live="polite" aria-label={`${value} percent`}>
      {String(shown).padStart(3, "0")}<span className="aload__pct">%</span>
    </div>
  );
}

function SegBar({ values, active, selected, onSelect, waiting }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
  };
  return (
    <div ref={ref} className="segbar" onPointerMove={move} onPointerLeave={() => setHover(null)} role="list" aria-label="Pipeline stages">
      {STAGES.map(([key, name], i) => {
        const v = values[key] ?? 0;
        const done = v >= 1;
        const isActive = key === active && !done;
        return (
          <button key={key} type="button" role="listitem"
            className={`seg ${done ? "is-done" : ""} ${isActive ? "is-active" : ""} ${selected === key ? "is-sel" : ""}`}
            onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            onClick={() => onSelect(key)} aria-label={`${name}: ${Math.round(v * 100)}%`}>
            <motion.span className="seg__fill" initial={false} animate={{ scaleX: v }} transition={{ type: "spring", stiffness: 60, damping: 18 }} />
            {waiting && i === 0 && <span className="indet" />}
          </button>
        );
      })}
      <AnimatePresence>
        {hover != null && (
          <motion.span key="tip" className="seg__tip" style={{ left: `${((hover + 0.5) / STAGES.length) * 100}%` }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.2 }}>
            {String(hover + 1).padStart(2, "0")} · {STAGES[hover][1]} · {Math.round((values[STAGES[hover][0]] ?? 0) * 100)}%
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function Scanner({ paused }) {
  return (
    <div className={`scan ${paused ? "is-paused" : ""}`} style={{ "--scan-w": "400px" }} aria-hidden>
      {Array.from({ length: 10 }, (_, i) => <span key={i} className="scan__cell" style={{ "--i": i }}>?</span>)}
      <span className="scan__beam" />
    </div>
  );
}

export default function Progress({ job }) {
  const values = job.progress || {};
  const running = job.status === "queued" || job.status === "running";
  const waiting = job.status === "queued" || job.stage === "queued";
  const failed = job.status === "error";
  const overall = Math.round((STAGES.reduce((a, [k]) => a + Math.min(1, values[k] ?? 0), 0) / STAGES.length) * 100);
  const known = STAGES.some(([k]) => k === job.stage);
  const active = known ? job.stage : STAGES.find(([k]) => (values[k] ?? 0) < 1)?.[0] || "matching";
  const activeIdx = STAGES.findIndex(([k]) => k === active);
  const [picked, setPicked] = useState(null); // null = follow the live stage
  const selected = picked ?? active;
  const sel = STAGES.find(([k]) => k === selected) || STAGES[0];
  const elapsed = useElapsed(job.created_at, running);
  const pick = (k) => setPicked(k === active ? null : k);

  return (
    <motion.section className="aload max-w-5xl mx-auto" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE }}>
      <HighwayCanvas className="aload__wave" horizon={0.22} camH={4.5} density={1.1} seed={5} />
      <div className="p-6 md:p-10">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 label-mono">
          <span><span className={`dot ${failed ? "" : "dot--live"}`} style={failed ? { background: "var(--red-3)" } : undefined} />
            {failed ? "analysis stopped" : waiting ? "queued" : `analysing${job.kind === "crosscam" ? " two clips" : ""}`}</span>
          <span>job {job.job_id}</span>
          <span>{elapsed} elapsed</span>
          <span className="ml-auto">stage {String(Math.max(0, activeIdx) + 1).padStart(2, "0")} / {String(STAGES.length).padStart(2, "0")}</span>
        </div>

        <div className="mt-10 md:mt-14 flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="label mb-3">{failed ? "Failed during" : waiting ? "Waiting for a worker" : "Now"}</div>
            <span className="mask-line relative">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={active} className="mask-line__in aload__stage" initial={{ y: "110%" }} animate={{ y: 0 }} exit={{ y: "-110%" }}
                  transition={{ duration: 0.55, ease: EASE }}>
                  {STAGES[Math.max(0, activeIdx)][1]}
                </motion.span>
              </AnimatePresence>
            </span>
          </div>
          <Count value={overall} />
        </div>

        <div className="mt-10">
          <SegBar values={values} active={active} selected={picked} onSelect={pick} waiting={waiting && running} />
          <div className="flex justify-between mt-3 label-mono">
            <span>ingest</span><span className="hidden sm:inline">hover a segment · click for details</span><span>shortlist</span>
          </div>
        </div>

        <div className="mt-10 grid md:grid-cols-[1.1fr_1fr] gap-8 md:gap-12">
          <div>
            {STAGES.map(([key, name, model], i) => {
              const v = values[key] ?? 0;
              const done = v >= 1;
              const isActive = key === active && !done && running;
              return (
                <button key={key} type="button" onClick={() => pick(key)}
                  className={`stg w-full text-left ${done ? "is-done" : ""} ${isActive ? "is-active" : ""} ${selected === key ? "is-sel" : ""}`}>
                  <span className="stg__i">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="stg__name block truncate">{name}</span>
                    <span className="stg__model block truncate">{model}</span>
                  </span>
                  <span className="stg__v">
                    {done ? <span className="stg__ok">done ✓</span>
                      : isActive ? <span><span className="dot dot--live" style={{ background: "var(--red)" }} />{Math.round(v * 100)}%</span>
                      : failed && key === active ? <span className="text-red-700">failed</span>
                      : <span className="text-slate-400">waiting</span>}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-6">
            <div className="panel p-5 min-h-[170px]">
              <div className="flex items-center justify-between label-mono">
                <span>{String(STAGES.indexOf(sel) + 1).padStart(2, "0")} · {sel[2]}</span>
                {picked && <button type="button" className="f-u" onClick={() => setPicked(null)}>follow live ↺</button>}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={sel[0]} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
                  <div className="text-[22px] font-light tracking-[-0.03em] mt-3">{sel[1]}</div>
                  <p className="text-[15px] text-slate-500 mt-2 leading-snug">{sel[3]}</p>
                </motion.div>
              </AnimatePresence>
            </div>
            <div>
              <Scanner paused={!running} />
              <p className="label-mono mt-3 max-w-[26rem]">Every position starts as ?. A character is only kept when clear frames agree on it.</p>
            </div>
          </div>
        </div>

        {failed && <div className="mt-8 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4 font-mono">{job.error}</div>}
        <p className="label-mono mt-8">The first run downloads and loads the models, so it takes longer than later runs.</p>
      </div>
    </motion.section>
  );
}
