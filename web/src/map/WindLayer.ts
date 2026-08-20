import type { Map as MapLibreMap, CustomLayerInterface, CustomRenderMethodInput } from 'maplibre-gl';
import { useWindSettings } from '../store';
import { useTime } from '../lib/timeStore';
import { type WindGrid, mercX, mercY } from '../lib/grid';
import { ensureGrid, getGrid, getGridByKey, keyOf } from '../lib/dataLoader';
import { COMPOSITE_FRAG, DRAW_FRAG, DRAW_VERT, FADE_FRAG, FULLSCREEN_VERT, UPDATE_FRAG } from './shaders';

// 物理 m/s -> 网格UV/s 的视觉倍率：急流 30 m/s 约以 0.5%/秒 划过域（速度滑条在此基础上倍乘）
const VISUAL_SPEED = 17000;
// 配色归一化的最大风速（固定值让不同时次强度可比；M4 再做自适应色带）
const COLOR_SPEED_MAX = 40;
// 自动播放每个预报时次持续秒数（41 时次 ≈ 100 秒一圈）
const SECONDS_PER_STEP = 2.5;

// MapLibre CustomLayerInterface 实现：WebGL2 风粒子层
// 移植自 mapbox/webgl-wind（MIT）的 ping-pong 粒子算法
// 渲染链：state 纹理 ping-pong（平流）→ trail 帧缓冲（fade+draw）→ 叠加回 MapLibre 帧缓冲
// M2 时间轴：相邻两个时次的风场纹理（u_wind0/u_wind1）按 frac 在着色器里交叉淡化，
// 拖动时间轴粒子丝滑过渡不跳变；异步预取下一对时次。
// 限制：基于轴对齐 mercator 仿射投影，禁用旋转/俯仰。
export class WindLayer implements CustomLayerInterface {
  id = 'wind';
  type = 'custom' as const;
  renderingMode = '2d' as const;

  private map!: MapLibreMap;
  private gl!: WebGL2RenderingContext;

  // 时次纹理缓存（按 `${level}:${fxx}` 键）；解码网格在 dataLoader 里共享
  private texByKey = new Map<string, WebGLTexture>();
  private lastKey: string | null = null; // 最近渲染的 (层,时次)，数据未就绪时兜底
  private colorMax = COLOR_SPEED_MAX; // 配色归一化最大风速，自适应但平滑

  // 粒子状态 ping-pong：fboA→texA, fboB→texB（存 x,y,prevX,prevY）
  private particleTexSize = 1; // P×P，P = ceil(sqrt(N))
  private fboA!: WebGLFramebuffer;
  private texA!: WebGLTexture;
  private fboB!: WebGLFramebuffer;
  private texB!: WebGLTexture;
  private stateReadTex!: WebGLTexture; // 本轮采样源
  private stateWriteFbo!: WebGLFramebuffer; // 本轮写入目标
  private lastCount = -1;

  // trail 帧缓冲（粒子尾迹累积）
  private trailFbo: WebGLFramebuffer | null = null;
  private trailTex: WebGLTexture | null = null;
  private trailW = 0;
  private trailH = 0;

  // 程序 + 按 program 缓存的 uniform location
  private progUpdate!: WebGLProgram;
  private progDraw!: WebGLProgram;
  private progFade!: WebGLProgram;
  private progComposite!: WebGLProgram;
  private uCache = new Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>();

  // VAO
  private vaoQuad!: WebGLVertexArrayObject; // 全屏四边形（update/fade/composite）
  private vaoLines!: WebGLVertexArrayObject; // 粒子线段
  private lineCount = 0;

  private lastFrame = 0;
  private lastDpr = 1;

  // M4-2 动态粒子数：EMA 估 FPS，自动模式定期升降粒子数以维持 ~35fps（弱机/软渲染自适应）
  private fpsEma = 0;
  private governTimer = 0;

