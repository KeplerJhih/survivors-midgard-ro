import type { Keyboard } from '../input/keyboard';
import type { Logger } from '../log';
import type { Dir } from '../movement/directions';
import { createStrategy, type Strategy } from '../movement/strategies';
import type { BotConfig } from '../settings';

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export interface BotState {
  running: boolean;
  dirs: Dir[];
  ticks: number;
  picks: number;
  enters: number;
}

export interface Bot {
  update(cfg: BotConfig): void;
  /** 由外部時脈定期呼叫（Worker ticker） */
  tick(): void;
  readonly state: Readonly<BotState>;
}

export interface BotDeps {
  keyboard: Keyboard;
  now: () => number;
  log?: Logger;
}

/**
 * 掛機主迴圈：
 * 1. 依走位策略持續按住方向鍵（只送差異，不重複 keydown）
 * 2. 週期送「1」處理升級選卡
 * 3. （選用）週期送 Enter 處理寶箱/結算
 * 技能由遊戲自動施放，不需處理。
 */
export function createBot(cfg: BotConfig, { keyboard, now, log }: BotDeps): Bot {
  let config = cfg;
  let strategy: Strategy = createStrategy(cfg.mode, cfg);
  let startedAt = now();
  let lastPick = -Infinity;
  let lastEnter = -Infinity;
  const state: BotState = { running: false, dirs: [], ticks: 0, picks: 0, enters: 0 };

  return {
    state,
    update(next) {
      if (next.mode !== config.mode || next.circlePeriodMs !== config.circlePeriodMs) {
        strategy = createStrategy(next.mode, next);
      }
      if (next.enabled && !config.enabled) startedAt = now();
      if (!next.enabled && config.enabled) {
        keyboard.releaseAll();
        state.dirs = [];
      }
      config = next;
      log?.debug('config', next);
    },
    tick() {
      state.running = config.enabled;
      if (!config.enabled) return;
      state.ticks++;
      const t = now();

      const want = strategy(t - startedAt);
      for (const d of DIRS) {
        if (want.includes(d)) keyboard.down(d);
        else keyboard.up(d);
      }
      state.dirs = want;

      if (t - lastPick >= config.pickIntervalMs) {
        lastPick = t;
        state.picks++;
        void keyboard.tap('pick1');
      }
      if (config.enterEnabled && t - lastEnter >= config.enterIntervalMs) {
        lastEnter = t;
        state.enters++;
        void keyboard.tap('enter');
      }
    },
  };
}
