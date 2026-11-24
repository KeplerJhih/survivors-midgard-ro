import { beforeAll, describe, expect, it } from 'vitest';
import { applyMobileSpoof } from '@/core/spoof/mobile';

describe('applyMobileSpoof', () => {
  beforeAll(() => applyMobileSpoof(window));

  it('通過頁面殼的 iOS 判斷（/play/ index.html）', () => {
    const IOS =
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    expect(IOS).toBe(true);
  });

  it('通過遊戲的觸控判斷（core/mouse_walk.gd _web_touch）', () => {
    expect(matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches).toBe(true);
  });

  it('跳過「加入主畫面」提示（core/web_host.gd _home_hint）', () => {
    expect((navigator as unknown as { standalone: boolean }).standalone).toBe(true);
  });

  it('其他 media query 不受影響', () => {
    expect(matchMedia('(min-width: 1px)').media).toBe('(min-width: 1px)');
  });

  it("'ontouchstart' in window", () => {
    expect('ontouchstart' in window).toBe(true);
  });
});
