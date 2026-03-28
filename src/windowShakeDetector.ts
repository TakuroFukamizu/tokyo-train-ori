export interface WindowShakeDetectorOptions {
  /** フレーム間変位のシェイク判定閾値 (px) — デフォルト 8 */
  shakeThreshold?: number;
  /** シェイク終了と判定するまでの静止フレーム数 — デフォルト 10 */
  settleFrames?: number;
}

export interface ShakeEventDetail {
  count: number;
  maxIntensity: number;
}

declare global {
  interface WindowEventMap {
    windowshake: CustomEvent<ShakeEventDetail>;
  }
}

export class WindowShakeDetector {
  private readonly shakeThreshold: number;
  private readonly settleFrames: number;

  private _running = false;
  private rafId: number | null = null;

  private mouseScreenX: number | null = null;
  private mouseScreenY: number | null = null;

  private prevX = 0;
  private prevY = 0;

  private shakeCount = 0;
  private maxIntensity = 0;
  private settleCounter = 0;

  private readonly _handleMouseMove: (e: MouseEvent) => void;

  constructor(options: WindowShakeDetectorOptions = {}) {
    this.shakeThreshold = options.shakeThreshold ?? 8;
    this.settleFrames = options.settleFrames ?? 10;

    this._handleMouseMove = (e: MouseEvent) => {
      this.mouseScreenX = e.screenX - e.clientX;
      this.mouseScreenY = e.screenY - e.clientY;
    };

    console.log("[WindowShakeDetector] initialized", {
      shakeThreshold: this.shakeThreshold,
      settleFrames: this.settleFrames,
    });
  }

  get running(): boolean {
    return this._running;
  }

  start(): void {
    if (this._running) {
      console.debug("[WindowShakeDetector] already running");
      return;
    }

    this.shakeCount = 0;
    this.maxIntensity = 0;
    this.settleCounter = 0;

    const pos = this._getWindowPos();
    this.prevX = pos.x;
    this.prevY = pos.y;

    window.addEventListener("mousemove", this._handleMouseMove);
    this.rafId = requestAnimationFrame(() => this._poll());
    this._running = true;
    console.log("[WindowShakeDetector] started");
  }

  stop(): void {
    if (!this._running) {
      console.debug("[WindowShakeDetector] not running");
      return;
    }

    window.removeEventListener("mousemove", this._handleMouseMove);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this._running = false;
    console.log("[WindowShakeDetector] stopped");
  }

  dispose(): void {
    this.stop();
    console.log("[WindowShakeDetector] disposed");
  }

  private _getWindowPos(): { x: number; y: number } {
    const wx = window.screenX;
    const wy = window.screenY;
    if (wx !== 0 || wy !== 0) return { x: wx, y: wy };
    if (this.mouseScreenX !== null) return { x: this.mouseScreenX, y: this.mouseScreenY! };
    return { x: 0, y: 0 };
  }

  private _poll(): void {
    const cur = this._getWindowPos();
    const dx = cur.x - this.prevX;
    const dy = cur.y - this.prevY;
    const intensity = Math.sqrt(dx * dx + dy * dy);

    if (intensity > this.shakeThreshold) {
      this.shakeCount += 1;
      this.maxIntensity = Math.max(this.maxIntensity, intensity);
      this.settleCounter = 0;
    } else if (this.shakeCount > 0) {
      this.settleCounter += 1;
      if (this.settleCounter >= this.settleFrames) {
        const count = this.shakeCount;
        const maxIntensity = this.maxIntensity;
        console.log("[WindowShakeDetector] SHAKE DETECTED!", { count, maxIntensity });
        window.dispatchEvent(
          new CustomEvent("windowshake", { detail: { count, maxIntensity } })
        );
        this.shakeCount = 0;
        this.maxIntensity = 0;
        this.settleCounter = 0;
      }
    }

    this.prevX = cur.x;
    this.prevY = cur.y;

    this.rafId = requestAnimationFrame(() => this._poll());
  }
}
