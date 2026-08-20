// M2 无头验收：manifest 加载 → 时间轴出现 → 自动播放推进 → 拖动 scrubber → 截图 + FPS
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m2.png';

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'load' });

// 等 manifest 加载（水印从"数据加载中…"变成 GFS cycle）
await page.waitForFunction(
  () => document.querySelector('.watermark')?.textContent?.includes('GFS'),
  { timeout: 20000 },
);
const watermark = await page.locator('.watermark').textContent();
console.log('水印:', watermark);

// 等风粒子稳定形成尾迹
await page.waitForTimeout(4000);
const fps = await page.locator('.fps-badge').textContent().catch(() => 'n/a');
console.log('FPS:', fps);

// 时间轴元素
const hasScrubber = (await page.locator('.scrub-range').count()) > 0;
const hasPlayBtn = (await page.locator('.scrub-play').count()) > 0;
console.log('scrubber:', hasScrubber, '| playBtn:', hasPlayBtn);

const timeLabel = () => page.locator('.scrub-time').textContent();

// 1) 自动播放推进：等待 ~3.5 秒，时间标签应变（41 时次 × 2.5s，跨一步以上）
const t0 = await timeLabel();
await page.waitForTimeout(3500);
const t1 = await timeLabel();
console.log(`autoplay 推进: "${t0}" -> "${t1}"  ${t0 !== t1 ? '✓' : '✗ 未推进'}`);

// 2) 拖动 scrubber：先 pointerdown（暂停）再设值 + input（headless 下拖动 range 不稳）
const before = await timeLabel();
await page.evaluate(() => {
  const input = document.querySelector('.scrub-range');
  if (!input) return;
  input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const ev = new Event('input', { bubbles: true });
  input.value = String(parseFloat(input.max) / 2); // 中点时次
  input.dispatchEvent(ev);
});
await page.waitForTimeout(800); // 让下一对时次数据加载并交叉淡化
const after = await timeLabel();
console.log(`scrub 到中段: "${before}" -> "${after}"  ${before !== after ? '✓' : '✗ 未变化'}`);

// 拖动后应暂停
const paused = !(await page.locator('.scrub-play').evaluate((el) => el.classList.contains('on')));
console.log('拖动后暂停:', paused ? '✓' : '✗');

await page.waitForTimeout(1500); // 让尾迹在新时次下稳定
await page.screenshot({ path: shot });

const glInfo = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return 'NO WEBGL2';
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return `${gl.getParameter(gl.VERSION)} | ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'renderer-hidden'}`;
});
console.log('GL:', glInfo);

const errs = logs.filter((l) => /error|warn|fail/i.test(l));
console.log('--- console (errors/warns) ---');
console.log(errs.slice(0, 40).join('\n') || '(clean)');
await browser.close();
