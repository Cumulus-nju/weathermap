import { create } from 'zustand';
import type { WmbManifest } from './wmb';

// M2 时间轴状态。index(整数时次) + frac(0..1 相邻时次插值) 表示连续播放头。
// 风层渲染循环直接 getState() 读（不进 React 渲染路径）；TimeScrubber 用 rAF 节流订阅。

export const DEFAULT_LEVEL = 850;

interface TimeState {
  manifest: WmbManifest | null;
  level: number; // hPa；M2 固定 850，M3 支持切换
  index: number; // 0..n-1
  frac: number; // 0..1
  playing: boolean;
  setManifest: (m: WmbManifest) => void;
  setLevel: (l: number) => void;
  setPlayhead: (index: number, frac: number) => void;
  togglePlay: () => void;
}

export const useTime = create<TimeState>((set) => ({
  manifest: null,
  level: DEFAULT_LEVEL,
  index: 0,
  frac: 0,
  playing: true,
  setManifest: (manifest) => set({ manifest }),
  setLevel: (level) => set({ level }),
  setPlayhead: (index, frac) => set({ index, frac }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
}));
