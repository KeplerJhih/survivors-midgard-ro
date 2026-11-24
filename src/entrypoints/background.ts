import { GAME_MATCHES } from '@/core/messages';
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
});
