import { dirsFromAngle, type Dir } from '../movement/directions';
import { findBlob, type Blob, type Frame } from './frame';

/**
 * 顏色依實機取樣校準（2026-11-24，Baphomet 迷宮）：
 * - 「返回地圖」傳送門：飽和青色，例 (203,255,255)、(180,245,255)；遊戲色 Color(0.45,0.78,1.0)
 * - 業力路線傳送門（Niflheim 等）：紅，例 (255,141,137)、(254,117,149)；遊戲色 Color(0.85,0.12,0.2)
 * 一般野外畫面以嚴格青色條件掃描，大多 0~6 點、特效偶發 30 點 → 需連續多次確認
 * 來源：core/mvp_raid.gd offer_exits()、_spawn_kportal()
 */
export const isExitColor = (r: number, g: number, b: number) => g >= 230 && b >= 230 && r <= 215;
export const isDangerColor = (r: number, g: number, b: number) =>
  r >= 240 && g >= 95 && g <= 160 && b >= 100 && b <= 170;

export interface PortalScan {
  exit: Blob | null;
  danger: Blob | null;
}

/** 160px 寬的畫面上，傳送門至少要這麼多點、且外框不能太大（排除全螢幕閃光） */
const MIN_EXIT_POINTS = 8;
const MAX_BLOB_SIZE = 0.3;

export function scanPortals(frame: Frame): PortalScan {
  const compact = (b: Blob | null) => (b && b.w <= MAX_BLOB_SIZE && b.h <= MAX_BLOB_SIZE ? b : null);
  return {
    exit: compact(findBlob(frame, isExitColor, MIN_EXIT_POINTS)),
    danger: compact(findBlob(frame, isDangerColor, MIN_EXIT_POINTS)),
  };
}

const DEG = Math.PI / 180;

/** 畫面座標（y 向下）轉成 dirsFromAngle 的角度（y 向上為正） */
const angleOf = (b: Blob) => Math.atan2(-b.y, b.x);

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** 朝出口走；若危險傳送門擋在前方（方向相近且更近），往遠離它的一側偏 70° 繞開 */
export function steerToExit(scan: PortalScan): Dir[] | null {
  if (!scan.exit) return null;
  let a = angleOf(scan.exit);
  const d = scan.danger;
  if (d) {
    const ad = angleOf(d);
    const blocking =
      angleDiff(a, ad) < 40 * DEG && Math.hypot(d.x, d.y) < Math.hypot(scan.exit.x, scan.exit.y) + 0.05;
    if (blocking) {
      const side = Math.sin(a - ad) >= 0 ? 1 : -1;
      a += side * 70 * DEG;
    }
  }
  return dirsFromAngle(a);
}

export interface PortalSeeker {
  /** 每次取樣後呼叫；確認看到出口時回傳要按的方向，否則 null（交回原本走位） */
  update(scan: PortalScan): Dir[] | null;
  readonly seeking: boolean;
}

/** 連續 confirm 次看到出口才開始導航；連續 lose 次看不到就放棄（避免特效誤判） */
export function createPortalSeeker(confirm = 3, lose = 6): PortalSeeker {
  let seen = 0;
  let missed = 0;
  let seeking = false;
  return {
    get seeking() {
      return seeking;
    },
    update(scan) {
      if (scan.exit) {
        seen++;
        missed = 0;
        if (seen >= confirm) seeking = true;
      } else {
        missed++;
        if (missed >= lose) {
          seen = 0;
          seeking = false;
        }
      }
      return seeking ? steerToExit(scan) : null;
    },
  };
}
