import json
import gzip
import os

import numpy as np
import pytest

from sr import fetch_osm
from sr.geo import LocalFrame
from sr.route import (RACE_MAX_HALF, RACE_MIN_HALF, STEP, RoadWay, overlap_length, build_graph, half_width_for,
                      reparameterize, sharpest_turn, smooth_polyline, snap, spans, strip_backtracks, trace)


def test_local_frame_axes_and_roundtrip():
    f = LocalFrame(37.8, -122.45)
    x, z = f.to_local(37.8, -122.44)   # one hundredth of a degree east
    assert x > 800 and abs(z) < 1.0
    x, z = f.to_local(37.81, -122.45)  # north -> negative z
    assert z < -1000 and abs(x) < 1.0
    lat, lon = f.to_latlon(500.0, -300.0)
    x2, z2 = f.to_local(lat, lon)
    assert abs(x2 - 500) < 1e-6 and abs(z2 + 300) < 1e-6


def test_elevated_route_reparameterizes_every_consumer_to_three_dimensional_arc():
    route = type("Route", (), {})()
    route.P = np.array([[0., 0., 0.], [3., 4., 0.], [6., 4., 0.]])
    route.S = np.array([0., 3., 6.])
    route.T = np.zeros((3, 3)); route.R = np.zeros((3, 3)); route.closed = False
    reparameterize(route)
    assert route.S.tolist() == [0., 5., 8.]
    assert np.all(route.T == 0) and np.all(route.R == 0)


def _way(osm_id, pts, nodes, highway="residential", **kw):
    d = dict(osm_id=osm_id, highway=highway, name="", nodes=nodes, xy=np.array(pts, dtype=float), lanes=2,
             oneway=False, bridge=False, tunnel=False, layer=0)
    d.update(kw)
    return RoadWay(**d)


def test_graph_trace_takes_shortest_path():
    # square of roads; waypoints at opposite corners, trace must go along two edges, not four
    a = _way(1, [[0, 0], [100, 0]], [1, 2]); b = _way(2, [[100, 0], [100, 100]], [2, 3])
    c = _way(3, [[100, 100], [0, 100]], [3, 4]); d = _way(4, [[0, 100], [0, 0]], [4, 1])
    G = build_graph([a, b, c, d])
    ids = snap(G, [[2, 3], [98, 97]])
    assert ids == [1, 3]
    xz, meta = trace(G, ids)
    assert len(xz) == 3 and abs(np.linalg.norm(np.diff(xz, axis=0), axis=1).sum() - 200) < 1e-9


def test_half_width_rules():
    # A divided road is driven on one carriageway only, so a three lane one-way side stays a three
    # lane road: 3 x 3.6 / 2 x 1.25. The other side of the median is not part of the track.
    bridge = _way(1, [[0, 0], [1, 1]], [1, 2], highway="motorway", lanes=3, oneway=True, bridge=True)
    assert half_width_for(bridge, 4.0) == pytest.approx(6.75)
    # unless the route says that bridge is one deck with a barrier that gets moved, as the Golden
    # Gate's is: then both carriageways are the same piece of road
    assert half_width_for(bridge, 4.0, shared_deck=True) == pytest.approx(13.5)
    # and a plain divided highway is one side whatever the route asks for
    highway = _way(1, [[0, 0], [1, 1]], [1, 2], highway="motorway", lanes=4, oneway=True)
    assert half_width_for(highway, 4.0, shared_deck=True) == pytest.approx(9.0)
    # and every road has a floor, because a real two-lane street is a corridor at racing speed
    assert half_width_for(_way(1, [[0, 0], [1, 1]], [1, 2], highway="service", lanes=1), 4.0) == RACE_MIN_HALF
    assert half_width_for(_way(1, [[0, 0], [1, 1]], [1, 2], highway="tertiary", lanes=2), 4.0) == RACE_MIN_HALF
    assert half_width_for(None, 4.5) == 4.5


def test_smooth_keeps_endpoints_and_roughly_length():
    xz = np.array([[0, 0], [100, 0], [100, 100]], dtype=float)
    sm = smooth_polyline(xz)
    assert np.allclose(sm[0], [0, 0, 0]) and np.allclose(sm[-1], [100, 0, 100])
    length = np.linalg.norm(np.diff(sm, axis=0), axis=1).sum()
    assert 190 < length < 200.5


