import { describe, expect, it } from 'vitest';
import { applyAspectLock, fitAspect, LOCKED_ASPECT } from '@/core/display/aspect';

describe('fitAspect（鎖定畫面比例）', () => {
  it('窄高視窗（實機 1080×906）：寬度用滿、上下留黑邊', () => {
    expect(fitAspect(1080, 906, 2.2)).toEqual({ width: 1080, height: 491, left: 0, top: 208 });
  });

  it('超寬視窗：高度用滿、左右留黑邊', () => {
    const b = fitAspect(2560, 800, 2.2);
    expect(b).toEqual({ width: 1760, height: 800, left: 400, top: 0 });
  });

  it('剛好是鎖定比例：整個視窗都用', () => {
    expect(fitAspect(2200, 1000, 2.2)).toEqual({ width: 2200, height: 1000, left: 0, top: 0 });
  });

  it('直立、方形、超寬：結果的比例都一樣', () => {
    for (const [w, h] of [[390, 844], [900, 900], [1920, 1080], [3440, 600]] as const) {
      const b = fitAspect(w, h);
      expect(b.width / b.height).toBeCloseTo(LOCKED_ASPECT, 1);
      expect(b.width).toBeLessThanOrEqual(w);
      expect(b.height).toBeLessThanOrEqual(h);
    }
  });
});

describe('applyAspectLock', () => {
  it('遊戲讀到的 innerWidth / innerHeight 是固定比例；視窗改大小後跟著變；畫布置中；解除後還原', () => {
    let size = { w: 1080, h: 906 };
    Object.defineProperty(window, 'innerWidth', { get: () => size.w, configurable: true });
    Object.defineProperty(window, 'innerHeight', { get: () => size.h, configurable: true });
    const css = () => [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 2, configurable: true });
    const unlock = applyAspectLock(window, 2.2);
    expect([window.innerWidth, window.innerHeight]).toEqual([1080, 491]);
    expect(css()).toContain('top:208px !important');
    // 畫布實際像素固定：innerWidth × devicePixelRatio 一律是 3136
    expect(window.innerWidth * window.devicePixelRatio).toBeCloseTo(3136, 5);

    size = { w: 2560, h: 800 };
    window.dispatchEvent(new Event('resize'));
    expect([window.innerWidth, window.innerHeight]).toEqual([1760, 800]);
    expect(window.innerWidth * window.devicePixelRatio).toBeCloseTo(3136, 5);
    expect(css()).toContain('left:400px !important');

    unlock();
    expect(window.devicePixelRatio).toBe(2);
    expect([window.innerWidth, window.innerHeight]).toEqual([2560, 800]);
    expect(css()).toBe('');
  });
});
