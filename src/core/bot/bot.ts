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
import { createHpTracker, type HpReading } from '../vision/hud';
import { circle } from '../movement/strategies';

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export interface BotState {
  running: boolean;
  /** patrol：一般走位；portal：正在走向返回地圖傳送門 */
  activity: 'patrol' | 'portal' | 'target' | 'dodge' | 'retreat' | 'flee' | 'screen';
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
  /** 催眠師螺旋太近時回傳遠離方向 */
  fleeSwirl?: () => Dir[] | null;
  /** 讀 HP 條；沒提供時不做低血量行為 */
  readHp?: () => HpReading | null;
  pointer?: Pointer;
  log?: Logger;
}

const SCAN_INTERVAL_MS = 250;
const SCREEN_INTERVAL_MS = 500;
const INDICATOR_INTERVAL_MS = 400;
const DANGER_INTERVAL_MS = 150;
const HP_INTERVAL_MS = 500;
/** 低血量時的走位：大圈持續移動（週期為一般走位的 2.5 倍） */
const RETREAT_PERIOD_FACTOR = 2.5;

/**
 * 掛機主迴圈：
 * 1. 依走位策略持續按住方向鍵（只送差異，不重複 keydown）
 * 2. 週期送「1」處理升級選卡
 * 3. 畫面辨識處理視窗（結算、腐化寶箱、確認框…）、傳送門、指示器目標、紅框躲避
 * （自動 Enter 已移除：腐化寶箱預設焦點是 Hel、城鎮按 Enter 會開世界聊天，且用途已被畫面辨識取代）
 * 技能由遊戲自動施放，不需處理。
 */
export function createBot(
  cfg: BotConfig,
  { keyboard, now, scanPortals, detectScreen, findIndicators, probeDanger, fleeSwirl, readHp, pointer, log }: BotDeps,
): Bot {
  let config = cfg;
  let strategy: Strategy = createStrategy(cfg.mode, cfg);
  let retreat: Strategy = circle(cfg.circlePeriodMs * RETREAT_PERIOD_FACTOR);
  let startedAt = now();
  let lastPick = -Infinity;
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
  let lastHpRead = -Infinity;
  let lowHp = false;
  const hpTracker = createHpTracker();
  let lastScreenCheck = -Infinity;
  let onScreen = false;
  const state: BotState = {
    running: false,
    activity: 'patrol',
    lastScreen: '-',
    dodges: 0,
    hp: -1,
    screenTaps: 0,
    dirs: [],
    scans: 0,
    ticks: 0,
    picks: 0,
  };

  return {
    state,
    update(next) {
      if (next.mode !== config.mode || next.circlePeriodMs !== config.circlePeriodMs) {
        strategy = createStrategy(next.mode, next);
        retreat = circle(next.circlePeriodMs * RETREAT_PERIOD_FACTOR);
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

      if (config.autoContinue && detectScreen && pointer && t - lastScreenCheck >= SCREEN_INTERVAL_MS) {
        lastScreenCheck = t;
        const seen = detectScreen();
        onScreen = seen !== null;
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
      if (readHp && t - lastHpRead >= HP_INTERVAL_MS) {
        lastHpRead = t;
        const hp = hpTracker.update(readHp());
        state.hp = hp ? Math.round(hp.ratio * 100) / 100 : -1;
        const nowLow = hp !== null && (hp.low || hp.ratio < config.lowHpRatio);
        if (nowLow && !lowHp) log?.info('hp: 低血量，停止追目標、改大圈移動', hp);
        lowHp = nowLow;
      }

      if (!lowHp && !portalDirs && config.seekTargets && findIndicators && t - lastIndicatorScan >= INDICATOR_INTERVAL_MS) {
        lastIndicatorScan = t;
        const next = targetSeeker.update(findIndicators(), t);
        if (next && !targetDirs) log?.info('target: 前往指示器目標');
        targetDirs = next;
      }
      if (portalDirs || !config.seekTargets || lowHp) targetDirs = null;
      state.activity = portalDirs ? 'portal' : targetDirs ? 'target' : lowHp ? 'retreat' : 'patrol';
      const patrol = lowHp ? retreat(t - startedAt) : strategy(t - startedAt);
      let want = portalDirs ?? targetDirs ?? patrol;
      if (!portalDirs && fleeSwirl && config.seekTargets) {
        const away = fleeSwirl();
        if (away) {
          state.activity = 'flee';
          want = away;
        }
      }
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
    },
  };
}
