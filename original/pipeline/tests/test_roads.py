import os

import numpy as np
import pytest
from shapely.geometry import Polygon

from sr.buildings import box_polygon, decompose_boxes, estimate_height, extrude, oriented_box, parse_height
from sr.fetch_osm import CACHE_DIR
from sr.roads import (BARRIER_DISTANCE, _densify, barrier_mesh, junction_layout, race_ribbons,
                      side_half_width)
from sr.route import RoadWay
from sr.routes import all_route_ids, load_route
from tests.test_terrain import straight_route

HAS_CACHE = os.path.exists(os.path.join(CACHE_DIR, "goldengate", "roads.json.gz"))
P2P_ROUTE_IDS = tuple(route_id for route_id in all_route_ids() if load_route(route_id)["mode"] == "p2p")


def _way(highway, lanes):
    return RoadWay(1, highway, "", [1, 2], np.array([[0.0, 0.0], [10.0, 0.0]]), lanes, False, False, False, 0)


def test_side_half_width_by_class():
    assert side_half_width(_way("motorway", 4)) == pytest.approx(7.2)
    assert side_half_width(_way("service", 1)) == pytest.approx(2.0)   # clamped up from 1.8
    assert side_half_width(_way("residential", 2)) == pytest.approx(3.6)


def test_densify_keeps_ends_and_spacing():
    out = _densify([[0, 0], [30, 0]], 4.0)
    assert np.allclose(out[0], [0, 0]) and np.allclose(out[-1], [30, 0])
    assert np.diff(out[:, 0]).max() <= 4.0 + 1e-9


def test_race_ribbon_splits_at_the_bridge():
    res = straight_route(length=600.0, bridge_span=(200.0, 400.0))
    road_y = np.full(len(res.P), 12.0)
    parts = race_ribbons(res, road_y)
    assert set(parts) == {"road", "bridge"}
    assert parts["bridge"].material == "bridge"
    # the bridge ribbon covers only the span, with a couple of meters of tolerance at each end
    xs = parts["bridge"].positions[:, 0]
    assert 195 <= xs.min() <= 205 and 395 <= xs.max() <= 405


def test_climbing_hairpin_is_tessellated_across_its_width():
    """A climbing turn is a smooth twisted surface, not two full-width collider facets.

    The old ribbon put one diagonal across the entire twelve-metre road. Its two triangles met at
    a visible and physical ridge; every wheel crossing that diagonal changed ground normal at once.
    Race ribbons divide the same outline into sub-metre cells, so adjoining faces turn gradually.
    """
    angle = np.linspace(0, np.pi, 17)
    centre = np.stack([8 * np.cos(angle), np.linspace(0, 6, len(angle)),
                       8 * np.sin(angle)], axis=1)
    tangent = np.gradient(centre, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    right = np.stack([-tangent[:, 2], np.zeros(len(angle)), tangent[:, 0]], axis=1)
    res = straight_route(length=32.0, half_width=6.0)
    res.P, res.R = centre, right
    res.S = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(centre, axis=0), axis=1))])
    res.half_width = np.full(len(centre), 6.0)
    res.bridge = np.zeros(len(centre), dtype=bool)

    road = race_ribbons(res, centre[:, 1])["road"]
    top_faces = 2 * (len(centre) - 1) * 16  # sixteen 0.75-metre cells across the road
    triangles = road.positions[road.indices.reshape(-1, 3)[:top_faces]]
    normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    paired = np.sum(normals[0::2] * normals[1::2], axis=1)

    assert top_faces == 512
    assert paired.min() > 0.98, "adjacent road faces still form a suspension-jolting ridge"


def test_barrier_model_is_a_k_rail():
    m = barrier_mesh()
    lo, hi = m.bounds()
    assert m.material == "barrier"
    assert np.allclose(hi - lo, [2.2, 0.9, 0.5])


def test_junction_layout_is_the_shared_source_for_paint_and_barriers(monkeypatch):
    from sr import roads

    res = straight_route(length=120.0, half_width=7.0)
    crossing = RoadWay(2, "residential", "", [1, 2],
                       np.array([[60.0, -60.0], [60.0, 60.0]]), 2, False, False, False, 0)
    parallel = RoadWay(3, "residential", "", [3, 4],
                       np.array([[0.0, 40.0], [120.0, 40.0]]), 2, False, False, False, 0)
    monkeypatch.setattr(roads, "load_ways", lambda route_id, frame: [crossing, parallel])
    layout = junction_layout(res, "synthetic")
    assert len(layout.junctions) == 1
    assert abs(res.P[layout.junctions[0].route_index, 0] - 60.0) <= 2.0
    assert len(layout.barriers) >= 2, "the closure arms remain available to barrier_lines"


def test_junction_layout_checks_each_osm_level_signal_independently(monkeypatch):
    from sr import roads

    res = straight_route(length=120.0, half_width=7.0)
    mismatched = [
        RoadWay(2, "residential", "", [1, 2],
                np.array([[30.0, -60.0], [30.0, 60.0]]), 2, False, False, False, 1),
        RoadWay(3, "residential", "", [3, 4],
                np.array([[50.0, -60.0], [50.0, 60.0]]), 2, False, True, False, 0),
        RoadWay(4, "residential", "", [5, 6],
                np.array([[70.0, -60.0], [70.0, 60.0]]), 2, False, False, True, 0),
    ]
    same_level = RoadWay(5, "residential", "", [7, 8],
                         np.array([[100.0, -60.0], [100.0, 60.0]]),
                         2, False, False, False, 0)
    monkeypatch.setattr(roads, "load_ways", lambda route_id, frame: [*mismatched, same_level])
    layout = junction_layout(res, "synthetic")
    assert len(layout.junctions) == 1
    assert abs(res.P[layout.junctions[0].route_index, 0] - 100.0) <= 2.0
    assert len(layout.barriers) == 2


