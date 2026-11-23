// Tracking overlay for the real highway footage (public/media/highway.mp4).
// The boxes are PRISM's own detector output for that clip: YOLO11 + ByteTrack, written by
// scripts/build_scene_media.py to public/media/highway_tracks.json at 15 fps. This module only
// interpolates them to the video's current time and draws them over the cover-fitted video.
//
// One track is "focused": the car nearest the pointer when the pointer is over the feed, otherwise
// the nearest (largest) car. Every track carries an illustrative plate (see fakePlate): the plates
// in this footage are far too small to read, so these are made up for the demo, not OCR output.

let tracksPromise = null;
/** Detector output for the highway loop (null if the file is missing). Fetched once per page. */
export function loadTracks() {
  tracksPromise = tracksPromise || fetch("/media/highway_tracks.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return tracksPromise;
}

const KIND = { c: "CAR", t: "TRUCK", b: "BUS" };
const RED = "#ff2a1f";

// Illustrative Indian-format plate per track id (state, district, series, number), e.g. "MH 12 KX 4821".
// Seeded by the id, so a car keeps the same plate for as long as it is tracked.
const STATES = ["CG", "MH", "KA", "DL", "TN", "GJ", "RJ", "UP", "MP", "HR", "TS", "KL"];
const SERIES = "ABCDEFGHJKLMNPRSTUVWXYZ"; // no I or O
const plates = new Map();
function fakePlate(id) {
  if (plates.has(id)) return plates.get(id);
  let s = (Number(id) * 2654435761) >>> 0;
  const next = (n) => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return s % n; };
  const pad = (v, n) => String(v).padStart(n, "0");
  const plate = `${STATES[next(STATES.length)]} ${pad(1 + next(40), 2)} ${SERIES[next(SERIES.length)]}${SERIES[next(SERIES.length)]} ${pad(1 + next(9999), 4)}`;
  plates.set(id, plate);
  return plate;
}

/** Boxes at time t (seconds), linearly interpolated between the two nearest detector frames. */
export function boxesAt(data, t) {
  const n = data.frames.length;
  const f = Math.max(0, t) * data.fps;
  const k = Math.floor(f) % n;
  const a = f - Math.floor(f);
  const next = new Map(data.frames[(k + 1) % n].map((b) => [b[0], b]));
  return data.frames[k].map((b) => {
    const q = next.get(b[0]);
    const m = (i) => (q ? b[i] + (q[i] - b[i]) * a : b[i]);
    return { id: b[0], kind: KIND[b[1]] || "VEHICLE", conf: b[6] / 100, x: m(2) / 1000, y: m(3) / 1000, w: m(4) / 1000, h: m(5) / 1000 };
  });
}

function brackets(ctx, x, y, w, h, len) {
  const l = Math.min(len, w * 0.3, h * 0.3);
  ctx.beginPath();
  ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
  ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
  ctx.moveTo(x + w, y + h - l); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - l, y + h);
  ctx.moveTo(x + l, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - l);
  ctx.stroke();
}

function tag(ctx, x, y, text, bg, fg) {
  ctx.font = "600 10.5px 'Geist Mono Variable', ui-monospace, monospace";
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = bg;
  ctx.fillRect(x, y - 17, w, 17);
  ctx.fillStyle = fg;
  ctx.fillText(text, x + 6, y - 5);
  return w;
}

/**
 * Draw the overlay every frame until destroyed.
 * opts.zone: [x0, y0, x1, y1] canvas fractions; only boxes centred inside are drawn.
 * opts.avoid: CSS selector; boxes overlapping those elements (e.g. hero text) are not drawn.
 * opts.onCount(n): called when the number of tracked vehicles on screen changes.
 */
