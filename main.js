import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.150.1/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader }    from "https://cdn.jsdelivr.net/npm/three@0.150.1/examples/jsm/loaders/GLTFLoader.js";

// ═══════════════════════════════════════════════════════════════════════════════
// SCENE
// ═══════════════════════════════════════════════════════════════════════════════
const container = document.getElementById("Home3D");
const scene     = new THREE.Scene();
scene.fog        = new THREE.FogExp2(0xaaddff, 0.006);

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA
// ═══════════════════════════════════════════════════════════════════════════════
const camera = new THREE.PerspectiveCamera(
  60, container.clientWidth / container.clientHeight, 0.1, 2000
);
camera.position.set(0, 18, 35);

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERER
// ═══════════════════════════════════════════════════════════════════════════════
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled   = true;
renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
renderer.outputEncoding      = THREE.sRGBEncoding;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.setClearColor(0x010315, 1);
container.appendChild(renderer.domElement);

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLS
// ═══════════════════════════════════════════════════════════════════════════════
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.06;
controls.enablePan      = true;
controls.minDistance    = 0.5;
controls.maxDistance    = 250;
controls.maxPolarAngle  = Math.PI * 0.84;

// ═══════════════════════════════════════════════════════════════════════════════
// WORLD CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
const WORLD = {
  time:      8.0,   // 0–24 world hours
  timeSpeed: 0.0,   // 0 = paused — user controls via slider / play button
  raining:   false,
};

let timePlaying = false; // starts paused

let sliderDragging = false;

// ═══════════════════════════════════════════════════════════════════════════════
// LIGHTS
// ═══════════════════════════════════════════════════════════════════════════════
const ambientLight = new THREE.AmbientLight(0x404060, 1.5);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff4e0, 4.0);
sunLight.position.set(60, 80, 30);
sunLight.castShadow            = true;
sunLight.shadow.mapSize.width  = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near    = 1;
sunLight.shadow.camera.far     = 350;
sunLight.shadow.camera.left    = -80;
sunLight.shadow.camera.right   =  80;
sunLight.shadow.camera.top     =  80;
sunLight.shadow.camera.bottom  = -80;
scene.add(sunLight);

const moonLight = new THREE.DirectionalLight(0x4466aa, 0.0);
moonLight.position.set(-60, 60, -30);
scene.add(moonLight);

const hemiLight = new THREE.HemisphereLight(0xfff4b0, 0x080820, 0.5);
scene.add(hemiLight);

const orbitPt = new THREE.PointLight(0x44aaff, 1.5, 20);
scene.add(orbitPt);

// ═══════════════════════════════════════════════════════════════════════════════
// NOISE UTILITIES  (value noise + fractal brownian motion)
// ═══════════════════════════════════════════════════════════════════════════════
function smoothstep(t) { return t * t * (3 - 2 * t); }
function mix(a, b, t)  { return a + (b - a) * t; }

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smoothstep(x - ix), fy = smoothstep(y - iy);
  return mix(
    mix(hash2(ix,   iy),   hash2(ix+1, iy),   fx),
    mix(hash2(ix,   iy+1), hash2(ix+1, iy+1), fx),
    fy
  );
}

function fbm(x, y, oct = 6) {
  let v = 0, a = 0.5, f = 1, m = 0;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x * f, y * f) * a;
    m += a; a *= 0.5; f *= 2.1;
  }
  return v / m;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TERRAIN CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
const T_SIZE   = 320;
const T_SEGS   = 128;
const T_HEIGHT = 30;
const W_LEVEL  = -1.8;   // water surface y

/**
 * Returns the world Y of the terrain at (x, z).
 * Keeps a flat clearing at the centre for the house.
 */
