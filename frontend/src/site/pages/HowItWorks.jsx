import React from "react";
import { ImageReveal, Label, Reveal, SplitLines } from "../motion.jsx";
import { BigCTA, NextLink, PageHero, SectionHead } from "../components.jsx";
import { FusionDemo, StatusTriplet } from "../demos.jsx";
import { STAGES } from "../data/content.js";

export default function HowItWorks() {
  return (
    <>
      <PageHero index={1} label="How it works" lines={["From pixels", "to a shortlist."]}
        lead="Eight stages turn a clip into a ranked list of registry vehicles. Masking, the format check and fusion can only turn characters into ?, never add them, so the final plate contains nothing the camera did not show." />

      <section className="gutter pb-[10vh]">
        {STAGES.map((s, i) => (
          <div key={s.n} className="grid md:grid-cols-12 gap-8 py-[8vh] border-t rule">
            <div className="md:col-span-4">
              <div className="md:sticky md:top-28">
                <Reveal><span className="tag">Stage {s.n}</span></Reveal>
                <SplitLines as="h2" lines={[s.name]} className="h-sec mt-3" />
                <Reveal delay={0.1}><p className="label-mono mt-4">{s.short}</p></Reveal>
              </div>
            </div>
            <div className="md:col-span-7 md:col-start-6">
              <Reveal><p className="text-[clamp(1.15rem,1.7vw,1.5rem)] leading-[1.4] tracking-[-0.015em]">{s.body}</p></Reveal>
              <div className={`card-media mt-8 ${s.pixel ? "aspect-[3/1] max-w-xl" : "aspect-[16/9]"}`}>
                <ImageReveal src={s.img} alt={`${s.name} output`} className="absolute inset-0" pixel={s.pixel}
                  imgClassName={s.img.includes("strip") ? "!object-contain bg-white" : ""} delay={i % 2 ? 0.1 : 0} />
              </div>
            </div>
          </div>
        ))}
        <div className="border-t rule" />
      </section>

      <section className="gutter py-[12vh]">
        <SectionHead index={2} label="The vote" title={["Evidence, weighted", "by sharpness."]} />
        <div className="grid md:grid-cols-3 gap-6 mt-12">
          {[
            ["Evidence per character", "W_k(a) = Σ_t I(c_tk = a) · p_tk · min(S_t / 100, 2)", "Each frame's vote for character a at position k is its OCR confidence times a sharpness weight, capped at 2."],
            ["Two conditions", "W_k(a*) ≥ 0.9   and   W_k(a*) / Σ_a W_k(a) ≥ 0.60", "The winner needs enough absolute evidence and a clear majority. Split votes such as 8 vs B leave a ?."],
            ["Consistency", "confident reads of a* / reads covering k ≥ 0.40", "Added after a night test where a half-hidden 2 was read as 8 at 0.85 in 4 of 24 reads."],
          ].map(([t, f, d], i) => (
            <Reveal key={t} delay={i * 0.08} className="panel p-6">
              <div className="tag">{t}</div>
              <div className="mono text-[15px] mt-4 text-accent leading-relaxed">{f}</div>
              <p className="text-muted text-[15px] mt-4 leading-relaxed">{d}</p>
            </Reveal>
          ))}
        </div>
        <div className="mt-16"><FusionDemo /></div>
      </section>

      <section className="gutter py-[12vh] border-t rule">
        <SectionHead index={3} label="The score" title={["One number,", "fully itemised."]}
          aside="Plate similarity tolerates a one-character shift (−0.05) and gives 0.35 credit to confusable pairs 0/O, 1/I, 8/B, 5/S, 2/Z, 6/G, 4/A, scaled by how many characters are known." />
        <div className="grid md:grid-cols-4 gap-6 mt-12">
          {[["Plate", "0.65", "0.75 in low light"], ["Colour", "0.20", "0.10 in low light; half credit for adjacent shades"], ["Body type", "0.15", "car, SUV, two-wheeler, auto, truck, bus"], ["Make / model", "+0.05", "bonus only; cannot lift a candidate over τ"]].map(([k, v, d], i) => (
            <Reveal key={k} delay={i * 0.06} className="border-t rule pt-4">
              <div className="tag">{k}</div>
              <div className="text-[clamp(2.5rem,5vw,4.5rem)] tracking-[-0.05em] font-medium leading-none mt-3">{v}</div>
              <p className="text-muted text-[14px] mt-3">{d}</p>
            </Reveal>
          ))}
        </div>
        <div className="mt-16"><StatusTriplet /></div>
      </section>

      <section className="gutter py-[12vh] border-t rule">
        <div className="grid md:grid-cols-12 gap-8 items-start">
          <div className="md:col-span-5">
            <Label index={4}>Super-resolution</Label>
            <SplitLines as="h2" lines={["For eyes only."]} className="h-sec mt-5" />
          </div>
          <Reveal className="md:col-span-6 md:col-start-7">
            <p className="lead !text-[var(--ink)]">
              An upscaled plate (lpsr-lacd) helps a person look at a crop, but upscalers can draw characters that were
              never there. PRISM saves the super-resolved image after OCR has finished and never reads it back. The
              OCR entry point rejects super-resolved images by type and by file name, and a test checks it.
            </p>
          </Reveal>
        </div>
      </section>

      <NextLink to="/cases" label="Next" title="See the cases" />
      <BigCTA />
    </>
  );
}
