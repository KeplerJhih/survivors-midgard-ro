import { describe, expect, it } from 'vitest';
import { approachBeam, findBeams } from '@/core/vision/loot';

const W = 160, H = 73;
function frame(shapes: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }[]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([70, 100, 60, 255], i * 4);
  for (const s of shapes)
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) data.set([...s.rgb, 255], (y * W + x) * 4);
  return { width: W, height: H, data };
}

describe('findBeams（地上掉落物光柱）', () => {
  it('細高的金色光柱 → 找到，位置是底部（地面）', () => {
    const b = findBeams(frame([{ x: 110, y: 20, w: 2, h: 14, rgb: [255, 217, 77] }]));
    expect(b.length).toBe(1);
    expect(b[0]!.x).toBeGreaterThan(0.3);
    expect(b[0]!.y).toBeCloseTo((33 - 36.5) / 73, 2);
    expect(approachBeam(frame([{ x: 110, y: 20, w: 2, h: 14, rgb: [255, 217, 77] }]))).toEqual(['right']);
  });
  it('藍色火焰（直立但 R 低 B 高）不算', () => {
    expect(findBeams(frame([{ x: 110, y: 20, w: 2, h: 14, rgb: [45, 138, 255] }]))).toEqual([]);
  });
  it('圓形亮點（資源、技能光）不算', () => {
    expect(findBeams(frame([{ x: 110, y: 20, w: 5, h: 5, rgb: [255, 217, 77] }]))).toEqual([]);
  });
});
