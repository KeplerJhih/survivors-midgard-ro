import type { Frame } from './frame';

/**
 * 讀左上「基本資訊」視窗的 HP 條（ui/ro_basic_window.gd _gauge）：
 * - 填滿色 GAUGE_BLUE (0.33,0.55,0.95)；HP < 25% 時改為 GAUGE_RED (0.92,0.3,0.38)
 * - HP 條在 SP、EXP 條上方 → 取左上區域最上面那條
 * 實機（978×685）：HP 條約 x 91~153、y 26，滿血時藍色填滿整條。
 * 空條（軌道）的顏色不穩定，用 EXP 條驗證「量軌道長度」算出 0.77（實際 0.555）→ 改用「看過的最長填滿長度」當滿血長度
 */
const BLUE: [number, number, number] = [84, 140, 242];
const RED: [number, number, number] = [235, 77, 97];

const near = (r: number, g: number, b: number, c: [number, number, number], tol = 40) =>
  (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2 <= tol * tol;
export interface HpReading {
  /** 填滿長度（像素），比例由 createHpTracker 依看過的最長長度換算 */
  fill: number;
  /** HP 條變紅（< 25%） */
  low: boolean;
  /** 所在列（0~1）；供 tracker 排除下方其他條（SP、經驗） */
  y?: number;
}

export function readHp(f: Frame): HpReading | null {
  const { width: W, height: H, data } = f;
  const x1 = Math.ceil(0.22 * W);
  const y1 = Math.ceil(0.12 * H);
  for (let y = 0; y < y1; y++) {
    let best: { start: number; end: number; red: boolean } | null = null;
    let runStart = -1;
    let runRed = false;
    for (let x = 0; x <= x1; x++) {
      const i = (y * W + x) * 4;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      const blue = x < x1 && near(r, g, b, BLUE);
      const red = x < x1 && near(r, g, b, RED);
      if (blue || red) {
        if (runStart < 0) {
          runStart = x;
          runRed = red;
        }
      } else if (runStart >= 0) {
        if (!best || x - runStart > best.end - best.start + 1) best = { start: runStart, end: x - 1, red: runRed };
        runStart = -1;
      }
    }
    if (!best || best.end - best.start + 1 < Math.max(2, 0.008 * W)) continue;
    return { fill: best.end - best.start + 1, low: best.red, y: y / H };
  }
  return null;
}

export interface HpTracker {
  /** 回傳 0~1 的 HP 比例；讀不到時 null */
  update(reading: HpReading | null): { ratio: number; low: boolean } | null;
}

/** 以看過的最長填滿長度當滿血長度（開局通常滿血）；視窗大小改變導致更長時自動更新 */
export function createHpTracker(): HpTracker {
  let full = 0;
  let hpY = Infinity;
  return {
    update(r) {
      if (!r) return null;
      // HP 是最上面那條；讀到比看過的 HP 列更下面的條 = HP 條這一刻沒抓到、抓到經驗條
      // （實機：滿血卻讀成 0.2 = 經驗 23%，誤觸低血量撤退）→ 當讀不到
      if (r.y !== undefined) {
        if (r.y > hpY + 0.012) return null;
        hpY = Math.min(hpY, r.y);
      }
      full = Math.max(full, r.fill);
      return { ratio: full ? r.fill / full : 1, low: r.low };
    },
  };
}

/**
 * 首領 / MVP 戰：畫面上方中央的血條面板（「首領 · X」「MVP · X」）。
 * 實機取樣（2026-11-25，Baphomet）：血條粉紅 (237,107,140)，位於 y≈0.04H、x 0.38~0.62W；320px 寬約 220 點。
 */
const BOSS_BAR: [number, number, number] = [237, 107, 140];

/** 進入首領戰的門檻（血條像素占畫面比例）；已在首領戰中則降到 BOSS_STAY（血條剩很少時仍算首領戰） */
export const BOSS_ENTER = 0.0015;
export const BOSS_STAY = 0.0002;

export function bossFight(f: Frame): boolean {
  return bossBar(f) >= BOSS_ENTER;
}

/** 首領血條剩餘量（血條像素占畫面比例，不設門檻） */
export function bossBar(f: Frame): number {
  const { width: W, height: H, data } = f;
  let n = 0;
  for (let y = 0; y < Math.ceil(0.1 * H); y++) {
    for (let x = Math.floor(0.3 * W); x < Math.ceil(0.7 * W); x++) {
      const i = (y * W + x) * 4;
      if (near(data[i]!, data[i + 1]!, data[i + 2]!, BOSS_BAR, 35)) n++;
    }
  }
  return n / (W * H);
}

/**
 * 首領戰是否「沒在打」：血條連續 stallMs 沒有下降（實機：Thief Bug Egg 在畫面外，
 * 大圈風箏繞著起點轉、一直打不到，血量停在 100% 超過一分鐘）→ 改回一般走位去找它。
 * 血條一開始下降就恢復風箏。
 * 雙門檻：≥ BOSS_ENTER 才進入首領戰，之後 ≥ BOSS_STAY 就維持（實機：MVP 剩 25% 時血條像素低於進入門檻，被當成沒首領、跑去追指示器）。
 */
export function createBossTracker(stallMs = 15000) {
  let best = Infinity;
  let progressAt = 0;
  return {
    update(bar: number, now: number): { boss: boolean; stalled: boolean } {
      const inFight = best !== Infinity;
      if (bar < (inFight ? BOSS_STAY : BOSS_ENTER)) {
        best = Infinity;
        return { boss: false, stalled: false };
      }
      if (best === Infinity || bar < best * 0.97) {
        best = Math.min(best, bar);
        progressAt = now;
      }
      return { boss: true, stalled: now - progressAt >= stallMs };
    },
  };
}
