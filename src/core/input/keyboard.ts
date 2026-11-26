import { KEYS, type KeyName } from '../keys';

export interface Keyboard {
  /** 按下並保持；已按住則忽略，但距上次送出 ≥ REPEAT_MS 會補送一次 keydown（見 down） */
  down(name: KeyName): void;
  /** 放開；沒按住則忽略 */
  up(name: KeyName): void;
  /** 按下 holdMs 後放開 */
  tap(name: KeyName, holdMs?: number): Promise<void>;
  held(): ReadonlySet<KeyName>;
  releaseAll(): void;
}

export interface KeyboardOptions {
  sleep?: (ms: number) => Promise<void>;
  onSend?: (type: 'keydown' | 'keyup', name: KeyName) => void;
  now?: () => number;
}

/** 按住的鍵每隔這麼久補送 keydown（像實體鍵盤的自動重複） */
export const REPEAT_MS = 500;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 對 target（遊戲 canvas）送合成 KeyboardEvent。遊戲不檢查 isTrusted（已實測）。 */
export function createKeyboard(target: EventTarget, opts: KeyboardOptions = {}): Keyboard {
  const sleep = opts.sleep ?? defaultSleep;
  const held = new Set<KeyName>();
  const now = opts.now ?? (() => performance.now());
  const sentAt = new Map<KeyName, number>();

  const send = (type: 'keydown' | 'keyup', name: KeyName) => {
    const k = KEYS[name];
    target.dispatchEvent(
      new KeyboardEvent(type, {
        key: k.key,
        code: k.code,
        keyCode: k.keyCode,
        which: k.keyCode,
        bubbles: true,
        cancelable: true,
      }),
    );
    opts.onSend?.(type, name);
  };

  const kb: Keyboard = {
    down(name) {
      // 已按住：遊戲可能已自行放開（失焦、暫停視窗時 Godot 會清掉按鍵狀態），我們卻以為還按著、不再送 →
      // 角色停住不動（實機：巢穴裡一直「按著上」卻原地不動）。像實體鍵盤一樣定期補送 keydown
      if (held.has(name)) {
        if (now() - (sentAt.get(name) ?? -Infinity) < REPEAT_MS) return;
      }
      held.add(name);
      sentAt.set(name, now());
      send('keydown', name);
    },
    up(name) {
      if (!held.delete(name)) return;
      send('keyup', name);
    },
    async tap(name, holdMs = 60) {
      kb.down(name);
      await sleep(holdMs);
      kb.up(name);
    },
    held: () => held,
    releaseAll() {
      for (const name of [...held]) kb.up(name);
    },
  };
  return kb;
}
