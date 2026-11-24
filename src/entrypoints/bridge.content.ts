import { GAME_MATCHES, isBridgeMessage, RELOAD_MESSAGE, type BridgeMessage } from '@/core/messages';
import { mergeSettings, type Settings } from '@/core/settings';
import { loadSettings, saveSettings, watchSettings } from '@/utils/settings-store';

/**
 * ISOLATED world：把 chrome.storage 的設定轉送給 MAIN world 的 bot，並代為寫入設定、觸發重新載入。
 * 外掛重新載入後舊 bridge 會失聯（chrome.* 丟 "Extension context invalidated"）：
 * 用 WXT ctx 註冊監聽，新 bridge 啟動或外掛失效時自動解除，所有外掛 API 呼叫都吞掉錯誤。
 */
export default defineContentScript({
  matches: GAME_MATCHES,
  main(ctx) {
    const post = (settings: Settings) => {
      if (ctx.isInvalid) return;
      const msg: BridgeMessage = { __msbot: true, type: 'settings', settings };
      window.postMessage(msg, location.origin);
    };
    const safe = (p: Promise<unknown>) => p.catch(() => {});

    ctx.addEventListener(window, 'message', (e: MessageEvent) => {
      if (ctx.isInvalid || e.source !== window || !isBridgeMessage(e.data)) return;
      const msg = e.data;
      if (msg.type === 'request-settings') safe(loadSettings().then(post));
      if (msg.type === 'set-settings') {
        safe(loadSettings().then((cur) => saveSettings(mergeSettings({ ...cur, ...msg.patch, bot: { ...cur.bot, ...msg.patch.bot } }))));
      }
      if (msg.type === 'reload-extension') safe(browser.runtime.sendMessage({ type: RELOAD_MESSAGE }));
    });
    safe(loadSettings().then(post));
    const unwatch = watchSettings(post);
    ctx.onInvalidated(unwatch);
  },
});
