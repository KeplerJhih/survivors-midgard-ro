import { describe, expect, it } from 'vitest';
import { createKeyboard } from '@/core/input/keyboard';

function setup() {
  const target = new EventTarget();
  const events: { type: string; key: string; code: string; keyCode: number }[] = [];
  for (const type of ['keydown', 'keyup']) {
    target.addEventListener(type, (e) => {
      const k = e as KeyboardEvent;
      events.push({ type, key: k.key, code: k.code, keyCode: k.keyCode });
    });
  }
  const kb = createKeyboard(target, { sleep: async () => {} });
  return { kb, events };
}

describe('keyboard', () => {
  it('送出帶 key / code / keyCode 的事件（遊戲 InputMap 用 physical code）', () => {
    const { kb, events } = setup();
    kb.down('up');
    expect(events).toEqual([{ type: 'keydown', key: 'w', code: 'KeyW', keyCode: 87 }]);
  });

  it('重複 down 不重送，沒按住的 up 不送', () => {
    const { kb, events } = setup();
    kb.down('left');
    kb.down('left');
    kb.up('right');
    expect(events.map((e) => e.type)).toEqual(['keydown']);
  });

  it('按住超過 REPEAT_MS 再 down → 補送 keydown（遊戲自行放開按鍵後還能恢復）', () => {
    const target = new EventTarget();
    const types: string[] = [];
    target.addEventListener('keydown', () => types.push('keydown'));
    let t = 0;
    const kb = createKeyboard(target, { sleep: async () => {}, now: () => t });
    kb.down('up');
    t = 200;
    kb.down('up');
    expect(types).toEqual(['keydown']);
    t = 700;
    kb.down('up');
    expect(types).toEqual(['keydown', 'keydown']);
  });

  it('tap = keydown + keyup', async () => {
    const { kb, events } = setup();
    await kb.tap('pick1');
    expect(events.map((e) => `${e.type}:${e.code}`)).toEqual(['keydown:Digit1', 'keyup:Digit1']);
    expect(kb.held().size).toBe(0);
  });

  it('releaseAll 放開所有按住的鍵', () => {
    const { kb, events } = setup();
    kb.down('up');
    kb.down('right');
    kb.releaseAll();
    expect(events.filter((e) => e.type === 'keyup').map((e) => e.code).sort()).toEqual(['KeyD', 'KeyW']);
    expect(kb.held().size).toBe(0);
  });
});
