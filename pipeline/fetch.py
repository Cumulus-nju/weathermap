"""GFS 0.25° 子集下载：HTTP Range 请求从 idx 选字段字节区间 → cfgrib 解码。

为什么不用 herbie：PyPI 上的 `herbie` 是冒名包（Project A 的 business-data 项目，
带 Django 依赖），真库 blaylockbk/Herbie 需从 GitHub 构建安装且不稳。本实现自包含，
只依赖 requests + cfgrib/eccodes，CI 与本地行为一致。

数据源 failover：AWS S3（noaa-gfs-bdp-pds）→ Google Cloud（global-forecast-system）
→ NOMADS（nomads.ncep.noaa.gov）。大陆网络 AWS/Google 常被墙，NOMADS 直连可达。
"""
from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import os

import numpy as np
import requests
import xarray as xr

# cfgrib 在 heightAboveGround 组内遇到 10m/2m 坐标冲突时会 ERROR 级刷 traceback
# （变量被跳过但整体仍成功），压到 CRITICAL 让 CI 日志干净。
logging.getLogger("cfgrib").setLevel(logging.CRITICAL)

from .config import (
    COLS, ROWS, DOMAIN, LEVELS, ISOBARIC_VARS, SURFACE_FIELDS,
)

SOURCES = {
    "aws": {
        "idx": "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{ymd}/{cyc}/atmos/gfs.t{cyc}z.pgrb2.0p25.f{fxx:03d}.idx",
        "grib": "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{ymd}/{cyc}/atmos/gfs.t{cyc}z.pgrb2.0p25.f{fxx:03d}",
    },
    "google": {
        "idx": "https://storage.googleapis.com/global-forecast-system/gfs.{ymd}/{cyc}/atmos/gfs.t{cyc}z.pgrb2.0p25.f{fxx:03d}.idx",
        "grib": "https://storage.googleapis.com/global-forecast-system/gfs.{ymd}/{cyc}/atmos/gfs.t{cyc}z.pgrb2.0p25.f{fxx:03d}",
    },
    "nomads": {
        "idx": "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.{ymd}/{cyc}/atmos/gfs.t{cyc}z.pgrb2.0p25.f{fxx:03d}.idx",
        "grib": "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.{ymd}/{cyc}/atmos/gfs.t{cyc}z.pgrb2.0p25.f{fxx:03d}",
    },
}

# 命中匹配：等压层 var 在指定层；地面场按 (var, level描述) 精确匹配
def _isobaric_wanted(var: str, level: int):
    return f":{var}:{level} mb"


def _surface_wanted(var: str, level_desc: str):
    return f":{var}:{level_desc}"


class GFSError(RuntimeError):
    pass


def make_session(proxy: str | None) -> requests.Session:
    s = requests.Session()
    s.trust_env = proxy is not None  # 无显式代理时直连（Windows 注册表代理有坑）
    if proxy:
        s.proxies = {"http": proxy, "https": proxy}
    return s


