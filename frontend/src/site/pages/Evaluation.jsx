import React, { useMemo, useState } from "react";
import { Counter, Label, Reveal, SplitLines } from "../motion.jsx";
import { Bar, BigCTA, NextLink, PageHero, Plate, SectionHead, StatusChip, TauChart } from "../components.jsx";
import { evaluation as E } from "../data/content.js";

const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;

const ABLATION = [
  ["single", "Single best frame"],
  ["majority", "Plain majority vote"],
  ["conf_mask", "+ confidence mask"],
  ["two_condition", "+ two-condition vote"],
  ["full", "Full PRISM (+ format check, consistency)"],
];

export default function Evaluation() {
  const s = E.clip_summary;
  const [tau, setTau] = useState(E.tau);
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
  return (
    <>
      <PageHero index={3} label="Evaluation" lines={["Measured,", "not promised"]}
        lead={`${E.clips.length} clips (6 demo clips, each also degraded 6 ways) and a synthetic benchmark of ${E.n_vehicles} registry vehicles across easy, medium and hard thirds. Run on ${E.device === "cuda" ? "GPU" : "CPU"} with τ = ${E.tau}.`} />

      <section className="gutter pb-[12vh]">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-12">
          {headline.map(([v, d, suf, k], i) => (
            <Reveal key={k} delay={(i % 4) * 0.06} className="border-t rule pt-5">
              <div className="text-[clamp(2.5rem,5vw,4.5rem)] leading-none tracking-[-0.03em] font-medium tabular-nums"><Counter value={v} decimals={d} suffix={suf} /></div>
              <p className="text-muted text-[15px] mt-3">{k}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="gutter py-[12vh] border-t rule">
        <SectionHead index={1} label="OCR benchmark" title={["Which reader", "goes in front?"]}
          aside={`Both OCR backends ran on the same ${E.n_vehicles} synthetic vehicles. The rule: best top-1 among backends within the false-match budget. Winner: ${E.ocr_winner}.`} />
        <div className="grid md:grid-cols-2 gap-10 mt-14">
          {Object.entries(E.ocr_benchmark).map(([name, b], j) => (
            <Reveal key={name} delay={j * 0.1} className="panel p-6 md:p-8">
              <div className="flex items-center justify-between">
                <span className="text-[28px] tracking-[-0.02em] font-medium">{name}</span>
                {name === E.ocr_winner && <span className="chip chip--ok">default</span>}
              </div>
              <div className="space-y-5 mt-8">
                {[["Top-1", b.top1], ["Top-5", b.top5], ["Characters recovered", b.recovery_rate], ["Committed error (lower is better)", b.committed_char_error, true]].map(([k, v, bad], i) => (
                  <div key={k}>
                    <div className="flex justify-between text-[14px] mb-2"><span className="text-muted">{k}</span><span className="tabular-nums">{pct(v)}</span></div>
                    <Bar value={v} color={bad ? "var(--red)" : name === E.ocr_winner ? "var(--accent)" : "var(--ink)"} delay={i * 0.08} />
                  </div>
                ))}
              </div>
              <div className="tag mt-6">{b.ms_per_read.toFixed(1)} ms per read · false match {pct(b.false_match_rate)}</div>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-8"><p className="text-muted text-[15px] max-w-3xl">fast_plate_ocr commits fewer wrong characters, but it also recovers far fewer, so it finds the right vehicle less often. PARSeq's extra errors are what the fusion guardrails exist to catch.</p></Reveal>
      </section>

      <section className="gutter py-[12vh] border-t rule">
        <SectionHead index={2} label="Ablation" title={["What each rule", "buys you"]}
          aside="Committed character error on the synthetic benchmark as each part of fusion is switched on. Lower is better." />
        <div className="mt-14 space-y-7">
          {ABLATION.map(([k, label], i) => {
            const a = E.ablation[k];
            if (!a) return null;
            return (
              <Reveal key={k} delay={i * 0.06} className="grid md:grid-cols-[18rem_1fr_6rem] items-center gap-4">
                <span className={`text-[18px] tracking-[-0.02em] ${k === "full" ? "text-accent" : ""}`}>{label}</span>
                <Bar value={a.committed_char_error} max={0.2} color={k === "full" ? "var(--accent)" : "var(--ink)"} delay={i * 0.08} />
                <span className="tabular-nums text-right text-[20px]">{pct(a.committed_char_error)}</span>
              </Reveal>
            );
          })}
        </div>
      </section>

      <section className="gutter py-[12vh] border-t rule">
        <SectionHead index={3} label="By difficulty" title={["Where it holds,", "where it doesn't"]} />
        <div className="grid md:grid-cols-3 gap-6 mt-14">
          {Object.entries(E.by_level).map(([lvl, v], i) => (
            <Reveal key={lvl} delay={i * 0.08} className="panel p-6">
              <div className="flex justify-between items-baseline"><span className="text-[28px] tracking-[-0.02em] font-medium capitalize">{lvl}</span><span className="tag">n = {v.n}</span></div>
              <dl className="grid grid-cols-2 gap-y-4 mt-6 text-[15px]">
                <dt className="text-muted">Committed error</dt><dd className={`text-right tabular-nums ${v.committed_char_error > 0.1 ? "text-bad" : ""}`}>{pct(v.committed_char_error)}</dd>
                <dt className="text-muted">Recovered</dt><dd className="text-right tabular-nums">{pct(v.recovery_rate)}</dd>
                <dt className="text-muted">Top-1</dt><dd className="text-right tabular-nums">{pct(v.top1)}</dd>
                <dt className="text-muted">Top-5</dt><dd className="text-right tabular-nums">{pct(v.top5)}</dd>
                <dt className="text-muted">False match</dt><dd className="text-right tabular-nums">{pct(v.false_match_rate)}</dd>
              </dl>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="gutter py-[12vh] border-t rule">
        <div className="grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <Label index={4}>Threshold sweep</Label>
            <SplitLines as="h2" lines={["Choosing τ"]} className="h-sec mt-5" />
            <Reveal delay={0.1}><p className="lead mt-6">The lowest τ that keeps false matches at or under 5% on the benchmark is {E.tau_choice.tau.toFixed(2)}. PRISM ships with the stricter {E.tau.toFixed(2)}, which removes most of those false matches at a cost of under one point of top-1.</p></Reveal>
          </div>
          <Reveal className="lg:col-span-7"><TauChart sweep={E.tau_sweep} tau={tau} onTau={setTau} defaultTau={E.tau} /></Reveal>
        </div>
      </section>

      <ClipTable />

      <section className="gutter py-[12vh] border-t rule">
        <SectionHead index={6} label="Limits" title={["What it still", "gets wrong"]} />
        <div className="grid md:grid-cols-3 gap-6 mt-14">
          {[
            [pct(s.color_acc), "Colour accuracy on the clips. White cars under CCTV light are often read as grey or silver, which is why similar shades can only produce AMBIGUOUS, never decide a match."],
            [pct(E.by_level.hard.recovery_rate), "Characters recovered on the hard benchmark third. PRISM leaves them as ? rather than guess, but a hard plate rarely yields a match."],
            [pct(s.false_match_rate), `Clips where another vehicle still cleared τ once the true vehicle was removed from the registry (${E.clips.filter((c) => c.false_match).length} of ${E.clips.length}). All are night-clip versions, where the decoy differs from the true car only at the digit no frame could read.`],
          ].map(([v, d], i) => (
            <Reveal key={i} delay={i * 0.08} className="border-t rule pt-5">
              <div className="text-[clamp(2.5rem,5vw,4.5rem)] leading-none tracking-[-0.03em] font-medium text-accent">{v}</div>
              <p className="text-muted text-[15px] mt-4 leading-relaxed">{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <NextLink to="/guardrails" label="Next" title="The guardrails" />
      <BigCTA />
    </>
  );
}

function ClipTable() {
  const degs = useMemo(() => ["all", ...Array.from(new Set(E.clips.map((c) => c.degradation)))], []);
  const [d, setD] = useState("all");
  const rows = E.clips.filter((c) => d === "all" || c.degradation === d);
  const ok = rows.filter((r) => r.status === r.expected).length;
  return (
    <section className="gutter py-[12vh] border-t rule">
      <SectionHead index={5} label="Every clip" title={[`${E.clips.length} runs, unfiltered`]}
        aside="Demo clips plus Gaussian blur, motion blur, 2× and 4× downscale, JPEG quality 20 and dark noise versions." />
      <Reveal className="flex flex-wrap gap-2 mt-10">
        {degs.map((x) => <button key={x} className={`filter-btn ${d === x ? "is-on" : ""}`} onClick={() => setD(x)}>{x}</button>)}
      </Reveal>
      <div className="tag mt-6">{ok} of {rows.length} with the designed status</div>
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
    </section>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" role="img" aria-label="as designed">
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}