import { dirsFromAngle, type Dir } from '../movement/directions';
import type { Frame } from './frame';

/**
 * 地圖物件（木箱 / 鐵箱，可破壞道具，碰到就破、掉 zeny/藥水；core/main.gd _update_props）。
 * 以灰階正規化相關係數（NCC）做樣板比對：比的是形狀與明暗分布，不看顏色、不受整體亮度影響。
 * 樣板取自實機（2026-11-25，視窗 978×685），比對畫面需以「高度 224px」取樣（世界縮放與視窗高度成正比）。
 *
 * ⚠️ 實機評估（實驗功能，預設關閉）：真箱分數 0.71~0.78，草地/HUD 誤判 0.69~0.74，多尺度（0.7~1.1）也無法拉開；
 * 灰階 NCC 在有紋理的草地上鑑別力不足。待改：邊緣方向分布（箱子有明確直角稜線）等更具鑑別力的特徵。
 */
export interface Template {
  name: string;
  w: number;
  h: number;
  data: readonly number[];
}

export const SAMPLE_HEIGHT = 224;

export const TEMPLATES: Template[] = [
  {
    name: 'woodbox',
    w: 16,
    h: 16,
    data: [
      129,128,137,126,139,147,146,150,147,153,143,149,135,143,140,149,137,139,137,132,132,140,145,150,188,163,150,140,134,138,132,133,
      142,142,142,147,123,144,146,146,169,161,178,163,150,146,132,126,140,143,138,135,150,148,137,145,173,134,141,170,179,167,127,141,
      136,114,143,163,131,125,148,171,175,166,156,124,124,163,163,135,156,80,88,122,149,137,123,130,175,121,126,147,149,121,113,127,
      138,79,66,70,102,137,153,144,167,138,151,129,106,84,106,111,125,74,65,87,73,86,113,127,135,125,110,84,99,80,110,108,
      126,91,55,56,74,98,84,92,100,86,84,88,105,75,118,119,110,86,56,67,68,75,91,99,111,112,96,90,91,79,114,144,
      129,69,58,59,90,78,79,99,111,125,84,115,95,79,106,130,145,70,51,49,77,92,59,96,111,113,86,83,89,78,108,129,
      137,72,56,64,66,72,72,85,111,96,85,76,89,103,101,132,120,107,102,89,63,71,86,76,111,93,105,102,99,117,144,139,
      137,138,140,125,98,91,86,83,102,101,93,110,119,136,142,140,122,134,128,125,128,124,110,78,100,107,125,154,136,130,141,142,
    ],
  },
  {
    name: 'steelbox',
    w: 18,
    h: 17,
    data: [
      127,135,144,148,133,145,137,149,158,183,181,181,157,150,148,139,138,130,139,145,125,134,148,148,135,159,147,116,120,135,201,202,149,134,143,128,
      122,140,134,136,135,147,165,115,130,128,124,125,118,131,204,204,138,151,133,131,135,143,130,107,111,121,125,127,111,121,124,125,102,154,220,120,
      110,116,153,133,75,83,89,78,103,124,117,119,104,121,188,164,118,110,90,92,112,131,158,129,81,99,92,80,93,126,189,163,126,115,76,86,108,79,
      68,100,120,135,162,98,82,95,160,169,127,115,100,114,80,119,93,89,62,60,72,96,112,114,155,125,121,112,92,93,108,124,80,120,110,89,67,65,
      64,60,69,94,127,105,70,75,90,132,161,133,80,120,104,89,77,118,104,72,60,63,99,63,83,99,111,128,159,128,80,120,101,89,77,93,110,126,
      95,62,105,64,126,109,110,134,140,128,80,116,104,89,68,81,97,115,99,62,120,64,123,109,123,124,131,98,81,115,96,81,68,61,77,101,90,62,
      120,64,121,90,108,88,80,100,107,126,101,82,72,76,63,59,69,62,120,62,60,54,81,115,108,125,140,136,129,143,113,86,76,74,74,60,120,62,
      75,92,111,128,121,130,139,127,142,116,141,146,106,90,94,88,115,99,102,107,113,139,149,152,142,141,133,159,136,143,121,131,119,89,106,104,
      119,131,134,115,124,151,146,154,
    ],
  },
];

export interface ObjectHit {
  name: string;
  /** 以畫面中心為原點、以畫面高度正規化 */
  x: number;
  y: number;
  score: number;
}

