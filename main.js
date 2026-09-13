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
renderer.shadowMap.enabled  = true;
renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
renderer.outputEncoding     = THREE.sRGBEncoding;
renderer.toneMapping        = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
container.appendChild(renderer.domElement);

// ─── Orbit Controls ───────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.06;
controls.enablePan      = true;
controls.minDistance    = 1;    // allow going close/inside
controls.maxDistance    = 50;
controls.autoRotate     = false;

// ─── Lights ───────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x404060, 1.5));

const keyLight = new THREE.DirectionalLight(0xfff4e0, 3.0);
keyLight.position.set(8, 12, 8);
keyLight.castShadow             = true;
keyLight.shadow.mapSize.width   = 512;   // ← optimised (was 1024)
keyLight.shadow.mapSize.height  = 512;
keyLight.shadow.camera.near     = 1;
keyLight.shadow.camera.far      = 60;
keyLight.shadow.camera.left     = -15;
keyLight.shadow.camera.right    = 15;
keyLight.shadow.camera.top      = 15;
keyLight.shadow.camera.bottom   = -15;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x6688cc, 1.5);
fillLight.position.set(-8, 4, -4);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xcc88ff, 1.0);
rimLight.position.set(0, -4, -10);
scene.add(rimLight);

scene.add(new THREE.HemisphereLight(0xfff4b0, 0x080820, 0.5));

const orbitPoint = new THREE.PointLight(0x44aaff, 2.5, 18);
scene.add(orbitPoint);

// ─── Loading overlay ──────────────────────────────────────────────────────────
const overlay = document.getElementById("loading-overlay");
const loadBar = document.getElementById("load-bar");
const loadPct = document.getElementById("load-pct");
const tooltip = document.getElementById("tooltip");
const toastEl = document.getElementById("toast");

function showToast(msg, duration = 2200) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), duration);
}

// ─── Model state ──────────────────────────────────────────────────────────────
let model          = null;
let modelBaseScale = 1;

// ─── Door/Gate animation state ────────────────────────────────────────────────
// Map: nodeUUID → { pivot: Group, open: bool, currentAngle: number, targetAngle: number }
const doorStates = new Map();
// All door meshes for raycasting
const doorMeshes = [];

// Keywords that identify door/gate nodes (matches GLTF names found in scene.gltf)
const DOOR_KEYWORDS = ["Door.", "door.", "Gate", "gate"];

function isDoor(name) {
  // Match Door.001_7, Door.002_8, etc. — but NOT DoorFrame
  return DOOR_KEYWORDS.some(k => name.includes(k)) && !name.toLowerCase().includes("frame");
}

/**
 * Wrap a door mesh in a pivot Group for hinge-style rotation.
 * The pivot is placed at the left edge of the mesh's world bounding box.
 */
function setupDoorPivot(mesh) {
  // Save world transform before reparenting
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();
  mesh.getWorldPosition(worldPos);
  mesh.getWorldQuaternion(worldQuat);
  mesh.getWorldScale(worldScale);

  // Bounding box in world space
  const box    = new THREE.Box3().setFromObject(mesh);
  const size   = box.getSize(new THREE.Vector3());

  // Hinge at left-most X edge (world space)
  const hingeWorldX = box.min.x;

  // Create pivot group at hinge position
  const pivot = new THREE.Group();
  pivot.position.set(hingeWorldX, worldPos.y, worldPos.z);
  pivot.quaternion.copy(worldQuat);

  // Reparent mesh to pivot — keep scene as parent of pivot
  const originalParent = mesh.parent;
  originalParent.add(pivot);
  pivot.add(mesh);

  // Shift mesh inside pivot so its left edge aligns with pivot origin
  // (pivot origin = hinge = left edge of door)
  mesh.position.set(size.x / 2, 0, 0);
  mesh.quaternion.set(0, 0, 0, 1); // reset local rotation

  return pivot;
}

// ─── Load GLTF ────────────────────────────────────────────────────────────────
let totalBytesLoaded = 0;
let totalBytesTotal  = 0;

