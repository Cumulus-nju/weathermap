import { useEffect, useRef } from 'react';
import { getMap } from '../lib/mapStore';
import { CITIES } from '../lib/cities';

// M6 城市标注：DOM 覆盖层（不用 MapLibre symbol 层——离线没有 CJK glyph PBF，
// 直接复用页面系统字体）。rAF 节流投影 + tier 分级 + 贪心避让，
// 全走 ref 直改 DOM、不触发 React 重渲染（与 ValueCard 同模式）。
// tier 门槛见 lib/cities.ts（0=世界大城市 2.5 / 1=亚洲区域性 4 / 2=其余 6）。

const TIER_ZOOM: Record<number, number> = { 0: 2.5, 1: 4, 2: 6 };
const MARGIN = 12; // 屏幕边缘留白（px），避免标签突然闪现/消失
const W = 64;      // 避让占位半宽（px）
const H = 18;      // 避让占位半高（px）
const GAP = 6;     // 标签之间最小间距（px）
const STEP = 100;  // 更新节流（ms）≈10Hz，拖拽时够跟手

export function CityLabels() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const elsRef = useRef<Map<string, HTMLSpanElement>>(new Map());

  useEffect(() => {
    const container = wrapRef.current;
    if (!container) return;
    let raf = 0;
    let last = 0;
    let disposed = false;

    const update = () => {
      const map = getMap();
      if (!map) return;
      const zoom = map.getZoom();
      const cw = map.getCanvas().clientWidth || 1;
      const ch = map.getCanvas().clientHeight || 1;

      // 候选：满足 tier 门槛 + 投影在屏内（含留白）
      const cands: { key: string; c: (typeof CITIES)[number]; x: number; y: number }[] = [];
      for (const c of CITIES) {
        if (zoom < TIER_ZOOM[c.tier]) continue;
        let p;
        try {
          p = map.project([c.lon, c.lat]);
        } catch {
          continue; // setStyle 中投影可能短暂失败，跳过本帧
        }
        if (p.x < -MARGIN - W || p.x > cw + MARGIN + W) continue;
        if (p.y < -MARGIN - H || p.y > ch + MARGIN + H) continue;
        cands.push({ key: `${c.lon},${c.lat}`, c, x: p.x, y: p.y });
      }
      cands.sort((a, b) => a.c.tier - b.c.tier); // 高级别优先占位

      // 贪心避让：按序放置，与已占位重叠的低级跳过（高级别稳定先画，缩放不闪烁）
      const placed: { x: number; y: number }[] = [];
      const visible = new Set<string>();
      for (const it of cands) {
        let ok = true;
        for (const q of placed) {
          if (Math.abs(q.x - it.x) < W + GAP && Math.abs(q.y - it.y) < H + GAP) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        placed.push({ x: it.x, y: it.y });
        visible.add(it.key);
      }

      // 增删改 DOM（直改 ref，不 setState）
      const els = elsRef.current;
      const byKey = new Map(cands.map((i) => [i.key, i] as const));
      const size = Math.max(10, Math.min(14, 10 + zoom - 2)); // 随 zoom 微放大
      for (const key of visible) {
        const it = byKey.get(key);
        if (!it) continue;
        let el = els.get(key);
        if (!el) {
          el = document.createElement('span');
          el.className = 'city-label';
          el.textContent = it.c.name;
          container.appendChild(el);
          els.set(key, el);
        }
        el.style.transform = `translate(${it.x}px, ${it.y}px) translate(-50%, -50%)`;
        el.style.fontSize = `${size}px`;
      }
      for (const [key, el] of els) {
        if (!visible.has(key)) {
          el.remove();
          els.delete(key);
        }
      }
    };

    const tick = (ts: number) => {
      if (disposed) return;
      if (ts - last >= STEP) {
        last = ts;
        update();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const el of elsRef.current.values()) el.remove();
      elsRef.current.clear();
    };
  }, []);

  return <div className="city-labels" ref={wrapRef} />;
}
