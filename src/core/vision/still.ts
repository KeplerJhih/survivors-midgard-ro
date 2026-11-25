import type { Frame } from './frame';

/** 兩張同尺寸畫面中，亮度變化超過 16 的像素比例 */
export function changedRatio(a: Frame, b: Frame): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const n = a.width * a.height;
  let changed = 0;
  for (let i = 0; i < n * 4; i += 4) {
    const la = 0.299 * a.data[i]! + 0.587 * a.data[i + 1]! + 0.114 * a.data[i + 2]!;
    const lb = 0.299 * b.data[i]! + 0.587 * b.data[i + 1]! + 0.114 * b.data[i + 2]!;
    if (Math.abs(la - lb) > 16) changed++;
  }
  return changed / n;
}

export interface StillDetector {
  /** 每次取樣呼叫；回傳畫面開始靜止的時間，正在動或讀不到時回傳 null */
  update(frame: Frame | null, now: number): number | null;
}

/**
 * 畫面靜止偵測（與解析度、UI 版面無關）：遊戲跳出視窗時整個場景暫停，畫面幾乎不動；
 * 對局中角色、怪物、技能特效一直在動。變化像素 < ratio 視為沒動（容許視窗上的小動畫）。
 */
export function createStillDetector(ratio = 0.01): StillDetector {
  let prev: Frame | null = null;
  let since: number | null = null;
  return {
    update(frame, now) {
      if (!frame) {
        prev = null;
        since = null;
        return null;
      }
      // 取樣器會重用同一塊緩衝區 → 複製一份
      const copy: Frame = { width: frame.width, height: frame.height, data: Uint8ClampedArray.from(frame.data) };
      const still = prev !== null && changedRatio(prev, copy) < ratio;
      prev = copy;
      if (!still) since = null;
      else if (since === null) since = now;
      return since;
    },
  };
}
