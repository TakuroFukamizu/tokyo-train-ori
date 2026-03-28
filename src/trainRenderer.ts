import * as THREE from "three";
import type { RailLine } from "./stationRenderer";

// --- Timetable types ---

interface TimetableStop {
  short_code: string;
  departure_sec: number;
}

interface TimetableTrain {
  train_id: string;
  stops: TimetableStop[];
}

interface TimetableDirection {
  direction_id: number;
  station_sequence: string[];
  trains: TimetableTrain[];
}

interface TimetableLine {
  line_code: string;
  directions: TimetableDirection[];
}

interface TimetableFile {
  lines: TimetableLine[];
}

// --- Internal state ---

interface ActiveTrain {
  trainId: string;
  mesh: THREE.Mesh;
  stops: TimetableStop[];
  posMap: Map<string, THREE.Vector3>;
}

const TIMETABLE_URLS = [
  "/data/tokyo_metro_timetable.json",
  "/data/toei_timetable.json",
  "/data/jr_yamanote_timetable.json",
];

const CONE_RADIUS = 0.008;
const CONE_HEIGHT = 0.025;
const CONE_SEGMENTS = 6;
const POOL_SIZE = 500;
const UP = new THREE.Vector3(0, 1, 0);

export class TrainRenderer {
  private lineMap = new Map<string, RailLine>();
  private timetableMap = new Map<string, TimetableLine>();
  private active = new Map<string, ActiveTrain>();
  private freePool: THREE.Mesh[] = [];
  private coneGeo: THREE.ConeGeometry;
  private materials = new Map<number, THREE.MeshBasicMaterial>();
  private parent: THREE.Object3D | null = null;

  constructor() {
    this.coneGeo = new THREE.ConeGeometry(
      CONE_RADIUS,
      CONE_HEIGHT,
      CONE_SEGMENTS
    );
  }

  async load(parent: THREE.Object3D, railLines: RailLine[]): Promise<void> {
    this.parent = parent;

    // Index rail lines
    for (const rl of railLines) {
      this.lineMap.set(rl.lineCode, rl);
    }

    // Fetch all timetables in parallel
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

    // Pre-allocate cone pool
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(this.coneGeo);
      mesh.visible = false;
      parent.add(mesh);
      this.freePool.push(mesh);
    }
  }

  update(simTimeSec: number): void {
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
            this.spawnTrain(key, train, railLine);
          }

          const active = this.active.get(key);
          if (active) {
            this.updatePosition(active, simTimeSec);
          }
        }
      }
    }
  }

  private spawnTrain(
    key: string,
    train: TimetableTrain,
    railLine: RailLine
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
    });
  }

  private updatePosition(train: ActiveTrain, simTimeSec: number): void {
    const { stops, posMap, mesh } = train;

    // Find current segment: largest i where stops[i].departure_sec <= simTimeSec
    let segIdx = -1;
    for (let i = stops.length - 1; i >= 0; i--) {
      if (stops[i].departure_sec <= simTimeSec) {
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
      ? (simTimeSec - stopA.departure_sec) / interval
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
