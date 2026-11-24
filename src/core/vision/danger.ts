import { dirsFromAngle, type Dir } from '../movement/directions';
import { findBlob, type Frame } from './frame';

/**
 * 地面紅色預警框（MVP 技能，例如 Baphomet「Niflheim 斬擊：站到裂痕之間！」的紅色帶狀區域）。
 * 實機取樣（2026-11-25，Baphomet 迷宮）：紅帶本體為深紅 (152,25,27)、(186,35,36)、(173,36,31)；
 * 技能火焰/光效為粉紅或橘紅 (250,180,170)、(250,177,114) → 只認 G、B 都很低的深紅。
 */
export const isDanger = (r: number, g: number, b: number) => r >= 140 && g <= 70 && b <= 70 && r - g >= 90;

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

/** 螺旋太靠近角色（重心距離 < near×H）時，回傳遠離它的方向；否則 null */
export function fleeSwirl(f: Frame, near = 0.25): Dir[] | null {
  const blob = findBlob(f, isHypnoSwirl, 12);
  if (!blob) return null;
  // findBlob 以寬度正規化；換成以高度正規化
  const k = f.width / f.height;
  const x = blob.x * k;
  const y = blob.y * k;
  if (Math.hypot(x, y) >= near) return null;
  return dirsFromAngle(Math.atan2(y, -x)); // 反方向（畫面 y 向下 → 角度 y 取正即為遠離）
}
