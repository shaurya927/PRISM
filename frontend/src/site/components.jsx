import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "framer-motion";
import { EASE, ImageReveal, Label, Reveal, RollText, SplitLines, Words } from "./motion.jsx";
import { useSite } from "./context.js";

/** Plate rendered as character cells. `truth` highlights committed characters that are wrong. */
export function Plate({ text, truth, className = "", size = "1em", onCell, active }) {
  if (!text) return <span className={`mono text-muted ${className}`}>no plate read</span>;
  return (
    <span className={`inline-flex flex-wrap gap-[0.12em] ${className}`} style={{ fontSize: size }}>
      {text.split("").map((ch, i) => {
        const wrong = truth && ch !== "?" && truth[i] && truth[i] !== ch;
        const cls = ch === "?" ? "pcell--q" : wrong ? "pcell--bad" : "";
        return (
          <span
            key={i}
            className={`pcell ${cls}`}
            style={active === i ? { boxShadow: "inset 0 0 0 1px var(--ink)" } : undefined}
            onMouseEnter={onCell ? () => onCell(i) : undefined}
          >
            {ch}
          </span>
        );
      })}
    </span>
  );
}

/** Status names in sentence case for chips and captions ("NO CONFIDENT MATCH" -> "No confident match"). */
export const statusLabel = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);

export function StatusChip({ status, className = "" }) {
  if (!status) return null;
  const tone = status === "MATCHED" ? "chip--ok" : status === "AMBIGUOUS" ? "chip--warn" : "chip--bad";
  return <span className={`chip ${tone} ${className}`}><span className="chip__dot" aria-hidden />{statusLabel(status)}</span>;
}

