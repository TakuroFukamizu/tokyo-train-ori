import type { RailLine } from "./stationRenderer";

interface DelayEntry {
  delaySec: number;
  startTimeSec: number;
  maxDelaySec: number;
}

const BASE_DELAY_SEC = 300;
const RECOVERY_DURATION = 180;
const CASCADE_FACTOR = 0.5;
const CASCADE_MIN = 30;
const CASCADE_STEP_DELAY = 0.5;

export class DelayManager {
  private delays = new Map<string, DelayEntry>();
  private transferMap = new Map<string, Set<string>>();
  private railLines: RailLine[] = [];

  setRailLines(railLines: RailLine[]): void {
    this.railLines = railLines;
    this.transferMap.clear();

    const stationToLines = new Map<string, Set<string>>();
    for (const rl of railLines) {
      for (const st of rl.stations) {
        if (!stationToLines.has(st.stationName)) {
          stationToLines.set(st.stationName, new Set());
        }
        stationToLines.get(st.stationName)!.add(rl.lineCode);
      }
    }

    for (const lines of stationToLines.values()) {
      if (lines.size < 2) continue;
      const arr = [...lines];
      for (let i = 0; i < arr.length; i++) {
        if (!this.transferMap.has(arr[i])) {
          this.transferMap.set(arr[i], new Set());
        }
        for (let j = 0; j < arr.length; j++) {
          if (i !== j) this.transferMap.get(arr[i])!.add(arr[j]);
        }
      }
    }
  }

  triggerDelay(lineCode: string, simTimeSec: number): void {
    this.applyDelay(lineCode, BASE_DELAY_SEC, simTimeSec);

    const visited = new Set<string>([lineCode]);
    let frontier: { lineCode: string; delay: number }[] = [
      { lineCode, delay: BASE_DELAY_SEC },
    ];

    const cascadeStep = () => {
      const nextFrontier: { lineCode: string; delay: number }[] = [];
      for (const { lineCode: lc, delay } of frontier) {
        const neighbors = this.transferMap.get(lc);
        if (!neighbors) continue;
        const childDelay = delay * CASCADE_FACTOR;
        if (childDelay < CASCADE_MIN) continue;
        for (const neighbor of neighbors) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          this.applyDelay(neighbor, childDelay, simTimeSec);
          nextFrontier.push({ lineCode: neighbor, delay: childDelay });
        }
      }
      frontier = nextFrontier;
      if (frontier.length > 0) {
        setTimeout(cascadeStep, CASCADE_STEP_DELAY * 1000);
      }
    };

    if (this.transferMap.has(lineCode)) {
      setTimeout(cascadeStep, CASCADE_STEP_DELAY * 1000);
    }
  }

  private applyDelay(lineCode: string, delaySec: number, simTimeSec: number): void {
    const existing = this.delays.get(lineCode);
    if (existing && existing.delaySec > delaySec) return;
    this.delays.set(lineCode, {
      delaySec,
      startTimeSec: simTimeSec,
      maxDelaySec: delaySec,
    });
  }

  getDelay(lineCode: string, simTimeSec: number): number {
    const entry = this.delays.get(lineCode);
    if (!entry) return 0;

    const elapsed = simTimeSec - entry.startTimeSec;
    if (elapsed >= RECOVERY_DURATION) {
      this.delays.delete(lineCode);
      return 0;
    }

    const progress = elapsed / RECOVERY_DURATION;
    return entry.maxDelaySec * (1 - progress);
  }

  isDelayed(lineCode: string, simTimeSec: number): boolean {
    return this.getDelay(lineCode, simTimeSec) > 0;
  }

  getAllDelays(simTimeSec: number): Map<string, number> {
    const result = new Map<string, number>();
    for (const [lineCode] of this.delays) {
      const d = this.getDelay(lineCode, simTimeSec);
      if (d > 0) result.set(lineCode, d);
    }
    return result;
  }

  getDelayRatio(lineCode: string, simTimeSec: number): number {
    const entry = this.delays.get(lineCode);
    if (!entry) return 0;
    const d = this.getDelay(lineCode, simTimeSec);
    return d / entry.maxDelaySec;
  }

  getRailLines(): RailLine[] {
    return this.railLines;
  }
}
