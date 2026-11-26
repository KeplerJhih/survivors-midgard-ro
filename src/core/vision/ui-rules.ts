import type { Frame } from './frame';
import { cx, cy, inside, lumaOf, rh, rows, rw, type Region } from './layout';
import type { ScreenAction } from './screens';

/**
 * 以版面結構（區塊的形狀、大小、排列）判斷畫面並決定要點哪裡；不依賴特定 UI 顏色。
 * 依遊戲程式（ui/menus.gd）的版面：
 * - 腐化寶箱：兩張卡並排、各有「選擇這條路」按鈕，左 Hel 右 Valhalla → 點右卡按鈕
 * - 初始技能：卡片頂端有「上次選擇」小色帶 → 點那張；沒有就點第一張
 * - 升級：一排 2~4 張卡（無按鈕）→ 稀有度最高（稀有度本身由外框色表示，僅此處比較顏色）
 * - 結算：近全寬面板，最下排 4 顆按鈕 [選擇目的地][再玩一次][前往城鎮][更換職業] → 第 2 顆
 * - 確認框/對話：非全寬面板，最下排 2 顆按鈕 → 最右（[要再想想][仍要離開]、[離開遊戲][留下]、任務 [先不要][我來幫忙！] 最右皆為想要的）
 * - 置中單一寬按鈕（新卡片/暫停選單「繼續」）→ 點它（必須先於「最寬按鈕」，暫停選單最下排有「放棄本局」）
 * - 選地圖/準備：最下排有明顯最寬的按鈕（選擇、出發冒險）→ 點它
 * - 初始技能（選項格）：等大的面板排成格子 → 與眾不同（上次選擇）的那張，否則第一張
 */
export type RarityRank = (rgb: [number, number, number]) => number;

/** 卡片外框平均色 → 稀有度等級（越大越稀有）；-1 表示無法判斷 */
export const defaultRarity: RarityRank = ([r, g, b]) => {
  const palette: [number, [number, number, number]][] = [
    [4, [217, 107, 13]], // 進化
    [3, [255, 173, 38]], // 傳說
    [2, [179, 89, 242]], // 史詩
    [1, [77, 140, 255]], // 稀有
  ];
  let best = 0;
  let bestD = 60 * 60;
  for (const [rank, c] of palette) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestD) (bestD = d), (best = rank);
  }
  return best;
};

/** 卡片外框一圈（外擴 1~2px）的「最飽和」像素平均色 */
function borderColor(f: Frame, r: Region): [number, number, number] {
  const W = f.width;
  const H = f.height;
  const pts: [number, number, number][] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    pts.push([f.data[i]!, f.data[i + 1]!, f.data[i + 2]!]);
  };
  const X0 = Math.round(r.x0 * W), X1 = Math.round(r.x1 * W), Y0 = Math.round(r.y0 * H), Y1 = Math.round(r.y1 * H);
  for (const d of [1, 2]) {
    for (let x = X0; x < X1; x += 2) push(x, Y0 - d), push(x, Y1 - 1 + d);
    for (let y = Y0; y < Y1; y += 2) push(X0 - d, y), push(X1 - 1 + d, y);
  }
  const sat = (p: [number, number, number]) => Math.max(...p) - Math.min(...p);
  pts.sort((a, b) => sat(b) - sat(a));
  const top = pts.slice(0, Math.max(1, Math.floor(pts.length * 0.3)));
  const avg = [0, 1, 2].map((k) => Math.round(top.reduce((s, p) => s + p[k]!, 0) / top.length));
  return avg as [number, number, number];
}

const tap = (kind: ScreenAction['kind'], r: Region): ScreenAction => ({ kind, x: cx(r), y: cy(r) });

export interface LayoutOptions {
  /** 轉職選哪條路（左＝第一條、右＝第二條）；只有一條路的職業不受影響 */
  jobPath?: 'first' | 'second';
}

export function decideByLayout(
  f: Frame,
  regions: Region[],
  rarity: RarityRank = defaultRarity,
  opts: LayoutOptions = {},
): ScreenAction | null {
  const act = decideCore(f, regions, rarity, opts);
  if (act?.kind !== 'result') return act;
  const found = keepTiles(regions, f.width / f.height);
  if (!found.length) return act;
  // 往左推不超出包住物品列的大面板（面板外是遊戲畫面，起伏也大）
  const box = regions
    .filter((r) => r.x0 <= found[0]!.x && r.x1 >= found[0]!.x && r.y0 <= found[0]!.y && r.y1 >= found[0]!.y && rw(r) * rh(r) >= 0.2)
    .sort((a, b) => rw(b) * rh(b) - rw(a) * rh(a))[0];
  const keep = extendKeepLeft(f, found, box ? box.x0 : 0.03);
  return { ...act, keep, keepTabs: keepTabs(regions, found) };
}

/**
 * 物品格常有一部分切不出來（相鄰格、角標黏在一起；實機 17 格只切出中間 5 格 → 點到中間、評分最高的左邊幾格沒帶）。
 * 用切出的格距往左一格一格推：那格的亮度起伏夠大（有物品圖示）就補上，碰到平坦的面板底色就停。
 */