def test_height_tags_beat_estimates():
    assert parse_height({"height": "32 m"}) == 32.0
    assert parse_height({"height": "105'"}) == pytest.approx(32.004)
    assert parse_height({"height": "326", "building:levels": "61"}) == 326.0
    assert parse_height({"building:levels": "12"}) == 42.0
    assert parse_height({"height": "unknown"}) is None
    assert parse_height({}) is None
    assert estimate_height({"building": "house"}, 120) == pytest.approx(7.0)
    assert estimate_height({"building": "office"}, 900) == pytest.approx(14.0)
    assert estimate_height({"building": "yes"}, 5000) == pytest.approx(17.5)


def test_extrude_encloses_the_footprint():
    poly = Polygon([(0, 0), (10, 0), (10, 6), (0, 6)])
    m = extrude(poly, base=5.0, top=17.0)
    lo, hi = m.bounds()
    assert lo[1] < 5.0 and abs(hi[1] - 17.0) < 1e-6      # walls continue below ground
    assert abs(lo[0]) < 1e-6 and abs(hi[0] - 10.0) < 1e-6
    assert m.triangle_count >= 4 * 2 + 2                 # four walls and a roof


def test_oriented_box_lands_back_on_its_own_footprint():
    """The yaw has to be the engine's, not merely some angle: a quarter turn out and a long
    building lies across the street instead of along it."""
    c, s = np.cos(0.4), np.sin(0.4)
    ring = [(x * c - z * s, x * s + z * c) for x, z in [(-10, -3), (10, -3), (10, 3), (-10, 3)]]
    poly = Polygon(ring)
    (cx, cy, cz), (hx, hy, hz), yaw = oriented_box(poly, 0.0, 20.0)
    assert abs(hx - 10) < 1e-6 and abs(hz - 3) < 1e-6 and abs(hy - 10) < 1e-6
    assert abs(cx) < 1e-6 and abs(cz) < 1e-6 and abs(cy - 10) < 1e-6
    rebuilt = box_polygon(cx, cz, hx, hz, yaw)
    assert rebuilt.intersection(poly).area / poly.area > 0.999


def test_decomposed_boxes_stay_inside_an_l_shaped_footprint():
    poly = Polygon([(0, 0), (30, 0), (30, 8), (8, 8), (8, 26), (0, 26)])
    boxes = decompose_boxes(poly, 0.0, 10.0)
    assert boxes, "an L shape is exactly the case a single bounding box gets wrong"
    grown = poly.buffer(0.5)
    for b in boxes:
        assert grown.contains(box_polygon(b[0], b[2], b[3], b[5], b[6]).buffer(-0.01))
    covered = sum(box_polygon(b[0], b[2], b[3], b[5], b[6]).area for b in boxes)
    assert covered > poly.area * 0.35   # conservative on purpose: cells on the edge are dropped


@pytest.mark.skipif(not HAS_CACHE, reason="no cache")
def test_goldengate_roads_and_buildings():
    from sr.buildings import build_buildings
    from sr.dem import DemSampler
    from sr.roads import barrier_lines, side_roads
    from sr.route import build_route
    from sr.routes import load_route
    from sr.terrain import corridor_polygon, road_profile

    route = load_route("goldengate"); res = build_route("goldengate"); dem = DemSampler()
    y = road_profile(res, dem, route["bridgeDeckM"], route["bridgeMinLengthM"])
    parts = race_ribbons(res, y)
    assert parts["road"].triangle_count > 2000 and parts["bridge"].triangle_count > 2000

    sides, _paint = side_roads(res, y, dem, "goldengate")
    assert sides.triangle_count > 5000

    barriers = barrier_lines(res, y, dem, "goldengate")
    assert 40 < len(barriers) < 2000
    pts = np.array([p for p, _ in barriers])
    from scipy.spatial import cKDTree
    d = cKDTree(res.P[:, [0, 2]]).query(pts[:, [0, 2]])[0]
    assert d.min() > BARRIER_DISTANCE * 0.5, "a barrier must never sit on the race surface"

    by_facade, boxes = build_buildings(res, y, dem, "goldengate", corridor_polygon(res))
    # One mesh per facade material since; the count below is the whole street, as before.
    assert len(by_facade) > 1, "a real corridor has more than one kind of facade on it"
    assert sum(m.triangle_count for m in by_facade.values()) > 2_500 and 20 < len(boxes) < 1000
    for cx, cy, cz, hx, hy, hz, yaw in boxes:
        assert hx > 0 and hy > 0 and hz > 0


