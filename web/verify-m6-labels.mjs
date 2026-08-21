// M6 城市标注 + 海岸线验收（真 GPU d3d11）：
//   1) 默认视角(zoom3 东亚)出现城市标注，含 北京/上海/东京 等 tier0
//   2) 标注位置 ≈ map.project 投影位置（错位 <8px）
//   3) 亮色主题切回后标注仍在、颜色按主题
//   4) flyTo 北京 zoom6 → 更多标注（tier1 城市出现）
//   5) console 无 error
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5174/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m6.png';
const FAILS = [];
let pass = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { FAILS.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

console.log('== M6 城市标注验收 ==');
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.city-label', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);

// ---- 1) 默认视角标注 ----
console.log('-- 1. 默认视角标注 --');
const labels = await page.evaluate(() =>
  [...document.querySelectorAll('.city-label')].map((el) => el.textContent),
);
console.log(`  标签(${labels.length}): ${labels.slice(0, 40).join(' ')}`);
check('出现标注', labels.length >= 8, `count=${labels.length}`);
for (const c of ['北京', '上海', '东京', '首尔']) {
  check(`含 ${c}`, labels.includes(c));
}

// ---- 2) 位置对齐 ----
console.log('-- 2. 标注位置对齐 --');
const posErr = await page.evaluate((beijing) => {
  const m = window.__map;
  const el = [...document.querySelectorAll('.city-label')].find((e) => e.textContent === beijing);
  if (!el) return null;
  const mt = el.style.transform;
  const x = parseFloat(mt.match(/translate\(([-\d.]+)px/)?.[1]);
  const y = parseFloat(mt.match(/translate\([-\d.]+px, ([-\d.]+)px/)?.[1]);
  const p = m.project([116.4, 39.9]);
  return { x, y, px: p.x, py: p.y, dx: x - p.x, dy: y - p.y };
}, '北京');
check('北京标注与投影对齐', posErr && Math.abs(posErr.dx) < 8 && Math.abs(posErr.dy) < 8,
  JSON.stringify(posErr));

await page.screenshot({ path: shot.replace('.png', '-dark.png') });

// ---- 3) 亮色主题 ----
console.log('-- 3. 亮色主题 --');
await page.locator('.panel .level-chip', { hasText: '亮色' }).click();
await page.waitForTimeout(1500);
const theme = await page.evaluate(() => document.body.dataset.theme);
check('body.dataset.theme=light', theme === 'light', `theme=${theme}`);
const labelsLight = await page.evaluate(() => document.querySelectorAll('.city-label').length);
check('亮色下标注仍在', labelsLight >= 8, `count=${labelsLight}`);
const labelColor = await page.evaluate(() => {
  const el = document.querySelector('.city-label');
  return el ? getComputedStyle(el).color : '';
});
check('标注色随主题变深', /rgb\((\d+), (\d+), (\d+)\)/.test(labelColor) &&
  parseInt(labelColor.match(/\d+/)[0]) < 120, labelColor);
await page.screenshot({ path: shot.replace('.png', '-light.png') });
await page.locator('.panel .level-chip', { hasText: '暗色' }).click();
await page.waitForTimeout(1200);

// ---- 4) flyTo 北京 zoom6 ----
console.log('-- 4. flyTo 北京 zoom6 --');
await page.evaluate(() => {
  window.__map.flyTo({ center: [116.4, 39.9], zoom: 6, duration: 800 });
});
await page.waitForTimeout(2000);
const labelsZoom6 = await page.evaluate(() =>
  [...document.querySelectorAll('.city-label')].map((el) => el.textContent),
);
console.log(`  zoom6 标签(${labelsZoom6.length}): ${labelsZoom6.slice(0, 30).join(' ')}`);
// zoom6 中心北京的可视框 ≈ 14°×7°(北纬40° mercator 纵向收窄)，框内数据集恰有 8 城——全部出现即达标
check('zoom6 展示全部框内城市', labelsZoom6.length >= 8, `count=${labelsZoom6.length}`);
for (const c of ['天津', '太原', '济南', '石家庄']) {
  check(`zoom6 含 ${c}`, labelsZoom6.includes(c));
}
await page.screenshot({ path: shot.replace('.png', '-zoom6.png') });

// ---- 5) 长三角 zoom7 密度 ----
console.log('-- 5. 长三角 zoom7 --');
await page.evaluate(() => {
  window.__map.flyTo({ center: [121.0, 31.0], zoom: 7, duration: 800 });
});
await page.waitForTimeout(2000);
const labelsZoom7 = await page.evaluate(() =>
  [...document.querySelectorAll('.city-label')].map((el) => el.textContent),
);
console.log(`  zoom7 标签(${labelsZoom7.length}): ${labelsZoom7.slice(0, 30).join(' ')}`);
check('zoom7 长三角多城', labelsZoom7.length >= 5, `count=${labelsZoom7.length}`);
for (const c of ['上海', '苏州', '杭州']) {
  check(`zoom7 含 ${c}`, labelsZoom7.includes(c));
}
await page.screenshot({ path: shot.replace('.png', '-zoom7.png') });

// ---- 6) console ----
console.log('-- 6. console --');
const errs = logs.filter((l) => /error|fail/i.test(l) && !/favicon/i.test(l));
check('无 error/pageerror/reqfail', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 20).join('\n'));

await browser.close();
console.log(`\n== 结果: ${pass} 通过, ${FAILS.length} 失败 ==`);
if (FAILS.length) {
  console.log('失败项:', FAILS.join(', '));
  process.exit(1);
}