function extendKeepLeft(f: Frame, keep: { x: number; y: number; w?: number }[], minX: number): { x: number; y: number }[] {
  if (keep.length < 2) return keep;
  const gaps = keep.slice(1).map((k, i) => k.x - keep[i]!.x).sort((a, b) => a - b);
  let pitch = gaps[gaps.length >> 1]!;
  // 切出的格子可能隔一格才有一個（實機格距算成 0.105、實際 0.05）→ 用格寬校正：格距約 1.25 倍格寬
  const ws = keep.map((k) => k.w ?? 0).filter((w) => w > 0).sort((a, b) => a - b);
  const tileW = ws.length ? ws[ws.length >> 1]! : 0;
  if (tileW > 0 && pitch > 1.7 * tileW) pitch = pitch / Math.max(1, Math.round(pitch / (1.25 * tileW)));
  if (pitch <= 0.01 || pitch > 0.12) return keep;
  const { width: W, height: H, data } = f;
  const halfW = 0.35 * pitch;
  const halfH = (halfW * W) / H;
  const busy = (cx: number, cy: number) => {
    const x0 = Math.round((cx - halfW) * W), x1 = Math.round((cx + halfW) * W);
    const y0 = Math.round((cy - halfH) * H), y1 = Math.round((cy + halfH) * H);
    if (x0 < 0 || y0 < 0 || x1 >= W || y1 >= H) return false;
    let n = 0, sum = 0, sq = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * W + x) * 4;
        const l = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
        n++;
        sum += l;
        sq += l * l;
      }
    const mean = sum / n;
    return Math.sqrt(Math.max(0, sq / n - mean * mean)) > 25;
  };
  const out = [...keep];
  const y = keep[0]!.y;
  for (let x = keep[0]!.x - pitch; x - halfW > minX + 0.005 && out.length < keep.length + 20; x -= pitch) {
    if (!busy(x, y)) break;
    out.unshift({ x, y });
  }
  return out;
}

/**
 * 物品格正上方一排按鈕＝稀有度分頁（_keep_section：傳說 / 紫色 / 其餘，0 件的停用、切不出來）。
 * 實機（1568×713）：格頂 0.763，分頁 y 0.67~0.72；目前分頁是按下狀態、比較暗（亮度 222 vs 252）。
 */
export function keepTabs(regions: Region[], keep: { x: number; y: number }[]): { x: number; y: number; pressed: boolean }[] {
  const rowY = keep[0]!.y;
  const tabs = regions
    .filter((r) => r.kind === 'button' && cy(r) < rowY - 0.05 && cy(r) > rowY - 0.2)
    .sort((a, b) => a.x0 - b.x0);
  if (!tabs.length) return [];
  // 只取同一排（中心高度相近）的
  const y0 = cy(tabs[0]!);
  const row = tabs.filter((t) => Math.abs(cy(t) - y0) <= 0.02);
  const minL = Math.min(...row.map((t) => t.luma));
  const maxL = Math.max(...row.map((t) => t.luma));
  return row.map((t) => ({ x: cx(t), y: cy(t), pressed: maxL - minL >= 12 && t.luma === minL }));
}

/**
 * 結算頁「帶回 Kafra 倉庫」物品格（ui/menus.gd _keep_section）：一排等大、近正方形的小格，遊戲已依評分由高到低排序。
 * 實機（1568×713）：格高 0.069H、寬 0.03W（≈正方形）、16 格排一列。
 * 倉庫已有同款的格子右上角有「x1」標籤，外框往上凸出 → 頂端比整排高出一截者排除（不靠顏色）。
 */
export function keepTiles(regions: Region[], aspect: number): { x: number; y: number; w?: number }[] {
  const cand = regions.filter((r) => {
    const h = rh(r);
    const ratio = (rw(r) * aspect) / h;
    // 只看下半部：上方角色面板的技能圖示也是一排近正方形小圖
    // 最下排按鈕列（選擇目的地 / 再玩一次 / 前往 Prontera）在 0.92 以下；物品格底邊實機 0.83~0.86
    // （實機：結算頁被暗化時把底部按鈕殘片當物品格 → 點到按鈕列、之後誤點「前往 Prontera」回城）
    return r.y0 >= 0.55 && r.y1 <= 0.9 && h >= 0.04 && h <= 0.11 && ratio >= 0.6 && ratio <= 1.5 && r.kind !== 'button';
  });
  // 以底邊分排，取最多格的一排（≥ 4 格、寬度相近）
  const groups: Region[][] = [];
  for (const r of cand) {
    const g = groups.find((g) => Math.abs(g[0]!.y1 - r.y1) <= 0.012);
    if (g) g.push(r);
    else groups.push([r]);
  }
  // 只在已認出結算頁時才呼叫 → 1 格也算（實機：只有 3 件可帶，原本要求 ≥ 4 格 → 一件都沒帶）
  // 物品格正上方有一排分頁鈕（傳說 / 紫色 / 其餘）；上方「本局卡片」列的卡片圖示也是近正方形
  // （實機：只有 1 件可帶時，卡片圖示和物品格各 1 格同票 → 點到卡片、物品沒帶走）
  // → 先看上方有沒有分頁鈕，再比格數，同分取較下面那排
  const buttons = regions.filter((r) => r.kind === 'button');
  const hasTabs = (g: Region[]) => {
    const y = cy(g[0]!);
    const above = buttons.filter((b) => cy(b) < y - 0.03 && cy(b) > y - 0.2);
    return above.some((b) => above.filter((o) => Math.abs(cy(o) - cy(b)) <= 0.02).length >= 2);
  };
  const row = groups.sort(
    (a, b) => Number(hasTabs(b)) - Number(hasTabs(a)) || b.length - a.length || b[0]!.y1 - a[0]!.y1,
  )[0];
  if (!row) return [];
  const ws = row.map(rw).sort((a, b) => a - b);
  const medW = ws[ws.length >> 1]!;
  const tops = row.map((r) => r.y0).sort((a, b) => a - b);
  const medTop = tops[tops.length >> 1]!;
  return row
    // 「x1」標籤讓頂端高出約 0.031；被上方篩選鈕黏住只高 0.017（實機）→ 門檻 0.02
    .filter((r) => Math.abs(rw(r) - medW) <= medW * 0.35 && r.y0 >= medTop - 0.02)
    .sort((a, b) => a.x0 - b.x0)
    .map((r) => ({ x: cx(r), y: cy(r), w: rw(r) }));
}

