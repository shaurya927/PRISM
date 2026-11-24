// Clerk sign-in for the investigator (/app). The project website stays public.
// Without VITE_CLERK_PUBLISHABLE_KEY everything renders as before (no provider, no gate).
import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ClerkProvider, SignIn, SignUp, UserButton, useAuth } from "@clerk/react";
import { setTokenGetter } from "./api.js";
import { HighwayFeed, useClock } from "./site/fx.jsx";

export const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "";
export const AUTH_ON = Boolean(CLERK_KEY);

const EASE = [0.22, 1, 0.36, 1];
const FONT = '"Geist Variable", ui-sans-serif, system-ui, sans-serif';
const DISPLAY = '"Instrument Serif", ui-serif, Georgia, serif';
const MONO = '"Geist Mono Variable", ui-monospace, monospace';

/** Clerk's card in the site's look: black, hairline rings, glass inputs, the red primary action. */
export const appearance = {
  variables: {
    colorPrimary: "#dc2f3c",
    colorDanger: "#e5484d",
    colorSuccess: "#45e0ea",
    colorWarning: "#e8a95b",
    colorBackground: "#0b0b0c",
    colorInput: "#131314",
    colorInputForeground: "#f0f0f0",
    colorForeground: "#f0f0f0",
    colorMutedForeground: "#a1a4a5",
    colorMuted: "#131314",
    colorPrimaryForeground: "#ffffff",
    colorNeutral: "#ffffff",
    colorBorder: "rgba(255,255,255,0.12)",
    colorRing: "rgba(220,47,60,0.45)",
    colorShimmer: "rgba(255,255,255,0.06)",
    fontFamily: FONT,
    fontFamilyButtons: FONT,
    fontSize: "15px",
    borderRadius: "10px",
    spacingUnit: "1rem",
  },
  layout: { socialButtonsPlacement: "bottom", socialButtonsVariant: "blockButton", logoPlacement: "none" },
  elements: {
    rootBox: { width: "100%" },
    cardBox: {
      width: "100%",
      boxShadow: "0 30px 80px -30px rgba(0,0,0,.9)",
      border: "1px solid rgba(255,255,255,.1)",
      borderRadius: "18px",
      background: "linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,0) 40%), #0b0b0c",
    },
    card: { background: "transparent", boxShadow: "none", border: "none", padding: "32px 32px 24px" },
    headerTitle: { fontFamily: DISPLAY, fontWeight: 400, fontSize: "34px", letterSpacing: "-0.01em", lineHeight: 1.05 },
    headerSubtitle: { color: "#a1a4a5", fontSize: "14px" },
    formFieldLabel: { fontFamily: MONO, fontSize: "12px", fontWeight: 400, color: "#a1a4a5", letterSpacing: 0 },
    formFieldInput: {
      background: "#131314",
      border: "1px solid rgba(255,255,255,.12)",
      boxShadow: "none",
      height: "44px",
    },
    formButtonPrimary: {
      height: "46px",
      fontSize: "15px",
      fontWeight: 500,
      textTransform: "none",
      background: "#dc2f3c",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,.18)",
      "&:hover": { background: "#c42633" },
    },
    socialButtonsBlockButton: {
      height: "44px",
      background: "linear-gradient(104deg, rgba(253,253,253,.05) 5%, rgba(240,240,228,.1) 100%)",
      border: "1px solid rgba(255,255,255,.1)",
    },
    dividerLine: { background: "rgba(255,255,255,.08)" },
    dividerText: { fontFamily: MONO, fontSize: "12px", color: "#7d8082" },
    footer: { background: "transparent", borderTop: "1px solid rgba(255,255,255,.06)" },
    footerActionText: { color: "#7d8082" },
    footerActionLink: { color: "#f0f0f0", fontWeight: 500, "&:hover": { color: "#ffffff" } },
    identityPreview: { background: "#131314", border: "1px solid rgba(255,255,255,.1)" },
    otpCodeFieldInput: { background: "#131314", border: "1px solid rgba(255,255,255,.12)" },
    formFieldAction: { color: "#a1a4a5" },
    alert: { background: "rgba(229,72,77,.08)", border: "1px solid rgba(229,72,77,.35)" },
    userButtonAvatarBox: { width: "32px", height: "32px" },
    userButtonPopoverCard: { background: "#0b0b0c", border: "1px solid rgba(255,255,255,.1)" },
  },
};

