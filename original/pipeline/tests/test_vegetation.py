import os
import zlib
from types import SimpleNamespace

import numpy as np
import pytest
from shapely.geometry import Point, Polygon

from sr.fetch_osm import CACHE_DIR
from sr.vegetation import (DENSITY, PAVED, ZONED_DENSITY, FLOWER_MATERIALS, FOLIAGE_BY_KIND, MAX_TREES,
                           PALM_VARIANT_COUNT, TREE_KINDS, TRUNK, add_to_tiles, flower_meshes,
                           kind_for_tags, lombard_flowers, scatter, tree_mesh)

HAS_CACHE = os.path.exists(os.path.join(CACHE_DIR, "goldengate", "landuse.json.gz"))


def test_a_tree_is_a_trunk_and_a_canopy_with_their_own_materials():
    for kind in TREE_KINDS:
        parts = tree_mesh(kind)
        assert set(parts) == {TRUNK, FOLIAGE_BY_KIND[kind]}
        assert parts[TRUNK].material == TRUNK
        assert parts[FOLIAGE_BY_KIND[kind]].material == FOLIAGE_BY_KIND[kind]
        assert sum(p.triangle_count for p in parts.values()) > 0


def test_every_tree_triangle_faces_its_own_shading_normal():
    """FrontSide is the material default: inward winding makes an otherwise valid tree invisible."""
    from sr.mesh import geometric_normals

    for kind in TREE_KINDS:
        for part, mesh in tree_mesh(kind).items():
            triangles = mesh.indices.reshape(-1, 3)
            face = geometric_normals(mesh.positions, triangles)
            shade = mesh.normals[triangles].mean(axis=1)
            assert (np.einsum("ij,ij->i", face, shade) > 0).all(), f"{kind}/{part} has inward faces"


def test_a_tree_stands_on_its_own_origin_and_the_canopy_is_above_the_trunk():
    """Instances place a tree by its footing and scale it, so the mesh has to start at y = 0."""
    for kind in TREE_KINDS:
        parts = tree_mesh(kind)
        assert parts[TRUNK].bounds()[0][1] == pytest.approx(0.0, abs=1e-5)
        foliage = parts[FOLIAGE_BY_KIND[kind]]
        assert foliage.bounds()[0][1] > 0.0
        assert foliage.bounds()[1][1] > parts[TRUNK].bounds()[1][1]


def test_a_conifer_is_taller_and_narrower_than_a_broadleaf():
    con = tree_mesh("conifer")[FOLIAGE_BY_KIND["conifer"]].bounds()
    broad = tree_mesh("broadleaf")[FOLIAGE_BY_KIND["broadleaf"]].bounds()
    assert con[1][1] > broad[1][1]
    assert (con[1][0] - con[0][0]) < (broad[1][0] - broad[0][0])


def test_palms_have_curved_feathered_fronds_and_several_trunk_silhouettes():
    crowns = []
    for variant in range(PALM_VARIANT_COUNT):
        parts = tree_mesh("palm", variant)
        trunk = parts[TRUNK]
        fronds = parts[FOLIAGE_BY_KIND["palm"]]
        rings = trunk.positions.reshape(10, 9, 3).mean(axis=1)
        crowns.append(rings[-1, [0, 2]])
        assert np.linalg.norm(rings[-1, [0, 2]] - rings[0, [0, 2]]) > 0.55
        assert np.max(np.linalg.norm(np.diff(rings[:, [0, 2]], axis=0), axis=1)) < 0.32
        assert fronds.triangle_count >= 600
        from sr.mesh import geometric_normals
        face_area = np.linalg.norm(geometric_normals(fronds.positions,
                                                     fronds.indices.reshape(-1, 3)), axis=1)
        assert np.min(face_area) > 1e-5
        lo, hi = fronds.bounds()
        assert hi[0] - lo[0] > 6.0 and hi[2] - lo[2] > 6.0
        assert lo[1] < rings[-1, 1] - 0.7 < hi[1]
        # CLEAR is measured from the paved apron. Even the widest, tallest allowed instance keeps
        # its bent trunk outside that line, while leaves may safely arch above the street.
        trunk_reach = np.max(np.linalg.norm(trunk.positions[:, [0, 2]], axis=1)) * 1.45 * 1.12
        assert trunk_reach < 2.5
        assert lo[1] * 0.75 * 0.94 > 3.5
    assert len({tuple(np.round(crown, 2)) for crown in crowns}) == PALM_VARIANT_COUNT