function decideCore(
  f: Frame,
  regions: Region[],
  rarity: RarityRank,
  opts: LayoutOptions,
): ScreenAction | null {
  // 結算頁大面板：遊戲 UI 依畫面高度縮放 → 以「寬 / 高」判斷，與視窗比例無關。
  // 實機：16:9 時面板寬 0.92W（=1.64H），1568×713 寬畫面只有 0.71W（=1.56H）→ 原本「≥ 0.8W」認不出來，
  // Enter 備援按到預設焦點「選擇目的地」而換地圖。暫停選單約 0.93H → 門檻 1.2H 分得開
  const aspect = f.width / f.height;
  // 窄視窗（1080×869，寬高比 1.24）UI 改依寬度縮放：結算頁面板 0.88W＝1.1H，「≥ 1.2H」認不出來 →
  // 兩顆按鈕被當成確認框、點右邊「前往 Prontera」回城（實機）。橫向佔 ≥ 0.85W 也算
  const isWide = (r: Region) => rw(r) * aspect >= 1.2 || rw(r) >= 0.85;
  const buttons = regions.filter((r) => r.kind === 'button');
  const panels = regions.filter((r) => r.kind === 'panel');
  const cards = regions.filter((r) => r.kind === 'card');

  // ---- 腐化寶箱：兩個大小相同、並排、各含一顆按鈕的區塊（卡片偏方，會被歸為 panel 或 card）----
  const boxes = regions.filter((r) => (r.kind === 'panel' || r.kind === 'card') && rw(r) < 0.6 && rh(r) >= 0.2);
  for (const pair of rows(boxes, 0.03, 0.05)) {
    if (pair.length !== 2) continue;
    const [a, b] = pair as [Region, Region];
    if (Math.abs(rw(a) - rw(b)) > 0.03) continue;
    // 按鈕在卡片底部（「選擇這條路」）；同一排沒有第三塊同高的面板。
    // 實機：結算頁的角色面板［匯出配置］＋傷害報告［查看詳情］被當成腐化寶箱，點開傷害詳情小視窗、擋住帶物品與下一局
    const atBottom = (x: Region, card: Region) => inside(x, card, 0.01) && cy(x) >= card.y1 - 0.25 * rh(card);
    const third = regions.some(
      (o) => o !== a && o !== b && rh(o) >= 0.2 && rw(o) >= 0.15 && Math.abs(cy(o) - cy(a)) < 0.05 && Math.abs(rh(o) - rh(a)) < 0.05,
    );
    if (third) continue;
    const btnA = buttons.find((x) => atBottom(x, a));
    const btnB = buttons.find((x) => atBottom(x, b));
    // 點右卡（Valhalla）的水平中心：按鈕在卡片內置中。實機切出的按鈕有時連到左卡 → 中心落在兩卡之間（0.506）沒點到
    if (btnA && btnB) return { kind: 'corrupt', x: cx(b), y: cy(btnB) };
  }

  // ---- 轉職（Base Lv 20）----
  const job = jobChange(regions, opts.jobPath === 'second' ? 1 : 0);
  if (job) return { kind: 'job', ...job };

  // ---- 卡片列 ----
  // 卡片列必須被一個大區塊包住（升級視窗）：MVP 戰的技能白光、左側 MVP 技能面板曾被誤判成卡片。
  // 不限種類：卡片佔掉面板大部分面積，面板填滿率低時會被歸為 other
  const bigPanels = regions.filter((r) => rw(r) * rh(r) >= 0.2);
  const cardRow = rows(cards, 0.05, 0.12)
    .filter((g) => g.length >= 2 && g.length <= 4)
    .filter((g) => bigPanels.some((p) => g.every((c) => inside(c, p, 0.03))))
    // 卡片彼此相鄰（間距 ≤ 一張卡寬）：實機結算頁開了「傷害詳情」小視窗，左右兩邊露出的面板邊被當成兩張卡一直點
    .filter((g) => g.every((c, k) => k === 0 || c.x0 - g[k - 1]!.x1 <= Math.max(rw(c), rw(g[k - 1]!))))
    .sort((a, b) => b.length - a.length)[0];
  if (cardRow) {
    const ranks = cardRow.map((c) => rarity(borderColor(f, c)));
    const top = Math.max(...ranks);
    const pick = cardRow[ranks.indexOf(top)]!;
    return tap(top > 0 ? 'level-up' : 'start-skill', pick);
  }

  // ---- 按鈕列 ----
  const buttonRows = rows(buttons);
  // 按鈕排所屬的面板：按鈕都在面板左右範圍內，且排位於面板內或緊貼其下方（≤ 8%）。
  // 容器也接受直立的 card（選地圖右側面板被歸為 card），以及面積 ≥ 10% 的 other
  // （準備畫面大面板內含許多子面板、填滿率低被歸為 other）
  const containers = regions.filter(
    (r) => r.kind === 'panel' || r.kind === 'card' || (r.kind === 'other' && rw(r) * rh(r) >= 0.1),
  );
  const container = (row: Region[]) =>
    containers
      .filter(
        (p) =>
          row.every((b) => b.x0 >= p.x0 - 0.02 && b.x1 <= p.x1 + 0.02) &&
          cy(row[0]!) > p.y0 + 0.3 * rh(p) &&
          cy(row[0]!) <= p.y1 + 0.08,
      )
      .sort((a, b) => rw(a) * rh(a) - rw(b) * rh(b))[0];
  // 只看屬於某個面板的按鈕排（排除畫面底部 HUD 的「已保留寶箱 [開啟]」等），取最下面那排
  const bottom = buttonRows
    .filter((g) => g.length >= 2 && container(g))
    .sort((a, b) => cy(b[0]!) - cy(a[0]!))[0];

  // 結算：近全寬面板最下排。4 顆 [選擇目的地][再玩一次][前往城鎮][更換職業] → 第 2 顆；
  // 沒解鎖新地圖時沒有「選擇目的地」只剩 3 顆 [再玩一次][前往城鎮][更換職業] → 第 1 顆
  // （實機：3 顆時落到「最寬按鈕」規則，點了字最多的「前往 Prontera · 可以轉生！」而進城鎮）
  // 必須在畫面底部（城鎮左上 [選單][角色][頻道][衣櫃] 也是 4 顆一排）
  if (bottom && (bottom.length === 4 || bottom.length === 3) && cy(bottom[0]!) >= 0.75) {
    const p = container(bottom);
    if (p && isWide(p)) return tap('result', bottom[bottom.length === 4 ? 1 : 0]!);
  }
  // 結算頁（全螢幕面板、最下排在畫面底部）：按鈕邊框淡，切出幾顆不一定（實機：有時頭尾兩顆、有時中間兩顆被當成
  // 一般對話框點了「前往 Prontera」進城鎮）→ 直接沿按鈕底邊掃圓角記號切出每顆按鈕
  const resultBox = regions.find((r) => isWide(r) && rh(r) >= 0.7 && Math.abs(cx(r) - 0.5) < 0.06);
  if (resultBox) {
    // 有切出底排（在畫面底部）就沿它的底邊掃；否則掃畫面底部 88~99%
    // （實機：一顆都切不出來 → 點成一般視窗進城鎮；開了「傷害詳情」小視窗時最下排變成上方的統計格）
    const atBottom = bottom && cy(bottom[0]!) >= 0.85;
    const hit = atBottom
      ? resultSlots(f, Math.max(...bottom.map((r) => r.y1)), Math.max(2, Math.round(0.012 * f.height)))
      : resultSlots(f, Math.min(0.99, resultBox.y1), Math.round(0.12 * f.height));
    // 掃出的位置落在已切出的按鈕上 → 改點那顆按鈕中心（實機窄視窗：記號掃出 0.401，剛好在「再玩一次」0.348~0.402 右緣）
    const snap = (x: number, y: number) => {
      const b = atBottom ? bottom.find((r) => x >= r.x0 - 0.01 && x <= r.x1 + 0.01) : undefined;
      return b ? { kind: 'result' as const, x: cx(b), y: cy(b) } : { kind: 'result' as const, x, y };
    };
    if (hit && hit.slots.length === 4) return snap(hit.slots[1]!, hit.y);
    if (hit && hit.slots.length === 3) return snap(hit.slots[0]!, hit.y);
  }
  // 結算（無盡模式「你倒下了」）：4 顆中間兩顆（再玩一次、前往城鎮）邊框淡、切不出來，只剩頭尾兩顆、中間空很大
  // （實機：0.361~0.422 與 0.588~0.639）→ 點空隙前 1/4（再玩一次，實際 0.43~0.49）
  if (bottom && bottom.length === 2 && cy(bottom[0]!) >= 0.85) {
    const p = container(bottom);
    const [a, b] = bottom as [Region, Region];
    const gap = b.x0 - a.x1;
    if (p && isWide(p) && gap > 1.5 * ((rw(a) + rw(b)) / 2))
      return { kind: 'result', x: a.x1 + gap * 0.25, y: cy(a) };
  }
  if (bottom && bottom.length === 2) {
    // 不限置中：任務 NPC 視窗在左側（[先不要][我來幫忙！]）
    const p = container(bottom);
    // 有焦點藍框的那顆優先（Godot 預設焦點＝遊戲預設選項）。實機：結算頁「不存放裝備？」視窗
    // [重新選擇][仍要離開]，焦點在左邊重新選擇（ui/menus.gd back.grab_focus）；原本固定點右邊 → 裝備全丟、回城
    if (p && !isWide(p)) {
      const focused = bottom.filter((b) => hasFocusFrame(f, b));
      return tap('dialog', focused.length === 1 ? focused[0]! : bottom[1]!);
    }
  }
  // 小面板內上下疊兩顆等寬的寬按鈕（MVP 勝利「繼續無盡模式／結束本局」）→ 點上面那顆（遊戲預設焦點、主要選項）
  const stacked = stackedPair(regions, buttons) ?? mergedStack(regions);
  if (stacked) return tap('dialog', stacked);
  // 置中、獨立的亮區塊，且周圍被壓暗（遮罩）→ 對話框；按鈕一律靠右下（ALIGNMENT_END）→ 點右下角
  // 實機：「不存放就離開？」的兩顆小按鈕邊框太淡切不出來，整個對話框被當成一塊
  const dlg = dimmedDialog(f, regions);
  if (dlg) {
    // 對話框內有焦點藍框按鈕（Godot 預設焦點＝主要動作）→ 點它。實機首領寶箱 [全部販賣 (F)][繼續]：
    // 右下角是空白，每次點兩下沒反應才靠 Enter 備援
    // 小對話框（勝利選擇 [以無盡模式繼續 (焦點)][結束本局]，面積 < 0.15）也要找 → 直接在對話框內找。
    // 實機：點右下角落在兩顆之間 → 結束了本局
    // 先看切得出來的按鈕外框有沒有焦點藍框；再在對話框下半部直接找藍框（上半部是標題列，實機有藍色誤判）
    const fb = buttons.filter((b) => inside(b, dlg, 0.01) && hasFocusFrame(f, b));
    if (fb.length === 1) return tap('dialog', fb[0]!);
    const focus = focusedButtonIn(f, dlg, 0.5);
    if (focus) return { kind: 'dialog', ...focus };
    return { kind: 'dialog', x: dlg.x0 + 0.9 * rw(dlg), y: dlg.y0 + 0.8 * rh(dlg) };
  }

  // 置中單一寬按鈕（獨自一排）
  const frag = bottomFragment(regions);
  const wide = buttonRows
    .filter((g) => g.length === 1)
    .map((g) => g[0]!)
    // 必須在畫面 30% 以下（上方首領血條面板曾被誤判），且位於某個較大面板的下半部
    // （底部 HUD「已保留 N 個寶箱 [開啟]」曾被誤判）
    .filter((b) => rw(b) >= 0.2 && Math.abs(cx(b) - 0.5) < 0.1 && cy(b) >= 0.3)
    .filter((b) =>
      panels.some((p) => rw(p) * rh(p) >= 0.05 && rw(p) > rw(b) && b.x0 >= p.x0 - 0.02 && b.x1 <= p.x1 + 0.02 && cy(b) > cy(p) && cy(b) <= p.y1 + 0.05),
    )
    // 下方還有「獨自一排」的按鈕時，那顆才是動作按鈕（實機：任務完成視窗把寬的獎勵列當成按鈕一直點，
    // 真正的「繼續」是右下小按鈕）；暫停選單「繼續」下方是 4 顆一排的選單，不受影響
    .filter((b) => !buttonRows.some((g) => g.length === 1 && g[0] !== b && cy(g[0]!) > cy(b) + 0.03 && cy(g[0]!) - cy(b) < 0.3))
    // 寶箱視窗：獎勵列（寬、像按鈕）下方沒有按鈕、只有被文字切碎的小「繼續」→ 不點獎勵列（實機：一直點「Mace」列卡住）；
    // 暫停選單「繼續」下方有一排按鈕，不受影響
    .filter((b) => !(frag && cy(frag) > cy(b) + 0.03 && !buttons.some((x) => x !== b && cy(x) > cy(b) + 0.03)))
    .sort((a, b) => cy(b) - cy(a))[0];
  if (wide) return tap('modal', wide);
  // 最下排明顯最寬的按鈕（準備「出發冒險！」等）；全寬面板（結算頁）不適用
  if (bottom) {
    const p = container(bottom);
    const byWidth = [...bottom].sort((a, b) => rw(b) - rw(a));
    if ((!p || !isWide(p)) && rw(byWidth[0]!) >= 1.4 * rw(byWidth[1]!)) return tap('map-select', byWidth[0]!);
  }
  // 大區塊右下角獨自一排的按鈕（選地圖「選擇 ▶」：返回/狂熱太小切不出來，只剩它）
  const corner = cornerButton(regions, buttons);
  if (corner) return tap('map-select', corner);
  // 選項格（初始技能等）：同一大區塊內 ≥2 個等大、無按鈕的面板 → 點「與眾不同」的那張（上次選擇有不同色帶），否則第一張
  const grid = optionGrid(f, regions, buttons);
  if (grid) return tap('start-skill', grid);
  // 小卡格（被催眠「等級要轉給誰？」：一個大面板裡 ≥5 張等寬小卡、沒有按鈕）→ 點左上第一張
  const tile = tileGrid(regions);
  if (tile) return tap('modal', tile);
  // 置中大視窗內、底部的「焦點框」按鈕（Godot 預設焦點的藍框＝主要動作）優先於按鈕殘片：
  // 實機 MVP 寶箱視窗「全部販賣 (F)」「繼續 (Enter)」→ 殘片只切得出左邊的販賣鈕 → 每次都把寶箱裝備賣掉，
  // 賣完按鈕變灰還一直點它而卡住（ui/menus.gd：ok.grab_focus，繼續有藍框）
  const focus = focusedButton(f, regions);
  if (focus) return { kind: 'modal', ...focus };
  // 置中的視窗裡切不出按鈕（小按鈕被文字切碎）：點面板底部中線附近的小亮塊（按鈕殘片）
  if (frag) {
    // 寶箱視窗底排固定是 [全部販賣 (F)][繼續]（ui/menus.gd）：切出來的若是中線左邊、夠寬的完整按鈕＝全部販賣，
    // 「繼續」緊貼在它右邊（實機：繼續只有兩個字、切不出來，焦點藍框也沒認到時會點到全部販賣把裝備賣掉）
    const panelCx = 0.5;
    if (rw(frag) >= 0.06 && cx(frag) < panelCx - 0.01)
      return { kind: 'modal', x: frag.x1 + 0.025, y: cy(frag) };
    return tap('modal', frag);
  }
  return null;
}

