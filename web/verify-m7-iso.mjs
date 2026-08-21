// M7-4 等值线跟随图层 + 气压色斑字段验收（真 GPU d3d11）：
//   1) 面板有 气压 芯片、等值线 toggle
//   2) 温度色斑 + 等值线 同开 → 图上叠等值线（截图 + look.py 判向）
//   3) 气压色斑开 → 图例显示 hPa 量程；等值线跟随 → 图例追加 ISO_LABEL
//   4) 850hPa + 温度 + 等值线 → 仍渲染（temp 有高层数据，不再强制切 sfc）
//   5) console 无 error
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5174/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m7-4.png';
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

console.log('== M7-4 等值线跟随图层 ==');
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500); // 数据 + 粒子就绪

// ---- 1) 面板元素 ----
console.log('-- 1. 面板元素 --');
const chips = await page.evaluate(() => [...document.querySelectorAll('.level-chip')].map((e) => e.textContent));
check('有 气压 芯片', chips.includes('气压'));
check('有 温度 芯片', chips.includes('温度'));
const toggles = await page.evaluate(() => [...document.querySelectorAll('.toggle span')].map((e) => e.textContent));
check('有 等值线 toggle', toggles.some((t) => t.includes('等值线')));
console.log(`  芯片(${chips.length}): ${chips.join(' ')}`);

// ---- 2) 温度 + 等值线 ----
console.log('-- 2. 温度色斑 + 等值线 --');
await page.locator('.level-chip', { hasText: '温度' }).click();
await page.waitForTimeout(800);
await page.locator('.toggle span', { hasText: '等值线' }).locator('..').locator('.toggle-btn').click();
await page.waitForTimeout(1200);
const legend = await page.evaluate(() => document.querySelector('.legend')?.textContent ?? '');
console.log(`  图例: ${legend}`);
check('图例含 温度', legend.includes('温度'));
check('图例含 ISO_LABEL(temp)', legend.includes('等值线 5℃'));
await page.screenshot({ path: shot.replace('.png', '-temp-iso.png') });

// ---- 3) 气压色斑 ----
console.log('-- 3. 气压色斑 + 等压线 --');
await page.locator('.level-chip', { hasText: '气压' }).click();
await page.waitForTimeout(1200);
const legend2 = await page.evaluate(() => document.querySelector('.legend')?.textContent ?? '');
console.log(`  图例: ${legend2}`);
check('图例含 气压', legend2.includes('气压'));
check('图例含 hPa 单位', legend2.includes('hPa'));
check('图例含 等压线 4 hPa', legend2.includes('等压线 4 hPa'));
const sfcChip = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.level-chip')];
  return els.find((e) => e.textContent === '地面')?.className.includes('on');
});
check('气压自动切地面层', sfcChip === true);
await page.screenshot({ path: shot.replace('.png', '-pressure-iso.png') });

// ---- 4) 850hPa + 温度 + 等值线（不强制切 sfc）----
console.log('-- 4. 850hPa 温度等值线 --');
await page.locator('.level-chip', { hasText: '850' }).click();
await page.waitForTimeout(500);
await page.locator('.level-chip', { hasText: '温度' }).click();
await page.waitForTimeout(1200);
const sfcChip2 = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.level-chip')];
  return els.find((e) => e.textContent === '地面')?.className.includes('on');
});
const legend3 = await page.evaluate(() => document.querySelector('.legend')?.textContent ?? '');
check('850hPa 下不切地面层', sfcChip2 !== true, `sfc=${sfcChip2}`);
check('850hPa 图例仍在', legend3.includes('温度'));
await page.screenshot({ path: shot.replace('.png', '-850-temp-iso.png') });

// ---- 5) console ----
console.log('-- 5. console --');
const errs = logs.filter((l) => /error|fail/i.test(l) && !/favicon/i.test(l));
check('无 error/pageerror/reqfail', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 20).join('\n'));

await browser.close();
console.log(`\n== 结果: ${pass} 通过, ${FAILS.length} 失败 ==`);
if (FAILS.length) {
  console.log('失败项:', FAILS.join(', '));
  process.exit(1);
}
