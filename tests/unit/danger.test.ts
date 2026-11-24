import { describe, expect, it } from 'vitest';
import { dodge, fleeSwirl, isDanger, isHypnoSwirl, probeDanger, type DangerProbes } from '@/core/vision/danger';
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
