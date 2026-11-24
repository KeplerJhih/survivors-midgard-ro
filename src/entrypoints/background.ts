import { GAME_MATCHES, RELOAD_MESSAGE } from '@/core/messages';
import type { Settings } from '@/core/settings';
import { loadSettings, watchSettings } from '@/utils/settings-store';

/**
 * 需要在 document_start、MAIN world 執行且可開關的腳本，改用動態註冊：
 * 設定關閉時直接不注入，比注入後再判斷更乾淨（MAIN world 無法同步讀 storage）。
 */
const RUNTIME_SCRIPTS: { id: string; file: string; enabled: (s: Settings) => boolean }[] = [
  { id: 'mobile', file: 'content-scripts/mobile.js', enabled: (s) => s.mobile },
  { id: 'keepalive', file: 'content-scripts/keepalive.js', enabled: (s) => s.background },
];

/** popup「重新載入」：讀取磁碟上最新 build 的外掛；不刷新網頁，由 onInstalled 重新注入 */
function reloadExtension() {
  browser.runtime.reload();
}

/**
 * 外掛重新載入/更新後，既有分頁裡的舊 content script 會失聯（ISOLATED world 失去 chrome.* API），
 * 直接把新版 bridge + bot 注入進去即可，不用刷新遊戲（bot 會先 dispose 舊實例）。
 * mobile / keepalive 屬於 document_start 腳本，改動後仍需重新整理頁面才會套用。
 */
async function reinjectGameTabs() {
  const tabs = await browser.tabs.query({ url: GAME_MATCHES });
  for (const tab of tabs) {
    if (tab.id == null) continue;
    const target = { tabId: tab.id };
    try {
      await browser.scripting.executeScript({ target, files: ['/content-scripts/bridge.js'] });
      await browser.scripting.executeScript({ target, files: ['/content-scripts/bot.js'], world: 'MAIN' });
    } catch (err) {
      console.warn('reinject failed', tab.id, err);
    }
  }
}

async function sync(settings: Settings) {
  const registered = new Set(
    (await browser.scripting.getRegisteredContentScripts()).map((s) => s.id),
  );
  for (const script of RUNTIME_SCRIPTS) {
    const want = script.enabled(settings);
    if (want && !registered.has(script.id)) {
      await browser.scripting.registerContentScripts([
        {
          id: script.id,
          js: [script.file],
          matches: GAME_MATCHES,
          runAt: 'document_start',
          world: 'MAIN',
          allFrames: false,
        },
      ]);
    } else if (!want && registered.has(script.id)) {
      await browser.scripting.unregisterContentScripts({ ids: [script.id] });
    }
  }
}

export default defineBackground(() => {
  loadSettings().then(sync).catch(console.error);
  watchSettings((s) => sync(s).catch(console.error));
  // 只在安裝/更新/重新載入時注入（service worker 閒置後重啟也會跑到這裡，不能每次都注入）
  browser.runtime.onInstalled.addListener(() => {
    reinjectGameTabs().catch(console.error);
  });
  browser.runtime.onMessage.addListener((msg: unknown) => {
    if ((msg as { type?: string })?.type === RELOAD_MESSAGE) reloadExtension();
  });
});
