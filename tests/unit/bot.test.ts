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
      // 斜向正規化（遊戲裡斜走不會比較快）
      const hx = (held.includes('right') ? 1 : 0) - (held.includes('left') ? 1 : 0);
      const hy = (held.includes('up') ? 1 : 0) - (held.includes('down') ? 1 : 0);
      const hn = Math.hypot(hx, hy) || 1;
      p = { x: p.x + (hx / hn) * 0.3, y: p.y - (hy / hn) * 0.3 };
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
        readHp: () => ({ fill: 20, low: false }),
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

describe('追目標撞牆', () => {
  it('按著方向鍵、小地圖位置 2 秒沒動 → 轉 90° 繞路；有在動就照直走', () => {
    let t = 0;
    let p = { x: 50, y: 50 };
    let wall = false;
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true },
      {
        keyboard,
        now: () => t,
        readMinimap: () => ({ player: { ...p }, boss: null }),
        findIndicators: () => [{ kind: 'target', x: 0, y: 0.35, icon: [255, 218, 112], size: 0.05 }],
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) {
        t += 250;
        bot.tick();
        if (!wall && bot.state.dirs.includes('down')) p = { x: p.x, y: p.y + 1 };
      }
    };
    run(4000);
    expect(bot.state.activity).toBe('target');
    expect(bot.state.dirs).toEqual(['down']);
    wall = true;
    run(3000);
    expect(['left', 'right']).toContain(bot.state.dirs[0]);
  });
});

describe('辨識不到的視窗（畫面還在動）', () => {
  const setup = () => {
    let t = 0;
    let digit = 0;
    let clockRuns = true;
    let moves = true;
    let p = { x: 50, y: 50 };
    const sent: string[] = [];
    const target = new EventTarget();
    target.addEventListener('keydown', (e) => sent.push((e as KeyboardEvent).code));
    const keyboard = createKeyboard(target, { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'circle' },
      {
        keyboard,
        now: () => t,
        detectScreen: () => null,
        pointer: { tap: async () => {} },
        readHp: () => ({ fill: 20, low: false }),
        clockGlyph: () => {
          if (clockRuns) digit++;
          return glyph();
        },
        readMinimap: () => ({ player: { ...p }, boss: null }),
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) {
        t += 250;
        bot.tick();
        if (moves) p = { x: p.x + 1, y: p.y };
      }
    };
    return { sent, run, set: (c: boolean, m: boolean) => ((clockRuns = c), (moves = m)) };
  };

  it('時鐘與角色同時停下（視窗暫停）→ 按 Enter', () => {
    const { sent, run, set } = setup();
    run(5000);
    set(false, false);
    run(8000);
    expect(sent).toContain('Enter');
  });

  it('入口開著：時鐘早就停了、之後才撞牆停下 → 不按 Enter', () => {
    const { sent, run, set } = setup();
    run(5000);
    set(false, true); // 入口開著，角色還在走
    run(10000);
    set(false, false); // 撞牆
    run(8000);
    expect(sent).not.toContain('Enter');
  });
});

describe('MVP 勝利後出口在畫面外', () => {
  it('追大圓盤指示器（出口），時間停著就不因 30 秒時限放棄', () => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    let bar = 0;
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
        bossBar: () => bar,
        approachExit: () => null,
        approachSwirl: () => ['right'], // 紅色因果路線傳送門的光：不可以走過去
        findIndicators: () => [{ kind: 'other', x: -0.35, y: 0, icon: [120, 120, 200], size: 0.06 }],
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(5000);
    frozenClock = true;
    run(5000);
    bar = 0.003;
    for (let i = 0; i < 10; i++) (bar -= 0.0001), run(500);
    bar = 0;
    run(3000);
    expect(bot.state.activity).toBe('enter');
    expect(bot.state.dirs).toEqual(['left']);
    run(40000);
    expect(bot.state.activity).toBe('enter');
    expect(bot.state.dirs).toEqual(['left']);
  });
});

describe('結算頁蓋住 HUD 時不按 Enter', () => {
  it('時鐘與角色同時停下，但 HP 條讀不到（結算頁）→ 不按 Enter（預設焦點是選擇目的地）', () => {
    let t = 0;
    let digit = 0;
    let stopped = false;
    let p = { x: 50, y: 50 };
    const sent: string[] = [];
    const target = new EventTarget();
    target.addEventListener('keydown', (e) => sent.push((e as KeyboardEvent).code));
    const keyboard = createKeyboard(target, { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'circle' },
      {
        keyboard,
        now: () => t,
        detectScreen: () => null,
        pointer: { tap: async () => {} },
        readHp: () => (stopped ? null : { fill: 20, low: false }),
        clockGlyph: () => {
          if (!stopped) digit++;
          return glyph();
        },
        readMinimap: () => ({ player: { ...p }, boss: null }),
      },
    );
    for (; t < 5000; t += 250) bot.tick(), (p = { x: p.x + 1, y: p.y });
    stopped = true;
    for (; t < 15000; t += 250) bot.tick();
    expect(sent).not.toContain('Enter');
  });
});