/**
 * 實機：累積 8 個寶箱的清單視窗（高到螢幕邊、card 0.27~0.73 × 0~1）底部「全部販賣」「繼續」邊框太淡、
 * 內部與面板同色 → 版面切不出任何東西；只有預設焦點的「繼續」有明顯藍框 (b-r ≥ 40)。
 * 在置中大視窗底部 25% 找藍框外框（寬 2~25%、高 1.5~10%），取最下面的點中心。
 */
/** 按鈕外框（往外 1~3px）有 Godot 焦點藍框 (b ≥ 150、b-r ≥ 40、b-g ≥ 20) */
function hasFocusFrame(f: Frame, r: Region): boolean {
  const { width: W, height: H, data } = f;
  const x0 = Math.round(r.x0 * W), x1 = Math.round(r.x1 * W), y0 = Math.round(r.y0 * H), y1 = Math.round(r.y1 * H);
  // 四邊分開算，至少 3 邊有藍框才算：相鄰按鈕的焦點框會落在這顆的外圈一側
  // （實機首領寶箱 [全部販賣][繼續] 緊貼：販賣鈕右側外圈＝繼續的藍框 → 被當成焦點，點了全部販賣把 Earring 賣掉）
  const side = [0, 0, 0, 0], tot = [0, 0, 0, 0];
  const at = (k: number, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    tot[k]!++;
    const i = (y * W + x) * 4;
    const R = data[i]!, G = data[i + 1]!, B = data[i + 2]!;
    if (B >= 150 && B - R >= 40 && B - G >= 20) side[k]!++;
  };
  for (let d = 0; d <= 3; d++) {
    for (let x = x0; x < x1; x++) (at(0, x, y0 - d), at(1, x, y1 - 1 + d));
    for (let y = y0; y < y1; y++) (at(2, x0 - d, y), at(3, x1 - 1 + d, y));
  }
  const lit = side.filter((n, k) => tot[k]! > 0 && n >= 0.15 * tot[k]!).length;
  return lit >= 3;
}

