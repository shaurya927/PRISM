import React from "react";
import { Empty, PlateText, StatusChip, fmt2 } from "./common.jsx";
import { MatchView } from "./Shortlist.jsx";
import Vehicles from "./Vehicles.jsx";

export default function CrossCam({ caseResult }) {
  const cc = caseResult.crosscam;
  if (!cc) return <Empty>This case has one clip. Start a “Two cameras” case to link vehicles across cameras.</Empty>;
  const byA = Object.fromEntries(caseResult.tracks.map((t) => [t.track_id, t]));
  const byB = Object.fromEntries(cc.tracks_b.map((t) => [t.track_id, t]));
  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm">
        <b>Encoder:</b> {cc.encoder} · similarity threshold {fmt2(cc.threshold)}. Two tracks are linked only if appearance similarity clears
        the threshold <i>and</i> the plates do not conflict <i>and</i> the body types match.
      </div>
      {!cc.pairs.length && <Empty>No track pairs to compare.</Empty>}
      {cc.pairs.map((p) => {
        const a = byA[p.track_a], b = byB[p.track_b];
        return (
          <div key={`${p.track_a}-${p.track_b}`} className={`card p-4 ${p.same_vehicle ? "ring-2 ring-green-500" : ""}`}>
            <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
              <Side t={a} label={`Camera A · track ${p.track_a}`} />
              <div className="text-center">
                <div className="text-2xl font-bold">{fmt2(p.similarity)}</div>
                <div className="text-xs text-slate-500">cosine similarity</div>
                <div className="flex flex-col gap-1 mt-2 items-center">
                  <span className={`chip ${p.plate_compatible ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>{p.plate_compatible ? "✔ plates compatible" : "✖ plate conflict"}</span>
                  <span className={`chip ${p.body_match ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>{p.body_match ? "✔ body type" : "✖ body type"}</span>
                  {p.speed_kmh != null && <span className={`chip ${p.speed_flag ? "bg-red-100 text-red-700" : "bg-slate-100"}`}>{p.speed_kmh} km/h{p.speed_flag ? " ⚠" : ""}</span>}
                  <span className={`chip font-bold ${p.same_vehicle ? "bg-green-600 text-white" : "bg-slate-200"}`}>{p.same_vehicle ? "SAME VEHICLE" : "not linked"}</span>
                </div>
              </div>
              <Side t={b} label={`Camera B · track ${p.track_b}`} />
            </div>
            <ul className="text-xs text-slate-600 list-disc ml-5 mt-3">{p.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            {p.combined && (
              <div className="mt-4 border-t pt-3 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="label">Combined evidence</span>
                  <PlateText fused={p.combined} size="text-2xl" />
                  <StatusChip status={p.status_before} /> → <StatusChip status={p.status_after} />
                  {p.upgraded && <span className="chip bg-blue-600 text-white">upgraded by camera B</span>}
                </div>
                <MatchView match={p.combined_match} advisor={null} fused={p.combined} />
              </div>
            )}
          </div>
        );
      })}
      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">All camera B tracks ({cc.tracks_b.length})</summary>
        <div className="mt-3"><Vehicles tracks={cc.tracks_b} selected={null} onSelect={() => {}} /></div>
      </details>
    </div>
  );
}

function Side({ t, label }) {
  if (!t) return <Empty>missing track</Empty>;
  return (
    <div className="flex gap-3 items-center">
      {t.best_crop_url && <img src={t.best_crop_url} className="h-24 rounded" alt="" />}
      <div>
        <div className="label">{label}</div>
        <PlateText fused={t.fused} size="text-lg" />
        <div className="text-xs text-slate-500">{t.attributes.color.value} {t.attributes.body_type.value}</div>
        <StatusChip status={t.match?.status} />
      </div>
    </div>
  );
}
