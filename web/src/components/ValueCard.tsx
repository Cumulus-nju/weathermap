import { useEffect, useState } from 'react';
import { usePointer } from '../lib/pointerStore';
import { useTime, levelLabel } from '../lib/timeStore';
import { useUnits } from '../store';
import { getGrid } from '../lib/dataLoader';
import { sampleField } from '../lib/grid';
import { windSpeed, windUnitLabel, tempFromC, tempUnitLabel } from '../lib/units';

// M3 读数卡：指针移动时双线性采样 (层, 当前时次/下一时次) 的网格，按播放头 frac 插值。
// 用 rAF ~20Hz 节流读 zustand，不触发地图渲染循环；卡上数值随拖动实时更新。

type Field = 'u' | 'v' | 't' | 'rh' | 'prmsl' | 'apcp';

interface Readout {
  x: number;
  y: number;
  lat: number;
  lon: number;
  /** 风速 m/s */
  speed: number | null;
  /** 风向（来自向，0=北顺时针） */
  dir: number | null;
  dirText: string | null;
  /** 温度 ℃ */
  temp: number | null;
  /** 相对湿度 % */
  rh: number | null;
  /** 海平面气压 hPa（仅地面） */
  prmsl: number | null;
  /** 3h 累积降水 mm（仅地面） */
  apcp: number | null;
  isSfc: boolean;
  level: string;
  validTime: string;
}

function lerp(a: number | null, b: number | null, f: number): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + (b - a) * f;
}

const DIRS = ['北', '北东北', '东北', '东东北', '东', '东东南', '东南', '南东南', '南', '南西南', '西南', '西西南', '西', '西西北', '西北', '北西北'];

function dirText(deg: number): string {
  return DIRS[Math.round(deg / 22.5) % 16];
}

/** ISO 有效时间 -> 本地时间（UTC+8），与时间轴标签一致 */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

export function ValueCard() {
  const [ro, setRo] = useState<Readout | null>(null);
  const { wind: windUnit, temp: tempUnit } = useUnits();

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 50) return; // ~20Hz，够读数卡刷新又不烧 CPU
      last = now;

      const p = usePointer.getState();
      if (!p.visible) {
        setRo(null); // null===null 不触发重渲染，安全
        return;
      }
      const t = useTime.getState();
      const m = t.manifest;
      if (!m || m.timesteps.length === 0) return;
      const n = m.timesteps.length;
      const i = Math.min(Math.max(t.index, 0), n - 1);
      const f0 = m.timesteps[i];
      const f1 = m.timesteps[(i + 1) % n];
      const g0 = getGrid(t.level, f0.fxx);
      const g1 = getGrid(t.level, f1.fxx);
      if (!g0 && !g1) return; // 该层数据未加载完，等下一帧
      const fr = t.frac;
      const s = (f: Field): number | null =>
        lerp(g0 ? sampleField(g0, p.lon, p.lat, f) : null, g1 ? sampleField(g1, p.lon, p.lat, f) : null, fr);

      const u = s('u');
      const v = s('v');
      let speed: number | null = null;
      let dir: number | null = null;
      if (u !== null && v !== null) {
        speed = Math.hypot(u, v);
        dir = (Math.atan2(-u, -v) * 180) / Math.PI; // 风向 = 与"北"顺时针夹角
        dir = (dir + 360) % 360;
      }
      const temp = s('t');
      const rh = s('rh');
      const prmsl = s('prmsl');
      const apcp = s('apcp');
      const g = g0 ?? g1;
      setRo({
        x: p.x, y: p.y,
        lat: p.lat, lon: p.lon,
        speed, dir,
        dirText: dir === null ? null : dirText(dir),
        temp: temp === null ? null : temp - 273.15,
        rh,
        prmsl: prmsl === null ? null : prmsl / 100,
        apcp,
        isSfc: t.level === 'sfc',
        level: levelLabel(t.level),
        validTime: g?.validTime ?? '',
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!ro) return null;

  // 指针在右/下半屏时卡片翻转到左/上方，避免出屏
  const flipX = ro.x > window.innerWidth / 2;
  const flipY = ro.y > window.innerHeight / 2;
  const style: React.CSSProperties = {
    left: flipX ? undefined : ro.x + 14,
    right: flipX ? window.innerWidth - ro.x + 14 : undefined,
    top: flipY ? undefined : ro.y + 14,
    bottom: flipY ? window.innerHeight - ro.y + 14 : undefined,
  };

  return (
    <div className="value-card" style={style}>
      <div className="vc-head">
        <span className="vc-level">{ro.level}</span>
        <span className="vc-coords">
          {ro.lat >= 0 ? `${ro.lat.toFixed(2)}°N` : `${(-ro.lat).toFixed(2)}°S`} ·{' '}
          {ro.lon.toFixed(2)}°E
        </span>
      </div>
      <div className="vc-row vc-wind">
        <span className="vc-key">风</span>
        <span className="vc-val">
          {ro.speed === null ? '—' : `${windSpeed(ro.speed, windUnit).toFixed(1)} ${windUnitLabel(windUnit)}`}
          {ro.dir !== null && ` · ${ro.dirText}(${ro.dir.toFixed(0)}°)`}
        </span>
      </div>
      <div className="vc-row">
        <span className="vc-key">温度</span>
        <span className="vc-val">
          {ro.temp === null ? '—' : `${tempFromC(ro.temp, tempUnit).toFixed(1)} ${tempUnitLabel(tempUnit)}`}
        </span>
      </div>
      <div className="vc-row">
        <span className="vc-key">湿度</span>
        <span className="vc-val">{ro.rh === null ? '—' : `${ro.rh.toFixed(0)} %`}</span>
      </div>
      {ro.isSfc && (
        <div className="vc-row">
          <span className="vc-key">海压</span>
          <span className="vc-val">{ro.prmsl === null ? '—' : `${ro.prmsl.toFixed(1)} hPa`}</span>
        </div>
      )}
      {ro.isSfc && (
        <div className="vc-row">
          <span className="vc-key">降水</span>
          <span className="vc-val">{ro.apcp === null ? '—' : `${ro.apcp.toFixed(1)} mm`}</span>
        </div>
      )}
      <div className="vc-foot">{fmtTime(ro.validTime)} 数据时次</div>
    </div>
  );
}
