import { describe, expect, it } from 'vitest';
import type { Frame } from '@/core/vision/frame';
import {
  classifyIcon,
  createIndicatorSeeker,
  findIndicators,
  steerToIndicator,
  type Indicator,
} from '@/core/vision/indicators';
import { resolvePurple } from '@/core/vision/indicators';

const W = 320;
const H = 224;
const GRASS = [130, 150, 70];

/** 草地上畫深色圓盤（直徑 d px）＋中心圖示色塊 */
function frame(discs: { cx: number; cy: number; d?: number; icon: number[] }[]): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...GRASS, 255], i * 4);
  for (const { cx, cy, d = 12, icon } of discs) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const r = Math.hypot(x - cx, y - cy);
        if (r <= d / 2) data.set([30, 34, 28, 255], (y * W + x) * 4);
        if (r <= 1.6) data.set([...icon, 255], (y * W + x) * 4);
      }
  }
  return { width: W, height: H, data };
}

const GOLD = [255, 218, 112]; // 實機：任務指示器中心「!」
const PURPLE = [190, 117, 255]; // 催眠師色 Color(0.74,0.46,1.0)

describe('classifyIcon', () => {
  it('金色 → 目標、紫色 → 避開', () => {
    expect(classifyIcon(255, 218, 112)).toBe('target');
    expect(classifyIcon(190, 117, 255)).toBe('avoid');
    expect(classifyIcon(120, 200, 120)).toBe('other');
  });
});

describe('findIndicators', () => {
  it('找到深色圓盤並依圖示分類，座標以畫面中心為原點', () => {
    const list = findIndicators(frame([{ cx: 220, cy: 170, d: 9, icon: GOLD }, { cx: 100, cy: 60, d: 9, icon: PURPLE }]));
    const t = list.find((i) => i.kind === 'target')!;
    const a = list.find((i) => i.kind === 'avoid')!;
    expect(t.x).toBeGreaterThan(0);
    expect(t.y).toBeGreaterThan(0);
    expect(a.x).toBeLessThan(0);
    expect(a.y).toBeLessThan(0);
  });

  it('大圓盤（MVP 入口，Baphomet 是紫色）一律當目標，不當催眠師避開', () => {
    const [p] = findIndicators(frame([{ cx: 100, cy: 60, d: 12, icon: PURPLE }]));
    expect(p!.kind).toBe('target');
    expect(p!.size).toBeGreaterThan(0.044);
  });

  it('綠色圖示的大圓盤（實機陰影誤判）不算', () => {
    expect(findIndicators(frame([{ cx: 100, cy: 60, d: 12, icon: [157, 162, 74] }]))).toEqual([]);
  });

  it('中間是 MVP 頭像（顏色歸為 other，如 Dark Lord）的圓盤：下方有白色距離數字 → 入口指示器', () => {
    // 指示圓盤畫在畫面邊緣（上緣附近）
    const f = frame([{ cx: 100, cy: 30, d: 9, icon: [230, 170, 200] }]);
    for (let y = 37; y <= 40; y++) for (let x = 98; x <= 102; x++) (f.data as Uint8ClampedArray).set([255, 255, 255, 255], (y * W + x) * 4);
    const [p] = findIndicators(f);
    expect(p!.kind).toBe('target');
    expect(p!.size).toBeGreaterThanOrEqual(0.044); // 當成傳送門大圓盤（頭像把圓盤切碎，量到的偏小）
  });

  it('頭像整個偏暗（沒有亮色圖示）但下方有距離數字 → 仍是入口圓盤', () => {
    // 指示圓盤畫在畫面邊緣（上緣附近）
    const f = frame([{ cx: 100, cy: 30, d: 9, icon: [30, 34, 28] }]);
    for (let y = 37; y <= 40; y++) for (let x = 98; x <= 102; x++) (f.data as Uint8ClampedArray).set([255, 255, 255, 255], (y * W + x) * 4);
    expect(findIndicators(f)[0]!.kind).toBe('target');
  });

  it('頭像＋距離數字但在畫面中間（角色自己的頭髮＋名字）→ 不算（指示圓盤只畫在邊緣）', () => {
    const f = frame([{ cx: W / 2, cy: H / 2 - 10, d: 9, icon: [30, 34, 28] }]);
    for (let y = H / 2 - 3; y <= H / 2; y++) for (let x = W / 2 - 2; x <= W / 2 + 2; x++) (f.data as Uint8ClampedArray).set([255, 255, 255, 255], (y * W + x) * 4);
    expect(findIndicators(f)).toEqual([]);
  });

  it('同樣的圓盤下方沒有白字（樹影）→ 不算', () => {
    expect(findIndicators(frame([{ cx: 100, cy: 70, d: 9, icon: [230, 170, 200] }]))).toEqual([]);
  });

  it('HUD 區域（右下觸控按鈕）的深色圓不算', () => {
    expect(findIndicators(frame([{ cx: 0.8 * W, cy: 0.8 * H, icon: GOLD }]))).toEqual([]);
  });

  it('太大的深色區塊（樹影）不算', () => {
    expect(findIndicators(frame([{ cx: 160, cy: 112, d: 40, icon: GOLD }]))).toEqual([]);
  });
});

