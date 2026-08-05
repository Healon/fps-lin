// 雙態程序化音樂系統（PLAN §6.5）：工業電子加 dark ambient，步進序列器驅動合成器，無人聲、
// 零音訊檔。探索態＝低頻 drone（雙層 detuned 鋸齒過 lowpass，慢速濾波掃動）＋稀疏金屬敲擊＋
// 偶發低鳴；戰鬥態在同一顆 drone 之上疊加脈衝低音線（16 分音符）與較密的工業打擊層——
// 「不換曲只加層」：drone 全程不斷，只有 explore／combat 兩個「附加層」的音量交叉淡入淡出。
//
// 排程採 WebAudio 標準的 lookahead scheduler 模式（Chris Wilson "A Tale of Two Clocks"）：
// setInterval 只負責每 ~25ms 醒來一次，實際「這個音要幾秒後響」一律用 AudioContext.currentTime
// 換算與排程（AudioParam／source.start 皆吃絕對時間），不使用 Date、不使用 Math.random——
// pattern 本身是寫死的資料表（純決定性），需要的話才走 rng/rng.ts 的 stream()。
//
// 音樂與既有 SFX（audio/synth.ts）共用同一顆 AudioContext 與 masterGainNode
// （見 synth.ts 的 getSharedAudioContext／getSharedMasterGain／getSharedNoiseBuffer），
// 確保兩者受同一份設定系統主音量控制、時間基準一致。音樂本身另接一個「音樂匯流排」
// （MUSIC_BUS_GAIN＝0.5）再接上 masterGain，避免蓋過音效（本次派工規格）。

import { getSharedAudioContext, getSharedMasterGain, getSharedNoiseBuffer } from "./synth.ts";
import type { GameState } from "../game/state.ts";

export type MusicState = "off" | "explore" | "combat";

// ---- 排程常數（本次派工規格）----
const TICK_INTERVAL_MS = 25;
const LOOKAHEAD_SECONDS = 0.12;
const MUSIC_BPM = 60; // PLAN §6.5：探索態約 60 BPM 的稀疏感；戰鬥態疊層但不換速度。
export const HYSTERESIS_SECONDS = 3; // 全部敵人脫離戰鬥狀態後，滯後這麼久才回 explore。
export const CROSSFADE_SECONDS = 2; // explore／combat 附加層交叉淡入淡出時長。

const MUSIC_BUS_GAIN = 0.5; // 音樂子增益，避免蓋過音效（本次派工規格）。
const PAUSED_GAIN_RATIO = 0.3; // paused 時降至約 30%，不停止（本次派工規格）。
const START_FADE_IN_SECONDS = 0.3; // 音樂匯流排從 0 淡入，避免 drone 瞬間啟動的爆音。
const PAUSE_RAMP_SECONDS = 0.4; // playing↔paused 音量切換的平滑時間（非規格硬性數字，防 click）。
const MENU_STOP_FADE_SECONDS = 0.15; // 回主選單「停止」：快速淡出防爆音，非規格要求的 2 秒 crossfade。
const COMPLETE_FADE_SECONDS = 2; // 通關「淡出」（本次派工規格）。

// ---- Drone 音色參數 ----
const DRONE_BASE_FREQ = 55; // A1，低頻壓迫感
const DRONE_DETUNE_CENTS = 11; // 雙層失諧製造陰冷拍頻感，非和聲上的音程
const DRONE_FILTER_BASE_HZ = 220;
const DRONE_FILTER_Q = 0.7;
const DRONE_LFO_HZ = 0.045; // 極慢濾波掃動
const DRONE_LFO_DEPTH_HZ = 90;
const DRONE_GAIN = 0.4;

/** 一個音軌的步進 pattern：steps 長度即該 pattern 的 loop 長度（可與其他軌不同長度，
 *  只要全部軌道共用同一個「絕對步進索引」計算 `index % steps.length`，就能任意疊加或
 *  抽離某條軌道而不必重新對齊拍點——這正是「不換曲只加層」的排程基礎）。 */
