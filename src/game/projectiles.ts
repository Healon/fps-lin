// 共用投射物系統（M3 新增）：電漿步槍與首領戰的地基，本階段唯一實際呼叫端是射擊體
// （game/spitter.ts）的 enemy 陣營攻擊；player 陣營介面已備妥供未來電漿步槍等武器使用。
// 每發投射物對關卡 AABB 與目標 AABB 做「本幀移動距離」的掃掠（swept segment），先命中者算
// （同 game/weapons.ts raycastScene 慣例：牆與目標中取最近交點），命中或超過最大存活時間即
// 消滅。純邏輯，無 DOM／GL 依賴；渲染由 main.ts 讀取 instances 用現有 FX pipeline 畫出。
//
// 決定性備註：投射物移動是純物理外插（無 Math.random），不影響 PLAN §6.4 的「生成」決定性
// 範疇（那是關卡佈局層級），但仍遵守專案「不用 Math.random／Date」的通用禁令。
// 效能：物件池重用（覆寫既有已消滅槽位），避免每幀配置新物件（本次派工規格）。

import type { Vec3 } from "../core/math.ts";
import { addVec3, normalizeVec3, scaleVec3, subVec3, lengthVec3 } from "../core/math.ts";
import type { Aabb } from "../procgen/level/level.ts";
import { expandAabb, rayAabbIntersect } from "./collision.ts";

export type ProjectileFaction = "enemy" | "player";

export interface ProjectileSpawnOptions {
  pos: Vec3;
  /** 方向向量，不需為單位向量（內部會正規化）。 */
  dir: Vec3;
  speed: number;
  damage: number;
  /** 命中判定半徑（公尺）：對目標 AABB 外擴此值做為容差，同 weapons.ts AIM_ASSIST_MARGIN 精神。 */
  radius: number;
  faction: ProjectileFaction;
  color: readonly [number, number, number];
  /**
   * M3 第三階段新增（能量砲）：範圍傷害半徑（公尺），省略或 0 即維持既有「單體命中」行為
   * （逐位元相容，見 update() 內判斷）。設定後，消滅當下（命中目標或命中牆面皆算，牆面亦會
   * 引爆）改為對 targetQuery(faction) 回傳清單中，AABB 中心與命中點距離 ≤ splashRadius 的
   * 每一個目標各自套用一次 applyDamage(damage, dir)，取代原本「只傷最近單一目標」的路徑。
   */
  splashRadius?: number;
  /**
   * M3 第三階段新增：不透明的呼叫端自訂標籤（例如武器 id），ProjectileSystem 本身不解讀，
   * 僅原樣保留並於命中事件（ProjectileHitEvent.tag）回傳。用途：main.ts 的 player 陣營投射物
   * 武器（電漿步槍與能量砲）命中特效／音效不同，但兩者頂點色皆為能源青、無法從外觀區分，
   * 需要這個標籤才知道是哪把武器命中的（見主迴圈 projectileHits 迴圈）。
   */
  tag?: string;
}

/** 投射物可能命中的目標（Crawler／Spitter／Warden／玩家包裝皆可，結構相容即可，不要求
 *  繼承關係）。hitDirection（M3 第二階段新增，可選）供 Warden 的方向性減傷判定使用
 *  （見 game/warden.ts isFrontHit），其餘目標忽略此參數。 */
export interface ProjectileTarget {
  getAabb(): Aabb;
  /** 回傳值語意依目標而定：敵人代表致命一擊，玩家代表傷害是否生效（同 Combat.damagePlayer 慣例）。 */
  applyDamage(amount: number, hitDirection?: Vec3): boolean;
}

/** 依陣營回傳本幀可能被擊中的目標清單（enemy 陣營通常回傳僅含玩家的單一元素陣列；
 *  player 陣營回傳存活敵人清單）。呼叫端（main.ts）逐幀提供最新清單，本系統不快取。 */
export type ProjectileTargetQuery = (faction: ProjectileFaction) => ProjectileTarget[];

export interface ProjectileHitEvent {
  faction: ProjectileFaction;
  target: ProjectileTarget;
  point: Vec3;
  died: boolean;
  /** 原樣回傳 spawn 時的 ProjectileSpawnOptions.tag（見該欄位註解），未設定則為 undefined。 */
  tag?: string;
}

/** 供渲染端讀取的存活投射物快照（不含已消滅的槽位）。 */
export interface ProjectileInstance {
  pos: Vec3;
  faction: ProjectileFaction;
  color: readonly [number, number, number];
  /** 生成後經過的模擬秒數（決定性，dt 累計）。渲染端用於「生成後漸長」：
   *  電漿彈生成點在相機眼睛座標，第一幀貼臉的全尺寸暈光會炸成一團大閃光
   *  （Lin 實玩回饋「擊發時暈光太大」），以 age 漸長讓彈體離開臉部後才到全尺寸。 */
  age: number;
}

const MAX_LIFETIME_SECONDS = 3;

interface Projectile {
  pos: Vec3;
  dir: Vec3; // 單位向量
  speed: number;
  damage: number;
  radius: number;
  faction: ProjectileFaction;
  color: readonly [number, number, number];
  age: number;
  alive: boolean;
  /** M3 第三階段新增（能量砲濺射），見 ProjectileSpawnOptions.splashRadius；undefined 或 0
   *  代表沿用既有單體命中路徑。 */
  splashRadius?: number;
  /** 見 ProjectileSpawnOptions.tag。 */
  tag?: string;
}

