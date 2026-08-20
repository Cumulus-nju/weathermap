// M4-2 无头验收：单位切换（风/温度）+ 动态粒子数 UI + 风粒子配色预设
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5174/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m4-2.png';

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

// 1) 单位芯片 + 配色芯片 + 自动 toggle 齐不齐
const labels = await page.locator('.panel .level-chip').allTextContents();
console.log('芯片:', labels.join('/'));
const unitChips = ['m/s', 'km/h', '节', '℃', '℉'];
console.log('单位芯片齐全:', unitChips.every((l) => labels.includes(l)) ? '✓' : '✗');
const palChips = ['标准', '极光', '白', '珊瑚'];
console.log('配色芯片齐全:', palChips.every((l) => labels.includes(l)) ? '✓' : '✗');
const autoBtns = await page.locator('.panel .toggle-btn').allTextContents();
console.log('自动 toggle 在:', autoBtns.includes('自动') || (await page.locator('.ctrl-row', { hasText: '粒子数自动' }).count()) > 0 ? '✓' : '✗');

// 2) 暂停播放（读数卡在固定播放头下采样，避免风场漂移干扰换算校验）
const playBtn = page.locator('.scrub-play');
const wasPlaying = await playBtn.evaluate((el) => el.classList.contains('on'));
if (wasPlaying) await playBtn.click();
await page.waitForTimeout(200);

// 3) 指针移到地图中心 → 读数卡出现（默认 m/s + ℃）
await page.waitForTimeout(2000);
await page.mouse.move(640, 420);
await page.waitForTimeout(600);
await page.mouse.move(640, 421);
await page.waitForTimeout(600);

const cardWind = async () =>
  page.locator('.value-card .vc-row.vc-wind .vc-val').textContent().catch(() => null);
const cardTemp = async () =>
  page.locator('.value-card .vc-row', { hasText: '温度' }).locator('.vc-val').textContent().catch(() => null);

const wind0 = await cardWind();
const temp0 = await cardTemp();
console.log(`默认读数卡: 风=[${wind0}] 温度=[${temp0}]`);
const w0 = parseFloat(wind0 ?? '');
const t0 = parseFloat(temp0 ?? '');
console.log(`默认单位 m/s+℃: ${wind0?.includes('m/s') && temp0?.includes('℃') ? '✓' : '✗'}`);

// 4) 切 km/h → 风速 ×3.6
await page.locator('.panel .level-chip', { hasText: 'km/h' }).click();
await page.waitForTimeout(500);
const wind1 = await cardWind();
const w1 = parseFloat(wind1 ?? '');
console.log(`km/h: 风=[${wind1}]  ${wind1?.includes('km/h') ? '✓' : '✗'}`);
console.log(`风速换算 3.6×: ${w0 > 0 && Math.abs(w1 / w0 - 3.6) < 0.05 ? `✓ (${(w1 / w0).toFixed(2)})` : '✗'}`);

// 5) 切 ℉ → 温度 °C→°F
await page.locator('.panel .level-chip', { hasText: '℉' }).click();
await page.waitForTimeout(500);
const temp1 = await cardTemp();
const t1 = parseFloat(temp1 ?? '');
console.log(`℉: 温度=[${temp1}]  ${temp1?.includes('℉') ? '✓' : '✗'}`);
console.log(`温度换算 9/5+32: ${t1 !== 0 && Math.abs(t1 - (t0 * 9) / 5 - 32) < 0.15 ? `✓ (${t1.toFixed(1)})` : '✗'}`);

// 6) 开温度叠加 → 图例显示 ℉
await page.locator('.panel .level-chip', { hasText: '温度' }).click();
await page.waitForTimeout(500);
const legTitle = await page.locator('.legend-title').textContent().catch(() => null);
console.log(`温度图例(℉): ${legTitle}  ${legTitle?.includes('℉') ? '✓' : '✗'}`);
const legScale = await page.locator('.legend-scale').allTextContents();
console.log(`图例量程: ${legScale.join(' / ')}  ${legScale.some((s) => s.includes('104')) ? '✓(最高104℉)' : '?'}`);

// 7) 恢复播放（配色切换要持续重绘才可见）再切珊瑚配色截图
if (wasPlaying) await playBtn.click();
await page.waitForTimeout(300);
await page.locator('.panel .level-chip', { hasText: '珊瑚' }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: shot.replace('.png', '-coral.png') });

// 8) 切回标准截图（对比）
await page.locator('.panel .level-chip', { hasText: '标准' }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: shot });

// 9) 自动 toggle 可点（点关再点开）
const autoToggle = page.locator('.ctrl-row', { hasText: '粒子数自动' }).locator('.toggle-btn');
await autoToggle.click();
await page.waitForTimeout(300);
const autoOff = await autoToggle.evaluate((el) => el.classList.contains('on'));
await autoToggle.click();
await page.waitForTimeout(300);
const autoOn = await autoToggle.evaluate((el) => el.classList.contains('on'));
console.log(`自动 toggle 往返: 关=${!autoOff} 开=${autoOn}  ${!autoOff && autoOn ? '✓' : '✗'}`);

const errs = logs.filter((l) => /error|fail/i.test(l));
console.log('--- console (errors) ---');
console.log(errs.slice(0, 40).join('\n') || '(clean)');
await browser.close();
