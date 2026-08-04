// 射擊視覺效果的生命週期管理：viewmodel 後座、槍口閃光、彈道 tracer、命中火花。
// 全部是「觸發後 t=0 開始、超過存活時間即失效」的簡單計時模型，純邏輯無 DOM／GL 依賴，
// 可獨立單元測試；渲染層（main.ts／gfx/renderer.ts）只負責讀取這裡的狀態畫圖。
//
// 背景：Lin 實玩回饋「開槍看不見、命中看不見」，根因是先前完全沒有 viewmodel 與任何射擊
// 視覺特效（只有 HUD 準星閃與音效）。本檔補上後座／槍口閃光／tracer／火花四種效果的
// 純狀態機，main.ts 在 fire／hit 事件發生時呼叫 trigger()，每幀呼叫 update(dt)。

import type { Vec3 } from "../core/math.ts";

const RECOIL_DURATION = 0.08; // 秒，PLAN 需求：約 80ms 指數回彈
const RECOIL_ATTACK_FRACTION = 0.2; // 前 20% 時間為上升段（kick），其餘為指數衰減

/** viewmodel 後座：trigger() 後短暫 kick 再指數回彈，amount 供位移／角度偏移使用。 */
export class Recoil {
  private elapsed = RECOIL_DURATION; // 初始即視為已結束（amount=0）

  trigger(): void {
    this.elapsed = 0;
  }

  update(dt: number): void {
    this.elapsed += dt;
  }

  get active(): boolean {
    return this.elapsed < RECOIL_DURATION;
  }

  /** 0（無後座）至 1（後座峰值）。 */
  get amount(): number {
    if (this.elapsed >= RECOIL_DURATION) return 0;
    const t = this.elapsed / RECOIL_DURATION;
    if (t < RECOIL_ATTACK_FRACTION) return t / RECOIL_ATTACK_FRACTION;
    const decayT = (t - RECOIL_ATTACK_FRACTION) / (1 - RECOIL_ATTACK_FRACTION);
    return Math.exp(-decayT * 4);
  }
}

const MUZZLE_FLASH_DURATION = 0.05; // 秒，約 60fps 下 3 幀內（PLAN 需求：一至兩幀，留餘裕）

/** 槍口閃光：極短暫的一次性可見狀態（是否該畫出閃光 quad）。 */
export class MuzzleFlashEffect {
  private elapsed = MUZZLE_FLASH_DURATION;

  trigger(): void {
    this.elapsed = 0;
  }

  update(dt: number): void {
    this.elapsed += dt;
  }

  get active(): boolean {
    return this.elapsed < MUZZLE_FLASH_DURATION;
  }
}

export interface TracerData {
  origin: Vec3;
  hitPoint: Vec3;
}

const TRACER_LIFETIME = 0.06; // 秒

/** 彈道 tracer：槍口到命中點（或最大射程終點）的短暫可見線段。 */
export class TracerEffect {
  private elapsed = TRACER_LIFETIME;
  private data: TracerData | null = null;

  trigger(data: TracerData): void {
    this.data = data;
    this.elapsed = 0;
  }

  update(dt: number): void {
    this.elapsed += dt;
  }

  get active(): boolean {
    return this.elapsed < TRACER_LIFETIME && this.data !== null;
  }

  get current(): TracerData | null {
    return this.active ? this.data : null;
  }
}

const WEAPON_SWITCH_DURATION = 0.25; // 秒，PLAN 本次派工規格：viewmodel 快速下收上抬約 0.25 秒

/** 武器切換：viewmodel 下收再上抬的一次性動畫，dipAmount 為 0（原位）至 1（谷底）的曲線，
 *  兩端為 0、中點（t=0.5）達峰值，供 main.ts 疊加到 viewmodel 的 Y 偏移。 */
export class WeaponSwitchEffect {
  private elapsed = WEAPON_SWITCH_DURATION;

  trigger(): void {
    this.elapsed = 0;
  }

  update(dt: number): void {
    this.elapsed += dt;
  }

  get active(): boolean {
    return this.elapsed < WEAPON_SWITCH_DURATION;
  }

  get dipAmount(): number {
    if (this.elapsed >= WEAPON_SWITCH_DURATION) return 0;
    const t = this.elapsed / WEAPON_SWITCH_DURATION;
    return Math.sin(t * Math.PI);
  }
}

export type SparkKind = "enemy" | "wall";

export interface SparkData {
  point: Vec3;
  kind: SparkKind;
}

const SPARK_LIFETIME = 0.15; // 秒

/** 命中火花：命中點的短暫粒子爆發，kind 區分敵人（警示橘）／牆面（暗一階琥珀）。 */
export class SparkEffect {
  private elapsed = SPARK_LIFETIME;
  private data: SparkData | null = null;

  trigger(data: SparkData): void {
    this.data = data;
    this.elapsed = 0;
  }

  update(dt: number): void {
    this.elapsed += dt;
  }

  get active(): boolean {
    return this.elapsed < SPARK_LIFETIME && this.data !== null;
  }

  /** 0（剛觸發）至 1（即將消失），供渲染端做淡出。非 active 時回傳 1。 */
  get progress(): number {
    if (!this.active) return 1;
    return this.elapsed / SPARK_LIFETIME;
  }

  get current(): SparkData | null {
    return this.active ? this.data : null;
  }
}
