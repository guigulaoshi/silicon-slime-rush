

def test_collider_table_matches_the_contract():
    """The exporter writes `collider: none` for any node prefix it does not know, and the runtime
    honours that over its own defaults. A guardrail once shipped that way: it rendered, and nothing
    ever touched it. The contract document is the source of truth, so check against it."""
    import os
    import re

    from sr.export import NODE_COLLIDER

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    doc = open(os.path.join(root, "docs", "CONTRACT.md"), encoding="utf-8").read()
    rows = dict(re.findall(r"^\| `([a-z_]+)` \| [^|]* \| `([a-z-]+)`", doc, re.M))
    assert rows, "could not read the node table out of docs/CONTRACT.md"
    assert NODE_COLLIDER == rows, f"exporter table {NODE_COLLIDER} does not match the contract {rows}"


def test_material_names_match_the_contract():
    """Tiles carry material names, not textures, so the two sides have to agree on the list. The
    contract keeps it as a plain block precisely so both this test and the runtime's can read it."""
    import os
    import re

    from sr.export import MATERIALS

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    doc = open(os.path.join(root, "docs", "CONTRACT.md"), encoding="utf-8").read()
    block = re.search(r"## 4\..*?```text\n(.*?)```", doc, re.S)
    assert block, "could not read the material list out of docs/CONTRACT.md"
    names = block.group(1).split()
    assert list(MATERIALS) == names, f"exporter materials {list(MATERIALS)} != contract {names}"


def test_compressed_building_identity_survives_both_sides_of_a_tile_boundary(tmp_path):
    import json
    import subprocess
    from pathlib import Path
    import numpy as np
    from sr.buildings import facade_identity
    from sr.export import write_tile_glb, compress_meshopt
    from sr.mesh import box, merge, split_by_tile
    from sr.tiles import tile_of

    homes = facade_identity(box((256, 6, 128), (16, 6, 16)), 'way:123', True)
    offices = facade_identity(box((280, 9, 128), (10, 9, 10)), 'way:456', False)
    expected = sorted({tuple(row) for row in np.vstack([homes.facade, offices.facade])})
    paths = []
    for index, mesh in enumerate(split_by_tile(merge([homes, offices]), tile_of).values()):
        raw, packed = tmp_path / f'{index}-raw.glb', tmp_path / f'{index}.glb'
        write_tile_glb(str(raw), {'buildings': mesh}, {}, [])
        assert compress_meshopt(str(raw), str(packed))
        paths.append(str(packed))
    game = Path(__file__).resolve().parents[2] / 'game'
    script = '''
      import { NodeIO } from '@gltf-transform/core';
      import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
      import { MeshoptDecoder } from 'meshoptimizer';
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({'meshopt.decoder': MeshoptDecoder});
      const result=[];
      for(const path of process.argv.slice(1)) {
        const doc=await io.read(path), rows=[];
        for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()) {
          const attribute=primitive.getAttribute('TEXCOORD_1');
          if(!attribute)throw new Error('missing building identity');
          for(let i=0;i<attribute.getCount();i++) {
            const row=attribute.getElement(i,[]);
            rows.push([Math.round(row[0]*1024)/1024, Math.round(row[1])]);
          }
        }
        result.push([...new Map(rows.map(row=>[JSON.stringify(row),row])).values()]);
      }
      console.log(JSON.stringify(result));
    '''
    result = subprocess.run(['node', '--input-type=module', '-e', script, *paths],
                            cwd=game, capture_output=True, text=True, check=True)
    decoded = json.loads(result.stdout)
    assert len(decoded) == 2
    for tile in decoded:
        assert list(homes.facade[0]) in tile
    assert sorted({tuple(row) for tile in decoded for row in tile}) == expected