function terrainY(x, z) {
  const d        = Math.sqrt(x * x + z * z);
  const FLAT_R   = 18;                           // flat zone radius in world units
  // smoothstep curve: 0 at centre → 1 at FLAT_R, smooth S-curve (no cliff)
  const t        = Math.min(d / FLAT_R, 1.0);
  const flatMask = 1.0 - t * t * (3 - 2 * t);   // smoothstep, range 1→0
  const raw      = fbm(x / 48, z / 48, 6);
  return (raw * T_HEIGHT - T_HEIGHT * 0.28) * (1 - flatMask * 0.97);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TERRAIN MESH
// ═══════════════════════════════════════════════════════════════════════════════
(function buildTerrain() {
  const geo = new THREE.PlaneGeometry(T_SIZE, T_SIZE, T_SEGS, T_SEGS);
  geo.rotateX(-Math.PI / 2);

  const pos    = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainY(x, z);
    pos.setY(i, h);

    // Vertex colour by normalised height
    const hn = h / T_HEIGHT;
    let r, g, b;
    if (h <= W_LEVEL + 0.4)   { r=0.56; g=0.50; b=0.38; } // sand
    else if (hn < 0.10)       { r=0.22; g=0.52; b=0.16; } // bright grass
    else if (hn < 0.32)       { r=0.26; g=0.44; b=0.14; } // dark grass
    else if (hn < 0.55)       { r=0.42; g=0.36; b=0.28; } // rock
    else if (hn < 0.76)       { r=0.54; g=0.50; b=0.46; } // grey rock
    else                      { r=0.88; g=0.91; b=0.96; } // snow cap

    colors[i*3]   = r;
    colors[i*3+1] = g;
    colors[i*3+2] = b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat  = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
})();

// ═══════════════════════════════════════════════════════════════════════════════
// WATER PLANE
// ═══════════════════════════════════════════════════════════════════════════════
const waterGeo = new THREE.PlaneGeometry(140, 90, 1, 1);
waterGeo.rotateX(-Math.PI / 2);
const waterMat = new THREE.MeshStandardMaterial({
  color:       0x0077bb,
  transparent: true,
  opacity:     0.80,
  metalness:   0.75,
  roughness:   0.08,
});
const waterMesh = new THREE.Mesh(waterGeo, waterMat);
waterMesh.position.set(90, W_LEVEL, 80);
waterMesh.receiveShadow = true;
scene.add(waterMesh);

// ═══════════════════════════════════════════════════════════════════════════════
// INSTANCED TREES  (2 draw calls for the whole forest)
// ═══════════════════════════════════════════════════════════════════════════════
(function buildTrees(count = 280) {
  const trunkGeo  = new THREE.CylinderGeometry(0.18, 0.30, 2.2, 6, 1);
  const canopyGeo = new THREE.ConeGeometry(1.5, 3.2, 7, 1);
  const barkMat   = new THREE.MeshStandardMaterial({ color: 0x5c3d1e, roughness: 0.95 });
  const leafMat   = new THREE.MeshStandardMaterial({ color: 0x2a6b1e, roughness: 0.88 });

  const trunks   = new THREE.InstancedMesh(trunkGeo,  barkMat, count);
  const canopies = new THREE.InstancedMesh(canopyGeo, leafMat, count);
  trunks.castShadow    = true;
  canopies.castShadow  = true;

  const dummy = new THREE.Object3D();
  let placed = 0, tries = 0;

  while (placed < count && tries < count * 12) {
    tries++;
    const angle  = Math.random() * Math.PI * 2;
    const radius = 16 + Math.random() * 125;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const ty = terrainY(x, z);

    if (ty < 0.6 || ty > T_HEIGHT * 0.70) continue;           // skip water / snow
    if (Math.abs(x - 90) < 72 && Math.abs(z - 80) < 50 && ty < 1.2) continue; // skip lake

    const sc = 0.55 + Math.random() * 0.95;
    dummy.scale.set(sc, sc, sc);
    dummy.rotation.y = Math.random() * Math.PI * 2;

    dummy.position.set(x, ty + 1.1 * sc, z);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);

    dummy.position.set(x, ty + 3.0 * sc, z);
    dummy.updateMatrix();
    canopies.setMatrixAt(placed, dummy.matrix);

    placed++;
  }
  trunks.count   = placed;
  canopies.count = placed;
  trunks.instanceMatrix.needsUpdate   = true;
  canopies.instanceMatrix.needsUpdate = true;
  scene.add(trunks);
  scene.add(canopies);
})();

