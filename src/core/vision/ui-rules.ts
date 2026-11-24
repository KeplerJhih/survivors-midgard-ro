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

export function decideByLayout(f: Frame, regions: Region[], rarity: RarityRank = defaultRarity): ScreenAction | null {
  const buttons = regions.filter((r) => r.kind === 'button');
  const panels = regions.filter((r) => r.kind === 'panel');
  const cards = regions.filter((r) => r.kind === 'card');

  // ---- 腐化寶箱：兩個大小相同、並排、各含一顆按鈕的區塊（卡片偏方，會被歸為 panel 或 card）----
  const boxes = regions.filter((r) => (r.kind === 'panel' || r.kind === 'card') && rw(r) < 0.6 && rh(r) >= 0.2);
  for (const pair of rows(boxes, 0.03, 0.05)) {
    if (pair.length !== 2) continue;
    const [a, b] = pair as [Region, Region];
    if (Math.abs(rw(a) - rw(b)) > 0.03) continue;
    const btnA = buttons.find((x) => inside(x, a, 0.01));
    const btnB = buttons.find((x) => inside(x, b, 0.01));
    if (btnA && btnB) return tap('corrupt', btnB);
  }

  // ---- 卡片列 ----
  // 卡片列必須被一個大區塊包住（升級視窗）：MVP 戰的技能白光、左側 MVP 技能面板曾被誤判成卡片。
  // 不限種類：卡片佔掉面板大部分面積，面板填滿率低時會被歸為 other
  const bigPanels = regions.filter((r) => rw(r) * rh(r) >= 0.2);
  const cardRow = rows(cards, 0.05, 0.12)
    .filter((g) => g.length >= 2 && g.length <= 4)
    .filter((g) => bigPanels.some((p) => g.every((c) => inside(c, p, 0.03))))
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
    if (p && rw(p) >= 0.8) return tap('result', bottom[bottom.length === 4 ? 1 : 0]!);
  }
  if (bottom && bottom.length === 2) {
    // 不限置中：任務 NPC 視窗在左側（[先不要][我來幫忙！]）
    const p = container(bottom);
    if (p && rw(p) < 0.8) return tap('dialog', bottom[1]!);
  }
  // 置中、獨立的亮區塊，且周圍被壓暗（遮罩）→ 對話框；按鈕一律靠右下（ALIGNMENT_END）→ 點右下角
  // 實機：「不存放就離開？」的兩顆小按鈕邊框太淡切不出來，整個對話框被當成一塊
  const dlg = dimmedDialog(f, regions);
  if (dlg) return { kind: 'dialog', x: dlg.x0 + 0.9 * rw(dlg), y: dlg.y0 + 0.8 * rh(dlg) };

  // 置中單一寬按鈕（獨自一排）
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
    .sort((a, b) => cy(b) - cy(a))[0];
  if (wide) return tap('modal', wide);
  // 最下排明顯最寬的按鈕（準備「出發冒險！」等）；全寬面板（結算頁）不適用
  if (bottom) {
    const p = container(bottom);
    const byWidth = [...bottom].sort((a, b) => rw(b) - rw(a));
    if ((!p || rw(p) < 0.8) && rw(byWidth[0]!) >= 1.4 * rw(byWidth[1]!)) return tap('map-select', byWidth[0]!);
  }
  // 大區塊右下角獨自一排的按鈕（選地圖「選擇 ▶」：返回/狂熱太小切不出來，只剩它）
  const corner = cornerButton(regions, buttons);
  if (corner) return tap('map-select', corner);
  // 選項格（初始技能等）：同一大區塊內 ≥2 個等大、無按鈕的面板 → 點「與眾不同」的那張（上次選擇有不同色帶），否則第一張
  const grid = optionGrid(f, regions, buttons);
  if (grid) return tap('start-skill', grid);
  // 置中的視窗裡切不出按鈕（小按鈕被文字切碎）：點面板底部中線附近的小亮塊（按鈕殘片）
  const frag = bottomFragment(regions, buttons);
  if (frag) return tap('modal', frag);
  return null;
}

/**
 * 實機：寶箱視窗的「繼續」只有兩個字，按鈕內部被文字切成小塊（寬 2.8%、高 3.5%），不像按鈕。
 * 條件：置中大面板（面積 15~50%、填滿率 ≥ 0.8）內沒有偵測到按鈕；面板底部 15% 內、靠近中線（±10%）有小亮塊。
 */
function bottomFragment(regions: Region[], buttons: Region[]): Region | null {
  const panel = regions.find(
    (r) =>
      r.kind === 'panel' &&
      Math.abs(cx(r) - 0.5) < 0.06 &&
      Math.abs(cy(r) - 0.5) < 0.12 &&
      rw(r) * rh(r) >= 0.15 &&
      rw(r) * rh(r) <= 0.5 &&
      r.fill >= 0.8,
  );
  if (!panel || buttons.some((b) => inside(b, panel, 0.01))) return null;
  return (
    regions
      .filter(
        (r) =>
          r !== panel &&
          inside(r, panel, 0.01) &&
          cy(r) >= panel.y1 - 0.15 * rh(panel) &&
          Math.abs(cx(r) - cx(panel)) < 0.1 &&
          rw(r) * rh(r) < 0.01,
      )
      .sort((a, b) => cy(b) - cy(a))[0] ?? null
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
