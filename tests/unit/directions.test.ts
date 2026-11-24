import { describe, expect, it } from 'vitest';
import { dirsFromAngle, TAU } from '@/core/movement/directions';
import { circle, createStrategy } from '@/core/movement/strategies';

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

  it('none 不移動', () => {
    expect(createStrategy('none', { circlePeriodMs: 1000 })(1234)).toEqual([]);
  });
});
