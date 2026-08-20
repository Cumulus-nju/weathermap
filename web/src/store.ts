import { create } from 'zustand';

interface WindSettings {
  enabled: boolean;
  particleCount: number;
  speed: number;
  fade: number;
  streak: number;
  setEnabled: (v: boolean) => void;
  setParticleCount: (v: number) => void;
  setSpeed: (v: number) => void;
  setFade: (v: number) => void;
  setStreak: (v: number) => void;
}

export const useWindSettings = create<WindSettings>((set) => ({
  enabled: true,
  particleCount: 100_000,
  speed: 1,
  fade: 0.97,
  streak: 1,
  setEnabled: (enabled) => set({ enabled }),
  setParticleCount: (particleCount) => set({ particleCount }),
  setSpeed: (speed) => set({ speed }),
  setFade: (fade) => set({ fade }),
  setStreak: (streak) => set({ streak }),
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
