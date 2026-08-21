import { create } from 'zustand';
import type { WmbManifest } from './wmb';
import type { Level } from './grid';

// M2 时间轴状态。index(整数时次) + frac(0..1 相邻时次插值) 表示连续播放头。
// 风层渲染循环直接 getState() 读（不进 React 渲染路径）；TimeScrubber 用 rAF 节流订阅。
// M3：level 支持等压面数字或 'sfc'（地面）。

export const DEFAULT_LEVEL: Level = 850;

export function levelLabel(level: Level): string {
  return level === 'sfc' ? '地面' : `${level} hPa`;
}

interface TimeState {
  manifest: WmbManifest | null;
  level: Level; // 气压层：数字(hPa) 或 'sfc'
  index: number; // 0..n-1
  frac: number; // 0..1
  playing: boolean;
  setManifest: (m: WmbManifest) => void;
  setLevel: (l: Level) => void;
  setPlayhead: (index: number, frac: number) => void;
  togglePlay: () => void;
}

export const useTime = create<TimeState>((set) => ({
  manifest: null,
  level: DEFAULT_LEVEL,
  index: 0,
  frac: 0,
  // M7-4.2 默认不自动播放（用户要求"先不要播放时间"，进来看初始时刻静态图，点播放才动）
  playing: false,
  setManifest: (manifest) => {
    // M7-4.2 初始播放头 = 距"现在"最近的时次（Windy 同款：进来看当前时刻附近的预报，
    // 而不是从 f000 开始）。validTime 为 UTC ISO，与 Date.now() 直接比较。
    let index = 0;
    if (manifest.timesteps.length) {
      const now = Date.now();
      let best = Infinity;
      manifest.timesteps.forEach((ts, i) => {
        const dt = Math.abs(new Date(ts.validTime).getTime() - now);
        if (dt < best) {
          best = dt;
          index = i;
        }
      });
    }
    set({ manifest, index, frac: 0 });
  },
  setLevel: (level) => set({ level }),
  setPlayhead: (index, frac) => set({ index, frac }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
}));