def test_spans_groups_runs():
    S = np.arange(10) * 2.0
    assert spans(np.array([0, 1, 1, 0, 0, 1, 0, 0, 0, 1], dtype=bool), S) == [[2.0, 4.0], [10.0, 10.0], [18.0, 18.0]]


def test_strip_backtracks_removes_out_and_back_spurs():
    assert strip_backtracks([1, 2, 3, 4]) == [1, 2, 3, 4]
    assert strip_backtracks([1, 2, 3, 2, 4]) == [1, 2, 4]          # walked up a spur and back
    assert strip_backtracks([1, 2, 3, 4, 2, 5]) == [1, 2, 5]       # a longer excursion
    assert strip_backtracks([1, 2, 1]) == [1]


@pytest.mark.skipif(not os.path.exists(os.path.join(fetch_osm.CACHE_DIR, "goldengate", "roads.json.gz")), reason="no cache")
def test_goldengate_route_builds():
    from sr.route import build_route, overlap_length
    res = build_route("goldengate")
    # halved on purpose: the bridge and the hairpins are the whole point of the route and the
    # approach through the Presidio was two thirds of the driving
    assert 4_500 < res.length < 6_500, res.length
    assert overlap_length(res) < 120, "route doubles back on itself"
    assert res.bridge.any(), "must cross the Golden Gate Bridge"
    assert {(int(layer), bool(bridge), bool(tunnel))
            for layer, bridge, tunnel in zip(res.layer, res.bridge, res.tunnel)} >= {
                (0, False, False), (1, True, False), (-1, False, True)
            }, "OSM layer, bridge and tunnel metadata must survive route resampling"
    names = {w.name for w in res.ways}
    assert "Conzelman Road" in names and "Lincoln Boulevard" in names
    # the floor gives way on a corner tighter than the road is wide -- a narrow road is still a
    # road, a ribbon folded over itself is not
    assert (res.half_width >= 3.0).all() and (res.half_width <= RACE_MAX_HALF).all()
    assert res.half_width.mean() > RACE_MIN_HALF
    # one spike is enough to make a track undriveable, so the worst corner is the thing to assert on
    assert np.degrees(sharpest_turn(res)) < 35, np.degrees(sharpest_turn(res))
    assert overlap_length(res) < 120


@pytest.mark.skipif(not os.path.exists(os.path.join(fetch_osm.CACHE_DIR, "goldengate", "roads.json.gz")), reason="no cache")
def test_goldengate_starts_with_a_distant_view_straight_at_the_bridge():
    """The first chase-camera frame is an approach vista, not the bridgehead."""
    from sr.route import build_route

    res = build_route("goldengate")
    south_tower_lat, south_tower_lon = res.route["suspension"]["towers"][0]
    tower_x, tower_z = res.frame.to_local(south_tower_lat, south_tower_lon)
    to_tower = np.array([tower_x, tower_z]) - res.P[0, [0, 2]]
    distance = np.linalg.norm(to_tower)
    heading = res.T[0, [0, 2]]
    heading_dot = np.dot(heading, to_tower) / np.linalg.norm(heading) / distance

    assert 800 < distance < 1_000, "the bridge should read as a vista, not a bridgehead start"
    assert heading_dot > 0.95, "the departure lane should frame the south tower straight ahead"
    assert 5_300 < res.length < 5_500, "the moved start must keep the route in its three-to-six km target"


@pytest.mark.skipif(not os.path.exists(os.path.join(fetch_osm.CACHE_DIR, "wolfe-pruneridge", "buildings.json.gz")),
                    reason="no roof-loop building cache")
def test_roof_loop_follows_the_osm_courtyard_and_keeps_the_whole_road_on_the_roof():
    from shapely.geometry import LineString
    from sr.buildings import footprint_by_osm_id
    from sr.route import build_route

    res = build_route("wolfe-pruneridge")
    building, _ = footprint_by_osm_id("wolfe-pruneridge", res.frame, 5281838)
    road = LineString(np.vstack([res.P[:, [0, 2]], res.P[:1, [0, 2]]])).buffer(res.half_width[0] + 0.5)
    assert len(building.interiors) == 1
    assert building.buffer(0.05).contains(road), "paint and guardrail allowance must stay on the roof annulus"
    assert 1_250 < res.length < 1_400
    assert 3_500 < res.length * res.route["laps"] < 5_000
    assert res.closed and res.bridge.all() and res.oneway.all()
    assert overlap_length(res) == 0
    assert np.degrees(sharpest_turn(res)) < 12


