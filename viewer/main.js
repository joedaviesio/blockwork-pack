// Blockwork viewer: instanced flat-shaded cubes, beauty through lighting.
// The world sun runs on UTC (PLAN: "real-time day/night cycle, world sun = UTC").
// SECURITY: every string from the API lands in the DOM via textContent only — never innerHTML.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const API = new URLSearchParams(location.search).get('api')
  || localStorage.getItem('blockwork.api')
  || 'http://localhost:8111';

const DEFAULT_PALETTE = {
  stone: '#9aa3ad', dirt: '#8a6a4f', grass: '#7fae62', sand: '#e5d5a4', water: '#4f86c6',
  wood: '#a5824f', leaves: '#5d8f4e', glass: '#bcd6e2', metal: '#b8bec6', light: '#ffe9a8',
  obsidian: '#2b2733', snow: '#f2f5f7', brick: '#b0574a', gold: '#f0c75e', moss: '#6f9a6a',
};
const EMISSIVE = { light: 1.0, gold: 0.35 };
const TRANSLUCENT = { glass: 0.5, water: 0.45 };

const el = (id) => document.getElementById(id);
const statsEl = el('stats');

// ---------- scene ----------
const app = el('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#171c26', 300, 1400);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 6000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

const hemi = new THREE.HemisphereLight('#cfe0ff', '#3a3428', 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe7c4', 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
Object.assign(sun.shadow.camera, { left: -320, right: 320, top: 320, bottom: -320, far: 2400 });
scene.add(sun, sun.target);
const ambient = new THREE.AmbientLight('#42506a', 0.3);
scene.add(ambient);

// Gradient sky dome (BackSide sphere; colors driven by the UTC cycle).
const skyUniforms = {
  top: { value: new THREE.Color('#0d1322') },
  horizon: { value: new THREE.Color('#1c2438') },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(4500, 24, 12),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: skyUniforms,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 horizon;
      void main(){ float h = clamp(normalize(vP).y * 1.6 + 0.08, 0.0, 1.0);
      gl_FragColor = vec4(mix(horizon, top, pow(h, 0.75)), 1.0); }`,
  })
);
scene.add(sky);

// Ground: subtle noise texture so the plain reads as land, not void.
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#7d7d7d';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 108 + Math.floor(Math.random() * 40);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(96, 96);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
const groundMat = new THREE.MeshLambertMaterial({ color: '#4c6238', map: groundTexture() });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(8192, 8192), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.51;
ground.receiveShadow = true;
scene.add(ground);

// ---------- UTC sun cycle ----------
const C = (hex) => new THREE.Color(hex);
const CYCLE = {
  day:   { skyTop: C('#8ec5ec'), horizon: C('#eaf3f7'), sun: C('#fff3d9'), sunI: 1.9, hemiSky: C('#cfe8ff'), hemiGround: C('#b9ac8a'), hemiI: 0.85, ambI: 0.32, ground: C('#6f8f57'), fogFar: 1800, exposure: 1.0 },
  dusk:  { skyTop: C('#41406e'), horizon: C('#f0a86e'), sun: C('#ffb46b'), sunI: 1.1, hemiSky: C('#8d86b8'), hemiGround: C('#6d5a44'), hemiI: 0.55, ambI: 0.26, ground: C('#5d6b46'), fogFar: 1400, exposure: 1.05 },
  night: { skyTop: C('#0d1322'), horizon: C('#1c2438'), sun: C('#9db4e6'), sunI: 0.12, hemiSky: C('#26324c'), hemiGround: C('#171512'), hemiI: 0.4, ambI: 0.2, ground: C('#2a3325'), fogFar: 1100, exposure: 1.12 },
};
function mixSettings(now = new Date()) {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const s = Math.sin(((h - 6) / 24) * Math.PI * 2); // -1 (midnight) .. 1 (noon UTC)
  const wDay = Math.max(0, s);
  const wDusk = Math.max(0, 1 - Math.abs(s) * 2.5);
  const wNight = Math.max(0, -s);
  const total = wDay + wDusk + wNight || 1;
  const out = {};
  for (const k of ['skyTop', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'ground']) {
    out[k] = new THREE.Color(0, 0, 0)
      .add(CYCLE.day[k].clone().multiplyScalar(wDay / total))
      .add(CYCLE.dusk[k].clone().multiplyScalar(wDusk / total))
      .add(CYCLE.night[k].clone().multiplyScalar(wNight / total));
  }
  for (const k of ['sunI', 'hemiI', 'ambI', 'fogFar', 'exposure']) {
    out[k] = (CYCLE.day[k] * wDay + CYCLE.dusk[k] * wDusk + CYCLE.night[k] * wNight) / total;
  }
  out.elev = Math.max(0.06, wDay) * (Math.PI / 3);
  out.azim = ((h / 24) * Math.PI * 2) + Math.PI * 0.25;
  return out;
}
function applyCycle() {
  const s = mixSettings();
  skyUniforms.top.value.copy(s.skyTop);
  skyUniforms.horizon.value.copy(s.horizon);
  scene.fog.color.copy(s.horizon);
  scene.fog.far = s.fogFar;
  sun.color.copy(s.sun);
  sun.intensity = s.sunI;
  hemi.color.copy(s.hemiSky);
  hemi.groundColor.copy(s.hemiGround);
  hemi.intensity = s.hemiI;
  ambient.intensity = s.ambI;
  groundMat.color.copy(s.ground);
  renderer.toneMappingExposure = s.exposure;
  const t = controls.target, R = 900;
  sun.position.set(
    t.x + R * Math.cos(s.azim) * Math.cos(s.elev),
    Math.max(60, R * Math.sin(s.elev)),
    t.z + R * Math.sin(s.azim) * Math.cos(s.elev)
  );
  sun.target.position.copy(t);
  sky.position.set(t.x, 0, t.z);
}
applyCycle();
setInterval(applyCycle, 30_000);

// ---------- data ----------
let palette = { ...DEFAULT_PALETTE };
let meshes = [];
let records = new Map(); // mesh.uuid -> block records per instanceId
let habitable = [300, 300, 700, 700];
let firstFit = true;

async function api(pathname) {
  const res = await fetch(API + pathname, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}`);
  return res.json();
}

