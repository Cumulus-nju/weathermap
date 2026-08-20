import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import { useOverlay, type OverlayField } from '../store';
import { useTime } from '../lib/timeStore';
import { ensureGrid, getGrid, getGridByKey } from '../lib/dataLoader';
import { mercX, mercY } from '../lib/grid';
import { CMAPS, cmapToPixels, fieldValueRange } from '../lib/colormaps';
import { OVERLAY_VERT, OVERLAY_FRAG } from './shaders';

// M4 色斑叠加层：温度/湿度/降水半透明色斑，画在风粒子下层。
// 与 WindLayer 共享 dataLoader 网格缓存 + 相同的 mercator 仿射投影；
// 字段按 (层,时次) 惰性上传 R32F 纹理，双时次按播放头 frac 交叉淡化（拖动平滑）。
// 只渲染网格 UV 域内的四边形，域外透明度为 0。

/** 叠加字段 -> WindGrid 上的字段数组（收窄为 float 数组键，保证索引类型） */
type FieldKey = 't' | 'rh' | 'apcp';
const FIELD_KEY: Record<Exclude<OverlayField, 'off'>, FieldKey> = {
  temp: 't',
  rh: 'rh',
  apcp: 'apcp',
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
  render(_gl: WebGLRenderingContext) {
    const gl = this.gl;
    const o = useOverlay.getState();
    if (o.field === 'off') return;
    const t = useTime.getState();
    const m = t.manifest;
    if (!m || m.timesteps.length === 0) return;
    // 降水只在地面层有
    if (o.field === 'apcp' && t.level !== 'sfc') return;

    const { domain } = m;
    const ts = m.timesteps;
    const n = ts.length;
    const i = Math.min(Math.max(t.index, 0), n - 1);
    const f0 = ts[i];
    const f1 = ts[(i + 1) % n];

    ensureGrid(t.level, f0.fxx);
    ensureGrid(t.level, f1.fxx);
    const g0 = getGrid(t.level, f0.fxx);
    const g1 = getGrid(t.level, f1.fxx);
    const bGrid = g0 ?? g1;
    if (!bGrid) return; // 数据未就绪，等下一帧
    const k = FIELD_KEY[o.field];
    if (!g0?.[k] && !g1?.[k]) return; // 该层无此字段（防御）

    const tex0 = this.ensureFieldTex(o.field, t.level, f0.fxx);
    const tex1 = this.ensureFieldTex(o.field, t.level, f1.fxx);
    if (!tex0 && !tex1) return; // 网格未就绪，等下一帧重试
    const field0 = (tex0 ?? tex1)!;
    const field1 = (tex1 ?? tex0)!;
    const range = fieldValueRange(o.field, [g0, g1]);
    const cmapTex = this.ensureCmap(o.field);

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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, field0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, field1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, cmapTex);

    gl.uniform1f(this.u('u_mix'), g0 && g1 && tex0 && tex1 ? t.frac : 0);
    gl.uniform2f(this.u('u_fieldSize'), bGrid.cols, bGrid.rows);
    gl.uniform2f(this.u('u_valRange'), range[0], range[1]);
    gl.uniform1f(this.u('u_opacity'), o.opacity);
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
    field: Exclude<OverlayField, 'off'>,
    level: number | 'sfc',
    fxx: number,
  ): WebGLTexture | undefined {
    const gridKey = `${level}:${fxx}`;
    const key = `${field}|${gridKey}`;
    const hit = this.texByKey.get(key);
    if (hit) return hit.tex;
    const g = getGrid(level, fxx);
    const data = g?.[FIELD_KEY[field]];
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
