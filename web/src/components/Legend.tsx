import { useEffect, useState } from 'react';
import { useOverlay, useUnits, useTheme, SURFACE_ONLY, type OverlayField } from '../store';
import { useTime } from '../lib/timeStore';
import { getGrid } from '../lib/dataLoader';
import { CMAPS, cmapToCss, fieldValueRange, ISO_LABEL, type Colormap } from '../lib/colormaps';
import { tempFromK, tempUnitLabel } from '../lib/units';

// M4 图例：当前叠加层的色带 + 量程。与 ColorLayer 同源（CMAPS），所见即所渲。
// 温度/湿度量程固定（数据未加载也可显示）；降水自适应当前网格最大值（未就绪时显示占位量程）。
// M4-2：温度量程/单位标签随 useUnits 切换 ℃↔℉。
// M5：等压线开关也在这显示（4 hPa 色样）；露点走温度换算、云量走 %。

interface LegendState {
  cmap: Colormap | null;
  iso: boolean;
  min: string;
  max: string;
}

function fmtVal(field: Colormap['id'], v: number): string {
  if (field === 'temp' || field === 'dpt')
    return `${Math.round(tempFromK(v, useUnits.getState().temp))}°`;
  if (field === 'pressure') return `${Math.round(v / 100)}`; // Pa → hPa 显示
  return `${Math.round(v)}`;
}

export function Legend() {
  const [state, setState] = useState<LegendState | null>(null);
  const tempUnit = useUnits((s) => s.temp); // 温度单位切换时重渲染（标题 + 量程数字）

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 100) return; // ~10Hz 足够（量程只在数据/层/时次变化时变）
      last = now;

      const o = useOverlay.getState();
      const iso = o.isoOn;
      const t = useTime.getState();
      const m = t.manifest;
      if (!m || m.timesteps.length === 0) return;
      // M7-4 等值线跟随图层：temp/rh 有高层数据 → 当前气压层也可显示；
      // 其余（field=off 的默认等压线 + surface-only 字段）只在地面层有，与 ColorLayer 守卫同步
      if (t.level !== 'sfc' &&
          ((o.isoOn && o.field === 'off') || (o.field !== 'off' && SURFACE_ONLY.has(o.field)))) {
        setState(null);
        return;
      }
      if (o.field === 'off') {
        // 仅等压线开 → 显示等压线图例
        setState(iso ? { cmap: null, iso: true, min: '', max: '' } : null);
        return;
      }
      const cmap = CMAPS[o.field];
      const n = m.timesteps.length;
      const i = Math.min(Math.max(t.index, 0), n - 1);
      const f0 = m.timesteps[i];
      const f1 = m.timesteps[(i + 1) % n];
      const g0 = getGrid(t.level, f0.fxx);
      const g1 = getGrid(t.level, f1.fxx);
      let range: [number, number];
      if (o.field === 'apcp') {
        if (!g0 && !g1) range = [0, 20]; // 数据未就绪占位
        else range = fieldValueRange(o.field, [g0, g1]);
      } else {
        range = fieldValueRange(o.field, []);
      }
      setState({ cmap, iso, min: fmtVal(o.field, range[0]), max: fmtVal(o.field, range[1]) });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!state) return null;
  const theme = useTheme.getState().theme;
  // 等压线色样跟随主题（与 ColorLayer 的 u_isoColor 同源）
  const isoColor = theme === 'light' ? 'rgba(64, 74, 100, 0.95)' : 'rgba(242, 235, 218, 0.95)';
  return (
    <div className="legend">
      <div className="legend-title">
        {state.cmap ? state.cmap.name : '等压线'}
        {state.cmap && (
          <span className="legend-unit">
            ({state.cmap.id === 'temp' || state.cmap.id === 'dpt' ? tempUnitLabel(tempUnit) : state.cmap.unit})
          </span>
        )}
        {state.iso && (
          <span className="legend-iso">{state.cmap ? ` · ${ISO_LABEL[state.cmap.id as Exclude<OverlayField, 'off'>]}` : ISO_LABEL.pressure}</span>
        )}
      </div>
      <div className="legend-row">
        <div
          className="legend-bar"
          style={
            state.cmap
              ? { background: `linear-gradient(to top, ${cmapToCss(state.cmap)})` }
              : { background: isoColor, borderColor: 'rgba(255,255,255,0.2)' }
          }
        />
        <div className="legend-scale">
          {state.cmap ? (
            <>
              <span>{state.max}</span>
              <span>{state.min}</span>
            </>
          ) : (
            <span>等值线</span>
          )}
        </div>
      </div>
    </div>
  );
}
