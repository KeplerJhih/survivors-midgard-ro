import { describe, expect, it } from 'vitest';
import { patchRaf, type RafHost } from '@/core/background/raf';

/** 可手動觸發的假原生 rAF */
function fakeHost() {
  const queue = new Map<number, (t: number) => void>();
  let id = 0;
  const host: RafHost = {
    requestAnimationFrame: (cb) => (queue.set(++id, cb), id),
    cancelAnimationFrame: (i) => void queue.delete(i),
  };
  const fireNative = (t: number) => {
    const cbs = [...queue.values()];
    queue.clear();
    cbs.forEach((cb) => cb(t));
  };
  return { host, queue, fireNative };
}

describe('patchRaf', () => {
  it('可見時由原生 rAF 執行，flush 不做事', () => {
    const { host, fireNative } = fakeHost();
    const raf = patchRaf({ win: host, isHidden: () => false, now: () => 0 });
    const calls: number[] = [];
    host.requestAnimationFrame((t) => calls.push(t));
    raf.flush();
    expect(calls).toEqual([]);
    fireNative(16);
    expect(calls).toEqual([16]);
  });

  it('隱藏時 flush 執行等待中的 callback，並取消對應的原生 rAF', () => {
    const { host, queue, fireNative } = fakeHost();
    const raf = patchRaf({ win: host, isHidden: () => true, now: () => 99 });
    const calls: number[] = [];
    host.requestAnimationFrame((t) => calls.push(t));
    raf.flush();
    expect(calls).toEqual([99]);
    expect(queue.size).toBe(0);
    fireNative(100); // 回到前景時不會重複執行
    expect(calls).toEqual([99]);
  });

  it('遊戲主迴圈在 callback 內重新排程，下一次 flush 繼續推進', () => {
    const { host } = fakeHost();
    let t = 0;
    const raf = patchRaf({ win: host, isHidden: () => true, now: () => t });
    let frames = 0;
    const loop = () => {
      frames++;
      host.requestAnimationFrame(loop);
    };
    host.requestAnimationFrame(loop);
    for (let i = 0; i < 5; i++) {
      t += 33;
      raf.flush();
    }
    expect(frames).toBe(5);
  });

  it('cancelAnimationFrame 有效', () => {
    const { host } = fakeHost();
    const raf = patchRaf({ win: host, isHidden: () => true, now: () => 0 });
    let called = false;
    const id = host.requestAnimationFrame(() => (called = true));
    host.cancelAnimationFrame(id);
    raf.flush();
    expect(called).toBe(false);
  });
});