@pytest.mark.skipif(not HAS_CACHE, reason="no cache")
def test_fort_point_is_not_clipped_by_the_bridge_above_it():
    """The Golden Gate crosses Fort Point in plan but sits about fifty metres above its roof."""
    from shapely.ops import unary_union

    from sr.buildings import footprint_by_osm_id, road_footprint
    from sr.clearance import surface
    from sr.dem import DemSampler
    from sr.roads import side_roads
    from sr.route import build_route
    from sr.routes import load_route
    from sr.terrain import road_profile

    res = build_route("goldengate")
    route = load_route("goldengate")
    dem = DemSampler()
    road_y = road_profile(res, dem, route["bridgeDeckM"], route["bridgeMinLengthM"])
    sides, _paint = side_roads(res, road_y, dem, "goldengate")
    fort, tags = footprint_by_osm_id("goldengate", res.frame, 5504536)
    assert tags["name"] == "Fort Point"
    full_road = road_footprint(res)
    # This is the exact production denominator passed by sr.build: ground-level race surface plus
    # all visible side streets. A helper-only default would not protect the exported track.
    building_clear = unary_union([
        road_footprint(res, include_bridges=False), surface(sides),
    ])
    assert fort.intersection(full_road).area > fort.area * .35, \
        "fixture must still reproduce the plan-view overlap that deleted the fort"
    assert fort.intersection(building_clear).area < fort.area * .01, \
        "an overhead bridge must not erase the complete building below it"


@pytest.mark.skipif(not HAS_CACHE, reason="no cache")
def test_no_building_collider_reaches_the_road():
    """A bounding box wide enough to cross the street stops the car dead, so none may."""
    import numpy as np
    from shapely.geometry import LineString

    from sr.buildings import box_polygon, build_buildings
    from sr.dem import DemSampler
    from sr.route import build_route
    from sr.routes import load_route
    from sr.terrain import corridor_polygon, road_profile

    route = load_route("goldengate")
    res = build_route("goldengate")
    dem = DemSampler()
    y = road_profile(res, dem, route["bridgeDeckM"], route["bridgeMinLengthM"])
    res.P[:, 1] = y
    _, boxes = build_buildings(res, y, dem, "goldengate", corridor_polygon(res))
    # Checked against the road's own width at the nearest point rather than against the polygon the
    # builder filters with, so that this stays a statement about the geometry and not a restatement
    # of the filter.
    from scipy.spatial import cKDTree
    tree = cKDTree(res.P[:, [0, 2]])
    intruding = []
    bridge = np.asarray(res.bridge, dtype=bool)
    for b in boxes:
        corners = np.array(box_polygon(b[0], b[2], b[3], b[5], b[6]).exterior.coords)
        d, idx = tree.query(corners)
        # A building under an elevated deck (Fort Point, 67 m below the Golden Gate's road)
        # shares its plan position but not its height. The car can only hit a box whose top reaches
        # the deck, so under a bridge the height decides.
        top = b[1] + b[4]
        reaches = (d < res.half_width[idx]) & ~(bridge[idx] & (top + 3.0 < y[idx]))
        if reaches.any():
            intruding.append(b)
    assert not intruding, f"{len(intruding)} building colliders reach the racing surface"
    assert len(boxes) > 25


@pytest.mark.parametrize("route_id", P2P_ROUTE_IDS)
def test_guardrail_stands_just_outside_the_road_and_keeps_only_the_end_caps_open(route_id):
    """The rail is what stops running wide from meaning falling off the world, so it has to be
    continuous and outside the drivable width. The route stays open forwards and backwards, but a
    vehicle must not fit sideways between the timing line and the first roadside rail."""
    import numpy as np
    from scipy.spatial import cKDTree

    from sr.roads import RAIL_END_SEAM, RAIL_HEIGHT, RAIL_OFFSET, guardrails, rail_paths
    from sr.route import build_route

    res = build_route(route_id)
    road_y = np.zeros(len(res.P))
    rail = guardrails(res, road_y)
    assert rail is not None and rail.triangle_count > 1000

    v = rail.positions
    assert np.isclose(v[:, 1].max() - v[:, 1].min(), RAIL_HEIGHT, atol=1e-6)

    tree = cKDTree(res.P[:, [0, 2]])
    d, idx = tree.query(v[:, [0, 2]])
    # never on the road, never far from it
    from shapely.geometry import MultiPoint
    from sr.clearance import surface
    from sr.mesh import ribbon
    # A nearest-sample circle is not the varying-width ribbon. Clipped beam endpoints can
    # be outside the real tarmac yet inside that circle; check the actual surface owner.
    road = surface(ribbon(res.P, res.R, res.half_width, closed=res.closed))
    assert not road.intersects(MultiPoint(v[:, [0, 2]])), "guardrail crosses the drivable surface"
    assert road.buffer(RAIL_OFFSET + 0.6).covers(MultiPoint(v[:, [0, 2]])), "guardrail drifts away from the edge"

    # Both side rails reach each timing line. Nothing projects behind the start or beyond the
    # finish, because those transverse caps would seal the public road in the direction of travel.
    s_of_rail = res.S[idx]
    assert s_of_rail.min() < 1.0
    assert s_of_rail.max() > res.S[-1] - 1.0
    points = np.concatenate(rail_paths(res))
    _, point_idx = tree.query(points)
    station = res.S[point_idx]
    start_points = points[station < 2.0]
    end_points = points[station > res.length - 2.0]
    assert len(start_points) >= 2 and len(end_points) >= 2
    start_relative = start_points - res.P[0, [0, 2]]
    end_relative = end_points - res.P[-1, [0, 2]]
    start_along = start_relative @ res.T[0, [0, 2]]
    end_along = end_relative @ res.T[-1, [0, 2]]
    assert start_along.min() >= -RAIL_END_SEAM - .01
    assert end_along.max() <= RAIL_END_SEAM + .01
    near_start = start_relative[start_along < 1.0] @ res.R[0, [0, 2]]
    near_end = end_relative[end_along > -1.0] @ res.R[-1, [0, 2]]
    assert near_start.min() < -res.half_width[0] and near_start.max() > res.half_width[0]
    assert near_end.min() < -res.half_width[-1] and near_end.max() > res.half_width[-1]


