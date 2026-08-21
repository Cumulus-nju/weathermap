import { useEffect, useRef } from 'react';
import { contours } from 'd3-contour';
import { getMap } from '../lib/mapStore';
import { useOverlay, useUnits, SURFACE_ONLY, type OverlayField } from '../store';
import { useTime } from '../lib/timeStore';
import { getGrid } from '../lib/dataLoader';
import type { Level } from '../lib/grid';
import { ISO_INTERVAL } from '../lib/colormaps';
import { tempFromK } from '../lib/units';
import { FIELD_KEY, type FieldKey } from '../map/ColorLayer';

// M7-4 等值线数值标注：CPU marching squares（d3-contour）把当前图层字段的等值线
// 重构成折线，沿线等距取候选标注点，rAF 节流投影 + 贪心避让（CityLabels 同款模式）。
// 重算只在 (字段, 层, 时次, 插值桶, 开关) 变化时发生；逐帧只重投影已有的 lon/lat 点。
// 字段与 ColorLayer 同源：等值线跟随当前色斑字段；temp/rh 有高层数据在当前层画，
// 其余（off 默认等压线 + surface-only）在 sfc 画，并镜像 ColorLayer 的地面层守卫。

/** 数据字段 -> 标注文本（显示单位：温度℃/℉、气压 hPa、其余整数） */
function labelText(fKey: FieldKey, v: number): string {
  const unit = useUnits.getState().temp;
  if (fKey === 't' || fKey === 'dpt') return `${Math.round(tempFromK(v, unit))}°`;
  if (fKey === 'prmsl') return `${Math.round(v / 100)}`; // Pa → hPa
  return `${Math.round(v)}`;
}

/** 该字段当前生效的气压层（surface-only / off → sfc，与 ColorLayer 一致） */
function effLevelOf(field: OverlayField, cur: Level): Level {
  return field === 'off' || SURFACE_ONLY.has(field) ? 'sfc' : cur;
}

const STEP = 100;       // 更新节流（ms）≈10Hz
const CAND_STEP = 1.0;  // 候选点沿等值线的网格间距（≈0.25°，默认视角 ~9px，高缩放时加密）
const EDGE = 1.5;       // 距域边界（网格单位）丢弃候选——d3 会把开等值线沿边界闭合，那里 GPU 无线
const MAX_CANDS = 3000; // 候选点数上限（防极端场爆 DOM/投影）
const GAP = 110;        // 标注之间最小屏幕间距（px）
const MAX_LABELS = 130; // 单帧最多放置标注数

interface Label {
  lon: number;
  lat: number;
  text: string;
}

