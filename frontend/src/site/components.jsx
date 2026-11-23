import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import { EASE, ImageReveal, Label, Reveal, SplitLines } from "./motion.jsx";

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

export function Arrow({ className = "" }) {
  return (
    <svg className={`arr ${className}`} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 11L11 3M11 3H4.5M11 3V9.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Pill link. Internal paths use the router; everything else is a normal anchor. */
export function Pill({ to, children, ghost = false, external = false, className = "" }) {
  const cls = `btn-pill ${ghost ? "btn-pill--ghost" : ""} ${className}`;
  const inner = (<>{children}<Arrow /></>);
  if (external || /^https?:|^\/(app|reports)/.test(to)) {
    return <a href={to} className={cls} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{inner}</a>;
  }
  return <Link to={to} className={cls}>{inner}</Link>;
}

/** Top of every subpage: label, masked headline, lead. */
export function PageHero({ index, label, lines, lead, children }) {
  return (
    <section className="gutter pt-[22vh] pb-[10vh]">
      <Reveal><Label index={index}>{label}</Label></Reveal>
      <SplitLines lines={lines} className="display mt-6" />
      {lead && (
        <Reveal className="mt-10 max-w-2xl">
          <p className="lead">{lead}</p>
        </Reveal>
      )}
      {children}
    </section>
  );
}

export function SectionHead({ index, label, title, aside, className = "" }) {
  return (
    <div className={`grid md:grid-cols-12 gap-6 items-end ${className}`}>
      <div className="md:col-span-8">
        <Reveal><Label index={index}>{label}</Label></Reveal>
        <SplitLines as="h2" lines={Array.isArray(title) ? title : [title]} className="h-sec mt-4" />
      </div>
      {aside && <Reveal className="md:col-span-4 md:text-right"><p className="text-muted text-[15px] leading-relaxed">{aside}</p></Reveal>}
    </div>
  );
}

/** Large case card with hover zoom and the "View" bubble. */
export function CaseCard({ c, tall = false }) {
  return (
    <Link to={`/cases/${c.id}`} className="case-card block group">
      <div className={`card-media ${tall ? "aspect-[4/5]" : "aspect-[4/3]"}`}>
        <ImageReveal src={c.best} alt={c.title} className="absolute inset-0 zoom" />
        <div className="absolute left-4 top-4 flex gap-2"><StatusChip status={c.status} className="!bg-black/70" /></div>
        <div className="absolute right-4 bottom-4 text-[22px] bg-black/70 rounded-lg px-2 py-1">
          <Plate text={c.fused} />
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-4 mt-4">
        <h3 className="card-title text-[22px] md:text-[26px] tracking-[-0.02em] font-medium">{c.title}</h3>
        <span className="tag">({String(c.index).padStart(2, "0")})</span>
      </div>
      <p className="text-muted text-[15px] mt-1 max-w-md">{c.clip}</p>
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
        <Reveal key={i} delay={i * 0.04}>
          <div className={`acc__row ${open === i ? "is-open" : ""}`}>
            <button className="acc__btn" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
              <span className="tag">({String(i + 1).padStart(2, "0")})</span>
              <span className="text-[22px] md:text-[32px] tracking-[-0.02em] font-normal leading-tight">{it.t}</span>
              <span className="acc__plus" aria-hidden />
            </button>
            <AnimatePresence initial={false}>
              {open === i && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="grid md:grid-cols-[3.5rem_1fr] gap-4 pb-8">
                    <span />
                    <div className="max-w-3xl">
                      <p className="lead !text-[var(--ink)] opacity-80">{it.d}</p>
                      {it.test && <p className="mono text-[12px] text-muted mt-4">Enforced by {it.test}</p>}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Reveal>
      ))}
      <div className="border-t rule" />
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
      <svg viewBox={`0 0 ${W} ${H}`} className="chart w-full h-auto">
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
        <path d={path("false_match_rate")} fill="none" stroke="var(--red)" strokeWidth="2" />
        <motion.line y1={P.t} y2={H - P.b} stroke="var(--accent)" strokeWidth="1.5"
          initial={{ x1: X(nearest.tau), x2: X(nearest.tau) }} animate={{ x1: X(nearest.tau), x2: X(nearest.tau) }} transition={{ duration: 0.25, ease: EASE }} />
        <motion.circle r="5" fill="var(--ink)" initial={{ cx: X(nearest.tau), cy: Y(nearest.top1_matched) }}
          animate={{ cx: X(nearest.tau), cy: Y(nearest.top1_matched) }} transition={{ duration: 0.25, ease: EASE }} />
        <motion.circle r="5" fill="var(--red)" initial={{ cx: X(nearest.tau), cy: Y(nearest.false_match_rate) }}
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
        <Stat k="τ" v={nearest.tau.toFixed(2)} accent />
        <Stat k="Correct vehicle MATCHED" v={`${(nearest.top1_matched * 100).toFixed(1)}%`} />
        <Stat k="False match" v={`${(nearest.false_match_rate * 100).toFixed(1)}%`} bad={nearest.false_match_rate > 0.01} />
      </div>
    </div>
  );
}

export function Stat({ k, v, accent, bad }) {
  return (
    <div className="border-t rule pt-3">
      <div className="tag">{k}</div>
      <div className={`text-[28px] md:text-[36px] tracking-[-0.02em] font-medium tabular-nums mt-1 ${accent ? "text-accent" : bad ? "text-bad" : ""}`}>{v}</div>
    </div>
  );
}

/** Horizontal bar that grows when scrolled into view. */
export function Bar({ value, max = 1, color = "var(--ink)" }) {
  return (
    <div className="bar">
      <span style={{ background: color, width: `${Math.max(0.5, (value / max) * 100)}%` }} />
    </div>
  );
}

/** Closing call to action shared by every page. */
export function BigCTA() {
  return (
    <section className="gutter py-[16vh] border-t rule">
      <Label index="→">Try it on the demo clips</Label>
      <div className="grid md:grid-cols-12 gap-10 items-end mt-8">
        <SplitLines as="h2" lines={["Open a case", "Upload a clip"]} className="display-2 md:col-span-8" />
        <div className="md:col-span-4 flex md:justify-end">
          <a href="/app" className="grid place-items-center w-44 h-44 md:w-56 md:h-56 rounded-full bg-[var(--accent)] hover:bg-[#c42619] text-white text-[18px] font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
            <span className="flex items-center gap-2">Open app <Arrow /></span>
          </a>
        </div>
      </div>
    </section>
  );
}

/** Big "next" link at the bottom of detail pages. */
export function NextLink({ to, label, title }) {
  return (
    <Link to={to} className="block gutter py-[12vh] border-t rule group">
      <div className="tag">{label}</div>
      <div className="display-2 mt-4 flex items-center gap-6 transition-colors duration-150 group-hover:text-white">
        {title}
        <Arrow className="w-[0.5em] h-[0.5em]" />
      </div>
    </Link>
  );
}

/** Small helper for code blocks with a copy button. */
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
