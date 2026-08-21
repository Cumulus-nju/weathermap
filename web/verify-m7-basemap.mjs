// M7 底图装饰验收：关掉风粒子、放大看中国，确认省份界线/主要河流/湖泊可见且配色美观。
// 视觉结论交给 look.py（纯文本主模型无视觉）；本脚本产出干净截图 + console 无错。
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5174/';
const out = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-basemap';

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.city-label', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);

// 关风粒子（风场粒子区第一个 toggle "动画"）
await page.locator('.ctrl-row.toggle', { hasText: '动画' }).locator('.toggle-btn').click();
await page.waitForTimeout(400);

// 放大看中国（zoom 5.2 中心 104E,35N）：省份界线 + 黄河/长江 + 青海湖等湖泊
console.log('-- 放大中国 zoom5.2 --');
await page.evaluate(() => {
  window.__map.flyTo({ center: [104, 35], zoom: 5.2, duration: 900 });
});
await page.waitForTimeout(2200);
await page.screenshot({ path: out + '-dark.png' });

// 亮色主题同视角
await page.locator('.level-chip', { hasText: '亮色' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: out + '-light.png' });
await page.locator('.level-chip', { hasText: '暗色' }).click();
await page.waitForTimeout(1200);

// 长江黄河交汇区 zoom6.5 细节
console.log('-- 长江/黄河 zoom6.5 --');
await page.evaluate(() => {
  window.__map.flyTo({ center: [112, 33], zoom: 6.5, duration: 900 });
});
await page.waitForTimeout(2000);
await page.screenshot({ path: out + '-dark-zoom65.png' });

// 重新开粒子，回到默认视角，确认粒子照常（且默认 20k）
await page.locator('.ctrl-row.toggle', { hasText: '动画' }).locator('.toggle-btn').click();
await page.waitForTimeout(2000);
const pcount = await page.evaluate(() => document.querySelector('.ctrl-row')?.textContent ?? '');
const valText = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.ctrl-row')];
  const r = rows.find((x) => x.textContent.includes('粒子数'));
  return r ? r.textContent : '';
});
console.log('  粒子数控件:', valText.trim());

const errs = logs.filter((l) => /error|fail/i.test(l) && !/favicon/i.test(l));
console.log('console 错误:', errs.length ? errs.slice(0, 10).join('\n') : '无');
await browser.close();
console.log('== 完成，请用 look.py 看图 ==');
