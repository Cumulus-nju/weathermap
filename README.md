# 自研 Windy（weathermap）

因 Windy.com 停止服务大陆用户而自研的天气可视化 Web 应用，核心目标是**交互打磨 + 高可视化质量**。

## 结构

```
weathermap/
  .github/workflows/deploy.yml   # 定时拉 GFS → 生成数据 → 构建 → 部署 Pages
  pipeline/                      # M1 数据管线：GFS 0.25° 子集下载 → 裁剪东亚 → 编码
  web/                           # M0 前端：MapLibre GL + React + WebGL2 风粒子
```

- **数据**：GFS 0.25° 运营预报，裁剪东亚域 60–150°E / 0–60°N（361×241 格点），8 个等压层
  （1000/925/850/700/500/300/250/200 hPa）× 风/温/湿 + 6 个地面场 = 38 字段 / 时次，
  f000–f120 共 41 时次。
- **编码**：Int16 + 每字段 scale/offset + gzip 单时次 bundle（`WMB1` 格式，前端
  `DecompressionStream` 解压）。约 4.1MB / 时次，全量约 170MB（Pages 1GB 上限安全）。
- **数据源**：默认 NOMADS（`nomads.ncep.noaa.gov`），大陆网络直连可达；AWS/Google 常被墙。

## 本地开发

```bash
# 1. 前端（M0，合成数据）
cd web
npm install
npm run dev            # http://localhost:5173

# 2. 数据管线（M1）
cd weathermap
pip install -e pipeline
python -m pipeline.run --latest --out web/public/data   # 全量 41 时次
python -m pipeline.run --latest --levels 850 --out web/public/data  # 仅 850hPa 快速试
```

管线 CLI：`--cycle ISO` / `--latest`、`--fxx 0:120:3`、`--levels 850`、`--no-surface`、
`--source nomads|aws|google`、`--proxy http://127.0.0.1:7897`。

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
- **M2** 时间轴 + 平滑插值（双时次纹理交叉淡化）
- **M3** 气压层切换 + 点击读数卡
- **M4** 打磨（配色/图例/单位切换/动态粒子数/离线底图）与延伸（云图/等值线/多图层）
