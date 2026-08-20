// 数据加载器：WMB1 bundle 解码 + 按 (层, 时次) 缓存 WindGrid。
// WindLayer（上传纹理渲染）与 ValueCard（读数采样）共享同一份缓存，避免重复解码。

import { loadBundleFile } from './wmb';
import { buildGrid, type Level, type WindGrid } from './grid';
import { useTime } from './timeStore';

// 可选气压层（等压面 hPa + 地面）
export const LEVELS: Level[] = ['sfc', 1000, 925, 850, 700, 500, 300, 250, 200];
// 解码网格 LRU 上限（当前+下一+预取 3 时次 × 切换过的层）
const MAX_GRIDS = 12;

const gridByKey = new Map<string, WindGrid>();
const pending = new Set<string>();

/** 缓存键：`${level}:${fxx}`（level 用字符串，避免 '850' 与 850 歧义由模板串统一） */
export const keyOf = (level: Level, fxx: number): string => `${level}:${fxx}`;

export function getGrid(level: Level, fxx: number): WindGrid | undefined {
  return gridByKey.get(keyOf(level, fxx));
}

/** 按完整键取网格（WindLayer 兜底回退用） */
export function getGridByKey(key: string): WindGrid | undefined {
  return gridByKey.get(key);
}

/** 确保 (层,时次) 网格已加载；未就绪返回 undefined（异步加载，完成后可再取） */
export function ensureGrid(level: Level, fxx: number): void {
  const k = keyOf(level, fxx);
  if (gridByKey.has(k) || pending.has(k)) return;
  const manifest = useTime.getState().manifest;
  if (!manifest) return;
  const step = manifest.timesteps.find((t) => t.fxx === fxx);
  if (!step) return;
  pending.add(k);
  loadBundleFile(step.file, fieldsFor(level))
    .then((fields) => {
      pending.delete(k);
      const m = useTime.getState().manifest;
      if (!m) return;
      const g = buildGrid(m.domain, level, fields, step.validTime);
      gridByKey.set(k, g);
      evict();
    })
    .catch((err) => {
      pending.delete(k);
      console.warn(`dataLoader: 层 ${level} 时次 f${fxx} 加载失败`, err);
    });
}

/** 该层所需的字段名（解码时只解这些，省 CPU） */
function fieldsFor(level: Level): string[] {
  if (level === 'sfc') return ['u_sfc', 'v_sfc', 't2m', 'rh2m', 'prmsl', 'apcp'];
  return [`u_${level}`, `v_${level}`, `t_${level}`, `rh_${level}`];
}

function evict() {
  while (gridByKey.size > MAX_GRIDS) {
    const oldest = gridByKey.keys().next().value;
    if (oldest === undefined) break;
    gridByKey.delete(oldest);
  }
}
