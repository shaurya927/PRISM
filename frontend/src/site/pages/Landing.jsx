import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform } from "framer-motion";
import { Counter, EASE_REVEAL, ImageReveal, Label, Magnetic, Marquee, Parallax, Reveal, ScrambleText, ScrubText, SplitLines } from "../motion.jsx";
import { Accordion, Arrow, BigCTA, CaseCard, HoverPreviewList, Pill, SectionHead, TauChart } from "../components.jsx";
import { CrossCamStory, FusionDemo, StatusTriplet } from "../demos.jsx";
import { CASES, evaluation, GUARDRAILS, MARQUEE, STAGES } from "../data/content.js";
import { useSite } from "../Layout.jsx";

export default function Landing() {
  return (
    <>
      <Hero />
      <Marquee items={MARQUEE} speed={38} />
      <Manifesto />
      <Stats />
      <Pipeline />
      <section className="gutter py-[14vh] border-t rule">
        <SectionHead index={3} label="Try the fusion" title={["Lower the bar", "and it lies."]}
          aside="Drag the threshold. These are PRISM's real masking and fusion functions re-run on the 24 real reads from the night clip." />
        <div className="mt-14"><FusionDemo /></div>
      </section>
      <ThresholdSection />
      <Work />
      <CrossCamStory />
      <section className="gutter py-[14vh] border-t rule">
        <SectionHead index={7} label="Three honest answers" title={["Every result says", "how sure it is."]} />
        <div className="mt-14"><StatusTriplet /></div>
      </section>
      <section className="gutter py-[14vh] border-t rule">
        <SectionHead index={8} label="Guardrails" title={["Rules it cannot", "break."]}
          aside="Each rule is enforced in code and covered by a test. Property-based tests generate thousands of random reads to try to break them." />
        <div className="mt-14"><Accordion items={GUARDRAILS.slice(0, 5)} /></div>
        <Reveal className="mt-10"><Pill to="/guardrails" ghost>All guardrails</Pill></Reveal>
      </section>
      <BigCTA />
    </>
  );
}

function Hero() {
  const { introDone } = useSite();
  const [d] = useState(() => (introDone ? 0.35 : 2.4));
  const night = CASES.find((c) => c.id === "night_partial_white");
  const { scrollY } = useScroll();
  const imgScale = useTransform(scrollY, [0, 900], [1, 1.12]);
  return (
    <section className="gutter pt-[20vh] md:pt-[18vh] pb-[8vh] min-h-screen flex flex-col">
      <motion.div className="flex justify-between label-mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: d, duration: 1 }}>
        <span>(Hackasol 5.0 · AIML-01)</span>
        <span className="text-right hidden sm:block">Plate Recovery &amp; Identification<br />from Surveillance Media</span>
      </motion.div>
      <SplitLines lines={["Read every frame.", "Guess nothing."]} className="display mt-8" delay={d + 0.1} stagger={0.1} />
      <div className="grid md:grid-cols-12 gap-8 mt-auto pt-14 items-end">
        <div className="md:col-span-5">
          <Reveal delay={d + 0.5}>
            <p className="lead max-w-md">
              PRISM reads blurry CCTV footage across many frames, keeps only the plate characters it saw clearly,
              and ranks registry vehicles with a written reason for every score.
            </p>
          </Reveal>
          <Reveal delay={d + 0.65} className="flex flex-wrap gap-3 mt-8">
            <Magnetic><Pill to="/app">Open the investigator</Pill></Magnetic>
            <Magnetic><Pill to="/how-it-works" ghost>How it works</Pill></Magnetic>
          </Reveal>
          <motion.div className="flex items-center gap-4 mt-12" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: d + 1.1 }}>
            <div className="scroll-cue" />
            <span className="label-mono">Scroll</span>
          </motion.div>
        </div>
        <div className="md:col-span-7">
          <div className="relative card-media aspect-[16/10]" data-cursor="Case">
            <Link to="/cases/night_partial_white" className="absolute inset-0 z-10" aria-label="Open the night case" />
            <motion.div style={{ scale: imgScale }} className="absolute inset-0">
              <ImageReveal src={night?.best} alt="Night CCTV crop of a white sedan" className="absolute inset-0" delay={d + 0.2} />
            </motion.div>
            <motion.div
              className="absolute left-4 bottom-4 right-4 flex flex-wrap items-end justify-between gap-3"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d + 0.9, duration: 0.9, ease: EASE_REVEAL }}
            >
              <span className="rounded-lg bg-black/55 backdrop-blur px-3 py-2 plate-type text-[clamp(1.25rem,2.6vw,2.25rem)]">
                <ScrambleText text={night?.fused || "CG04MX48?1"} delay={d + 0.9} duration={1.4} />
              </span>
              <span className="label-mono bg-black/55 backdrop-blur rounded-md px-2 py-1 !text-[var(--ink)]">night_partial_white.mp4 · {night?.reads} reads</span>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Manifesto() {
  return (
    <section className="gutter py-[18vh]">
      <Label index={1}>The idea</Label>
      <div className="mt-10 max-w-5xl">
        <ScrubText text="Most plate readers fill every gap with a guess. PRISM reads every frame, keeps only what it saw clearly, and marks the rest ? so an investigator can tell evidence from a lead at a glance." />
      </div>
    </section>
  );
}

