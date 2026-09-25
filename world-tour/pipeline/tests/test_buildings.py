import ast
from collections import Counter
import os
import re

import numpy as np
import pytest
from shapely.geometry import Polygon

from sr.buildings import (_building_base, _join_rings, _rings, extrude, finish_roof,
                          roof_fascia, roofline_bottom)
from sr.mesh import BUILDING_UV_METRES, box, pitched_roof, pitched_roof_parts
from sr.routes import all_route_ids

UV_SCALE = BUILDING_UV_METRES
SR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sr")
CONTRACT = os.path.normpath(os.path.join(SR_DIR, "..", "..", "docs", "CONTRACT.md"))


def _wall_verts(mesh):
    """The wall vertices of an extrusion: everything whose normal is horizontal."""
    horizontal = np.abs(mesh.normals[:, 1]) < 1e-6
    return mesh.positions[horizontal], mesh.uvs[horizontal]


def _open_edges(mesh):
    """Geometric edges used an odd number of times, despite per-face duplicated vertices."""
    points = [tuple(np.round(point, 6)) for point in mesh.positions]
    edges = Counter()
    for tri in np.asarray(mesh.indices).reshape(-1, 3):
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            edges[tuple(sorted((points[a], points[b])))] += 1
    return [edge for edge, count in edges.items() if count % 2]


def test_an_extruded_building_is_a_closed_volume():
    """A building may be clipped by terrain, but no camera angle may see sky through its floor."""
    poly = Polygon([(0, 0), (20, 0), (20, 12), (14, 12), (14, 5), (0, 5)])
    mesh = extrude(poly, base=8.0, top=24.0)
    assert not _open_edges(mesh)
    assert mesh.positions[:, 1].min() < 8.0, "the closing floor must remain buried below terrain"


def test_pitched_roofs_have_a_raised_crisp_ridge_and_upward_slopes():
    for kind in ("gable", "hip"):
        roof = pitched_roof((10, 8, 20), (9, 5), yaw=.4, rise=2.5, kind=kind,
                            material="building_stucco")
        assert roof.positions[:, 1].min() == pytest.approx(8.0)
        assert roof.positions[:, 1].max() == pytest.approx(10.5)
        slopes = roof.normals[:, 1] > .1
        assert slopes.any() and np.all(slopes | (np.abs(roof.normals[:, 1]) < 1e-6) | (roof.normals[:, 1] < -.999)), \
            "upward slopes, vertical gable ends and the flat underside only"
        assert np.unique(np.round(roof.normals[slopes], 4), axis=0).shape[0] >= 2
        assert np.allclose(roof.uvs, .02), "facade windows must not climb onto the roof"


@pytest.mark.parametrize(("material", "expected"), [
    ("building", 3.02),
    ("building_glass", 2.82),
    ("building_stucco", 2.82),
    ("building_parking", 2.82),
])
def test_roofline_starts_after_the_last_complete_window_row(material, expected):
    assert roofline_bottom(0.0, 5.5, material) == pytest.approx(expected)


def test_flat_roof_has_a_windowless_cap_and_a_raised_parapet():
    poly = Polygon([(0, 0), (18, 0), (18, 12), (0, 12)])
    finish, pitched_base, roof_top = finish_roof(poly, 0.0, 5.5, "building_glass", "flat")
    assert finish.positions[:, 1].min() == pytest.approx(2.82)
    assert pitched_base == pytest.approx(5.92)
    assert roof_top == pytest.approx(6.44)
    assert finish.positions[:, 1].max() == pytest.approx(roof_top)
    assert np.allclose(finish.uvs, .02), "the cap must sample a windowless facade texel"
    assert not _open_edges(finish), "cornice and parapet must be closed solids"


def test_ring_roof_fascia_does_not_fill_the_occupied_roof():
    ring = Polygon([(0, 0), (30, 0), (30, 30), (0, 30)],
                   [[(8, 8), (8, 22), (22, 22), (22, 8)]])
    fascia = roof_fascia(ring, 30.0)
    assert fascia.positions[:, 1].min() == pytest.approx(27.0)
    assert fascia.positions[:, 1].max() == pytest.approx(30.10)
    assert np.allclose(fascia.uvs, .02), "the Colosseum's top band must stay free of windows"
    # Every roof-facing triangle belongs to the thin boundary strip, never the courtyard or the
    # occupied middle of the annular roof.
    horizontal = np.abs(fascia.normals[:, 1]) > .9
    assert horizontal.any()
    assert not np.any(np.all(np.isclose(fascia.positions[horizontal][:, [0, 2]], [15, 15]), axis=1))


