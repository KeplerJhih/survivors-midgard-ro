export interface Ticker {
  stop(): void;
}

/** Worker 內的計時器不受分頁背景節流影響（主執行緒的 setInterval 在背景會被壓到 ≥1 秒） */
const WORKER_SRC =
  'let id;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)};';

/** 以 Web Worker 為時脈的計時器；建立 Worker 失敗時退回 setInterval */
export function createWorkerTicker(intervalMs: number, onTick: () => void): Ticker {
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = () => onTick();
    worker.postMessage(intervalMs);
    return {
      stop() {
        worker.terminate();
        URL.revokeObjectURL(url);
      },
    };
  } catch {
    const id = setInterval(onTick, intervalMs);
    return { stop: () => clearInterval(id) };
  }
}
