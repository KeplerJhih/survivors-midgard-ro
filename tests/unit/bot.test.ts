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
    expect(bot.state.activity).not.toBe('screen'); // 單次偵測不停下
    t += 500;
    bot.tick();
    expect(bot.state.activity).toBe('screen');
    expect([...keyboard.held()].filter((k) => k !== 'pick1')).toEqual([]);
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

    // 遲滯：回到 0.6（> 門檻 0.5、< 0.7）仍撤退；0.75 才恢復
    fill = 12;
    t += 500;
    bot.tick();
    expect(bot.state.activity).toBe('retreat');
    fill = 15;
    t += 500;
    bot.tick();
    expect(bot.state.activity).toBe('retreat'); // 一筆回升不算，要連續 3 秒
    fill = 11; // 讀數跳回 0.55 → 重新計時
    t += 500;
    bot.tick();
    fill = 15;
    for (let i = 0; i < 5; i++) {
      t += 500;
      bot.tick();
      expect(bot.state.activity).toBe('retreat');
    }
    t += 1000;
    bot.tick();
    expect(bot.state.activity).toBe('target');
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
        bossBar: () => 0.003,
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


describe('首領血條久不下降 → 依小地圖走向首領', () => {
  it('校正後往首領點走（activity target）', () => {
    let t = 0;
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    // 對應：按右 → 小地圖 +x、按上 → 小地圖 -y（一般地圖方向）；玩家依按住方向移動
    let p = { x: 100, y: 100 };
    let held: string[] = [];
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'flower' },
      {
        keyboard,
        now: () => t,
        bossBar: () => 0.003,
        readMinimap: () => ({ player: { ...p }, boss: { x: -500, y: 100 } }),
      },
    );
    for (; t < 40000; t += 100) {
      bot.tick();
      held = bot.state.dirs;
      p = {
        x: p.x + ((held.includes('right') ? 1 : 0) - (held.includes('left') ? 1 : 0)) * 0.3,
        y: p.y - ((held.includes('up') ? 1 : 0) - (held.includes('down') ? 1 : 0)) * 0.3,
      };
    }
    expect(bot.state.activity).toBe('target');
    expect(bot.state.dirs).toEqual(['left']);
  });
});

describe('MVP 巢穴：勝利後走淡藍出口，不走金色因果路線', () => {
  it('時間停住期間打過首領 → 改用出口方向；沒打過首領（入口）→ 用入口光方向', () => {
    let t = 0;
    let bar = 0;
    let digit = 0;
    let frozenClock = false;
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'circle' },
      {
        keyboard,
        now: () => t,
        clockGlyph: () => {
          if (!frozenClock) digit++;
          return glyph();
        },
        bossBar: () => bar,
        approachSwirl: () => ['left'],
        approachExit: () => ['right'],
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(4000); // 時鐘在走
    frozenClock = true;
    run(5000); // 停住（入口開著）
    expect(bot.state.frozen).toBe(true);
    expect(bot.state.activity).toBe('enter');
    expect(bot.state.dirs).toEqual(['left']);
    bar = 0.003;
    for (let i = 0; i < 20; i++) (bar -= 0.0001), run(500); // 巢穴內首領戰（血條持續下降）
    expect(bot.state.boss).toBe(true);
    bar = 0; // 擊敗
    run(3000);
    expect(bot.state.boss).toBe(false);
    expect(bot.state.activity).toBe('enter');
    expect(bot.state.dirs).toEqual(['right']);
    // 無盡模式：勝利後巢穴內時鐘恢復走動，仍在 30 秒內找出口
    frozenClock = false;
    run(8000);
    expect(bot.state.frozen).toBe(false);
    expect(bot.state.activity).toBe('enter');
    expect(bot.state.dirs).toEqual(['right']);
    run(25000); // 超過時限 → 回到一般走位
    expect(bot.state.activity).not.toBe('enter');
  });

  it('勝利後找出口期間低血量 → 撤退優先', () => {
    let t = 0;
    let bar = 0;
    let digit = 0;
    let frozenClock = false;
    let fill = 20;
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'circle' },
      {
        keyboard,
        now: () => t,
        clockGlyph: () => {
          if (!frozenClock) digit++;
          return glyph();
        },
        bossBar: () => bar,
        readHp: () => ({ fill, low: false }),
        approachExit: () => ['right'],
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(4000);
    frozenClock = true;
    run(5000);
    bar = 0.003;
    for (let i = 0; i < 10; i++) (bar -= 0.0001), run(500);
    bar = 0;
    run(2000);
    expect(bot.state.activity).toBe('enter');
    frozenClock = false; // 回到地圖、時鐘恢復（仍在 30 秒出口時限內）
    fill = 3; // 15%
    run(2000);
    expect(bot.state.activity).toBe('retreat');
  });
});

