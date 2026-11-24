import type { Dir } from '../movement/directions';
import { dirsFromAngle } from '../movement/directions';
import type { Frame } from './frame';

/**
 * 小地圖（右上，ui/ro_minimap.gd）：
 * - 玩家箭頭 ARROW = (255,38,25)
 * - 首領點 BOSS_DOT = (255,64,64)、半徑 3、外圍黑框（world.boss，在範圍外會被夾在邊緣）
 * 取樣區只要包含小地圖即可（HUD 不依比例縮放，位置隨視窗大小變）；以原生解析度取樣。
 */
export const MINIMAP_REGION = { x0: 0.8, y0: 0, x1: 1, y1: 0.4 };

export interface Point {
  x: number;
  y: number;
}

export interface MinimapRead {
  player: Point;
  boss: Point | null;
}

const isArrow = (r: number, g: number, b: number) => r >= 200 && g <= 70 && b <= 50 && g >= b - 5;
const isBossDot = (r: number, g: number, b: number) =>
  r >= 200 && g >= 45 && g <= 100 && b >= 45 && b <= 100 && Math.abs(g - b) <= 25;

interface Blob extends Point {
  n: number;
}

function blobs(f: Frame, match: (r: number, g: number, b: number) => boolean): Blob[] {
  const { width: W, height: H, data } = f;
  const seen = new Uint8Array(W * H);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || !match(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!)) continue;
    seen[i] = 1;
    stack.push(i);
    let n = 0;
    let sx = 0;
    let sy = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p / W) | 0;
      n++;
      sx += x;
      sy += y;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H || seen[q]) continue;
        if (Math.abs((q % W) - x) > 1) continue;
        if (!match(data[q * 4]!, data[q * 4 + 1]!, data[q * 4 + 2]!)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    out.push({ x: sx / n, y: sy / n, n });
  }
  return out;
}

export function readMinimap(f: Frame): MinimapRead | null {
  const area = f.width * f.height;
  const arrow = blobs(f, isArrow)
    .filter((b) => b.n >= area * 0.00004)
    .sort((a, b) => b.n - a.n)[0];
  if (!arrow) return null;
  // 首領點離玩家箭頭夠遠（箭頭邊緣的混色不算），取最大的
  const boss =
    blobs(f, isBossDot)
      .filter((b) => b.n >= area * 0.00001 && Math.hypot(b.x - arrow.x, b.y - arrow.y) > 6)
      .sort((a, b) => b.n - a.n)[0] ?? null;
  return { player: { x: arrow.x, y: arrow.y }, boss: boss ? { x: boss.x, y: boss.y } : null };
}

/** 按住的方向鍵 → 畫面向量（右 +x、上 +y） */
export function vecOfDirs(dirs: readonly Dir[]): Point {
  const x = (dirs.includes('right') ? 1 : 0) - (dirs.includes('left') ? 1 : 0);
  const y = (dirs.includes('up') ? 1 : 0) - (dirs.includes('down') ? 1 : 0);
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
}

/**
 * 小地圖導航：小地圖的方向和畫面按鍵方向不一致（實機：按上→小地圖往左、按右→往上；鏡頭角度依地圖而異），
 * 所以邊走邊學：觀察「按住方向 v」與「箭頭位移 d」，最小平方法擬合 d = A·v；要去目標時解 v = A⁻¹·(目標−玩家)。
 * 撞牆的樣本（位移很小）略過；換地圖（玩家位置跳很遠）就清掉重學。
 */
export function createMinimapNavigator(minIntervalMs = 800, maxSamples = 24) {
  let last: { p: Point; v: Point; t: number } | null = null;
  let samples: { v: Point; d: Point }[] = [];
  let A: [number, number, number, number] | null = null; // [a b; c d]

  const fit = () => {
    if (samples.length < 4) return (A = null);
    // A = (Σ d vᵀ)(Σ v vᵀ)⁻¹
    let s11 = 0, s12 = 0, s22 = 0, m11 = 0, m12 = 0, m21 = 0, m22 = 0;
    for (const { v, d } of samples) {
      s11 += v.x * v.x;
      s12 += v.x * v.y;
      s22 += v.y * v.y;
      m11 += d.x * v.x;
      m12 += d.x * v.y;
      m21 += d.y * v.x;
      m22 += d.y * v.y;
    }
    const det = s11 * s22 - s12 * s12;
    if (det < 0.5) return (A = null); // 方向不夠多樣
    const i11 = s22 / det, i12 = -s12 / det, i22 = s11 / det;
    A = [m11 * i11 + m12 * i12, m11 * i12 + m12 * i22, m21 * i11 + m22 * i12, m21 * i12 + m22 * i22];
  };

  return {
    get calibrated() {
      return A !== null;
    },
    /** 每次讀到小地圖時呼叫；dirs 是這段期間按住的方向 */
    observe(p: Point, dirs: readonly Dir[], t: number) {
      const v = vecOfDirs(dirs);
      if (!last) {
        last = { p, v, t };
        return;
      }
      const sameDir = Math.abs(v.x - last.v.x) < 1e-6 && Math.abs(v.y - last.v.y) < 1e-6;
      if (!sameDir) {
        last = { p, v, t };
        return;
      }
      if (t - last.t < minIntervalMs) return;
      const d = { x: p.x - last.p.x, y: p.y - last.p.y };
      const len = Math.hypot(d.x, d.y);
      if (len > 60) {
        samples = []; // 換地圖 / 傳送
        A = null;
      } else if ((v.x || v.y) && len >= 2) {
        samples.push({ v, d });
        if (samples.length > maxSamples) samples.shift();
        fit();
      }
      last = { p, v, t };
    },
    /** 走向目標要按的方向；未校正或已到達回傳 null */
    steer(from: Point, to: Point, arrive = 3): Dir[] | null {
      if (!A) return null;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.hypot(dx, dy) < arrive) return null;
      const [a, b, c, d] = A;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-6) return null;
      const vx = (d * dx - b * dy) / det;
      const vy = (-c * dx + a * dy) / det;
      return dirsFromAngle(Math.atan2(vy, vx));
    },
  };
}
