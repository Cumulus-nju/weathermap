// M4-3 底图风格化：离线暗色底图（不依赖任何外部瓦片）
// 陆地 = world-atlas 内置 Natural Earth 50m TopoJSON（~536KB），运行时转 GeoJSON 填充。
// 用 50m 而非 110m（54KB）：核心演示区是东亚，50m 海岸线保真明显更好，
// 体积对 GB 级数据可忽略。
// M6-2：叠加 中国省份界线 + 世界主要河流 + 主要湖泊（Natural Earth 10m 处理后内置，
// 生成脚本 pipeline/ne_build.py）——三层都是淡色装饰，画在风粒子/色斑下层。
// 经纬网格线按 15° 程序生成。海洋/陆地/网格/海岸/湖泊/省份/河流全是内置图层。

import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import landTopo from 'world-atlas/land-50m.json';
import { feature } from 'topojson-client';
// M6-2 离线装饰矢量（pipeline/ne_build.py 从 Natural Earth 10m 裁剪简化）
import chnProvinces from '../lib/geo/chn-provinces.json';
import majorRivers from '../lib/geo/major-rivers.json';
import majorLakes from '../lib/geo/major-lakes.json';

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

/** 主题配色参数（暗/亮两套） */
interface BasemapTheme {
  sea: string;
  land: string;
  gratColor: string;
  gratOpacity: number;
  coastColor: string;
  coastHalo: string;
  coastHaloOpacity: number;
  lakeColor: string;
  lakeOpacity: number;
  provColor: string;
  provOpacity: number;
  riverColor: string;
  riverOpacity: number;
}

/** 底图样式模板：海/陆底色 + 湖泊 + 省份界线 + 河流 + 经纬网格 + 双层次海岸线
 *  海岸线 = 宽 halo 衬边（陆侧压暗出轮廓）+ 细亮线，让大陆边界在海上/陆上/色斑下都清晰 */
function baseStyle(t: BasemapTheme): StyleSpecification {
  return {
    version: 8,
    sources: {
      land: { type: 'geojson', data: landFeature as unknown as GeoJSON.GeoJSON },
      lakes: { type: 'geojson', data: majorLakes as unknown as GeoJSON.GeoJSON },
      prov: { type: 'geojson', data: chnProvinces as unknown as GeoJSON.GeoJSON },
      rivers: { type: 'geojson', data: majorRivers as unknown as GeoJSON.GeoJSON },
      grat: { type: 'geojson', data: graticule() },
    },
    layers: [
      // 海洋底色
      { id: 'sea', type: 'background', paint: { 'background-color': t.sea } },
      // 陆地填充（比海明显亮，让大陆轮廓 + 色斑颜色都更跳）
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': t.land } },
      // 主要湖泊（淡色水填充，画在陆地上层）
      {
        id: 'lake', type: 'fill', source: 'lakes',
        paint: { 'fill-color': t.lakeColor, 'fill-opacity': t.lakeOpacity },
      },
      // 中国省份界线（淡线；zoom<2.5 全屏看中国小，线糊成一团，故设 minzoom）
      {
        id: 'prov', type: 'line', source: 'prov', minzoom: 2.5,
        paint: { 'line-color': t.provColor, 'line-opacity': t.provOpacity, 'line-width': 1.0 },
      },
      // 主要河流（淡蓝细线）
      {
        id: 'river', type: 'line', source: 'rivers', minzoom: 1.5,
        paint: { 'line-color': t.riverColor, 'line-opacity': t.riverOpacity, 'line-width': 1.2 },
      },
      // 海岸 halo：粗线衬边，陆侧压出一道深/浅边界，让轮廓"立"起来
      {
        id: 'coast-halo', type: 'line', source: 'land',
        paint: { 'line-color': t.coastHalo, 'line-opacity': t.coastHaloOpacity, 'line-width': 3.5 },
      },
      // 海岸线（亮色细线叠在 halo 上，保证在海上清晰可辨）
      {
        id: 'coast', type: 'line', source: 'land',
        paint: { 'line-color': t.coastColor, 'line-opacity': 1, 'line-width': 1.4 },
      },
      // 经纬网格（极淡，画在陆地上层）
      {
        id: 'grat', type: 'line', source: 'grat',
        paint: { 'line-color': t.gratColor, 'line-opacity': t.gratOpacity, 'line-width': 1 },
      },
    ],
  };
}

// 暗色调：海偏蓝黑、陆地偏灰蓝且明显更亮（保证大陆轮廓一眼可辨），海岸 halo 用海色压暗陆侧，
// 细亮线提亮边界；湖泊/河流/省份界线都偏暗蓝且低不透明度（淡装饰不抢色斑/风场的戏）
export function darkBasemapStyle(): StyleSpecification {
  return baseStyle({
    sea: '#0a1a2c',
    land: '#2e3d58',
    gratColor: '#8aa0bd',
    gratOpacity: 0.08,
    coastColor: '#9cc0ea',
    coastHalo: '#0a1a2c',
    coastHaloOpacity: 0.55,
    lakeColor: '#3a6a92',
    lakeOpacity: 0.5,
    provColor: '#5a6d88',
    provOpacity: 0.55,
    riverColor: '#4a7ea8',
    riverOpacity: 0.7,
  });
}

// M5 亮色主题：纸张感航海图配色（海浅蓝 / 陆米白 / 网格石板灰 / 岸线中灰 + 中灰 halo 衬边）；
// 湖泊/河流用比海稍深的蓝灰、省份界线中灰，均低不透明度
export function lightBasemapStyle(): StyleSpecification {
  return baseStyle({
    sea: '#dbe7f2',
    land: '#f2efe6',
    gratColor: '#5a6b80',
    gratOpacity: 0.15,
    coastColor: '#7f95ad',
    coastHalo: '#c9d7e5',
    coastHaloOpacity: 0.8,
    lakeColor: '#c3d9ea',
    lakeOpacity: 0.8,
    provColor: '#96a8c0',
    provOpacity: 0.6,
    riverColor: '#6fa3c8',
    riverOpacity: 0.75,
  });
}

/** 切换主题：setStyle 会丢自定义层，style.load 时 createMap 幂等重挂 ColorLayer/WindLayer */
export function applyTheme(map: MapLibreMap, theme: 'dark' | 'light'): void {
  map.setStyle(theme === 'dark' ? darkBasemapStyle() : lightBasemapStyle());
}
