// M7-4.3 线上验收: 图例不再撑宽盖地图 + 云/降水等值线正常 + console 干净
import { chromium } from 'playwright';
const url = process.argv[2] || 'https://cumulus-nju.github.io/weathermap/';
const browser = await chromium.launch({ args: ['--use-angle=d3d11'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e).slice(0, 300)));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()}`));
let pass = 0, fail = 0;
const ok = (c, name) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${name}`); };

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(6000); // 等 GFS 数据加载

// 数据新鲜度: 数据角标
const dataOk = await page.locator('.data-badge').count();
ok(dataOk > 0, '数据角标存在');

// 1) 降水 + 等值线同开: 图例应窄(<130px), 带区像素亮
await page.locator('.level-chip', { hasText: '降水' }).click();
await page.waitForTimeout(800);
await page.locator('.toggle span', { hasText: '等值线' }).locator('..').locator('.toggle-btn').click();
await page.waitForTimeout(1000);
const leg1 = await page.locator('.legend').boundingBox();
console.log(`  图例(降水+等值线): x=${Math.round(leg1.x)} w=${Math.round(leg1.width)} h=${Math.round(leg1.height)}`);
ok(leg1.width < 130, '图例宽度 <130px(不再 151px 横条)');
// 用截图读带区像素 (x=120 应已不被图例覆盖 → 亮)
const shot1 = await page.screenshot();
const band1 = await page.evaluate((b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64;
  return img.decode().then(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 800;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    return { p120: [...ctx.getImageData(120, 585, 1, 1).data.slice(0, 3)], p90: [...ctx.getImageData(90, 585, 1, 1).data.slice(0, 3)] };
  });
}, shot1.toString('base64'));
console.log(`  带区像素: (90,585)=[${band1.p90}] (120,585)=[${band1.p120}]`);
ok(band1.p120[0] + band1.p120[1] + band1.p120[2] > 60, 'x=120 处亮(图例不再覆盖)');
// 等值线关了图例回到窄
await page.locator('.toggle span', { hasText: '等值线' }).locator('..').locator('.toggle-btn').click();
await page.waitForTimeout(500);
const legOff = await page.locator('.legend').boundingBox();
console.log(`  图例(仅降水): w=${Math.round(legOff.width)}`);
ok(legOff.width < 100, '关等值线后图例更窄');

// 2) 总云 + 等值线
await page.locator('.level-chip', { hasText: '总云' }).click();
await page.waitForTimeout(800);
await page.locator('.toggle span', { hasText: '等值线' }).locator('..').locator('.toggle-btn').click();
await page.waitForTimeout(1000);
const leg2 = await page.locator('.legend').boundingBox();
console.log(`  图例(总云+等值线): w=${Math.round(leg2.width)}`);
ok(leg2.width < 130, '总云+等值线图例仍窄');

// 3) 截图存档
await page.screenshot({ path: 'shot-m743-live.png' });

// 4) console（过滤掉 verify 脚本自身 Canvas 读回引起的浏览器性能提示）
const real = logs.filter((l) => !l.includes('favicon') && !l.includes('willReadFrequently'));
console.log('  console:', real.length ? real.join(' | ') : '干净');
ok(real.length === 0, 'console 干净');

console.log(`\n== 结果: ${pass} 通过, ${fail} 失败 ==`);
await browser.close();
process.exit(fail ? 1 : 0);
