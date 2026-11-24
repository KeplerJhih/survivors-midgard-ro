import { dirsFromAngle, TAU, type Dir } from './directions';

/** 走位策略：給定已經過的毫秒數，回傳此刻要按住的方向鍵。純函式，方便測試。 */
export type Strategy = (elapsedMs: number) => Dir[];

export type MoveMode = 'none' | 'circle' | 'figure8';

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

export function createStrategy(mode: MoveMode, opts: MoveOptions): Strategy {
  switch (mode) {
    case 'circle':
      return circle(opts.circlePeriodMs);
    case 'figure8':
      return figure8(opts.circlePeriodMs);
    case 'none':
      return none;
  }
}
