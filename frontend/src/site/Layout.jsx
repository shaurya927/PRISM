import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import Lenis from "lenis";
import { EASE, RollText } from "./motion.jsx";
import { Arrow } from "./components.jsx";
import { useClock, useHealth, useSpotlight } from "./fx.jsx";
import { CASES, NAV, REPO_URL } from "./data/content.js";
import { SiteCtx } from "./context.js";
import Intro from "./Intro.jsx";

export { useSite } from "./context.js";

let firstPage = true; // the first page is revealed by the loader, not by a page fade

export default function SiteLayout() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduce = useReducedMotion();
  const lenisRef = useRef(null);
  const menuBtn = useRef(null);
  const [introDone, setIntroDone] = useState(() => reduce || sessionStorage.getItem("prism-intro") === "1");
  // True once the intro starts lifting (or was never shown): the hero animates in from then.
  const [introReveal, setIntroReveal] = useState(introDone);
  const [menu, setMenu] = useState(false);
  useSpotlight();

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

  // While the menu is open, Escape closes it and returns focus to the toggle, and the page cannot
  // scroll (Lenis is stopped above; the overflow lock also covers reduced motion, where Lenis is off).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setMenu(false);
      menuBtn.current?.focus();
    };
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = overflow;
    };
  }, [menu]);

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
        <Topbar menuOpen={menu} onMenu={() => setMenu((m) => !m)} onClose={() => setMenu(false)} btnRef={menuBtn} />
        <AnimatePresence>{menu && <SiteMenu onClose={() => setMenu(false)} />}</AnimatePresence>
        {/* While the menu is open the page behind it is inert: no focus, no clicks, hidden from screen readers. */}
        <div inert={menu ? "" : undefined}>
          {/* Keyed on the path only, so changing ?tab= inside a page never re-runs the page fade. */}
          <AnimatePresence mode="wait" onExitComplete={toTop}>
            <Page key={location.pathname}>{outlet}</Page>
          </AnimatePresence>
        </div>
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

function Topbar({ menuOpen, onMenu, onClose, btnRef }) {
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
  // Logo on the left, menu toggle on the right. The bar sits above the open menu, so neither moves.
  return (
    <motion.header className={`topbar ${solid ? "is-solid" : ""} ${menuOpen ? "is-menu" : ""}`}
      animate={{ y: hidden && !menuOpen ? -120 : 0 }} transition={{ duration: 0.4, ease: EASE }}>
      <Link to="/" className="topbar__logo" aria-label="PRISM home" onClick={menuOpen ? onClose : undefined}>
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden><polygon points="16,3 29,28 3,28" fill="currentColor" /></svg>
        prism
      </Link>
      <MenuButton open={menuOpen} onClick={onMenu} btnRef={btnRef} />
    </motion.header>
  );
}

/** Menu toggle: the label rolls from "menu" to "close" and the two lines cross into an X. */
function MenuButton({ open, onClick, btnRef }) {
  return (
    <button ref={btnRef} type="button" onClick={onClick} className={`menu-btn ${open ? "is-open" : ""}`}
      aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Close menu" : "Open menu"}>
      <span className="menu-btn__labels" aria-hidden>
        <span className="menu-btn__label">menu</span>
        <span className="menu-btn__label">close</span>
      </span>
      <span className="menu-btn__icon" aria-hidden><span /><span /></span>
    </button>
  );
}

const MENU_ITEMS = [["Home", "/"], ...NAV];

// Menu motion: the curtain wipes down from the top bar, the page names rise out of their masks one
// after another, then the side copy and the status line fade up. Closing plays it back, faster.
const MENU_MOTION = {
  sheet: {
    open: { clipPath: "inset(0% 0% 0% 0%)", transition: { duration: 0.7, ease: EASE, delayChildren: 0.16 } },
    closed: { clipPath: "inset(0% 0% 100% 0%)", transition: { duration: 0.55, ease: EASE, delay: 0.12 } },
  },
  list: {
    open: { transition: { staggerChildren: 0.05 } },
    closed: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
  },
  item: {
    open: { y: "0%", transition: { duration: 0.8, ease: EASE } },
    closed: { y: "140%", transition: { duration: 0.3, ease: EASE } },
  },
  side: {
    open: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE, delay: 0.42 } },
    closed: { opacity: 0, y: 16, transition: { duration: 0.2, ease: EASE } },
  },
  foot: {
    open: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE, delay: 0.55 } },
    closed: { opacity: 0, y: 8, transition: { duration: 0.2, ease: EASE } },
  },
};
// Reduced motion: a short cross-fade and nothing moves.
const MENU_FADE = {
  sheet: { open: { opacity: 1, transition: { duration: 0.15 } }, closed: { opacity: 0, transition: { duration: 0.15 } } },
  list: {}, item: {}, side: {}, foot: {},
};

/**
 * Full-screen site menu, on every screen size. Hovering or focusing a page name locks a red tracking
 * box onto it, like the tracked car in the hero feed, and dims the other names. The current page keeps
 * a grey box, like an untracked detection.
 */
function SiteMenu({ onClose }) {
  const reduce = useReducedMotion();
  const health = useHealth();
  const m = reduce ? MENU_FADE : MENU_MOTION;
  const counts = { "/cases": CASES.length };
  return (
    <motion.div id="site-menu" className="menu" data-lenis-prevent variants={m.sheet} initial="closed" animate="open" exit="closed">
      <div className="menu__body gutter">
        <nav className="menu__nav" aria-label="Main">
          <motion.ul className="menu__list" variants={m.list}>
            {MENU_ITEMS.map(([label, to]) => (
              <li key={to} className="mask-line">
                <motion.span className="mask-line__in" variants={m.item}>
                  <NavLink to={to} end={to === "/"} onClick={onClose} className="menu__link">
                    <span className="menu__label">
                      {label}
                      {counts[to] ? <sup className="menu__count">({counts[to]})</sup> : null}
                      <span className="menu__box" aria-hidden />
                    </span>
                  </NavLink>
                </motion.span>
              </li>
            ))}
          </motion.ul>
        </nav>
        <motion.div className="menu__side" variants={m.side}>
          <div className="tag">Plate Recovery &amp; Identification from Surveillance Media</div>
          <p>Upload a clip and get a ranked, explained registry shortlist. Characters PRISM cannot read stay <b>?</b>, and it never guesses them.</p>
          <a href="/app" className="btn-pill btn-pill--red"><RollText>Open the investigator</RollText> <Arrow /></a>
        </motion.div>
      </div>
      <motion.div className="menu__foot gutter" variants={m.foot}>
        <span>Every frame read. Nothing guessed.</span>
        <span className="menu__status">
          <span className={`dot ${health ? "dot--live" : ""}`} />
          {health ? "API online" : health === false ? "API offline" : "Checking API…"}
        </span>
      </motion.div>
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
          <div className="mt-6"><a href="/app" className="btn-pill btn-pill--red"><RollText>Open the investigator</RollText> <Arrow /></a></div>
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
            <div className="text-muted">{health ? `registry ${health.registry_size} records · v${health.prism_version}` : "registry · 50,000 records"}</div>
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
