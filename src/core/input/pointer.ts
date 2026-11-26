export interface Pointer {
  /** 點擊畫面上的位置（0~1，相對 canvas） */
  tap(x: number, y: number): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 對遊戲 canvas 送合成點擊。觸控模式（偽裝手機）送 TouchEvent，否則送滑鼠事件。
 * 實測：遊戲接受合成 TouchEvent 點擊 UI 按鈕（結算頁「再玩一次」）。
 */
export function createPointer(canvas: HTMLElement, isTouch: () => boolean): Pointer {
  return {
    async tap(fx, fy) {
      const r = canvas.getBoundingClientRect();
      const x = r.left + fx * r.width;
      const y = r.top + fy * r.height;
      if (isTouch()) {
        const make = (type: 'touchstart' | 'touchend') => {
          const t = new Touch({ identifier: 7, target: canvas, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y, radiusX: 1, radiusY: 1, force: 1 });
          const active = type === 'touchend' ? [] : [t];
          return new TouchEvent(type, { touches: active, targetTouches: active, changedTouches: [t], bubbles: true, cancelable: true });
        };
        canvas.dispatchEvent(make('touchstart'));
        await sleep(80);
        canvas.dispatchEvent(make('touchend'));
      } else {
        const opts = { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true };
        canvas.dispatchEvent(new MouseEvent('mousemove', opts));
        canvas.dispatchEvent(new MouseEvent('mousedown', opts));
        await sleep(80);
        canvas.dispatchEvent(new MouseEvent('mouseup', opts));
        // 滑鼠停在剛點的位置會跳出說明框（實機：結算頁物品格的物品說明蓋住畫面 → 認不出物品格，帶回物品中斷）
        // → 點完移到畫面最上緣中央（沒有 UI 的地方）
        await sleep(30);
        const park = { clientX: r.left + 0.5 * r.width, clientY: r.top + 1, bubbles: true, cancelable: true };
        canvas.dispatchEvent(new MouseEvent('mousemove', park));
      }
    },
  };
}
