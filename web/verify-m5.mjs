// M5 无头验收（真 GPU，--use-angle=d3d11；SwiftShader 位移多边形不可信）：
//   1) 新色斑芯片存在且点击自动切地面层、图例标题匹配
//   2) 等压线 toggle：图例显示等压线、色斑+等压线同开截图
//   3) 亮色主题：body.dataset.theme + 截图
//   4) 城市搜索：输入北京 → 下拉命中 → 点击后地图中心飞过去 + 读数卡出现
//   5) 收藏：星标 → localStorage 持久化 → reload 后星仍实心
//   6) console 无 error/pageerror/reqfail
//   7) 叠加层像素级断言：阵风色斑(不开等压线)必须真的把大片蓝青色画上地图
//      （回归防护：M5 曾因 mode===0 被提前 return 导致色斑完全不渲染，图例却正常，纯查图例漏过）
import { chromium } from 'playwright';
import zlib from 'node:zlib';

const url = process.argv[2] || 'http://localhost:5174/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m5.png';
const FAILS = [];

// 极简 PNG 解码（Playwright 截图 = RGBA8 非隔行）：IHDR + 拼接 IDAT → zlib inflate → 逐行 unfilter
function decodePng(buf) {
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if ((colorType !== 6 && colorType !== 2) || bitDepth !== 8 || interlace !== 0)
    throw new Error(`unexpected png format ct=${colorType} bd=${bitDepth} il=${interlace}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = row[x]; break;
        case 1: v = (row[x] + a) & 0xff; break;
        case 2: v = (row[x] + b) & 0xff; break;
        case 3: v = (row[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      out[y * stride + x] = v;
    }
    prev.set(row);
  }
  return { width, height, data: out };
}

/** 截图缓冲 → 统计 阵风色斑(青蓝/橙) 与 暖色(温度) 像素占比 */
function countOverlayPixels(pngBuf) {
  const { width, height, data } = decodePng(pngBuf);
  let cyan = 0, orange = 0, warm = 0, tot = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    tot++;
    // 阵风 cmap 中段青蓝 (蓝>绿>红，饱和)；阈值放宽以覆盖 0.65 透明度叠在暗海上的混色
    if (b > 120 && g > 90 && r < 160 && b > g) cyan++;
    // 阵风/温度 cmap 橙红
    if (r > 190 && g > 100 && g < 220 && b < 90) orange++;
    // 温度 cmap 黄橙红（暖色）
    if (r > 160 && g > 100 && b < 140) warm++;
  }
  return { cyan, orange, warm, tot };
}
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

console.log('== M5 验收 ==');
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.querySelector('.watermark')?.textContent?.includes('GFS'),
  { timeout: 30000 },
);
await page.waitForTimeout(4000); // 等数据 + 风层渲染

// ---- 1) 新色斑芯片 ----
console.log('-- 1. 新图层芯片 --');
for (const label of ['阵风', '露点', '总云', '低云', '中云', '高云']) {
  const n = await page.locator('.panel .level-chip', { hasText: label }).count();
  check(`芯片存在: ${label}`, n > 0);
}
// 点击 阵风 → 地面芯片自动点亮
const sfcChip = page.locator('.panel .level-chip', { hasText: /^地面$/ });
const sfcOnBefore = (await sfcChip.getAttribute('class'))?.includes('on') ?? false;
await page.locator('.panel .level-chip', { hasText: '阵风' }).click();
await page.waitForTimeout(300);
const sfcOnAfter = (await sfcChip.getAttribute('class'))?.includes('on') ?? false;
check('surface-only 芯片自动切到地面层', !sfcOnBefore && sfcOnAfter, `before=${sfcOnBefore} after=${sfcOnAfter}`);
const gustLegend = (await page.locator('.legend-title').textContent()) ?? '';
check('图例标题=阵风', gustLegend.includes('阵风'), gustLegend);
await page.waitForTimeout(2500);
const gustShot = await page.screenshot({ path: shot.replace('.png', '-gust.png') });
// 像素级断言：色斑必须真的渲染（不开等压线，mode=0 仅色斑）——图例出现不代表色斑画上了
const pix = countOverlayPixels(gustShot);
const cyanPct = (100 * pix.cyan) / pix.tot;
check('阵风色斑渲染(青蓝像素)', cyanPct > 2.5, `cyan=${cyanPct.toFixed(1)}%`);

// ---- 2) 等压线 ----
console.log('-- 2. 等压线 --');
const isoBtn = page.locator('.ctrl-row', { hasText: '等压线' }).locator('.toggle-btn');
await isoBtn.click(); // 阵风 已开，等压线叠上去
await page.waitForTimeout(400);
const legend2 = (await page.locator('.legend-title').textContent()) ?? '';
check('图例显示 · 等压线', legend2.includes('等压线'), legend2);
await page.waitForTimeout(2500);
await page.screenshot({ path: shot.replace('.png', '-gust-iso.png') });
// 只开等压线（关掉色斑）
await page.locator('.panel .level-chip', { hasText: /^关$/ }).click();
await page.waitForTimeout(300);
const legendIso = (await page.locator('.legend-title').textContent()) ?? '';
check('仅等压线图例标题=等压线', legendIso.includes('等压线'), legendIso);
await page.waitForTimeout(1500);
await page.screenshot({ path: shot.replace('.png', '-iso-only.png') });
await isoBtn.click(); // 关掉等压线
await page.waitForTimeout(300);
const legendOff = (await page.locator('.legend').count()) === 0;
check('关掉等压线+色斑后图例消失', legendOff);

// ---- 3) 亮色主题 ----
console.log('-- 3. 亮色主题 --');
await page.locator('.panel .level-chip', { hasText: '亮色' }).click();
await page.waitForTimeout(2000);
const theme = await page.evaluate(() => document.body.dataset.theme);
check('body.dataset.theme=light', theme === 'light', `theme=${theme}`);
const seaBefore = await page.evaluate(() => {
  // 直接从已渲染的样式源读背景色不现实，改由外部分析截图；这里只看能飞回来
  return document.querySelector('.maplibregl-canvas') ? true : false;
});
check('亮色后画布仍在', seaBefore);
await page.waitForTimeout(1500);
await page.screenshot({ path: shot.replace('.png', '-light.png') });
await page.locator('.panel .level-chip', { hasText: '暗色' }).click();
await page.waitForTimeout(1500);

// ---- 4) 城市搜索 ----
console.log('-- 4. 城市搜索 --');
await page.locator('.city-input').fill('北京');
await page.waitForTimeout(300);
const items = await page.locator('.city-drop .city-item').count();
check('下拉出现结果', items > 0, `count=${items}`);
const firstName = (await page.locator('.city-drop .city-item .city-name').first().textContent()) ?? '';
check('首条含北京', firstName.includes('北京'), firstName);
await page.locator('.city-drop .city-item').first().click();
await page.waitForFunction(
  () => {
    const m = window.__map;
    if (!m) return false;
    const c = m.getCenter();
    return Math.abs(c.lng - 116.4) < 1 && Math.abs(c.lat - 39.9) < 1;
  },
  { timeout: 15000 },
).catch(() => {});
const center = await page.evaluate(() => {
  const c = window.__map.getCenter();
  return `${c.lng.toFixed(2)},${c.lat.toFixed(2)}`;
});
check(`地图中心飞到北京附近`, Math.abs(parseFloat(center.split(',')[0]) - 116.4) < 1, center);
// flyTo 动画结束(moveend)后才写 pointerStore → 读数卡出现（给足动画+数据加载时间）
await page.waitForFunction(() => document.querySelector('.value-card'), { timeout: 15000 }).catch(() => {});
const cardVisible = await page.locator('.value-card').count();
check('读数卡出现', cardVisible > 0);

// ---- 5) 收藏 ----
console.log('-- 5. 收藏 --');
await page.locator('.city-input').fill('北京');
await page.waitForTimeout(300);
await page.locator('.city-drop .city-item .fav-btn').first().click();
await page.waitForTimeout(300);
const favStore = await page.evaluate(() => localStorage.getItem('weathermap.favorites') ?? '');
check('localStorage 含北京', favStore.includes('北京'), favStore);
const favChip = await page.locator('.fav-chip', { hasText: '北京' }).count();
check('收藏列表出现北京', favChip > 0);
// reload 持久化
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3000);
const favChip2 = await page.locator('.fav-chip', { hasText: '北京' }).count();
check('reload 后收藏仍在', favChip2 > 0);
await page.locator('.city-input').fill('北京');
await page.waitForTimeout(300);
const starOn = await page.locator('.city-drop .city-item .fav-btn.on').count();
check('星标实心(收藏中)', starOn > 0);

// ---- 6) console ----
console.log('-- 6. console --');
const errs = logs.filter((l) => /error|fail/i.test(l) && !/favicon/i.test(l));
check('无 error/pageerror/reqfail', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 20).join('\n'));

await browser.close();
console.log(`\n== 结果: ${pass} 通过, ${FAILS.length} 失败 ==`);
if (FAILS.length) {
  console.log('失败项:', FAILS.join(', '));
  process.exit(1);
}