@pytest.mark.parametrize("producer", ["street", "district", "skyline"])
def test_actual_building_producers_do_not_overlap_windowed_walls_and_roof_bands(monkeypatch, producer):
    from dataclasses import replace
    import sr.backdrop as backdrop
    import sr.buildings as buildings
    import sr.vistas as vistas
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=600.0)
    dem = FakeDem(res.frame, lambda x, z: np.full(np.shape(x), 10.0))
    poly = Polygon([(100, 500), (120, 500), (120, 520), (100, 520)])
    monkeypatch.setattr(vistas, "choose_roof", lambda *args, **kwargs: "flat")
    if producer == "street":
        import sr.local_style as local_style
        monkeypatch.setattr(local_style, "types", lambda route: [])     # the shared facades (a city style: below)
        monkeypatch.setattr(buildings, "footprints", lambda *args, **kwargs:
                            [(poly, {"building": "yes", "height": "12"})])
        monkeypatch.setattr(buildings, "landmark_footprints", lambda *args, **kwargs: [])
        meshes, _ = buildings.build_buildings(res, np.full(len(res.P), 10.0), dem,
                                              "beijing", poly.buffer(1))
        assert len(meshes) == 1
        mesh = next(iter(meshes.values()))
        assert mesh.facade is not None and np.all(mesh.facade[:, 0] > 0)
    elif producer == "district":
        p = replace(vistas.profile("beijing"), density=1, near_m=0, height_m=(12, 12))
        monkeypatch.setattr(vistas, "profile", lambda _: p)
        monkeypatch.setattr(vistas, "_candidate_grid", lambda *args: np.array([[110., 510.]]))
        monkeypatch.setattr(vistas, "settlement_mask", lambda route, lat, lon: np.ones(len(lat), bool))
        meshes, stats = vistas.city_massing(res, dem, "beijing")
        assert stats["buildings"] == 1
        mesh = next(iter(meshes.values()))
        assert mesh.facade is not None and np.all(mesh.facade[:, 0] > 0)
    else:
        x, z = np.array(poly.exterior.coords).T
        lat, lon = res.frame.to_latlon(x, z)
        element = {"tags": {"building": "yes", "building:levels": "4"},
                   "geometry": [{"lat": la, "lon": lo} for la, lo in zip(lat, lon)]}
        monkeypatch.setattr(backdrop, "load_layer", lambda *args: {"elements": [element]})
        monkeypatch.setattr(backdrop, "landmark_footprints", lambda *args, **kwargs: [])
        meshes = backdrop.skyline(res, dem, "beijing", corridor_pad=300)
        assert meshes is not None
        mesh = next(iter(meshes.values()))
    assert mesh.facade is not None and np.all(mesh.facade[:, 0] > 0)
    positions, uvs = _wall_verts(mesh)
    pinned = np.all(np.isclose(uvs, .02), axis=1)
    assert pinned.any() and (~pinned).any(), "both facade surfaces must actually be examined"
    window_top = positions[~pinned, 1].max()
    assert window_top <= positions[pinned, 1].min() + 1e-4
    assert mesh.positions[:, 1].max() > window_top + .9, "retain the roof and raised parapet"


@pytest.mark.parametrize("route_id", all_route_ids())
def test_every_actual_route_facade_batch_contains_the_new_vertical_roof_finish(route_id):
    """Audit every cached footprint, rather than one browser streaming window per route."""
    import sr.buildings as buildings
    from sr.route import build_route
    from sr.routes import load_route
    from sr.terrain import corridor_polygon
    from tests.test_terrain import FakeDem

    res = build_route(route_id)
    route = load_route(route_id)
    corridor = corridor_polygon(res, pad=route.get("terrainPadM", 300))
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))
    by_material, _boxes = buildings.build_buildings(
        res, np.zeros(len(res.P)), dem, route_id, corridor)
    assert by_material, f"{route_id}: the real cache must contain buildings inside its corridor"
    for material, mesh in by_material.items():
        if material not in ("building", "building_stucco", "building_glass", "building_metal", "building_concrete", "building_parking"):
            continue
        vertical = np.abs(mesh.normals[:, 1]) < .1
        pinned = np.all(np.isclose(mesh.uvs, .02), axis=1)
        assert np.any(vertical & pinned), f"{route_id}/{material}: no no-window roof fascia"


def test_a_road_clipped_house_does_not_regrow_a_rectangular_roof_over_the_road(monkeypatch):
    from shapely import affinity
    import sr.buildings as buildings
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=600.0)
    # Clipping this rotated rectangle at z=10 leaves a 96.7%-rectangular polygon. The old 94% rule
    # accepted it, then regrew the missing corner as a pitched roof over the road.
    poly = affinity.rotate(Polygon([(85, 12), (115, 12), (115, 24), (85, 24)]),
                           20, origin=(100, 18))
    road = Polygon([(-50, -10), (650, -10), (650, 10), (-50, 10)])
    monkeypatch.setattr(buildings, "footprints", lambda *args, **kwargs: [(poly, {"building": "house"})])
    monkeypatch.setattr(buildings, "landmark_footprints", lambda *args, **kwargs: [])
    monkeypatch.setattr("sr.vistas.choose_roof", lambda *args, **kwargs: "gable")
    corridor = Polygon([(-50, -100), (650, -100), (650, 100), (-50, 100)])
    by_material, _ = buildings.build_buildings(
        res, np.zeros(len(res.P)), FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x))),
        # a route with no `architecture` of its own: this is about the roof, not a city's palette
        "amboseli", corridor, keep_clear=road)
    mesh = by_material["building_stucco"]
    assert mesh.positions[:, 1].max() == pytest.approx(7.94)
    # The clipped outline still gets a pitched roof -- grown from the outline, never the rectangle.
    roofs = [part for name, part in by_material.items() if name.startswith("house_roof")]
    assert roofs and max(r.positions[:, 1].max() for r in roofs) > 7.94 + 1.0
    for part in by_material.values():
        triangles=part.positions[part.indices.reshape(-1,3)]
        assert not any(Polygon(t[:,[0,2]]).intersection(road).area>.001 for t in triangles)


