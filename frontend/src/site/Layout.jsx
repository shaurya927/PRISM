import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import Lenis from "lenis";
import { EASE } from "./motion.jsx";
import { useSpotlight } from "./fx.jsx";
import { CASES, NAV } from "./data/content.js";
import { SiteCtx } from "./context.js";
import Intro from "./Intro.jsx";

export { useSite } from "./context.js";

let firstPage = true; // the first page is revealed by the loader, not by a page fade
const INTRO_KEY = "prism-intro"; // set in sessionStorage once the intro has played in this tab
/** Logo click: forget that the intro played, then let the browser load "/" from scratch. */
const replayIntro = () => { try { sessionStorage.removeItem(INTRO_KEY); } catch { /* storage blocked: the page still reloads */ } };
// The page behind the intro: a little smaller and invisible. Once the intro's plate has gone it fades in
// and grows to full size in one smooth move.
const STAGE_HIDDEN = { opacity: 0, scale: 0.92 };
const STAGE_SHOWN = { opacity: 1, scale: 1,
  transition: { opacity: { duration: 0.9, ease: [0.33, 1, 0.68, 1] }, scale: { duration: 1.4, ease: [0.16, 1, 0.3, 1] } } };

export default function SiteLayout() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduce = useReducedMotion();
  const lenisRef = useRef(null);
  const menuBtn = useRef(null);
  const [introDone, setIntroDone] = useState(() => reduce || sessionStorage.getItem(INTRO_KEY) === "1");
  // True once the intro has started (or was never shown): the hero copy mounts and animates from then.
  // During the intro that happens out of sight, so the page is already composed when it appears.
  const [introReveal, setIntroReveal] = useState(introDone);
  // True once the intro starts lifting: the page zooms and fades up behind the decoded plate.
  const [stageIn, setStageIn] = useState(introDone);
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
  const stageNow = useCallback(() => setStageIn(true), []);

  const toTop = () => {
    if (lenisRef.current) lenisRef.current.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo(0, 0);
  };

  return (
    <SiteCtx.Provider value={{ introDone, introReveal, lenis: lenisRef }}>
      <div className="site">
        {!introDone && (
          <Intro onLeave={revealNow} onReveal={stageNow}
            onDone={() => { sessionStorage.setItem(INTRO_KEY, "1"); setIntroDone(true); }} />
        )}
        {/* Behind the intro the page (top bar included) waits smaller and dark, then zooms and fades up as the
            intro lifts. Once it has settled the wrapper carries no transform, so the fixed top bar works as normal. */}
        <motion.div className="site__stage" style={{ transformOrigin: "50% 50vh" }}
          initial={stageIn ? false : STAGE_HIDDEN} animate={stageIn ? STAGE_SHOWN : STAGE_HIDDEN}>
          <Topbar menuOpen={menu} onMenu={() => setMenu((m) => !m)} btnRef={menuBtn} />
          {/* While the menu is open the page behind it is inert: no focus, no clicks, hidden from screen readers. */}
          <div inert={menu ? "" : undefined}>
            {/* Keyed on the path only, so changing ?tab= inside a page never re-runs the page fade. */}
            <AnimatePresence mode="wait" onExitComplete={toTop}>
              <Page key={location.pathname}>{outlet}</Page>
            </AnimatePresence>
          </div>
        </motion.div>
        <AnimatePresence>{menu && <SiteMenu onClose={() => setMenu(false)} />}</AnimatePresence>
      </div>
    </SiteCtx.Provider>
  );
}

/** Page wrapper: a short fade out and in (about 0.35 s in total). No motion under reduced motion. */
function Page({ children }) {
  const skip = firstPage;
  useEffect(() => { firstPage = false; }, []);
  const reduce = useReducedMotion();
  if (reduce) return <div><main>{children}</main></div>;
  return (
    <motion.div
      initial={skip ? false : { opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE } }}
      exit={{ opacity: 0, transition: { duration: 0.15, ease: EASE } }}
    >
      <main>{children}</main>
    </motion.div>
  );
}

function Topbar({ menuOpen, onMenu, btnRef }) {
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
      {/* A full page load, not a router link: clearing the session flag makes the site start over from the
          intro (unless reduced motion is on, which always skips it). */}
      <a href="/" className="topbar__logo" aria-label="PRISM home, replays the intro" onClick={replayIntro}>
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden><polygon points="16,3 29,28 3,28" fill="currentColor" /></svg>
        prism
      </a>
      <MenuButton open={menuOpen} onClick={onMenu} btnRef={btnRef} />
    </motion.header>
  );
}

/** Menu toggle: the label rolls from "menu" to "close" and the two lines cross into an X. */
function MenuButton({ open, onClick, btnRef }) {
  return (
    <button ref={btnRef} type="button" onClick={onClick} onPointerEnter={prefetchCubeArt} onFocus={prefetchCubeArt}
      className={`menu-btn ${open ? "is-open" : ""}`}
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
// The menu's cube (three.js, WebGL) is desktop only and is fetched with the menu, never with the page.
// Pointing at or focusing the menu button fetches it early, so it is usually ready when the menu opens.
// If the chunk cannot load, the menu simply has no art.
const WIDE = "(min-width: 1024px)";
const loadCubeArt = () => import("./CubeArt.jsx");
const CubeArt = lazy(() => loadCubeArt().catch(() => ({ default: () => null })));
const prefetchCubeArt = () => { if (window.matchMedia(WIDE).matches) loadCubeArt().catch(() => {}); };

function useMedia(query) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

// Menu motion: the curtain wipes down from the top bar, the page names rise out of their masks one
// after another, then the tagline fades up. Closing plays it back, faster.
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
  foot: {
    open: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE, delay: 0.55 } },
    closed: { opacity: 0, y: 8, transition: { duration: 0.2, ease: EASE } },
  },
  art: {
    open: { opacity: 1, y: 0, scale: 1, transition: { duration: 1, ease: EASE, delay: 0.2 } },
    closed: { opacity: 0, y: 24, scale: 0.97, transition: { duration: 0.25, ease: EASE } },
  },
};
// Reduced motion: a short cross-fade and nothing moves.
const MENU_FADE = {
  sheet: { open: { opacity: 1, transition: { duration: 0.15 } }, closed: { opacity: 0, transition: { duration: 0.15 } } },
  list: {}, item: {}, foot: {}, art: {},
};

/**
 * Full-screen site menu, on every screen size. Hovering or focusing a page name keeps it white and
 * dims the others.
 */
function SiteMenu({ onClose }) {
  const reduce = useReducedMotion();
  const wide = useMedia(WIDE);
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
                    </span>
                  </NavLink>
                </motion.span>
              </li>
            ))}
          </motion.ul>
        </nav>
        <motion.div className="menu__art" variants={m.art}>
          {wide && <Suspense fallback={null}><CubeArt /></Suspense>}
        </motion.div>
      </div>
      <motion.div className="menu__foot gutter" variants={m.foot}>
        <span>Every frame read. Nothing guessed.</span>
      </motion.div>
    </motion.div>
  );
}

