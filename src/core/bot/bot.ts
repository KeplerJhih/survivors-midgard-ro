import type { Keyboard } from '../input/keyboard';
import type { Pointer } from '../input/pointer';
import type { Logger } from '../log';
import type { Dir } from '../movement/directions';
import { circle, createStrategy, type Strategy } from '../movement/strategies';
import type { BotConfig } from '../settings';
import type { DangerProbes } from '../vision/danger';
import { createBossTracker, createHpTracker, type HpReading } from '../vision/hud';
import { createIndicatorSeeker, resolvePurple, type Indicator } from '../vision/indicators';
import { createPortalSeeker, type PortalScan } from '../vision/portal';
import { createScreenHandler, type ScreenAction } from '../vision/screens';
import { createObjectSeeker, type ObjectHit } from '../vision/objects';
import { createFreezeDetector } from '../vision/clock';
import { createMinimapNavigator, type MinimapRead } from '../vision/minimap';
import { decide, type Activity } from './decide';
import type { GameSync } from './game-sync';
import { throttle } from './throttle';

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export interface BotState {
  running: boolean;
  activity: Activity | 'screen' | 'sync';
  boss: boolean;
  /** 遊戲時間停住（MVP 入口開著等） */
  frozen: boolean;
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
  /** 小地圖（玩家箭頭、首領點） */
  readMinimap?: () => MinimapRead | null;
  /** 首領血條剩餘量（0＝沒有首領戰） */
  bossBar?: () => number;
  findObjects?: () => ObjectHit[] | null;
  /** 右上時鐘字形（小地圖下方；判斷遊戲時間是否停住） */
  clockGlyph?: () => Uint8Array | null;
  /** 走向粉紫光圈的方向 */
  approachSwirl?: () => Dir[] | null;
  /** MVP 勝利後走向淡藍出口 */
  approachExit?: () => Dir[] | null;
  /** 遊戲內設定同步（暫停選單勾選框）；需要時 bot 會暫停其他行為 */
  gameSync?: GameSync;
  pointer?: Pointer;
  log?: Logger;
}

