import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.150.1/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.150.1/examples/jsm/loaders/GLTFLoader.js";

// ─── Scene ────────────────────────────────────────────────────────────────────
const container = document.getElementById("Home3D");
const scene     = new THREE.Scene();
scene.background = new THREE.Color(0x0d0d1a);
scene.fog        = new THREE.FogExp2(0x0d0d1a, 0.012);

// ─── Camera ───────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  60,
  container.clientWidth / container.clientHeight,
  0.01,
  500
);
camera.position.set(0, 3, 14);

// ─── Renderer ─────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled   = true;
renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
renderer.outputEncoding      = THREE.sRGBEncoding;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
container.appendChild(renderer.domElement);

// ─── Orbit Controls ───────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan     = true;
controls.minDistance   = 0.5;
controls.maxDistance   = 50;

// ─── Lights ───────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x404060, 1.5));

const keyLight = new THREE.DirectionalLight(0xfff4e0, 3.0);
keyLight.position.set(8, 12, 8);
keyLight.castShadow            = true;
keyLight.shadow.mapSize.width  = 512;
keyLight.shadow.mapSize.height = 512;
keyLight.shadow.camera.near    = 1;
keyLight.shadow.camera.far     = 60;
keyLight.shadow.camera.left    = -15;
keyLight.shadow.camera.right   =  15;
keyLight.shadow.camera.top     =  15;
keyLight.shadow.camera.bottom  = -15;
scene.add(keyLight);

scene.add(Object.assign(new THREE.DirectionalLight(0x6688cc, 1.5), { position: new THREE.Vector3(-8, 4, -4) }));
scene.add(Object.assign(new THREE.DirectionalLight(0xcc88ff, 1.0), { position: new THREE.Vector3(0, -4, -10) }));
scene.add(new THREE.HemisphereLight(0xfff4b0, 0x080820, 0.5));

const orbitPoint = new THREE.PointLight(0x44aaff, 2.5, 18);
scene.add(orbitPoint);

// ─── UI refs ──────────────────────────────────────────────────────────────────
const overlay = document.getElementById("loading-overlay");
const loadBar = document.getElementById("load-bar");
const loadPct = document.getElementById("load-pct");
const tooltip = document.getElementById("tooltip");
const toastEl = document.getElementById("toast");

// ── Loading helpers ────────────────────────────────────────────────────────────
// Use indeterminate animated bar (xhr.total is often 0 — no Content-Length header)
function setLoadingIndeterminate() {
  if (loadBar) loadBar.classList.add("indeterminate");
  if (loadPct) loadPct.textContent = "Loading…";
}
function setLoadingDone() {
  if (loadBar) { loadBar.classList.remove("indeterminate"); loadBar.style.width = "100%"; }
  if (loadPct) loadPct.textContent = "100%";
  setTimeout(() => { if (overlay) overlay.classList.add("hidden"); }, 400);
}
function setLoadingError(msg) {
  if (overlay) {
    overlay.innerHTML = `
      <div class="loader-inner">
        <p style="color:#ff6b6b;font-size:1rem;text-align:center">⚠️ Failed to load model</p>
        <p style="color:#aaa;font-size:0.8rem;margin-top:0.5rem;text-align:center">${msg}</p>
        <button onclick="location.reload()" style="margin-top:1rem;padding:0.4rem 1.2rem;border:1px solid #6688ff;background:transparent;color:#99aaff;border-radius:99px;cursor:pointer;font-size:0.85rem">Retry</button>
      </div>`;
  }
}

// Timeout: if model hasn't loaded in 60s, show error
const loadTimeout = setTimeout(() => setLoadingError("Timed out. Check console (F12) for details."), 60000);
setLoadingIndeterminate();

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2500);
}

// ─── Door state ───────────────────────────────────────────────────────────────
// doorStates: meshUUID → { group: THREE.Object3D, open, currentAngle, targetAngle, baseAngle }
const doorStates = new Map();
const doorMeshes = []; // actual Mesh objects for raycasting

