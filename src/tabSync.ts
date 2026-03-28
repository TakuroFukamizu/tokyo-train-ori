type TabChangeCallback = (tabCount: number, tabIndex: number) => void;
type SpeedChangeCallback = (speed: number) => void;

interface TabMessage {
  type: "join" | "announce" | "heartbeat" | "leave" | "speed";
  id: string;
  speed?: number;
}

const CHANNEL_NAME = "ori-tab-sync";
const HEARTBEAT_INTERVAL = 2000;
const TIMEOUT = 4000;

export class TabSync {
  private id = crypto.randomUUID();
  private channel: BroadcastChannel;
  private peers = new Map<string, number>(); // id -> last seen timestamp
  private heartbeatTimer: number | null = null;
  private cleanupTimer: number | null = null;
  private onChange: TabChangeCallback;
  private onSpeedChange: SpeedChangeCallback | null = null;
  private lastTabCount = -1;
  private lastTabIndex = -1;

  constructor(onChange: TabChangeCallback, onSpeedChange?: SpeedChangeCallback) {
    this.onChange = onChange;
    this.onSpeedChange = onSpeedChange ?? null;
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (e: MessageEvent<TabMessage>) =>
      this.handleMessage(e.data);

    // Register self
    this.peers.set(this.id, Date.now());

    // Announce join
    this.channel.postMessage({ type: "join", id: this.id });

    // Start heartbeat
    this.heartbeatTimer = window.setInterval(() => {
      this.peers.set(this.id, Date.now());
      this.channel.postMessage({ type: "heartbeat", id: this.id });
    }, HEARTBEAT_INTERVAL);

    // Start cleanup timer
    this.cleanupTimer = window.setInterval(() => {
      this.cleanupStale();
    }, HEARTBEAT_INTERVAL);

    // Leave on unload
    window.addEventListener("beforeunload", this.handleUnload);

    // Notify initial state
    this.notifyIfChanged();
  }

  private handleMessage(msg: TabMessage): void {
    switch (msg.type) {
      case "join":
        this.peers.set(msg.id, Date.now());
        this.channel.postMessage({ type: "announce", id: this.id });
        this.notifyIfChanged();
        break;
      case "announce":
      case "heartbeat":
        this.peers.set(msg.id, Date.now());
        this.notifyIfChanged();
        break;
      case "leave":
        this.peers.delete(msg.id);
        this.notifyIfChanged();
        break;
      case "speed":
        if (msg.speed != null && this.onSpeedChange) {
          this.onSpeedChange(msg.speed);
        }
        break;
    }
  }

  private cleanupStale(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, lastSeen] of this.peers) {
      if (id !== this.id && now - lastSeen > TIMEOUT) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.notifyIfChanged();
  }

  private notifyIfChanged(): void {
    const ids = [...this.peers.keys()].sort();
    const tabCount = ids.length;
    const tabIndex = ids.indexOf(this.id);

    if (tabCount !== this.lastTabCount || tabIndex !== this.lastTabIndex) {
      this.lastTabCount = tabCount;
      this.lastTabIndex = tabIndex;
      this.onChange(tabCount, tabIndex);
    }
  }

  private handleUnload = (): void => {
    this.channel.postMessage({ type: "leave", id: this.id });
  };

  broadcastSpeed(speed: number): void {
    this.channel.postMessage({ type: "speed", id: this.id, speed });
  }

  destroy(): void {
    window.removeEventListener("beforeunload", this.handleUnload);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    if (this.cleanupTimer !== null) clearInterval(this.cleanupTimer);
    this.channel.postMessage({ type: "leave", id: this.id });
    this.channel.close();
  }
}