def test_a_side_road_across_a_cross_slope_is_not_buried_in_the_hill():
    """Both edges take the ground height at their own position. Taking one height for the whole
    cross-section lays the street out flat, and on a hillside the uphill half ends up inside the
    hill: that buried thirty percent of every side road on Twin Peaks, by as much as 2.8 m."""
    import numpy as np

    from sr.mesh import ribbon
    from sr.terrain import ground_height
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=600.0)
    road_y = np.full(len(res.P), 20.0)
    # ground falling away steeply across the route: twenty percent, well beyond the road blend
    slope = FakeDem(res.frame, lambda x, z: 20.0 - np.clip(np.abs(z) - 20.0, 0, None) * 0.2 * np.sign(z))

    # a side road running parallel to the route, forty metres out on the falling side
    piece = np.stack([np.linspace(50, 550, 60), np.full(60, 40.0)], axis=1)
    T = np.tile(np.array([1.0, 0.0]), (60, 1))
    R = np.stack([T[:, 1], np.zeros(60), -T[:, 0]], axis=1)
    hw = np.full(60, 9.0)
    y = ground_height(res, road_y, slope, piece)
    P = np.stack([piece[:, 0], y, piece[:, 1]], axis=1)

    flat = ribbon(P, R, hw, y_offset=0.03, material="road")
    draped = ribbon(P, R, hw, y_offset=0.03, material="road", edge_y=[
        ground_height(res, road_y, slope, piece + R[:, [0, 2]] * side * hw[:, None])
        for side in (-1.0, 1.0)])

    def burial(mesh):
        v = mesh.positions
        ground = ground_height(res, road_y, slope, v[:, [0, 2]].astype(float))
        return float((ground - v[:, 1]).max())

    assert burial(flat) > 1.0, "the flat ribbon should be the buried one, or this test proves nothing"
    assert burial(draped) < 0.05, f"draped ribbon still buried by {burial(draped):.2f} m"


def test_the_guardrail_mesh_is_manifold_so_the_solver_can_answer_contacts_on_it():
    ""
    from collections import Counter

    import numpy as np

    from sr.mesh import wall

    base = np.array([[float(i) * 6.0, 0.0, float(i * i) * 0.05] for i in range(12)])
    m = wall(base, 0.7)
    tri = np.asarray(m.indices).reshape(-1, 3)
    edges = Counter()
    for a, b, c in tri:
        for u, v in ((a, b), (b, c), (c, a)):
            edges[(int(min(u, v)), int(max(u, v)))] += 1
    worst = max(edges.values())
    assert worst <= 2, f"an edge is shared by {worst} triangles; the rail mesh is not a surface"


def test_a_circuit_has_no_gap_in_the_tarmac_at_the_start_line():
    """Every surface here is generated from an open polyline.

    On a closed route that leaves a hole at exactly one place -- the seam where the last sample
    meets the first -- and that place is the start line, which is where the car spawns. The first
    campus circuit put the car over the hole, looking down through it at the scenery, and it read
    as the race starting on grass.

    Checking for triangles *near* the seam proves nothing: the ones either side of the gap are
    near it too. This asks the only question that matters -- is the seam covered.
    """
    import numpy as np

    from sr.roads import race_ribbons, sidewalks
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=400.0)
    n = len(res.P)
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    r = 120.0
    res.P = np.stack([r * np.cos(th), np.zeros(n), r * np.sin(th)], axis=1)
    res.S = np.linspace(0, 2 * np.pi * r, n, endpoint=False)
    res.T = np.stack([-np.sin(th), np.zeros(n), np.cos(th)], axis=1)
    res.R = np.stack([np.cos(th), np.zeros(n), np.sin(th)], axis=1)
    res.half_width = np.full(n, 6.0)
    res.closed = True
    road_y = np.zeros(n)

    def covers(mesh, pt):
        P = np.asarray(mesh.positions)[:, [0, 2]]
        tri = np.asarray(mesh.indices).reshape(-1, 3)
        a, b, c = P[tri[:, 0]], P[tri[:, 1]], P[tri[:, 2]]
        d = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
        d = np.where(np.abs(d) < 1e-12, 1e-12, d)
        l1 = ((b[:, 1] - c[:, 1]) * (pt[0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (pt[1] - c[:, 1])) / d
        l2 = ((c[:, 1] - a[:, 1]) * (pt[0] - c[:, 0]) + (a[:, 0] - c[:, 0]) * (pt[1] - c[:, 1])) / d
        return bool(((l1 >= -1e-9) & (l2 >= -1e-9) & (l1 + l2 <= 1 + 1e-9)).any())

    # the middle of the seam: halfway between the last sample and the first, on the centreline
    seam = (res.P[0][[0, 2]] + res.P[-1][[0, 2]]) / 2.0
    walk = sidewalks(res, road_y, FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x))))
    assert covers(race_ribbons(res, road_y)["road"], seam), "a hole in the tarmac at the start line"
    # and the pavement, a metre and a half out from the kerb on one side
    out = seam + res.R[0][[0, 2]] * (res.half_width[0] + 1.6)
    assert covers(walk, out), "a hole in the pavement at the start line"