  // ---- 生命周期 ----
  onAdd(map: MapLibreMap, gl: WebGLRenderingContext) {
    this.map = map;
    this.gl = gl as WebGL2RenderingContext;
    if (!this.gl.getExtension('EXT_color_buffer_float')) {
      console.warn('WindLayer: EXT_color_buffer_float 不可用，浮点帧缓冲会失败');
    }
    this.buildPrograms();
    this.buildQuadVao();
    // 软渲染（SwiftShader/llvmpipe，无硬件 GPU）没有 60fps 预算：自动模式默认压低粒子数
    const renderer = String(this.gl.getParameter(this.gl.RENDERER));
    if (/swiftshader|llvmpipe|software|swrast|angle.*(software|llvmpipe)/i.test(renderer)) {
      const ws = useWindSettings.getState();
      if (ws.autoParticles) ws.setParticleCount(30_000);
    }
    this.ensureParticles();
    this.lastFrame = performance.now();
  }

  onRemove() {
    const gl = this.gl;
    const dels: (WebGLTexture | WebGLFramebuffer | WebGLProgram | WebGLVertexArrayObject | null)[] = [
      this.progUpdate, this.progDraw, this.progFade, this.progComposite,
      this.texA, this.texB, this.fboA, this.fboB,
      this.trailFbo, this.trailTex, this.vaoQuad, this.vaoLines,
    ];
    for (const tex of this.texByKey.values()) dels.push(tex);
    for (const o of dels) {
      if (!o) continue;
      if (o instanceof WebGLTexture) gl.deleteTexture(o);
      else if (o instanceof WebGLFramebuffer) gl.deleteFramebuffer(o);
      else if (o instanceof WebGLProgram) gl.deleteProgram(o);
      else if (o instanceof WebGLVertexArrayObject) gl.deleteVertexArray(o);
    }
    this.trailFbo = null;
    this.trailTex = null;
    this.texByKey.clear();
  }

