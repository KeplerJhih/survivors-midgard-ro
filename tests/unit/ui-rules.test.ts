import { describe, expect, it } from 'vitest';
import type { Frame } from '@/core/vision/frame';
import { parseLayout } from '@/core/vision/layout';
import { decideByLayout } from '@/core/vision/ui-rules';

type RGB = [number, number, number];
const W = 640;
const H = 448;

/** 依序畫矩形（0~1 座標）：外框 1px 用 border 色，內部 fill 色；後畫的蓋前面 */
function draw(bg: RGB, boxes: { x0: number; y0: number; x1: number; y1: number; fill: RGB; border?: RGB }[]): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...bg, 255], i * 4);
  for (const b of boxes) {
    const X0 = Math.round(b.x0 * W), X1 = Math.round(b.x1 * W), Y0 = Math.round(b.y0 * H), Y1 = Math.round(b.y1 * H);
    for (let y = Y0; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const edge = x <= X0 + 1 || x >= X1 - 2 || y <= Y0 + 1 || y >= Y1 - 2;
        data.set([...(edge ? (b.border ?? [150, 155, 170]) : b.fill), 255], (y * W + x) * 4);
      }
  }
  return { width: W, height: H, data };
}

const GRASS: RGB = [90, 120, 60];
const PANEL: RGB = [248, 249, 252];
const BTN: RGB = [236, 240, 252];
const decide = (f: Frame) => decideByLayout(f, parseLayout(f));

