import { describe, expect, it } from 'vitest';
import { dirsFromAngle, TAU } from '@/core/movement/directions';
import { circle, createStrategy, figure8, flower, wander } from '@/core/movement/strategies';

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
    ['flower', flower(4000)],
  ])('%s 長時間掛機不會漂走（10 個週期後回到起點）', (_name, s) => {
    const { drift } = simulate(s, 40000);
    expect(drift).toBeLessThan(40); // 位移單位：速度×毫秒，一圈周長約 4000
  });

  it('wander：方向會變、長時間不漂走（離起點不超過約 0.5 個週期距離）', () => {
    const s = wander(4000, 42);
    const dirs = new Set(Array.from({ length: 300 }, (_, i) => s(i * 200).join('+')));
    expect(dirs.size).toBeGreaterThanOrEqual(5);
    const { maxR } = simulate(wander(4000, 7), 120000, 10);
    expect(maxR).toBeLessThan(0.5 * 4000 + 2000);
  });

  it('wander：同一種子可重現；時間倒退會重置', () => {
    const a = wander(4000, 1);
    const b = wander(4000, 1);
    const seqA = [0, 1500, 3000, 6000].map((t) => a(t).join('+'));
    expect([0, 1500, 3000, 6000].map((t) => b(t).join('+'))).toEqual(seqA);
    expect(a(0).join('+')).toBe(seqA[0]);
  });

  it('figure8 是上下兩個圓，涵蓋高度約為同週期繞圈的兩倍', () => {
    expect(simulate(figure8(4000), 8000).height).toBeGreaterThan(simulate(circle(4000), 4000).height * 1.8);
  });

  it('flower 掃過整片圓盤：半徑 2R 內幾乎每個點都會被經過（MVP 入口傳送門一定踩得到）', () => {
    // 記錄路徑點
    const path: [number, number][] = [];
    let x = 0;
    let y = 0;
    const s = flower(4000);
    for (let t = 0; t < 4000 * 24; t += 10) {
      const d = s(t);
      const vx = (d.includes('right') ? 1 : 0) - (d.includes('left') ? 1 : 0);
      const vy = (d.includes('up') ? 1 : 0) - (d.includes('down') ? 1 : 0);
      const n = Math.hypot(vx, vy) || 1;
      x += (vx / n) * 10;
      y += (vy / n) * 10;
      path.push([x, y]);
    }
    const R = 4000 / (2 * Math.PI); // 單圈半徑（速度 1/ms）
    const trigger = 0.25 * R; // 觸發距離：遊戲中 1.2 單位，相對 R≈3~4 單位
    let inside = 0;
    let covered = 0;
    for (let gx = -2 * R; gx <= 2 * R; gx += R / 5) {
      for (let gy = -2 * R; gy <= 2 * R; gy += R / 5) {
        const r = Math.hypot(gx, gy);
        if (r < 0.6 * R || r > 1.8 * R) continue; // 傳送門生成在一定距離外
        inside++;
        if (path.some(([px, py]) => Math.hypot(px - gx, py - gy) < trigger)) covered++;
      }
    }
    expect(covered / inside).toBeGreaterThan(0.95);
  });

  it('none 不移動', () => {
    expect(createStrategy('none', { circlePeriodMs: 1000 })(1234)).toEqual([]);
  });
});
