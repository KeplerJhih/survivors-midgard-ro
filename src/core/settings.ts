import type { MoveMode } from './movement/strategies';

export interface BotConfig {
  enabled: boolean;
  mode: MoveMode;
  circlePeriodMs: number;
  /** 週期送「1」處理升級選卡（遊戲在非選卡畫面會忽略） */
  pickIntervalMs: number;
  /** 週期送 Enter（寶箱/結算）。⚠️ 在城鎮會開世界聊天，預設關閉 */
  enterEnabled: boolean;
  enterIntervalMs: number;
  /** MVP 打完後，以畫面辨識自動走進「返回地圖」傳送門（避開紅色業力傳送門） */
  portalSeek: boolean;
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
}

export const DEFAULT_SETTINGS: Settings = {
  mobile: true,
  touchBridge: true,
  background: true,
  debug: false,
  bot: {
    enabled: false,
    mode: 'flower',
    circlePeriodMs: 4000,
    pickIntervalMs: 1500,
    enterEnabled: false,
    enterIntervalMs: 3000,
    portalSeek: true,
  },
};

/** 把儲存的（可能是舊版或不完整的）設定補齊預設值 */
export function mergeSettings(raw: unknown): Settings {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const bot = (p.bot && typeof p.bot === 'object' ? p.bot : {}) as Partial<BotConfig>;
  return { ...DEFAULT_SETTINGS, ...p, bot: { ...DEFAULT_SETTINGS.bot, ...bot } };
}
