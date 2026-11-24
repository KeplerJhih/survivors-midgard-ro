import { describe, expect, it } from 'vitest';
import { decide, type Perception } from '@/core/bot/decide';
import { throttle } from '@/core/bot/throttle';

const pat = { patrol: ['up' as const], retreat: ['left' as const], kite: ['down' as const] };
const base: Perception = { portal: null, target: null, flee: null, danger: null, lowHp: false, boss: false };
const safe = { center: 0, dirs: [0, 0, 0, 0, 0, 0, 0, 0] };

describe('decide（移動優先順序）', () => {
  it('沒有任何事件 → 一般走位', () => {
    expect(decide(base, pat)).toEqual({ activity: 'patrol', want: ['up'] });
  });

  it('傳送門 > 目標 > 走位', () => {
    expect(decide({ ...base, portal: ['right'], target: ['left'] }, pat).activity).toBe('portal');
    expect(decide({ ...base, target: ['left'] }, pat).activity).toBe('target');
  });

  it('低血量、首領戰時不追目標，改大圈', () => {
    expect(decide({ ...base, target: ['right'], lowHp: true }, pat)).toEqual({ activity: 'retreat', want: ['left'] });
    expect(decide({ ...base, target: ['right'], boss: true }, pat)).toEqual({ activity: 'kite', want: ['down'] });
  });

  it('催眠師螺旋太近 → 逃，但走向傳送門時不理', () => {
    expect(decide({ ...base, flee: ['down'] }, pat).activity).toBe('flee');
    expect(decide({ ...base, flee: ['down'], portal: ['up'] }, pat).activity).toBe('portal');
  });

  it('紅框最後修正方向（連傳送門也要躲）', () => {
    const danger = { center: 0, dirs: [0, 0, 0.9, 0, 0, 0, 0, 0] }; // 正上方危險
    const d = decide({ ...base, portal: ['up'], danger }, pat);
    expect(d.activity).toBe('dodge');
    expect(d.want).not.toEqual(['up']);
    expect(decide({ ...base, danger: safe }, pat).activity).toBe('patrol');
  });
});

describe('throttle', () => {
  it('間隔內回傳快取，fresh 標示是否剛重新計算', () => {
    let n = 0;
    const t = throttle(100, () => ++n, 0);
    expect(t.get(0)).toBe(1);
    expect(t.fresh).toBe(true);
    expect(t.get(50)).toBe(1);
    expect(t.fresh).toBe(false);
    expect(t.get(100)).toBe(2);
    t.reset();
    expect(t.get(110)).toBe(3);
  });
});
