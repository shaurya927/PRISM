import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import Lenis from "lenis";
import { EASE } from "./motion.jsx";
import { Arrow } from "./components.jsx";
import { useClock, useHealth } from "./fx.jsx";
import { CASES, NAV, REPO_URL } from "./data/content.js";
import { SiteCtx } from "./context.js";
import Intro from "./Intro.jsx";

export { useSite } from "./context.js";

const EASE_SHEET = EASE;
let firstPage = true; // the first page is revealed by the loader, not by a page fade

export default function SiteLayout() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduce = useReducedMotion();
  const lenisRef = useRef(null);
  const [introDone, setIntroDone] = useState(() => reduce || sessionStorage.getItem("prism-intro") === "1");
  // True once the intro starts lifting (or was never shown): the hero animates in from then.
  const [introReveal, setIntroReveal] = useState(introDone);
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

  const revealNow = useCallback(() => setIntroReveal(true), []);

  const toTop = () => {
    if (lenisRef.current) lenisRef.current.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo(0, 0);
  };

  return (
    <SiteCtx.Provider value={{ introDone, introReveal, lenis: lenisRef }}>
      <div className="site">
        {!introDone && (
          <Intro onLeave={revealNow} onDone={() => { sessionStorage.setItem("prism-intro", "1"); setIntroDone(true); }} />
        )}
        <Topbar onMenu={() => setMenu(true)} />
        <AnimatePresence>{menu && <MobileMenu onClose={() => setMenu(false)} />}</AnimatePresence>
        {/* Keyed on the path only, so changing ?tab= inside a page never re-runs the page fade. */}
        <AnimatePresence mode="wait" onExitComplete={toTop}>
          <Page key={location.pathname}>{outlet}</Page>
        </AnimatePresence>
      </div>
    </SiteCtx.Provider>
  );
}

/** Page wrapper: a short fade out and in (about 0.35 s in total). No motion under reduced motion. */
function Page({ children }) {
  const skip = firstPage;
  useEffect(() => { firstPage = false; }, []);
  const reduce = useReducedMotion();
  if (reduce) return <div><main>{children}</main><Footer /></div>;
  return (
    <motion.div
      initial={skip ? false : { opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE } }}
      exit={{ opacity: 0, transition: { duration: 0.15, ease: EASE } }}
    >
      <main>{children}</main>
      <Footer />
    </motion.div>
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
    <motion.header className={`topbar ${solid ? "is-solid" : ""}`} animate={{ y: hidden ? -120 : 0 }} transition={{ duration: 0.4, ease: EASE }}>
      <Link to="/" className="topbar__logo" aria-label="PRISM home">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden><polygon points="16,3 29,28 3,28" fill="currentColor" /></svg>
        prism
      </Link>
      <nav className="topbar__nav" aria-label="Main">
        {NAV.map(([label, to]) => (
          <NavLink key={to} to={to} className={({ isActive }) => `f-u ${isActive ? "is-on" : ""}`}>
            {label.toLowerCase()}{counts[to] ? <sup>({counts[to]})</sup> : null}
          </NavLink>
        ))}
        <a href="/app" className="f-u">open app <Arrow /></a>
      </nav>
      <button className="lg:hidden text-[15px] min-h-[44px] px-2 -mr-2 -mt-3" onClick={onMenu} aria-label="Open menu">menu</button>
    </motion.header>
  );
}

function MobileMenu({ onClose }) {
  const items = [["Home", "/"], ...NAV, ["Open app", "/app"]];
  const size = "text-[clamp(2rem,8vw,2.75rem)] tracking-[-0.025em] font-normal leading-[1.15]";
  return (
    <motion.div className="menu gutter flex flex-col" initial={{ y: "-100%" }} animate={{ y: 0 }} exit={{ y: "-100%" }} transition={{ duration: 0.4, ease: EASE_SHEET }}>
      <div className="flex justify-between items-center pt-4 h-[64px]">
        <span className="text-[22px] font-medium tracking-[-0.04em]">prism</span>
        <button className="text-[15px] min-h-[44px] px-2 -mr-2" onClick={onClose}>close</button>
      </div>
      <nav className="mt-10 flex flex-col" aria-label="Main">
        {items.map(([label, to], i) => (
          <span key={to} className="mask-line">
            <motion.span className="mask-line__in" initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: 0.15 + Math.min(i, 5) * 0.03 }}>
              {to === "/app"
                ? <a href="/app" className={`inline-flex items-center gap-3 ${size}`}>{label} <Arrow className="w-[0.4em] h-[0.4em]" /></a>
                : <Link to={to} onClick={onClose} className={size}>{label.toLowerCase()}</Link>}
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
      <div className="grid grid-cols-2 md:grid-cols-12 gap-x-6 gap-y-10">
        <div className="col-span-2 md:col-span-4">
          <div className="tag mb-4">Get started</div>
          <p className="text-muted text-[15px] max-w-[30ch]">Upload a clip and get a ranked, explained registry shortlist.</p>
          <div className="mt-6"><a href="/app" className="btn-pill btn-pill--red">Open the investigator <Arrow /></a></div>
        </div>
        <div className="md:col-span-2 md:col-start-6">
          <div className="tag mb-4">Pages</div>
          <ul className="space-y-2 text-[15px]">
            <li><Link to="/" className="f-u">Home</Link></li>
            {NAV.map(([l, to]) => <li key={to}><Link to={to} className="f-u">{l}</Link></li>)}
          </ul>
        </div>
        <div className="md:col-span-2">
          <div className="tag mb-4">Project</div>
          <ul className="space-y-2 text-[15px]">
            <li><a className="f-u" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a className="f-u" href="/reports/index.html" target="_blank" rel="noreferrer">Sample reports</a></li>
            <li><a className="f-u" href="/api/docs" target="_blank" rel="noreferrer">API docs</a></li>
          </ul>
        </div>
        <div className="col-span-2 md:col-span-3">
          <div className="tag mb-4">Now running</div>
          <div className="text-[15px] leading-snug">
            <div className="flex items-center">
              <span className={`dot ${health ? "dot--live" : ""}`} />
              <span>{health ? "API online" : health === false ? "API offline" : "Checking API…"}</span>
            </div>
            <div className="mt-1 text-[var(--muted-2)]">{health ? `OCR ${health.ocr_backend} on ${health.gpu || health.device}` : "PARSeq OCR"}</div>
            <div className="text-muted">{health ? `registry ${health.registry_size} records · v${health.prism_version}` : "registry · 500 records"}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-4 label-mono mt-12 pt-6 border-t rule">
        <span>Hackasol 5.0 · AIML-01</span>
        <span>{clock} · local time</span>
        <span>Decision support only. It does not identify a vehicle on its own.</span>
        <span>© {year} PRISM</span>
      </div>
    </footer>
  );
}
