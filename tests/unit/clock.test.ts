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
    for (let s = 0; s < 4; s++, t += 1000) d.update(glyph(99), t); // 變化下一筆確認 → 晚一筆
    expect(d.update(glyph(99), t)).toBe(true);
    expect(d.update(glyph(100), t + 1000)).toBe(true); // 恢復走動也要下一筆確認
    expect(d.update(glyph(101), t + 2000)).toBe(false);
  });

  it('停住期間時鐘被飄過的東西蓋住一瞬間（下一筆變回原樣）不算走動', () => {
    const d = createFreezeDetector(3000);
    let t = 0;
    for (let s = 0; s < 4; s++, t += 1000) d.update(glyph(s), t);
    for (let i = 0; i < 5; i++, t += 1000) d.update(glyph(50), t);
    expect(d.update(glyph(50), t)).toBe(true);
    expect(d.update(glyph(77), t + 1000)).toBe(true); // 傷害數字飄過
    expect(d.update(glyph(50), t + 2000)).toBe(true);
    expect(d.update(glyph(50), t + 3000)).toBe(true);
  });

  it('沒看過走動（開局就停住）、讀不到時鐘都不判定', () => {
    const d = createFreezeDetector(3000);
    for (let s = 0; s < 8; s++) expect(d.update(glyph(0), s * 1000)).toBe(false);
    expect(d.ticking).toBe(false);
    expect(d.update(null, 9000)).toBe(false);
  });

  it('停住期間偶爾讀不到時鐘，沿用停住狀態', () => {
    const d = createFreezeDetector(3000);
    let t = 0;
    for (let s = 0; s < 3; s++, t += 1000) d.update(glyph(s), t);
    for (let s = 0; s < 5; s++, t += 1000) d.update(glyph(50), t);
    expect(d.update(null, t)).toBe(true);
    expect(d.update(glyph(50), t + 1000)).toBe(true);
  });

  it('字形長度變了（方框寬度差幾 px）不重新計時，停住判定不閃動', () => {
    const d = createFreezeDetector(3000);
    let t = 0;
    for (let s = 0; s < 4; s++, t += 1000) d.update(glyph(s), t);
    for (let i = 0; i < 4; i++, t += 1000) d.update(glyph(3), t);
    expect(d.update(glyph(3), t)).toBe(true);
    const shorter = glyph(3).slice(0, 290);
    expect(d.update(shorter, t + 500)).toBe(true);
    expect(d.update(glyph(3), t + 1000)).toBe(true);
  });

  it('載入畫面（沒有字）不重置：之後時鐘一直停在同一個數字 → 判定停住', () => {
    const d = createFreezeDetector(3000);
    let t = 0;
    for (let s = 0; s < 4; s++, t += 1000) d.update(glyph(s), t);
    for (let i = 0; i < 3; i++, t += 1000) d.update(new Uint8Array(300), t); // 載入畫面
    for (let i = 0; i < 4; i++, t += 1000) d.update(glyph(3), t); // 巢穴內時鐘停在原本的數字
    expect(d.update(glyph(3), t)).toBe(true);
  });

  it('時鐘在走時長時間讀不到（圖示壓住小地圖邊框）不會變成停住；讀不到超過 5 秒停住狀態也解除', () => {
    const d = createFreezeDetector(3000);
    let t = 0;
    for (let s = 0; s < 4; s++, t += 1000) d.update(glyph(s), t);
    for (let i = 0; i < 10; i++, t += 1000) expect(d.update(null, t)).toBe(false);
    const e = createFreezeDetector(3000);
    t = 0;
    for (let s = 0; s < 3; s++, t += 1000) e.update(glyph(s), t);
    for (let s = 0; s < 5; s++, t += 1000) e.update(glyph(50), t);
    const last = t - 1000;
    expect(e.update(null, last + 4000)).toBe(true);
    expect(e.update(null, last + 6000)).toBe(false);
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
      data.set([148, 168, 219, 255], (121 * W + x) * 4); // 雙列邊框：取上面那列
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

  it('底邊被圖示壓斷時，用上邊 + 邊長推出方框', () => {
    const f = make(10);
    for (let y = 114; y < 128; y++) for (let x = 80; x < 100; x++) f.data.set([255, 38, 25, 255], (y * W + x) * 4);
    // 外層面板邊框（比方框長、在方框上方）不能被當成上邊
    for (let x = 20; x < 180; x++) f.data.set([148, 168, 219, 255], (12 * W + x) * 4);
    expect(findMinimapSquare(f)).toEqual({ x0: 40, y0: 20, x1: 140, y1: 120 });
  });

  it('上邊被圖示壓斷時，用底邊 − 邊長推出方框', () => {
    const f = make(10);
    for (let y = 14; y < 28; y++) for (let x = 80; x < 100; x++) f.data.set([255, 38, 25, 255], (y * W + x) * 4);
    expect(findMinimapSquare(f)).toEqual({ x0: 40, y0: 20, x1: 140, y1: 120 });
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
