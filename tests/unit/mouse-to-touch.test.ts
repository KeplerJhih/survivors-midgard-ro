import { describe, expect, it } from 'vitest';
import { installMouseToTouch, type TouchEventFactory } from '@/core/touch/mouse-to-touch';

function setup() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const made: string[] = [];
  const factory: TouchEventFactory = (type, _t, x, y) => {
    made.push(`${type}@${x},${y}`);
    return new Event(type);
  };
  const gameMouse: string[] = [];
  canvas.addEventListener('mousedown', () => gameMouse.push('mousedown'));
  const uninstall = installMouseToTouch(canvas, window, factory);
  const mouse = (type: string, x: number, y: number, target: EventTarget = canvas) =>
    target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
  return { canvas, made, gameMouse, uninstall, mouse };
}

describe('installMouseToTouch', () => {
  it('滑鼠拖曳轉成 touchstart → touchmove → touchend', () => {
    const { made, mouse, uninstall } = setup();
    mouse('mousedown', 10, 20);
    mouse('mousemove', 15, 25);
    mouse('mouseup', 15, 25);
    expect(made).toEqual(['touchstart@10,20', 'touchmove@15,25', 'touchend@15,25']);
    uninstall();
  });

  it('原本的滑鼠事件不再送到遊戲', () => {
    const { gameMouse, mouse, uninstall } = setup();
    mouse('mousedown', 1, 1);
    expect(gameMouse).toEqual([]);
    uninstall();
  });

  it('沒按下時的 mousemove 不轉換', () => {
    const { made, mouse, uninstall } = setup();
    mouse('mousemove', 5, 5);
    expect(made).toEqual([]);
    uninstall();
  });

  it('解除安裝後恢復原本行為', () => {
    const { made, gameMouse, mouse, uninstall } = setup();
    uninstall();
    mouse('mousedown', 1, 1);
    expect(made).toEqual([]);
    expect(gameMouse).toEqual(['mousedown']);
  });
});
