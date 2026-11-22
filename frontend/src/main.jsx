import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import "./site/site.css";
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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/app/*"
          element={
            <Suspense fallback={<div className="min-h-screen bg-slate-100" />}>
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
