import { describe, expect, it } from 'vitest';
import { createMinimapNavigator, readMinimap, vecOfDirs } from '@/core/vision/minimap';
import type { Dir } from '@/core/movement/directions';

const frame = (dots: { x: number; y: number; r: number; c: [number, number, number] }[]) => {
  const W = 200;
  const H = 200;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([150, 170, 130, 255], i * 4);
  for (const d of dots)
    for (let y = d.y - d.r; y <= d.y + d.r; y++)
      for (let x = d.x - d.r; x <= d.x + d.r; x++)
        if (Math.hypot(x - d.x, y - d.y) <= d.r) data.set([...d.c, 255], (y * W + x) * 4);
  return { width: W, height: H, data };
};

describe('readMinimap', () => {
  it('找出玩家箭頭與首領點', () => {
    const m = readMinimap(
      frame([
        { x: 50, y: 60, r: 3, c: [255, 38, 25] },
        { x: 150, y: 20, r: 2, c: [255, 64, 64] },
      ]),
    )!;
    expect(m.player.x).toBeCloseTo(50, 0);
    expect(m.boss!.x).toBeCloseTo(150, 0);
  });
  it('沒有箭頭 → null；沒有首領點 → boss null', () => {
    expect(readMinimap(frame([]))).toBeNull();
    expect(readMinimap(frame([{ x: 50, y: 60, r: 3, c: [255, 38, 25] }]))!.boss).toBeNull();
  });
});

describe('createMinimapNavigator', () => {
  // 實機那樣旋轉的對應：按上 → 小地圖往左（-x）、按右 → 小地圖往上（-y）
  const A = (v: { x: number; y: number }) => ({ x: -v.y * 5, y: -v.x * 5 });
  const train = () => {
    const nav = createMinimapNavigator(800);
    let p = { x: 100, y: 100 };
    let t = 0;
    const seq: Dir[][] = [['up'], ['right'], ['down'], ['left'], ['up', 'right'], ['down', 'left']];
    for (const dirs of seq) {
      nav.observe(p, dirs, t);
      const d = A(vecOfDirs(dirs));
      p = { x: p.x + d.x, y: p.y + d.y };
      t += 1000;
      nav.observe(p, dirs, t);
      t += 10;
    }
    return nav;
  };

  it('學到旋轉後，往目標的方向正確', () => {
    const nav = train();
    expect(nav.calibrated).toBe(true);
    // 目標在小地圖左方 → 應按「上」
    expect(nav.steer({ x: 100, y: 100 }, { x: 60, y: 100 })).toEqual(['up']);
    // 目標在小地圖上方 → 應按「右」
    expect(nav.steer({ x: 100, y: 100 }, { x: 100, y: 60 })).toEqual(['right']);
  });

  it('未校正時不給方向；到達時不給方向', () => {
    expect(createMinimapNavigator().steer({ x: 0, y: 0 }, { x: 50, y: 0 })).toBeNull();
    expect(train().steer({ x: 100, y: 100 }, { x: 101, y: 101 })).toBeNull();
  });
});
