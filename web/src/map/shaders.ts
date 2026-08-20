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

// 共享：坐标变换 + 双线性采样（拼进各 pass）
// 注意：u_m0/u_scale/u_p0/u_cssSize 只在 draw pass 用到，但必须声明在 COMMON，
// 因为 UPDATE_FRAG 也包含 COMMON——GLSL 中 uniform 声明必须在函数引用之前。
// u_wind0/u_wind1 + u_mix 实现时间轴交叉淡化：相邻两个时次的风场按 frac 混合。
const COMMON = `
uniform vec2 u_windSize;   // 风场纹理尺寸 (cols, rows)
uniform vec2 u_domain;     // lon0, lat0
uniform vec2 u_domainSpan; // (lon1-lon0, lat1-lat0)
uniform sampler2D u_wind0; // 当前时次风场
uniform sampler2D u_wind1; // 下一时次风场
uniform float u_mix;       // 0..1 时次插值系数
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
  if (newPos.x < 0.0 || newPos.x > 1.0 || newPos.y < 0.0 || newPos.y > 1.0) {
    newPos = vec2(hash1(pos.x * 3.1 + 0.13), hash1(pos.y * 7.7 + 0.57));
  }
  fragColor = vec4(newPos, pos);
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

void main() {
  float pIdx = floor(a_index * 0.5);
  float isHead = mod(a_index, 2.0);
  vec4 st = texture(u_state, idxToUV(pIdx));
  vec2 pos = isHead > 0.5 ? st.xy : st.zw;
  gl_Position = vec4(gridToClip(pos), 0.0, 1.0);
  vec2 wind = sampleWind(st.xy);
  v_speed01 = clamp(length(wind) / u_maxSpeed, 0.0, 1.0);
}
`;

export const DRAW_FRAG = `#version 300 es
precision highp float;
in float v_speed01;
out vec4 fragColor;
uniform float u_lineAlpha;

vec3 windColor(float t) {
  vec3 c0 = vec3(0.05, 0.25, 0.60);
  vec3 c1 = vec3(0.05, 0.55, 0.75);
  vec3 c2 = vec3(0.10, 0.75, 0.50);
  vec3 c3 = vec3(0.85, 0.85, 0.25);
  vec3 c4 = vec3(0.95, 0.45, 0.20);
  vec3 c5 = vec3(0.90, 0.20, 0.30);
  float s = clamp(t, 0.0, 1.0);
  if (s < 0.2) return mix(c0, c1, s / 0.2);
  else if (s < 0.4) return mix(c1, c2, (s - 0.2) / 0.2);
  else if (s < 0.6) return mix(c2, c3, (s - 0.4) / 0.2);
  else if (s < 0.8) return mix(c3, c4, (s - 0.6) / 0.2);
  else return mix(c4, c5, (s - 0.8) / 0.2);
}

void main() {
  vec3 col = windColor(v_speed01) * u_lineAlpha;
  fragColor = vec4(col, 1.0);
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
