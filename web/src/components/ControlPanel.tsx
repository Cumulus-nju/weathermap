import { useWindSettings } from '../store';

// M0 控制面板：粒子数 / 速度 / 尾迹 / 亮度，全部走 zustand（不触发 React 重渲染的风层）
// 渲染循环在 WindLayer.render 里直接读 store.getState()，这里只管滑块 UI
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
      <div className="panel-title">风场粒子</div>
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
