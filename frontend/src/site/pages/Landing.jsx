import React from "react";
import { Link } from "react-router-dom";
import { Counter, Label, Reveal, SplitLines } from "../motion.jsx";
import { Arrow, CaseCard, Plate, StatusChip, Tabs } from "../components.jsx";
import { CrossCamCompare, FusionDemo } from "../demos.jsx";
import { HighwayFeed, RollLink, useClock, useHealth } from "../fx.jsx";
import { CASES, caseById, evaluation, FEATURES, STATUS_INFO } from "../data/content.js";
import { useSite } from "../context.js";

const FEATURED_CASES = ["night_partial_white", "crosscam_night_partial_white__camB_white", "unregistered_white"];

export default function Landing() {
  return (
    <>
      <Hero />
      <Features />
      <Stats />
      <SeeItWork />
      <FeaturedCases />
      <CtaBand />
    </>
  );
}

function Head({ label, title, aside, link }) {
  return (
    <div className="grid md:grid-cols-12 gap-6 items-end">
      <div className="md:col-span-7">
        <Label>{label}</Label>
        <SplitLines as="h2" lines={[title]} className="h-sec mt-3" />
      </div>
      <div className="md:col-span-5 md:text-right">
        {aside && <p className="text-muted text-[15px] leading-relaxed md:ml-auto">{aside}</p>}
        {link && <div className={aside ? "mt-3" : ""}>{link}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hero (the live feed is unchanged) */
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

/* ---------------------------------------------------------------- what PRISM does: 4 tiles */
function Features() {
  return (
    <section className="gutter py-16 md:py-20 relative z-[2]">
      <Head label="What PRISM does" title="Read what is there, mark what is not" link={<RollLink to="/how-it-works">How it works</RollLink>} />
      <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
        {FEATURES.map((f, i) => {
          const inner = (
            <>
              <div className="tile__art" aria-hidden><TileArt art={f.art} /></div>
              <div className="p-5 flex flex-col flex-1">
                <h3 className="row-title">{f.title}</h3>
                <p className="text-muted text-[15px] leading-relaxed mt-2">{f.body}</p>
                <span className="tile__more">{f.more} <Arrow /></span>
              </div>
            </>
          );
          return (
            <Reveal as="li" key={f.id} className="flex" delay={i * 0.07}>
              {f.to.startsWith("/app")
                ? <a href={f.to} className="tile panel w-full">{inner}</a>
                : <Link to={f.to} className="tile panel w-full">{inner}</Link>}
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}

function TileArt({ art }) {
  const night = caseById("night_partial_white");
  const cross = caseById("crosscam_night_partial_white__camB_white")?.crosscam;
  if (art === "fusion") {
    return (
      <div className="flex flex-col items-center gap-3 w-full">
        <div className="grid grid-cols-3 gap-2 w-full max-w-[220px]">
          {night?.plates.map((src) => <img key={src} src={src} alt="" className="pixel w-full aspect-[3/1] object-cover rounded" />)}
        </div>
        <span className="text-[15px]"><Plate text={night?.fused} /></span>
      </div>
    );
  }
  if (art === "unknown") {
    return (
      <div className="flex items-center gap-4">
        <span className="text-[44px]"><Plate text="?" /></span>
        <span className="mono text-[12px] text-muted leading-relaxed">Position 9<br />best read "8" at 0.69<br />below 0.70</span>
      </div>
    );
  }
  if (art === "shortlist") {
    return <img src="/media/app_shortlist.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover object-top opacity-90" />;
  }
  if (art === "crosscam" && cross) {
    return (
      <div className="flex flex-col items-center gap-2 text-[13px]">
        <Plate text={cross.a} />
        <Plate text={cross.b} />
        <span className="text-[15px] mt-1"><Plate text={cross.combined} /></span>
      </div>
    );
  }
  return null;
}

/* ---------------------------------------------------------------- key numbers */
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
    <section className="gutter py-16 md:py-20 border-t rule">
      <Head label="Measured" title="Key numbers" link={<RollLink to="/evaluation">Full evaluation</RollLink>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10 mt-10">
        {items.map((it, i) => (
          <Reveal key={i} className="border-t rule pt-5" delay={i * 0.07}>
            <div className="stat-num"><Counter value={it.v} decimals={it.d} suffix={it.suffix} /></div>
            <p className="text-muted text-[14px] mt-3 max-w-[26ch]">{it.k}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- see it work: one tabbed demo */
function SeeItWork() {
  const tabs = [
    {
      id: "fusion", label: "Fusion",
      render: () => (
        <>
          <p className="text-muted text-[15px] mb-8">Drag the threshold. These are PRISM's real masking and fusion functions re-run on the 24 reads from the night clip.</p>
          <FusionDemo />
          <div className="mt-8"><RollLink to="/how-it-works?tab=fusion">Fusion in detail</RollLink></div>
        </>
      ),
    },
    {
      id: "crosscam", label: "Cross-camera",
      render: () => (
        <>
          <CrossCamCompare />
          <div className="mt-8"><RollLink to="/how-it-works?tab=crosscam">Cross-camera in detail</RollLink></div>
        </>
      ),
    },
    {
      id: "shortlist", label: "Shortlist",
      render: () => (
        <div className="grid lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 card-media border rule">
            <img src="/media/app_shortlist.jpg" alt="The investigator app showing a ranked registry shortlist" loading="lazy" className="w-full block" />
          </div>
          <div className="lg:col-span-5">
            <p className="text-[18px] leading-relaxed">Every registry record gets 0.65 × plate + 0.20 × colour + 0.15 × body, and each part of the score is listed.</p>
            <p className="text-muted text-[15px] leading-relaxed mt-3">The result is one of three outcomes, never a silent guess.</p>
            <dl className="mt-5 space-y-4">
              {Object.entries(STATUS_INFO).map(([status, info]) => (
                <div key={status} className="border-t rule pt-4">
                  <dt><StatusChip status={status} /></dt>
                  <dd className="text-muted text-[14px] leading-relaxed mt-2">{info}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6"><RollLink href="/app">Open the investigator</RollLink></div>
          </div>
        </div>
      ),
    },
  ];
  return (
    <section className="gutter py-16 md:py-20 border-t rule">
      <Head label="See it work" title="Real runs, real numbers" />
      <div className="mt-8"><Tabs id="demo" label="Demos" tabs={tabs} /></div>
    </section>
  );
}

/* ---------------------------------------------------------------- featured cases */
function FeaturedCases() {
  const cases = FEATURED_CASES.map(caseById).filter(Boolean);
  return (
    <section className="gutter py-16 md:py-20 border-t rule">
      <Head label="Cases" title="Real runs on the demo clips" link={<RollLink to="/cases">All {CASES.length} cases</RollLink>} />
      <div className="grid md:grid-cols-3 gap-x-6 gap-y-10 mt-10">
        {cases.map((c, i) => <Reveal key={c.id} delay={i * 0.08}><CaseCard c={c} /></Reveal>)}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- one call to action */
function CtaBand() {
  return (
    <section className="gutter py-16 md:py-20 border-t rule">
      <div className="grid md:grid-cols-12 gap-8 items-end">
        <div className="md:col-span-7">
          <Label>Try it on the demo clips</Label>
          <h2 className="h-sec mt-3">Open a case or upload a clip</h2>
        </div>
        <div className="md:col-span-5 flex flex-wrap md:justify-end gap-3">
          <a href="/app" className="btn-pill btn-pill--red">Open the investigator <Arrow /></a>
          <Link to="/docs" className="btn-pill btn-pill--ghost">Run it yourself <Arrow /></Link>
        </div>
      </div>
    </section>
  );
}