// ═══════════════════════════════════════════════════════════════════════════════
// SKY DOME  (gradient + sun disc + glow via ShaderMaterial)
// ═══════════════════════════════════════════════════════════════════════════════
const skyMat = new THREE.ShaderMaterial({
  side:       THREE.BackSide,
  depthWrite: false,
  uniforms: {
    uTop:     { value: new THREE.Color(0x1a4080) },
    uHorizon: { value: new THREE.Color(0x88ccff) },
    uBot:     { value: new THREE.Color(0x223355) },
    uSunDir:  { value: new THREE.Vector3(0, 1, 0) },
    uSunCol:  { value: new THREE.Color(1, 0.98, 0.9) },
    uGlow:    { value: new THREE.Color(1, 0.5, 0.1) },
    uNight:   { value: 0.0 },   // 0=day  1=night  (fades sun out)
  },
  vertexShader: `
    varying vec3 vNorm;
    void main() {
      vNorm = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  fragmentShader: `
    uniform vec3  uTop, uHorizon, uBot;
    uniform vec3  uSunDir, uSunCol, uGlow;
    uniform float uNight;
    varying vec3  vNorm;

    void main() {
      float h   = vNorm.y;
      vec3  col = h > 0.0
        ? mix(uHorizon, uTop, pow(clamp(h,0.0,1.0), 0.55))
        : mix(uHorizon, uBot, pow(clamp(-h,0.0,1.0), 0.3));

      float sdot  = dot(normalize(vNorm), normalize(uSunDir));
      float glow  = smoothstep(0.92, 0.998, sdot) * (1.0 - uNight);
      float disc  = smoothstep(0.9992, 1.0,  sdot) * (1.0 - uNight);
      col = mix(col,  uGlow,   glow * 0.55);
      col = mix(col,  uSunCol, disc);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 32), skyMat);
skyDome.renderOrder = -1;
scene.add(skyDome);

// ═══════════════════════════════════════════════════════════════════════════════
// STARS
// ═══════════════════════════════════════════════════════════════════════════════
const starsMat = new THREE.PointsMaterial({
  color: 0xffffff, size: 1.3, sizeAttenuation: true,
  transparent: true, opacity: 0.0,
});
(function buildStars() {
  const N = 4500, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const th  = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1) * 0.45 + 0.05;
    const r   = 750 + Math.random() * 80;
    pos[i*3]   = r * Math.sin(phi) * Math.cos(th);
    pos[i*3+1] = r * Math.cos(phi);
    pos[i*3+2] = r * Math.sin(phi) * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, starsMat));
})();

// ═══════════════════════════════════════════════════════════════════════════════
// MOON DISC
// ═══════════════════════════════════════════════════════════════════════════════
const moonMesh = new THREE.Mesh(
  new THREE.SphereGeometry(9, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0xdde8ff, emissive: 0xaabbcc, emissiveIntensity: 0.7, roughness: 0.9 })
);
scene.add(moonMesh);

// ═══════════════════════════════════════════════════════════════════════════════
// RAIN SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
class RainSystem {
  constructor(count = 12000) {
    this.count     = count;
    this.active    = false;
    this.intensity = 0;
    this._thunder  = 0;

    this._pos = new Float32Array(count * 6);
    this._vel = new Float32Array(count);
    for (let i = 0; i < count; i++) this._resetDrop(i, true);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));

    this._mat  = new THREE.LineBasicMaterial({ color: 0x99bbdd, transparent: true, opacity: 0 });
    this.lines = new THREE.LineSegments(geo, this._mat);
    this.lines.frustumCulled = false;
    this.lines.visible       = false;
    scene.add(this.lines);
  }

  _resetDrop(i, randY = false) {
    const x = (Math.random() - 0.5) * 280;
    const z = (Math.random() - 0.5) * 280;
    const y = randY ? Math.random() * 90 : 90;
    this._vel[i]     = 20 + Math.random() * 14;
    this._pos[i*6]   = x;
    this._pos[i*6+1] = y;
    this._pos[i*6+2] = z;
    this._pos[i*6+3] = x + 0.18;
    this._pos[i*6+4] = y - 0.9;
    this._pos[i*6+5] = z;
  }

  setRaining(on) {
    this.active = on;
    WORLD.raining = on;
    if (on) this.lines.visible = true;
    // overlay
    document.getElementById('rain-overlay').classList.toggle('active', on);
    document.getElementById('btn-rain').classList.toggle('active', on);
    document.getElementById('btn-clear').classList.toggle('active', !on);
  }

  update(dt) {
    const target = this.active ? 1 : 0;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 1.6);
    this.intensity  = Math.max(0, Math.min(1, this.intensity));

    this._mat.opacity = this.intensity * 0.62;

    if (this.intensity < 0.01) { this.lines.visible = false; scene.fog.density = 0.006; return; }
    this.lines.visible = true;

    const p = this._pos, v = this._vel;
    for (let i = 0; i < this.count; i++) {
      p[i*6+1] -= v[i] * dt;
      p[i*6+4] -= v[i] * dt;
      if (p[i*6+1] < -4) this._resetDrop(i, false);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    scene.fog.density = 0.006 + this.intensity * 0.016;

    // Thunder
    this._thunder -= dt;
    if (this.active && this.intensity > 0.65 && this._thunder <= 0) {
      this._thunder = 7 + Math.random() * 22;
      this._lightning();
    }
  }

  _lightning() {
    const ov = document.getElementById('rain-overlay');
    ov.classList.add('lightning');
    setTimeout(() => ov.classList.remove('lightning'), 160);
    // Synthesised thunder with Web Audio API
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const buf  = ctx.createBuffer(1, ctx.sampleRate * 2.2, ctx.sampleRate);
      const d    = buf.getChannelData(0);
      let env = 1.0;
      for (let i = 0; i < d.length; i++) { env = Math.max(0, env - 0.00055); d[i] = (Math.random()*2-1)*env*0.45; }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lpf  = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 130;
      src.connect(lpf); lpf.connect(ctx.destination);
      src.start();
    } catch(_) {}
  }
}
const rain = new RainSystem(12000);

