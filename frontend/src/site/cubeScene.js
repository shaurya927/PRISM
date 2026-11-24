// The black puzzle cube in the site menu, drawn with three.js (React wrapper: CubeArt.jsx).
//
// 27 rounded pieces in mixed black finishes (satin, gloss, perforated metal, blasted grain, a fine
// weave), after the cube on resend.com. The front face carries the first nine characters of the night
// case's fused plate, one per piece, and the unresolved ? is the one red face. The cube opens scrambled
// and turns itself back until the plate reads in order, holds it, then scrambles and solves again:
// many partial reads put back into one plate, with the digit nobody could read left as ?, not guessed.
//
// One renderer is created the first time the menu opens and kept for the life of the page. While the
// menu is closed its drawing buffer shrinks to 1x1 px, so reopening the menu needs no new WebGL context
// and no shader compile.
import {
  CanvasTexture, Color, DirectionalLight, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, NeutralToneMapping, PerspectiveCamera, PlaneGeometry,
  PMREMGenerator, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const RED = "#dc2f3c"; // --red in site.css
const FONT = '"Geist Mono Variable", ui-monospace, monospace';
const PITCH = 1.045; // centre-to-centre distance of neighbouring pieces (a piece is 1 unit wide)
const RADIUS = 0.12; // edge rounding of a piece
// RoundedBoxGeometry maps each rounded edge into the outer band of its face's UV square. FLAT is the
// width of that band, so face art can stay on the flat part of the face.
const ARC = (Math.PI * RADIUS) / 2;
const FLAT = (0.5 * ARC) / (ARC + 1 - 2 * RADIUS);

const TURN = 0.5; // s per quarter turn
const FIRST_TURN = 0.4; // the first solve after the menu opens runs a little quicker
const REST = 0.07; // s between turns
const START = 0.45; // s from the menu opening to the first turn
const HOLD = 2.8; // s the solved plate is held
const PAUSE = 0.8; // s the scrambled cube waits before solving
const FIRST_MOVES = 5;
const MOVES = 6;
// Resting pose (radians): the plate face to the front left, the right face and the top in view. While
// the solved plate is held the cube turns a little further toward the viewer.
const POSE = { x: 0.5, y: -0.64 };
const SHOW = { x: 0.4, y: -0.5 };
const GLOW = 0.5; // emissive strength of the plate characters at rest

// Finishes for the 45 faces off the plate side, shuffled once with a fixed seed so the cube looks the
// same on every visit.
const MIX = [
  ...Array(14).fill("satin"), ...Array(7).fill("lift"), ...Array(7).fill("gloss"),
  ...Array(7).fill("perf"), ...Array(6).fill("grain"), ...Array(4).fill("weave"),
];

const AXES = ["x", "y", "z"];
const AXIS = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };

/** Small seeded PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** CSS-style cubic-bezier easing (x1, x2 in [0, 1]); y may leave [0, 1] for an overshoot. */
function bezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = ((ax * t + bx) * t + cx) * t - x;
      const slope = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(err) < 1e-6 || Math.abs(slope) < 1e-6) break;
      t -= err / slope;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}
// A quarter turn: eases in, then lands slightly past square and settles, like a real cube clicking home.
const turnEase = bezier(0.6, 0, 0.2, 1.12);

/** Random moves on alternating axes, so no move undoes or merges with the one before it. */
function randomMoves(n) {
  const out = [];
  let last = "";
  while (out.length < n) {
    const axis = AXES[Math.floor(Math.random() * 3)];
    if (axis === last) continue;
    out.push({ axis, layer: Math.floor(Math.random() * 3) - 1, dir: Math.random() < 0.5 ? 1 : -1 });
    last = axis;
  }
  return out;
}
const undo = (m) => ({ ...m, dir: -m.dir });

function makeCanvas(n) {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  return c;
}

/**
 * Studio lighting as an environment map: a black room with five soft panels, blurred by PMREM. Glossy
 * black only shows what it reflects, so these panels are what draw the faces and edges.
 */
