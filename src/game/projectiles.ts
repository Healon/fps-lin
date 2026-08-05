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
import { addVec3, normalizeVec3, scaleVec3 } from "../core/math.ts";
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
        const died = nearestTarget.applyDamage(p.damage, p.dir);
        events.push({ faction: p.faction, target: nearestTarget, point: hitPoint, died });
        p.alive = false;
        continue;
      }

      if (nearestWallT !== null) {
        p.alive = false; // 消滅於牆面，不回報命中事件（無 target）。
        continue;
      }

      p.pos = addVec3(p.pos, scaleVec3(p.dir, stepDistance));
    }
    return events;
  }
}
