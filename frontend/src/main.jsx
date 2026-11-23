import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/instrument-serif";
import "./index.css";
import "./site/site.css";
import "./app.css";
import SiteLayout from "./site/Layout.jsx";
import Landing from "./site/pages/Landing.jsx";
import HowItWorks from "./site/pages/HowItWorks.jsx";
import Cases from "./site/pages/Cases.jsx";
import CaseDetail from "./site/pages/CaseDetail.jsx";
import Evaluation from "./site/pages/Evaluation.jsx";
import Guardrails from "./site/pages/Guardrails.jsx";
import Docs from "./site/pages/Docs.jsx";
import About from "./site/pages/About.jsx";
import NotFound from "./site/pages/NotFound.jsx";

// The investigator app is loaded only when /app is opened.
const InvestigatorApp = lazy(() => import("./App.jsx"));

/** Shown while the investigator bundle loads: same mark and red bar as the site loader. */
function AppLoading() {
  return (
    <div className="site app min-h-screen grid place-items-center">
      <div className="w-[min(420px,80vw)]">
        <div className="topbar__logo">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><polygon points="16,3 29,28 3,28" fill="currentColor" /></svg>
          prism
        </div>
        <div className="label-mono mt-6 mb-3">loading investigator</div>
        <div className="upbar"><span className="indet" /></div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/app/*"
          element={
            <Suspense fallback={<AppLoading />}>
              <InvestigatorApp />
            </Suspense>
          }
        />
        <Route element={<SiteLayout />}>
          <Route index element={<Landing />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="cases" element={<Cases />} />
          <Route path="cases/:id" element={<CaseDetail />} />
          <Route path="evaluation" element={<Evaluation />} />
          <Route path="guardrails" element={<Guardrails />} />
          <Route path="docs" element={<Docs />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
