import React, { useMemo, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Label, Reveal, SplitLines } from "./motion.jsx";
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
    <div className="grid lg:grid-cols-12 gap-10">
      <div className="lg:col-span-7">
        <div className="panel p-6 md:p-10">
          <div className="flex items-center justify-between">
            <span className="tag">Fused plate · {night.evidence?.length ?? night.reads} reads</span>
            <span className={`chip ${wrong ? "chip--bad" : "chip--ok"}`}>{wrong ? `${wrong} wrong character` : `${unknown} unknown · 0 wrong`}</span>
          </div>
          <div className="mt-8 text-[clamp(1.2rem,3.4vw,3.1rem)]">
            <Plate text={cur.text} truth={TRUE_NIGHT_PLATE} onCell={setPos} active={pos} />
          </div>
          <div className="mt-4 text-[clamp(1rem,2vw,1.4rem)] opacity-40">
            <Plate text={TRUE_NIGHT_PLATE} />
          </div>
          <div className="tag mt-2">Ground truth (REG-0001), shown for this demo only. PRISM never sees it.</div>

          <div className="mt-10">
            <div className="flex items-baseline justify-between">
              <span className="label-mono">Character confidence threshold τ_char</span>
              <span className="text-[28px] font-medium tracking-[-0.02em] text-accent tabular-nums">{cur.tau.toFixed(2)}</span>
            </div>
            <input type="range" className="rng mt-4" min="0.5" max="0.95" step="0.05" value={tau}
              onChange={(e) => setTau(parseFloat(e.target.value))} aria-label="Character confidence threshold" />
            <div className="flex justify-between tag mt-3"><span>0.50 · lenient</span><span>0.70 · PRISM default</span><span>0.95 · strict</span></div>
          </div>
        </div>
      </div>
      <div className="lg:col-span-5 flex flex-col gap-6">
        <motion.p key={wrong ? "w" : "ok"} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-[22px] md:text-[28px] leading-[1.15] tracking-[-0.03em]">
          {wrong
            ? <>At {cur.tau.toFixed(2)} the half-hidden <span className="text-ok">2</span> is fused as <span className="text-bad">8</span>. A lenient reader commits a wrong digit, and now the true car contradicts the read.</>
            : <>At {cur.tau.toFixed(2)} the hidden digit stays <span className="text-accent">?</span>. Nothing wrong is committed, so the two look-alike registry cars stay tied and PRISM reports AMBIGUOUS.</>}
        </motion.p>
        <div className="grid grid-cols-2 gap-4">
          <div className="border-t rule pt-3"><div className="tag">Characters kept</div><div className="text-[30px] font-medium tracking-[-0.02em] tabular-nums">{cur.kept}<span className="text-muted text-[18px]">/{cur.total}</span></div></div>
          <div className="border-t rule pt-3"><div className="tag">Unknown positions</div><div className="text-[30px] font-medium tracking-[-0.02em] tabular-nums">{unknown}</div></div>
        </div>
        {p && (
          <div className="panel p-5">
            <div className="tag">Position {pos + 1} · hover a cell</div>
            <div className="flex items-center gap-4 mt-3">
              <span className="text-[40px]"><Plate text={p.char} /></span>
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

/** Scroll-driven cross-camera story: plate A + plate B -> combined plate, AMBIGUOUS -> MATCHED. */
export function CrossCamStory() {
  const c = caseById("crosscam_night_partial_white__camB_white");
  const night = caseById("night_partial_white");
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const ax = useTransform(scrollYProgress, [0, 0.45], ["-30%", "0%"]);
  const bx = useTransform(scrollYProgress, [0, 0.45], ["30%", "0%"]);
  const sideOpacity = useTransform(scrollYProgress, [0.05, 0.3], [0.3, 1]);
  const mergeOpacity = useTransform(scrollYProgress, [0.5, 0.7], [0, 1]);
  const mergeY = useTransform(scrollYProgress, [0.5, 0.7], [40, 0]);
  const beforeOpacity = useTransform(scrollYProgress, [0.68, 0.78], [1, 0]);
  const afterOpacity = useTransform(scrollYProgress, [0.72, 0.82], [0, 1]);
  if (!c?.crosscam) return null;
  const x = c.crosscam;
  return (
    <section ref={ref} className="relative h-[260vh]">
      <div className="sticky top-0 h-screen gutter flex flex-col justify-center">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <Label index={6}>Cross-camera</Label>
            <SplitLines as="h2" lines={["Two partial views,", "one full plate"]} className="h-sec mt-5" />
          </div>
          <div className="relative h-[30px] w-[230px]">
            <motion.div style={{ opacity: beforeOpacity }} className="absolute right-0"><StatusChip status={x.before} /></motion.div>
            <motion.div style={{ opacity: afterOpacity }} className="absolute right-0"><StatusChip status={x.after} /></motion.div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 md:gap-8 mt-10">
          <motion.div style={{ x: ax, opacity: sideOpacity }}>
            <div className="card-media aspect-[16/10]"><img src={night?.best || c.best} alt="Camera A" className="w-full h-full object-cover" /></div>
            <div className="tag mt-3">Camera A · night</div>
            <div className="text-[clamp(0.9rem,2.2vw,1.8rem)] mt-2"><Plate text={x.a} /></div>
          </motion.div>
          <motion.div style={{ x: bx, opacity: sideOpacity }}>
            <div className="card-media aspect-[16/10]"><img src={x.best_b} alt="Camera B" className="w-full h-full object-cover" /></div>
            <div className="tag mt-3">Camera B · appearance similarity {x.similarity.toFixed(2)}</div>
            <div className="text-[clamp(0.9rem,2.2vw,1.8rem)] mt-2"><Plate text={x.b} /></div>
          </motion.div>
        </div>
        <motion.div style={{ opacity: mergeOpacity, y: mergeY }} className="mt-10 flex flex-wrap items-center gap-6">
          <span className="tag">Combined evidence</span>
          <span className="text-[clamp(1.5rem,4vw,3.25rem)]"><Plate text={x.combined} /></span>
          <span className="text-muted text-[15px] max-w-sm">Each camera fills the position the other could not read. Linking needed appearance, 3+ agreeing characters and the same body type.</span>
        </motion.div>
      </div>
    </section>
  );
}

export function StatusTriplet() {
  const rows = [
    ["MATCHED", "day_clear_white"],
    ["AMBIGUOUS", "night_partial_white"],
    ["NO CONFIDENT MATCH", "unregistered_white"],
  ];
  return (
    <div className="grid md:grid-cols-3 gap-6">
      {rows.map(([status, id], i) => {
        const c = caseById(id);
        return (
          <Reveal key={status} delay={i * 0.1} className="panel p-6 flex flex-col">
            <StatusChip status={status} />
            <p className="text-[20px] leading-snug tracking-[-0.02em] mt-6 flex-1">{c?.explanation}</p>
            <div className="tag mt-6">{c?.clip}</div>
          </Reveal>
        );
      })}
    </div>
  );
}
