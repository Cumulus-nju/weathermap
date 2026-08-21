// M4-3 底图风格化：离线暗色底图（不依赖任何外部瓦片）
// 陆地 = world-atlas 内置 Natural Earth 50m TopoJSON（~536KB），运行时转 GeoJSON 填充。
// 用 50m 而非 110m（54KB）：核心演示区是东亚，50m 海岸线保真明显更好，
// 体积对 GB 级数据可忽略。
// 经纬网格线按 15° 程序生成。海洋/陆地/海岸线/网格四层都是 MapLibre 内置图层，
// 风粒子与色斑叠加画在上面——大陆架不再是一整片纯黑。

import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import landTopo from 'world-atlas/land-50m.json';
import { feature } from 'topojson-client';

// TopoJSON -> GeoJSON Feature（50m 陆地多边形）
const landFeature = feature(landTopo as never, (landTopo as { objects: { land: unknown } }).objects.land as never);

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

/** 底图样式模板：海/陆底色 + 经纬网格 + 海岸线（暗亮主题仅换配色） */
function baseStyle(
  sea: string,
  land: string,
  gratColor: string,
  gratOpacity: number,
  coastColor: string,
): StyleSpecification {
  return {
    version: 8,
    sources: {
      land: { type: 'geojson', data: landFeature as unknown as GeoJSON.GeoJSON },
      grat: { type: 'geojson', data: graticule() },
    },
    layers: [
      // 海洋底色
      { id: 'sea', type: 'background', paint: { 'background-color': sea } },
      // 陆地填充（比海明显亮，让大陆轮廓 + 色斑颜色都更跳）
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': land } },
      // 经纬网格（极淡，画在陆地上层）
      {
        id: 'grat', type: 'line', source: 'grat',
        paint: { 'line-color': gratColor, 'line-opacity': gratOpacity, 'line-width': 1 },
      },
      // 海岸线（半透明描边，保证在海上清晰可辨）
      {
        id: 'coast', type: 'line', source: 'land',
        paint: { 'line-color': coastColor, 'line-opacity': 0.7, 'line-width': 1 },
      },
    ],
  };
}

// 暗色调：海偏蓝黑、陆地偏灰蓝且明显更亮（保证大陆轮廓一眼可辨），海岸线勾勒，网格若有若无
export function darkBasemapStyle(): StyleSpecification {
  return baseStyle('#0a1a2c', '#283449', '#8aa0bd', 0.08, '#6b8cb8');
}

// M5 亮色主题：纸张感航海图配色（海浅蓝 / 陆米白 / 网格石板灰 / 岸线中灰）
export function lightBasemapStyle(): StyleSpecification {
  return baseStyle('#dbe7f2', '#f2efe6', '#5a6b80', 0.15, '#7f95ad');
}

/** 切换主题：setStyle 会丢自定义层，style.load 时 createMap 幂等重挂 ColorLayer/WindLayer */
export function applyTheme(map: MapLibreMap, theme: 'dark' | 'light'): void {
  map.setStyle(theme === 'dark' ? darkBasemapStyle() : lightBasemapStyle());
}
