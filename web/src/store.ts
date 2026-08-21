import { create } from 'zustand';
import type { WindUnit, TempUnit } from './lib/units';
import type { City } from './lib/cities';

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
// M5：新增阵风/露点/云量；等压线是独立 toggle（isoOn），不占色斑 union
export type OverlayField = 'off' | 'temp' | 'rh' | 'apcp' | 'gust' | 'dpt' | 'tcdc' | 'lcdc' | 'mcdc' | 'hcdc';

/** 仅地面层有的色斑字段（选这些或开等压线时自动切到地面层） */
export const SURFACE_ONLY = new Set<OverlayField>(['apcp', 'gust', 'dpt', 'tcdc', 'lcdc', 'mcdc', 'hcdc']);

interface OverlayState {
  field: OverlayField;
  /** M5 等压线开关：色斑之上叠加海平面气压等值线（4 hPa 间隔） */
  isoOn: boolean;
  opacity: number;
  setField: (f: OverlayField) => void;
  setIsoOn: (v: boolean) => void;
  setOpacity: (o: number) => void;
}

export const useOverlay = create<OverlayState>((set) => ({
  field: 'off',
  isoOn: false,
  opacity: 0.65,
  setField: (field) => set({ field }),
  setIsoOn: (isoOn) => set({ isoOn }),
  setOpacity: (opacity) => set({ opacity }),
}));

// M5 底图主题：暗色/亮色（localStorage 持久化）
export type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const loadTheme = (): Theme => {
  try {
    const v = localStorage.getItem('weathermap.theme');
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

export const useTheme = create<ThemeState>((set, get) => ({
  theme: loadTheme(),
  setTheme: (theme) => {
    localStorage.setItem('weathermap.theme', theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

// M5 城市收藏（localStorage 持久化）
interface PlacesState {
  favorites: City[];
  toggleFavorite: (c: City) => void;
  isFavorite: (c: City) => boolean;
}

const loadFavorites = (): City[] => {
  try {
    const v = localStorage.getItem('weathermap.favorites');
    return v ? (JSON.parse(v) as City[]) : [];
  } catch {
    return [];
  }
};

const saveFavorites = (favs: City[]) => {
  try {
    localStorage.setItem('weathermap.favorites', JSON.stringify(favs));
  } catch {
    /* 隐私模式等存储不可用时静默 */
  }
};

export const usePlaces = create<PlacesState>((set, get) => ({
  favorites: loadFavorites(),
  toggleFavorite: (c) => {
    const favs = get().favorites;
    const hit = favs.some((f) => f.lon === c.lon && f.lat === c.lat);
    const next = hit ? favs.filter((f) => !(f.lon === c.lon && f.lat === c.lat)) : [...favs, c];
    saveFavorites(next);
    set({ favorites: next });
  },
  isFavorite: (c) =>
    get().favorites.some((f) => f.lon === c.lon && f.lat === c.lat),
}));
