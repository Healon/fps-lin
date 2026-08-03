// 主迴圈：requestAnimationFrame 驅動，dt 上限 50ms，分頁切換（visibilitychange）自動暫停。

export type UpdateFn = (dtSeconds: number) => void;

const MAX_DT_SECONDS = 0.05;

export class GameLoop {
  private readonly update: UpdateFn;
  private rafHandle: number | null = null;
  private lastTimeMs: number | null = null;
  private running = false;

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.pauseInternal();
    } else if (this.running) {
      // 恢復時重置時間基準，避免補回一大段 dt 造成瞬移／穿模。
      this.lastTimeMs = null;
      this.scheduleNext();
    }
  };

  private readonly tick = (nowMs: number): void => {
    if (!this.running) return;
    if (this.lastTimeMs === null) {
      this.lastTimeMs = nowMs;
    }
    const dtSeconds = Math.min((nowMs - this.lastTimeMs) / 1000, MAX_DT_SECONDS);
    this.lastTimeMs = nowMs;
    this.update(dtSeconds);
    this.scheduleNext();
  };

  constructor(update: UpdateFn) {
    this.update = update;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  private scheduleNext(): void {
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private pauseInternal(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = null;
    if (!document.hidden) this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.pauseInternal();
  }

  dispose(): void {
    this.stop();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }
}
