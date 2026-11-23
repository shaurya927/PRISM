// First-visit intro. A live night-freeway feed runs with PRISM's real detector boxes on it
// (feed.js). Then the camera grabs the vehicle: a Hyundai Verna turns through a full circle and stops
// facing the camera, with the car and plate boxes following it frame by frame (verna_spin.json), the
// plate is read character by character (each starts as ?), and the registry record appears.
//
// The plate, read count, plate crops, scores and registry record are PRISM's real output for
// day_clear_white.mp4 (data/cases.json). The turning car is studio footage of a Verna (credits in
// public/media/CREDITS.md); its plates were blanked in the source, and the plate drawn on them is the
// one PRISM read from the clip.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { HighwayFeed, useClock } from "./fx.jsx";
import { caseById } from "./data/content.js";
import { statusLabel } from "./components.jsx";

const EASE_SHEET = [0.76, 0, 0.24, 1];
const EASE_OUT = [0.18, 0.66, 0.18, 1];
const RATE = 1.2; // spin playback speed
const SPIN = 70 / 30 / RATE; // seconds the turn takes on screen
const T0 = { flash: 2.45, cap: 2.5 };
// The plate box waits for the car to stop: during the turn the plate moves too fast for an HTML overlay
// to stay on it frame-accurately, and the stopped, face-on frame is the best plate frame anyway.
const T = { ...T0, box: T0.cap + 0.2, pbox: T0.cap + SPIN, spun: T0.cap + SPIN, read: T0.cap + SPIN + 0.15,
  details: T0.cap + SPIN + 0.9, end: T0.cap + SPIN + 2.3 };
const ASPECT = 1912 / 1046;
const MAX_WAIT = 5; // seconds the intro holds for the spin video before using its still frame

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const pct = (r) => (r ? { left: `${r[0] / 10}%`, top: `${r[1] / 10}%`, width: `${r[2] / 10}%`, height: `${r[3] / 10}%` } : null);

