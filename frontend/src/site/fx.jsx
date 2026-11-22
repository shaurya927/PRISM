// Pointer- and scroll-driven effects for the website: cursor, WebGL hero wave, split wordmark,
// tilt cards, liquid text, direction-aware fills, roll links, live clock and /health status.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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

/* ------------------------------------------------------------------ WebGL wave */
const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
const FRAG = `precision highp float;
uniform vec2 uRes;uniform float uTime;uniform vec2 uMouse;uniform float uAmt;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<4;i++){v+=a*n(p);p=m*p;a*=.5;}return v;}
void main(){
 vec2 uv=gl_FragCoord.xy/uRes;float ar=uRes.x/uRes.y;
 vec2 p=vec2(uv.x*ar,uv.y);vec2 m=vec2(uMouse.x*ar,uMouse.y);
 float d=distance(p,m);
 p+=(p-m)*uAmt*.55*exp(-d*d*5.);
 float t=uTime*.055;
 vec2 q=vec2(fbm(p*1.3+vec2(0.,t)),fbm(p*1.3+vec2(5.2,-t)));
 vec2 r=vec2(fbm(p*1.5+3.*q+vec2(1.7,9.2)+t*1.4),fbm(p*1.5+3.*q+vec2(8.3,2.8)-t));
 float f=fbm(p*1.15+3.4*r);
 float silk=.5+.5*sin(9.*f+t*5.+r.x*4.);
 float band=smoothstep(.45,1.,f*1.25)*silk;
 vec3 black=vec3(.059,0.,0.);vec3 deep=vec3(.42,0.,0.);vec3 red=vec3(1.,.04,0.);vec3 pink=vec3(1.,.70,.70);
 vec3 c=mix(black,deep,smoothstep(.25,.75,f));
 c=mix(c,red,band*.8);
 c=mix(c,pink,pow(band,5.)*.45);
 c+=red*.22*uAmt*exp(-d*d*9.);
 c*=mix(.25,1.,smoothstep(-.1,.75,uv.y));
 gl_FragColor=vec4(c,1.);
}`;

export function WaveCanvas({ className = "" }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const [ok, setOk] = useState(true);
  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) { setOk(false); return; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setOk(false); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uMouse = gl.getUniformLocation(prog, "uMouse");
    const uAmt = gl.getUniformLocation(prog, "uAmt");
    const scale = 0.5; // render below CSS resolution; the wave is soft anyway
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(2, Math.round(r.width * scale));
      canvas.height = Math.max(2, Math.round(r.height * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const target = { x: 0.5, y: 0.6, amt: 0 };
    const cur = { x: 0.5, y: 0.6, amt: 0 };
    let lastMove = 0;
    const move = (e) => {
      const r = canvas.getBoundingClientRect();
      target.x = (e.clientX - r.left) / r.width;
      target.y = 1 - (e.clientY - r.top) / r.height;
      lastMove = performance.now();
    };
    window.addEventListener("pointermove", move, { passive: true });
    let visible = true;
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; });
    io.observe(canvas);
    let raf;
    const t0 = performance.now();
    let last = 0;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (!visible || now - last < 30) return; // ~30 fps is plenty for a slow wave
      last = now;
      target.amt = now - lastMove < 1200 ? 1 : 0;
      cur.x += (target.x - cur.x) * 0.06;
      cur.y += (target.y - cur.y) * 0.06;
      cur.amt += (target.amt - cur.amt) * 0.04;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, reduce ? 20 : (now - t0) / 1000);
      gl.uniform2f(uMouse, cur.x, cur.y);
      gl.uniform1f(uAmt, cur.amt);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (reduce) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", move);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [reduce]);
  return (
    <div className={`hero__wave ${className}`}>
      {ok ? <canvas ref={ref} aria-hidden /> : <div className="hero__fallback" />}
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
