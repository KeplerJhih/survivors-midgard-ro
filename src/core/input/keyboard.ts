import { KEYS, type KeyName } from '../keys';

export interface Keyboard {
  /** 按下並保持；已按住則忽略（不送重複 keydown） */
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
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 對 target（遊戲 canvas）送合成 KeyboardEvent。遊戲不檢查 isTrusted（已實測）。 */
export function createKeyboard(target: EventTarget, opts: KeyboardOptions = {}): Keyboard {
  const sleep = opts.sleep ?? defaultSleep;
  const held = new Set<KeyName>();

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
      if (held.has(name)) return;
      held.add(name);
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
