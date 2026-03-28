import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FaceTracker } from "./faceTracker";
import { fetchStations, renderStations } from "./stationRenderer";
import { TabSync } from "./tabSync";
import { classifyLines, filterStations, getCategoriesForTab } from "./stationFilter";
import { TrainRenderer } from "./trainRenderer";
import { TimeController, type SpeedMultiplier } from "./timeController";
import "./style.css";

// --- Sensitivity / smoothing (tweak these) ---
const SENSITIVITY_ROTATION = 2.0; // how much head angle affects camera
const SENSITIVITY_POSITION = 0.15; // how much head translation affects camera (radians per cm)
const SMOOTHING = 0.15; // lerp factor (0 = no change, 1 = instant)
const INITIAL_POSITION = new THREE.Vector3(3, 3, 3);
const CAMERA_RADIUS = INITIAL_POSITION.length();
const LOOK_AT = new THREE.Vector3(0, 1, 0); // center of ori

// --- Renderer ---
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x1a1a1a);

// --- Scene ---
const scene = new THREE.Scene();

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.copy(INITIAL_POSITION);
camera.lookAt(LOOK_AT);

// --- OrbitControls ---
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.copy(LOOK_AT);

// --- Grid ---
const grid = new THREE.GridHelper(10, 10, 0x444444, 0x333333);
scene.add(grid);

// --- Ori (wireframe cube) ---
const oriGeometry = new THREE.BoxGeometry(2, 2, 2);
const oriEdges = new THREE.EdgesGeometry(oriGeometry);
const oriMaterial = new THREE.LineBasicMaterial({ color: 0x00ffaa });
const ori = new THREE.LineSegments(oriEdges, oriMaterial);
ori.position.y = 1;
scene.add(ori);

// --- Sea level (0m) marker inside ori ---
// elev=0 → y = (0 * EXAGGERATION / MAX_H) * 2 = 0
const seaLevelY = 0;
const seaLevelGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-1, seaLevelY, -1),
  new THREE.Vector3(1, seaLevelY, -1),
  new THREE.Vector3(1, seaLevelY, 1),
  new THREE.Vector3(-1, seaLevelY, 1),
  new THREE.Vector3(-1, seaLevelY, -1),
]);
const seaLevelLine = new THREE.Line(
  seaLevelGeo,
  new THREE.LineBasicMaterial({ color: 0x4488ff, opacity: 0.6, transparent: true })
);
ori.add(seaLevelLine);

// --- Tab-aware station rendering ---
const timeCtrl = new TimeController();
const trainRenderer = new TrainRenderer();
let dataLoaded = false;
const tabInfoEl = document.getElementById("tab-info") as HTMLDivElement;

const tabLabels: Record<string, string> = {
  all: "全路線",
  "subway,inner": "23区内完結路線",
  connecting: "接続路線",
  subway: "地下鉄 (Metro/都営)",
  inner: "JR・私鉄 (23区内)",
};

(async () => {
  const allStations = await fetchStations();
  const lineClassification = classifyLines(allStations);

  async function updateStations(tabCount: number, tabIndex: number): Promise<void> {
    const categories = getCategoriesForTab(tabCount, tabIndex);
    const stations =
      categories === null
        ? allStations
        : filterStations(allStations, lineClassification, categories);
    const railLines = renderStations(stations, ori);
    await trainRenderer.load(ori, railLines);
    dataLoaded = true;

    const categoryKey = categories === null ? "all" : [...categories].sort().join(",");
    const label = tabLabels[categoryKey] ?? categoryKey;
    tabInfoEl.textContent = `Tab ${tabIndex + 1}/${tabCount} — ${label}`;
    document.title = tabCount <= 1 ? "Ori Viewer" : `Ori Viewer — ${label}`;
  }

  new TabSync((tabCount, tabIndex) => {
    updateStations(tabCount, tabIndex);
  });
})();

// --- UI ---
const startBtn = document.getElementById("btn-start") as HTMLButtonElement;
const previewBtn = document.getElementById("btn-preview") as HTMLButtonElement;
const videoEl = document.getElementById("face-video") as HTMLVideoElement;
const previewContainer = document.getElementById(
  "preview-container"
) as HTMLDivElement;

// --- Helper: compute spherical angles relative to LOOK_AT ---
function sphericalAnglesFromPosition(pos: THREE.Vector3) {
  const rel = pos.clone().sub(LOOK_AT);
  const r = rel.length();
  return {
    pitch: Math.asin(rel.y / r),
    yaw: Math.atan2(rel.x, rel.z),
  };
}

// --- Face tracking state ---
const initial = sphericalAnglesFromPosition(INITIAL_POSITION);
let basePitch = initial.pitch;
let baseYaw = initial.yaw;
let targetPitch = basePitch;
let targetYaw = baseYaw;
let currentPitch = basePitch;
let currentYaw = baseYaw;

