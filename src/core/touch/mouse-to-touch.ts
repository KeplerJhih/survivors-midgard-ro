export type TouchType = 'touchstart' | 'touchmove' | 'touchend';
export type TouchEventFactory = (type: TouchType, target: Element, x: number, y: number) => Event;

/** 用瀏覽器原生的 Touch / TouchEvent 建立單指觸控事件 */
export const nativeTouchFactory: TouchEventFactory = (type, target, x, y) => {
  const touch = new Touch({
    identifier: 1,
    target,
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    screenX: x,
    screenY: y,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  });
  const active = type === 'touchend' ? [] : [touch];
  return new TouchEvent(type, {
    touches: active,
    targetTouches: active,
    changedTouches: [touch],
    bubbles: true,
    cancelable: true,
  });
};

/**
 * 手機模式下，把在 canvas 上的滑鼠左鍵拖曳轉成單指觸控，才能操作虛擬搖桿與觸控 UI。
 * 在 window 的 capture 階段攔截，原本的滑鼠事件不會再送到遊戲（避免重複輸入）。
 * 回傳解除安裝的函式。
 */
export function installMouseToTouch(
  canvas: Element,
  win: Window,
  make: TouchEventFactory = nativeTouchFactory,
): () => void {
  let dragging = false;

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0 || e.target !== canvas) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    dragging = true;
    canvas.dispatchEvent(make('touchstart', canvas, e.clientX, e.clientY));
  };
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    e.stopImmediatePropagation();
    canvas.dispatchEvent(make('touchmove', canvas, e.clientX, e.clientY));
  };
  const onUp = (e: MouseEvent) => {
    if (!dragging || e.button !== 0) return;
    e.stopImmediatePropagation();
    dragging = false;
    canvas.dispatchEvent(make('touchend', canvas, e.clientX, e.clientY));
  };

  win.addEventListener('mousedown', onDown, true);
  win.addEventListener('mousemove', onMove, true);
  win.addEventListener('mouseup', onUp, true);
  return () => {
    win.removeEventListener('mousedown', onDown, true);
    win.removeEventListener('mousemove', onMove, true);
    win.removeEventListener('mouseup', onUp, true);
  };
}
