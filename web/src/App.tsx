import { useEffect, useRef } from 'react';
import { createMap } from './map/createMap';
import { ControlPanel } from './components/ControlPanel';
import { FpsMeter } from './components/FpsMeter';
import { TimeScrubber } from './components/TimeScrubber';
import { fetchManifest } from './lib/wmb';
import { useTime } from './lib/timeStore';

function Watermark() {
  const manifest = useTime((s) => s.manifest);
  const level = useTime((s) => s.level);
  return (
    <div className="watermark">
      自研 Windy · {manifest ? `GFS ${manifest.cycle}` : '数据加载中…'} · {level} hPa
    </div>
  );
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = createMap(containerRef.current);

    // 数据 manifest（决定渲染域与时间轴）。加载失败不阻塞地图显示，仅风层等待。
    fetchManifest()
      .then((m) => useTime.getState().setManifest(m))
      .catch((err) => console.warn('manifest 加载失败，风层不可用', err));

    return () => map.remove();
  }, []);

  return (
    <div className="app">
      <div ref={containerRef} className="map-container" />
      <FpsMeter />
      <TimeScrubber />
      <ControlPanel />
      <Watermark />
    </div>
  );
}
