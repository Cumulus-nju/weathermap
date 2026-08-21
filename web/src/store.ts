import { create } from 'zustand';
import type { WindUnit, TempUnit } from './lib/units';

interface WindSettings {
  enabled: boolean;
  particleCount: number;
  /** M4-2 粒子数自适应：按实测 FPS 升降粒子数以维持 ~35fps（弱机/软渲染），开时手动滑条锁定 */
  autoParticles: boolean;
  /** M4-2 风粒子配色预设索引（对应 shaders DRAW_FRAG 的 pal* 函数） */
  palette: number;
  speed: number;
  fade: number;
  streak: number;
  setEnabled: (v: boolean) => void;
  setParticleCount: (v: number) => void;
  setAutoParticles: (v: boolean) => void;
  setPalette: (v: number) => void;
  setSpeed: (v: number) => void;
  setFade: (v: number) => void;
  setStreak: (v: number) => void;
}

export const useWindSettings = create<WindSettings>((set) => ({
  enabled: true,
  // 简洁明了：60k 默认（Windy 风格可见独立流线），fade 0.96 尾迹适中；弱机由 governor 自动降数
  particleCount: 60_000,
  autoParticles: true,
  palette: 0,
  speed: 1,
  fade: 0.96,
  streak: 1,
  setEnabled: (enabled) => set({ enabled }),
  setParticleCount: (particleCount) => set({ particleCount }),
  setAutoParticles: (autoParticles) => set({ autoParticles }),
  setPalette: (palette) => set({ palette }),
  setSpeed: (speed) => set({ speed }),
  setFade: (fade) => set({ fade }),
  setStreak: (streak) => set({ streak }),
}));

// M4-2 显示单位（风 m/s↔km/h↔节，温度 ℃↔℉）
interface UnitsState {
  wind: WindUnit;
  temp: TempUnit;
  setWind: (u: WindUnit) => void;
  setTemp: (u: TempUnit) => void;
}

export const useUnits = create<UnitsState>((set) => ({
  wind: 'ms',
  temp: 'c',
  setWind: (wind) => set({ wind }),
  setTemp: (temp) => set({ temp }),
}));

// M4 叠加图层：色斑叠加（温度/湿度/降水）+ 不透明度
export type OverlayField = 'off' | 'temp' | 'rh' | 'apcp';

interface OverlayState {
  field: OverlayField;
  opacity: number;
  setField: (f: OverlayField) => void;
  setOpacity: (o: number) => void;
}

export const useOverlay = create<OverlayState>((set) => ({
  field: 'off',
  opacity: 0.65,
  setField: (field) => set({ field }),
  setOpacity: (opacity) => set({ opacity }),
}));
