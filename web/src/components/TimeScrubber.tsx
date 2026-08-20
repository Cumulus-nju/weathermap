import { useEffect, useState, type CSSProperties } from 'react';
import { useTime } from '../lib/timeStore';

// M2 时间轴：scrubber（拖动实时预览）+ 播放/暂停 + 插值有效时间标签
// 渲染循环以 60fps 写 store；这里用 rAF 节流到 ~20Hz 同步到 React，避免每帧重渲染
const TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return TIME_FMT.format(d);
}

export function TimeScrubber() {
  const manifest = useTime((s) => s.manifest);
  const [ui, setUi] = useState({ index: 0, frac: 0, playing: true });

  // 节流订阅 store（index/frac/playing 任一变化即触发）
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const sync = () => {
      raf = 0;
      const now = performance.now();
      if (now - last >= 50) {
        last = now;
        const s = useTime.getState();
        setUi({ index: s.index, frac: s.frac, playing: s.playing });
      }
    };
    const unsub = useTime.subscribe(() => {
      if (!raf) raf = requestAnimationFrame(sync);
    });
    return () => {
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  if (!manifest || manifest.timesteps.length === 0) return null;
  const n = manifest.timesteps.length;
  const v = Math.min(ui.index + ui.frac, n - 1);
  const pct = (v / (n - 1)) * 100;
  const step = manifest.timesteps[Math.min(ui.index, n - 1)];
  const next = manifest.timesteps[Math.min(ui.index + 1, n - 1)];
  const label = n > 1 ? `${fmt(step.validTime)} → ${fmt(next.validTime)}` : fmt(step.validTime);

  const onScrub = (val: number) => {
    const f = Math.max(0, Math.min(val, n - 1)); // 拖到末端 frac 归零，避免跨时次混入
    useTime.getState().setPlayhead(Math.floor(f), f - Math.floor(f));
  };
  const handleDown = () => {
    const s = useTime.getState();
    if (s.playing) s.togglePlay(); // 拖动时暂停，松手后用户可手动恢复播放
  };

  return (
    <div className="scrubber">
      <button
        className={`scrub-play ${ui.playing ? 'on' : ''}`}
        onClick={() => useTime.getState().togglePlay()}
        title={ui.playing ? '暂停自动播放' : '开始自动播放'}
        aria-label={ui.playing ? '暂停' : '播放'}
      >
        {ui.playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        className="scrub-range"
        min={0}
        max={n - 1}
        step={0.001}
        value={v}
        onPointerDown={handleDown}
        onInput={(e) => onScrub(parseFloat(e.currentTarget.value))}
        style={{ '--scrub-pct': `${pct}%` } as CSSProperties}
      />
      <div className="scrub-time">{label}</div>
    </div>
  );
}
