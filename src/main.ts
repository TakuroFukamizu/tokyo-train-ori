import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FaceTracker } from "./faceTracker";
import { loadStations } from "./stationRenderer";
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

// --- Stations (rendered inside ori) ---
loadStations(ori);

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

// --- Resize ---
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Render loop ---
function animate() {
  requestAnimationFrame(animate);

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
