// 风场网格数据结构（前后端共享的"心"）
// M3：网格现在携带温度/湿度/海压/降水（读数卡用），并可按层构建

/** 气压层级：等压面数值（hPa）或地面 */
export type Level = number | 'sfc';

export interface WindGrid {
  cols: number;
  rows: number;
  lon0: number;
  lat0: number;
  lon1: number;
  lat1: number;
  /** 纬向风 m/s，长度 cols*rows，行优先（row0 = lat0 最南） */
  u: Float32Array;
  /** 经向风 m/s，长度 cols*rows，行优先 */
  v: Float32Array;
  /** 数据有效时间，ISO 字符串；M0 合成数据用 'SYNTHETIC' */
  validTime: string;
  /** 温度 K（等压面 t_<level>；地面 t2m），读数卡用 */
  t?: Float32Array;
  /** 相对湿度 %（等压面 rh_<level>；地面 rh2m） */
  rh?: Float32Array;
  /** 海平面气压 Pa（仅地面） */
  prmsl?: Float32Array;
  /** 3h 累积降水 mm（仅地面；f000 为 PRATE 速率兜底） */
  apcp?: Float32Array;
  /** 全场最大风速 m/s（配色自适应归一化用，加载时算好） */
  maxSpeed?: number;
  /** 全场最大降水 mm（仅地面，降水色带自适应量程用） */
  maxApcp?: number;
}

export interface GridDomain {
  lon0: number;
  lat0: number;
  lon1: number;
  lat1: number;
  cols: number;
  rows: number;
}

/** 层 -> 风场字段名（u/v） */
export function windField(level: Level, c: 'u' | 'v'): string {
  return level === 'sfc' ? `${c}_sfc` : `${c}_${level}`;
}

/** 由解码出的字段（按层）+ 域 + 时次构造 WindGrid */
export function buildGrid(
  d: GridDomain,
  level: Level,
  fields: Record<string, Float32Array>,
  validTime: string,
): WindGrid {
  const u = fields[windField(level, 'u')];
  const v = fields[windField(level, 'v')];
  if (!u || !v) throw new Error(`buildGrid: 层 ${level} 缺 u/v 字段`);
  const g: WindGrid = {
    cols: d.cols, rows: d.rows, lon0: d.lon0, lat0: d.lat0, lon1: d.lon1, lat1: d.lat1,
    u, v, validTime,
  };
  if (level === 'sfc') {
    g.t = fields['t2m'];
    g.rh = fields['rh2m'];
    g.prmsl = fields['prmsl'];
    g.apcp = fields['apcp'];
  } else {
    g.t = fields[`t_${level}`];
    g.rh = fields[`rh_${level}`];
  }
  // 配色归一化：一次遍历算好，渲染时直接读，避免每帧重扫
  let m = 0;
  for (let i = 0; i < u.length; i++) {
    const s = Math.hypot(u[i], v[i]);
    if (s > m) m = s;
  }
  g.maxSpeed = m;
  if (g.apcp) {
    let pm = 0;
    for (let i = 0; i < g.apcp.length; i++) if (g.apcp[i] > pm) pm = g.apcp[i];
    g.maxApcp = pm;
  }
  return g;
}

/** 某点双线性插值采样（域外或字段缺失返回 null） */
export function sampleField(
  g: WindGrid,
  lon: number,
  lat: number,
  f: 'u' | 'v' | 't' | 'rh' | 'prmsl' | 'apcp',
): number | null {
  const data = g[f];
  if (!data) return null;
  if (lon < g.lon0 || lon > g.lon1 || lat < g.lat0 || lat > g.lat1) return null;
  // 网格坐标：row0=lat0（最南），col0=lon0（最西）
  const fx = ((lon - g.lon0) / (g.lon1 - g.lon0)) * (g.cols - 1);
  const fy = ((lat - g.lat0) / (g.lat1 - g.lat0)) * (g.rows - 1);
  const x0 = Math.max(0, Math.floor(fx));
  const y0 = Math.max(0, Math.floor(fy));
  const x1 = Math.min(g.cols - 1, x0 + 1);
  const y1 = Math.min(g.rows - 1, y0 + 1);
  const wx = fx - x0;
  const wy = fy - y0;
  const i00 = y0 * g.cols + x0;
  const i01 = y1 * g.cols + x0;
  const i10 = y0 * g.cols + x1;
  const i11 = y1 * g.cols + x1;
  return (
    (1 - wy) * ((1 - wx) * data[i00] + wx * data[i10]) +
    wy * ((1 - wx) * data[i01] + wx * data[i11])
  );
}

/** Web Mercator：经度 -> [0,1] */
export function mercX(lon: number): number {
  return (lon + 180) / 360;
}

/** Web Mercator：纬度 -> [0,1]，y=0 在最北 */
export function mercY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}
