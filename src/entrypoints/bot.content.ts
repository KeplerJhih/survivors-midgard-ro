import { createWorkerTicker } from '@/core/background/ticker';
import { createBot } from '@/core/bot/bot';
import { createOverlay } from '@/core/debug/overlay';
import { createKeyboard } from '@/core/input/keyboard';
import { createLogger } from '@/core/log';
import { GAME_MATCHES, isBridgeMessage, type BridgeMessage } from '@/core/messages';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '@/core/settings';
import { installMouseToTouch } from '@/core/touch/mouse-to-touch';

const TICK_MS = 50;

export default defineContentScript({
  matches: GAME_MATCHES,
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;

    let settings: Settings = DEFAULT_SETTINGS;
    const log = createLogger(() => settings.debug);
    const keyboard = createKeyboard(canvas, { onSend: (type, name) => log.debug(type, name) });
    const bot = createBot(settings.bot, { keyboard, now: () => performance.now(), log });
    const overlay = createOverlay(document);
    let removeTouch: (() => void) | null = null;

    const apply = (next: Settings) => {
      settings = next;
      bot.update(next.bot);
      overlay.setVisible(next.debug);
      // 只有真的偽裝成手機（遊戲進入觸控模式）時才需要滑鼠轉觸控
      const wantTouch = next.mobile && next.touchBridge && /iPhone/.test(navigator.userAgent);
      if (wantTouch && !removeTouch) removeTouch = installMouseToTouch(canvas, window);
      if (!wantTouch && removeTouch) {
        removeTouch();
        removeTouch = null;
      }
      log.info('settings applied', next);
    };

    let received = false;
    window.addEventListener('message', (e) => {
      if (e.source !== window || !isBridgeMessage(e.data)) return;
      if (e.data.type === 'settings') {
        received = true;
        apply(mergeSettings(e.data.settings));
      }
    });
    // bridge（ISOLATED world）與本腳本的載入順序不固定，請求可能在對方開始監聽前送出而遺失：
    // 收到第一份設定前持續重送（實測：重新整理後掛機一直停在預設的停用狀態）
    const req: BridgeMessage = { __msbot: true, type: 'request-settings' };
    const requestSettings = () => {
      if (received) return;
      window.postMessage(req, location.origin);
      setTimeout(requestSettings, 500);
    };
    requestSettings();

    createWorkerTicker(TICK_MS, () => {
      bot.tick();
      overlay.render({
        bot: bot.state.running ? 'ON' : 'off',
        visibility: document.visibilityState,
        dirs: bot.state.dirs.join('+') || '-',
        ticks: bot.state.ticks,
        picks: bot.state.picks,
        enters: bot.state.enters,
        touch: removeTouch ? 'bridge' : '-',
      });
    });

    // DevTools 除錯用：__msbot.bot.state、__msbot.apply({...})
    (window as unknown as { __msbot: unknown }).__msbot = {
      bot,
      keyboard,
      apply,
      get settings() {
        return settings;
      },
    };
  },
});
