import { WindGrid } from './grid';

// 合成风场（M0 用）：中纬西风急流 + 若干气旋/反气旋 + 噪声
// 与 M1 真实 GFS 域一致：60–150°E, 0–60°N, 0.25° 分辨率
export function makeSyntheticGrid(): WindGrid {
  const lon0 = 60, lat0 = 0, lon1 = 150, lat1 = 60;
  const cols = 361, rows = 241;
  const u = new Float32Array(cols * rows);
  const v = new Float32Array(cols * rows);

  const vortices = [
    { cx: 118, cy: 22, s: 14, R: 9 },  // 气旋（台风感）
    { cx: 128, cy: 40, s: -10, R: 7 }, // 反气旋
    { cx: 88, cy: 30, s: 8, R: 6 },
  ];

  for (let j = 0; j < rows; j++) {
    const lat = lat0 + (j / (rows - 1)) * (lat1 - lat0);
    for (let i = 0; i < cols; i++) {
      const lon = lon0 + (i / (cols - 1)) * (lon1 - lon0);
      // 中纬西风急流，带横向波动
      const meander = 6 * Math.sin((lon - 100) * (Math.PI / 35) + 1.2);
      const jetLat = 42 + meander;
      let U = 26 * Math.exp(-Math.pow((lat - jetLat) / 8, 2));
      let V = -2.5 * Math.sin((lon - 100) * (Math.PI / 40));
      // 涡旋（Rankine 式切向风 + 高斯衰减）
      for (const vt of vortices) {
        const dx = lon - vt.cx, dy = lat - vt.cy;
        const r = Math.hypot(dx, dy) + 1e-6;
        const prof = Math.exp(-(dx * dx + dy * dy) / (vt.R * vt.R));
        U += vt.s * prof * (-dy / r);
        V += vt.s * prof * (dx / r);
      }
      // 微噪声：让粒子有质感
      U += 0.8 * Math.sin(lat * 0.9 + lon * 0.05) + 0.5 * Math.sin(lon * 0.15 + lat * 0.3);
      V += 0.6 * Math.cos(lon * 0.2 - lat * 0.8);
      u[j * cols + i] = U;
      v[j * cols + i] = V;
    }
  }

  return { cols, rows, lon0, lat0, lon1, lat1, u, v, validTime: 'SYNTHETIC' };
}
