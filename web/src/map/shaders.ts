// 风粒子 WebGL 着色器（GLSL ES 3.00 / WebGL2）
// 架构：两 pass
//   pass1 update —— 在 ping-pong 状态纹理上平流粒子
//   pass2 draw   —— 把每个粒子画成 prev→cur 线段（LINES），叠加进 trail 帧缓冲

// 全屏四边形（update / fade / composite 共用）
export const FULLSCREEN_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// 共享：网格 UV -> clip 的坐标变换（风层 + 色斑叠加层共用）
// 依赖轴对齐 mercator 仿射投影（地图禁旋转/俯仰）
const GRID_MATH = `
uniform vec2 u_domain;     // lon0, lat0
uniform vec2 u_domainSpan; // (lon1-lon0, lat1-lat0)
uniform vec2 u_m0;         // 参考点 mercator 坐标
uniform vec2 u_scale;      // mercator->CSS px 缩放
uniform vec2 u_p0;         // 参考点 CSS px
uniform vec2 u_cssSize;    // 画布 CSS px

// Web Mercator：lonlat -> [0,1]²
vec2 mercator(vec2 lonlat) {
  float x = (lonlat.x + 180.0) / 360.0;
  float rad = radians(lonlat.y);
  float y = (1.0 - log(tan(rad) + 1.0 / cos(rad)) / 3.141592653589793) / 2.0;
  return vec2(x, y);
}

// 网格 UV [0,1]² -> 屏幕 CSS px
vec2 gridToScreen(vec2 g) {
  vec2 lonlat = u_domain + g * u_domainSpan;
  vec2 w = mercator(lonlat);
  return (w - u_m0) * u_scale + u_p0;
}

// 网格 UV [0,1]² -> clip
vec2 gridToClip(vec2 g) {
  vec2 s = gridToScreen(g);
  return vec2(s.x / u_cssSize.x * 2.0 - 1.0, -(s.y / u_cssSize.y * 2.0 - 1.0));
}

// 屏幕 CSS px -> clip（与 gridToClip 的 y 翻转一致）
vec2 screenToClip(vec2 s) {
  return vec2(s.x / u_cssSize.x * 2.0 - 1.0, -(s.y / u_cssSize.y * 2.0 - 1.0));
}
`;

// 风层共享：坐标变换 + 双线性采样（拼进各 pass）
// 注意：uniform 声明必须在函数引用之前（UPDATE_FRAG 也包含 COMMON）。
// u_wind0/u_wind1 + u_mix 实现时间轴交叉淡化：相邻两个时次的风场按 frac 混合。
const COMMON = `
${GRID_MATH}
uniform vec2 u_windSize;   // 风场纹理尺寸 (cols, rows)
uniform sampler2D u_wind0; // 当前时次风场
uniform sampler2D u_wind1; // 下一时次风场
uniform float u_mix;       // 0..1 时次插值系数

// 单纹理双线性采样（NEAREST 纹理 + 手动插值）
vec2 sampleTex(sampler2D tex, vec2 gridUV) {
  vec2 tc = gridUV * u_windSize - 0.5;
  vec2 base = floor(tc);
  vec2 fr = fract(tc);
  vec2 inv = 1.0 / u_windSize;
  vec2 c00 = (base + 0.5) * inv;
  vec2 c10 = (base + vec2(1.0, 0.0) + 0.5) * inv;
  vec2 c01 = (base + vec2(0.0, 1.0) + 0.5) * inv;
  vec2 c11 = (base + vec2(1.0, 1.0) + 0.5) * inv;
  vec2 w00 = texture(tex, c00).xy;
  vec2 w10 = texture(tex, c10).xy;
  vec2 w01 = texture(tex, c01).xy;
  vec2 w11 = texture(tex, c11).xy;
  vec2 a = mix(w00, w10, fr.x);
  vec2 b = mix(w01, w11, fr.x);
  return mix(a, b, fr.y);
}

// 时间插值风场：当前时次与下一时次按 u_mix 交叉淡化
vec2 sampleWind(vec2 gridUV) {
  return mix(sampleTex(u_wind0, gridUV), sampleTex(u_wind1, gridUV), u_mix);
}

float hash1(float x) {
  return fract(sin(x * 12.9898) * 43758.5453);
}
`;

