import { describe, expect, it } from 'vitest';
import { createClockTracker, type TextBand } from '@/core/vision/clock';
import { decide } from '@/core/bot/decide';

const band = (y: number, seed: number): TextBand => {
  const mask = Uint8Array.from({ length: 200 }, (_, i) => ((i * 7 + seed * 13) % 5 === 0 ? 1 : 0));
  return { y, mask, on: mask.reduce((s, v) => s + v, 0) };
};

describe('createClockTracker（自動定位時鐘）', () => {
  it('鎖定每秒在變的文字帶；之後該帶連續 3 秒不變判定停住', () => {
    const t = createClockTracker(3000);
    let now = 0;
    // 地圖名稱帶（y=10）不變，時鐘帶（y=30）每秒變
    for (let s = 0; s < 6; s++, now += 1000) expect(t.update([band(10, 0), band(30, s)], now)).toBe(false);
    expect(t.locked).toBe(30);
    // 時鐘停住
    for (let s = 0; s < 3; s++, now += 1000) t.update([band(10, 0), band(30, 99)], now);
    expect(t.update([band(10, 0), band(30, 99)], now)).toBe(true);
    // 恢復走動
    expect(t.update([band(10, 0), band(30, 100)], now + 1000)).toBe(false);
  });

  it('還沒鎖定時（開局就停住）不判定停住', () => {
    const t = createClockTracker(3000);
    for (let s = 0; s < 8; s++) expect(t.update([band(10, 0), band(30, 0)], s * 1000)).toBe(false);
    expect(t.locked).toBeNull();
  });

  it('時鐘帶消失超過 5 秒就解除鎖定（版面改變）', () => {
    const t = createClockTracker(3000);
    for (let s = 0; s < 6; s++) t.update([band(30, s)], s * 1000);
    expect(t.locked).toBe(30);
    for (let s = 6; s < 13; s++) t.update([band(70, 0)], s * 1000);
    expect(t.locked).toBeNull();
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
