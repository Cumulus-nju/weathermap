import {
  useWindSettings, useOverlay, useUnits, useTheme, SURFACE_ONLY,
  type OverlayField, type Theme,
} from '../store';
import { WIND_UNITS, TEMP_UNITS } from '../lib/units';
import { LEVELS } from '../lib/dataLoader';
import { useTime, levelLabel } from '../lib/timeStore';
import { applyTheme } from '../lib/basemap';
import { getMap } from '../lib/mapStore';

// M0 控制面板：粒子数 / 速度 / 尾迹 / 亮度，全部走 zustand（不触发 React 重渲染的风层）
// 渲染循环在 WindLayer.render 里直接读 store.getState()，这里只管滑块 UI
// M3：顶部加气压层切换（等压面 + 地面）

// 芯片短标签：地面显示"地面"，等压面只显示数字（" hPa" 由面板标题隐含）
function chipLabel(level: (typeof LEVELS)[number]): string {
  return level === 'sfc' ? '地面' : `${level}`;
}

function LevelChips() {
  const level = useTime((s) => s.level);
  const setLevel = useTime((s) => s.setLevel);
  return (
    <div className="level-row" title="气压层">
      {LEVELS.map((l) => (
        <button
          key={String(l)}
          className={`level-chip${l === level ? ' on' : ''}`}
          onClick={() => setLevel(l)}
          title={levelLabel(l)}
        >
          {chipLabel(l)}
        </button>
      ))}
    </div>
  );
}

// M4 叠加图层选择（温度/湿度/降水）+ 不透明度
// M5：新增 阵风/露点/总云/低云/中云/高云，全是 surface-only —— 选中时若不在地面层自动切过去
const OVERLAY_OPTS: { id: OverlayField; label: string }[] = [
  { id: 'off', label: '关' },
  { id: 'temp', label: '温度' },
  { id: 'rh', label: '湿度' },
  { id: 'apcp', label: '降水' },
  { id: 'gust', label: '阵风' },
  { id: 'dpt', label: '露点' },
  { id: 'pressure', label: '气压' },
  { id: 'tcdc', label: '总云' },
  { id: 'lcdc', label: '低云' },
  { id: 'mcdc', label: '中云' },
  { id: 'hcdc', label: '高云' },
];