function focusedButton(f: Frame, regions: Region[]): { x: number; y: number } | null {
  const box = regions.find(
    // 寬 < 0.95：視窗不會貼滿左右兩側；實機 MVP 巢穴淺色石板地被切成滿版面板 → 把技能列藍框當「繼續」一直點
    (r) => (r.kind === 'panel' || r.kind === 'card') && Math.abs(cx(r) - 0.5) < 0.06 && rw(r) < 0.95 && rw(r) * rh(r) >= 0.15 && r.fill >= 0.5,
  );
  return box ? focusedButtonIn(f, box, 0.25) : null;
}

/** 在 box 底部 bottomFrac 範圍內找焦點藍框按鈕（取最下排、同排取最右） */
function focusedButtonIn(f: Frame, box: Region, bottomFrac: number): { x: number; y: number } | null {
  const { width: W, height: H, data } = f;
  const x0 = Math.round(box.x0 * W), x1 = Math.round(box.x1 * W);
  const y0 = Math.round((box.y1 - bottomFrac * rh(box)) * H), y1 = Math.min(H, Math.round(box.y1 * H));
  const ok = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      if (b >= 150 && b - r >= 40 && b - g >= 20) ok[y * W + x] = 1;
    }
  const seen = new Uint8Array(W * H);
  let best: { x: number; y: number } | null = null;
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!ok[p0] || seen[p0]) continue;
    seen[p0] = 1;
    const stack = [p0];
    let n = 0, mnx = W, mxx = 0, mny = H, mxy = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      n++;
      if (x < mnx) mnx = x;
      if (x > mxx) mxx = x;
      if (y < mny) mny = y;
      if (y > mxy) mxy = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (ok[q] && !seen[q]) (seen[q] = 1), stack.push(q);
        }
    }
    const w = (mxx - mnx + 1) / W, h = (mxy - mny + 1) / H;
    const perimeter = 2 * (mxx - mnx + mxy - mny + 2);
    // 寬到 0.4：勝利選擇的「以無盡模式繼續」寬 0.27W（實機）
    if (w < 0.02 || w > 0.4 || h < 0.015 || h > 0.1 || n < perimeter * 0.3) continue;
    const c = { x: (mnx + mxx + 1) / 2 / W, y: (mny + mxy + 1) / 2 / H };
    // 取最下面一排；同一排有好幾個藍框時取最右邊（遊戲對話框的主要動作放最後，如寶箱「繼續」在「全部販賣」右邊）
    if (!best || c.y > best.y + 0.02 || (Math.abs(c.y - best.y) <= 0.02 && c.x > best.x)) best = c;
  }
  return best;
}

