export type Dir = 'up' | 'down' | 'left' | 'right';

export const TAU = Math.PI * 2;

/** 8 個扇區，從右方開始逆時針（畫面上方為正） */
const SECTORS: readonly Dir[][] = [
  ['right'],
  ['right', 'up'],
  ['up'],
  ['up', 'left'],
  ['left'],
  ['left', 'down'],
  ['down'],
  ['down', 'right'],
];

/** 角度（弧度，0 = 右，逆時針為正）轉成要按住的方向鍵（1~2 個） */
export function dirsFromAngle(angle: number): Dir[] {
  const a = ((angle % TAU) + TAU) % TAU;
  const sector = Math.round(a / (TAU / 8)) % 8;
  return [...SECTORS[sector]!];
}