/** Card titles in PRISM's words (the Clerk dashboard's application name would show otherwise). */
const localization = {
  signIn: {
    start: { title: "Welcome back", subtitle: "Sign in to open a case", actionText: "No account yet?", actionLink: "Create one" },
    password: { title: "Enter your password", subtitle: "to continue to the investigator" },
  },
  signUp: {
    start: { title: "Create your account", subtitle: "to open cases in the investigator", actionText: "Have an account?", actionLink: "Sign in" },
  },
};

/** Wraps the whole router tree. Without a key it is a pass-through. */
export function AuthProvider({ children }) {
  const navigate = useNavigate();
  if (!AUTH_ON) return children;
  return (
    <ClerkProvider
      publishableKey={CLERK_KEY}
      appearance={appearance}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/app"
      afterSignOutUrl="/"
      localization={localization}
    >
      {children}
    </ClerkProvider>
  );
}

/** Gate for /app: signed-in users get the investigator, everyone else goes to /sign-in and back. */
export function RequireAuth({ children, fallback = null }) {
  if (!AUTH_ON) return children;
  return <Gate fallback={fallback}>{children}</Gate>;
}

function Gate({ children, fallback }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (isLoaded && isSignedIn) setTokenGetter(() => getToken());
    if (isLoaded && !isSignedIn) {
      const back = encodeURIComponent(pathname + search);
      navigate(`/sign-in?redirect_url=${back}`, { replace: true });
    }
  }, [isLoaded, isSignedIn, getToken, navigate, pathname, search]);
  if (!isLoaded || !isSignedIn) return fallback;
  return children;
}

/** Account avatar for the investigator header (nothing without Clerk). */
export function AccountButton() {
  if (!AUTH_ON) return null;
  return <UserButton appearance={appearance} />;
}

/** /sign-in and /sign-up: the live highway feed behind, the headline on the left, Clerk's card right. */
export function AuthPage({ mode = "sign-in" }) {
  const reduce = useReducedMotion();
  const clock = useClock();
  const { search } = useLocation();
  const redirect = new URLSearchParams(search).get("redirect_url") || "/app";
  const rise = (delay) => (reduce ? {} : {
    initial: { opacity: 0, y: 14, filter: "blur(6px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.8, ease: EASE, delay },
  });
  const signIn = mode === "sign-in";
  if (!AUTH_ON) {
    return (
      <div className="site auth">
        <div className="auth__grid"><p className="lead">Sign-in is not configured. <a className="ulink" href="/app">Open the investigator</a>.</p></div>
      </div>
    );
  }
  return (
    <div className="site auth">
      <div className="auth__bg" aria-hidden>
        <HighwayFeed labels={false} />
        <div className="auth__scrim" />
      </div>
      <header className="auth__top">
        <a href="/" className="topbar__logo" aria-label="PRISM home">
          <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden><polygon points="16,3 29,28 3,28" fill="currentColor" /></svg>
          prism
        </a>
        <a href="/" className="auth__back label-mono">← back to the site</a>
      </header>
      <main className="auth__grid">
        <section className="auth__copy">
          <motion.div className="auth__kicker label-mono" {...rise(0)}><span className="rec" />REC · CAM 04 · {clock}</motion.div>
          <motion.h1 className="auth__h" {...rise(0.08)}>
            {signIn ? <>Sign in to the<br /><em>investigator</em></> : <>Open an<br /><em>investigator</em> account</>}
          </motion.h1>
          <motion.p className="auth__sub" {...rise(0.18)}>
            Uploaded footage, plate crops and case reports stay behind sign-in. The project site and the sample cases
            are open to everyone.
          </motion.p>
          <motion.ul className="auth__facts" {...rise(0.28)}>
            <li><span className="auth__cell">?</span>Characters it cannot see stay unknown, never guessed</li>
            <li><span className="auth__cell auth__cell--ok">✓</span>Every score explained, every frame linked</li>
            <li><span className="auth__cell auth__cell--ok">#</span>SHA-256 chain of custody on every case</li>
          </motion.ul>
        </section>
        <motion.section className="auth__card" {...rise(0.12)}>
          {signIn
            ? <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl={redirect} />
            : <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl={redirect} />}
        </motion.section>
      </main>
      <footer className="auth__foot label-mono">Decision support only. It does not identify a vehicle on its own.</footer>
    </div>
  );
}
