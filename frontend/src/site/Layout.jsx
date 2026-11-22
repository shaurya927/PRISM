import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, animate, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import Lenis from "lenis";
import { EASE_REVEAL, Magnetic } from "./motion.jsx";
import { Arrow } from "./components.jsx";
import { Cursor, RollLink, useClock, useHealth } from "./fx.jsx";
import { CASES, NAV, REPO_URL } from "./data/content.js";

const SiteCtx = createContext({ introDone: true, lenis: null });
export const useSite = () => useContext(SiteCtx);

const EASE_SHEET = [0.76, 0, 0.24, 1];
let firstPage = true; // the first page is revealed by the loader, not by a page curtain

export default function SiteLayout() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduce = useReducedMotion();
  const lenisRef = useRef(null);
  const [introDone, setIntroDone] = useState(() => reduce || sessionStorage.getItem("prism-intro") === "1");
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ lerp: 0.09, autoRaf: true });
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
        {!introDone && <Loader onDone={() => { sessionStorage.setItem("prism-intro", "1"); setIntroDone(true); }} />}
        <Topbar onMenu={() => setMenu(true)} />
        <AnimatePresence>{menu && <MobileMenu onClose={() => setMenu(false)} />}</AnimatePresence>
        <AnimatePresence mode="wait" onExitComplete={toTop}>
          <Page key={location.pathname}>{outlet}</Page>
        </AnimatePresence>
        <Cursor />
        <div className="grain" aria-hidden />
      </div>
    </SiteCtx.Provider>
  );
}

/** Page wrapper. Leaving: a red sheet then a black panel rise over the page. Entering: they lift away. */
function Page({ children }) {
  const skip = firstPage;
  useEffect(() => { firstPage = false; }, []);
  const reduce = useReducedMotion();
  if (reduce) return <div><main>{children}</main><Footer /></div>;
  const sheet = (delayIn, delayOut) => ({
    initial: { y: "0%" },
    enter: { y: "-100%", transition: { duration: 0.8, ease: EASE_SHEET, delay: delayIn } },
    exit: { y: ["100%", "0%"], transition: { duration: 0.6, ease: EASE_SHEET, delay: delayOut } },
  });
  return (
    <motion.div initial={skip ? false : "initial"} animate="enter" exit="exit">
      <div className="curtain" aria-hidden>
        <motion.div className="curtain__red" variants={sheet(0.18, 0)} />
        <motion.div className="curtain__black" variants={sheet(0.02, 0.12)} />
      </div>
      <main>{children}</main>
      <Footer />
    </motion.div>
  );
}

/** First-visit loader: mark fills left to right, mono counter, red bar; then the panels lift. */
function Loader({ onDone }) {
  const [n, setN] = useState(0);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const c = animate(0, 100, { duration: 1.7, ease: [0.6, 0.05, 0.2, 1], onUpdate: (v) => setN(Math.round(v)), onComplete: () => setTimeout(() => setLeaving(true), 180) });
    return () => c.stop();
  }, []);
  return (
    <div className="ld" aria-label="Loading">
      <motion.div className="ld__sheet" animate={leaving ? { y: "-100%" } : { y: 0 }} transition={{ duration: 0.9, ease: EASE_SHEET, delay: 0.12 }}
        onAnimationComplete={() => leaving && onDone()} />
      <motion.div className="ld__panel" animate={leaving ? { y: "-100%" } : { y: 0 }} transition={{ duration: 0.85, ease: EASE_SHEET }}>
        <div className="ld__mark">
          <span className="ld__ghost">PRISM</span>
          <span className="ld__fill" style={{ clipPath: `inset(0% ${100 - n}% 0% 0%)` }}>PRISM</span>
        </div>
        <div className="ld__labels"><span>{n < 100 ? "Reading frames" : "Ready"}</span></div>
        <div className="ld__count">{String(n).padStart(3, "0")}<span className="ld__pct">%</span></div>
        <div className="ld__bar" style={{ transform: `scaleX(${n / 100})` }} />
      </motion.div>
    </div>
  );
}

function Topbar({ onMenu }) {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [solid, setSolid] = useState(false);
  const last = useRef(0);
  const { pathname } = useLocation();
  useMotionValueEvent(scrollY, "change", (y) => {
    if (y > last.current + 2 && y > 200) setHidden(true);
    else if (y < last.current - 2 || y < 200) setHidden(false);
    // Blend over the hero; solid bar once the page content scrolls under it.
    setSolid(y > (pathname === "/" ? window.innerHeight * 0.72 : 80));
    last.current = y;
  });
  const counts = { "/cases": CASES.length };
  return (
    <motion.header className={`topbar ${solid ? "is-solid" : ""}`} animate={{ y: hidden ? -120 : 0 }} transition={{ duration: 0.6, ease: EASE_REVEAL }}>
      <Link to="/" className="topbar__logo" aria-label="PRISM home">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><polygon points="16,3 29,28 3,28" fill="currentColor" /></svg>
        prism
      </Link>
      <nav className="topbar__nav">
        {NAV.map(([label, to]) => (
          <NavLink key={to} to={to} className={({ isActive }) => `f-u ${isActive ? "is-on" : ""}`}>
            {label.toLowerCase()}{counts[to] ? <sup>({counts[to]})</sup> : null}
          </NavLink>
        ))}
        <a href="/app" className="f-u">open app ↗</a>
      </nav>
      <button className="lg:hidden text-[16px] pt-1" onClick={onMenu}>menu</button>
    </motion.header>
  );
}