describe('祭壇', () => {
  const run = (altarsOn: Record<string, boolean>) => {
    let t = 0;
    let p = { x: 100, y: 100 };
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const altar = { id: 'yggdrasil' as const, x: 60, y: 100, d: 32 };
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'flower', altars: altarsOn },
      { keyboard, now: () => t, readMinimap: () => ({ player: { ...p }, boss: null, altars: [altar] }) },
    );
    const acts: string[] = [];
    for (; t < 20000; t += 100) {
      bot.tick();
      const held = bot.state.dirs;
      // 斜向正規化（遊戲裡斜走不會比較快）
      const hx = (held.includes('right') ? 1 : 0) - (held.includes('left') ? 1 : 0);
      const hy = (held.includes('up') ? 1 : 0) - (held.includes('down') ? 1 : 0);
      const hn = Math.hypot(hx, hy) || 1;
      p = { x: p.x + (hx / hn) * 0.3, y: p.y - (hy / hn) * 0.3 };
      acts.push(bot.state.activity);
    }
    return { p, acts, bot };
  };

  it('勾選的祭壇：校正小地圖方向後走過去並站著', () => {
    const { p, bot } = run({ yggdrasil: true });
    expect(Math.hypot(p.x - 60, p.y - 100)).toBeLessThan(4);
    expect(bot.state.activity).toBe('target');
    expect(bot.state.dirs).toEqual([]);
  });

  it('沒勾選的祭壇不去', () => {
    const { acts } = run({ yggdrasil: false });
    expect(acts.filter((a) => a === 'target')).toEqual([]);
  });
});

describe('入口開著、畫面上找不到入口（暗色地圖）', () => {
  it('依小地圖留在入口剛開時的位置附近（入口生在 4~6.5 單位內）', () => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    let p = { x: 100, y: 100 };
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'flower', circlePeriodMs: 30000 },
      {
        keyboard,
        now: () => t,
        clockGlyph: () => {
          if (!frozenClock) digit++;
          return glyph();
        },
        approachSwirl: () => null,
        readMinimap: () => ({ player: { ...p }, boss: null, altars: [] }),
      },
    );
    let home = { x: 0, y: 0 };
    let maxAway = 0;
    for (; t < 60000; t += 100) {
      if (t === 20000) {
        frozenClock = true;
      }
      bot.tick();
      if (t === 24000) home = { ...p };
      const held = bot.state.dirs;
      // 斜向正規化（遊戲裡斜走不會比較快）
      const hx = (held.includes('right') ? 1 : 0) - (held.includes('left') ? 1 : 0);
      const hy = (held.includes('up') ? 1 : 0) - (held.includes('down') ? 1 : 0);
      const hn = Math.hypot(hx, hy) || 1;
      p = { x: p.x + (hx / hn) * 0.3, y: p.y - (hy / hn) * 0.3 };
      if (t > 30000) maxAway = Math.max(maxAway, Math.hypot(p.x - home.x, p.y - home.y));
    }
    expect(bot.state.frozen).toBe(true);
    expect(maxAway).toBeLessThan(15);
  });
});

describe('巢穴勝利後點掉對話框', () => {
  it('時間還停著：仍只找出口，不追其他亮光（因果路線傳送門）', () => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    let bar = 0;
    let dialog = false;
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
        bossBar: () => bar,
        detectScreen: () => (dialog ? { kind: 'dialog', x: 0.5, y: 0.5 } : null),
        pointer: { tap: async () => void (dialog = false) },
        approachExit: () => null,
        approachSwirl: () => ['right'], // 金色因果路線傳送門的光
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(5000);
    frozenClock = true;
    run(5000);
    bar = 0.003;
    for (let i = 0; i < 10; i++) (bar -= 0.0001), run(500);
    bar = 0;
    dialog = true;
    run(3000);
    run(5000);
    expect(bot.state.frozen).toBe(true);
    expect(bot.state.dirs).not.toEqual(['right']);
    expect(bot.state.dirs).toEqual([]); // 看不到出口：原地等，不去追其他亮光
  });
});

