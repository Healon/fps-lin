// 武器庫存：追蹤已擁有武器與目前裝備中的武器，統一彈藥加值／重置入口。
// 獨立成檔（而非併入 weapons.ts 或 shotgun.ts）以避免 weapons.ts ↔ shotgun.ts 的循環
// import（shotgun.ts 需要 import weapons.ts 的 raycastScene／HitKind）。
// main.ts 依 `current` 決定要驅動哪把武器的 update／tryFire；未擁有任何武器時 current 為
// null（撿取前不可開火，本次派工規格：區域 A 出生時赤手空拳）。

import { PulsePistol, PULSE_PISTOL_MAGAZINE } from "./weapons.ts";
import { ScatterShotgun, SCATTER_MAGAZINE } from "./shotgun.ts";

export type WeaponId = "pistol" | "shotgun";

export class WeaponInventory {
  readonly pistol = new PulsePistol();
  readonly shotgun = new ScatterShotgun();
  private currentId: WeaponId | null = null;
  private ownedState: Record<WeaponId, boolean> = { pistol: false, shotgun: false };

  get current(): WeaponId | null {
    return this.currentId;
  }

  owns(id: WeaponId): boolean {
    return this.ownedState[id];
  }

  /** 是否已擁有任一武器（供 HUD「尚未持有武器」引導提示判斷）。 */
  ownsAny(): boolean {
    return this.ownedState.pistol || this.ownedState.shotgun;
  }

  /** 給予武器（撿取成功時呼叫）：已擁有則回傳 false（不重複觸發）；新武器一律自動裝備上手。 */
  give(id: WeaponId): boolean {
    if (this.ownedState[id]) return false;
    this.ownedState[id] = true;
    this.currentId = id;
    return true;
  }

  /** 切換至已擁有的武器；未擁有或已是目前武器則回傳 false（未擁有的武器不可切，本次派工規格）。 */
  switchTo(id: WeaponId): boolean {
    if (!this.ownedState[id] || this.currentId === id) return false;
    this.currentId = id;
    return true;
  }

  /** 目前武器的彈藥（無裝備武器時為 0）。 */
  ammo(): number {
    if (this.currentId === "pistol") return this.pistol.ammo;
    if (this.currentId === "shotgun") return this.shotgun.ammo;
    return 0;
  }

  /** 目前武器的彈藥上限（無裝備武器時為 0，供 HUD 顯示「目前 / 上限」）。 */
  magazine(): number {
    if (this.currentId === "pistol") return PULSE_PISTOL_MAGAZINE;
    if (this.currentId === "shotgun") return SCATTER_MAGAZINE;
    return 0;
  }

  addAmmo(id: WeaponId, amount: number): void {
    if (id === "pistol") this.pistol.ammo = Math.min(PULSE_PISTOL_MAGAZINE, this.pistol.ammo + amount);
    else this.shotgun.ammo = Math.min(SCATTER_MAGAZINE, this.shotgun.ammo + amount);
  }

  /** 重置為初始狀態：無武器、無裝備（供死亡重生／重新開始使用，關卡從頭來過）。 */
  reset(): void {
    this.pistol.reset();
    this.shotgun.reset();
    this.ownedState = { pistol: false, shotgun: false };
    this.currentId = null;
  }

  update(dt: number): void {
    this.pistol.update(dt);
    this.shotgun.update(dt);
  }
}
