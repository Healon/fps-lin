// 遊戲狀態機：menu／playing／paused 三態，統一收斂所有狀態判斷。
// 收掉 HANDOFF 待辦第 3 條技術債：先前「開始畫面下遊戲邏輯已在跑」的根因是沒有單一狀態來源，
// 各處用散落的 boolean（是否已點擊、是否鎖定）自行猜測。改用本模組後，main.ts 的每幀更新
// 一律以 `gameState.state === "playing"` 為唯一閘門，不再散落判斷。
//
// 純邏輯，無 DOM／計時器依賴，可直接以 node:test 驗證轉移表（tests/unit/state.test.ts）。

export type GameState = "menu" | "playing" | "paused";

export type GameStateListener = (next: GameState, previous: GameState) => void;

export class GameStateMachine {
  private current: GameState = "menu";
  private readonly listeners: GameStateListener[] = [];

  get state(): GameState {
    return this.current;
  }

  onChange(listener: GameStateListener): void {
    this.listeners.push(listener);
  }

  /**
   * 直接切換到任意狀態，不檢查是否為「合法」轉移路徑。供 start／pause／resume／restart 等
   * 語意方法內部呼叫，也供 `window.__p96.debug.setState()` 測試用途直接呼叫（本次派工規格：
   * 「debug hooks 在任何狀態都直接生效，繞過狀態閘；真實輸入路徑則必須被狀態閘擋住」，
   * 本方法屬前者：呼叫端明確要求切態，不經真實輸入路徑）。相同狀態重複設定不觸發監聽者。
   */
  setState(next: GameState): void {
    if (next === this.current) return;
    const previous = this.current;
    this.current = next;
    for (const listener of this.listeners) listener(next, previous);
  }

  /** menu → playing：主選單「點擊開始」。 */
  start(): void {
    this.setState("playing");
  }

  /** playing → paused：Esc 或 pointer lock 退出。 */
  pause(): void {
    this.setState("paused");
  }

  /** paused → playing：暫停選單「繼續」。呼叫端負責重新要求 pointer lock（見 main.ts）。 */
  resume(): void {
    this.setState("playing");
  }

  /** paused → playing：暫停選單「重新開始」。呼叫端負責先從種子重建關卡狀態（見 main.ts）。 */
  restart(): void {
    this.setState("playing");
  }
}
