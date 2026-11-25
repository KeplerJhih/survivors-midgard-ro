import type { MoveMode } from './movement/strategies';
import type { AltarId } from './vision/minimap';

export interface BotConfig {
  enabled: boolean;
  mode: MoveMode;
  circlePeriodMs: number;
  /** 週期送「1」處理升級選卡（遊戲在非選卡畫面會忽略） */
  pickIntervalMs: number;
  /** MVP 打完後，以畫面辨識自動走進「返回地圖」傳送門（避開紅色業力傳送門） */
  portalSeek: boolean;
  /** 低血量時保命：HP 條變紅（< 25%）或低於此比例 → 不追目標、改大圈移動 */
  lowHpRatio: number;
  /** 首領/MVP 戰：改大圈移動與 Boss 拉開距離、暫停追目標 */
  bossKite: boolean;
  /** 辨識地面紅色預警框（MVP 技能範圍）自動躲開 */
  dodge: boolean;
  /** 以畫面外指示器自動前往寶箱、任務 NPC、金波利；避開催眠師 */
  seekTargets: boolean;
  /** （實驗）以樣板比對找木箱/鐵箱並撞破。實機鑑別力不足（真箱 0.71~0.78、草地誤判 0.69~0.74），預設關閉 */
  seekObjects: boolean;
  /** 以畫面辨識自動處理：結算頁（再玩一次）、確認框（仍要離開/繼續）、初始技能（上次選擇） */
  autoContinue: boolean;
  /** 轉職（Base Lv 20）選哪條路：左（第一條，遊戲預設）/ 右（第二條）；只有一條路的職業不受影響 */
  jobPath: 'first' | 'second';
  /** 自動前往觸發的祭壇（每座都有代價，預設只開沒有代價的 Yggdrasil） */
  altars: Partial<Record<AltarId, boolean>>;
  /** 走向地上貴重掉落物的光柱（卡片等；吸取範圍小，要走到旁邊才撿得到） */
  seekLoot: boolean;
}

/** 遊戲內的勾選設定：on/off 由外掛在暫停選單同步，keep 不動 */
export type Toggle = 'on' | 'off' | 'keep';
export interface GameToggles {
  /** 隨機選擇（endless_auto_pick）：遊戲自己依稀有度挑最高，不跳窗不暫停；每局會被重設 */
  autoPick: Toggle;
  /** 累積強化（hold_levels） */
  holdLevels: Toggle;
  /** 累積寶箱（hold_chests）：寶箱不跳窗 */
  holdChests: Toggle;
}

export interface Settings {
  /** 偽裝成 iPhone（需重新整理遊戲頁才生效） */
  mobile: boolean;
  /** 手機模式下把滑鼠拖曳轉成觸控（才能操作虛擬搖桿） */
  touchBridge: boolean;
  /** 分頁在背景時仍持續執行遊戲（需重新整理遊戲頁才生效） */
  background: boolean;
  /** 顯示 debug 面板與詳細 log */
  debug: boolean;
  bot: BotConfig;
  game: GameToggles;
}

export const DEFAULT_SETTINGS: Settings = {
  mobile: true,
  touchBridge: true,
  background: true,
  debug: false,
  game: { autoPick: 'on', holdLevels: 'keep', holdChests: 'on' },
  bot: {
    enabled: false,
    mode: 'flower',
    circlePeriodMs: 4000,
    pickIntervalMs: 1500,
    portalSeek: true,
    seekTargets: true,
    seekObjects: false,
    dodge: true,
    lowHpRatio: 0.5,
    bossKite: true,
    autoContinue: true,
    jobPath: 'first',
    altars: { yggdrasil: true },
    seekLoot: true,
  },
};

/** 把儲存的（可能是舊版或不完整的）設定補齊預設值 */
export function mergeSettings(raw: unknown): Settings {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const bot = (p.bot && typeof p.bot === 'object' ? p.bot : {}) as Partial<BotConfig>;
  const game = (p.game && typeof p.game === 'object' ? p.game : {}) as Partial<GameToggles>;
  const altars = bot.altars && typeof bot.altars === 'object' ? bot.altars : {};
  return {
    ...DEFAULT_SETTINGS,
    ...p,
    bot: { ...DEFAULT_SETTINGS.bot, ...bot, altars: { ...DEFAULT_SETTINGS.bot.altars, ...altars } },
    game: { ...DEFAULT_SETTINGS.game, ...game },
  };
}
