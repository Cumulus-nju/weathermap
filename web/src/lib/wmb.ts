// WMB1 bundle 解码（与 pipeline/encode.py 的格式一一对应）+ manifest 加载
// bundle（gzip 解压后）：
//   magic "WMB1" (4B) | u32 nfields | u32 cols | u32 rows
//   每字段: u32 name_len | bytes name | f32 scale | f32 offset | int16[cols*rows] (LE)
// 解码: value = int16 * scale + offset
// 前端只解需要的字段（如 u_850/v_850），其余跳字节，省 CPU

const MAGIC = [0x57, 0x4d, 0x42, 0x31]; // "WMB1"
const DATA_BASE = import.meta.env.BASE_URL + 'data/';

export interface Timestep {
  fxx: number;
  validTime: string;
  file: string;
  sizeBytes: number;
}

export interface WmbManifest {
  format: string;
  generated: string;
  cycle: string;
  domain: {
    lon0: number; lat0: number; lon1: number; lat1: number;
    dlon: number; dlat: number; cols: number; rows: number;
  };
  fields: string[];
  timesteps: Timestep[];
}

export async function fetchManifest(): Promise<WmbManifest> {
  const r = await fetch(`${DATA_BASE}manifest.json`);
  if (!r.ok) throw new Error(`manifest 加载失败: ${r.status}`);
  return r.json();
}

export async function loadBundleFile(
  file: string,
  wanted: string[],
): Promise<Record<string, Float32Array>> {
  const r = await fetch(`${DATA_BASE}${file}`);
  if (!r.ok) throw new Error(`bundle 加载失败: ${file} ${r.status}`);
  return decodeBundle(await r.arrayBuffer(), wanted);
}

export async function decodeBundle(
  raw: ArrayBuffer,
  wanted: string[],
): Promise<Record<string, Float32Array>> {
  // gzip 解压（现代浏览器原生 DecompressionStream）
  // 注意：某些静态服务器（如 Vite dev）对 .gz 文件自动发送 Content-Encoding: gzip，
  // 此时浏览器已透明解压，bytes 不含 gzip 魔数——按魔数判断是否还需手动解压。
  const head = new Uint8Array(raw, 0, Math.min(raw.byteLength, 2));
  const isGzip = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
  const buf = isGzip
    ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : raw;
  const view = new DataView(buf);

  let p = 0;
  for (let i = 0; i < 4; i++) {
    if (new Uint8Array(buf, p, 4)[i] !== MAGIC[i]) throw new Error('WMB1 magic 不匹配');
  }
  p += 4;
  const nfields = view.getUint32(p, true); p += 4;
  const cols = view.getUint32(p, true); p += 4;
  const rows = view.getUint32(p, true); p += 4;
  const n = cols * rows;

  const want = new Set(wanted);
  const out: Record<string, Float32Array> = {};

  for (let i = 0; i < nfields; i++) {
    const nameLen = view.getUint32(p, true); p += 4;
    const name = new TextDecoder().decode(new Uint8Array(buf, p, nameLen)); p += nameLen;
    const scale = view.getFloat32(p, true); p += 4;
    const offset = view.getFloat32(p, true); p += 4;
    if (want.has(name)) {
      // p 可能因字段名长度不成 2 对齐 → 复制到对齐缓冲再建 Int16Array
      const bytes = new Uint8Array(n * 2);
      bytes.set(new Uint8Array(buf, p, n * 2));
      const i16 = new Int16Array(bytes.buffer);
      const arr = new Float32Array(n);
      for (let k = 0; k < n; k++) arr[k] = i16[k] * scale + offset;
      out[name] = arr;
    }
    p += n * 2;
  }
  return out;
}