// ═══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
const overlay    = document.getElementById("loading-overlay");
const loadBar    = document.getElementById("load-bar");
const loadPct    = document.getElementById("load-pct");
const toastEl    = document.getElementById("toast");
const doorPrompt = document.getElementById("door-prompt");
const btnOpen    = document.getElementById("btn-open-door");
const btnInside  = document.getElementById("btn-go-inside");

function showToast(msg, dur = 2500) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), dur);
}

function loadingIndeterminate() {
  if (loadBar) loadBar.classList.add("indeterminate");
  if (loadPct) loadPct.textContent = "Loading…";
}
function loadingDone() {
  if (loadBar) { loadBar.classList.remove("indeterminate"); loadBar.style.width = "100%"; }
  if (loadPct) loadPct.textContent = "100%";
  setTimeout(() => { if (overlay) overlay.classList.add("hidden"); }, 400);
}
function loadingError(msg) {
  if (!overlay) return;
  overlay.innerHTML = `
    <div class="loader-inner">
      <p style="color:#ff6b6b;font-size:1rem;text-align:center">⚠️ Failed to load model</p>
      <p style="color:#aaa;font-size:0.78rem;margin-top:.4rem;text-align:center">${msg}</p>
      <button onclick="location.reload()" style="margin-top:1rem;padding:.4rem 1.2rem;border:1px solid #6688ff;background:transparent;color:#99aaff;border-radius:99px;cursor:pointer;font-size:.82rem">↺ Retry</button>
    </div>`;
}

const loadTout = setTimeout(() => loadingError("Timed out (60 s). Press F12 for details."), 60000);
loadingIndeterminate();

// Show world immediately — house loads in background
setTimeout(() => { loadingDone(); showToast("🌍 Akash World — house model loading…"); }, 1500);

// ═══════════════════════════════════════════════════════════════════════════════
// DOOR STATE SYSTEM  (preserved from original)
// ═══════════════════════════════════════════════════════════════════════════════
const doorStates = new Map();

function findDoorGroup(obj) {
  let node = obj;
  while (node && node !== scene) {
    const n = node.name || "";
    if (/^Door[._]/i.test(n) && !/frame/i.test(n)) return node;
    node = node.parent;
  }
  return null;
}

function registerDoor(group) {
  if (doorStates.has(group.uuid)) return doorStates.get(group.uuid);
  const s = { group, open: false, baseAngle: group.rotation.y, currentAngle: group.rotation.y, targetAngle: group.rotation.y };
  doorStates.set(group.uuid, s);
  return s;
}

