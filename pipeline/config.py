"""M1 数据管线配置：GFS 0.25° 东亚域裁剪的常量定义。

域与字段设计对齐前端 lib/grid.ts 与 M2/M3 需求：
- 域 60–150°E, 0–60°N → 361×241
- 8 个等压层 × (TMP/UGRD/VGRD/RH) + 6 个地面场 = 38 字段
- 编码：Int16 + 每字段 scale/offset，gzip 打包
"""
from __future__ import annotations  # Python 3.9 兼容 `str | None` 注解

from dataclasses import dataclass, field

# ---- 空间域 ----
DOMAIN = dict(lon0=60.0, lat0=0.0, lon1=150.0, lat1=60.0, dlon=0.25, dlat=0.25)
COLS = int((DOMAIN["lon1"] - DOMAIN["lon0"]) / DOMAIN["dlon"]) + 1  # 361
ROWS = int((DOMAIN["lat1"] - DOMAIN["lat0"]) / DOMAIN["dlat"]) + 1  # 241

# ---- 字段 ----
LEVELS = [1000, 925, 850, 700, 500, 300, 250, 200]  # hPa
ISOBARIC_VARS = ["TMP", "UGRD", "VGRD", "RH"]

# 地面场：(grib 变量名, grib level 描述, 输出字段名)
SURFACE_FIELDS = [
    ("UGRD", "10 m above ground", "u_sfc"),
    ("VGRD", "10 m above ground", "v_sfc"),
    ("TMP", "2 m above ground", "t2m"),
    ("RH", "2 m above ground", "rh2m"),
    ("PRMSL", "mean sea level", "prmsl"),
    ("APCP", "surface", "apcp"),
    # M5 新图层：阵风 / 露点 / 总云 / 低中高云（GFS 0.25° 全可用）
    ("GUST", "surface", "gust_sfc"),
    ("DPT", "2 m above ground", "dpt2m"),
    ("TCDC", "entire atmosphere", "tcdc"),
    ("LCDC", "low cloud layer", "lcdc"),
    ("MCDC", "middle cloud layer", "mcdc"),
    ("HCDC", "high cloud layer", "hcdc"),
]

# 编码精度：小数位数 prec → scale = 10**-prec；offset 让 int16 覆盖真实范围
# 键 = 字段名类别（u*/v* 归 u/v 类）
FIELD_PREC = {"u": 2, "v": 2, "t": 2, "rh": 2, "prmsl": 0, "apcp": 2, "gust_sfc": 1, "tcdc": 0, "lcdc": 0, "mcdc": 0, "hcdc": 0}
FIELD_OFFSET = {"u": 0.0, "v": 0.0, "t": 200.0, "rh": 0.0, "prmsl": 95000.0, "apcp": 0.0, "gust_sfc": 0.0, "tcdc": 0.0, "lcdc": 0.0, "mcdc": 0.0, "hcdc": 0.0}


def field_kind(name: str) -> str:
    """字段名 -> 类别键（用于查 scale/offset）"""
    if name.startswith("u_"):
        return "u"
    if name.startswith("v_"):
        return "v"
    if name.startswith("t2"):
        return "t"
    if name == "dpt2m":  # 露点存 K，复用 t 类精度（prec 2 / offset 200）
        return "t"
    if name.startswith("rh"):
        return "rh"
    if name.startswith("t_"):
        return "t"
    if name.startswith("rh_"):
        return "rh"
    return name  # prmsl / apcp / gust_sfc / 云量


def all_field_ids() -> list[str]:
    """输出字段顺序（前端读取即按此顺序 + header 自描述）"""
    ids = []
    for lv in LEVELS:
        ids += [f"u_{lv}", f"v_{lv}", f"t_{lv}", f"rh_{lv}"]
    ids += [fid for _, _, fid in SURFACE_FIELDS]
    return ids


@dataclass
class FetchOpts:
    cycle: str  # ISO "YYYY-MM-DDTHH:00:00Z"
    fxx_list: list[int] = field(default_factory=lambda: list(range(0, 121, 3)))
    source: str = "nomads"
    proxy: str | None = None
    out: str = "web/public/data"
