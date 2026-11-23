import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useScroll, useTransform } from "framer-motion";
import { Counter, EASE_REVEAL, Label, Magnetic, Marquee, Reveal, SplitLines } from "../motion.jsx";
import { Arrow, Plate, StatusChip, TauChart } from "../components.jsx";
import { CrossCamStory, FusionDemo } from "../demos.jsx";
import { HighwayFeed, LiquidWord, RollLink, TiltCard, useClock, useDirFill, useHealth } from "../fx.jsx";
import { BUILT_ON, CASES, caseById, evaluation, FEATURES, MARQUEE, QUOTES, STAGES } from "../data/content.js";
import { useSite } from "../Layout.jsx";

export default function Landing() {
  return (
    <>
      <Hero />
      <Work />
      <Lede />
      <Stats />
      <section className="gutter py-[14vh]">
        <Head label="Try the fusion" title="Lower the bar and it lies." aside="Drag the threshold. These are PRISM's real masking and fusion functions re-run on the 24 reads from the night clip." />
        <div className="mt-14"><FusionDemo /></div>
      </section>
      <Pipeline />
      <Marquee items={MARQUEE} speed={40} />
      <CasesPeek />
      <CrossCamStory />
      <Threshold />
      <BuiltOn />
      <Quotes />
      <Contact />
    </>
  );
}

