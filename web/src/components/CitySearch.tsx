import { useMemo, useRef, useState } from 'react';
import { searchCities, type City } from '../lib/cities';
import { usePlaces } from '../store';
import { getMap } from '../lib/mapStore';
import { usePointer } from '../lib/pointerStore';

// M5 城市搜索 + 收藏：内置城市库按 中文/拼音 子串过滤（无外部 API）。
// 点击结果 flyTo 到城市 + 打开读数卡；星标收藏持久化到 localStorage。

export function CitySearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { favorites, toggleFavorite, isFavorite } = usePlaces();
  const results = useMemo(() => (q.trim() ? searchCities(q) : []), [q]);

  /** 跳到某城市：flyTo + 动画结束后按投影坐标打开读数卡 */
  const jump = (c: City) => {
    const map = getMap();
    setQ('');
    setOpen(false);
    if (!map) return;
    map.flyTo({ center: [c.lon, c.lat], zoom: 6, duration: 900 });
    map.once('moveend', () => {
      const pt = map.project([c.lon, c.lat]);
      usePointer.getState().move(c.lon, c.lat, pt.x, pt.y);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'Enter' && results.length > 0) {
      jump(results[0]);
    }
  };

  return (
    <div className="city-search">
      <input
        ref={inputRef}
        className="city-input"
        placeholder="搜索城市（中文/拼音）"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && q.trim() !== '' && (
        <div className="city-drop">
          {results.length === 0 && <div className="city-empty">未找到城市</div>}
          {results.map((c) => (
            <div key={`${c.lon},${c.lat}`} className="city-item" onMouseDown={() => jump(c)}>
              <span className="city-name">{c.name}</span>
              <span className="city-meta">
                {c.country} · {c.lat.toFixed(1)}°{c.lat >= 0 ? 'N' : 'S'} {c.lon.toFixed(1)}°E
              </span>
              <button
                className={`fav-btn${isFavorite(c) ? ' on' : ''}`}
                title={isFavorite(c) ? '取消收藏' : '收藏'}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  toggleFavorite(c);
                }}
              >
                {isFavorite(c) ? '★' : '☆'}
              </button>
            </div>
          ))}
        </div>
      )}
      {favorites.length > 0 && (
        <div className="fav-list">
          {favorites.map((c) => (
            <button
              key={`${c.lon},${c.lat}`}
              className="fav-chip"
              title={`${c.name} · ${c.country}`}
              onClick={() => jump(c)}
            >
              {c.name}
              <span
                className="fav-x"
                role="button"
                title="取消收藏"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(c);
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
