import { describe, expect, it } from 'vitest';
import { createFreezeDetector } from '@/core/vision/clock';
import { decide } from '@/core/bot/decide';

const glyph = (seed: number) => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + seed) % 5 === 0 ? 1 : 0));

describe('createFreezeDetector', () => {
  it('字形連續 3 秒不變才判定停住；一變就解除', () => {
    const d = createFreezeDetector(3000);
    expect(d.update(glyph(0), 0)).toBe(false);
    expect(d.update(glyph(0), 1000)).toBe(false);
    expect(d.update(glyph(0), 3000)).toBe(false);
    expect(d.update(glyph(0), 4000)).toBe(true);
    expect(d.update(glyph(1), 5000)).toBe(false);
  });

  it('字形太少（讀不到時鐘）不判定', () => {
    const d = createFreezeDetector(1000);
    const empty = new Uint8Array(300);
    d.update(empty, 0);
    expect(d.update(empty, 5000)).toBe(false);
  });
});

describe('decide（時間停住＝MVP 入口開著）', () => {
  const pat = { patrol: ['up' as const], retreat: ['left' as const], kite: ['down' as const] };
  const base = { portal: null, target: null, flee: null, danger: null, lowHp: false, boss: false };

  it('走向粉紫光圈、不追目標、不逃螺旋', () => {
    const d = decide({ ...base, frozen: true, approach: ['left'], target: ['right'], flee: ['right'] }, pat);
    expect(d).toEqual({ activity: 'enter', want: ['left'] });
  });

  it('看不到光圈就一般走位掃', () => {
    expect(decide({ ...base, frozen: true }, pat)).toEqual({ activity: 'patrol', want: ['up'] });
  });

  it('首領戰（MVP 戰中時間也停）照常風箏；出口優先', () => {
    expect(decide({ ...base, frozen: true, boss: true, approach: ['left'] }, pat).activity).toBe('kite');
    expect(decide({ ...base, frozen: true, portal: ['down'], approach: ['left'] }, pat).activity).toBe('portal');
  });
});