// A door GROUP node name looks like "Door.001_7" — has a period after "Door"
function isDoorGroup(name) {
  return /^Door[. _]/i.test(name) && !/frame/i.test(name);
}

// ─── Load GLTF ────────────────────────────────────────────────────────────────
let model          = null;
let modelBaseScale = 1;
let allSceneMeshes = []; // for double-click raycasting

const loader = new GLTFLoader();
loader.load(
  "models/home/scene.gltf",
  (gltf) => {
    clearTimeout(loadTimeout); // cancel error timeout
    model = gltf.scene;

    // ── Normalise size & center ───────────────────────────────────────────────
    const box    = new THREE.Box3().setFromObject(model);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    modelBaseScale = 6 / Math.max(size.x, size.y, size.z);
    model.scale.setScalar(modelBaseScale);
    model.position.sub(center.multiplyScalar(modelBaseScale));

    scene.add(model);

    // ── Find door GROUPS then collect their child meshes ──────────────────────
    // GLTF structure:  Door.001_7 (Group)
    //                    └─ Object_14 (Mesh)
    //                    └─ Object_15 (Mesh)
    // We target the GROUP for rotation, child meshes for raycasting.
    model.traverse((node) => {
      if (node.isMesh) {
        node.castShadow    = true;
        node.receiveShadow = true;
        allSceneMeshes.push(node);
        return;
      }

      // Is this a door GROUP node?
      if (isDoorGroup(node.name)) {
        const childMeshes = [];
        node.traverse((c) => { if (c.isMesh) childMeshes.push(c); });

        if (childMeshes.length === 0) return;

        // One shared state per door group
        const state = {
          group:        node,
          open:         false,
          baseAngle:    node.rotation.y,
          currentAngle: node.rotation.y,
          targetAngle:  node.rotation.y,
        };

        childMeshes.forEach((m) => {
          // Save original emissive for hover highlight
          if (m.material?.emissive) {
            m.userData.origEmissive = m.material.emissive.clone();
          }
          doorMeshes.push(m);
          doorStates.set(m.uuid, state);
        });
      }
    });

    // ── Fit camera ───────────────────────────────────────────────────────────
    const newBox    = new THREE.Box3().setFromObject(model);
    const newCenter = newBox.getCenter(new THREE.Vector3());
    controls.target.copy(newCenter);

    setLoadingDone();

    const doorCount = new Set([...doorStates.values()].map(s => s.group.uuid)).size;
    console.log(`✅ Loaded. Door groups: ${doorCount}`);
    showToast(doorCount > 0 ? `✅ Loaded — Click any door to open!` : `✅ Loaded`);
  },
  (_xhr) => { /* progress: indeterminate bar handles visuals */ },
  (err) => {
    clearTimeout(loadTimeout);
    console.error("GLTF Error:", err);
    setLoadingError(err?.message || String(err));
  }
);

// ─── Raycaster ────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const ndc       = new THREE.Vector2();

let hoveredMesh = null;

// ── Hover: highlight door ──────────────────────────────────────────────────────
let rawMouseX = 0, rawMouseY = 0;

