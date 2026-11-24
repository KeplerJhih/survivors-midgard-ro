import type { Frame } from './frame';
import { cx, cy, rh, rw, type Region } from './layout';

/**
 * 讀暫停選單（Esc）的勾選框：依遊戲程式固定順序為 [隨機選擇][累積強化][累積寶箱]（ui/menus.gd 的 checks；合作模式無累積寶箱）。
 * 結構：勾選框那排在寬按鈕「繼續」正上方（約 0.011~0.058H）；三組「框＋標籤」之間空隙大、標籤字距小。
 * 狀態：未勾＝一段寬的灰色方塊；已勾＝深色勾號（實機：未勾 G408-419、勾後 K613-619，1080×734）。
 */
export interface PauseToggle {
  x: number;
  y: number;
  checked: boolean;
}

export interface PauseMenu {
  /** 「繼續」按鈕中心 */
  resume: { x: number; y: number };
  /** 依序：隨機選擇、累積強化、累積寶箱 */
  toggles: PauseToggle[];
}

export function readPauseMenu(f: Frame, regions: Region[]): PauseMenu | null {
  const resume = regions
    // 實機「繼續」寬 48%、長寬比 20.4，略超過 button 分類上限 → 也接受高填滿的寬條
    .filter((r) => (r.kind === 'button' || (r.fill >= 0.8 && rh(r) >= 0.025 && rh(r) <= 0.09)) && rw(r) >= 0.3 && Math.abs(cx(r) - 0.5) < 0.05 && cy(r) > 0.4)
    .sort((a, b) => rw(b) - rw(a))[0];
  if (!resume) return null;
  const W = f.width;
  const H = f.height;
  const Y0 = Math.round((resume.y0 - 0.058) * H);
  const Y1 = Math.round((resume.y0 - 0.011) * H);
  const X0 = Math.round(resume.x0 * W);
  const X1 = Math.round(resume.x1 * W);
  if (Y0 < 0 || Y1 <= Y0) return null;
  const rows = Y1 - Y0;
  type Seg = { t: 'G' | 'K'; x0: number; x1: number };
  const segs: Seg[] = [];
  for (let x = X0; x < X1; x++) {
    let g = 0;
    let k = 0;
    for (let y = Y0; y < Y1; y++) {
      const i = (y * W + x) * 4;
      const r = f.data[i]!, gg = f.data[i + 1]!, b = f.data[i + 2]!;
      const l = 0.299 * r + 0.587 * gg + 0.114 * b;
      const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
      if (l < 95) k++;
      else if (l >= 110 && l < 180 && sat < 30) g++;
    }
    const t = g >= Math.max(3, rows * 0.2) ? 'G' : k >= 1 ? 'K' : null;
    if (!t) continue;
    const last = segs[segs.length - 1];
    if (last && last.t === t && last.x1 === x - 1) last.x1 = x;
    else segs.push({ t, x0: x, x1: x });
  }
  // 依大空隙分組（組間 > 2% 寬，標籤字距遠小於此）
  const groups: Seg[][] = [];
  for (const s of segs) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    if (!g || !prev || s.x0 - prev.x1 > 0.02 * W) groups.push([s]);
    else g.push(s);
  }
  // 合作模式沒有「累積寶箱」→ 只有 2 組
  if (groups.length < 2 || groups.length > 3) return null;
  const toggles = groups.map((g) => {
    const first = g[0]!;
    const width = first.x1 - first.x0 + 1;
    return {
      x: (first.x0 + first.x1 + 1) / 2 / W,
      y: (Y0 + Y1) / 2 / H,
      checked: !(first.t === 'G' && width >= 0.006 * W),
    };
  });
  return { resume: { x: cx(resume), y: cy(resume) }, toggles };
}
