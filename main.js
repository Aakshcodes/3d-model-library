import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.150.1/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.150.1/examples/jsm/loaders/GLTFLoader.js";

// ─── Scene ────────────────────────────────────────────────────────────────────
const container = document.getElementById("Home3D");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0d1a);
scene.fog = new THREE.FogExp2(0x0d0d1a, 0.014);

// ─── Camera ───────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  60,
  container.clientWidth / container.clientHeight,
  0.01,
  1000
);
camera.position.set(0, 2, 12);

// ─── Renderer ─────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
container.appendChild(renderer.domElement);

// ─── Orbit Controls ───────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 40;
controls.autoRotate = false;

// ─── Lights ───────────────────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0x404060, 1.5);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff4e0, 3.5);
keyLight.position.set(8, 12, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 100;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x6688cc, 1.8);
fillLight.position.set(-8, 4, -4);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xcc88ff, 1.2);
rimLight.position.set(0, -6, -10);
scene.add(rimLight);

const groundLight = new THREE.HemisphereLight(0xfff4b0, 0x080820, 0.6);
scene.add(groundLight);

const orbitPoint = new THREE.PointLight(0x44aaff, 3, 20);
scene.add(orbitPoint);

// ─── Loading overlay ──────────────────────────────────────────────────────────
const overlay = document.getElementById("loading-overlay");
const loadBar = document.getElementById("load-bar");
const loadPct  = document.getElementById("load-pct");

// ─── Tooltip UI ───────────────────────────────────────────────────────────────
const tooltip = document.getElementById("tooltip");

// ─── Gate / Door State ────────────────────────────────────────────────────────
// Keywords to auto-detect clickable meshes (gate, door, window, etc.)
const CLICKABLE_KEYWORDS = [
  "gate", "door", "door_leaf", "leaf", "panel",
  "fence", "portal", "entri", "entry", "shutter", "window"
];

// Map: mesh.uuid → { pivot: Group, open: bool, currentAngle: number, targetAngle: number, openAngle: number }
const clickableObjects = new Map();
// All THREE.Mesh objects eligible for raycasting
let raycasterTargets = [];

function isClickable(name) {
  const n = (name || "").toLowerCase();
  return CLICKABLE_KEYWORDS.some((k) => n.includes(k));
}

/**
 * Given a mesh, wrap it in a pivot Group positioned at its left edge (hinge).
 * Returns the pivot group added to the scene (or parent).
 */
function wrapWithPivot(mesh) {
  // World bounding box
  const box    = new THREE.Box3().setFromObject(mesh);
  const size   = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Hinge at the left edge of the bounding box (local space)
  // We pivot around Y axis — feels natural for a gate/door
  const hingeOffset = new THREE.Vector3(
    box.min.x - mesh.position.x, // left edge in local space
    0,
    0
  );

  // Create pivot group at the hinge world position
  const pivot = new THREE.Group();
  pivot.position.copy(mesh.getWorldPosition(new THREE.Vector3()));
  pivot.position.x = box.min.x; // hinge is left edge

  // Reparent mesh into pivot
  const parent = mesh.parent;
  parent.add(pivot);
  pivot.add(mesh);

  // Offset mesh so its left edge aligns with pivot origin
  mesh.position.x = size.x / 2;

  return pivot;
}

// ─── Load GLTF Model ──────────────────────────────────────────────────────────
let model          = null;
let modelBaseScale = 1;

// Track overall loading progress across all GLTF sub-files
let totalBytesLoaded = 0;
let totalBytesTotal  = 0;

const loader = new GLTFLoader();
loader.load(
  "models/home/scene.gltf",
  (gltf) => {
    model = gltf.scene;

    // Show 100% before hiding
    if (loadBar) loadBar.style.width = "100%";
    if (loadPct)  loadPct.textContent  = "100%";

    // Centre and normalise
    const box    = new THREE.Box3().setFromObject(model);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    modelBaseScale = 6 / maxDim;
    model.scale.setScalar(modelBaseScale);
    model.position.sub(center.multiplyScalar(modelBaseScale));

    // ── Traverse: shadows + find clickable meshes ──────────────────────────
    const allMeshNames = [];
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow    = true;
      child.receiveShadow = true;

      const name = child.name || child.parent?.name || "";
      allMeshNames.push(name);

      if (isClickable(name)) {
        // Wrap with pivot for hinge animation
        const pivot = wrapWithPivot(child);
        const openAngle = Math.PI / 2; // 90° open

        clickableObjects.set(child.uuid, {
          pivot,
          open:         false,
          currentAngle: 0,
          targetAngle:  0,
          openAngle,
        });

        // Store original material for highlight
        if (child.material) {
          child.userData.origEmissive = child.material.emissive?.clone() ?? new THREE.Color(0x000000);
        }

        raycasterTargets.push(child);
        console.log("✅ Clickable mesh found:", name);
      }
    });

    // Log all mesh names so you can see what's in the model
    console.log("─── ALL MESH NAMES ───");
    console.table(allMeshNames);

    // If no named gate/door found, make ALL meshes clickable (fallback)
    if (raycasterTargets.length === 0) {
      console.warn("No gate/door keyword found. Making all meshes clickable. Check console for names.");
      model.traverse((child) => {
        if (child.isMesh) {
          raycasterTargets.push(child);
          console.log("Mesh:", child.name);
        }
      });
    }

    scene.add(model);
    camera.lookAt(0, 0, 0);

    // Small delay so user sees 100% before overlay fades
    setTimeout(() => {
      if (overlay) overlay.classList.add("hidden");
    }, 300);
  },
  (xhr) => {
    // GLTF fires separate XHR events for .gltf, .bin, and each texture.
    // Accumulate totals to keep percentage 0-100%.
    if (xhr.total > 0) {
      totalBytesLoaded += xhr.loaded - (xhr._prevLoaded || 0);
      totalBytesTotal  += xhr.total  - (xhr._prevTotal  || 0);
      xhr._prevLoaded   = xhr.loaded;
      xhr._prevTotal    = xhr.total;
      const pct = Math.min(Math.round((totalBytesLoaded / totalBytesTotal) * 100), 99);
      if (loadBar) loadBar.style.width = pct + "%";
      if (loadPct)  loadPct.textContent  = pct + "%";
    }
  },
  (error) => {
    console.error("GLTF load error:", error);
    if (overlay) {
      overlay.innerHTML = `<p style="color:#ff6b6b;">⚠️ Failed to load model.<br><small>${error.message || error}</small></p>`;
    }
  }
);