export function IsoLabels() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Label[]>([]);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const container = wrapRef.current;
    if (!container) return;
    let raf = 0;
    let last = 0;
    let disposed = false;

    /** 等值线重构（数据未就绪返回 false，下个 tick 重试） */
    const recompute = (
      field: OverlayField,
      fKey: FieldKey,
      effLevel: Level,
      t: ReturnType<typeof useTime.getState>,
      key: string,
    ): boolean => {
      const m = t.manifest;
      if (!m || m.timesteps.length === 0) return false;
      const ts = m.timesteps;
      const n = ts.length;
      const i = Math.min(Math.max(t.index, 0), n - 1);
      const f0 = ts[i];
      const f1 = ts[(i + 1) % n];
      const g0 = getGrid(effLevel, f0.fxx);
      const g1 = getGrid(effLevel, f1.fxx);
      const d0 = g0?.[fKey];
      const d1 = g1?.[fKey];
      if (!g0 || !g1 || !d0 || !d1) return false; // 网格未就绪，等加载
      const cols = g0.cols;
      const rows = g0.rows;
      // 与着色器 u_mix 同源的双时次插值场
      const frac = t.frac;
      const vals = new Float64Array(cols * rows);
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < vals.length; k++) {
        const v = d0[k] * (1 - frac) + d1[k] * frac;
        vals[k] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      // 等值面 = interval 的整数倍（与 shader fract(iso/interval) 对齐）
      const interval = ISO_INTERVAL[field === 'off' ? 'pressure' : field];
      const levels: number[] = [];
      for (let L = Math.ceil(lo / interval) * interval; L <= hi; L += interval) levels.push(L);
      if (levels.length === 0) {
        labelsRef.current = [];
        lastKeyRef.current = key;
        return true;
      }
      const polys = contours()
        .size([cols, rows])
        .thresholds(levels)
        .smooth(true)(vals as unknown as number[]);

      const { lon0, lat0, lon1, lat1 } = m.domain;
      const cands: Label[] = [];
      const emit = (text: string, x: number, y: number) => {
        // 域边界附近：d3 沿边闭合的伪线段，GPU 不画线，跳过
        if (x < EDGE || x > cols - EDGE || y < EDGE || y > rows - EDGE) return;
        const lon = lon0 + ((x - 0.5) / (cols - 1)) * (lon1 - lon0);
        const lat = lat0 + ((y - 0.5) / (rows - 1)) * (lat1 - lat0);
        cands.push({ lon, lat, text });
      };

      outer: for (const poly of polys) {
        const text = labelText(fKey, poly.value);
        for (const polygon of poly.coordinates) {
          for (const ring of polygon) {
            let prev = ring[0];
            let cum = 0; // 距上次发射已走的长度
            for (let p = 1; p < ring.length; p++) {
              const cur = ring[p];
              let seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
              while (seg + cum >= CAND_STEP) {
                const need = CAND_STEP - cum;
                const f = seg > 0 ? need / seg : 1;
                const x = prev[0] + (cur[0] - prev[0]) * f;
                const y = prev[1] + (cur[1] - prev[1]) * f;
                const rem = seg - need;
                if (rem > 1e-9) {
                  prev = [x, y];
                  seg = rem;
                } else {
                  prev = cur;
                  seg = 0;
                }
                cum = 0;
                emit(text, x, y);
                if (cands.length >= MAX_CANDS) break outer;
              }
              cum += seg;
              prev = cur;
            }
          }
        }
      }
      labelsRef.current = cands;
      lastKeyRef.current = key;
      return true;
    };

    const clearDom = () => {
      while (container.lastChild) container.lastChild.remove();
    };

    /** 逐帧投影 + 贪心避让 + 直改 DOM */
    const place = () => {
      const map = getMap();
      if (!map) return;
      const cw = map.getCanvas().clientWidth || 1;
      const ch = map.getCanvas().clientHeight || 1;
      const labels = labelsRef.current;
      const placed: { x: number; y: number }[] = [];
      const shown: { text: string; x: number; y: number }[] = [];
      for (const lb of labels) {
        let p;
        try {
          p = map.project([lb.lon, lb.lat]);
        } catch {
          continue; // setStyle 中投影可能短暂失败
        }
        if (p.x < -40 || p.x > cw + 40 || p.y < -40 || p.y > ch + 40) continue;
        let ok = true;
        for (const q of placed) {
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          if (dx * dx + dy * dy < GAP * GAP) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        placed.push({ x: p.x, y: p.y });
        shown.push({ text: lb.text, x: p.x, y: p.y });
        if (shown.length >= MAX_LABELS) break;
      }
      // 按序复用 DOM，多退少补（直改，不触发 React）
      const divs = container.children as HTMLCollectionOf<HTMLSpanElement>;
      for (let i = 0; i < shown.length; i++) {
        let el = divs[i] as HTMLSpanElement | undefined;
        if (!el) {
          el = document.createElement('span');
          el.className = 'iso-label';
          container.appendChild(el);
        }
        el.textContent = shown[i].text;
        el.style.transform = `translate(${shown[i].x}px, ${shown[i].y}px) translate(-50%, -50%)`;
      }
      while (divs.length > shown.length) divs[divs.length - 1].remove();
    };

    const update = () => {
      const o = useOverlay.getState();
      const t = useTime.getState();
      if (!o.isoOn || !t.manifest || t.manifest.timesteps.length === 0) {
        labelsRef.current = [];
        lastKeyRef.current = null;
        clearDom();
        return;
      }
      const field: OverlayField = o.field;
      // 镜像 ColorLayer 的地面层守卫：高层 + surface-only 场（或默认等压线）整层不渲染
      if (t.level !== 'sfc' &&
          ((o.isoOn && (field === 'off' || SURFACE_ONLY.has(field))) ||
           (field !== 'off' && SURFACE_ONLY.has(field)))) {
        labelsRef.current = [];
        lastKeyRef.current = null;
        clearDom();
        return;
      }
      const effLevel = effLevelOf(field, t.level);
      const fKey: FieldKey = field === 'off' ? 'prmsl' : FIELD_KEY[field];
      const fracBucket = Math.round(t.frac * 8); // 插值桶：播放拖拽时等值线位置跟随渐变
      const key = `${fKey}|${effLevel}|${t.index}|${fracBucket}`;
      if (key !== lastKeyRef.current) {
        if (!recompute(field, fKey, effLevel, t, key)) return; // 数据未就绪，下一 tick 重试
      }
      place();
    };

    const tick = (ts: number) => {
      if (disposed) return;
      if (ts - last >= STEP) {
        last = ts;
        update();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearDom();
      labelsRef.current = [];
      lastKeyRef.current = null;
    };
  }, []);

  return <div className="iso-labels" ref={wrapRef} />;
}