function readPalette(meta) {
  const pal = meta?.palette;
  if (!Array.isArray(pal)) return;
  for (const p of pal) {
    const name = typeof p === 'string' ? p : p?.name;
    if (!name) continue;
    if (typeof p === 'object' && p.color) palette[name] = p.color;
    if (!(name in palette)) palette[name] = '#c0c0c0';
  }
}

function extractCubes(data) {
  const arr = data?.cubes ?? data?.blocks ?? (Array.isArray(data) ? data : []);
  return arr
    .map((c) => (Array.isArray(c) ? { x: c[0], y: c[1], z: c[2], block: c[3], builder: c[4] ?? null } : c))
    .filter((c) => c && Number.isFinite(c.x))
    .map((c) => ({
      x: c.x, y: c.y, z: c.z,
      block: c.block ?? c.type ?? 'stone',
      builder: c.builder ?? null,
    }));
}

async function fetchWorld() {
  const bbox = [habitable[0] - 20, 0, habitable[1] - 20, habitable[2] + 20, 260, habitable[3] + 20];
  try {
    return extractCubes(await api(`/v1/chunks?bbox=${bbox.join(',')}`));
  } catch {
    // fallback: materialise from the event feed
    const world = new Map();
    let since = 0;
    for (let page = 0; page < 200; page++) {
      const data = await api(`/v1/events?since=${since}`);
      const events = data?.events ?? [];
      if (!events.length) break;
      for (const e of events) {
        const blocks = e.blocks ?? (e.x != null ? [e] : []);
        for (const b of blocks) {
          const k = `${b.x},${b.y},${b.z}`;
          if (e.op === 'remove') world.delete(k);
          else world.set(k, { x: b.x, y: b.y, z: b.z, block: b.block ?? e.block ?? 'stone', builder: e.builder ?? null });
        }
      }
      const next = data?.next ?? since + events.length;
      if (next === since) break;
      since = next;
    }
    return [...world.values()];
  }
}

const geom = new THREE.BoxGeometry(1, 1, 1);

// Deterministic per-cube jitter so large same-material faces don't read as one flat sheet.
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return (((h ^ (h >> 16)) >>> 0) % 1000) / 1000;
}

