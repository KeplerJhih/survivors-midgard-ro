import { describe, expect, it } from 'vitest';
import type { Frame } from '@/core/vision/frame';
import { createScreenHandler, detectScreen, lightRatio } from '@/core/vision/screens';

type RGB = [number, number, number];
const W = 160;
const H = 112;

/** 用一連串矩形（0~1 座標）畫出合成畫面，後畫的蓋前面 */
function paint(bg: RGB, rects: { x0: number; y0: number; x1: number; y1: number; rgb: RGB }[]): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...bg, 255], i * 4);
  for (const r of rects) {
    for (let y = Math.floor(r.y0 * H); y < Math.ceil(r.y1 * H); y++)
      for (let x = Math.floor(r.x0 * W); x < Math.ceil(r.x1 * W); x++) data.set([...r.rgb, 255], (y * W + x) * 4);
  }
  return { width: W, height: H, data };
}

const GRASS: RGB = [95, 125, 60];
const PANEL: RGB = [251, 251, 252]; // 實機取樣
const BLUE_BORDER: RGB = [84, 113, 200]; // 實機取樣（主要按鈕框）
const BUTTON: RGB = [235, 240, 255];
const SHADE: RGB = [50, 55, 30]; // 草地被 55% 遮罩壓暗
const LEGEND: RGB = [217, 107, 13]; // LEGENDARY_COLOR

describe('detectScreen', () => {
  it('結算頁：點主要按鈕（選擇目的地）右邊那顆（再玩一次）', () => {
    const f = paint(GRASS, [
      { x0: 0.04, y0: 0.01, x1: 0.96, y1: 0.99, rgb: PANEL },
      { x0: 0.31, y0: 0.93, x1: 0.38, y1: 0.97, rgb: BLUE_BORDER },
      { x0: 0.315, y0: 0.935, x1: 0.375, y1: 0.965, rgb: BUTTON },
    ]);
    expect(lightRatio(f)).toBeGreaterThan(0.5);
    const a = detectScreen(f)!;
    expect(a.kind).toBe('result');
    expect(a.x).toBeGreaterThan(0.38); // 在主要按鈕右側
    expect(a.x).toBeLessThan(0.46);
    expect(a.y).toBeCloseTo(0.95, 1);
  });

  it('確認框：背景被壓暗、中央亮色視窗 → 點右下角（實機約占畫面 27%×11%）', () => {
    const f = paint(SHADE, [{ x0: 0.36, y0: 0.44, x1: 0.64, y1: 0.56, rgb: PANEL }]);
    const a = detectScreen(f)!;
    expect(a.kind).toBe('dialog');
    expect(a.x).toBeGreaterThan(0.58);
    expect(a.y).toBeGreaterThan(0.52);
  });

  it('初始技能：點「上次選擇」色帶下方的卡片', () => {
    const f = paint(SHADE, [
      { x0: 0.18, y0: 0.13, x1: 0.82, y1: 0.78, rgb: PANEL },
      { x0: 0.25, y0: 0.2, x1: 0.32, y1: 0.24, rgb: LEGEND },
    ]);
    const a = detectScreen(f)!;
    expect(a.kind).toBe('start-skill');
    expect(a.x).toBeCloseTo(0.285, 1);
    expect(a.y).toBeGreaterThan(0.24);
  });

  it('一般遊玩畫面（四角 HUD 面板、零星白字）不觸發', () => {
    const f = paint(GRASS, [
      { x0: 0, y0: 0, x1: 0.22, y1: 0.14, rgb: PANEL }, // 左上資訊
      { x0: 0.86, y0: 0, x1: 1, y1: 0.27, rgb: PANEL }, // 右上小地圖
      { x0: 0.86, y0: 0.42, x1: 1, y1: 0.56, rgb: PANEL }, // 右側傷害
      { x0: 0.42, y0: 0.9, x1: 0.67, y1: 1, rgb: PANEL }, // 下方技能列
      { x0: 0.5, y0: 0.3, x1: 0.53, y1: 0.32, rgb: [255, 255, 255] }, // 傷害數字
    ]);
    expect(detectScreen(f)).toBeNull();
  });

  it('沒被壓暗的畫面中央出現亮色（技能閃光）不當成確認框', () => {
    const f = paint(GRASS, [{ x0: 0.38, y0: 0.4, x1: 0.62, y1: 0.6, rgb: PANEL }]);
    expect(detectScreen(f)).toBeNull();
  });
});

describe('createScreenHandler', () => {
  const act = { kind: 'result' as const, x: 0.4, y: 0.95 };

  it('連續 2 次才動作，之後冷卻', () => {
    const h = createScreenHandler(2, 2500);
    expect(h.update(act, 0)).toBeNull();
    expect(h.update(act, 500)).toEqual(act);
    expect(h.update(act, 1000)).toBeNull();
    expect(h.update(act, 1500)).toBeNull(); // 冷卻中
    expect(h.update(act, 3000)).toEqual(act); // 冷卻結束、畫面還在 → 再點一次
  });

  it('中間斷掉要重新累積', () => {
    const h = createScreenHandler(2, 2500);
    h.update(act, 0);
    h.update(null, 500);
    expect(h.update(act, 1000)).toBeNull();
  });
});