describe('decideByLayout（結構判斷）', () => {
  it('升級：一排三張卡 → 點外框最稀有（史詩）的那張', () => {
    const f = draw(GRASS, [
      { x0: 0.18, y0: 0.18, x1: 0.82, y1: 0.8, fill: PANEL },
      { x0: 0.2, y0: 0.25, x1: 0.39, y1: 0.73, fill: PANEL, border: [189, 201, 230] },
      { x0: 0.41, y0: 0.25, x1: 0.59, y1: 0.73, fill: PANEL, border: [77, 140, 255] },
      { x0: 0.61, y0: 0.25, x1: 0.8, y1: 0.73, fill: PANEL, border: [179, 89, 242] },
    ]);
    const a = decide(f)!;
    expect(a.kind).toBe('level-up');
    expect(a.x).toBeCloseTo(0.705, 1);
  });

  describe('轉職：大面板內左右兩張職業卡', () => {
    // 實機：只切出有預設焦點藍框的左卡，右卡外框淡、和面板連成一塊
    const f = draw(GRASS, [
      { x0: 0.24, y0: 0.08, x1: 0.76, y1: 0.92, fill: PANEL },
      { x0: 0.25, y0: 0.21, x1: 0.49, y1: 0.86, fill: PANEL, border: [84, 140, 242] },
    ]);
    it('預設（左）→ 點左卡', () => {
      const a = decideByLayout(f, parseLayout(f))!;
      expect(a.kind).toBe('job');
      expect(a.x).toBeCloseTo(0.37, 1);
    });
    it('設定右邊 → 點面板內的鏡像位置（右卡）', () => {
      const a = decideByLayout(f, parseLayout(f), undefined, { jobPath: 'second' })!;
      expect(a.kind).toBe('job');
      expect(a.x).toBeCloseTo(0.63, 1);
    });
    it('兩張都切得出來 → 依設定點對應的那張', () => {
      const g = draw(GRASS, [
        { x0: 0.24, y0: 0.08, x1: 0.76, y1: 0.92, fill: PANEL },
        { x0: 0.25, y0: 0.21, x1: 0.49, y1: 0.86, fill: PANEL, border: [84, 140, 242] },
        { x0: 0.51, y0: 0.21, x1: 0.75, y1: 0.86, fill: PANEL, border: [150, 155, 170] },
      ]);
      expect(decideByLayout(g, parseLayout(g), undefined, { jobPath: 'second' })!.x).toBeCloseTo(0.63, 1);
      expect(decideByLayout(g, parseLayout(g))!.x).toBeCloseTo(0.37, 1);
    });
  });

  it('腐化寶箱：兩張卡各有按鈕 → 點右卡的按鈕', () => {
    const f = draw(GRASS, [
      { x0: 0.1, y0: 0.12, x1: 0.9, y1: 0.9, fill: PANEL },
      { x0: 0.18, y0: 0.45, x1: 0.49, y1: 0.88, fill: PANEL },
      { x0: 0.2, y0: 0.8, x1: 0.47, y1: 0.86, fill: BTN },
      { x0: 0.51, y0: 0.45, x1: 0.82, y1: 0.88, fill: PANEL },
      { x0: 0.53, y0: 0.8, x1: 0.8, y1: 0.86, fill: BTN },
    ]);
    const a = decide(f)!;
    expect(a.kind).toBe('corrupt');
    expect(a.x).toBeGreaterThan(0.6);
  });

  it('結算：全寬面板底部 4 顆按鈕 → 第 2 顆（再玩一次）', () => {
    const f = draw(GRASS, [
      { x0: 0.04, y0: 0.01, x1: 0.96, y1: 0.99, fill: PANEL },
      { x0: 0.3, y0: 0.92, x1: 0.37, y1: 0.97, fill: BTN },
      { x0: 0.38, y0: 0.92, x1: 0.44, y1: 0.97, fill: BTN },
      { x0: 0.45, y0: 0.92, x1: 0.62, y1: 0.97, fill: BTN },
      { x0: 0.63, y0: 0.92, x1: 0.7, y1: 0.97, fill: BTN },
    ]);
    const a = decide(f)!;
    expect(a.kind).toBe('result');
    expect(a.x).toBeCloseTo(0.41, 1);
  });

  it('結算：只有 3 顆按鈕（沒解鎖新地圖）→ 第 1 顆（再玩一次），不點最寬的「前往城鎮」', () => {
    const f = draw(GRASS, [
      { x0: 0.04, y0: 0.01, x1: 0.96, y1: 0.99, fill: PANEL },
      { x0: 0.3, y0: 0.92, x1: 0.37, y1: 0.97, fill: BTN },
      { x0: 0.38, y0: 0.92, x1: 0.62, y1: 0.97, fill: BTN },
      { x0: 0.63, y0: 0.92, x1: 0.7, y1: 0.97, fill: BTN },
    ]);
    const a = decide(f)!;
    expect(a.kind).toBe('result');
    expect(a.x).toBeCloseTo(0.335, 1);
  });

  it('選地圖：右側直立面板右下角獨自的按鈕「選擇」', () => {
    const f = draw([60, 70, 50], [
      { x0: 0.625, y0: 0.17, x1: 0.986, y1: 0.855, fill: PANEL },
      { x0: 0.873, y0: 0.8, x1: 0.975, y1: 0.845, fill: BTN },
    ]);
    const a = decide(f)!;
    expect(a.kind).toBe('map-select');
    expect(a.x).toBeCloseTo(0.92, 1);
  });

  it('確認框：小面板底部 2 顆按鈕 → 最右', () => {
    const f = draw([40, 45, 30], [
      { x0: 0.36, y0: 0.45, x1: 0.64, y1: 0.6, fill: PANEL },
      { x0: 0.48, y0: 0.54, x1: 0.55, y1: 0.585, fill: BTN },
      { x0: 0.56, y0: 0.54, x1: 0.63, y1: 0.585, fill: BTN },
    ]);
    const a = decide(f)!;
    expect(a.kind).toBe('dialog');
    expect(a.x).toBeCloseTo(0.595, 1);
  });

  it('被壓暗背景上的置中對話框（按鈕切不出來）→ 點右下角', () => {
    const f = draw([110, 112, 118], [{ x0: 0.366, y0: 0.513, x1: 0.634, y1: 0.592, fill: PANEL }]);
    const a = decide(f)!;
    expect(a.kind).toBe('dialog');
    expect(a.x).toBeCloseTo(0.607, 1);
    expect(a.y).toBeCloseTo(0.576, 1);
  });

  it('一般遊玩畫面（四角有亮 HUD）中央亮塊不當成對話框', () => {
    const f = draw(GRASS, [
      { x0: 0, y0: 0, x1: 0.22, y1: 0.14, fill: PANEL },
      { x0: 0.86, y0: 0, x1: 1, y1: 0.27, fill: PANEL },
      { x0: 0.4, y0: 0.45, x1: 0.6, y1: 0.55, fill: PANEL },
    ]);
    expect(decide(f)?.kind).not.toBe('dialog');
  });

  it('暫停選單：先點置中寬按鈕「繼續」，絕不點最下排（含放棄本局）', () => {
    const f = draw(GRASS, [
      { x0: 0.24, y0: 0.2, x1: 0.76, y1: 0.8, fill: PANEL },
      { x0: 0.25, y0: 0.6, x1: 0.75, y1: 0.66, fill: BTN }, // 繼續
      { x0: 0.25, y0: 0.72, x1: 0.37, y1: 0.77, fill: BTN },
      { x0: 0.38, y0: 0.72, x1: 0.5, y1: 0.77, fill: BTN },
      { x0: 0.51, y0: 0.72, x1: 0.63, y1: 0.77, fill: BTN },
      { x0: 0.64, y0: 0.72, x1: 0.75, y1: 0.77, fill: BTN }, // 放棄本局
    ]);
    const a = decide(f)!;
    expect(a.kind).toBe('modal');
    expect(a.y).toBeCloseTo(0.63, 1);
  });

  it('準備/選地圖：最下排明顯最寬的按鈕', () => {
    const f = draw(GRASS, [
      { x0: 0.15, y0: 0.23, x1: 0.85, y1: 0.77, fill: PANEL },
      { x0: 0.27, y0: 0.71, x1: 0.31, y1: 0.76, fill: BTN },
      { x0: 0.32, y0: 0.71, x1: 0.39, y1: 0.76, fill: BTN },
      { x0: 0.4, y0: 0.71, x1: 0.48, y1: 0.76, fill: BTN },
      { x0: 0.56, y0: 0.71, x1: 0.73, y1: 0.76, fill: BTN }, // 出發冒險
    ]);
    const a = decide(f)!;
    expect(a.kind).toBe('map-select');
    expect(a.x).toBeCloseTo(0.645, 1);
  });

  it('底部 HUD 的寬條（已保留寶箱 [開啟]）不當成寬按鈕', () => {
    const f = draw(GRASS, [{ x0: 0.42, y0: 0.86, x1: 0.67, y1: 0.93, fill: BTN }]);
    expect(decide(f)).toBeNull();
  });

  it('沒有大面板包住的「卡片列」（技能白光）不當成升級', () => {
    const f = draw(GRASS, [
      { x0: 0.2, y0: 0.25, x1: 0.39, y1: 0.73, fill: PANEL, border: [77, 140, 255] },
      { x0: 0.41, y0: 0.25, x1: 0.59, y1: 0.73, fill: PANEL },
    ]);
    expect(decide(f)).toBeNull();
  });

  it('任務完成視窗：寬的獎勵列不是按鈕，點右下的小「繼續」', () => {
    const f = draw(GRASS, [
      { x0: 0.2, y0: 0.27, x1: 0.8, y1: 0.8, fill: PANEL },
      { x0: 0.21, y0: 0.56, x1: 0.79, y1: 0.64, fill: BTN }, // 獎勵列
      { x0: 0.75, y0: 0.755, x1: 0.795, y1: 0.795, fill: BTN }, // 繼續
    ]);
    const a = decide(f)!;
    expect(a.x).toBeGreaterThan(0.74);
    expect(a.y).toBeGreaterThan(0.74);
  });

  it('首領戰：上方中央的血條面板不當成寬按鈕', () => {
    const f = draw(GRASS, [
      { x0: 0.34, y0: 0.0, x1: 0.66, y1: 0.12, fill: PANEL },
      { x0: 0.38, y0: 0.03, x1: 0.62, y1: 0.06, fill: BTN },
    ]);
    expect(decide(f)).toBeNull();
  });

  it('城鎮：明亮地面＋左上 4 顆按鈕一排，不當成結算頁', () => {
    const f = draw([225, 225, 228], [
      { x0: 0.01, y0: 0.01, x1: 0.07, y1: 0.045, fill: BTN },
      { x0: 0.07, y0: 0.01, x1: 0.12, y1: 0.045, fill: BTN },
      { x0: 0.12, y0: 0.01, x1: 0.21, y1: 0.045, fill: BTN },
      { x0: 0.22, y0: 0.01, x1: 0.28, y1: 0.045, fill: BTN },
    ]);
    expect(decide(f)?.kind).not.toBe('result');
  });

  it('初始技能 2×2 選項格：點色帶與眾不同的「上次選擇」那張', () => {
    const f = draw(GRASS, [
      { x0: 0.31, y0: 0.22, x1: 0.69, y1: 0.78, fill: PANEL },
      { x0: 0.33, y0: 0.3, x1: 0.49, y1: 0.5, fill: PANEL },
      { x0: 0.33, y0: 0.3, x1: 0.49, y1: 0.34, fill: [255, 200, 160], border: [217, 107, 13] }, // 上次選擇色帶
      { x0: 0.51, y0: 0.3, x1: 0.67, y1: 0.5, fill: PANEL },
      { x0: 0.35, y0: 0.56, x1: 0.49, y1: 0.76, fill: PANEL },
      { x0: 0.51, y0: 0.56, x1: 0.65, y1: 0.76, fill: PANEL },
    ]);
    const a = decide(f)!;
    expect(a.kind).toBe('start-skill');
    expect(a.x).toBeLessThan(0.5);
    expect(a.y).toBeLessThan(0.55);
  });

  it('寶箱視窗：小「繼續」被文字切碎 → 點面板底部中線的殘片', () => {
    const f = draw(GRASS, [
      { x0: 0.26, y0: 0.26, x1: 0.74, y1: 0.74, fill: PANEL },
      { x0: 0.485, y0: 0.68, x1: 0.515, y1: 0.725, fill: BTN, border: [90, 110, 200] },
    ]);
    const a = decide(f)!;
    expect(a.x).toBeCloseTo(0.5, 1);
    expect(a.y).toBeGreaterThan(0.66);
  });

  it('寶箱清單視窗：底部有「全部販賣」按鈕＋小「繼續」殘片 → 點右邊的繼續', () => {
    const f = draw(GRASS, [
      { x0: 0.263, y0: 0.124, x1: 0.738, y1: 0.874, fill: PANEL },
      { x0: 0.431, y0: 0.816, x1: 0.525, y1: 0.851, fill: BTN, border: [90, 110, 200] },
      { x0: 0.539, y0: 0.818, x1: 0.569, y1: 0.851, fill: BTN, border: [90, 110, 200] },
    ]);
    const a = decide(f)!;
    expect(a).not.toBeNull();
    expect(a.x).toBeGreaterThan(0.53);
    expect(a.y).toBeGreaterThan(0.8);
  });

  it('等級要轉給誰：大面板內一堆等寬小卡、沒按鈕 → 點左上第一張', () => {
    const tiles = [0.066, 0.192, 0.319, 0.442, 0.569, 0.698, 0.825].map((x0) => ({ x0, y0: 0.27, x1: x0 + 0.11, y1: 0.42, fill: PANEL, border: [189, 201, 230] as RGB }));
    const f = draw(GRASS, [
      { x0: 0.025, y0: 0.161, x1: 0.975, y1: 0.837, fill: [225, 228, 236] },
      ...tiles,
      { x0: 0.381, y0: 0.44, x1: 0.492, y1: 0.59, fill: PANEL, border: [189, 201, 230] },
      { x0: 0.508, y0: 0.44, x1: 0.619, y1: 0.59, fill: PANEL, border: [189, 201, 230] },
    ]);
    const a = decide(f)!;
    expect(a).not.toBeNull();
    expect(a.x).toBeCloseTo(0.12, 1);
    expect(a.y).toBeCloseTo(0.345, 1);
  });

  it('寶箱視窗：寬的獎勵列像按鈕、下方小「繼續」→ 點繼續不點獎勵列', () => {
    const f = draw(GRASS, [
      { x0: 0.263, y0: 0.216, x1: 0.738, y1: 0.782, fill: PANEL },
      { x0: 0.3, y0: 0.531, x1: 0.7, y1: 0.595, fill: BTN, border: [120, 200, 120] },
      { x0: 0.484, y0: 0.72, x1: 0.516, y1: 0.765, fill: BTN, border: [90, 110, 200] },
    ]);
    const a = decide(f)!;
    expect(a).not.toBeNull();
    expect(a.y).toBeGreaterThan(0.7);
  });

  it('MVP 勝利選擇：小面板內上下兩顆等寬按鈕 → 點上面的「繼續無盡模式」', () => {
    const f = draw([40, 45, 55], [
      { x0: 0.353, y0: 0.361, x1: 0.647, y1: 0.639, fill: PANEL },
      { x0: 0.365, y0: 0.52, x1: 0.635, y1: 0.565, fill: BTN, border: [90, 140, 255] },
      { x0: 0.365, y0: 0.585, x1: 0.635, y1: 0.63, fill: BTN, border: [189, 201, 230] },
    ]);
    const a = decide(f)!;
    expect(a).not.toBeNull();
    expect(a.y).toBeLessThan(0.57);
    expect(a.y).toBeGreaterThan(0.51);
  });

  it('MVP 勝利選擇：兩顆按鈕被合併成一塊 → 點上半部（繼續無盡模式）', () => {
    const f = draw([40, 45, 55], [
      { x0: 0.352, y0: 0.359, x1: 0.647, y1: 0.641, fill: PANEL },
      { x0: 0.367, y0: 0.526, x1: 0.633, y1: 0.618, fill: BTN, border: [189, 201, 230] },
    ]);
    const a = decide(f)!;
    expect(a).not.toBeNull();
    expect(a.y).toBeGreaterThan(0.53);
    expect(a.y).toBeLessThan(0.56);
  });

  it('無盡模式結算：底排只切出頭尾兩顆 → 點空隙前 1/4（再玩一次）', () => {
    const f = draw([60, 70, 90], [
      { x0: 0.075, y0: 0.02, x1: 0.925, y1: 0.985, fill: PANEL },
      { x0: 0.333, y0: 0.211, x1: 0.62, y1: 0.566, fill: PANEL, border: [189, 201, 230] },
      { x0: 0.633, y0: 0.211, x1: 0.906, y1: 0.566, fill: PANEL, border: [189, 201, 230] },
      { x0: 0.361, y0: 0.93, x1: 0.422, y1: 0.97, fill: BTN, border: [90, 110, 200] },
      { x0: 0.588, y0: 0.93, x1: 0.639, y1: 0.97, fill: BTN, border: [90, 110, 200] },
    ]);
    const a = decide(f)!;
    expect(a.kind).toBe('result');
    expect(a.x).toBeGreaterThan(0.43);
    expect(a.x).toBeLessThan(0.49);
  });

  it('寶箱長清單：底部按鈕切不出來，只有預設焦點的藍框 → 點藍框', () => {
    const f = draw(GRASS, [{ x0: 0.266, y0: 0.01, x1: 0.734, y1: 0.995, fill: PANEL }]);
    // 藍色焦點外框（2px），內部與面板同色
    const X0 = Math.round(0.53 * W), X1 = Math.round(0.58 * W), Y0 = Math.round(0.92 * H), Y1 = Math.round(0.97 * H);
    for (let y = Y0; y < Y1; y++)
      for (let x = X0; x < X1; x++)
        if (x <= X0 + 1 || x >= X1 - 2 || y <= Y0 + 1 || y >= Y1 - 2) (f.data as Uint8ClampedArray).set([90, 110, 220, 255], (y * W + x) * 4);
    const a = decide(f)!;
    expect(a).not.toBeNull();
    expect(a.x).toBeCloseTo(0.555, 1);
    expect(a.y).toBeGreaterThan(0.9);
  });

  it('相距很遠的兩張「卡」（小視窗兩側露出的面板邊）不是卡片列', () => {
    const f = draw(GRASS, [
      { x0: 0.064, y0: 0.01, x1: 0.934, y1: 0.989, fill: [225, 228, 236] },
      { x0: 0.084, y0: 0.216, x1: 0.192, y1: 0.584, fill: PANEL, border: [189, 201, 230] },
      { x0: 0.82, y0: 0.216, x1: 0.916, y1: 0.584, fill: PANEL, border: [189, 201, 230] },
    ]);
    const a = decide(f);
    expect(a?.kind).not.toBe('start-skill');
    expect(a?.kind).not.toBe('level-up');
  });

  it('一般遊玩畫面（只有小 HUD 面板）不動作', () => {
    const f = draw(GRASS, [
      { x0: 0, y0: 0, x1: 0.22, y1: 0.14, fill: PANEL },
      { x0: 0.86, y0: 0, x1: 1, y1: 0.27, fill: PANEL },
    ]);
    expect(decide(f)).toBeNull();
  });
});
