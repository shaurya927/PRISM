import React from "react";
import { useParams } from "react-router-dom";
import { ImageReveal, Label, Parallax, Reveal, SplitLines } from "../motion.jsx";
import { Bar, BigCTA, NextLink, Pill, Plate, StatusChip } from "../components.jsx";
import { CASES, caseById, STATUS_INFO } from "../data/content.js";
import NotFound from "./NotFound.jsx";

/** Renders `code` spans and [F8, POS-9] evidence citations from PRISM's summaries. */
function RichText({ text }) {
  const parts = text.split(/(`[^`]+`|\[[A-Z0-9, -]+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("`")) return <span key={i} className="mono text-amber">{p.slice(1, -1)}</span>;
        if (/^\[[A-Z0-9, -]+\]$/.test(p)) return <sup key={i} className="mono text-[0.55em] text-muted ml-0.5">{p}</sup>;
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

export default function CaseDetail() {
  const { id } = useParams();
  const c = caseById(id);
  if (!c) return <NotFound />;
  const idx = CASES.findIndex((x) => x.id === id);
  const next = CASES[(idx + 1) % CASES.length];
  const top = c.top || [];
  const maxScore = Math.max(1, ...top.map((t) => t.score));
  const meta = [
    ["Clip", c.mode === "crosscam" ? `${c.clip} + camB_white.mp4` : c.clip],
    ["Mode", c.mode === "crosscam" ? "cross-camera" : "single clip"],
    ["Vehicle", `${c.color} ${c.body}`],
    ["Plate reads", c.reads],
  ];
  return (
    <>
      <section className="gutter pt-[22vh] pb-[8vh]">
        <Reveal><Label index={c.index}>Case</Label></Reveal>
        <SplitLines lines={[c.title]} className="display-2 mt-6 max-w-[14ch]" delay={0.55} />
        <Reveal delay={0.8} className="mt-8 max-w-2xl"><p className="lead">{c.blurb}</p></Reveal>
        <Reveal delay={0.9} className="grid grid-cols-2 md:grid-cols-5 gap-6 mt-14 border-t rule pt-6">
          {meta.map(([k, v]) => (
            <div key={k}><div className="tag">{k}</div><div className="mt-2 text-[15px] break-words">{v}</div></div>
          ))}
          <div><div className="tag">Status</div><div className="mt-2"><StatusChip status={c.status} /></div></div>
        </Reveal>
      </section>

      <section className="gutter">
        <div className="card-media aspect-[16/9] md:aspect-[21/9]">
          <Parallax offset={40} className="absolute inset-[-8%_0]">
            <ImageReveal src={c.best} alt={`${c.title}: sharpest vehicle crop`} className="absolute inset-0" />
          </Parallax>
        </div>
        <div className="tag mt-3">Sharpest vehicle crop chosen by PRISM</div>
      </section>

      <section className="gutter py-[12vh] grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4">
          <Label index={1}>Fused plate</Label>
          <Reveal delay={0.1}><p className="text-muted text-[15px] mt-4 leading-relaxed">Amber cells are positions no frame read with enough confidence. They stay unknown in the plate and in the report.</p></Reveal>
        </div>
        <div className="md:col-span-8">
          <Reveal><div className="text-[clamp(2rem,5.5vw,4.75rem)]"><Plate text={c.fused} /></div></Reveal>
          {!!c.plates?.length && (
            <div className="grid grid-cols-3 gap-3 mt-10">
              {c.plates.map((src, i) => (
                <Reveal key={src} delay={i * 0.08}>
                  <img src={src} alt={`Plate crop ${i + 1}`} className="pixel w-full aspect-[3/1] object-cover rounded-md border rule" />
                  <div className="tag mt-2">Raw plate crop {i + 1}</div>
                </Reveal>
              ))}
            </div>
          )}
          {c.strip && (
            <Reveal className="mt-10">
              <div className="rounded-xl overflow-auto bg-white max-h-[75vh]" data-lenis-prevent><img src={c.strip} alt="Evidence strip: per-position votes" className="w-full" /></div>
              <div className="tag mt-2">Evidence strip: each column is a plate position, each row a read</div>
            </Reveal>
          )}
        </div>
      </section>

      {!!top.length && (
        <section className="gutter py-[12vh] border-t rule">
          <div className="grid md:grid-cols-12 gap-10">
            <div className="md:col-span-4">
              <Label index={2}>Shortlist</Label>
              <SplitLines as="h2" lines={["Top candidates"]} className="h-sec mt-5" />
              <Reveal delay={0.1}><p className="text-muted text-[15px] mt-4 leading-relaxed">{STATUS_INFO[c.status]}</p></Reveal>
            </div>
            <div className="md:col-span-8">
              {top.map((t, i) => (
                <Reveal key={t.id} delay={i * 0.08} className="border-t rule py-6 grid grid-cols-[2.5rem_1fr] gap-4">
                  <span className="tag pt-1">#{i + 1}</span>
                  <div>
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="text-[24px] tracking-[-0.03em] font-medium">{t.id} <span className="text-muted text-[16px] font-normal">· {t.model}</span></span>
                      <span className="text-[24px] tabular-nums tracking-[-0.03em]">{t.score.toFixed(2)}</span>
                    </div>
                    <div className="mt-3 text-[18px]"><Plate text={t.plate} /></div>
                    <div className="mt-4"><Bar value={t.score} max={maxScore} color={i === 0 ? "var(--amber)" : "var(--ink)"} delay={i * 0.1} /></div>
                    <div className="flex flex-wrap gap-2 mt-4">
                      <span className="chip">{t.color}</span>
                      <span className="chip">{t.body}</span>
                      {t.mismatches.map((m) => <span key={m} className="chip chip--warn normal-case">{m}</span>)}
                    </div>
                  </div>
                </Reveal>
              ))}
              <div className="border-t rule" />
            </div>
          </div>
        </section>
      )}

      <section className="gutter py-[12vh] border-t rule grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4"><Label index={3}>Why</Label></div>
        <div className="md:col-span-8 space-y-10">
          {c.explanation && <Reveal><p className="text-[clamp(1.4rem,2.6vw,2.25rem)] leading-[1.2] tracking-[-0.03em]">{c.explanation}</p></Reveal>}
          {c.advisor && (
            <Reveal className="panel p-6 md:p-8 border-[rgb(245_165_36_/_0.35)]">
              <div className="tag text-amber">Next-best-evidence advisor</div>
              <p className="text-[18px] leading-relaxed mt-3"><RichText text={c.advisor} /></p>
            </Reveal>
          )}
          {c.summary && (
            <Reveal>
              <div className="tag">Evidence-checked summary</div>
              <p className="text-[18px] leading-[1.6] mt-3 text-[var(--ink)] opacity-85"><RichText text={c.summary} /></p>
            </Reveal>
          )}
        </div>
      </section>

      {c.crosscam && (
        <section className="gutter py-[12vh] border-t rule">
          <Label index={4}>Cross-camera link</Label>
          <div className="grid md:grid-cols-2 gap-8 mt-10">
            {[["Camera A", c.best, c.crosscam.a], ["Camera B", c.crosscam.best_b, c.crosscam.b]].map(([k, src, plate], i) => (
              <Reveal key={k} delay={i * 0.1}>
                <div className="card-media aspect-[16/10]"><ImageReveal src={src} alt={k} className="absolute inset-0" /></div>
                <div className="tag mt-3">{k}</div>
                <div className="text-[clamp(1rem,2.4vw,2rem)] mt-2"><Plate text={plate} /></div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-12 flex flex-wrap items-center gap-6">
            <span className="tag">Combined</span>
            <span className="text-[clamp(1.5rem,4vw,3.25rem)]"><Plate text={c.crosscam.combined} /></span>
            <StatusChip status={c.crosscam.before} /><span className="text-muted">→</span><StatusChip status={c.crosscam.after} />
            <span className="tag">appearance similarity {c.crosscam.similarity.toFixed(2)}</span>
          </Reveal>
        </section>
      )}

      <section className="gutter py-[12vh] border-t rule grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4"><Label index={c.crosscam ? 5 : 4}>Chain of custody</Label></div>
        <div className="md:col-span-8">
          {c.clip_sha256 && (
            <Reveal>
              <div className="tag">Clip SHA-256</div>
              <div className="mono text-[13px] md:text-[15px] mt-2 break-all">{c.clip_sha256}</div>
            </Reveal>
          )}
          <Reveal delay={0.1} className="flex flex-wrap gap-3 mt-8">
            {c.reports?.pdf && <Pill to={c.reports.pdf}>Download the PDF report</Pill>}
            {c.reports?.html && <Pill to={c.reports.html} ghost>Open the HTML report</Pill>}
          </Reveal>
          <p className="text-muted text-[14px] mt-6">The report also lists hashes of every crop, the registry and the config, plus model and package versions.</p>
        </div>
      </section>

      <NextLink to={`/cases/${next.id}`} label={`Next case (${String(next.index).padStart(2, "0")})`} title={next.title} />
      <BigCTA />
    </>
  );
}
