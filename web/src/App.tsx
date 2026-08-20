import { useEffect, useRef } from 'react';
import { createMap } from './map/createMap';
import { ControlPanel } from './components/ControlPanel';
import { FpsMeter } from './components/FpsMeter';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = createMap(containerRef.current);
    return () => map.remove();
  }, []);

  return (
    <div className="app">
      <div ref={containerRef} className="map-container" />
      <FpsMeter />
      <ControlPanel />
      <div className="watermark">自研 Windy · M0 合成数据</div>
    </div>
  );
}
