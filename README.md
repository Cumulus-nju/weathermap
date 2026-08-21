# 自研 Windy（weathermap）

因 Windy.com 停止服务大陆用户而自研的天气可视化 Web 应用，核心目标是**交互打磨 + 高可视化质量**。
已上线：https://cumulus-nju.github.io/weathermap/

## 功能

- **风场粒子**：WebGL2 单缓冲风粒子，10 万粒子 60fps；粒子数/速度/尾迹/亮度可调，
  并支持按实测 FPS 自动升降粒子数维持流畅（弱机/软渲染友好）。
- **气压层切换**：1000/925/850/700/500/300/250/200 hPa + 地面，共 9 层。
- **叠加图层**：温度 / 湿度 / 降水色斑（不透明度可调），画在风粒子之下、底图之上。
- **时间轴**：41 个预报时次（f000–f120），相邻时次双纹理交叉淡化平滑播放，可拖动/播放/暂停。
- **读数卡**：鼠标悬停实时显示该点风/温/湿/降水值与坐标，单位跟随设置。
- **单位切换**：风 m/s ↔ km/h ↔ 节，温度 ℃ ↔ ℉。
- **离线暗色底图**：Natural Earth 50m 陆地 + 海岸线 + 15° 经纬网格，无外部瓦片依赖。
- **数据新鲜度角标**：显示 GFS cycle 与距今时间，按滞后程度变色（正常/滞后/过期）。

## 结构

```
weathermap/
  .github/workflows/deploy.yml   # 定时拉 GFS → 生成数据 → 构建 → 部署 Pages
  pipeline/                      # M1 数据管线：GFS 0.25° 子集下载 → 裁剪东亚 → 编码
  web/                           # M0 前端：MapLibre GL + React + WebGL2 风粒子
    src/map/                     # 地图：createMap + WindLayer(粒子) + ColorLayer(色斑)
    src/lib/                     # basemap / colormaps / dataLoader / units / wmb 等
    src/components/              # ControlPanel / TimeScrubber / ValueCard / Legend / DataBadge
```

- **数据**：GFS 0.25° 运营预报，裁剪东亚域 60–150°E / 0–60°N（361×241 格点），8 个等压层
  （1000/925/850/700/500/300/250/200 hPa）× 风/温/湿 + 6 个地面场 = 38 字段 / 时次，
  f000–f120 共 41 时次。
- **编码**：Int16 + 每字段 scale/offset + gzip 单时次 bundle（`WMB1` 格式，前端
  `DecompressionStream` 解压）。约 4.1MB / 时次，全量约 170MB（Pages 1GB 上限安全）。
- **数据源**：默认 NOMADS（`nomads.ncep.noaa.gov`），大陆网络直连可达；AWS/Google 常被墙。

## 本地开发

```bash
# 1. 前端（合成数据可先行预览）
cd web
npm install
npm run dev            # http://localhost:5173

# 2. 数据管线
cd weathermap
pip install -e pipeline
python -m pipeline.run --latest --out web/public/data   # 全量 41 时次
python -m pipeline.run --latest --levels 850 --out web/public/data  # 仅 850hPa 快速试
```

管线 CLI：`--cycle ISO` / `--latest`、`--fxx 0:120:3`、`--levels 850`、`--no-surface`、
`--source nomads|aws|google`、`--proxy http://127.0.0.1:7897`。

## 无头验收（自动化）

`web/verify-*.mjs` 用 Playwright 跑端到端验收（角标 / 底图地理正确性 / console 干净度）。
**必须 `--use-angle=d3d11` 走真 GPU**——SwiftShader 软渲染会位移小多边形、且不可靠：

```bash
cd web
node verify-m4-3.mjs            # 需先 npm run dev 起服务
```

## 部署（GitHub Actions + Pages）

1. 建仓并推代码：
   ```bash
   git init
   git add -A
   git commit -m "M1: GFS 数据管线 + Pages 部署"
   git remote add origin https://github.com/<你>/<仓库>.git
   git push -u origin main
   ```
2. 仓库 **Settings → Pages → Source = "GitHub Actions"**（一次性，数据不进 git 历史）。
3. 在 **Actions** 页手动触发 `部署 Pages`（workflow_dispatch，`fxx=0` 可快速验证链路），
   或等 4 次/天的定时任务自动跑。

`web/public/data/` 已被 `.gitignore` 排除——数据只在 CI 时生成、随构建产物上传，仓库只存源码。

## 里程碑

- **M0** 脚手架 + WebGL 风粒子层（10 万粒子 60fps）✓
- **M1** Python 数据管线（38 字段、NOMADS、Int16+gzip）+ GitHub Actions/Pages 部署 ✓
- **M2** 时间轴 + 平滑插值（双时次纹理交叉淡化）✓
- **M3** 气压层切换 + 点击读数卡 ✓
- **M4** 打磨 ✓
  - M4-1 叠加图层（温度/湿度/降水色斑）+ 图例 + 不透明度
  - M4-2 单位切换（风/温）+ 粒子数自适应 + 配色预设
  - M4-3 离线暗色底图（50m 陆地/海岸线/网格）+ 数据新鲜度角标
  - 延伸方向：云图、等值线、多图层叠加
