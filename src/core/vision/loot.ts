import { dirsFromAngle, type Dir } from '../movement/directions';
import type { Frame } from './frame';

/**
 * 地上貴重掉落物的光柱（core/main.gd _drop_item → _drop_marker → Vfx.beam）：
 * 卡片金色 (1,0.85,0.3) 高 4、寵物/樹枝/力量掉落也各有光柱。卡片吸取範圍小（ITEM_PULL），要走到旁邊才撿得到。
 * 特徵：又細又高、直立的亮色長條（傷害數字、技能光效都不是這種形狀）。
 * 回傳最近一道光柱底部（地面）的位置，以畫面中心為原點、畫面高度正規化。
 */
export interface Beam {
  x: number;
  y: number;
}

/** 不找的介面區（左上資訊、右上小地圖與傷害統計、底部技能列） */
const EXCLUDE = [
  { x0: 0, y0: 0, x1: 0.24, y1: 0.18 },
  { x0: 0.85, y0: 0, x1: 1, y1: 0.72 },
  { x0: 0.38, y0: 0.84, x1: 0.7, y1: 1 },
];

const isBeamPx = (r: number, g: number, b: number) => {
  const mx = Math.max(r, g, b);
  // 角色周圍的藍色火焰（R 低、B 高）也是直立亮條 → 排除
  return mx >= 200 && mx - Math.min(r, g, b) >= 50 && !(b > r + 30 && b > g + 10 && r < 120);
};

export function findBeams(f: Frame): Beam[] {
  const { width: W, height: H, data } = f;
  const ok = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!isBeamPx(data[i]!, data[i + 1]!, data[i + 2]!)) continue;
      const fx = x / W, fy = y / H;
      if (EXCLUDE.some((z) => fx >= z.x0 && fx <= z.x1 && fy >= z.y0 && fy <= z.y1)) continue;
      ok[y * W + x] = 1;
    }
  const seen = new Uint8Array(W * H);
  const out: (Beam & { d: number })[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!ok[s] || seen[s]) continue;
    seen[s] = 1;
    const stack = [s];
    let n = 0, x0 = W, x1 = 0, y0 = H, y1 = 0, sx = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      n++;
      sx += x;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (ok[q] && !seen[q]) (seen[q] = 1), stack.push(q);
        }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    // 細高：高 ≥ 0.08H、高寬比 ≥ 3、夠實（不是零星亮點連成的）
    if (h < 0.08 * H || h / w < 3 || n < h * 1.5) continue;
    const bx = (sx / n - W / 2) / H;
    const by = (y1 - H / 2) / H; // 底部＝地面上的掉落物
    out.push({ x: bx, y: by, d: Math.hypot(bx, by) });
  }
  return out.sort((a, b) => a.d - b.d).map(({ x, y }) => ({ x, y }));
}

/** 走向最近的光柱底部；已經站在旁邊（< near）就不用動 */
export function approachBeam(f: Frame, near = 0.04): Dir[] | null {
  const b = findBeams(f)[0];
  if (!b || Math.hypot(b.x, b.y) < near) return null;
  return dirsFromAngle(Math.atan2(-b.y, b.x));
}
