import React, { useMemo, useState } from "react";
import { AttrChip, ConfPill, Empty, PlateText, fmt2, ts } from "./common.jsx";

/** One column per plate position, one row per read. Cell shade = vote weight; bar = winner share. */
export function EvidenceStrip({ fused }) {
  const reads = useMemo(() => {
    const ids = [];
    fused?.positions?.forEach((p) => p.cells.forEach((c) => !ids.includes(c.read_id) && ids.push(c.read_id)));
    return ids;
  }, [fused]);
  if (!fused?.positions?.length) return <Empty>No plate reads to fuse.</Empty>;
  const maxW = Math.max(0.0001, ...fused.positions.flatMap((p) => p.cells.map((c) => c.weight)));
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="px-2 text-left text-slate-500 font-medium">fused</th>
            {fused.positions.map((p) => {
              const share = p.total_weight ? Math.max(0, ...Object.values(p.votes)) / p.total_weight : 0;
              return (
                <th key={p.index} className="px-1 pb-1" title={p.note || `${p.source}; votes ${JSON.stringify(p.votes)}`}>
                  <div className={`font-mono text-xl font-semibold ${p.char === "?" ? (p.source === "conflict" ? "text-red-600" : "text-amber-500") : p.source === "investigator-supplied" ? "text-blue-600" : "text-slate-900"}`}>{p.char}</div>
                  <div className="h-1.5 w-9 bg-slate-200 rounded mx-auto mt-0.5 overflow-hidden">
                    <div className={`h-full ${p.char !== "?" ? "bg-green-500" : "bg-amber-400"}`} style={{ width: `${share * 100}%` }} />
                  </div>
                  <div className="text-[9px] text-slate-400 font-normal">{p.index + 1} · {fmt2(p.weight)}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {reads.map((rid) => (
            <tr key={rid}>
              <td className="px-2 font-mono text-slate-500">{rid}</td>
              {fused.positions.map((p) => {
                const c = p.cells.find((x) => x.read_id === rid);
                if (!c || c.char == null) return <td key={p.index} className="w-10 h-7 border border-white bg-slate-50 text-center text-slate-300">·</td>;
                if (c.char === "?")
                  return (
                    <td key={p.index} className="w-10 h-7 border border-white bg-amber-50 text-center font-mono text-amber-600" title={`read '${c.raw_char}' at ${fmt2(c.raw_conf)}: below threshold, no weight`}>
                      {(c.raw_char || "?").toUpperCase()}<span className="text-[8px] align-super">{fmt2(c.raw_conf)}</span>
                    </td>
                  );
                const t = c.weight / maxW;
                const disagree = p.char !== "?" && c.char !== p.char;
                return (
                  <td key={p.index} className={`w-10 h-7 border border-white text-center font-mono font-semibold ${disagree ? "text-red-700" : "text-slate-900"}`}
                    style={{ background: `rgba(20, 151, 172, ${0.1 + 0.7 * t})` }} title={`weight ${fmt2(c.weight)} (conf ${fmt2(c.raw_conf)})`}>
                    {c.char}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 mt-2">
        Brighter teal = more weight (confidence × sharpness). Amber cells were read below 0.70 and carry no weight. A position is
        accepted only if its winner has evidence ≥ 0.9 and at least 60% of all votes; otherwise it stays <span className="text-amber-500 font-semibold">?</span>.
      </p>
    </div>
  );
}

function FramesTable({ frames, showSR, srAvailable }) {
  const [copy, setCopy] = useState("all");
  const rows = frames.filter((f) => copy === "all" || f.source === copy);
  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-sm">
        <span className="label">Copies</span>
        {["all", "raw", "clahe"].map((c) => (
          <button key={c} className={`chip border ${copy === c ? "bg-blue-600 text-white border-blue-600" : "bg-white border-slate-300"}`} onClick={() => setCopy(c)}>{c}</button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="p-2 text-left">Read</th><th className="p-2 text-left">Frame / time</th><th className="p-2 text-left">Vehicle</th>
              <th className="p-2 text-left">Plate crop</th>{showSR && <th className="p-2 text-left">Super-res (visual aid)</th>}
              <th className="p-2 text-right">Sharpness</th><th className="p-2 text-left">Raw OCR</th><th className="p-2 text-left">Masked</th><th className="p-2 text-left">Confidence per character</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.read_id} className="border-t border-slate-100 align-top">
                <td className="p-2 font-mono text-xs">{f.read_id}<div className="text-[10px] text-slate-400">{f.source}{f.two_line ? " · 2-line" : ""}</div></td>
                <td className="p-2 text-xs">#{f.frame_idx}<div className="text-slate-400">{ts(f.timestamp_sec)}</div></td>
                <td className="p-2">{f.vehicle_crop_url && <img src={f.vehicle_crop_url} className="h-14 rounded" alt="" />}</td>
                <td className="p-2">{f.plate_crop_url && <img src={f.source === "clahe" ? f.plate_clahe_url : f.plate_crop_url} className="h-10 pixel border rounded" alt="" />}</td>
                {showSR && (
                  <td className="p-2">
                    {f.sr_url ? (
                      <div><img src={f.sr_url} className="h-10 pixel border-2 border-dashed border-purple-400 rounded" alt="" />
                        <div className="text-[9px] text-purple-700">not evidence</div></div>
                    ) : <span className="text-[10px] text-slate-400">{srAvailable ? "raw copy only" : "not installed"}</span>}
                  </td>
                )}
                <td className="p-2 text-right font-mono text-xs">{f.sharpness.toFixed(1)}</td>
                <td className="p-2 font-mono text-xs">{f.raw_text || <span className="text-slate-400">(empty)</span>}</td>
                <td className="p-2 font-mono text-sm font-semibold">{f.masked_text.split("").map((ch, i) => <span key={i} className={ch === "?" ? "text-amber-500" : ""}>{ch}</span>)}</td>
                <td className="p-2 whitespace-nowrap">
                  {f.chars.map((c, i) => <ConfPill key={i} c={c} />)}
                  {f.format_conflicts?.map((m, i) => <div key={i} className="text-[10px] text-red-600 whitespace-normal">{m}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Evidence({ track }) {
  const [sr, setSR] = useState(false);
  if (!track) return <Empty>Select a vehicle track.</Empty>;
  const f = track.fused;
  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap gap-6 items-center">
        {track.best_crop_url && <img src={track.best_crop_url} className="h-28 rounded" alt="" />}
        <div className="space-y-2">
          <div className="label">Track {track.track_id} · combined plate</div>
          <PlateText fused={f} size="text-3xl" />
          {f.hint && <div className="text-xs text-slate-500">video only: <span className="font-mono">{f.video_text || "(none)"}</span> · hint <span className="font-mono text-blue-600">{f.hint}</span></div>}
          {f.hint_conflicts?.map((c, i) => <div key={i} className="text-xs text-red-600">{c}</div>)}
          <div className="flex gap-1 flex-wrap">
            <AttrChip label="colour" attr={track.attributes.color} />
            <AttrChip label="body" attr={track.attributes.body_type} />
            <AttrChip label="make/model" attr={track.attributes.make_model} />
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-2">Plate evidence strip</h3>
        <EvidenceStrip fused={f} />
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3>Frame-by-frame ({track.frames.length} reads from {new Set(track.frames.map((x) => x.frame_idx)).size} frames)</h3>
          <label className={`flex items-center gap-2 text-xs px-2 py-1 rounded border ${track.sr_available ? "border-purple-300 bg-purple-50 text-purple-800" : "border-slate-200 text-slate-400"}`}>
            <input type="checkbox" disabled={!track.sr_available} checked={sr} onChange={(e) => setSR(e.target.checked)} />
            {track.sr_available ? "Super-resolution preview: Visual aid only. Not used for identification." : "Super-resolution not installed"}
          </label>
        </div>
        {track.frames.length ? <FramesTable frames={track.frames} showSR={sr} srAvailable={track.sr_available} /> : <Empty>No plate crop passed the detection, width (≥ 30 px) and sharpness (≥ 45) filters.</Empty>}
      </div>
    </div>
  );
}