/**
 * 結算頁底排按鈕：在按鈕底邊上方幾列（或整個畫面底部），找暗色圓角記號（亮度 < 200），相距 ≤ 1.5% 的記號歸成一群；
 * 群 k 與群 k+1 之間就是第 k 顆按鈕（實機：4 顆 → 5 群）。回傳各按鈕中心 x。
 */
function resultSlots(f: Frame, bottomY: number, rows: number): { slots: number[]; y: number } | null {
  const { width: W, height: H, data } = f;
  let best: { slots: number[]; y: number } | null = null;
  for (let dy = 1; dy <= rows; dy++) {
    const y = Math.round(bottomY * H) - dy;
    if (y < 0) break;
    const marks: number[] = [];
    for (let x = Math.round(0.15 * W); x < Math.round(0.85 * W); x++) {
      const i = (y * W + x) * 4;
      if (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! < 200) marks.push(x);
    }
    const groups: number[][] = [];
    for (const x of marks) {
      const g = groups[groups.length - 1];
      if (g && x - g[g.length - 1]! <= 0.015 * W) g.push(x);
      else groups.push([x]);
    }
    if (groups.length < 4 || groups.length > 5) continue;
    const centers = groups.map((g) => (g[0]! + g[g.length - 1]!) / 2 / W);
    const slots = centers.slice(1).map((c, k) => (centers[k]! + c) / 2);
    // 每顆寬 3~15%、整排置中（± 8%）。例外：完整 4 顆（5 條邊界）時第一顆「選擇目的地」可到 25%
    // （實機：「選擇目的地 · Glast Heim 已解鎖！」寬 0.155 → 認不出、卡在結算頁）。
    // 不完整時維持嚴格：無盡模式中間兩顆切不出來時，放寬會把頭尾配錯而點到「選擇目的地」
    const maxW = (k: number) => (k === 0 && groups.length === 5 ? 0.25 : 0.15);
    if (!slots.every((_, k) => centers[k + 1]! - centers[k]! >= 0.03 && centers[k + 1]! - centers[k]! <= maxW(k))) continue;
    if (Math.abs((centers[0]! + centers[centers.length - 1]!) / 2 - 0.5) > 0.08) continue;
    if (!best || slots.length > best.slots.length) best = { slots, y: (y - 0.02 * H) / H };
  }
  return best;
}

/**
 * 實機（Golden Thief Bug 勝利後走進出口）：「擊敗 MVP！要繼續戰鬥嗎？」小面板（面積 ~0.08），
 * 兩顆等寬按鈕上下疊：上「繼續無盡模式」（主要、預設焦點）、下「結束本局」。原本被壓暗對話框規則點右下 → 點到結束。
 * 條件：面積 ≤ 0.15 的面板內，兩顆按鈕中心 x 差 < 0.02、寬差 < 0.03、寬 ≥ 面板寬 60%、上下相鄰（間距 < 0.1）。
 * 寶箱清單（面板 ~0.27）的獎勵列不受影響。
 */
