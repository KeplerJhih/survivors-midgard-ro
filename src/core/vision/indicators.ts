import { dirsFromAngle, type Dir } from '../movement/directions';
import type { Frame } from './frame';

/**
 * 畫面外指示器（ui/chest_pointer.gd）：目標在畫面外時，在「中心 + 方向 × min(到邊距離, 0.4×高)」
 * 畫深色底圓（半徑 19/24 UI px）＋目標色外框＋圖示＋外側箭頭＋下方距離。
 * 標記：寶箱（最近 8 個）、MVP 入口、金波利、任務（金色「!」）、催眠師（紫色「!」）。
 * 實機取樣（2026-11-25，320px 寬取樣）：任務指示器深色圓盤 11×11、填滿率 0.72、中心圖示 (255,218,112)。
 * 觸控版右下的 F 按鈕（綠框月牙）也是深色圓，位置固定 → 以 HUD 區域排除。
 *
 * 尺寸：傳送門與任務的圓盤半徑 24、寶箱與催眠師 19（chest_pointer.gd）。
 * MVP 入口顏色隨 MVP 不同，Baphomet 是紫色 (0.75,0.3,1.0)，與催眠師 (0.74,0.46,1.0) 幾乎一樣 →
 * 大圓盤一律當目標（不進 MVP 入口會一直卡在地圖），小圓盤才依圖示顏色分辨催眠師。
 * 實機任務指示器直徑 11px（320px 寬取樣，H=224）→ 約 0.049H；寶箱/催眠師推算約 0.039H。
 */
export type IndicatorKind = 'target' | 'avoid' | 'other';

export interface Indicator {
  kind: IndicatorKind;
  /** 以畫面中心為原點、以畫面高度正規化（右、下為正） */
  x: number;
  y: number;
  icon: [number, number, number];
  /** 圓盤直徑 / 畫面高度 */
  size: number;
  /** 只靠「下方有距離數字」認出的頭像圓盤（MVP 入口 / 出口；一般戰鬥中不追，避免陰影＋白字誤判） */
  face?: boolean;
}

/** 大於此直徑（/H）視為大圓盤：傳送門或任務 */
export const LARGE_DISC = 0.044;
/** 圓盤正下方（0.55~1.3 個直徑）有白色距離數字 */
function hasDistanceText(f: Frame, cx: number, cy: number, d: number): boolean {
  const { width: W, height: H, data } = f;
  let n = 0;
  for (let y = Math.round(cy + 0.55 * d); y <= Math.min(H - 1, Math.round(cy + 1.3 * d)); y++)
    for (let x = Math.max(0, Math.round(cx - 0.5 * d)); x <= Math.min(W - 1, Math.round(cx + 0.5 * d)); x++) {
      const i = (y * W + x) * 4;
      if (Math.min(data[i]!, data[i + 1]!, data[i + 2]!) >= 200) n++;
    }
  return n >= 3;
}

/** 不在這些區域找（0~1）：左上資訊、右上小地圖與任務/傷害面板、底部技能列、兩側觸控搖桿與按鈕 */
export const HUD_ZONES = [
  { x0: 0, y0: 0, x1: 0.24, y1: 0.16 },
  { x0: 0.85, y0: 0, x1: 1, y1: 0.58 },
  { x0: 0.38, y0: 0.84, x1: 0.7, y1: 1 },
  { x0: 0, y0: 0.72, x1: 0.2, y1: 1 },
  { x0: 0.74, y0: 0.72, x1: 1, y1: 1 },
];

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

export function classifyIcon(r: number, g: number, b: number): IndicatorKind {
  if (b >= g + 40 && r >= g + 20) return 'avoid'; // 紫：催眠師
  if (r >= 180 && r >= b + 50) return 'target'; // 金/橙/棕：寶箱、任務、金波利
  return 'other';
}

/** 指示圓盤中心離畫面邊緣的最大距離（畫面高度比例；邊距 40~78px＋半徑 24，UI 放大時更寬；實機 1080×869 量到 0.21H） */
export const EDGE_BAND = 0.3;

