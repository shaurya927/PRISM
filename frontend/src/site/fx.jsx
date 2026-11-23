// Effects for the website: CCTV highway feed, feature cards,
// direction-aware fills, roll links, live clock and /health status.
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createFeedHud } from "./feed.js";
import { useAnimationControls, useReducedMotion } from "framer-motion";

/* ------------------------------------------------------------------ CCTV highway */
/**
 * Real night-freeway footage (public/media/highway.mp4, credits in public/media/CREDITS.md) with
 * PRISM's detector boxes drawn over it (see feed.js).
 * hud: draw the tracking overlay; zone: [x0, y0, x1, y1] area the overlay may use;
 * avoid: CSS selector of elements the boxes must not cover;
 * labels: draw track and plate tags; onCount(n): number of vehicles currently tracked.
 */
export function HighwayFeed({ className = "", hud = true, zone, avoid, labels = true, onCount }) {
  const vid = useRef(null);
  const cv = useRef(null);
  const reduce = useReducedMotion();
  const countRef = useRef(onCount);
  countRef.current = onCount;
  const zoneKey = zone ? zone.join(",") : "";
  useEffect(() => {
    const v = vid.current;
    v.muted = true; // set the property too: React does not always reflect the muted attribute
    if (reduce) v.pause();
    else v.play().catch(() => {});
    const h = createFeedHud(cv.current, v, {
      hud, labels, avoid, still: !!reduce, zone: zoneKey ? zoneKey.split(",").map(Number) : null,
      onCount: (n) => countRef.current?.(n),
    });
    return () => h.destroy();
  }, [hud, labels, avoid, zoneKey, reduce]);
  return (
    <div className={`hwy ${className}`}>
      <video ref={vid} className="hwy__vid" poster="/media/highway.jpg" muted loop playsInline autoPlay={!reduce} preload="auto" aria-hidden>
        <source src="/media/highway.webm" type="video/webm" />
        <source src="/media/highway.mp4" type="video/mp4" />
      </video>
      <canvas ref={cv} aria-hidden />
      <div className="hwy__fx" aria-hidden />
    </div>
  );
}

/* ------------------------------------------------------------------ feature card */
/** Feature card: a flat 16:9 surface that links somewhere. No tilt, no shine, no scroll skew. */
export function FeatureCard({ children, className = "", to, href, label = "View" }) {
  const Tag = to ? Link : "a";
  const linkProps = to ? { to } : { href, target: href?.startsWith("http") || href?.startsWith("/reports") ? "_blank" : undefined, rel: "noreferrer" };
  return (
    <div className={`feat__card ${className}`}>
      <Tag {...linkProps} className="absolute inset-0 z-[3] rounded-[inherit]" aria-label={label} />
      <div className="feat__media">{children}</div>
    </div>
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
  const ease = { duration: 0.3, ease: [0.22, 1, 0.36, 1] };
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
