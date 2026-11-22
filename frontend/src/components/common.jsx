import React from "react";

export const fmt2 = (v) => (v == null ? "-" : Number(v).toFixed(2));
export const ts = (t) => {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
};

const STATUS_STYLE = {
  MATCHED: "bg-green-50 text-green-800 border-green-300",
  AMBIGUOUS: "bg-amber-50 text-amber-800 border-amber-300",
  "NO CONFIDENT MATCH": "bg-red-50 text-red-800 border-red-300",
};
const STATUS_ICON = { MATCHED: "✔", AMBIGUOUS: "⚖", "NO CONFIDENT MATCH": "✖" };

export function StatusBanner({ match }) {
  if (!match) return null;
  return (
    <div className={`border rounded-lg px-4 py-3 ${STATUS_STYLE[match.status]}`}>
      <div className="flex items-center gap-2 text-lg font-bold">
        <span>{STATUS_ICON[match.status]}</span>
        <span>{match.status}</span>
        <span className="ml-auto text-xs font-medium opacity-80">threshold {fmt2(match.threshold_used)}</span>
      </div>
      <p className="text-sm mt-1">{match.explanation}</p>
      <p className="text-xs mt-1 opacity-80">
        {match.specificity_text}.{match.low_light ? " Low-light clip: colour weight reduced to 0.10, plate raised to 0.75." : ""}
      </p>
    </div>
  );
}

export function StatusChip({ status }) {
  if (!status) return null;
  return <span className={`chip border ${STATUS_STYLE[status]}`}>{status}</span>;
}

/** Fused plate: amber '?' for unknown, blue for investigator-supplied, red '?' for conflicts. */
export function PlateText({ fused, size = "text-2xl" }) {
  if (!fused || !fused.positions || fused.positions.length === 0)
    return <span className="text-amber-600 font-mono text-sm">(no plate read)</span>;
  return (
    <span className={`font-mono font-bold tracking-[0.2em] ${size}`}>
      {fused.positions.map((p) => {
        let cls = "text-slate-900";
        let title = `position ${p.index + 1}: ${p.source}`;
        if (p.char === "?") cls = p.source === "conflict" ? "text-red-600" : "text-amber-500";
        else if (p.source === "investigator-supplied") cls = "text-blue-600 underline decoration-dotted";
        if (p.note) title += ` - ${p.note}`;
        return (
          <span key={p.index} className={cls} title={title}>
            {p.char}
          </span>
        );
      })}
    </span>
  );
}

export function AttrChip({ label, attr }) {
  if (!attr) return null;
  const unsure = attr.uncertain;
  const isModel = /model/i.test(label);
  const offRegistry = !unsure && /not a registry model/.test(attr.source || "");
  // An uncertain make/model is not named: naming the closest of 57 labels reads like a claim.
  const text = unsure ? (isModel ? "not recognised" : `uncertain (${attr.top2?.[0]?.[0] ?? "?"})`) : attr.value;
  const tip = [
    attr.top2?.length ? `closest: ${attr.top2.map(([l, p]) => `${l} ${fmt2(p)}`).join(", ")}` : null,
    offRegistry ? "not a registry model, so it adds nothing to the score" : null,
  ].filter(Boolean).join(" · ");
  return (
    <span
      className={`chip ${unsure ? "bg-slate-100 text-slate-500 border border-dashed border-slate-300" : "bg-indigo-50 text-indigo-800"}`}
      title={tip}
    >
      <span className="opacity-60">{label}</span> {text}
      {!(unsure && isModel) && <span className="opacity-60">{fmt2(attr.confidence)}</span>}
      {offRegistry && <span className="opacity-60">· not in registry</span>}
    </span>
  );
}

export function ConfPill({ c, tau = 0.7 }) {
  const ok = c.char !== "?";
  const cls = ok
    ? "bg-green-100 text-green-800"
    : c.reason === "format"
    ? "bg-red-100 text-red-700"
    : "bg-amber-100 text-amber-800";
  return (
    <span className={`inline-flex flex-col items-center rounded px-1 py-0.5 mx-[1px] text-[10px] font-mono ${cls}`}
      title={ok ? "accepted" : c.reason === "format" ? "masked: breaks Indian plate format" : c.reason === "non_alphanumeric" ? "masked: not A-Z/0-9" : `masked: confidence below ${tau}`}>
      <span className="text-xs font-bold">{c.raw_char || "·"}</span>
      <span>{Number(c.conf).toFixed(2)}</span>
    </span>
  );
}

export function Empty({ children }) {
  return <div className="text-sm text-slate-500 italic p-6 text-center">{children}</div>;
}
