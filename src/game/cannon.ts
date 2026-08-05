// 能量砲：充能式投射物武器（PLAN §3.3：充能 1.2 秒、80 傷加範圍傷害、彈藥上限 12）。
// 與其餘武器（pistol／shotgun／plasma）的「按住即連發」不同，能量砲是「按住累積充能、放開才
// 發射」：main.ts 逐幀呼叫 chargeTick()（input.firing 為 true 時）累積充能，偵測到放開（本幀
// input.firing 由 true 轉 false）時呼叫 releaseCharge()——未滿 CANNON_CHARGE_DURATION 秒即放開
// 視為取消，不耗彈、不發射；充滿放開才真正發射並扣彈。另提供 tryFireFull()：略過充能狀態機、
// 立即以「已充滿」的效果單次發射，供 window.__p96.fire() 這類「單次程式化觸發」的呼叫端使用
// （同 plasma.ts／weapons.ts 的 debug 相容慣例；main.ts 不會在真實輸入路徑呼叫本方法，
// 避免按住時每幀觸發造成瞬間打光全部彈藥，見 main.ts 主迴圈註解）。
//
// 命中判定延後至投射物實際命中時發生（同 plasma.ts 慣例）：本檔只回傳 spawnEvent，
// 由 main.ts 呼叫 game/projectiles.ts 的 ProjectileSystem.spawn() 建立實際投射物，並帶上
// splashRadius（M3 第三階段對 ProjectileSystem 的擴充，見該檔案）。

import type { Vec3 } from "../core/math.ts";
import { normalizeVec3 } from "../core/math.ts";
import { playCannonChargeStart, playCannonFire } from "../audio/synth.ts";

export const CANNON_CHARGE_DURATION = 1.2; // 秒（PLAN §3.3）
export const CANNON_DAMAGE = 80;
export const CANNON_MAGAZINE = 12;
export const CANNON_PROJECTILE_SPEED = 16; // m/s（本次派工規格）
export const CANNON_PROJECTILE_RADIUS = 0.3; // m（本次派工規格）
export const CANNON_SPLASH_RADIUS = 2.5; // m（PLAN §3.3：命中點 2.5m 範圍濺射）
/** 能源青（PLAN §5.1 #35E0FF），player 陣營投射物色（同 plasma.ts 慣例）。 */
export const CANNON_PROJECTILE_COLOR: readonly [number, number, number] = [0x35 / 255, 0xe0 / 255, 0xff / 255];

const HIT_MARKER_DURATION = 0.12; // 秒，同其餘武器慣例

export interface CannonSpawnEvent {
  pos: Vec3;
  /** 已正規化的射出方向（單位向量）。 */
  dir: Vec3;
  speed: number;
  damage: number;
  radius: number;
  splashRadius: number;
  faction: "player";
  color: readonly [number, number, number];
}

export interface CannonFireResult {
  fired: boolean;
  /** fired=true 時提供；fired=false 時為 null（充能未滿即放開＝取消，或彈藥不足）。 */
  spawnEvent: CannonSpawnEvent | null;
}

export class EnergyCannon {
  ammo = CANNON_MAGAZINE;
  private charging = false;
  private chargeElapsed = 0;
  private hitMarkerRemaining = 0;

  get hitMarkerActive(): boolean {
    return this.hitMarkerRemaining > 0;
  }

  get isCharging(): boolean {
    return this.charging;
  }

  /** 充能進度 0（剛開始）至 1（已充滿，可安全放開發射）；未充能時為 0。供 HUD 充能條讀取。 */
  get chargeProgress(): number {
    if (!this.charging) return 0;
    return Math.min(1, this.chargeElapsed / CANNON_CHARGE_DURATION);
  }

  get canFire(): boolean {
    return this.ammo > 0;
  }

  /** 每幀呼叫一次，遞減命中回饋計時器（同其餘武器慣例，與 chargeTick 分開呼叫，見 main.ts）。 */
  update(dt: number): void {
    this.hitMarkerRemaining = Math.max(0, this.hitMarkerRemaining - dt);
  }

  /**
   * 真實輸入路徑：本幀偵測到開火鍵按住（input.firing）時每幀呼叫一次。尚未開始充能且有彈藥
   * 才開始（觸發一次上升音調的充能音，見 audio/synth.ts）；已在充能中則單純累積時間。
   * 彈藥為 0 時不開始充能（避免空充能誤導玩家）。
   */
  chargeTick(dt: number): void {
    if (!this.charging) {
      if (this.ammo <= 0) return;
      this.charging = true;
      this.chargeElapsed = 0;
      playCannonChargeStart();
    }
    this.chargeElapsed += dt;
  }

  /**
   * 真實輸入路徑：本幀偵測到開火鍵放開（input.firing 由 true 轉 false）時呼叫一次。
   * 未在充能中（例如剛切換到本武器就放開）直接回傳 fired=false。充能未滿
   * CANNON_CHARGE_DURATION 秒即視為取消：不耗彈、不發射、不播音效（PLAN §3.3「未滿 1.2 秒
   * 放開＝取消不耗彈」）。充滿放開才真正發射並扣彈。
   */
  releaseCharge(origin: Vec3, direction: Vec3): CannonFireResult {
    if (!this.charging) return { fired: false, spawnEvent: null };
    const full = this.chargeElapsed >= CANNON_CHARGE_DURATION;
    this.charging = false;
    this.chargeElapsed = 0;
    if (!full) return { fired: false, spawnEvent: null };
    return this.fireNow(origin, direction);
  }

  /** 中止目前充能（不發射、不耗彈），供切離本武器時呼叫（見 game/inventory.ts switchTo）。 */
  cancelCharge(): void {
    this.charging = false;
    this.chargeElapsed = 0;
  }

  /**
   * 略過充能狀態機，立即以「已充滿」效果單次發射（見檔頭註解：供 debug／單次程式化觸發使用，
   * 不應在真實輸入路徑逐幀呼叫）。彈藥不足則回傳 fired=false。
   */
  tryFireFull(origin: Vec3, direction: Vec3): CannonFireResult {
    if (!this.canFire) return { fired: false, spawnEvent: null };
    this.charging = false;
    this.chargeElapsed = 0;
    return this.fireNow(origin, direction);
  }

  private fireNow(origin: Vec3, direction: Vec3): CannonFireResult {
    if (this.ammo <= 0) return { fired: false, spawnEvent: null };
    this.ammo -= 1;
    playCannonFire();
    return {
      fired: true,
      spawnEvent: {
        pos: { ...origin },
        dir: normalizeVec3(direction),
        speed: CANNON_PROJECTILE_SPEED,
        damage: CANNON_DAMAGE,
        radius: CANNON_PROJECTILE_RADIUS,
        splashRadius: CANNON_SPLASH_RADIUS,
        faction: "player",
        color: CANNON_PROJECTILE_COLOR,
      },
    };
  }

  /** 供呼叫端在收到本武器發射的投射物命中事件時觸發命中回饋（同 plasma.ts 慣例）。 */
  triggerHitMarker(): void {
    this.hitMarkerRemaining = HIT_MARKER_DURATION;
  }

  /** 重置為滿彈藥、清空充能與命中回饋（供死亡重生／重新開始使用）。 */
  reset(): void {
    this.ammo = CANNON_MAGAZINE;
    this.charging = false;
    this.chargeElapsed = 0;
    this.hitMarkerRemaining = 0;
  }
}
