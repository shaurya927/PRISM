import React, { useMemo, useState } from "react";
import { Counter, Label, Reveal } from "../motion.jsx";
import { Bar, NextLink, PageHero, Plate, SectionHead, StatusChip, Tabs, TauChart } from "../components.jsx";
import { evaluation as E } from "../data/content.js";

const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;

const ABLATION = [
  ["single", "Single best frame"],
  ["majority", "Plain majority vote"],
  ["conf_mask", "+ confidence mask"],
  ["two_condition", "+ two-condition vote"],
  ["full", "Full PRISM (+ format check, consistency)"],
];

function Overview() {
  const s = E.clip_summary;
  const headline = [
    [s.status_as_designed * 100, 1, "%", "Clips with the designed status"],
    [s.committed_char_error * 100, 1, "%", "Committed characters wrong"],
    [s.recovery_rate * 100, 1, "%", "Plate characters recovered"],
    [s.top1 * 100, 1, "%", "True vehicle ranked first"],
    [s.top5 * 100, 1, "%", "True vehicle in top 5"],
    [s.wrong_matched, 0, "", "MATCHED to the wrong vehicle"],
    [s.body_acc * 100, 1, "%", "Body type correct"],
    [s.mean_seconds, 1, " s", "Mean seconds per clip"],
  ];
  const limits = [
    [pct(s.color_acc), "Colour accuracy on the clips. White cars under CCTV light are often read as grey or silver, which is why similar shades can only produce AMBIGUOUS, never decide a match."],
    [pct(E.by_level.hard.recovery_rate), "Characters recovered on the hard benchmark third. PRISM leaves them as ? rather than guess, but a hard plate rarely yields a match."],
    [pct(s.false_match_rate), `Clips where another vehicle still cleared τ once the true vehicle was removed from the registry (${E.clips.filter((c) => c.false_match).length} of ${E.clips.length}). All are night-clip versions, where the decoy differs from the true car only at the digit no frame could read.`],
  ];
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
        {headline.map(([v, d, suf, k], i) => (
          <Reveal key={k} className="border-t rule pt-5" delay={(i % 4) * 0.06}>
            <div className="stat-num"><Counter value={v} decimals={d} suffix={suf} /></div>
            <p className="text-muted text-[14px] mt-3">{k}</p>
          </Reveal>
        ))}
      </div>
      <div className="mt-16">
        <SectionHead label="Limits" title="What it still gets wrong" />
        <div className="grid md:grid-cols-3 gap-6 mt-8">
          {limits.map(([v, d], i) => (
            <Reveal key={i} className="border-t rule pt-5">
              <div className="stat-num text-bad">{v}</div>
              <p className="text-muted text-[15px] mt-3 leading-relaxed">{d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </>
  );
}

function Ocr() {
  return (
    <>
      <SectionHead label="OCR benchmark" title="Which reader goes in front?"
        aside={`Both OCR backends ran on the same ${E.n_vehicles} synthetic vehicles. The rule: best top-1 among backends within the false-match budget. Winner: ${E.ocr_winner}.`} />
      <div className="grid md:grid-cols-2 gap-6 mt-8">
        {Object.entries(E.ocr_benchmark).map(([name, b]) => (
          <Reveal key={name} className="panel p-6">
            <div className="flex items-center justify-between">
              <span className="row-title">{name}</span>
              {name === E.ocr_winner && <span className="chip chip--ok">default</span>}
            </div>
            <div className="space-y-4 mt-6">
              {[["Top-1", b.top1], ["Top-5", b.top5], ["Characters recovered", b.recovery_rate], ["Committed error (lower is better)", b.committed_char_error, true]].map(([k, v, bad]) => (
                <div key={k}>
                  <div className="flex justify-between text-[14px] mb-2"><span className="text-muted">{k}</span><span className="tabular-nums">{pct(v)}</span></div>
                  <Bar value={v} color={bad ? "var(--red-3)" : name === E.ocr_winner ? "var(--ink)" : "var(--muted)"} />
                </div>
              ))}
            </div>
            <div className="tag mt-6">{b.ms_per_read.toFixed(1)} ms per read · false match {pct(b.false_match_rate)}</div>
          </Reveal>
        ))}
      </div>
      <p className="text-muted text-[15px] mt-6">fast_plate_ocr commits fewer wrong characters, but it also recovers far fewer, so it finds the right vehicle less often. PARSeq's extra errors are what the fusion guardrails exist to catch.</p>
    </>
  );
}

function Ablation() {
  return (
    <>
      <SectionHead label="Ablation" title="What each rule buys you"
        aside="Committed character error on the synthetic benchmark as each part of fusion is switched on. Lower is better." />
      <div className="mt-8 space-y-5">
        {ABLATION.map(([k, label]) => {
          const a = E.ablation[k];
          if (!a) return null;
          return (
            <div key={k} className="grid md:grid-cols-[18rem_1fr_5rem] items-center gap-x-4 gap-y-2">
              <span className={`text-[16px] ${k === "full" ? "font-medium" : "text-[var(--muted-2)]"}`}>{label}</span>
              <Bar value={a.committed_char_error} max={0.2} color={k === "full" ? "var(--ink)" : "var(--muted)"} />
              <span className="tabular-nums md:text-right text-[16px]">{pct(a.committed_char_error)}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-16">
        <SectionHead label="By difficulty" title="Where it holds, where it doesn't" />
        <div className="grid md:grid-cols-3 gap-4 mt-8">
          {Object.entries(E.by_level).map(([lvl, v]) => (
            <Reveal key={lvl} className="panel p-5">
              <div className="flex justify-between items-baseline"><span className="row-title capitalize">{lvl}</span><span className="tag">n = {v.n}</span></div>
              <dl className="grid grid-cols-2 gap-y-3 mt-5 text-[15px]">
                <dt className="text-muted">Committed error</dt><dd className={`text-right tabular-nums ${v.committed_char_error > 0.1 ? "text-bad" : ""}`}>{pct(v.committed_char_error)}</dd>
                <dt className="text-muted">Recovered</dt><dd className="text-right tabular-nums">{pct(v.recovery_rate)}</dd>
                <dt className="text-muted">Top-1</dt><dd className="text-right tabular-nums">{pct(v.top1)}</dd>
                <dt className="text-muted">Top-5</dt><dd className="text-right tabular-nums">{pct(v.top5)}</dd>
                <dt className="text-muted">False match</dt><dd className="text-right tabular-nums">{pct(v.false_match_rate)}</dd>
              </dl>
            </Reveal>
          ))}
        </div>
      </div>
    </>
  );
}

function Threshold() {
  const [tau, setTau] = useState(E.tau);
  return (
    <div className="grid lg:grid-cols-12 gap-10">
      <div className="lg:col-span-5">
        <Label>Threshold sweep</Label>
        <h2 className="h-sec mt-3">Choosing τ</h2>
        <p className="lead mt-5">The lowest τ that keeps false matches at or under 5% on the benchmark is {E.tau_choice.tau.toFixed(2)}. PRISM ships with the stricter {E.tau.toFixed(2)}, which removes most of those false matches at a cost of under one point of top-1.</p>
        <p className="text-muted text-[15px] mt-4">On {E.n_vehicles} synthetic vehicles, a lower τ matches a few more true vehicles but lets in false matches. The investigator can move τ live.</p>
      </div>
      <div className="lg:col-span-7"><TauChart sweep={E.tau_sweep} tau={tau} onTau={setTau} defaultTau={E.tau} /></div>
    </div>
  );
}

function ClipTable() {
  const degs = useMemo(() => ["all", ...Array.from(new Set(E.clips.map((c) => c.degradation)))], []);
  const [d, setD] = useState("all");
  const rows = E.clips.filter((c) => d === "all" || c.degradation === d);
  const ok = rows.filter((r) => r.status === r.expected).length;
  return (
    <>
      <SectionHead label="Every clip" title={`${E.clips.length} runs, unfiltered`}
        aside="Demo clips plus Gaussian blur, motion blur, 2× and 4× downscale, JPEG quality 20 and dark noise versions." />
      <div className="flex flex-wrap gap-2 mt-8" role="group" aria-label="Filter by degradation">
        {degs.map((x) => <button key={x} className={`filter-btn ${d === x ? "is-on" : ""}`} aria-pressed={d === x} onClick={() => setD(x)}>{x}</button>)}
      </div>
      <div className="tag mt-5">{ok} of {rows.length} with the designed status</div>
      <div className="overflow-x-auto mt-4">
        <table className="tbl min-w-[760px]">
          <thead><tr><th>Clip</th><th>Fused plate</th><th>Status</th><th>Designed</th><th>Wrong chars</th><th className="text-right">Seconds</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.clip}>
                <td className="mono text-[13px]">{r.clip}</td>
                <td className="text-[15px]"><Plate text={r.plate} /></td>
                <td><StatusChip status={r.status} /></td>
                <td className={r.status === r.expected ? "text-ok" : "text-muted"}>{r.status === r.expected ? <Check /> : r.expected}</td>
                <td className={r.wrong ? "text-bad tabular-nums" : "tabular-nums text-muted"}>{r.wrong}</td>
                <td className="text-right tabular-nums text-muted">{r.seconds.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" role="img" aria-label="as designed">
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TABS = [
  { id: "overview", label: "Overview", render: () => <Overview /> },
  { id: "ocr", label: "OCR benchmark", render: () => <Ocr /> },
  { id: "ablation", label: "Ablation & difficulty", render: () => <Ablation /> },
  { id: "threshold", label: "Threshold", render: () => <Threshold /> },
  { id: "clips", label: "All clips", render: () => <ClipTable /> },
];

export default function Evaluation() {
  return (
    <>
      <PageHero index={3} label="Evaluation" lines={["Measured,", "not promised"]}
        lead={`${E.clips.length} clips (6 demo clips, each also degraded 6 ways) and a synthetic benchmark of ${E.n_vehicles} registry vehicles across easy, medium and hard thirds. Run on ${E.device === "cuda" ? "GPU" : "CPU"} with τ = ${E.tau}.`} />
      <section className="gutter pb-16 md:pb-20">
        <Tabs id="eval" label="Evaluation sections" tabs={TABS} />
      </section>
      <NextLink to="/guardrails" label="Next" title="The guardrails" />
    </>
  );
}