def test_wall_faces_point_out_of_the_solid_for_any_osm_ring_winding():
    shell = [(0, 0), (20, 0), (20, 20), (0, 20)]
    hole = [(7, 7), (13, 7), (13, 13), (7, 13)]
    for reverse_shell, reverse_hole in ((False, False), (True, False), (False, True), (True, True)):
        poly = Polygon(shell[::-1] if reverse_shell else shell,
                       [hole[::-1] if reverse_hole else hole])
        mesh = extrude(poly, base=0.0, top=10.0)
        # Walls are the first four vertices per boundary edge. Exterior normals point away from the
        # building centre; courtyard normals point into the empty courtyard.
        wall_quads = 4 * (len(shell) + len(hole))
        for i in range(0, wall_quads, 4):
            centre = mesh.positions[i:i + 4, [0, 2]].mean(axis=0)
            normal = mesh.normals[i:i + 4, [0, 2]].mean(axis=0)
            on_hole = 6.9 <= centre[0] <= 13.1 and 6.9 <= centre[1] <= 13.1
            want = np.array([10.0, 10.0]) - centre if on_hole else centre - np.array([10.0, 10.0])
            assert np.dot(normal, want) > 0, (reverse_shell, reverse_hole, centre, normal)


def _geo(lat, lon):
    return {"lat": lat, "lon": lon}


def test_split_multipolygon_members_are_joined_in_either_direction():
    """Open relation members are edges, not buildings; closing each one creates giant flat walls."""
    bottom = [_geo(0, 0), _geo(0, 2)]
    right_top = [_geo(1, 2), _geo(0, 2)]       # deliberately reversed
    left = [_geo(1, 0), _geo(0, 0)]
    top = [_geo(1, 2), _geo(1, 0)]
    rings = _join_rings([right_top, bottom, left, top])
    assert len(rings) == 1
    assert rings[0][0] == rings[0][-1]
    assert {_geo(0, 0)["lat"], _geo(1, 0)["lat"]} == {p["lat"] for p in rings[0]}


def test_an_incomplete_relation_never_invents_a_closing_wall():
    missing_top = [[_geo(0, 0), _geo(0, 2)], [_geo(0, 2), _geo(1, 2)]]
    assert _join_rings(missing_top) == []
    relation = {"type": "relation", "members": [
        {"role": "outer", "geometry": member} for member in missing_top
    ]}
    assert _rings(relation) == ([], [])


def test_building_relations_use_the_outline_and_never_promote_parts_to_buildings():
    outline = [_geo(0, 0), _geo(0, 4), _geo(2, 4), _geo(2, 0), _geo(0, 0)]
    part = [_geo(0, 0), _geo(0, 2), _geo(2, 2), _geo(2, 0), _geo(0, 0)]
    relation = {"type": "relation", "tags": {"type": "building", "building": "yes"}, "members": [
        {"role": "outline", "geometry": outline}, {"role": "part", "geometry": part},
    ]}
    assert _rings(relation) == ([outline], [])
    part_only = {**relation, "members": [{"role": "part", "geometry": part}]}
    assert _rings(part_only) == ([], [])


def test_a_hillside_building_floor_sits_below_its_lowest_edge():
    from scipy.spatial import cKDTree
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=600.0)
    road_y = np.zeros(len(res.P))
    dem = FakeDem(res.frame, lambda x, z: 0.1 * x + 0.02 * z)
    poly = Polygon([(100, 30), (220, 30), (220, 50), (100, 50)])
    tree = cKDTree(res.P[:, [0, 2]])
    base = _building_base(res, road_y, dem, poly, tree)
    edge = np.asarray(poly.exterior.coords)
    lat, lon = res.frame.to_latlon(edge[:, 0], edge[:, 1])
    assert base <= dem.heights(lat, lon).min() + 1e-6
    mesh = extrude(poly, base, 35.0)
    assert mesh.positions[:, 1].min() < dem.heights(lat, lon).min()


