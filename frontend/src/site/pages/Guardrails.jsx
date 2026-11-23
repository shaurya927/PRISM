import React from "react";
import { Label, Reveal, ScrubText } from "../motion.jsx";
import { Accordion, BigCTA, NextLink, PageHero, Plate, SectionHead } from "../components.jsx";
import { GUARDRAILS } from "../data/content.js";

const HINT_RULES = [
  ["CG04MX48?1", "CG04????2?", "CG04MX4821", "Video ? + hint 2: filled, labelled investigator-supplied"],
  ["CG04MX4821", "CG04MX4851", "CG04MX48?1", "Video 2 vs hint 5: conflict, set to ? and listed"],
];

export default function Guardrails() {
  return (
    <>
      <PageHero index={4} label="Guardrails" lines={["Rules it", "cannot break"]}
        lead="A tool that names a vehicle can send an investigation the wrong way. Each rule below is enforced in code and checked by a test, several of them with property-based tests that generate thousands of random reads." />

      <section className="gutter pb-[12vh]">
        <Accordion items={GUARDRAILS} />
      </section>

      <section className="gutter py-[14vh] border-t rule">
        <Label index={1}>Principle</Label>
        <div className="mt-10 max-w-5xl">
          <ScrubText text="PRISM output supports an investigator's decision. It does not identify a vehicle on its own. Every candidate comes with its reasons, and every ? comes with the frame that came closest to reading it." />
        </div>
      </section>

      <section className="gutter py-[12vh] border-t rule">
        <SectionHead index={2} label="Investigator hints" title={["A witness can help,", "but never overrule"]}
          aside="Hints fill only positions the video could not read. Where video and hint disagree, the position becomes ? and the conflict is written into the report." />
        <div className="mt-14 space-y-4">
          {HINT_RULES.map(([video, hint, out, d], i) => (
            <Reveal key={i} delay={i * 0.08} className="panel p-6 grid md:grid-cols-[1fr_1fr_1fr_1.4fr] gap-6 items-center">
              <div><div className="tag mb-2">Video</div><span className="text-[20px]"><Plate text={video} /></span></div>
              <div><div className="tag mb-2">Hint</div><span className="text-[20px]"><Plate text={hint} /></span></div>
              <div><div className="tag mb-2">Merged</div><span className="text-[20px]"><Plate text={out} /></span></div>
              <p className="text-muted text-[15px]">{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="gutter py-[12vh] border-t rule">
        <SectionHead index={3} label="Summaries" title={["Every sentence", "is checked"]} />
        <div className="grid md:grid-cols-3 gap-6 mt-14">
          {[
            ["Template by default", "The case summary is generated from the evidence with a fixed template. An optional local LLM (Ollama) can rewrite it."],
            ["Cited evidence", "Each sentence carries citations such as [F13, POS-9] that point to frames, positions and registry records."],
            ["Rule-based verifier", "Each sentence of an LLM-written summary is checked against the case data. If more than one sentence fails, PRISM falls back to the template."],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 0.08} className="border-t rule pt-5">
              <div className="text-[22px] tracking-[-0.03em] font-medium">{t}</div>
              <p className="text-muted text-[15px] mt-3 leading-relaxed">{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <NextLink to="/docs" label="Next" title="Run it yourself" />
      <BigCTA />
    </>
  );
}
