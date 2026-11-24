import type { Keyboard } from '../input/keyboard';
import type { Pointer } from '../input/pointer';
import type { Logger } from '../log';
import type { Dir } from '../movement/directions';
import { circle, createStrategy, type Strategy } from '../movement/strategies';
import type { BotConfig } from '../settings';
import type { DangerProbes } from '../vision/danger';
import { createHpTracker, type HpReading } from '../vision/hud';
import { createIndicatorSeeker, type Indicator } from '../vision/indicators';
import { createPortalSeeker, type PortalScan } from '../vision/portal';
import { createScreenHandler, type ScreenAction } from '../vision/screens';
import { decide, type Activity } from './decide';
import { throttle } from './throttle';

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export interface BotState {
  running: boolean;
  activity: Activity | 'screen';
  boss: boolean;
  /** 最近讀到的 HP 比例（-1 表示讀不到） */
  hp: number;
  dodges: number;
  /** 最近一次處理的畫面 */
  lastScreen: string;
  screenTaps: number;
  dirs: Dir[];
  scans: number;
  ticks: number;
  picks: number;
}

export interface Bot {
  update(cfg: BotConfig): void;
  /** 由外部時脈定期呼叫（Worker ticker） */
  tick(): void;
  readonly state: Readonly<BotState>;
}

/** 感知來源（皆可省略：省略即不啟用該行為），由 entrypoint 以畫面取樣實作 */
export interface BotDeps {
  keyboard: Keyboard;
  now: () => number;
  scanPortals?: () => PortalScan | null;
  detectScreen?: () => ScreenAction | null;
  findIndicators?: () => Indicator[] | null;
  probeDanger?: () => DangerProbes | null;
  fleeSwirl?: () => Dir[] | null;
  readHp?: () => HpReading | null;
  bossFight?: () => boolean;
  pointer?: Pointer;
  log?: Logger;
}

/** 各感知的取樣間隔 */
const INTERVAL = { screen: 500, portal: 250, indicator: 400, danger: 150, hp: 500, swirl: 250 };
/** 低血量撤退、首領戰風箏的大圈倍數（相對一般走位週期） */
const RETREAT_FACTOR = 2.5;
const KITE_FACTOR = 2;

/**
 * 掛機主迴圈：感知（節流取樣）→ 視窗處理 → 移動決策（decide.ts，純函式）→ 按鍵。
 * 技能由遊戲自動施放；升級卡另以週期送「1」當備援。
 * （自動 Enter 已移除：腐化寶箱預設焦點是 Hel、城鎮按 Enter 會開世界聊天）
 */
export function createBot(cfg: BotConfig, deps: BotDeps): Bot {
  const { keyboard, now, pointer, log } = deps;
  let config = cfg;
  const patterns = (c: BotConfig) => ({
    patrol: createStrategy(c.mode, c),
    retreat: circle(c.circlePeriodMs * RETREAT_FACTOR),
    kite: circle(c.circlePeriodMs * KITE_FACTOR),
  });
  let moves: Record<'patrol' | 'retreat' | 'kite', Strategy> = patterns(cfg);
  let startedAt = now();
  let lastPick = -Infinity;
  let dodging = false;
  let lowHp = false;
  let boss = false;

  const portalSeeker = createPortalSeeker();
  const targetSeeker = createIndicatorSeeker();
  const screens = createScreenHandler();
  const hpTracker = createHpTracker();

  const state: BotState = {
    running: false,
    activity: 'patrol',
    lastScreen: '-',
    dodges: 0,
    hp: -1,
    boss: false,
    screenTaps: 0,
    dirs: [],
    scans: 0,
    ticks: 0,
    picks: 0,
  };

  // ---- 感知（節流）----
  const sense = {
    screen: throttle(INTERVAL.screen, () => (config.autoContinue && pointer ? deps.detectScreen?.() ?? null : null), null as ScreenAction | null),
    portal: throttle(
      INTERVAL.portal,
      () => {
        if (!config.portalSeek || !deps.scanPortals) return null;
        const scan = deps.scanPortals();
        if (!scan) return null;
        state.scans++;
        return portalSeeker.update(scan);
      },
      null as Dir[] | null,
    ),
    vitals: throttle(
      INTERVAL.hp,
      () => {
        const hp = deps.readHp ? hpTracker.update(deps.readHp()) : null;
        state.hp = hp ? Math.round(hp.ratio * 100) / 100 : -1;
        const nowLow = hp !== null && (hp.low || hp.ratio < config.lowHpRatio);
        if (nowLow && !lowHp) log?.info('hp: 低血量，停止追目標、改大圈移動', hp);
        const nowBoss = config.bossKite && deps.bossFight ? deps.bossFight() : false;
        if (nowBoss && !boss) log?.info('boss: 首領戰，改大圈風箏');
        lowHp = nowLow;
        boss = nowBoss;
        state.boss = boss;
        return { lowHp, boss };
      },
      { lowHp: false, boss: false },
    ),
    target: throttle(
      INTERVAL.indicator,
      () => (config.seekTargets && deps.findIndicators ? targetSeeker.update(deps.findIndicators(), now()) : null),
      null as Dir[] | null,
    ),
    swirl: throttle(INTERVAL.swirl, () => (config.seekTargets ? deps.fleeSwirl?.() ?? null : null), null as Dir[] | null),
    danger: throttle(INTERVAL.danger, () => (config.dodge ? deps.probeDanger?.() ?? null : null), null as DangerProbes | null),
  };

  return {
    state,
    update(next) {
      if (next.mode !== config.mode || next.circlePeriodMs !== config.circlePeriodMs) moves = patterns(next);
      if (next.enabled && !config.enabled) startedAt = now();
      if (!next.enabled && config.enabled) {
        keyboard.releaseAll();
        state.dirs = [];
      }
      config = next;
      // 設定變更後重新取樣（例如關掉某功能要立即生效）
      Object.values(sense).forEach((s) => s.reset());
      log?.debug('config', next);
    },
    tick() {
      state.running = config.enabled;
      if (!config.enabled) return;
      state.ticks++;
      const t = now();

      // 視窗：辨識到就點擊並停止移動，等畫面切換
      const seen = sense.screen.get(t);
      // 只有新的取樣才交給處理器（它要求「連續 2 次獨立取樣」成立才點，避免同一份快取被重複計數）
      const act = sense.screen.fresh ? screens.update(seen, t) : null;
      if (act && pointer) {
        state.screenTaps++;
        state.lastScreen = act.kind;
        log?.info('screen: 點擊', act);
        void pointer.tap(act.x, act.y);
      }
      if (seen) {
        for (const d of DIRS) keyboard.up(d);
        state.dirs = [];
        state.activity = 'screen';
        return;
      }

      const vitals = sense.vitals.get(t);
      const portal = sense.portal.get(t);
      const target = portal || vitals.lowHp || vitals.boss ? null : sense.target.get(t);
      const elapsed = t - startedAt;
      const { activity, want } = decide(
        { portal, target, flee: sense.swirl.get(t), danger: sense.danger.get(t), ...vitals },
        { patrol: moves.patrol(elapsed), retreat: moves.retreat(elapsed), kite: moves.kite(elapsed) },
      );
      if (activity === 'dodge' && !dodging) state.dodges++;
      dodging = activity === 'dodge';
      if (activity === 'target' && state.activity !== 'target') log?.info('target: 前往指示器目標');
      state.activity = activity;

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
    },
  };
}
