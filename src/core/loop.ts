// 主迴圈：requestAnimationFrame 驅動，dt 上限 50ms，分頁切換（visibilitychange）自動暫停。
// M2 第三階段新增：記錄單幀耗時峰值（PLAN §7.4「卡頓」量測），供 window.__p96.debug.maxFrameMs()
// 讀取。刻意記錄「夾限前」的原始幀間時間差，而非餵給模擬用的已夾限 dtSeconds——否則長時間
// 卡頓會被 MAX_DT_SECONDS 蓋掉看不出來，量測值需反映「使用者實際感受到的停頓」。
// 分頁切換恢復時 lastTimeMs 會先重置為 null 再於同一次 tick 內設回 nowMs（見 tick()），
// 故該次 tick 的原始差值恆為 0，不會把「切走又切回」誤記成一次巨大卡頓。

export type UpdateFn = (dtSeconds: number) => void;

const MAX_DT_SECONDS = 0.05;

export class GameLoop {
  private readonly update: UpdateFn;
  private rafHandle: number | null = null;
  private lastTimeMs: number | null = null;
  private running = false;
  private maxFrameMs = 0;

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
    const rawDeltaMs = nowMs - this.lastTimeMs;
    if (rawDeltaMs > this.maxFrameMs) this.maxFrameMs = rawDeltaMs;
    const dtSeconds = Math.min(rawDeltaMs / 1000, MAX_DT_SECONDS);
    this.lastTimeMs = nowMs;
    this.update(dtSeconds);
    this.scheduleNext();
  };

  /** 自 GameLoop 建構（實務上等同 __p96.ready）起算的單幀最大耗時（毫秒）。 */
  getMaxFrameMs(): number {
    return this.maxFrameMs;
  }

  /** 歸零重新量測（供測試在特定劇本段落前重置基準）。 */
  resetMaxFrameMs(): void {
    this.maxFrameMs = 0;
  }

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
