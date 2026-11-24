export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

/** 被改寫的 media query（比對時去掉空白、轉小寫） */
const MEDIA_OVERRIDES: Record<string, boolean> = {
  '(pointer:coarse)': true,
  '(pointer:fine)': false,
  '(any-pointer:coarse)': true,
  '(any-pointer:fine)': false,
  '(hover:none)': true,
  '(hover:hover)': false,
};

function defineGetter(obj: object, prop: string, value: unknown) {
  Object.defineProperty(obj, prop, { get: () => value, configurable: true });
}

function fakeMediaQueryList(media: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  } as MediaQueryList;
}

/**
 * 偽裝成 iPhone。必須在頁面腳本之前（document_start）執行。
 * - 頁面殼的 iOS 判斷：/iPhone|iPad|iPod/.test(navigator.userAgent)
 * - Godot 的 OS.has_feature('web_ios') 也是看 UA
 * - 遊戲觸控判斷（core/mouse_walk.gd）：matchMedia('(pointer: coarse)')
 * - standalone=true：跳過「加入主畫面」提示（core/web_host.gd _home_hint）
 */
export function applyMobileSpoof(win: Window, ua = IPHONE_UA): void {
  const nav = win.navigator;
  defineGetter(nav, 'userAgent', ua);
  defineGetter(nav, 'appVersion', ua.replace(/^Mozilla\//, ''));
  defineGetter(nav, 'platform', 'iPhone');
  defineGetter(nav, 'vendor', 'Apple Computer, Inc.');
  defineGetter(nav, 'maxTouchPoints', 5);
  defineGetter(nav, 'standalone', true);

  const original = typeof win.matchMedia === 'function' ? win.matchMedia.bind(win) : null;
  win.matchMedia = (query: string) => {
    const key = query.replace(/\s+/g, '').toLowerCase();
    if (key in MEDIA_OVERRIDES) return fakeMediaQueryList(query, MEDIA_OVERRIDES[key]!);
    return original ? original(query) : fakeMediaQueryList(query, false);
  };

  if (!('ontouchstart' in win)) (win as unknown as Record<string, unknown>).ontouchstart = null;
}
