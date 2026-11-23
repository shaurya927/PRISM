// Night highway seen from a roadside CCTV camera, drawn on a 2D canvas.
// A static layer (sky, skyline, road, lane markings, street lamps) is rendered once per resize;
// traffic (headlights coming toward the camera, taillights going away) is drawn every frame.
// With `hud`, a tracking box follows one oncoming car, the car nearest the pointer if the pointer
// is over the canvas. Its plate starts as ?????????? and characters appear as the car comes
// closer, the same idea PRISM uses: a character is only shown once there are enough pixels to read it.
//
// Units are metres. Indian traffic keeps left, so oncoming lanes are on the right (x > 0).

const ONCOMING = [1.9, 5.6, 9.3];
const OUTGOING = [-1.9, -5.6, -9.3];
const LANE_SPEED = [31, 27, 22]; // m/s, inner lane fastest
const EDGE = 11.4;
const Z_FAR = 320;
const STATES = ["CG", "MH", "KA", "DL", "TN", "GJ", "UP", "RJ", "HR", "KL", "TS", "MP"];
const KINDS = {
  car: { w: 1.8, h: 1.45 },
  suv: { w: 1.9, h: 1.75 },
  truck: { w: 2.5, h: 3.2 },
  bike: { w: 0.8, h: 1.4 },
};
const BODY = ["#1b1113", "#231a1b", "#2b2325", "#140d0e", "#20191b"];

export const HIGHWAY_DEFAULTS = {
  camH: 5.2, // camera height above the road
  camX: 0, // camera position across the road
  horizon: 0.42, // horizon height as a fraction of the canvas
  focal: 0.95,
  density: 1,
  hud: true,
  skipLanes: [],
  seed: 7,
};

