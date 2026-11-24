import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "./api.js";
import { useNetActive } from "./net.js";
import { HighwayFeed } from "./site/fx.jsx";
import { MenuButton, SiteMenu } from "./site/Layout.jsx";
import NewCase, { HintInput } from "./components/NewCase.jsx";
import Progress from "./components/Progress.jsx";
import Vehicles from "./components/Vehicles.jsx";
import Evidence from "./components/Evidence.jsx";
import Shortlist from "./components/Shortlist.jsx";
import WhatIf from "./components/WhatIf.jsx";
import Summary from "./components/Summary.jsx";
import CrossCam from "./components/CrossCam.jsx";
import { Icon, fmt2 } from "./components/common.jsx";

const EASE = [0.22, 1, 0.36, 1];

function Header({ jobId, onNew }) {
  // The same full-screen menu as the project site (Home + every site page).
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef(null);
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
    return () => { window.removeEventListener("keydown", onKey); html.style.overflow = overflow; };
  }, [menu]);
  return (
    <>
    <header className={`app-top ${menu ? "is-menu" : ""}`}>
      {/* The logo goes to the project site's home page, like the logo on the site itself. */}
      <a href="/" className="topbar__logo" aria-label="PRISM home">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden><polygon points="16,3 29,28 3,28" fill="currentColor" /></svg>
        prism
      </a>
      <span className="app-top__crumb label-mono hidden sm:inline">/ investigator</span>
      <div className="ml-auto flex items-center gap-4">
        <AnimatePresence>
          {jobId && (
            <motion.button key="new" className="btn-pill btn-pill--red !h-10 !px-4" onClick={onNew}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: EASE }}>
              <Icon name="plus" size={16} />New case
            </motion.button>
          )}
        </AnimatePresence>
        <MenuButton open={menu} onClick={() => setMenu((m) => !m)} btnRef={menuBtn} />
      </div>
    </header>
    <AnimatePresence>{menu && <SiteMenu onClose={() => setMenu(false)} />}</AnimatePresence>
    </>
  );
}

function Hero({ health }) {
  return (
    <div className="app-hero">
      <HighwayFeed labels={false} />
      <div className="app-hero__in">
        <h1 className="app-hero__h">
          <span className="mask-line"><motion.span className="mask-line__in" initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ duration: 0.8, ease: EASE }}>Open a case</motion.span></span>
        </h1>
        <motion.p className="label-mono text-right hidden md:block" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.4, ease: EASE }}>
          {health ? <>Running on {health.gpu || health.device}<br />τ {health.thresholds?.tau} · τ_char {health.thresholds?.char_conf}</> : "Connecting to the PRISM API…"}
        </motion.p>
      </div>
    </div>
  );
}