function Head({ label, title, aside, link }) {
  return (
    <div className="grid md:grid-cols-12 gap-6 items-end">
      <div className="md:col-span-8">
        <Reveal><Label>{label}</Label></Reveal>
        <SplitLines as="h2" lines={[title]} className="h-sec mt-5" />
      </div>
      <div className="md:col-span-4 md:text-right">
        {aside && <Reveal delay={0.1}><p className="text-muted text-[16px] leading-relaxed">{aside}</p></Reveal>}
        {link && <Reveal delay={0.15} className="mt-4">{link}</Reveal>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hero */
function Hero() {
  const { introReveal } = useSite();
  const d = 0.25;
  const clock = useClock();
  const health = useHealth();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 700], [0, -90]);
  const fade = useTransform(scrollY, [0, 500], [1, 0.2]);
  const rise = (i) => ({ initial: { y: "110%" }, animate: { y: "0%" }, transition: { duration: 1.1, ease: EASE_REVEAL, delay: d + i * 0.09 } });
  const fadeUp = (delay) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay: d + delay, duration: 0.9, ease: EASE_REVEAL } });
  return (
    <section className="hero" id="hero">
      <div className="hero__inner">
        <HighwayFeed zone={[0, 0.12, 1, 0.94]} avoid=".hero .hero__copy, .hero .atf__meta" />
        <div className="hero__scrim" aria-hidden />
        {introReveal && (
        <motion.div className="atf" style={{ y, opacity: fade }}>
          <div className="hero__copy">
            <motion.div className="hero__kicker" {...fadeUp(0)}><span className="rec" />REC · CAM 04 · {clock}</motion.div>
            <h1 className="hero__h">
              <span className="hero__line"><motion.span className="inline-block" {...rise(1)}>Every frame read.</motion.span></span>
              <span className="hero__line"><motion.span className="inline-block hero__h2" {...rise(2)}>Nothing guessed.</motion.span></span>
            </h1>
            <motion.p className="hero__sub" {...fadeUp(0.45)}>
              PRISM reads number plates from blurry CCTV by fusing every frame of a clip. A character it cannot see stays <b>?</b>,
              and the registry match says why.
            </motion.p>
            <motion.div className="hero__cta" {...fadeUp(0.6)}>
              <Magnetic><a href="/app" className="btn-pill btn-pill--red">Open the investigator <Arrow /></a></Magnetic>
              <Magnetic><Link to="/how-it-works" className="btn-pill btn-pill--ghost">How it works <Arrow /></Link></Magnetic>
            </motion.div>
          </div>
          <motion.div className="atf__meta" {...fadeUp(0.8)}>
            <div className="hidden md:block">Point at a car to track it</div>
            <div>
              <span className={`dot ${health ? "dot--live" : ""}`} />
              {health ? `Running on ${health.device === "cuda" ? "GPU" : "CPU"} · registry ${health.registry_size}` : "Open source · runs locally"}
            </div>
          </motion.div>
        </motion.div>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- feature scroll cards */
function Work() {
  return (
    <section className="relative z-[2]">
      <div className="work__head">
        <SplitLines as="h2" lines={["Features"]} className="h-big" />
        <RollLink to="/how-it-works">How it works</RollLink>
      </div>
      <div className="feats">
        {FEATURES.map((f, i) => (
          <div key={f.id} className="feat">
            <div className="feat__cap">
              <div className="feat__cap-in">
                <div className="feat__idx">({String(i + 1).padStart(2, "0")})</div>
                <div>{f.title}</div>
                <div className="feat__kind">{f.kind}</div>
              </div>
            </div>
            <TiltCard to={f.to?.startsWith("/app") ? undefined : f.to} href={f.href || (f.to?.startsWith("/app") ? f.to : undefined)} cursor={f.cursor || "View"}>
              <FeatureArt look={f.look} />
            </TiltCard>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeatureArt({ look }) {
  const night = caseById("night_partial_white");
  const cross = caseById("crosscam_night_partial_white__camB_white");
  if (look === "fusion") {
    return (
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #ff0000 0%, #b80000 100%)" }}>
        <div className="absolute left-[10%] top-[15%] w-[42%] flex flex-col gap-[2.4cqw]">
          {night?.plates.map((src, i) => (
            <img key={src} src={src} alt="" className="pixel w-full rounded-[0.6cqw] shadow-2xl"
              style={{ transform: `rotate(${[-3, 2, -1][i]}deg) translateX(${i * 4}%)` }} />
          ))}
        </div>
        <div className="absolute right-[9%] top-1/2 -translate-y-1/2 text-right">
          <div className="mono text-[1.4cqw] text-white/80 mb-[1.2cqw]">FUSED · {night?.reads} READS</div>
          <div className="text-[3.3cqw] [&_.pcell]:bg-black/80 [&_.pcell]:text-white"><Plate text={night?.fused} /></div>
        </div>
      </div>
    );
  }
  if (look === "unknown") {
    return (
      <div className="absolute inset-0 paper on-paper">
        <div className="absolute left-[8%] -bottom-[6%] text-[54cqw] leading-none font-light tracking-[-0.08em] text-[var(--red)]">?</div>
        <div className="absolute right-[9%] top-[18%] w-[48%]">
          <div className="mono text-[1.35cqw] opacity-60">POSITION 9 · BEST READ "8" AT 0.69 &lt; 0.70</div>
          <div className="text-[3.6cqw] mt-[1.6cqw]"><Plate text={night?.fused} /></div>
          <p className="text-[2.1cqw] leading-[1.15] tracking-[-0.03em] mt-[3cqw] font-light">A character read below 0.70 confidence becomes <span className="text-[var(--red)]">?</span>. It stays unknown in the plate, the score and the report.</p>
        </div>
      </div>
    );
  }
  if (look === "shortlist" || look === "evidence") {
    const src = look === "shortlist" ? "/media/app_shortlist.jpg" : "/media/app_evidence.jpg";
    const bg = look === "shortlist" ? "linear-gradient(160deg, #f6efed, #e9dcd8)" : "linear-gradient(160deg, #ffb3b3, #e5524a)";
    return (
      <div className="absolute inset-0" style={{ background: bg }}>
        <div className="absolute left-[11%] right-[11%] top-[13%] rounded-[1cqw] overflow-hidden shadow-[0_3cqw_6cqw_-2cqw_rgba(0,0,0,.6)] bg-white">
          <div className="h-[2.4cqw] bg-[#e9e2df] flex items-center gap-[0.7cqw] px-[1.2cqw]">
            {[0, 1, 2].map((i) => <span key={i} className="w-[0.9cqw] h-[0.9cqw] rounded-full bg-black/20" />)}
            <span className="mono text-[1cqw] text-black/50 ml-[1.5cqw]">127.0.0.1:8000/app</span>
          </div>
          <img src={src} alt="" className="w-full block" />
        </div>
      </div>
    );
  }
  if (look === "crosscam" && cross?.crosscam) {
    const x = cross.crosscam;
    return (
      <div className="absolute inset-0" style={{ background: "radial-gradient(56% 156% at 47.1% 1.9%, #45e0ea 0%, #1497ac 100%)" }}>
        <div className="absolute left-[9%] right-[9%] top-[12%] grid grid-cols-2 gap-[2.5cqw]">
          {[[night?.best, x.a, "CAM A"], [x.best_b, x.b, "CAM B"]].map(([src, p, k]) => (
            <div key={k}>
              <img src={src} alt="" className="w-full aspect-[16/10] object-cover rounded-[0.8cqw]" />
              <div className="mono text-[1.2cqw] text-black/70 mt-[1cqw]">{k}</div>
              <div className="text-[1.9cqw] mt-[0.4cqw] [&_.pcell]:bg-black/75"><Plate text={p} /></div>
            </div>
          ))}
        </div>
        <div className="absolute left-[9%] bottom-[10%] flex items-center gap-[2cqw]">
          <span className="text-[3cqw] [&_.pcell]:bg-black [&_.pcell]:text-white"><Plate text={x.combined} /></span>
          <span className="mono text-[1.3cqw] text-black/80">{x.before} → {x.after}</span>
        </div>
      </div>
    );
  }
  if (look === "night") {
    return (
      <div className="absolute inset-0 bg-black">
        <img src={night?.best} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(15,0,0,.92) 0%, rgba(15,0,0,.2) 60%, rgba(255,0,0,.25) 100%)" }} />
        <div className="absolute left-[9%] top-1/2 -translate-y-1/2">
          <div className="mono text-[1.35cqw] text-white/70">LOW LIGHT DETECTED</div>
          <div className="text-[6.5cqw] font-light tracking-[-0.05em] leading-[0.9] mt-[1cqw]">plate 0.75<br />colour 0.10</div>
          <div className="mono text-[1.25cqw] text-white/60 mt-[2cqw]">MATCH WEIGHTS SHIFT TO THE PLATE AT NIGHT</div>
        </div>
      </div>
    );
  }
  if (look === "report") {
    return (
      <div className="absolute inset-0" style={{ background: "#e9e2df" }}>
        <img src="/media/report_page.jpg" alt="" className="absolute left-[30%] top-[8%] w-[40%] rounded-[0.4cqw] shadow-[0_3cqw_5cqw_-1.5cqw_rgba(15,0,0,.45)] rotate-[-4deg]" />
        <div className="absolute left-[8%] bottom-[11%] text-[#0f0000]">
          <div className="mono text-[1.25cqw] opacity-60">SHA-256 · CLIP</div>
          <div className="mono text-[1.35cqw] mt-[0.4cqw] max-w-[24cqw] break-all">{night?.clip_sha256}</div>
        </div>
        <div className="absolute right-[8%] bottom-[11%] flex flex-col items-end gap-[0.8cqw]">
          {["config hash", "registry hash", "model versions"].map((t) => (
            <span key={t} className="mono text-[1.2cqw] rounded-full border border-black/30 px-[1.2cqw] py-[0.4cqw] text-black/80">{t}</span>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

/* ---------------------------------------------------------------- lede */
function Lede() {
  const words = "is a plate reader for investigators. It reads every frame, keeps only what it saw clearly, and marks the rest ? so you can tell evidence from a lead.".split(" ");
  const ref = React.useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 50%"] });
  return (
    <section className="gutter py-[16vh]" ref={ref}>
      <Reveal><Label>About PRISM</Label></Reveal>
      <p className="lede mt-10 max-w-[19em]">
        <LiquidWord>PRISM</LiquidWord>
        <span className="face"><img src="/media/night_partial_white_plate1.png" alt="" className="pixel" /></span>{" "}
        {words.map((w, i) => (
          <LedeWord key={i} w={w} i={i} n={words.length} p={scrollYProgress} />
        ))}
      </p>
      <Reveal className="mt-12"><RollLink to="/about">More about PRISM</RollLink></Reveal>
    </section>
  );
}

function LedeWord({ w, i, n, p }) {
  const opacity = useTransform(p, [i / n, (i + 1) / n], [0.18, 1]);
  return (
    <motion.span style={{ opacity }} className="inline">
      <LiquidWord color={w === "?" ? "var(--ink)" : undefined} className={w === "?" ? "!text-[var(--red)]" : ""}>{w}</LiquidWord>{" "}
    </motion.span>
  );
}

/* ---------------------------------------------------------------- stats */
function Stats() {
  const s = evaluation.clip_summary;
  const n = evaluation.clips.length;
  const items = [
    { v: s.wrong_matched, d: 0, suffix: "", k: `Clips MATCHED to the wrong vehicle, of ${n}` },
    { v: s.committed_char_error * 100, d: 1, suffix: "%", k: "Committed characters that were wrong" },
    { v: s.top5 * 100, d: 1, suffix: "%", k: "True vehicle in the top-5 shortlist" },
    { v: s.mean_seconds, d: 1, suffix: "s", k: `Mean time per clip on ${evaluation.device === "cuda" ? "an RTX 5050 GPU" : "CPU"}` },
  ];
  return (
    <section className="gutter pb-[14vh]">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-12">
        {items.map((it, i) => (
          <Reveal key={i} delay={i * 0.08} className="border-t rule pt-5">
            <div className="text-[clamp(3.25rem,7vw,7rem)] leading-none tracking-[-0.06em] font-light tabular-nums">
              <Counter value={it.v} decimals={it.d} suffix={it.suffix} />
            </div>
            <p className="text-muted text-[15px] mt-4 max-w-[24ch]">{it.k}</p>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-10"><RollLink to="/evaluation">Full evaluation</RollLink></Reveal>
    </section>
  );
}

/* ---------------------------------------------------------------- pipeline (experience-style rows) */
function Pipeline() {
  return (
    <section className="gutter py-[14vh]">
      <Head label="Pipeline" title="Eight stages, one evidence chain." link={<RollLink to="/how-it-works">All stages</RollLink>} />
      <div className="mt-14">
        {STAGES.map((s, i) => (
          <Reveal key={s.n} delay={(i % 4) * 0.05} className="xp__row">
            <Link to="/how-it-works" className="xp__main group">
              <span className="xp__tile"><img src={s.img} alt="" className={s.pixel ? "pixel" : ""} /></span>
              <span>
                <span className="xp__company block transition-transform duration-500 group-hover:translate-x-2">{s.name}</span>
                <span className="xp__role block">{s.short}</span>
              </span>
              <span className="xp__years">Stage {s.n}</span>
            </Link>
          </Reveal>
        ))}
        <div className="border-t rule" />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- cases: sticky peek + list */
function CasesPeek() {
  const [active, setActive] = useState(0);
  return (
    <section className="gutter py-[14vh]">
      <Head label="Cases" title="Real runs on the demo clips." link={<RollLink to="/cases">All cases</RollLink>} />
      <div className="peek">
        <div className="peek__frame">
          <AnimatePresence initial={false}>
            <motion.img key={CASES[active].best} src={CASES[active].best} alt=""
              initial={{ clipPath: "inset(100% 0% 0% 0%)", scale: 1.15 }} animate={{ clipPath: "inset(0% 0% 0% 0%)", scale: 1 }}
              exit={{ opacity: 0, transition: { delay: 0.5, duration: 0.2 } }} transition={{ duration: 0.75, ease: EASE_REVEAL }} />
          </AnimatePresence>
          <div className="absolute left-3 bottom-3 rounded-md bg-black/60 backdrop-blur px-2 py-1 text-[18px] z-[2]"><Plate text={CASES[active].fused} /></div>
        </div>
        <div className="peek__list">
          {CASES.map((c, i) => <PeekRow key={c.id} c={c} i={i} onHover={() => setActive(i)} />)}
          <div className="border-t rule" />
        </div>
      </div>
    </section>
  );
}

function PeekRow({ c, i, onHover }) {
  const { hot, controls, handlers } = useDirFill();
  return (
    <Reveal delay={(i % 4) * 0.05}>
      <Link to={`/cases/${c.id}`} className={`peek__a ${hot ? "is-hot" : ""}`} data-cursor="View"
        onMouseEnter={(e) => { handlers.onMouseEnter(e); onHover(); }} onMouseLeave={handlers.onMouseLeave}>
        <motion.span className="peek__fill" initial={{ clipPath: "inset(0% 100% 0% 0%)" }} animate={controls} />
        <span className="peek__date">({String(c.index).padStart(2, "0")})</span>
        <span>
          <span className="peek__title block">{c.title}</span>
          <span className="peek__ex block">{c.blurb}</span>
        </span>
        <span className="peek__meta">
          <StatusChip status={c.status} />
          <span>{c.clip}</span>
        </span>
      </Link>
    </Reveal>
  );
}

/* ---------------------------------------------------------------- threshold */
function Threshold() {
  const [tau, setTau] = useState(evaluation.tau);
  return (
    <section className="gutter py-[14vh]">
      <div className="grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-5">
          <Label>Match threshold</Label>
          <SplitLines as="h2" lines={["Move τ,", "see the cost."]} className="h-sec mt-5" />
          <Reveal delay={0.1}>
            <p className="lead mt-8">On {evaluation.n_vehicles} synthetic vehicles, a lower τ matches a few more true vehicles but lets in false matches.
              PRISM ships with τ = {evaluation.tau.toFixed(2)}, and the investigator can move it live.</p>
          </Reveal>
        </div>
        <Reveal className="lg:col-span-7" delay={0.15}>
          <TauChart sweep={evaluation.tau_sweep} tau={tau} onTau={setTau} defaultTau={evaluation.tau} />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- built on (cells light up) */
function BuiltOn() {
  return (
    <section className="gutter py-[14vh]">
      <div className="grid md:grid-cols-12 gap-6 items-end">
        <SplitLines as="h2" lines={["Built on"]} className="h-big md:col-span-8" />
        <Reveal className="md:col-span-4 md:text-right"><p className="text-muted text-[16px]">Open research models, wrapped read-only. Their versions and commits are recorded in every report.</p></Reveal>
      </div>
      <ul className="cl mt-[9vh]">
        {BUILT_ON.map((b, i) => (
          <motion.li key={b.name} className="cl__cell" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.05, duration: 0.6 }}>
            <a href={b.url} target="_blank" rel="noreferrer" className="cl__in" style={{ "--lit": b.lit, "--on": b.on }}>
              <span className="cl__mark">{b.name}</span>
              <svg className="cl__arr" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M3 11L11 3M11 3H4.5M11 3V9.5" stroke="currentColor" strokeWidth="1.4" /></svg>
              <span className="cl__cap"><span>{b.role}</span></span>
            </a>
          </motion.li>
        ))}
        <li className="cl__cell cl__cell--ask">
          <a href="/app" className="cl__in">
            <span className="text-center"><span className="block text-[clamp(17px,1.45vw,22px)] tracking-[-0.02em]">Your footage here.</span>
              <span className="inline-flex items-center gap-2 mt-2 text-[15px]">Open a case <Arrow /></span></span>
          </a>
        </li>
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- quotes (PRISM's own words) */
function Quotes() {
  const items = QUOTES.map((q) => ({ ...q, text: (caseById(q.id)?.[q.field] || "").replace(/`/g, "").replace(/\s*\[[A-Z0-9, -]+\]/g, "") })).filter((q) => q.text);
  const [i, setI] = useState(0);
  const q = items[i];
  if (!q) return null;
  const short = q.text.length > 260 ? q.text.slice(0, q.text.indexOf(".", 180) + 1 || 260) : q.text;
  return (
    <section className="rv">
      <div className="rv__bg" />
      <div className="gutter grid md:grid-cols-12 gap-6">
        <div className="md:col-span-12"><SplitLines as="h2" lines={["In its own words"]} className="h-big" /></div>
        <div className="md:col-span-9 md:col-start-4 mt-[7vh]">
          <span className="rv__mark" aria-hidden>“</span>
          <AnimatePresence mode="wait">
            <motion.figure key={i} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.6, ease: EASE_REVEAL }}>
              <blockquote className="rv__quote">{short}</blockquote>
              <figcaption className="rv__who"><span className="rv__dash" />{q.who}<span className="rv__role">{q.role}</span></figcaption>
              <Link to={`/cases/${q.id}`} className="inline-flex items-center gap-2 mt-3 ml-[46px] text-[17px] font-bold f-u">Open the case <Arrow /></Link>
            </motion.figure>
          </AnimatePresence>
          <div className="flex items-center gap-5 mt-12">
            <button className="rv__btn" aria-label="Previous" onClick={() => setI((i - 1 + items.length) % items.length)}>←</button>
            <span className="tag tabular-nums">{String(i + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}</span>
            <button className="rv__btn" aria-label="Next" onClick={() => setI((i + 1) % items.length)}>→</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- contact */
function Contact() {
  return (
    <section className="gutter pt-[22vh] pb-[6vh]">
      <Reveal><Label>Get started</Label></Reveal>
      <div className="mt-8">
        <a href="/app" className="contact__big f-u"><SplitLines as="span" lines={["Open a case ↗"]} /></a>
      </div>
      <Reveal className="mt-[5vh] flex flex-wrap gap-3">
        <Magnetic><a href="/app" className="btn-pill btn-pill--red">Upload a clip <Arrow /></a></Magnetic>
        <Magnetic><Link to="/docs" className="btn-pill btn-pill--ghost">Run it yourself <Arrow /></Link></Magnetic>
      </Reveal>
    </section>
  );
}
