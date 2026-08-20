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
