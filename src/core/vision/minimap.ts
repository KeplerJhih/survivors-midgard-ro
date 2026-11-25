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

export interface Square {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 小地圖邊框色 (0.58,0.66,0.86)（ro_minimap.gd draw_rect 外框 1px） */
const isBorder = (r: number, g: number, b: number) =>
  Math.abs(r - 148) < 30 && Math.abs(g - 168) < 30 && Math.abs(b - 219) < 30;

/** 找小地圖方框：上下兩條等長的邊框色水平線、間距約等於線長（正方形） */
export function findMinimapSquare(f: Frame): Square | null {
  const { width: W, height: H, data } = f;
  const lines: { y: number; x0: number; len: number }[] = [];
  for (let y = 0; y < H; y++) {
    let run = 0;
    let start = 0;
    let best = 0;
    let bx = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (isBorder(data[i]!, data[i + 1]!, data[i + 2]!)) {
        if (run === 0) start = x;
        run++;
        if (run > best) (best = run), (bx = start);
      } else run = 0;
    }
    if (best >= 0.2 * W) lines.push({ y, x0: bx, len: best });
  }
  // 邊框可能有 2 列（實機 273/274 交替被抓到 → 時鐘字形整列位移被當成變化）：每組相鄰線只取最上面那列
  const firsts = lines.filter((l) => !lines.some((o) => o.y === l.y - 1 && Math.abs(o.x0 - l.x0) <= 3));
  let found: Square | null = null;
  for (const a of firsts)
    for (const b of firsts) {
      if (b.y <= a.y + 10 || Math.abs(a.x0 - b.x0) > 3 || Math.abs(a.len - b.len) > 3) continue;
      const gap = b.y - a.y;
      if (Math.abs(gap - a.len) > a.len * 0.08) continue;
      if (!found || a.len > found.x1 - found.x0) found = { x0: a.x0, y0: a.y, x1: a.x0 + a.len, y1: b.y };
    }
  if (found) return found;
  // 底邊被角色/首領圖示壓斷（實機：角色走到地圖下緣，底邊只剩 123/221 px）：
  // 上邊在「上邊 + 邊長」附近有一段落在同一水平範圍內的殘段 → 方框是正方形，底邊 = 上邊 + 邊長。
  // （不能只取最長線：外層面板邊框 y=47 長 310 比方框還長）
  for (const a of [...firsts].sort((p, q) => q.len - p.len)) {
    const bottom = firsts.find(
      (b) => Math.abs(b.y - (a.y + a.len)) <= a.len * 0.08 && b.x0 >= a.x0 - 3 && b.x0 + b.len <= a.x0 + a.len + 3,
    );
    if (bottom) return { x0: a.x0, y0: a.y, x1: a.x0 + a.len, y1: a.y + a.len };
  }
  return null;
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
 * 所以邊走邊學：一段時間內累積「按鍵向量 × 時間」u 與箭頭位移 d，最小平方法擬合 d = A·u；要去目標時解 u = A⁻¹·(目標−玩家)。
 * 不要求方向固定（花瓣走位約每 500ms 換方向）。撞牆的樣本（位移很小）略過；換地圖（位置跳很遠）就清掉重學。
 */
export function createMinimapNavigator(minIntervalMs = 800, maxSamples = 24) {
  let win: { p: Point; t: number; u: Point } | null = null;
  let prev: { v: Point; t: number } | null = null;
  let samples: { v: Point; d: Point }[] = [];
  let A: [number, number, number, number] | null = null; // [a b; c d]

  const fit = () => {
    if (samples.length < 4) return (A = null);
    // A = (Σ d uᵀ)(Σ u uᵀ)⁻¹
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
    if (det < 0.05 * (s11 + s22) ** 2 / 4) return (A = null); // 方向不夠多樣
    const i11 = s22 / det, i12 = -s12 / det, i22 = s11 / det;
    A = [m11 * i11 + m12 * i12, m11 * i12 + m12 * i22, m21 * i11 + m22 * i12, m21 * i12 + m22 * i22];
  };

  return {
    get calibrated() {
      return A !== null;
    },
    /** 每次讀到小地圖時呼叫；dirs 是目前按住的方向 */
    observe(p: Point, dirs: readonly Dir[], t: number) {
      const v = vecOfDirs(dirs);
      if (!win || !prev || t < prev.t) {
        win = { p, t, u: { x: 0, y: 0 } };
        prev = { v, t };
        return;
      }
      const dt = (t - prev.t) / 1000;
      win.u = { x: win.u.x + prev.v.x * dt, y: win.u.y + prev.v.y * dt };
      prev = { v, t };
      if (t - win.t < minIntervalMs) return;
      const d = { x: p.x - win.p.x, y: p.y - win.p.y };
      const len = Math.hypot(d.x, d.y);
      if (len > 60) {
        samples = []; // 換地圖 / 傳送
        A = null;
      } else if (Math.hypot(win.u.x, win.u.y) >= 0.3 && len >= 2) {
        samples.push({ v: win.u, d });
        if (samples.length > maxSamples) samples.shift();
        fit();
      }
      win = { p, t, u: { x: 0, y: 0 } };
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
