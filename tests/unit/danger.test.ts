import { describe, expect, it } from 'vitest';
import { approachExit, dodge, findPortalGlow, fleeSwirl, isDanger, isHypnoSwirl, probeDanger, type DangerProbes } from '@/core/vision/danger';
import type { Frame } from '@/core/vision/frame';

const W = 160;
const H = 112;

function frame(paint: (x: number, y: number) => number[] | null): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) data.set([...(paint(x, y) ?? [110, 140, 70]), 255], (y * W + x) * 4);
  return { width: W, height: H, data };
}

const RED = [173, 36, 31]; // 實機紅帶本體

describe('isDanger', () => {
  it('深紅紅帶是危險，技能火焰/粉紅光效不是', () => {
    expect(isDanger(152, 25, 27)).toBe(true);
    expect(isDanger(186, 35, 36)).toBe(true);
    expect(isDanger(250, 180, 170)).toBe(false);
    expect(isDanger(250, 177, 114)).toBe(false);
    expect(isDanger(150, 110, 70)).toBe(false); // 泥土
  });

  it('Golden Thief Bug 黃金之火的橘紅圓盤是危險', () => {
    for (const [r, g, b] of [[247, 104, 78], [242, 108, 84], [239, 128, 92], [244, 113, 77]] as const)
      expect(isDanger(r, g, b)).toBe(true);
    expect(isDanger(249, 169, 112)).toBe(false); // 圓盤亮邊（G 偏高）不算
  });
});

describe('probeDanger', () => {
  it('右側一條垂直紅帶：右方探測為紅、其他方向安全', () => {
    const f = frame((x) => (x > W / 2 + 0.1 * H && x < W / 2 + 0.17 * H ? RED : null));
    const p = probeDanger(f);
    expect(p.center).toBe(0);
    expect(p.dirs[0]).toBeGreaterThan(0.3); // 右
    expect(p.dirs[4]).toBe(0); // 左
  });
});

const probes = (center: number, dirs: number[]): DangerProbes => ({ center, dirs });

describe('dodge', () => {
  it('沒有危險時不修正', () => {
    expect(dodge(probes(0, [0, 0, 0, 0, 0, 0, 0, 0]), ['right'])).toBeNull();
  });

  it('前方是紅的：改走最接近原方向的安全方向', () => {
    // 右(0)、右上(1)危險 → 最接近「右」的安全方向是右下(7)
    expect(dodge(probes(0, [0.5, 0.5, 0, 0, 0, 0, 0, 0]), ['right'])).toEqual(['down', 'right']);
  });

  it('腳下是紅的：往最不紅的方向逃', () => {
    expect(dodge(probes(0.6, [0.6, 0.6, 0.6, 0.6, 0.1, 0.6, 0.6, 0.6]), ['right'])).toEqual(['left']);
  });

  it('站著不動時，只有腳下是紅的才動', () => {
    expect(dodge(probes(0, [0.9, 0, 0, 0, 0, 0, 0, 0]), [])).toBeNull();
    expect(dodge(probes(0.5, [0.9, 0.9, 0, 0.9, 0.9, 0.9, 0.9, 0.9]), [])).toEqual(['up']);
  });
});

describe('fleeSwirl', () => {
  const SWIRL = [248, 181, 245]; // 實機催眠師螺旋
  it('顏色：螺旋是、粉紅光效與波利不是', () => {
    expect(isHypnoSwirl(255, 189, 255)).toBe(true);
    expect(isHypnoSwirl(250, 180, 170)).toBe(false);
    expect(isHypnoSwirl(250, 150, 160)).toBe(false);
  });

  it('螺旋在角色右上方附近 → 往左下逃', () => {
    const f = frame((x, y) => (Math.hypot(x - (W / 2 + 15), y - (H / 2 - 10)) < 5 ? SWIRL : null));
    expect(fleeSwirl(f)).toEqual(['left', 'down']);
  });

  it('螺旋很遠時不理', () => {
    const f = frame((x, y) => (Math.hypot(x - 5, y - 5) < 4 ? SWIRL : null));
    expect(fleeSwirl(f)).toBeNull();
  });
});

describe('findPortalGlow（時間停住時找 MVP 入口光）', () => {
  const make = (blobs: { x: number; y: number; r: number; c: [number, number, number] }[]) => {
    const W = 160;
    const H = 110;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([90, 95, 105, 255], i * 4);
    for (const b of blobs)
      for (let y = b.y - b.r; y <= b.y + b.r; y++)
        for (let x = b.x - b.r; x <= b.x + b.r; x++) data.set([...b.c, 255], (y * W + x) * 4);
    return { width: W, height: H, data };
  };
  it('取最大的金色光團；藍色火焰、角色中心、頂部血條不算', () => {
    const g = findPortalGlow(
      make([
        { x: 110, y: 75, r: 4, c: [255, 210, 60] }, // 金色傳送門
        { x: 50, y: 60, r: 5, c: [60, 120, 255] }, // 藍色火焰
        { x: 80, y: 55, r: 3, c: [255, 230, 80] }, // 角色本身
        { x: 80, y: 5, r: 4, c: [237, 107, 140] }, // 首領血條
      ]),
    )!;
    expect(g.x).toBeGreaterThan(0.2);
    expect(g.y).toBeGreaterThan(0.1);
  });
  it('沒有光 → null', () => {
    expect(findPortalGlow(make([]))).toBeNull();
  });
  it('MVP 勝利後的出口：只認淡藍光，不認藍色火焰與金色因果路線傳送門', () => {
    const dirs = approachExit(
      make([
        { x: 120, y: 55, r: 4, c: [150, 200, 240] }, // 淡藍出口（右）
        { x: 40, y: 55, r: 5, c: [255, 210, 60] }, // 金色因果路線（左，較大）
        { x: 80, y: 90, r: 4, c: [45, 138, 255] }, // 藍色火焰（下）
      ]),
    );
    expect(dirs).toEqual(['right']);
    expect(approachExit(make([{ x: 40, y: 55, r: 5, c: [255, 210, 60] }, { x: 80, y: 90, r: 4, c: [45, 138, 255] }]))).toBeNull();
  });
});
