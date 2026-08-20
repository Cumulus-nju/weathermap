// M0 交互验收：平移/缩放/调参期间渲染是否持续、无错误
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:4173/';

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// 平移地图（从中心向左拖）
const c = page.locator('.map-container');
const box = await c.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 300, box.y + box.height / 2 - 100, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shot-pan.png' });

// 缩放（滚轮）
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -800); // zoom in
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shot-zoom.png' });

// 调参：粒子数 100k→50k，流速 1→2（点滑块任意位置）
const sliders = await page.locator('input[type=range]').count();
const s0 = page.locator('input[type=range]').nth(0);
await s0.focus();
await page.keyboard.press('Home'); // 50k 附近由 step 决定
await page.waitForTimeout(800);

// 关闭再打开动画
await page.locator('.toggle-btn').click();
await page.waitForTimeout(400);
await page.locator('.toggle-btn').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shot-settings.png' });

const fps = await page.locator('.fps-badge').textContent().catch(() => 'n/a');
console.log('sliders found:', sliders);
console.log('FPS after interaction:', fps);
console.log('--- errors (if any) ---');
console.log(logs.join('\n') || '(clean)');
await browser.close();
