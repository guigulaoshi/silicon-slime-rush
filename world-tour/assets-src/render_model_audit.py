"""Render shipped vehicle/aircraft GLBs at reproducible comparison angles.

Blender --background --python-exit-code 1 --python assets-src/render_model_audit.py
    -- --output-dir tmp/model-polish/before
"""
import argparse
import json
import struct
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'assets-src/vehicles'))
from render_garage_references import CATALOGUE, render_reference
sys.path.insert(0, str(ROOT / 'assets-src/landmarks'))
from build_moffett_aircraft import render as render_aircraft


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--ids', help='Optional comma-separated subset to render')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    directory = ROOT / args.output_dir
    directory.mkdir(parents=True, exist_ok=True)
    stats = []
    ids = set(args.ids.split(',')) if args.ids else None
    for path in sorted((ROOT / 'game/public/models').glob('*/*.glb')):
        if path.parent.name != 'cars' and not path.stem.startswith('moffett-'):
            continue
        raw = path.read_bytes()
        length = struct.unpack_from('<I', raw, 12)[0]
        doc = json.loads(raw[20:20+length])
        triangles = sum(doc['accessors'][p['indices']]['count']//3
                        for mesh in doc['meshes'] for p in mesh['primitives'])
        stats.append({'id': path.stem, 'bytes': len(raw), 'triangles': triangles})
    (directory / 'models.json').write_text(json.dumps(stats, indent=2)+'\n')
    for spec in CATALOGUE['vehicles']:
        if ids is not None and spec['id'] not in ids:
            continue
        render_reference(spec, directory)
    for path in sorted((ROOT / 'game/public/models/landmarks').glob('moffett-*.glb')):
        if ids is not None and path.stem not in ids:
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(path))
        points = [obj.matrix_world @ v.co for obj in bpy.context.scene.objects
                  if obj.type == 'MESH' for v in obj.data.vertices]
        dimensions = [max(p[i] for p in points)-min(p[i] for p in points) for i in (0, 2, 1)]
        bpy.context.scene.world = bpy.data.worlds.new('Aircraft studio')
        render_aircraft(path, directory, {'dimensions': dimensions})


if __name__ == '__main__':
    main()