@pytest.mark.parametrize("style", ["shared", "local"])
def test_build_buildings_connects_hillside_base_to_mesh_and_collider(monkeypatch, style):
    from scipy.spatial import cKDTree
    import sr.buildings as buildings
    import sr.local_style as local_style
    from tests.test_terrain import FakeDem, straight_route

    if style == "shared":
        monkeypatch.setattr(local_style, "types", lambda route: [])
    else:
        monkeypatch.setattr(local_style, "types", lambda route: [{
            "slot": "a", "storeys": [3, 3], "storeyM": 3.0, "groundM": 4.0, "roof": {"kind": "flat"}}])

    res = straight_route(length=600.0)
    road_y = np.zeros(len(res.P))
    dem = FakeDem(res.frame, lambda x, z: 0.1 * x + 0.02 * z)
    poly = Polygon([(100, 30), (220, 30), (220, 50), (100, 50)])
    monkeypatch.setattr(buildings, "footprints", lambda *args, **kwargs: [(poly, {"building": "yes"})])
    monkeypatch.setattr(buildings, "landmark_footprints", lambda *args, **kwargs: [])
    corridor = Polygon([(-50, -200), (650, -200), (650, 300), (-50, 300)])
    road_clear = Polygon([(-50, -10), (650, -10), (650, 10), (-50, 10)])
    by_facade, boxes = buildings.build_buildings(
        res, road_y, dem, "beijing", corridor, keep_clear=road_clear)

    edge = np.asarray(poly.exterior.coords)
    ground = buildings.ground_height(res, road_y, dem, edge, cKDTree(res.P[:, [0, 2]]))
    lowest = min(float(m.positions[:, 1].min()) for m in by_facade.values())
    highest = max(float(m.positions[:, 1].max()) for m in by_facade.values())
    assert lowest <= ground.min() - buildings.SINK + 1e-6
    assert len(boxes) == 1
    _, cy, _, _, hy, _, _ = boxes[0]
    assert cy - hy == pytest.approx(lowest)
    assert cy + hy == pytest.approx(highest)


def test_visual_boxes_include_buildings_too_far_away_to_need_collision(monkeypatch):
    import sr.buildings as buildings
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=600.0)
    poly = Polygon([(100, 30), (220, 30), (220, 50), (100, 50)])
    monkeypatch.setattr(buildings, "footprints", lambda *args, **kwargs: [(poly, {"building": "yes"})])
    monkeypatch.setattr(buildings, "landmark_footprints", lambda *args, **kwargs: [])
    corridor = Polygon([(-50, -200), (650, -200), (650, 300), (-50, 300)])
    by_facade, colliders, visual = buildings.build_buildings(
        res, np.zeros(len(res.P)), FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x))),
        "beijing", corridor, collider_radius=1.0, return_visual_boxes=True,
    )
    assert by_facade
    assert colliders == []
    assert len(visual) == 1


@pytest.mark.skipif(not os.path.exists(os.path.join(os.path.dirname(SR_DIR), "cache")),
                    reason="needs cached OSM extracts")
def test_every_cached_split_building_relation_emits_only_closed_rings():
    from sr.fetch_osm import load_layer
    from sr.routes import all_route_ids

    split_members = 0
    for route_id in all_route_ids():
        for element in load_layer(route_id, "buildings").get("elements", []):
            if element.get("type") != "relation":
                continue
            raw = [member.get("geometry") or [] for member in element.get("members", [])]
            split_members += sum(len(ring) >= 2 and ring[0] != ring[-1] for ring in raw)
            outer, inner = _rings(element)
            assert all(ring[0] == ring[-1] for ring in [*outer, *inner])
    assert split_members > 0, "the real cache must exercise split relation members"

    # Verified by direct inspection of the real cache (no goldengate/fishermans-wharf cache exists any
    # more): pipeline/cache/new-york's buildings layer has relation 2848024, the Staten Island Ferry
    # Whitehall Terminal, with ten `part` members and no `outline` -- the same shape as the old "50
    # Golden Gate structure parts".
    terminal = next(element for element in load_layer("new-york", "buildings")["elements"]
                    if element.get("id") == 2848024)
    assert _rings(terminal) == ([], []), "10 Whitehall Terminal structure parts are not 10 generic buildings"
    # pipeline/cache/giza's buildings layer has relation 7728526, the Great Sphinx, with one `outline`
    # member and three `part` members -- the same shape as the old Fisherman's Wharf relation.
    sphinx = next(element for element in load_layer("giza", "buildings")["elements"]
                 if element.get("id") == 7728526)
    outer, inner = _rings(sphinx)
    assert len(outer) == 1 and not inner, "the outline owns the Sphinx; its parts must not duplicate it"


def test_wall_u_is_metres_walked_along_the_footprint():
    """The window pattern is laid out from uv.x, so uv.x has to be arc length along the wall and
    not a projection onto a world axis. A wall at 45 degrees projects a 3 m column spacing to
    4.24 m, which is what made campus facades read at a different scale from street ones."""
    # a right triangle: legs on the axes, hypotenuse at 45 degrees
    poly = Polygon([(0, 0), (10, 0), (10, 10)])
    mesh = extrude(poly, base=0.0, top=12.0)
    pos, uv = _wall_verts(mesh)

    # every wall quad spans exactly its own edge length in metres of u, whatever its angle
    for i in range(0, len(pos), 4):
        span = (uv[i + 1, 0] - uv[i, 0]) * UV_SCALE
        edge = float(np.hypot(pos[i + 1, 0] - pos[i, 0], pos[i + 1, 2] - pos[i, 2]))
        assert span == 0.0 or abs(span - edge) < 1e-9, f"quad {i // 4} spans {span} m of u over {edge} m of wall"

    # and the 45 degree hypotenuse gets the same metres-per-u as the axis-aligned legs
    lengths = {round(float(np.hypot(pos[i + 1, 0] - pos[i, 0], pos[i + 1, 2] - pos[i, 2])), 6)
               for i in range(0, len(pos), 4)}
    assert round(10 * np.sqrt(2), 6) in lengths, "the hypotenuse should be one wall quad"


