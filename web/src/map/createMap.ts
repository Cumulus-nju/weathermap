import { Map } from 'maplibre-gl';
import { WindLayer } from './WindLayer';
import { ColorLayer } from './ColorLayer';
import { darkBasemapStyle } from '../lib/basemap';

// M4-3：离线暗色底图（陆地填充 + 海岸线 + 经纬网格，无外部瓦片依赖）
// M4：叠加层（色斑）加在风粒子下层——先 addLayer 的在底层
// 数据域由 manifest 决定（渲染时从 useTime store 读取）
export function createMap(container: HTMLElement): Map {
  const map = new Map({
    container,
    style: darkBasemapStyle(),
    center: [110, 30], // 东亚
    zoom: 3,
    minZoom: 1.5,
    maxZoom: 9,
    attributionControl: false,
    dragRotate: false, // WindLayer 依赖轴对齐 mercator 投影
    pitchWithRotate: false,
    touchPitch: false,
  });

  // M5 主题切换用 setStyle 会重建样式、丢自定义层；这里幂等重挂，
  // 让 load 与 style.load 都触发（applyTheme 后粒子重播种一次，单帧代价）
  const addCustomLayers = () => {
    if (!map.getLayer('overlay')) map.addLayer(new ColorLayer()); // 色斑叠加在风粒子之下
    if (!map.getLayer('wind')) map.addLayer(new WindLayer());
  };
  map.on('load', addCustomLayers);
  map.on('style.load', addCustomLayers);

  return map;
}