  // ---- 渲染主循环 ----
  render(_gl: WebGLRenderingContext, _options: CustomRenderMethodInput) {
    const gl = _gl as WebGL2RenderingContext; // MapLibre v5 内部已是 WebGL2，仅类型上未收窄
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;

    // 自动播放推进（风层关时时间轴也照走，scrubber 跟随）
    const t0 = useTime.getState();
    if (t0.playing && t0.manifest && t0.manifest.timesteps.length > 1) {
      const n = t0.manifest.timesteps.length;
      let v = t0.index + t0.frac + dt / SECONDS_PER_STEP;
      if (v >= n) v = 0; // 播放到结尾回卷
      const idx = Math.floor(v);
      const fr = v - idx;
      if (idx !== t0.index || fr !== t0.frac) useTime.setState({ index: idx, frac: fr });
    }

    const s = useWindSettings.getState();
    if (!s.enabled) {
      // 关层时若仍在播放，保持时间轴走（触发 repaint 让 scrubber 更新）
      if (t0.playing) this.map.triggerRepaint();
      return;
    }

    // M4-2 动态粒子数：EMA 估 FPS，自动模式每 ~3s 升降一次（×0.6 / ×1.4）维持 ~35fps
    const fpsNow = dt > 0 ? 1 / dt : 60;
    this.fpsEma = this.fpsEma ? this.fpsEma * 0.95 + fpsNow * 0.05 : fpsNow;
    this.governTimer += dt;
    if (s.autoParticles && this.governTimer > 3) {
      this.governTimer = 0;
      const cur = s.particleCount;
      let next = cur;
      if (this.fpsEma < 28) next = Math.max(10_000, Math.round(cur * 0.6));
      else if (this.fpsEma > 50 && cur < 200_000) next = Math.min(200_000, Math.round(cur * 1.4));
      if (next !== cur) s.setParticleCount(next);
    }

    const t = useTime.getState();
    const manifest = t.manifest;
    if (!manifest || manifest.timesteps.length === 0) return;
    const { domain } = manifest;

    // 记录 MapLibre 当前绑定的帧缓冲，composite 时恢复——直接绑 null 会在多 pass 场景画丢
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;

    const dw = gl.drawingBufferWidth;
    const dh = gl.drawingBufferHeight;
    const dpr = this.map.getPixelRatio();
    if (dpr !== this.lastDpr) {
      this.lastDpr = dpr;
      this.trailW = 0; // 强制重建 trail（尺寸变化）
      this.trailH = 0;
    }

    if (s.particleCount !== this.lastCount) this.ensureParticles();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // ---- 时间轴：当前/下一时次 + 预取（按当前气压层）----
    const level = useTime.getState().level;
    const ts = manifest.timesteps;
    const n = ts.length;
    const i = Math.min(Math.max(t.index, 0), n - 1);
    const f0 = ts[i];
    const f1 = ts[(i + 1) % n];
    const f2 = ts[(i + 2) % n];
    ensureGrid(level, f0.fxx);
    ensureGrid(level, f1.fxx);
    ensureGrid(level, f2.fxx);

    // 数据未就绪时回退到最近渲染的 (层,时次)；f0/f1 都齐才交叉淡化
    const g0 = getGrid(level, f0.fxx);
    const g1 = getGrid(level, f1.fxx);
    const bGrid = g0 ?? g1 ?? (this.lastKey ? getGridByKey(this.lastKey) : undefined);
    if (!bGrid) {
      // 数据还在加载：保持 repaint 让时间轴继续走，数据到位自动接上
      if (t.playing) this.map.triggerRepaint();
      return;
    }
    const bKey = g0 ? keyOf(level, f0.fxx) : g1 ? keyOf(level, f1.fxx) : this.lastKey!;
    const nKey = g1 ? keyOf(level, f1.fxx) : bKey;
    const mix = g0 && g1 ? t.frac : 0;
    this.lastKey = bKey;
    this.pruneTextures();

    this.ensureTex(bKey);
    this.ensureTex(nKey);
    const tex0 = this.texByKey.get(bKey)!;
    const tex1 = this.texByKey.get(nKey)!;
    const windW = bGrid.cols;
    const windH = bGrid.rows;

    // 投影参数（CSS 像素系；轴对齐，依赖禁旋转）
    const cssW = this.map.getCanvas().clientWidth || dw;
    const cssH = this.map.getCanvas().clientHeight || dh;
    const { lon0, lat0, lon1, lat1 } = domain;
    const p0 = this.map.project([lon0, lat0]);
    const p1 = this.map.project([lon1, lat1]);
    const m0x = mercX(lon0), m0y = mercY(lat0);
    const m1x = mercX(lon1), m1y = mercY(lat1);
    const scaleX = (p1.x - p0.x) / (m1x - m0x);
    const scaleY = (p1.y - p0.y) / (m1y - m0y);

    // ---- pass1: update（平流粒子）----
    this.ensureTrail(dw, dh);
    this.swapState(); // 读上一轮写入的、写另一块
    gl.viewport(0, 0, this.particleTexSize, this.particleTexSize);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateWriteFbo);
    gl.useProgram(this.progUpdate);
    gl.uniform1i(this.u(this.progUpdate, 'u_wind0'), 0);
    gl.uniform1i(this.u(this.progUpdate, 'u_wind1'), 1);
    gl.uniform1i(this.u(this.progUpdate, 'u_state'), 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.stateReadTex);
    gl.uniform2f(this.u(this.progUpdate, 'u_windSize'), windW, windH);
    gl.uniform2f(this.u(this.progUpdate, 'u_domain'), lon0, lat0);
    gl.uniform2f(this.u(this.progUpdate, 'u_domainSpan'), lon1 - lon0, lat1 - lat0);
    gl.uniform1f(this.u(this.progUpdate, 'u_mix'), mix);
    gl.uniform1f(this.u(this.progUpdate, 'u_dt'), dt);
    gl.uniform1f(this.u(this.progUpdate, 'u_speed'), s.speed * VISUAL_SPEED);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ---- pass2: fade trail ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo);
    gl.viewport(0, 0, dw, dh);
    gl.useProgram(this.progFade);
    gl.uniform1f(this.u(this.progFade, 'u_fadeAmt'), 1 - s.fade);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ---- pass3: draw 粒子线段（叠加进 trail）----
    gl.useProgram(this.progDraw);
    gl.uniform1i(this.u(this.progDraw, 'u_state'), 0);
    gl.uniform1i(this.u(this.progDraw, 'u_wind0'), 1);
    gl.uniform1i(this.u(this.progDraw, 'u_wind1'), 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateReadTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tex1);
    gl.uniform2f(this.u(this.progDraw, 'u_particleSize'), this.particleTexSize, this.particleTexSize);
    // 配色归一化：自适应当前场最大风速但平滑逼近，换层/跨时次不跳色（高空急流不饱和）
    const target = bGrid.maxSpeed ?? COLOR_SPEED_MAX;
    this.colorMax = this.colorMax * 0.93 + target * 0.07;
    gl.uniform1f(this.u(this.progDraw, 'u_maxSpeed'), Math.max(6, this.colorMax));
    gl.uniform1f(this.u(this.progDraw, 'u_lineAlpha'), s.streak);
    gl.uniform1i(this.u(this.progDraw, 'u_palette'), s.palette);
    gl.uniform1f(this.u(this.progDraw, 'u_mix'), mix);
    gl.uniform2f(this.u(this.progDraw, 'u_m0'), m0x, m0y);
    gl.uniform2f(this.u(this.progDraw, 'u_scale'), scaleX, scaleY);
    gl.uniform2f(this.u(this.progDraw, 'u_p0'), p0.x, p0.y);
    gl.uniform2f(this.u(this.progDraw, 'u_cssSize'), cssW, cssH);
    gl.uniform2f(this.u(this.progDraw, 'u_windSize'), windW, windH);
    gl.uniform2f(this.u(this.progDraw, 'u_domain'), lon0, lat0);
    gl.uniform2f(this.u(this.progDraw, 'u_domainSpan'), lon1 - lon0, lat1 - lat0);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vaoLines);
    gl.drawArrays(gl.LINES, 0, this.lineCount);

    // ---- pass4: composite trail -> MapLibre 帧缓冲（加色发光）----
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(0, 0, dw, dh);
    gl.useProgram(this.progComposite);
    gl.uniform1i(this.u(this.progComposite, 'u_trail'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 还原状态（MapLibre 期望 blendFunc(ONE, ONE_MINUS_SRC_ALPHA)）
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    this.map.triggerRepaint();
  }

  // ---- 时次数据加载（网格在 dataLoader 共享缓存，这里只管上传纹理）----
  private gridToWindData(g: WindGrid): Float32Array {
    const data = new Float32Array(g.cols * g.rows * 4);
    for (let k = 0; k < g.cols * g.rows; k++) {
      data[k * 4] = g.u[k];
      data[k * 4 + 1] = g.v[k];
    }
    return data;
  }

  private ensureTex(key: string) {
    if (this.texByKey.has(key)) return;
    const g = getGridByKey(key);
    if (!g) return;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, g.cols, g.rows, 0, gl.RGBA, gl.FLOAT, this.gridToWindData(g));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texByKey.set(key, tex);
  }

  /** 清理 dataLoader 已淘汰（LRU）的网格对应纹理，防 GPU 内存泄漏 */
  private pruneTextures() {
    const gl = this.gl;
    for (const [k, tex] of this.texByKey) {
      if (!getGridByKey(k)) {
        gl.deleteTexture(tex);
        this.texByKey.delete(k);
      }
    }
  }

  // ---- GL 初始化 ----
  private buildPrograms() {
    this.progUpdate = this.link([FULLSCREEN_VERT, UPDATE_FRAG]);
    this.progDraw = this.link([DRAW_VERT, DRAW_FRAG]);
    this.progFade = this.link([FULLSCREEN_VERT, FADE_FRAG]);
    this.progComposite = this.link([FULLSCREEN_VERT, COMPOSITE_FRAG]);
  }

  private link(sources: string[]): WebGLProgram {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, sources[0]);
    const fs = this.compile(gl.FRAGMENT_SHADER, sources[1]);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.bindAttribLocation(prog, 1, 'a_index');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link program: ' + gl.getProgramInfoLog(prog));
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
      throw new Error('compile: ' + gl.getShaderInfoLog(sh) + '\n---\n' + src);
    }
    return sh;
  }

  /** per-program uniform location（location 在不同 program 间不通用） */
  private u(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.uCache.get(prog);
    if (!m) {
      m = {};
      this.uCache.set(prog, m);
    }
    if (!(name in m)) m[name] = this.gl.getUniformLocation(prog, name);
    return m[name];
  }

  private buildQuadVao() {
    const gl = this.gl;
    this.vaoQuad = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoQuad);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private ensureParticles() {
    const gl = this.gl;
    const N = useWindSettings.getState().particleCount;
    const P = Math.ceil(Math.sqrt(N));
    this.particleTexSize = P;

    // 重建（粒子数变化时释放旧的）
    if (this.texA) {
      gl.deleteTexture(this.texA);
      gl.deleteTexture(this.texB);
      gl.deleteFramebuffer(this.fboA);
      gl.deleteFramebuffer(this.fboB);
      gl.deleteVertexArray(this.vaoLines);
    }

    const makeTex = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, P, P);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const makeFbo = (t: WebGLTexture) => {
      const f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return f;
    };

    this.texA = makeTex();
    this.texB = makeTex();
    this.fboA = makeFbo(this.texA);
    this.fboB = makeFbo(this.texB);
    this.assertFbo(this.fboA);
    this.assertFbo(this.fboB);
    this.stateReadTex = this.texA;
    this.stateWriteFbo = this.fboB;

    // 初始化：随机位置。两块纹理都要写——首次 render 的 swap 可能从任一块开始读，
    // 若另一块是未初始化的零，所有粒子会塌缩到同一点
    const data = new Float32Array(P * P * 4);
    for (let i = 0; i < P * P; i++) {
      const x = Math.random();
      const y = Math.random();
      data[i * 4] = x;
      data[i * 4 + 1] = y;
      data[i * 4 + 2] = x;
      data[i * 4 + 3] = y;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, P, P, gl.RGBA, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, P, P, gl.RGBA, gl.FLOAT, data);

    // 线段缓冲 0..2N-1
    this.lineCount = N * 2;
    const idx = new Float32Array(this.lineCount);
    for (let i = 0; i < this.lineCount; i++) idx[i] = i;
    this.vaoLines = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoLines);
    const lb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lb);
    gl.bufferData(gl.ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.lastCount = N;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** FBO 不完整时抛错——否则 WebGL 会静默跳过该 pass，很难排查 */
  private assertFbo(_fbo: WebGLFramebuffer) {
    const gl = this.gl;
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`WindLayer: framebuffer 不完整 (${status})`);
    }
  }

  /** ping-pong：本轮写入的纹理成为下轮读取源 */
  private swapState() {
    this.stateReadTex = this.stateWriteFbo === this.fboA ? this.texA : this.texB;
    this.stateWriteFbo = this.stateWriteFbo === this.fboA ? this.fboB : this.fboA;
  }

  private ensureTrail(w: number, h: number) {
    if (this.trailTex && this.trailW === w && this.trailH === h) return;
    const gl = this.gl;
    if (this.trailFbo) gl.deleteFramebuffer(this.trailFbo);
    if (this.trailTex) gl.deleteTexture(this.trailTex);
    this.trailW = w;
    this.trailH = h;
    this.trailTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.trailFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.trailTex, 0);
    this.assertFbo(this.trailFbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
