// The lit, extruded 3D name in the hero.
//
// Each letter is its own mesh so the name can assemble on load (letters flip up
// from edge-on). Colour is the page's spectrum gradient baked into vertex
// colours across the whole name, under a clearcoat material lit by a generated
// room environment — no HDR file to fetch. The group is fitted to the box of
// the HTML <h1>, so the layout never moves when 3D takes over.
//
// Returns null when WebGL2 is unavailable; the HTML name then simply stays.

import * as THREE from "./vendor/three.module.min.js";
import { FontLoader } from "./vendor/FontLoader.js";
import { TextGeometry } from "./vendor/TextGeometry.js";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";

const STOPS = ["#ff6a2b", "#ff2e7e", "#9b5cff", "#3da9ff"].map((c) => new THREE.Color(c));
function spectrum(t, out) {
  const s = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(s));
  return out.copy(STOPS[i]).lerp(STOPS[i + 1], s - i);
}
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
// Frame-rate independent smoothing toward a target.
const approach = (v, t, rate, dt) => v + (t - v) * (1 - Math.exp(-dt * rate));

export async function startHero({ canvas, anchor, hero, reduced }) {
  if (!canvas || !anchor || !hero) return null;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null; // no WebGL2: keep the HTML name
  }
  const phone = matchMedia("(max-width: 640px)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2));
  // Neutral keeps the gradient's hues saturated; ACES would wash them toward white.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 14);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 5, 8);
  scene.add(key);
  const warm = new THREE.PointLight(0xff6a2b, 40, 40, 1.6);
  const cool = new THREE.PointLight(0x3da9ff, 40, 40, 1.6);
  scene.add(warm, cool);

  // ── build the name ────────────────────────────────────────────────────────
  const font = await new FontLoader().loadAsync("fonts/name.typeface.json");
  const unit = 1 / font.data.resolution;
  const DEPTH = 0.24;
  // Faces carry the full gradient; the extruded walls are the same colours
  // darkened, so each letter's face stays crisp against its neighbour's side.
  const face = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    metalness: 0.2,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.05,
  });
  const wall = face.clone();
  wall.color.set(0x4b4b58);
  wall.roughness = 0.38;
  const material = [face, wall]; // TextGeometry groups: 0 = faces, 1 = sides
  const TRACK = 0.014; // looser than the HTML name's -0.045em: extruded walls need air

  const name = new THREE.Group(); // receives scroll + pointer motion
  const inner = new THREE.Group(); // centred content
  name.add(inner);
  scene.add(name);

  const letters = [];
  const lines = ["Devondre", "Woodard"];
  const LINE = 0.86; // matches the CSS line-height of the HTML name
  lines.forEach((word, li) => {
    let x = 0;
    const row = [];
    for (const ch of word) {
      const geo = new TextGeometry(ch, {
        font,
        size: 1,
        depth: DEPTH,
        curveSegments: phone ? 5 : 9,
        bevelEnabled: true,
        bevelThickness: 0.035,
        bevelSize: 0.02,
        bevelSegments: phone ? 2 : 4,
      });
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const cx = (bb.max.x + bb.min.x) / 2;
      geo.translate(-cx, 0, -DEPTH / 2); // pivot at the letter's foot, centre of its depth
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x + cx, -li * LINE, 0);
      row.push(mesh);
      x += (font.data.glyphs[ch]?.ha ?? 600) * unit + TRACK;
    }
    const width = x - TRACK;
    for (const m of row) {
      m.position.x -= width / 2;
      inner.add(m);
      letters.push(m);
    }
  });

  // Centre the block and measure it.
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  inner.position.set(-centre.x, -centre.y, 0);

  // Spectrum across the whole name, tilted slightly so the two lines differ.
  const col = new THREE.Color();
  for (const m of letters) {
    const pos = m.geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + m.position.x;
      const wy = pos.getY(i) + m.position.y;
      const t = (wx - (box.min.x)) / size.x + (wy - centre.y) * -0.06;
      spectrum(t, col).toArray(colors, i * 3);
    }
    m.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }

  // ── fit to the HTML name's box ────────────────────────────────────────────
  const range = document.createRange();
  let base = { x: 0, y: 0, s: 1 };
  function fit() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const visW = visH * camera.aspect;
    const c = canvas.getBoundingClientRect();
    range.selectNodeContents(anchor);
    const r = range.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - c.left) / c.width;
    const cy = (r.top + r.height / 2 - c.top) / c.height;
    base = { x: (cx - 0.5) * visW, y: (0.5 - cy) * visH, s: ((r.width / c.width) * visW) / size.x };
    needsRender = true;
  }

  // ── motion state ──────────────────────────────────────────────────────────
  const state = { px: 0, py: 0, rx: 0, ry: 0, p: 0, pTarget: 0 };
  let needsRender = true;
  let visible = true;
  const t0 = performance.now();
  const STAGGER = 0.045, DUR = 1.25;
  const introLength = (letters.length - 1) * STAGGER + DUR;

  if (!reduced && matchMedia("(hover: hover) and (pointer: fine)").matches) {
    addEventListener(
      "pointermove",
      (e) => {
        state.px = (e.clientX / innerWidth) * 2 - 1;
        state.py = (e.clientY / innerHeight) * 2 - 1;
      },
      { passive: true }
    );
  }

  let last = performance.now();
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const elapsed = (now - t0) / 1000;
    const intro = reduced ? 1 : Math.min(1, elapsed / introLength);

    // Letters flip up from edge-on, one after another.
    letters.forEach((m, i) => {
      const e = reduced ? 1 : easeOutExpo(Math.min(1, Math.max(0, (elapsed - i * STAGGER) / DUR)));
      m.rotation.x = (1 - e) * (-Math.PI / 2);
      m.position.z = (1 - e) * -1.2;
    });

    const prevRx = state.rx, prevRy = state.ry, prevP = state.p;
    state.ry = approach(state.ry, state.px * 0.22, 5, dt);
    state.rx = approach(state.rx, state.py * 0.12, 5, dt);
    state.p = reduced ? state.pTarget : approach(state.p, state.pTarget, 9, dt);

    const p = state.p;
    name.position.set(base.x, base.y + p * 0.6, -p * 4.5);
    name.scale.setScalar(base.s);
    name.rotation.set(state.rx + p * 0.55, state.ry, 0);
    warm.position.set(-7 + state.px * 3, -1 - state.py * 2, 5);
    cool.position.set(7 + state.px * 3, 2 - state.py * 2, 5);

    const moving =
      intro < 1 ||
      Math.abs(state.rx - prevRx) > 1e-5 ||
      Math.abs(state.ry - prevRy) > 1e-5 ||
      Math.abs(state.p - prevP) > 1e-5;
    if (moving || needsRender) {
      renderer.render(scene, camera);
      if (needsRender && !root.classList.contains("has-3d")) root.classList.add("has-3d");
      needsRender = false;
    }
    if (visible && !reduced) raf = requestAnimationFrame(frame);
  }
  const root = document.documentElement;
  let raf = 0;
  const kick = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  // Only draw while the hero is on screen and the tab is visible.
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && document.visibilityState === "visible";
    if (visible) kick();
  }).observe(hero);
  document.addEventListener("visibilitychange", () => {
    visible = document.visibilityState === "visible";
    if (visible) kick();
  });
  new ResizeObserver(() => {
    fit();
    kick();
  }).observe(canvas);
  document.fonts?.ready.then(() => {
    fit();
    kick();
  });
  canvas.addEventListener("webglcontextlost", () => root.classList.remove("has-3d"));

  fit();
  kick();

  return {
    setProgress(p) {
      state.pTarget = p;
      needsRender = true;
      kick();
    },
  };
}