export function findIndicators(f: Frame): Indicator[] {
  const { width: W, height: H, data } = f;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = luma(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!) < 70 ? 1 : 0;
  const seen = new Uint8Array(W * H);
  const minD = 0.027 * H;
  const maxD = 0.09 * H;
  const out: Indicator[] = [];

  for (let start = 0; start < W * H; start++) {
    if (!dark[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let n = 0, sx = 0, sy = 0, minX = W, maxX = 0, minY = H, maxY = 0;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % W;
      const y = (j / W) | 0;
      n++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && dark[j - 1] && !seen[j - 1]) (seen[j - 1] = 1), stack.push(j - 1);
      if (x < W - 1 && dark[j + 1] && !seen[j + 1]) (seen[j + 1] = 1), stack.push(j + 1);
      if (y > 0 && dark[j - W] && !seen[j - W]) (seen[j - W] = 1), stack.push(j - W);
      if (y < H - 1 && dark[j + W] && !seen[j + W]) (seen[j + W] = 1), stack.push(j + W);
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w < minD || h < minD || w > maxD || h > maxD) continue;
    if (w / h < 0.6 || w / h > 1.7 || n / (w * h) < 0.45) continue;
    const cx = sx / n / W;
    const cy = sy / n / H;
    if (HUD_ZONES.some((z) => cx >= z.x0 && cx <= z.x1 && cy >= z.y0 && cy <= z.y1)) continue;

    // 圓盤內的亮色、高飽和像素（圖示）平均色
    let r = 0, g = 0, b = 0, k = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = (y * W + x) * 4;
        const R = data[i]!, G = data[i + 1]!, B = data[i + 2]!;
        if (luma(R, G, B) < 140 || Math.max(R, G, B) - Math.min(R, G, B) < 60) continue;
        r += R;
        g += G;
        b += B;
        k++;
      }
    }
    const size = (w + h) / 2 / H;
    // 沒有亮色圖示：一般是陰影；但 MVP 頭像可能整個偏暗（實機 Dark Lord）→ 下方有距離數字的仍算入口圓盤
    // 指示圓盤一律畫在畫面邊緣（ui/chest_pointer.gd：離邊 MARGIN 40、底部 78，入口在畫面內時改畫箭頭不畫圓盤）
    // → 只靠「頭像＋距離數字」認的圓盤必須靠邊（實機：角色自己的深色頭髮＋下方白色名字被當成入口圓盤，一直往上走）
    const nearEdge = Math.min(sx / n, W - sx / n, sy / n, H - sy / n) <= EDGE_BAND * H;
    if (k < 2) {
      if (!nearEdge || !hasDistanceText(f, sx / n, sy / n, size * H)) continue;
      out.push({ kind: 'target', x: (sx / n - W / 2) / H, y: (sy / n - H / 2) / H, icon: [0, 0, 0], size: Math.max(size, LARGE_DISC), face: true });
      continue;
    }
    const icon: [number, number, number] = [Math.round(r / k), Math.round(g / k), Math.round(b / k)];
    const cls = classifyIcon(...icon);
    // 綠/灰圖示：陰影、樹影等（實機誤判 icon≈(157,162,74)）。
    // 例外：MVP 入口 / 出口圓盤中間是 MVP 頭像，顏色各不相同（實機：Dark Lord 頭像被歸為 other → 入口指示器被丟掉）。
    // 大小與樹影重疊（實機入口圓盤 0.051H、樹影 0.062H）→ 改看 ui/chest_pointer.gd 固定畫在圓盤正下方的
    // 白色距離數字（Color.WHITE）：樹影下方不會有純白像素（實機量測：入口 18 px、樹影 0）
    // 頭像的亮色部分把深色圓盤切碎 → 量到的圓盤比實際小（實機 0.038H），不能再用大小門檻；
    // 寶箱圖示是金色（target），歸為 other 又有距離數字的就是 MVP 頭像 → 當成傳送門大圓盤
    let portalFace = false;
    if (cls === 'other') {
      if (!nearEdge || !hasDistanceText(f, sx / n, sy / n, size * H)) continue;
      portalFace = true;
    }
    // 大圓盤（傳送門/任務）一律前往，紫色的大圓盤是 Baphomet 等 MVP 入口
    const kind = size >= LARGE_DISC || portalFace ? 'target' : cls;
    out.push({
      kind,
      x: (sx / n - W / 2) / H,
      y: (sy / n - H / 2) / H,
      icon,
      size: portalFace ? Math.max(size, LARGE_DISC) : size,
      ...(portalFace ? { face: true } : {}),
    });
  }
  return out;
}

