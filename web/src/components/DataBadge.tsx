import { useEffect, useState } from 'react';
import { useTime } from '../lib/timeStore';

// M4-3 数据新鲜度角标：显示 GFS cycle 时间 + 数据生成距今。
// 新鲜度以 pipeline 生成时间（manifest.generated）为信号——4 次/天的调度下，
// 超 18h 未更新说明可能跳了一次 cycle，超 48h 基本是 CI 停了，变红提醒。
// 定时器每 30s 重算一次，挂机也会随时间从绿变黄再变红。

function fmtCycle(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}Z`;
}

function fmtAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟前`;
  if (hours < 48) return `${Math.round(hours)} 小时前`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return `${d} 天${h ? ` ${h}h` : ''} 前`;
}

export function DataBadge() {
  const manifest = useTime((s) => s.manifest);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!manifest) return null;
  const ageH = (now - new Date(manifest.generated).getTime()) / 3_600_000;
  if (Number.isNaN(ageH) || ageH < 0) return null;
  const level = ageH < 18 ? 'ok' : ageH < 48 ? 'warn' : 'stale';
  const label = level === 'ok' ? '正常' : level === 'warn' ? '滞后' : '过期';
  return (
    <div className={`data-badge ${level}`} title={`数据生成于 ${manifest.generated}（UTC），GFS 预报起始 ${manifest.cycle}`}>
      GFS {fmtCycle(manifest.cycle)} · {fmtAge(ageH)}
      <span className="data-badge-label">{label}</span>
    </div>
  );
}
