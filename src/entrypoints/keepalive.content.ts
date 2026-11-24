import { patchRaf } from '@/core/background/raf';
import { createWorkerTicker } from '@/core/background/ticker';
import { GAME_MATCHES } from '@/core/messages';

/** 分頁在背景時的幀率（遊戲失焦時本身也會降到 unfocused_fps，預設 30） */
const BACKGROUND_FPS = 30;

export default defineContentScript({
  matches: GAME_MATCHES,
  world: 'MAIN',
  runAt: 'document_start',
  registration: 'runtime',
  main() {
    const raf = patchRaf({
      win: window,
      isHidden: () => document.visibilityState === 'hidden',
      now: () => performance.now(),
    });
    createWorkerTicker(1000 / BACKGROUND_FPS, () => raf.flush());
    (window as unknown as { __msKeepAlive: unknown }).__msKeepAlive = raf;
  },
});