// ---- pass1 update：平流粒子 ----
export const UPDATE_VERT = FULLSCREEN_VERT;

export const UPDATE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_state;  // 上一步粒子状态 (x,y,prevX,prevY)
uniform float u_dt;         // 秒
uniform float u_speed;      // 视觉速度倍率（物理 UV/s × 倍率）
uniform float u_elapsed;    // 层累计运行秒数（重生相位基准，只增不减）
uniform float u_reseedPeriod; // 粒子平均寿命（秒）：到期随机重生
${COMMON}
void main() {
  vec4 st = texture(u_state, v_uv);
  vec2 pos = st.xy;
  vec2 wind = sampleWind(pos); // m/s
  // 物理换算：m/s -> 网格UV/s，再乘视觉倍率（实时风速下粒子走得肉眼可见）
  vec2 lonlat = u_domain + pos * u_domainSpan;
  float cosLat = max(cos(radians(lonlat.y)), 0.15);
  vec2 degPerSec = wind / (111320.0 * vec2(cosLat, 1.0));
  vec2 uvPerSec = degPerSec / u_domainSpan;
  vec2 newPos = pos + uvPerSec * u_speed * u_dt;
  // M7-1 粒子寿命重生：平流会把粒子卷进气旋/急流等吸引子、别处越卷越空（气旋中心出现空洞）；
  // 每个粒子按"时间相位+位置哈希"平均每 u_reseedPeriod 秒随机重生一次，全局覆盖一直均匀（Windy 同款）。
  // 相位跨整周期即触发：phase 随 u_elapsed 每周期 0→1 走一次，落在 [0, dt/L] 窗口就重生。
  float agePhase = fract(u_elapsed / u_reseedPeriod + hash1(pos.x * 3.1 + pos.y * 7.7 + 0.13));
  bool doReseed = (newPos.x < 0.0 || newPos.x > 1.0 || newPos.y < 0.0 || newPos.y > 1.0
      || agePhase < u_dt / u_reseedPeriod);
  if (doReseed) {
    newPos = vec2(hash1(pos.x * 3.1 + 0.13), hash1(pos.y * 7.7 + 0.57));
  }
  // M7-3 重生点 prev=cur → 线段零长，杜绝任何距离的拉丝：
  // reseed 跳变 <0.25 UV 时 DRAW_VERT 的 abnorm 阈值拦不住，高 zoom 下 UV 小跳就是全屏长线。
  // 重生瞬间把 prev 也置为新位置，粒子上帧路径(旧 prev)不参与画线。
  fragColor = vec4(newPos, doReseed ? newPos : pos);
}
`;

// ---- pass2 draw：线段 ----
export const DRAW_VERT = `#version 300 es
precision highp float;
in float a_index;  // 0..2N-1，偶数=prev 奇数=cur
uniform sampler2D u_state;
uniform vec2 u_particleSize;
uniform float u_maxSpeed;
uniform float u_lineAlpha;
${COMMON}
out float v_speed01;

vec2 idxToUV(float idx) {
  float x = mod(idx, u_particleSize.x);
  float y = floor(idx / u_particleSize.x);
  return (vec2(x, y) + 0.5) / u_particleSize;
}

// 最低可见拖尾长度（CSS px）：低风速粒子每帧位移不足 1px，直接画只剩一个亮点、
// 静风区大片空白；沿风方向把段长拉伸到这个下限，让弱风区也有"短短粒子"填充画面（Windy 同款观感）。
const float MIN_SEG_PX = 3.0;

