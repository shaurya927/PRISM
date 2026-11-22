import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from "framer-motion";
import Lenis from "lenis";
import { EASE_REVEAL, Magnetic, ScrambleText } from "./motion.jsx";
import { Arrow } from "./components.jsx";
import { NAV, REPO_URL } from "./data/content.js";

const SiteCtx = createContext({ introDone: true, lenis: null });
export const useSite = () => useContext(SiteCtx);

let firstPage = true; // the first page skips the curtain (the intro covers it)

export default function SiteLayout() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduce = useReducedMotion();
  const lenisRef = useRef(null);
  const [introDone, setIntroDone] = useState(() => reduce || sessionStorage.getItem("prism-intro") === "1");
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, autoRaf: true });
    lenisRef.current = lenis;
    return () => { lenis.destroy(); lenisRef.current = null; };
  }, [reduce]);

  useEffect(() => {
    const l = lenisRef.current;
    if (!l) return;
    if (!introDone || menu) l.stop(); else l.start();
  }, [introDone, menu]);

  useEffect(() => { setMenu(false); }, [location.pathname]);

  const titleFor = NAV.find(([, p]) => location.pathname.startsWith(p))?.[0];
  useEffect(() => {
    document.title = titleFor ? `${titleFor} · PRISM` : "PRISM · Plate Recovery & Identification from Surveillance Media";
  }, [titleFor]);

  const toTop = () => {
    if (lenisRef.current) lenisRef.current.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo(0, 0);
  };

  return (
    <SiteCtx.Provider value={{ introDone, lenis: lenisRef }}>
      <div className="site">
        {!introDone && <Intro onDone={() => { sessionStorage.setItem("prism-intro", "1"); setIntroDone(true); }} />}
        <Nav onMenu={() => setMenu(true)} />
        <AnimatePresence>{menu && <MobileMenu onClose={() => setMenu(false)} />}</AnimatePresence>
        <AnimatePresence mode="wait" onExitComplete={toTop}>
          <Page key={location.pathname}>{outlet}</Page>
        </AnimatePresence>
        <ViewBubble />
        <div className="grain" aria-hidden />
      </div>
    </SiteCtx.Provider>
  );
}

function Page({ children }) {
  const skip = firstPage;
  useEffect(() => { firstPage = false; }, []);
  const reduce = useReducedMotion();
  if (reduce) return <div>{children}<Footer /></div>;
  return (
    <motion.div initial={skip ? false : "initial"} animate="enter" exit="exit">
      <motion.div
        className="curtain"
        style={{ originY: 0 }}
        variants={{ initial: { scaleY: 1 }, enter: { scaleY: 0, transition: { duration: 0.85, ease: EASE_REVEAL, delay: 0.05 } }, exit: { scaleY: 0 } }}
      />
      <motion.div
        className="curtain curtain--in"
        style={{ originY: 1 }}
        variants={{ initial: { scaleY: 0 }, enter: { scaleY: 0 }, exit: { scaleY: 1, transition: { duration: 0.55, ease: [0.7, 0, 0.3, 1] } } }}
      />
      <main>{children}</main>
      <Footer />
    </motion.div>
  );
}

/** First-visit loader: counter and plate scramble, then the panel lifts away. */
function Intro({ onDone }) {
  const [n, setN] = useState(0);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const c = animate(0, 100, { duration: 1.6, ease: [0.6, 0.05, 0.2, 1], onUpdate: (v) => setN(Math.round(v)), onComplete: () => setLeaving(true) });
    return () => c.stop();
  }, []);
  return (
    <motion.div
      className="intro gutter flex flex-col justify-between py-8"
      initial={{ y: 0 }}
      animate={leaving ? { y: "-100%" } : { y: 0 }}
      transition={{ duration: 0.9, ease: [0.76, 0, 0.24, 1] }}
      onAnimationComplete={() => leaving && onDone()}
    >
      <div className="flex justify-between label-mono">
        <span>PRISM</span>
        <span>Reading frames</span>
      </div>
      <div className="text-center">
        <div className="plate-type text-[clamp(2rem,7vw,6rem)]">
          <ScrambleText text="CG04MX48?1" duration={1.3} />
        </div>
        <div className="label-mono mt-4">24 reads · 1 position unknown</div>
      </div>
      <div className="flex justify-between items-end">
        <span className="label-mono">Plate Recovery &amp; Identification<br />from Surveillance Media</span>
        <span className="text-[clamp(3rem,10vw,9rem)] leading-none tracking-[-0.06em] font-medium tabular-nums">{n}</span>
      </div>
    </motion.div>
  );
}

