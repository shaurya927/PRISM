import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import NewCase, { HintInput } from "./components/NewCase.jsx";
import Progress from "./components/Progress.jsx";
import Vehicles from "./components/Vehicles.jsx";
import Evidence from "./components/Evidence.jsx";
import Shortlist from "./components/Shortlist.jsx";
import Summary from "./components/Summary.jsx";
import CrossCam from "./components/CrossCam.jsx";
import { StatusChip, fmt2 } from "./components/common.jsx";

function DeviceBadge({ health }) {
  if (!health) return <span className="chip bg-slate-200 text-slate-600">API offline</span>;
  const gpu = health.device === "cuda";
  return (
    <span className={`chip ${gpu ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`} title={health.gpu || "CPU inference"}>
      {gpu ? `GPU · ${health.gpu || "CUDA"}` : "CPU"}
    </span>
  );
}

function CaseList({ jobs, current, onOpen, onDelete }) {
  if (!jobs.length) return null;
  return (
    <div className="card p-3 max-w-4xl mx-auto mt-6">
      <div className="label mb-2">Previous cases</div>
      <div className="divide-y divide-slate-100">
        {jobs.slice(0, 12).map((j) => (
          <div key={j.job_id} className={`flex items-center gap-3 py-1.5 text-sm ${current === j.job_id ? "font-semibold" : ""}`}>
            <button className="font-mono text-blue-700 hover:underline" onClick={() => onOpen(j.job_id)}>{j.job_id}</button>
            <span className="text-slate-500">{j.kind}</span>
            <span className="truncate">{j.clip || ""}</span>
            <span className="ml-auto text-xs text-slate-400">{j.created_at?.replace("T", " ").slice(0, 19)}</span>
            <span className={`chip ${j.status === "done" ? "bg-green-100 text-green-800" : j.status === "error" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-800"}`}>{j.status}</span>
            <button className="text-xs text-slate-400 hover:text-red-600" title="Delete case and its crops" onClick={() => onDelete(j.job_id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
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
  ["summary", "Summary & report"],
  ["crosscam", "Cross-camera"],
];

export default function App() {
  const [health, setHealth] = useState(null);
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

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <button onClick={goNew} className="flex items-center gap-2">
            <span className="text-2xl">◭</span>
            <span className="font-bold tracking-wide">PRISM</span>
            <span className="hidden md:inline text-xs text-slate-400">Plate Recovery &amp; Identification from Surveillance Media</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <a href="/" className="text-xs text-slate-400 hover:text-white mr-2">← Project site</a>
            {health && <span className="text-xs text-slate-400">registry {health.registry_size} · OCR {health.ocr_backend} · v{health.prism_version}</span>}
            <DeviceBadge health={health} />
            {jobId && <button className="btn bg-slate-700 hover:bg-slate-600 text-white" onClick={goNew}>+ New case</button>}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded p-2 text-sm">{err}</div>}
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

        {jobId && job && (job.status === "queued" || job.status === "running" || job.status === "error") && <Progress job={job} />}

        {jobId && result && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold">
                {result.mode === "hint-only" ? "Hint-only search" : result.clip?.name}
                {result.crosscam && <span className="text-slate-500 font-normal"> + {result.crosscam.clip_b?.name}</span>}
              </h2>
              <span className="text-xs font-mono text-slate-500">case {result.case_id}</span>
              {result.clip?.low_light && <span className="chip bg-indigo-900 text-white">🌙 low light (median brightness {fmt2(result.clip.median_brightness)})</span>}
              {track?.match && <StatusChip status={track.match.status} />}
              {result.warnings?.map((w, i) => <span key={i} className="chip bg-amber-100 text-amber-800">{w}</span>)}
            </div>
            <ResultControls result={result} onRescore={rescore} busy={busy} />
            <div className="flex border-b border-slate-300 bg-white rounded-t-lg px-2 overflow-x-auto">
              {TABS.filter(([k]) => !(result.mode === "hint-only" && (k === "evidence" || k === "vehicles" || k === "crosscam"))).map(([k, l]) => (
                <button key={k} className={`tab ${tab === k ? "tab-active" : ""}`} onClick={() => setTab(k)}>{l}{k === "crosscam" && result.crosscam ? ` (${result.crosscam.pairs.filter((p) => p.same_vehicle).length})` : ""}</button>
              ))}
              {result.tracks.length > 1 && (tab === "evidence" || tab === "shortlist") && (
                <select className="ml-auto my-1 input w-auto" value={trackId ?? ""} onChange={(e) => setTrackId(parseInt(e.target.value, 10))}>
                  {result.tracks.map((t) => <option key={t.track_id} value={t.track_id}>Track {t.track_id} · {t.fused.text || "no plate"}</option>)}
                </select>
              )}
            </div>
            <div>
              {tab === "vehicles" && <Vehicles tracks={result.tracks} selected={trackId} primaryId={result.primary_track_id}
                label={result.crosscam ? "Camera A" : null} onSelect={(id) => { setTrackId(id); setTab("evidence"); }} />}
              {tab === "evidence" && <Evidence track={track} />}
              {tab === "shortlist" && <Shortlist track={track} />}
              {tab === "summary" && <Summary caseResult={result} jobId={jobId} />}
              {tab === "crosscam" && <CrossCam caseResult={result} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
