// M4 色带系统：色斑叠加层（温度/湿度/降水）的配色定义。
// 一份色带同时产出：①GL 1D 纹理（ColorLayer 着色器采样）②CSS 渐变（图例渲染）——
// 两端同源，图例所见即渲染所得。

import type { OverlayField } from '../store';
import type { WindGrid } from './grid';

export interface ColorStop {
  /** 0..1 位置 */
  t: number;
  /** 0..255 RGB */
  c: [number, number, number];
}

export interface Colormap {
  id: OverlayField;
  name: string;
  unit: string;
  stops: ColorStop[];
}

// 温度（K 存储）：-40..40℃ 冷→暖，参考 NCL BlAqGrYeOrRe 风格
export const TEMP_CMAP: Colormap = {
  id: 'temp',
  name: '温度',
  unit: '℃',
  stops: [
    { t: 0.0, c: [30, 14, 90] },
    { t: 0.12, c: [38, 50, 150] },
    { t: 0.28, c: [28, 130, 190] },
    { t: 0.42, c: [60, 190, 170] },
    { t: 0.55, c: [130, 220, 120] },
    { t: 0.68, c: [210, 240, 90] },
    { t: 0.8, c: [250, 200, 40] },
    { t: 0.9, c: [248, 120, 40] },
    { t: 1.0, c: [200, 20, 30] },
  ],
};

// 相对湿度（%）：干→湿 绿→黄→红
export const RH_CMAP: Colormap = {
  id: 'rh',
  name: '相对湿度',
  unit: '%',
  stops: [
    { t: 0.0, c: [150, 210, 120] },
    { t: 0.35, c: [210, 240, 90] },
    { t: 0.6, c: [250, 200, 40] },
    { t: 0.82, c: [248, 120, 40] },
    { t: 1.0, c: [200, 20, 30] },
  ],
};

// 降水（mm，3h 累积）：弱→强 蓝→青→绿→黄→橙→红
export const APCP_CMAP: Colormap = {
  id: 'apcp',
  name: '降水',
  unit: 'mm',
  stops: [
    { t: 0.0, c: [20, 90, 170] },
    { t: 0.18, c: [20, 160, 210] },
    { t: 0.4, c: [90, 210, 130] },
    { t: 0.58, c: [220, 240, 90] },
    { t: 0.75, c: [250, 200, 40] },
    { t: 0.88, c: [248, 120, 40] },
    { t: 1.0, c: [210, 20, 60] },
  ],
};

// M5 阵风（m/s 0-30）：弱→强 蓝→青→青柠→橙→红
export const GUST_CMAP: Colormap = {
  id: 'gust',
  name: '阵风',
  unit: 'm/s',
  stops: [
    { t: 0.0, c: [30, 80, 150] },
    { t: 0.25, c: [30, 150, 190] },
    { t: 0.5, c: [120, 210, 120] },
    { t: 0.72, c: [250, 200, 40] },
    { t: 0.88, c: [248, 120, 40] },
    { t: 1.0, c: [210, 30, 60] },
  ],
};

// M5 露点（K -40..40℃）：闷热区醒目 钢→青→橄榄→琥珀→玫瑰
export const DPT_CMAP: Colormap = {
  id: 'dpt',
  name: '露点',
  unit: '℃',
  stops: [
    { t: 0.0, c: [60, 80, 120] },
    { t: 0.25, c: [50, 140, 160] },
    { t: 0.5, c: [150, 190, 90] },
    { t: 0.75, c: [230, 180, 60] },
    { t: 1.0, c: [210, 90, 110] },
  ],
};