function CaseList({ jobs, current, onOpen, onDelete }) {
  if (!jobs.length) return null;
  return (
    <motion.div className="card p-5 md:p-6 max-w-4xl mx-auto mt-6" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: 0.1 }}>
      <div className="flex items-baseline justify-between mb-3">
        <div className="label">Previous cases</div>
        <div className="label-mono">{jobs.length}</div>
      </div>
      <div className="hlist">
        {jobs.slice(0, 12).map((j) => (
          <div key={j.job_id} className={`hlist__row flex items-center gap-3 py-2.5 text-sm ${current === j.job_id ? "font-medium" : ""}`}>
            <button className="font-mono text-blue-700 f-u" onClick={() => onOpen(j.job_id)}>{j.job_id}</button>
            <span className="text-slate-500">{j.kind}</span>
            <span className="truncate">{j.clip || ""}</span>
            <span className="ml-auto label-mono hidden sm:inline">{j.created_at?.replace("T", " ").slice(0, 19)}</span>
            <span className={`chip ${j.status === "done" ? "chip--ok" : j.status === "error" ? "chip--bad" : "chip--warn"}`}>{j.status}</span>
            <button className="grid place-items-center w-7 h-7 rounded-md text-slate-400 hover:text-red-600 hover:bg-slate-100 transition-colors" title="Delete case and its crops" aria-label={`Delete case ${j.job_id}`} onClick={() => onDelete(j.job_id)}><Icon name="x" size={14} /></button>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function ResultControls({ result, onRescore, busy }) {
  const [tau, setTau] = useState(result.threshold);
  const [hint, setHint] = useState(result.hint || "");
  const timer = useRef(null);
  useEffect(() => { setTau(result.threshold); }, [result.threshold]);
  const slide = (v) => {
    setTau(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onRescore({ threshold: v }), 250);
  };
  return (
    <div className="card p-4 grid md:grid-cols-[1fr_1.3fr] gap-5">
      <div>
        <div className="label">Match threshold τ = {tau.toFixed(2)} {busy && <span className="text-blue-600 normal-case">· rescoring…</span>}</div>
        <input type="range" min="0.30" max="0.95" step="0.01" value={tau} onChange={(e) => slide(parseFloat(e.target.value))} className="w-full accent-blue-600" />
        <p className="text-xs text-slate-500">Only the matcher reruns; the video stages are not repeated.</p>
      </div>
      {result.mode !== "hint-only" && (
        <div>
          <div className="label mb-1">Investigator hint</div>
          <HintInput value={hint} onChange={setHint} />
          <div className="flex gap-2 mt-2">
            <button className="btn-primary" disabled={busy} onClick={() => onRescore({ hint })}>Apply hint</button>
            {result.hint && <button className="btn-ghost" disabled={busy} onClick={() => { setHint(""); onRescore({ clearHint: true }); }}>Clear hint</button>}
          </div>
        </div>
      )}
    </div>
  );
}

const TABS = [
  ["vehicles", "Vehicles found"],
  ["evidence", "Evidence"],
  ["shortlist", "Shortlist"],
  ["whatif", "What-if"],
  ["summary", "Summary & report"],
  ["crosscam", "Cross-camera"],
];

export default function App() {
  const [health, setHealth] = useState(undefined);
  const netActive = useNetActive();
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState(() => new URLSearchParams(location.search).get("job"));
  const [job, setJob] = useState(null);
  const [tab, setTab] = useState("vehicles");
  const [trackId, setTrackId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refreshJobs = useCallback(() => api.jobs().then(setJobs).catch(() => {}), []);
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    const url = new URL(location.href);
    if (jobId) url.searchParams.set("job", jobId); else url.searchParams.delete("job");
    history.replaceState(null, "", url);
    if (!jobId) { setJob(null); return; }
    let stop = false;
    let t;
    const poll = async () => {
      try {
        const j = await api.job(jobId);
        if (stop) return;
        setJob(j);
        if (j.status === "queued" || j.status === "running") t = setTimeout(poll, 800);
        else {
          refreshJobs();
          api.health().then(setHealth).catch(() => {});
        }
      } catch (e) {
        if (!stop) setErr(String(e.message || e));
      }
    };
    poll();
    return () => { stop = true; clearTimeout(t); };
  }, [jobId, refreshJobs]);

  const result = job?.result;
  useEffect(() => {
    if (result) setTrackId((cur) => (result.tracks.some((t) => t.track_id === cur) ? cur : result.primary_track_id ?? result.tracks[0]?.track_id ?? null));
  }, [result]);

  async function rescore(opts) {
    setBusy(true);
    setErr("");
    try {
      const r = await api.rescore(jobId, { ...opts, trackId: opts.hint ? trackId : undefined });
      setJob((j) => ({ ...j, result: r }));
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const track = result?.tracks.find((t) => t.track_id === trackId);
  const goNew = () => { setJobId(null); setTab("vehicles"); };

  const analysing = job && (job.status === "queued" || job.status === "running");

  return (
    <div className="site app min-h-screen">
      <AnimatePresence>
        {(netActive || busy || analysing) && (
          <motion.div key="net" className="netbar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <span className="netbar__run" />
          </motion.div>
        )}
      </AnimatePresence>
      <Header jobId={jobId} onNew={goNew} />
      {!jobId && <Hero health={health} />}

      <main className="app-main max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-5">
        {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{err}</div>}
        {!jobId && (
          <>
            <NewCase
              health={health}
              onStarted={(id) => { setJobId(id); setTab("vehicles"); }}
              onSearchResult={(r) => { refreshJobs(); setJobId(r.case_id); setTab("shortlist"); }}
            />
            <CaseList jobs={jobs} current={jobId} onOpen={(id) => setJobId(id)}
              onDelete={async (id) => { await api.deleteJob(id).catch(() => {}); refreshJobs(); }} />
          </>
        )}

        {jobId && !job && !err && (
          <div className="max-w-5xl mx-auto py-24">
            <div className="label-mono mb-3">opening case {jobId}</div>
            <div className="upbar"><span className="indet" /></div>
          </div>
        )}

        {jobId && job && (job.status === "queued" || job.status === "running" || job.status === "error") && <Progress job={job} />}

        {jobId && result && (
          <motion.div className="space-y-5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <h2 className="text-[clamp(1.75rem,3vw,2.75rem)] leading-none mr-2">
                {result.mode === "hint-only" ? "Hint-only search" : result.clip?.name}
                {result.crosscam && <span className="text-slate-500 font-normal"> + {result.crosscam.clip_b?.name}</span>}
              </h2>
              <span className="text-xs font-mono text-slate-500">case {result.case_id}</span>
              {result.clip?.low_light && <span className="chip bg-indigo-900 text-indigo-800"><Icon name="moon" size={12} />low light · median brightness {fmt2(result.clip.median_brightness)}</span>}
              {result.warnings?.map((w, i) => (
                <span key={i} className="chip bg-amber-100 text-amber-800 max-w-full" style={{ whiteSpace: "normal", height: "auto", lineHeight: 1.45 }}>{w}</span>
              ))}
            </div>
            <ResultControls result={result} onRescore={rescore} busy={busy} />
            <div className="flex items-center border-b border-slate-300 px-1 overflow-x-auto">
              {TABS.filter(([k]) => !(result.mode === "hint-only" && (k === "evidence" || k === "vehicles" || k === "crosscam"))).map(([k, l]) => (
                <button key={k} className={`tab relative !border-transparent ${tab === k ? "tab-active" : ""}`} onClick={() => setTab(k)}>
                  {l}{k === "crosscam" && result.crosscam ? ` (${result.crosscam.pairs.filter((p) => p.same_vehicle).length})` : ""}
                  {tab === k && <motion.span layoutId="tab-line" className="absolute left-2 right-2 -bottom-px h-[2px] bg-[var(--red)]" transition={{ duration: 0.25, ease: EASE }} />}
                </button>
              ))}
              {result.tracks.length > 1 && (tab === "evidence" || tab === "shortlist" || tab === "whatif") && (
                <select className="ml-auto my-1 input w-auto" value={trackId ?? ""} onChange={(e) => setTrackId(parseInt(e.target.value, 10))}>
                  {result.tracks.map((t) => <option key={t.track_id} value={t.track_id}>Track {t.track_id} · {t.fused.text || "no plate"}</option>)}
                </select>
              )}
            </div>
            <div>
              {tab === "vehicles" && <Vehicles tracks={result.tracks} selected={trackId} primaryId={result.primary_track_id}
                hidden={(result.hidden_tracks || []).filter((h) => h.clip_role !== "B")}
                label={result.crosscam ? "Camera A" : null} onSelect={(id) => { setTrackId(id); setTab("evidence"); }} />}
              {tab === "evidence" && <Evidence track={track} />}
              {tab === "shortlist" && <Shortlist track={track} />}
              {tab === "whatif" && <WhatIf jobId={jobId} track={track} caseThreshold={result.threshold} />}
              {tab === "summary" && <Summary caseResult={result} jobId={jobId} />}
              {tab === "crosscam" && <CrossCam caseResult={result} />}
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
