import { tracked } from "./net.js";

// Clerk session token for the API (set by the auth gate in auth.jsx). Without Clerk it stays null and
// requests go out without an Authorization header, as before.
let getToken = null;
export function setTokenGetter(fn) {
  getToken = fn;
}

async function authHeaders(extra = {}) {
  const token = getToken ? await getToken() : null;
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/** fetch with the Clerk session token attached. */
async function authFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: await authHeaders(opts.headers || {}) });
}

function errorMessage(status, statusText, body) {
  if (body && typeof body.detail === "string") return body.detail;
  if (body && (body.detail || body)) return JSON.stringify(body.detail || body);
  return `${status} ${statusText}`;
}

async function handle(res) {
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    throw new Error(errorMessage(res.status, res.statusText, body));
  }
  return res.json();
}

/** multipart POST with upload progress (fetch cannot report it). onProgress(loadedBytes, totalBytes). */
function upload(url, form, onProgress) {
  return tracked(
    new Promise(async (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      const headers = await authHeaders();
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      };
      xhr.onload = () => {
        let body = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* not JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(errorMessage(xhr.status, xhr.statusText, body)));
      };
      xhr.onerror = () => reject(new Error("Network error while uploading the clip"));
      xhr.send(form);
    })
  );
}

export const api = {
  health: () => fetch("/health").then(handle),
  config: () => authFetch("/api/config").then(handle),
  jobs: () => authFetch("/api/jobs").then(handle),
  job: (id) => authFetch(`/api/jobs/${id}`).then(handle),
  deleteJob: (id) => tracked(authFetch(`/api/jobs/${id}`, { method: "DELETE" }).then(handle)),
  createJob: ({ file, hint, threshold, onProgress }) => {
    const fd = new FormData();
    fd.append("file", file);
    if (hint) fd.append("hint", hint);
    if (threshold != null) fd.append("threshold", String(threshold));
    return upload("/api/jobs", fd, onProgress);
  },
  createCrosscam: ({ fileA, fileB, hint, threshold, distanceKm, gapS, onProgress }) => {
    const fd = new FormData();
    fd.append("file_a", fileA);
    fd.append("file_b", fileB);
    if (hint) fd.append("hint", hint);
    if (threshold != null) fd.append("threshold", String(threshold));
    if (distanceKm) fd.append("distance_km", String(distanceKm));
    if (gapS) fd.append("gap_s", String(gapS));
    return upload("/api/crosscam", fd, onProgress);
  },
  rescore: (id, { threshold, hint, trackId, clearHint }) => {
    const q = new URLSearchParams();
    if (trackId != null) q.set("track_id", String(trackId));
    if (clearHint) q.set("clear_hint", "true");
    return tracked(
      authFetch(`/api/jobs/${id}/rescore?${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold, hint: hint || null }),
      }).then(handle)
    );
  },
  /** Hypothetical re-ranking and stability analysis. Read-only: nothing is saved to the case. */
  whatif: (id, { trackId, slots, color, bodyType, threshold }, signal) =>
    authFetch(`/api/jobs/${id}/whatif`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track_id: trackId ?? null, slots: slots || {}, color: color || null, body_type: bodyType || null, threshold: threshold ?? null }),
      signal,
    }).then(handle),
  search: (body) =>
    tracked(
      authFetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(handle)
    ),
  reportUrl: (id, fmt) => `/api/report/${id}?format=${fmt}`,
};