const ind = (kind: Indicator['kind'], x: number, y: number, size = 0.039): Indicator => ({
  kind,
  x,
  y,
  icon: [0, 0, 0],
  size,
});

describe('steerToIndicator', () => {
  it('朝最近的目標走', () => {
    expect(steerToIndicator([ind('target', 0.4, 0), ind('target', 0, -0.2)])).toEqual(['up']);
  });

  it('催眠師擋在前方時偏開', () => {
    const dirs = steerToIndicator([ind('target', 0.4, 0), ind('avoid', 0.3, -0.02)])!;
    expect(dirs).not.toEqual(['right']);
    expect(dirs).toContain('down');
  });

  it('傳送門（大圓盤）優先於較近的寶箱', () => {
    expect(steerToIndicator([ind('target', 0.1, 0), ind('target', 0, -0.4, 0.05)])).toEqual(['up']);
  });

  it('沒有目標回傳 null', () => {
    expect(steerToIndicator([ind('avoid', 0.3, 0)])).toBeNull();
  });
});

describe('createIndicatorSeeker', () => {
  const list = [ind('target', 0.3, 0)];

  it('連續 2 次才前往', () => {
    const s = createIndicatorSeeker(2, 30000, 20000);
    expect(s.update(list, 0)).toBeNull();
    expect(s.update(list, 400)).toEqual(['right']);
  });

  it('指示器消失（目標進入畫面）後沿最後方向滑行 2.5 秒', () => {
    const s = createIndicatorSeeker(2, 30000, 20000, 2500);
    s.update(list, 0);
    s.update(list, 400);
    expect(s.update([], 800)).toEqual(['right']);
    expect(s.update([], 3000)).toEqual(['right']);
    expect(s.update([], 3400)).toBeNull();
  });

  it('追超過時限就放棄並冷卻', () => {
    const s = createIndicatorSeeker(2, 30000, 20000);
    s.update(list, 0);
    s.update(list, 400);
    expect(s.update(list, 31000)).toBeNull();
    expect(s.update(list, 40000)).toBeNull(); // 冷卻中
    s.update(list, 52000);
    expect(s.update(list, 52400)).toEqual(['right']);
  });
});

describe('resolvePurple', () => {
  const big = { kind: 'target' as const, x: -0.35, y: 0.2, icon: [185, 116, 250] as [number, number, number], size: 0.065 };
  const gold = { kind: 'target' as const, x: 0.3, y: 0, icon: [230, 170, 60] as [number, number, number], size: 0.065 };
  it('時間沒停住：大紫圓盤（催眠師）改成避開，金色大圓盤不變', () => {
    expect(resolvePurple([big, gold], false).map((i) => i.kind)).toEqual(['avoid', 'target']);
  });
  it('時間停住（MVP 入口開著）：大紫圓盤仍是目標', () => {
    expect(resolvePurple([big], true)[0]!.kind).toBe('target');
  });
});
