import * as THREE from "three";
import type { RailLine } from "./stationRenderer";
import type { DelayManager } from "./delayManager";

const PARTICLES_PER_LINE = 30;
const PARTICLE_SIZE = 0.015;
const PARTICLE_SPEED = 0.3;

interface LineParticles {
  lineCode: string;
  points: THREE.Points;
  positions: Float32Array;
  pathPoints: THREE.Vector3[];
  pathLengths: number[];
  totalLength: number;
  offsets: Float32Array;
}

export class DelayParticles {
  private parent: THREE.Object3D;
  private lineParticlesMap = new Map<string, LineParticles>();
  private particleMaterial: THREE.PointsMaterial;

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
    this.particleMaterial = new THREE.PointsMaterial({
      color: 0xff4400,
      size: PARTICLE_SIZE,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  setRailLines(railLines: RailLine[]): void {
    this.dispose();

    for (const rl of railLines) {
      if (rl.stations.length < 2) continue;

      const pathPoints = rl.stations.map((s) => s.pos.clone());
      if (rl.isLoop) pathPoints.push(pathPoints[0].clone());

      const pathLengths: number[] = [0];
      let totalLength = 0;
      for (let i = 1; i < pathPoints.length; i++) {
        totalLength += pathPoints[i].distanceTo(pathPoints[i - 1]);
        pathLengths.push(totalLength);
      }

      const positions = new Float32Array(PARTICLES_PER_LINE * 3);
      const offsets = new Float32Array(PARTICLES_PER_LINE);
      for (let i = 0; i < PARTICLES_PER_LINE; i++) {
        offsets[i] = Math.random();
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const points = new THREE.Points(geometry, this.particleMaterial);
      points.visible = false;
      this.parent.add(points);

      this.lineParticlesMap.set(rl.lineCode, {
        lineCode: rl.lineCode,
        points,
        positions,
        pathPoints,
        pathLengths,
        totalLength,
        offsets,
      });
    }
  }

  update(delayManager: DelayManager, simTimeSec: number, deltaSec: number): void {
    for (const [lineCode, lp] of this.lineParticlesMap) {
      const ratio = delayManager.getDelayRatio(lineCode, simTimeSec);

      if (ratio <= 0) {
        lp.points.visible = false;
        continue;
      }

      lp.points.visible = true;
      (lp.points.material as THREE.PointsMaterial).opacity = 0.4 + 0.6 * ratio;

      const speed = PARTICLE_SPEED * deltaSec;
      for (let i = 0; i < PARTICLES_PER_LINE; i++) {
        lp.offsets[i] = (lp.offsets[i] + speed / lp.totalLength) % 1;

        const dist = lp.offsets[i] * lp.totalLength;
        const pos = this.getPointOnPath(lp, dist);
        lp.positions[i * 3] = pos.x;
        lp.positions[i * 3 + 1] = pos.y;
        lp.positions[i * 3 + 2] = pos.z;
      }

      (lp.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private getPointOnPath(lp: LineParticles, dist: number): THREE.Vector3 {
    const { pathPoints, pathLengths } = lp;
    let segIdx = 0;
    for (let i = 1; i < pathLengths.length; i++) {
      if (pathLengths[i] >= dist) {
        segIdx = i - 1;
        break;
      }
      segIdx = i - 1;
    }
    const segStart = pathLengths[segIdx];
    const segEnd = pathLengths[segIdx + 1] ?? pathLengths[segIdx];
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (dist - segStart) / segLen : 0;
    return new THREE.Vector3().lerpVectors(
      pathPoints[segIdx],
      pathPoints[segIdx + 1] ?? pathPoints[segIdx],
      Math.max(0, Math.min(1, t))
    );
  }

  dispose(): void {
    for (const lp of this.lineParticlesMap.values()) {
      this.parent.remove(lp.points);
      lp.points.geometry.dispose();
    }
    this.lineParticlesMap.clear();
  }
}
