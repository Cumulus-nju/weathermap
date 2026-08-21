// M7-4.2 验收（真 GPU d3d11）：
//   1) 降水/云量 + 等值线 无"格点状伪影"（iso 线像素占比从 33%/36% 降到个位数 %）
//   2) 初始时间 = 距现在最近的时次，且默认不自动播放（index 不随时间推进）
//   3) 鼠标移到地图外（右侧栏/顶部徽章/底部控件）→ 读数卡隐藏；移回地图 → 恢复
//   4) 回归：温度 + 等值线 仍正常（iso 线占比在合理范围）
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5174/';
const base = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m742';
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

const cardVisible = () => page.locator('.value-card').count().then((n) => n > 0);
const timeState = () =>
  page.evaluate(() => {
    // dev 下 HMR 动态 import 会拿到另一 store 实例 → 用 App 暴露到 window 的 __time
    const s = window.__time.getState();
    const m = s.manifest;
    const ts = m?.timesteps?.[s.index];
    return { index: s.index, playing: s.playing, validTime: ts?.validTime ?? null, n: m?.timesteps?.length ?? 0 };
  });

console.log('== M7-4.2 格点伪影修复 + 初始时刻 + 鼠标离图隐藏 ==');
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// ---- 2) 初始时间 ----
console.log('-- 2. 初始时刻 & 不自动播放 --');
// 轮询等 manifest 就绪（dev server 首次编译可能慢）
let st0 = await timeState();
for (let i = 0; i < 15 && st0.n === 0; i++) {
  await page.waitForTimeout(1000);
  st0 = await timeState();
}
const now = Date.now();
const nearest = st0.validTime ? Math.abs(new Date(st0.validTime).getTime() - now) : null;
console.log(`  初始 index=${st0.index}/${st0.n} validTime=${st0.validTime} 距现在=${nearest ? Math.round(nearest / 60000) : '?'} 分钟`);
check('默认不播放', st0.playing === false, `playing=${st0.playing}`);
check('初始为距现在最近时次', nearest !== null && nearest < 6 * 3600 * 1000, `距现在 ${nearest}`);
await page.waitForTimeout(4000);
const st1 = await timeState();
check('不播放时 index 不推进', st1.index === st0.index, `${st0.index}->${st1.index}`);

// ---- 3) 鼠标离图隐藏 ----
console.log('-- 3. 鼠标离图隐藏读数卡 --');
await page.mouse.move(600, 400);
await page.waitForTimeout(600);
check('图上显示读数卡', await cardVisible());
// 右侧栏（.panel 位于 right:12px 宽 220px → x∈[1048,1268]，取 x=1150 在面板内）
await page.mouse.move(1150, 300);
await page.waitForTimeout(400);
check('移到右侧栏隐藏', !(await cardVisible()));
// 移回地图恢复
await page.mouse.move(600, 500);
await page.waitForTimeout(500);
check('移回地图恢复显示', await cardVisible());
// 顶部徽章
await page.mouse.move(150, 15);
await page.waitForTimeout(400);
check('移到顶部隐藏', !(await cardVisible()));
// 底部控件（play 按钮）
await page.mouse.move(700, 785);
await page.waitForTimeout(400);
check('移到底部控件隐藏', !(await cardVisible()));

// ---- 1) 格点伪影修复（iso 线像素占比）----
console.log('-- 1. 降水/云量 等值线无格点伪影 --');
await page.mouse.move(600, 400); // 回地图，避免悬停面板
await page.waitForTimeout(300);
const pause = async () => {
  try { await page.locator('.scrub-play').click(); } catch {}
  try { await page.locator('.toggle span', { hasText: '动画' }).locator('..').locator('.toggle-btn').click(); } catch {}
  await page.waitForTimeout(400);
};
await pause();
const snap = (name) => page.screenshot({ path: `${base}-${name}.png` });
// 截图成对保存，iso 线像素占比由 Python 在磁盘上 diff 计算（iso-on vs iso-off）
const checkIso = async (field, label) => {
  await page.locator('.level-chip', { hasText: field }).click();
  await page.waitForTimeout(1200);
  await page.locator('.toggle span', { hasText: '等值线' }).locator('..').locator('.toggle-btn').click();
  await page.waitForTimeout(2500);
  await snap(`${label}-iso`);
  await page.locator('.toggle span', { hasText: '等值线' }).locator('..').locator('.toggle-btn').click();
  await page.waitForTimeout(1200);
  await snap(`${label}-only`);
};

await checkIso('降水', 'apcp');
await checkIso('总云', 'cloud');
await checkIso('温度', 'temp');

// ---- 4) console ----
console.log('-- 4. console --');
const errs = logs.filter((l) => /error|fail/i.test(l) && !/favicon/i.test(l));
check('无 error/pageerror/reqfail', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 20).join('\n'));

await browser.close();
console.log(`\n== 结果: ${pass} 通过, ${FAILS.length} 失败 ==`);
if (FAILS.length) {
  console.log('失败项:', FAILS.join(', '));
  process.exit(1);
}