window.addEventListener("mousemove", (e) => {
  rawMouseX = (e.clientX / window.innerWidth  - 0.5) * 2;
  rawMouseY = (e.clientY / window.innerHeight - 0.5) * 2;

  if (!doorMeshes.length) return;

  ndc.set(
    (e.clientX / window.innerWidth)  * 2 - 1,
   -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(doorMeshes, false);

  const hit = hits[0]?.object ?? null;

  if (hit !== hoveredMesh) {
    // Remove old highlight
    if (hoveredMesh?.material?.emissive) {
      hoveredMesh.material.emissive.copy(hoveredMesh.userData.origEmissive ?? new THREE.Color(0));
    }
    hoveredMesh = hit;
    // Add new highlight
    if (hoveredMesh?.material?.emissive) {
      hoveredMesh.material.emissive.set(0x2244aa);
    }
    document.body.style.cursor = hoveredMesh ? "pointer" : "default";

    if (tooltip) {
      if (hoveredMesh) {
        const st = doorStates.get(hoveredMesh.uuid);
        tooltip.textContent = st?.open ? "🔒 Click to close" : "🚪 Click to open";
        tooltip.style.opacity = "1";
      } else {
        tooltip.style.opacity = "0";
      }
    }
  }
});

// ── Click: toggle door (guard against orbit drag) ─────────────────────────────
let pointerDownPos = new THREE.Vector2();

window.addEventListener("pointerdown", (e) => {
  pointerDownPos.set(e.clientX, e.clientY);
});

window.addEventListener("pointerup", (e) => {
  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  if (Math.sqrt(dx * dx + dy * dy) > 6) return; // was a drag

  ndc.set(
    (e.clientX / window.innerWidth)  * 2 - 1,
   -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(doorMeshes, false);
  if (!hits.length) return;

  const state = doorStates.get(hits[0].object.uuid);
  if (!state) return;

  state.open        = !state.open;
  // Rotate GROUP around its local Y — negative = inward swing (natural)
  state.targetAngle = state.open
    ? state.baseAngle - Math.PI / 2
    : state.baseAngle;

  showToast(state.open ? "🚪 Opening…" : "🔒 Closing…");
});

// ── Double-click: fly camera to clicked surface ───────────────────────────────
let fly = null; // { from, to, lookAt, progress }

window.addEventListener("dblclick", (e) => {
  if (!model) return;
  ndc.set(
    (e.clientX / window.innerWidth)  * 2 - 1,
   -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(allSceneMeshes, false);
  if (!hits.length) return;

  const pt = hits[0].point;
  fly = {
    from:     camera.position.clone(),
    to:       pt.clone().add(new THREE.Vector3(0, 0.5, 1.2)),
    lookAt:   pt.clone(),
    progress: 0,
  };
  showToast("🏠 Flying to that spot…");
});

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ─── Clock ────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let elapsed = 0;
let smoothX = 0, smoothY = 0;

// Cubic ease-in-out
function easeIO(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }

// ─── Animate ──────────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  elapsed    += delta;

  // Mouse smooth lerp
  const decay = 1 - Math.pow(0.01, delta);
  smoothX    += (rawMouseX - smoothX) * decay;
  smoothY    += (rawMouseY - smoothY) * decay;

  // ── Camera fly ────────────────────────────────────────────────────────────
  if (fly && fly.progress < 1) {
    fly.progress = Math.min(fly.progress + delta / 1.4, 1);
    const t = easeIO(fly.progress);
    camera.position.lerpVectors(fly.from, fly.to, t);
    controls.target.lerp(fly.lookAt, t);
    if (fly.progress >= 1) fly = null;
  }

  // ── Door rotation (per unique group, via Set dedup) ───────────────────────
  const animated = new Set();
  doorStates.forEach((state) => {
    if (animated.has(state.group.uuid)) return;
    animated.add(state.group.uuid);

    // Smooth exponential lerp — feels like a real hinge with friction
    const lerpF = 1 - Math.pow(0.0008, delta);
    state.currentAngle += (state.targetAngle - state.currentAngle) * lerpF;
    state.group.rotation.y = state.currentAngle;
  });

  // ── Orbiting accent light ─────────────────────────────────────────────────
  orbitPoint.position.set(
    Math.sin(elapsed * 0.4) * 7,
    Math.sin(elapsed * 0.25) * 2 + 2.5,
    Math.cos(elapsed * 0.4) * 7
  );
  orbitPoint.intensity = 2.5 + Math.sin(elapsed) * 0.8;

  controls.update();
  renderer.render(scene, camera);
}

animate();
