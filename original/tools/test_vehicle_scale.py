"""Check the raw Blender export transform without starting Blender."""
import ast
import json
import struct
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets-src/vehicles/common.py"


def chunks(data):
    magic, version, length = struct.unpack_from("<4sII", data)
    assert (magic, version, length) == (b"glTF", 2, len(data))
    size = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + size]), bytearray(data[28 + size:])


def raw_export():
    """A tiny uncompressed GLB shaped like the data bake_glb_scale actually receives."""
    positions = struct.pack("<9f", -1, 0, 2, 3, 4, 5, 0, -2, 1)
    normals = struct.pack("<9f", 0, 1, 0, 0, 1, 0, 0, 1, 0)
    indices = struct.pack("<3H2x", 0, 1, 2)
    binary = positions + normals + indices
    document = {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(positions)},
            {"buffer": 0, "byteOffset": len(positions), "byteLength": len(normals)},
            {"buffer": 0, "byteOffset": len(positions) + len(normals), "byteLength": len(indices)},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3",
             "min": [-1, -2, 1], "max": [3, 4, 5]},
            {"bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": 3, "type": "SCALAR"},
        ],
        "materials": [{"name": "paint"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1},
                                       "indices": 2, "material": 0}]}],
        "nodes": [
            {"name": "root", "children": [1], "translation": [1, 2, 3]},
            {"name": "wheel", "mesh": 0,
             "matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1]},
        ],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    return (struct.pack("<4sII", b"glTF", 2, 28 + len(encoded) + len(binary))
            + struct.pack("<I4s", len(encoded), b"JSON") + encoded
            + struct.pack("<I4s", len(binary), b"BIN\x00") + binary)


def test_baked_positions_move_but_normals_indices_materials_and_hierarchy_survive(tmp_path):
    source = ast.parse(SOURCE.read_text())
    function = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == "bake_glb_scale")
    scope = {"json": json, "struct": struct}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), scope)
    path = tmp_path / "raw.glb"
    path.write_bytes(raw_export())
    before, before_binary = chunks(path.read_bytes())
    scope["bake_glb_scale"](path, 1.5)
    after, after_binary = chunks(path.read_bytes())

    accessor = before["accessors"][0]
    examined = 0
    for vertex in range(accessor["count"]):
        address = vertex * 12
        old = struct.unpack_from("<3f", before_binary, address)
        new = struct.unpack_from("<3f", after_binary, address)
        assert new == pytest.approx([value * 1.5 for value in old])
        before_binary[address:address + 12] = after_binary[address:address + 12] = bytes(12)
        examined += 1
    for key in ("min", "max"):
        assert after["accessors"][0][key] == pytest.approx([value * 1.5 for value in accessor[key]])
        after["accessors"][0][key] = accessor[key]
    for old, new in zip(before["nodes"], after["nodes"]):
        if "translation" in old:
            assert new["translation"] == pytest.approx([value * 1.5 for value in old["translation"]])
            new["translation"] = old["translation"]
        if "matrix" in old:
            assert new["matrix"][12:15] == pytest.approx([value * 1.5 for value in old["matrix"][12:15]])
            new["matrix"][12:15] = old["matrix"][12:15]
    assert examined == 3
    assert before_binary == after_binary
    assert before == after
