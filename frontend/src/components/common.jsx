import React from "react";

// One line-icon set for the investigator app (lucide shapes, 1.5 stroke, colour from the text role).
const ICON_PATHS = {
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18M6 6l12 12",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  scale: "M12 3v18M7 21h10M3 7h18M6 7l-3 7a3 3 0 006 0zM18 7l-3 7a3 3 0 006 0z",
  moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  arrow: "M7 17L17 7M8 7h9v9",
  plus: "M12 5v14M5 12h14",
  refresh: "M3 12a9 9 0 0115.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 01-15.5 6.3L3 16M3 21v-5h5",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
};
export function Icon({ name, size = 14, className = "", title }) {
  return (
    <svg className={`ico ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} aria-label={title}>
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
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
const STATUS_ICON = { MATCHED: "check", AMBIGUOUS: "scale", "NO CONFIDENT MATCH": "x" };

export function StatusBanner({ match }) {
  if (!match) return null;
  return (
    <div className={`border rounded-lg px-4 py-3 ${STATUS_STYLE[match.status]}`}>
      <div className="flex items-center gap-2 text-lg font-medium">
        <Icon name={STATUS_ICON[match.status]} size={18} />
        <span>{match.status}</span>
        <span className="ml-auto text-xs font-mono font-normal opacity-80">threshold {fmt2(match.threshold_used)}</span>
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
  return <span className={`chip border ${STATUS_STYLE[status]}`}><span className="chip__dot" aria-hidden />{status}</span>;
}

/** Fused plate: amber '?' for unknown, blue for investigator-supplied, red '?' for conflicts. */
export function PlateText({ fused, size = "text-2xl" }) {
  if (!fused || !fused.positions || fused.positions.length === 0)
    return <span className="text-amber-600 font-mono text-sm">(no plate read)</span>;
  return (
    <span className={`font-mono font-medium tracking-[0.2em] ${size}`}>
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
  const alts = c.alts && Object.keys(c.alts).length
    ? " · model candidates: " + Object.entries(c.alts).map(([k, v]) => `${k} ${Number(v).toFixed(2)}`).join(", ")
    : "";
  if (c.reason === "layout" && c.layout_from) {
    return (
      <span className="inline-flex flex-col items-center rounded px-1 py-0.5 mx-[1px] text-[10px] font-mono bg-purple-50 text-purple-700 border border-dashed border-purple-400"
        title={`layout-constrained read: '${c.layout_from}' breaks the Indian plate layout; '${c.char}' is the model's own alternative (model ${Number(c.model_prob).toFixed(2)}, after the layout ${Number(c.layout_prob).toFixed(2)})${alts}`}>
        <span className="text-xs font-semibold">{c.layout_from}→{c.char}</span>
        <span>{Number(c.model_prob).toFixed(2)}</span>
      </span>
    );
  }
  const ok = c.char !== "?";
  const disagree = c.reason === "ocr_disagreement";
  const cls = ok
    ? "bg-green-100 text-green-800"
    : c.reason === "format"
    ? "bg-red-100 text-red-700"
    : disagree
    ? "bg-orange-50 text-orange-800 border border-dashed border-orange-400"
    : "bg-amber-100 text-amber-800";
  const check = c.check_char ? ` · second OCR read '${c.check_char}' ${Number(c.check_conf).toFixed(2)}` : "";
  const why = ok
    ? "accepted"
    : c.reason === "format"
    ? "masked: breaks Indian plate format"
    : c.reason === "non_alphanumeric"
    ? "masked: not A-Z/0-9"
    : disagree
    ? "masked: the second OCR model did not confirm it"
    : `masked: confidence below ${tau}`;
  return (
    <span className={`inline-flex flex-col items-center rounded px-1 py-0.5 mx-[1px] text-[10px] font-mono ${cls}`}
      title={why + check + alts}>
      <span className="text-xs font-semibold">{c.raw_char || "·"}</span>
      <span>{Number(c.conf).toFixed(2)}</span>
    </span>
  );
}

export function Empty({ children }) {
  return <div className="text-sm text-slate-500 p-6 text-center">{children}</div>;
}