def test_every_point_of_a_circuit_has_tarmac_under_it_including_the_corners():
    """The centreline is where the car is; the ribbon has to cover all of it.

    A ribbon is drawn by offsetting each sample sideways, and at a right-angle junction the inside
    edge crosses itself: the surface folds and the fold leaves the centreline uncovered. The campus
    circuit turns four square corners, and the one at the seam swallowed the spawn point.
    """
    import numpy as np

    from sr.roads import race_ribbons
    from tests.test_terrain import straight_route

    # a rounded rectangle: four right-angle corners, sampled every two metres like a real route
    def ring():
        w, h, r = 260.0, 160.0, 12.0
        pts = []
        for cx, cz, a0 in ((w - r, h - r, 0), (r, h - r, 90), (r, r, 180), (w - r, r, 270)):
            for k in range(9):
                t = np.radians(a0 + k * 90 / 8)
                pts.append((cx + r * np.cos(t), cz + r * np.sin(t)))
        pts = np.array(pts)
        out = [pts[0]]
        for p in np.vstack([pts[1:], pts[:1]]):
            d = np.linalg.norm(p - out[-1])
            for k in range(1, max(int(d / 2.0), 1) + 1):
                out.append(out[-1] + (p - out[-1]) * (k / max(int(d / 2.0), 1)))
        return np.array(out)

    xz = ring()
    n = len(xz)
    res = straight_route(length=400.0)
    res.P = np.stack([xz[:, 0], np.zeros(n), xz[:, 1]], axis=1)
    d = np.gradient(xz, axis=0)
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    res.T = np.stack([d[:, 0], np.zeros(n), d[:, 1]], axis=1)
    res.R = np.stack([-d[:, 1], np.zeros(n), d[:, 0]], axis=1)
    res.S = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(xz, axis=0), axis=1))])
    res.half_width = np.full(n, 6.0)
    res.bridge = np.zeros(n, dtype=bool)
    res.closed = True

    mesh = race_ribbons(res, np.zeros(n))["road"]
    P = np.asarray(mesh.positions)[:, [0, 2]]
    tri = np.asarray(mesh.indices).reshape(-1, 3)
    a, b, c = P[tri[:, 0]], P[tri[:, 1]], P[tri[:, 2]]
    den = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
    den = np.where(np.abs(den) < 1e-12, 1e-12, den)
    bare = []
    for i, pt in enumerate(xz):
        l1 = ((b[:, 1] - c[:, 1]) * (pt[0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (pt[1] - c[:, 1])) / den
        l2 = ((c[:, 1] - a[:, 1]) * (pt[0] - c[:, 0]) + (a[:, 0] - c[:, 0]) * (pt[1] - c[:, 1])) / den
        if not ((l1 >= -1e-9) & (l2 >= -1e-9) & (l1 + l2 <= 1 + 1e-9)).any():
            bare.append(i)
    assert not bare, f"{len(bare)} of {n} centreline points have no tarmac under them"


def test_no_building_is_drawn_standing_in_the_road():
    ""
    import numpy as np
    from scipy.spatial import cKDTree

    from sr.buildings import build_buildings
    from sr.dem import DemSampler
    from sr.route import build_route
    from sr.routes import load_route
    from sr.terrain import corridor_polygon, road_profile

    route = load_route("goldengate")
    res = build_route("goldengate")
    dem = DemSampler()
    y = road_profile(res, dem, route["bridgeDeckM"], route["bridgeMinLengthM"])
    res.P[:, 1] = y
    by_facade, _ = build_buildings(res, y, dem, "goldengate", corridor_polygon(res))
    P = np.concatenate([m.positions for m in by_facade.values()]) if by_facade else np.zeros((0, 3))
    assert len(P), "the route does have buildings; this test proves nothing without them"

    from sr.roads import WALK_INNER, WALK_WIDTH
    kerb = WALK_INNER + WALK_WIDTH          # the far edge of the pavement, beyond the guardrail

    tree = cKDTree(res.P[:, [0, 2]])
    d, idx = tree.query(P[:, [0, 2]])
    limit = res.half_width[idx] + kerb
    # A building under an elevated deck (Fort Point below the Golden Gate) is not standing
    # in the road; only what rises to within 3 m of the deck counts there.
    under_deck = np.asarray(res.bridge, dtype=bool)[idx] & (P[:, 1] + 3.0 < y[idx])
    over = (d < limit) & ~under_deck
    worst = float((limit - d)[over].max()) if over.any() else 0.0
    assert not over.any(), (f"{int(over.sum())} building vertices stand on the road or its pavement, "
                            f"the worst {worst:.1f} m inside the pavement's outer edge")


def test_a_courtyard_is_a_hole_and_not_a_filled_in_block():
    """OSM stores a building round a courtyard as a relation with an inner ring.

    Those rings were thrown away, so every such building came out as a solid slab the size of the
    whole block -- and a slab that size beside the road reads as a wall. Six of them in the Mountain
    View corridor alone.
    """
    import numpy as np
    from shapely.geometry import Polygon

    from sr.buildings import extrude

    shell = [(0, 0), (40, 0), (40, 40), (0, 40)]
    hole = [(10, 10), (30, 10), (30, 30), (10, 30)]
    court = extrude(Polygon(shell, [hole]), 0.0, 10.0)
    solid = extrude(Polygon(shell), 0.0, 10.0)
    assert court.triangle_count > solid.triangle_count, "the courtyard walls are missing"

    P = np.asarray(court.positions)
    inside = (P[:, 0] > 10.5) & (P[:, 0] < 29.5) & (P[:, 2] > 10.5) & (P[:, 2] < 29.5)
    assert not inside.any(), "the courtyard has been roofed over"
    on_hole = (P[:, 0] >= 9.5) & (P[:, 0] <= 30.5) & (P[:, 2] >= 9.5) & (P[:, 2] <= 30.5)
    assert on_hole.any(), "the courtyard has no walls facing into it"


def test_the_build_refuses_a_building_standing_on_the_racing_surface():
    """The guard the build itself runs, on its own.

    Every earlier version of this check looked at the footprints rather than at the geometry, and
    every earlier version passed while the game shipped walls across the road: between a footprint
    and a triangle there is a corridor filter, a clip, a per-tile split and a merge, and the bug was
    in the step that skipped the filter entirely. So the build asks the finished triangles, and this
    asks the same question of a case small enough to read.
    """
    import numpy as np

    from sr.buildings import extrude
    from sr.clearance import buildings_over_the_road
    from sr.mesh import ribbon
    from shapely.geometry import Polygon

    n = 40
    P = np.stack([np.linspace(0, 200, n), np.zeros(n), np.zeros(n)], axis=1)
    R = np.tile([0.0, 0.0, 1.0], (n, 1))
    road = ribbon(P, R, np.full(n, 6.0))

    clear = extrude(Polygon([(90, 12), (120, 12), (120, 40), (90, 40)]), 0.0, 10.0)
    assert buildings_over_the_road([road], clear) == [], "a building beside the road is not on it"

    across = extrude(Polygon([(90, -20), (120, -20), (120, 20), (90, 20)]), 0.0, 10.0)
    found = buildings_over_the_road([road], across)
    assert found, "a building straddling the road was not caught"
    assert found[0][0] > 100, f"the overlap should be most of a thirty metre block, got {found[0][0]:.0f} m2"


def test_a_clipped_roof_stays_inside_its_own_outline():
    """shapely's triangulate is a Delaunay of the vertices; it knows nothing about the edges.

    On a convex footprint that is the same answer. On one with the road bitten out of it, it makes
    triangles whose centroid is inside the shape and whose corner reaches across the notch -- and
    the notch is the road. The footprint filter was right and the roof hung over the road anyway,
    which the build's clearance check caught on Lombard after everything else had been fixed.
    """
    import numpy as np
    from shapely.geometry import Polygon

    from sr.buildings import extrude

    # a square with a bite taken out of one side, the shape a clipped building ends up as
    poly = Polygon([(0, 0), (30, 0), (30, 30), (0, 30)]).difference(
        Polygon([(10, -5), (20, -5), (20, 12), (10, 12)]))
    mesh = extrude(poly, 0.0, 8.0)
    P = np.asarray(mesh.positions)
    top = np.isclose(P[:, 1], 8.0)
    tri = np.asarray(mesh.indices).reshape(-1, 3)
    roof = [t for t in tri if top[t].all()]
    assert roof, "the roof is missing"
    outside = 0.0
    for t in roof:
        piece = Polygon(P[t][:, [0, 2]])
        if piece.is_valid:
            outside += piece.difference(poly).area
    assert outside < 0.25, f"{outside:.2f} m2 of roof hangs outside the footprint"


@pytest.mark.parametrize('closed', [False, True])
def test_bridge_material_transitions_cover_every_segment_once(closed):
    from sr.roads import race_ribbons
    from sr.clearance import surface
    from sr.mesh import ribbon

    res = straight_route(length=20)
    if closed:
        angle = np.linspace(0, 2 * np.pi, len(res.P), endpoint=False)
        res.P = np.column_stack([30 * np.cos(angle), np.zeros(len(angle)), 30 * np.sin(angle)])
        res.R = np.column_stack([np.cos(angle), np.zeros(len(angle)), np.sin(angle)])
        res.closed = True
    # A one-segment bridge plus another span reaching the circuit seam.
    res.bridge[2] = True
    res.bridge[-3:] = True
    meshes = race_ribbons(res, np.zeros(len(res.P)))
    actual = surface(*meshes.values())
    expected = surface(ribbon(res.P, res.R, res.half_width, closed=closed))
    assert actual.symmetric_difference(expected).area < 1e-5
    road, bridge = (surface(meshes[name]) for name in ('road', 'bridge'))
    assert road.intersection(bridge).area < 1e-5


def test_retired_hairpin_rails_do_not_cross_any_racing_surface():
    """The former 1718 m rail tip trapped the roof of a normally powered sports car."""
    import numpy as np
    from shapely.geometry import MultiPoint
    from sr.clearance import surface
    from sr.mesh import ribbon
    from sr.roads import guardrails
    import json
    from pathlib import Path
    from types import SimpleNamespace

    data = json.loads((Path(__file__).parent / "fixtures/retired-hairpin.json").read_text())
    right = np.asarray(data["right"])
    tangent = np.column_stack([-right[:, 2], np.zeros(len(right)), right[:, 0]])
    res = SimpleNamespace(route={}, P=np.asarray(data["points"]), T=tangent, R=right,
                          half_width=np.asarray(data["halfWidth"]), closed=False)
    rail = guardrails(res, np.zeros(len(res.P)))
    road = surface(ribbon(res.P, res.R, res.half_width, closed=res.closed))
    assert len(res.P) >= 390
    assert rail.triangle_count > 300
    intrusions = []
    for tri in np.asarray(rail.indices).reshape(-1, 3):
        footprint = MultiPoint(rail.positions[tri][:, [0, 2]]).convex_hull
        if footprint.intersects(road):
            intrusions.append(footprint.intersection(road))
    assert not intrusions, f"{len(intrusions)} rail/post faces intrude into the racing ribbon"


@pytest.mark.parametrize("route_id", ["goldengate", "twin-peaks", "lombard",
                                      "fishermans-wharf", "shoreline", "wolfe-pruneridge", "bayshore-101", "moffett-field"])
def test_dangerous_curve_boundary_has_no_missing_guardrail(route_id):
    from scipy.spatial import cKDTree
    from shapely.geometry import MultiPoint
    from shapely import points as geometry_points
    from shapely.strtree import STRtree
    from sr.clearance import surface
    from sr.mesh import ribbon
    from sr.roads import guardrails, RAIL_OFFSET
    from sr.route import build_route
    res = build_route(route_id)
    mesh = guardrails(res, np.zeros(len(res.P)))
    rail = STRtree([MultiPoint(mesh.positions[triangle][:, [0, 2]]).convex_hull
                       for triangle in mesh.indices.reshape(-1, 3)])
    road = surface(ribbon(res.P, res.R, res.half_width, closed=res.closed))
    # A sub-car-width crease closed by the safety offset is not an escape gap.
    boundary = road.buffer(RAIL_OFFSET, join_style=2, mitre_limit=2).boundary
    rings = [boundary] if boundary.geom_type == "LineString" else list(boundary.geoms)
    tree = cKDTree(res.P[:, [0, 2]])
    checked = 0
    for ring in rings:
        points = np.asarray(ring.segmentize(.5).coords)
        _, idx = tree.query(points)
        if not res.closed:
            points = points[(res.S[idx] >= 30) & (res.S[idx] <= res.length - 30)]
        checked += len(points)
        if len(points):
            _, distances = rail.query_nearest(geometry_points(points), return_distance=True, all_matches=False)
            assert len(distances) == len(points)
            assert distances.max() < .08, (route_id, distances.max())
    assert checked > 1000


def test_parallel_highway_deck_and_lane_lines_survive_race_widening(monkeypatch):
    from sr.route import RoadWay
    from sr.roads import side_roads, ROAD_LIFT, SIDE_LIFT
    from tests.test_terrain import FakeDem, straight_route
    res = straight_route(length=300, half_width=14, bridge_span=(0, 300))
    res.oneway[:] = True
    res.layer[:] = 1
    res.highway = ["motorway"] * len(res.P)
    res.P[:, 1] = 20
    dem = FakeDem(res.frame, lambda x, z: np.zeros_like(x))
    opposite = RoadWay(1, "motorway", "", [1, 2], np.array([[280., 13.], [20., 13.]]),
                       4, True, True, False, 1)
    monkeypatch.setattr("sr.roads.load_ways", lambda *_: [opposite])
    road, paint = side_roads(res, np.full(len(res.P), 20.), dem, "test")
    assert road.triangle_count > 100
    assert road.positions[:, 2].min() >= 15 - 1e-5, "the median must survive widened racing shoulders"
    middle = (road.positions[:, 0] > 100) & (road.positions[:, 0] < 200)
    assert np.allclose(road.positions[middle, 1], 20 + ROAD_LIFT)
    assert set(paint) == {"line_white", "line_yellow"}
    assert all(mesh.triangle_count > 10 for mesh in paint.values())
    assert all(np.allclose(mesh.positions[(mesh.positions[:, 0] > 100)
        & (mesh.positions[:, 0] < 200), 1], 20 + ROAD_LIFT + .02) for mesh in paint.values())
    # OSM bridge endpoints differ between directions. The environment bridge must still meet
    # each adjoining ground road without a seam, rather than dropping several metres at a tag.
    from sr.terrain import ground_height
    end = road.positions[[0, 1, -2, -1]]
    ground = ground_height(res, np.full(len(res.P), 20.), dem, end[:, [0, 2]])
    assert np.allclose(end[:, 1], ground + SIDE_LIFT)
    assert np.abs(np.diff(road.positions.reshape(-1, 2, 3)[:, :, 1], axis=0)).max() < 1
    first = RoadWay(2, "motorway", "", [1, 3], np.array([[280., 13.], [150., 13.]]),
                    4, True, True, False, 1)
    second = RoadWay(3, "motorway", "", [3, 2], np.array([[150., 13.], [20., 13.]]),
                     4, True, True, False, 1)
    monkeypatch.setattr("sr.roads.load_ways", lambda *_: [first, second])
    split, _ = side_roads(res, np.full(len(res.P), 20.), dem, "test")
    seam = split.positions[np.isclose(split.positions[:, 0], 150)]
    assert len(seam) == 4
    assert np.allclose(seam[:, 1], 20 + ROAD_LIFT), "an OSM way split is not a bridge abutment"
    monkeypatch.setattr("sr.roads.load_ways", lambda *_: [opposite])
    # A different-level crossing stays below; proximity alone must not lift it to the freeway.
    opposite.layer = 0
    opposite.bridge = False
    opposite.xy = np.array([[240., 30.], [60., 30.]])
    lower, lower_paint = side_roads(res, np.full(len(res.P), 20.), dem, "test")
    assert not lower.is_empty()
    assert np.isclose(np.ptp(lower.positions[:, 0]), 180)
    assert lower.positions[:, 1].max() < 1
    assert lower_paint == {}


def test_the_race_street_remains_visible_beyond_both_open_route_endpoints(monkeypatch):
    from shapely.geometry import Point

    from sr.clearance import surface
    from sr.route import RoadWay
    from sr.roads import race_ribbons, side_roads
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=300, half_width=6)
    dem = FakeDem(res.frame, lambda x, z: np.zeros_like(x))
    # Most of this OSM way is the racing line, but the physical street continues well beyond both
    # selected race endpoints. The former whole-way shortcut discarded both visible tails.
    street = RoadWay(1, "residential", "", [1, 2], np.array([[-100., 0.], [400., 0.]]),
                     2, False, False, False, 0)
    monkeypatch.setattr("sr.roads.load_ways", lambda *_: [street])

    road, _ = side_roads(res, np.zeros(len(res.P)), dem, "test")
    assert road.positions[:, 0].min() <= -95, "the start-side street tail was cut off"
    assert road.positions[:, 0].max() >= 395, "the finish-side street tail was cut off"
    visible_street = surface(road, *race_ribbons(res, np.zeros(len(res.P))).values())
    assert all(visible_street.covers(Point(x, 0)) for x in np.linspace(-95, 395, 99)), (
        "the street tails do not meet the racing ribbon at both endpoints")


def test_the_other_carriageway_of_a_divided_freeway_stays_level_and_unburied(monkeypatch):
    """US 101's southbound lanes vanished under the terrain. The blend back to natural
    ground began three metres past the racing shoulder, right under the other carriageway, and a
    ribbon sampled only at its two edges sagged below the curved ground between them."""
    from sr.route import RoadWay
    from sr.roads import parallel_flat_extents, side_roads
    from sr.terrain import ground_height
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=400, half_width=11)
    res.oneway[:] = True
    res.highway = ["motorway"] * len(res.P)
    road_y = np.full(len(res.P), 20.0)
    res.P[:, 1] = road_y
    dem = FakeDem(res.frame, lambda x, z: np.full_like(x, 17.8))    # a low embankment, as the map records a freeway
    # the southbound carriageway, 21 m to one side and running the opposite way
    other = RoadWay(1, "motorway", "", [1, 2], np.array([[380., 21.], [20., 21.]]), 5, True, False, False, 0)
    monkeypatch.setattr("sr.roads.load_ways", lambda *_: [other])

    def burial():
        road, _ = side_roads(res, road_y, dem, "test")
        middle = (road.positions[:, 0] > 100) & (road.positions[:, 0] < 300)
        v = road.positions[middle]
        # probe between the ribbon's edges too, where a sagging chord hides under the ground
        across = np.linspace(v[0::2, 2], v[1::2, 2], 9).T.reshape(-1)
        along = np.repeat(v[0::2, 0], 9)
        heights = np.linspace(v[0::2, 1], v[1::2, 1], 9).T.reshape(-1)
        ground = ground_height(res, road_y, dem, np.column_stack([along, across]))
        return float((ground - heights).max()), v[:, 1]

    buried, _ = burial()
    assert buried > 0.2, "without a level roadbed the other carriageway should be buried, or this proves nothing"
    res.flat_left, res.flat_right = parallel_flat_extents(res, [other], road_y, dem)
    buried, heights = burial()
    assert buried < 0.05, f"the other carriageway is still buried by {buried:.2f} m"
    assert np.allclose(heights, 20.0, atol=0.1), "both directions of one freeway share its level"
    # a carriageway on its own grade up a hillside keeps that grade instead of being carved flat
    hill = FakeDem(res.frame, lambda x, z: np.where(z > 15, 30.0, 14.0))
    left, right = parallel_flat_extents(res, [other], road_y, hill)
    assert left.max() < 0.5 and right.max() < 0.5


