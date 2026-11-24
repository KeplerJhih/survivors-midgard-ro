import { describe, expect, it } from 'vitest';
import { findBlob, type Frame } from '@/core/vision/frame';
import { createPortalSeeker, scanPortals, steerToExit, type PortalScan } from '@/core/vision/portal';

const GRASS: [number, number, number] = [90, 130, 60];
const EXIT: [number, number, number] = [195, 245, 255]; // 實機取樣的返回地圖傳送門色
const DANGER: [number, number, number] = [255, 135, 140]; // 實機取樣的 Niflheim 傳送門色

/** 建立 W×H 的草地畫面，並在指定中心畫 size×size 的色塊 */
function frame(blocks: { at: [number, number]; size: number; rgb: [number, number, number] }[], W = 160, H = 112): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...GRASS, 255], i * 4);
  for (const { at, size, rgb } of blocks) {
    for (let y = at[1] - size / 2; y < at[1] + size / 2; y++)
      for (let x = at[0] - size / 2; x < at[0] + size / 2; x++) data.set([...rgb, 255], (y * W + x) * 4);
  }
  return { width: W, height: H, data };
}

describe('findBlob', () => {
  it('回傳以畫面中心為原點、以寬度正規化的重心', () => {
    const b = findBlob(frame([{ at: [120, 56], size: 6, rgb: EXIT }]), (r, g, b) => g > 240 && b > 240)!;
    expect(b.count).toBe(36);
    expect(b.x).toBeCloseTo((119.5 - 80) / 160, 2);
    expect(b.y).toBeCloseTo((55.5 - 56) / 160, 2);
  });

  it('少於 minCount 回傳 null', () => {
    expect(findBlob(frame([{ at: [10, 10], size: 2, rgb: EXIT }]), () => false)).toBeNull();
  });
});

describe('scanPortals', () => {
  it('辨識出返回地圖與危險傳送門，草地不誤判', () => {
    const s = scanPortals(frame([
      { at: [130, 80], size: 6, rgb: EXIT },
      { at: [130, 30], size: 6, rgb: DANGER },
    ]));
    expect(s.exit!.x).toBeGreaterThan(0.2);
    expect(s.danger!.y).toBeLessThan(0);
    expect(scanPortals(frame([])).exit).toBeNull();
  });

  it('角色身邊的技能青光不算出口（實機誤判）', () => {
    expect(scanPortals(frame([{ at: [80, 56], size: 10, rgb: EXIT }])).exit).toBeNull();
  });

  it('太少點（特效雜訊）或太大（全螢幕閃光）都不算', () => {
    expect(scanPortals(frame([{ at: [40, 40], size: 2, rgb: EXIT }])).exit).toBeNull();
    expect(scanPortals(frame([{ at: [80, 56], size: 100, rgb: EXIT }])).exit).toBeNull();
    expect(scanPortals(frame([{ at: [40, 30], size: 24, rgb: EXIT }])).exit).toBeNull(); // 外框 0.15W
  });
});

const blob = (x: number, y: number) => ({ count: 30, x, y, w: 0.05, h: 0.05 });

describe('steerToExit', () => {
  it('朝出口方向走（畫面右下 → 右+下）', () => {
    expect(steerToExit({ exit: blob(0.3, 0.3), danger: null })).toEqual(['down', 'right']);
  });

  it('危險傳送門擋在路上時繞開，不朝它走', () => {
    // 出口在正右方遠處，危險傳送門在正右方較近處
    const dirs = steerToExit({ exit: blob(0.4, 0), danger: blob(0.2, -0.01) })!;
    expect(dirs).not.toEqual(['right']);
    expect(dirs).toContain('down'); // 危險在略上方 → 往下繞
  });

  it('危險傳送門不在路上時直走', () => {
    expect(steerToExit({ exit: blob(0.4, 0), danger: blob(0, -0.3) })).toEqual(['right']);
  });
});

describe('createPortalSeeker', () => {
  const seen: PortalScan = { exit: blob(0.3, 0), danger: null };
  const none: PortalScan = { exit: null, danger: null };

  it('連續 3 次看到才開始導航（排除特效閃一下）', () => {
    const s = createPortalSeeker(3, 6);
    expect(s.update(seen)).toBeNull();
    expect(s.update(seen)).toBeNull();
    expect(s.update(seen)).toEqual(['right']);
    expect(s.seeking).toBe(true);
  });

  it('單次閃現後消失不會觸發', () => {
    const s = createPortalSeeker(3, 6);
    s.update(seen);
    for (let i = 0; i < 6; i++) s.update(none);
    s.update(seen);
    s.update(seen);
    expect(s.seeking).toBe(false);
  });

  it('連續 6 次看不到才放棄（短暫被遮住不中斷）', () => {
    const s = createPortalSeeker(3, 6);
    for (let i = 0; i < 3; i++) s.update(seen);
    for (let i = 0; i < 5; i++) s.update(none);
    expect(s.seeking).toBe(true);
    s.update(none);
    expect(s.seeking).toBe(false);
  });
});
