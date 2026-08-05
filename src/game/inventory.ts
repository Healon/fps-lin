// 武器庫存：追蹤已擁有武器與目前裝備中的武器，統一彈藥加值／重置入口。
// 獨立成檔（而非併入 weapons.ts 或 shotgun.ts）以避免 weapons.ts ↔ shotgun.ts 的循環
// import（shotgun.ts 需要 import weapons.ts 的 raycastScene／HitKind）。
// main.ts 依 `current` 決定要驅動哪把武器的 update／tryFire；未擁有任何武器時 current 為
// null（撿取前不可開火，本次派工規格：區域 A 出生時赤手空拳）。
// M3 第二階段新增電漿步槍（game/plasma.ts）：WeaponId 沿用 weapons.ts 匯出的定義（不重複宣告，
// 避免兩處字面量聯合型別漂移不同步）。M3 第三階段新增能量砲（game/cannon.ts，充能式，見該檔
// 檔頭註解：真實輸入路徑的「按住充能、放開發射」不透過本類別的 update()／switchTo 驅動開火，
// 而由 main.ts 主迴圈另行呼叫 cannon.chargeTick()／releaseCharge()；switchTo 離開能量砲時
// 呼叫 cannon.cancelCharge() 中止進行中的充能，避免切槍後殘留充能狀態）。

import { PulsePistol, PULSE_PISTOL_MAGAZINE, type WeaponId } from "./weapons.ts";
import { ScatterShotgun, SCATTER_MAGAZINE } from "./shotgun.ts";
import { PlasmaRifle, PLASMA_RIFLE_MAGAZINE } from "./plasma.ts";
import { EnergyCannon, CANNON_MAGAZINE } from "./cannon.ts";

export type { WeaponId };

export class WeaponInventory {
  readonly pistol = new PulsePistol();
  readonly shotgun = new ScatterShotgun();
  readonly plasma = new PlasmaRifle();
  readonly cannon = new EnergyCannon();
  private currentId: WeaponId | null = null;
  private ownedState: Record<WeaponId, boolean> = { pistol: false, shotgun: false, plasma: false, cannon: false };

  get current(): WeaponId | null {
    return this.currentId;
  }

  owns(id: WeaponId): boolean {
    return this.ownedState[id];
  }

  /** 是否已擁有任一武器（供 HUD「尚未持有武器」引導提示判斷）。 */
  ownsAny(): boolean {
    return this.ownedState.pistol || this.ownedState.shotgun || this.ownedState.plasma || this.ownedState.cannon;
  }

  /** 給予武器（撿取成功時呼叫）：已擁有則回傳 false（不重複觸發）；新武器一律自動裝備上手。 */
  give(id: WeaponId): boolean {
    if (this.ownedState[id]) return false;
    this.ownedState[id] = true;
    this.currentId = id;
    return true;
  }

  /** 切換至已擁有的武器；未擁有或已是目前武器則回傳 false（未擁有的武器不可切，本次派工規格）。
   *  離開能量砲時中止其進行中的充能（不耗彈，見 game/cannon.ts cancelCharge）。 */
  switchTo(id: WeaponId): boolean {
    if (!this.ownedState[id] || this.currentId === id) return false;
    if (this.currentId === "cannon") this.cannon.cancelCharge();
    this.currentId = id;
    return true;
  }

  /** 目前武器的彈藥（無裝備武器時為 0）。 */
  ammo(): number {
    if (this.currentId === "pistol") return this.pistol.ammo;
    if (this.currentId === "shotgun") return this.shotgun.ammo;
    if (this.currentId === "plasma") return this.plasma.ammo;
    if (this.currentId === "cannon") return this.cannon.ammo;
    return 0;
  }

  /** 目前武器的彈藥上限（無裝備武器時為 0，供 HUD 顯示「目前 / 上限」）。 */
  magazine(): number {
    if (this.currentId === "pistol") return PULSE_PISTOL_MAGAZINE;
    if (this.currentId === "shotgun") return SCATTER_MAGAZINE;
    if (this.currentId === "plasma") return PLASMA_RIFLE_MAGAZINE;
    if (this.currentId === "cannon") return CANNON_MAGAZINE;
    return 0;
  }

  addAmmo(id: WeaponId, amount: number): void {
    if (id === "pistol") this.pistol.ammo = Math.min(PULSE_PISTOL_MAGAZINE, this.pistol.ammo + amount);
    else if (id === "shotgun") this.shotgun.ammo = Math.min(SCATTER_MAGAZINE, this.shotgun.ammo + amount);
    else if (id === "plasma") this.plasma.ammo = Math.min(PLASMA_RIFLE_MAGAZINE, this.plasma.ammo + amount);
    else this.cannon.ammo = Math.min(CANNON_MAGAZINE, this.cannon.ammo + amount);
  }

  /** 重置為初始狀態：無武器、無裝備（供死亡重生／重新開始使用，關卡從頭來過）。 */
  reset(): void {
    this.pistol.reset();
    this.shotgun.reset();
    this.plasma.reset();
    this.cannon.reset();
    this.ownedState = { pistol: false, shotgun: false, plasma: false, cannon: false };
    this.currentId = null;
  }

  /** 每幀呼叫：遞減各武器冷卻／命中回饋計時器。能量砲的充能本身（chargeTick／releaseCharge）
   *  由 main.ts 主迴圈依真實輸入按住／放開狀態另行驅動，不在此處統一呼叫（見類別頭註解）。 */
  update(dt: number): void {
    this.pistol.update(dt);
    this.shotgun.update(dt);
    this.plasma.update(dt);
    this.cannon.update(dt);
  }
}
