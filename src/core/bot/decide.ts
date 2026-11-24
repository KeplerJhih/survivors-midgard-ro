import type { Dir } from '../movement/directions';
import { dodge, type DangerProbes } from '../vision/danger';

export type Activity = 'patrol' | 'portal' | 'target' | 'object' | 'enter' | 'dodge' | 'retreat' | 'kite' | 'flee';

/** 本 tick 的感知結果（由 bot.ts 依節流取樣得來） */
export interface Perception {
  /** 走向返回地圖/城鎮傳送門的方向 */
  portal: Dir[] | null;
  /** 走向指示器目標的方向 */
  target: Dir[] | null;
  /** 走向畫面內物件（木箱/鐵箱）的方向 */
  object?: Dir[] | null;
  /** 遠離催眠師螺旋的方向 */
  flee: Dir[] | null;
  danger: DangerProbes | null;
  lowHp: boolean;
  boss: boolean;
  /** 遊戲時間停住（且無視窗）：MVP 入口傳送門開著，等角色走進去 */
  frozen?: boolean;
  /** 時間停住時走向粉紫光圈（入口傳送門）的方向 */
  approach?: Dir[] | null;
}

export interface Patterns {
  patrol: Dir[];
  retreat: Dir[];
  kite: Dir[];
}

export interface Decision {
  activity: Activity;
  want: Dir[];
}

/**
 * 移動決策（純函式）。優先順序：
 * 1. 傳送門（出口/城鎮）
 * 2. 時間停住（MVP 入口開著）且非首領戰：走向粉紫光圈（入口），看不到就一般走位掃；不追目標、不逃螺旋
 * 3. 指示器目標，其次畫面內物件（低血量、首領戰時都不追）
 * 3. 基本走位：低血量 → 大圈撤退；首領戰 → 大圈風箏；否則一般走位
 * 4. 催眠師螺旋太近 → 反方向逃（傳送門導航時不理）
 * 5. 紅色預警框 → 最後修正成安全方向
 */
export function decide(p: Perception, pat: Patterns): Decision {
  let activity: Activity;
  let want: Dir[];
  const entering = !!p.frozen && !p.boss;
  if (p.portal) {
    activity = 'portal';
    want = p.portal;
  } else if (entering) {
    activity = p.approach ? 'enter' : 'patrol';
    want = p.approach ?? pat.patrol;
  } else if (p.target && !p.lowHp && !p.boss) {
    activity = 'target';
    want = p.target;
  } else if (p.object && !p.lowHp && !p.boss) {
    activity = 'object';
    want = p.object;
  } else if (p.lowHp) {
    activity = 'retreat';
    want = pat.retreat;
  } else if (p.boss) {
    activity = 'kite';
    want = pat.kite;
  } else {
    activity = 'patrol';
    want = pat.patrol;
  }
  if (!p.portal && !entering && p.flee) {
    activity = 'flee';
    want = p.flee;
  }
  const safer = p.danger ? dodge(p.danger, want) : null;
  if (safer) {
    activity = 'dodge';
    want = safer;
  }
  return { activity, want };
}
