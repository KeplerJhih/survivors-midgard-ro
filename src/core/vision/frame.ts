/** 縮小後的畫面像素（RGBA），與 ImageData 相容，測試時可直接手工建立 */
export interface Frame {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export type PixelMatch = (r: number, g: number, b: number) => boolean;

/** 一群符合條件的像素：座標以畫面中心為原點、以畫面寬度正規化（右、下為正） */
export interface Blob {
  count: number;
  x: number;
  y: number;
  /** 外框寬高（以畫面寬度正規化） */
  w: number;
  h: number;
}

/** 找出所有符合條件像素的重心與外框；少於 minCount 視為沒有。include 可排除特定位置（例如角色周圍） */
export function findBlob(
  frame: Frame,
  match: PixelMatch,
  minCount = 1,
  include: (x: number, y: number) => boolean = () => true,
): Blob | null {
  const { width, height, data } = frame;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!match(data[i]!, data[i + 1]!, data[i + 2]!) || !include(x, y)) continue;
      n++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (n < minCount) return null;
  return {
    count: n,
    x: (sx / n - width / 2) / width,
    y: (sy / n - height / 2) / width,
    w: (maxX - minX + 1) / width,
    h: (maxY - minY + 1) / width,
  };
}

/** 從遊戲 canvas（preserveDrawingBuffer: true，任何時候都可讀）取一張縮小畫面 */
export function createCanvasSampler(source: HTMLCanvasElement, width = 160): () => Frame | null {
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d', { willReadFrequently: true });
  return () => {
    if (!ctx || source.width === 0 || source.height === 0) return null;
    const height = Math.max(1, Math.round((width * source.height) / source.width));
    if (off.width !== width || off.height !== height) {
      off.width = width;
      off.height = height;
    }
    ctx.drawImage(source, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  };
}

/** 依固定「高度」取樣（寬度隨長寬比）：樣板比對需要與視窗高度成正比的世界縮放 */
export function createCanvasSamplerByHeight(source: HTMLCanvasElement, height: number): () => Frame | null {
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d', { willReadFrequently: true });
  return () => {
    if (!ctx || source.width === 0 || source.height === 0) return null;
    const width = Math.max(1, Math.round((height * source.width) / source.height));
    if (off.width !== width || off.height !== height) {
      off.width = width;
      off.height = height;
    }
    ctx.drawImage(source, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  };
}

/** 以原生解析度取畫面的一塊區域（比例座標）：小地圖上的點只有幾個像素，縮小取樣會消失 */
export function createCropSampler(
  source: HTMLCanvasElement,
  rect: { x0: number; y0: number; x1: number; y1: number },
): () => Frame | null {
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d', { willReadFrequently: true });
  return () => {
    if (!ctx || source.width === 0 || source.height === 0) return null;
    const sx = Math.round(rect.x0 * source.width);
    const sy = Math.round(rect.y0 * source.height);
    const w = Math.max(1, Math.round(rect.x1 * source.width) - sx);
    const h = Math.max(1, Math.round(rect.y1 * source.height) - sy);
    if (off.width !== w || off.height !== h) {
      off.width = w;
      off.height = h;
    }
    ctx.drawImage(source, sx, sy, w, h, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  };
}