function studio(renderer) {
  const room = new Scene();
  const plane = new PlaneGeometry(1, 1);
  // each panel is brightest in the middle and fades out to its edges, so reflections are soft gradients
  const c = makeCanvas(64), g = c.getContext("2d");
  const fall = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  fall.addColorStop(0, "#fff");
  fall.addColorStop(0.5, "#777");
  fall.addColorStop(1, "#000");
  g.fillStyle = fall;
  g.fillRect(0, 0, 64, 64);
  const soft = new CanvasTexture(c);
  const mats = [];
  const panel = (w, h, x, y, z, k) => {
    const m = new MeshBasicMaterial({ map: soft, color: new Color().setScalar(k), side: DoubleSide });
    const p = new Mesh(plane, m);
    p.scale.set(w, h, 1);
    p.position.set(x, y, z);
    p.lookAt(0, 0, 0);
    mats.push(m);
    room.add(p);
  };
  panel(8, 4, 0.5, 8, -4.6, 2); // overhead softbox: top faces catch its fading edge, so they shade from back to front
  panel(2.4, 10, 9, 0.5, -3.5, 3.2); // tall strip on the right: the right faces and the vertical edges
  panel(4, 1.6, -2, 6, 6, 1); // small panel above the viewer: a line of light along the upper edges
  panel(6, 4, -8, -3, 3, 0.8); // faint fill low on the left: a sheen across the plate face
  panel(2.5, 8, -6, 2, -8, 2.2); // kicker behind on the left: lifts the outline off the black
  const pm = new PMREMGenerator(renderer);
  const target = pm.fromScene(room, 0.025);
  pm.dispose();
  plane.dispose();
  soft.dispose();
  mats.forEach((m) => m.dispose());
  return target;
}

/** Perforated metal: a hex grid of round holes on the flat part of the face (colour and height). */
function perforated(n) {
  const color = makeCanvas(n), height = makeCanvas(n);
  const a = color.getContext("2d"), b = height.getContext("2d");
  a.fillStyle = "#232325";
  a.fillRect(0, 0, n, n);
  b.fillStyle = "#fff";
  b.fillRect(0, 0, n, n);
  const lo = n * (FLAT + 0.04), span = n - 2 * lo;
  const cols = 10, step = span / cols, rowStep = (step * Math.sqrt(3)) / 2, r = step * 0.3;
  const rows = Math.floor((span - step) / rowStep) + 1;
  const y0 = lo + (span - (rows - 1) * rowStep) / 2;
  a.fillStyle = "#000";
  b.fillStyle = "#000";
  for (let i = 0; i < rows; i++) {
    const odd = i % 2;
    for (let k = 0; k < cols - odd; k++) {
      const x = lo + step / 2 + k * step + (odd ? step / 2 : 0);
      const y = y0 + i * rowStep;
      for (const g of [a, b]) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  return { color, height };
}

/** Blasted grain: per-texel height noise, and a roughness map with a few polished specks that glint. */
function blasted(n, rand) {
  const rough = makeCanvas(n), height = makeCanvas(n);
  const rc = rough.getContext("2d"), hc = height.getContext("2d");
  const ri = rc.createImageData(n, n), hi = hc.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const k = i * 4;
    const h = (40 + rand() * 190) | 0;
    const r = rand() < 0.12 ? 50 : (150 + rand() * 90) | 0; // roughness is read from the green channel
    hi.data[k] = hi.data[k + 1] = hi.data[k + 2] = h;
    ri.data[k] = ri.data[k + 1] = ri.data[k + 2] = r;
    hi.data[k + 3] = ri.data[k + 3] = 255;
  }
  rc.putImageData(ri, 0, 0);
  hc.putImageData(hi, 0, 0);
  return { rough, height };
}

/** A fine 2/2 twill, like carbon fibre: rows of raised strands whose direction alternates diagonally. */
function weave(n) {
  const c = makeCanvas(n), g = c.getContext("2d");
  const cells = 20, s = n / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = i * s, y = j * s;
      const across = (i + j) % 4 < 2;
      const grad = across ? g.createLinearGradient(x, y, x, y + s) : g.createLinearGradient(x, y, x + s, y);
      grad.addColorStop(0, "#1a1a1a");
      grad.addColorStop(0.5, "#e6e6e6");
      grad.addColorStop(1, "#1a1a1a");
      g.fillStyle = grad;
      g.fillRect(x, y, s, s);
    }
  }
  return c;
}