export interface TrackPattern {
  readonly track: string;
  readonly steps: readonly boolean[];
}

export interface ScheduledStep {
  readonly stepIndex: number;
  readonly track: string;
  readonly time: number;
}

/** 16 分音符的秒數長度（給定 BPM）。 */
export function stepDurationSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

function buildSparsePattern(length: number, hitSteps: readonly number[]): boolean[] {
  const arr = new Array<boolean>(length).fill(false);
  for (const i of hitSteps) arr[i] = true;
  return arr;
}

// ---- Pattern 資料表（PLAN §6.5：影響玩法之外的內容，仍走「寫死決定性資料」而非亂數）----

/** 探索態：稀疏金屬敲擊，64 步（4 個 16 步小節）一次。 */
export const EXPLORE_PING_TRACK: TrackPattern = {
  track: "explore-ping",
  steps: buildSparsePattern(64, [0]),
};

/** 探索態：偶發低鳴，96 步（6 小節）一次，刻意與 ping 錯開避免同時觸發。 */
export const EXPLORE_RUMBLE_TRACK: TrackPattern = {
  track: "explore-rumble",
  steps: buildSparsePattern(96, [47]),
};

/** 戰鬥態：脈衝低音線，16 分音符 pattern（一個 16 步小節循環）。 */
export const COMBAT_BASS_TRACK: TrackPattern = {
  track: "combat-bass",
  steps: [true, false, true, false, false, true, false, true, true, false, true, false, false, true, false, false],
};

/** 戰鬥態：較密的工業打擊層（比 explore 的稀疏敲擊密集許多）。 */
export const COMBAT_PERC_TRACK: TrackPattern = {
  track: "combat-perc",
  steps: [true, false, true, true, false, true, true, false, true, false, true, true, false, true, true, false],
};

export const ALL_TRACK_PATTERNS: readonly TrackPattern[] = [
  EXPLORE_PING_TRACK,
  EXPLORE_RUMBLE_TRACK,
  COMBAT_BASS_TRACK,
  COMBAT_PERC_TRACK,
];

/**
 * 純函式排程核心：給定目前「尚未排程的下一步」（索引與絕對時間）與時間窗上限 horizonTime，
 * 把落在窗內的所有步進事件依序展開，回傳事件陣列與下一次呼叫應接續的 (index, time)。
 * 純函式、無副作用、無 AudioContext 依賴，供 tests/unit/music.test.ts 驗證決定性
 * （同輸入同輸出）與無重疊無遺漏（連續呼叫覆蓋一段窗口，應等於一次呼叫涵蓋整段窗口）。
 */
export function scheduleWindow(
  patterns: readonly TrackPattern[],
  bpm: number,
  nextStepIndex: number,
  nextStepTime: number,
  horizonTime: number,
): { events: ScheduledStep[]; nextStepIndex: number; nextStepTime: number } {
  const dur = stepDurationSeconds(bpm);
  const events: ScheduledStep[] = [];
  let idx = nextStepIndex;
  let time = nextStepTime;
  // guard：純函式健全性防呆（理論上 dur 恆為正、呼叫端不會給出退化窗口），避免任何輸入
  // 異常造成無窮迴圈，不代表預期會觸發。
  let guard = 0;
  const GUARD_LIMIT = 1_000_000;
  while (time < horizonTime && guard < GUARD_LIMIT) {
    for (const p of patterns) {
      const len = p.steps.length;
      if (len > 0 && p.steps[idx % len]) {
        events.push({ stepIndex: idx, track: p.track, time });
      }
    }
    idx += 1;
    time += dur;
    guard += 1;
  }
  return { events, nextStepIndex: idx, nextStepTime: time };
}

/** explore／combat 附加層的純邏輯狀態機：任一敵人 aggro 立即進 combat 並重置滯後計時；
 *  脫離後滯後 HYSTERESIS_SECONDS 秒才回 explore。純函式，供單元測試驗證滯後行為。 */
export interface HysteresisState {
  readonly layer: "explore" | "combat";
  readonly hysteresisRemaining: number;
}