describe('時鐘還在走時看到的「視窗」是誤判', () => {
  it('時鐘在走 → 不停下不點；時鐘停下（真的視窗）→ 照常點', () => {
    let t = 0;
    let digit = 0;
    let clockRuns = true;
    let fake = false;
    const taps: number[] = [];
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'circle' },
      {
        keyboard,
        now: () => t,
        clockGlyph: () => {
          if (clockRuns) digit++;
          return glyph();
        },
        detectScreen: () => (fake ? { kind: 'modal', x: 0.5, y: 0.5 } : null),
        pointer: { tap: async (x) => void taps.push(x) },
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(3000); // 時鐘開始走
    fake = true;
    run(8000);
    expect(taps).toEqual([]);
    expect(bot.state.activity).not.toBe('screen');
    clockRuns = false;
    run(6000);
    expect(taps.length).toBeGreaterThan(0);
  });
});

describe('巢穴內（時間停住）', () => {
  it('首領血條 20 秒不下降仍算首領戰（風箏）；低血量時撤退優先', () => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    let fill = 20;
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
        bossBar: () => 0.003, // 血條不動
        readHp: () => ({ fill, low: false }),
        approachSwirl: () => ['right'],
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(4000);
    frozenClock = true;
    run(25000);
    expect(bot.state.boss).toBe(true);
    expect(bot.state.activity).toBe('kite');
    fill = 4;
    run(2000);
    expect(bot.state.activity).toBe('retreat');
  });
});

describe('勝利後出口光時有時無', () => {
  it('看不到出口時不切回一般走位亂走：先沿原方向、再原地等', () => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    let bar = 0;
    let exitSeen = true;
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
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
        approachExit: () => (exitSeen ? ['left', 'down'] : null),
        approachSwirl: () => ['right'],
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(4000);
    frozenClock = true;
    run(4000);
    bar = 0.003;
    for (let i = 0; i < 10; i++) (bar -= 0.0001), run(500);
    bar = 0;
    run(2000);
    expect(bot.state.dirs).toEqual(['left', 'down']);
    exitSeen = false;
    run(1500);
    expect(bot.state.activity).toBe('enter');
    expect(bot.state.dirs).toEqual(['left', 'down']); // 沿原方向
    run(4000);
    expect(bot.state.activity).toBe('enter');
    expect(bot.state.dirs).toEqual([]); // 原地等，不亂走
  });
});

describe('破關結算頁帶回 3 件', () => {
  const setup = (won: boolean) => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    let bar = 0;
    let result = false;
    const taps: number[] = [];
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const keep = [0.21, 0.25, 0.29, 0.33].map((x) => ({ x, y: 0.8 }));
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true },
      {
        keyboard,
        now: () => t,
        clockGlyph: () => {
          if (!frozenClock) digit++;
          return glyph();
        },
        bossBar: () => bar,
        approachExit: () => null,
        detectScreen: () => (result ? { kind: 'result', x: 0.47, y: 0.94, keep } : null),
        pointer: { tap: async (x) => void taps.push(x) },
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(4000);
    frozenClock = true;
    run(4000);
    if (won) {
      bar = 0.003;
      for (let i = 0; i < 10; i++) (bar -= 0.0001), run(500);
      bar = 0;
      run(8000);
    }
    result = true;
    run(15000);
    return taps;
  };
  it('打倒過 MVP → 先點前 3 格，再點再玩一次', () => {
    expect(setup(true).slice(0, 4)).toEqual([0.21, 0.25, 0.29, 0.47]);
  });
  it('沒打倒 MVP（帶回要付 zeny）→ 直接點再玩一次', () => {
    expect(setup(false)[0]).toBe(0.47);
  });
});

describe('破關帶回：最高分頁不足 3 件', () => {
  it('傳說頁只有 1 件 → 點完切到紫色頁再點 2 件，最後才再玩一次', () => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    let bar = 0;
    let result = false;
    let page: 'legend' | 'purple' = 'legend';
    const taps: string[] = [];
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const tabs = () => [
      { x: 0.45, y: 0.69, pressed: page === 'legend' },
      { x: 0.5, y: 0.69, pressed: page === 'purple' },
      { x: 0.55, y: 0.69, pressed: false },
    ];
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true },
      {
        keyboard,
        now: () => t,
        clockGlyph: () => {
          if (!frozenClock) digit++;
          return glyph();
        },
        bossBar: () => bar,
        approachExit: () => null,
        detectScreen: () =>
          result
            ? {
                kind: 'result',
                x: 0.47,
                y: 0.94,
                keep: page === 'legend' ? [{ x: 0.2, y: 0.8 }] : [0.3, 0.34, 0.38, 0.42].map((x) => ({ x, y: 0.8 })),
                keepTabs: tabs(),
              }
            : null,
        pointer: {
          tap: async (x, y) => {
            if (y < 0.7 && Math.abs(x - 0.5) < 0.01) page = 'purple';
            taps.push(`${x}`);
          },
        },
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(4000);
    frozenClock = true;
    run(4000);
    bar = 0.003;
    for (let i = 0; i < 10; i++) (bar -= 0.0001), run(500);
    bar = 0;
    run(8000);
    result = true;
    run(20000);
    expect(taps.slice(0, 5)).toEqual(['0.2', '0.5', '0.3', '0.34', '0.47']);
  });
});