def test_moffett_low_rail_matches_the_runtime_collision_fixture():
    """The physics comparison must use the actual generator and airfield rail height."""
    import json
    from pathlib import Path
    from types import SimpleNamespace
    import numpy as np
    from sr.roads import guardrails, ROAD_LIFT
    from sr.routes import load_route

    route = load_route("moffett-field")
    assert route["guardrails"] is True
    width = route["airfieldCircuit"]["sections"][0]["widthM"] / 2
    points = np.array([[0., 0., z] for z in np.arange(-300, 302, 2)])
    res = SimpleNamespace(route=route, P=points, T=np.tile([0., 0., 1.], (len(points), 1)),
                          R=np.tile([1., 0., 0.], (len(points), 1)),
                          half_width=np.full(len(points), width), closed=False)
    mesh = guardrails(res, np.full(len(points), -ROAD_LIFT))
    fixture = json.loads((Path(__file__).parents[2] / "game/test/fixtures/moffett-rail.json").read_text())
    np.testing.assert_allclose(mesh.positions.flatten(), fixture["vertices"], atol=1e-10)
    np.testing.assert_array_equal(mesh.indices.flatten(), fixture["indices"])
    assert np.isclose(mesh.positions[:, 1].max(), route["guardrailHeightM"])
    assert np.all(np.abs(mesh.positions[:, 0]) > width)
    assert mesh.positions[:, 0].min() < -width and mesh.positions[:, 0].max() > width
