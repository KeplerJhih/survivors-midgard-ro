import { describe, expect, it } from 'vitest';
import type { Frame } from '@/core/vision/frame';
import { bossFight, createBossTracker, createHpTracker, readHp } from '@/core/vision/hud';

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
    expect(readHp(frame(20, undefined, 5))).toMatchObject({ fill: 20, low: false });
    expect(readHp(frame(8, undefined, 20))).toMatchObject({ fill: 8, low: false });
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

  it('HP 條這一刻沒抓到、讀到下面的經驗條 → 當讀不到，不當成低血量', () => {
    const t = createHpTracker();
    expect(t.update({ fill: 20, low: false, y: 0.04 })!.ratio).toBe(1);
    expect(t.update({ fill: 5, low: false, y: 0.09 })).toBeNull();
    expect(t.update({ fill: 19, low: false, y: 0.041 })!.ratio).toBeCloseTo(0.95);
  });
});

describe('bossFight', () => {
  it('上方中央有首領粉紅血條 → true；沒有 → false', () => {
    const f = frame(20);
    expect(bossFight(f)).toBe(false);
    const d = f.data as Uint8ClampedArray;
    for (let y = 8; y < 11; y++) for (let x = 123; x < 197; x++) d.set([237, 107, 140, 255], (y * W + x) * 4);
    expect(bossFight(f)).toBe(true);
  });
});

describe('createBossTracker', () => {
  it('血條 15 秒沒下降 → stalled；開始下降就恢復', () => {
    const t = createBossTracker(15000);
    expect(t.update(0.003, 0)).toEqual({ boss: true, stalled: false });
    expect(t.update(0.003, 14000).stalled).toBe(false);
    expect(t.update(0.003, 15000).stalled).toBe(true);
    expect(t.update(0.0028, 16000).stalled).toBe(false);
  });
  it('雙門檻：進入要夠長的血條，之後剩很少仍算首領戰', () => {
    const t = createBossTracker(15000);
    expect(t.update(0.001, 0).boss).toBe(false);
    expect(t.update(0.003, 100).boss).toBe(true);
    expect(t.update(0.0005, 200).boss).toBe(true);
    expect(t.update(0.0001, 300).boss).toBe(false);
  });

  it('首領戰結束（血條消失）重置', () => {
    const t = createBossTracker(15000);
    t.update(0.003, 0);
    expect(t.update(0, 20000)).toEqual({ boss: false, stalled: false });
    expect(t.update(0.003, 21000).stalled).toBe(false);
  });
});
