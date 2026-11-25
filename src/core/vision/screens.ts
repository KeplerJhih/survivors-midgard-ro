import type { Frame } from './frame';

/**
 * 非遊玩畫面（視窗）的辨識與要點擊的位置。座標皆為 0~1（相對畫面寬高）。
 * 依實機取樣校準（2026-11-25）：
 * - 結算頁：面板像素 (251,251,252)，全畫面淺色約 75%；主要按鈕「選擇目的地」為飽和藍框 (84,113,200)，
 *   「再玩一次」緊接在它右側（ui/menus.gd show_end：[選擇目的地][再玩一次][前往 Prontera][更換職業]）
 * - 「不存放就離開？」確認框：背景加 55% 遮罩變暗，中央亮色小視窗，按鈕靠右 [要再想想][仍要離開]
 *   （ui/menus.gd _end_leave）
 * - 初始技能：「上次選擇」卡片頂端是 LEGENDARY_COLOR (0.85,0.42,0.05) 色帶（ui/menus.gd show_start_skill）
 * - 腐化寶箱選路線：左卡 Hel 標題粉紅 (247,224,224)、右卡 Valhalla 標題淡藍 (222,235,255)，
 *   按鈕「選擇這條路」在卡片底部；預設焦點在 Hel，所以只能點擊（karma.gd chest_choice、menus.gd）
 * - 升級選卡：卡片外框色＝稀有度（ui/menus.gd _rarity_frame、GameData.CHOICE_RARITY）：
 *   稀有 (77,140,255)、史詩 (179,89,242)、傳說 (255,173,38)、進化 LEGENDARY_COLOR (217,107,13)；普通為淡灰藍。
 *   遊戲內「隨機選擇」每局會被重設（實機：新局後變回未勾），故由外掛依稀有度點卡；全是普通卡時交給週期送的「1」
 * - 選地圖（城鎮踩「出發冒險！」傳送門後，menus.show_server_select）：左側世界地圖、右側淺色面板
 *   （右 38% 區域淺色約 51%、全畫面約 20%），右下「選擇 ▶」為主要按鈕（約 y=0.825H）；上一張地圖預設已選
 * - 「準備」畫面：置中大面板，右下「出發冒險！」為主要按鈕 → 由置中視窗規則處理
 * - 「新卡片！」等置中視窗：淺色面板（實機約畫面 37%×61%，密度 0.72），底部「繼續」為主要按鈕（藍框，
 *   縮圖後只剩上緣一條線）；背景不壓暗。升級選卡視窗不使用 UiKit 主要按鈕，不會被誤點
 */
export type ScreenKind = 'result' | 'corrupt' | 'level-up' | 'map-select' | 'modal' | 'dialog' | 'start-skill' | 'pause' | 'job';

/** 稀有度由高到低（進化 > 傳說 > 史詩 > 稀有） */
export const RARITY_BORDERS: { name: string; rgb: [number, number, number] }[] = [
  { name: 'evolve', rgb: [217, 107, 13] },
  { name: 'legendary', rgb: [255, 173, 38] },
  { name: 'epic', rgb: [179, 89, 242] },
  { name: 'rare', rgb: [77, 140, 255] },
];

export interface ScreenAction {
  kind: ScreenKind;
  /** 要點擊的位置（0~1） */
  x: number;
  y: number;
  /** 結算頁「帶回 Kafra 倉庫」物品格（由左到右、已排除倉庫已有的），破關時免費帶 3 件 */
  keep?: { x: number; y: number }[];
}

const isLight = (r: number, g: number, b: number) =>
  Math.min(r, g, b) >= 225 && Math.max(r, g, b) - Math.min(r, g, b) <= 30;
const isPrimaryBorder = (r: number, g: number, b: number) => r <= 110 && b >= 180 && b - r >= 90 && g <= 135;
const isHelHeader = (r: number, g: number, b: number) =>
  r >= 238 && g >= 212 && g <= 234 && b >= 212 && b <= 234 && r - b >= 12;
const isValhallaHeader = (r: number, g: number, b: number) =>
  r >= 210 && r <= 234 && g >= 226 && g <= 244 && b >= 248 && b - r >= 20;
const isLegendary = (r: number, g: number, b: number) => r >= 180 && g >= 70 && g <= 140 && b <= 60 && r - b >= 140;

interface Box {
  n: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function scan(
  f: Frame,
  match: (r: number, g: number, b: number) => boolean,
  region = { x0: 0, x1: 1, y0: 0, y1: 1 },
): Box {
  const box: Box = { n: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const X0 = Math.floor(region.x0 * f.width);
  const X1 = Math.ceil(region.x1 * f.width);
  const Y0 = Math.floor(region.y0 * f.height);
  const Y1 = Math.ceil(region.y1 * f.height);
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const i = (y * f.width + x) * 4;
      if (!match(f.data[i]!, f.data[i + 1]!, f.data[i + 2]!)) continue;
      box.n++;
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  return box;
}

/** box 以外區域的平均亮度（遮罩 55% 會把背景壓到約 60 以下；一般遊玩畫面約 100~140） */
function outsideLuma(f: Frame, box: Box): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < f.height; y += 2) {
    for (let x = 0; x < f.width; x += 2) {
      if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) continue;
      const i = (y * f.width + x) * 4;
      sum += 0.299 * f.data[i]! + 0.587 * f.data[i + 1]! + 0.114 * f.data[i + 2]!;
      n++;
    }
  }
  return n ? sum / n : 255;
}

