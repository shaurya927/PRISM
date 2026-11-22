import React from "react";
import { api } from "../api.js";

export default function Summary({ caseResult, jobId }) {
  const n = caseResult.narrative;
  const cu = caseResult.custody;
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Evidence-checked summary</h3>
          <span className="chip bg-slate-100 text-slate-700">{n?.method} · {n?.checked} checked · {n?.removed} removed</span>
        </div>
        <p className="text-[15px] leading-relaxed">
          {n?.sentences.filter((s) => s.passed).map((s, i) => (
            <span key={i}>
              {s.text.split(/(\[[^\]]+\])/).map((part, j) =>
                part.startsWith("[") ? <span key={j} className="text-xs font-mono text-blue-700 bg-blue-50 rounded px-1">{part}</span> : <span key={j}>{part}</span>
              )}{" "}
            </span>
          ))}
        </p>
        {n?.sentences.some((s) => !s.passed) && (
          <details className="mt-2 text-xs text-slate-500"><summary>Removed sentences</summary>
            {n.sentences.filter((s) => !s.passed).map((s, i) => <div key={i}>“{s.text}” — {s.problems.join("; ")}</div>)}
          </details>
        )}
        <p className="text-xs text-slate-500 mt-3">Every sentence cites evidence IDs and is checked against the result data before it is shown. The summary never sees the video.</p>
      </div>

      <div className="card p-5 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold mr-auto">Forensic report</h3>
        <a className="btn-primary" href={api.reportUrl(jobId, "pdf")} target="_blank" rel="noreferrer">⬇ Download PDF</a>
        <a className="btn-ghost" href={api.reportUrl(jobId, "html")} target="_blank" rel="noreferrer">⬇ Download HTML</a>
      </div>

      {cu && (
        <div className="card p-5 text-sm">
          <h3 className="font-semibold mb-2">Chain of custody</h3>
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
            {cu.clips.map((c, i) => <div key={i}><span className="label">Clip {c.name}</span><div className="font-mono text-[11px] break-all">{c.sha256}</div></div>)}
            <div><span className="label">Config hash</span><div className="font-mono text-[11px] break-all">{cu.config_hash}</div></div>
            {cu.registry_sha256 && <div><span className="label">Registry</span><div className="font-mono text-[11px] break-all">{cu.registry_sha256}</div></div>}
            {Object.entries(cu.models).map(([k, v]) => <div key={k}><span className="label">{k}</span><div className="text-xs">{v}</div></div>)}
            {Object.entries(cu.vendor_commits).map(([k, v]) => <div key={k}><span className="label">vendor/{k}</span><div className="font-mono text-[11px] break-all">{v}</div></div>)}
          </div>
          <p className="text-xs text-slate-500 mt-2">{cu.artifacts.length} saved artifacts are hashed with SHA-256; the full list is in the report.</p>
        </div>
      )}
      <p className="text-xs font-semibold text-slate-600 border border-slate-300 rounded p-3 bg-white">
        PRISM output supports an investigator's decision. It does not identify a vehicle on its own.
      </p>
    </div>
  );
}
