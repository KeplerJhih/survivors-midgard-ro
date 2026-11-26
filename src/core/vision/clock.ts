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
  /** 最後一次確認時鐘走動的時間 */
  readonly changedAt: number;
  /** 看過時鐘走動（停住是「看著它停下」的，不是一開始就停著） */
  readonly sawTick: boolean;
}

/** 字形連續 freezeMs 不變 → 停住。必須先看過它走動（開局就停住不判定）；偶爾讀不到（方框被遮）沿用上次狀態 */
/** 沒看過時鐘走動時，要連續不變這麼久才算停住 */
const UNTICKED_FREEZE_MS = 12000;

export function createFreezeDetector(freezeMs = 3000): FreezeDetector {
  let last: Uint8Array | null = null;
  let lastOn = 0;
  let changedAt = -Infinity;
  let ticked = false;
  let nowT = 0;
  let state = false;
  let seenAt = -Infinity;
  let prev2: Uint8Array | null = null;
  let lastChanged = false;
  return {
    get ticking() {
      return ticked && nowT - changedAt < 10000;
    },
    get changedAt() {
      return changedAt;
    },
    get sawTick() {
      return ticked;
    },
    update(glyph, now) {
      nowT = now;
      // 讀不到（實機：角色/首領圖示壓在小地圖下緣，方框找不到）：沿用上次結果；
      // 超過 5 秒都讀不到就當沒停住（原本用「上次變化至今」判斷，讀不到 3 秒就誤判停住）
      let on = 0;
      if (glyph) for (let i = 0; i < glyph.length; i++) on += glyph[i]!;
      // 沒有字（載入畫面、視窗遮住）也當讀不到，不重置「看過走動」：
      // 實機：進 MVP 巢穴的載入畫面把狀態清掉，之後時鐘一直停在 11:00 → 永遠判定不出停住 → 勝利後不知道在巢穴裡
      if (!glyph || on < 10) return now - seenAt <= 5000 ? state : false;
      seenAt = now;
      const diff = (a: Uint8Array) => {
        let d = 0;
        for (let i = 0; i < glyph.length; i++) d += glyph[i]! ^ a[i]!;
        // 實機：每秒變一位數時差異 32~115 px（字形約 820 px），10% 門檻會把部分秒數當成沒變 → 2%
        return d > Math.max(3, Math.max(on, lastOn) * 0.02);
      };
      if (last && last.length === glyph.length) {
        // 連續兩筆都在變、且不是變回前前一筆，才算走動（時鐘在走時每筆都是新的秒數）。
        // 實機巢穴內：傷害數字閃過時鐘一筆就變回原樣（差異 146 px）；首領圖示 / 特效蓋住一角好幾秒
        // （差異 48 px，出現、消失各變一次）→ 都只是單次變化，原本被當成走動 → 「停住」中斷 3 秒
        const changed = diff(last) && !(prev2 && prev2.length === glyph.length && !diff(prev2));
        if (changed && lastChanged) {
          changedAt = now;
          ticked = true;
        }
        lastChanged = changed;
        prev2 = last;
      } else {
        // 第一次：開始計時；長度不同（方框由上下邊找到 / 由單邊推算，寬差幾 px）：只換參考字形，不重新計時
        // （實機：入口開著時兩種方式交替 → 每次都重置 → 「停住」閃動）
        if (!last) changedAt = now;
        prev2 = null;
        lastChanged = false;
      }
      last = glyph;
      lastOn = on;
      // 沒看過走動但讀得到時鐘、一直停著很久 → 也算停住（實機：入口開著時重新載入外掛 →
      // 永遠判定不出停住，把入口當一般畫面走位，入口指示器也不理）。門檻放長，避免剛開局的短暫停頓
      return (state = now - changedAt >= (ticked ? freezeMs : UNTICKED_FREEZE_MS));
    },
  };
}
