import { describe, expect, it } from 'vitest';
import { ALTAR_COLORS, findAltars } from '@/core/vision/minimap';

const W = 400;
const H = 400;
const SQ = { x0: 20, y0: 20, x1: 358, y1: 358 }; // 邊長 338（實機）

function frame(draw: (set: (x: number, y: number, c: [number, number, number]) => void) => void) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([73, 73, 74, 255], i * 4);
  draw((x, y, c) => data.set([...c, 255], (Math.round(y) * W + Math.round(x)) * 4));
  return { width: W, height: H, data };
}
const disc = (set: (x: number, y: number, c: [number, number, number]) => void, cx: number, cy: number) => {
  for (let y = -16; y <= 16; y++) for (let x = -16; x <= 16; x++) if (x * x + y * y <= 256) set(cx + x, cy + y, [16, 16, 29]);
};
const cross = (set: (x: number, y: number, c: [number, number, number]) => void, cx: number, cy: number, c: [number, number, number]) => {
  for (let k = -9; k <= 9; k++)
    for (let t = -2; t <= 2; t++) {
      set(cx + k, cy + k + t, c);
      set(cx + k, cy - k + t, c);
    }
};

describe('findAltars（小地圖祭壇標記）', () => {
  it('深色圓底＋葉子色圖示 → Yggdrasil；十字紫 → Niflheim', () => {
    const f = frame((set) => {
      disc(set, 120, 220);
      cross(set, 120, 220, ALTAR_COLORS.yggdrasil);
      disc(set, 260, 100);
      cross(set, 260, 100, ALTAR_COLORS.niflheim);
    });
    const list = findAltars(f, SQ).sort((a, b) => a.x - b.x);
    expect(list.map((a) => a.id)).toEqual(['yggdrasil', 'niflheim']);
    expect(list[0]!.x).toBeCloseTo(120, -1);
    expect(list[0]!.d).toBeGreaterThan(25);
  });

  it('催眠師（實心紫圓，顏色接近 Niflheim）不當成祭壇', () => {
    const f = frame((set) => {
      disc(set, 150, 150);
      for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) if (x * x + y * y <= 100) set(150 + x, 150 + y, [172, 107, 232]);
    });
    expect(findAltars(f, SQ)).toEqual([]);
  });

  it('沒有深色圓底的色點（寶箱、首領點）不算', () => {
    const f = frame((set) => {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) set(200 + x, 200 + y, ALTAR_COLORS.emperium);
    });
    expect(findAltars(f, SQ)).toEqual([]);
  });
});