export function lightRatio(f: Frame): number {
  return scan(f, isLight).n / (f.width * f.height);
}

/** 辨識目前是否停在需要點擊才能繼續的畫面；一般遊玩畫面回傳 null */
export function detectScreen(f: Frame): ScreenAction | null {
  const W = f.width;
  const H = f.height;
  const light = lightRatio(f);

  // 結算頁：大面積淺色面板 + 下方的主要按鈕（藍框）
  if (light >= 0.5) {
    const primary = scan(f, isPrimaryBorder, { x0: 0, x1: 1, y0: 0.8, y1: 1 });
    if (primary.n >= 4) {
      const bw = primary.maxX - primary.minX + 1;
      return {
        kind: 'result',
        x: (primary.maxX + 0.6 * bw) / W,
        y: (primary.minY + primary.maxY + 1) / 2 / H,
      };
    }
  }

  // 腐化寶箱：左 Hel（粉紅）右 Valhalla（淡藍）兩張卡 → 一律選 Valhalla（生存優先）
  const hel = scan(f, isHelHeader, { x0: 0.05, x1: 0.95, y0: 0.15, y1: 0.75 });
  const val = scan(f, isValhallaHeader, { x0: 0.05, x1: 0.95, y0: 0.15, y1: 0.75 });
  const minHeader = W * H * 0.01;
  if (hel.n >= minHeader && val.n >= minHeader && (hel.minX + hel.maxX) / 2 < (val.minX + val.maxX) / 2) {
    const card = scan(f, isLight, { x0: val.minX / W, x1: (val.maxX + 1) / W, y0: val.minY / H, y1: 0.95 });
    return {
      kind: 'corrupt',
      x: (val.minX + val.maxX + 1) / 2 / W,
      y: (card.maxY + 1) / H - 0.04,
    };
  }

  // 置中、夠寬的主要按鈕（新卡片/暫停選單的「繼續」，約 0.34W 寬）：不受視窗內容影響直接點
  // 實機：Baphomet Card 的金色卡框 (255,199,56) 與傳說色相近 → 升級規則誤判、一直點卡圖而卡住；
  // 卡圖偏暗也讓面板規則認不出來 → 此規則排在升級規則之前（升級視窗沒有寬的主要按鈕）
  const wide = scan(f, isPrimaryBorder, { x0: 0.15, x1: 0.85, y0: 0.3, y1: 0.95 });
  if (wide.n >= 4 && wide.maxX - wide.minX + 1 >= 0.2 * W && Math.abs((wide.minX + wide.maxX + 1) / 2 / W - 0.5) < 0.1) {
    return { kind: 'modal', x: (wide.minX + wide.maxX + 1) / 2 / W, y: (wide.minY + 0.5) / H + 0.02 };
  }

  // 升級選卡：點稀有度最高的卡（同稀有度多張時取像素最多那張）
  if (light >= 0.15) {
    const pick = pickRarestCard(f);
    if (pick) return { kind: 'level-up', ...pick };
  }

  // 選地圖：右側淺色面板，點面板右下的主要按鈕「選擇」（沿用預設選中的地圖）
  const right = scan(f, isLight, { x0: 0.62, x1: 1, y0: 0.15, y1: 0.9 });
  if (light < 0.35 && right.n / (0.38 * W * 0.75 * H) >= 0.4) {
    const p = scan(f, isPrimaryBorder, { x0: 0.62, x1: 1, y0: 0.75, y1: 0.92 });
    if (p.n >= 4) {
      return { kind: 'map-select', x: (p.minX + p.maxX + 1) / 2 / W, y: (p.minY + 0.5) / H + 0.015 };
    }
  }

  // 置中的淺色視窗，下半部有主要按鈕（新卡片「繼續」等）→ 點主要按鈕（藍框上緣往下一點才在按鈕內）
  const modal = scan(f, isLight, { x0: 0.15, x1: 0.85, y0: 0.1, y1: 0.9 });
  if (modal.n > 0) {
    const bw = modal.maxX - modal.minX + 1;
    const bh = modal.maxY - modal.minY + 1;
    const cx = (modal.minX + modal.maxX + 1) / 2 / W;
    const density = modal.n / (bw * bh);
    const area = (bw * bh) / (W * H);
    if (density >= 0.55 && area >= 0.08 && Math.abs(cx - 0.5) < 0.12) {
      const primary = scan(f, isPrimaryBorder, {
        x0: modal.minX / W,
        x1: (modal.maxX + 1) / W,
        y0: (modal.minY + 0.6 * bh) / H,
        y1: (modal.maxY + 1) / H,
      });
      if (primary.n >= 4) {
        return {
          kind: 'modal',
          x: (primary.minX + primary.maxX + 1) / 2 / W,
          y: (primary.minY + 0.5) / H + 0.02,
        };
      }
    }
  }

  // 初始技能：淺色視窗中有「上次選擇」的傳說色帶 → 點那張卡片（色帶下方）
  if (light >= 0.15) {
    const chip = scan(f, isLegendary, { x0: 0.1, x1: 0.9, y0: 0.1, y1: 0.9 });
    if (chip.n >= 6 && chip.maxX - chip.minX < W * 0.3) {
      return {
        kind: 'start-skill',
        x: (chip.minX + chip.maxX + 1) / 2 / W,
        y: (chip.maxY + 1) / H + 0.06,
      };
    }
  }

  // 置中的亮色對話框且背景被遮罩壓暗：點右下角的按鈕（仍要離開 / 繼續）
  if (light < 0.35) {
    const box = scan(f, isLight, { x0: 0.15, x1: 0.85, y0: 0.15, y1: 0.85 });
    if (box.n > 0) {
      const bw = box.maxX - box.minX + 1;
      const bh = box.maxY - box.minY + 1;
      const cx = (box.minX + box.maxX + 1) / 2 / W;
      const cy = (box.minY + box.maxY + 1) / 2 / H;
      const density = box.n / (bw * bh);
      const area = (bw * bh) / (W * H);
      const centered = Math.abs(cx - 0.5) < 0.12 && Math.abs(cy - 0.5) < 0.15;
      if (density >= 0.55 && area >= 0.02 && area <= 0.45 && centered && outsideLuma(f, box) < 85) {
        return { kind: 'dialog', x: (box.minX + 0.9 * bw) / W, y: (box.minY + 0.8 * bh) / H };
      }
    }
  }
  return null;
}

