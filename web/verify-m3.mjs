// M3 无头验收：气压层芯片 → 切换 300 hPa → 读数卡（风速/温度等双线性采样 + 播放头插值）
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m3.png';

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'load' });

// 等 manifest
await page.waitForFunction(
  () => document.querySelector('.watermark')?.textContent?.includes('GFS'),
  { timeout: 20000 },
);
console.log('水印:', await page.locator('.watermark').textContent());

// 1) 气压层芯片
const chips = page.locator('.level-chip');
const chipCount = await chips.count();
const chipLabels = await chips.allTextContents();
console.log(`气压层芯片: ${chipCount} 个 (${chipLabels.join('/')})`);
const hasAll = chipCount === 9 && chipLabels.includes('地面') && chipLabels.includes('850');
console.log('芯片齐全:', hasAll ? '✓' : '✗');

// 默认层 850 应高亮 + 水印 850 hPa
const activeDefault = await page.$$eval('.level-chip.on', (els) => els.map((e) => e.textContent).join(','));
console.log(`默认高亮: ${activeDefault}  ${activeDefault.includes('850') ? '✓' : '✗'}`);
console.log('水印默认层:', await page.locator('.watermark').textContent());

// 2) 等初始数据加载，悬停地图中心 → 读数卡出现
await page.waitForTimeout(5000);
const box = await page.locator('.map-container').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(2500); // 等 20Hz 采样 + 网格就绪
const cardVisible = (await page.locator('.value-card').count()) > 0;
console.log('读数卡出现:', cardVisible ? '✓' : '✗');
if (cardVisible) {
  const cardText = await page.locator('.value-card').innerText();
  console.log('--- 850 hPa 读数卡 ---');
  console.log(cardText.replace(/\n/g, ' | '));
  const speed = await page.locator('.vc-wind .vc-val').textContent();
  const m = speed?.match(/([\d.]+) m\/s/);
  const speedOk = m && parseFloat(m[1]) >= 0 && parseFloat(m[1]) <= 150;
  console.log('风速数值合理:', speedOk ? `✓ (${speed})` : `✗ (${speed})`);
}

// 3) 切到 300 hPa：点芯片，水印应即时更新
await chips.filter({ hasText: '300' }).click();
await page.waitForTimeout(200);
console.log('水印切换后:', await page.locator('.watermark').textContent());
const w300 = (await page.locator('.watermark').textContent())?.includes('300 hPa');
console.log('水印 → 300 hPa:', w300 ? '✓' : '✗');
const active300 = await page.$$eval('.level-chip.on', (els) => els.map((e) => e.textContent).join(','));
console.log('高亮芯片:', active300, active300.includes('300') ? '✓' : '✗');

// 4) 等 300 hPa 数据（解码+上传纹理），再悬停刷新读数卡，层标签应变
await page.waitForTimeout(6000);
await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 5); // 挪一点触发新 mousemove
await page.waitForTimeout(2000);
const cardLevel = await page.locator('.vc-level').textContent().catch(() => null);
console.log(`读数卡层: ${cardLevel}  ${cardLevel?.includes('300') ? '✓' : '✗'}`);
if (cardLevel) {
  const speed = await page.locator('.vc-wind .vc-val').textContent();
  console.log('300 hPa 风速:', speed);
}

await page.screenshot({ path: shot });

const errs = logs.filter((l) => /error|fail/i.test(l));
console.log('--- console (errors) ---');
console.log(errs.slice(0, 40).join('\n') || '(clean)');
await browser.close();
