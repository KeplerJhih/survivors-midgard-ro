type RafCallback = (time: number) => void;

export interface RafHost {
  requestAnimationFrame(cb: RafCallback): number;
  cancelAnimationFrame(id: number): void;
}

export interface RafPatchDeps {
  win: RafHost;
  /** 分頁是否被隱藏（隱藏時瀏覽器不再觸發原生 rAF，直接接手） */
  isHidden: () => boolean;
  now: () => number;
  /**
   * 看門狗：callback 等超過這麼久原生 rAF 都沒觸發，就由 flush() 接手。
   * 視窗被遮住/縮小時，原生 rAF 會停但 visibilityState 仍是 visible（實測），只靠 isHidden 不夠。
   */
  staleMs?: number;
}

export interface RafPatch {
  /** 執行原生 rAF 沒能及時觸發的 callback（分頁隱藏時全部、否則只處理超過 staleMs 的） */
  flush(): void;
  pendingCount(): number;
  restore(): void;
}

/**
 * 接管 requestAnimationFrame：每個 callback 同時排進原生 rAF 與自己的佇列，
 * 誰先觸發就由誰執行（另一邊作廢）。原生 rAF 正常時照常驅動；
 * 分頁隱藏、或原生 rAF 停擺超過 staleMs 時，由外部時脈（Worker ticker）呼叫 flush() 推動遊戲主迴圈。
 * 必須在頁面腳本之前（document_start）安裝，頁面殼才會包到這一層。
 */
export function patchRaf({ win, isHidden, now, staleMs = 100 }: RafPatchDeps): RafPatch {
  const nativeRaf = win.requestAnimationFrame.bind(win);
  const nativeCancel = win.cancelAnimationFrame.bind(win);
  const pending = new Map<number, { cb: RafCallback; nativeId: number; at: number }>();
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
    pending.set(id, { cb, nativeId, at: now() });
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
      if (pending.size === 0) return;
      const t = now();
      const hidden = isHidden();
      const due = [...pending].filter(([, p]) => hidden || t - p.at >= staleMs);
      for (const [id, p] of due) {
        pending.delete(id);
        nativeCancel(p.nativeId);
      }
      for (const [, p] of due) run(p.cb, t);
    },
    pendingCount: () => pending.size,
    restore() {
      win.requestAnimationFrame = nativeRaf;
      win.cancelAnimationFrame = nativeCancel;
    },
  };
}
