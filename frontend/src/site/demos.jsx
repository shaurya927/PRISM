import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ImageReveal, Reveal } from "./motion.jsx";
import { Plate, StatusChip } from "./components.jsx";
import { caseById, TRUE_NIGHT_PLATE } from "./data/content.js";

/**
 * Interactive fusion demo. Every value comes from re-running PRISM's real masking + fusion code on the
 * 24 real reads of night_partial_white.mp4 at each τ_char (scripts/build_site_media.py).
 */
export function FusionDemo() {
  const night = caseById("night_partial_white");
  const sweep = night?.fusion_sweep || [];
  const [tau, setTau] = useState(0.7);
  const [pos, setPos] = useState(8);
  const cur = useMemo(() => sweep.reduce((a, b) => (Math.abs(b.tau - tau) < Math.abs(a.tau - tau) ? b : a), sweep[0]), [sweep, tau]);
  if (!cur) return null;
  const wrong = cur.text.split("").filter((c, i) => c !== "?" && TRUE_NIGHT_PLATE[i] && c !== TRUE_NIGHT_PLATE[i]).length;
  const unknown = cur.text.split("").filter((c) => c === "?").length;
  const p = cur.positions[pos];
  return (
    <div className="grid lg:grid-cols-12 gap-8 lg:gap-10">
      <div className="lg:col-span-7">
        <div className="panel p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="tag">Fused plate · {night.evidence?.length ?? night.reads} reads</span>
            <span className={`chip ${wrong ? "chip--bad" : "chip--ok"}`}>{wrong ? `${wrong} wrong character` : `${unknown} unknown · 0 wrong`}</span>
          </div>
          <div className="mt-6 text-[clamp(1.25rem,2.6vw,2.25rem)]">
            <Plate text={cur.text} truth={TRUE_NIGHT_PLATE} onCell={setPos} active={pos} />
          </div>
          <div className="mt-3 text-[clamp(1rem,1.6vw,1.25rem)] opacity-40">
            <Plate text={TRUE_NIGHT_PLATE} />
          </div>
          <div className="tag mt-2">Ground truth (REG-0001), shown for this demo only. PRISM never sees it.</div>

          <div className="mt-10">
            <div className="flex items-baseline justify-between gap-4">
              <span className="label-mono">Character confidence threshold τ_char</span>
              <span className="text-[24px] font-medium tracking-[-0.02em] tabular-nums">{cur.tau.toFixed(2)}</span>
            </div>
            <input type="range" className="rng mt-4" min="0.5" max="0.95" step="0.05" value={tau}
              onChange={(e) => setTau(parseFloat(e.target.value))} aria-label="Character confidence threshold" />
            <div className="flex justify-between tag mt-3"><span>0.50 · lenient</span><span>0.70 · PRISM default</span><span>0.95 · strict</span></div>
          </div>
        </div>
      </div>
      <div className="lg:col-span-5 flex flex-col gap-5">
        <motion.p key={wrong ? "w" : "ok"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}
          className="text-[18px] md:text-[20px] leading-[1.4] tracking-[-0.01em]" aria-live="polite">
          {wrong
            ? <>At {cur.tau.toFixed(2)} the half-hidden <span className="text-ok">2</span> is fused as <span className="text-bad">8</span>. A lenient reader commits a wrong digit, and now the true car contradicts the read.</>
            : <>At {cur.tau.toFixed(2)} the hidden digit stays <span className="pcell pcell--q">?</span>. Nothing wrong is committed, so the two look-alike registry cars stay tied and PRISM reports AMBIGUOUS.</>}
        </motion.p>
        <div className="grid grid-cols-2 gap-4">
          <div className="border-t rule pt-3"><div className="tag">Characters kept</div><div className="text-[26px] font-medium tracking-[-0.02em] tabular-nums">{cur.kept}<span className="text-muted text-[16px]">/{cur.total}</span></div></div>
          <div className="border-t rule pt-3"><div className="tag">Unknown positions</div><div className="text-[26px] font-medium tracking-[-0.02em] tabular-nums">{unknown}</div></div>
        </div>
        {p && (
          <div className="panel p-5">
            <div className="tag">Position {pos + 1} · hover a cell</div>
            <div className="flex items-center gap-4 mt-3">
              <span className="text-[30px]"><Plate text={p.char} /></span>
              <div className="text-[14px] text-muted leading-relaxed">
                evidence {p.weight.toFixed(2)} of {p.total.toFixed(2)} · share {(p.share * 100).toFixed(0)}%
                <br />
                {p.note || "accepted: evidence ≥ 0.9, share ≥ 60%, consistency ≥ 40%"}
              </div>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          {night.plates.map((src, i) => (
            <img key={src} src={src} alt={`Plate crop ${i + 1}`} className="pixel w-full rounded-md border rule aspect-[3/1] object-cover" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Static cross-camera view: camera A and camera B side by side, then the combined plate and the status change. */
export function CrossCamCompare() {
  const c = caseById("crosscam_night_partial_white__camB_white");
  const night = caseById("night_partial_white");
  if (!c?.crosscam) return null;
  const x = c.crosscam;
  const cams = [
    ["Camera A · night", night?.best || c.best, x.a],
    [`Camera B · appearance similarity ${x.similarity.toFixed(2)}`, x.best_b, x.b],
  ];
  return (
    <div>
      <div className="grid sm:grid-cols-2 gap-6">
        {cams.map(([k, src, plate]) => (
          <figure key={k}>
            <div className="card-media aspect-[16/10]"><ImageReveal src={src} alt={k} className="absolute inset-0" /></div>
            <figcaption className="tag mt-3">{k}</figcaption>
            <div className="text-[clamp(1rem,1.8vw,1.375rem)] mt-2"><Plate text={plate} /></div>
          </figure>
        ))}
      </div>
      <div className="panel p-5 md:p-6 mt-6 flex flex-wrap items-center gap-x-6 gap-y-4">
        <span className="tag">Combined evidence</span>
        <span className="text-[clamp(1.25rem,2.4vw,1.75rem)]"><Plate text={x.combined} /></span>
        <span className="flex items-center gap-2">
          <StatusChip status={x.before} />
          <span className="text-muted" aria-hidden>→</span><span className="sr-only">then</span>
          <StatusChip status={x.after} />
        </span>
      </div>
      <p className="text-muted text-[15px] mt-4">Each camera fills the position the other could not read. Linking needed appearance, 3+ agreeing characters and the same body type.</p>
    </div>
  );
}

export function StatusTriplet() {
  const rows = [
    ["MATCHED", "day_clear_white"],
    ["AMBIGUOUS", "night_partial_white"],
    ["NO CONFIDENT MATCH", "unregistered_white"],
  ];
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {rows.map(([status, id]) => {
        const c = caseById(id);
        return (
          <Reveal key={status} className="panel p-5 flex flex-col">
            <div><StatusChip status={status} /></div>
            <p className="text-[16px] leading-relaxed text-[var(--muted-2)] mt-4 flex-1">{c?.explanation}</p>
            <div className="tag mt-4">{c?.clip}</div>
          </Reveal>
        );
      })}
    </div>
  );
}
