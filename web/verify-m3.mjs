// M3 无头验收：气压层芯片 → 切换 300 hPa → 读数卡（风速/温度等双线性采样 + 播放头插值）
// 读数卡依赖 (层,时次) 网格解码缓存就绪，本地/线上速度差异大 → 用轮询等待而非固定 sleep。
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

// 2) 悬停地图中心 → 轮询读数卡出现（每 1.5s 挪 1px 触发新 mousemove，绕过地图初始化期事件丢失；
//    网格解码就绪后 20Hz 采样会自动补上）
const box = await page.locator('.map-container').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
async function poll(condFn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let i = 0;
  while (Date.now() < deadline) {
    if (await page.evaluate(condFn)) return true;
    await page.mouse.move(cx + (i % 3), cy + ((i % 2) * 2)); // 小范围挪动触发 mousemove
    i++;
    await page.waitForTimeout(1500);
  }
  return false;
}
const cardOk = await poll(() => !!document.querySelector('.value-card'), 25000);
console.log('读数卡出现:', cardOk ? '✓' : '✗');
if (cardOk) {
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

// 4) 轮询等读数卡层标签变 300 hPa（300 网格解码就绪；挪鼠标保证 mousemove 持续触发）
const lv300 = await poll(
  () => document.querySelector('.value-card .vc-level')?.textContent?.includes('300') ?? false,
  30000,
);
console.log('读数卡 → 300 hPa:', lv300 ? '✓' : '✗');
if (lv300) console.log('300 hPa 风速:', await page.locator('.vc-wind .vc-val').textContent());

await page.screenshot({ path: shot });

const errs = logs.filter((l) => /error|fail/i.test(l));
console.log('--- console (errors) ---');
console.log(errs.slice(0, 40).join('\n') || '(clean)');
await browser.close();
