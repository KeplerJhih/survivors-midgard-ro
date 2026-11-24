import type { Frame } from './frame';

/**
 * 版面解析：只用亮度與幾何結構（不靠特定顏色）找出畫面上的 UI 區塊。
 * 1. 亮度梯度 → 邊緣（面板/按鈕/卡片的外框、文字筆畫）
 * 2. 非邊緣且夠亮的像素做連通 → 一塊塊均勻的淺色區域
 * 3. 依外框大小、長寬比、填滿率分類為 panel / button / card
 * 座標皆以 0~1 表示（相對畫面寬高）。
 */
export type RegionKind = 'panel' | 'button' | 'card' | 'other';

export interface Region {
  kind: RegionKind;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 區域像素數 / 外框面積 */
  fill: number;
  /** 平均亮度 0~255 */
  luma: number;
}

export const cx = (r: Region) => (r.x0 + r.x1) / 2;
export const cy = (r: Region) => (r.y0 + r.y1) / 2;
export const rw = (r: Region) => r.x1 - r.x0;
export const rh = (r: Region) => r.y1 - r.y0;

export interface LayoutOptions {
  /** 亮度梯度門檻（相鄰像素差） */
  edge: number;
  /** 區域最低平均亮度（UI 面板都是淺色底，不限定色相） */
  minLuma: number;
}

const DEFAULTS: LayoutOptions = { edge: 18, minLuma: 175 };

export function lumaOf(f: Frame): Float32Array {
  const out = new Float32Array(f.width * f.height);
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.299 * f.data[i * 4]! + 0.587 * f.data[i * 4 + 1]! + 0.114 * f.data[i * 4 + 2]!;
  }
  return out;
}

export function classify(r: Omit<Region, 'kind'>, aspect: number): RegionKind {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const area = w * h;
  // 按鈕：扁長、高度約 2.5~9% 畫面（以寬度比例換算長寬比）。
  // 小按鈕裡文字佔比高，填滿率只有 0.37~0.45（實機：任務視窗 [先不要][我來幫忙！]）→ 門檻放寬到 0.3
  const ratio = (w * aspect) / h;
  if (r.fill >= 0.3 && h >= 0.025 && h <= 0.09 && ratio >= 1.6 && ratio <= 20 && w <= 0.7) return 'button';
  if (r.fill < 0.45) return 'other';
  // 卡片：直立的高矩形
  if (h >= 0.3 && ratio >= 0.35 && ratio <= 0.95) return 'card';
  if (area >= 0.02) return 'panel';
  return 'other';
}

export function parseLayout(f: Frame, opts: Partial<LayoutOptions> = {}): Region[] {
  const { edge, minLuma } = { ...DEFAULTS, ...opts };
  const W = f.width;
  const H = f.height;
  const L = lumaOf(f);
  // 可通行像素：夠亮、且與右/下鄰居亮度差小（不是邊緣）
  const open = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = L[i]!;
      if (v < minLuma) continue;
      const dx = x + 1 < W ? Math.abs(v - L[i + 1]!) : 0;
      const dy = y + 1 < H ? Math.abs(v - L[i + W]!) : 0;
      const dxl = x > 0 ? Math.abs(v - L[i - 1]!) : 0;
      const dyu = y > 0 ? Math.abs(v - L[i - W]!) : 0;
      if (Math.max(dx, dy, dxl, dyu) < edge) open[i] = 1;
    }
  }
  const seen = new Uint8Array(W * H);
  const regions: Region[] = [];
  const minPixels = Math.max(12, W * H * 0.0004);
  const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!open[s] || seen[s]) continue;
    seen[s] = 1;
    stack.push(s);
    let n = 0, sum = 0, minX = W, maxX = 0, minY = H, maxY = 0;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % W;
      const y = (j / W) | 0;
      n++;
      sum += L[j]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && open[j - 1] && !seen[j - 1]) (seen[j - 1] = 1), stack.push(j - 1);
      if (x < W - 1 && open[j + 1] && !seen[j + 1]) (seen[j + 1] = 1), stack.push(j + 1);
      if (y > 0 && open[j - W] && !seen[j - W]) (seen[j - W] = 1), stack.push(j - W);
      if (y < H - 1 && open[j + W] && !seen[j + W]) (seen[j + W] = 1), stack.push(j + W);
    }
    if (n < minPixels) continue;
    const box = {
      x0: minX / W,
      y0: minY / H,
      x1: (maxX + 1) / W,
      y1: (maxY + 1) / H,
      fill: n / ((maxX - minX + 1) * (maxY - minY + 1)),
      luma: sum / n,
    };
    regions.push({ kind: classify(box, W / H), ...box });
  }
  return mergeStacked(regions, W / H);
}

/**
 * 合併「左右範圍幾乎相同、上下緊貼」的區塊（例如卡片的標題列與內容被分隔線切開）。
 * 實機：升級卡未選取時標題與內容分成兩塊（標題被誤認為按鈕），選取中的卡則是一整塊 → 高度不一、分不到同一排。
 */
export function mergeStacked(regions: Region[], aspect: number, tol = 0.015, gap = 0.02): Region[] {
  const list = regions.map((r) => ({ ...r, n: r.fill * rw(r) * rh(r) }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = list[i]!;
        const b = list[j]!;
        const sameSpan = Math.abs(a.x0 - b.x0) <= tol && Math.abs(a.x1 - b.x1) <= tol;
        const stacked = b.y0 >= a.y1 - 0.005 && b.y0 - a.y1 <= gap;
        if (!sameSpan || !stacked || rw(a) < 0.05) continue;
        const box = {
          x0: Math.min(a.x0, b.x0),
          x1: Math.max(a.x1, b.x1),
          y0: a.y0,
          y1: b.y1,
          luma: (a.luma * a.n + b.luma * b.n) / (a.n + b.n),
        };
        const n = a.n + b.n;
        const fill = n / ((box.x1 - box.x0) * (box.y1 - box.y0));
        const next = { ...box, fill, n, kind: classify({ ...box, fill }, aspect) };
        list.splice(Math.max(i, j), 1);
        list.splice(Math.min(i, j), 1, next);
        merged = true;
        break outer;
      }
    }
  }
  return list.map(({ n: _n, ...r }) => r);
}

/** 依 y 中心分組成「一排」（高度相近、垂直對齊），每排依 x 排序 */
export function rows(items: Region[], tol = 0.02, heightTol = tol * 1.5): Region[][] {
  const sorted = [...items].sort((a, b) => cy(a) - cy(b));
  const out: Region[][] = [];
  for (const r of sorted) {
    const row = out.find((g) => Math.abs(cy(g[0]!) - cy(r)) <= tol && Math.abs(rh(g[0]!) - rh(r)) <= heightTol);
    if (row) row.push(r);
    else out.push([r]);
  }
  return out.map((g) => g.sort((a, b) => cx(a) - cx(b)));
}

/** a 是否在 b 裡面（允許些微誤差） */
export const inside = (a: Region, b: Region, m = 0.01) =>
  a.x0 >= b.x0 - m && a.x1 <= b.x1 + m && a.y0 >= b.y0 - m && a.y1 <= b.y1 + m;
