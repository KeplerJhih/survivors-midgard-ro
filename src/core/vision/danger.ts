import { HUD_ZONES } from './indicators';
import { dirsFromAngle, type Dir } from '../movement/directions';
import { findBlob, type Frame } from './frame';

/**
 * 地面紅色預警框（MVP 技能，例如 Baphomet「Niflheim 斬擊：站到裂痕之間！」的紅色帶狀區域）。
 * 實機取樣（2026-11-25，Baphomet 迷宮）：紅帶本體為深紅 (152,25,27)、(186,35,36)、(173,36,31)；
 * 技能火焰/光效為粉紅或橘紅 (250,180,170)、(250,177,114) → 只認 G、B 都很低的深紅。
 *
 * Golden Thief Bug「黃金之火：離開圓圈」是橘紅圓盤：實機取樣（2026-11-25）(247,104,78)、(242,108,84)、(239,128,92)、(244,113,77)；
 * 與光效的差別在 G ≤ 150（光效 G 170~180）→ 另認亮橘紅。其他實機畫面探測圓最高 5%（門檻 15%）。
 */
const isDeepRed = (r: number, g: number, b: number) => r >= 140 && g <= 70 && b <= 70 && r - g >= 90;
const isFireDisc = (r: number, g: number, b: number) => r >= 210 && g >= 85 && g <= 150 && b <= 110 && r - g >= 90 && r - b >= 120;
export const isDanger = (r: number, g: number, b: number) => isDeepRed(r, g, b) || isFireDisc(r, g, b);

export interface DangerProbes {
  /** 角色腳下的紅色比例 */
  center: number;
  /** 8 個方向（0=右，逆時針每 45°）探測圓內的紅色比例 */
  dirs: number[];
}

/** 以畫面中心（角色）為圓心，在腳下與 8 個方向 dist 處各取一個半徑 radius 的圓（皆以畫面高度為單位） */
export function probeDanger(f: Frame, dist = 0.13, radius = 0.05): DangerProbes {
  const { width: W, height: H, data } = f;
  const disk = (cx: number, cy: number) => {
    const r = radius * H;
    let n = 0;
    let hit = 0;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        n++;
        const i = (y * W + x) * 4;
        if (isDanger(data[i]!, data[i + 1]!, data[i + 2]!)) hit++;
      }
    }
    return n ? hit / n : 0;
  };
  const cx = W / 2;
  const cy = H / 2;
  const dirs: number[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    dirs.push(disk(cx + Math.cos(a) * dist * H, cy - Math.sin(a) * dist * H));
  }
  return { center: disk(cx, cy), dirs };
}

const SECTOR_ANGLE = Math.PI / 4;

function angleOfDirs(dirs: Dir[]): number | null {
  const x = (dirs.includes('right') ? 1 : 0) - (dirs.includes('left') ? 1 : 0);
  const y = (dirs.includes('up') ? 1 : 0) - (dirs.includes('down') ? 1 : 0);
  return x === 0 && y === 0 ? null : Math.atan2(y, x);
}

const sectorDist = (a: number, b: number) => Math.min((a - b + 8) % 8, (b - a + 8) % 8);

/**
 * 依探測結果修正移動方向；不需修正時回傳 null。
 * - 腳下是紅的：往最不紅的方向逃（同分取最接近原方向）
 * - 原方向前方是紅的：改走最接近原方向的安全方向；都不安全就走最不紅的方向
 */