const loader = new GLTFLoader();
loader.load(
  "models/home/scene.gltf",
  (gltf) => {
    model = gltf.scene;

    // Centre & normalise
    const box    = new THREE.Box3().setFromObject(model);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    modelBaseScale = 6 / maxDim;
    model.scale.setScalar(modelBaseScale);
    model.position.sub(center.multiplyScalar(modelBaseScale));

    scene.add(model);

    // ── Traverse: shadows + door detection ───────────────────────────────────
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow    = true;
      child.receiveShadow = true;

      // ── OPTIMISATION: share material instances ────────────────────────────
      if (child.material) {
        child.material.needsUpdate = false;
      }

      const name = child.name || "";
      if (isDoor(name)) {
        // Store original emissive for hover highlight
        child.userData.origEmissive = (child.material?.emissive?.clone()) ?? new THREE.Color(0);

        // Setup hinge pivot
        const pivot = setupDoorPivot(child);
        doorStates.set(child.uuid, {
          pivot,
          open:         false,
          currentAngle: 0,
          targetAngle:  0,
        });
        doorMeshes.push(child);
      }
    });

    // ── Camera: fit model in view ─────────────────────────────────────────────
    const newBox = new THREE.Box3().setFromObject(model);
    const newCenter = newBox.getCenter(new THREE.Vector3());
    controls.target.copy(newCenter);
    camera.lookAt(newCenter);

    // 100% → fade overlay
    if (loadBar) loadBar.style.width = "100%";
    if (loadPct) loadPct.textContent  = "100%";
    setTimeout(() => { if (overlay) overlay.classList.add("hidden"); }, 300);

    showToast(`✅ Model loaded — ${doorMeshes.length} door(s) found. Click to open!`);
  },
  (xhr) => {
    if (xhr.total > 0) {
      totalBytesLoaded += xhr.loaded - (xhr._prevLoaded || 0);
      totalBytesTotal  += xhr.total  - (xhr._prevTotal  || 0);
      xhr._prevLoaded   = xhr.loaded;
      xhr._prevTotal    = xhr.total;
      const pct = Math.min(Math.round((totalBytesLoaded / totalBytesTotal) * 100), 99);
      if (loadBar) loadBar.style.width = pct + "%";
      if (loadPct) loadPct.textContent  = pct + "%";
    }
  },
  (err) => {
    console.error(err);
    if (overlay) overlay.innerHTML = `<p style="color:#ff6b6b">⚠️ ${err.message}</p>`;
  }
);

// ─── Raycaster ────────────────────────────────────────────────────────────────
const raycaster  = new THREE.Raycaster();
const ndc        = new THREE.Vector2(); // normalised device coords

let hoveredDoor  = null;

// ── Hover ─────────────────────────────────────────────────────────────────────
let rawMouseX = 0, rawMouseY = 0;

window.addEventListener("mousemove", (e) => {
  rawMouseX = (e.clientX / window.innerWidth  - 0.5) * 2;
  rawMouseY = (e.clientY / window.innerHeight - 0.5) * 2;

  if (doorMeshes.length === 0) return;

  ndc.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const hits = raycaster.intersectObjects(doorMeshes, false);

  if (hits.length > 0) {
    const mesh = hits[0].object;
    if (mesh !== hoveredDoor) {
      // Un-highlight old
      if (hoveredDoor?.material?.emissive) {
        hoveredDoor.material.emissive.copy(hoveredDoor.userData.origEmissive);
      }
      hoveredDoor = mesh;
      // Highlight new
      if (hoveredDoor.material?.emissive) {
        hoveredDoor.material.emissive.set(0x224488);
      }
      document.body.style.cursor = "pointer";
      const st = doorStates.get(hoveredDoor.uuid);
      if (tooltip) {
        tooltip.textContent = st?.open ? "🔒 Click to close" : "🚪 Click to open";
        tooltip.style.opacity = "1";
      }
    }
  } else {
    if (hoveredDoor?.material?.emissive) {
      hoveredDoor.material.emissive.copy(hoveredDoor.userData.origEmissive);
    }
    hoveredDoor = null;
    document.body.style.cursor = "default";
    if (tooltip) tooltip.style.opacity = "0";
  }
});