function useViewport() {
  const [v, setV] = useState(() => ({ W: window.innerWidth, H: window.innerHeight }));
  useEffect(() => {
    const on = () => setV({ W: window.innerWidth, H: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}

/** Where the capture frame and the two panels go for this viewport. */
function useLayout({ W, H }) {
  return useMemo(() => {
    const narrow = W < 900;
    if (narrow) {
      const g = 20;
      const w = W - g * 2;
      const h = w / ASPECT;
      const top = Math.max(64, Math.min(H * 0.1, 90));
      return { narrow, cap: { left: g, top, width: w, height: h }, plate: { left: g, top: top + h + 12, width: w }, det: { left: g, top: top + h + 176, width: w } };
    }
    const col = 380, gap = 28, side = 56;
    const short = H < 640;
    const w = Math.min(W - side * 2 - col - gap, (H - (short ? 140 : 210)) * ASPECT, 960);
    const h = w / ASPECT;
    const left = (W - (w + gap + col)) / 2;
    const top = Math.max(64, (H - h) / 2 - (short ? 4 : 14));
    return { narrow, short, cap: { left, top, width: w, height: h }, plate: { left: left + w + gap, top: short ? 56 : top - 40, width: col },
      det: { left: left + w + gap, top: (short ? 56 : top - 40) + (short ? 122 : 160), width: col } };
  }, [W, H]);
}

function Brackets({ className = "" }) {
  return (
    <span className={`ibx ${className}`}>
      <i /><i /><i /><i />
    </span>
  );
}

let spinPromise = null;
const loadSpin = () => (spinPromise = spinPromise || fetch("/media/verna_spin.json").then((r) => (r.ok ? r.json() : null)).catch(() => null));

export default function Intro({ onLeave, onDone }) {
  const vp = useViewport();
  const L = useLayout(vp);
  const reduce = useReducedMotion();
  const c = caseById("day_clear_white");
  const top = c?.top?.[0];
  const plate = c?.fused || "CG04MX4821";
  const [t, setT] = useState(0);
  const [count, setCount] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [spin, setSpin] = useState(null);
  const vid = useRef(null);
  const ready = useRef(false); // spin video can play through
  const still = useRef(!!reduce); // show the last frame instead of playing
  const started = useRef(false);
  const skipped = useRef(false);
  const clock = useClock();

  const shown = useRef(-1); // index of the spin frame actually on screen (-1 = use currentTime)
  useEffect(() => { loadSpin().then(setSpin); }, []);
  useEffect(() => {
    const v = vid.current;
    if (!v) return undefined;
    v.muted = true;
    v.playbackRate = RATE;
    const ok = () => { ready.current = true; };
    if (v.readyState >= 3) ok();
    v.addEventListener("canplaythrough", ok);
    v.addEventListener("error", () => { still.current = true; });
    // currentTime runs ahead of the presented frame; the frame callback reports the one on screen,
    // so the boxes stay on the car and plate while it turns
    let id = 0;
    const onFrame = (_, meta) => { shown.current = Math.round(meta.mediaTime * 30); id = v.requestVideoFrameCallback(onFrame); };
    if (v.requestVideoFrameCallback) id = v.requestVideoFrameCallback(onFrame);
    return () => {
      v.removeEventListener("canplaythrough", ok);
      if (id) v.cancelVideoFrameCallback?.(id);
    };
  }, []);

  useEffect(() => {
    let raf;
    let last = performance.now();
    let clockT = 0;
    let waited = 0;
    const tick = (now) => {
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      // hold just before the grab while the spin video is still loading
      if (!ready.current && !still.current && clockT + dt >= T.cap - 0.06) {
        waited += dt;
        if (waited > MAX_WAIT) still.current = true;
      } else {
        clockT += dt;
      }
      const v = skipped.current ? T.end : clockT;
      const el = vid.current;
      if (el && v >= T.cap && !started.current) {
        started.current = true;
        if (still.current) { el.currentTime = el.duration || 99; }
        else { el.playbackRate = RATE; el.play().catch(() => { el.currentTime = el.duration || 99; }); }
      }
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

  const show = (k) => t >= k;
  const flash = t > T.flash ? Math.max(0, 0.5 - (t - T.flash) * 1.8) : 0;
  const prog = Math.round(clamp(t / T.end) * 100);
  const holding = !ready.current && !still.current && t >= T.cap - 0.1;
  const stages = [
    [0, "Watching CAM 04 · live"],
    [0.7, `Tracking ${count || "…"} vehicles · YOLO11 + ByteTrack`],
    [T.cap, "Vehicle locked · tracking as it turns"],
    [T.pbox, "Best plate frame · plate detected"],
    [T.read, "Reading plate · PARSeq"],
    [T.details, "Registry match"],
  ];
  const label = prog >= 100 ? "Ready" : holding ? "Loading footage…" : ([...stages].reverse().find(([s]) => t >= s) || stages[0])[1];
  const readDone = T.read + 0.12 + plate.length * 0.075;
  const { narrow, short } = L;
  const capOn = show(T.cap) && !holding;

  // boxes for the frame on screen
  let carBox = null, plateBox = null;
  if (spin && capOn) {
    const el = vid.current;
    const n = spin.frames.length;
    const live = el && !el.ended && el.currentTime < (el.duration || 1e9) - 0.02;
    const k = !live ? n - 1 : shown.current >= 0 ? shown.current : Math.floor(el.currentTime * spin.fps);
    [carBox, plateBox] = spin.frames[clamp(k, 0, n - 1)].map(pct);
  }
  // the panel title is the make and model, and the plate panel above shows the plate
  const rows = top ? [
    !(narrow || short) && ["Registered plate", top.plate],
    ["Make", top.model?.split(" ")[0]],
    ["Body", [top.style, top.body].filter(Boolean).join(" · ")],
    ["Registered colour", top.color],
    ["Registered in", top.region],
  ].filter((r) => r && r[1]) : [];

  return (
    <div className="ld" aria-label="Loading PRISM">
      <motion.div className="ld__sheet" animate={leaving ? { y: "-100%" } : { y: 0 }} transition={{ duration: 0.9, ease: EASE_SHEET, delay: 0.12 }}
        onAnimationComplete={() => leaving && onDone()} />
      <motion.div className="ld__panel intro" animate={leaving ? { y: "-100%" } : { y: 0 }} transition={{ duration: 0.85, ease: EASE_SHEET }}>
        <motion.div className="absolute inset-0" initial={{ opacity: 0 }} transition={{ duration: 0.6 }}
          animate={{ opacity: capOn ? 0.3 : 1, filter: capOn ? "blur(3px)" : "blur(0px)" }}>
          <HighwayFeed onCount={setCount} labels={!capOn} />
        </motion.div>

        {/* always mounted so the spin video loads while the feed plays */}
        <motion.div className="cap" style={{ ...L.cap, pointerEvents: "none" }} initial={false}
          animate={capOn ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.06 }} transition={{ duration: 0.5, ease: EASE_OUT }}>
          <div className="cap__media">
            <video ref={vid} className="cap__vid" poster="/media/verna_spin.jpg" muted playsInline preload="auto" aria-hidden>
              <source src="/media/verna_spin.webm" type="video/webm" />
              <source src="/media/verna_spin.mp4" type="video/mp4" />
            </video>
            {show(T.box) && carBox && (
              <div className="intro__box" style={carBox}>
                <motion.div className="absolute inset-0" initial={{ opacity: 0, scale: 1.08 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: EASE_OUT }}>
                  <Brackets />
                  <span className="intro__tag intro__tag--in">TRACK 1 · {(top?.model || "car").toUpperCase()}</span>
                </motion.div>
              </div>
            )}
            {show(T.pbox) && plateBox && (
              <div className="intro__box intro__box--plate" style={plateBox}>
                <motion.div className="absolute inset-0" initial={{ opacity: 0, scale: 1.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
                  <Brackets className="ibx--red" />
                </motion.div>
              </div>
            )}
          </div>
          <div className="cap__fx" aria-hidden />
          <div className="cap__hud">
            <span><span className="rec" />CAM 04</span>
            <span className="hidden sm:inline">{show(T.spun) ? "Best plate frame" : "Tracking"} · {clock}</span>
          </div>
          <div className="cap__credit">studio footage · Hyundai Verna</div>
        </motion.div>
        <span className="intro__flash" style={{ opacity: flash }} />

        {show(T.read - 0.15) && (
          <motion.div className="intro__panel" style={L.plate} initial={{ opacity: 0, x: narrow ? 0 : 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.45, ease: EASE_OUT }}>
            <div className="intro__lbl">Plate · fused from {c?.reads ?? 24} reads</div>
            {!short && c?.plates?.length > 0 && (
              <div className="intro__crops">
                {c.plates.map((u, i) => (
                  <motion.img key={u} src={u} alt="" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 * i, duration: 0.3 }} />
                ))}
              </div>
            )}
            <div className="intro__cells">
              {plate.split("").map((ch, i) => {
                const known = t >= T.read + 0.12 + i * 0.075;
                return <span key={i} className={`intro__cell ${known ? "" : "is-q"}`}>{known ? ch : "?"}</span>;
              })}
            </div>
            <div className="intro__sub">
              {t >= readDone ? `${plate.length} of ${plate.length} characters read clearly` : "unread characters stay ?"}
            </div>
          </motion.div>
        )}

        {show(T.details) && top && (
          <motion.div className="intro__panel intro__panel--det" style={L.det} initial={{ opacity: 0, x: narrow ? 0 : 16 }}
            animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }}>
            <div className="flex items-center justify-between gap-4">
              <span className="intro__lbl">Registry match · {top.id}</span>
              <span className="chip chip--ok"><span className="chip__dot" aria-hidden />{statusLabel(c.status)}</span>
            </div>
            <motion.div className="intro__rid" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}>
              {top.model}
            </motion.div>
            <dl className="intro__dl">
              {rows.map(([k, v], i) => (
                <motion.div key={k} className="intro__dr" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 + i * 0.07, duration: 0.35 }}>
                  <dt>{k}</dt><dd>{v}</dd>
                </motion.div>
              ))}
            </dl>
            <motion.div className="intro__row intro__mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.4 }}>
              score {top.score.toFixed(2)} · τ 0.55{!narrow && !short ? ` · colour seen as ${c.color}, not used to decide` : ""}
            </motion.div>
          </motion.div>
        )}

        <div className="intro__hud">
          <span><span className="rec" />REC</span>
          <span>CAM 04 · {count ? `${count} tracked` : "live"}</span>
          <span className="hidden sm:inline">{clock}</span>
        </div>
        <button type="button" className="intro__skip f-u" onClick={() => { skipped.current = true; }}>skip intro →</button>
        <div className="ld__labels" style={{ opacity: short && show(T.read - 0.15) ? 0 : 1, transition: "opacity .3s" }}>
          <motion.span key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>{label}</motion.span>
        </div>
        <div className="ld__count intro__count" style={{ opacity: (narrow || short) && show(T.details) ? 0 : undefined, transition: "opacity .3s" }}>
          {prog}<span className="ld__pct">%</span>
        </div>
        <div className="ld__bar" style={{ transform: `scaleX(${prog / 100})` }} />
      </motion.div>
    </div>
  );
}