function toggleDoor(state) {
  state.open        = !state.open;
  state.targetAngle = state.open ? state.baseAngle - Math.PI / 2 : state.baseAngle;
  showToast(state.open ? "🚪 Door opening…" : "🔒 Door closing…");
  if (btnOpen) btnOpen.textContent = state.open ? "🔒 Close Door" : "🚪 Open Door";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOM TOUR  (preserved + World View added)
// ═══════════════════════════════════════════════════════════════════════════════
let rooms = [];

function buildRooms(box) {
  const c = box.getCenter(new THREE.Vector3());
  const h = box.max.y - box.min.y;
  rooms = [
    { id:"front",    pos: new THREE.Vector3(c.x, c.y, box.max.z+6),         look: c.clone() },
    { id:"entrance", pos: new THREE.Vector3(c.x, box.min.y+h*.15, box.max.z-.3), look: new THREE.Vector3(c.x,box.min.y+h*.2,c.z) },
    { id:"ground",   pos: new THREE.Vector3(c.x-1, box.min.y+h*.15, c.z+.5), look: new THREE.Vector3(c.x+1,box.min.y+h*.2,box.min.z+.5) },
    { id:"upper",    pos: new THREE.Vector3(c.x, box.min.y+h*.6, c.z+.5),    look: new THREE.Vector3(c.x,box.min.y+h*.65,box.min.z+.5) },
    { id:"back",     pos: new THREE.Vector3(c.x, c.y, box.min.z-6),          look: c.clone() },
    { id:"side",     pos: new THREE.Vector3(box.max.x+6, c.y, c.z),          look: c.clone() },
    { id:"world",    pos: new THREE.Vector3(0, 75, 100),                      look: new THREE.Vector3(0,0,0) },
  ];
}

document.querySelectorAll(".room-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const room = rooms.find(r => r.id === btn.dataset.room);
    if (!room) { showToast("Model not loaded yet!"); return; }
    flyTo(room.pos, room.look);
    showToast(`✈️ Flying to ${btn.textContent.trim()}…`);
    document.querySelectorAll(".room-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA FLY  (preserved)
// ═══════════════════════════════════════════════════════════════════════════════
let fly = null;

function flyTo(toPos, toLook) {
  fly = { from: camera.position.clone(), to: toPos.clone(),
          lookFrom: controls.target.clone(), lookTo: toLook.clone(), t: 0 };
}

function easeIO(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD GLTF MODEL
// ═══════════════════════════════════════════════════════════════════════════════
let model     = null;
let allMeshes = [];

const loader = new GLTFLoader();
loader.load(
  "models/home/scene.gltf",
  (gltf) => {
    clearTimeout(loadTout);
    model = gltf.scene;

    // ── Scale & place model ─────────────────────────────────────────────────
    // Compute bounding box in LOCAL space (model not yet scaled / moved)
    const box    = new THREE.Box3().setFromObject(model);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const sc     = 6 / Math.max(size.x, size.y, size.z);

    model.scale.setScalar(sc);

    // After scaling by sc, the world-space bottom of the model would be
    // at (box.min.y * sc) if position were zero.  We want that to sit
    // exactly on the terrain surface, so:
    //   model.position.y + box.min.y * sc  = groundY
    //   model.position.y = groundY - box.min.y * sc
    const groundY = terrainY(0, 0);
    model.position.set(
      -center.x * sc,                  // centre X over origin
      groundY - box.min.y * sc,         // floor of model = terrain surface
      -center.z * sc                   // centre Z over origin
    );

    scene.add(model);

    model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = node.receiveShadow = true;
      allMeshes.push(node);
      if (node.material?.emissive) node.userData.origEmissive = node.material.emissive.clone();
      const dg = findDoorGroup(node);
      if (dg) registerDoor(dg);
    });

    const finalBox = new THREE.Box3().setFromObject(model);
    buildRooms(finalBox);
    controls.target.copy(finalBox.getCenter(new THREE.Vector3()));

    if (overlay && !overlay.classList.contains('hidden')) loadingDone();
    showToast(`🌍 Akash World ready — ${doorStates.size} door(s). Explore!`);
  },
  () => {},
  err => { clearTimeout(loadTout); console.error(err); showToast('⚠️ House model not found — world still works!', 4000); if (overlay && !overlay.classList.contains('hidden')) loadingDone(); }
);

// ═══════════════════════════════════════════════════════════════════════════════
// RAYCASTING — hover + click  (preserved)
// ═══════════════════════════════════════════════════════════════════════════════
const raycaster = new THREE.Raycaster();
const ndc       = new THREE.Vector2();
let   hovered   = null;

function setHover(mesh) {
  if (mesh === hovered) return;
  if (hovered?.material?.emissive) hovered.material.emissive.copy(hovered.userData.origEmissive ?? new THREE.Color(0));
  hovered = mesh;
  if (hovered?.material?.emissive) hovered.material.emissive.set(0x1a3366);
  document.body.style.cursor = hovered ? "pointer" : "default";
}

window.addEventListener("mousemove", e => {
  if (!allMeshes.length) return;
  ndc.set((e.clientX / window.innerWidth)*2-1, -(e.clientY / window.innerHeight)*2+1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(allMeshes, false).find(h => findDoorGroup(h.object));
  setHover(hit ? hit.object : null);
});

let downPt = {x:0,y:0};
window.addEventListener("pointerdown", e => { downPt = {x:e.clientX,y:e.clientY}; });
window.addEventListener("pointerup", e => {
  const dx = e.clientX-downPt.x, dy = e.clientY-downPt.y;
  if (dx*dx+dy*dy > 25) return;
  ndc.set((e.clientX/window.innerWidth)*2-1, -(e.clientY/window.innerHeight)*2+1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(allMeshes, false).find(h => findDoorGroup(h.object));
  if (!hit) return;
  toggleDoor(registerDoor(findDoorGroup(hit.object)));
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOOR PROMPT BUTTONS  (preserved)
// ═══════════════════════════════════════════════════════════════════════════════
let activeDoorState = null;
const _wp = new THREE.Vector3(), _sp = new THREE.Vector3();

if (btnOpen) btnOpen.addEventListener("click", () => { if (activeDoorState) toggleDoor(activeDoorState); });
if (btnInside) btnInside.addEventListener("click", () => {
  if (!activeDoorState) return;
  if (!activeDoorState.open) toggleDoor(activeDoorState);
  const dp = new THREE.Vector3();
  activeDoorState.group.getWorldPosition(dp);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y=0; dir.normalize();
  flyTo(dp.clone().addScaledVector(dir, 1.2), dp.clone().addScaledVector(dir, 3));
  showToast("🏠 Going inside…");
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORLD UI WIRING
// ═══════════════════════════════════════════════════════════════════════════════
const timeSlider  = document.getElementById('time-slider');
const speedSlider = document.getElementById('speed-slider');
const timeDisplay = document.getElementById('world-time-display');
const skyIcon     = document.getElementById('hud-sky-icon');

// Slider drag detection (so slider wins over auto-advance)
if (timeSlider) {
  timeSlider.addEventListener('mousedown',  () => { sliderDragging = true;  });
  timeSlider.addEventListener('touchstart', () => { sliderDragging = true;  }, {passive:true});
  timeSlider.addEventListener('input', () => { WORLD.time = parseFloat(timeSlider.value); });
}
window.addEventListener('mouseup',  () => { sliderDragging = false; });
window.addEventListener('touchend', () => { sliderDragging = false; });

// ── Single source-of-truth helpers ────────────────────────────────────────
function _syncPlayBtn() {
  const pb = document.getElementById('btn-playpause');
  if (pb) pb.textContent = timePlaying ? '⏸️ Pause' : '▶️ Play';
}
function setPlaying() {
  if (WORLD.timeSpeed === 0) { WORLD.timeSpeed = 0.3; if (speedSlider) speedSlider.value = 0.3; }
  timePlaying = true;
  _syncPlayBtn();
}
function setPaused() {
  timePlaying = false;
  _syncPlayBtn();
}

if (speedSlider) speedSlider.addEventListener('input', () => {
  WORLD.timeSpeed = parseFloat(speedSlider.value);
  // Speed to 0 = visual pause; speed > 0 = auto-play
  if (WORLD.timeSpeed === 0) setPaused();
  else if (!timePlaying)    setPlaying();
});

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    WORLD.time = parseFloat(btn.dataset.time);
    if (timeSlider) timeSlider.value = WORLD.time;
    WORLD.timeSpeed = 0;
    if (speedSlider) speedSlider.value = 0;
    setPaused();
  });
});

// Play / Pause button toggle
document.getElementById('btn-playpause')?.addEventListener('click', () => {
  if (timePlaying) {
    setPaused();
    showToast('⏸️ Time paused');
  } else {
    setPlaying();
    showToast('▶️ Time flowing…');
  }
});

document.getElementById('btn-rain')?.addEventListener('click',  () => rain.setRaining(true));
document.getElementById('btn-clear')?.addEventListener('click', () => rain.setRaining(false));

function updateHUD() {
  const t  = WORLD.time;
  const hh = String(Math.floor(t)).padStart(2,'0');
  const mm = String(Math.floor((t % 1) * 60)).padStart(2,'0');
  if (timeDisplay) timeDisplay.textContent = `${hh}:${mm}`;
  if (timeSlider && !sliderDragging) timeSlider.value = t;
  if (skyIcon) {
    if      (WORLD.raining)          skyIcon.textContent = '🌧️';
    else if (t >= 20 || t < 5)       skyIcon.textContent = '🌙';
    else if (t < 7  || t > 18.5)     skyIcon.textContent = '🌅';
    else                             skyIcon.textContent = '☀️';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKY COLOUR HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
const _sc = {   // named colour presets
  nightTop:  new THREE.Color(0x010315),
  nightHor:  new THREE.Color(0x04061a),
  dawnTop:   new THREE.Color(0x150830),
  dawnHor:   new THREE.Color(0xff6622),
  dayTop:    new THREE.Color(0x0d4fa0),
  dayHor:    new THREE.Color(0x55aaff),
  noonTop:   new THREE.Color(0x0940b0),
  noonHor:   new THREE.Color(0x77ccff),
  duskTop:   new THREE.Color(0x080420),
  duskHor:   new THREE.Color(0xff4411),
};

// Reusable Color objects to avoid GC pressure
const _cTop = new THREE.Color(), _cHor = new THREE.Color(), _cFog = new THREE.Color();
const _waterNight = new THREE.Color(0x001133);
const _waterDay   = new THREE.Color(0x0088cc);
const _tmpColor   = new THREE.Color();

function getSkyColors(t) {
  if      (t >= 5  && t < 7)  { const p=(t-5)/2;  _cTop.copy(_sc.nightTop).lerp(_sc.dawnTop,p);  _cHor.copy(_sc.nightHor).lerp(_sc.dawnHor,p); }
  else if (t >= 7  && t < 9)  { const p=(t-7)/2;  _cTop.copy(_sc.dawnTop).lerp(_sc.dayTop,p);    _cHor.copy(_sc.dawnHor).lerp(_sc.dayHor,p);  }
  else if (t >= 9  && t < 15) {                    _cTop.copy(_sc.dayTop).lerp(_sc.noonTop,0.5);  _cHor.copy(_sc.dayHor).lerp(_sc.noonHor,0.5);}
  else if (t >= 15 && t < 18) { const p=(t-15)/3; _cTop.copy(_sc.noonTop).lerp(_sc.duskTop,p);   _cHor.copy(_sc.noonHor).lerp(_sc.duskHor,p); }
  else if (t >= 18 && t < 21) { const p=(t-18)/3; _cTop.copy(_sc.duskTop).lerp(_sc.nightTop,p);  _cHor.copy(_sc.duskHor).lerp(_sc.nightHor,p);}
  else                         {                   _cTop.copy(_sc.nightTop);                       _cHor.copy(_sc.nightHor);                    }
  _cFog.copy(_cHor).lerp(_cTop, 0.35);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAY / NIGHT UPDATE
// ═══════════════════════════════════════════════════════════════════════════════
function updateDayNight(dt) {
  // timePlaying is the single source of truth — no need to also check timeSpeed
  if (timePlaying && !sliderDragging) {
    WORLD.time = (WORLD.time + dt * WORLD.timeSpeed) % 24;
  }
  const t = WORLD.time;

  // Sun arc: sunAngle=0 at 6am (sunrise), π at 18pm (sunset)
  const sunAngle = ((t - 6) / 24) * Math.PI * 2;  // full circle in 24h
  const sunY     = Math.sin(sunAngle);
  const sunX     = Math.cos(sunAngle) * 0.8;

  const sunDir = new THREE.Vector3(sunX, sunY, -0.35).normalize();
  sunLight.position.copy(sunDir).multiplyScalar(120);

  const dayness = Math.max(0, sunY);

  // Sun intensity + colour
  sunLight.intensity = dayness * 4.5;
  const dawnFactor   = Math.max(0, 1 - Math.abs(t - 6.5) / 2.5) + Math.max(0, 1 - Math.abs(t - 18) / 2.5);
  sunLight.color.setHSL(
    mix(0.12, 0.06, dawnFactor),   // hue: warm-white→orange at dawn/dusk
    mix(0.1,  0.85, dawnFactor),   // saturation
    1.0
  );

  // Moon opposite sun
  const moonDir = sunDir.clone().negate();
  moonLight.position.copy(moonDir).multiplyScalar(120);
  moonLight.intensity = Math.max(0, -sunY) * 0.4;
  moonMesh.position.copy(moonDir).multiplyScalar(500);
  moonMesh.visible = sunY < 0.15;

  // Sky uniforms
  getSkyColors(t);
  skyMat.uniforms.uTop.value.copy(_cTop);
  skyMat.uniforms.uHorizon.value.copy(_cHor);
  skyMat.uniforms.uSunDir.value.copy(sunDir);
  skyMat.uniforms.uSunCol.value.setHSL(0.12, 0.15, 1.0);
  skyMat.uniforms.uGlow.value.setHSL(mix(0.08,0.12,dayness), mix(0.9,0.3,dayness), 0.85);
  skyMat.uniforms.uNight.value = Math.max(0, -sunY + 0.05);

  // Stars fade in/out
  const nightness  = t < 5 ? 1 : t < 7 ? 1-(t-5)/2 : t < 17 ? 0 : t < 20 ? (t-17)/3 : 1;
  starsMat.opacity = nightness * 0.92;

  // Ambient
  ambientLight.intensity = 0.08 + dayness * 1.6;
  ambientLight.color.setHSL(0.6, mix(0.5,0.1,dayness), mix(0.15,0.8,dayness));

  // Hemisphere
  hemiLight.intensity = 0.1 + dayness * 0.55;
  hemiLight.groundColor.setHSL(0.1, 0.5, mix(0.02, 0.18, dayness));

  // Fog (rain also contributes density — handled in rain.update)
  if (!rain.active && rain.intensity < 0.01) scene.fog.density = 0.006;
  scene.fog.color.copy(_cFog);

  // Water tint: dark-navy at night → bright blue by day
  waterMat.color.copy(_waterNight).lerp(_waterDay, dayness);
  waterMat.opacity = 0.75 + dayness * 0.1;

  // Exposure
  renderer.toneMappingExposure = 0.55 + dayness * 0.75;

  updateHUD();
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════════════════════════════════════════
window.addEventListener("resize", () => {
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATE
// ═══════════════════════════════════════════════════════════════════════════════
const clock   = new THREE.Clock();
let   elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  elapsed    += delta;

  // ── Camera fly ─────────────────────────────────────────────────────────────
  if (fly) {
    fly.t = Math.min(fly.t + delta / 1.6, 1);
    const et = easeIO(fly.t);
    camera.position.lerpVectors(fly.from, fly.to, et);
    controls.target.lerpVectors(fly.lookFrom, fly.lookTo, et);
    if (fly.t >= 1) fly = null;
  }

  // ── Door rotation ───────────────────────────────────────────────────────────
  const doorLerp = 1 - Math.pow(0.0006, delta);
  doorStates.forEach(s => {
    s.currentAngle += (s.targetAngle - s.currentAngle) * doorLerp;
    s.group.rotation.y = s.currentAngle;
  });

  // ── Door proximity prompt ───────────────────────────────────────────────────
  if (doorPrompt && doorStates.size > 0) {
    let closestState = null, closestDist = Infinity;
    doorStates.forEach(s => {
      s.group.getWorldPosition(_wp);
      const d = camera.position.distanceTo(_wp);
      if (d < closestDist) { closestDist = d; closestState = s; }
    });
    if (closestDist < 3.5 && closestState) {
      closestState.group.getWorldPosition(_wp);
      _sp.copy(_wp).project(camera);
      if (_sp.z < 1) {
        doorPrompt.style.left = `${(_sp.x+1)/2*window.innerWidth}px`;
        doorPrompt.style.top  = `${(-_sp.y+1)/2*window.innerHeight}px`;
        doorPrompt.classList.add("visible");
        activeDoorState = closestState;
        if (btnOpen) btnOpen.textContent = closestState.open ? "🔒 Close Door" : "🚪 Open Door";
      } else { doorPrompt.classList.remove("visible"); }
    } else { doorPrompt.classList.remove("visible"); activeDoorState = null; }
  }

  // ── World systems ───────────────────────────────────────────────────────────
  updateDayNight(delta);
  rain.update(delta);

  // ── Water ripple animation ──────────────────────────────────────────────────
  waterMesh.position.y = W_LEVEL + Math.sin(elapsed * 0.55) * 0.05;
  waterMat.roughness   = 0.06 + Math.abs(Math.sin(elapsed * 1.1)) * 0.06;

  // ── Accent orbiting point light ─────────────────────────────────────────────
  const oAngle = elapsed * 0.38;
  const ox = Math.sin(oAngle) * 8, oz = Math.cos(oAngle) * 8;
  orbitPt.position.set(ox, terrainY(ox, oz) + 2.5, oz);
  orbitPt.color.setHSL((elapsed * 0.04) % 1, 0.8, 0.65);
  orbitPt.intensity = (1.2 + Math.sin(elapsed * 0.9) * 0.5) *
                      (WORLD.time > 19 || WORLD.time < 7 ? 2.0 : 0.4);

  controls.update();
  renderer.render(scene, camera);
}

animate();
