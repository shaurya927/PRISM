import React from "react";
import { ImageReveal, Label, Reveal } from "../motion.jsx";
import { NextLink, PageHero, SectionHead, Tabs } from "../components.jsx";
import { CrossCamCompare, FusionDemo, StatusTriplet } from "../demos.jsx";
import { STAGES } from "../data/content.js";

const VOTE = [
  ["Evidence per character", "W_k(a) = Σ_t I(c_tk = a) · p_tk · min(S_t / 100, 2)", "Each frame's vote for character a at position k is its OCR confidence times a sharpness weight, capped at 2."],
  ["Two conditions", "W_k(a*) ≥ 0.9   and   W_k(a*) / Σ_a W_k(a) ≥ 0.60", "The winner needs enough absolute evidence and a clear majority. Split votes such as 8 vs B leave a ?."],
  ["Consistency", "confident reads of a* / reads covering k ≥ 0.40", "Added after a night test where a half-hidden 2 was read as 8 at 0.85 in 4 of 24 reads."],
];

const WEIGHTS = [
  ["Plate", "0.65", "0.75 in low light"],
  ["Colour", "0.20", "0.10 in low light; half credit for adjacent shades"],
  ["Body type", "0.15", "car, SUV, two-wheeler, auto, truck, bus"],
  ["Make / model", "+0.05", "bonus only; cannot lift a candidate over τ"],
];

function Pipeline() {
  return (
    <>
      <div>
        {STAGES.map((s) => (
          <Reveal key={s.n} className="grid md:grid-cols-12 gap-x-8 gap-y-4 py-8 border-t rule">
            <div className="md:col-span-3">
              <span className="tag">Stage {s.n}</span>
              <h2 className="row-title mt-2">{s.name}</h2>
              <p className="label-mono mt-2">{s.short}</p>
            </div>
            <p className="md:col-span-6 text-[16px] leading-relaxed text-[var(--muted-2)]">{s.body}</p>
            <div className="md:col-span-3">
              <div className={`card-media ${s.pixel ? "aspect-[3/1]" : "aspect-[16/10]"}`}>
                <ImageReveal src={s.img} alt={`${s.name} output`} className="absolute inset-0" pixel={s.pixel}
                  imgClassName={s.img.includes("strip") ? "!object-contain bg-white" : ""} />
              </div>
            </div>
          </Reveal>
        ))}
        <div className="border-t rule" />
      </div>
      <Reveal className="panel p-6 md:p-8 mt-10 grid md:grid-cols-12 gap-6">
        <div className="md:col-span-4">
          <Label>Super-resolution</Label>
          <h2 className="row-title mt-2">For eyes only</h2>
        </div>
        <p className="md:col-span-8 text-[16px] leading-relaxed text-[var(--muted-2)]">
          An upscaled plate (lpsr-lacd) helps a person look at a crop, but upscalers can draw characters that were
          never there. PRISM saves the super-resolved image after OCR has finished and never reads it back. The
          OCR entry point rejects super-resolved images by type and by file name, and a test checks it.
        </p>
      </Reveal>
    </>
  );
}

function Fusion() {
  return (
    <>
      <SectionHead label="The vote" title="Evidence, weighted by sharpness" />
      <div className="grid md:grid-cols-3 gap-4 mt-8">
        {VOTE.map(([t, f, d], i) => (
          <Reveal key={t} className="panel p-5" delay={i * 0.07}>
            <div className="tag">{t}</div>
            <div className="mono text-[14px] mt-3 leading-relaxed">{f}</div>
            <p className="text-muted text-[15px] mt-3 leading-relaxed">{d}</p>
          </Reveal>
        ))}
      </div>
      <div className="mt-12"><FusionDemo /></div>
    </>
  );
}

function Scoring() {
  return (
    <>
      <SectionHead label="The score" title="One number, fully itemised"
        aside="Plate similarity tolerates a one-character shift (−0.05) and gives 0.35 credit to confusable pairs 0/O, 1/I, 8/B, 5/S, 2/Z, 6/G, 4/A, scaled by how many characters are known." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8">
        {WEIGHTS.map(([k, v, d], i) => (
          <Reveal key={k} className="border-t rule pt-4" delay={i * 0.07}>
            <div className="tag">{k}</div>
            <div className="stat-num mt-3">{v}</div>
            <p className="text-muted text-[14px] mt-3">{d}</p>
          </Reveal>
        ))}
      </div>
      <div className="mt-12"><StatusTriplet /></div>
    </>
  );
}

function CrossCam() {
  return (
    <>
      <SectionHead label="Cross-camera" title="Two partial views, one full plate"
        aside="Camera A lost one digit and camera B lost the first letter. Linked by appearance plus agreeing plate characters, the combined plate resolves the case." />
      <div className="mt-8"><CrossCamCompare /></div>
    </>
  );
}

const TABS = [
  { id: "pipeline", label: "Pipeline", render: () => <Pipeline /> },
  { id: "fusion", label: "Fusion", render: () => <Fusion /> },
  { id: "scoring", label: "Scoring", render: () => <Scoring /> },
  { id: "crosscam", label: "Cross-camera", render: () => <CrossCam /> },
];

export default function HowItWorks() {
  return (
    <>
      <PageHero index={1} label="How it works" lines={["From pixels", "to a shortlist"]}
        lead="Eight stages turn a clip into a ranked list of registry vehicles. Masking, the format check and fusion can only turn characters into ?, never add them, so the final plate contains nothing the camera did not show." />
      <section className="gutter pb-16 md:pb-20">
        <Tabs id="hiw" label="How it works sections" tabs={TABS} />
      </section>
      <NextLink to="/cases" label="Next" title="See the cases" />
    </>
  );
}
