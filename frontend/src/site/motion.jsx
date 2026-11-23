import React, { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

// One ease-out curve for every transition on the site. Motion answers interaction (hover, press,
// sliders, tabs, menus, page changes) and scrolling:
//   - headings rise letter by letter out of a mask, paragraphs word by word
//   - blocks pop up once as they enter the viewport
//   - images drift inside their frames (parallax) and some frames unfold from an inset
//   - button labels roll letter by letter on hover (CSS, see .rt in site.css)
// Under reduced motion everything renders in place.
export const EASE = [0.22, 1, 0.36, 1];
export const EASE_REVEAL = EASE;
export const EASE_APPEAR = EASE;

// Trigger a little before the block is fully on screen, and only once.
const VIEWPORT = { once: true, amount: 0.15, margin: "0px 0px -8% 0px" };

const lineVariants = {
  hidden: { y: "105%" },
  shown: (i) => ({ y: "0%", transition: { duration: 0.7, ease: EASE, delay: i * 0.07 } }),
};
const charVariants = {
  hidden: { y: "115%" },
  shown: (d) => ({ y: "0%", transition: { duration: 0.75, ease: EASE, delay: d } }),
};

/**
 * One line of text as characters that rise in turn. Characters are grouped per word so the line only
 * wraps between words. Needs a parent that switches between the "hidden" and "shown" variants.
 */
export function SplitChars({ text, start = 0, step }) {
  const words = String(text).split(" ");
  const total = String(text).length || 1;
  const s = step ?? Math.min(0.022, 0.45 / total);
  let n = 0;
  return words.map((w, wi) => (
    <React.Fragment key={wi}>
      <span className="chars__w">
        {Array.from(w).map((c, ci) => <motion.span key={ci} className="chars__c" variants={charVariants} custom={start + n++ * s}>{c}</motion.span>)}
      </span>
      {wi < words.length - 1 && (n++, " ")}
    </React.Fragment>
  ));
}

/**
 * Headline split into lines. Each line keeps its own block so wraps stay where they were written.
 * On scroll, text lines rise letter by letter out of their masks (other content rises as one line).
 * The heading is observed rather than the letters, because the letters start clipped by their masks
 * and would never count as visible. The heading carries the full text as its accessible name.
 */
export function SplitLines({ lines, as: Tag = "h1", className = "" }) {
  const reduce = useReducedMotion();
  const allText = lines.every((l) => typeof l === "string");
  if (reduce) {
    return (
      <Tag className={className}>
        {lines.map((line, i) => <span key={i} className="mask-line"><span className="mask-line__in">{line}</span></span>)}
      </Tag>
    );
  }
  const M = motion[Tag] || motion.div;
  return (
    <M className={className} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.5 }}
      aria-label={allText ? lines.join(" ") : undefined}>
      {lines.map((line, i) => (
        <span key={i} className="mask-line" aria-hidden={allText || undefined}>
          {typeof line === "string"
            ? <span className="mask-line__in"><SplitChars text={line} start={i * 0.08} /></span>
            : <motion.span className="mask-line__in" variants={lineVariants} custom={i}>{line}</motion.span>}
        </span>
      ))}
    </M>
  );
}

const wordVariants = {
  hidden: { opacity: 0, y: "0.6em" },
  shown: (d) => ({ opacity: 1, y: "0em", transition: { duration: 0.6, ease: EASE, delay: d } }),
};

/** Paragraph whose words fade up in turn the first time it scrolls into view. */
export function Words({ text, as: Tag = "p", className = "", start = 0 }) {
  const reduce = useReducedMotion();
  if (reduce || typeof text !== "string") return <Tag className={className}>{text}</Tag>;
  const words = text.split(" ");
  const step = Math.min(0.018, 0.6 / words.length);
  const M = motion[Tag] || motion.p;
  return (
    <M className={className} initial="hidden" whileInView="shown" viewport={VIEWPORT}>
      {words.map((w, i) => (
        <React.Fragment key={i}>
          <motion.span className="inline-block" variants={wordVariants} custom={start + i * step}>{w}</motion.span>{i < words.length - 1 ? " " : null}
        </React.Fragment>
      ))}
    </M>
  );
}

/** Button and link label that rolls up letter by letter on hover (styles: .rt in site.css). */
export function RollText({ children }) {
  const parts = React.Children.toArray(children);
  if (!parts.length || !parts.every((c) => typeof c === "string" || typeof c === "number")) return children;
  const text = parts.join("");
  const row = (cls) => (
    <span className={`rt__row ${cls}`} aria-hidden>
      {Array.from(text).map((c, i) => <span key={i} className="rt__c" style={{ "--i": i }}>{c}</span>)}
    </span>
  );
  return (
    <span className="rt">
      <span className="sr-only">{text}</span>
      {row("rt__row--a")}
      {row("rt__row--b")}
    </span>
  );
}

/**
 * Full-width band that unfolds from a rounded inset to the full width as it scrolls in, and folds
 * back as it leaves (scrubbed by scroll position).
 */
export function Unfold({ as: Tag = "section", className = "", children }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const clipPath = useTransform(p, [0, 0.22, 0.82, 1],
    ["inset(5% 4% round 28px)", "inset(0% 0% round 0px)", "inset(0% 0% round 0px)", "inset(5% 4% round 28px)"]);
  const M = motion[Tag] || motion.section;
  return <M ref={ref} className={className} style={reduce ? undefined : { clipPath }}>{children}</M>;
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

/**
 * Image in a clipped frame. parallax: the image is slightly zoomed and drifts inside the frame as the
 * frame crosses the viewport. unfold: the frame itself opens from an inset as it scrolls in.
 */
export function ImageReveal({ src, alt = "", className = "", imgClassName = "", pixel = false, parallax = true, unfold = false, radius = 12 }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(p, [0, 1], ["-5%", "5%"]);
  const scale = useTransform(p, [0, 0.5], [1.2, 1.12]);
  const clipPath = useTransform(p, [0.05, 0.4], [`inset(12% 10% round ${radius}px)`, `inset(0% 0% round ${radius}px)`]);
  const move = !reduce && parallax;
  return (
    <motion.div ref={ref} className={`overflow-hidden ${className}`} style={!reduce && unfold ? { clipPath } : undefined}>
      <motion.img src={src} alt={alt} loading="lazy" className={`w-full h-full object-cover ${pixel ? "pixel" : ""} ${imgClassName}`}
        style={move ? { y, scale } : undefined} />
    </motion.div>
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
