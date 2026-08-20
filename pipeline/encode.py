"""字段编码：Int16 + scale/offset + 单时次 bundle 打包（gzip）。

bundle 二进制格式（解压后）：
  magic "WMB1" (4B)
  u32 nfields | u32 cols | u32 rows
  每个字段:
    u32 name_len | bytes name | f32 scale | f32 offset | int16[cols*rows] (LE)
解码: value = int16 * scale + offset

前端用 DecompressionStream('gzip') 解压后按此 header 切片，无需额外解析开销。
"""
from __future__ import annotations

import gzip
import struct

import numpy as np

from .config import FIELD_OFFSET, FIELD_PREC, field_kind, all_field_ids

MAGIC = b"WMB1"
F32 = struct.Struct("<f").pack
U32 = struct.Struct("<I").pack


def encode_field(arr: np.ndarray, name: str) -> tuple[bytes, float, float]:
    """float32 (ROWS,COLS) -> (int16 字节, scale, offset)"""
    kind = field_kind(name)
    scale = 10.0 ** -FIELD_PREC[kind]
    offset = FIELD_OFFSET[kind]
    q = np.round((arr.astype(np.float64) - offset) / scale)
    q = np.clip(q, -32767, 32767).astype(np.int16)
    return q.tobytes(), scale, offset


def build_bundle(fields: dict[str, np.ndarray], cols: int, rows: int) -> bytes:
    """fields: {字段名: float32 2D}（dict 顺序即打包顺序）。返回 gzip 压缩后的 bundle 字节。"""
    out = bytearray()
    out += MAGIC
    order = list(fields.keys())
    n = len(order)
    out += U32(n)
    out += U32(cols)
    out += U32(rows)
    for name in order:
        arr = fields[name]
        assert arr.shape == (rows, cols), (name, arr.shape)
        raw, scale, offset = encode_field(arr, name)
        nb = name.encode("utf-8")
        out += U32(len(nb))
        out += nb
        out += F32(scale)
        out += F32(offset)
        out += raw
    return gzip.compress(bytes(out), compresslevel=6)


def decode_bundle(data: bytes) -> tuple[dict[str, np.ndarray], dict]:
    """解压并解码（测试/前端调试用）。返回 (fields, meta)。"""
    raw = gzip.decompress(data)
    pos = 0
    assert raw[:4] == MAGIC, "magic 不匹配"
    pos = 4
    n, cols, rows = struct.unpack("<III", raw[pos:pos + 12])
    pos += 12
    fields: dict[str, np.ndarray] = {}
    meta: dict = {"nfields": n, "cols": cols, "rows": rows, "fields": []}
    for _ in range(n):
        (nl,) = struct.unpack("<I", raw[pos:pos + 4]); pos += 4
        name = raw[pos:pos + nl].decode("utf-8"); pos += nl
        scale, offset = struct.unpack("<ff", raw[pos:pos + 8]); pos += 8
        arr = np.frombuffer(raw, dtype="<i2", count=cols * rows, offset=pos).reshape(rows, cols)
        pos += cols * rows * 2
        fields[name] = arr.astype(np.float32) * scale + offset
        meta["fields"].append({"name": name, "scale": scale, "offset": offset})
    return fields, meta
