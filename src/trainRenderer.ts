import * as THREE from "three";
import type { RailLine } from "./stationRenderer";
import type { DelayManager } from "./delayManager";

// --- Timetable types ---

interface TimetableStop {
  short_code: string;
  departure_sec: number;
}

interface TimetableTrain {
  train_id: string;
  terminal: string;
  stops: TimetableStop[];
}

interface TimetableDirection {
  direction_id: number;
  station_sequence: string[];
  trains: TimetableTrain[];
}

interface TimetableLine {
  line_code: string;
  line_name: string;
  directions: TimetableDirection[];
}

interface TimetableFile {
  lines: TimetableLine[];
}

// --- Internal state ---

export interface TrainInfo {
  trainId: string;
  lineName: string;
  lineCode: string;
  terminal: string;
}

interface ActiveTrain {
  trainId: string;
  mesh: THREE.Mesh;
  stops: TimetableStop[];
  posMap: Map<string, THREE.Vector3>;
  info: TrainInfo;
}

const TIMETABLE_URLS = [
  "/data/tokyo_metro_timetable.json",
  "/data/toei_timetable.json",
  "/data/jr_timetable.json",
  "/data/private_railway_timetable.json",
  "/data/other_timetable.json",
];

const CONE_RADIUS = 0.008;
const CONE_HEIGHT = 0.025;
const CONE_SEGMENTS = 6;
const POOL_SIZE = 800;
const UP = new THREE.Vector3(0, 1, 0);

const DELAY_SCALE = 1.5;
const SHAKE_AMPLITUDE = 0.003;
const SHAKE_FREQUENCY = 12;

export class TrainRenderer {
  private lineMap = new Map<string, RailLine>();
  private timetableMap = new Map<string, TimetableLine>();
  private active = new Map<string, ActiveTrain>();
  private freePool: THREE.Mesh[] = [];
  private coneGeo: THREE.ConeGeometry;
  private materials = new Map<number, THREE.MeshBasicMaterial>();
  private parent: THREE.Object3D | null = null;
  private poolInitialized = false;
  private timetableLoaded = false;

  constructor() {
    this.coneGeo = new THREE.ConeGeometry(
      CONE_RADIUS,
      CONE_HEIGHT,
      CONE_SEGMENTS
    );
  }

  async load(parent: THREE.Object3D, railLines: RailLine[]): Promise<void> {
    this.parent = parent;

    // Return all active trains to pool
    for (const [key, train] of this.active) {
      train.mesh.visible = false;
      this.freePool.push(train.mesh);
      this.active.delete(key);
    }

    // Rebuild line index from scratch
    this.lineMap.clear();
    for (const rl of railLines) {
      this.lineMap.set(rl.lineCode, rl);
    }

    // Fetch timetables only once
    if (!this.timetableLoaded) {
      const files = await Promise.all(
        TIMETABLE_URLS.map((url) =>
          fetch(url).then((r) => r.json() as Promise<TimetableFile>)
        )
      );

      for (const file of files) {
        for (const line of file.lines) {
          this.timetableMap.set(line.line_code, line);
        }
      }
      this.timetableLoaded = true;
    }

    // Pre-allocate cone pool only once
    if (!this.poolInitialized) {
      for (let i = 0; i < POOL_SIZE; i++) {
        const mesh = new THREE.Mesh(this.coneGeo);
        mesh.visible = false;
        parent.add(mesh);
        this.freePool.push(mesh);
      }
      this.poolInitialized = true;
    }
  }

  update(simTimeSec: number, delayManager?: DelayManager): void {
    // Despawn trains that have finished
    for (const [key, train] of this.active) {
      const lastDep = train.stops[train.stops.length - 1].departure_sec;
      if (simTimeSec > lastDep + 30) {
        train.mesh.visible = false;
        this.freePool.push(train.mesh);
        this.active.delete(key);
      }
    }

    // Spawn and update trains
    for (const [lineCode, ttLine] of this.timetableMap) {
      const railLine = this.lineMap.get(lineCode);
      if (!railLine) continue;

      for (const dir of ttLine.directions) {
        for (const train of dir.trains) {
          const firstDep = train.stops[0].departure_sec;
          const lastDep = train.stops[train.stops.length - 1].departure_sec;

          // Not yet in service or already past
          if (simTimeSec < firstDep || simTimeSec > lastDep + 30) continue;

          const key = `${lineCode}:${train.train_id}`;

          if (!this.active.has(key)) {
            this.spawnTrain(key, train, railLine, ttLine.line_name);
          }

          const active = this.active.get(key);
          if (active) {
            this.updatePosition(active, simTimeSec, delayManager);
            if (delayManager) {
              const ratio = delayManager.getDelayRatio(lineCode, simTimeSec);
              if (ratio > 0) {
                const scale = 1 + (DELAY_SCALE - 1) * ratio;
                active.mesh.scale.setScalar(scale);
                const shake = Math.sin(simTimeSec * SHAKE_FREQUENCY) * SHAKE_AMPLITUDE * ratio;
                active.mesh.position.x += shake;
                active.mesh.position.z += shake * 0.7;
              } else {
                active.mesh.scale.setScalar(1);
              }
            }
          }
        }
      }
    }
  }

