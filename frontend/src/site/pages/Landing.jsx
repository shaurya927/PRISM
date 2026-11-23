import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Counter, EASE, Label, Marquee, Reveal, SplitLines } from "../motion.jsx";
import { Arrow, Plate, StatusChip, statusLabel, TauChart } from "../components.jsx";
import { CrossCamStory, FusionDemo } from "../demos.jsx";
import { FeatureCard, HighwayFeed, RollLink, useClock, useDirFill, useHealth } from "../fx.jsx";
import { BUILT_ON, CASES, caseById, evaluation, FEATURES, MARQUEE, QUOTES, STAGES } from "../data/content.js";
import { useSite } from "../Layout.jsx";

export default function Landing() {
  return (
    <>
      <Hero />
      <Work />
      <Lede />
      <Stats />
      <section className="gutter py-24">
        <Head label="Try the fusion" title="Lower the bar and it lies" aside="Drag the threshold. These are PRISM's real masking and fusion functions re-run on the 24 reads from the night clip." />
        <div className="mt-12"><FusionDemo /></div>
      </section>
      <Pipeline />
      <Marquee items={MARQUEE} />
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
        <Label>{label}</Label>
        <SplitLines as="h2" lines={[title]} className="h-sec mt-4" />
      </div>
      <div className="md:col-span-4 md:text-right">
        {aside && <p className="text-muted text-[16px] leading-relaxed">{aside}</p>}
        {link && <div className="mt-4">{link}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hero */
function Hero() {
  const { introReveal } = useSite();
  const clock = useClock();
  const health = useHealth();
  return (
    <section className="hero" id="hero">
      <div className="hero__inner">
        <HighwayFeed zone={[0, 0.12, 1, 0.94]} avoid=".hero .hero__copy, .hero .atf__meta" />
        <div className="hero__scrim" aria-hidden />
        {introReveal && (
        <div className="atf">
          <div className="hero__copy">
            <div className="hero__kicker"><span className="rec" />REC · CAM 04 · {clock}</div>
            <h1 className="hero__h">
              <span className="hero__line">Every frame read</span>
              <span className="hero__line hero__h2">Nothing guessed</span>
            </h1>
            <p className="hero__sub">
              PRISM reads number plates from blurry CCTV by fusing every frame of a clip. A character it cannot see stays <b>?</b>,
              and the registry match says why.
            </p>
            <div className="hero__cta">
              <a href="/app" className="btn-pill btn-pill--red">Open the investigator <Arrow /></a>
              <Link to="/how-it-works" className="btn-pill btn-pill--ghost">How it works <Arrow /></Link>
            </div>
          </div>
          <div className="atf__meta">
            <ReadOut />
            <div className="hidden md:block">Point at a car to track it</div>
            <div>
              <span className={`dot ${health ? "dot--live" : ""}`} />
              {health ? `Running on ${health.device === "cuda" ? "GPU" : "CPU"} · registry ${health.registry_size}` : "Open source · runs locally"}
            </div>
          </div>
        </div>
        )}
      </div>
    </section>
  );
}

/** The product moment: PRISM's real result for the night clip, from the raw crops to the fused plate. */
function ReadOut() {
  const c = caseById("night_partial_white");
  if (!c) return null;
  const unknown = (c.fused || "").split("").filter((ch) => ch === "?").length;
  return (
    <Link to={`/cases/${c.id}`} className="readout" aria-label={`Open the case: ${c.title}`}>
      <div className="readout__head">
        <span>{c.clip}</span>
        <StatusChip status={c.status} />
      </div>
      <div className="readout__crops">
        {c.plates.map((src) => <img key={src} src={src} alt="" className="pixel" />)}
      </div>
      <div className="readout__plate"><Plate text={c.fused} /></div>
      <div className="readout__foot">
        <span>Fused from {c.reads} reads · {unknown} unknown</span>
        <span className="readout__open">Open the case <Arrow /></span>
      </div>
    </Link>
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
            <FeatureCard to={f.to?.startsWith("/app") ? undefined : f.to} href={f.href || (f.to?.startsWith("/app") ? f.to : undefined)} label={`${f.title}: ${f.cursor || "View"}`}>
              <FeatureArt look={f.look} />
            </FeatureCard>
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
      <div className="feat-art feat-art--dark">
        <div className="absolute left-[10%] top-[15%] w-[42%] flex flex-col gap-[2.4cqw]">
          {night?.plates.map((src, i) => (
            <img key={src} src={src} alt="" className="pixel w-full rounded-[0.6cqw] shadow-[0_1cqw_2.4cqw_rgba(0,0,0,.45)]"
              style={{ transform: `rotate(${[-3, 2, -1][i]}deg) translateX(${i * 4}%)` }} />
          ))}
        </div>
        <div className="absolute right-[9%] top-1/2 -translate-y-1/2 text-right">
          <div className="mono text-[1.4cqw] text-[var(--muted)] mb-[1.2cqw]">Fused · {night?.reads} reads</div>
          <div className="text-[3.3cqw]"><Plate text={night?.fused} /></div>
        </div>
      </div>
    );
  }
  if (look === "unknown") {
    return (
      <div className="feat-art feat-art--paper on-paper">
        <div className="absolute left-[8%] -bottom-[6%] text-[54cqw] leading-none font-normal tracking-[-0.02em] text-[var(--red)]">?</div>
        <div className="absolute right-[9%] top-[18%] w-[48%]">
          <div className="mono text-[1.35cqw] opacity-60">Position 9 · best read "8" at 0.69 &lt; 0.70</div>
          <div className="text-[3.6cqw] mt-[1.6cqw]"><Plate text={night?.fused} /></div>
          <p className="text-[2.1cqw] leading-[1.2] tracking-[-0.015em] mt-[3cqw]">A character read below 0.70 confidence becomes <span className="text-[var(--red)]">?</span>. It stays unknown in the plate, the score and the report.</p>
        </div>
      </div>
    );
  }
  if (look === "shortlist" || look === "evidence") {
    const src = look === "shortlist" ? "/media/app_shortlist.jpg" : "/media/app_evidence.jpg";
    const tone = look === "shortlist" ? "feat-art--raised" : "feat-art--paper";
    return (
      <div className={`feat-art ${tone}`}>
        <div className="absolute left-[11%] right-[11%] top-[13%] rounded-[1cqw] overflow-hidden shadow-[0_2cqw_4cqw_-1.5cqw_rgba(0,0,0,.45)] bg-white">
          <div className="h-[2.4cqw] bg-[#e7e5e0] flex items-center gap-[0.7cqw] px-[1.2cqw]">
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
      <div className="feat-art feat-art--dark">
        <div className="absolute left-[9%] right-[9%] top-[12%] grid grid-cols-2 gap-[2.5cqw]">
          {[[night?.best, x.a, "Camera A"], [x.best_b, x.b, "Camera B"]].map(([src, p, k]) => (
            <div key={k}>
              <img src={src} alt="" className="w-full aspect-[16/10] object-cover rounded-[0.8cqw]" />
              <div className="mono text-[1.2cqw] text-[var(--muted)] mt-[1cqw]">{k}</div>
              <div className="text-[1.9cqw] mt-[0.4cqw]"><Plate text={p} /></div>
            </div>
          ))}
        </div>
        <div className="absolute left-[9%] bottom-[10%] flex items-center gap-[2cqw]">
          <span className="text-[3cqw]"><Plate text={x.combined} /></span>
          <span className="mono text-[1.3cqw] text-[var(--muted-2)]">{statusLabel(x.before)} → {statusLabel(x.after)}</span>
        </div>
      </div>
    );
  }
  if (look === "night") {
    return (
      <div className="feat-art bg-black">
        <img src={night?.best} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgb(11 12 15 / .92) 0%, rgb(11 12 15 / .2) 60%, rgb(11 12 15 / .1) 100%)" }} />
        <div className="absolute left-[9%] top-1/2 -translate-y-1/2">
          <div className="mono text-[1.35cqw] text-white/70">Low light detected</div>
          <div className="text-[6.5cqw] font-normal tracking-[-0.03em] leading-[0.95] mt-[1cqw] tabular-nums">plate 0.75<br />colour 0.10</div>
          <div className="mono text-[1.25cqw] text-white/60 mt-[2cqw]">Match weights shift to the plate at night</div>
        </div>
      </div>
    );
  }
  if (look === "report") {
    return (
      <div className="feat-art feat-art--paper">
        <img src="/media/report_page.jpg" alt="" className="absolute left-[30%] top-[8%] w-[40%] rounded-[0.4cqw] shadow-[0_2cqw_4cqw_-1.5cqw_rgba(0,0,0,.3)] rotate-[-4deg]" />
        <div className="absolute left-[8%] bottom-[11%]">
          <div className="mono text-[1.25cqw] opacity-60">SHA-256 · clip</div>
          <div className="mono text-[1.35cqw] mt-[0.4cqw] max-w-[24cqw] break-all">{night?.clip_sha256}</div>
        </div>
        <div className="absolute right-[8%] bottom-[11%] flex flex-col items-end gap-[0.8cqw]">
          {["config hash", "registry hash", "model versions"].map((t) => (
            <span key={t} className="mono text-[1.2cqw] rounded-[0.5cqw] border border-black/20 px-[1cqw] py-[0.4cqw] text-black/70">{t}</span>
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
  return (
    <section className="gutter py-24">
      <Label>About PRISM</Label>
      <p className="lede mt-12 max-w-[19em]">
        <span>PRISM</span>
        <span className="face"><img src="/media/night_partial_white_plate1.png" alt="" className="pixel" /></span>{" "}
        {words.map((w, i) => (
          <React.Fragment key={i}><span className={w === "?" ? "text-[var(--red)]" : undefined}>{w}</span>{" "}</React.Fragment>
        ))}
      </p>
      <div className="mt-12"><RollLink to="/about">More about PRISM</RollLink></div>
    </section>
  );
}
/* ---------------------------------------------------------------- stats */
function Stats() {
  const s = evaluation.clip_summary;
  const n = evaluation.clips.length;
  const items = [
    { v: s.wrong_matched, d: 0, suffix: "", k: `Clips matched to the wrong vehicle, of ${n}` },
    { v: s.committed_char_error * 100, d: 1, suffix: "%", k: `Committed characters that were wrong, over ${n} clips` },
    { v: s.top5 * 100, d: 1, suffix: "%", k: `True vehicle in the top-5 shortlist, over ${n} clips` },
    { v: s.mean_seconds, d: 1, suffix: "s", k: `Mean time per clip on ${evaluation.device === "cuda" ? "an RTX 5050 GPU" : "CPU"}` },
  ];
  return (
    <section className="gutter pb-24">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-12">
        {items.map((it, i) => (
          <Reveal key={i} className="border-t rule pt-6">
            <div className="text-[clamp(3.25rem,6.4vw,6.25rem)] leading-none tracking-[-0.02em] font-normal tabular-nums">
              <Counter value={it.v} decimals={it.d} suffix={it.suffix} />
            </div>
            <p className="text-muted text-[15px] mt-4 max-w-[24ch]">{it.k}</p>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-12"><RollLink to="/evaluation">Full evaluation</RollLink></Reveal>
    </section>
  );
}

/* ---------------------------------------------------------------- pipeline (experience-style rows) */
function Pipeline() {
  return (
    <section className="gutter py-24">
      <Head label="Pipeline" title="Eight stages, one evidence chain" link={<RollLink to="/how-it-works">All stages</RollLink>} />
      <div className="mt-12">
        {STAGES.map((s) => (
          <Reveal key={s.n} className="xp__row">
            <Link to="/how-it-works" className="xp__main group">
              <span className="xp__tile"><img src={s.img} alt="" className={s.pixel ? "pixel" : ""} /></span>
              <span>
                <span className="xp__company block">{s.name}</span>
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
    <section className="gutter py-24">
      <Head label="Cases" title="Real runs on the demo clips" link={<RollLink to="/cases">All cases</RollLink>} />
      <div className="peek">
        <div className="peek__frame">
          <AnimatePresence initial={false}>
            <motion.img key={CASES[active].best} src={CASES[active].best} alt=""
              initial={{ clipPath: "inset(100% 0% 0% 0%)" }} animate={{ clipPath: "inset(0% 0% 0% 0%)" }}
              exit={{ opacity: 0, transition: { delay: 0.4, duration: 0.2 } }} transition={{ duration: 0.5, ease: EASE }} />
          </AnimatePresence>
          <div className="absolute left-4 bottom-4 rounded-lg bg-black/70 px-2 py-1 text-[18px] z-[2]"><Plate text={CASES[active].fused} /></div>
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
    <Reveal>
      <Link to={`/cases/${c.id}`} className={`peek__a ${hot ? "is-hot" : ""}`}
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
    <section className="gutter py-24">
      <div className="grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-5">
          <Label>Match threshold</Label>
          <SplitLines as="h2" lines={["Move τ,", "see the cost"]} className="h-sec mt-4" />
          <Reveal>
            <p className="lead mt-8">On {evaluation.n_vehicles} synthetic vehicles, a lower τ matches a few more true vehicles but lets in false matches.
              PRISM ships with τ = {evaluation.tau.toFixed(2)}, and the investigator can move it live.</p>
          </Reveal>
        </div>
        <Reveal className="lg:col-span-7">
          <TauChart sweep={evaluation.tau_sweep} tau={tau} onTau={setTau} defaultTau={evaluation.tau} />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- built on (cells light up) */
function BuiltOn() {
  return (
    <section className="gutter py-24">
      <div className="grid md:grid-cols-12 gap-6 items-end">
        <SplitLines as="h2" lines={["Built on"]} className="h-big md:col-span-8" />
        <Reveal className="md:col-span-4 md:text-right"><p className="text-muted text-[16px]">Open research models, wrapped read-only. Their versions and commits are recorded in every report.</p></Reveal>
      </div>
      <ul className="cl mt-16">
        {BUILT_ON.map((b) => (
          <li key={b.name} className="cl__cell">
            <a href={b.url} target="_blank" rel="noreferrer" className="cl__in">
              <span className="cl__mark">{b.name}</span>
              <svg className="cl__arr" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M3 11L11 3M11 3H4.5M11 3V9.5" stroke="currentColor" strokeWidth="1.4" /></svg>
              <span className="cl__cap"><span>{b.role}</span></span>
            </a>
          </li>
        ))}
        <li className="cl__cell cl__cell--ask">
          <a href="/app" className="cl__in">
            <span className="text-center"><span className="block text-[clamp(17px,1.45vw,22px)] tracking-[-0.01em]">Your footage here</span>
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
      <div className="gutter grid md:grid-cols-12 gap-6">
        <div className="md:col-span-12"><SplitLines as="h2" lines={["In its own words"]} className="h-big" /></div>
        <div className="md:col-span-9 md:col-start-4 mt-12">
          <span className="rv__mark" aria-hidden>“</span>
          <AnimatePresence mode="wait">
            <motion.figure key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }}>
              <blockquote className="rv__quote">{short}</blockquote>
              <figcaption className="rv__who"><span className="rv__dash" />{q.who}<span className="rv__role">{q.role}</span></figcaption>
              <Link to={`/cases/${q.id}`} className="inline-flex items-center gap-2 mt-4 ml-12 text-[16px] font-medium f-u">Open the case <Arrow /></Link>
            </motion.figure>
          </AnimatePresence>
          <div className="flex items-center gap-4 mt-12">
            <button className="rv__btn" aria-label="Previous quote" onClick={() => setI((i - 1 + items.length) % items.length)}><Chevron dir="left" /></button>
            <span className="tag tabular-nums">{String(i + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}</span>
            <button className="rv__btn" aria-label="Next quote" onClick={() => setI((i + 1) % items.length)}><Chevron dir="right" /></button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- contact */
function Contact() {
  return (
    <section className="gutter pt-24 pb-16">
      <Label>Get started</Label>
      <div className="mt-8">
        <a href="/app" className="contact__big f-u"><SplitLines as="span" lines={[<>Open a case<Arrow /></>]} /></a>
      </div>
      <Reveal className="mt-12 flex flex-wrap gap-3">
        <a href="/app" className="btn-pill btn-pill--red">Upload a clip <Arrow /></a>
        <Link to="/docs" className="btn-pill btn-pill--ghost">Run it yourself <Arrow /></Link>
      </Reveal>
    </section>
  );
}

/** Chevron for the quote slider, same stroke as the other line icons. */
function Chevron({ dir }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden style={dir === "left" ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}