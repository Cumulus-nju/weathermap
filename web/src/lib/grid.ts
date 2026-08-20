// 风场网格数据结构（前后端共享的"心"）
export interface WindGrid {
  cols: number;
  rows: number;
  lon0: number;
  lat0: number;
  lon1: number;
  lat1: number;
  /** 纬向风 m/s，长度 cols*rows，行优先 */
  u: Float32Array;
  /** 经向风 m/s，长度 cols*rows，行优先 */
  v: Float32Array;
  /** 数据有效时间，ISO 字符串；M0 合成数据用 'SYNTHETIC' */
  validTime: string;
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

/** 网格最大风速 m/s（用于配色归一化） */
export function maxSpeed(g: WindGrid): number {
  let m = 0;
  for (let i = 0; i < g.u.length; i++) {
    const s = Math.hypot(g.u[i], g.v[i]);
    if (s > m) m = s;
  }
  return m;
}
