import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import * as THREE from "three";

export interface HeadPose {
  pitch: number; // radians, positive = looking up
  yaw: number; // radians, positive = looking right
  x: number; // horizontal position (positive = right, cm-scale)
  y: number; // vertical position (positive = up, cm-scale)
}

export type OnPoseCallback = (pose: HeadPose) => void;

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export class FaceTracker {
  private faceLandmarker: FaceLandmarker | null = null;
  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private animFrameId = 0;
  private lastVideoTime = -1;
  private onPose: OnPoseCallback;
  private _running = false;

  // Neutral pose (calibrated on first detection)
  private neutralPitch: number | null = null;
  private neutralYaw: number | null = null;
  private neutralX: number | null = null;
  private neutralY: number | null = null;

  constructor(video: HTMLVideoElement, onPose: OnPoseCallback) {
    this.video = video;
    this.onPose = onPose;
  }

  get running() {
    return this._running;
  }

  async start(): Promise<void> {
    // Init MediaPipe
    if (!this.faceLandmarker) {
      const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
    }

    // Start camera
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });

    try {
      this.video.srcObject = this.stream;
      await new Promise<void>((resolve, reject) => {
        const onMeta = () => {
          cleanup();
          resolve();
        };
        const onErr = () => {
          cleanup();
          reject(new Error("Video load failed"));
        };
        const cleanup = () => {
          this.video.removeEventListener("loadedmetadata", onMeta);
          this.video.removeEventListener("error", onErr);
        };
        this.video.addEventListener("loadedmetadata", onMeta, { once: true });
        this.video.addEventListener("error", onErr, { once: true });
      });
      await this.video.play();
    } catch (e) {
      // Clean up stream if video setup fails
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.video.srcObject = null;
      throw e;
    }

    this._running = true;
    this.neutralPitch = null;
    this.neutralYaw = null;
    this.neutralX = null;
    this.neutralY = null;
    this.detect();
  }

  stop(): void {
    this._running = false;
    cancelAnimationFrame(this.animFrameId);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  dispose(): void {
    this.stop();
    this.faceLandmarker?.close();
    this.faceLandmarker = null;
  }

  private detect = (): void => {
    if (!this._running || !this.faceLandmarker) return;

    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;

      const result = this.faceLandmarker.detectForVideo(
        this.video,
        performance.now()
      );

      const matrix = result.facialTransformationMatrixes?.[0];
      if (matrix) {
        const m = matrix.data as unknown as number[];

        // Extract Euler angles via Three.js
        const mat4 = new THREE.Matrix4().fromArray(m);
        const euler = new THREE.Euler().setFromRotationMatrix(mat4, "XYZ");
        const pitch = euler.x;
        const yaw = euler.y;

        // Extract translation (column-major: tx=m[12], ty=m[13])
        const tx = m[12];
        const ty = m[13];

        // Calibrate neutral on first detection
        if (
          this.neutralPitch === null ||
          this.neutralYaw === null ||
          this.neutralX === null ||
          this.neutralY === null
        ) {
          this.neutralPitch = pitch;
          this.neutralYaw = yaw;
          this.neutralX = tx;
          this.neutralY = ty;
        }

        // Mirror x and yaw (webcam is mirrored)
        this.onPose({
          pitch: pitch - this.neutralPitch,
          yaw: -(yaw - this.neutralYaw),
          x: -(tx - this.neutralX),
          y: ty - this.neutralY,
        });
      }
    }

    this.animFrameId = requestAnimationFrame(this.detect);
  };
}