const DEG = Math.PI / 180;
/** 大圓盤（傳送門/任務）優先於寶箱：沒進 MVP 入口對局會卡住 */
const priority = (i: Indicator) => (i.size >= LARGE_DISC ? 0 : 1);
const angleOf = (p: { x: number; y: number }) => Math.atan2(-p.y, p.x);
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** 朝最近的目標指示器走；要避開的指示器在前進方向 ±35° 內時，往遠離它的一側偏 60° */
export function steerToIndicator(list: Indicator[]): Dir[] | null {
  const targets = list.filter((i) => i.kind === 'target');
  if (targets.length === 0) return null;
  const t = targets.reduce((a, b) => {
    if (priority(a) !== priority(b)) return priority(a) < priority(b) ? a : b;
    return Math.hypot(a.x, a.y) <= Math.hypot(b.x, b.y) ? a : b;
  });
  let a = angleOf(t);
  for (const av of list.filter((i) => i.kind === 'avoid')) {
    const aa = angleOf(av);
    if (angleDiff(a, aa) < 35 * DEG) a += (Math.sin(a - aa) >= 0 ? 1 : -1) * 60 * DEG;
  }
  return dirsFromAngle(a);
}

export interface IndicatorSeeker {
  update(list: Indicator[] | null, now: number): Dir[] | null;
  readonly seeking: boolean;
}

/**
 * 連續 confirm 次看到目標才前往；追超過 maxChaseMs 就放棄並冷卻 cooldownMs（走不到/卡地形時）。
 * 指示器消失＝目標已進入畫面（離得不遠）→ 沿最後方向再走 coastMs，走到觸發/吸取範圍（任務 2.6、寶箱 3 單位）。
 */
export function createIndicatorSeeker(
  confirm = 2,
  maxChaseMs = 30000,
  cooldownMs = 20000,
  coastMs = 2500,
): IndicatorSeeker {
  let seen = 0;
  let chaseStart = -1;
  let coolUntil = -Infinity;
  let seeking = false;
  let lastDirs: Dir[] | null = null;
  let coastUntil = -Infinity;
  return {
    get seeking() {
      return seeking;
    },
    update(list, now) {
      const dirs = list ? steerToIndicator(list) : null;
      if (!dirs && seeking && lastDirs && now >= coolUntil) {
        // 剛失去指示器：開始滑行
        coastUntil = now + coastMs;
        seeking = false;
        seen = 0;
        chaseStart = -1;
      }
      if (!dirs && now < coastUntil && lastDirs) return lastDirs;
      if (!dirs || now < coolUntil) {
        seen = 0;
        chaseStart = -1;
        seeking = false;
        lastDirs = null;
        return null;
      }
      seen++;
      if (seen < confirm) return null;
      if (chaseStart < 0) chaseStart = now;
      if (now - chaseStart > maxChaseMs) {
        coolUntil = now + cooldownMs;
        seen = 0;
        chaseStart = -1;
        seeking = false;
        return null;
      }
      seeking = true;
      lastDirs = dirs;
      return dirs;
    },
  };
}

/**
 * 大紫圓盤只有在 MVP 入口開著（時間停住）時才是入口（Baphomet 等）；平常是催眠師（實機：大小 0.065、
 * 色 (185,116,250)，被「大圓盤一律前往」帶過去，一局被催眠兩次）→ 時間沒停住時改回 avoid。
 */
export function resolvePurple(list: Indicator[], frozen: boolean): Indicator[] {
  if (frozen) return list;
  return list.map((i) => (i.kind === 'target' && classifyIcon(...i.icon) === 'avoid' ? { ...i, kind: 'avoid' as const } : i));
}
