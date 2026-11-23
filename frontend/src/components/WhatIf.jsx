import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { Empty, Icon, StatusChip, fmt2 } from "./common.jsx";
import { Candidate } from "./Shortlist.jsx";

// Counterfactual what-if simulator (Hypothesis & Sensitivity Matrix). Every change re-asks the API,
// which re-ranks the registry under the hypothesis and perturbs everything not pinned. Nothing here is
// saved to the case: assumed characters are shown in blue with a dotted underline and labelled
// "hypothesis" everywhere.

const FALLBACK_PAIRS = [["0", "O"], ["1", "I"], ["8", "B"], ["5", "S"], ["2", "Z"], ["6", "G"], ["4", "A"]];
const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;

function usePartners() {
  const [pairs, setPairs] = useState(FALLBACK_PAIRS);
  const [colors, setColors] = useState([]);
  const [bodies, setBodies] = useState([]);
  useEffect(() => {
    api.config().then((c) => {
      if (c?.config?.match?.confusable_pairs) setPairs(c.config.match.confusable_pairs);
      setColors(c?.colors || []);
      setBodies(c?.body_types || []);
    }).catch(() => {});
  }, []);
  const partner = useMemo(() => Object.fromEntries(pairs.flatMap(([a, b]) => [[a, b], [b, a]])), [pairs]);
  return { partner, colors, bodies };
}

