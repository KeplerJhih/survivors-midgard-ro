import { dirsFromAngle, TAU, type Dir } from './directions';

/** 走位策略：給定已經過的毫秒數，回傳此刻要按住的方向鍵。純函式，方便測試。 */
export type Strategy = (elapsedMs: number) => Dir[];

export type MoveMode = 'none' | 'circle' | 'figure8' | 'flower' | 'wander';

export interface MoveOptions {
  /** 繞一圈的時間 */
  circlePeriodMs: number;
}

/** 原地不動（只靠自動攻擊） */
export const none: Strategy = () => [];

/** 繞圈（8 方向近似成八角形） */
export function circle(periodMs: number): Strategy {
  return (t) => dirsFromAngle((t / periodMs) * TAU);
}

/**
 * 8 字形：逆時針繞一圈（圓心在起點上方）、再順時針繞一圈（上下鏡像，圓心在下方），兩圓相切於起點。
 * 每個完整圓的淨位移為 0，長時間掛機不會漂走；涵蓋範圍是繞圈的兩倍，經過更多掉落物
 * （遊戲撿取靠磁吸半徑 BASE_MAGNET=4，core/player.gd）。
 * 註：Lissajous 曲線經 8 方向量化後每週期會漂移約半個圖形大小（模擬實測），故不採用。
 */
export function figure8(periodMs: number): Strategy {
  return (t) => {
    const lap = Math.floor(t / periodMs);
    const a = ((t % periodMs) / periodMs) * TAU;
    return dirsFromAngle(lap % 2 === 0 ? a : -a);
  };
}

/** 黃金角：連續圈的出發方向不重複、分布最均勻 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * 花瓣：每圈都是從起點出發、回到起點的圓，但每圈的出發方向轉一個黃金角（137.5°）。
 * 所有經過起點的圓會掃過半徑 2R 的整個圓盤（R 為單圈半徑）：
 * - MVP 入口傳送門生成在角色 4~6.5 單位外、隨機方向，且一直等到角色踩進去
 *   （core/mvp_raid.gd _portal_point / state 'portal'）→ 掃過圓盤就會踩到
 * - 範圍內的掉落物也會被經過（磁吸半徑 4）
 * 每圈都是完整的圓，淨位移為 0，不會漂走。
 */
export function flower(periodMs: number): Strategy {
  return (t) => {
    const lap = Math.floor(t / periodMs);
    const a = ((t % periodMs) / periodMs) * TAU;
    return dirsFromAngle(lap * GOLDEN_ANGLE + a);
  };
}

/** 可重現的亂數（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 隨機走動：每段隨機挑 8 方向之一、走 0.25~0.6 個週期（例：週期 4 秒 → 1~2.5 秒）後換方向。
 * 內部估算位移（Input.get_vector 會正規化斜向），離起點超過 0.35 個週期的距離就改朝起點走（±45° 隨機），
 * 範圍與花瓣相近、不會漂走。時間倒退（重新啟動）時重置。
 */
export function wander(periodMs: number, seed = Math.floor(Math.random() * 2 ** 32)): Strategy {
  const radius = 0.35 * periodMs;
  let rand = rng(seed);
  let segStart = 0;
  let segEnd = 0;
  let heading = 0;
  let x = 0;
  let y = 0;
  const reset = () => {
    rand = rng(seed);
    segStart = 0;
    segEnd = 0;
    x = 0;
    y = 0;
  };
  const nextSegment = () => {
    if (Math.hypot(x, y) > radius) {
      heading = Math.atan2(-y, -x) + (rand() - 0.5) * (Math.PI / 2);
    } else {
      heading = Math.floor(rand() * 8) * (Math.PI / 4);
    }
    segStart = segEnd;
    segEnd = segStart + periodMs * (0.25 + rand() * 0.35);
  };
  const advance = (from: number, to: number) => {
    const d = dirsFromAngle(heading);
    const vx = (d.includes('right') ? 1 : 0) - (d.includes('left') ? 1 : 0);
    const vy = (d.includes('up') ? 1 : 0) - (d.includes('down') ? 1 : 0);
    const n = Math.hypot(vx, vy) || 1;
    x += (vx / n) * (to - from);
    y += (vy / n) * (to - from);
  };
  return (t) => {
    if (t < segStart) reset();
    while (t >= segEnd) {
      advance(segStart, segEnd);
      nextSegment();
    }
    return dirsFromAngle(heading);
  };
}

export function createStrategy(mode: MoveMode, opts: MoveOptions): Strategy {
  switch (mode) {
    case 'circle':
      return circle(opts.circlePeriodMs);
    case 'figure8':
      return figure8(opts.circlePeriodMs);
    case 'flower':
      return flower(opts.circlePeriodMs);
    case 'wander':
      return wander(opts.circlePeriodMs);
    case 'none':
      return none;
  }
}
