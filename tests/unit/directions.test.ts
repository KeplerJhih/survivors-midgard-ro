import { describe, expect, it } from 'vitest';
import { dirsFromAngle, TAU } from '@/core/movement/directions';
import { circle, createStrategy, figure8 } from '@/core/movement/strategies';

describe('dirsFromAngle', () => {
  it.each([
    [0, ['right']],
    [TAU / 8, ['right', 'up']],
    [TAU / 4, ['up']],
    [TAU / 2, ['left']],
    [(3 * TAU) / 4, ['down']],
    [TAU, ['right']],
    [-TAU / 4, ['down']],
  ])('angle %f → %j', (angle, expected) => {
    expect(dirsFromAngle(angle)).toEqual(expected);
  });
});

describe('strategies', () => {
  it('circle 一個週期走完 8 個方向並回到起點', () => {
    const s = circle(8000);
    const seen = Array.from({ length: 8 }, (_, i) => s(i * 1000).join('+'));
    expect(new Set(seen).size).toBe(8);
    expect(s(8000)).toEqual(s(0));
  });

  /** 模擬遊戲移動（Input.get_vector 會正規化）：累積位移、記錄離起點最遠距離 */
  function simulate(s: (t: number) => string[], totalMs: number, stepMs = 5) {
    let x = 0;
    let y = 0;
    let maxR = 0;
    let minY = 0;
    let maxY = 0;
    for (let t = 0; t < totalMs; t += stepMs) {
      const d = s(t);
      const vx = (d.includes('right') ? 1 : 0) - (d.includes('left') ? 1 : 0);
      const vy = (d.includes('up') ? 1 : 0) - (d.includes('down') ? 1 : 0);
      const n = Math.hypot(vx, vy) || 1;
      x += (vx / n) * stepMs;
      y += (vy / n) * stepMs;
      maxR = Math.max(maxR, Math.hypot(x, y));
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { drift: Math.hypot(x, y), maxR, height: maxY - minY };
  }

  it.each([
    ['circle', circle(4000)],
    ['figure8', figure8(4000)],
  ])('%s 長時間掛機不會漂走（10 個週期後回到起點）', (_name, s) => {
    const { drift } = simulate(s, 40000);
    expect(drift).toBeLessThan(40); // 位移單位：速度×毫秒，一圈周長約 4000
  });

  it('figure8 是上下兩個圓，涵蓋高度約為同週期繞圈的兩倍', () => {
    expect(simulate(figure8(4000), 8000).height).toBeGreaterThan(simulate(circle(4000), 4000).height * 1.8);
  });

  it('none 不移動', () => {
    expect(createStrategy('none', { circlePeriodMs: 1000 })(1234)).toEqual([]);
  });
});
