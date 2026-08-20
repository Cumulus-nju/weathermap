// M0 无头验收：加载页面 → 抓 console/WebGL 错误 → 等粒子动画 → 截图 + 读 FPS
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:4173/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot.png';

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(4500); // 让粒子稳定流动，形成尾迹

const fps = await page.locator('.fps-badge').textContent().catch(() => 'n/a');
await page.screenshot({ path: shot });

// 同时导出 WebGL 环境信息，确认跑的是 WebGL2
const glInfo = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return 'NO WEBGL2';
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return `${gl.getParameter(gl.VERSION)} | ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'renderer-hidden'}`;
});

console.log('GL:', glInfo);
console.log('FPS:', fps);
console.log('--- console/logs ---');
console.log(logs.slice(0, 80).join('\n') || '(clean)');
await browser.close();