def test_u_is_continuous_around_a_corner():
    """Neighbouring walls share a corner. If u restarted at each edge the column at every corner
    would be a stripe of the wrong width."""
    poly = Polygon([(0, 0), (20, 0), (20, 7), (0, 7)])
    mesh = extrude(poly, base=0.0, top=9.0)
    _, uv = _wall_verts(mesh)
    for i in range(0, len(uv) - 4, 4):
        assert abs(uv[i + 4, 0] - uv[i + 1, 0]) < 1e-9, "u should carry over from one wall to the next"


def test_v_is_height_above_the_building_and_not_above_sea_level():
    """Floor lines and the shopfront band are drawn from uv.y. Measured from absolute world height
    they drift against any building on a hill -- dubai's spline sits at 0.1-3.9 m, rio's mountain
    climb far higher at 470.8-609.1 m (both measured from game/public/tracks/<id>/track.json) -- and
    the pavement band ends up underground."""
    poly = Polygon([(0, 0), (12, 0), (12, 8), (0, 8)])
    low = extrude(poly, base=0.0, top=15.0)
    high = extrude(poly, base=240.0, top=255.0)
    assert np.allclose(low.uvs, high.uvs), "the same building 240 m up should get the same uvs"

    pos, uv = _wall_verts(low)
    top = pos[:, 1] > 1.0
    assert np.allclose(uv[top, 1] * UV_SCALE, 15.0), "v at the roofline should be the building's height"


def test_a_box_measures_its_walls_in_the_same_units():
    """The distant skyline and the landmark shells are boxes, not extrusions, and they share the
    building material and therefore the shader. Their uv has to mean metres/uv_scale too."""
    mesh = box((0.0, 10.0, 0.0), (6.0, 10.0, 4.0), uv_scale=UV_SCALE)
    side = np.abs(mesh.normals[:, 1]) < 1e-6
    uv = mesh.uvs[side]
    spans = {round(float(v), 6) for v in np.unique(uv[:, 0]) if v > 0}
    assert spans == {round(12.0 / UV_SCALE, 6), round(8.0 / UV_SCALE, 6)}, \
        "u should span the face width in metres/uv_scale"
    assert round(float(uv[:, 1].max()), 6) == round(20.0 / UV_SCALE, 6), \
        "v should span the box height in metres/uv_scale"


def test_the_contract_owns_the_facade_uv_scale():
    """The runtime draws windows straight onto these uvs and reads the shopfront band off them in
    absolute metres, so the number lives in docs/CONTRACT.md and both sides read it back."""
    doc = open(CONTRACT, encoding="utf-8").read()
    m = re.search(r"facade_uv_metres = ([0-9.]+)", doc)
    assert m, "docs/CONTRACT.md no longer states facade_uv_metres"
    assert float(m.group(1)) == BUILDING_UV_METRES


def test_nothing_gives_building_geometry_a_scale_of_its_own():
    """The distant skyline passed 6.0 and the landmark shells 4.0/6.0. Windows are drawn from uv,
    so those walls got windows of their own size -- and the 3-4.2 m shopfront band grew with them
    until it covered whole buildings: the Whitehall Terminal's 15 m hull (new-york's real cache,
    way/relation 2848024, height=15) spans only 2.5 uv at scale 6."""
    offenders = []
    for name in sorted(os.listdir(SR_DIR)):
        if not name.endswith(".py"):
            continue
        tree = ast.parse(open(os.path.join(SR_DIR, name), encoding="utf-8").read(), name)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or getattr(node.func, "id", None) not in ("box", "extrude"):
                continue
            kw = {k.arg: k.value for k in node.keywords}
            material = kw.get("material")
            is_building = material is None or (
                isinstance(material, ast.Constant) and material.value == "building") or (
                isinstance(material, ast.Name) and material.id == "MATERIAL_WALL")
            if is_building and "uv_scale" in kw:
                offenders.append(f"{name}:{node.lineno}")
    assert not offenders, f"building geometry with a uv_scale of its own: {offenders}"


def test_the_contract_owns_the_road_lift():
    """The runtime puts the start/finish line on the road from a checkpoint's y, and a checkpoint's
    y is the spline, not the asphalt. Three centimetres of clearance buried the line inside the
    road: it rendered nothing while being in the scene, visible and correctly lit."""
    from sr.roads import ROAD_LIFT
    doc = open(CONTRACT, encoding="utf-8").read()
    m = re.search(r"road_lift_m = ([0-9.]+)", doc)
    assert m, "docs/CONTRACT.md no longer states road_lift_m"
    assert float(m.group(1)) == ROAD_LIFT


def test_every_facade_a_footprint_can_get_is_a_material_the_contract_knows():
    """`FACADE` names materials, and a name the runtime has never heard of renders magenta.

    Nothing else checks this: the pipeline is happy to write any string into a GLB, and the tile
    loader reports the unknown name once and then draws the whole building bright pink.
    """
    from sr.buildings import DEFAULT_FACADE, FACADE, facade_for
    from sr.export import MATERIALS
    assert set(FACADE.values()) | {DEFAULT_FACADE} <= set(MATERIALS)
    assert facade_for({"building": "office"}) == "building_glass"
    assert facade_for({"building": "OFFICE"}) == "building_glass", "tags are not case-normalised upstream"
    assert facade_for({"building": "yes"}) == DEFAULT_FACADE
    assert facade_for({}) == DEFAULT_FACADE


