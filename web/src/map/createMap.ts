import { Map } from 'maplibre-gl';
import { WindLayer } from './WindLayer';
import { makeSyntheticGrid } from '../lib/syntheticWind';

// M0：暗色背景-only 底图（不依赖外部瓦片）+ 合成风粒子层
// M1 之后换成 GFS 真实数据 / M4 加内置低缩放底图
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
    map.addLayer(new WindLayer(makeSyntheticGrid()));
  });

  return map;
}
