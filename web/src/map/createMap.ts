import { Map } from 'maplibre-gl';
import { WindLayer } from './WindLayer';
import { ColorLayer } from './ColorLayer';
import { darkBasemapStyle } from '../lib/basemap';
import { useTheme } from '../store';

// M4-3：离线暗色底图（陆地填充 + 海岸线 + 经纬网格，无外部瓦片依赖）
// M4：叠加层（色斑）加在风粒子下层——先 addLayer 的在底层
// 数据域由 manifest 决定（渲染时从 useTime store 读取）
export function createMap(container: HTMLElement): Map {
  const map = new Map({
    container,
    style: darkBasemapStyle(),
    center: [104, 36], // 中国（fitBounds 会立即微调到正好覆盖中国）
    zoom: 3.5,
    minZoom: 1.5,
    maxZoom: 9,
    attributionControl: false,
    dragRotate: false, // WindLayer 依赖轴对齐 mercator 投影
    pitchWithRotate: false,
    touchPitch: false,
  });

  // M7-3 初始视角聚焦中国东部（100–135°E / 18–46°N）：
  // 成渝/昆明以东、含海南台湾、到哈尔滨，西部(新疆/西藏/青海)出画。
  // 数据域边缘(60°E/150°E/0°N/60°N)仍挤出视口，看不出"只有中国附近有数据"。
  // fitBounds 按实际窗口尺寸自适应；只调一次——不能放 style.load（主题切换会重置用户相机）。
  map.fitBounds([[100, 18], [135, 46]], { padding: 16, animate: false });

  // M5 主题切换用 setStyle 会重建样式、丢自定义层；这里幂等重挂，
  // 让 load 与 style.load 都触发（applyTheme 后粒子重播种一次，单帧代价）
  const addCustomLayers = () => {
    if (!map.getLayer('overlay')) map.addLayer(new ColorLayer()); // 色斑叠加在风粒子之下
    if (!map.getLayer('wind')) map.addLayer(new WindLayer());
    // M7-4 大陆边界：黑色细线 + 浅色衬边，盖在色斑+风粒子之上（Windy 同款——
    // 底图里那层浅色海岸线被 0.65 透明度色斑压淡、等值线又是白色，边界就不明显了）。
    // ⚠️ 不能加 beforeId：MapLibre 自定义层不进序列化层数组，beforeId 指到 custom 层时
    // 会落到 overlay/wind 之下被色斑盖住——必须无 beforeId 追加到最顶层（实测才可见）。
    // halo 用浅色衬在黑线后：黑线叠在深蓝灰气压斑上也能跳出来（纯黑在深底上会糊）。
    const theme = useTheme.getState().theme;
    const haloColor = theme === 'dark' ? '#cfdcf0' : '#ffffff';
    if (!map.getLayer('coast-top-halo')) {
      map.addLayer({
        id: 'coast-top-halo',
        type: 'line',
        source: 'land',
        paint: {
          'line-color': haloColor,
          'line-opacity': theme === 'dark' ? 0.5 : 0.65,
          'line-width': 3.2,
        },
      });
    }
    if (!map.getLayer('coast-top')) {
      map.addLayer({
        id: 'coast-top',
        type: 'line',
        source: 'land',
        paint: {
          'line-color': '#0a0f18', // 近黑（两主题通用）
          'line-opacity': 0.95,
          'line-width': 1.4,
        },
      });
    }
  };
  map.on('load', addCustomLayers);
  map.on('style.load', addCustomLayers);

  return map;
}
