async function handle(res) {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail || body);
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  health: () => fetch("/health").then(handle),
  config: () => fetch("/api/config").then(handle),
  jobs: () => fetch("/api/jobs").then(handle),
  job: (id) => fetch(`/api/jobs/${id}`).then(handle),
  deleteJob: (id) => fetch(`/api/jobs/${id}`, { method: "DELETE" }).then(handle),
  createJob: ({ file, hint, threshold }) => {
    const fd = new FormData();
    fd.append("file", file);
    if (hint) fd.append("hint", hint);
    if (threshold != null) fd.append("threshold", String(threshold));
    return fetch("/api/jobs", { method: "POST", body: fd }).then(handle);
  },
  createCrosscam: ({ fileA, fileB, hint, threshold, distanceKm, gapS }) => {
    const fd = new FormData();
    fd.append("file_a", fileA);
    fd.append("file_b", fileB);
    if (hint) fd.append("hint", hint);
    if (threshold != null) fd.append("threshold", String(threshold));
    if (distanceKm) fd.append("distance_km", String(distanceKm));
    if (gapS) fd.append("gap_s", String(gapS));
    return fetch("/api/crosscam", { method: "POST", body: fd }).then(handle);
  },
  rescore: (id, { threshold, hint, trackId, clearHint }) => {
    const q = new URLSearchParams();
    if (trackId != null) q.set("track_id", String(trackId));
    if (clearHint) q.set("clear_hint", "true");
    return fetch(`/api/jobs/${id}/rescore?${q}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threshold, hint: hint || null }),
    }).then(handle);
  },
  search: (body) =>
    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(handle),
  reportUrl: (id, fmt) => `/api/report/${id}?format=${fmt}`,
};