export function dodge(p: DangerProbes, want: Dir[], threshold = 0.15): Dir[] | null {
  const a = angleOfDirs(want);
  const wantSector = a === null ? null : ((Math.round(a / SECTOR_ANGLE) % 8) + 8) % 8;
  const closeness = (k: number) => (wantSector === null ? 0 : sectorDist(k, wantSector));
  const pick = (candidates: number[]) =>
    candidates.reduce((best, k) =>
      p.dirs[k]! < p.dirs[best]! - 1e-9 || (Math.abs(p.dirs[k]! - p.dirs[best]!) < 1e-9 && closeness(k) < closeness(best))
        ? k
        : best,
    );
  const all = [0, 1, 2, 3, 4, 5, 6, 7];

  if (p.center >= threshold) return dirsFromAngle(pick(all) * SECTOR_ANGLE);
  if (wantSector === null || p.dirs[wantSector]! < threshold) return null;
  const safe = all.filter((k) => p.dirs[k]! < threshold);
  if (safe.length === 0) return dirsFromAngle(pick(all) * SECTOR_ANGLE);
  const best = safe.reduce((b, k) => (closeness(k) < closeness(b) ? k : b));
  return dirsFromAngle(best * SECTOR_ANGLE);
}

/**
 * 催眠師的地面紫色螺旋（站在半徑 1.8 內 2 秒會跳「忘掉一個技能」，core/altars.gd）。
 * 進入畫面後指示器消失，需另外辨識。實機取樣（2026-11-25）：(248,181,245)、(241,166,245)、(255,189,255)。
 */
export const isHypnoSwirl = (r: number, g: number, b: number) =>
  r >= 225 && b >= 230 && g >= 150 && g <= 200 && r - g >= 45 && b - g >= 45;

/** 粉紫光圈（催眠師螺旋；Baphomet 等 MVP 入口傳送門也是同色系）的位置，以畫面高度正規化 */
export function findSwirl(f: Frame): { x: number; y: number } | null {
  const blob = findBlob(f, isHypnoSwirl, 12);
  if (!blob) return null;
  const k = f.width / f.height; // findBlob 以寬度正規化 → 換成以高度正規化
  return { x: blob.x * k, y: blob.y * k };
}

/** 螺旋太靠近角色（重心距離 < near×H）時，回傳遠離它的方向；否則 null */
export function fleeSwirl(f: Frame, near = 0.25): Dir[] | null {
  const s = findSwirl(f);
  if (!s || Math.hypot(s.x, s.y) >= near) return null;
  return dirsFromAngle(Math.atan2(s.y, -s.x)); // 反方向（畫面 y 向下 → 角度 y 取正即為遠離）
}

/** 走向粉紫光圈（時間停住＝MVP 入口開著時，光圈是傳送門而非催眠師） */
/**
 * MVP 勝利後走向淡藍出口（「返回地圖」），不走金色因果路線傳送門
 * （實機：走進「傳送門：Valhalla」→ Valkyrie 戰滿血被秒殺、整局結束）。
 */
export function approachExit(f: Frame): Dir[] | null {
  const s = findPortalGlow(f, 20, isExitBlue);
  return s ? dirsFromAngle(Math.atan2(-s.y, s.x)) : null;
}

export function approachSwirl(f: Frame): Dir[] | null {
  const s = findSwirl(f) ?? findPortalGlow(f);
  if (!s) return null;
  return dirsFromAngle(Math.atan2(-s.y, s.x));
}

/**
 * MVP 入口傳送門的光（顏色依 MVP 而異：Golden Thief Bug 是金色；core/mvp_raid.gd Vfx.warp_portal(color)）。
 * 只在時間停住時用：此時遊戲會清掉一般怪物（banish_enemy），畫面上最大一團「高亮、高飽和」的光就是傳送門。
 * 排除藍色系（角色周圍的藍色火焰）、角色中心、HUD 區域；取最大的連通塊，以畫面高度正規化。
 */
const isPortalGlow = (r: number, g: number, b: number) => {
  const mx = Math.max(r, g, b);
  if (mx < 220 || mx - Math.min(r, g, b) < 90) return false;
  return !(b > r + 30 && b > g + 10); // 藍色火焰
};

/**
 * MVP 勝利後的出口（「返回地圖」）是淡藍光：實機取樣（2026-11-25）(147,202,241)、(152,173,212)、(161,218,255)；
 * 藍色火焰是飽和深藍 (45,138,255)、(35,104,230)，R < 90 → 以 R ≥ 110、B-R ≤ 110 區分。
 */
