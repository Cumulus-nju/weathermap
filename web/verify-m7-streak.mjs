// M7-3 全屏拉丝检测：连拍 N 帧，统计"薄长亮线"（横/竖）——reseed 重生跳变如果被画成
// 线段，就是一条横跨/纵贯屏幕的细长亮线（且每帧都有新的出现 = 来回闪）。
// 用法: node verify-m7-streak.mjs [url] [帧数] [间隔ms]
//   * 先跑线上(旧版带bug)当"修复前"基线，再跑本地(修复后)对比。
// 判定：某行最长连续亮run >= 0.6*宽（或某列 >= 0.6*高），且该 run 是"薄"的（上下相邻行不亮）
//   → 计为一条可疑拉丝。
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const url = process.argv[2] || 'https://cumulus-nju.github.io/weathermap/';
const FRAMES = parseInt(process.argv[3] || '12', 10);
const INTERVAL = parseInt(process.argv[4] || '400', 10);
const ZOOM = parseFloat(process.argv[5] || '0'); // >0 时先 setZoom
const shot = 'C:/Users/HONOR/weathermap/web/shot-streak.png';

function decodePng(buf) {
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if ((colorType !== 6 && colorType !== 2) || bitDepth !== 8 || interlace !== 0)
    throw new Error(`png ct=${colorType} bd=${bitDepth}`);
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
          v = (row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff; break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      out[y * stride + x] = v;
    }
    prev.set(row);
  }
  return { width, height, data: out, bpp };
}

/** 统计一帧里的薄长亮线条数。bright 阈值 150（风色亮线），排除底图/标注色 */
function countStreaks(png, W, H, bpp) {
  const bright = new Uint8Array(H * W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * bpp;
      bright[y * W + x] = Math.max(png.data[o], png.data[o + 1], png.data[o + 2]) > 150 ? 1 : 0;
    }
  }
  const rowRun = new Int32Array(H).fill(0);   // 每行最长连续亮run
  const colRun = new Int32Array(W).fill(0);   // 每列最长连续亮run
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      run = bright[y * W + x] ? run + 1 : 0;
      if (run > rowRun[y]) rowRun[y] = run;
    }
  }
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y < H; y++) {
      run = bright[y * W + x] ? run + 1 : 0;
      if (run > colRun[x]) colRun[x] = run;
    }
  }
  const LONG_R = Math.round(W * 0.6), LONG_C = Math.round(H * 0.6);
  let h = 0, v = 0, maxH = 0, maxV = 0;
  for (let y = 0; y < H; y++) {
    if (rowRun[y] >= LONG_R) {
      // 薄线判定：该行亮而上下相邻行暗（条纹不是整片亮区）
      const up = y > 0 ? rowRun[y - 1] : 0, dn = y < H - 1 ? rowRun[y + 1] : 0;
      if (up < LONG_R * 0.6 || dn < LONG_R * 0.6) h++;
    }
    if (rowRun[y] > maxH) maxH = rowRun[y];
  }
  for (let x = 0; x < W; x++) {
    if (colRun[x] >= LONG_C) {
      const lf = x > 0 ? colRun[x - 1] : 0, rt = x < W - 1 ? colRun[x + 1] : 0;
      if (lf < LONG_C * 0.6 || rt < LONG_C * 0.6) v++;
    }
    if (colRun[x] > maxV) maxV = colRun[x];
  }
  return { h, v, maxH, maxV };
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[console] ${m.text()}`); });
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(3000);
if (ZOOM > 0) {
  await page.evaluate((z) => { window.__map.setZoom(z); }, ZOOM);
  await page.waitForTimeout(1500);
}
let totalH = 0, totalV = 0, framesWithStreak = 0, maxRunSeen = 0;
const frames = [];
for (let f = 0; f < FRAMES; f++) {
  await page.screenshot({ path: shot });
  const buf = readFileSync(shot);
  const png = decodePng(buf);
  const { h, v, maxH, maxV } = countStreaks(png, png.width, png.height, png.bpp);
  totalH += h; totalV += v; maxRunSeen = Math.max(maxRunSeen, maxH, maxV);
  if (h > 0 || v > 0) framesWithStreak++;
  frames.push({ f, h, v, maxH, maxV });
  await page.waitForTimeout(INTERVAL);
}
await browser.close();
console.log(`站点 ${url}`);
console.log(`连拍 ${FRAMES} 帧 × ${INTERVAL}ms`);
console.log('每帧 [横向可疑, 纵向可疑, 最长横run, 最长竖run]:');
for (const f of frames) console.log(`  #${f.f} h=${f.h} v=${f.v} maxH=${f.maxH} maxV=${f.maxV}`);
console.log(`总可疑横线=${totalH}, 纵线=${totalV}, 出现可疑线的帧=${framesWithStreak}/${FRAMES}`);
console.log(`全屏最长亮run=${maxRunSeen}px (宽1280 高800)`);
console.log(logs.length ? 'CONSOLE ERR:\n' + logs.join('\n') : 'console 干净');
