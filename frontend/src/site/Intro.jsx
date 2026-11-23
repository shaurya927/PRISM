// First-visit intro: a car drives up the highway toward a CCTV camera, the camera locks onto it
// and its plate, the plate is read character by character (each starts as ?), then the registry
// details appear. The plate, scores and registry record are PRISM's real output for
// day_clear_white.mp4 (see data/cases.json).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { HighwayCanvas, useClock } from "./fx.jsx";
import { projector } from "./highway.js";
import { caseById } from "./data/content.js";

const EASE_SHEET = [0.76, 0, 0.24, 1];
const LANE = 1.9; // the car uses the inner oncoming lane; the camera sits over it
const T = { drive0: 0.25, drive1: 2.7, flash: 2.72, box: 2.8, plate: 3.15, read: 3.4, details: 4.25, end: 5.4 };
const STAGES = [
  [0, "Watching CAM 04 · NH-30"],
  [1.3, "Tracking vehicle · YOLO11 + ByteTrack"],
  [T.box, "Plate detected · fast-alpr"],
  [T.read, "Reading plate · PARSeq"],
  [T.details, "Registry match"],
];

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = (u) => 1 - (1 - u) ** 3;
const prog = (t, a, b) => clamp((t - a) / (b - a));

function useViewport() {
  const [v, setV] = useState(() => ({ W: window.innerWidth, H: window.innerHeight }));
  useEffect(() => {
    const on = () => setV({ W: window.innerWidth, H: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}

/** Camera and final car size for this viewport, so the stopped car fills the lower middle. */
function useStage({ W, H }) {
  return useMemo(() => {
    const narrow = W < 900;
    const horizon = narrow ? 0.34 : 0.44;
    const opts = { focal: 0.95, horizon, camX: LANE };
    const f = projector(W, H, { ...opts, camH: 1 }).f;
    // Desktop: the plate panel (~370 px) and details panel (~290 px) sit either side of the car,
    // so the car is never wider than the space they leave.
    const side = W - 56 - 68 - 380 - 300;
    const wpx = narrow ? W * 0.66 : Math.min(W >= 1200 ? Math.min(W * 0.34, 560) : W * 0.3, side * 0.96);
    const groundY = narrow ? H * 0.5 : H * 0.88;
    let s = wpx / 1.8;
    s = Math.min(s, (groundY - H * 0.1) / 1.45);
    const camH = clamp((groundY - H * horizon) / s, 0.8, 3.2);
    return { narrow, opts: { ...opts, camH }, zEnd: f / s, zFar: 150 };
  }, [W, H]);
}

function Car({ plate }) {
  const p = `${plate.slice(0, 2)} ${plate.slice(2, 4)} ${plate.slice(4, 6)} ${plate.slice(6)}`;
  return (
    <svg viewBox="0 0 400 260" width="100%" height="100%" aria-hidden>
      <defs>
        <linearGradient id="ic-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9d3d1" />
          <stop offset="0.55" stopColor="#a49c9a" />
          <stop offset="1" stopColor="#5e5655" />
        </linearGradient>
        <linearGradient id="ic-roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9c2c0" />
          <stop offset="1" stopColor="#8d8584" />
        </linearGradient>
        <linearGradient id="ic-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a1416" />
          <stop offset="1" stopColor="#090506" />
        </linearGradient>
        <radialGradient id="ic-pool" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ecf6ff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ecf6ff" stopOpacity="0" />
        </radialGradient>
        <filter id="ic-bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <ellipse cx="200" cy="246" rx="235" ry="16" fill="url(#ic-pool)" />
      <ellipse cx="200" cy="241" rx="186" ry="9" fill="#000" opacity="0.7" />
      <rect x="40" y="196" width="52" height="46" rx="9" fill="#0a0808" />
      <rect x="308" y="196" width="52" height="46" rx="9" fill="#0a0808" />
      <path d="M86 124 L117 54 Q121 45 132 45 L268 45 Q279 45 283 54 L314 124 Z" fill="url(#ic-roof)" />
      <path d="M103 120 L129 60 Q132 54 140 54 L260 54 Q268 54 271 60 L297 120 Z" fill="url(#ic-glass)" />
      <path d="M152 60 L178 60 L141 116 L117 116 Z" fill="#fff" opacity="0.07" />
      <path d="M66 112 L90 105 L93 123 L68 125 Q63 119 66 112 Z" fill="#7a7271" />
      <path d="M334 112 L310 105 L307 123 L332 125 Q337 119 334 112 Z" fill="#7a7271" />
      <path d="M22 152 Q22 130 46 123 L354 123 Q378 130 378 152 L378 206 Q378 221 362 223 L38 223 Q22 221 22 206 Z" fill="url(#ic-body)" />
      <path d="M118 124 L148 144 M282 124 L252 144" stroke="#000" strokeOpacity="0.18" strokeWidth="2" />
      <path d="M36 141 L120 147 L113 166 L45 162 Q34 157 36 141 Z" fill="#f3f8ff" />
      <path d="M364 141 L280 147 L287 166 L355 162 Q366 157 364 141 Z" fill="#f3f8ff" />
      <g filter="url(#ic-bloom)" opacity="0.9">
        <ellipse cx="78" cy="154" rx="40" ry="11" fill="#fff" />
        <ellipse cx="322" cy="154" rx="40" ry="11" fill="#fff" />
      </g>
      <path d="M42 144 L116 149" stroke="#bfe9ff" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M358 144 L284 149" stroke="#bfe9ff" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M131 149 L269 149 L261 175 L139 175 Z" fill="#100c0d" />
      {[155, 162, 169].map((y) => <path key={y} d={`M${136 + (y - 149) * 0.3} ${y} L${264 - (y - 149) * 0.3} ${y}`} stroke="#2a2223" strokeWidth="2" />)}
      <ellipse cx="200" cy="160" rx="11" ry="6" fill="none" stroke="#cfc8c6" strokeWidth="2" />
      <rect x="64" y="196" width="272" height="17" rx="7" fill="#1d1718" />
      <circle cx="80" cy="205" r="5" fill="#ffe7c2" />
      <circle cx="320" cy="205" r="5" fill="#ffe7c2" />
      <rect x="151" y="179" width="98" height="23" rx="2.5" fill="#f5f5f1" stroke="#1a1a1a" strokeWidth="1.5" />
      <rect x="152" y="180" width="10" height="21" fill="#1d4fa8" />
      <text x="157" y="194" fontSize="4.6" fill="#fff" textAnchor="middle" fontFamily="sans-serif" fontWeight="700">IND</text>
      <text x="206" y="195" fontSize="11" fill="#111" textAnchor="middle" textLength="80" lengthAdjust="spacingAndGlyphs"
        fontFamily="'Geist Mono Variable', monospace" fontWeight="700">{p}</text>
    </svg>
  );
}

function Brackets({ className = "" }) {
  return (
    <span className={`ibx ${className}`}>
      <i /><i /><i /><i />
    </span>
  );
}

export default function Intro({ onLeave, onDone }) {
  const vp = useViewport();
  const stage = useStage(vp);
  const c = caseById("day_clear_white");
  const top = c?.top?.[0];
  const plate = c?.fused || "CG04MX4821";
  const [t, setT] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const skipped = useRef(false);
  const clock = useClock();

  useEffect(() => {
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      // rAF timestamps are the frame start, which can be slightly before t0
      const v = skipped.current ? T.end : Math.max(0, (now - t0) / 1000);
      setT(v);
      if (v >= T.end) { setLeaving(true); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const key = (e) => { if (e.key === "Escape") skipped.current = true; };
    window.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", key); };
  }, []);
  useEffect(() => { if (leaving) onLeave?.(); }, [leaving, onLeave]);

  // car position for this instant
  const P = projector(vp.W, vp.H, stage.opts);
  const u = easeOut(prog(t, T.drive0, T.drive1));
  const z = stage.zFar + (stage.zEnd - stage.zFar) * u;
  const g = P.p(LANE, z);
  const wpx = 1.8 * g.s;
  const elW = (wpx * 400) / 360;
  const elH = (elW * 260) / 400;
  const shake = Math.sin(t * 46) * 0.8 * (1 - u);
  const car = { left: g.x - elW / 2, top: g.y - (240 / 260) * elH + shake, w: elW, h: elH };
  const vb = (x, y) => ({ x: car.left + (x / 400) * car.w, y: car.top + (y / 260) * car.h });
  const a = vb(14, 40), b = vb(386, 248);
  const box = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  const pa = vb(146, 175), pb = vb(254, 206);
  const pbox = { x: pa.x, y: pa.y, w: pb.x - pa.x, h: pb.y - pa.y };
  const lights = [vb(78, 154), vb(322, 154)];
  const glowR = Math.max(34, wpx * 0.42);
  const glowA = 0.95 - 0.45 * u;

  const flash = t > T.flash ? Math.max(0, 0.45 - (t - T.flash) * 1.6) : 0;
  const pct = Math.round(clamp(t / T.end) * 100);
  const label = pct >= 100 ? "Ready" : ([...STAGES].reverse().find(([s]) => t >= s) || STAGES[0])[1];
  const nar = stage.narrow;
  const platePanel = nar
    ? { left: "50%", top: box.y + box.h + 14, x: "-50%" }
    : { left: box.x - 34, top: pbox.y + pbox.h / 2, x: "-100%", y: "-50%" };
  const detailPanel = nar
    ? { left: "50%", top: box.y + box.h + 124, x: "-50%" }
    : { left: box.x + box.w + 34, top: Math.max(56, Math.min(box.y + 6, vp.H - 210)) };
  const short = !nar && vp.H < 640; // landscape laptops with little height: drop secondary lines
  const show = (k) => t >= k;

  return (
    <div className="ld" aria-label="Loading PRISM">
      <motion.div className="ld__sheet" animate={leaving ? { y: "-100%" } : { y: 0 }} transition={{ duration: 0.9, ease: EASE_SHEET, delay: 0.12 }}
        onAnimationComplete={() => leaving && onDone()} />
      <motion.div className="ld__panel intro" animate={leaving ? { y: "-100%" } : { y: 0 }} transition={{ duration: 0.85, ease: EASE_SHEET }}>
        <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
          <HighwayCanvas hud={false} density={0.75} skipLanes={[LANE]} seed={3} {...stage.opts} />
        </motion.div>

        {lights.map((l, i) => (
          <span key={i} className="intro__glow" style={{ left: l.x, top: l.y, width: glowR * 2, height: glowR * 2, opacity: glowA }} />
        ))}
        <div className="intro__car" style={{ left: car.left, top: car.top, width: car.w, height: car.h }}>
          <Car plate={plate} />
        </div>
        <span className="intro__flash" style={{ opacity: flash }} />

        {show(T.box) && (
          <motion.div className="intro__box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            initial={{ opacity: 0, scale: 1.18 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: [0.18, 0.66, 0.18, 1] }}>
            <Brackets />
            <motion.span className="intro__sweep" initial={{ top: "0%", opacity: 1 }} animate={{ top: "100%", opacity: 0 }} transition={{ duration: 0.5, ease: "easeInOut" }} />
            <span className="intro__tag">TRACK 1 · {(c?.body || "car").toUpperCase()} · CAM 04</span>
          </motion.div>
        )}
        {show(T.plate) && (
          <motion.div className="intro__box intro__box--plate" style={{ left: pbox.x, top: pbox.y, width: pbox.w, height: pbox.h }}
            initial={{ opacity: 0, scale: 1.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: [0.18, 0.66, 0.18, 1] }}>
            <Brackets className="ibx--red" />
          </motion.div>
        )}

        {show(T.read - 0.15) && (
          <motion.div className="intro__panel" style={platePanel} initial={{ opacity: 0, y: nar ? 10 : "-50%", x: platePanel.x, scale: 0.96 }}
            animate={{ opacity: 1, y: nar ? 0 : "-50%", x: platePanel.x, scale: 1 }} transition={{ duration: 0.45, ease: [0.18, 0.66, 0.18, 1] }}>
            <div className="intro__lbl">PLATE · FUSED FROM {c?.reads ?? 24} READS</div>
            <div className="intro__cells">
              {plate.split("").map((ch, i) => {
                const known = t >= T.read + 0.12 + i * 0.075;
                return <span key={i} className={`intro__cell ${known ? "" : "is-q"}`}>{known ? ch : "?"}</span>;
              })}
            </div>
            <div className="intro__sub">
              {t >= T.read + 0.12 + 10 * 0.075 ? `${plate.length} of ${plate.length} characters read clearly` : "unread characters stay ?"}
            </div>
            {!nar && <motion.span className="intro__wire intro__wire--l" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.35, delay: 0.1 }} />}
          </motion.div>
        )}

        {show(T.details) && top && (
          <motion.div className="intro__panel intro__panel--det" style={detailPanel} initial={{ opacity: 0, x: nar ? "-50%" : 18 }}
            animate={{ opacity: 1, x: nar ? "-50%" : 0 }} transition={{ duration: 0.5, ease: [0.18, 0.66, 0.18, 1] }}>
            {!nar && <motion.span className="intro__wire intro__wire--r" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.35 }} />}
            <div className="flex items-center justify-between gap-4">
              <span className="intro__lbl">REGISTRY MATCH</span>
              <span className="chip chip--ok">{c.status}</span>
            </div>
            {[
              <div key="id" className="intro__rid">{top.id}</div>,
              <div key="mm" className="intro__row">{top.model} · {top.color} {top.body}</div>,
              <div key="sc" className="intro__row intro__mono">score {top.score.toFixed(2)} · τ 0.55</div>,
              !nar && !short && <div key="cl" className="intro__row intro__muted">colour seen as {c.color}, kept out of the decision</div>,
            ].filter(Boolean).map((el, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.09, duration: 0.4 }}>{el}</motion.div>
            ))}
          </motion.div>
        )}

        <div className="intro__hud">
          <span><span className="rec" />REC</span>
          <span>CAM 04 · NH-30 · KM 42</span>
          <span className="hidden sm:inline">{clock}</span>
        </div>
        <button type="button" className="intro__skip f-u" onClick={() => { skipped.current = true; }}>skip intro →</button>
        <div className="ld__labels" style={{ opacity: short && show(T.read - 0.15) ? 0 : 1, transition: "opacity .3s" }}>
          <motion.span key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>{label}</motion.span>
        </div>
        <div className="ld__count intro__count" style={{ opacity: (nar || vp.H < 640) && show(T.details) ? 0 : undefined, transition: "opacity .3s" }}>
          {String(pct).padStart(3, "0")}<span className="ld__pct">%</span>
        </div>
        <div className="ld__bar" style={{ transform: `scaleX(${pct / 100})` }} />
      </motion.div>
    </div>
  );
}
