"""M1 数据管线 CLI。

用法示例：
  python -m pipeline.run --latest --out web/public/data            # 全量 41 时次
  python -m pipeline.run --latest --levels 850 --out /tmp/test     # 快速：仅 850hPa 风/温
  python -m pipeline.run --cycle 2026-08-20T00:00:00Z --fxx 0 3    # 指定时次
  python -m pipeline.run --latest --proxy http://127.0.0.1:7897    # 走代理（如 AWS 源）

输出：<out>/t{fxx:03d}.bin.gz（每时次一 bundle）+ manifest.json
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

from .config import COLS, ROWS, LEVELS, SURFACE_FIELDS, ISOBARIC_VARS, all_field_ids
from .encode import build_bundle
from .fetch import GFSError, crop, ds_to_arrays, fetch_timestep, latest_cycle, make_session
from .manifest import write_manifest


def parse_fxx(spec: str) -> list[int]:
    """--fxx 支持 "0", "0,3,6", "0:120:3"（start:end:step，end 含）"""
    out = []
    for part in spec.split(","):
        if ":" in part:
            bits = [int(x) for x in part.split(":")]
            if len(bits) == 2:
                s, e = bits
                out += list(range(s, e + 1, 3))
            elif len(bits) == 3:
                s, e, st = bits
                out += list(range(s, e + 1, st))
        else:
            out.append(int(part))
    return sorted(set(out))


def build_field_names(levels: list[int], surface: bool) -> list[str]:
    names = []
    for lv in levels:
        names += [f"u_{lv}", f"v_{lv}", f"t_{lv}", f"rh_{lv}"]
    if surface:
        names += [fid for _, _, fid in SURFACE_FIELDS]
    return names


def run(opts) -> dict:
    session = make_session(opts.proxy)

    if opts.cycle:
        t = datetime.fromisoformat(opts.cycle.replace("Z", "+00:00"))
    elif opts.latest:
        t = datetime.fromisoformat(latest_cycle(session).replace("Z", "+00:00"))
    else:
        raise SystemExit("需要 --cycle 或 --latest")

    levels = LEVELS if opts.levels == "all" else [int(x) for x in opts.levels.split(",")]
    surface = not opts.no_surface
    fxx_list = parse_fxx(opts.fxx) if opts.fxx else list(range(0, 121, 3))

    os.makedirs(opts.out, exist_ok=True)
    bundles = []
    total = 0

    for fxx in fxx_list:
        valid = (t + timedelta(hours=fxx)).strftime("%Y-%m-%dT%H:%M:%SZ")
        sys.stderr.write(f"[fxx {fxx:03d}] 下载 {valid} ... ")
        sys.stderr.flush()
        try:
            ds = fetch_timestep(t, fxx, session, source=opts.source, levels=levels, surface=surface)
            ds = crop(ds)
            fields = ds_to_arrays(ds, levels=levels)
            # 按规范顺序整理
            order = build_field_names(levels, surface)
            fields = {name: fields[name] for name in order}
        except GFSError as e:
            sys.stderr.write(f"跳过（{e}）\n")
            continue

        blob = build_bundle(fields, COLS, ROWS)
        fname = f"t{fxx:03d}.bin.gz"
        with open(os.path.join(opts.out, fname), "wb") as f:
            f.write(blob)
        sz = len(blob)
        total += sz
        bundles.append({"fxx": fxx, "validTime": valid, "file": fname, "sizeBytes": sz})
        sys.stderr.write(f"OK {sz/1e6:.2f}MB\n")

    manifest = write_manifest(opts.out, t.strftime("%Y-%m-%dT%H:00:00Z"), bundles)
    sys.stderr.write(f"\n完成: {len(bundles)} 时次, 共 {total/1e6:.1f}MB → {opts.out}\n")
    return manifest


def main(argv=None):
    p = argparse.ArgumentParser(description="GFS 0.25° 东亚数据管线")
    p.add_argument("--cycle", help="cycle ISO 如 2026-08-20T00:00:00Z")
    p.add_argument("--latest", action="store_true", help="用最近可用 cycle")
    p.add_argument("--fxx", help="时次，如 0,3,6 或 0:120:3（默认 0:120:3）")
    p.add_argument("--levels", default="all", help="等压层，all 或 850,700")
    p.add_argument("--no-surface", action="store_true", help="跳过地面场")
    p.add_argument("--source", default="nomads", choices=["nomads", "aws", "google"])
    p.add_argument("--proxy", help="代理 URL，如 http://127.0.0.1:7897")
    p.add_argument("--out", default="web/public/data", help="输出目录")
    opts = p.parse_args(argv)
    run(opts)


if __name__ == "__main__":
    main()