/** 在升級視窗範圍內找各稀有度外框，依 x 間隔分成一張張卡，回傳最高稀有度那張卡的中心 */
export function pickRarestCard(f: Frame): { x: number; y: number; rarity: string } | null {
  const W = f.width;
  const H = f.height;
  const minPixels = Math.max(6, W * H * 0.0008);
  for (const { name, rgb } of RARITY_BORDERS) {
    const pts: [number, number][] = [];
    for (let y = Math.floor(0.12 * H); y < Math.ceil(0.85 * H); y++) {
      for (let x = Math.floor(0.1 * W); x < Math.ceil(0.9 * W); x++) {
        const i = (y * W + x) * 4;
        const dr = f.data[i]! - rgb[0];
        const dg = f.data[i + 1]! - rgb[1];
        const db = f.data[i + 2]! - rgb[2];
        if (dr * dr + dg * dg + db * db <= 45 * 45) pts.push([x, y]);
      }
    }
    if (pts.length < minPixels) continue;
    // 依 x 排序，間隔 > 2% 寬就是不同張卡
    pts.sort((a, b) => a[0] - b[0]);
    const cards: [number, number][][] = [[]];
    for (let k = 0; k < pts.length; k++) {
      if (k > 0 && pts[k]![0] - pts[k - 1]![0] > 0.02 * W) cards.push([]);
      cards[cards.length - 1]!.push(pts[k]!);
    }
    // 卡片外框是高的矩形；扁的同色區塊（例如初始技能「上次選擇」色帶，與進化色相同）不算
    const tall = cards.filter((c) => {
      const ys = c.map((p) => p[1]);
      return c.length >= minPixels && Math.max(...ys) - Math.min(...ys) >= 0.15 * H;
    });
    if (tall.length === 0) continue;
    const best = tall.reduce((a, b) => (b.length > a.length ? b : a));
    const xs = best.map((p) => p[0]);
    const ys = best.map((p) => p[1]);
    return {
      x: (Math.min(...xs) + Math.max(...xs) + 1) / 2 / W,
      y: (Math.min(...ys) + Math.max(...ys) + 1) / 2 / H,
      rarity: name,
    };
  }
  return null;
}

export interface ScreenHandler {
  /** 每次取樣後呼叫；需要點擊時回傳動作，否則 null */
  update(action: ScreenAction | null, now: number): ScreenAction | null;
}

/** 同一種畫面連續 confirm 次才動作；動作後冷卻 cooldownMs（等畫面切換） */
export function createScreenHandler(confirm = 2, cooldownMs = 2500): ScreenHandler {
  let last: ScreenKind | null = null;
  let streak = 0;
  let readyAt = 0;
  return {
    update(action, now) {
      if (!action) {
        last = null;
        streak = 0;
        return null;
      }
      streak = action.kind === last ? streak + 1 : 1;
      last = action.kind;
      if (streak < confirm || now < readyAt) return null;
      readyAt = now + cooldownMs;
      streak = 0;
      return action;
    },
  };
}
