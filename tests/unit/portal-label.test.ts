import { describe, expect, it } from 'vitest';
import { findPortalLabel } from '@/core/vision/portal-label';

const W = 640;
const H = 291;
const frame = (draw: (set: (x: number, y: number, c: number[]) => void) => void) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([90, 120, 70, 255], i * 4);
  draw((x, y, c) => data.set([...c, 255], (y * W + x) * 4));
  return { width: W, height: H, data };
};
/** 一行「文字」：一排小字形（3px 寬筆畫、字距 4px），外圍 1px 黑框（遊戲 _label 的 outline）；outline=false 模擬沒有黑框的粉白物體 */
const text = (set: (x: number, y: number, c: number[]) => void, x0: number, y0: number, chars: number, col: number[], outline = true) => {
  for (let k = 0; k < chars; k++) {
    if (outline) for (let y = y0 - 1; y < y0 + 8; y++) for (let x = x0 + k * 7 - 1; x < x0 + k * 7 + 4; x++) set(x, y, [10, 10, 10]);
    for (let y = y0; y < y0 + 7; y++) for (let x = x0 + k * 7; x < x0 + k * 7 + 3; x++) set(x, y, col);
  }
};

describe('findPortalLabel（MVP 入口 / 出口名稱）', () => {
  it('淡粉白 (255,229,255) 的一行字 → 傳送門在名稱正下方', () => {
    const f = frame((set) => text(set, 400, 55, 8, [255, 229, 255]));
    const p = findPortalLabel(f)!;
    expect(p).not.toBeNull();
    expect(p.x).toBeGreaterThan(0.3); // 在畫面右側
    expect(p.y).toBeCloseTo(62 / H - 0.5 + 0.06, 2);
  });

  it('與外框混色變暗的筆畫也算（比例不變），但要有原色核心', () => {
    const f = frame((set) => {
      text(set, 400, 55, 8, [205, 184, 205]);
      text(set, 400, 55, 1, [255, 229, 255]);
    });
    expect(findPortalLabel(f)).not.toBeNull();
    expect(findPortalLabel(frame((set) => text(set, 400, 55, 8, [205, 184, 205])))).toBeNull();
  });

  it('顏色相同但沒有黑框（粉紅催眠漩渦）不算', () => {
    expect(findPortalLabel(frame((set) => text(set, 400, 55, 8, [255, 229, 255], false)))).toBeNull();
  });

  it('純白字（怪物說明）、金色字（因果路線傳送門）不算', () => {
    expect(findPortalLabel(frame((set) => text(set, 400, 55, 8, [255, 255, 255])))).toBeNull();
    expect(findPortalLabel(frame((set) => text(set, 400, 55, 8, [255, 235, 170])))).toBeNull();
  });
  it('旁邊是比例相同的淡紫地面（Niflheim 碎石）→ 不跟地面連成一塊，名稱仍找得到', () => {
    // 實機：地面 (209,195,210) 也符合比例 → 與名稱連成一大塊、高度超過一行字 → 被丟掉，外掛在催眠師旁打轉
    const f = frame((set) => {
      for (let y = 40; y < 120; y++) for (let x = 380; x < 480; x++) if ((x + y) % 3 === 0) set(x, y, [209, 195, 210]);
      text(set, 400, 60, 8, [255, 229, 255]);
    });
    const p = findPortalLabel(f)!;
    expect(p).not.toBeNull();
    // 緊貼外框的地面像素會被算進來、底部略往下（差幾 px），方向正確即可
    expect(p.y).toBeCloseTo(67 / H - 0.5 + 0.06, 1);
  });
});
