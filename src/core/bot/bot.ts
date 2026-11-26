import type { Keyboard } from '../input/keyboard';
import type { Pointer } from '../input/pointer';
import type { Logger } from '../log';
import { dirsFromAngle, type Dir } from '../movement/directions';
import { circle, createStrategy, type Strategy } from '../movement/strategies';
import type { BotConfig } from '../settings';
import type { DangerProbes } from '../vision/danger';
import { createBossTracker, createHpTracker, type HpReading } from '../vision/hud';
import { createIndicatorSeeker, LARGE_DISC, resolvePurple, steerToIndicator, type Indicator } from '../vision/indicators';
import { createPortalSeeker, type PortalScan } from '../vision/portal';
import { createScreenHandler, type ScreenAction } from '../vision/screens';
import { createObjectSeeker, type ObjectHit } from '../vision/objects';
import { createFreezeDetector } from '../vision/clock';
import type { Frame } from '../vision/frame';
import { createStillDetector } from '../vision/still';
import { createMinimapNavigator, type MinimapRead } from '../vision/minimap';
import { decide, type Activity } from './decide';
import type { GameSync } from './game-sync';
import { throttle } from './throttle';

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
const TURN: Record<'cw' | 'ccw', Record<Dir, Dir>> = {
  cw: { up: 'right', right: 'down', down: 'left', left: 'up' },
  ccw: { up: 'left', left: 'down', down: 'right', right: 'up' },
};

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
  /** 小地圖上看到的祭壇（除錯用） */
  altars: string[];
  /** 小地圖上看到金波利（除錯用） */
  runner: boolean;
  /** 入口開著時走向的來源（除錯用） */
  enterSrc: string;
  /** 距上次讀到小地圖幾毫秒（除錯用） */
  mmAge: number;
  /** 最近 10 次視窗處理（除錯用：辨識成什麼、點哪裡、怎麼點） */
  acts: { t: number; kind: string; x: number; y: number; keep: number; kx?: string; how: string }[];
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
  /** 「這局打倒過 MVP」跨外掛重新載入保存（頁面不重新整理就還在） */
  wonMvp?: { get(): boolean; set(v: boolean): void };
  /** MVP 入口 / 出口頭上的名稱（淡粉白字，被擋住也看得到）→ 傳送門位置（相對畫面中心、以畫面高度正規化） */
  portalLabel?: () => { x: number; y: number } | null;
  /** 走向地上掉落物光柱（卡片等）的方向 */
  approachLoot?: () => Dir[] | null;
  /** 低解析度整張畫面（靜止偵測：辨識不到的視窗讓遊戲暫停時按 Enter） */
  stillFrame?: () => Frame | null;
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
/** 對局中畫面靜止多久（且沒辨識到視窗）→ 按 Enter 觸發視窗的預設焦點按鈕 */
const STILL_MS = 4000;
/** 畫面靜止時，時鐘須在這段時間內還在走，才算「視窗跳出讓遊戲暫停」 */
const STILL_CLOCK_GAP = 4000;
/** 時鐘在這段時間內還有走動＝遊戲進行中（沒有視窗暫停） */
const GAME_RUNNING_MS = 2000;
/** 時鐘停住且最近這段時間沒看到視窗，才算在 MVP 巢穴裡（視窗造成的暫停不算） */
const LAIR_NO_WINDOW_MS = 5000;
/** 時鐘停住＋首領血條連續這麼久＝巢穴戰（原地圖寶箱視窗的停住很短） */
const LAIR_BOSS_MS = 8000;
/** 勝利後看不到出口：沿最後方向走多久、原地等到多久才交回一般走位 */
const EXIT_COAST_MS = 3000;
const EXIT_WAIT_MS = 12000;
/** 走向傳送門時畫面靜止多久＝撞牆 → 往側邊繞 DETOUR_MS */
const STUCK_MS = 1500;
// 先短後長（0.9 → 1.8 → 2.7 → 3.6 秒，左右輪流）：缺口常在旁邊一點點（實機：Glast Heim 兩座塔之間，
// 往下 0.7 秒再往右就過；原本 2/4/6 秒一繞就繞過頭，上下來回 12 秒都沒試到缺口）
const DETOUR_MS = 900;
/** 小地圖上移動超過這麼多像素才算有在走；按著方向鍵 MINIMAP_STUCK_MS 都沒超過＝撞牆 */
const MINIMAP_MOVE_PX = 2;
/** 祭壇：小地圖上離祭壇中心這麼近就站著等觸發；多久沒成功就放棄 */
const ALTAR_ARRIVE = 0.09;
const ALTAR_GIVE_UP_MS = 25000;
/** 繞圈找入口：往外走多久、圓周每 1/8 走多久（入口開了會給 Sleipnir 加速） */
const SEARCH_OUT_MS = 900;
const SEARCH_SEG_MS = 600;
/** 入口指示圓盤短暫消失時沿最後方向走多久 */
const POINTER_COAST_MS = 3000;
const MINIMAP_STUCK_MS = 2000;
/** 小地圖相鄰兩次讀數距離超過這麼多 px＝換地圖（走路每 0.4 秒只移動幾 px） */
const MAP_JUMP_PX = 15;
/** 備援 Enter 的最短間隔 */
const ENTER_COOLDOWN = 3000;
/** HP 條與小地圖連續這麼久都讀不到＝不在對局（城鎮）→ 不辨識視窗。
 * 原 60 秒：結算頁帶物品等畫面穩定 + 格數統計殘留，停留超過 60 秒 → 被當成城鎮、結算頁不再點（實機卡住）→ 180 秒 */