function OverlayChips() {
  const field = useOverlay((s) => s.field);
  const setField = useOverlay((s) => s.setField);
  const level = useTime((s) => s.level);
  const setLevel = useTime((s) => s.setLevel);
  const onSelect = (id: OverlayField) => {
    if (id !== 'off' && SURFACE_ONLY.has(id) && level !== 'sfc') setLevel('sfc');
    setField(id);
  };
  return (
    <div className="level-row level-row2" title="叠加图层（色斑）">
      {OVERLAY_OPTS.map((o) => (
        <button
          key={o.id}
          className={`level-chip${field === o.id ? ' on' : ''}`}
          onClick={() => onSelect(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// M5 等值线 toggle：独立开关，不占色斑芯片。
// M7-4 等值线跟随当前色斑字段（temp/rh 可在当前气压层画）；只有字段为 off（默认等压线）
// 或 surface-only 字段时才强制切到地面层。
function IsoToggle() {
  const isoOn = useOverlay((s) => s.isoOn);
  const setIsoOn = useOverlay((s) => s.setIsoOn);
  const field = useOverlay((s) => s.field);
  const level = useTime((s) => s.level);
  const setLevel = useTime((s) => s.setLevel);
  return (
    <label className="ctrl-row toggle">
      <span>等值线</span>
      <button
        className={`toggle-btn${isoOn ? ' on' : ''}`}
        onClick={() => {
          if (!isoOn && level !== 'sfc' && (field === 'off' || SURFACE_ONLY.has(field)))
            setLevel('sfc');
          setIsoOn(!isoOn);
        }}
      >
        {isoOn ? '开' : '关'}
      </button>
    </label>
  );
}

// M5 底图主题（暗色/亮色）：切换 store + 应用到地图（setStyle 触发 style.load 重挂自定义层）
const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark', label: '暗色' },
  { id: 'light', label: '亮色' },
];

function ThemeRow() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  return (
    <>
      <div className="panel-title panel-title2">主题</div>
      <div className="level-row level-row2" title="底图主题">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`level-chip${theme === t.id ? ' on' : ''}`}
            onClick={() => {
              setTheme(t.id);
              const map = getMap();
              if (map) applyTheme(map, t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </>
  );
}

function OverlayOpacity() {
  const field = useOverlay((s) => s.field);
  const opacity = useOverlay((s) => s.opacity);
  const setOpacity = useOverlay((s) => s.setOpacity);
  if (field === 'off') return null;
  return (
    <Slider
      label="透明度"
      value={opacity}
      min={0.15}
      max={1}
      step={0.05}
      format={(v) => `${(v * 100).toFixed(0)}%`}
      onChange={setOpacity}
    />
  );
}

// M4-2 单位切换：风（m/s↔km/h↔节）+ 温度（℃↔℉）
function UnitRow() {
  const wind = useUnits((s) => s.wind);
  const setWind = useUnits((s) => s.setWind);
  const temp = useUnits((s) => s.temp);
  const setTemp = useUnits((s) => s.setTemp);
  return (
    <>
      <div className="panel-title panel-title2">单位</div>
      <div className="level-row" title="风速单位">
        {WIND_UNITS.map((u) => (
          <button
            key={u.id}
            className={`level-chip${wind === u.id ? ' on' : ''}`}
            onClick={() => setWind(u.id)}
          >
            {u.label}
          </button>
        ))}
      </div>
      <div className="level-row level-row2" title="温度单位">
        {TEMP_UNITS.map((u) => (
          <button
            key={u.id}
            className={`level-chip${temp === u.id ? ' on' : ''}`}
            onClick={() => setTemp(u.id)}
          >
            {u.label}
          </button>
        ))}
      </div>
    </>
  );
}

// M4-2 风粒子配色预设（与 shaders DRAW_FRAG 的 pal* 一一对应）
const PALETTES = [
  { id: 0, label: '标准' },
  { id: 1, label: '极光' },
  { id: 2, label: '白' },
  { id: 3, label: '珊瑚' },
];

function PaletteChips() {
  const palette = useWindSettings((s) => s.palette);
  const setPalette = useWindSettings((s) => s.setPalette);
  return (
    <div className="level-row" title="风粒子配色">
      {PALETTES.map((p) => (
        <button
          key={p.id}
          className={`level-chip${palette === p.id ? ' on' : ''}`}
          onClick={() => setPalette(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label, value, min, max, step, format, onChange, disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`ctrl-row${disabled ? ' ctrl-disabled' : ''}`}>
      <span className="ctrl-label">{label}</span>
      <input
        className="ctrl-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="ctrl-value">{format ? format(value) : value}</span>
    </label>
  );
}

export function ControlPanel() {
  const {
    enabled, particleCount, autoParticles, speed, fade, streak,
    setEnabled, setParticleCount, setAutoParticles, setSpeed, setFade, setStreak,
  } = useWindSettings();

  return (
    <div className="panel">
      <div className="panel-title">气压层</div>
      <LevelChips />
      <div className="panel-title panel-title2">叠加图层</div>
      <OverlayChips />
      <IsoToggle />
      <OverlayOpacity />
      <UnitRow />
      <ThemeRow />
      <div className="panel-title panel-title2">风场粒子</div>
      <label className="ctrl-row toggle">
        <span>动画</span>
        <button
          className={enabled ? 'toggle-btn on' : 'toggle-btn'}
          onClick={() => setEnabled(!enabled)}
        >
          {enabled ? '开' : '关'}
        </button>
      </label>
      <label className="ctrl-row toggle">
        <span>粒子数自动</span>
        <button
          className={autoParticles ? 'toggle-btn on' : 'toggle-btn'}
          onClick={() => setAutoParticles(!autoParticles)}
        >
          {autoParticles ? '开' : '关'}
        </button>
      </label>
      <Slider
        label="粒子数"
        value={particleCount}
        min={10_000}
        max={200_000}
        step={5_000}
        format={(v) => `${(v / 1000).toFixed(0)}k`}
        onChange={setParticleCount}
        disabled={autoParticles}
      />
      <PaletteChips />
      <Slider
        label="流速"
        value={speed}
        min={0.2}
        max={4}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        onChange={setSpeed}
      />
      <Slider
        label="尾迹"
        value={fade}
        min={0.85}
        max={0.995}
        step={0.005}
        format={(v) => `${v.toFixed(3)}`}
        onChange={setFade}
      />
      <Slider
        label="亮度"
        value={streak}
        min={0.2}
        max={2}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        onChange={setStreak}
      />
    </div>
  );
}
