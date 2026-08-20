// M4-1 无头验收：叠加图层（温度/湿度/降水色斑）+ 图例 + 不透明度
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m4.png';

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
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
console.log('水印:', await page.locator('.watermark').textContent());

// 1) 叠加图层芯片
const chips = page.locator('.panel .level-chip');
const labels = await chips.allTextContents();
console.log('面板芯片:', labels.join('/'));
const overlayLabels = ['关', '温度', '湿度', '降水'];
const hasOverlay = overlayLabels.every((l) => labels.includes(l));
console.log('叠加芯片齐全:', hasOverlay ? '✓' : '✗');

// 默认关 → 无图例
console.log('默认无图例:', (await page.locator('.legend').count()) === 0 ? '✓' : '✗');

// 2) 开温度 → 图例出现（温度量程固定，无需等数据）
await page.locator('.panel .level-chip', { hasText: '温度' }).click();
await page.waitForTimeout(300);
const legTemp = await page.locator('.legend-title').textContent().catch(() => null);
console.log(`温度图例: ${legTemp}  ${legTemp?.includes('温度') ? '✓' : '✗'}`);
const legBarBg = await page.locator('.legend-bar').evaluate((el) => getComputedStyle(el).backgroundImage).catch(() => '');
console.log('图例渐变条:', legBarBg.startsWith('linear-gradient') ? '✓' : '✗');
console.log('不透明度滑块:', (await page.locator('.panel .ctrl-range').count()) > 0 ? '✓' : '✗');

// 等叠加数据加载（色斑渲染）+ 截图（用 look.py 复核颜色）
await page.waitForTimeout(6000);
await page.screenshot({ path: shot });

// 3) 切湿度 → 图例标题变
await page.locator('.panel .level-chip', { hasText: '湿度' }).click();
await page.waitForTimeout(300);
const legRh = await page.locator('.legend-title').textContent().catch(() => null);
console.log(`湿度图例: ${legRh}  ${legRh?.includes('湿度') ? '✓' : '✗'}`);

// 4) 在等压面（默认 850）点降水 → 无地面层数据，图例应隐藏
await page.locator('.panel .level-chip', { hasText: '降水' }).click();
await page.waitForTimeout(300);
const legHidden = (await page.locator('.legend').count()) === 0;
console.log('850hPa 降水无图例:', legHidden ? '✓' : '✗');

// 5) 切到地面 → 降水图例出现（自适应量程需数据就绪，用轮询）
await page.locator('.panel .level-chip', { hasText: '地面' }).click();
let legApcp = null;
const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  legApcp = await page.locator('.legend-title').textContent().catch(() => null);
  if (legApcp?.includes('降水')) break;
  await page.waitForTimeout(1000);
}
console.log(`地面降水图例: ${legApcp}  ${legApcp?.includes('降水') ? '✓' : '✗'}`);

await page.waitForTimeout(3000); // 让色斑渲染
await page.screenshot({ path: shot.replace('.png', '-apcp.png') });

// 6) 关掉叠加 → 图例消失
await page.locator('.panel .level-chip', { hasText: '关' }).click();
await page.waitForTimeout(300);
console.log('关闭后无图例:', (await page.locator('.legend').count()) === 0 ? '✓' : '✗');

const errs = logs.filter((l) => /error|fail/i.test(l));
console.log('--- console (errors) ---');
console.log(errs.slice(0, 40).join('\n') || '(clean)');
await browser.close();
