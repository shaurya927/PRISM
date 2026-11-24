// First-visit intro (about 2.8 s; styles: .dec in site.css). The night clip's plate is decoded the way
// PRISM reads it: on a black screen with faint CCTV interference, every position flickers through what
// the clip's 24 frames actually read there (plus OCR look-alikes such as 8/B and 0/O) and locks in from
// left to right. The position the frames never agreed on turns into the red ? cell.
//
// Hand-over, strictly in turn: the finished plate holds for a moment, then its characters glitch back into
// look-alikes and blur away one by one on the black, the red ? last, and the static fades with them. Only
// once the plate is gone (T.reveal) does the black lift and the page, waiting a little smaller behind it,
// fade and grow to full size (onReveal; Layout.jsx animates it). The hero copy is composed behind the black
// from the first frame (onLeave), so the page that opens is already finished.
//
// The plate and every flickering character come from PRISM's real result for night_partial_white.mp4
// (data/cases.json). Layout.jsx shows the intro once per session and skips it under reduced motion.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { caseById } from "./data/content.js";

// seconds from the start
const T = { inEnd: 0.25, lock0: 0.4, step: 0.065, q: 1.12,
  dissolve: 1.5, spread: 0.25, charOut: 0.38, qOut: 1.8, qDur: 0.4, // plate gone by 2.2 s
  reveal: 2.2, black: 0.6, open: 2.3, end: 2.85 };