/** Ground-plane projection shared by the canvas and anything placed on top of it (the intro car). */
export function projector(W, H, o) {
  const f = o.focal * Math.max(W, H * 1.2);
  const cx = W / 2;
  const hy = H * o.horizon;
  return {
    f, cx, hy,
    p(x, z) {
      const s = f / z;
      return { x: cx + (x - o.camX) * s, y: hy + o.camH * s, s };
    },
  };
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sprite(r, g, b, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d");
  const grd = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grd.addColorStop(0.12, `rgba(${r},${g},${b},0.85)`);
  grd.addColorStop(0.38, `rgba(${r},${g},${b},0.22)`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grd;
  x.fillRect(0, 0, size, size);
  return c;
}

function makePlate(rng) {
  const d = () => Math.floor(rng() * 10);
  const L = () => String.fromCharCode(65 + Math.floor(rng() * 26));
  const st = STATES[Math.floor(rng() * STATES.length)];
  return `${st}${d()}${d() || 1}${L()}${L()}${d()}${d()}${d()}${d()}`;
}

function shuffled(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createHighway(canvas, opts = {}) {
  const o = { ...HIGHWAY_DEFAULTS, ...opts };
  const ctx = canvas.getContext("2d");
  const rng = mulberry32(o.seed);
  const S = {
    warm: sprite(255, 214, 204),
    head: sprite(236, 246, 255),
    tail: sprite(255, 26, 16),
    pink: sprite(255, 179, 179),
  };
  let W = 1, H = 1, dpr = 1, P = null, layer = null;
  let cars = [];
  let nextId = 101;
  const lanes = [
    ...ONCOMING.map((x, i) => ({ x, dir: 1, v: LANE_SPEED[i], i })),
    ...OUTGOING.map((x, i) => ({ x, dir: -1, v: LANE_SPEED[i] - 2, i })),
  ].filter((l) => !o.skipLanes.includes(l.x));
  const pointer = { x: 0, y: 0, t: -1e9, inside: false };
  const hud = { car: null, box: null };

  function newCar(lane, z) {
    const r = rng();
    let kind = r < 0.64 ? "car" : r < 0.86 ? "suv" : r < 0.94 ? "truck" : "bike";
    if (lane.i === 0 && (kind === "truck" || kind === "bike")) kind = "car"; // fast lane
    return {
      id: nextId++, lane, z, kind, ...KINDS[kind],
      v: lane.v * (0.96 + rng() * 0.08),
      body: BODY[Math.floor(rng() * BODY.length)],
      plate: makePlate(rng), order: shuffled(10, rng),
    };
  }

  function gap() {
    return (26 + rng() * 70) / o.density;
  }

  function populate() {
    cars = [];
    for (const lane of lanes) {
      for (let z = 6 + rng() * 30; z < Z_FAR; z += gap()) cars.push(newCar(lane, z));
    }
  }

  function buildLayer() {
    layer = document.createElement("canvas");
    layer.width = Math.round(W * dpr);
    layer.height = Math.round(H * dpr);
    const c = layer.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lr = mulberry32(o.seed + 11);
    // sky and ground
    let g = c.createLinearGradient(0, 0, 0, P.hy);
    g.addColorStop(0, "#030000");
    g.addColorStop(1, "#130303");
    c.fillStyle = g;
    c.fillRect(0, 0, W, P.hy + 1);
    g = c.createLinearGradient(0, P.hy, 0, H);
    g.addColorStop(0, "#0a0303");
    g.addColorStop(1, "#100606");
    c.fillStyle = g;
    c.fillRect(0, P.hy, W, H - P.hy);
    // city glow on the horizon
    const rg = c.createRadialGradient(P.cx, P.hy, 0, P.cx, P.hy, W * 0.6);
    rg.addColorStop(0, "rgba(184,0,0,0.30)");
    rg.addColorStop(0.35, "rgba(120,0,0,0.12)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = rg;
    c.fillRect(0, 0, W, H);
    // skyline
    const k = Math.max(0.5, H / 900);
    for (let x = -10; x < W + 10;) {
      const bw = (10 + lr() * 34) * k;
      const bh = (4 + lr() ** 2 * 52) * k * (0.5 + 0.5 * Math.min(1, Math.abs(x - P.cx) / (W * 0.25)));
      c.fillStyle = "#070101";
      c.fillRect(x, P.hy - bh, bw, bh + 1);
      c.fillStyle = "rgba(255,179,179,0.20)";
      for (let wy = P.hy - bh + 3 * k; wy < P.hy - 3 * k; wy += 5 * k) {
        for (let wx = x + 2 * k; wx < x + bw - 3 * k; wx += 5 * k) if (lr() < 0.12) c.fillRect(wx, wy, 1.4 * k, 1.6 * k);
      }
      x += bw + lr() * 6 * k;
    }
    // road
    const quad = (x0, x1, z0, z1, style) => {
      const a = P.p(x0, z0), b = P.p(x1, z0), d = P.p(x1, z1), e = P.p(x0, z1);
      c.fillStyle = style;
      c.beginPath();
      c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y);
      c.closePath();
      c.fill();
    };
    g = c.createLinearGradient(0, P.hy, 0, H);
    g.addColorStop(0, "#0d0505");
    g.addColorStop(1, "#1c0b0b");
    quad(-EDGE - 0.6, EDGE + 0.6, 0.6, Z_FAR * 4, g);
    quad(-0.45, 0.45, 0.6, Z_FAR * 4, "#190a0a");
    quad(-0.06, 0.06, 0.6, Z_FAR * 4, "rgba(255,179,179,0.10)");
    for (const sx of [-1, 1]) quad(sx * (EDGE - 0.35), sx * (EDGE - 0.2), 0.6, Z_FAR * 4, "rgba(246,239,237,0.22)");
    for (const x of [-7.45, -3.75, 3.75, 7.45]) {
      for (let z0 = 2; z0 < 280; z0 += 12) quad(x - 0.08, x + 0.08, z0, z0 + 3, `rgba(246,239,237,${0.42 * (1 - z0 / 300)})`);
    }
    // street lamps with light pools on the road
    c.globalCompositeOperation = "lighter";
    for (const side of [-1, 1]) {
      for (let z = 8 + (side > 0 ? 17 : 0); z < 300; z += 34) {
        const base = P.p(side * (EDGE + 1.2), z);
        const topY = P.hy + (o.camH - 10) * base.s;
        const armX = P.cx + (side * (EDGE - 1.6) - o.camX) * base.s;
        c.globalCompositeOperation = "source-over";
        c.strokeStyle = "rgba(70,34,34,0.9)";
        c.lineWidth = Math.max(0.6, 0.14 * base.s);
        c.beginPath();
        c.moveTo(base.x, base.y); c.lineTo(base.x, topY); c.lineTo(armX, topY);
        c.stroke();
        c.globalCompositeOperation = "lighter";
        const r = Math.max(3, 1.6 * base.s);
        c.globalAlpha = 0.9;
        c.drawImage(S.warm, armX - r, topY - r, r * 2, r * 2);
        c.globalAlpha = 0.25;
        c.drawImage(S.warm, armX - r * 4, topY - r * 4, r * 8, r * 8);
        const y1 = P.p(0, Math.max(0.8, z - 6)).y, y2 = P.p(0, z + 6).y;
        const pc = P.cx + (side * (EDGE - 3) - o.camX) * base.s;
        c.globalAlpha = 0.09;
        c.drawImage(S.warm, pc - 6 * base.s, y2, 12 * base.s, Math.max(2, y1 - y2));
        c.globalAlpha = 1;
      }
    }
    c.globalCompositeOperation = "source-over";
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    P = projector(W, H, o);
    buildLayer();
    if (!cars.length) populate();
    if (o.still) render(performance.now());
  }

  function step(dt) {
    for (const c of cars) {
      c.z -= c.lane.dir * c.v * dt;
      if (c.lane.dir === 1 && c.z < 1.2) {
        const far = Math.max(Z_FAR, ...cars.filter((d) => d.lane === c.lane && d !== c).map((d) => d.z));
        Object.assign(c, newCar(c.lane, far + gap()));
      } else if (c.lane.dir === -1 && c.z > Z_FAR) {
        const near = Math.min(4, ...cars.filter((d) => d.lane === c.lane && d !== c).map((d) => d.z));
        Object.assign(c, newCar(c.lane, near - gap()));
      }
    }
  }

  function glow(img, x, y, r, a) {
    ctx.globalAlpha = a;
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  }

  function trail(x0, y0, x1, y1, w, rgb, a) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(1, `rgba(${rgb},${a})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  function geom(c) {
    const g = P.p(c.lane.x, c.z);
    return { ...g, w: c.w * g.s, h: c.h * g.s };
  }

  function drawCar(c) {
    if (c.z < 0.8 || c.z > Z_FAR * 1.15) return;
    const g = geom(c);
    if (g.y - g.h > H + 40 || g.x + g.w < -80 || g.x - g.w > W + 80) return;
    const fade = clamp(1.25 - c.z / Z_FAR, 0.12, 1);
    const on = c.lane.dir === 1;
    // body (only visible once it is a few pixels wide)
    if (g.w > 5) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.min(1, g.w / 30) * fade;
      ctx.fillStyle = c.body;
      const lowH = c.kind === "truck" ? g.h * 0.9 : g.h * 0.52;
      ctx.fillRect(g.x - g.w / 2, g.y - lowH, g.w, lowH);
      if (c.kind !== "truck") {
        const top = g.w * (c.kind === "bike" ? 0.6 : 0.68);
        ctx.beginPath();
        ctx.moveTo(g.x - g.w * 0.46, g.y - lowH);
        ctx.lineTo(g.x - top / 2, g.y - g.h);
        ctx.lineTo(g.x + top / 2, g.y - g.h);
        ctx.lineTo(g.x + g.w * 0.46, g.y - lowH);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = on ? "rgba(255,255,255,0.06)" : "rgba(255,40,30,0.05)";
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(g.x - g.w / 2, g.y - lowH, g.w, Math.max(1, g.s * 0.04));
    }
    ctx.globalCompositeOperation = "lighter";
    const spread = c.kind === "bike" ? [0] : [-0.36, 0.36];
    const ly = g.y - g.h * (on ? 0.3 : 0.44);
    const prev = P.p(c.lane.x, c.z + c.lane.dir * c.v * 0.16);
    for (const k of spread) {
      const lx = g.x + k * g.w;
      const px = prev.x + k * c.w * prev.s;
      const py = prev.y - c.h * prev.s * (on ? 0.3 : 0.44);
      if (on) {
        const rh = Math.max(4, 1.0 * g.s);
        trail(px, py, lx, ly, Math.max(1, 0.16 * g.s), "236,246,255", 0.35 * fade);
        glow(S.head, lx, ly, rh, 0.55 * fade);
        glow(S.head, lx, ly, Math.max(1.4, 0.16 * g.s), 1 * fade);
        ctx.globalAlpha = 0.14 * fade;
        ctx.drawImage(S.head, lx - rh * 0.35, ly, rh * 0.7, rh * 2.8);
      } else {
        const rh = Math.max(2.5, 0.55 * g.s);
        trail(px, py, lx, ly, Math.max(1, 0.12 * g.s), "255,30,20", 0.45 * fade);
        glow(S.tail, lx, ly, rh, 0.75 * fade);
        ctx.globalAlpha = 0.18 * fade;
        ctx.drawImage(S.tail, lx - rh * 0.3, ly, rh * 0.6, rh * 2.6);
      }
    }
    if (c.kind === "truck") {
      for (const k of [-0.48, 0.48]) glow(S.pink, g.x + k * g.w, g.y - g.h * 0.97, Math.max(1.5, 0.3 * g.s), 0.7 * fade);
    }
    if (on && g.s > 2.5) {
      // headlight beam on the road in front of the car
      const a = P.p(c.lane.x, Math.max(0.9, c.z - 11));
      ctx.globalAlpha = 0.07 * fade;
      ctx.fillStyle = "#ecf6ff";
      ctx.beginPath();
      ctx.moveTo(g.x - g.w * 0.45, g.y);
      ctx.lineTo(g.x + g.w * 0.45, g.y);
      ctx.lineTo(a.x + 2.2 * a.s, a.y);
      ctx.lineTo(a.x - 2.2 * a.s, a.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // hudZone [x0, y0, x1, y1] as canvas fractions: the tracking box stays inside it, clear of page text.
  function inRange(c) {
    if (c.lane.dir !== 1 || c.z < 13 || c.z > 115) return false;
    const g = geom(c);
    const [x0, y0, x1, y1] = o.hudZone || [0, 0, 1, 1];
    return g.x - g.w / 2 > W * x0 + 10 && g.x + g.w / 2 < W * x1 - 10 && g.y - g.h > H * y0 && g.y < H * y1 - 40;
  }

  function pickTarget(now) {
    const pool = cars.filter(inRange);
    if (!pool.length) { hud.car = null; return; }
    if (pointer.inside && now - pointer.t < 3000) {
      let best = null, bd = 1e9;
      for (const c of pool) {
        const g = geom(c);
        const d = Math.hypot(g.x - pointer.x, g.y - g.h / 2 - pointer.y);
        if (d < bd) { bd = d; best = c; }
      }
      hud.car = best;
      return;
    }
    if (!hud.car || !inRange(hud.car)) hud.car = pool.filter((c) => c.z < 100).sort((a, b) => b.z - a.z)[0] || pool[0];
  }

  function drawHud(now) {
    pickTarget(now);
    const c = hud.car;
    if (!c) { hud.box = null; return; }
    const g = geom(c);
    const pad = Math.max(6, g.w * 0.14);
    const t = { x: g.x - g.w / 2 - pad, y: g.y - g.h - pad, w: g.w + pad * 2, h: g.h + pad * 1.6 };
    const b = hud.box && hud.box.id === c.id ? hud.box : hud.box ? { ...hud.box, id: c.id } : { ...t, id: c.id };
    const k = 0.32;
    b.x += (t.x - b.x) * k; b.y += (t.y - b.y) * k; b.w += (t.w - b.w) * k; b.h += (t.h - b.h) * k;
    hud.box = b;
    const cyan = "#45e0ea";
    const L = Math.min(16, b.w * 0.28);
    ctx.strokeStyle = cyan;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [x, y, dx, dy] of [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1], [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]]) {
      ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L);
    }
    ctx.stroke();
    ctx.font = '500 10.5px "Geist Mono Variable", ui-monospace, monospace';
    ctx.textBaseline = "middle";
    const tag = `TRACK ${c.id} · ${c.kind.toUpperCase()}`;
    const tw = ctx.measureText(tag).width + 12;
    ctx.fillStyle = cyan;
    ctx.fillRect(b.x, b.y - 18, tw, 15);
    ctx.fillStyle = "#0f0000";
    ctx.fillText(tag, b.x + 6, b.y - 10.5);
    // plate: bracket on the bumper, readout below the box
    if (g.w > 34) {
      const pw = Math.max(16, 0.52 * g.s), ph = Math.max(7, 0.13 * g.s);
      const px = g.x - pw / 2, py = g.y - g.h * 0.2 - ph / 2;
      ctx.strokeStyle = "#ff3b30";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(px - 2, py - 2, pw + 4, ph + 4);
    }
    const known = clamp(Math.floor((g.w - 42) / 11), 0, 10);
    const shown = c.plate.split("").map((ch, i) => (c.order.indexOf(i) < known ? ch : "?"));
    ctx.font = '600 12px "Geist Mono Variable", ui-monospace, monospace';
    const cw = ctx.measureText("M").width + 1.5;
    const rx = b.x, ry = b.y + b.h + 6, rw = cw * 10 + 64;
    ctx.fillStyle = "rgba(15,0,0,0.78)";
    ctx.fillRect(rx, ry, rw, 20);
    ctx.strokeStyle = "rgba(69,224,234,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, 19);
    ctx.font = '500 9.5px "Geist Mono Variable", ui-monospace, monospace';
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("PLATE", rx + 7, ry + 10.5);
    ctx.font = '600 12px "Geist Mono Variable", ui-monospace, monospace';
    shown.forEach((ch, i) => {
      ctx.fillStyle = ch === "?" ? "#ff5a4f" : "#ffffff";
      ctx.fillText(ch, rx + 46 + i * cw, ry + 10.5);
    });
  }

  function render(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(layer, 0, 0, W, H);
    cars.sort((a, b) => b.z - a.z);
    for (const c of cars) drawCar(c);
    if (o.hud) drawHud(now);
  }

  // ---------------------------------------------------------------- lifecycle
  let raf = 0, last = performance.now(), visible = true;
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
  io.observe(canvas);
  const move = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= r.width && pointer.y <= r.height;
    pointer.t = performance.now();
  };
  window.addEventListener("pointermove", move, { passive: true });
  if (o.still) {
    for (let i = 0; i < 160; i++) step(0.05);
    render(performance.now());
  } else {
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible || document.hidden) return;
      step(dt);
      render(now);
    };
    raf = requestAnimationFrame(frame);
  }
  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", move);
    },
  };
}
