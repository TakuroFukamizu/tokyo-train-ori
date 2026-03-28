export type SpeedMultiplier = 1 | 2 | 5 | 10;

export class TimeController {
  private simTimeSec: number;
  private speed: SpeedMultiplier = 1;
  private lastMs = performance.now();

  constructor() {
    const now = new Date();
    this.simTimeSec =
      now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  }

  /** Advance simulation clock by wall-clock delta * speed. Returns current sim time. */
  tick(): number {
    const now = performance.now();
    this.simTimeSec += ((now - this.lastMs) / 1000) * this.speed;
    this.lastMs = now;
    // Wrap at midnight (support after-midnight trains up to 26:00 = 93600)
    if (this.simTimeSec >= 93600) this.simTimeSec -= 86400;
    return this.simTimeSec;
  }

  setSpeed(s: SpeedMultiplier): void {
    this.speed = s;
  }

  get currentSpeed(): SpeedMultiplier {
    return this.speed;
  }

  get currentTime(): number {
    return this.simTimeSec;
  }

  /** Format sim time as HH:MM:SS for display */
  formatTime(): string {
    const h = Math.floor(this.simTimeSec / 3600) % 24;
    const m = Math.floor((this.simTimeSec % 3600) / 60);
    const s = Math.floor(this.simTimeSec % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
}