@pytest.mark.skipif(not os.path.exists(os.path.join(fetch_osm.CACHE_DIR, "wolfe-pruneridge", "buildings.json.gz")),
                    reason="no roof-loop building cache")
def test_roof_loop_support_reaches_exactly_to_the_driving_plane():
    from sr.build import SUPPORT_ROOF_DROP_M, roof_support
    from sr.buildings import footprint_by_osm_id, parse_height
    from sr.dem import DemSampler
    from sr.route import build_route

    res = build_route("wolfe-pruneridge")
    _poly, tags = footprint_by_osm_id("wolfe-pruneridge", res.frame, 5281838)
    support, top = roof_support(res.route, res, DemSampler())
    lo, hi = support.bounds()
    assert "heightM" not in res.route["roofLoop"]
    assert parse_height(tags) == pytest.approx(30.0)
    assert support.material == "building_landmark_glass"
    # Its own roof stops under the photovoltaic field instead of capping it at the driving plane.
    assert hi[1] == pytest.approx(top - SUPPORT_ROOF_DROP_M)
    assert top - lo[1] == pytest.approx(31.5)
    assert support.triangle_count > 300, "the courtyard hole and curved outer wall both need geometry"


@pytest.mark.skipif(not os.path.exists(os.path.join(fetch_osm.CACHE_DIR, "wolfe-pruneridge", "buildings.json.gz")),
                    reason="no roof-loop building cache")
def test_roof_loop_keeps_apple_parks_floor_bands_and_solar_field_off_the_race_surface():
    from sr.build import roof_support, roof_support_details
    from sr.dem import DemSampler
    from sr.route import build_route

    res = build_route("wolfe-pruneridge")
    _support, top = roof_support(res.route, res, DemSampler())
    details = roof_support_details(res.route, res, top)
    assert set(details) == {"roof_floor_bands", "deck_roof_solar", "roof_top_band"}
    assert details["roof_floor_bands"].material == "building_landmark_pale"
    assert details["deck_roof_solar"].material == "building_landmark_solar"
    assert details["roof_top_band"].material == "building_landmark_roof"
    assert details["roof_floor_bands"].bounds()[1][1] <= top + 0.2
    assert details["deck_roof_solar"].bounds()[1][1] < top, "solar panels must stay below the asphalt"
    solar = details["deck_roof_solar"]
    assert solar.bounds()[1][1] > _support.bounds()[1][1], "the glass support must not cap the panels"
    up = solar.normals[:, 1] > 0.9
    assert np.ptp(solar.uvs[up, 0]) > 50 and np.ptp(solar.uvs[up, 1]) > 50, \
        "the panel texture is laid across the field, not sampled at one constant roof UV"
    assert details["roof_top_band"].bounds()[0][1] == pytest.approx(top - 3.0)


@pytest.mark.skipif(not os.path.exists(os.path.join(fetch_osm.CACHE_DIR, "wolfe-pruneridge", "buildings.json.gz")),
                    reason="no roof-loop building cache")
def test_roof_support_is_not_built_again_as_two_full_height_trackside_walls():
    ""
    from shapely.geometry import LineString
    from sr.buildings import footprints
    from sr.route import build_route

    res = build_route("wolfe-pruneridge")
    relation = res.route["roofLoop"]["osmRelation"]
    ordinary = footprints(res.route["id"], res.frame, exclude_osm_ids=(relation,))
    sightline = LineString(np.vstack([res.P[:, [0, 2]], res.P[:1, [0, 2]]])).buffer(38.0)
    blocking = [poly for poly, _tags in ordinary if poly.intersects(sightline)]
    assert not blocking, "ordinary buildings must not rise through the roof's inward or outward view"


@pytest.mark.skipif(not os.path.exists(os.path.join(fetch_osm.CACHE_DIR, "moffett-field", "roads.json.gz")),
                    reason="no Moffett cache")