def test_a_footprint_wears_its_facade_all_the_way_into_the_mesh():
    """The material has to travel with the geometry, not just be decided and dropped."""
    from shapely.geometry import Polygon
    from sr.buildings import extrude, facade_for
    poly = Polygon([(0, 0), (10, 0), (10, 8), (0, 8)])
    mesh = extrude(poly, 0.0, 12.0, material=facade_for({"building": "parking"}))
    assert mesh.material == "building_parking"


def test_the_five_facades_are_told_apart_by_something_a_street_actually_has():
    """A guard against the mapping collapsing to one kind: the tags any city corridor is full of
    have to land on more than one facade, or the split bought nothing."""
    from sr.buildings import facade_for
    tags = ["office", "house", "school", "warehouse", "parking", "apartments", "retail"]
    assert len({facade_for({"building": t}) for t in tags}) >= 5


def test_the_untagged_majority_gets_a_facade_too():
    """`building=yes` is not an edge case, it is most of the map: 338 of beijing's 382 footprints,
    4792 of fuji's 4821, 666 of lhasa's 668. Mapping only the tags that say something left 76.9% of
    every wall in the game on the untextured fallback -- whole city blocks still the one beige with
    one window grid, which is the thing this was meant to end."""
    from collections import Counter
    from sr.buildings import DEFAULT_FACADE, facade_for

    def spread(area, storeys):
        """One shape, many positions: what that shape looks like along a street."""
        return Counter(facade_for({"building": "yes"}, area=area, storeys=storeys, at=(x * 13.0, 7.0))
                       for x in range(120))

    houses, towers, sheds = spread(120.0, 2.0), spread(3000.0, 12.0), spread(5000.0, 1.0)
    for got in (houses, towers, sheds):
        assert DEFAULT_FACADE not in got, "an untagged footprint still fell through to the fallback"
    # The position only picks within a shape's choices, so the shape still decides the character.
    assert houses.most_common(1)[0][0] == "building_stucco"
    assert towers.most_common(1)[0][0] == "building_glass"
    assert sheds.most_common(1)[0][0] == "building_metal"


def test_neighbours_do_not_all_come_out_the_same():
    """A street of identical blocks reads as wallpaper however good the texture is. The choice
    comes from the footprint's own position, so it is stable across builds and mixed along a road."""
    from sr.buildings import facade_for
    got = {facade_for({"building": "yes"}, area=120.0, storeys=2.0, at=(x * 17.0, 3.0))
           for x in range(40)}
    assert len(got) > 1, "every house on the street came out the same material"


def test_the_shape_rule_only_runs_when_the_tag_says_nothing():
    """A tagged use always wins: a `building=parking` of any size is a parking deck."""
    from sr.buildings import facade_for
    assert facade_for({"building": "parking"}, area=9000.0, storeys=1.0, at=(0.0, 0.0)) == "building_parking"
    assert facade_for({"building": "house"}, area=9000.0, storeys=9.0, at=(0.0, 0.0)) == "building_stucco"


def test_a_roof_samples_one_point_of_its_facade_rather_than_tiling_it():
    """A facade texture is a wall seen from the street and a roof's uvs are world x/z, so tiling
    the same image across a roof lays curtain wall -- or the slots of a parking deck -- flat on top
    of every building in the city. The runtime's window grid skipped anything facing up, but that
    rule is compiled out wherever a texture is present, so nothing was left to catch it."""
    from shapely.geometry import Polygon
    from sr.buildings import ROOF_UV, extrude
    mesh = extrude(Polygon([(0, 0), (20, 0), (20, 14), (0, 14)]), 0.0, 30.0,
                   material="building_glass")
    up = mesh.normals[:, 1] > 0.9
    assert up.sum() > 0, "this footprint does have a roof"
    assert np.allclose(mesh.uvs[up], ROOF_UV), "the roof is tiling the wall image"
    assert not np.allclose(mesh.uvs[~up], ROOF_UV), "and the walls still are not"


def test_every_pitched_roof_face_points_out_of_the_roof_392():
    """An inward gable end is culled from outside and shows the far gable's inside as a floating shard."""
    for kind in ("gable", "hip"):
        for yaw in (0.0, .4, 1.9):
            roof = pitched_roof((10, 8, 20), (9, 5), yaw=yaw, rise=2.5, kind=kind, material="house_roof_slate")
            tris = roof.positions[roof.indices.reshape(-1, 3)]
            centre = tris.reshape(-1, 3).mean(axis=0)
            for a, b, c in tris:
                normal = np.cross(b - a, c - a)
                assert np.dot(normal, (a + b + c) / 3 - centre) > 0, (kind, yaw)