/** One plate character, light on black, or white on red for the unresolved ?. */
function paintGlyph(c, ch) {
  const n = c.width, g = c.getContext("2d"), q = ch === "?";
  g.fillStyle = q ? RED : "#0c0c0d";
  g.fillRect(0, 0, n, n);
  g.fillStyle = q ? "#fff" : "#e2e2e2";
  g.font = `500 ${Math.round(n * 0.4)}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const m = g.measureText(ch);
  g.fillText(ch, n / 2, n / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

/** A texture from a canvas. srgb: it holds colour (as opposed to height or roughness data). */
function texture(c, aniso, srgb = false) {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** The materials of the faces off the plate side, and of the hidden inner faces. */
function finishes(env, aniso) {
  const tex = (c, srgb) => texture(c, aniso, srgb);
  const perf = perforated(512), grain = blasted(160, rng(7)), twill = weave(256);
  const lit = { envMap: env };
  return {
    // the hidden inner faces, which show between pieces and inside a turning layer
    core: new MeshStandardMaterial({ color: 0x000000, roughness: 0.8, metalness: 0, envMapIntensity: 0.15, ...lit }),
    satin: new MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.5, metalness: 0.3, clearcoat: 0.3, clearcoatRoughness: 0.4, ...lit }),
    lift: new MeshPhysicalMaterial({ color: 0x1e1e21, roughness: 0.55, metalness: 0.25, ...lit }),
    gloss: new MeshPhysicalMaterial({ color: 0x030303, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, ...lit }),
    perf: new MeshPhysicalMaterial({ map: tex(perf.color, true), bumpMap: tex(perf.height), bumpScale: 1.6, roughness: 0.32, metalness: 0.75, ...lit }),
    grain: new MeshPhysicalMaterial({ color: 0x646468, roughness: 1, roughnessMap: tex(grain.rough), bumpMap: tex(grain.height), bumpScale: 2.2, metalness: 0.45, ...lit }),
    weave: new MeshPhysicalMaterial({ color: 0x101012, roughness: 0.3, metalness: 0.4, bumpMap: tex(twill), bumpScale: 1, clearcoat: 0.7, clearcoatRoughness: 0.12, ...lit }),
  };
}

let cube = null;

/** The page's one cube, created on first use. Throws if WebGL is unavailable. */
export function getCube(plate) {
  if (!cube) cube = createCube(plate);
  return cube;
}

function createCube(plate) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.setSize(1, 1, false);
  const canvas = renderer.domElement;
  canvas.className = "cube__canvas";

  const scene = new Scene();
  const camera = new PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 0, 11.8); // far enough that a corner never reaches the canvas edge
  const key = new DirectionalLight(0xffffff, 1.5);
  key.position.set(4, 8, 6);
  const rim = new DirectionalLight(0xffffff, 2.6);
  rim.position.set(-7, 3, -6);
  scene.add(key, rim);

  const env = studio(renderer).texture;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const look = finishes(env, aniso);

  // The plate face: one canvas per character, used as both the colour and the glow. When the plate
  // comes together the resolved characters flare in reading order; the ? only flickers.
  const glyphs = [...plate.padEnd(9, "?")].slice(0, 9).map((ch) => {
    const c = makeCanvas(256);
    paintGlyph(c, ch);
    const map = texture(c, aniso, true);
    const q = ch === "?";
    const material = new MeshPhysicalMaterial({
      map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: q ? 0.6 : GLOW, envMap: env,
      roughness: q ? 0.3 : 0.42, metalness: q ? 0.05 : 0.3, clearcoat: q ? 1 : 0.35, clearcoatRoughness: q ? 0.08 : 0.35,
    });
    return { ch, c, map, material, base: material.emissiveIntensity, flare: q ? 0.35 : 1.1 };
  });

  const rig = new Group();
  scene.add(rig);
  const geometry = new RoundedBoxGeometry(1, 1, 1, 5, RADIUS);
  const pick = shuffled(MIX, rng(11));
  let next = 0;
  const face = (outside) => (outside ? look[pick[next++ % pick.length]] : look.core);
  const pieces = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        // material slots follow BoxGeometry's groups: +x, -x, +y, -y, +z (the plate), -z
        const mats = [face(x === 1), face(x === -1), face(y === 1), face(y === -1),
          z === 1 ? glyphs[(1 - y) * 3 + x + 1].material : look.core, face(z === -1)];
        const mesh = new Mesh(geometry, mats);
        rig.add(mesh);
        pieces.push({ mesh, home: new Vector3(x, y, z), pos: new Vector3(x, y, z), q: new Quaternion() });
      }
    }
  }

  // Fonts first (the characters are painted with Geist Mono), then the shaders, compiled off the main
  // thread where the browser supports it. Either step gives up after a moment rather than block the art.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fonts = Promise.race([document.fonts?.load(`500 112px ${FONT}`), wait(1500)]).catch(() => {});
  const ready = Promise.all([
    fonts.then(() => glyphs.forEach((g) => { paintGlyph(g.c, g.ch); g.map.needsUpdate = true; })),
    Promise.race([renderer.compileAsync(scene, camera), wait(2500)]).catch(() => {}),
  ]);

  // --- puzzle state -------------------------------------------------------------------------------
  const rot = new Quaternion();
  const snapM = new Matrix4();
  const inLayer = (p, m) => Math.round(p.pos[m.axis]) === m.layer;
  const place = (p, r) => {
    p.mesh.position.copy(p.pos);
    if (r) {
      p.mesh.position.applyQuaternion(r);
      p.mesh.quaternion.multiplyQuaternions(r, p.q);
    } else {
      p.mesh.quaternion.copy(p.q);
    }
    p.mesh.position.multiplyScalar(PITCH);
  };
  /** Pose a layer part of the way through a move (amount 1 = a quarter turn). */
  const turnTo = (m, amount) => {
    rot.setFromAxisAngle(AXIS[m.axis], (m.dir * amount * Math.PI) / 2);
    for (const p of pieces) if (inLayer(p, m)) place(p, rot);
  };
  /** Finish a move: grid positions and orientations are rounded exactly, so no error builds up. */
  const commit = (m) => {
    rot.setFromAxisAngle(AXIS[m.axis], (m.dir * Math.PI) / 2);
    for (const p of pieces) {
      if (!inLayer(p, m)) continue;
      p.pos.applyQuaternion(rot).round();
      p.q.premultiply(rot);
      snapM.makeRotationFromQuaternion(p.q);
      const e = snapM.elements;
      for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) e[i] = Math.round(e[i]);
      p.q.setFromRotationMatrix(snapM);
      place(p, null);
    }
  };

  const s = { phase: "pause", timer: 0, queue: [], cur: null, scramble: [], turn: TURN, solvedAt: -99, show: 0 };
  const reset = (still) => {
    for (const p of pieces) {
      p.pos.copy(p.home);
      p.q.identity();
    }
    Object.assign(s, { queue: [], cur: null, solvedAt: -99, show: still ? 1 : 0 });
    if (!still) {
      s.scramble = randomMoves(FIRST_MOVES);
      s.scramble.forEach(commit);
      Object.assign(s, { phase: "pause", timer: START, turn: FIRST_TURN });
    }
    pieces.forEach((p) => place(p, null));
  };

  /** Advance the loop: pause (scrambled) -> solve -> hold (solved) -> scramble -> pause ... */
  const step = (dt, clock) => {
    if (s.cur) {
      s.cur.t += dt / s.turn;
      if (s.cur.t < 1) {
        turnTo(s.cur.move, turnEase(s.cur.t));
        return;
      }
      commit(s.cur.move);
      s.cur = null;
      s.timer = REST;
    }
    if ((s.timer -= dt) > 0) return;
    if (s.queue.length) {
      s.cur = { move: s.queue.shift(), t: 0 };
      return;
    }
    if (s.phase === "pause") {
      s.phase = "solve";
      s.queue = s.scramble.slice().reverse().map(undo);
    } else if (s.phase === "solve") {
      Object.assign(s, { phase: "hold", timer: HOLD, turn: TURN, solvedAt: clock });
    } else if (s.phase === "hold") {
      s.phase = "scramble";
      s.scramble = randomMoves(MOVES);
      s.queue = s.scramble.slice();
    } else {
      Object.assign(s, { phase: "pause", timer: PAUSE });
    }
  };

  // --- pose, pointer and frame loop ---------------------------------------------------------------
  const aim = { x: 0, y: 0 }, lean = { x: 0, y: 0 };
  let clock = 0;
  const pose = (dt) => {
    const k = 1 - Math.exp(-dt * 2.4);
    s.show += ((s.phase === "hold" ? 1 : 0) - s.show) * k;
    lean.x += (aim.x - lean.x) * (1 - Math.exp(-dt * 3));
    lean.y += (aim.y - lean.y) * (1 - Math.exp(-dt * 3));
    rig.rotation.x = POSE.x + (SHOW.x - POSE.x) * s.show + Math.sin(clock * 0.41) * 0.03 + lean.y * 0.14;
    rig.rotation.y = POSE.y + (SHOW.y - POSE.y) * s.show + Math.sin(clock * 0.27) * 0.09 + lean.x * 0.22;
    rig.position.y = Math.sin(clock * 0.7) * 0.06;
    glyphs.forEach((g, i) => {
      const t = clock - s.solvedAt - i * 0.07;
      g.material.emissiveIntensity = g.base + (t > 0 ? g.flare * Math.exp(-t * 2.6) * (1 - Math.exp(-t * 24)) : 0);
    });
  };

  let host = null, raf = 0, last = 0, lost = false, onLost = null, box = null, still = false;
  const draw = () => renderer.render(scene, camera);
  const fit = () => {
    if (!host || lost) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    box = host.getBoundingClientRect();
    // resizing clears the canvas, so draw straight away rather than show an empty frame
    if (canvas.classList.contains("is-on")) draw();
  };
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60; // a hidden tab resumes without a jump
    last = now;
    clock += dt;
    step(dt, clock);
    pose(dt);
    draw();
  };
  const onPointer = (e) => {
    if (!box) return;
    aim.x = Math.max(-1, Math.min(1, (e.clientX - (box.left + box.width / 2)) / (window.innerWidth / 2)));
    aim.y = Math.max(-1, Math.min(1, (e.clientY - (box.top + box.height / 2)) / (window.innerHeight / 2)));
  };
  const ro = new ResizeObserver(fit);

  canvas.addEventListener("webglcontextlost", () => {
    // The GPU dropped the context: stop, and let the next menu open build a fresh cube.
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    if (cube === api) cube = null;
    onLost?.();
  });

  /**
   * Show the cube in `el` (sized by CSS). still: one solved frame, no motion (reduced motion).
   * Returns the cleanup function.
   */
  function mount(el, opts = {}) {
    host = el;
    still = Boolean(opts.still);
    onLost = opts.onLost || null;
    el.appendChild(canvas);
    ro.observe(el);
    reset(still);
    clock = 0; // every opening starts from the same pose (and the still frame has no sway in it)
    Object.assign(aim, { x: 0, y: 0 });
    Object.assign(lean, { x: 0, y: 0 });
    pose(0);
    fit();
    let alive = true;
    const hover = !still && window.matchMedia("(hover: hover)").matches;
    if (hover) window.addEventListener("pointermove", onPointer, { passive: true });
    ready.then(() => {
      if (!alive || lost) return;
      if (still) draw();
      else {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
      canvas.classList.add("is-on");
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      if (hover) window.removeEventListener("pointermove", onPointer);
      if (host === el) host = null;
      onLost = null;
      canvas.remove();
      if (!lost) renderer.setSize(1, 1, false); // give the drawing buffer back while the menu is closed
    };
  }

  const api = { mount };
  return api;
}
