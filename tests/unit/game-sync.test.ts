import { describe, expect, it, vi } from 'vitest';
import { createGameSync } from '@/core/bot/game-sync';
import type { GameToggles } from '@/core/settings';
import type { PauseMenu } from '@/core/vision/pause';
import { readPauseMenu } from '@/core/vision/pause';
import type { Region } from '@/core/vision/layout';

const setup = (menuState: boolean[], want: GameToggles) => {
  let open = false;
  const toggles = menuState.map((c, i) => ({ x: 0.4 + i * 0.1, y: 0.58, checked: c }));
  const keyboard = { tap: vi.fn(async () => void (open = !open)) } as never;
  const pointer = {
    tap: vi.fn(async (x: number, y: number) => {
      if (y > 0.6) open = false; // 繼續
      const t = toggles.find((t) => t.x === x && t.y === y);
      if (t) t.checked = !t.checked;
    }),
  } as never;
  const read = (): PauseMenu | null => (open ? { resume: { x: 0.5, y: 0.64 }, toggles } : null);
  const sync = createGameSync({ keyboard, pointer, read, desired: () => want });
  return { sync, toggles, keyboard, pointer, isOpen: () => open };
};

const run = (sync: ReturnType<typeof createGameSync>, from = 5000, until = 20000, safe = true) => {
  for (let t = from; t < until; t += 100) sync.tick(t, safe);
};

describe('createGameSync', () => {
  it('開選單、把不一致的勾選切到設定值、按繼續關閉', () => {
    const s = setup([false, false, false], { autoPick: 'on', holdLevels: 'keep', holdChests: 'on' });
    run(s.sync);
    expect(s.toggles.map((t) => t.checked)).toEqual([true, false, true]);
    expect(s.isOpen()).toBe(false);
    expect(s.sync.busy).toBe(false);
  });

  it('已一致就只開關一次；完成後不再重複', () => {
    const s = setup([true, false, true], { autoPick: 'on', holdLevels: 'off', holdChests: 'on' });
    run(s.sync);
    expect((s.pointer as unknown as { tap: { mock: { calls: number[][] } } }).tap.mock.calls).toHaveLength(1);
    run(s.sync, 20000, 40000);
    expect((s.keyboard as unknown as { tap: { mock: { calls: unknown[] } } }).tap.mock.calls).toHaveLength(1);
  });

  it('不安全（有視窗、不在對局中）時不開始；全部 keep 也不動', () => {
    const s = setup([false, false, false], { autoPick: 'on', holdLevels: 'keep', holdChests: 'keep' });
    run(s.sync, 5000, 20000, false);
    expect(s.isOpen()).toBe(false);
    const k = setup([false, false, false], { autoPick: 'keep', holdLevels: 'keep', holdChests: 'keep' });
    run(k.sync);
    expect((k.keyboard as unknown as { tap: { mock: { calls: unknown[] } } }).tap.mock.calls).toHaveLength(0);
  });

  it('request() 後（新的一局）重新同步', () => {
    const s = setup([false, false, false], { autoPick: 'on', holdLevels: 'keep', holdChests: 'keep' });
    run(s.sync);
    s.toggles[0]!.checked = false; // 遊戲每局重設
    s.sync.request();
    run(s.sync, 20000, 40000);
    expect(s.toggles[0]!.checked).toBe(true);
  });
});

describe('readPauseMenu', () => {
  // 合成：寬按鈕「繼續」在 y 0.62~0.66；上方一排三組 [框][標籤]
  const W = 400;
  const H = 300;
  const frame = (checked: boolean[]) => {
    const data = new Uint8ClampedArray(W * H * 4).fill(250);
    const put = (x0: number, x1: number, y0: number, y1: number, c: number) => {
      for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++)
        for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) data.set([c, c, c, 255], (y * W + x) * 4);
    };
    [0.4, 0.5, 0.6].forEach((gx, i) => {
      if (checked[i]) put(gx + 0.002, gx + 0.008, 0.585, 0.595, 40); // 勾號
      else put(gx, gx + 0.012, 0.58, 0.6, 140); // 灰框
      for (let k = 0; k < 4; k++) put(gx + 0.02 + k * 0.012, gx + 0.026 + k * 0.012, 0.582, 0.598, 60); // 文字
    });
    return { width: W, height: H, data };
  };
  const button: Region = { kind: 'button', x0: 0.25, x1: 0.75, y0: 0.62, y1: 0.66, fill: 0.9, luma: 240 };

  it('讀出三個勾選狀態與「繼續」位置', () => {
    const m = readPauseMenu(frame([false, true, false]), [button])!;
    expect(m.toggles.map((t) => t.checked)).toEqual([false, true, false]);
    expect(m.toggles[0]!.x).toBeCloseTo(0.406, 2);
    expect(m.resume.y).toBeCloseTo(0.64, 2);
  });

  it('沒有寬按鈕 → null', () => {
    expect(readPauseMenu(frame([false, false, false]), [])).toBeNull();
  });
});
