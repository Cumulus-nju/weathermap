import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { createMap } from './map/createMap';
import { ControlPanel } from './components/ControlPanel';
import { FpsMeter } from './components/FpsMeter';
import { TimeScrubber } from './components/TimeScrubber';
import { ValueCard } from './components/ValueCard';
import { Legend } from './components/Legend';
import { DataBadge } from './components/DataBadge';
import { CitySearch } from './components/CitySearch';
import { fetchManifest } from './lib/wmb';
import { useTime, levelLabel } from './lib/timeStore';
import { usePointer } from './lib/pointerStore';
import { useTheme } from './store';
import { setMap } from './lib/mapStore';

function Watermark() {
  const manifest = useTime((s) => s.manifest);
  const level = useTime((s) => s.level);
  return (
    <div className="watermark">
      自研 Windy · {manifest ? `GFS ${manifest.cycle}` : '数据加载中…'} · {levelLabel(level)}
    </div>
  );
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = createMap(containerRef.current);
    mapRef.current = map;
    setMap(map); // M5 CitySearch 通过模块级引用 flyTo
    (window as any).__map = map; // e2e 验收用

    // M3 读数卡：指针移动写入 pointerStore（ValueCard 用自己的 rAF 循环节流读取）
    map.on('mousemove', (e: MapMouseEvent) => {
      usePointer.getState().move(e.lngLat.lng, e.lngLat.lat, e.point.x, e.point.y);
    });
    map.on('mouseleave', () => usePointer.getState().leave());

    // 数据 manifest（决定渲染域与时间轴）。加载失败不阻塞地图显示，仅风层等待。
    fetchManifest()
      .then((m) => useTime.getState().setManifest(m))
      .catch((err) => console.warn('manifest 加载失败，风层不可用', err));

    return () => {
      map.remove();
      setMap(null);
      mapRef.current = null;
    };
  }, []);

  // M5 亮色主题：body dataset 给全局样式切换（水面/陆地等 UI 文字对比度）
  useEffect(() => {
    const sub = useTheme.subscribe((s) => {
      document.body.dataset.theme = s.theme;
    });
    document.body.dataset.theme = useTheme.getState().theme;
    return () => sub();
  }, []);

  return (
    <div className="app">
      <div ref={containerRef} className="map-container" />
      <FpsMeter />
      <DataBadge />
      <CitySearch />
      <TimeScrubber />
      <ControlPanel />
      <Watermark />
      <ValueCard />
      <Legend />
    </div>
  );
}