describe('視窗辨識失敗的備援（與畫面大小無關）', () => {
  const frame = (v: number) => ({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(v) });

  it('同一個視窗點 3 次還在 → 與點擊交替按 Enter', async () => {
    let t = 0;
    const order: string[] = [];
    const target = new EventTarget();
    target.addEventListener('keydown', (e) => (e as KeyboardEvent).code === 'Enter' && order.push('enter'));
    const keyboard = createKeyboard(target, { sleep: async () => {} });
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true },
      {
        keyboard,
        now: () => t,
        detectScreen: () => ({ kind: 'modal', x: 0.5, y: 0.7 }),
        pointer: { tap: async () => void order.push('tap') },
      },
    );
    for (; t < 20000; t += 250) {
      bot.tick();
      await new Promise((r) => setTimeout(r, 0)); // 讓按鍵放開
    }
    expect(order.slice(0, 6)).toEqual(['tap', 'tap', 'tap', 'enter', 'tap', 'enter']);
  });

  it('腐化寶箱點不掉也不按 Enter（預設焦點是 Hel）', () => {
    let t = 0;
    const sent: string[] = [];
    const target = new EventTarget();
    target.addEventListener('keydown', (e) => sent.push((e as KeyboardEvent).code));
    const keyboard = createKeyboard(target, { sleep: async () => {} });
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true },
      { keyboard, now: () => t, detectScreen: () => ({ kind: 'corrupt', x: 0.7, y: 0.8 }), pointer: { tap: async () => {} } },
    );
    for (; t < 20000; t += 250) bot.tick();
    expect(sent).not.toContain('Enter');
  });

  const stillSetup = (clockRuns: boolean) => {
    let t = 0;
    let digit = 0;
    let frozenGame = false;
    const sent: string[] = [];
    const target = new EventTarget();
    target.addEventListener('keydown', (e) => sent.push((e as KeyboardEvent).code));
    const keyboard = createKeyboard(target, { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true },
      {
        keyboard,
        now: () => t,
        detectScreen: () => null,
        pointer: { tap: async () => {} },
        clockGlyph: () => {
          if (clockRuns && !frozenGame) digit++;
          return glyph();
        },
        stillFrame: () => frame(frozenGame ? 50 : (t / 250) % 2 ? 0 : 200),
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    return { bot, sent, run, pause: () => (frozenGame = true) };
  };

  it('對局中跳出辨識不到的視窗（畫面整個靜止）→ 4 秒後按 Enter', () => {
    const { sent, run, pause } = stillSetup(true);
    run(5000);
    expect(sent).not.toContain('Enter');
    pause();
    run(3000);
    expect(sent).not.toContain('Enter');
    run(3000);
    expect(sent).toContain('Enter');
  });

  it('不在對局中（時鐘沒走過，例如城鎮）畫面靜止不按 Enter', () => {
    const { sent, run, pause } = stillSetup(false);
    pause();
    run(15000);
    expect(sent).not.toContain('Enter');
  });

  it('升級三張普通卡（判成初始技能）不會每次都觸發設定同步', () => {
    let t = 0;
    let requests = 0;
    let show = true;
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true },
      {
        keyboard,
        now: () => t,
        detectScreen: () => (show ? { kind: 'start-skill', x: 0.3, y: 0.5 } : null),
        pointer: { tap: async () => {} },
        gameSync: { request: () => void requests++, tick: () => false, busy: false } as never,
      },
    );
    for (let i = 0; i < 5; i++) {
      show = true;
      for (let e = 0; e < 2000; e += 250) (t += 250), bot.tick();
      show = false;
      for (let e = 0; e < 10000; e += 250) (t += 250), bot.tick();
    }
    expect(requests).toBe(1);
  });
});

describe('走向傳送門撞牆', () => {
  it('時間停住、走向入口光時畫面靜止 → 轉 90° 繞路；入口開著時不按 Enter', () => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    const sent: string[] = [];
    const target = new EventTarget();
    target.addEventListener('keydown', (e) => sent.push((e as KeyboardEvent).code));
    const keyboard = createKeyboard(target, { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    let moving = true;
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true },
      {
        keyboard,
        now: () => t,
        detectScreen: () => null,
        pointer: { tap: async () => {} },
        clockGlyph: () => {
          if (!frozenClock) digit++;
          return glyph();
        },
        approachSwirl: () => ['up'],
        stillFrame: () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(moving ? (Math.floor(t / 1000) % 2 ? 0 : 200) : 50) }),
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(5000);
    frozenClock = true;
    run(6000); // 入口開著、一路往上走
    expect(bot.state.activity).toBe('enter');
    expect(bot.state.dirs).toEqual(['up']);
    moving = false; // 撞牆
    run(4000);
    expect(bot.state.dirs).not.toEqual(['up']);
    expect(['left', 'right']).toContain(bot.state.dirs[0]);
    run(8000);
    expect(sent).not.toContain('Enter');
  });
});

describe('MVP 入口在畫面外', () => {
  it('時間停住、畫面上沒有入口光 → 追邊緣的大圓盤指示器（傳送門）', () => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true },
      {
        keyboard,
        now: () => t,
        clockGlyph: () => {
          if (!frozenClock) digit++;
          return glyph();
        },
        approachSwirl: () => null,
        findIndicators: () => [{ kind: 'target', x: 0, y: 0.35, icon: [200, 200, 200], size: 0.06 }],
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(5000);
    frozenClock = true;
    run(6000);
    expect(bot.state.frozen).toBe(true);
    expect(bot.state.activity).toBe('enter');
    expect(bot.state.dirs).toEqual(['down']);
  });
});
