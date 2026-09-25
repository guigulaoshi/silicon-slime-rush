import numpy as np

from sr.mesh import box, quad, split_by_tile
from sr.tiles import TILE, TileSet, s_ranges_for_tile, tile_of, tile_rect


def test_tile_of_negative_coords():
    assert tile_of(-1.0, 0.0) == (-1, 0) and tile_of(255.9, 256.0) == (0, 1)
    assert tile_rect(-1, 0) == (-TILE, 0.0, 0.0, TILE)


def test_s_ranges_merge_contiguous_runs():
    P = np.stack([np.arange(0, 600, 2.0), np.zeros(300), np.zeros(300)], axis=1)
    S = np.arange(300) * 2.0
    r = s_ranges_for_tile(P, S, 1, 0, margin=0.0)
    # the tile spans x 256..512 and the range carries one sample of slack at each end
    assert len(r) == 1 and abs(r[0][0] - 254) < 1e-9 and abs(r[0][1] - 514) < 1e-9


def test_s_ranges_cover_tiles_beside_the_road():
    P = np.stack([np.arange(0, 600, 2.0), np.zeros(300), np.zeros(300)], axis=1)
    S = np.arange(300) * 2.0
    assert s_ranges_for_tile(P, S, 0, -1) != [], "the tile the driver is looking at must carry an interval"
    assert s_ranges_for_tile(P, S, 0, 4) == [], "a tile a kilometre away must not"


def test_s_ranges_padding_stays_inside_the_authoritative_route_length():
    P = np.array([[0., 0., 0.], [3., 4., 0.], [6., 4., 0.]])
    S = np.array([0., 5., 8.])
    ranges = s_ranges_for_tile(P, S, 0, 0, margin=0)
    assert ranges == [[0.0, 8.0]]


def test_split_by_tile_reindexes():
    b = box((256.0, 5, 128.0), (10, 5, 10))  # straddles tiles 0 and 1 along x
    parts = split_by_tile(b, tile_of)
    assert set(parts) == {(0, 0), (1, 0)}
    for m in parts.values():
        assert m.indices.max() < len(m.positions)


def test_tileset_bounds_and_boxes():
    ts = TileSet()
    ts.add_mesh("buildings", box((10, 5, 10), (4, 5, 4)))
    ts.add_box_collider((10, 5, 10), (4, 5, 4), 0.0)
    ts.add_mesh("terrain", quad(0, 0, 256, 256), tile=(0, 0))
    lo, hi = ts.bounds((0, 0))
    assert lo[0] == 0 and hi[0] == 256 and hi[1] == 10
    assert ts.boxes[(0, 0)][0][:3] == [10, 5, 10]


def _faces_up(mesh):
    from sr.mesh import geometric_normals
    n = geometric_normals(mesh.positions, mesh.indices.reshape(-1, 3))
    return (n[:, 1] > 0).all()


def test_ground_generators_wind_face_up():
    """A ground mesh wound the wrong way is invisible, not dark: the renderer culls it outright."""
    from sr.mesh import grid, quad, ribbon
    import numpy as np
    assert _faces_up(quad(0, 0, 10, 10))
    assert _faces_up(grid(0, 0, 30, 30, np.zeros((4, 4))))
    P = np.stack([np.arange(0, 20, 2.0), np.zeros(10), np.zeros(10)], axis=1)
    R = np.tile([0.0, 0.0, 1.0], (10, 1))
    assert _faces_up(ribbon(P, R, [4.0] * 10))


def test_every_face_agrees_with_its_shading_normal():
    from sr.mesh import box, geometric_normals, vertical_strip
    import numpy as np
    for m in (box((0, 5, 0), (3, 5, 4), 0.7), box((0, 5, 0), (3, 5, 4), 0.0)):
        g = geometric_normals(m.positions, m.indices.reshape(-1, 3))
        shading = m.normals[m.indices.reshape(-1, 3)].mean(axis=1)
        assert (np.einsum("ij,ij->i", g, shading) > 0).all()
    top = np.stack([np.arange(0, 20, 2.0), np.full(10, 6.0), np.zeros(10)], axis=1)
    bot = top.copy(); bot[:, 1] = 0.0
    for flip in (False, True):
        w = vertical_strip(top, bot, flip=flip)
        g = geometric_normals(w.positions, w.indices.reshape(-1, 3))
        shading = w.normals[w.indices.reshape(-1, 3)].mean(axis=1)
        assert (np.einsum("ij,ij->i", g, shading) > 0).all()
        assert abs(g[:, 2].mean()) > 0  # a wall faces sideways, never up


def test_the_building_colliders_ride_on_a_facade_node_when_there_is_no_plain_buildings_node(tmp_path):
    ""
    import json
    from pygltflib import GLTF2
    from sr.export import write_tile_glb
    from sr.mesh import box

    nodes = {"buildings_glass": box((0, 5, 0), (4, 5, 4), material="building_glass"),
             "buildings_metal": box((30, 3, 0), (3, 3, 3), material="building_metal"),
             "terrain": quad(-50, -50, 50, 50)}
    boxes = [[0.0, 5.0, 0.0, 4.0, 5.0, 4.0, 0.0], [30.0, 3.0, 0.0, 3.0, 3.0, 3.0, 0.0]]
    path = tmp_path / "t.glb"
    write_tile_glb(str(path), nodes, {}, boxes)
    gltf = GLTF2().load(str(path))
    carrying = {n.name: n.extras.get("boxes") for n in gltf.nodes if n.extras}
    assert carrying.get("buildings_glass") == boxes, "the first facade node carries them"
    assert carrying.get("buildings_metal") is None, "and only that one"
    assert all(n.extras["collider"] == "boxes" for n in gltf.nodes
               if n.name.startswith("buildings")), "the prefix still decides the collider kind"


def test_building_identity_survives_merge_and_tile_vertex_reordering():
    from sr.buildings import facade_identity
    from sr.mesh import merge
    home = facade_identity(box((256, 5, 128), (12, 5, 12)), "way:123", True)
    office = facade_identity(box((280, 9, 128), (8, 9, 8)), "way:456", False)
    identity = home.facade[0].copy()
    combined = merge([home, office])
    pieces = split_by_tile(combined, tile_of)
    assert len(pieces) == 2
    count = 0
    for mesh in pieces.values():
        homes = mesh.facade[:, 1] == 1
        assert np.all(mesh.facade[homes] == identity)
        count += np.count_nonzero(homes)
        for tri in mesh.indices.reshape(-1, 3):
            assert np.all(mesh.facade[tri] == mesh.facade[tri[0]])
    assert count >= len(home.positions)
    repeated = facade_identity(box((0, 0, 0), (1, 1, 1)), "way:123", True)
    assert np.all(repeated.facade == identity)
    assert identity[0] != office.facade[0, 0]


def test_missing_facade_metadata_has_the_legacy_default_when_merged():
    from sr.buildings import facade_identity
    from sr.mesh import merge
    old = box((0, 0, 0), (1, 1, 1))
    new = facade_identity(box((5, 0, 0), (1, 1, 1)), "new")
    merged = merge([old, new])
    assert np.all(merged.facade[:len(old.positions)] == 0)
    assert np.all(merged.facade[len(old.positions):] == new.facade)