const isExitBlue = (r: number, g: number, b: number) =>
  b > r + 30 && r >= 110 && g >= 150 && b >= 180 && b - r <= 110 && Math.max(r, g, b) - Math.min(r, g, b) >= 50;
/** 左側 MVP 任務面板（淡藍進度條會被當成出口光） */
const MVP_PANEL = { x0: 0, y0: 0.28, x1: 0.18, y1: 0.7 };

export function findPortalGlow(f: Frame, minPixels = 8, match = isPortalGlow): { x: number; y: number } | null {
  const { width: W, height: H, data } = f;
  const ok = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!match(data[i]!, data[i + 1]!, data[i + 2]!)) continue;
      const fx = x / W, fy = y / H;
      if (fy < 0.13) continue; // 頂部中央的首領/MVP 血條面板（粉紅血條）
      if (HUD_ZONES.some((z) => fx >= z.x0 && fx <= z.x1 && fy >= z.y0 && fy <= z.y1)) continue;
      if (match === isExitBlue && fx >= MVP_PANEL.x0 && fx <= MVP_PANEL.x1 && fy >= MVP_PANEL.y0 && fy <= MVP_PANEL.y1) continue;
      if (Math.hypot((x - W / 2) / H, (y - H / 2) / H) < 0.08) continue; // 角色本身
      ok[y * W + x] = 1;
    }
  const seen = new Uint8Array(W * H);
  let best: { n: number; x: number; y: number } | null = null;
  const stack: number[] = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!ok[p0] || seen[p0]) continue;
    seen[p0] = 1;
    stack.push(p0);
    let n = 0, sx = 0, sy = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      n++;
      sx += x;
      sy += y;
      // 8 鄰接（光暈常是點狀散開）
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (ok[q] && !seen[q]) (seen[q] = 1), stack.push(q);
        }
    }
    if (n >= minPixels && (!best || n > best.n)) best = { n, x: sx / n, y: sy / n };
  }
  return best ? { x: (best.x - W / 2) / H, y: (best.y - H / 2) / H } : null;
}

/**
 * Golden Thief Bug「催眠閃光：倒數結束時不要動！」（raid_trials.gd snap, mode stop）：角色腳下出現環，
 * 倒數結束時有移動就扣 30% HP。實機：環與火焰圓圈同色（(240,100,80)），但它是**以角色為中心的空心環**：
 * 半徑 0.03~0.075H 的環帶 8 個方向都有紅（每方向 ≥ 15%），環內（< 0.02H，只有角色本身）紅 < 40%。
 * 火焰圓圈是實心、通常不以角色為中心 → 不符合；正好蓋在角色上時（角色遮住中心）靠環外仍有大量紅排除。
 */
export function detectSnapRing(f: Frame): boolean {
  const { width: W, height: H, data } = f;
  const cx = W / 2, cy = H / 2;
  const sec = new Array(8).fill(0);
  const tot = new Array(8).fill(0);
  let inner = 0, innerN = 0, outer = 0, outerN = 0;
  const R = 0.12 * H;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(H - 1, Math.ceil(cy + R)); y++)
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W - 1, Math.ceil(cx + R)); x++) {
      const dx = (x - cx) / H, dy = (y - cy) / H;
      const d = Math.hypot(dx, dy);
      const i = (y * W + x) * 4;
      const red = data[i]! - data[i + 1]! >= 70 && data[i]! - data[i + 2]! >= 70;
      if (d < 0.02) {
        innerN++;
        if (red) inner++;
      } else if (d >= 0.03 && d <= 0.075) {
        const s = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
        tot[s]++;
        if (red) sec[s]++;
      } else if (d >= 0.095 && d <= 0.12) {
        outerN++;
        if (red) outer++;
      }
    }
  if (!innerN || !outerN || tot.some((n) => n === 0)) return false;
  // 環外（0.095~0.12H）紅要少：實機火焰圓圈正好蓋在角色身上時環外仍 30~45% 紅，倒數環 0~20%
  return Math.min(...sec.map((v, k) => v / tot[k])) >= 0.15 && inner / innerN < 0.4 && outer / outerN < 0.25;
}
