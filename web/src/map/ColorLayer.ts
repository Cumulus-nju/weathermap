import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import { useOverlay, useTheme, SURFACE_ONLY, type OverlayField } from '../store';
import { useTime } from '../lib/timeStore';
import { ensureGrid, getGrid, getGridByKey } from '../lib/dataLoader';
import { mercX, mercY, type WindGrid } from '../lib/grid';
import { CMAPS, cmapToPixels, fieldValueRange } from '../lib/colormaps';
import { OVERLAY_VERT, OVERLAY_FRAG } from './shaders';

// M4 色斑叠加层：温度/湿度/降水半透明色斑，画在风粒子下层。
// 与 WindLayer 共享 dataLoader 网格缓存 + 相同的 mercator 仿射投影；
// 字段按 (层,时次) 惰性上传 R32F 纹理，双时次按播放头 frac 交叉淡化（拖动平滑）。
// 只渲染网格 UV 域内的四边形，域外透明度为 0。

/** 叠加字段 -> WindGrid 上的字段数组（收窄为 float 数组键，保证索引类型；prmsl 为等压线专用） */
type FieldKey = 't' | 'rh' | 'apcp' | 'gust' | 'dpt' | 'tcdc' | 'lcdc' | 'mcdc' | 'hcdc' | 'prmsl';
const FIELD_KEY: Record<Exclude<OverlayField, 'off'>, FieldKey> = {
  temp: 't',
  rh: 'rh',
  apcp: 'apcp',
  gust: 'gust',
  dpt: 'dpt',
  tcdc: 'tcdc',
  lcdc: 'lcdc',
  mcdc: 'mcdc',
  hcdc: 'hcdc',
};

const QUAD_UV = new Float32Array([
  // 两个三角形覆盖整个网格域
  0, 0, 1, 0, 0, 1,
  0, 1, 1, 0, 1, 1,
]);

export class ColorLayer implements CustomLayerInterface {
  id = 'overlay';
  type = 'custom' as const;
  renderingMode = '2d' as const;

  private map!: MapLibreMap;
  private gl!: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private uCache = new Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>();
  /** `${field}|${level}:${fxx}` -> 字段纹理（附网格键，供 LRU 清理） */
  private texByKey = new Map<string, { tex: WebGLTexture; gridKey: string }>();
  private cmapByField = new Map<string, WebGLTexture>();
  private unsubs: (() => void)[] = [];

  // ---- 生命周期 ----
  onAdd(map: MapLibreMap, gl: WebGLRenderingContext) {
    this.map = map;
    this.gl = gl as WebGL2RenderingContext;
    const gl2 = this.gl;
    this.prog = this.link([OVERLAY_VERT, OVERLAY_FRAG]);
    this.vao = gl2.createVertexArray()!;
    gl2.bindVertexArray(this.vao);
    const buf = gl2.createBuffer();
    gl2.bindBuffer(gl2.ARRAY_BUFFER, buf);
    gl2.bufferData(gl2.ARRAY_BUFFER, QUAD_UV, gl2.STATIC_DRAW);
    gl2.enableVertexAttribArray(0);
    gl2.vertexAttribPointer(0, 2, gl2.FLOAT, false, 0, 0);
    gl2.bindVertexArray(null);
    // 叠加设置变化（开/关字段、改不透明度）时强制重绘（暂停 + 风层关时也要生效）
    this.unsubs.push(useOverlay.subscribe(() => this.map.triggerRepaint()));
  }