// ── Single Click → toggle door ────────────────────────────────────────────────
let pointerMoved = false;
window.addEventListener("pointerdown", () => { pointerMoved = false; });
window.addEventListener("pointermove", () => { pointerMoved = true; });

window.addEventListener("pointerup", (e) => {
  if (pointerMoved) return; // was a drag, not a click

  ndc.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const hits = raycaster.intersectObjects(doorMeshes, false);
  if (hits.length === 0) return;

  const mesh  = hits[0].object;
  const state = doorStates.get(mesh.uuid);
  if (!state) return;

  state.open        = !state.open;
  state.targetAngle = state.open ? -Math.PI / 2 : 0; // open 90° inward
  showToast(state.open ? "🚪 Opening door…" : "🔒 Closing door…");
});

// ── Double Click → fly camera inside ─────────────────────────────────────────
let flyTarget    = null; // {pos: Vector3, lookAt: Vector3}
let flyProgress  = 1;    // 0=start, 1=arrived
const FLY_SPEED  = 1.2;  // seconds to complete fly

window.addEventListener("dblclick", (e) => {
  ndc.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  // Cast against entire model (not just doors)
  if (!model) return;
  const allMeshes = [];
  model.traverse(c => { if (c.isMesh) allMeshes.push(c); });
  const hits = raycaster.intersectObjects(allMeshes, false);
  if (hits.length === 0) return;

  const pt = hits[0].point; // clicked world position
  // Move camera 1 unit above hit point, looking slightly forward
  const camTarget = pt.clone().add(new THREE.Vector3(0, 0.5, 1.5));
  flyTarget   = { from: camera.position.clone(), to: camTarget, lookAt: pt };
  flyProgress = 0;
  showToast("🏠 Flying inside…");
});

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ─── Clock ────────────────────────────────────────────────────────────────────
const clock  = new THREE.Clock();
let elapsed  = 0;
let smoothMouseX = 0, smoothMouseY = 0;

// ─── Animation Loop ───────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  elapsed    += delta;

  // Frame-rate independent mouse lerp
  const decay    = 1 - Math.pow(0.01, delta);
  smoothMouseX  += (rawMouseX - smoothMouseX) * decay;
  smoothMouseY  += (rawMouseY - smoothMouseY) * decay;

  // ── Camera fly animation (double-click) ───────────────────────────────────
  if (flyTarget && flyProgress < 1) {
    flyProgress = Math.min(flyProgress + delta / FLY_SPEED, 1);
    const t = easeInOut(flyProgress);
    camera.position.lerpVectors(flyTarget.from, flyTarget.to, t);
    camera.lookAt(flyTarget.lookAt);
    controls.target.lerp(flyTarget.lookAt, t);
    if (flyProgress >= 1) flyTarget = null;
  }

  // ── Door hinge animation ───────────────────────────────────────────────────
  doorStates.forEach((state) => {
    const hingeLerp    = 1 - Math.pow(0.0005, delta); // very smooth friction
    state.currentAngle += (state.targetAngle - state.currentAngle) * hingeLerp;
    state.pivot.rotation.y = state.currentAngle;
  });

  // ── Orbiting accent light ──────────────────────────────────────────────────
  orbitPoint.position.x = Math.sin(elapsed * 0.4) * 7;
  orbitPoint.position.z = Math.cos(elapsed * 0.4) * 7;
  orbitPoint.position.y = Math.sin(elapsed * 0.25) * 2.5 + 2;
  orbitPoint.intensity  = 2.5 + Math.sin(elapsed) * 0.8;

  controls.update();
  renderer.render(scene, camera);
}

// Smooth ease in-out cubic
function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

animate();
