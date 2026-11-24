import { createWorkerTicker } from '@/core/background/ticker';
import { createBot } from '@/core/bot/bot';
import { createGameSync } from '@/core/bot/game-sync';
import { readPauseMenu } from '@/core/vision/pause';
import { createOverlay } from '@/core/debug/overlay';
import { createKeyboard } from '@/core/input/keyboard';
import { createPointer } from '@/core/input/pointer';
import { createLogger } from '@/core/log';
import { GAME_MATCHES, isBridgeMessage, type BridgeMessage } from '@/core/messages';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '@/core/settings';
import { installMouseToTouch } from '@/core/touch/mouse-to-touch';
import { createCanvasSampler, createCanvasSamplerByHeight } from '@/core/vision/frame';
import { findObjects, SAMPLE_HEIGHT } from '@/core/vision/objects';
import { scanPortals } from '@/core/vision/portal';
import { detectScreen } from '@/core/vision/screens';
import { parseLayout } from '@/core/vision/layout';
import { decideByLayout } from '@/core/vision/ui-rules';
import { findIndicators } from '@/core/vision/indicators';
import { approachSwirl, fleeSwirl, probeDanger } from '@/core/vision/danger';
import { textBands } from '@/core/vision/clock';
import { bossFight, readHp } from '@/core/vision/hud';

const TICK_MS = 50;

interface BotHandle {
  dispose(): void;
}

export default defineContentScript({
  matches: GAME_MATCHES,
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    // 外掛重新載入後會把本腳本再注入一次（不刷新網頁）：先清掉舊版實例
    const g = window as unknown as { __msbot?: BotHandle };
    g.__msbot?.dispose();

    let settings: Settings = DEFAULT_SETTINGS;
    const log = createLogger(() => settings.debug);
    const keyboard = createKeyboard(canvas, { onSend: (type, name) => log.debug(type, name) });
    const sample = createCanvasSampler(canvas);
    // 指示器圓盤較小，用較高解析度取樣
    const sampleHi = createCanvasSampler(canvas, 320);
    // UI 結構解析需要較高解析度（按鈕外框 1~2px）
    const sampleUI = createCanvasSampler(canvas, 640);
    const sampleObj = createCanvasSamplerByHeight(canvas, SAMPLE_HEIGHT);
    const pointer = createPointer(canvas, () => /iPhone/.test(navigator.userAgent));
    const gameSync = createGameSync({
      keyboard,
      pointer,
      read: () => {
        const frame = sampleUI();
        return frame ? readPauseMenu(frame, parseLayout(frame)) : null;
      },
      desired: () => settings.game,
      log,
    });
    const bot = createBot(settings.bot, {
      keyboard,
      gameSync,
      now: () => performance.now(),
      scanPortals: () => {
        const frame = sample();
        return frame ? scanPortals(frame) : null;
      },
      detectScreen: () => {
        const frame = sampleUI();
        if (!frame) return null;
        // 結構判斷優先；舊顏色規則只保留特徵獨特的「結算頁」「腐化寶箱」
        // （實機：城鎮明亮石板地讓舊「初始技能」規則把屋頂當成色帶、在城鎮亂點）
        const regions = parseLayout(frame);
        const structural = decideByLayout(frame, regions);
        if (structural) return structural;
        // 保險：停在暫停選單（同步失敗、誤按 Esc）→ 點「繼續」（同步中 bot 不會呼叫這裡）
        const pause = readPauseMenu(frame, regions);
        if (pause) return { kind: 'pause', ...pause.resume };
        const legacy = detectScreen(frame);
        return legacy && (legacy.kind === 'result' || legacy.kind === 'corrupt') ? legacy : null;
      },
      findIndicators: () => {
        const frame = sampleHi();
        return frame ? findIndicators(frame) : null;
      },
      probeDanger: () => {
        const frame = sample();
        return frame ? probeDanger(frame) : null;
      },
      clockBands: () => {
        const frame = sampleUI();
        return frame ? textBands(frame) : null;
      },
      approachSwirl: () => {
        const frame = sample();
        return frame ? approachSwirl(frame) : null;
      },
      fleeSwirl: () => {
        const frame = sample();
        return frame ? fleeSwirl(frame) : null;
      },
      findObjects: () => {
        const frame = sampleObj();
        return frame ? findObjects(frame, 0.8) : null;
      },
      bossFight: () => {
        const frame = sampleHi();
        return frame ? bossFight(frame) : false;
      },
      readHp: () => {
        const frame = sampleHi();
        return frame ? readHp(frame) : null;
      },
      pointer,
      log,
    });
    const overlay = createOverlay(document);
    let removeTouch: (() => void) | null = null;

    const apply = (next: Settings) => {
      if (JSON.stringify(next.game) !== JSON.stringify(settings.game)) gameSync.request();
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
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || !isBridgeMessage(e.data)) return;
      if (e.data.type === 'settings') {
        received = true;
        apply(mergeSettings(e.data.settings));
      }
    };
    window.addEventListener('message', onMessage);
    // bridge（ISOLATED world）與本腳本的載入順序不固定，請求可能在對方開始監聽前送出而遺失：
    // 收到第一份設定前持續重送（實測：重新整理後掛機一直停在預設的停用狀態）
    const req: BridgeMessage = { __msbot: true, type: 'request-settings' };
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    const requestSettings = () => {
      if (received) return;
      window.postMessage(req, location.origin);
      requestTimer = setTimeout(requestSettings, 500);
    };
    requestSettings();

    const ticker = createWorkerTicker(TICK_MS, () => {
      bot.tick();
      overlay.render({
        bot: bot.state.running ? 'ON' : 'off',
        activity: bot.state.activity,
        visibility: document.visibilityState,
        dirs: bot.state.dirs.join('+') || '-',
        ticks: bot.state.ticks,
        scans: bot.state.scans,
        screen: `${bot.state.lastScreen} ×${bot.state.screenTaps}`,
        dodges: bot.state.dodges,
        hp: bot.state.hp,
        boss: bot.state.boss,
        frozen: bot.state.frozen,
        picks: bot.state.picks,
        touch: removeTouch ? 'bridge' : '-',
      });
    });

    // DevTools 除錯用：__msbot.bot.state、__msbot.apply({...})
    g.__msbot = {
      bot,
      keyboard,
      apply,
      get settings() {
        return settings;
      },
      /** DevTools：__msbot.saveSettings({ bot: { mode: 'flower' } }) → 寫入儲存設定（等同在 popup 修改） */
      saveSettings(patch: Extract<BridgeMessage, { type: 'set-settings' }>['patch']) {
        const msg: BridgeMessage = { __msbot: true, type: 'set-settings', patch };
        window.postMessage(msg, location.origin);
      },
      /** DevTools：__msbot.reloadExtension() → 載入最新 build 並重新注入（不刷新遊戲） */
      reloadExtension() {
        const msg: BridgeMessage = { __msbot: true, type: 'reload-extension' };
        window.postMessage(msg, location.origin);
      },
      dispose() {
        ticker.stop();
        clearTimeout(requestTimer);
        window.removeEventListener('message', onMessage);
        keyboard.releaseAll();
        removeTouch?.();
        overlay.remove();
      },
    } as BotHandle;
    log.info('bot 已啟動');
  },
});