const TOWN_NO_HUD_MS = 180000;
/** 同一個視窗點了幾次還在 → 改成與點擊交替按 Enter */
const TAPS_BEFORE_ENTER = 3;
/** 破關時免費帶回倉庫的件數（game_data.gd KEEP_WIN） */
const KEEP_FREE = 3;
/** 結算頁出現後等這麼久才開始帶物品（進場動畫） */
const RESULT_SETTLE_MS = 8000;
/** 初始技能觸發遊戲設定同步的最短間隔（升級三張普通卡也會被判成初始技能） */
const SYNC_REQUEST_GAP = 180000;
const INTERVAL = { still: 1000, minimap: 400, screen: 500, portal: 250, indicator: 400, danger: 150, hp: 500, swirl: 250, object: 600, clock: 1000 };
/** 低血量撤退、首領戰風箏的大圈倍數（相對一般走位週期） */
const RETREAT_FACTOR = 2.5;
const KITE_FACTOR = 2;

/**
 * 掛機主迴圈：感知（節流取樣）→ 視窗處理 → 移動決策（decide.ts，純函式）→ 按鍵。
 * 技能由遊戲自動施放；升級卡另以週期送「1」當備援。
 * （常駐自動 Enter 已移除：腐化寶箱預設焦點是 Hel、城鎮按 Enter 會開世界聊天；
 *   現在只在「視窗點了沒反應」或「對局中畫面靜止且辨識不到視窗」時按，作為與畫面大小無關的備援）
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
  /** 時鐘停住期間小地圖位置跳動（走進巢穴＝傳送）的時間 */
  let lairJumpAt = -Infinity;
  let frozenBossSince: number | null = null;
  /** 目前這個視窗已點過幾次（視窗消失即歸零） */
  let windowTaps = 0;
  /** 靜止開始時是否在對局中（null＝畫面在動） */
  let stillInRun: boolean | null = null;
  let lastEnter = -Infinity;
  let lastSyncRequest = -Infinity;
  /** 這局打倒過 MVP（結算頁可免費帶 3 件回倉庫）、已帶幾件 */
  // 重新載入外掛時沿用（實機：打倒 MVP 後更新外掛 → 結算頁不知道能免費帶 3 件，一件都沒帶）
  let wonMvpThisRun = deps.wonMvp?.get() ?? false;
  const setWon = (v: boolean) => {
    if (wonMvpThisRun !== v) deps.wonMvp?.set(v);
    wonMvpThisRun = v;
  };
  let keepTaken = 0;
  /** 目前分頁（以按下的分頁 x 位置識別）、這頁點了幾格、試過切到哪些分頁 */
  let keepPageTaps = 0;
  let keepWaits = 0;
  let keepMaxLen = 0;
  let keepShortWaits = 0;
  let keepFewWaits = 0;
  const keepTappedX: number[] = [];
  let resultFirstAt: number | null = null;
  let resultSeenAt = -Infinity;
  let resultLeftPending = false;
  let storageFull = false;
  /** 結算頁按了離開卻被「不存放就離開？」退回的次數 */
  let resultBounces = 0;
  const keepTabTried = new Set<number>();
  const nextKeep = (act: ScreenAction): { x: number; y: number; what: string } | null => {
    const tabs = act.keepTabs ?? [];
    const cur = tabs.find((t) => t.pressed);
    // 只有自己點了分頁才從第 1 格重算：「按下」的分頁靠亮度差判斷，取樣間會閃 → 原本一閃就重算，
    // 同一格被點 3 次（存 → 取消 → 存），只帶回 1 件（實機）
    // 依位置挑：最左邊、還沒點過的那格（不依索引：某張取樣只切出部分格子時，索引會對到別格；
    // 實機第一下點到第 7 格、之後再點第 2、3 格，評分最高的第 1 格沒帶）
    const tile = act.keep?.find((k) => !keepTappedX.some((x) => Math.abs(x - k.x) < 0.015));
    if (tile) {
      keepTappedX.push(tile.x);
      keepPageTaps++;
      keepTaken++;
      return { ...tile, what: 'item' };
    }
    // 這頁點完了：切到目前分頁右邊的下一個（只往右、每個試一次）
    if (!cur) return null;
    const next = tabs.filter((t) => t.x > cur.x + 0.01).sort((a, b) => a.x - b.x)[0];
    if (!next || keepTabTried.has(Math.round(next.x * 100))) return null;
    keepTabTried.add(Math.round(next.x * 100));
    keepPageTaps = 0;
    keepTappedX.length = 0;
    return { x: next.x, y: next.y, what: 'tab' };
  };
  let detourUntil = -Infinity;
  let detourDirs: Dir[] = [];
  let detourCw = false;
  let detourStreak = 0;
  /** 小地圖上的玩家位置：按著方向鍵卻久沒移動＝撞牆（畫面上怪物在動，靠畫面靜止判斷不出來） */
  let mmPos: { x: number; y: number } | null = null;
  let mmMovedAt = -Infinity;
  let mmSeenAt = -Infinity;
  /** 小地圖位置真正變化的時間（不因切換動作而重設；判斷「遊戲被暫停」用） */
  let mmChangedAt = -Infinity;
  /** 祭壇：最近讀到的小地圖、目前要去的祭壇與放棄清單 */
  let mmLast: MinimapRead | null = null;
  /** 時間剛停住（入口剛開）時玩家在小地圖上的位置：入口一定生在這附近 4~6.5 單位內（mvp_raid.gd _portal_point） */
  let portalHome: { x: number; y: number } | null = null;
  let wasFrozen = false;
  let lastWindowAt = -Infinity;
  /** 巢穴內（時間停著）點過對話框：時鐘恢復走動＝回到地圖 → 不必再找出口 */
  let lairDialog = false;
  let altarGoal: { id: string; x: number; y: number; since: number } | null = null;
  const altarGiveUp: { x: number; y: number; until: number }[] = [];

  const portalSeeker = createPortalSeeker();
  const targetSeeker = createIndicatorSeeker();
  const objectSeeker = createObjectSeeker();
  const clock = createFreezeDetector();
  const screens = createScreenHandler();
  const still = createStillDetector();
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
    altars: [],
    runner: false,
    enterSrc: '-',
    mmAge: -1,
    acts: [],
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
        // 結算頁之後又看到 HP 條＝新的一局開始 → 重設「打倒過 MVP」與帶回物品進度
        if (hp && resultLeftPending) {
          resultLeftPending = false;
          setWon(false);
          keepTaken = 0;
          keepPageTaps = 0;
          keepMaxLen = 0;
          keepShortWaits = 0;
          keepWaits = 0;
          resultFirstAt = null;
          storageFull = false;
          resultBounces = 0;
          keepFewWaits = 0;
          keepTappedX.length = 0;
          keepTabTried.clear();
        }
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
        // 巢穴內（時間停住）首領一定在場：血條久不下降也是首領戰（實機：Valkyrie Reginleif 血厚，
        // 15 秒沒掉被當成「首領在畫面外」→ 不風箏、去找入口光，HP 見底）
        const nowBoss = b.boss && (!b.stalled || state.frozen);
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
        // 小地圖上角色位置瞬間跳很遠＝換地圖（傳送）。打倒 MVP 後跳走＝已出巢穴回到原地圖 → 不再找出口
        // （實機：原地圖有首領血條一直出現，「首領消失 30 秒」條件遲遲不成立，回地圖後還追著指示器 2~3 分鐘不打怪）
        // 出口後跳出勝利選擇視窗 → 小地圖中斷一段時間（實機：回地圖後又找了 70 秒出口）；
        // 中斷較久時要時鐘已恢復（不在巢穴）才算，避免巢穴裡讀數中斷又走了一段被當成換地圖
        if (mmLast && (now() - mmSeenAt < 1500 || !state.frozen) && mvpFight && now() - lastBossAt > 3000 &&
          Math.hypot(m.player.x - mmLast.player.x, m.player.y - mmLast.player.y) > MAP_JUMP_PX) {
          mvpFight = false;
          lairDialog = false;
          log?.info('minimap: 位置跳動＝已離開巢穴，停止找出口');
        }
        // 時鐘 2 秒以上沒跳（入口開著＝時間停住）時的傳送；不看 state.frozen（載入畫面讀不到時鐘會短暫解除）
        if (mmLast && now() - clock.changedAt > 2000 && Math.hypot(m.player.x - mmLast.player.x, m.player.y - mmLast.player.y) > MAP_JUMP_PX)
          lairJumpAt = now();
        mmSeenAt = now();
        mmLast = m;
        state.altars = (m.altars ?? []).map((a) => a.id);
        state.runner = !!m.runner;
        if (!mmPos || Math.hypot(m.player.x - mmPos.x, m.player.y - mmPos.y) > MINIMAP_MOVE_PX) {
          mmPos = m.player;
          mmMovedAt = now();
          mmChangedAt = now();
        }
        return bossStalled && m.boss ? navigator.steer(m.player, m.boss) : null;
      },
      null as Dir[] | null,
    ),
    // 傳送門指示器：只看大圓盤（chest_pointer.gd：MVP 入口 / 勝利後的「返回地圖」出口半徑 24，寶箱 19）。
    // 圓盤只在傳送門不在畫面上時出現，且紅色因果路線傳送門沒有指示器 → 追它一定是入口 / 出口，與顏色無關
    pointer: throttle(
      INTERVAL.indicator,
      () => {
        const list = deps.findIndicators?.() ?? null;
        if (!list) return null;
        return steerToIndicator(list.filter((i) => i.size >= LARGE_DISC).map((i) => ({ ...i, kind: 'target' as const })));
      },
      null as Dir[] | null,
    ),
    target: throttle(
      INTERVAL.indicator,
      () => {
        if (!config.seekTargets || !deps.findIndicators) return null;
        // 頭像圓盤只在入口開著 / 找出口時由 pointer 處理；一般走位不追（陰影旁剛好有白色東西會誤判）
        const list = deps.findIndicators()?.filter((i) => !i.face) ?? null;
        return targetSeeker.update(list && resolvePurple(list, state.frozen), now());
      },
      null as Dir[] | null,
    ),
    loot: throttle(INTERVAL.swirl, () => (config.seekLoot && deps.approachLoot ? deps.approachLoot() : null), null as Dir[] | null),
    object: throttle(
      INTERVAL.object,
      () => (config.seekObjects && deps.findObjects ? objectSeeker.update(deps.findObjects(), now()) : null),
      null as Dir[] | null,
    ),
    still: throttle(INTERVAL.still, () => (deps.stillFrame ? still.update(deps.stillFrame(), now()) : null), null as number | null),
    frozen: throttle(INTERVAL.clock, () => (deps.clockGlyph ? clock.update(deps.clockGlyph(), now()) : false), false),
    approach: throttle(INTERVAL.swirl, () => deps.approachSwirl?.() ?? null, null as Dir[] | null),
    exit: throttle(INTERVAL.swirl, () => deps.approachExit?.() ?? null, null as Dir[] | null),
    label: throttle(
      INTERVAL.swirl,
      () => {
        const p = deps.portalLabel?.() ?? null;
        return p ? dirsFromAngle(Math.atan2(-p.y, p.x)) : null;
      },
      null as Dir[] | null,
    ),
    swirl: throttle(INTERVAL.swirl, () => (config.seekTargets ? deps.fleeSwirl?.() ?? null : null), null as Dir[] | null),
    danger: throttle(INTERVAL.danger, () => (config.dodge ? deps.probeDanger?.() ?? null : null), null as DangerProbes | null),
  };

  /**
   * 勝利後找出口：出口光時有時無時，不要切回一般走位在巢穴裡亂走（實機：亂走時踩進旁邊的金色 Valhalla 因果傳送門）。
   * 看不到出口：先沿最後方向走 3 秒，之後原地等；12 秒都沒再看到才交回一般走位（避免永遠卡住）
   */
  let lastExit: { dirs: Dir[]; at: number } | null = null;
  const exitApproach = (t: number): Dir[] | null => {
    // 名稱（與出口顏色、語言無關，被擋住也畫在最上層）優先於淡藍光；因果路線傳送門名稱是金 / 紅色，不會認錯
    const d = sense.pointer.get(t) ?? sense.label.get(t) ?? sense.exit.get(t);
    if (d) {
      lastExit = { dirs: d, at: t };
      return d;
    }
    if (!lastExit) lastExit = { dirs: [], at: t };
    if (t - lastExit.at < EXIT_COAST_MS) return lastExit.dirs;
    if (t - lastExit.at < EXIT_WAIT_MS) return [];
    return null;
  };

  /** 掉落物光柱：追超過 8 秒（走不到、地形擋住）就放棄 10 秒，避免一直卡在同一處 */
  let lootSince: number | null = null;
  let lootPauseUntil = -Infinity;
  const lootStep = (t: number): Dir[] | null => {
    if (t < lootPauseUntil) return null;
    const d = sense.loot.get(t);
    if (!d) {
      lootSince = null;
      return null;
    }
    if (lootSince === null) lootSince = t;
    if (t - lootSince > 8000) {
      lootPauseUntil = t + 10000;
      lootSince = null;
      return null;
    }
    return d;
  };

  /** 金波利：依小地圖追（會跑、限時 40 秒；在畫面內時沒有邊緣指示器可追） */
  const chaseRunner = (): Dir[] | null => {
    if (!config.seekTargets || !mmLast?.runner || now() - mmSeenAt > 1500) return null;
    return navigator.steer(mmLast.player, mmLast.runner, 1.5);
  };

  /** 入口在畫面外又沒有指示器（暗色地圖指示圓盤與地形連成一片）→ 依小地圖走回入口剛開時的位置，入口就會回到畫面上 */
  /** 入口開著時的走向（記錄來源供除錯：指示器 / 畫面光 / 小地圖回入口位置） */
  const entryApproach = (t: number): Dir[] | null => {
    // 指示圓盤會閃（被特效、樹影蓋住一兩筆）→ 3 秒內沿最後方向走，不馬上改成回入口位置 / 繞圈（實機：兩者交替來回）
    // 入口在畫面上：看頭上的名稱（固定淡粉白＋黑框，與 MVP 種類無關；實機 Dark Lord 入口光淡又細，光的判斷認不出）。
    // 名稱優先於指示圓盤：看得到名稱時入口就在畫面上，此時的「圓盤」多半是任務「!」等其他指示
    // （實機：入口在左、名稱看得到，卻追右下的任務圓盤）。名稱誤判（粉紅催眠漩渦）已用黑框檢查排除
    const l = sense.label.get(t);
    if (l) return (searchStart = null), (lastPointer = null), (state.enterSrc = 'label'), l;
    const p = sense.pointer.get(t);
    if (p) lastPointer = { dirs: p, at: t };
    else if (lastPointer && t - lastPointer.at < POINTER_COAST_MS) return (state.enterSrc = 'pointer~'), lastPointer.dirs;
    if (p) return (searchStart = null), (state.enterSrc = 'pointer'), p;
    const g = sense.approach.get(t);
    if (g) return (searchStart = null), (state.enterSrc = 'glow'), g;
    const h = backToPortalHome();
    if (h) {
      searchStart = null;
      return (state.enterSrc = 'home'), h;
    }
    if (!portalHome) return (state.enterSrc = '-'), null;
    state.enterSrc = 'circle';
    return circleSearch(t);
  };

  /**
   * 已回到入口剛開時的位置、畫面上仍認不出入口（顏色淡、被柱子擋住）→ 繞圈找。
   * 遊戲固定把入口開在當時角色位置 4～6.5 單位外、保證走得到（core/mvp_raid.gd _portal_point）
   * → 先往外走一段再沿圓周繞，每圈半徑放大；與入口顏色無關，碰到入口就自動進入
   */
  let searchStart: number | null = null;
  let lastPointer: { dirs: Dir[]; at: number } | null = null;
  const circleSearch = (t: number): Dir[] => {
    if (searchStart === null) searchStart = t;
    let e = t - searchStart;
    for (let loop = 0; ; loop++) {
      const k = 1 + 0.35 * (loop % 4);
      const out = SEARCH_OUT_MS * k, seg = SEARCH_SEG_MS * k;
      const total = out + 8 * seg + out;
      if (e >= total) {
        e -= total;
        continue;
      }
      const start = (loop * 3) % 8; // 每圈換起點方向
      if (e < out) return dirsFromAngle((start * Math.PI) / 4);
      if (e < out + 8 * seg) {
        const i = Math.floor((e - out) / seg);
        // 沿圓周（逆時針，八角形）：第 i 段的切線方向＝起點方向 + 90° + i·45°
        return dirsFromAngle(((start + i) * Math.PI) / 4 + Math.PI / 2);
      }
      return dirsFromAngle((start * Math.PI) / 4 + Math.PI); // 回中心
    }
  };

  const backToPortalHome = (): Dir[] | null => {
    if (!portalHome || !mmLast) return null;
    // 繞圈找入口時會離開中心一段距離 → 放寬，走太遠（被牆帶偏）才拉回中心重來
    return navigator.steer(mmLast.player, portalHome, searchStart === null ? 4 : 12);
  };

  /**
   * 祭壇：依小地圖走到勾選的祭壇上，到了就站著（回傳 []）等 2 秒觸發；觸發後標記消失。
   * 25 秒還沒成功（走不到、站不準）就放棄這座 60 秒。
   */
  const seekAltar = (t: number): Dir[] | null => {
    const m = mmLast;
    if (!m || t - mmSeenAt > 1500) return null;
    const want = (m.altars ?? []).filter(
      (a) => config.altars?.[a.id] && !altarGiveUp.some((g) => g.until > t && Math.hypot(g.x - a.x, g.y - a.y) < 8),
    );
    if (!want.length) {
      altarGoal = null;
      return null;
    }
    const a = want.reduce((p, q) =>
      Math.hypot(p.x - m.player.x, p.y - m.player.y) <= Math.hypot(q.x - m.player.x, q.y - m.player.y) ? p : q,
    );
    if (!altarGoal || altarGoal.id !== a.id || Math.hypot(altarGoal.x - a.x, altarGoal.y - a.y) > 8) {
      altarGoal = { id: a.id, x: a.x, y: a.y, since: t };
      log?.info('altar: 前往祭壇', a.id);
    }
    if (t - altarGoal.since > ALTAR_GIVE_UP_MS) {
      altarGiveUp.push({ x: a.x, y: a.y, until: t + 60000 });
      log?.info('altar: 放棄', a.id);
      altarGoal = null;
      return null;
    }
    // 觸發半徑 1.8 單位：實機小地圖約 1.7 px/單位、圓底直徑 32 px → 約 0.09 個圓底直徑
    return navigator.steer(m.player, a, Math.max(1.5, ALTAR_ARRIVE * a.d)) ?? (navigator.calibrated ? [] : null);
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
      // 時鐘還在走＝遊戲沒被視窗暫停 → 看到的「視窗」是誤判，不停下也不點
      // （實機：Pyramid 亮色石地被當成視窗，角色停在沒勾選的 Valkyrie 祭壇圈內，差點觸發）。
      // 真的視窗會讓時鐘停下，最多晚 2 秒照常處理。視窗期間也持續讀時鐘，判斷才不會過期
      sense.frozen.get(t);
      const gameRunning = clock.ticking && t - clock.changedAt < GAME_RUNNING_MS;
      const rawSeen = deps.gameSync?.busy ? null : sense.screen.get(t);
      if (rawSeen) lastWindowAt = t;
      // 城鎮：沒有 HP 條、時鐘也不走 → 明亮石板地會被當成結算頁 / 視窗，點到扭蛋機、NPC（實機 Prontera）
      // 從開外掛起算：視窗蓋住 HUD 時才開外掛（實機：勝利選擇「以無盡模式繼續」畫面）也要能點；
      // HP 讀數會整段失效（實機 Valhalla：左側 MVP 面板出現後一直 -1）→ 小地圖看得到也算在對局（城鎮沒有小地圖）
      const hudGone = !!deps.readHp && t - Math.max(hpSeenAt, mmSeenAt, startedAt) >= TOWN_NO_HUD_MS;
      // 結算頁會把 HUD 整個藏起來（menus.gd show_end：world.hud.hide()）→ HP 條還讀得到就不是結算頁。
      // 實機：巢穴淺色石板地讓舊「結算頁」顏色規則成立，一直點底部技能列（跳出技能說明）而不去出口
      sense.vitals.get(t);
      const resultWithHud = rawSeen?.kind === 'result' && !!deps.readHp && t - hpSeenAt < 1500;
      const seen = gameRunning || hudGone || resultWithHud ? null : rawSeen;
      // 只有新的取樣才交給處理器（它要求「連續 2 次獨立取樣」成立才點，避免同一份快取被重複計數）
      const act = sense.screen.fresh && !deps.gameSync?.busy ? screens.update(seen, t) : null;
      // 結算頁剛出現時物品格還在進場動畫：同一位置先只切出 1 格（實機第一下點在 0.55,0.80，之後才是 12~17 格那排）
      // → 要帶物品時，格數連續兩次取樣相同才開始點
      const keepLen = act?.kind === 'result' ? act.keep?.length ?? 0 : -1;
      // 帶物品時兩種情況先不點：
      // ① 格數比之前看過的都多（進場動畫還在長，實機第一下只切出 1 格、位置不對）→ 等下一張
      // ② 格數比之前看過的少（2 排物品時某些取樣只切出 1 格 → 以為帶完、直接點再玩一次）→ 等完整的那張
      // 各有上限，不卡在結算頁
      // ③ 結算頁出現後先等 8 秒（實機：完整物品列約 6 秒後才穩定）（進場動畫：實機第一下常點在動畫中、排序較後面的格子）
      // 「出現時間」以這次連續看到結算頁起算：超過 10 秒沒看到＝新的結算頁（實機：重載 / 手動處理後殘留舊值 → 沒等就點）
      if (act?.kind === 'result') {
        if (resultFirstAt === null || t - resultSeenAt > 10000) {
          // 新的結算頁：上一次的格數統計作廢（實機：殘留的最大格數讓這次一直判成「格數變少」，等了 1 分多鐘才點）
          resultFirstAt = t;
          keepMaxLen = 0;
          keepWaits = 0;
          keepShortWaits = 0;
          keepFewWaits = 0;
        }
        resultSeenAt = t;
      }
      const keepPending = act?.kind === 'result' && wonMvpThisRun && keepTaken < KEEP_FREE;
      const keepEarly = keepPending && resultFirstAt !== null && t - resultFirstAt < RESULT_SETTLE_MS;
      const keepGrew = keepPending && keepLen > keepMaxLen;
      const keepShort = keepPending && keepLen < keepMaxLen;
      // ④ 切出的格數少於還要帶的件數 → 多半是切割不完整，等一下（真的只有 1~2 件時最多等 6 次）
      const keepFew = keepPending && keepLen < KEEP_FREE - keepTaken && keepFewWaits < 6;
      const keepUnsettled = keepEarly || keepFew || (keepGrew && keepWaits < 4) || (keepShort && keepShortWaits < 20);
      if (act?.kind === 'result') {
        if (keepGrew) keepWaits++;
        if (keepShort) keepShortWaits++;
        if (keepFew) keepFewWaits++;
        keepMaxLen = Math.max(keepMaxLen, keepLen);
      }
      if (act && pointer && !keepUnsettled) {
        state.screenTaps++;
        // 點過勝利選擇 / 結算 / 初始技能＝已離開巢穴，不再找出口（寶箱等 modal 不算：勝利後巢穴內也會跳）
        // 時間還停著＝還在巢穴裡：勝利後巢穴內也會跳對話框（實機：點掉後當成「入口開著」去追任何亮光 →
        // 走進金色 Valhalla 因果路線傳送門）→ 不清除，繼續只找出口
        if (act.kind === 'dialog' || act.kind === 'result' || act.kind === 'start-skill') {
          if (state.frozen) lairDialog = true;
          else mvpFight = false;
        }
        state.lastScreen = act.kind;
        // 點了幾次視窗還在（畫面大小不同時按鈕位置可能算偏）→ 與點擊交替按 Enter（預設焦點按鈕）。
        // 腐化寶箱（預設焦點 Hel）、結算頁（焦點不一定是再玩一次）、轉職選右邊（預設焦點是左邊）不按
        // 結算頁按了離開卻跳「不存放就離開？」＝遊戲說還能帶（只有打倒過 MVP 才會跳）
        // 實機：重新整理頁面後外掛不知道打倒過 MVP → 不帶、一直在結算頁與這個視窗間來回
        // → 補上旗標，退回後就去帶；帶了還一直被退回（點沒生效）→ 第 3 次起點「仍要離開」
        const bounced = act.kind === 'dialog' && resultLeftPending && !storageFull;
        if (bounced) {
          resultBounces++;
          if (!wonMvpThisRun) log?.info('result: 被退回＝打倒過 MVP，補帶物品');
          setWon(true);
        }
        const leaveAnyway = act.kind === 'dialog' && resultLeftPending && !!act.alt && (storageFull || resultBounces >= 3);
        const enter =
          !leaveAnyway &&
          windowTaps >= TAPS_BEFORE_ENTER &&
          windowTaps % 2 === 1 &&
          act.kind !== 'corrupt' &&
          act.kind !== 'result' &&
          !(act.kind === 'job' && config.jobPath === 'second');
        windowTaps++;
        // 破關（打倒過 MVP）的結算頁：先免費帶 3 件回 Kafra 倉庫（不帶就離開會被賣掉），再點再玩一次。
        // 每格只點一次（再點一次＝取消保存）
        // 只顯示目前稀有度分頁（傳說 > 紫色 > 其餘，預設停在最高的）；這頁不足 3 件 → 切到右邊下一頁繼續
        // 倉庫已滿：點取消後不再帶（再帶也只會一直跳替換視窗）
        if (act.kind === 'storage-full') (keepTaken = KEEP_FREE), (storageFull = true);
        const keepStep = act.kind === 'result' && wonMvpThisRun && keepTaken < KEEP_FREE ? nextKeep(act) : null;
        state.acts = [
          ...state.acts.slice(-9),
          {
            t,
            kind: act.kind,
            // 帶回物品時記實際點的格子（除錯：原本記成結算按鈕位置，看不出點了哪格）
            x: +(keepStep ?? act).x.toFixed(3),
            y: +(keepStep ?? act).y.toFixed(3),
            keep: act.keep?.length ?? 0,
            // 除錯：切出的物品格位置（實機：結算頁一直只切出 1 格、在結算與「不存放就離開？」間來回）
            kx: act.keep?.map((k) => k.x.toFixed(2)).join(','),
            how: keepStep ? `keep:${keepStep.what}` : enter ? 'enter' : 'tap',
          },
        ];
        if (keepStep) {
          log?.info('result: 帶回倉庫', keepStep.what, keepTaken);
          void pointer.tap(keepStep.x, keepStep.y);
        } else if (enter) {
          log?.info('screen: 點擊無效，改按 Enter', act);
          void keyboard.tap('enter');
        } else {
          // 倉庫已滿、結算頁按了離開 →「不存放就離開？」點「仍要離開」（預設焦點是重新選擇，會一直退回結算頁）
          const target = leaveAnyway ? act.alt! : act;
          log?.info('screen: 點擊', act, target === act ? '' : '（仍要離開）');
          void pointer.tap(target.x, target.y);
          // 點了結算頁的按鈕不代表離開：沒帶滿 3 件會跳「不存放就離開？」、Enter 退回結算頁
          // （實機：在這裡就清掉「打倒過 MVP」→ 剩下 2 件不再帶、一直點再玩一次原地打轉）
          // → 等下一局 HP 條出現才重設（見 vitals）
          if (act.kind === 'result') resultLeftPending = true;
        }
        // 初始技能選完＝新的一局開始；「隨機選擇」每局會被遊戲重設 → 重新同步。
        // 升級三張普通卡也會被判成初始技能 → 限制頻率，避免對局中一直開暫停選單
        if (act.kind === 'start-skill' && t - lastSyncRequest >= SYNC_REQUEST_GAP) {
          lastSyncRequest = t;
          deps.gameSync?.request();
        }
      }
      if (sense.screen.fresh) screenStreak = seen ? screenStreak + 1 : 0;
      if (screenStreak === 0) windowTaps = 0;
      // 連續 2 次取樣都看到視窗才停止移動（單張誤判不該讓角色在戰鬥中停下；真的視窗遊戲本來就暫停）
      if (seen && screenStreak >= 2) {
        for (const d of DIRS) keyboard.up(d);
        state.dirs = [];
        state.activity = 'screen';
        return;
      }

      // 辨識不到的視窗（畫面大小不同、新視窗）：對局中畫面突然整個靜止 → 遊戲被視窗暫停 → 按 Enter。
      // 只在靜止開始時時鐘「剛剛」還在走才算：視窗跳出時時鐘與畫面同時停下。
      // 城鎮、載入畫面（時鐘沒走過）不按（城鎮 Enter 會開聊天）；MVP 入口開著時時鐘早就停了、怪物被清空，
      // 角色撞牆時畫面也會靜止（實機：誤按 Enter）→ 時鐘停下超過 STILL_CLOCK_GAP 才靜止的不算
      const stillSince = sense.still.get(t);
      if (stillSince === null) stillInRun = null;
      else if (stillInRun === null) stillInRun = clock.ticking && t - clock.changedAt < STILL_CLOCK_GAP;
      const stillPause = stillInRun && stillSince !== null && t - stillSince >= STILL_MS;
      // 另一種暫停訊號：時鐘停住、按著方向鍵小地圖位置也不動，且兩者「一起」停下（差 < STILL_CLOCK_GAP）。
      // 實機：「任務完成！」視窗在左側、背後 NPC 立繪與特效還在動 → 畫面不算靜止，Enter 備援不觸發，卡住。
      // MVP 入口開著 / 巢穴內：時鐘早就停了、角色還能走 → 不會一起停，不按
      const heldStill =
        clock.changedAt > -Infinity &&
        t - clock.changedAt >= STILL_MS &&
        t - mmSeenAt < 1500 &&
        state.dirs.length > 0 &&
        t - mmChangedAt >= STILL_MS &&
        Math.abs(clock.changedAt - mmChangedAt) < STILL_CLOCK_GAP;
      // 左上 HP 條還讀得到才按：任務完成 / 轉職 / 馴服等視窗不蓋 HUD；結算頁整個蓋掉 HUD，
      // 預設焦點是「選擇目的地」（實機：結算頁沒認出來 → Enter → 換到別張地圖）
      const hudVisible = now() - hpSeenAt < 2000;
      if (!seen && !deps.gameSync?.busy && hudVisible && (stillPause || heldStill) && t - lastEnter >= ENTER_COOLDOWN) {
        lastEnter = t;
        state.screenTaps++;
        state.lastScreen = 'still-enter';
        log?.info('screen: 遊戲像是被辨識不到的視窗暫停，按 Enter', { stillPause, heldStill });
        void keyboard.tap('enter');
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
      // 入口開啟位置：只有「看著時鐘停下」才知道（重新載入外掛時入口早就開了，當下位置不是入口開啟處）
      if (frozen && !wasFrozen && !mvpFight)
        portalHome = clock.sawTick && mmLast && t - mmSeenAt < 1500 ? { ...mmLast.player } : null;
      if (!frozen) portalHome = null;
      wasFrozen = frozen;
      // 時間停住期間打過首領＝在 MVP 巢穴裡（入口開著時一般怪物會被清掉，不會有首領）→ 勝利後找淡藍出口。
      // 實機：無盡模式勝利後巢穴內時鐘恢復走動 → 不能靠「停住」判斷，改成首領消失後 30 秒內都找出口
      if (!(frozen && vitals.boss)) frozenBossSince = null;
      if (vitals.boss) {
        lastBossAt = t;
        // 一般首領戰中時鐘停住一定是視窗暫停（實機：寶箱視窗讓時鐘停 → 被當成巢穴，打完在地圖上找出口亂轉）；
        // 巢穴內時鐘停住時沒有視窗 → 最近 5 秒沒看到視窗才算巢穴。
        // （原本「連續停 4 秒」不可靠：進巢穴的載入畫面讀不到時鐘，停住判定中斷重算 → Glast Heim 巢穴勝利後沒進入找出口）
        // 小地圖讀得到時還要看過「時鐘停住後傳送」（走進巢穴）：原地圖首領戰中寶箱視窗讓時鐘停 → 視窗收掉後
        // 時鐘還沒恢復、又剛好 5 秒沒認到視窗 → 被當成巢穴，打完在原地圖「找出口」不打怪（實機）
        // 「時鐘最後一次跳動」之後才傳送＝走進巢穴。不用「沒判定停住」的時間：進巢穴的載入畫面讀不到時鐘，
        // 停住判定會短暫解除（實機：打贏 MVP 卻沒認成巢穴戰 → 沒記打倒過 MVP → 結算頁沒帶物品）
        // 或「時鐘停住＋首領血條」已連續 8 秒以上（原地圖寶箱視窗造成的停住，視窗一關時鐘就走；
        // 實機：載入畫面讓時鐘判定出一次「跳動」→ 傳送早於它 → 打贏也沒記到打倒過 MVP）
        if (frozenBossSince === null) frozenBossSince = t;
        const enteredLair = t - mmSeenAt > 3000 || lairJumpAt >= clock.changedAt || t - frozenBossSince >= LAIR_BOSS_MS;
        if (frozen && t - lastWindowAt > LAIR_NO_WINDOW_MS && enteredLair) {
          mvpFight = true;
          portalHome = null; // 已進巢穴（另一張地圖），入口位置作廢
          lastExit = null;
        }
      }
      // 時間還停著＝還在巢穴裡（非無盡模式勝利後時鐘不會走）→ 繼續找出口，不因時限放棄
      else if ((t - lastBossAt > EXIT_WINDOW || lairDialog) && !frozen) {
        mvpFight = false;
        lairDialog = false;
      }
      // 低血量時撤退優先（實機：勝利選擇後回到地圖仍在找出口，HP 9% 照樣亂走）
      const exitSeek = mvpFight && !vitals.boss && !vitals.lowHp;
      // 首領血條消失 5 秒以上才算打倒（短暫讀不到血條不算；沒打倒的結算頁帶回要付 zeny）
      if (mvpFight && !vitals.boss && t - lastBossAt > 5000) setWon(true);
      const busy = portal || vitals.lowHp || vitals.boss || frozen || exitSeek;
      const bossSeek = sense.bossSeek.get(t);
      state.mmAge = Math.round(t - mmSeenAt);
      if (bossSeek && state.activity !== 'target') log?.info('boss: 依小地圖走向首領');
      const altar = busy || bossSeek ? null : seekAltar(t);
      const runner = busy || bossSeek ? null : chaseRunner();
      const target = busy ? null : bossSeek ?? runner ?? altar ?? sense.target.get(t);
      const object = busy || target ? null : (lootStep(t) ?? sense.object.get(t));
      const elapsed = t - startedAt;
      const { activity, want: decided } = decide(
        {
          portal,
          target,
          object,
          frozen: frozen || exitSeek,
          // 入口開著（時間停住、沒首領）：畫面上的入口光優先；傳送門在畫面外時改追邊緣指示器
          // （ui/chest_pointer.gd：傳送門圓盤半徑 24 比寶箱 19 大，排序優先；與顏色無關）。
          // 實機：原本時間停住就不看指示器，傳送門在畫面外只能靠走位碰運氣
          // 傳送門指示器優先（只在傳送門於畫面外時出現，最可靠）；在畫面內才靠光：出口找淡藍、入口找高亮光
          approach: exitSeek
            ? exitApproach(t)
            : frozen && !vitals.boss
              ? entryApproach(t)
              : null,
          flee: frozen || exitSeek ? null : sense.swirl.get(t),
          danger: sense.danger.get(t),
          ...vitals,
        },
        { patrol: moves.patrol(elapsed), retreat: moves.retreat(elapsed), kite: moves.kite(elapsed) },
      );
      // 走向傳送門 / 出口 / 指示器目標時撞牆（實機：下水道地圖直線走過去被牆擋住）→ 轉 90° 繞一段再回來，左右輪流。
      // 撞牆判斷：畫面靜止（入口開著、怪物被清空時）或小地圖位置按著方向鍵卻沒動（實機：追目標卡牆，周圍怪物在動）
      let want = decided;
      if (!state.dirs.length || state.activity !== activity) mmMovedAt = Math.max(mmMovedAt, t);
      // 一般走位 / 撤退 / 風箏也會撞牆（實機：走位圖形照時間按鍵，撞牆就一直推著牆）→ 一律繞路。
      // 例外：閃避與逃離催眠師（方向不能被改）、找出口（巢穴開闊，轉 90° 反而可能擦過因果路線傳送門）
      if (activity !== 'dodge' && activity !== 'flee' && !(activity === 'enter' && exitSeek)) {
        // 繞完之後原方向要重新試一段才算卡住：繞路本身也撞牆時，靜止 / 小地圖不動的計時從繞路前就開始，
        // 一繞完立刻又判卡住 → 永遠不走原方向（實機：Glast Heim 樹籬迷宮，指示器在左，只上下來回）
        const stuck =
          (stillSince !== null && t - Math.max(stillSince, detourUntil) >= STUCK_MS) ||
          (t - mmSeenAt < 1000 && t - Math.max(mmMovedAt, detourUntil) >= MINIMAP_STUCK_MS);
        if (t < detourUntil) want = detourDirs;
        else if (stuck && want.length) {
          mmMovedAt = t;
          // 連續卡住（上次繞完 10 秒內）→ 同一側繞更久（0.9 → 1.8 → 2.7 → 3.6 秒，沿牆走），到頂才換邊；
          // 每次換邊會把前一段繞的路走回去（上下來回原地打轉）
          const cont = t - detourUntil < 10000;
          detourStreak = cont ? detourStreak + 1 : 1;
          if (detourStreak > 4) detourStreak = 1;
          if (detourStreak === 1) detourCw = !detourCw;
          // 斜向被擋（常是牆角）：先只走其中一個分量（轉 45°），比轉 90° 往反方向繞近得多
          // （實機：入口在右上、塔的牆角擋住，轉 90° 一直往左上繞，在右上 / 左上之間來回）
          detourDirs = want.length === 2 ? [want[detourCw ? 0 : 1]!] : want.map((d) => TURN[detourCw ? 'cw' : 'ccw'][d]);
          detourUntil = t + DETOUR_MS * detourStreak;
          log?.info('enter: 卡住，往側邊繞', detourDirs);
          want = detourDirs;
        }
      }
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