function rebuild(cubes) {
  for (const m of meshes) { scene.remove(m); m.dispose(); }
  meshes = []; records = new Map();
  const occupied = new Set();
  for (const c of cubes) occupied.add(`${c.x},${c.y},${c.z}`);
  const byMat = new Map();
  for (const c of cubes) {
    if (!byMat.has(c.block)) byMat.set(c.block, []);
    byMat.get(c.block).push(c);
  }
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const builders = new Set();
  for (const [block, list] of byMat) {
    const color = new THREE.Color(palette[block] ?? '#c0c0c0');
    const mat = new THREE.MeshLambertMaterial({
      color,
      ...(EMISSIVE[block] ? { emissive: color, emissiveIntensity: EMISSIVE[block] } : {}),
      ...(TRANSLUCENT[block] ? { transparent: true, opacity: 1 - TRANSLUCENT[block], depthWrite: false } : {}),
    });
    const mesh = new THREE.InstancedMesh(geom, mat, list.length);
    mesh.castShadow = !TRANSLUCENT[block];
    mesh.receiveShadow = true;
    list.forEach((c, i) => {
      dummy.position.set(c.x + 0.5, c.y, c.z + 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // Cheap voxel AO: darken by buried faces; +per-cube jitter. Emissive blocks stay clean.
      if (!EMISSIVE[block]) {
        let occ = 0;
        if (occupied.has(`${c.x},${c.y + 1},${c.z}`)) occ += 0.1;
        if (occupied.has(`${c.x + 1},${c.y},${c.z}`)) occ += 0.045;
        if (occupied.has(`${c.x - 1},${c.y},${c.z}`)) occ += 0.045;
        if (occupied.has(`${c.x},${c.y},${c.z + 1}`)) occ += 0.045;
        if (occupied.has(`${c.x},${c.y},${c.z - 1}`)) occ += 0.045;
        const v = Math.max(0.62, 1 - occ) * (0.965 + hash3(c.x, c.y, c.z) * 0.07);
        mesh.setColorAt(i, tint.setScalar(v));
      } else {
        mesh.setColorAt(i, tint.setScalar(1));
      }
      if (c.builder) builders.add(c.builder);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    records.set(mesh.uuid, list);
    scene.add(mesh);
    meshes.push(mesh);
  }
  statsEl.textContent = `${cubes.length.toLocaleString()} blocks · ${builders.size} builders · ${new Date().toLocaleTimeString()}`;
  if (firstFit && cubes.length) { fitCamera(cubes); firstFit = false; }
}

function fitCamera(cubes) {
  const box = new THREE.Box3();
  for (const c of cubes) box.expandByPoint(new THREE.Vector3(c.x, c.y, c.z));
  const center = box.getCenter(new THREE.Vector3());
  const size = Math.max(box.getSize(new THREE.Vector3()).length(), 60);
  controls.target.copy(center);
  camera.position.set(center.x + size * 0.7, center.y + size * 0.55, center.z + size * 0.7);
  applyCycle();
}

// ---------- click -> info · double-click -> fly ----------
const ray = new THREE.Raycaster();
let flight = null;
function pick(ev) {
  const ndc = new THREE.Vector2((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(meshes, false)[0];
  if (!hit || hit.instanceId == null) return null;
  return records.get(hit.object.uuid)?.[hit.instanceId] ?? null;
}
renderer.domElement.addEventListener('pointerdown', async (ev) => {
  if (ev.button !== 0) return;
  const rec = pick(ev);
  const info = el('info');
  if (!rec) { info.style.display = 'none'; return; }
  el('i-pos').textContent = `${rec.x}, ${rec.y}, ${rec.z}`;
  el('i-mat').textContent = rec.block;
  el('i-builder').textContent = rec.builder ?? 'unknown';
  el('i-struct').textContent = '…';
  info.style.display = 'block';
  try {
    const data = await api(`/v1/structures?bbox=${[rec.x, rec.y, rec.z, rec.x, rec.y, rec.z].join(',')}`);
    const s = (data?.structures ?? [])[0];
    // textContent only: structure names/styles are untrusted agent text
    const sName = s?.untrusted_name ?? s?.name;
    const sStyle = s?.untrusted_style ?? s?.style;
    el('i-struct').textContent = s ? `${sName ?? 'unnamed'}${sStyle ? ` — ${sStyle}` : ''}` : 'undeclared';
  } catch { el('i-struct').textContent = 'undeclared'; }
});
renderer.domElement.addEventListener('dblclick', (ev) => {
  const rec = pick(ev);
  if (!rec) return;
  const to = new THREE.Vector3(rec.x + 0.5, rec.y + 1, rec.z + 0.5);
  const dir = camera.position.clone().sub(controls.target).normalize();
  flight = {
    t0: performance.now(), dur: 1100,
    fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
    toTarget: to, toPos: to.clone().add(dir.multiplyScalar(34)).add(new THREE.Vector3(0, 14, 0)),
  };
});

// ---------- live polling ----------
let live = true, polling = false;
async function refresh() {
  if (polling) return;
  polling = true;
  try { rebuild(await fetchWorld()); }
  catch (e) { statsEl.textContent = `API unreachable at ${API}`; }
  polling = false;
}
el('live').addEventListener('click', (ev) => {
  live = !live;
  ev.currentTarget.setAttribute('aria-pressed', String(live));
  ev.currentTarget.textContent = live ? '● live' : '○ paused';
});
el('refresh').addEventListener('click', refresh);
setInterval(() => { if (live) refresh(); }, 5000);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
(function frame() {
  requestAnimationFrame(frame);
  if (flight) {
    const t = Math.min(1, (performance.now() - flight.t0) / flight.dur);
    const e = easeInOut(t);
    camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
    if (t >= 1) flight = null;
  }
  controls.update();
  renderer.render(scene, camera);
})();

// ---------- boot ----------
(async () => {
  try {
    const meta = await api('/v1/world/meta');
    readPalette(meta);
    const hb = meta?.habitable_bbox;
    if (Array.isArray(hb) && hb.length === 4) habitable = hb;
    localStorage.setItem('blockwork.api', API);
  } catch {
    const err = el('err');
    err.style.display = 'block';
    err.textContent = `Can't reach the Blockwork API at ${API}. Start the server (port 8111) or pass ?api=http://host:port`;
  }
  refresh();
})();