export const INITIAL_HYSTERESIS_STATE: HysteresisState = { layer: "explore", hysteresisRemaining: 0 };

export function stepHysteresis(state: HysteresisState, anyAggro: boolean, dt: number): HysteresisState {
  if (anyAggro) {
    return { layer: "combat", hysteresisRemaining: HYSTERESIS_SECONDS };
  }
  if (state.layer === "combat") {
    const remaining = state.hysteresisRemaining - dt;
    if (remaining <= 0) return { layer: "explore", hysteresisRemaining: 0 };
    return { layer: "combat", hysteresisRemaining: remaining };
  }
  return state;
}

// ---- 個別音色（時間皆為絕對 AudioContext.currentTime 座標，供排程器於未來時間點觸發）----

function scheduleMetalPing(ctx: AudioContext, dest: AudioNode, time: number): void {
  const src = ctx.createBufferSource();
  src.buffer = getSharedNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(2600, time);
  filter.Q.value = 9;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.4, time + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.6);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(time);
  src.stop(time + 0.65);
}

function scheduleLowRumble(ctx: AudioContext, dest: AudioNode, time: number): void {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(42, time);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.3, time + 0.5);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 3.5);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 3.6);
}

function scheduleBassPulse(ctx: AudioContext, dest: AudioNode, time: number): void {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(55, time);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 320;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.5, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.2);
}

function scheduleIndustrialHit(ctx: AudioContext, dest: AudioNode, time: number): void {
  const src = ctx.createBufferSource();
  src.buffer = getSharedNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(1800, time);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.35, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(time);
  src.stop(time + 0.1);
}

/**
 * 雙態程序化音樂系統。呼叫慣例：
 * - `onGameStateChange(next)` 掛在 game/state.ts 的 GameStateMachine.onChange 上，一次涵蓋
 *   playing／paused／complete／menu 四態的音樂行為（本次派工規格）。
 * - `update(dt, anyAggro)` 每個模擬幀在 `gameState.state === "playing"` 時呼叫一次
 *   （與 main.ts 其餘系統同一道狀態閘，freeze 時傳 dt=0 即可與其他系統一致凍結）。
 * - AudioContext 不可用時（不支援／建立失敗）`start()` 直接靜音略過，不拋例外
 *   （PLAN §6.7「無音效裝置不當機」同一防禦精神）；`getState()` 此時恆回 "off"。
 */
export class MusicSystem {
  private ctx: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private exploreLayerGain: GainNode | null = null;
  private combatLayerGain: GainNode | null = null;

  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private droneLfo: OscillatorNode | null = null;

  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private nextStepIndex = 0;
  private nextStepTime = 0;
  private pendingStopAtTime: number | null = null;

  private started = false;
  private hysteresisState: HysteresisState = INITIAL_HYSTERESIS_STATE;
  private stateForDebug: MusicState = "off";

  /** 目前邏輯狀態（供 window.__p96.debug.musicState() 讀取）。狀態轉移即時生效，
   *  實際音訊的 gain ramp／淡出仍在背景以 AudioContext 時間軸進行（與 game/state.ts
   *  的 UI 顯隱切換同一慣例：邏輯狀態立即切換，動畫效果非同步跟上）。 */
  getState(): MusicState {
    return this.stateForDebug;
  }

