/** 每 intervalMs 才重新計算一次，其餘時間回傳快取值（各種畫面取樣都很貴，不必每個 tick 做） */
export interface Throttled<T> {
  get(now: number): T;
  /** 最近一次 get 是否重新計算（新的取樣） */
  readonly fresh: boolean;
  reset(): void;
}

export function throttle<T>(intervalMs: number, compute: () => T, initial: T): Throttled<T> {
  let last = -Infinity;
  let value = initial;
  let fresh = false;
  return {
    get(now) {
      fresh = now - last >= intervalMs;
      if (fresh) {
        last = now;
        value = compute();
      }
      return value;
    },
    get fresh() {
      return fresh;
    },
    reset() {
      last = -Infinity;
      value = initial;
    },
  };
}
