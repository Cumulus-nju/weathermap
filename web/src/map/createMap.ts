import { Map } from 'maplibre-gl';
import { WindLayer } from './WindLayer';

// M2：暗色背景-only 底图（不依赖外部瓦片）+ 风粒子层
// 数据域由 manifest 决定（WindLayer 渲染时从 useTime store 读取），M4 加内置低缩放底图
export function createMap(container: HTMLElement): Map {
  const map = new Map({
    container,
    style: {
      version: 8,
      sources: {},
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#070b14' } },
      ],
    },
    center: [110, 30], // 东亚
    zoom: 3,
    minZoom: 1.5,
    maxZoom: 9,
    attributionControl: false,
    dragRotate: false, // WindLayer 依赖轴对齐 mercator 投影
    pitchWithRotate: false,
    touchPitch: false,
  });

  map.on('load', () => {
    map.addLayer(new WindLayer());
  });

  return map;
}