/** 各感知的取樣間隔 */
/** MVP 勝利後找出口的時限 */
const EXIT_WINDOW = 30000;
/** 撤退解除前 HP 須連續回到門檻以上的時間 */
const HP_RECOVER_MS = 3000;
const INTERVAL = { minimap: 400, screen: 500, portal: 250, indicator: 400, danger: 150, hp: 500, swirl: 250, object: 600, clock: 1000 };
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
  let screenStreak = 0;
  let mvpFight = false;
  let hpSeenAt = -Infinity;
  let recoverSince: number | null = null;
  let lastBossAt = -Infinity;

  const portalSeeker = createPortalSeeker();
  const targetSeeker = createIndicatorSeeker();
  const objectSeeker = createObjectSeeker();
  const clock = createFreezeDetector();
  const screens = createScreenHandler();
  const hpTracker = createHpTracker();
  const bossTracker = createBossTracker();
  const navigator = createMinimapNavigator();
  let bossStalled = false;

  const state: BotState = {
    running: false,
    activity: 'patrol',
    lastScreen: '-',
    dodges: 0,
    hp: -1,
    boss: false,
    frozen: false,
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
        // 遲滯：低於門檻進入撤退，回到門檻 +0.2 才解除（實機：無盡模式後期 HP 0.5 → 0 只要 2~3 秒，
        // 門檻 0.35 進撤退時已來不及）；讀不到時沿用
        if (hp) hpSeenAt = now();
        // 讀不到時沿用，但最多 5 秒（實機：HP 列學錯後一直讀不到，卡在撤退）
        let nowLow =
          hp === null
            ? lowHp && now() - hpSeenAt < 5000
            : hp.low || hp.ratio < (lowHp ? Math.min(0.9, config.lowHpRatio + 0.2) : config.lowHpRatio);
        // 解除撤退要連續 HP_RECOVER_MS 都在門檻以上：實機無盡模式 HP 讀數 0.45 → 0.7 → 0.55 → 0.35 跳動，
        // 一筆 0.7 就解除 → 立刻回去追目標衝進怪群 → 陣亡
        if (lowHp && !nowLow && hp) {
          if (recoverSince === null) recoverSince = now();
          if (now() - recoverSince < HP_RECOVER_MS) nowLow = true;
        } else recoverSince = null;
        if (nowLow && !lowHp) log?.info('hp: 低血量，停止追目標、改大圈移動', hp);
        const b = bossTracker.update(config.bossKite && deps.bossBar ? deps.bossBar() : 0, now());
        // 血條很久沒下降＝沒打到（首領在畫面外）→ 不風箏，照一般走位 / 追指示器去找它
        const nowBoss = b.boss && !b.stalled;
        if (nowBoss && !boss) log?.info('boss: 首領戰，改大圈風箏');
        if (b.stalled && boss) log?.info('boss: 血條沒下降，改一般走位去找首領');
        lowHp = nowLow;
        boss = nowBoss;
        bossStalled = b.stalled;
        state.boss = boss;
        return { lowHp, boss };
      },
      { lowHp: false, boss: false },
    ),
    // 小地圖：持續觀察以校正方向；首領血條久不下降時走向首領點
    bossSeek: throttle(
      INTERVAL.minimap,
      () => {
        const m = deps.readMinimap?.() ?? null;
        if (!m) return null;
        navigator.observe(m.player, state.dirs, now());
        return bossStalled && m.boss ? navigator.steer(m.player, m.boss) : null;
      },
      null as Dir[] | null,
    ),
    target: throttle(
      INTERVAL.indicator,
      () => {
        if (!config.seekTargets || !deps.findIndicators) return null;
        const list = deps.findIndicators();
        return targetSeeker.update(list && resolvePurple(list, state.frozen), now());
      },
      null as Dir[] | null,
    ),
    object: throttle(
      INTERVAL.object,
      () => (config.seekObjects && deps.findObjects ? objectSeeker.update(deps.findObjects(), now()) : null),
      null as Dir[] | null,
    ),
    frozen: throttle(INTERVAL.clock, () => (deps.clockGlyph ? clock.update(deps.clockGlyph(), now()) : false), false),
    approach: throttle(INTERVAL.swirl, () => deps.approachSwirl?.() ?? null, null as Dir[] | null),
    exit: throttle(INTERVAL.swirl, () => deps.approachExit?.() ?? null, null as Dir[] | null),
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
      // 同步遊戲設定中：暫停選單由同步模組操作，畫面辨識不插手（否則會被保險規則點「繼續」關掉）
      const seen = deps.gameSync?.busy ? null : sense.screen.get(t);
      // 只有新的取樣才交給處理器（它要求「連續 2 次獨立取樣」成立才點，避免同一份快取被重複計數）
      const act = sense.screen.fresh && !deps.gameSync?.busy ? screens.update(seen, t) : null;
      if (act && pointer) {
        state.screenTaps++;
        // 點過勝利選擇 / 結算 / 初始技能＝已離開巢穴，不再找出口（寶箱等 modal 不算：勝利後巢穴內也會跳）
        if (act.kind === 'dialog' || act.kind === 'result' || act.kind === 'start-skill') mvpFight = false;
        state.lastScreen = act.kind;
        log?.info('screen: 點擊', act);
        void pointer.tap(act.x, act.y);
        // 初始技能選完＝新的一局開始；「隨機選擇」每局會被遊戲重設 → 重新同步
        if (act.kind === 'start-skill') deps.gameSync?.request();
      }
      if (sense.screen.fresh) screenStreak = seen ? screenStreak + 1 : 0;
      // 連續 2 次取樣都看到視窗才停止移動（單張誤判不該讓角色在戰鬥中停下；真的視窗遊戲本來就暫停）
      if (seen && screenStreak >= 2) {
        for (const d of DIRS) keyboard.up(d);
        state.dirs = [];
        state.activity = 'screen';
        return;
      }

      // 遊戲設定同步：只在對局中（時鐘已定位）且沒有視窗時開始
      const syncing = deps.gameSync?.tick(t, !seen && clock.ticking) ?? false;
      if (syncing) {
        for (const d of DIRS) keyboard.up(d);
        state.dirs = [];
        state.activity = 'sync';
        return;
      }

      const vitals = sense.vitals.get(t);
      const portal = sense.portal.get(t);
      const frozen = sense.frozen.get(t);
      state.frozen = frozen;
      // 時間停住期間打過首領＝在 MVP 巢穴裡（入口開著時一般怪物會被清掉，不會有首領）→ 勝利後找淡藍出口。
      // 實機：無盡模式勝利後巢穴內時鐘恢復走動 → 不能靠「停住」判斷，改成首領消失後 30 秒內都找出口
      if (vitals.boss) {
        lastBossAt = t;
        if (frozen) mvpFight = true;
      } else if (t - lastBossAt > EXIT_WINDOW) mvpFight = false;
      // 低血量時撤退優先（實機：勝利選擇後回到地圖仍在找出口，HP 9% 照樣亂走）
      const exitSeek = mvpFight && !vitals.boss && !vitals.lowHp;
      const busy = portal || vitals.lowHp || vitals.boss || frozen || exitSeek;
      const bossSeek = sense.bossSeek.get(t);
      if (bossSeek && state.activity !== 'target') log?.info('boss: 依小地圖走向首領');
      const target = busy ? null : bossSeek ?? sense.target.get(t);
      const object = busy || target ? null : sense.object.get(t);
      const elapsed = t - startedAt;
      const { activity, want } = decide(
        {
          portal,
          target,
          object,
          frozen: frozen || exitSeek,
          approach: exitSeek ? sense.exit.get(t) : frozen && !vitals.boss ? sense.approach.get(t) : null,
          flee: frozen || exitSeek ? null : sense.swirl.get(t),
          danger: sense.danger.get(t),
          ...vitals,
        },
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
