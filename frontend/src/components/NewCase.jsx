import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api.js";
import { Icon } from "./common.jsx";

const EASE = [0.22, 1, 0.36, 1];

/** Real upload progress from the browser: bytes sent, percentage and throughput. */
function UploadBar({ up }) {
  if (!up) return null;
  const frac = up.total ? up.loaded / up.total : 0;
  const secs = Math.max(0.001, (up.at - up.t0) / 1000);
  const mbps = up.loaded / 1e6 / secs;
  const done = frac >= 1;
  return (
    <div className="mt-1">
      <div className="flex justify-between label-mono mb-2">
        <span>{done ? "Upload complete · starting analysis…" : `Uploading ${up.name}`}</span>
        <span>{(up.loaded / 1e6).toFixed(1)} / {(up.total / 1e6).toFixed(1)} MB · {Math.round(frac * 100)}%{!done && secs > 0.3 ? ` · ${mbps.toFixed(1)} MB/s` : ""}</span>
      </div>
      <div className="upbar">
        <div className="upbar__fill" style={{ transform: `scaleX(${frac})` }} />
        {done && <span className="indet" />}
      </div>
    </div>
  );
}

// Videos, or a still photo (analysed as a one-frame clip). Must match ALLOWED_EXT in backend/app/main.py.
const VIDEO_EXT = [".mp4", ".avi", ".mov", ".mkv", ".m4v", ".webm"];
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"];
const ACCEPT = ["video/*", "image/*", ...VIDEO_EXT, ...IMAGE_EXT].join(",");
const extOf = (name) => (name.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
export const isPhoto = (file) => Boolean(file) && (file.type?.startsWith("image/") || IMAGE_EXT.includes(extOf(file.name)));
const isAccepted = (file) => isPhoto(file) || file.type?.startsWith("video/") || VIDEO_EXT.includes(extOf(file.name));

function DropZone({ label, file, onFile }) {
  const [over, setOver] = useState(false);
  const [bad, setBad] = useState("");
  const photo = isPhoto(file);
  // a small preview of a chosen photo, released when it changes
  const preview = useMemo(() => (photo ? URL.createObjectURL(file) : null), [file, photo]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const take = (f) => {
    if (!f) return;
    if (!isAccepted(f)) { setBad(`${f.name}: not a video or photo`); return; }
    setBad("");
    onFile(f);
  };
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}
      className={`group flex flex-col items-center justify-center border border-dashed rounded-xl p-8 cursor-pointer text-center transition-colors duration-150 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 ${over ? "border-[rgb(238_240_243/.5)] bg-slate-100" : file ? "border-green-300 bg-green-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100"}`}
    >
      <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => take(e.target.files[0])} />
      {preview ? (
        <img src={preview} alt="" className="max-h-28 max-w-full rounded-md object-contain" />
      ) : (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden
          className={`transition-colors duration-150 ${file ? "text-green-800" : over ? "text-slate-700" : "text-slate-500 group-hover:text-slate-700"}`}>
          <rect x="3" y="5" width="13" height="14" rx="2" /><path d="M16 10l5-3v10l-5-3z" />
        </svg>
      )}
      <div className="mt-3 text-[19px] font-normal tracking-[-0.01em]">{label}</div>
      <div className="label-mono mt-1">
        {file ? `${photo ? "photo" : "video"} · ${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : "Drag a CCTV clip or a photo here, or click to choose"}
      </div>
      {bad && <div className="text-xs text-red-600 mt-2">{bad}</div>}
      {!file && <div className="text-xs text-slate-500 mt-2">Video: MP4, MOV, AVI, MKV, WebM · Photo: JPG, PNG, WebP, BMP, TIFF</div>}
    </label>
  );
}

/** Mask helper: type the characters you know, click a box to toggle it to '?'. */
export function HintInput({ value, onChange }) {
  const chars = value.split("");
  const toggle = (i) => {
    const c = [...chars];
    c[i] = c[i] === "?" ? "" : "?";
    onChange(c.join("").replace(/[^A-Z0-9?]/g, (x) => x));
  };
  return (
    <div>
      <input
        className="input font-mono tracking-widest uppercase"
        placeholder="e.g. CG04??48??   (use ? for unknown)"
        value={value}
        maxLength={12}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9?*_ ]/g, "").replace(/[*_]/g, "?").replace(/ /g, ""))}
      />
      <div className="flex gap-1 mt-2 flex-wrap">
        {Array.from({ length: Math.max(10, chars.length) }).map((_, i) => {
          const c = chars[i];
          return (
            <button
              type="button"
              key={i}
              onClick={() => (c ? toggle(i) : onChange((value + "?".repeat(Math.max(0, i - value.length + 1))).slice(0, 12)))}
              className={`w-7 h-8 rounded-md border text-sm font-mono font-medium transition-colors duration-150 ${c === "?" ? "border-amber-400 bg-amber-50 text-amber-600" : c ? "border-blue-400 bg-blue-50 text-blue-700" : "border-dashed border-slate-300 text-slate-300"}`}
              title={c ? "click to toggle unknown" : "click to add an unknown position"}
            >
              {c || "·"}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 mt-1">Hint characters are always labelled <span className="text-blue-600 font-medium">investigator-supplied</span>, never treated as video evidence.</p>
    </div>
  );
}

export default function NewCase({ health, onStarted, onSearchResult }) {
  const [mode, setMode] = useState("single");
  const [fileA, setFileA] = useState(null);
  const [fileB, setFileB] = useState(null);
  const [hint, setHint] = useState("");
  const [threshold, setThreshold] = useState(0.55);
  const [distanceKm, setDistanceKm] = useState("");
  const [gapS, setGapS] = useState("");
  const [color, setColor] = useState("");
  const [body, setBody] = useState("");
  const [mm, setMm] = useState("");
  const [lowLight, setLowLight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [opts, setOpts] = useState({ colors: [], body_types: [], make_models: [] });

  useEffect(() => { api.config().then(setOpts).catch(() => {}); }, []);
  useEffect(() => { if (health?.thresholds?.tau) setThreshold(health.thresholds.tau); }, [health]);

  const canStart = useMemo(() => {
    if (mode === "single") return !!fileA;
    if (mode === "crosscam") return !!fileA && !!fileB;
    return hint.replace(/\?/g, "").length > 0;
  }, [mode, fileA, fileB, hint]);

  const [up, setUp] = useState(null);
  const t0 = useRef(0);

  async function start() {
    setBusy(true);
    setErr("");
    t0.current = performance.now();
    const name = mode === "crosscam" ? `${fileA?.name} + ${fileB?.name}` : fileA?.name;
    const onProgress = (loaded, total) => setUp({ name, loaded, total, t0: t0.current, at: performance.now() });
    try {
      if (mode === "single") onStarted((await api.createJob({ file: fileA, hint, threshold, onProgress })).job_id);
      else if (mode === "crosscam")
        onStarted((await api.createCrosscam({ fileA, fileB, hint, threshold, distanceKm: parseFloat(distanceKm) || null, gapS: parseFloat(gapS) || null, onProgress })).job_id);
      else onSearchResult(await api.search({ hint, color: color || null, body_type: body || null, make_model: mm || null, threshold, low_light: lowLight }));
    } catch (e) {
      setErr(String(e.message || e));
      setUp(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div className="max-w-4xl mx-auto card p-6 md:p-8 space-y-6" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay: 0.05 }}>
      <div className="flex items-center justify-between">
        <h2 className="text-[30px] leading-none">New case</h2>
        <div className="relative flex rounded-[10px] border border-slate-300 p-1 text-sm" role="tablist" aria-label="Case type">
          {[["single", "Clip or photo"], ["crosscam", "Two cameras"], ["search", "Hint-only search"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`relative px-4 py-1.5 rounded-md transition-colors duration-150 ${mode === k ? "text-slate-900" : "text-slate-500 hover:text-white"}`}>
              {mode === k && <motion.span layoutId="mode-pill" className="absolute inset-0 rounded-md bg-slate-200 shadow-[inset_0_1px_0_rgb(255_255_255/.08)]" transition={{ duration: 0.25, ease: EASE }} />}
              <span className="relative">{l}</span>
            </button>
          ))}
        </div>
      </div>

      {mode !== "search" && (
        <div className={`grid gap-4 ${mode === "crosscam" ? "md:grid-cols-2" : ""}`}>
          <DropZone label={mode === "crosscam" ? "Camera A clip or photo" : "CCTV clip or photo"} file={fileA} onFile={setFileA} />
          {mode === "crosscam" && <DropZone label="Camera B clip or photo" file={fileB} onFile={setFileB} />}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <div className="label mb-1">Partial plate hint {mode !== "search" && "(optional)"}</div>
          <HintInput value={hint} onChange={setHint} />
        </div>
        <div className="space-y-4">
          <div>
            <div className="label mb-1">Match threshold τ = {threshold.toFixed(2)}</div>
            <input type="range" min="0.30" max="0.95" step="0.01" value={threshold} onChange={(e) => setThreshold(parseFloat(e.target.value))} className="w-full accent-blue-600" />
            <p className="text-xs text-slate-500">Below τ PRISM says “no confident match”. You can move it again on the results page; only matching reruns.</p>
          </div>
          {mode === "crosscam" && (
            <div className="grid grid-cols-2 gap-2">
              <div><div className="label mb-1">Camera distance (km)</div><input className="input" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} placeholder="optional" /></div>
              <div><div className="label mb-1">Time between clips (s)</div><input className="input" value={gapS} onChange={(e) => setGapS(e.target.value)} placeholder="optional" /></div>
              <p className="col-span-2 text-xs text-slate-500">Used only to flag pairs needing an impossible speed (&gt; 120 km/h).</p>
            </div>
          )}
          {mode === "search" && (
            <div className="grid grid-cols-2 gap-2">
              <div><div className="label mb-1">Colour</div>
                <select className="input" value={color} onChange={(e) => setColor(e.target.value)}><option value="">unknown</option>{opts.colors.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><div className="label mb-1">Body type</div>
                <select className="input" value={body} onChange={(e) => setBody(e.target.value)}><option value="">unknown</option>{opts.body_types.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="col-span-2"><div className="label mb-1">Make / model</div>
                <select className="input" value={mm} onChange={(e) => setMm(e.target.value)}><option value="">unknown</option>{opts.make_models.map((c) => <option key={c}>{c}</option>)}</select></div>
              <label className="col-span-2 text-sm flex items-center gap-2"><input type="checkbox" checked={lowLight} onChange={(e) => setLowLight(e.target.checked)} /> Seen at night (low light)</label>
            </div>
          )}
        </div>
      </div>

      {err && <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 text-sm">{err}</div>}
      <div className="flex flex-wrap items-center gap-4">
        <button className="btn-primary !h-12 !px-6 !text-[15px]" disabled={!canStart || busy} onClick={start}>
          {busy ? (mode === "search" ? "Searching…" : "Uploading…") : mode === "search" ? "Search registry"
            : mode === "single" && isPhoto(fileA) ? "Analyse photo" : "Analyse footage"}
          <Icon name="arrow" />
        </button>
        <span className="label-mono">All models run locally; footage never leaves this machine.</span>
      </div>
      {busy && mode !== "search" && <UploadBar up={up} />}
    </motion.div>
  );
}