def test_palm_instances_choose_repeatable_variants_and_independent_height_and_thickness():
    from sr.tiles import TileSet

    trees = [(float(i * 7), 0.0, float((i % 3) * 11), i * 0.17, 1.0, "palm")
             for i in range(30)]
    a = TileSet(); add_to_tiles(a, trees)
    b = TileSet(); add_to_tiles(b, trees)
    a_nodes = {name: data for tile in a.instances.values() for name, data in tile.items()}
    b_nodes = {name: data for tile in b.instances.values() for name, data in tile.items()}
    variants = {name.split("_v", 1)[1].split("_", 1)[0] for name in a_nodes}
    assert len(variants) == PALM_VARIANT_COUNT
    assert a_nodes.keys() == b_nodes.keys()
    for name in a_nodes:
        assert a_nodes[name]["positions"] == b_nodes[name]["positions"]
        assert a_nodes[name]["scales"] == b_nodes[name]["scales"]
        assert all(scale[0] == scale[2] and scale[0] != scale[1]
                   for scale in a_nodes[name]["scales"])


def test_hydrangea_bush_has_leaf_mass_and_five_visible_heads_in_each_shared_colour():
    bush, blooms = flower_meshes()
    assert bush.material == "foliage"
    assert set(blooms) == set(FLOWER_MATERIALS)
    assert all(mesh.material == material for material, mesh in blooms.items())
    assert all(mesh.triangle_count >= 5 * 40 for mesh in blooms.values())