  private spawnTrain(
    key: string,
    train: TimetableTrain,
    railLine: RailLine,
    lineName: string
  ): void {
    if (this.freePool.length === 0) return; // pool exhausted

    const mesh = this.freePool.pop()!;

    // Set material (reuse per color)
    if (!this.materials.has(railLine.color)) {
      this.materials.set(
        railLine.color,
        new THREE.MeshBasicMaterial({ color: railLine.color })
      );
    }
    mesh.material = this.materials.get(railLine.color)!;
    mesh.visible = true;

    // Build position lookup from rail line stations
    const posMap = new Map<string, THREE.Vector3>();
    for (const st of railLine.stations) {
      posMap.set(st.shortCode, st.pos);
    }

    // Filter stops to only those with known positions
    const validStops = train.stops.filter((s) => posMap.has(s.short_code));
    if (validStops.length < 2) {
      // Not enough positions — return mesh to pool
      mesh.visible = false;
      this.freePool.push(mesh);
      return;
    }

    this.active.set(key, {
      trainId: train.train_id,
      mesh,
      stops: validStops,
      posMap,
      info: {
        trainId: train.train_id,
        lineName,
        lineCode: railLine.lineCode,
        terminal: train.terminal,
      },
    });
  }

  private updatePosition(train: ActiveTrain, simTimeSec: number, delayManager?: DelayManager): void {
    const { stops, posMap, mesh } = train;

    let effectiveTime = simTimeSec;
    if (delayManager) {
      const delay = delayManager.getDelay(train.info.lineCode, simTimeSec);
      effectiveTime = simTimeSec - delay;
    }

    // Find current segment: largest i where stops[i].departure_sec <= effectiveTime
    let segIdx = -1;
    for (let i = stops.length - 1; i >= 0; i--) {
      if (stops[i].departure_sec <= effectiveTime) {
        segIdx = i;
        break;
      }
    }

    // Before first stop — hold at first station
    if (segIdx < 0) {
      const pos = posMap.get(stops[0].short_code);
      if (pos) mesh.position.copy(pos);
      return;
    }

    // At last stop — hold position
    if (segIdx >= stops.length - 1) {
      const pos = posMap.get(stops[stops.length - 1].short_code);
      if (pos) mesh.position.copy(pos);
      return;
    }

    const stopA = stops[segIdx];
    const stopB = stops[segIdx + 1];
    // posMap is guaranteed valid since stops are filtered at spawn time
    const posA = posMap.get(stopA.short_code)!;
    const posB = posMap.get(stopB.short_code)!;

    // Linear interpolation
    const interval = stopB.departure_sec - stopA.departure_sec;
    const t = interval > 0
      ? (effectiveTime - stopA.departure_sec) / interval
      : 0;
    mesh.position.lerpVectors(posA, posB, Math.max(0, Math.min(1, t)));

    // Orient cone in direction of travel
    const dir = new THREE.Vector3().subVectors(posB, posA);
    if (dir.lengthSq() > 0.00001) {
      dir.normalize();
      // ConeGeometry points +Y by default; rotate to face travel direction
      if (Math.abs(dir.dot(UP)) > 0.9999) {
        // Near-vertical: use two-step rotation to avoid gimbal issues
        const tmpDir = new THREE.Vector3(0, 0, 1);
        const q1 = new THREE.Quaternion().setFromUnitVectors(UP, tmpDir);
        const q2 = new THREE.Quaternion().setFromUnitVectors(tmpDir, dir);
        mesh.quaternion.multiplyQuaternions(q2, q1);
      } else {
        mesh.quaternion.setFromUnitVectors(UP, dir);
      }
    }
  }

  /** Return count of currently visible trains (for debug display) */
  get activeCount(): number {
    return this.active.size;
  }

  /** Look up train info by mesh (for click/hover detection) */
  getTrainInfoByMesh(mesh: THREE.Object3D): TrainInfo | null {
    for (const train of this.active.values()) {
      if (train.mesh === mesh) return train.info;
    }
    return null;
  }

  /** Get all visible train meshes for raycasting */
  getVisibleMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const train of this.active.values()) {
      if (train.mesh.visible) meshes.push(train.mesh);
    }
    return meshes;
  }

  dispose(): void {
    this.coneGeo.dispose();
    for (const mat of this.materials.values()) {
      mat.dispose();
    }
    if (this.parent) {
      for (const mesh of this.freePool) {
        this.parent.remove(mesh);
      }
      for (const train of this.active.values()) {
        this.parent.remove(train.mesh);
      }
    }
    this.freePool.length = 0;
    this.active.clear();
  }
}
