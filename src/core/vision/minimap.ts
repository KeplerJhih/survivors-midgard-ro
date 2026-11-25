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
  /** 小地圖上的祭壇標記（已排除催眠師） */
  altars?: AltarMark[];
}

/**
 * 祭壇（core/altars.gd、ui/ro_minimap.gd ALTAR_LOOK）：小地圖上畫「深色圓底 (0.05,0.05,0.1) 半徑 7」＋閃爍外環＋中間圖示，
 * 圖示形狀與顏色依祭壇固定（遊戲用來區分祭壇的識別）。站進半徑 1.8 的圈內連續 2 秒即觸發（ALTAR_CHANNEL）。
 * 實機（3840 寬、Byalan Island）：圓底 (16,16,29)/(36,36,47)、直徑約 32 px（小地圖邊長 338 px 的 0.095）；
 * Niflheim 十字 (173,107,255) 與程式碼顏色完全一致。
 */
export type AltarId =
  | 'odin'
  | 'thor'
  | 'freyja'
  | 'emperium'
  | 'baldur'
  | 'loki'
  | 'yggdrasil'
  | 'niflheim'
  | 'valkyrie'
  | 'hel';

export const ALTAR_COLORS: Record<AltarId, [number, number, number]> = {
  odin: [230, 237, 255],
  thor: [77, 148, 255],
  freyja: [255, 133, 51],
  emperium: [255, 219, 56],
  baldur: [255, 247, 179],
  loki: [158, 242, 46],
  yggdrasil: [51, 230, 199],
  niflheim: [173, 107, 255],
  valkyrie: [255, 140, 194],
  hel: [235, 36, 56],
};

export interface AltarMark extends Point {
  id: AltarId;
  /** 圓底直徑（px）：與小地圖同比例縮放，用來換算「站上去」的距離 */
  d: number;
}

/** 祭壇深色圓底：近黑、略偏藍 */
const isAltarDisc = (r: number, g: number, b: number) => r <= 50 && Math.abs(r - g) <= 6 && b - r >= 6 && b - r <= 20;
const DISC_BG: [number, number, number] = [16, 16, 29];

/** 與圖示色（不透明或 90% 不透明疊在圓底上）的距離 */
function glyphDist(r: number, g: number, b: number, c: [number, number, number]): number {
  const d1 = Math.hypot(r - c[0], g - c[1], b - c[2]);
  const m = c.map((v, k) => 0.9 * v + 0.1 * DISC_BG[k]!);
  const d2 = Math.hypot(r - m[0]!, g - m[1]!, b - m[2]!);
  return Math.min(d1, d2);
}

/**
 * 在小地圖方框內找祭壇標記並辨識是哪一座。
 * 先找各祭壇圖示色的像素團，再確認周圍有深色圓底：圓底常被玩家箭頭、相鄰標記切碎
 * （實機 2160 寬：兩個標記疊在箭頭旁，圓底碎成 5 塊、每塊都太小）→ 不要求圓底完整。
 */
export function findAltars(f: Frame, sq: Square): AltarMark[] {
  const { width: W, data } = f;
  const side = sq.x1 - sq.x0;
  const x0 = Math.max(0, Math.floor(sq.x0)), x1 = Math.min(W, Math.ceil(sq.x1));
  const y0 = Math.max(0, Math.floor(sq.y0)), y1 = Math.min(f.height, Math.ceil(sq.y1));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return [];
  const at = (x: number, y: number) => ((y0 + y) * W + x0 + x) * 4;
  const ids = Object.keys(ALTAR_COLORS) as AltarId[];
  // 每個像素最接近的圖示色（距離 < 16）
  const label = new Int8Array(w * h).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      // 圖示色都有一點飽和度（Odin 偏藍白 max-min=25）；灰白面板（實機 (239,240,245)）不算
      if (Math.max(r, g, b) < 100 || Math.max(r, g, b) - Math.min(r, g, b) < 18) continue;
      let bd = 16;
      for (let k = 0; k < ids.length; k++) {
        const dd = glyphDist(r, g, b, ALTAR_COLORS[ids[k]!]);
        if (dd < bd) (bd = dd), (label[y * w + x] = k);
      }
    }
  const minN = Math.max(6, (0.011 * side) ** 2);
  const discR = 0.06 * side; // 圓底半徑（實機直徑 ≈ 0.095 邊長）
  const seen = new Uint8Array(w * h);
  const out: AltarMark[] = [];
  for (let s = 0; s < w * h; s++) {
    const k = label[s]!;
    if (k < 0 || seen[s]) continue;
    seen[s] = 1;
    const stack = [s];
    let n = 0, sx = 0, sy = 0, mnx = w, mxx = 0, mny = h, mxy = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      n++;
      sx += x;
      sy += y;
      if (x < mnx) mnx = x;
      if (x > mxx) mxx = x;
      if (y < mny) mny = y;
      if (y > mxy) mxy = y;
      // 8 鄰、容許 1 px 斷開（圖示有白色描邊、抗鋸齒）
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (seen[q] || label[q] !== k) continue;
          seen[q] = 1;
          stack.push(q);
        }
    }
    const bw = mxx - mnx + 1, bh = mxy - mny + 1;
    if (n < minN || bw > 2.2 * discR || bh > 2.2 * discR) continue;
    const cx = sx / n, cy = sy / n;
    // 周圍要有深色圓底
    let disc = 0, tot = 0;
    const R = Math.ceil(discR);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        tot++;
        const i = at(x, y);
        if (isAltarDisc(data[i]!, data[i + 1]!, data[i + 2]!)) disc++;
      }
    if (disc < tot * 0.08) continue;
    const id = ids[k]!;
    // 催眠師（實心紫圓＋螺旋，顏色接近 Niflheim）：填滿比例高 → 不是祭壇
    if (id === 'niflheim' && n / (bw * bh) > 0.6) continue;
    // 同一座的圖示被切成幾塊（實機：Baldur 太陽的光芒報成 3 座）→ 兩個圓底半徑內合併
    if (out.some((o) => o.id === id && Math.hypot(o.x - (x0 + cx), o.y - (y0 + cy)) < 2 * discR)) continue;
    out.push({ id, x: x0 + cx, y: y0 + cy, d: 2 * discR });
  }
  return out;
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
    // 反過來：上邊被壓斷（角色在地圖上緣），以底邊往上推
    const top = firsts.find(
      (b) => Math.abs(b.y - (a.y - a.len)) <= a.len * 0.08 && b.x0 >= a.x0 - 3 && b.x0 + b.len <= a.x0 + a.len + 3,
    );
    if (top) return { x0: a.x0, y0: a.y - a.len, x1: a.x0 + a.len, y1: a.y };
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

/**
 * 方框邊線常被標記壓斷（實機：祭壇標記與玩家箭頭擠在上緣，上邊碎成短段 → 方框時有時無、祭壇讀不到）。
 * 視窗大小沒變時小地圖位置固定 → 找不到就沿用上次找到的方框。
 */
let lastSquare: { w: number; h: number; sq: Square } | null = null;
function squareOrLast(f: Frame): Square | null {
  const sq = findMinimapSquare(f);
  if (sq) {
    lastSquare = { w: f.width, h: f.height, sq };
    return sq;
  }
  return lastSquare && lastSquare.w === f.width && lastSquare.h === f.height ? lastSquare.sq : null;
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
  const sq = squareOrLast(f);
  return {
    player: { x: arrow.x, y: arrow.y },
    boss: boss ? { x: boss.x, y: boss.y } : null,
    altars: sq ? findAltars(f, sq) : [],
  };
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