def test_moffett_circuit_uses_the_real_runway_and_goes_around_hangar_one():
    from shapely.geometry import LineString, Point, Polygon
    from sr.landmark_data import entries
    from sr.route import build_route, must_pass

    res = build_route("moffett-field")
    route_line = LineString(np.vstack([res.P[:, [0, 2]], res.P[:1, [0, 2]]]))
    hangar = entries()["hangar-one"]["footprint"]
    x, z = res.frame.to_local([point[0] for point in hangar], [point[1] for point in hangar])
    hangar_poly = Polygon(np.stack([x, z], axis=1))
    runway = next(way for way in res.ways if way.osm_id == 8141139)

    assert 3_000 < res.length < 5_000
    assert res.closed and overlap_length(res) < 80
    assert set(res.highway) >= {"runway", "taxiway", "road"}
    assert sum(surface == "runway" for surface in res.highway) * STEP > 1_200
    assert np.median(res.half_width[np.asarray(res.highway) == "runway"]) > 29
    assert route_line.distance(LineString(runway.xy)) < 1.0
    assert route_line.distance(hangar_poly) > 8.0
    visiting = [entries()[name] for name in (
        "moffett-f22-raptor", "moffett-f16-falcon",
        "moffett-ah64-apache", "moffett-v22-osprey")]
    aircraft_points = []
    for spec in visiting:
        x, z = res.frame.to_local(spec["lat"], spec["lon"])
        point = Point(float(x), float(z))
        aircraft_points.append(point)
        assert route_line.distance(point) > 70.0, \
            f"{spec['id']} must stay on the apron instead of blocking the circuit"
    assert min(a.distance(b) for i, a in enumerate(aircraft_points)
               for b in aircraft_points[i + 1:]) > 35.0, \
        "the visiting aircraft need readable silhouettes and rotor clearance, not an airshow pile-up"
    min_x, min_z, max_x, max_z = hangar_poly.bounds
    route_xz = res.P[:, [0, 2]]
    assert route_xz[:, 0].min() < min_x - 20 and route_xz[:, 0].max() > max_x + 20
    assert route_xz[:, 1].min() < min_z - 20 and route_xz[:, 1].max() > max_z + 20
    assert all(check["ok"] for check in must_pass(res, res.route))


def test_roof_relation_exclusion_is_wired_into_the_ordinary_building_pass(monkeypatch):
    """The filtering call itself is not enough: build_buildings must supply the route's relation."""
    import sr.buildings as buildings
    from shapely.geometry import box
    from sr.route import build_route

    seen = []

    def capture(_route_id, _frame, _layer, exclude_osm_ids=()):
        seen.extend(exclude_osm_ids)
        return []

    monkeypatch.setattr(buildings, "footprints", capture)
    res = build_route("wolfe-pruneridge")
    meshes, colliders = buildings.build_buildings(
        res, np.zeros(len(res.P)), None, res.route["id"], box(-1000, -1000, 1000, 1000))
    assert meshes == {} and colliders == []
    assert seen == [res.route["roofLoop"]["osmRelation"]]


@pytest.mark.skipif(not os.path.exists(os.path.join(fetch_osm.CACHE_DIR, "wolfe-pruneridge", "buildings.json.gz")),
                    reason="no roof-loop building cache")
def test_ground_streets_do_not_become_junctions_on_the_roof():
    from sr.build import road_markings, roof_support
    from sr.dem import DemSampler
    from sr.route import build_route

    res = build_route("wolfe-pruneridge")
    _support, top = roof_support(res.route, res, DemSampler())
    painted, layout = road_markings(res, np.full(len(res.P), top), res.route["id"])
    assert layout.junctions == () and layout.barriers == ()
    assert sum(mesh.triangle_count for mesh in painted.values()) > 3000, "the roof still needs lane paint"


@pytest.mark.skipif(not os.path.exists(os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "game",
                                                    "public", "tracks", "wolfe-pruneridge", "track.json")),
                    reason="roof-loop track not built")
def test_built_roof_loop_contains_the_support_shell_node():
    """Exercise the exported artifact: calling roof_support alone cannot prove build() kept it."""
    import json
    import pygltflib

    root = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "game", "public",
                                         "tracks", "wolfe-pruneridge"))
    with open(os.path.join(root, "track.json"), encoding="utf-8") as f:
        track = json.load(f)
    nodes = set()
    for tile in track["tiles"]:
        gltf = pygltflib.GLTF2().load(os.path.join(root, "tiles", tile["name"] + ".glb"))
        nodes.update(node.name for node in gltf.nodes)
    assert "roof_support" in nodes


