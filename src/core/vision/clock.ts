import type { Frame } from './frame';

/**
 * 遊戲時間是否停住（MVP 入口傳送門開著時時間會停並等角色走進去；core/mvp_raid.gd state 'portal'）。
 *
 * 時鐘在右上小地圖面板內（「時間 mm:ss」），但 HUD 不是依畫面比例縮放（實機：978×685 時在 y≈0.19H，
 * 1080×734 時在 y≈0.22H），寫死座標會讀錯 → 自動定位：
 * 1. 右上區域的深色文字（亮度 < 75；面板半透明，只看深色字形才不受背景影響）按列切成文字帶
 * 2. 持續觀察各文字帶的變化，約每 1~2 秒變一次的那一帶就是時鐘並鎖定
 * 3. 鎖定的時鐘帶連續 freezeMs 不變 → 停住；未鎖定或時鐘帶消失 → 不判定（安全預設）
 */
export const SEARCH = { x0: 0.78, x1: 1, y0: 0.04, y1: 0.42 };

export interface TextBand {
  /** 帶的中心 y（像素，在搜尋區內） */
  y: number;
  mask: Uint8Array;
  on: number;
}

/** 切出搜尋區內的深色文字帶 */
export function textBands(f: Frame): TextBand[] {
  const X0 = Math.round(SEARCH.x0 * f.width);
  const X1 = Math.round(SEARCH.x1 * f.width);
  const Y0 = Math.round(SEARCH.y0 * f.height);
  const Y1 = Math.round(SEARCH.y1 * f.height);
  const w = X1 - X0;
  const dark = (x: number, y: number) => {
    const i = (y * f.width + x) * 4;
    return 0.299 * f.data[i]! + 0.587 * f.data[i + 1]! + 0.114 * f.data[i + 2]! < 75;
  };
  const rowCount: number[] = [];
  for (let y = Y0; y < Y1; y++) {
    let n = 0;
    for (let x = X0; x < X1; x++) if (dark(x, y)) n++;
    rowCount.push(n);
  }
  const bands: TextBand[] = [];
  let start = -1;
  for (let r = 0; r <= rowCount.length; r++) {
    const has = r < rowCount.length && rowCount[r]! >= 2 && rowCount[r]! < w * 0.6; // 排除整列深色（地圖圖塊等）
    if (has && start < 0) start = r;
    if (!has && start >= 0) {
      const h = r - start;
      if (h >= 3 && h <= 20) {
        const mask = new Uint8Array(h * w);
        let on = 0;
        for (let yy = 0; yy < h; yy++)
          for (let x = 0; x < w; x++) if (dark(X0 + x, Y0 + start + yy)) (mask[yy * w + x] = 1), on++;
        bands.push({ y: start + h / 2, mask, on });
      }
      start = -1;
    }
  }
  return bands;
}

const changed = (a: TextBand, b: TextBand) => {
  if (a.mask.length !== b.mask.length) return true;
  let d = 0;
  for (let i = 0; i < a.mask.length; i++) d += a.mask[i]! ^ b.mask[i]!;
  return d > Math.max(3, Math.max(a.on, b.on) * 0.1);
};

export interface ClockTracker {
  /** 每秒左右呼叫一次；回傳時間是否停住 */
  update(bands: TextBand[] | null, now: number): boolean;
  /** 已鎖定的時鐘帶 y（未鎖定為 null） */
  readonly locked: number | null;
}

export function createClockTracker(freezeMs = 3000, window = 6): ClockTracker {
  type Track = { y: number; last: TextBand; history: boolean[]; unchangedSince: number };
  let tracks: Track[] = [];
  let lockedY: number | null = null;
  let lostSince = -1;
  return {
    get locked() {
      return lockedY;
    },
    update(bands, now) {
      if (!bands) return false;
      const next: Track[] = [];
      for (const b of bands) {
        const t = tracks.find((tr) => Math.abs(tr.y - b.y) <= 2);
        if (!t) {
          next.push({ y: b.y, last: b, history: [], unchangedSince: now });
          continue;
        }
        const c = changed(t.last, b);
        const history = [...t.history, c].slice(-window);
        next.push({ y: b.y, last: b, history, unchangedSince: c ? now : t.unchangedSince });
      }
      tracks = next;
      // 鎖定：近 window 次中變化 40%~100%（約每 1~2 秒變一次）的帶
      if (lockedY === null) {
        const cand = tracks
          .filter((t) => t.history.length >= 4)
          .map((t) => ({ t, rate: t.history.filter(Boolean).length / t.history.length }))
          .filter((c) => c.rate >= 0.4)
          .sort((a, b) => b.rate - a.rate)[0];
        if (cand) lockedY = cand.t.y;
      }
      if (lockedY === null) return false;
      const clock = tracks.find((t) => Math.abs(t.y - lockedY!) <= 2);
      if (!clock) {
        if (lostSince < 0) lostSince = now;
        if (now - lostSince > 5000) lockedY = null; // 版面變了（換視窗大小、進城鎮）→ 重新定位
        return false;
      }
      lostSince = -1;
      return now - clock.unchangedSince >= freezeMs;
    },
  };
}
