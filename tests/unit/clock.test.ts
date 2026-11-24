import { describe, expect, it } from 'vitest';
import { clockGlyph, createFreezeDetector } from '@/core/vision/clock';
import { findMinimapSquare } from '@/core/vision/minimap';
import { decide } from '@/core/bot/decide';

const glyph = (seed: number) => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + seed * 13) % 5 === 0 ? 1 : 0));

describe('createFreezeDetector', () => {
  it('看過時鐘走動後，連續 3 秒不變判定停住；恢復走動解除', () => {
    const d = createFreezeDetector(3000);
    let t = 0;
    for (let s = 0; s < 4; s++, t += 1000) expect(d.update(glyph(s), t)).toBe(false);
    expect(d.ticking).toBe(true);
    for (let s = 0; s < 3; s++, t += 1000) d.update(glyph(99), t);
    expect(d.update(glyph(99), t)).toBe(true);
    expect(d.update(glyph(100), t + 1000)).toBe(false);
  });

  it('沒看過走動（開局就停住）、讀不到時鐘都不判定', () => {
    const d = createFreezeDetector(3000);
    for (let s = 0; s < 8; s++) expect(d.update(glyph(0), s * 1000)).toBe(false);
    expect(d.ticking).toBe(false);
    expect(d.update(null, 9000)).toBe(false);
  });
});

describe('findMinimapSquare + clockGlyph', () => {
  // 合成：200x300，小地圖方框 x 40~140、y 20~120（邊框色），時鐘列在底邊下方 0.19~0.31 S（y 139~151）
  const W = 200;
  const H = 300;
  const make = (digits: number) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([240, 240, 245, 255], i * 4);
    for (let x = 40; x < 140; x++) {
      data.set([148, 168, 219, 255], (20 * W + x) * 4);
      data.set([148, 168, 219, 255], (120 * W + x) * 4);
    }
    for (let y = 142; y < 149; y++) for (let x = 50; x < 50 + digits; x++) data.set([20, 20, 30, 255], (y * W + x) * 4);
    return { width: W, height: H, data };
  };
  it('找到方框並讀出時鐘列的字形', () => {
    const f = make(10);
    const sq = findMinimapSquare(f)!;
    expect(sq).toEqual({ x0: 40, y0: 20, x1: 140, y1: 120 });
    const g = clockGlyph(f, sq);
    expect(g.reduce((s, v) => s + v, 0)).toBe(70);
    expect(clockGlyph(make(20), sq).reduce((s, v) => s + v, 0)).toBe(140);
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