function stackedPair(regions: Region[], buttons: Region[]): Region | null {
  for (const p of regions) {
    if ((p.kind !== 'panel' && p.kind !== 'card') || rw(p) * rh(p) > 0.15) continue;
    const inner = buttons.filter((b) => inside(b, p, 0.01) && rw(b) >= 0.6 * rw(p)).sort((a, b) => cy(a) - cy(b));
    if (inner.length !== 2) continue;
    const [top, bottom] = inner as [Region, Region];
    if (Math.abs(cx(top) - cx(bottom)) < 0.02 && Math.abs(rw(top) - rw(bottom)) < 0.03 && bottom.y0 - top.y1 < 0.1) return top;
  }
  return null;
}

/**
 * 同上，但兩顆按鈕間距太小被版面合併成一塊（實機全解析：面板 0.352~0.647 × 0.359~0.641，
 * 合併塊 0.367~0.633 × 0.526~0.618、高 0.092 ≈ 兩顆按鈕）→ 回傳上半部（上面那顆按鈕）。
 */
function mergedStack(regions: Region[]): Region | null {
  for (const p of regions) {
    if ((p.kind !== 'panel' && p.kind !== 'card') || rw(p) * rh(p) > 0.15 || rw(p) * rh(p) < 0.03) continue;
    const m = regions.find(
      (r) => r !== p && inside(r, p, 0.01) && rw(r) >= 0.8 * rw(p) && rh(r) >= 0.07 && rh(r) <= 0.13 && cy(r) > cy(p) && r.fill >= 0.6,
    );
    if (m) return { ...m, y1: m.y0 + rh(m) / 2 };
  }
  return null;
}

/**
 * 實機（被催眠師螺旋忘掉技能後）：「你腦中一片空白：等級要轉給誰？」全寬面板（面積 ~0.64）內 10~12 張小技能卡
 * （寬 ~0.11、高 0.12~0.15，圖示把卡片頂端切開所以高度不一，分類為 other），沒有按鈕。點左上第一張即可。
 */
function tileGrid(regions: Region[]): Region | null {
  const box = regions.find((r) => (r.kind === 'panel' || r.kind === 'card') && rw(r) * rh(r) >= 0.3);
  if (!box) return null;
  const tiles = regions.filter(
    (r) => r !== box && r.kind !== 'button' && inside(r, box, 0.01) && rw(r) >= 0.06 && rw(r) <= 0.2 && rh(r) >= 0.08 && rh(r) <= 0.25,
  );
  if (tiles.length < 5) return null;
  const widths = tiles.map(rw).sort((a, b) => a - b);
  const median = widths[widths.length >> 1]!;
  const same = tiles.filter((r) => Math.abs(rw(r) - median) <= 0.02);
  if (same.length < 5) return null;
  return [...same].sort((a, b) => (Math.abs(a.y1 - b.y1) > 0.05 ? a.y1 - b.y1 : a.x0 - b.x0))[0]!;
}

/**
 * 實機：寶箱視窗的「繼續」只有兩個字，按鈕內部被文字切成小塊（寬 2.8%、高 3.5%），不像按鈕。
 * 條件：置中大面板（面積 15~60%、填滿率 ≥ 0.5；累積寶箱清單視窗高 89~98%、被分類成 card、填滿率 0.57~0.67）；
 * 面板底部 15% 內、靠近中線（±10%）的小塊取最右邊（底列可能是「全部販賣」按鈕＋小「繼續」，確認鍵在右）。
 * 前面的規則都沒命中才會走到這裡。
 */
function bottomFragment(regions: Region[]): Region | null {
  const panel = regions.find(
    (r) =>
      (r.kind === 'panel' || r.kind === 'card') &&
      Math.abs(cx(r) - 0.5) < 0.06 &&
      Math.abs(cy(r) - 0.5) < 0.12 &&
      rw(r) * rh(r) >= 0.15 &&
      rw(r) * rh(r) <= 0.6 &&
      r.fill >= 0.5,
  );
  if (!panel) return null;
  const bottom = panel.y1 - 0.15 * rh(panel);
  return (
    regions
      .filter(
        (r) =>
          r !== panel &&
          inside(r, panel, 0.01) &&
          cy(r) >= bottom &&
          Math.abs(cx(r) - cx(panel)) < 0.1 &&
          rw(r) * rh(r) < 0.01,
      )
      .sort((a, b) => cx(b) - cx(a))[0] ?? null
  );
}

/**
 * 選項格：面積 ≥ 15% 的大區塊內，有 ≥ 2 個寬高相近（±3%）、內部沒有按鈕的面板。
 * 「上次選擇」的卡頂端色帶與其他卡不同（不寫死顏色：取與其他卡平均色差最大者，差距夠大才採用）。
 * 實機：初始技能 2×2 四張卡被歸為 panel（高 18~20%），外層為 other 大區塊。
 */
function optionGrid(f: Frame, regions: Region[], buttons: Region[]): Region | null {
  const outer = regions.filter((r) => rw(r) * rh(r) >= 0.15);
  for (const box of outer) {
    const opts = regions.filter(
      (r) =>
        r !== box &&
        r.kind === 'panel' &&
        inside(r, box, 0.01) &&
        rw(r) * rh(r) >= 0.015 &&
        !buttons.some((b) => inside(b, r, 0.005)),
    );
    const ref = opts[0];
    if (!ref) continue;
    const same = opts.filter((r) => Math.abs(rw(r) - rw(ref)) <= 0.03 && Math.abs(rh(r) - rh(ref)) <= 0.03);
    if (same.length < 2) continue;
    const ordered = [...same].sort((a, b) => (Math.abs(cy(a) - cy(b)) > 0.05 ? cy(a) - cy(b) : cx(a) - cx(b)));
    const bands = ordered.map((r) => topBand(f, r));
    const dist = bands.map((c, i) => {
      const others = bands.filter((_, j) => j !== i);
      const mean = [0, 1, 2].map((k) => others.reduce((s, o) => s + o[k]!, 0) / others.length);
      return Math.hypot(c[0]! - mean[0]!, c[1]! - mean[1]!, c[2]! - mean[2]!);
    });
    const best = dist.indexOf(Math.max(...dist));
    return ordered.length >= 3 && dist[best]! >= 40 ? ordered[best]! : ordered[0]!;
  }
  return null;
}

