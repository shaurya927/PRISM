import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

function DropZone({ label, file, onFile }) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
      className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer text-center transition ${over ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100"}`}
    >
      <input type="file" accept="video/*,.mp4,.avi,.mov,.mkv" className="hidden" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
      <div className="text-3xl">🎞</div>
      <div className="font-medium mt-1">{label}</div>
      <div className="text-xs text-slate-500 mt-1">{file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : "Drag a CCTV clip here or click to choose"}</div>
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
              className={`w-7 h-8 rounded border text-sm font-mono font-bold ${c === "?" ? "border-amber-400 bg-amber-50 text-amber-600" : c ? "border-blue-400 bg-blue-50 text-blue-700" : "border-dashed border-slate-300 text-slate-300"}`}
              title={c ? "click to toggle unknown" : "click to add an unknown position"}
            >
              {c || "·"}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 mt-1">Hint characters are always labelled <span className="text-blue-600 font-semibold">investigator-supplied</span>, never treated as video evidence.</p>
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

  async function start() {
    setBusy(true);
    setErr("");
    try {
      if (mode === "single") onStarted((await api.createJob({ file: fileA, hint, threshold })).job_id);
      else if (mode === "crosscam")
        onStarted((await api.createCrosscam({ fileA, fileB, hint, threshold, distanceKm: parseFloat(distanceKm) || null, gapS: parseFloat(gapS) || null })).job_id);
      else onSearchResult(await api.search({ hint, color: color || null, body_type: body || null, make_model: mm || null, threshold, low_light: lowLight }));
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">New case</h2>
        <div className="flex rounded-md border border-slate-300 overflow-hidden text-sm">
          {[["single", "Single clip"], ["crosscam", "Two cameras"], ["search", "Hint-only search"]].map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className={`px-3 py-1.5 ${mode === k ? "bg-blue-600 text-white" : "bg-white hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
      </div>

      {mode !== "search" && (
        <div className={`grid gap-4 ${mode === "crosscam" ? "md:grid-cols-2" : ""}`}>
          <DropZone label={mode === "crosscam" ? "Camera A clip" : "CCTV clip"} file={fileA} onFile={setFileA} />
          {mode === "crosscam" && <DropZone label="Camera B clip" file={fileB} onFile={setFileB} />}
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

      {err && <div className="bg-red-50 text-red-700 border border-red-200 rounded p-2 text-sm">{err}</div>}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={!canStart || busy} onClick={start}>
          {busy ? "Starting…" : mode === "search" ? "Search registry" : "Analyse footage"}
        </button>
        <span className="text-xs text-slate-500">All models run locally; footage never leaves this machine.</span>
      </div>
    </div>
  );
}
