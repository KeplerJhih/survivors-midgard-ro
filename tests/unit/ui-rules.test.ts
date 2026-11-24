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

  it('首領戰：上方中央的血條面板不當成寬按鈕', () => {
    const f = draw(GRASS, [
      { x0: 0.34, y0: 0.0, x1: 0.66, y1: 0.12, fill: PANEL },
      { x0: 0.38, y0: 0.03, x1: 0.62, y1: 0.06, fill: BTN },
    ]);
    expect(decide(f)).toBeNull();
  });

  it('一般遊玩畫面（只有小 HUD 面板）不動作', () => {
    const f = draw(GRASS, [
      { x0: 0, y0: 0, x1: 0.22, y1: 0.14, fill: PANEL },
      { x0: 0.86, y0: 0, x1: 1, y1: 0.27, fill: PANEL },
    ]);
    expect(decide(f)).toBeNull();
  });
});
