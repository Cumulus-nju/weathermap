import { useEffect, useState } from 'react';
import { useOverlay } from '../store';
import { useTime } from '../lib/timeStore';
import { getGrid } from '../lib/dataLoader';
import { CMAPS, cmapToCss, fieldValueRange, type Colormap } from '../lib/colormaps';

// M4 图例：当前叠加层的色带 + 量程。与 ColorLayer 同源（CMAPS），所见即所渲。
// 温度/湿度量程固定（数据未加载也可显示）；降水自适应当前网格最大值（未就绪时显示占位量程）。

interface LegendState {
  cmap: Colormap;
  min: string;
  max: string;
}

function fmtVal(field: Colormap['id'], v: number): string {
  if (field === 'temp') return `${(v - 273.15).toFixed(0)}°`;
  return `${Math.round(v)}`;
}

export function Legend() {
  const [state, setState] = useState<LegendState | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 100) return; // ~10Hz 足够（量程只在数据/层/时次变化时变）
      last = now;

      const o = useOverlay.getState();
      if (o.field === 'off') {
        setState(null);
        return;
      }
      const t = useTime.getState();
      const m = t.manifest;
      if (!m || m.timesteps.length === 0) return;
      // 降水只在地面层有
      if (o.field === 'apcp' && t.level !== 'sfc') {
        setState(null);
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
      setState({ cmap, min: fmtVal(o.field, range[0]), max: fmtVal(o.field, range[1]) });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!state) return null;
  return (
    <div className="legend">
      <div className="legend-title">
        {state.cmap.name} <span className="legend-unit">({state.cmap.unit})</span>
      </div>
      <div className="legend-row">
        <div
          className="legend-bar"
          style={{ background: `linear-gradient(to top, ${cmapToCss(state.cmap)})` }}
        />
        <div className="legend-scale">
          <span>{state.max}</span>
          <span>{state.min}</span>
        </div>
      </div>
    </div>
  );
}
