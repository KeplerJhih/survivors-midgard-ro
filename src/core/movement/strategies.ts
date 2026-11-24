import { dirsFromAngle, TAU, type Dir } from './directions';

/** 走位策略：給定已經過的毫秒數，回傳此刻要按住的方向鍵。純函式，方便測試。 */
export type Strategy = (elapsedMs: number) => Dir[];

export type MoveMode = 'none' | 'circle';

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

export function createStrategy(mode: MoveMode, opts: MoveOptions): Strategy {
  switch (mode) {
    case 'circle':
      return circle(opts.circlePeriodMs);
    case 'none':
      return none;
  }
}
