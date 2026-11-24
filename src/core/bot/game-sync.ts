import type { Keyboard } from '../input/keyboard';
import type { Pointer } from '../input/pointer';
import type { Logger } from '../log';
import type { GameToggles } from '../settings';
import type { PauseMenu } from '../vision/pause';

/**
 * 遊戲設定同步：開暫停選單 → 讀三個勾選框 → 點掉與設定不一致的 → 點「繼續」。
 * 只在 bot 判斷「對局中且安全」時開始；同步期間 bot 暫停其他行為。
 * 「隨機選擇」每局會被遊戲重設 → 每局開始（初始技能選完）重新同步。
 */
export interface GameSync {
  /** 標記需要同步（啟動、設定改變、新局開始） */
  request(): void;
  /** 每個 tick 呼叫；回傳 true 表示正在同步（bot 應暫停其他行為） */
  tick(now: number, safe: boolean): boolean;
  readonly busy: boolean;
}

export interface GameSyncDeps {
  keyboard: Keyboard;
  pointer: Pointer;
  read: () => PauseMenu | null;
  desired: () => GameToggles;
  log?: Logger;
}

const ORDER: (keyof GameToggles)[] = ['autoPick', 'holdLevels', 'holdChests'];

export function createGameSync({ keyboard, pointer, read, desired, log }: GameSyncDeps): GameSync {
  let dirty = true;
  let phase: 'idle' | 'opening' | 'adjusting' | 'closing' = 'idle';
  let phaseAt = 0;
  let lastAction = 0;
  let retries = 0;

  const anyWanted = () => ORDER.some((k) => desired()[k] !== 'keep');
  const finish = (now: number, ok: boolean) => {
    phase = 'idle';
    phaseAt = now;
    if (ok) {
      dirty = false;
      retries = 0;
    } else if (++retries >= 3) {
      dirty = false; // 連續失敗就放棄，等下次觸發
      retries = 0;
      log?.warn('game-sync: 讀不到暫停選單，放棄本次同步');
    }
  };

  return {
    request() {
      dirty = true;
    },
    get busy() {
      return phase !== 'idle';
    },
    tick(now, safe) {
      if (phase === 'idle') {
        if (!dirty || !safe || !anyWanted() || now - phaseAt < 3000) return false;
        log?.info('game-sync: 開暫停選單同步遊戲設定');
        void keyboard.tap('escape');
        phase = 'opening';
        phaseAt = now;
        lastAction = now;
        return true;
      }
      if (phase === 'opening') {
        if (now - phaseAt < 800) return true;
        phase = 'adjusting';
        phaseAt = now;
      }
      const menu = read();
      if (phase === 'adjusting') {
        if (!menu) {
          if (now - phaseAt > 2000) {
            // 讀不到：可能沒打開或不是暫停選單 → 按 Esc 關掉（若有開）並結束
            void keyboard.tap('escape');
            finish(now, false);
          }
          return true;
        }
        if (now - lastAction < 500) return true;
        const want = desired();
        const idx = ORDER.findIndex((k, i) => want[k] !== 'keep' && menu.toggles[i] && menu.toggles[i]!.checked !== (want[k] === 'on'));
        if (idx >= 0) {
          const t = menu.toggles[idx]!;
          log?.info(`game-sync: 切換 ${ORDER[idx]}`);
          void pointer.tap(t.x, t.y);
          lastAction = now;
          return true;
        }
        void pointer.tap(menu.resume.x, menu.resume.y);
        phase = 'closing';
        phaseAt = now;
        return true;
      }
      // closing：等選單關閉
      if (now - phaseAt < 800) return true;
      if (menu) {
        void pointer.tap(menu.resume.x, menu.resume.y);
        phaseAt = now;
        return true;
      }
      log?.info('game-sync: 完成');
      finish(now, true);
      return false;
    },
  };
}
