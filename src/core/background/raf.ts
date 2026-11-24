type RafCallback = (time: number) => void;

export interface RafHost {
  requestAnimationFrame(cb: RafCallback): number;
  cancelAnimationFrame(id: number): void;
}

export interface RafPatchDeps {
  win: RafHost;
  /** 分頁是否真的被隱藏（隱藏時瀏覽器不再觸發原生 rAF） */
  isHidden: () => boolean;
  now: () => number;
}

export interface RafPatch {
  /** 分頁隱藏時，執行所有等待中的 rAF callback；可見時什麼都不做 */
  flush(): void;
  pendingCount(): number;
  restore(): void;
}

/**
 * 接管 requestAnimationFrame：每個 callback 同時排進原生 rAF 與自己的佇列，
 * 誰先觸發就由誰執行（另一邊作廢）。可見時原生 rAF 照常驅動；
 * 隱藏時由外部時脈（Worker ticker）呼叫 flush() 推動遊戲主迴圈。
 * 必須在頁面腳本之前（document_start）安裝，頁面殼才會包到這一層。
 */
export function patchRaf({ win, isHidden, now }: RafPatchDeps): RafPatch {
  const nativeRaf = win.requestAnimationFrame.bind(win);
  const nativeCancel = win.cancelAnimationFrame.bind(win);
  const pending = new Map<number, { cb: RafCallback; nativeId: number }>();
  let nextId = 1;

  const run = (cb: RafCallback, t: number) => {
    try {
      cb(t);
    } catch (err) {
      // 不讓單一 callback 的錯誤中斷其他 callback，但仍讓它出現在 console
      queueMicrotask(() => {
        throw err;
      });
    }
  };

  win.requestAnimationFrame = (cb) => {
    const id = nextId++;
    const nativeId = nativeRaf((t) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      run(p.cb, t);
    });
    pending.set(id, { cb, nativeId });
    return id;
  };

  win.cancelAnimationFrame = (id) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    nativeCancel(p.nativeId);
  };

  return {
    flush() {
      if (!isHidden() || pending.size === 0) return;
      const t = now();
      const batch = [...pending.values()];
      pending.clear();
      for (const p of batch) {
        nativeCancel(p.nativeId);
        run(p.cb, t);
      }
    },
    pendingCount: () => pending.size,
    restore() {
      win.requestAnimationFrame = nativeRaf;
      win.cancelAnimationFrame = nativeCancel;
    },
  };
}