export function createFeedHud(canvas, video, opts = {}) {
  const ctx = canvas.getContext("2d");
  let data = null;
  let raf = 0;
  let alive = true;
  let visible = true;
  let W = 0, H = 0, dpr = 1;
  let pointer = null;
  let focusId = null;
  let lastCount = -1;

  loadTracks().then((d) => { if (alive) data = d; });

  const fit = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  };
  const ro = new ResizeObserver(fit);
  ro.observe(canvas);
  fit();

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (!opts.still) visible ? video.play().catch(() => {}) : video.pause();
  });
  io.observe(canvas);

  // rectangles (canvas px) of page elements the boxes must not cover, re-measured a few times a second
  let avoid = [];
  let measured = 0;
  const measureAvoid = (now) => {
    if (!opts.avoid || now - measured < 250) return;
    measured = now;
    const c = canvas.getBoundingClientRect();
    avoid = Array.from(document.querySelectorAll(opts.avoid), (el) => {
      const r = el.getBoundingClientRect();
      return [r.left - c.left - 12, r.top - c.top - 22, r.right - c.left + 12, r.bottom - c.top + 12];
    }).filter((r) => r[2] > r[0] && r[3] > r[1]);
  };

  const move = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    pointer = x >= 0 && y >= 0 && x <= r.width && y <= r.height ? { x, y } : null;
  };
  window.addEventListener("pointermove", move, { passive: true });

  const draw = (now) => {
    raf = requestAnimationFrame(draw);
    if (!visible) return;
    measureAvoid(now);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!data || opts.hud === false) return;
    // the video is object-fit: cover, so map frame fractions through the same scale and crop
    const s = Math.max(W / data.w, H / data.h);
    const ox = (W - data.w * s) / 2, oy = (H - data.h * s) / 2;
    const z = opts.zone;
    const boxes = boxesAt(data, video.currentTime || 0)
      .map((b) => ({ ...b, px: ox + b.x * data.w * s, py: oy + b.y * data.h * s, pw: b.w * data.w * s, ph: b.h * data.h * s }))
      .filter((b) => {
        if (avoid.some((r) => b.px < r[2] && b.px + b.pw > r[0] && b.py < r[3] && b.py + b.ph > r[1])) return false;
        if (!z) return true;
        const cx = (b.px + b.pw / 2) / W, cy = (b.py + b.ph / 2) / H;
        return cx >= z[0] && cx <= z[2] && cy >= z[1] && cy <= z[3];
      });
    if (boxes.length !== lastCount) { lastCount = boxes.length; opts.onCount?.(boxes.length); }

    let focus = null;
    if (pointer) {
      let best = 1e9;
      for (const b of boxes) {
        const d = Math.hypot(b.px + b.pw / 2 - pointer.x, b.py + b.ph / 2 - pointer.y);
        if (d < best && d < 260) { best = d; focus = b; }
      }
    }
    if (!focus) focus = boxes.find((b) => b.id === focusId && b.pw > 24) || null;
    if (!focus) for (const b of boxes) if (!focus || b.pw * b.ph > focus.pw * focus.ph) focus = b;
    focusId = focus?.id ?? null;

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,.62)";
    for (const b of boxes) {
      if (b === focus) continue;
      brackets(ctx, b.px, b.py, b.pw, b.ph, 9);
      if (b.pw > 34 && opts.labels !== false) {
        ctx.font = "500 9.5px 'Geist Mono Variable', ui-monospace, monospace";
        ctx.fillStyle = "rgba(255,255,255,.72)";
        ctx.fillText(`#${b.id} ${b.kind} ${b.conf.toFixed(2)}`, b.px, b.py - 4);
        ctx.fillText(fakePlate(b.id), b.px, b.py + b.ph + 11);
      }
    }
    if (focus) {
      const { px, py, pw, ph } = focus;
      ctx.fillStyle = "rgba(255,20,10,.09)";
      ctx.fillRect(px, py, pw, ph);
      ctx.lineWidth = 2;
      ctx.strokeStyle = RED;
      ctx.shadowColor = "rgba(255,0,0,.8)";
      ctx.shadowBlur = 8;
      brackets(ctx, px, py, pw, ph, 14);
      ctx.shadowBlur = 0;
      if (opts.labels !== false) {
        tag(ctx, px, py - 3, `TRACK ${focus.id} · ${focus.kind} · ${focus.conf.toFixed(2)}`, RED, "#fff");
        tag(ctx, px, py + ph + 21, `PLATE ${fakePlate(focus.id)}`, "rgba(10,0,0,.82)", "#ffd9d6");
      }
    }
  };
  raf = requestAnimationFrame(draw);

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", move);
    },
  };
}
