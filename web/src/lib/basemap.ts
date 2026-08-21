// M4-3 底图风格化：离线暗色底图（不依赖任何外部瓦片）
// 陆地 = world-atlas 内置 Natural Earth 50m TopoJSON（~536KB），运行时转 GeoJSON 填充。
// 用 50m 而非 110m（54KB）：核心演示区是东亚，50m 海岸线保真明显更好，
// 体积对 GB 级数据可忽略。
// 经纬网格线按 15° 程序生成。海洋/陆地/海岸线/网格四层都是 MapLibre 内置图层，
// 风粒子与色斑叠加画在上面——大陆架不再是一整片纯黑。

import type { StyleSpecification } from 'maplibre-gl';
import landTopo from 'world-atlas/land-50m.json';
import { feature } from 'topojson-client';

// TopoJSON -> GeoJSON Feature（50m 陆地多边形）
const land = feature(landTopo as never, (landTopo as { objects: { land: unknown } }).objects.land as never);

/** 经纬网格线（每 15° 一条，经线 -180..180，纬线 -75..75，各段插点成折线） */
function graticule(): GeoJSON.Feature<GeoJSON.MultiLineString> {
  const lines: number[][][] = [];
  for (let lon = -180; lon <= 180; lon += 15) {
    const pts: number[][] = [];
    for (let lat = -85; lat <= 85; lat += 5) pts.push([lon, lat]);
    lines.push(pts);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const pts: number[][] = [];
    for (let lon = -180; lon <= 180; lon += 5) pts.push([lon, lat]);
    lines.push(pts);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
}

// 暗色调：海偏蓝黑、陆地偏灰蓝且明显更亮（保证大陆轮廓一眼可辨），海岸线勾勒，网格若有若无
export function darkBasemapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      land: { type: 'geojson', data: land as unknown as GeoJSON.GeoJSON },
      grat: { type: 'geojson', data: graticule() },
    },
    layers: [
      // 海洋底色（深蓝黑）
      { id: 'sea', type: 'background', paint: { 'background-color': '#0a1a2c' } },
      // 陆地填充（明显偏亮的暗灰蓝，让大陆轮廓 + 色斑颜色都更跳）
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#283449' } },
      // 经纬网格（极淡，画在陆地上层）
      {
        id: 'grat', type: 'line', source: 'grat',
        paint: { 'line-color': '#8aa0bd', 'line-opacity': 0.08, 'line-width': 1 },
      },
      // 海岸线（半透明浅蓝描边，提亮保证在暗海上清晰可辨）
      {
        id: 'coast', type: 'line', source: 'land',
        paint: { 'line-color': '#6b8cb8', 'line-opacity': 0.7, 'line-width': 1 },
      },
    ],
  };
}