def test_gable_ends_are_wall_coloured_and_the_slopes_stay_roofing_392():
    roof, ends = pitched_roof_parts((10, 8, 20), (9, 5), yaw=.4, rise=2.5, kind="gable",
                                    material="house_roof_slate", end_material="building_stucco")
    assert roof.material == "house_roof_slate" and ends.material == "building_stucco"
    assert np.all((np.abs(ends.normals[:, 1]) < 1e-6) | (ends.normals[:, 1] < -.999)), "the ends and the underside"
    assert np.all(roof.normals[:, 1] > .1), "the roof part holds only the slopes"
    assert np.allclose(ends.uvs, .02), "a wall texture sampled where it has no window"
    assert len(pitched_roof_parts((10, 8, 20), (9, 5), kind="hip", material="house_roof_slate",
                                  end_material="building_stucco")) == 1


def test_a_pitched_roof_is_a_closed_solid_so_an_overhang_never_shows_sky_392():
    """Every edge is shared by exactly two triangles walking it in opposite directions."""
    for kind in ("gable", "hip"):
        for half in ((9, 5), (5, 5), (4, 11)):
            parts = pitched_roof_parts((10, 8, 20), half, yaw=.7, rise=2.5, kind=kind,
                                       material="house_roof_slate", end_material="building_stucco")
            edges = {}
            for part in parts:
                for tri in part.indices.reshape(-1, 3):
                    keys = [tuple(np.round(part.positions[i], 6)) for i in tri]
                    if len(set(keys)) < 3:           # a square hip's ridge collapses to a point
                        continue
                    for a, b in zip(keys, keys[1:] + keys[:1]):
                        edges[(a, b)] = edges.get((a, b), 0) + 1
            for (a, b), count in edges.items():
                if a == b:
                    continue
                assert count == 1 and edges.get((b, a)) == 1, (kind, half, a, b)


def test_flattened_building_part_outlines_are_not_drawn_but_small_plain_buildings_are():
    from sr.buildings import flattened_outline
    assert flattened_outline({"building": "yes", "building:parts": "yes", "height": "0.01"})
    assert not flattened_outline({"building": "yes", "building:parts": "yes", "height": "13"})
    # A plain footprint with a stray tiny height is still a building (Twin Peaks' Lutheran church).
    assert not flattened_outline({"building": "yes", "height": "0.1"})


def test_the_harbour_bridge_pylons_are_not_windowed_buildings_in_the_strait():
    """The home page's orbit showed an office block standing on the south tower's pier.

    Sydney's Harbour Bridge North/South Pylons (the real cache: pipeline/cache/sydney buildings layer,
    way 156584774 and way 382401361) are OSM-tagged `building=yes` with height=89, so a bare
    `footprints()` scan does draw them into the generic building batch (verified directly). What must
    keep an office block from standing on a tower pier is the same landmark exclusion `build_buildings`
    applies to every route: the route's own `harbour-bridge` landmark footprint has to cover both
    pylons so neither ever reaches the batch."""
    from sr.buildings import footprints, landmark_footprints
    from sr.geo import LocalFrame
    from sr.routes import load_route
    route = load_route("sydney")
    frame = LocalFrame(route["origin"]["lat"], route["origin"]["lon"])
    pylon_ids = {"way:156584774", "way:382401361"}
    drawn = {tags["sr:facade-id"] for _, tags in footprints("sydney", frame)}
    assert drawn, "the real Sydney cache has buildings"
    assert pylon_ids <= drawn, "the real cache does tag both pylons as generic buildings"
    excluded = landmark_footprints(frame, names=route.get("landmarks"))
    assert excluded, "the harbour-bridge landmark must contribute an exclusion footprint"
    for poly, tags in footprints("sydney", frame):
        if tags["sr:facade-id"] in pylon_ids:
            assert any(shape.intersects(poly) for shape in excluded), tags["sr:facade-id"]


def _walled(monkeypatch, architecture):
    """One untagged block, one mapped wall and one named object, built under `architecture`."""
    import sr.buildings as buildings
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=600.0)
    block = Polygon([(90, 30), (120, 30), (120, 50), (90, 50)])
    wall = Polygon([(200, 30), (230, 30), (230, 31), (200, 31)])
    stand = Polygon([(300, 30), (320, 30), (320, 38), (300, 38)])
    monkeypatch.setattr(buildings, "footprints", lambda *a, **k: [
        (block, {"building": "yes", "sr:facade-id": "way:10"}),
        (wall, {"building": "wall", "height": "6", "sr:facade-id": "way:11"}),
        (stand, {"building": "yes", "height": "5", "sr:facade-id": "way:12"})])
    monkeypatch.setattr(buildings, "landmark_footprints", lambda *a, **k: [])
    monkeypatch.setattr("sr.vistas.choose_roof", lambda *a, **k: "gable")
    route = {"id": "test", "architecture": architecture} if architecture else {"id": "test"}
    monkeypatch.setattr("sr.routes.load_route", lambda route_id: route)
    corridor = Polygon([(-50, -100), (650, -100), (650, 100), (-50, 100)])
    road = Polygon([(-50, -10), (650, -10), (650, 10), (-50, 10)])
    by_material, _ = buildings.build_buildings(
        res, np.zeros(len(res.P)), FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x))), "test", corridor,
        keep_clear=road)
    return by_material


def test_a_route_that_declares_no_walls_builds_walls_as_ordinary_buildings(monkeypatch):
    got = _walled(monkeypatch, None)
    assert "house_wall_red" not in got
    walls = [m for m, mesh in got.items() if m.startswith("building") and (mesh.positions[:, 0] >= 199).any()]
    assert walls, sorted(got)