void main() {
  float pIdx = floor(a_index * 0.5);
  float isHead = mod(a_index, 2.0);
  vec4 st = texture(u_state, idxToUV(pIdx));
  vec2 cur = st.xy;
  vec2 prev = st.zw;
  // 跨域重定位的粒子（prev→cur 一跳很远）退化为零长线段：粒子直接出现在新位置，
  // 避免从边界到域内随机点的满屏拉丝。正常平流单帧位移远小于 0.25 UV
  // （上限≈0.18 UV @ 速度滑条4×/80m/s 急流/dt 0.05），只有 reset 才跳 ≥0.3。
  float abnorm = step(0.25, length(cur - prev));
  vec2 tail = mix(prev, cur, abnorm); // reset 时尾端=头部 → 零长线段
  // 屏幕空间拉伸：方向 = prev→cur，头部=粒子当前位置，尾端沿反方向延伸到最短段长。
  // reset 段长 0 → dir=0 → 仍零长（不破坏"重定位不拉丝"的既有约束）。
  vec2 curS = gridToScreen(cur);
  vec2 tailS = gridToScreen(tail);
  vec2 seg = curS - tailS;
  float segLen = length(seg);
  vec2 dir = segLen > 1e-5 ? seg / segLen : vec2(0.0, 0.0);
  vec2 posS = isHead > 0.5 ? curS : curS - dir * max(segLen, MIN_SEG_PX);
  gl_Position = vec4(screenToClip(posS), 0.0, 1.0);
  vec2 wind = sampleWind(st.xy);
  v_speed01 = clamp(length(wind) / u_maxSpeed, 0.0, 1.0);

}
`;

export const DRAW_FRAG = `#version 300 es
precision highp float;
in float v_speed01;
out vec4 fragColor;
uniform int u_palette;      // 配色预设：0=标准 1=极光 2=白 3=珊瑚
uniform float u_lineAlpha;

// 5 段色阶插值（s 0..1 由速度/最大风速归一化）
vec3 ramp(float s, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4) {
  s = clamp(s, 0.0, 1.0);
  if (s < 0.2) return mix(c0, c1, s / 0.2);
  else if (s < 0.4) return mix(c1, c2, (s - 0.2) / 0.2);
  else if (s < 0.6) return mix(c2, c3, (s - 0.4) / 0.2);
  else if (s < 0.8) return mix(c3, c4, (s - 0.6) / 0.2);
  else return c4;
}

// 标准：蓝→青→绿→黄→红（默认，暖区醒目）
vec3 palStandard(float s) {
  return ramp(s,
    vec3(0.05, 0.25, 0.60), vec3(0.05, 0.55, 0.75), vec3(0.10, 0.75, 0.50),
    vec3(0.85, 0.85, 0.25), vec3(0.90, 0.20, 0.30));
}
// 极光：深蓝→青→翠绿→紫（冷调，弱风区细节好）
vec3 palAurora(float s) {
  return ramp(s,
    vec3(0.03, 0.16, 0.42), vec3(0.05, 0.50, 0.65), vec3(0.25, 0.80, 0.40),
    vec3(0.80, 0.85, 0.20), vec3(0.75, 0.35, 0.85));
}
// 白：黑→灰→白（底图感，纯矢量感）
vec3 palWhite(float s) {
  return ramp(s,
    vec3(0.10, 0.12, 0.16), vec3(0.30, 0.34, 0.40), vec3(0.55, 0.60, 0.66),
    vec3(0.80, 0.84, 0.88), vec3(1.00, 1.00, 1.00));
}
// 珊瑚：紫→粉→橙→米黄（暖调，风速梯度分明）
vec3 palCoral(float s) {
  return ramp(s,
    vec3(0.25, 0.08, 0.35), vec3(0.60, 0.18, 0.50), vec3(0.90, 0.38, 0.42),
    vec3(1.00, 0.62, 0.30), vec3(1.00, 0.92, 0.55));
}

void main() {
  vec3 col = u_palette == 1 ? palAurora(v_speed01)
    : u_palette == 2 ? palWhite(v_speed01)
    : u_palette == 3 ? palCoral(v_speed01)
    : palStandard(v_speed01);
  fragColor = vec4(col * u_lineAlpha, 1.0);
}
`;

// ---- fade：把 trail 缓冲整体淡掉 ----
export const FADE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform float u_fadeAmt;  // 每帧淡去比例（0~1）
void main() {
  fragColor = vec4(0.0, 0.0, 0.0, u_fadeAmt);
}
`;

