// M7-1 线上冒烟：加载线上站点，确认粒子渲染均匀（无气旋空洞）+ console 干净
// 用法: node verify-m7-live.mjs [url] [shot]
// 默认 url = 线上 Pages，shot = web/shot-m7-live.png
// 需真 GPU：--use-angle=d3d11（SwiftShader 软渲染位移多边形不可信）
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const url = process.argv[2] || 'https://cumulus-nju.github.io/weathermap/';
const shot = process.argv[3] || 'C:/Users/HONOR/weathermap/web/shot-m7-live.png';

// 极简 PNG 解码（Playwright 截图 = RGBA8/RGB8 非隔行）：IHDR + 拼接 IDAT → zlib inflate → 逐行 unfilter
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
  return { width, height, data: out, bpp };
}

const logs = [];
const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'load' });
// 等风粒子渲染起来（首帧平流 + 尾迹累积）
await page.waitForTimeout(4000);
// 模拟用户场景：放大进风区 → 停留 → 缩小回默认，检查缩放后无空洞
await page.waitForTimeout(1500);
await page.keyboard.press('Control+='); // zoom in (浏览器级快捷键，maplibre 缩放优先用滚轮)
await page.mouse.wheel(0, -240);
await page.waitForTimeout(1200);
await page.mouse.wheel(0, -240);
await page.waitForTimeout(1500);
// 缩回
await page.mouse.wheel(0, 240);
await page.waitForTimeout(1200);
await page.mouse.wheel(0, 240);
await page.waitForTimeout(2500);
await page.screenshot({ path: shot });

// ---- 像素覆盖分析：16×8 网格，逐单元亮像素占比，找空洞（<0.1% 空单元） ----
// WebGL 画布 drawImage 读回全黑，只能解码 Playwright screenshot 缓冲
const png = decodePng(readFileSync(shot));
const W = png.width, H = png.height;
const bpp = png.bpp;
const GX = 16, GY = 8;
const cellW = W / GX, cellH = H / GY;
const cells = new Array(GX * GY).fill(0);
const cellTot = new Array(GX * GY).fill(0);
let litTotal = 0, total = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const o = i * bpp;
    const mx = Math.max(png.data[o], png.data[o + 1], png.data[o + 2]);
    total++;
    const cx = Math.floor(x / cellW), cy = Math.floor(y / cellH);
    const ci = cy * GX + cx;
    cellTot[ci]++;
    if (mx > 100) { cells[ci]++; litTotal++; }
  }
}
let empty = 0, minFrac = 1, minCell = -1;
for (let c = 0; c < cells.length; c++) {
  const f = cells[c] / cellTot[c];
  if (f < 0.001) empty++;
  if (f < minFrac) { minFrac = f; minCell = c; }
}
console.log(`网格 ${GX}x${GY}, 每单元亮像素占比最小=${minFrac.toFixed(4)} (单元 ${minCell})`);
console.log(`空/近空单元(<0.1%): ${empty}`);
console.log(`地图区总亮像素占比=${(litTotal / total).toFixed(3)}`);

// 截图后 look.py 人工确认可选
console.log(logs.length ? 'CONSOLE ERRORS:\n' + logs.join('\n') : 'console 干净');

await browser.close();
if (empty > 0) {
  console.log('❌ 检测到空洞单元');
  process.exit(1);
}
console.log('✅ 无空洞，覆盖均匀');
