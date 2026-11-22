import React from "react";

const LABELS = {
  ingest: "Ingest & hash",
  tracking: "Vehicle tracking (YOLO11 + ByteTrack)",
  plates: "Plate detection & sharpness filter",
  ocr: "OCR + masking + fusion",
  attributes: "Colour / body / make-model (OpenCLIP)",
  matching: "Registry matching & summary",
};

export default function Progress({ job }) {
  const stages = Object.keys(LABELS);
  return (
    <div className="max-w-2xl mx-auto card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Analysing{job.kind === "crosscam" ? " two clips" : ""}…</h2>
        <span className="text-xs font-mono text-slate-500">job {job.job_id}</span>
      </div>
      <div className="space-y-3">
        {stages.map((s) => {
          const v = job.progress?.[s] ?? 0;
          const active = job.stage === s;
          return (
            <div key={s}>
              <div className="flex justify-between text-sm">
                <span className={active ? "font-semibold text-blue-700" : v >= 1 ? "text-slate-700" : "text-slate-400"}>
                  {v >= 1 ? "✔ " : active ? "▶ " : "○ "}{LABELS[s]}
                </span>
                <span className="text-xs text-slate-500">{Math.round(v * 100)}%</span>
              </div>
              <div className="h-2 bg-slate-200 rounded overflow-hidden">
                <div className={`h-full transition-all ${v >= 1 ? "bg-green-500" : "bg-blue-500"}`} style={{ width: `${v * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      {job.status === "error" && <div className="mt-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">{job.error}</div>}
      <p className="text-xs text-slate-500 mt-4">The first run downloads and loads models, which takes longer.</p>
    </div>
  );
}
