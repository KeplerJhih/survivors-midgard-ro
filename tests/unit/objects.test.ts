import { describe, expect, it } from 'vitest';
import type { Frame } from '@/core/vision/frame';
import { createObjectSeeker, findObjects, TEMPLATES } from '@/core/vision/objects';

const W = 320;
const H = 224;

/** 草地雜訊背景，並在 (px,py) 左上角貼上樣板（灰階） */
function frame(paste?: { name: string; px: number; py: number }): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < W * H; i++) {
    const v = 110 + rnd() * 40;
    data.set([v * 0.9, v * 1.1, v * 0.6, 255], i * 4);
  }
  if (paste) {
    const t = TEMPLATES.find((x) => x.name === paste.name)!;
    for (let j = 0; j < t.h; j++)
      for (let i = 0; i < t.w; i++) {
        const v = t.data[j * t.w + i]!;
        data.set([v, v, v, 255], ((paste.py + j) * W + paste.px + i) * 4);
      }
  }
  return { width: W, height: H, data };
}

describe('findObjects', () => {
  it('找到貼上的木箱（形狀比對，與顏色無關：此處貼的是灰階）', () => {
    const hits = findObjects(frame({ name: 'woodbox', px: 200, py: 40 }), 0.8);
    expect(hits[0]!.name).toBe('woodbox');
    expect(hits[0]!.x).toBeGreaterThan(0);
    expect(hits[0]!.y).toBeLessThan(0);
  });

  it('找到鐵箱', () => {
    const hits = findObjects(frame({ name: 'steelbox', px: 80, py: 120 }), 0.8);
    expect(hits[0]!.name).toBe('steelbox');
  });

  it('純草地雜訊不誤判', () => {
    expect(findObjects(frame(), 0.8)).toEqual([]);
  });
});

describe('createObjectSeeker', () => {
  const hit = { name: 'woodbox', x: 0.3, y: 0, score: 0.9 };
  it('連續兩次在相近位置看到才前往；追太久放棄冷卻', () => {
    const s = createObjectSeeker(2, 10000, 10000);
    expect(s.update([hit], 0)).toBeNull();
    expect(s.update([{ ...hit, x: 0.28 }], 600)).toEqual(['right']);
    expect(s.update([hit], 11000)).toBeNull(); // 超時
    expect(s.update([hit], 15000)).toBeNull(); // 冷卻
  });
});
