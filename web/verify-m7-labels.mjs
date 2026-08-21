// M7-4 等值线数值标注验收（真 GPU d3d11）：
//   1) 温度 + 等值线 → .iso-label 出现，文本为 "NN°"
//   2) 气压 + 等压线 → 标注为 hPa 整数
//   3) 关等值线 → 标注消失
//   4) 850hPa + 温度 + 等值线 → 标注仍在（temp 高层）
//   5) console 无 error
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5174/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m7-labels.png';
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

const isoLabels = () => page.evaluate(() => [...document.querySelectorAll('.iso-label')].map((e) => e.textContent));
const count = () => page.evaluate(() => document.querySelectorAll('.iso-label').length);

console.log('== M7-4 等值线数值标注 ==');
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// ---- 1) 温度 + 等值线 ----
console.log('-- 1. 温度等值线标注 --');
await page.locator('.level-chip', { hasText: '温度' }).click();
await page.waitForTimeout(600);
await page.locator('.toggle span', { hasText: '等值线' }).locator('..').locator('.toggle-btn').click();
await page.waitForTimeout(2500);
let labels = await isoLabels();
console.log(`  温度标注(${labels.length}): ${labels.slice(0, 20).join(' ')}`);
check('出现标注', labels.length >= 3, `count=${labels.length}`);
check('标注带 ℃ 符号', labels.every((t) => t.endsWith('°')), labels.slice(0, 5).join(','));
await page.screenshot({ path: shot.replace('.png', '-temp.png') });

// ---- 2) 气压等压线标注 ----
console.log('-- 2. 气压等压线标注 --');
await page.locator('.level-chip', { hasText: '气压' }).click();
await page.waitForTimeout(2500);
labels = await isoLabels();
console.log(`  气压标注(${labels.length}): ${labels.slice(0, 20).join(' ')}`);
check('出现标注', labels.length >= 3, `count=${labels.length}`);
check('标注为 hPa 整数', labels.every((t) => /^\d+$/.test(t)), labels.slice(0, 5).join(','));
await page.screenshot({ path: shot.replace('.png', '-pressure.png') });

// ---- 3) 关等值线 ----
console.log('-- 3. 关等值线 --');
await page.locator('.toggle span', { hasText: '等值线' }).locator('..').locator('.toggle-btn').click();
await page.waitForTimeout(800);
check('标注消失', (await count()) === 0, `count=${await count()}`);
await page.waitForTimeout(1200);

// ---- 4) 850hPa 温度等值线 ----
console.log('-- 4. 850hPa 温度等值线 --');
await page.locator('.level-chip', { hasText: '850' }).click();
await page.waitForTimeout(500);
await page.locator('.level-chip', { hasText: '温度' }).click();
await page.waitForTimeout(600);
await page.locator('.toggle span', { hasText: '等值线' }).locator('..').locator('.toggle-btn').click();
await page.waitForTimeout(2500);
labels = await isoLabels();
console.log(`  850hPa 温度标注(${labels.length}): ${labels.slice(0, 20).join(' ')}`);
check('高层也出标注', labels.length >= 3, `count=${labels.length}`);
await page.screenshot({ path: shot.replace('.png', '-850.png') });

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
