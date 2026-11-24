import React from "react";
import { AttrChip, Empty, Icon, PlateText, StatusChip, ts } from "./common.jsx";

const MERGE_LABEL = { plate: "same plate", box: "same box", handoff: "tracker lost and re-found it" };

function mergeLabel(note) {
  const kinds = [];
  if (/plates agree/.test(note || "")) kinds.push(MERGE_LABEL.plate);
  if (/boxes sit on the same vehicle/.test(note || "")) kinds.push(MERGE_LABEL.box);
  if (/ended and the other began/.test(note || "")) kinds.push(MERGE_LABEL.handoff);
  return kinds.join(", ") || "same vehicle";
}

/** One line under the grid: what was left off the dashboard and why. Nothing is deleted. */
function HiddenNote({ hidden }) {
  if (!hidden?.length) return null;
  const by = {};
  for (const h of hidden) by[h.reason] = (by[h.reason] || 0) + 1;
  const parts = Object.entries(by).map(([r, n]) => `${n} ${r}`);
  return (
    <p className="text-xs text-slate-500 mt-3" title={hidden.map((h) => `track ${h.track_id}${h.clip_role === "B" ? " (B)" : ""}: ${h.reason}`).join("\n")}>
      {hidden.length} more tracked vehicle{hidden.length === 1 ? "" : "s"} not shown: {parts.join(", ")}.
    </p>
  );
}

export default function Vehicles({ tracks, selected, onSelect, primaryId, label, hidden }) {
  if (!tracks?.length) {
    return (
      <div>
        <Empty>{hidden?.length
          ? "No vehicle in this clip showed a readable plate, so none is listed."
          : "No vehicle tracks of at least 5 frames were found in this clip."}</Empty>
        <HiddenNote hidden={hidden} />
      </div>
    );
  }
  return (
    <div>
      {label && <div className="label mb-2">{label}</div>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tracks.map((t) => (
          <button
            key={`${t.clip_role}-${t.track_id}`}
            onClick={() => onSelect(t.track_id)}
            className={`card text-left overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${selected === t.track_id ? "ring-1 ring-blue-500" : ""}`}
          >
            <div className="h-36 bg-slate-900 flex items-center justify-center overflow-hidden">
              {t.best_crop_url ? <img src={t.best_crop_url} className="max-h-36 object-contain" alt="" /> : <span className="text-slate-500 text-xs">no crop</span>}
            </div>
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium inline-flex items-center gap-1.5">Track {t.track_id}{t.track_id === primaryId && <Icon name="star" size={12} className="text-slate-500" title="primary track" />}</span>
                <StatusChip status={t.match?.status} />
              </div>
              <PlateText fused={t.fused} size="text-lg" />
              <div className="flex flex-wrap gap-1">
                <AttrChip label="colour" attr={t.attributes.color} />
                <AttrChip label="body" attr={t.attributes.body_type} />
                {t.attributes.make_model && <AttrChip label="model" attr={t.attributes.make_model} />}
              </div>
              <div className="text-xs text-slate-500">
                seen {ts(t.first_seen_sec)}–{ts(t.last_seen_sec)} · {t.frames.length} plate reads · YOLO {t.yolo_class}
              </div>
              {t.merged_track_ids?.length > 0 && (
                <div className="text-xs text-blue-700" title={t.merge_note || ""}>
                  merged tracker IDs {t.merged_track_ids.join(", ")} ({mergeLabel(t.merge_note)})
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-3">
        <span className="text-amber-500 font-semibold font-mono">?</span> unknown (never guessed) ·{" "}
        <span className="text-blue-600 font-semibold font-mono underline decoration-dotted">A</span> investigator-supplied ·{" "}
        <span className="text-red-600 font-semibold font-mono">?</span> video/hint conflict · <Icon name="star" size={12} /> primary track
      </p>
      <HiddenNote hidden={hidden} />
    </div>
  );
}
