import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '@/core/settings';

describe('mergeSettings', () => {
  it('空值回傳預設', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('補齊舊版缺少的欄位，保留已存的值', () => {
    const s = mergeSettings({ mobile: false, bot: { enabled: true } });
    expect(s.mobile).toBe(false);
    expect(s.background).toBe(DEFAULT_SETTINGS.background);
    expect(s.bot.enabled).toBe(true);
    expect(s.bot.pickIntervalMs).toBe(DEFAULT_SETTINGS.bot.pickIntervalMs);
  });

  it('預設不啟用掛機', () => {
    expect(DEFAULT_SETTINGS.bot.enabled).toBe(false);
  });
});
