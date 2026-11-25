import { describe, expect, it } from 'vitest';
import { changedRatio, createStillDetector } from '@/core/vision/still';

const frame = (fill: (i: number) => number, n = 100) => {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) data.fill(fill(i), i * 4, i * 4 + 4);
  return { width: 10, height: n / 10, data };
};

describe('still', () => {
  it('變化像素比例', () => {
    expect(changedRatio(frame(() => 100), frame(() => 100))).toBe(0);
    expect(changedRatio(frame(() => 100), frame((i) => (i < 10 ? 200 : 100)))).toBeCloseTo(0.1);
    expect(changedRatio(frame(() => 100), frame(() => 110))).toBe(0); // 微小亮度變化不算
  });

  it('連續兩張幾乎相同才算靜止，動了就重置', () => {
    const d = createStillDetector();
    expect(d.update(frame(() => 100), 0)).toBeNull();
    expect(d.update(frame(() => 100), 1000)).toBe(1000);
    expect(d.update(frame(() => 100), 2000)).toBe(1000);
    expect(d.update(frame((i) => (i < 20 ? 0 : 100)), 3000)).toBeNull();
    expect(d.update(null, 4000)).toBeNull();
  });
});
