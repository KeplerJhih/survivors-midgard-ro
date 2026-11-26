import type { Frame } from './frame';

/**
 * MVP 入口 / 勝利後出口頭上的名稱（「傳送門：Dark Lord」「返回地圖」）。
 *
 * core/mvp_raid.gd _spawn_portal：入口與出口都用 _label(..., Color(1, 0.9, 1), 高度 2.6, 字級 34)，
 * 黑色外框、no_depth_test（被高塔、柱子擋住也照樣畫在最上層）。
 * → 與 MVP 種類、入口光的顏色、語言都無關：文字一律是同一個淡粉白。
 * 因果路線傳送門（Valhalla 等）的名稱是 col.lightened(0.35)（金 / 紅），怪物說明是純白 → 都排除。
 *
 * 文字筆畫縮圖後會與黑外框混色變暗，但 R:G:B 比例不變 → 以比例判斷（G ≈ 0.9R、B ≈ R），不看絕對亮度。
 */
export const isPortalLabel = (r: number, g: number, b: number) =>
  r >= 140 && Math.abs(r - b) <= 0.08 * r && g >= 0.83 * r && g <= 0.95 * r;

/** HUD 區（左上角色面板、右側小地圖 / 任務 / 傷害面板、下方技能列） */
const HUD = [
  { x0: 0, y0: 0, x1: 0.24, y1: 0.2 },
  { x0: 0.85, y0: 0, x1: 1, y1: 0.72 },
  { x0: 0.38, y0: 0.84, x1: 0.7, y1: 1 },
];

/** 名稱底部到傳送門中心的距離（畫面高度比例；實機 1568×713：名稱底 147px、光圈中心 190px） */
export const LABEL_TO_PORTAL = 0.06;

/**
 * 找傳送門名稱，回傳傳送門位置（相對畫面中心，以畫面高度正規化，與 findPortalGlow 一致）。
 * 文字字形彼此分開 → 先把符合的像素水平膨脹再找連通塊；名稱是一行橫向文字（寬遠大於高）。
 */
export function findPortalLabel(f: Frame): { x: number; y: number } | null {
  const { width: W, height: H, data } = f;
  const hit = new Uint8Array(W * H);
  let any = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const fx = x / W, fy = y / H;
      if (HUD.some((z) => fx >= z.x0 && fx <= z.x1 && fy >= z.y0 && fy <= z.y1)) continue;
      const i = (y * W + x) * 4;
      if (isPortalLabel(data[i]!, data[i + 1]!, data[i + 2]!)) {
        hit[y * W + x] = 1;
        any++;
      }
    }
  if (any < 6) return null;
  // 水平膨脹（字距）＋垂直 1px
  const gap = Math.max(2, Math.round(0.012 * H));
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!hit[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -gap; dx <= gap; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) m[yy * W + xx] = 1;
        }
    }
  const seen = new Uint8Array(W * H);
  let best: { n: number; x0: number; x1: number; y1: number; sx: number } | null = null;
  // 文字核心是原色 (255,229,255)（實機）；特效、傷害數字混到相近比例但沒有這麼亮的核心
  const core = (p: number) => data[p * 4]! >= 240 && data[p * 4 + 2]! >= 240;
  const stack: number[] = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!m[p0] || seen[p0]) continue;
    seen[p0] = 1;
    stack.push(p0);
    let n = 0, sx = 0, x0 = W, x1 = 0, y0 = H, y1 = 0, c = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      if (hit[p]) {
        n++;
        sx += x;
        if (core(p)) c++;
      }
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H || seen[q] || !m[q]) continue;
        if (Math.abs((q % W) - x) > 1) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const w = (x1 - x0 + 1) / H, h = (y1 - y0 + 1) / H;
    // 一行文字：高 0.015~0.07H、寬至少 2 倍高；筆畫像素夠多
    // 實機名稱（「傳送門：Dark Lord」，640 寬取樣）：45 px、核心 ≥ 3
    if (h < 0.015 || h > 0.07 || w < 2 * h || n < 20 || c < 3) continue;
    // 名稱有黑色外框（_label outline）：框內暗像素要夠多。實機：粉紅的催眠師漩渦顏色相近、沒有黑框 → 被當成入口名稱
    let dark = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * W + x) * 4;
        if (data[i]! + data[i + 1]! + data[i + 2]! < 180) dark++;
      }
    if (dark < 0.15 * n) continue;
    if (!best || n > best.n) best = { n, x0, x1, y1, sx };
  }
  if (!best) return null;
  const cx = best.sx / best.n;
  return { x: (cx - W / 2) / H, y: ((best.y1 + 1) / H - 0.5) + LABEL_TO_PORTAL };
}