describe('一般走位撞牆', () => {
  it('按著方向鍵小地圖位置 2 秒沒動 → 轉 90° 繞路', () => {
    let t = 0;
    let p = { x: 50, y: 50 };
    let wall = false;
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true, mode: 'circle', circlePeriodMs: 600000 },
      { keyboard, now: () => t, readMinimap: () => ({ player: { ...p }, boss: null, altars: [] }) },
    );
    const seen: string[] = [];
    for (; t < 12000; t += 100) {
      if (t === 3000) wall = true;
      bot.tick();
      const held = bot.state.dirs;
      if (!wall) p = { x: p.x + (held.includes('right') ? 0.3 : 0), y: p.y - (held.includes('up') ? 0.3 : 0) };
      if (t > 6000) seen.push(held.join('+'));
    }
    expect(bot.state.activity).toBe('patrol');
    // 週期 600 秒的大圈在這段時間都往正右；撞牆後應出現轉 90° 的方向
    expect(seen.some((d) => d.includes('up') || d.includes('down'))).toBe(true);
  });
});

describe('一般首領戰中被視窗短暫暫停', () => {
  it('時鐘只停一下 → 不當成巢穴，首領打完不會去找出口', () => {
    let t = 0;
    let digit = 0;
    let clockRuns = true;
    let bar = 0.003;
    const keyboard = createKeyboard(new EventTarget(), { sleep: async () => {} });
    const glyph = () => Uint8Array.from({ length: 300 }, (_, i) => ((i * 7 + digit * 13) % 5 === 0 ? 1 : 0));
    const bot = createBot(
      { ...DEFAULT_SETTINGS.bot, enabled: true },
      {
        keyboard,
        now: () => t,
        clockGlyph: () => {
          if (clockRuns) digit++;
          return glyph();
        },
        bossBar: () => bar,
        approachExit: () => ['up'],
        detectScreen: () => (clockRuns ? null : { kind: 'modal', x: 0.5, y: 0.7 }),
        pointer: { tap: async () => {} },
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) {
        t += 250;
        bar = Math.max(0, bar - 0.00002);
        bot.tick();
      }
    };
    run(5000);
    clockRuns = false; // 視窗暫停（畫面上有視窗）
    run(4000);
    clockRuns = true;
    run(3000);
    bar = 0; // 首領被打倒
    run(4000);
    expect(bot.state.activity).not.toBe('enter');
  });
});

describe('巢穴：時鐘剛停住首領就出現（載入後立刻開打）', () => {
  it('沒有視窗 → 仍判定為巢穴戰，打完找出口', () => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    let bar = 0;
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
        bossBar: () => bar,
        approachExit: () => ['up'],
      },
    );
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) (t += 250), bot.tick();
    };
    run(4000);
    frozenClock = true;
    run(3500); // 停住剛被判定
    bar = 0.003;
    for (let i = 0; i < 10; i++) (bar -= 0.0001), run(500);
    bar = 0;
    run(2000);
    expect(bot.state.activity).toBe('enter');
    expect(bot.state.dirs).toEqual(['up']);
  });
});

describe('入口開著但畫面上認不出入口（淡色、被擋住）', () => {
  it('回到入口剛開的位置後繞圈找，八個方向都會走到', () => {
    let t = 0;
    let digit = 0;
    let frozenClock = false;
    let p = { x: 100, y: 100 };
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
        readMinimap: () => ({ player: { ...p }, boss: null }),
      },
    );
    // 角色依按住的方向移動（斜向正規化，與遊戲一致）
    const run = (ms: number) => {
      for (let e = 0; e < ms; e += 250) {
        t += 250;
        bot.tick();
        const d = bot.state.dirs;
        const dx = (d.includes('right') ? 1 : 0) - (d.includes('left') ? 1 : 0);
        const dy = (d.includes('down') ? 1 : 0) - (d.includes('up') ? 1 : 0);
        const n = Math.hypot(dx, dy) || 1;
        p = { x: p.x + (dx / n) * 1.5, y: p.y + (dy / n) * 1.5 };
      }
    };
    run(4000);
    frozenClock = true; // 入口開了
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      run(250);
      if (bot.state.activity === 'enter') seen.add(bot.state.dirs.join('+'));
    }
    expect(bot.state.enterSrc).toBe('circle');
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