function Stats() {
  const s = evaluation.clip_summary;
  const n = evaluation.clips.length;
  const items = [
    { v: s.wrong_matched, d: 0, suffix: "", k: `Clips MATCHED to the wrong vehicle, of ${n}` },
    { v: s.committed_char_error * 100, d: 1, suffix: "%", k: "Committed characters that were wrong" },
    { v: s.top5 * 100, d: 1, suffix: "%", k: "True vehicle in the top-5 shortlist" },
    { v: s.mean_seconds, d: 1, suffix: " s", k: `Mean time per clip on ${evaluation.device === "cuda" ? "an RTX 5050 GPU" : "CPU"}` },
  ];
  return (
    <section className="gutter pb-[14vh]">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-12">
        {items.map((it, i) => (
          <Reveal key={i} delay={i * 0.08} className="border-t rule pt-5">
            <div className="text-[clamp(3rem,6vw,5.5rem)] leading-none tracking-[-0.06em] font-medium tabular-nums">
              <Counter value={it.v} decimals={it.d} suffix={it.suffix} />
            </div>
            <p className="text-muted text-[15px] mt-4 max-w-[24ch]">{it.k}</p>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-10"><Link to="/evaluation" className="label-mono ulink">Full evaluation on {n} clips and {evaluation.n_vehicles} synthetic vehicles →</Link></Reveal>
    </section>
  );
}

function Pipeline() {
  return (
    <section className="gutter py-[14vh] border-t rule">
      <SectionHead index={2} label="Pipeline" title={["Eight stages,", "one evidence chain."]}
        aside="From the uploaded clip to a signed report. Hover a stage to see real output from that step." />
      <div className="mt-14">
        <HoverPreviewList
          rows={STAGES}
          renderRow={(s) => (
            <Link to="/how-it-works" className="hlist__row grid grid-cols-[3rem_1fr_auto] md:grid-cols-[5rem_1fr_1fr_auto] items-center gap-4 py-6 md:py-8">
              <span className="tag">{s.n}</span>
              <span className="text-[clamp(1.75rem,3.6vw,3.25rem)] tracking-[-0.045em] font-medium leading-none">{s.name}</span>
              <span className="hidden md:block text-muted text-[16px]">{s.short}</span>
              <Arrow />
            </Link>
          )}
        />
        <div className="border-t rule" />
      </div>
    </section>
  );
}

function ThresholdSection() {
  const [tau, setTau] = useState(evaluation.tau);
  return (
    <section className="gutter py-[14vh] border-t rule">
      <div className="grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-5">
          <Label index={4}>Match threshold</Label>
          <SplitLines as="h2" lines={["Move τ,", "see the cost."]} className="h-sec mt-5" />
          <Reveal delay={0.1}>
            <p className="lead mt-8">
              On {evaluation.n_vehicles} synthetic vehicles, a lower τ matches a few more true vehicles but lets in false matches.
              PRISM ships with τ = {evaluation.tau.toFixed(2)}, and the investigator can move it live; only the matcher reruns.
            </p>
          </Reveal>
        </div>
        <Reveal className="lg:col-span-7" delay={0.15}>
          <TauChart sweep={evaluation.tau_sweep} tau={tau} onTau={setTau} defaultTau={evaluation.tau} />
          <div className="flex gap-6 tag mt-6">
            <span className="flex items-center gap-2"><i className="inline-block w-4 h-[2px] bg-[var(--ink)]" />correct vehicle MATCHED</span>
            <span className="flex items-center gap-2"><i className="inline-block w-4 h-[2px] bg-[var(--red)]" />false match</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Work() {
  const picks = CASES.slice(0, 4);
  return (
    <section className="gutter py-[14vh] border-t rule">
      <SectionHead index={5} label="Cases" title={["Real runs on", "the demo clips."]}
        aside="Every image, plate and score below is unedited PRISM output, with its PDF report." />
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-16 mt-14">
        {picks.map((c, i) => (
          <div key={c.id} className={i % 2 ? "md:mt-[18vh]" : ""}>
            <Parallax offset={i % 2 ? 40 : 0}><CaseCard c={c} /></Parallax>
          </div>
        ))}
      </div>
      <Reveal className="mt-16 flex justify-center"><Pill to="/cases" ghost>All {CASES.length} cases</Pill></Reveal>
    </section>
  );
}