// ---- composite：trail 纹理叠加到屏幕 ----
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_trail;
void main() {
  fragColor = vec4(texture(u_trail, v_uv).rgb, 1.0);
}
`;

// ---- M4 色斑叠加层：域内全屏四边形，色带映射 + 时次交叉淡化 ----
// 顶点按网格 UV 走 gridToClip（与风层同投影）；片元采样 1D 色带纹理。
export const OVERLAY_VERT = `#version 300 es
precision highp float;
in vec2 a_uv; // 网格 UV [0,1]²，v=0 南（纹理行序）
${GRID_MATH}
out vec2 v_uv;
void main() {
  gl_Position = vec4(gridToClip(a_uv), 0.0, 1.0);
  v_uv = a_uv;
}
`;

export const OVERLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_field0; // 当前时次字段（色斑）
uniform sampler2D u_field1; // 下一时次字段（色斑）
uniform vec2 u_fieldSize;   // 字段纹理尺寸 (cols, rows)
uniform float u_mix;        // 0..1 时次插值
uniform sampler2D u_cmap;   // 色带 1D 纹理（RGBA8, 64px）
uniform vec2 u_valRange;    // (min, max)
uniform float u_opacity;
// M5 等压线：mode 0=仅色斑 1=仅等压线 2=色斑+等压线
uniform int u_mode;
uniform sampler2D u_iso0;   // 当前时次 prmsl（Pa）
uniform sampler2D u_iso1;   // 下一时次 prmsl（Pa）
uniform float u_isoInterval; // 等值线间隔（Pa，400 = 4 hPa）
uniform vec3 u_isoColor;    // 线色（暗/亮主题不同）

// 手动双线性采样（NEAREST 纹理；32F 纹理在部分软渲染器上不支持 LINEAR 过滤）
float sampleField(sampler2D tex, vec2 uv) {
  vec2 tc = uv * u_fieldSize - 0.5;
  vec2 base = floor(tc);
  vec2 fr = fract(tc);
  vec2 inv = 1.0 / u_fieldSize;
  vec2 c00 = (base + vec2(0.5)) * inv;
  vec2 c10 = (base + vec2(1.0, 0.0) + 0.5) * inv;
  vec2 c01 = (base + vec2(0.0, 1.0) + 0.5) * inv;
  vec2 c11 = (base + vec2(1.0, 1.0) + 0.5) * inv;
  float v00 = texture(tex, c00).r;
  float v10 = texture(tex, c10).r;
  float v01 = texture(tex, c01).r;
  float v11 = texture(tex, c11).r;
  return mix(mix(v00, v10, fr.x), mix(v01, v11, fr.x), fr.y);
}

void main() {
  vec4 acc = vec4(0.0);  // 预乘 alpha 累积，等压线叠加在色斑上
  if (u_mode != 1) {
    float v = mix(sampleField(u_field0, v_uv), sampleField(u_field1, v_uv), u_mix);
    float t = clamp((v - u_valRange.x) / (u_valRange.y - u_valRange.x), 0.0, 1.0);
    vec4 c = texture(u_cmap, vec2(t, 0.5));
    acc = vec4(c.rgb * c.a * u_opacity, c.a * u_opacity);
  }
  if (u_mode != 0) {
    // 等压线：以"值/间隔"的周期余数距离定线宽，fwidth 换算屏幕像素 → 抗锯齿 ~1px 线
    float iso = mix(sampleField(u_iso0, v_uv), sampleField(u_iso1, v_uv), u_mix);
    float t = iso / u_isoInterval;
    float f = fract(t);
    float d = min(f, 1.0 - f);              // 距最近等值线的距离（0..0.5）
    float dpx = d / max(fwidth(t), 1e-4);   // 换算成屏幕像素
    float line = 1.0 - smoothstep(0.4, 1.2, dpx);
    float a = line * u_opacity;
    acc += vec4(u_isoColor * a, a);
  }
  fragColor = acc;
}
`;
