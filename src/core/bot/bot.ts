import type { Keyboard } from '../input/keyboard';
import type { Logger } from '../log';
import type { Dir } from '../movement/directions';
import { createStrategy, type Strategy } from '../movement/strategies';
import type { BotConfig } from '../settings';
import type { Pointer } from '../input/pointer';
import { createPortalSeeker, type PortalScan } from '../vision/portal';
import { createScreenHandler, type ScreenAction } from '../vision/screens';
import { createIndicatorSeeker, type Indicator } from '../vision/indicators';
import { dodge, type DangerProbes } from '../vision/danger';

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export interface BotState {
  running: boolean;
  /** patrol：一般走位；portal：正在走向返回地圖傳送門 */
  activity: 'patrol' | 'portal' | 'target' | 'dodge' | 'screen';
  dodges: number;
  /** 最近一次處理的畫面 */
  lastScreen: string;
  screenTaps: number;
  dirs: Dir[];
  scans: number;
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
  /** 掃描畫面上的傳送門；沒提供或回傳 null 時不做傳送門導航 */
  scanPortals?: () => PortalScan | null;
  /** 辨識需要點擊的畫面（結算、確認框、初始技能）；沒提供時不處理 */
  detectScreen?: () => ScreenAction | null;
  /** 找畫面外指示器（寶箱、任務、金波利、催眠師）；沒提供時不前往 */
  findIndicators?: () => Indicator[] | null;
  /** 探測角色周圍的紅色預警框；沒提供時不躲 */
  probeDanger?: () => DangerProbes | null;
  pointer?: Pointer;
  log?: Logger;
}

const SCAN_INTERVAL_MS = 250;
const SCREEN_INTERVAL_MS = 500;
const INDICATOR_INTERVAL_MS = 400;
const DANGER_INTERVAL_MS = 150;

/**
 * 掛機主迴圈：
 * 1. 依走位策略持續按住方向鍵（只送差異，不重複 keydown）
 * 2. 週期送「1」處理升級選卡
 * 3. （選用）週期送 Enter 處理寶箱/結算
 * 技能由遊戲自動施放，不需處理。
 */
export function createBot(
  cfg: BotConfig,
  { keyboard, now, scanPortals, detectScreen, findIndicators, probeDanger, pointer, log }: BotDeps,
): Bot {
  let config = cfg;
  let strategy: Strategy = createStrategy(cfg.mode, cfg);
  let startedAt = now();
  let lastPick = -Infinity;
  let lastEnter = -Infinity;
  let lastScan = -Infinity;
  let portalDirs: Dir[] | null = null;
  const seeker = createPortalSeeker();
  const screens = createScreenHandler();
  const targetSeeker = createIndicatorSeeker();
  let lastIndicatorScan = -Infinity;
  let targetDirs: Dir[] | null = null;
  let lastDangerProbe = -Infinity;
  let probes: DangerProbes | null = null;
  let dodging = false;
  let lastScreenCheck = -Infinity;
  let onScreen = false;
  /** 連續幾次畫面檢查都沒有視窗（Enter 只在畫面穩定時送，避免在腐化寶箱選到預設焦點 Hel） */
  let clearChecks = 0;
  let checkedThisTick = false;
  const state: BotState = {
    running: false,
    activity: 'patrol',
    lastScreen: '-',
    dodges: 0,
    screenTaps: 0,
    dirs: [],
    scans: 0,
    ticks: 0,
    picks: 0,
    enters: 0,
  };

  return {
    state,
    update(next) {
      if (next.mode !== config.mode || next.circlePeriodMs !== config.circlePeriodMs) {
        strategy = createStrategy(next.mode, next);
      }
      if (next.enabled && !config.enabled) startedAt = now();
      if (!next.portalSeek) portalDirs = null;
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

      checkedThisTick = false;
      if (config.autoContinue && detectScreen && pointer && t - lastScreenCheck >= SCREEN_INTERVAL_MS) {
        lastScreenCheck = t;
        checkedThisTick = true;
        const seen = detectScreen();
        onScreen = seen !== null;
        clearChecks = onScreen ? 0 : clearChecks + 1;
        const act = screens.update(seen, t);
        if (act) {
          state.screenTaps++;
          state.lastScreen = act.kind;
          log?.info('screen: 點擊', act);
          void pointer.tap(act.x, act.y);
        }
      }
      if (onScreen) {
        // 停在視窗上：放開方向鍵，等畫面切換
        for (const d of DIRS) keyboard.up(d);
        state.dirs = [];
        state.activity = 'screen';
        return;
      }

      if (config.portalSeek && scanPortals && t - lastScan >= SCAN_INTERVAL_MS) {
        lastScan = t;
        const scan = scanPortals();
        if (scan) {
          state.scans++;
          const next = seeker.update(scan);
          if (next && !portalDirs) log?.info('portal: 看到返回地圖傳送門，開始導航', scan);
          portalDirs = next;
        }
      }
      if (!portalDirs && config.seekTargets && findIndicators && t - lastIndicatorScan >= INDICATOR_INTERVAL_MS) {
        lastIndicatorScan = t;
        const next = targetSeeker.update(findIndicators(), t);
        if (next && !targetDirs) log?.info('target: 前往指示器目標');
        targetDirs = next;
      }
      if (portalDirs || !config.seekTargets) targetDirs = null;
      state.activity = portalDirs ? 'portal' : targetDirs ? 'target' : 'patrol';
      let want = portalDirs ?? targetDirs ?? strategy(t - startedAt);
      if (config.dodge && probeDanger) {
        if (t - lastDangerProbe >= DANGER_INTERVAL_MS) {
          lastDangerProbe = t;
          probes = probeDanger();
        }
        const safer = probes ? dodge(probes, want) : null;
        if (safer && !dodging) state.dodges++;
        dodging = safer !== null;
        if (safer) {
          state.activity = 'dodge';
          want = safer;
        }
      } else {
        probes = null;
      }
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
      const screenSafe = !(config.autoContinue && detectScreen && pointer) || (checkedThisTick && clearChecks >= 2);
      if (config.enterEnabled && screenSafe && t - lastEnter >= config.enterIntervalMs) {
        lastEnter = t;
        state.enters++;
        void keyboard.tap('enter');
      }
    },
  };
}