def latest_cycle(session: requests.Session, now: datetime | None = None,
                 max_hours_back: int = 72) -> str:
    """找最近可用的 GFS cycle（ISO），从当前整点回推，检查 idx 是否已落地。"""
    now = now or datetime.now(timezone.utc)
    cyc_hour = (now.hour // 6) * 6
    t = now.replace(hour=cyc_hour, minute=0, second=0, microsecond=0)
    for _ in range(max_hours_back // 6 + 1):
        if _has_cycle(session, t):
            return t.strftime("%Y-%m-%dT%H:00:00Z")
        t -= timedelta(hours=6)
    raise GFSError("72h 内没有找到已落地的 GFS cycle")


def _has_cycle(session: requests.Session, t: datetime) -> bool:
    url = _build_url(t, fxx=0, source="nomads")["idx"]
    try:
        r = session.get(url, timeout=20)
        return r.status_code == 200
    except requests.RequestException:
        return False


def _build_url(t: datetime, fxx: int, source: str) -> dict:
    url = SOURCES[source]
    return {
        "idx": url["idx"].format(ymd=t.strftime("%Y%m%d"), cyc=t.strftime("%H"), fxx=fxx),
        "grib": url["grib"].format(ymd=t.strftime("%Y%m%d"), cyc=t.strftime("%H"), fxx=fxx),
    }


@dataclass
class _Message:
    offset: int
    desc: str


def fetch_timestep(t: datetime, fxx: int, session: requests.Session,
                   source: str = "nomads", levels: list[int] | None = None,
                   surface: bool = True) -> xr.Dataset:
    """下载单个时次所需字段的字节区间，cfgrib 解码为一个合并 Dataset。

    返回 Dataset 含等压层 vars（t/u/v/r, 坐标 isobaricInhPa×latitude×longitude），
    以及地面 vars（u10/v10/t2m/rh2m/prmsl/apcp 等, 按各自 typeOfLevel 合并）。
    纬度坐标仍为 GFS 原序（90→-90 降序），裁剪时统一翻转。
    """
    levels = levels or LEVELS
    url = _build_url(t, fxx, source)

    # 1) 拉 idx
    r = session.get(url["idx"], timeout=30)
    if r.status_code != 200:
        raise GFSError(f"idx 不可用: {r.status_code} {url['idx']}")
    msgs: list[_Message] = []
    for ln in r.text.splitlines():
        parts = ln.split(":")
        msgs.append(_Message(int(parts[1]), ln))
    size = int(session.head(url["grib"], timeout=30).headers["Content-Length"])

    # 2) 收集想要的字段消息索引
    wanted_idx: list[tuple[int, str]] = []  # (消息index, 输出字段名)
    for var in ISOBARIC_VARS:
        for lv in levels:
            key = _isobaric_wanted(var, lv)
            for i, m in enumerate(msgs):
                if key in m.desc:
                    wanted_idx.append((i, f"{var.lower()}_{lv}"))
                    break
    if surface:
        for var, lvl_desc, fid in SURFACE_FIELDS:
            key = _surface_wanted(var, lvl_desc)
            hit = None
            for i, m in enumerate(msgs):
                if key in m.desc:
                    hit = (i, fid)
                    break
            # f000 无 APCP（累积为0），用 PRATE 兜底
            if hit is None and var == "APCP":
                for i, m in enumerate(msgs):
                    if ":PRATE:surface" in m.desc:
                        hit = (i, "apcp")
                        break
            if hit is not None:
                wanted_idx.append(hit)

    # 3) 计算字节区间（终点 = 文件内下一条偏移-1）
    pairs = []
    for i, _ in wanted_idx:
        end = msgs[i + 1].offset - 1 if i + 1 < len(msgs) else size - 1
        pairs.append((msgs[i].offset, end))

    # 4) 下载（先多区间，NOMADS 支持；否则逐个）
    blob = _download(session, url["grib"], pairs)

    # 5) cfgrib 解码
    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as f:
        f.write(blob)
        tmp = f.name
    try:
        # 等压层一组
        ds_p = xr.open_dataset(tmp, engine="cfgrib",
                               backend_kwargs={"filter_by_keys": {"typeOfLevel": "isobaricInhPa"}})
        ds = ds_p
        parts = [ds_p]
        if surface:
            # 地面分组打开。cfgrib 事实（本机实测）：
            # - 10m u/v 自带命名 u10/v10，2m RH 叫 r2；
            # - filter_by_keys 只有 paramId / typeOfLevel 单键可靠，组合或 shortName/height 均
            #   静默返回空；heightAboveGround 组内混 10m+2m 时 cfgrib 会跳过 2m 字段（无害）。
            # - rename 仅对存在的键生效（xarray rename 遇缺失键抛 ValueError）。
            for fkeys, renames in (
                ({"typeOfLevel": "heightAboveGround"}, {}),     # u10, v10
                ({"paramId": 167}, {}),                         # TMP:2m → t2m
                ({"paramId": 260242}, {"r2": "rh2m"}),          # RH:2m → r2 → rh2m
                ({"typeOfLevel": "meanSea"}, {}),               # prmsl（+mslet 忽略）
                ({"typeOfLevel": "surface"}, {}),               # f000: prate (PRATE)；f003+: tp (APCP)
            ):
                try:
                    ds_s = xr.open_dataset(
                        tmp, engine="cfgrib",
                        backend_kwargs={"filter_by_keys": fkeys},
                    )
                    if renames:
                        present = {k: v for k, v in renames.items() if k in ds_s}
                        if present:
                            ds_s = ds_s.rename(present)
                    if len(ds_s.data_vars):
                        # 地面各组为单层：丢弃 typeOfLevel 标量坐标，避免 10m vs 2m 合并冲突
                        for c in ("heightAboveGround", "meanSea", "surface"):
                            if c in ds_s.coords:
                                ds_s = ds_s.drop_vars(c)
                        parts.append(ds_s)
                except Exception:
                    continue  # 该组无消息（如 f000 无 APCP）
            ds = xr.merge(parts)
        ds.load()  # 必须显式载入内存，否则删除临时文件后延迟数组读不到
        for p in parts:
            p.close()
        return ds
    finally:
        os.remove(tmp)


def _download(session: requests.Session, url: str, pairs: list[tuple[int, int]]) -> bytes:
    total = sum(e - s + 1 for s, e in pairs)
    h = {"Range": "bytes=" + ",".join(f"{s}-{e}" for s, e in pairs)}
    r = session.get(url, headers=h, timeout=180)
    if r.status_code == 206 and len(r.content) <= total * 2:
        return r.content
    # 兜底：逐个单区间请求
    blob = b""
    for s, e in pairs:
        rr = session.get(url, headers={"Range": f"bytes={s}-{e}"}, timeout=120)
        if rr.status_code != 206:
            raise GFSError(f"range 请求失败 {rr.status_code}")
        blob += rr.content
    return blob


def crop(ds: xr.Dataset) -> xr.Dataset:
    """裁剪到东亚域，并把纬度翻转为升序（南→北，对齐前端 lib/grid.ts）。"""
    lat = ds.latitude.values
    lon = ds.longitude.values
    lat_sel = lat[(lat >= DOMAIN["lat0"]) & (lat <= DOMAIN["lat1"])]
    lon_sel = lon[(lon >= DOMAIN["lon0"]) & (lon <= DOMAIN["lon1"])]
    ds = ds.sel(latitude=lat_sel, longitude=lon_sel)
    assert ds.sizes["latitude"] == ROWS and ds.sizes["longitude"] == COLS, \
        (ds.sizes["latitude"], ds.sizes["longitude"])
    return ds.isel(latitude=slice(None, None, -1))  # 降序→升序


def ds_to_arrays(ds: xr.Dataset, levels: list[int] | None = None) -> dict[str, np.ndarray]:
    """Dataset -> {字段名: float32 2D (ROWS, COLS)}。

    cfgrib 单层时会压缩 isobaricInhPa 维度 → 数组退化为 2D，需按请求的 levels 兜底。
    """
    levels = levels or LEVELS
    out: dict[str, np.ndarray] = {}
    # 等压层：t/u/v/r with isobaricInhPa coord
    for var, code in (("t", "t"), ("u", "u"), ("v", "v"), ("r", "rh")):
        if var not in ds:
            continue
        da = ds[var]
        if "isobaricInhPa" in da.coords:
            iv = da.isobaricInhPa.values
            present = [float(iv)] if iv.ndim == 0 else [float(x) for x in iv]
        else:
            present = [float(levels[0])]  # 单层被 cfgrib 压缩
        for lv in present:
            if lv not in levels:
                continue
            if "isobaricInhPa" in da.dims:
                arr = da.sel(isobaricInhPa=lv).values.astype(np.float32)
            else:
                arr = da.values.astype(np.float32)
            out[f"{code}_{int(lv)}"] = np.ascontiguousarray(arr)
    # 地面（cfgrib 命名：u10/v10/t2m/rh2m/prmsl；降水 prate(f000)/tp(f003+) → apcp）
    for fid, vn in (
        ("u_sfc", "u10"), ("v_sfc", "v10"), ("t2m", "t2m"), ("rh2m", "rh2m"),
        ("prmsl", "prmsl"),
    ):
        if vn in ds:
            out[fid] = np.ascontiguousarray(ds[vn].values.astype(np.float32))
    for vn in ("prate", "tp"):
        if vn in ds:
            out["apcp"] = np.ascontiguousarray(ds[vn].values.astype(np.float32))
            break
    expected = {f"{c}_{lv}" for lv in levels for c in ("u", "v", "t", "rh")}
    for fid, vn in (
        ("u_sfc", "u10"), ("v_sfc", "v10"), ("t2m", "t2m"), ("rh2m", "rh2m"),
        ("prmsl", "prmsl"),
    ):
        if vn in ds:
            expected.add(fid)
    if any(v in ds for v in ("prate", "tp")):
        expected.add("apcp")
    missing = expected - set(out)
    if missing:
        raise GFSError(f"字段缺失: {sorted(missing)}")
    return out
