// M5 模块级地图引用：React 树外也能操作地图（CitySearch 点击搜索结果 flyTo + 打开读数卡）
import type { Map as MapLibreMap } from 'maplibre-gl';

let _map: MapLibreMap | null = null;

export const setMap = (m: MapLibreMap | null) => {
  _map = m;
};

export const getMap = (): MapLibreMap | null => _map;
