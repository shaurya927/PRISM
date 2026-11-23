import { createContext, useContext } from "react";

// Shared site state: intro progress and the Lenis instance (a ref, null under reduced motion).
// Kept in its own module so components.jsx can read it without importing Layout.jsx.
export const SiteCtx = createContext({ introDone: true, introReveal: true, lenis: { current: null } });
export const useSite = () => useContext(SiteCtx);
