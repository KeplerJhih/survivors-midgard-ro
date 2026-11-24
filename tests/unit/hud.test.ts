import { describe, expect, it } from 'vitest';
import type { Frame } from '@/core/vision/frame';
import { createHpTracker, readHp } from '@/core/vision/hud';

const W = 320;
const H = 224;

/** 左上視窗：HP 條（y=8）、SP 條（y=13），填滿長度 hpFill / spFill（起點 x=30） */
function frame(hpFill: number, hpRgb = [84, 140, 242], spFill = 20): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([245, 246, 250, 255], i * 4);
  const bar = (y: number, len: number, rgb: number[]) => {
    for (let x = 30; x < 50; x++) data.set([220, 228, 245, 255], (y * W + x) * 4);
    for (let x = 30; x < 30 + len; x++) data.set([...rgb, 255], (y * W + x) * 4);
  };
  bar(8, hpFill, hpRgb);
  bar(13, spFill, [84, 140, 242]);
  return { width: W, height: H, data };
}

describe('readHp', () => {
  it('讀最上面那條（HP）的填滿長度', () => {
    expect(readHp(frame(20, undefined, 5))).toEqual({ fill: 20, low: false });
    expect(readHp(frame(8, undefined, 20))).toEqual({ fill: 8, low: false });
  });

  it('HP 條變紅（< 25%）→ low', () => {
    expect(readHp(frame(4, [235, 77, 97]))!.low).toBe(true);
  });
});

describe('createHpTracker', () => {
  it('以看過的最長長度當滿血換算比例', () => {
    const t = createHpTracker();
    expect(t.update({ fill: 20, low: false })!.ratio).toBe(1);
    expect(t.update({ fill: 7, low: false })!.ratio).toBeCloseTo(0.35);
    expect(t.update({ fill: 4, low: true })).toEqual({ ratio: 0.2, low: true });
  });
});