function Nav({ onMenu }) {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useMotionValueEvent(scrollY, "change", (y) => {
    setHidden(y > 160 && y > last.current);
    last.current = y;
  });
  return (
    <motion.header
      className="nav"
      animate={{ y: hidden ? "-110%" : "0%" }}
      transition={{ duration: 0.6, ease: EASE_REVEAL }}
    >
      <div className="gutter flex items-center justify-between h-[76px]">
        <Link to="/" className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.04em]" aria-label="PRISM home">
          <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden><polygon points="16,3 29,28 3,28" fill="currentColor" /></svg>
          PRISM
        </Link>
        <nav className="hidden lg:flex items-center gap-7">
          {NAV.map(([label, to]) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav__link ${isActive ? "is-active" : ""}`}>{label}</NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a href="/app" className="hidden sm:inline-flex items-center gap-2 h-10 px-4 rounded-full border border-white/40 nav__link !opacity-100 hover:bg-white hover:text-black transition-colors">
            Open app <Arrow />
          </a>
          <button className="lg:hidden nav__link !opacity-100 h-10 px-4 rounded-full border border-white/40" onClick={onMenu}>Menu</button>
        </div>
      </div>
    </motion.header>
  );
}

function MobileMenu({ onClose }) {
  const items = [["Home", "/"], ...NAV, ["Open app", "/app"]];
  return (
    <motion.div className="menu gutter flex flex-col" initial={{ clipPath: "inset(0 0 100% 0)" }} animate={{ clipPath: "inset(0 0 0% 0)" }}
      exit={{ clipPath: "inset(0 0 100% 0)" }} transition={{ duration: 0.7, ease: [0.76, 0, 0.24, 1] }}>
      <div className="flex justify-between items-center h-[76px]">
        <span className="text-[20px] font-semibold tracking-[-0.04em]">PRISM</span>
        <button className="nav__link h-10 px-4 rounded-full border border-white/40" onClick={onClose}>Close</button>
      </div>
      <nav className="mt-10 flex flex-col">
        {items.map(([label, to], i) => (
          <span key={to} className="mask-line">
            <motion.span className="mask-line__in" initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ duration: 0.8, ease: EASE_REVEAL, delay: 0.2 + i * 0.05 }}>
              {to === "/app"
                ? <a href="/app" className="text-[clamp(2.5rem,9vw,4.5rem)] tracking-[-0.05em] font-medium leading-[1.05] text-amber">{label}</a>
                : <Link to={to} onClick={onClose} className="text-[clamp(2.5rem,9vw,4.5rem)] tracking-[-0.05em] font-medium leading-[1.05]">{label}</Link>}
            </motion.span>
          </span>
        ))}
      </nav>
    </motion.div>
  );
}

/** Amber "View" bubble that follows the pointer over elements with data-cursor. */
function ViewBubble() {
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const sx = useSpring(x, { stiffness: 400, damping: 32, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 400, damping: 32, mass: 0.5 });
  const [label, setLabel] = useState(null);
  useEffect(() => {
    const move = (e) => {
      x.set(e.clientX); y.set(e.clientY);
      const el = e.target.closest?.("[data-cursor]");
      setLabel(el ? el.getAttribute("data-cursor") : null);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [x, y]);
  return (
    <motion.div className="bubble" style={{ x: sx, y: sy }} initial={{ scale: 0 }} animate={{ scale: label ? 1 : 0 }}
      transition={{ duration: 0.4, ease: EASE_REVEAL }} aria-hidden>
      {label}
    </motion.div>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="pt-[14vh] overflow-hidden">
      <div className="gutter grid md:grid-cols-12 gap-10">
        <div className="md:col-span-6">
          <p className="h-sec">Characters it can't read stay <span className="text-amber">?</span></p>
          <div className="flex flex-wrap gap-3 mt-10">
            <Magnetic><a href="/app" className="btn-pill">Open the investigator <Arrow /></a></Magnetic>
            <Magnetic><a href={REPO_URL} target="_blank" rel="noreferrer" className="btn-pill btn-pill--ghost">Source on GitHub <Arrow /></a></Magnetic>
          </div>
        </div>
        <div className="md:col-span-3 md:col-start-8">
          <div className="tag mb-4">Pages</div>
          <ul className="space-y-2 text-[17px]">
            <li><Link to="/" className="ulink">Home</Link></li>
            {NAV.map(([l, to]) => <li key={to}><Link to={to} className="ulink">{l}</Link></li>)}
          </ul>
        </div>
        <div className="md:col-span-2">
          <div className="tag mb-4">Project</div>
          <ul className="space-y-2 text-[17px]">
            <li><a className="ulink" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a className="ulink" href="/reports/index.html" target="_blank" rel="noreferrer">Sample reports</a></li>
            <li><Link className="ulink" to="/docs">API &amp; setup</Link></li>
          </ul>
        </div>
      </div>
      <div className="gutter mt-[10vh] flex flex-wrap justify-between gap-4 label-mono">
        <span>Hackasol 5.0 · AIML-01 · Vehicle identification from CCTV</span>
        <span>PRISM output supports an investigator's decision. It does not identify a vehicle on its own.</span>
        <span>{year}</span>
      </div>
      <FooterWordmark />
    </footer>
  );
}

function FooterWordmark() {
  const letters = "PRISM?".split("");
  return (
    <div className="gutter mt-8 select-none" aria-hidden>
      <motion.div className="wordmark flex" initial="hide" whileInView="show" viewport={{ once: true, margin: "0px 0px -5% 0px" }}>
        {letters.map((ch, i) => (
          <span key={i} className="overflow-hidden inline-block pb-[0.04em]">
            <motion.span
              className={`inline-block ${ch === "?" ? "q" : ""}`}
              variants={{ hide: { y: "100%" }, show: { y: "0%", transition: { duration: 1.2, ease: EASE_REVEAL, delay: i * 0.06 } } }}
            >
              {ch}
            </motion.span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}
