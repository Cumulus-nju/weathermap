import { create } from 'zustand';

// M3 读数卡指针状态：地图 mousemove 写入（lon/lat + 屏幕坐标），ValueCard 用 rAF 节流订阅。
// 不直接用 React state 是因为 map 在 App 的 useEffect 里创建，绕过 props 更干净。

interface PointerState {
  lon: number;
  lat: number;
  /** 屏幕坐标（CSS px，相对 map 容器）——读数卡定位用 */
  x: number;
  y: number;
  visible: boolean;
  move: (lon: number, lat: number, x: number, y: number) => void;
  leave: () => void;
}

export const usePointer = create<PointerState>((set) => ({
  lon: 110,
  lat: 30,
  x: 0,
  y: 0,
  visible: false,
  move: (lon, lat, x, y) => set({ lon, lat, x, y, visible: true }),
  leave: () => set({ visible: false }),
}));