const faceTracker = new FaceTracker(videoEl, (pose) => {
  // Combine rotation and position: both contribute to camera orbit angles
  const pitchDelta =
    pose.pitch * SENSITIVITY_ROTATION + pose.y * SENSITIVITY_POSITION;
  const yawDelta =
    pose.yaw * SENSITIVITY_ROTATION + pose.x * SENSITIVITY_POSITION;

  targetPitch = basePitch - pitchDelta;
  targetYaw = baseYaw - yawDelta;

  // Clamp pitch to avoid flipping
  targetPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, targetPitch));
});

startBtn.addEventListener("click", async () => {
  if (faceTracker.running) {
    faceTracker.stop();
    controls.enabled = true;
    startBtn.textContent = "🎥 Start Face Tracking";
    startBtn.classList.remove("active");
    previewBtn.classList.remove("active");
    previewContainer.classList.remove("visible");
  } else {
    startBtn.textContent = "Loading...";
    startBtn.disabled = true;
    try {
      await faceTracker.start();
      controls.enabled = false;

      // Capture current orbit position as base (relative to LOOK_AT)
      const angles = sphericalAnglesFromPosition(camera.position);
      basePitch = angles.pitch;
      baseYaw = angles.yaw;
      currentPitch = basePitch;
      currentYaw = baseYaw;
      targetPitch = basePitch;
      targetYaw = baseYaw;

      startBtn.textContent = "⏹ Stop";
      startBtn.classList.add("active");
    } catch (e) {
      console.error("Face tracking failed:", e);
      const msg =
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "⚠ Camera permission denied"
          : "⚠ Failed to start face tracking";
      startBtn.textContent = msg;
      setTimeout(() => {
        startBtn.textContent = "🎥 Start Face Tracking";
      }, 3000);
    } finally {
      startBtn.disabled = false;
    }
  }
});

previewBtn.addEventListener("click", () => {
  if (!faceTracker.running) return;
  previewContainer.classList.toggle("visible");
  previewBtn.classList.toggle("active");
});

// --- Time controls ---
const speedSelect = document.getElementById("speed-select") as HTMLSelectElement;
const simTimeEl = document.getElementById("sim-time") as HTMLSpanElement;
const trainCountEl = document.getElementById("train-count") as HTMLSpanElement;

speedSelect.addEventListener("change", () => {
  timeCtrl.setSpeed(Number(speedSelect.value) as SpeedMultiplier);
});

// --- Train click tooltip ---
const tooltipEl = document.getElementById("train-tooltip") as HTMLDivElement;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

canvas.addEventListener("click", (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const meshes = trainRenderer.getVisibleMeshes();
  if (meshes.length === 0) return;

  const intersects = raycaster.intersectObjects(meshes);
  if (intersects.length > 0) {
    const info = trainRenderer.getTrainInfoByMesh(intersects[0].object);
    if (info) {
      tooltipEl.innerHTML =
        `<span class="line-name">${info.lineName}</span><br>` +
        `<span class="terminal">${info.terminal} 方面</span><br>` +
        `<span class="train-id">${info.trainId}</span>`;
      tooltipEl.style.left = `${event.clientX + 12}px`;
      tooltipEl.style.top = `${event.clientY - 10}px`;
      tooltipEl.classList.add("visible");

      // Auto-hide after 3 seconds
      setTimeout(() => tooltipEl.classList.remove("visible"), 3000);
    }
  } else {
    tooltipEl.classList.remove("visible");
  }
});

// Hide tooltip on camera move
canvas.addEventListener("mousedown", () => {
  tooltipEl.classList.remove("visible");
});

// --- Resize ---
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Render loop ---
let frameCount = 0;

function animate() {
  requestAnimationFrame(animate);

  // Advance simulation clock and update trains (only after data is loaded)
  if (dataLoaded) {
    const simTime = timeCtrl.tick();
    trainRenderer.update(simTime);

    // Update UI every 15 frames (~4 times/sec at 60fps)
    if (++frameCount % 15 === 0) {
      simTimeEl.textContent = timeCtrl.formatTime();
      trainCountEl.textContent = `${trainRenderer.activeCount} trains`;
    }
  }

  if (faceTracker.running) {
    // Smooth interpolation
    currentPitch += (targetPitch - currentPitch) * SMOOTHING;
    currentYaw += (targetYaw - currentYaw) * SMOOTHING;

    // Spherical to cartesian (centered on LOOK_AT)
    camera.position.set(
      LOOK_AT.x + CAMERA_RADIUS * Math.cos(currentPitch) * Math.sin(currentYaw),
      LOOK_AT.y + CAMERA_RADIUS * Math.sin(currentPitch),
      LOOK_AT.z + CAMERA_RADIUS * Math.cos(currentPitch) * Math.cos(currentYaw)
    );
    camera.lookAt(LOOK_AT);
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
}

animate();