/** Chevron used on buttons and links; it slides right on hover. */
export function Arrow({ className = "" }) {
  return (
    <svg className={`arr ${className}`} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 2.75L9.25 7L5 11.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Pill link. Internal paths use the router; everything else is a normal anchor. */
export function Pill({ to, children, ghost = false, external = false, className = "" }) {
  const cls = `btn-pill ${ghost ? "btn-pill--ghost" : ""} ${className}`;
  const inner = (<><RollText>{children}</RollText><Arrow /></>);
  if (external || /^https?:|^\/(app|reports)/.test(to)) {
    return <a href={to} className={cls} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{inner}</a>;
  }
  return <Link to={to} className={cls}>{inner}</Link>;
}

/** Top of every subpage: label, headline, lead. */
export function PageHero({ index, label, lines, lead, children }) {
  return (
    <section className="gutter pt-32 md:pt-36 pb-10">
      <Reveal><Label index={index}>{label}</Label></Reveal>
      <SplitLines lines={lines} className="display mt-4" />
      {lead && (
        <div className="mt-6 max-w-2xl">
          <Words className="lead" text={lead} start={0.25} />
        </div>
      )}
      {children}
    </section>
  );
}

export function SectionHead({ index, label, title, aside, className = "" }) {
  return (
    <div className={`grid md:grid-cols-12 gap-6 items-end ${className}`}>
      <div className="md:col-span-7">
        {label && <Reveal><Label index={index}>{label}</Label></Reveal>}
        <SplitLines as="h2" lines={Array.isArray(title) ? title : [title]} className={`h-sec ${label ? "mt-3" : ""}`} />
      </div>
      {aside && <Reveal className="md:col-span-5 md:text-right"><p className="text-muted text-[15px] leading-relaxed md:ml-auto">{aside}</p></Reveal>}
    </div>
  );
}

/** Case card: image with status and fused plate, then the title. */
export function CaseCard({ c, tall = false }) {
  return (
    <Link to={`/cases/${c.id}`} className="case-card block group">
      <div className={`card-media ${tall ? "aspect-[4/5]" : "aspect-[4/3]"}`}>
        <ImageReveal src={c.best} alt={c.title} className="absolute inset-0" />
        <div className="absolute left-3 top-3 flex gap-2"><StatusChip status={c.status} className="!bg-black/70" /></div>
        <div className="absolute right-3 bottom-3 text-[16px] bg-black/70 rounded-lg px-2 py-1">
          <Plate text={c.fused} />
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-4 mt-4">
        <h3 className="card-title row-title">{c.title}</h3>
        <span className="tag">({String(c.index).padStart(2, "0")})</span>
      </div>
      <p className="text-muted text-[14px] mt-1 max-w-md">{c.clip}</p>
    </Link>
  );
}

/** Follows the pointer and shows the image of the hovered row (melon-style list preview). */
export function HoverPreviewList({ rows, renderRow }) {
  const [hover, setHover] = useState(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const move = (e) => { x.set(e.clientX); y.set(e.clientY); };
  return (
    <div className="hlist" onMouseMove={move} onMouseLeave={() => setHover(null)}>
      {rows.map((r, i) => (
        <div key={i} onMouseEnter={() => setHover(i)}>{renderRow(r, i)}</div>
      ))}
      <AnimatePresence>
        {hover != null && rows[hover]?.img && (
          <motion.div
            className="hover-preview"
            style={{ x, y }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            <AnimatePresence mode="popLayout">
              <motion.img
                key={rows[hover].img}
                src={rows[hover].img}
                alt=""
                className={rows[hover].pixel ? "pixel" : ""}
                initial={{ clipPath: "inset(100% 0 0 0)" }}
                animate={{ clipPath: "inset(0% 0 0 0)" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
              />
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Accordion list with numbered rows. */
export function Accordion({ items, defaultOpen = 0 }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      {items.map((it, i) => (
        <Reveal key={i} delay={i * 0.04} className={`acc__row ${open === i ? "is-open" : ""}`}>
          <button className="acc__btn" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
            <span className="tag">({String(i + 1).padStart(2, "0")})</span>
            <span className="row-title">{it.t}</span>
            <span className="acc__plus" aria-hidden />
          </button>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="overflow-hidden"
              >
                <div className="grid md:grid-cols-[3rem_1fr] gap-4 pb-6">
                  <span />
                  <div>
                    <p className="text-[16px] leading-relaxed text-[var(--muted-2)]">{it.d}</p>
                    {it.test && <p className="mono text-[12px] text-muted mt-3">Enforced by {it.test}</p>}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Reveal>
      ))}
      <div className="border-t rule" />
    </div>
  );
}

/**
 * Tabs. The active tab lives in the URL as ?tab=<id> (the first tab has no param), so tabs can be
 * linked and survive a reload. Only one Tabs block per page.
 * tabs: [{ id, label, render: () => node }]
 */
export function Tabs({ id, tabs, label }) {
  const [params, setParams] = useSearchParams();
  const reduce = useReducedMotion();
  const { lenis } = useSite();
  const barRef = useRef(null);
  const listRef = useRef(null);
  const tabRefs = useRef({});
  const pending = useRef(null);
  const q = params.get("tab");
  const idx = Math.max(0, tabs.findIndex((t) => t.id === q));
  const active = tabs[idx];

  const select = (i, focus = false) => {
    const t = tabs[(i + tabs.length) % tabs.length];
    if (t.id === active.id) {
      if (focus) tabRefs.current[t.id]?.focus();
      return;
    }
    pending.current = { focus };
    const next = new URLSearchParams(params);
    if (t.id === tabs[0].id) next.delete("tab"); else next.set("tab", t.id);
    setParams(next, { replace: true });
  };

  const onKey = (e) => {
    const to = { ArrowRight: idx + 1, ArrowLeft: idx - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    select(to, true);
  };

  useEffect(() => {
    const el = tabRefs.current[active.id];
    const list = listRef.current;
    // Keep the active tab visible when the list scrolls sideways (narrow screens).
    if (el && list && list.scrollWidth > list.clientWidth) {
      const pad = 24;
      const l = el.offsetLeft - pad;
      const r = el.offsetLeft + el.offsetWidth + pad;
      const behavior = reduce ? "auto" : "smooth";
      if (l < list.scrollLeft) list.scrollTo({ left: l, behavior });
      else if (r > list.scrollLeft + list.clientWidth) list.scrollTo({ left: r - list.clientWidth, behavior });
    }
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    if (p.focus) el?.focus({ preventScroll: true });
    // If the tab bar has scrolled out of view (e.g. "Next" at the end of a long panel), bring it back.
    const bar = barRef.current;
    if (bar && bar.getBoundingClientRect().top < 72) {
      const top = Math.max(0, window.scrollY + bar.getBoundingClientRect().top - 96);
      const l = lenis?.current;
      if (l) {
        // The new panel can be shorter, so the browser may already have clamped the scroll.
        // Re-sync Lenis with the real page height and position before animating.
        l.resize();
        l.scrollTo(window.scrollY, { immediate: true, force: true });
        l.scrollTo(top, { force: true });
      } else {
        window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
      }
    }
  }, [active.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = tabs[idx + 1];
  return (
    <div className="tabs">
      <div ref={barRef} className="tabs__bar">
        <div ref={listRef} className="tabs__list" role="tablist" aria-label={label} onKeyDown={onKey}>
          {tabs.map((t, i) => {
            const on = i === idx;
            return (
              <button
                key={t.id}
                ref={(n) => { tabRefs.current[t.id] = n; }}
                type="button"
                role="tab"
                id={`${id}-tab-${t.id}`}
                aria-selected={on}
                aria-controls={on ? `${id}-panel-${t.id}` : undefined}
                tabIndex={on ? 0 : -1}
                className="tabs__tab"
                onClick={() => select(i)}
              >
                {t.label}
                {on && (
                  <motion.span layoutId={`${id}-tabs-ul`} className="tabs__ul" aria-hidden
                    transition={reduce ? { duration: 0 } : { duration: 0.25, ease: EASE }} />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <motion.div
        key={active.id}
        role="tabpanel"
        id={`${id}-panel-${active.id}`}
        aria-labelledby={`${id}-tab-${active.id}`}
        tabIndex={0}
        className="tabs__panel"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: EASE }}
      >
        {active.render()}
        {next && (
          <button type="button" className="tabs__next" onClick={() => select(idx + 1)}>
            Next: {next.label} <Arrow />
          </button>
        )}
      </motion.div>
    </div>
  );
}

/** τ sweep chart: top-1 MATCHED and false-match rate against the match threshold. */
export function TauChart({ sweep, tau, onTau, defaultTau = 0.55 }) {
  const W = 640, H = 280, P = { l: 44, r: 16, t: 16, b: 34 };
  const xs = sweep.map((s) => s.tau);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = (t) => P.l + ((t - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (v) => H - P.b - v * (H - P.t - P.b);
  const path = (k) => sweep.map((s, i) => `${i ? "L" : "M"}${X(s.tau).toFixed(1)},${Y(s[k]).toFixed(1)}`).join(" ");
  const nearest = sweep.reduce((a, b) => (Math.abs(b.tau - tau) < Math.abs(a.tau - tau) ? b : a));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart w-full h-auto" role="img" aria-label="Correct matches and false matches against the match threshold τ">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line className="grid" x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} />
            <text x={P.l - 8} y={Y(v) + 4} textAnchor="end">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {xs.filter((_, i) => i % 2 === 0).map((t) => (
          <text key={t} x={X(t)} y={H - 10} textAnchor="middle">{t.toFixed(2)}</text>
        ))}
        <line x1={X(defaultTau)} x2={X(defaultTau)} y1={P.t} y2={H - P.b} stroke="var(--muted)" strokeDasharray="3 4" />
        <text x={X(defaultTau) + 6} y={P.t + 10}>default</text>
        <path d={path("top1_matched")} fill="none" stroke="var(--ink)" strokeWidth="2" />
        <path d={path("false_match_rate")} fill="none" stroke="var(--red-3)" strokeWidth="2" />
        <motion.line y1={P.t} y2={H - P.b} stroke="var(--muted-2)" strokeWidth="1.5"
          initial={{ x1: X(nearest.tau), x2: X(nearest.tau) }} animate={{ x1: X(nearest.tau), x2: X(nearest.tau) }} transition={{ duration: 0.25, ease: EASE }} />
        <motion.circle r="5" fill="var(--ink)" initial={{ cx: X(nearest.tau), cy: Y(nearest.top1_matched) }}
          animate={{ cx: X(nearest.tau), cy: Y(nearest.top1_matched) }} transition={{ duration: 0.25, ease: EASE }} />
        <motion.circle r="5" fill="var(--red-3)" initial={{ cx: X(nearest.tau), cy: Y(nearest.false_match_rate) }}
          animate={{ cx: X(nearest.tau), cy: Y(nearest.false_match_rate) }} transition={{ duration: 0.25, ease: EASE }} />
      </svg>
      {onTau && (
        <div className="mt-6" style={{ paddingLeft: `${(P.l / W) * 100}%`, paddingRight: `${(P.r / W) * 100}%` }}>
          <input type="range" className="rng" min={x0} max={x1} step={0.05} value={tau}
            onChange={(e) => onTau(parseFloat(e.target.value))} aria-label="Match threshold τ" />
          <div className="flex justify-between tag mt-3"><span>τ {x0.toFixed(2)}</span><span>τ {x1.toFixed(2)}</span></div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-4 mt-8">
        <Stat k="τ" v={nearest.tau.toFixed(2)} />
        <Stat k="Correct vehicle MATCHED" v={`${(nearest.top1_matched * 100).toFixed(1)}%`} />
        <Stat k="False match" v={`${(nearest.false_match_rate * 100).toFixed(1)}%`} bad={nearest.false_match_rate > 0.01} />
      </div>
    </div>
  );
}

export function Stat({ k, v, bad }) {
  return (
    <div className="border-t rule pt-3">
      <div className="tag">{k}</div>
      <div className={`text-[22px] md:text-[26px] tracking-[-0.02em] font-medium tabular-nums mt-1 ${bad ? "text-bad" : ""}`}>{v}</div>
    </div>
  );
}

/** Horizontal bar. */
export function Bar({ value, max = 1, color = "var(--ink)" }) {
  return (
    <div className="bar">
      <span style={{ background: color, width: `${Math.max(0.5, (value / max) * 100)}%` }} />
    </div>
  );
}

/** Compact "next page" link at the bottom of subpages: the one closing call to action. */
export function NextLink({ to, label, title }) {
  return (
    <Link to={to} className="block gutter py-16 border-t rule group">
      <div className="tag">{label}</div>
      <div className="h-sec mt-3 flex items-center gap-4 transition-colors duration-150 group-hover:text-white">
        {title}
        <Arrow className="w-[0.5em] h-[0.5em] transition-transform duration-200 group-hover:translate-x-[6px]" />
      </div>
    </Link>
  );
}

/** Code block with a copy button. */
export function Code({ children, label }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="relative">
      {label && <div className="tag mb-2">{label}</div>}
      <pre className="code">{children}</pre>
      <button
        className="absolute right-3 bottom-3 tag hover:text-[var(--ink)]"
        onClick={() => navigator.clipboard?.writeText(String(children)).then(() => setCopied(true))}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
