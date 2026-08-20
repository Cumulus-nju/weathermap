import { useWindSettings } from '../store';
import { LEVELS } from '../lib/dataLoader';
import { useTime, levelLabel } from '../lib/timeStore';

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
function Slider({
  label, value, min, max, step, format, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="ctrl-row">
      <span className="ctrl-label">{label}</span>
      <input
        className="ctrl-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="ctrl-value">{format ? format(value) : value}</span>
    </label>
  );
}

export function ControlPanel() {
  const {
    enabled, particleCount, speed, fade, streak,
    setEnabled, setParticleCount, setSpeed, setFade, setStreak,
  } = useWindSettings();

  return (
    <div className="panel">
      <div className="panel-title">气压层</div>
      <LevelChips />
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
      <Slider
        label="粒子数"
        value={particleCount}
        min={10_000}
        max={200_000}
        step={5_000}
        format={(v) => `${(v / 1000).toFixed(0)}k`}
        onChange={setParticleCount}
      />
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
