import { describe, expect, it } from 'vitest';
import { createBot } from '@/core/bot/bot';
import { createKeyboard } from '@/core/input/keyboard';
import { DEFAULT_SETTINGS, type BotConfig } from '@/core/settings';
import type { PortalScan } from '@/core/vision/portal';

function setup(overrides: Partial<BotConfig> = {}, scan?: () => PortalScan | null) {
  let t = 0;
  const sent: string[] = [];
  const target = new EventTarget();
  for (const type of ['keydown', 'keyup']) {
    target.addEventListener(type, (e) => sent.push(`${type}:${(e as KeyboardEvent).code}`));
  }
  const keyboard = createKeyboard(target, { sleep: async () => {} });
  const cfg: BotConfig = { ...DEFAULT_SETTINGS.bot, mode: 'circle', ...overrides };
  const bot = createBot(cfg, { keyboard, now: () => t, scanPortals: scan });
  const heldDirs = () => [...keyboard.held()].filter((k) => k !== 'pick1');
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

  it('停用時放開所有按鍵', () => {
    const { bot, keyboard, cfg } = setup({ enabled: true });
    bot.tick();
    expect(keyboard.held().size).toBeGreaterThan(0);
    bot.update({ ...cfg, enabled: false });
    expect(keyboard.held().size).toBe(0);
  });

  it('確認看到返回地圖傳送門後改為朝它走，消失後回到原本走位', () => {
    let exit: PortalScan['exit'] = { count: 30, x: 0, y: 0.3, w: 0.05, h: 0.05 }; // 正下方
    const { bot, heldDirs, advance } = setup({ enabled: true, circlePeriodMs: 8000 }, () => ({ exit, danger: null }));
    for (let i = 0; i < 3; i++) {
      bot.tick();
      advance(250);
    }
    expect(bot.state.activity).toBe('portal');
    expect(heldDirs()).toEqual(['down']);

    exit = null;
    for (let i = 0; i < 6; i++) {
      bot.tick();
      advance(250);
    }
    expect(bot.state.activity).toBe('patrol');
  });

  it('portalSeek 關閉時不掃描畫面', () => {
    let calls = 0;
    const { bot } = setup({ enabled: true, portalSeek: false }, () => (calls++, null));
    bot.tick();
    expect(calls).toBe(0);
  });

  it('停在需要點擊的畫面時：放開方向鍵並點擊', async () => {
    let t = 0;
    const taps: [number, number][] = [];
    const target = new EventTarget();
    const keyboard = createKeyboard(target, { sleep: async () => {} });
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'circle' },
      {
        keyboard,
        now: () => t,
        detectScreen: () => ({ kind: 'result', x: 0.4, y: 0.95 }),
        pointer: { tap: async (x, y) => void taps.push([x, y]) },
      },
    );
    bot.tick();
    expect(bot.state.activity).toBe('screen');
    expect([...keyboard.held()].filter((k) => k !== 'pick1')).toEqual([]);
    t += 500;
    bot.tick();
    expect(taps).toEqual([[0.4, 0.95]]);
  });

  it('低血量：不追指示器目標、改大圈移動', () => {
    let t = 0;
    let fill = 20;
    const target = new EventTarget();
    const keyboard = createKeyboard(target, { sleep: async () => {} });
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'circle' },
      {
        keyboard,
        now: () => t,
        readHp: () => ({ fill, low: fill < 5 }),
        findIndicators: () => [{ kind: 'target', x: 0, y: -0.3, icon: [255, 218, 112], size: 0.05 }],
      },
    );
    bot.tick();
    t += 500;
    bot.tick();
    expect(bot.state.activity).toBe('target');

    fill = 4; // 變紅
    t += 500;
    bot.tick();
    expect(bot.state.activity).toBe('retreat');
    expect(bot.state.hp).toBeCloseTo(0.2);
  });

  it('首領戰：不追目標、改大圈風箏', () => {
    let t = 0;
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'circle' },
      {
        keyboard,
        now: () => t,
        readHp: () => ({ fill: 20, low: false }),
        bossFight: () => true,
        findIndicators: () => [{ kind: 'target', x: 0, y: -0.3, icon: [255, 218, 112], size: 0.05 }],
      },
    );
    bot.tick();
    t += 500;
    bot.tick();
    expect(bot.state.boss).toBe(true);
    expect(bot.state.activity).toBe('kite');
  });
});