// ─── Raycaster ────────────────────────────────────────────────────────────────
const raycaster    = new THREE.Raycaster();
const clickedMouse = new THREE.Vector2();

// Hover highlight
let hoveredMesh = null;
const hoverMouse = new THREE.Vector2();

window.addEventListener("mousemove", (e) => {
  rawMouseX = (e.clientX / window.innerWidth  - 0.5) * 2;
  rawMouseY = (e.clientY / window.innerHeight - 0.5) * 2;

  hoverMouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  hoverMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  // Hover detection for cursor change + highlight
  if (raycasterTargets.length > 0) {
    raycaster.setFromCamera(hoverMouse, camera);
    const hits = raycaster.intersectObjects(raycasterTargets, false);
    if (hits.length > 0) {
      const mesh = hits[0].object;
      if (mesh !== hoveredMesh) {
        // Un-highlight old
        if (hoveredMesh && hoveredMesh.material) {
          hoveredMesh.material.emissive?.set(hoveredMesh.userData.origEmissive || 0x000000);
        }
        // Highlight new
        hoveredMesh = mesh;
        if (hoveredMesh.material && hoveredMesh.material.emissive) {
          hoveredMesh.material.emissive.set(0x333366);
        }
        document.body.style.cursor = "pointer";
        const state = clickableObjects.get(hoveredMesh.uuid);
        if (tooltip) {
          tooltip.textContent = state
            ? (state.open ? "Click to close" : "Click to open")
            : `Click → ${hoveredMesh.name}`;
          tooltip.style.opacity = "1";
        }
      }
    } else {
      if (hoveredMesh && hoveredMesh.material) {
        hoveredMesh.material.emissive?.set(hoveredMesh.userData.origEmissive || 0x000000);
      }
      hoveredMesh = null;
      document.body.style.cursor = "default";
      if (tooltip) tooltip.style.opacity = "0";
    }
  }
});

// Click → toggle open/close
window.addEventListener("click", (e) => {
  // Don't fire if user was orbiting (mousedown → mousemove → mouseup)
  clickedMouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  clickedMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (raycasterTargets.length === 0) return;

  raycaster.setFromCamera(clickedMouse, camera);
  const hits = raycaster.intersectObjects(raycasterTargets, false);
  if (hits.length === 0) return;

  const mesh  = hits[0].object;
  const state = clickableObjects.get(mesh.uuid);

  if (state) {
    // Toggle
    state.open        = !state.open;
    state.targetAngle = state.open ? state.openAngle : 0;
    console.log(`${state.open ? "Opening" : "Closing"} → ${mesh.name}`);
    showToast(state.open ? "🚪 Opening…" : "🔒 Closing…");
  } else {
    // Not a mapped gate — just log the name for debugging
    console.log("Clicked mesh:", mesh.name || "(no name)");
    showToast(`Clicked: ${mesh.name || "(unnamed mesh)"}`);
  }
});

// ─── Toast notification ───────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ─── Mouse parallax state ─────────────────────────────────────────────────────
let rawMouseX  = 0;
let rawMouseY  = 0;
let smoothMouseX = 0;
let smoothMouseY = 0;

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ─── Clock ────────────────────────────────────────────────────────────────────
const clock   = new THREE.Clock();
let   elapsed = 0;

// ─── Animation Loop ───────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  elapsed    += delta;

  // Frame-rate independent lerp
  const decay = 1 - Math.pow(0.01, delta);
  smoothMouseX += (rawMouseX - smoothMouseX) * decay;
  smoothMouseY += (rawMouseY - smoothMouseY) * decay;

  if (model) {
    // ── NO auto-rotation: user controls with OrbitControls ──────────────────
    // Only subtle mouse parallax tilt (no spinning)
    model.rotation.x = smoothMouseY * 0.08;
    model.rotation.z = smoothMouseX * 0.04;
  }

  // ── Animate all gate/door pivots ──────────────────────────────────────────
  clickableObjects.forEach((state) => {
    // Smooth lerp toward target angle — feels like a real hinge with friction
    const lerpSpeed = 1 - Math.pow(0.001, delta); // very smooth
    state.currentAngle += (state.targetAngle - state.currentAngle) * lerpSpeed;
    state.pivot.rotation.y = state.currentAngle;
  });

  // Orbiting accent light
  orbitPoint.position.x = Math.sin(elapsed * 0.5) * 8;
  orbitPoint.position.z = Math.cos(elapsed * 0.5) * 8;
  orbitPoint.position.y = Math.sin(elapsed * 0.3) * 3 + 2;
  orbitPoint.intensity  = 3 + Math.sin(elapsed * 1.2) * 1.2;

  controls.update();
  renderer.render(scene, camera);
}

animate();
