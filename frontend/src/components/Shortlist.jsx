import React from "react";
import { Empty, PlateText, StatusBanner, fmt2 } from "./common.jsx";

function ScoreBar({ b }) {
  const seg = [
    ["plate", b.plate, "bg-blue-600"],
    ["colour", b.color, "bg-amber-500"],
    ["body", b.body, "bg-emerald-500"],
    ["make/model", b.make_model, "bg-violet-500"],
  ];
  return (
    <div>
      <div className="flex h-3 w-full bg-slate-100 rounded overflow-hidden">
        {seg.map(([k, v, c]) => <div key={k} className={c} style={{ width: `${Math.min(100, v * 100)}%` }} title={`${k} ${fmt2(v)}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-500 mt-1">
        {seg.map(([k, v, c]) => (
          <span key={k} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-sm ${c}`} />{k} {fmt2(v)}</span>
        ))}
        {b.capped && <span className="text-red-600">capped: {b.capped}</span>}
      </div>
    </div>
  );
}

function Candidate({ c, status, plateLen }) {
  const top = c.rank === 1;
  const highlight = top && status === "MATCHED";
  const dim = status === "NO CONFIDENT MATCH";
  return (
    <div className={`card p-4 ${highlight ? "ring-2 ring-green-500" : ""} ${dim ? "opacity-80" : ""}`}>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${highlight ? "bg-green-600 text-white" : "bg-slate-200"}`}>{c.rank}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{c.registry_id}</span>
            <span className="font-mono text-lg tracking-widest">{c.plate}</span>
            <span className="text-sm text-slate-600">{c.color} {c.body_type} · {c.make} {c.model}</span>
            <span className="text-xs text-slate-400">{c.owner_region}</span>
            <span className="ml-auto text-2xl font-bold">{fmt2(c.score)}</span>
          </div>
          <div className="mt-2"><ScoreBar b={c.breakdown} /></div>
          <div className="flex flex-wrap gap-1 mt-2">
            <span className="chip bg-green-100 text-green-800">✔ {c.matched_known}/{c.known_count} known chars</span>
            {c.breakdown.color_sim === 1 && <span className="chip bg-green-100 text-green-800">✔ colour</span>}
            {c.breakdown.color_sim === 0.5 && <span className="chip bg-yellow-100 text-yellow-800">≈ colour</span>}
            {c.breakdown.body_sim === 1 && <span className="chip bg-green-100 text-green-800">✔ body</span>}
            {c.breakdown.make_model > 0 && <span className="chip bg-violet-100 text-violet-800">✔ make/model</span>}
            {c.breakdown.shift !== 0 && <span className="chip bg-slate-100 text-slate-700">shift {c.breakdown.shift > 0 ? "+" : ""}{c.breakdown.shift}</span>}
            {c.mismatches.map((m, i) => <span key={i} className="chip bg-red-100 text-red-700">✖ {m}</span>)}
          </div>
          <ul className="mt-2 text-sm text-slate-700 list-disc ml-5 space-y-0.5">
            {c.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function Advisor({ advisor }) {
  if (!advisor) return null;
  return (
    <div className={`card p-4 border-l-4 ${advisor.needed ? "border-l-blue-500" : "border-l-slate-300"}`}>
      <div className="label mb-1">Next-best-evidence advisor</div>
      <p className="text-sm">{advisor.text}</p>
      {advisor.lead_read_id && (
        <p className="text-xs text-slate-500 mt-1">Lead: read <span className="font-mono">{advisor.lead_read_id}</span> (frame {advisor.lead_frame_idx}) saw
          <span className="font-mono font-bold"> {advisor.lead_char}</span> at {fmt2(advisor.lead_conf)}. Leads never enter the score.</p>
      )}
    </div>
  );
}

export function MatchView({ match, advisor, fused }) {
  if (!match) return <Empty>No match result.</Empty>;
  return (
    <div className="space-y-3">
      <StatusBanner match={match} />
      {fused && <div className="text-sm text-slate-600">Searching with <PlateText fused={fused} size="text-base" /> · {match.known_count} known characters</div>}
      <Advisor advisor={advisor} />
      {match.status === "NO CONFIDENT MATCH" && <p className="text-xs text-red-700">The candidates below are shown for transparency only. None is a match.</p>}
      {match.top_candidates.map((c) => <Candidate key={c.registry_id} c={c} status={match.status} plateLen={fused?.length} />)}
    </div>
  );
}

export default function Shortlist({ track }) {
  if (!track) return <Empty>Select a vehicle track.</Empty>;
  return <MatchView match={track.match} advisor={track.advisor} fused={track.fused} />;
}