export class ProjectileSystem {
  private readonly pool: Projectile[] = [];

  /** 發射一發投射物：優先覆寫既有已消滅槽位（物件池重用），找不到才 push 新槽位。 */
  spawn(opts: ProjectileSpawnOptions): void {
    const dir = normalizeVec3(opts.dir);
    const data: Projectile = {
      pos: { ...opts.pos },
      dir,
      speed: opts.speed,
      damage: opts.damage,
      radius: opts.radius,
      faction: opts.faction,
      color: opts.color,
      age: 0,
      alive: true,
      splashRadius: opts.splashRadius,
      tag: opts.tag,
    };
    const slot = this.pool.find((p) => !p.alive);
    if (slot) {
      Object.assign(slot, data);
    } else {
      this.pool.push(data);
    }
  }

  /** 存活中的投射物實例（供渲染端讀取）。 */
  get instances(): ProjectileInstance[] {
    return this.pool.filter((p) => p.alive).map((p) => ({ pos: { ...p.pos }, faction: p.faction, color: p.color, age: p.age }));
  }

  /** 目前存活數（供測試驗證物件池行為，不代表 pool 陣列總長度）。 */
  get aliveCount(): number {
    return this.pool.filter((p) => p.alive).length;
  }

  /** 目前池陣列總長度（供測試驗證重用行為：spawn 次數大於同時存活數時陣列不應無限增長）。 */
  get poolSize(): number {
    return this.pool.length;
  }

  /** 清空所有投射物（供死亡重生／重新開始使用，關卡從頭來過）。 */
  reset(): void {
    for (const p of this.pool) p.alive = false;
  }

  update(dt: number, colliders: readonly Aabb[], targetQuery: ProjectileTargetQuery): ProjectileHitEvent[] {
    const events: ProjectileHitEvent[] = [];
    for (const p of this.pool) {
      if (!p.alive) continue;

      p.age += dt;
      if (p.age > MAX_LIFETIME_SECONDS) {
        p.alive = false;
        continue;
      }

      const stepDistance = p.speed * dt;
      if (stepDistance <= 0) continue;

      let nearestWallT: number | null = null;
      for (const c of colliders) {
        const t = rayAabbIntersect(p.pos, p.dir, c);
        if (t !== null && t <= stepDistance && (nearestWallT === null || t < nearestWallT)) nearestWallT = t;
      }

      let nearestTarget: ProjectileTarget | null = null;
      let nearestTargetT: number | null = null;
      for (const target of targetQuery(p.faction)) {
        const expanded = expandAabb(target.getAabb(), p.radius);
        const t = rayAabbIntersect(p.pos, p.dir, expanded);
        if (t !== null && t <= stepDistance && (nearestTargetT === null || t < nearestTargetT)) {
          nearestTargetT = t;
          nearestTarget = target;
        }
      }

      // 先命中者算：目標交點需早於（或等於）牆面交點才算命中目標，否則視為打牆。
      if (nearestTarget !== null && (nearestWallT === null || nearestTargetT! <= nearestWallT)) {
        const hitPoint = addVec3(p.pos, scaleVec3(p.dir, nearestTargetT!));
        p.alive = false;
        if (p.splashRadius && p.splashRadius > 0) {
          events.push(...this.resolveSplash(p, hitPoint, targetQuery));
        } else {
          const died = nearestTarget.applyDamage(p.damage, p.dir);
          events.push({ faction: p.faction, target: nearestTarget, point: hitPoint, died, tag: p.tag });
        }
        continue;
      }

      if (nearestWallT !== null) {
        p.alive = false;
        // 濺射彈命中牆面仍應引爆（同榴彈慣例），對牆面附近目標造成範圍傷害；
        // 非濺射彈維持既有行為：消滅於牆面，不回報命中事件（無 target）。
        if (p.splashRadius && p.splashRadius > 0) {
          const hitPoint = addVec3(p.pos, scaleVec3(p.dir, nearestWallT));
          events.push(...this.resolveSplash(p, hitPoint, targetQuery));
        }
        continue;
      }

      p.pos = addVec3(p.pos, scaleVec3(p.dir, stepDistance));
    }
    return events;
  }

  /** 範圍傷害引爆（M3 第三階段新增，見 splashRadius 註解）：對 targetQuery(faction) 回傳清單中
   *  每個 AABB 中心與 impactPoint 距離 ≤ p.splashRadius 的目標各套用一次 applyDamage，
   *  逐一回傳命中事件（供呼叫端逐一觸發命中回饋／擊殺計數，同一般命中事件慣例）。 */
  private resolveSplash(p: Projectile, impactPoint: Vec3, targetQuery: ProjectileTargetQuery): ProjectileHitEvent[] {
    const events: ProjectileHitEvent[] = [];
    const radius = p.splashRadius ?? 0;
    for (const target of targetQuery(p.faction)) {
      const aabb = target.getAabb();
      const center: Vec3 = {
        x: (aabb.min.x + aabb.max.x) / 2,
        y: (aabb.min.y + aabb.max.y) / 2,
        z: (aabb.min.z + aabb.max.z) / 2,
      };
      if (lengthVec3(subVec3(center, impactPoint)) > radius) continue;
      const died = target.applyDamage(p.damage, p.dir);
      events.push({ faction: p.faction, target, point: impactPoint, died, tag: p.tag });
    }
    return events;
  }
}
