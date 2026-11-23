import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { EASE_REVEAL, Label, Reveal } from "../motion.jsx";
import { Arrow, CaseCard, HoverPreviewList, NextLink, PageHero, Plate, StatusChip } from "../components.jsx";
import { CASES } from "../data/content.js";

const FILTERS = ["All", "MATCHED", "AMBIGUOUS", "NO CONFIDENT MATCH"];

export default function Cases() {
  const [f, setF] = useState("All");
  const [view, setView] = useState("grid");
  const shown = CASES.filter((c) => f === "All" || c.status === f);
  return (
    <>
      <PageHero index={2} label="Cases" lines={["Seven clips", "Seven reports"]}
        lead="Each case is a real PRISM run on a demo clip, produced by scripts/batch_report.py. Open one to see the plate crops, the fusion strip, the shortlist, the written summary and the PDF." />
      <section className="gutter pb-16 md:pb-20">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t rule pt-6">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {FILTERS.map((x) => (
              <button key={x} className={`filter-btn ${f === x ? "is-on" : ""}`} aria-pressed={f === x} onClick={() => setF(x)}>
                {x} <span className="opacity-60 ml-1">{x === "All" ? CASES.length : CASES.filter((c) => c.status === x).length}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2" role="group" aria-label="View">
            {["grid", "list"].map((v) => (
              <button key={v} className={`filter-btn ${view === v ? "is-on" : ""}`} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
        </div>

        <h2 className="sr-only">Case list</h2>
        <AnimatePresence mode="wait">
          {view === "grid" ? (
            <motion.div key={`g-${f}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_REVEAL }} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10 mt-10">
              {shown.map((c, i) => <Reveal key={c.id} delay={(i % 3) * 0.08}><CaseCard c={c} /></Reveal>)}
            </motion.div>
          ) : (
            <motion.div key={`l-${f}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="mt-10">
              <HoverPreviewList
                rows={shown.map((c) => ({ ...c, img: c.best }))}
                renderRow={(c) => (
                  <Link to={`/cases/${c.id}`} className="hlist__row grid grid-cols-[2.5rem_1fr_auto] md:grid-cols-[3rem_1.3fr_1fr_11rem_auto] items-center gap-4 py-5">
                    <span className="tag">({String(c.index).padStart(2, "0")})</span>
                    <span className="row-title">{c.title}</span>
                    <span className="hidden md:block text-[15px]"><Plate text={c.fused} /></span>
                    <span className="hidden md:block"><StatusChip status={c.status} /></span>
                    <Arrow />
                  </Link>
                )}
              />
              <div className="border-t rule" />
            </motion.div>
          )}
        </AnimatePresence>
        {!shown.length && <p className="text-muted mt-10">No case has this status.</p>}

        <div className="mt-16">
          <Label>All reports</Label>
          <p className="text-muted text-[15px] mt-2">The batch index lists every report with its status, top candidate and file hash: <a className="ulink text-[var(--ink)]" href="/reports/index.html" target="_blank" rel="noreferrer">reports/index.html</a></p>
        </div>
      </section>
      <NextLink to="/evaluation" label="Next" title="The evaluation" />
    </>
  );
}
