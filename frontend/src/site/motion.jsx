import React from "react";
import { motion, useReducedMotion } from "framer-motion";

// One ease-out curve for every transition on the site. Motion answers interaction (hover, press,
// sliders, tabs, menus, page changes) and scrolling: blocks rise into place once as they enter the
// viewport. Under reduced motion everything renders in place.
export const EASE = [0.22, 1, 0.36, 1];
export const EASE_REVEAL = EASE;
export const EASE_APPEAR = EASE;

// Trigger a little before the block is fully on screen, and only once.
const VIEWPORT = { once: true, amount: 0.15, margin: "0px 0px -8% 0px" };

const lineVariants = {
  hidden: { y: "105%" },
  shown: (i) => ({ y: "0%", transition: { duration: 0.7, ease: EASE, delay: i * 0.07 } }),
};

/**
 * Headline split into lines. Each line keeps its own block so wraps stay where they were written.
 * On scroll the lines rise out of their masks. The heading is observed (not the lines), because the
 * lines start clipped by their masks and would never count as visible.
 */
export function SplitLines({ lines, as: Tag = "h1", className = "" }) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <Tag className={className}>
        {lines.map((line, i) => <span key={i} className="mask-line"><span className="mask-line__in">{line}</span></span>)}
      </Tag>
    );
  }
  const M = motion[Tag] || motion.div;
  return (
    <M className={className} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.5 }}>
      {lines.map((line, i) => (
        <span key={i} className="mask-line">
          <motion.span className="mask-line__in" variants={lineVariants} custom={i}>{line}</motion.span>
        </span>
      ))}
    </M>
  );
}

/** Block that pops up a little (fade, 18px rise, slight scale) the first time it scrolls into view. */
export function Reveal({ children, className = "", as: Tag = "div", delay = 0 }) {
  const reduce = useReducedMotion();
  if (reduce) return <Tag className={className}>{children}</Tag>;
  const M = motion[Tag] || motion.div;
  return (
    <M className={className} initial={{ opacity: 0, y: 18, scale: 0.985 }} whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={VIEWPORT} transition={{ duration: 0.6, ease: EASE, delay: Math.min(delay, 0.4) }}>
      {children}
    </M>
  );
}

/** Paragraph with the unknown `?` in the accent colour. */
export function ScrubText({ text, className = "" }) {
  return (
    <p className={`scrub ${className}`}>
      {text.split(" ").map((w, i) => (
        <span key={i}>{w.includes("?") ? <span className="pcell pcell--q">{w}</span> : w}{" "}</span>
      ))}
    </p>
  );
}

/** A measured figure in one format. */
export function Counter({ value, decimals = 0, suffix = "", prefix = "", className = "" }) {
  return <span className={className}>{prefix}{Number(value).toFixed(decimals)}{suffix}</span>;
}

/** Image in a clipped frame. */
export function ImageReveal({ src, alt = "", className = "", imgClassName = "", pixel = false }) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <img src={src} alt={alt} loading="lazy" className={`w-full h-full object-cover ${pixel ? "pixel" : ""} ${imgClassName}`} />
    </div>
  );
}

/** Mono micro-label with an index, e.g. "(02) Pipeline". */
export function Label({ index, children, className = "" }) {
  return (
    <div className={`label-mono ${className}`}>
      {index != null && <span className="mr-2">({String(index).padStart(2, "0")})</span>}
      {children}
    </div>
  );
}

/** Text with every `?` in the accent colour. */
export function ScrambleText({ text, className = "" }) {
  return (
    <span className={className} aria-label={text}>
      {text.split("").map((c, i) => (
        <span key={i} className={c === "?" ? "text-accent" : ""}>{c}</span>
      ))}
    </span>
  );
}
