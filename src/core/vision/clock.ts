import type { Frame } from './frame';

/**
 * 遊戲時間是否停住：讀右上小地圖面板的「時間 mm:ss」數字字形（深色像素），比對前後是否相同。
 * 面板半透明，整塊亮度會隨背後畫面浮動（實測時間停住時平均差仍有 1~5），只比字形（亮度 < 90）才穩定：
 * 實機 MVP 戰中時間停在 08:00，4 秒內字形 XOR 皆為 0（56 個字形像素）。
 * 用途：MVP 入口傳送門開啟時時間會停住並等角色走進去（core/mvp_raid.gd state 'portal'）。
 */
export const CLOCK_REGION = { x0: 0.885, x1: 0.935, y0: 0.175, y1: 0.2 };

export function clockGlyph(f: Frame): Uint8Array {
  const X0 = Math.round(CLOCK_REGION.x0 * f.width);
  const X1 = Math.round(CLOCK_REGION.x1 * f.width);
  const Y0 = Math.round(CLOCK_REGION.y0 * f.height);
  const Y1 = Math.round(CLOCK_REGION.y1 * f.height);
  const out = new Uint8Array((X1 - X0) * (Y1 - Y0));
  let k = 0;
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const i = (y * f.width + x) * 4;
      out[k++] = 0.299 * f.data[i]! + 0.587 * f.data[i + 1]! + 0.114 * f.data[i + 2]! < 90 ? 1 : 0;
    }
  }
  return out;
}

export interface FreezeDetector {
  /** 傳入新字形；回傳時間是否已停住超過 freezeMs */
  update(glyph: Uint8Array | null, now: number): boolean;
}

export function createFreezeDetector(freezeMs = 3000, minPixels = 20, tolerance = 2): FreezeDetector {
  let prev: Uint8Array | null = null;
  let since = -1;
  return {
    update(g, now) {
      const on = g ? g.reduce((s, v) => s + v, 0) : 0;
      if (!g || on < minPixels || !prev || prev.length !== g.length) {
        prev = g;
        since = -1;
        return false;
      }
      let diff = 0;
      for (let i = 0; i < g.length; i++) diff += g[i]! ^ prev[i]!;
      prev = g;
      if (diff > tolerance) {
        since = -1;
        return false;
      }
      if (since < 0) since = now;
      return now - since >= freezeMs;
    },
  };
}
