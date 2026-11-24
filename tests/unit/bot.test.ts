import { describe, expect, it } from 'vitest';
import { createBot } from '@/core/bot/bot';
import { createKeyboard } from '@/core/input/keyboard';
import { DEFAULT_SETTINGS, type BotConfig } from '@/core/settings';

function setup(overrides: Partial<BotConfig> = {}) {
  let t = 0;
  const sent: string[] = [];
  const target = new EventTarget();
  for (const type of ['keydown', 'keyup']) {
    target.addEventListener(type, (e) => sent.push(`${type}:${(e as KeyboardEvent).code}`));
  }
  const keyboard = createKeyboard(target, { sleep: async () => {} });
  const cfg: BotConfig = { ...DEFAULT_SETTINGS.bot, ...overrides };
  const bot = createBot(cfg, { keyboard, now: () => t });
  const heldDirs = () => [...keyboard.held()].filter((k) => k !== 'pick1' && k !== 'enter');
  return { bot, keyboard, heldDirs, sent, advance: (ms: number) => (t += ms), cfg };
}

describe('bot', () => {
  it('未啟用時不送任何按鍵', () => {
    const { bot, sent } = setup({ enabled: false });
    bot.tick();
    expect(sent).toEqual([]);
    expect(bot.state.running).toBe(false);
  });

  it('啟用後按住走位方向，並送 1 選卡', () => {
    const { bot, heldDirs } = setup({ enabled: true, mode: 'circle', circlePeriodMs: 8000 });
    bot.tick();
    expect(heldDirs()).toEqual(['right']);
    expect(bot.state.picks).toBe(1);
  });

  it('方向改變時放開舊鍵、按下新鍵', () => {
    const { bot, heldDirs, advance } = setup({ enabled: true, circlePeriodMs: 8000 });
    bot.tick();
    advance(2000); // 1/4 圈 → 上
    bot.tick();
    expect(heldDirs()).toEqual(['up']);
  });

  it('選卡依間隔送，不會每個 tick 都送', () => {
    const { bot, advance } = setup({ enabled: true, pickIntervalMs: 1500 });
    for (let i = 0; i < 30; i++) {
      bot.tick();
      advance(100);
    }
    expect(bot.state.picks).toBe(2); // t=0, t=1500
  });

  it('Enter 預設關閉', () => {
    const { bot, sent } = setup({ enabled: true });
    bot.tick();
    expect(sent.some((s) => s.endsWith(':Enter'))).toBe(false);
  });

  it('enterEnabled 時依間隔送 Enter', () => {
    const { bot, sent } = setup({ enabled: true, enterEnabled: true });
    bot.tick();
    expect(sent).toContain('keydown:Enter');
  });

  it('停用時放開所有按鍵', () => {
    const { bot, keyboard, cfg } = setup({ enabled: true });
    bot.tick();
    expect(keyboard.held().size).toBeGreaterThan(0);
    bot.update({ ...cfg, enabled: false });
    expect(keyboard.held().size).toBe(0);
  });
});