const TICK = 0.06; // a scrambling character changes this often
// OCR look-alikes, so the scramble looks like a reader torn between candidates
const LOOK = {
  0: "OQD8", O: "0QD", Q: "0O", D: "0O", 1: "Il7", I: "1l", 2: "Z7", Z: "2", 3: "8B", 4: "AH", A: "4", 5: "S6", S: "5",
  6: "Gb5", G: "6C", 7: "1T", 8: "B30", B: "8", C: "G(O", M: "NHW", N: "MH", H: "MN", X: "KY", K: "X", Y: "X",
};
const JUNK = "8B0OQDS5Z2bq{[(_;:j";

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
// stable pseudo-random number in [0, 1) for a position and a tick
const rnd = (i, f = 0) => {
  let h = Math.imul(i + 1, 73856093) ^ Math.imul(f + 7, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** For each position: the characters the frames read there, their look-alikes, and a little junk. */
function buildPools(c, plate) {
  return plate.split("").map((ch, k) => {
    const read = (c?.evidence || []).map((e) => e.chars?.[k]?.[0]).filter(Boolean);
    const base = ch === "?" ? read.join("") : ch;
    const look = Array.from(new Set(base.split(""))).map((x) => LOOK[x] || "").join("");
    return Array.from(new Set((read.join("") + look + JUNK.slice(k % 7, (k % 7) + 6)).split(""))).filter((x) => x !== ch || ch === "?");
  });
}

export default function Intro({ onLeave, onReveal, onDone }) {
  const c = caseById("night_partial_white");
  const plate = c?.fused || "CG04MX48?1";
  const reads = c?.evidence?.length || c?.reads || 24;
  const unknown = plate.split("").filter((ch) => ch === "?").length;
  const pools = useMemo(() => buildPools(c, plate), [c, plate]);
  const lockAt = useMemo(() => plate.split("").map((ch, i) => (ch === "?" ? T.q : T.lock0 + i * T.step + rnd(i, 99) * 0.05)), [plate]);
  const [t, setT] = useState(0);
  const revealed = useRef(false);
  const done = useRef(false);
  const noise = useRef(null);
  const cb = useRef({ onLeave, onReveal, onDone });
  cb.current = { onLeave, onReveal, onDone };

  const reveal = useCallback(() => { if (!revealed.current) { revealed.current = true; cb.current.onReveal?.(); } }, []);
  const finish = useCallback(() => { reveal(); if (!done.current) { done.current = true; cb.current.onDone?.(); } }, [reveal]);

  // the hero copy builds itself behind the black straight away
  useEffect(() => { cb.current.onLeave?.(); }, []);

  // one clock drives the whole timeline
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now) => {
      const v = (now - start) / 1000;
      setT(v);
      if (v >= T.reveal) reveal();
      if (v >= T.end) { finish(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const key = (e) => { if (e.key === "Escape") finish(); };
    window.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", key); };
  }, [reveal, finish]);

  // CCTV interference: faint horizontal streaks and dim blocks, redrawn a dozen times a second
  useEffect(() => {
    const cv = noise.current;
    if (!cv) return undefined;
    const ctx = cv.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let last = 0;
    const fit = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    fit();
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 80) return;
      last = now;
      const W = innerWidth, H = innerHeight;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.012 + Math.random() * 0.02})`;
        ctx.fillRect(Math.random() * W, Math.random() * H, 40 + Math.random() * 150, 8 + Math.random() * 26);
      }
      for (let i = 0; i < 46; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.025 + Math.random() * 0.07})`;
        ctx.fillRect(Math.random() * W, Math.random() * H, 6 + Math.random() * 54, Math.random() < 0.8 ? 1 : 2);
      }
    };
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", fit); };
  }, []);

  const f = Math.floor(t / TICK);
  const bg = 1 - ease(clamp((t - T.reveal) / T.black)); // the black lifts only after the plate has gone
  const fx = 1 - ease(clamp((t - T.dissolve) / (T.reveal + 0.2 - T.dissolve))); // the static fades with the plate
  const enter = ease(clamp(t / T.inEnd));
  // the plate drifts toward the viewer as it lets go
  const lift = ease(clamp((t - T.dissolve) / (T.reveal - T.dissolve)));
  const allRead = t >= T.q + 0.1;
  const capOut = clamp((t - T.dissolve) / 0.25);
  const caption = t < T.lock0 + plate.length * T.step ? `reading ${reads} frames · CAM 04`
    : allRead ? `${plate.length - unknown} of ${plate.length} read · ${unknown} stays ?` : "fusing the reads";

  return (
    <div className={`ld dec ${t >= T.open ? "is-open" : ""}`} style={{ "--bg": bg.toFixed(3) }} role="status" aria-label="Loading PRISM">
      <canvas ref={noise} className="dec__noise" style={{ opacity: fx }} aria-hidden />
      <div className="dec__fx" style={{ opacity: fx }} aria-hidden />
      <div className="dec__stage" aria-hidden style={{ opacity: enter, transform: `scale(${(1.04 - 0.04 * enter + 0.06 * lift).toFixed(4)})` }}>
        <div className="dec__plate">
          {plate.split("").map((ch, i) => {
            const isQ = ch === "?";
            const locked = t >= lockAt[i];
            const pool = pools[i];
            const glyph = (seed) => pool[Math.floor(rnd(i, seed) * pool.length)] || ch;
            if (!locked) {
              const jit = { opacity: 0.5 + rnd(i, f + 3) * 0.45, transform: `translateY(${((rnd(i, f + 5) - 0.5) * 0.07).toFixed(3)}em)`,
                filter: rnd(i, f + 9) > 0.72 ? "blur(1.2px)" : undefined };
              return <span key={i} className="dec__c is-scr" style={jit}>{glyph(f)}</span>;
            }
            const fresh = t - lockAt[i] < 0.14;
            if (isQ) {
              const out = clamp((t - T.qOut) / T.qDur);
              const qs = out > 0 ? { opacity: 1 - ease(out), filter: `blur(${(out * 8).toFixed(1)}px)`, transform: `scale(${(1 - out * 0.3).toFixed(3)})` } : undefined;
              return <span key={i} className={`dec__c is-q ${fresh ? "is-pop" : ""}`} style={qs}>?</span>;
            }
            // letting go: the character glitches back into look-alikes as it blurs and fades
            const out = clamp((t - (T.dissolve + rnd(i, 7) * T.spread)) / T.charOut);
            if (out <= 0) return <span key={i} className={`dec__c ${fresh ? "is-lock" : ""}`}>{ch}</span>;
            const shown = out < 0.62 && rnd(i, f + 11) > 0.35 ? glyph(f + 17) : ch;
            const os = { opacity: (1 - ease(out)) * (0.75 + rnd(i, f + 13) * 0.25), filter: `blur(${(out * 9).toFixed(1)}px)`,
              transform: `translateY(${(-out * 0.12).toFixed(3)}em)` };
            return <span key={i} className="dec__c is-scr" style={os}>{shown}</span>;
          })}
        </div>
        <div className="dec__cap" style={{ opacity: t < 0.2 ? 0 : 1 - capOut }}>{caption}</div>
      </div>
      <button type="button" className="dec__skip f-u" onClick={finish}>skip intro</button>
    </div>
  );
}