def test_only_lombards_tight_block_gets_dense_repeatable_flower_beds(monkeypatch):
    from sr.geom import resample, rights, tangents

    angle = np.linspace(0, 4 * np.pi, 500)
    points = np.column_stack((24 * np.sin(angle), np.zeros(len(angle)), angle * 8))
    P, S = resample(points, 2.0)
    T = tangents(P)
    res = SimpleNamespace(P=P, S=S, T=T, R=rights(T), half_width=np.full(len(P), 3.0),
                          closed=False, length=float(S[-1]),
                          snapped=[P[0, [0, 2]], P[len(P) // 4, [0, 2]],
                                   P[len(P) * 3 // 4, [0, 2]]])
    monkeypatch.setattr("sr.vegetation.ground_height",
                        lambda _res, _road_y, _dem, points: np.zeros(len(points)))
    a = lombard_flowers(res, np.zeros(len(P)), object(), "lombard")
    b = lombard_flowers(res, np.zeros(len(P)), object(), "lombard")
    assert len(a) >= 150
    assert a == b
    assert {plant[5] for plant in a} == set(FLOWER_MATERIALS)
    assert lombard_flowers(res, np.zeros(len(P)), object(), "goldengate") == []
    from shapely.geometry import Point
    sight_clear = Point(a[0][0], a[0][2]).buffer(6.5)
    visible = lombard_flowers(res, np.zeros(len(P)), object(), "lombard", sight_clear=sight_clear)
    assert 0 < len(visible) < len(a)
    assert all(not sight_clear.covers(Point(p[0], p[2])) for p in visible)

    placed = np.asarray([[p[0], p[2]] for p in a])
    from scipy.spatial import cKDTree
    distance, nearest = cKDTree(P[:, [0, 2]]).query(placed)
    assert np.all(distance > res.half_width[nearest] + 0.7)


def test_osm_species_tags_choose_the_shapes_they_name():
    assert kind_for_tags({"leaf_type": "palm"}) == "palm"
    assert kind_for_tags({"species": "Phoenix canariensis"}) == "palm"
    assert kind_for_tags({"genus": "Malus"}) == "orchard"
    assert kind_for_tags({"leaf_type": "needleleaved"}) == "conifer"
    assert kind_for_tags({"leaf_type": "broadleaved"}) == "broadleaf"


def test_scatter_lands_inside_the_polygon_at_about_the_asked_density():
    poly = Polygon([(0, 0), (200, 0), (200, 200), (0, 200)])
    rng = np.random.default_rng(1)
    pts = scatter(poly, 90.0, rng)
    assert len(pts) == int(poly.area / 90.0)
    assert all(poly.contains(__import__("shapely").geometry.Point(p[0], p[1])) for p in pts)


def test_scatter_of_a_tiny_patch_is_empty_rather_than_one_lonely_tree():
    rng = np.random.default_rng(1)
    assert len(scatter(Polygon([(0, 0), (4, 0), (4, 4), (0, 4)]), 90.0, rng)) == 0


def test_the_same_route_grows_the_same_forest():
    """Seeded from a stable hash of the route id. Python's own string hash is randomised per
    process, so seeding with it would move every tree on every build and void the visual baseline."""
    poly = Polygon([(0, 0), (150, 0), (150, 150), (0, 150)])
    a = scatter(poly, 100.0, np.random.default_rng(zlib.crc32(b"goldengate")))
    b = scatter(poly, 100.0, np.random.default_rng(zlib.crc32(b"goldengate")))
    c = scatter(poly, 100.0, np.random.default_rng(zlib.crc32(b"twin-peaks")))
    assert np.array_equal(a, b)
    assert not np.array_equal(a, c)


def test_scrub_is_sparser_than_woodland():
    assert DENSITY["scrub"] > DENSITY["wood"]


def test_positions_gets_landuse_rings_from_the_shared_reader(monkeypatch):
    called = []
    ring = [(40.0, 40.0), (40.0, 80.0), (80.0, 80.0), (40.0, 40.0)]
    monkeypatch.setattr("sr.vegetation.load_layer", lambda *_: {"elements": []})
    monkeypatch.setattr("sr.vegetation.landcover.rings",
                        lambda route_id, wanted, keys=None, relations=False:
                        called.append((route_id, wanted, keys, relations)) or ([("wood", ring)] if keys is None else []))
    monkeypatch.setattr("sr.vegetation.ground_height",
                        lambda _res, _road_y, _dem, points: np.zeros(len(points)))
    frame = SimpleNamespace(to_local=lambda lat, lon: (np.asarray(lat), np.asarray(lon)))
    res = SimpleNamespace(
        frame=frame,
        P=np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]]),
        half_width=np.array([1.0, 1.0]),
    )
    got = __import__("sr.vegetation", fromlist=["positions"]).positions(
        res, np.zeros(2), object(), "route", Polygon([(0, 0), (100, 0), (100, 100), (0, 100)]))
    assert called == [("route", set(DENSITY) | set(ZONED_DENSITY) | PAVED, None, True),
                      ("route", {"parking"}, ("amenity",), True)]
    assert got, "the shared ring must reach the tree scatter, not only be imported unused"


@pytest.mark.skipif(not HAS_CACHE, reason="needs the goldengate cache")
def test_goldengate_trees_keep_off_the_road():
    import numpy as np
    from sr.dem import DemSampler
    from sr.route import build_route
    from sr.routes import load_route
    from sr.terrain import APRON, corridor_polygon, road_profile
    from sr.vegetation import CLEAR, positions
    from scipy.spatial import cKDTree

    res = build_route("goldengate")
    route = load_route("goldengate")
    dem = DemSampler()
    road_y = road_profile(res, dem, route.get("bridgeDeckM"), route.get("bridgeMinLengthM", 200.0))
    res.P[:, 1] = road_y
    trees = positions(res, road_y, dem, "goldengate", corridor_polygon(res))
    assert 200 < len(trees) <= MAX_TREES, len(trees)
    P = np.array([[t[0], t[2]] for t in trees])
    dist, idx = cKDTree(res.P[:, [0, 2]]).query(P)
    assert np.all(dist > res.half_width[idx] + APRON + CLEAR - 1e-6), "a tree in the road"
    assert {t[5] for t in trees} <= set(TREE_KINDS)


@pytest.mark.skipif(not HAS_CACHE, reason="needs the cached OSM extracts")
def test_fishermans_keeps_mapped_palms():
    from sr.dem import DemSampler
    from sr.route import build_route
    from sr.routes import load_route
    from sr.terrain import corridor_polygon, road_profile
    from sr.vegetation import positions

    res = build_route("fishermans-wharf")
    route = load_route("fishermans-wharf")
    dem = DemSampler()
    road_y = road_profile(res, dem, route.get("bridgeDeckM"), route.get("bridgeMinLengthM", 200.0))
    res.P[:, 1] = road_y
    trees = positions(res, road_y, dem, "fishermans-wharf", corridor_polygon(res))
    assert sum(t[5] == "palm" for t in trees) >= 40


def test_residential_and_park_ground_is_planted_but_never_on_streets_buildings_or_car_parks(monkeypatch):
    """Zoned ground gets trees; the obstacles the caller hands in and mapped paving stay bare."""
    from shapely.geometry import box
    from sr import vegetation
    square = lambda x0, z0, x1, z1: [(x0, z0), (x0, z1), (x1, z1), (x1, z0), (x0, z0)]
    rings = [("residential", square(20, 20, 220, 220)), ("park", square(-220, 20, -20, 220)),
             ("parking", square(120, 120, 220, 220)), ("wood", square(-220, -220, -20, -20))]
    monkeypatch.setattr("sr.vegetation.load_layer", lambda *_: {"elements": []})
    monkeypatch.setattr("sr.vegetation.landcover.rings",
                        lambda route_id, wanted, keys=None, relations=False: rings if keys is None else [])
    monkeypatch.setattr("sr.vegetation.ground_height", lambda _r, _y, _d, points: np.zeros(len(points)))
    frame = SimpleNamespace(to_local=lambda lat, lon: (np.asarray(lat, float), np.asarray(lon, float)))
    res = SimpleNamespace(frame=frame, P=np.array([[0.0, 0.0, -250.0], [0.0, 0.0, 250.0]]),
                          half_width=np.array([1.0, 1.0]))
    monkeypatch.setattr("sr.vegetation.flat_inner", lambda _res, idx, _p: np.full(len(idx), 5.0))
    corridor = box(-250, -250, 250, 250)
    street = box(20, 100, 220, 112)                 # a residential street across the block
    house = box(40, 40, 70, 70)
    wood_building = box(-200, -200, -100, -100)     # obstacles only thin out zoned ground, not woodland
    got = vegetation.positions(res, np.zeros(2), object(), "route", corridor,
                               occupied=street.union(house).union(wood_building))
    pts = np.array([(x, z) for x, _y, z, *_ in got])
    kinds = [k for *_, k in got]
    inside = lambda g: np.array([g.contains(Point(x, z)) for x, z in pts])
    residential = inside(box(20, 20, 220, 220))
    assert residential.sum() > 60 and inside(box(-220, 20, -20, 220)).sum() > 120
    assert not inside(street.buffer(-0.01)).any()
    assert not inside(house.buffer(-0.01)).any()
    assert not inside(box(120, 120, 220, 220).buffer(-0.01)).any()
    assert inside(wood_building).sum() > 50
    assert set(kinds) <= {"broadleaf", "conifer"}
    assert "conifer" in kinds and "broadleaf" in kinds


def test_campus_relations_and_amenity_car_parks_reach_the_tree_scatter(monkeypatch):
    """Review: Google's campus is a multipolygon relation and car parks are amenity=parking."""
    from shapely.geometry import box
    from sr import landcover, vegetation
    way = lambda pts: {"type": "way", "geometry": [{"lat": a, "lon": b} for a, b in pts]}
    campus = {"type": "relation", "tags": {"landuse": "commercial", "type": "multipolygon"}, "members": [
        {"type": "way", "role": "outer", "geometry": [{"lat": 20, "lon": 20}, {"lat": 20, "lon": 220}, {"lat": 220, "lon": 220}]},
        {"type": "way", "role": "outer", "geometry": [{"lat": 220, "lon": 220}, {"lat": 220, "lon": 20}, {"lat": 20, "lon": 20}]},
    ]}
    park = {"type": "way", "tags": {"amenity": "parking"},
            "geometry": [{"lat": a, "lon": b} for a, b in [(20, 20), (20, 120), (120, 120), (120, 20), (20, 20)]]}
    layer = {"elements": [campus, park]}
    monkeypatch.setattr("sr.landcover.load_layer", lambda *_: layer)
    joined = landcover.rings("route", {"commercial"}, relations=True)
    assert len(joined) == 1 and len(joined[0][1]) >= 4, "the two split outer ways close into one ring"
    assert landcover.rings("route", {"commercial"}) == [], "terrain cover keeps skipping relations"
    monkeypatch.setattr("sr.vegetation.load_layer", lambda *_: {"elements": []})
    monkeypatch.setattr("sr.vegetation.ground_height", lambda _r, _y, _d, points: np.zeros(len(points)))
    monkeypatch.setattr("sr.vegetation.flat_inner", lambda _res, idx, _p: np.full(len(idx), 5.0))
    frame = SimpleNamespace(to_local=lambda lat, lon: (np.asarray(lat, float), np.asarray(lon, float)))
    res = SimpleNamespace(frame=frame, P=np.array([[0.0, 0.0, -250.0], [0.0, 0.0, 250.0]]), half_width=np.array([1.0, 1.0]))
    got = vegetation.positions(res, np.zeros(2), object(), "route", box(-250, -250, 250, 250))
    pts = [(x, z) for x, _y, z, *_ in got]
    assert len(pts) > 40, "the relation-only campus is planted"
    assert not any(20 < x < 120 and 20 < z < 120 for x, z in pts), "no tree on the amenity car park"


def test_the_build_hands_buildings_and_streets_to_the_tree_scatter(monkeypatch):
    """The obstacles the scatter obeys must really contain the route's buildings and mapped streets."""
    from shapely.geometry import Point
    from sr import build
    street = SimpleNamespace(xy=np.array([[0.0, 50.0], [200.0, 50.0]]), width_m=0, highway="residential", lanes=2)
    monkeypatch.setattr("sr.route.load_ways", lambda route_id, frame: [street])
    corridor = Polygon([(-300, -300), (300, -300), (300, 300), (-300, 300)])
    boxes = [[100.0, 0.0, -100.0, 10.0, 5.0, 8.0, 0.0]]
    blocked = build.tree_obstacles(SimpleNamespace(frame=None), "route", corridor, boxes)
    assert blocked.contains(Point(100, -100)) and blocked.contains(Point(109, -107)), "inside the building box"
    assert blocked.contains(Point(111, -100)), "within the clearance beside the building"
    assert blocked.contains(Point(50, 50)) and blocked.contains(Point(50, 55)), "on and beside the street"
    assert not blocked.contains(Point(50, 0)), "open ground between them stays plantable"
    
    assert "occupied=tree_obstacles(" in open(build.__file__).read()
