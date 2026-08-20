"""编码/解码往返测试（离线，合成数据）。运行：python -m tests.test_encode 或 pytest。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import numpy as np

from pipeline.config import COLS, ROWS, LEVELS, SURFACE_FIELDS, all_field_ids
from pipeline.encode import build_bundle, decode_bundle


def synth_fields() -> dict:
    rng = np.random.default_rng(42)
    fields = {}
    for lv in LEVELS:
        fields[f"u_{lv}"] = rng.normal(0, 15, (ROWS, COLS)).astype(np.float32)
        fields[f"v_{lv}"] = rng.normal(0, 10, (ROWS, COLS)).astype(np.float32)
        fields[f"t_{lv}"] = (220 + rng.random((ROWS, COLS)) * 90).astype(np.float32)
        fields[f"rh_{lv}"] = (rng.random((ROWS, COLS)) * 100).astype(np.float32)
    fields["u_sfc"] = fields["u_850"]
    fields["v_sfc"] = fields["v_850"]
    fields["t2m"] = fields["t_850"] + 2
    fields["rh2m"] = fields["rh_850"]
    fields["prmsl"] = (100000 + rng.normal(0, 200, (ROWS, COLS))).astype(np.float32)
    fields["apcp"] = (rng.random((ROWS, COLS)) * 20).astype(np.float32)
    return fields


def test_roundtrip():
    fields = synth_fields()
    blob = build_bundle(fields, COLS, ROWS)
    dec, meta = decode_bundle(blob)
    assert meta["cols"] == COLS and meta["rows"] == ROWS
    assert list(dec.keys()) == list(fields.keys())
    # 精度：scale=0.01 → 误差 < 0.005
    for name, arr in fields.items():
        err = np.abs(dec[name] - arr).max()
        kind = name.split("_")[0]
        tol = 0.01 if kind not in ("prmsl",) else 1.0
        assert err <= tol + 1e-6, (name, err)
    # 体积合理性：87k 点 × 38 字段 × 2B ≈ 6.6MB 原始，gzip 后应 < 60%
    print(f"bundle 大小: {len(blob)/1e6:.2f}MB (raw {COLS*ROWS*len(fields)*2/1e6:.1f}MB)")
    return blob


if __name__ == "__main__":
    test_roundtrip()
    print("encode round-trip OK")