function MobileMenu({ onClose }) {
  const items = [["Home", "/"], ...NAV, ["Open app", "/app"]];
  return (
    <motion.div className="menu gutter flex flex-col" initial={{ y: "-100%" }} animate={{ y: 0 }} exit={{ y: "-100%" }} transition={{ duration: 0.75, ease: EASE_SHEET }}>
      <div className="flex justify-between items-center pt-4 h-[64px]">
        <span className="text-[24px] font-medium tracking-[-0.06em]">prism</span>
        <button className="text-[16px]" onClick={onClose}>close</button>
      </div>
      <nav className="mt-10 flex flex-col">
        {items.map(([label, to], i) => (
          <span key={to} className="mask-line">
            <motion.span className="mask-line__in" initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ duration: 0.8, ease: EASE_REVEAL, delay: 0.25 + i * 0.05 }}>
              {to === "/app"
                ? <a href="/app" className="text-[clamp(2.6rem,11vw,4.5rem)] tracking-[-0.05em] font-light leading-[1.02]">{label} ↗</a>
                : <Link to={to} onClick={onClose} className="text-[clamp(2.6rem,11vw,4.5rem)] tracking-[-0.05em] font-light leading-[1.02]">{label.toLowerCase()}</Link>}
            </motion.span>
          </span>
        ))}
      </nav>
    </motion.div>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  const clock = useClock();
  const health = useHealth();
  return (
    <footer className="foot">
      <div className="grid grid-cols-2 md:grid-cols-12 gap-x-6 gap-y-12">
        <div className="col-span-2 md:col-span-4">
          <div className="tag mb-5">Get started</div>
          <a href="/app" className="text-[clamp(1.6rem,2.4vw,2.4rem)] font-light tracking-[-0.04em] f-u">Open the investigator</a>
          <div className="mt-8"><Magnetic><a href="/app" className="btn-pill btn-pill--red">Start a case <Arrow /></a></Magnetic></div>
          <p className="label-mono mt-8"><span className="dot dot--live" />{health ? "API online" : health === false ? "API offline" : "Checking API…"}</p>
        </div>
        <div className="md:col-span-2 md:col-start-6">
          <div className="tag mb-5">Pages</div>
          <ul className="space-y-2 text-[17px]">
            <li><Link to="/" className="f-u">Home</Link></li>
            {NAV.map(([l, to]) => <li key={to}><Link to={to} className="f-u">{l}</Link></li>)}
          </ul>
        </div>
        <div className="md:col-span-2">
          <div className="tag mb-5">Project</div>
          <ul className="space-y-2 text-[17px]">
            <li><a className="f-u" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a className="f-u" href="/reports/index.html" target="_blank" rel="noreferrer">Sample reports</a></li>
            <li><a className="f-u" href="/api/docs" target="_blank" rel="noreferrer">API docs</a></li>
          </ul>
        </div>
        <div className="col-span-2 md:col-span-3">
          <div className="tag mb-5">Now running</div>
          <div className="flex gap-4 items-start">
            <div className="w-16 h-16 rounded-md bg-[var(--red)] grid place-items-center text-[28px] font-medium shrink-0">?</div>
            <div className="text-[15px] leading-snug">
              <div className="flex items-center"><span className="eq"><i /><i /><i /><i /></span><span className="tag !text-[var(--ink)]">Live</span></div>
              <div className="mt-1">{health ? `OCR ${health.ocr_backend} on ${health.gpu || health.device}` : "PARSeq OCR"}</div>
              <div className="text-muted">{health ? `registry ${health.registry_size} records · v${health.prism_version}` : "registry · 500 records"}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="border-t rule mt-[10vh]" />
      <FooterWordmark />
      <div className="flex flex-wrap justify-between gap-4 label-mono mt-6">
        <span>Hackasol 5.0 · AIML-01</span>
        <span>{clock} · local time</span>
        <span>Decision support only. It does not identify a vehicle on its own.</span>
        <span>© {year} PRISM</span>
      </div>
    </footer>
  );
}

function FooterWordmark() {
  const letters = "prism?".split("");
  return (
    <div className="mt-6 select-none" aria-hidden>
      <motion.div className="wordmark flex" initial="hide" whileInView="show" viewport={{ once: true, margin: "0px 0px -5% 0px" }}>
        {letters.map((ch, i) => (
          <span key={i} className="overflow-clip inline-block pb-[0.04em]">
            <motion.span className={`inline-block ${ch === "?" ? "q" : ""}`}
              variants={{ hide: { y: "100%" }, show: { y: "0%", transition: { duration: 1.2, ease: EASE_REVEAL, delay: i * 0.06 } } }}>
              {ch}
            </motion.span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export { RollLink };
