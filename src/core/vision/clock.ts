import type { Frame } from './frame';
import type { Square } from './minimap';

/**
 * 遊戲時間是否停住（MVP 入口傳送門開著時時間會停並等角色走進去；core/mvp_raid.gd state 'portal'）。
 *
 * 時鐘（「時間 mm:ss · 危險 n」）在小地圖正下方。HUD 不依畫面比例縮放，但面板內的相對位置固定 →
 * 以小地圖方框為尺（邊長 S），時鐘列在方框底邊下方 0.19S~0.31S（實機量測：座標列 0.03~0.11S、時間列 0.21~0.29S、MVP 列 0.38~0.43S）。
 * 舊做法在右上大範圍找「每秒會變的文字列」：MVP 戰的閃光透過半透明面板干擾，且座標列移動時也每秒變，會鎖錯列。
 */
export function clockGlyph(f: Frame, sq: Square): Uint8Array {
  const S = sq.x1 - sq.x0;
  const y0 = Math.round(sq.y1 + 0.19 * S);
  const y1 = Math.min(f.height, Math.round(sq.y1 + 0.31 * S));
  const w = sq.x1 - sq.x0;
  const mask = new Uint8Array(Math.max(0, y1 - y0) * w);
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * f.width + sq.x0 + x) * 4;
      // 深色字形（亮度 < 75）：面板半透明，只看字形才不受背景影響
      if (0.299 * f.data[i]! + 0.587 * f.data[i + 1]! + 0.114 * f.data[i + 2]! < 75) mask[(y - y0) * w + x] = 1;
    }
  return mask;
}

export interface FreezeDetector {
  /** 每秒左右呼叫；回傳時間是否停住 */
  update(glyph: Uint8Array | null, now: number): boolean;
  /** 最近看到時鐘在走（判斷「在對局中」） */
  readonly ticking: boolean;
}

/** 字形連續 freezeMs 不變 → 停住。必須先看過它走動（開局就停住不判定）；偶爾讀不到（方框被遮）沿用上次狀態 */
export function createFreezeDetector(freezeMs = 3000): FreezeDetector {
  let last: Uint8Array | null = null;
  let lastOn = 0;
  let changedAt = -Infinity;
  let ticked = false;
  let nowT = 0;
  let state = false;
  let seenAt = -Infinity;
  return {
    get ticking() {
      return ticked && nowT - changedAt < 10000;
    },
    update(glyph, now) {
      nowT = now;
      // 讀不到（實機：角色/首領圖示壓在小地圖下緣，方框找不到）：沿用上次結果；
      // 超過 5 秒都讀不到就當沒停住（原本用「上次變化至今」判斷，讀不到 3 秒就誤判停住）
      if (!glyph) return now - seenAt <= 5000 ? state : false;
      seenAt = now;
      let on = 0;
      for (let i = 0; i < glyph.length; i++) on += glyph[i]!;
      if (on < 10) {
        last = null;
        ticked = false;
        return (state = false);
      }
      if (last && last.length === glyph.length) {
        let d = 0;
        for (let i = 0; i < glyph.length; i++) d += glyph[i]! ^ last[i]!;
        // 實機：每秒變一位數時差異 32~115 px（字形約 820 px），10% 門檻會把部分秒數當成沒變 → 2%
        if (d > Math.max(3, Math.max(on, lastOn) * 0.02)) {
          changedAt = now;
          ticked = true;
        }
      } else {
        changedAt = now; // 第一次或版面改變：重新計時
      }
      last = glyph;
      lastOn = on;
      return (state = ticked && now - changedAt >= freezeMs);
    },
  };
}
