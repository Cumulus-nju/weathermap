"""生成 manifest.json：前端数据加载器读取的数据目录索引。"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from .config import COLS, ROWS, DOMAIN, all_field_ids


def write_manifest(out_dir: str, cycle: str, bundles: list[dict], fields: list[str] | None = None):
    """bundles: [{fxx, validTime, file, sizeBytes}]"""
    manifest = {
        "format": "wmb-v1",
        "generated": datetime.now(timezone.utc).isoformat(),
        "cycle": cycle,
        "domain": {**DOMAIN, "cols": COLS, "rows": ROWS},
        "fields": fields or all_field_ids(),
        "timesteps": bundles,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
    return manifest