// M5 云量（%）：云越多越亮 钢→浅灰→白（云图氛围感）
const CLOUD_STOPS: ColorStop[] = [
  { t: 0.0, c: [70, 80, 100] },
  { t: 0.35, c: [110, 120, 140] },
  { t: 0.7, c: [170, 178, 192] },
  { t: 1.0, c: [240, 244, 250] },
];
export const TCDC_CMAP: Colormap = { id: 'tcdc', name: '总云量', unit: '%', stops: CLOUD_STOPS };
export const LCDC_CMAP: Colormap = { id: 'lcdc', name: '低云', unit: '%', stops: [
  { t: 0.0, c: [40, 90, 120] },
  { t: 0.4, c: [70, 140, 160] },
  { t: 0.75, c: [130, 190, 200] },
  { t: 1.0, c: [235, 242, 248] },
]};
export const MCDC_CMAP: Colormap = { id: 'mcdc', name: '中云', unit: '%', stops: [
  { t: 0.0, c: [60, 70, 130] },
  { t: 0.4, c: [100, 115, 180] },
  { t: 0.75, c: [160, 170, 215] },
  { t: 1.0, c: [238, 240, 250] },
]};
export const HCDC_CMAP: Colormap = { id: 'hcdc', name: '高云', unit: '%', stops: [
  { t: 0.0, c: [80, 60, 120] },
  { t: 0.4, c: [125, 110, 175] },
  { t: 0.75, c: [180, 170, 215] },
  { t: 1.0, c: [245, 244, 252] },
]};

/** 层名 -> 色带 */
export const CMAPS: Record<Exclude<OverlayField, 'off'>, Colormap> = {
  temp: TEMP_CMAP,
  rh: RH_CMAP,
  apcp: APCP_CMAP,
  gust: GUST_CMAP,
  dpt: DPT_CMAP,
  tcdc: TCDC_CMAP,
  lcdc: LCDC_CMAP,
  mcdc: MCDC_CMAP,
  hcdc: HCDC_CMAP,
};

// ---- 色带工具 ----

/** 在 stops 间线性插值，返回 0..255 RGB */
export function sampleStops(stops: ColorStop[], t: number): [number, number, number] {
  if (stops.length === 0) return [0, 0, 0];
  if (t <= stops[0].t) return stops[0].c;
  const last = stops[stops.length - 1];
  if (t >= last.t) return last.c;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * f),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * f),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * f),
      ];
    }
  }
  return last.c;
}

/** 色带 -> RGBA8 像素（GL 1D 纹理用） */
export function cmapToPixels(cmap: Colormap, n = 64): Uint8Array {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = sampleStops(cmap.stops, n <= 1 ? 0 : i / (n - 1));
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 色带 -> CSS linear-gradient（图例用） */
export function cmapToCss(cmap: Colormap): string {
  return cmap.stops
    .map((s) => `rgb(${s.c[0]},${s.c[1]},${s.c[2]}) ${(s.t * 100).toFixed(1)}%`)
    .join(', ');
}

// ---- 量程 ----
// 温度纹理存 K；固定量程保证不同时次/层可比。降水自适应当前场最大（f000 是 PRATE 速率≈0，天然接近 0）。
export const TEMP_RANGE: [number, number] = [233.15, 313.15]; // -40..40℃
export const RH_RANGE: [number, number] = [0, 100];
export const GUST_RANGE: [number, number] = [0, 30]; // m/s
export const DPT_RANGE: [number, number] = TEMP_RANGE; // 露点复用温度量程
export const CLOUD_RANGE: [number, number] = [0, 100]; // %

/** 该字段的渲染量程（降水按传入网格的最大值自适应） */
export function fieldValueRange(
  field: Exclude<OverlayField, 'off'>,
  grids: (WindGrid | null | undefined)[],
): [number, number] {
  if (field === 'temp') return TEMP_RANGE;
  if (field === 'rh') return RH_RANGE;
  if (field === 'gust') return GUST_RANGE;
  if (field === 'dpt') return DPT_RANGE;
  if (field === 'tcdc' || field === 'lcdc' || field === 'mcdc' || field === 'hcdc')
    return CLOUD_RANGE;
  let m = 0;
  for (const g of grids) if (g?.maxApcp) m = Math.max(m, g.maxApcp);
  return [0, Math.max(5, m)];
}