/** 不在這些區域找（0~1）：四角 HUD、底部技能列、兩側觸控搖桿與角色本身 */
const SKIP = [
  { x0: 0, y0: 0, x1: 0.24, y1: 0.16 },
  { x0: 0.85, y0: 0, x1: 1, y1: 0.58 },
  { x0: 0.38, y0: 0.84, x1: 0.7, y1: 1 },
  { x0: 0, y0: 0.72, x1: 0.2, y1: 1 },
  { x0: 0.74, y0: 0.72, x1: 1, y1: 1 },
  { x0: 0.45, y0: 0.4, x1: 0.55, y1: 0.6 },
];

function prep(t: Template) {
  const n = t.data.length;
  const mean = t.data.reduce((s, v) => s + v, 0) / n;
  const centered = t.data.map((v) => v - mean);
  const norm = Math.sqrt(centered.reduce((s, v) => s + v * v, 0));
  return { ...t, centered, norm };
}
const PREPARED = TEMPLATES.map(prep);

/** 在高度 SAMPLE_HEIGHT 的畫面上找物件；minScore 為 NCC 門檻 */
export function findObjects(f: Frame, minScore = 0.75, stride = 2): ObjectHit[] {
  const { width: W, height: H, data } = f;
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  const hits: ObjectHit[] = [];
  for (const t of PREPARED) {
    for (let y = 0; y + t.h <= H; y += stride) {
      for (let x = 0; x + t.w <= W; x += stride) {
        const cx = (x + t.w / 2) / W;
        const cy = (y + t.h / 2) / H;
        if (SKIP.some((z) => cx >= z.x0 && cx <= z.x1 && cy >= z.y0 && cy <= z.y1)) continue;
        let sum = 0;
        for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) sum += L[(y + j) * W + x + i]!;
        const mean = sum / (t.w * t.h);
        let dot = 0;
        let ss = 0;
        let k = 0;
        for (let j = 0; j < t.h; j++) {
          for (let i = 0; i < t.w; i++) {
            const v = L[(y + j) * W + x + i]! - mean;
            dot += v * t.centered[k++]!;
            ss += v * v;
          }
        }
        if (ss < 1) continue;
        const score = dot / (Math.sqrt(ss) * t.norm);
        if (score >= minScore) hits.push({ name: t.name, x: (cx - 0.5) * (W / H), y: cy - 0.5, score });
      }
    }
  }
  // 非極大值抑制：同一物件附近只留分數最高的
  hits.sort((a, b) => b.score - a.score);
  const kept: ObjectHit[] = [];
  for (const h of hits) if (!kept.some((k) => Math.hypot(k.x - h.x, k.y - h.y) < 0.06)) kept.push(h);
  return kept;
}

/** 朝最近的物件走 */
export function steerToObject(hits: ObjectHit[]): Dir[] | null {
  if (hits.length === 0) return null;
  const near = hits.reduce((a, b) => (Math.hypot(a.x, a.y) <= Math.hypot(b.x, b.y) ? a : b));
  return dirsFromAngle(Math.atan2(-near.y, near.x));
}

export interface ObjectSeeker {
  update(hits: ObjectHit[] | null, now: number): Dir[] | null;
}

/**
 * 連續 confirm 次在相近位置（< 0.12H，角色移動會讓物件在畫面上平移）看到物件才前往；
 * 追超過 maxChaseMs 就放棄並冷卻（可能是誤判或被地形擋住）。
 */
export function createObjectSeeker(confirm = 2, maxChaseMs = 10000, cooldownMs = 10000): ObjectSeeker {
  let streak = 0;
  let last: ObjectHit | null = null;
  let chaseStart = -1;
  let coolUntil = -Infinity;
  return {
    update(hits, now) {
      if (now < coolUntil || !hits || hits.length === 0) {
        streak = 0;
        last = null;
        chaseStart = -1;
        return null;
      }
      const near = hits.reduce((a, b) => (Math.hypot(a.x, a.y) <= Math.hypot(b.x, b.y) ? a : b));
      streak = last && Math.hypot(last.x - near.x, last.y - near.y) < 0.12 ? streak + 1 : 1;
      last = near;
      if (streak < confirm) return null;
      if (chaseStart < 0) chaseStart = now;
      if (now - chaseStart > maxChaseMs) {
        coolUntil = now + cooldownMs;
        streak = 0;
        chaseStart = -1;
        return null;
      }
      return steerToObject([near]);
    },
  };
}
