import React from "react";
import { Link } from "react-router-dom";
import { Label, Reveal, ScrubText } from "../motion.jsx";
import { Accordion, Arrow, NextLink, PageHero, Plate, SectionHead, Tabs } from "../components.jsx";
import { caseById, GUARDRAILS, QUOTES } from "../data/content.js";

const HINT_RULES = [
  ["CG04MX48?1", "CG04????2?", "CG04MX4821", "Video ? + hint 2: filled, labelled investigator-supplied"],
  ["CG04MX4821", "CG04MX4851", "CG04MX48?1", "Video 2 vs hint 5: conflict, set to ? and listed"],
];

const SUMMARY_RULES = [
  ["Template by default", "The case summary is generated from the evidence with a fixed template. An optional local LLM (Ollama) can rewrite it."],
  ["Cited evidence", "Each sentence carries citations such as [F13, POS-9] that point to frames, positions and registry records."],
  ["Rule-based verifier", "Each sentence of an LLM-written summary is checked against the case data. If more than one sentence fails, PRISM falls back to the template."],
];

function Rules() {
  return (
    <>
      <Accordion items={GUARDRAILS} />
      <div className="mt-16">
        <Label>Principle</Label>
        <div className="mt-4">
          <ScrubText text="PRISM output supports an investigator's decision. It does not identify a vehicle on its own. Every candidate comes with its reasons, and every ? comes with the frame that came closest to reading it." />
        </div>
      </div>
    </>
  );
}

function Hints() {
  return (
    <>
      <SectionHead label="Investigator hints" title="A witness can help, but never overrule"
        aside="Hints fill only positions the video could not read. Where video and hint disagree, the position becomes ? and the conflict is written into the report." />
      <div className="mt-8 space-y-4">
        {HINT_RULES.map(([video, hint, out, d], i) => (
          <Reveal key={i} className="panel p-5 grid sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1.4fr] gap-5 items-center">
            <div><div className="tag mb-2">Video</div><span className="text-[17px]"><Plate text={video} /></span></div>
            <div><div className="tag mb-2">Hint</div><span className="text-[17px]"><Plate text={hint} /></span></div>
            <div><div className="tag mb-2">Merged</div><span className="text-[17px]"><Plate text={out} /></span></div>
            <p className="text-muted text-[15px] sm:col-span-3 lg:col-span-1">{d}</p>
          </Reveal>
        ))}
      </div>
    </>
  );
}

/** PRISM's own words: the advisor, an explanation and a summary, cut to a readable length. */
function Quotes() {
  const items = QUOTES
    .map((q) => ({ ...q, text: (caseById(q.id)?.[q.field] || "").replace(/`/g, "").replace(/\s*\[[A-Z0-9, -]+\]/g, "") }))
    .filter((q) => q.text);
  if (!items.length) return null;
  return (
    <div className="mt-16">
      <SectionHead label="Examples" title="In its own words" />
      <div className="grid md:grid-cols-3 gap-4 mt-8">
        {items.map((q) => {
          const short = q.text.length > 260 ? q.text.slice(0, q.text.indexOf(".", 180) + 1 || 260) : q.text;
          return (
            <figure key={q.id} className="panel p-5 flex flex-col">
              <figcaption className="tag">{q.who} · {q.role}</figcaption>
              <blockquote className="text-[16px] leading-relaxed mt-3 flex-1">{short}</blockquote>
              <Link to={`/cases/${q.id}`} className="inline-flex items-center gap-2 mt-4 text-[14px] text-[var(--muted-2)] hover:text-[var(--ink)] f-u self-start">Open the case <Arrow /></Link>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

function Summaries() {
  return (
    <>
      <SectionHead label="Summaries" title="Every sentence is checked" />
      <div className="grid md:grid-cols-3 gap-6 mt-8">
        {SUMMARY_RULES.map(([t, d]) => (
          <Reveal key={t} className="border-t rule pt-5">
            <h3 className="row-title">{t}</h3>
            <p className="text-muted text-[15px] mt-2 leading-relaxed">{d}</p>
          </Reveal>
        ))}
      </div>
      <Quotes />
    </>
  );
}

const TABS = [
  { id: "rules", label: "Rules", render: () => <Rules /> },
  { id: "hints", label: "Investigator hints", render: () => <Hints /> },
  { id: "summaries", label: "Summaries", render: () => <Summaries /> },
];

export default function Guardrails() {
  return (
    <>
      <PageHero index={4} label="Guardrails" lines={["Rules it", "cannot break"]}
        lead="A tool that names a vehicle can send an investigation the wrong way. Each rule below is enforced in code and checked by a test, several of them with property-based tests that generate thousands of random reads." />
      <section className="gutter pb-16 md:pb-20">
        <Tabs id="guard" label="Guardrails sections" tabs={TABS} />
      </section>
      <NextLink to="/docs" label="Next" title="Run it yourself" />
    </>
  );
}
