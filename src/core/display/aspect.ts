/**
 * 鎖定遊戲畫面比例：不管瀏覽器視窗是什麼形狀，遊戲一律以固定比例繪製（多出來的地方留黑邊）。
 *
 * 為什麼：畫面辨識的門檻都是「佔畫面寬高的比例」。遊戲（Godot）在視窗比 16:9 寬時依高度縮放 UI、
 * 比 16:9 窄時依寬度縮放 → 視窗形狀一變，每顆按鈕、面板的相對大小與位置都跟著變，
 * 逐條規則去補永遠補不完（實機 1080×906：選地圖、結算頁、HP 條全部失準）。
 * 把比例固定住，所有人看到的版面就只有一種。
 *
 * 怎麼做：Godot 網頁版每一幀讀 window.innerWidth / innerHeight 決定畫布大小，並把畫布釘在 (0,0)
 * → 改寫這兩個屬性回傳「塞得進視窗的最大固定比例矩形」，再用樣式把畫布移到正中間。
 * 遊戲進行中直接套用即可（實機：下一幀就切換），不用重新整理；要在 MAIN world 執行。
 * 只在掛機啟動時鎖定，停止就還原，手動玩不受影響。
 */

/** 外掛實機調校、驗證最久的視窗比例（約 1568×713，也接近手機橫向） */
export const LOCKED_ASPECT = 2.2;

/**
 * 鎖定時畫布的實際像素寬度（＝調校用視窗 1568 CSS px × DPR 2）。
 * 只鎖比例不夠：視窗小，畫布像素就少，文字筆畫變細，縮圖後與黑外框混色
 * （實機 1079 寬：「返回地圖」名稱縮到 640 後沒有任何原色像素 → 認不出出口，角色卡在巢穴）。
 * Godot 以 innerWidth × devicePixelRatio 決定畫布像素 → 一併改寫 devicePixelRatio，
 * 讓畫布像素固定（實機：1079 寬視窗的畫布由 2158 變 3136，版面不變）。
 */
export const RENDER_WIDTH = 3136;

export interface Box {
  width: number;
  height: number;
  left: number;
  top: number;
}

/** 在 w×h 的視窗內放得下、比例為 ratio 的最大矩形（置中） */
export function fitAspect(w: number, h: number, ratio = LOCKED_ASPECT): Box {
  const width = Math.max(1, Math.min(w, Math.round(h * ratio)));
  const height = Math.max(1, Math.min(h, Math.round(width / ratio)));
  return { width, height, left: Math.round((w - width) / 2), top: Math.round((h - height) / 2) };
}

/** 套用鎖定；回傳的函式會還原成滿版（停止掛機時呼叫） */
export function applyAspectLock(win: Window, ratio = LOCKED_ASPECT): () => void {
  const doc = win.document;
  const origW = Object.getOwnPropertyDescriptor(win, 'innerWidth');
  const origH = Object.getOwnPropertyDescriptor(win, 'innerHeight');
  const box = () => fitAspect(origW?.get?.call(win) ?? doc.documentElement.clientWidth, origH?.get?.call(win) ?? doc.documentElement.clientHeight, ratio);
  Object.defineProperty(win, 'innerWidth', { get: () => box().width, configurable: true });
  Object.defineProperty(win, 'innerHeight', { get: () => box().height, configurable: true });
  const origDpr = Object.getOwnPropertyDescriptor(win, 'devicePixelRatio');
  Object.defineProperty(win, 'devicePixelRatio', { get: () => RENDER_WIDTH / box().width, configurable: true });

  const style = doc.createElement('style');
  const place = () => {
    const b = box();
    // Godot 每幀把畫布寫成 top:0; left:0 → 用 !important 蓋過
    style.textContent = `canvas{top:${b.top}px !important;left:${b.left}px !important}html,body{background:#000 !important}`;
  };
  place();
  (doc.head ?? doc.documentElement).appendChild(style);
  win.addEventListener('resize', place);
  return () => {
    win.removeEventListener('resize', place);
    style.remove();
    if (origW) Object.defineProperty(win, 'innerWidth', origW);
    if (origH) Object.defineProperty(win, 'innerHeight', origH);
    if (origDpr) Object.defineProperty(win, 'devicePixelRatio', origDpr);
  };
}
