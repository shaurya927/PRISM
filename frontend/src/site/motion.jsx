import React, { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion, useScroll, useTransform } from "framer-motion";

// One easing curve for every transition on the site.
export const EASE = [0.22, 1, 0.36, 1];
export const EASE_REVEAL = EASE;
export const EASE_APPEAR = EASE;

/** Masked line reveal: each line slides up from behind an overflow mask. */
export function SplitLines({ lines, as: Tag = "h1", className = "", delay = 0, stagger = 0.08, once = true }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  return (
    <Tag ref={ref} className={className}>
      {lines.map((line, i) => (
        <span key={i} className="mask-line">
          <motion.span
            className="mask-line__in"
            initial={reduce ? false : { y: "110%" }}
            animate={inView ? { y: "0%" } : undefined}
            transition={{ duration: 0.8, ease: EASE, delay: delay + i * stagger }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

/** Fade + rise on enter. */
export function Reveal({ children, delay = 0, y = 12, className = "", as = "div" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });
  const reduce = useReducedMotion();
  const M = motion[as] || motion.div;
  return (
    <M
      ref={ref}
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.5, ease: EASE, delay }}
    >
      {children}
    </M>
  );
}

/** Paragraph whose words light up as it scrolls through the viewport. */
export function ScrubText({ text, className = "" }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 45%"] });
  const words = text.split(" ");
  return (
    <p ref={ref} className={`scrub ${className}`}>
      {words.map((w, i) => (
        <ScrubWord key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]}>
          {w}
        </ScrubWord>
      ))}
    </p>
  );
}

function ScrubWord({ children, progress, range }) {
  const opacity = useTransform(progress, range, [0.14, 1]);
  const amber = children.includes("?");
  return (
    <motion.span style={{ opacity }} className={amber ? "text-accent" : ""}>
      {children}{" "}
    </motion.span>
  );
}

/** Counts up to `value` when it enters the viewport. */
export function Counter({ value, decimals = 0, suffix = "", prefix = "", duration = 1.8, className = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const [v, setV] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!inView) return;
    if (reduce) return setV(value);
    const c = animate(0, value, { duration, ease: EASE_REVEAL, onUpdate: setV });
    return () => c.stop();
  }, [inView, value, duration, reduce]);
  return (
    <span ref={ref} className={className}>
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** Infinite horizontal marquee; speeds up with scroll velocity. */
export function Marquee({ items, speed = 40, className = "" }) {
  const reduce = useReducedMotion();
  const row = [...items, ...items];
  return (
    <div className={`marquee ${className}`} aria-hidden={false}>
      <div className="marquee__track" style={{ animationDuration: reduce ? "0s" : `${speed}s` }}>
        {row.map((it, i) => (
          <span key={i} className="marquee__item">
            {it}
            <span className="marquee__dot">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Image revealed by an expanding clip-path, with a slight scale settle. */
export function ImageReveal({ src, alt = "", className = "", imgClassName = "", delay = 0, pixel = false }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  return (
    <div ref={ref} className={`overflow-hidden ${className}`}>
      <motion.img
        src={src}
        alt={alt}
        loading="lazy"
        className={`w-full h-full object-cover ${pixel ? "pixel" : ""} ${imgClassName}`}
        initial={reduce ? false : { clipPath: "inset(100% 0% 0% 0%)" }}
        animate={inView ? { clipPath: "inset(0% 0% 0% 0%)" } : undefined}
        transition={{ duration: 0.8, ease: EASE, delay }}
      />
    </div>
  );
}

/** Mono micro-label with an index, e.g. "(02) Pipeline". */
export function Label({ index, children, className = "" }) {
  return (
    <div className={`label-mono ${className}`}>
      {index != null && <span className="opacity-50 mr-2">({String(index).padStart(2, "0")})</span>}
      {children}
    </div>
  );
}

/** Characters scramble before settling on the final string; '?' stays amber. */
export function ScrambleText({ text, className = "", delay = 0, duration = 1.2 }) {
  const [out, setOut] = useState(text.replace(/./g, " "));
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView) return;
    if (reduce) return setOut(text);
    const pool = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
    let raf;
    const start = performance.now() + delay * 1000;
    const tick = (now) => {
      const t = Math.max(0, (now - start) / (duration * 1000));
      const settled = Math.floor(t * text.length);
      setOut(
        text
          .split("")
          .map((ch, i) => (i < settled ? ch : t > 0 ? (ch === "?" ? "?" : pool[(Math.random() * pool.length) | 0]) : " "))
          .join("")
      );
      if (t < 1) raf = requestAnimationFrame(tick);
      else setOut(text);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, text, delay, duration, reduce]);
  return (
    <span ref={ref} className={className} aria-label={text}>
      {out.split("").map((c, i) => (
        <span key={i} className={c === "?" ? "text-accent" : ""}>{c}</span>
      ))}
    </span>
  );
}
