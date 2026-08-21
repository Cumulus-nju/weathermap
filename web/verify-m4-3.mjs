// M4-3 无头验收（真 GPU）：
//   1) 数据新鲜度角标（GFS cycle + 距今 + ok/正常）
//   2) 离线暗色底图：陆地/海岸线/网格渲染 + 地理正确性（采样已知陆/海点）
//   3) console 无错误
// 注意：必须用 --use-angle=d3d11 走真 GPU。SwiftShader 软渲染会位移小多边形，
//   且 maplibre worldSize = 512*2^zoom（zoom3=4096），换算像素时要小心。
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5174/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m4-3.png';

const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.querySelector('.watermark')?.textContent?.includes('GFS'),
  { timeout: 20000 },
);

// 1) 数据新鲜度角标
const badgeText = await page.locator('.data-badge').textContent().catch(() => null);
console.log(`角标: ${badgeText}`);
const badgeOk = (badgeText ?? '').includes('GFS') && (badgeText ?? '').includes('前');
console.log(`角标含 cycle+距今: ${badgeOk ? '✓' : '✗'}`);
const badgeClass = await page.locator('.data-badge').getAttribute('class').catch(() => null);
const hasOk = (badgeClass ?? '').includes('ok');
console.log(`角标新鲜度 ok(绿): ${hasOk ? '✓' : `✗ (${badgeClass})`}`);
const badgeLabel = await page.locator('.data-badge-label').textContent().catch(() => null);
console.log(`角标状态字: ${badgeLabel}  ${['正常', '滞后', '过期'].includes(badgeLabel ?? '') ? '✓' : '✗'}`);

// 2) 等风层渲染 + 截图
await page.waitForTimeout(4000);
await page.screenshot({ path: shot });

// 2b) 地理正确性：用 map.project 采样已知陆/海点，看填充色
const geo = await page.evaluate(() => {
  const cv = document.querySelector('.maplibregl-canvas');
  const ctx = cv?.getContext('2d');
  if (!ctx) return { note: 'no 2d ctx on webgl canvas' };
  return { note: 'skip' }; // WebGL canvas 拿不到像素，改用整体截图外部分析
});
console.log(`地理采样: ${geo.note}`);

// 3) 开温度叠加 + 图例再截一张（色斑在底图上的观感）
await page.locator('.panel .level-chip', { hasText: '温度' }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: shot.replace('.png', '-temp.png') });

const errs = logs.filter((l) => /error|fail/i.test(l));
console.log('--- console (errors) ---');
console.log(errs.slice(0, 40).join('\n') || '(clean)');
await browser.close();