function Seg({ value, options, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg p-1 bg-slate-100">
      {options.map(([v, l, title]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} title={title}
          onClick={() => onChange(v)}
          className={`px-2.5 h-8 rounded-md text-[13px] transition-colors ${value === v ? "bg-slate-700 text-slate-900" : "text-slate-600 hover:text-slate-900"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** One editable plate slot: type a character, '?' for unreadable; look-alike and reset buttons below. */
function Slot({ i, video, value, partner, onSet, conf, source }) {
  const changed = value !== video;
  const alt = video !== "?" ? partner[video] : null;
  const shown = value;
  const cls = changed
    ? "text-blue-600 border-blue-400 bg-blue-50 underline decoration-dotted"
    : shown === "?" ? "text-amber-500 border-slate-300" : source === "investigator-supplied" ? "text-blue-600 border-slate-300" : "text-slate-900 border-slate-300";
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] font-mono text-slate-400 tabular-nums">{i + 1}</span>
      <input
        aria-label={`Position ${i + 1}: video ${video === "?" ? "unread" : video}${changed ? `, assumed ${shown}` : ""}`}
        className={`w-9 h-11 text-center font-mono text-xl font-medium rounded-md border bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 ${cls}`}
        value={shown}
        maxLength={1}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const c = e.target.value.toUpperCase().slice(-1);
          if (c && /^[A-Z0-9?]$/.test(c)) onSet(i, c);
        }}
        onKeyDown={(e) => {
          if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); onSet(i, video); }
          if (e.key === "ArrowRight") e.currentTarget.parentElement.nextElementSibling?.querySelector("input")?.focus();
          if (e.key === "ArrowLeft") e.currentTarget.parentElement.previousElementSibling?.querySelector("input")?.focus();
        }}
        title={conf != null && video !== "?" ? `read with fusion share ${fmt2(conf)}` : video === "?" ? "unread in the video" : undefined}
      />
      <div className="h-5 flex items-center gap-0.5">
        {alt && !changed && (
          <button type="button" className="text-[10px] font-mono px-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            title={`Assume the OCR look-alike '${alt}'`} onClick={() => onSet(i, alt)}>{video}↔{alt}</button>
        )}
        {changed && (
          <button type="button" className="text-[10px] font-mono px-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            title="Back to the video reading" onClick={() => onSet(i, video)}>reset</button>
        )}
      </div>
    </div>
  );
}

function HypPlate({ positions }) {
  return (
    <span className="font-mono font-medium tracking-[0.2em] text-xl">
      {positions.map((p) => {
        const cls = p.source === "hypothesis" ? "text-blue-600 underline decoration-dotted"
          : p.char === "?" ? "text-amber-500" : p.source === "investigator-supplied" ? "text-blue-600" : "text-slate-900";
        return <span key={p.index} className={cls} title={`position ${p.index + 1}: ${p.source}`}>{p.char}</span>;
      })}
    </span>
  );
}

function StabilityGauge({ s }) {
  const others = s.win_shares.filter((w) => w.registry_id !== s.leader_id);
  const segs = [
    [s.leader_id, s.leader_share, "bg-green-500"],
    ...others.slice(0, 4).map((w, i) => [w.registry_id, w.share, ["bg-amber-400", "bg-violet-500", "bg-slate-700", "bg-blue-100"][i]]),
    ["tie", s.tie_share, "bg-slate-200"],
  ].filter(([, v]) => v > 0);
  return (
    <div>
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <div className="label">Hypothesis Stability Score</div>
          <div className="text-[44px] leading-none font-medium tabular-nums mt-1">{pct(s.leader_share)}</div>
        </div>
        <div className="text-sm text-slate-600 pb-1">
          <span className="font-mono">{s.leader_id || "-"}</span> is the sole #1 in {pct(s.leader_share)} of {s.n_scenarios} scenario{s.n_scenarios === 1 ? "" : "s"}
          {s.sampled ? ` (sampled from ${s.n_combinations})` : ""} · MATCHED in {pct(s.clear_share)} · tied in {pct(s.tie_share)}
        </div>
      </div>
      <div className="flex h-2.5 w-full rounded overflow-hidden bg-slate-100 mt-3" role="img" aria-label="Share of scenarios won by each candidate">
        {segs.map(([k, v, c]) => <div key={k} className={c} style={{ width: `${v * 100}%` }} title={`${k === "tie" ? "tied #1" : k} ${pct(v)}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-slate-500 mt-2">
        {segs.map(([k, v, c]) => <span key={k} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-sm ${c}`} />{k === "tie" ? "tied #1" : k} {pct(v)}</span>)}
      </div>
      <p className="text-sm text-slate-700 mt-3">{s.text}</p>
    </div>
  );
}

/** Rows: perturbed slots and the colour/lighting reading. Columns: their values. Cell: how often the
 *  hypothesis leader stays sole #1 with that value. Click a cell to pin that value. */
function Matrix({ s, onPick, pinnedSlot }) {
  if (!s.axes.length) return <p className="text-sm text-slate-500">Nothing left to perturb: every slot is read or pinned and the colour is fixed.</p>;
  const heat = (v) => (v >= 0.8 ? "bg-green-100 text-green-800" : v >= 0.5 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700");
  return (
    <div>
      <div className="sr-only">Sensitivity matrix: share of scenarios in which {s.leader_id} stays the sole #1 candidate, per slot value</div>
      <div className="space-y-2.5 text-sm">
          {s.axes.map((a) => (
            <div key={`${a.kind}-${a.index}`} role="group" aria-label={a.label}
              className="grid sm:grid-cols-[15rem_1fr] gap-x-3 gap-y-1.5 items-center">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-slate-700">{a.label}</span>
                {a.pivotal && <span className="chip bg-red-100 text-red-700">pivotal</span>}
              </div>
              <div>
                <div className="flex flex-wrap gap-1.5">
                  {a.cells.map((c) => {
                    const flip = c.leader_id && c.leader_id !== s.leader_id;
                    return (
                      <button key={c.value} type="button" onClick={() => onPick(a, c)}
                        className={`rounded-md px-2.5 py-1.5 text-left transition-shadow hover:ring-1 hover:ring-slate-400 ${heat(c.keeps_leader_share)}`}
                        title={`${c.n} scenario${c.n === 1 ? "" : "s"} · ${s.leader_id} sole #1 in ${pct(c.keeps_leader_share)} · tied in ${pct(c.tie_share)}. Click to assume this.`}>
                        <div className="font-mono text-[13px]">{c.label}</div>
                        <div className="text-[11px] tabular-nums opacity-80">
                          keeps #1 {pct(c.keeps_leader_share)}{flip ? ` · → ${c.leader_id}` : !c.leader_id && c.tie_share ? " · mostly tied" : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
      </div>
      <p className="text-xs text-slate-500 mt-3">Green: the leader holds in at least 80% of scenarios with that value. Red: below 50%. Click a value to make it part of the hypothesis.</p>
    </div>
  );
}

function Differential({ d }) {
  const max = Math.max(0.05, ...d.components.map((c) => Math.abs(c.delta)));
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="label">#1 vs #{d.rival_rank}</span>
        <span className="font-mono text-sm">{d.leader_id} <span className="text-slate-400">vs</span> {d.rival_id}</span>
        <span className="ml-auto font-mono text-sm tabular-nums">{fmt2(d.leader_score)} · {fmt2(d.rival_score)} · gap {d.gap >= 0 ? "+" : ""}{fmt2(d.gap)}</span>
      </div>
      <p className="text-sm mt-2">{d.text}</p>
      <div className="grid gap-1.5 mt-3">
        {d.components.map((c) => (
          <div key={c.name} className="grid grid-cols-[6.5rem_1fr_4rem] items-center gap-2 text-[12px] font-mono">
            <span className="text-slate-500">{c.name}</span>
            <div className="relative h-2 bg-slate-100 rounded">
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-300" />
              <div className={`absolute top-0 bottom-0 rounded ${c.delta >= 0 ? "bg-green-500 left-1/2" : "bg-[var(--red-3)] right-1/2"}`}
                style={{ width: `${(Math.abs(c.delta) / max) * 50}%` }} />
            </div>
            <span className={`text-right tabular-nums ${c.delta > 0 ? "text-green-800" : c.delta < 0 ? "text-red-700" : "text-slate-400"}`}>{c.delta > 0 ? "+" : ""}{fmt2(c.delta)}</span>
          </div>
        ))}
      </div>
      {d.rival_contradicts && <p className="text-xs text-red-700 mt-2">{d.rival_id} contradicts a confidently read character, so it ranks below every candidate without a contradiction.</p>}
    </div>
  );
}

export default function WhatIf({ jobId, track, caseThreshold }) {
  const { partner, colors, bodies } = usePartners();
  const base = track?.fused?.text || "";
  const [slots, setSlots] = useState({});
  const [color, setColor] = useState("recorded");
  const [assumedColor, setAssumedColor] = useState("");
  const [body, setBody] = useState("recorded");
  const [assumedBody, setAssumedBody] = useState("");
  const [tau, setTau] = useState(caseThreshold);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const ctrl = useRef(null);
  const timer = useRef(null);

  useEffect(() => { setSlots({}); setColor("recorded"); setBody("recorded"); setTau(caseThreshold); setRes(null); }, [track?.track_id, jobId, caseThreshold]);

  const colorReq = color === "assume" ? assumedColor || null : color === "recorded" ? null : color;
  const bodyReq = body === "assume" ? assumedBody || null : body === "recorded" ? null : body;

  useEffect(() => {
    if (!track || !jobId) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      setErr("");
      api.whatif(jobId, { trackId: track.track_id, slots, color: colorReq, bodyType: bodyReq, threshold: tau }, c.signal)
        .then((r) => { if (!c.signal.aborted) setRes(r); })
        .catch((e) => { if (e.name !== "AbortError") setErr(String(e.message || e)); })
        .finally(() => { if (!c.signal.aborted) setLoading(false); });
    }, 220);
    return () => clearTimeout(timer.current);
  }, [jobId, track, slots, colorReq, bodyReq, tau]);

  if (!track) return <Empty>Select a vehicle track.</Empty>;
  if (!base) return <Empty>This track has no plate reading, so there are no slots to test. Colour and body assumptions alone cannot produce a match.</Empty>;

  const setSlot = (i, c) => setSlots((s) => {
    const n = { ...s };
    if (c === base[i]) delete n[i]; else n[i] = c;
    return n;
  });
  const reset = () => { setSlots({}); setColor("recorded"); setBody("recorded"); setTau(caseThreshold); };
  const dirty = Object.keys(slots).length || color !== "recorded" || body !== "recorded" || Math.abs(tau - caseThreshold) > 1e-9;
  const onPick = (axis, cell) => {
    if (axis.kind === "position") setSlot(axis.index, cell.value);
    else { setColor(cell.value === "recorded" ? "recorded" : cell.value); }
  };
  const conf = Object.fromEntries((track.fused.positions || []).map((p) => [p.index, p.confidence]));
  const src = Object.fromEntries((track.fused.positions || []).map((p) => [p.index, p.source]));
  const recColor = track.attributes?.color;
  const recBody = track.attributes?.body_type;

  return (
    <div className="space-y-4">
      <div className="card p-4 border-l-4 border-l-blue-500">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[16rem]">
            <div className="label mb-1">What-if simulator · Track {track.track_id}</div>
            <p className="text-sm text-slate-600">Change any slot, the colour or lighting assumption, or τ. PRISM re-ranks the registry under your hypothesis, then varies every uncertain slot you did not pin to see how stable the #1 candidate is.</p>
          </div>
          <div className="flex items-center gap-2">
            {loading && <span className="label-mono text-blue-600">computing…</span>}
            <button className="btn-ghost" disabled={!dirty} onClick={reset}><Icon name="refresh" size={14} />Reset to evidence</button>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2"><Icon name="alert" size={12} /> Hypothetical. Assumed characters and lighting are not evidence: nothing here changes the case result, the report or the chain of custody.</p>
      </div>

      <div className="card p-4 space-y-4">
        <div>
          <div className="label mb-2">Plate slots <span className="normal-case text-slate-400">· type a character, ? for unreadable, Backspace to reset</span></div>
          <div className="flex flex-wrap gap-1.5">
            {base.split("").map((v, i) => (
              <Slot key={i} i={i} video={v} value={slots[i] ?? v} partner={partner} onSet={setSlot} conf={conf[i]} source={src[i]} />
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-1">Video reading <span className="font-mono tracking-[0.2em] text-slate-700">{base}</span>
            {track.fused.hint && <> · hint characters (blue) were supplied by the investigator</>}</div>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <div>
            <div className="label mb-2">Colour / lighting</div>
            <Seg label="Colour assumption" value={color} onChange={setColor} options={[
              ["recorded", recColor && !recColor.uncertain ? `As seen (${recColor.value})` : "As seen (uncertain)", "Use the colour PRISM read"],
              ["ignore", "Unreliable", "Treat the colour reading as unreliable: it adds nothing to any score"],
              ["sodium", "Sodium lighting", "Sodium-vapour street lights: white, silver, grey and yellow look alike (half credit)"],
              ["assume", "Assume…", "Assume a specific colour"],
            ]} />
            {color === "assume" && (
              <select className="input w-auto mt-2" value={assumedColor} onChange={(e) => setAssumedColor(e.target.value)} aria-label="Assumed colour">
                <option value="">choose a colour</option>
                {colors.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>
          <div>
            <div className="label mb-2">Body type</div>
            <Seg label="Body type assumption" value={body} onChange={setBody} options={[
              ["recorded", recBody && !recBody.uncertain ? `As seen (${recBody.value})` : "As seen (uncertain)", "Use the body type PRISM read"],
              ["ignore", "Ignore", "Body type adds nothing to any score"],
              ["assume", "Assume…", "Assume a specific body type"],
            ]} />
            {body === "assume" && (
              <select className="input w-auto mt-2" value={assumedBody} onChange={(e) => setAssumedBody(e.target.value)} aria-label="Assumed body type">
                <option value="">choose a body type</option>
                {bodies.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>
        </div>
        <div>
          <div className="label">Threshold τ = {tau.toFixed(2)} <span className="normal-case text-slate-400">· case: {caseThreshold.toFixed(2)}</span></div>
          <input type="range" min="0.30" max="0.95" step="0.01" value={tau} onChange={(e) => setTau(parseFloat(e.target.value))} className="w-full accent-blue-600" aria-label="Hypothetical match threshold" />
        </div>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{err}</div>}

      {res && (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`} aria-live="polite">
          <div className="card p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="label">Hypothesis</span>
              <HypPlate positions={res.positions} />
              <StatusChip status={res.match.status} />
              <span className="ml-auto text-xs font-mono text-slate-500">{res.stability.n_scenarios} scenarios · {Math.round(res.elapsed_ms)} ms</span>
            </div>
            {(res.leader_changed || res.status_changed) && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-sm">
                {res.leader_changed && <>Under this hypothesis #1 changes from <span className="font-mono">{res.actual_leader_id}</span> to <span className="font-mono">{res.match.top_candidates[0]?.registry_id}</span>. </>}
                {res.status_changed && <>Status changes from {res.actual_status} to {res.match.status}.</>}
              </div>
            )}
            <ul className="mt-3 text-sm text-slate-700 list-disc ml-5 space-y-0.5">
              {res.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
            <p className="text-sm text-slate-600 mt-2">{res.match.explanation}</p>
          </div>

          <div className="card p-4"><StabilityGauge s={res.stability} /></div>

          <div className="card p-4">
            <div className="label mb-2">Sensitivity matrix</div>
            <Matrix s={res.stability} onPick={onPick} />
          </div>

          {res.differentials.length > 0 && (
            <div className="space-y-3">
              <div className="label">Differential justification</div>
              <div className="grid lg:grid-cols-2 gap-3">
                {res.differentials.map((d) => <Differential key={d.rival_id} d={d} />)}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="label">Hypothetical shortlist <span className="normal-case text-slate-400">· {res.match.specificity_text}</span></div>
            {res.match.top_candidates.map((c) => <Candidate key={c.registry_id} c={c} status={res.match.status} />)}
          </div>
        </div>
      )}
      {!res && !err && <div className="upbar"><span className="indet" /></div>}
    </div>
  );
}