def test_a_routes_walls_and_named_objects_are_solid_windowless_walls(monkeypatch):
    """The first World Tour's: Beijing's vermilion palace walls and the reviewing stands
    either side of Tiananmen were drawn as beige blocks with windows."""
    got = _walled(monkeypatch, {"walls": "house_wall_red", "byId": {"way:12": "house_wall_red"},
                                "pitched": {"maxStoreys": 3, "share": 1.0, "kind": "hip",
                                            "roofMaterial": "house_roof_slate"}})
    red = got["house_wall_red"].positions
    assert (red[:, 0] >= 199).any() and (red[:, 0] >= 299).any(), "the wall and the named stand are both red"
    assert not (red[:, 0] < 150).any(), "the ordinary block is not"
    for name, mesh in got.items():
        if name != "house_wall_red":
            assert not (mesh.positions[:, 0] >= 199).any(), f"{name} on a wall: no roof, no porch, no windows"
    roofs = [mesh for name, mesh in got.items() if name.startswith("house_roof")]
    assert roofs, "the ordinary low block still takes the city's pitched roof"


@pytest.mark.parametrize("architecture", [{"walls": "building_glass"}, {"byId": {"way:1": "building_stucco"}}])
def test_a_wall_pinned_to_a_windowed_material_stops_the_build(monkeypatch, architecture):
    with pytest.raises(ValueError, match="a wall is one of"):
        _walled(monkeypatch, architecture)


def test_beijings_palace_walls_and_reviewing_stands_are_declared_walls():
    from sr.buildings import SOLID_WALLS, pinned_wall
    from sr.routes import load_route
    route = load_route("beijing")
    assert route.get("lowRise"), "the low-rise zones stay"
    for way in ("way:257208025", "way:257208026"):
        assert pinned_wall(route, {"building": "yes", "sr:facade-id": way}) in SOLID_WALLS
    assert pinned_wall(route, {"building": "wall", "sr:facade-id": "way:685274596"}) in SOLID_WALLS
    assert pinned_wall(route, {"building": "yes", "sr:facade-id": "way:1"}) is None


def test_buildings_mapped_underground_are_not_drawn(monkeypatch):
    # A basement mall mapped layer=-1 stood as a windowless block by Tiananmen Square (a player's
    # screenshot); 28 such outlines across the World Tour's cities.
    import sr.buildings as B
    from sr.buildings import underground
    assert underground({"building": "yes", "layer": "-1"})
    assert underground({"building": "yes", "location": "underground"})
    assert not underground({"building": "yes", "layer": "1"})
    assert not underground({"building": "yes"})

    class Frame:
        def to_local(self, lat, lon):
            return np.asarray(lon) * 1e5, np.asarray(lat) * 1e5

    def square(osm_id, **tags):
        ring = [(0, 0), (0, 3e-4), (3e-4, 3e-4), (3e-4, 0), (0, 0)]
        return {"type": "way", "id": osm_id, "tags": {"building": "yes", **tags},
                "geometry": [{"lat": a, "lon": b} for a, b in ring]}

    monkeypatch.setattr(B, "load_layer", lambda route, layer: {"elements": [
        square(1), square(2, layer="-1"), square(3, location="underground")]})
    ids = [tags["sr:facade-id"] for _, tags in B.footprints("any", Frame())]
    assert ids == ["way:1"]


@pytest.mark.parametrize("route_id", ["paris", "shanghai"])
def test_far_town_uses_the_route_palette_and_roofscape(monkeypatch, route_id):
    """The far low-rise town is built in the route's own walls and roofs, not one pale flat box."""
    from dataclasses import replace
    import sr.vistas as vistas
    from sr.routes import load_route
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=2000.0)
    dem = FakeDem(res.frame, lambda x, z: np.full(np.shape(x), 10.0))
    p = replace(vistas.profile(route_id), density=1, near_m=0, far_m=5000, height_m=(10, 16))
    monkeypatch.setattr(vistas, "profile", lambda _: p)
    grid = np.array([[x, z] for x in range(100, 1900, 90) for z in (300, 450)], float)
    monkeypatch.setattr(vistas, "_candidate_grid", lambda *args: grid)
    monkeypatch.setattr(vistas, "settlement_mask", lambda route, lat, lon: np.ones(len(lat), bool))
    meshes, stats = vistas.city_massing(res, dem, route_id)
    arch = load_route(route_id)["architecture"]
    walls = {name for name in meshes if name.startswith("building_")}
    assert stats["buildings"] >= 30
    if arch.get("local"):
        # a city with its own style builds its far town in it (sr/local_style.py far_style); where
        # none of its types applies (outside a type's `within` circles) the shared palette stays
        assert walls and all(w.startswith("building_local_wall_") or w in set(arch.get("facades") or ())
                             for w in walls), walls
        return
    assert walls <= set(arch["facades"]) and len(walls) >= 2, walls
    pitched = arch.get("pitched")
    if pitched:
        assert stats["roofs"][pitched["kind"]] > .6 * stats["buildings"], stats["roofs"]
        assert pitched["roofMaterial"] in meshes