  /** 建立音訊圖並開始播放（explore 起始層）。AudioContext 不可用時整個略過。冪等：
   *  已啟動時重複呼叫不做任何事（見 onGameStateChange 對「已啟動」的處理）。 */
  start(): void {
    if (this.started) return;
    const ctx = getSharedAudioContext();
    const master = getSharedMasterGain();
    if (!ctx || !master) return;
    this.ctx = ctx;

    const musicBus = ctx.createGain();
    musicBus.gain.setValueAtTime(0, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(MUSIC_BUS_GAIN, ctx.currentTime + START_FADE_IN_SECONDS);
    musicBus.connect(master);
    this.musicBus = musicBus;

    const exploreLayerGain = ctx.createGain();
    exploreLayerGain.gain.value = 1;
    exploreLayerGain.connect(musicBus);
    this.exploreLayerGain = exploreLayerGain;

    const combatLayerGain = ctx.createGain();
    combatLayerGain.gain.value = 0;
    combatLayerGain.connect(musicBus);
    this.combatLayerGain = combatLayerGain;

    this.startDrone(ctx, musicBus);

    this.nextStepIndex = 0;
    this.nextStepTime = ctx.currentTime + 0.05;
    this.pendingStopAtTime = null;
    this.hysteresisState = INITIAL_HYSTERESIS_STATE;
    this.stateForDebug = "explore";
    this.started = true;

    this.timerHandle = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.tick(); // 立即先跑一次，縮短第一批排程等到下個 interval 才出現的延遲。
  }

  /** 依 game/state.ts 的四態驅動音樂行為（本次派工規格，見檔頭類別註解）。 */
  onGameStateChange(next: GameState): void {
    if (next === "playing") {
      if (!this.started) {
        this.start();
      } else {
        this.pendingStopAtTime = null; // 取消先前 complete／menu 觸發的淡出停止（若有）。
        this.setPausedRatio(false);
      }
    } else if (next === "paused") {
      this.setPausedRatio(true);
    } else if (next === "complete") {
      this.beginStop(COMPLETE_FADE_SECONDS);
    } else if (next === "menu") {
      this.beginStop(MENU_STOP_FADE_SECONDS);
    }
  }

  /** 每模擬幀呼叫一次（僅限 playing 狀態，見類別註解）：推進 explore／combat 滯後狀態機，
   *  狀態改變時才觸發對應的附加層交叉淡入淡出。 */
  update(dt: number, anyAggro: boolean): void {
    if (!this.started) return;
    const prevLayer = this.hysteresisState.layer;
    this.hysteresisState = stepHysteresis(this.hysteresisState, anyAggro, dt);
    if (this.hysteresisState.layer !== prevLayer) {
      if (this.hysteresisState.layer === "combat") this.enterCombatLayer();
      else this.enterExploreLayer();
    }
  }

  private enterCombatLayer(): void {
    this.stateForDebug = "combat";
    if (this.exploreLayerGain) this.rampGain(this.exploreLayerGain.gain, 0, CROSSFADE_SECONDS);
    if (this.combatLayerGain) this.rampGain(this.combatLayerGain.gain, 1, CROSSFADE_SECONDS);
  }

  private enterExploreLayer(): void {
    this.stateForDebug = "explore";
    if (this.exploreLayerGain) this.rampGain(this.exploreLayerGain.gain, 1, CROSSFADE_SECONDS);
    if (this.combatLayerGain) this.rampGain(this.combatLayerGain.gain, 0, CROSSFADE_SECONDS);
  }

  /** paused↔playing 的音量切換（正常＝MUSIC_BUS_GAIN 音樂子增益，paused＝其 30%），
   *  音樂本身不停止、排程持續推進。 */
  private setPausedRatio(paused: boolean): void {
    if (!this.started || !this.musicBus) return;
    const target = paused ? MUSIC_BUS_GAIN * PAUSED_GAIN_RATIO : MUSIC_BUS_GAIN;
    this.rampGain(this.musicBus.gain, target, PAUSE_RAMP_SECONDS);
  }

  /** 淡出並排定實際停止時間點：邏輯狀態立即視為 off，音訊背景淡出，tick() 偵測到時間到才
   *  真正拆除音訊圖（見 tick() 尾端）。尚未啟動時直接視為已是 off，無需動作。 */
  private beginStop(fadeSeconds: number): void {
    this.stateForDebug = "off";
    if (!this.started || !this.ctx || !this.musicBus) return;
    this.rampGain(this.musicBus.gain, 0, fadeSeconds);
    this.pendingStopAtTime = this.ctx.currentTime + fadeSeconds;
  }

  /** 標準跨瀏覽器 AudioParam 交叉淡入淡出慣例：cancelScheduledValues 後以 setValueAtTime
   *  錨定目前值，再排一段新的 linearRamp，避免與前一段仍在進行中的 ramp 疊加造成的
   *  「先繼續舊方向一段時間才反向」問題（見設計筆記：直接疊加 ramp 事件會被前一個事件的
   *  時間點卡住，不會立即反應）。 */
  private rampGain(param: AudioParam, target: number, duration: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(target, now + duration);
  }

  private startDrone(ctx: AudioContext, dest: AudioNode): void {
    const osc1 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.value = DRONE_BASE_FREQ;

    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.value = DRONE_BASE_FREQ;
    osc2.detune.value = DRONE_DETUNE_CENTS;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = DRONE_FILTER_BASE_HZ;
    filter.Q.value = DRONE_FILTER_Q;

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = DRONE_LFO_HZ;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = DRONE_LFO_DEPTH_HZ;

    const droneGain = ctx.createGain();
    droneGain.gain.value = DRONE_GAIN;

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(droneGain);
    droneGain.connect(dest);

    osc1.start();
    osc2.start();
    lfo.start();

    this.droneOsc1 = osc1;
    this.droneOsc2 = osc2;
    this.droneLfo = lfo;
  }

  private stopDrone(): void {
    const now = this.ctx?.currentTime;
    for (const osc of [this.droneOsc1, this.droneOsc2, this.droneLfo]) {
      if (!osc) continue;
      try {
        if (now !== undefined) osc.stop(now);
        else osc.stop();
      } catch {
        // 已停止或已排程停止則忽略（非致命）。
      }
    }
    this.droneOsc1 = null;
    this.droneOsc2 = null;
    this.droneLfo = null;
  }

  /** 排程器 tick：展開 lookahead 窗口內的步進事件並實際觸發音色；同時檢查是否該執行
   *  先前 beginStop() 排定的硬停止時間點。 */
  private tick(): void {
    if (!this.ctx) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD_SECONDS;
    const result = scheduleWindow(ALL_TRACK_PATTERNS, MUSIC_BPM, this.nextStepIndex, this.nextStepTime, horizon);
    this.nextStepIndex = result.nextStepIndex;
    this.nextStepTime = result.nextStepTime;
    for (const ev of result.events) this.triggerTrack(ev.track, ev.time);

    if (this.pendingStopAtTime !== null && this.ctx.currentTime >= this.pendingStopAtTime) {
      this.hardStop();
    }
  }

  private triggerTrack(track: string, time: number): void {
    if (!this.ctx) return;
    switch (track) {
      case "explore-ping":
        if (this.exploreLayerGain) scheduleMetalPing(this.ctx, this.exploreLayerGain, time);
        break;
      case "explore-rumble":
        if (this.exploreLayerGain) scheduleLowRumble(this.ctx, this.exploreLayerGain, time);
        break;
      case "combat-bass":
        if (this.combatLayerGain) scheduleBassPulse(this.ctx, this.combatLayerGain, time);
        break;
      case "combat-perc":
        if (this.combatLayerGain) scheduleIndustrialHit(this.ctx, this.combatLayerGain, time);
        break;
    }
  }

  /** 實際拆除音訊圖與排程器（beginStop() 淡出完成後由 tick() 呼叫）。已排程但尚未觸發的
   *  獨立音符（noise burst／oscillator one-shot）不逐一追蹤停止：它們各自的 envelope 很短，
   *  且此時 musicBus 已淡到 0，即使尾音還在跑也聽不見，比逐一持有引用簡單且無副作用。 */
  private hardStop(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.stopDrone();
    for (const node of [this.musicBus, this.exploreLayerGain, this.combatLayerGain]) {
      if (!node) continue;
      try {
        node.disconnect();
      } catch {
        // 已斷開則忽略。
      }
    }
    this.musicBus = null;
    this.exploreLayerGain = null;
    this.combatLayerGain = null;
    this.pendingStopAtTime = null;
    this.started = false;
    this.hysteresisState = INITIAL_HYSTERESIS_STATE;
    this.stateForDebug = "off";
  }
}
