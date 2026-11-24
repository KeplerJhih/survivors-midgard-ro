import { GAME_MATCHES, RELOAD_MESSAGE } from '@/core/messages';
import type { Settings } from '@/core/settings';
import { loadSettings, watchSettings } from '@/utils/settings-store';
import { storage } from '#imports';

/** 重新載入外掛前記下的遊戲分頁，外掛重啟後重新整理它們（不能用 session：reload 時會被清空） */
const pendingReloadTabs = storage.defineItem<number[]>('local:pendingReloadTabs', { fallback: [] });

/** popup「重新載入」：讀取磁碟上最新 build 的外掛，並重新整理遊戲分頁讓新腳本注入 */
async function reloadExtensionAndGame() {
  const tabs = await browser.tabs.query({ url: GAME_MATCHES });
  await pendingReloadTabs.setValue(tabs.flatMap((t) => (t.id == null ? [] : [t.id])));
  browser.runtime.reload();
}

async function reloadPendingTabs() {
  const ids = await pendingReloadTabs.getValue();
  if (ids.length === 0) return;
  await pendingReloadTabs.setValue([]);
  for (const id of ids) await browser.tabs.reload(id).catch(() => {}); // 分頁可能已被關閉
}

/**
 * 需要在 document_start、MAIN world 執行且可開關的腳本，改用動態註冊：
 * 設定關閉時直接不注入，比注入後再判斷更乾淨（MAIN world 無法同步讀 storage）。
 */
const RUNTIME_SCRIPTS: { id: string; file: string; enabled: (s: Settings) => boolean }[] = [
  { id: 'mobile', file: 'content-scripts/mobile.js', enabled: (s) => s.mobile },
  { id: 'keepalive', file: 'content-scripts/keepalive.js', enabled: (s) => s.background },
];

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
  // 先完成腳本註冊，再重新整理分頁，document_start 腳本才會注入
  loadSettings().then(sync).then(reloadPendingTabs).catch(console.error);
  watchSettings((s) => sync(s).catch(console.error));
  browser.runtime.onMessage.addListener((msg: unknown) => {
    if ((msg as { type?: string })?.type === RELOAD_MESSAGE) reloadExtensionAndGame().catch(console.error);
  });
});
