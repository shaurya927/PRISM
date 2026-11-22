import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { EASE_REVEAL, Label, Reveal } from "../motion.jsx";
import { Arrow, BigCTA, CaseCard, HoverPreviewList, PageHero, Plate, StatusChip } from "../components.jsx";
import { CASES } from "../data/content.js";

const FILTERS = ["All", "MATCHED", "AMBIGUOUS", "NO CONFIDENT MATCH"];

export default function Cases() {
  const [f, setF] = useState("All");
  const [view, setView] = useState("grid");
  const shown = CASES.filter((c) => f === "All" || c.status === f);
  return (
    <>
      <PageHero index={2} label="Cases" lines={["Seven clips.", "Seven reports."]}
        lead="Each case is a real PRISM run on a demo clip, produced by scripts/batch_report.py. Open one to see the plate crops, the fusion strip, the shortlist, the written summary and the PDF." />
      <section className="gutter pb-[14vh]">
        <Reveal className="flex flex-wrap items-center justify-between gap-4 border-t rule pt-6">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((x) => (
              <button key={x} className={`filter-btn ${f === x ? "is-on" : ""}`} onClick={() => setF(x)}>
                {x} <span className="opacity-60 ml-1">{x === "All" ? CASES.length : CASES.filter((c) => c.status === x).length}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {["grid", "list"].map((v) => (
              <button key={v} className={`filter-btn ${view === v ? "is-on" : ""}`} onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
        </Reveal>

        <AnimatePresence mode="wait">
          {view === "grid" ? (
            <motion.div key={`g-${f}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5, ease: EASE_REVEAL }} className="grid md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-14 mt-12">
              {shown.map((c) => <CaseCard key={c.id} c={c} />)}
            </motion.div>
          ) : (
            <motion.div key={`l-${f}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="mt-12">
              <HoverPreviewList
                rows={shown.map((c) => ({ ...c, img: c.best }))}
                renderRow={(c) => (
                  <Link to={`/cases/${c.id}`} className="hlist__row grid grid-cols-[3rem_1fr_auto] md:grid-cols-[4rem_1.3fr_1fr_12rem_auto] items-center gap-4 py-6">
                    <span className="tag">({String(c.index).padStart(2, "0")})</span>
                    <span className="text-[clamp(1.4rem,2.8vw,2.5rem)] tracking-[-0.04em] font-medium leading-none">{c.title}</span>
                    <span className="hidden md:block text-[18px]"><Plate text={c.fused} /></span>
                    <span className="hidden md:block"><StatusChip status={c.status} /></span>
                    <Arrow />
                  </Link>
                )}
              />
              <div className="border-t rule" />
            </motion.div>
          )}
        </AnimatePresence>
        {!shown.length && <p className="text-muted mt-12">No case has this status.</p>}
      </section>
      <section className="gutter pb-[10vh]">
        <Label>All reports</Label>
        <p className="text-muted mt-3">The batch index lists every report with its status, top candidate and file hash: <a className="ulink text-[var(--ink)]" href="/reports/index.html" target="_blank" rel="noreferrer">reports/index.html</a></p>
      </section>
      <BigCTA />
    </>
  );
}
