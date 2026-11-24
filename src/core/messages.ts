import type { Settings } from './settings';

/** ISOLATED world（可用 chrome.storage）與 MAIN world（可碰遊戲頁）之間的 postMessage 協定 */
export type BridgeMessage =
  | { __msbot: true; type: 'request-settings' }
  | { __msbot: true; type: 'settings'; settings: Settings }
  /** 從遊戲頁要求重新載入外掛（開發部署用：載入磁碟上最新 build，onInstalled 會重新注入，不刷新遊戲） */
  | { __msbot: true; type: 'reload-extension' };

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  return !!data && typeof data === 'object' && (data as { __msbot?: unknown }).__msbot === true;
}

export const GAME_MATCHES = ['https://midgardsurvivors.com/play/*'];

/** popup → background：重新載入外掛（不刷新遊戲分頁） */
export const RELOAD_MESSAGE = 'msbot:reload';