  onRemove() {
    const gl = this.gl;
    for (const { tex } of this.texByKey.values()) gl.deleteTexture(tex);
    for (const tex of this.cmapByField.values()) gl.deleteTexture(tex);
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.texByKey.clear();
    this.cmapByField.clear();
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  // ---- 渲染 ----
  // M5 等压线：mode 0=仅色斑 1=仅等压线 2=色斑+等压线（isoOn 决定）；prmsl 仅 surface
  render(_gl: WebGLRenderingContext) {
    const gl = this.gl;
    const o = useOverlay.getState();
    // mode：0=仅色斑 1=仅等压线 2=色斑+等压线（isoOn 决定）
    // ⚠️ 勿在 mode===0 时 return——那正是「只开色斑不开等压线」的常态！
    const mode: number = o.isoOn ? (o.field !== 'off' ? 2 : 1) : 0;
    if (o.field === 'off' && !o.isoOn) return; // 两者全关才跳过
    // 收窄：mode!==1 时必有色斑字段（TS 无法从 mode 推断，这里显式 null 化）
    const colorField: Exclude<OverlayField, 'off'> | null = o.field === 'off' ? null : o.field;
    const t = useTime.getState();
    const m = t.manifest;
    if (!m || m.timesteps.length === 0) return;
    // surface-only 色斑字段与等压线都要求地面层（UI 已自动切换，这里防御）
    if (t.level !== 'sfc' && (o.isoOn || (o.field !== 'off' && SURFACE_ONLY.has(o.field)))) return;

    const { domain } = m;
    const ts = m.timesteps;
    const n = ts.length;
    const i = Math.min(Math.max(t.index, 0), n - 1);
    const f0 = ts[i];
    const f1 = ts[(i + 1) % n];

    // 色斑分支（mode 1 跳过）
    let colorTex0: WebGLTexture | undefined;
    let colorTex1: WebGLTexture | undefined;
    let cGrid: WindGrid | undefined;
    let g0: WindGrid | undefined;
    let g1: WindGrid | undefined;
    let range: [number, number] = [0, 1];
    if (mode !== 1) {
      ensureGrid(t.level, f0.fxx);
      ensureGrid(t.level, f1.fxx);
      g0 = getGrid(t.level, f0.fxx);
      g1 = getGrid(t.level, f1.fxx);
      cGrid = g0 ?? g1;
      if (!cGrid) return; // 数据未就绪，等下一帧
      const k = FIELD_KEY[colorField!];
      if (!g0?.[k] && !g1?.[k]) return; // 该层无此字段（防御）
      colorTex0 = this.ensureFieldTex(k, t.level, f0.fxx);
      colorTex1 = this.ensureFieldTex(k, t.level, f1.fxx);
      if (!colorTex0 && !colorTex1) return; // 网格未就绪，等下一帧重试
      range = fieldValueRange(colorField!, [g0, g1]);
    }

    // 等压线分支（mode 0 跳过）：prmsl 固定取地面层
    let isoTex0: WebGLTexture | undefined;
    let isoTex1: WebGLTexture | undefined;
    let isoGrid: WindGrid | undefined;
    let i0: WindGrid | undefined;
    let i1: WindGrid | undefined;
    if (mode !== 0) {
      ensureGrid('sfc', f0.fxx);
      ensureGrid('sfc', f1.fxx);
      i0 = getGrid('sfc', f0.fxx);
      i1 = getGrid('sfc', f1.fxx);
      isoGrid = i0 ?? i1;
      if (!isoGrid) return;
      if (!i0?.prmsl && !i1?.prmsl) return;
      isoTex0 = this.ensureFieldTex('prmsl', 'sfc', f0.fxx);
      isoTex1 = this.ensureFieldTex('prmsl', 'sfc', f1.fxx);
      if (!isoTex0 && !isoTex1) return;
    }
    const bGrid = cGrid ?? isoGrid!;

    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const dw = gl.drawingBufferWidth;
    const dh = gl.drawingBufferHeight;
    const cssW = this.map.getCanvas().clientWidth || dw;
    const cssH = this.map.getCanvas().clientHeight || dh;
    const { lon0, lat0, lon1, lat1 } = domain;
    const p0 = this.map.project([lon0, lat0]);
    const p1 = this.map.project([lon1, lat1]);
    const m0x = mercX(lon0);
    const m0y = mercY(lat0);
    const m1x = mercX(lon1);
    const m1y = mercY(lat1);

    gl.viewport(0, 0, dw, dh);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // 预乘 alpha
    gl.useProgram(this.prog);

    gl.uniform1i(this.u('u_field0'), 0);
    gl.uniform1i(this.u('u_field1'), 1);
    gl.uniform1i(this.u('u_cmap'), 2);
    gl.uniform1i(this.u('u_iso0'), 3);
    gl.uniform1i(this.u('u_iso1'), 4);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTex0 ?? null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, colorTex1 ?? null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, o.field !== 'off' ? this.ensureCmap(o.field) : null);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, isoTex0 ?? null);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, isoTex1 ?? null);

    const colorMix = g0 && g1 && colorTex0 && colorTex1 ? t.frac : 0;
    const isoMix = i0 && i1 && isoTex0 && isoTex1 ? t.frac : 0;
    gl.uniform1f(this.u('u_mix'), mode === 1 ? isoMix : colorMix);
    gl.uniform1i(this.u('u_mode'), mode);
    gl.uniform2f(this.u('u_fieldSize'), bGrid.cols, bGrid.rows);
    gl.uniform2f(this.u('u_valRange'), range[0], range[1]);
    gl.uniform1f(this.u('u_opacity'), o.opacity);
    gl.uniform1f(this.u('u_isoInterval'), 400.0); // 4 hPa
    // 线色由主题决定：暗色暖白 / 亮色石板灰
    const theme = useTheme.getState().theme;
    const isoColor = theme === 'light' ? [0.32, 0.38, 0.5] : [0.95, 0.92, 0.83];
    gl.uniform3f(this.u('u_isoColor'), isoColor[0], isoColor[1], isoColor[2]);
    gl.uniform2f(this.u('u_domain'), lon0, lat0);
    gl.uniform2f(this.u('u_domainSpan'), lon1 - lon0, lat1 - lat0);
    gl.uniform2f(this.u('u_m0'), m0x, m0y);
    gl.uniform2f(this.u('u_scale'), (p1.x - p0.x) / (m1x - m0x), (p1.y - p0.y) / (m1y - m0y));
    gl.uniform2f(this.u('u_p0'), p0.x, p0.y);
    gl.uniform2f(this.u('u_cssSize'), cssW, cssH);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 还原（MapLibre 期望的状态）
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
  }

  // ---- 字段纹理（RGBA32F，值放 R 通道；NEAREST 过滤，着色器内手动双线性）----
  private ensureFieldTex(
    field: FieldKey,
    level: number | 'sfc',
    fxx: number,
  ): WebGLTexture | undefined {
    const gridKey = `${level}:${fxx}`;
    const key = `${field}|${gridKey}`;
    const hit = this.texByKey.get(key);
    if (hit) return hit.tex;
    const g = getGrid(level, fxx);
    const data = g?.[field];
    if (!g || !data) return undefined; // 网格未就绪（异步加载中），下一帧重试
    const gl = this.gl;
    const rgba = new Float32Array(g.cols * g.rows * 4);
    for (let i = 0; i < data.length; i++) rgba[i * 4] = data[i];
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, g.cols, g.rows, 0, gl.RGBA, gl.FLOAT, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texByKey.set(key, { tex, gridKey });
    this.prune();
    return tex;
  }

  /** 清理网格已被 dataLoader 淘汰（LRU）的字段纹理，防 GPU 内存泄漏 */
  private prune() {
    const gl = this.gl;
    for (const [k, { tex, gridKey }] of this.texByKey) {
      if (!getGridByKey(gridKey)) {
        gl.deleteTexture(tex);
        this.texByKey.delete(k);
      }
    }
  }

  /** 色带 -> 1D RGBA8 纹理（懒创建，按字段缓存） */
  private ensureCmap(field: Exclude<OverlayField, 'off'>): WebGLTexture {
    const hit = this.cmapByField.get(field);
    if (hit) return hit;
    const stops = CMAPS[field].stops;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 64, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, cmapToPixels({ id: field, name: '', unit: '', stops }));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.cmapByField.set(field, tex);
    return tex;
  }

  // ---- GL 工具（与 WindLayer 相同模式）----
  private link(sources: string[]): WebGLProgram {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, sources[0]);
    const fs = this.compile(gl.FRAGMENT_SHADER, sources[1]);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'a_uv');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link overlay: ' + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('compile overlay: ' + gl.getShaderInfoLog(sh) + '\n---\n' + src);
    }
    return sh;
  }

  private u(name: string): WebGLUniformLocation | null {
    let m = this.uCache.get(this.prog);
    if (!m) {
      m = {};
      this.uCache.set(this.prog, m);
    }
    if (!(name in m)) m[name] = this.gl.getUniformLocation(this.prog, name);
    return m[name];
  }
}