/** 區塊頂端（上緣上下各約 3%）一條橫帶的平均色 */
function topBand(f: Frame, r: Region): number[] {
  const W = f.width;
  const H = f.height;
  let n = 0;
  const sum: [number, number, number] = [0, 0, 0];
  for (let y = Math.max(0, Math.round((r.y0 - 0.03) * H)); y < Math.min(H, Math.round((r.y0 + 0.03) * H)); y++) {
    for (let x = Math.round(r.x0 * W); x < Math.round(r.x1 * W); x += 2) {
      const i = (y * W + x) * 4;
      sum[0] += f.data[i]!;
      sum[1] += f.data[i + 1]!;
      sum[2] += f.data[i + 2]!;
      n++;
    }
  }
  return sum.map((v) => v / Math.max(1, n));
}

/** 大區塊（面板或直立卡片，面積 ≥ 15%）底部 25% 內、同排沒有其他按鈕、靠右半邊的最下方按鈕 */
function cornerButton(regions: Region[], buttons: Region[]): Region | null {
  const boxes = regions
    .filter((r) => (r.kind === 'panel' || r.kind === 'card') && rw(r) * rh(r) >= 0.15 && rw(r) < 0.8)
    .sort((a, b) => rw(b) * rh(b) - rw(a) * rh(a));
  for (const box of boxes) {
    const inBox = buttons.filter((b) => b.x0 >= box.x0 - 0.01 && b.x1 <= box.x1 + 0.01 && cy(b) > box.y0 && cy(b) <= box.y1 + 0.03);
    const last = inBox.sort((a, b) => cy(b) - cy(a))[0];
    if (!last) continue;
    const alone = !inBox.some((b) => b !== last && Math.abs(cy(b) - cy(last)) < 0.02);
    const nearBottom = cy(last) >= box.y1 - 0.25 * rh(box);
    const rightSide = cx(last) >= cx(box);
    if (alone && nearBottom && rightSide) return last;
  }
  return null;
}

/**
 * 畫面中央獨立的亮區塊，且背後加了遮罩：區塊外平均亮度比它低 60 以上，
 * 且區塊外幾乎沒有亮像素（< 2%；一般遊玩畫面四角 HUD 面板是亮的、暫停選單/升級視窗本身也亮）
 */
function dimmedDialog(f: Frame, regions: Region[]): Region | null {
  const cand = regions
    .filter((r) => Math.abs(cx(r) - 0.5) < 0.12 && Math.abs(cy(r) - 0.5) < 0.15)
    .filter((r) => rw(r) * rh(r) >= 0.01 && rw(r) * rh(r) <= 0.2 && rw(r) >= 0.15)
    .sort((a, b) => rw(b) * rh(b) - rw(a) * rh(a))[0];
  if (!cand) return null;
  const L = lumaOf(f);
  const W = f.width;
  const H = f.height;
  let sum = 0;
  let n = 0;
  let bright = 0;
  for (let y = 0; y < H; y += 4) {
    for (let x = 0; x < W; x += 4) {
      const fx = x / W;
      const fy = y / H;
      if (fx >= cand.x0 - 0.05 && fx <= cand.x1 + 0.05 && fy >= cand.y0 - 0.1 && fy <= cand.y1 + 0.1) continue;
      const v = L[y * W + x]!;
      sum += v;
      n++;
      if (v >= 175) bright++;
    }
  }
  return n && cand.luma - sum / n >= 60 && bright / n < 0.02 ? cand : null;
}

/**
 * 轉職視窗（ui/menus.gd show_job_change）：置中大面板內左右兩張直立職業卡，各佔面板約一半寬、從面板頂端附近一路到底；
 * 整張卡就是按鈕。實機（3840×1858 取樣 640）：面板 0.24~0.76 × 0.08~0.92，只切出有預設焦點藍框的左卡 0.25~0.49 × 0.21~0.86，
 * 右卡外框淡、和面板連成一塊 → 只看到一張時，另一條路取面板內的鏡像位置。
 * 腐化寶箱也是兩張並排，但卡片在面板下半部（頂端離面板頂 ≥ 40%）→ 以「卡片從面板上方 25% 內開始、高 ≥ 面板 70%」區分。
 * 只有一條路的職業（卡片置中）不處理，交給 Enter 備援（只有一個選項）。
 */
function jobChange(regions: Region[], path: 0 | 1): { x: number; y: number } | null {
  // 面板高度隨視窗比例變（實機 1080×854：0.2~0.8 × 0.20~0.80，高 0.594）→ 門檻放寬到 0.45
  const boxes = regions.filter((r) => rw(r) * rh(r) >= 0.2 && rh(r) >= 0.45 && Math.abs(cx(r) - 0.5) < 0.06);
  for (const p of boxes) {
    const cards = regions
      .filter(
        (c) =>
          c !== p &&
          c.kind === 'card' &&
          inside(c, p, 0.01) &&
          rw(c) / rw(p) >= 0.38 &&
          rw(c) / rw(p) <= 0.5 &&
          rh(c) >= 0.7 * rh(p) &&
          c.y0 - p.y0 <= 0.25 * rh(p),
      )
      .sort((a, b) => cx(a) - cx(b));
    if (cards.length === 2) return { x: cx(cards[path]!), y: cy(cards[path]!) };
    if (cards.length !== 1) continue;
    const c = cards[0]!;
    const side = cx(c) < cx(p) - 0.05 * rw(p) ? 0 : cx(c) > cx(p) + 0.05 * rw(p) ? 1 : -1;
    if (side < 0) continue;
    return { x: side === path ? cx(c) : p.x0 + p.x1 - cx(c), y: cy(c) };
  }
  return null;
}
