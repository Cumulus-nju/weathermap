import { useEffect, useRef, useState } from 'react';

// M0 验收指标：100k 粒子 @60fps（FPS 徽章挂在角落）
export function FpsMeter() {
  const [fps, setFps] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frames++;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return <div className="fps-badge" title="每秒帧数（越接近显示器刷新率越流畅）">{fps} fps</div>;
}
