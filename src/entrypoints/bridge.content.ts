import { GAME_MATCHES, isBridgeMessage, type BridgeMessage } from '@/core/messages';
import type { Settings } from '@/core/settings';
import { loadSettings, watchSettings } from '@/utils/settings-store';

/** ISOLATED world：把 chrome.storage 的設定轉送給 MAIN world 的 bot */
export default defineContentScript({
  matches: GAME_MATCHES,
  main() {
    const post = (settings: Settings) => {
      const msg: BridgeMessage = { __msbot: true, type: 'settings', settings };
      window.postMessage(msg, location.origin);
    };
    window.addEventListener('message', (e) => {
      if (e.source !== window || !isBridgeMessage(e.data)) return;
      if (e.data.type === 'request-settings') loadSettings().then(post);
    });
    loadSettings().then(post);
    watchSettings(post);
  },
});
