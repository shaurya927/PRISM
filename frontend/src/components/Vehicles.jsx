import React from "react";
import { AttrChip, Empty, PlateText, StatusChip, ts } from "./common.jsx";

export default function Vehicles({ tracks, selected, onSelect, primaryId, label }) {
  if (!tracks?.length) return <Empty>No vehicle tracks of at least 5 frames were found in this clip.</Empty>;
  return (
    <div>
      {label && <div className="label mb-2">{label}</div>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tracks.map((t) => (
          <button
            key={`${t.clip_role}-${t.track_id}`}
            onClick={() => onSelect(t.track_id)}
            className={`card text-left overflow-hidden hover:shadow-md transition ${selected === t.track_id ? "ring-2 ring-blue-500" : ""}`}
          >
            <div className="h-36 bg-slate-900 flex items-center justify-center overflow-hidden">
              {t.best_crop_url ? <img src={t.best_crop_url} className="max-h-36 object-contain" alt="" /> : <span className="text-slate-500 text-xs">no crop</span>}
            </div>
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Track {t.track_id}{t.track_id === primaryId ? " ★" : ""}</span>
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
                  merged tracker IDs {t.merged_track_ids.join(", ")} (same plate)
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-3">
        <span className="text-amber-500 font-bold font-mono">?</span> unknown (never guessed) ·{" "}
        <span className="text-blue-600 font-bold font-mono underline decoration-dotted">A</span> investigator-supplied ·{" "}
        <span className="text-red-600 font-bold font-mono">?</span> video/hint conflict · ★ primary track
      </p>
    </div>
  );
}
