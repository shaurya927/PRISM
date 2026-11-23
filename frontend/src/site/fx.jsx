// Pointer- and scroll-driven effects for the website: cursor, CCTV highway scene, split wordmark,
// tilt cards, liquid text, direction-aware fills, roll links, live clock and /health status.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createHighway } from "./highway.js";
import { motion, useAnimationControls, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, useVelocity } from "framer-motion";

/* ------------------------------------------------------------------ cursor */
export function Cursor() {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const rx = useSpring(x, { stiffness: 420, damping: 36, mass: 0.6 });
  const ry = useSpring(y, { stiffness: 420, damping: 36, mass: 0.6 });
  const [state, setState] = useState({ label: null, link: false, down: false, hidden: true });
  useEffect(() => {
    const move = (e) => {
      x.set(e.clientX);
      y.set(e.clientY);
      const t = e.target;
      const lab = t.closest?.("[data-cursor]");
      const link = !!t.closest?.("a, button, input, [role=button]");
      setState((s) => {
        const label = lab ? lab.getAttribute("data-cursor") : null;
        return s.label === label && s.link === link && !s.hidden ? s : { ...s, label, link, hidden: false };
      });
    };
    const down = () => setState((s) => ({ ...s, down: true }));
    const up = () => setState((s) => ({ ...s, down: false }));
    const leave = () => setState((s) => ({ ...s, hidden: true }));
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [x, y]);
  const d = (state.label ? 92 : state.link ? 56 : 36) * (state.down ? 0.82 : 1);
  return (
    <motion.div className="cur" style={{ x: rx, y: ry }} aria-hidden>
      <motion.div
        className={`cur__ring ${state.label ? "is-label" : ""} ${state.link && !state.label ? "is-link" : ""}`}
        animate={{ width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2, opacity: state.hidden ? 0 : 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
      >
        <motion.span animate={{ opacity: state.label ? 1 : 0, y: state.label ? 0 : 8 }} transition={{ duration: 0.25 }} style={{ display: "block", fontSize: 12 }}>
          {state.label}
        </motion.span>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ CCTV highway */
/** Night highway from a roadside camera (see highway.js). Options are passed to createHighway. */
export function HighwayCanvas({ className = "", ...opts }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const key = JSON.stringify(opts);
  useEffect(() => {
    const h = createHighway(ref.current, { ...JSON.parse(key), still: !!reduce });
    return () => h.destroy();
  }, [key, reduce]);
  return (
    <div className={`hwy ${className}`}>
      <canvas ref={ref} aria-hidden />
      <div className="hwy__fx" aria-hidden />
    </div>
  );
}

/* ------------------------------------------------------------------ split wordmark */
/** Full-width wordmark; each letter rises toward the pointer and drifts at its own speed on scroll. */
export function Wordmark({ text = "PRISM", delay = 0 }) {
  const wrap = useRef(null);
  const measure = useRef(null);
  const [fs, setFs] = useState(0);
  const [offsets, setOffsets] = useState([]);
  const [W, setW] = useState(1);
  const reduce = useReducedMotion();
  const mx = useMotionValue(-1);
  const { scrollY } = useScroll();
  useLayoutEffect(() => {
    const fit = () => {
      const w = wrap.current?.clientWidth || 0;
      const m = measure.current;
      if (!w || !m) return;
      const at100 = m.getBoundingClientRect().width;
      const size = (w / at100) * 100 * 0.975; // small margin so the last glyph's overhang stays on screen
      setFs(size);
      setW(w);
      requestAnimationFrame(() => {
        const spans = wrap.current?.querySelectorAll(".wm-l");
        if (!spans) return;
        const left = wrap.current.getBoundingClientRect().left;
        setOffsets(Array.from(spans).map((s) => s.getBoundingClientRect().left - left));
      });
    };
    document.fonts?.ready.then(fit);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const move = (e) => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r) return;
      const inside = e.clientY > r.top - 120 && e.clientY < r.bottom + 160;
      mx.set(inside ? (e.clientX - r.left) / r.width : -1);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [mx]);
  const letters = text.split("");
  const grad = `linear-gradient(180deg, rgb(184 0 0 / 0) 20%, rgb(184 0 0 / .85) 100%), radial-gradient(56% 156% at 47.1% 1.9%, var(--cyan) 0%, var(--teal) 100%)`;
  return (
    <div ref={wrap} className="relative w-full select-none" aria-label={text} role="img">
      <span ref={measure} aria-hidden style={{ position: "absolute", visibility: "hidden", fontSize: 100, fontWeight: 500, letterSpacing: "-0.075em", whiteSpace: "nowrap", lineHeight: 1 }}>
        {text}
      </span>
      <div className="flex whitespace-nowrap" style={{ fontSize: fs || "28vw", fontWeight: 500, letterSpacing: "-0.075em", lineHeight: 0.8, paddingBottom: "0.04em" }} aria-hidden>
        {letters.map((ch, i) => (
          <Letter key={i} ch={ch} i={i} n={letters.length} mx={mx} scrollY={scrollY} reduce={reduce} delay={delay}
            style={{ backgroundImage: grad, backgroundSize: `${W}px 100%`, backgroundPosition: `${-(offsets[i] || 0)}px 0` }} />
        ))}
      </div>
    </div>
  );
}

function Letter({ ch, i, n, mx, scrollY, reduce, delay, style }) {
  const center = (i + 0.5) / n;
  const lift = useTransform(mx, (v) => (v < 0 ? 0 : -Math.exp(-((v - center) ** 2) / 0.012) * 7));
  const spring = useSpring(lift, { stiffness: 180, damping: 18 });
  const liftPct = useTransform(spring, (v) => `${v}%`);
  const skew = useTransform(mx, (v) => (v < 0 ? 0 : (center - v) * 6));
  const skewS = useSpring(skew, { stiffness: 140, damping: 20 });
  const drift = useTransform(scrollY, [0, 900], [0, -(40 + ((i * 37) % 5) * 28)]);
  return (
    <span className="inline-block" style={{ overflowX: "visible", overflowY: "clip", paddingBottom: "0.06em", marginBottom: "-0.06em" }}>
      <motion.span className="inline-block" style={{ y: reduce ? 0 : drift }}>
        <motion.span
          className="inline-block"
          initial={reduce ? false : { y: "105%" }}
          animate={{ y: "0%" }}
          transition={{ duration: 1.3, ease: [0.18, 0.66, 0.18, 1], delay: delay + i * 0.07 }}
        >
          <motion.span className="inline-block" style={reduce ? undefined : { y: liftPct, skewX: skewS }}>
            <span className="wm-l inline-block" style={{ ...style, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{ch}</span>
          </motion.span>
        </motion.span>
      </motion.span>
    </span>
  );
}

/* ------------------------------------------------------------------ tilt card */
/** Card that tilts toward the pointer, with an inner layer moving the other way and a light spot. */
export function TiltCard({ children, className = "", to, href, cursor = "View", max = 5 }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, { stiffness: 160, damping: 20 });
  const sy = useSpring(py, { stiffness: 160, damping: 20 });
  const rotY = useTransform(sx, [0, 1], [-max, max]);
  const rotX = useTransform(sy, [0, 1], [max, -max]);
  const ix = useTransform(sx, [0, 1], ["1.5%", "-1.5%"]);
  const iy = useTransform(sy, [0, 1], ["1.5%", "-1.5%"]);
  const shine = useTransform([sx, sy], ([a, b]) => `radial-gradient(circle at ${a * 100}% ${b * 100}%, rgb(255 255 255 / .55), transparent 45%)`);
  // Scroll: scale in on enter, inner parallax, skew with scroll velocity.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const scale = useTransform(scrollYProgress, [0, 0.35], [0.86, 1]);
  const radius = useTransform(scrollYProgress, [0, 0.35], [28, 6]);
  const par = useTransform(scrollYProgress, [0, 1], ["-2%", "2%"]);
  const { scrollY } = useScroll();
  const vel = useVelocity(scrollY);
  const skew = useSpring(useTransform(vel, [-3000, 0, 3000], [2.5, 0, -2.5]), { stiffness: 200, damping: 30 });
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const reset = () => { px.set(0.5); py.set(0.5); };
  const Tag = to ? Link : "a";
  const linkProps = to ? { to } : { href, target: href?.startsWith("http") || href?.startsWith("/reports") ? "_blank" : undefined, rel: "noreferrer" };
  return (
    <div style={{ perspective: 1400 }}>
      <motion.div ref={ref} style={reduce ? undefined : { scale, rotateX: rotX, rotateY: rotY, borderRadius: radius }} className={`feat__card ${className}`}
        onMouseMove={onMove} onMouseLeave={reset} data-cursor={cursor}>
        <Tag {...linkProps} className="absolute inset-0 z-[3]" aria-label={cursor} />
        <motion.div className="feat__media" style={reduce ? undefined : { x: ix, y: par, skewY: skew }}>
          <motion.div className="absolute inset-0" style={reduce ? undefined : { y: iy }}>{children}</motion.div>
        </motion.div>
        <motion.div className="feat__shine" style={{ background: shine }} />
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ liquid word */
/** Word whose colour pools from the pointer position on hover. */
export function LiquidWord({ children, color, className = "", style }) {
  const ref = useRef(null);
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <motion.span
      ref={ref}
      className={`liquid inline-block ${className}`}
      style={{ ...style, ...(color ? { "--liquid-from": color } : {}) }}
      onMouseMove={onMove}
      onMouseEnter={(e) => { onMove(e); ref.current.style.setProperty("--r", "260px"); }}
      onMouseLeave={() => ref.current.style.setProperty("--r", "0px")}
    >
      {children}
    </motion.span>
  );
}

/* ------------------------------------------------------------------ direction-aware fill */
const CLOSED = { l: "inset(0% 100% 0% 0%)", r: "inset(0% 0% 0% 100%)", t: "inset(0% 0% 100% 0%)", b: "inset(100% 0% 0% 0%)" };
const nearestSide = (e, el) => {
  const r = el.getBoundingClientRect();
  const d = { l: e.clientX - r.left, r: r.right - e.clientX, t: e.clientY - r.top, b: r.bottom - e.clientY };
  return Object.keys(d).reduce((a, k) => (d[k] < d[a] ? k : a), "l");
};
/** Fill that sweeps in from the side the pointer entered and leaves through the side it exited. */
export function useDirFill() {
  const controls = useAnimationControls();
  const [hot, setHot] = useState(false);
  const ease = { duration: 0.5, ease: [0.11, 0.06, 0.18, 1] };
  return {
    hot,
    controls,
    handlers: {
      onMouseEnter: (e) => {
        controls.set({ clipPath: CLOSED[nearestSide(e, e.currentTarget)] });
        controls.start({ clipPath: "inset(0% 0% 0% 0%)", transition: ease });
        setHot(true);
      },
      onMouseLeave: (e) => {
        controls.start({ clipPath: CLOSED[nearestSide(e, e.currentTarget)], transition: ease });
        setHot(false);
      },
    },
  };
}

/* ------------------------------------------------------------------ roll link */
const ArrowSvg = ({ className = "" }) => (
  <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M1 7h11M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export function RollLink({ to, href, children, className = "" }) {
  const inner = (
    <>
      <span className="roll__clip">
        <span className="roll__t">{children}</span>
        <span className="roll__t roll__t--b" aria-hidden>{children}</span>
      </span>
      <span className="roll__arrs"><ArrowSvg className="roll__arr" /><ArrowSvg className="roll__arr roll__arr--b" /></span>
    </>
  );
  if (to) return <Link to={to} className={`roll ${className}`}>{inner}</Link>;
  return <a href={href} className={`roll ${className}`} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{inner}</a>;
}

/* ------------------------------------------------------------------ clock + health */
export function useClock() {
  const fmt = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const [t, setT] = useState(fmt);
  useEffect(() => { const id = setInterval(() => setT(fmt()), 10000); return () => clearInterval(id); }, []);
  return t;
}

let healthPromise = null;
/** Live /health from the PRISM API (null while loading, false if the API is offline). */
export function useHealth() {
  const [h, setH] = useState(null);
  useEffect(() => {
    healthPromise = healthPromise || fetch("/health").then((r) => (r.ok ? r.json() : false)).catch(() => false);
    let live = true;
    healthPromise.then((v) => live && setH(v));
    return () => { live = false; };
  }, []);
  return h;
}