def test_width_gives_way_on_a_corner_it_cannot_fit_round():
    """Lombard's switchbacks turn inside eight metres. A twelve metre ribbon round one of those
    folds over itself, and the crease behaves like a wall standing in the road."""
    import numpy as np

    from sr.geom import curvature
    from sr.route import build_route

    res = build_route("lombard")
    c = np.abs(curvature(res.P, res.S))
    tight = c > 1 / 12.0
    assert tight.sum() > 20, "expected the switchbacks to survive routing"
    # inside a corner, the road is never wider than the corner can carry
    assert (res.half_width[tight] <= 0.7 / c[tight] + 1e-6).all()
    assert (res.half_width[tight] >= 3.0).all()


def test_ref_constrained_leg_never_shortcuts_onto_another_highway():
    import networkx as nx
    freeway = _way(901, [[0, 0], [0, 100], [100, 100]], [1, 2, 3], name="Bayshore", refs=("US 101",))
    renamed = _way(902, [[100, 100], [100, 0]], [3, 4], name="James Lick", refs=("US 101", "CA 84"))
    shortcut = _way(903, [[0, 0], [100, 0]], [1, 4], refs=("I 280",))
    graph = build_graph([freeway, renamed, shortcut])
    points, ways = trace(graph, [1, 4], ["ref:US 101", "ref:US 101"])
    assert len(points) == 4
    assert all("US 101" in way.refs for way in ways)
    with pytest.raises(nx.NetworkXNoPath):
        trace(build_graph([freeway, shortcut]), [1, 4], ["ref:US 101", "ref:US 101"])


def test_bayshore_101_runs_from_moffett_past_menlo_park_within_twenty_km():
    from sr.route import build_route, must_pass, resolve_waypoints, waypoint_roads
    from sr.routes import load_route
    route = load_route("bayshore-101")
    res = build_route("bayshore-101")
    # the player's ceiling for this route is 20 km; it starts on the mainline beside the
    # Moffett hangar and its only ramp is the Marsh Road exit past the Menlo Park campus.
    assert 14_000 < res.length < 20_000
    highway = np.asarray(res.highway)
    ramps = np.flatnonzero(highway != "motorway")
    assert res.length - res.S[ramps[0]] < 500
    assert np.count_nonzero(highway == "motorway") * 2 > res.length - 500
    assert all(c["ok"] for c in must_pass(res, route))
    assert overlap_length(res) < 10
    graph = build_graph(res.ways, respect_oneway=route.get("respectOneway", False))
    ids = snap(graph, resolve_waypoints(route, res.ways, res.frame))
    selectors = waypoint_roads(route)
    selected = [i for i, name in enumerate(selectors) if name == "ref:US 101"]
    _points, ways = trace(graph, [ids[i] for i in selected], [selectors[i] for i in selected])
    assert all("US 101" in way.refs for way in ways)
    assert np.degrees(sharpest_turn(res)) < 35
    # the player asked for the route to pass within sight of the Moffett hangar
    from sr.landmark_data import entries
    assert "hangar-one" in route["landmarks"]
    hangar = np.asarray(entries()["hangar-one"]["footprint"]).mean(axis=0)
    hx, hz = res.frame.to_local(np.array([hangar[0]]), np.array([hangar[1]]))
    assert np.hypot(res.P[:, 0] - hx[0], res.P[:, 2] - hz[0]).min() < 1_000


def test_real_oneway_routing_rejects_reversing_an_onramp():
    import networkx as nx
    forward = _way(911, [[0, 0], [100, 0]], [1, 2], oneway=True)
    backward = _way(912, [[100, 0], [200, 0]], [2, 3], oneway=True, reverse_oneway=True)
    graph = build_graph([forward, backward], respect_oneway=True)
    assert graph.has_edge(1, 2) and not graph.has_edge(2, 1)
    assert graph.has_edge(3, 2) and not graph.has_edge(2, 3)
    with pytest.raises(nx.NetworkXNoPath):
        trace(graph, [1, 3])
    assert len(trace(build_graph([forward, backward]), [1, 3])[0]) == 3


def test_a_missing_access_road_cannot_move_a_venue_endpoint(monkeypatch):
    import sr.route as route_module
    route = {"id": "venue", "origin": {"lat": 37, "lon": -122}, "mode": "p2p",
             "waypoints": [[37, -122], [37, -122.001]], "maxSnapM": 25}
    monkeypatch.setattr(route_module, "load_route", lambda _: route)
    monkeypatch.setattr(route_module, "load_ways", lambda *_: [
        _way(920, [[1000, 0], [1200, 0]], [1, 2])])
    with pytest.raises(ValueError, match="waypoint snap moved"):
        route_module.build_route("venue")
