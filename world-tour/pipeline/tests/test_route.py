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
    # unless the route says that bridge is one deck with a barrier that gets moved, as the Sydney
    # Harbour Bridge's is (its centre lanes reverse direction under overhead signals, but it is one
    # physical deck): then both carriageways are the same piece of road
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


@pytest.mark.skipif(not os.path.exists(os.path.join(fetch_osm.CACHE_DIR, "sydney", "roads.json.gz")), reason="no cache")
def test_sydney_route_builds():
    """The Golden Gate route's replacement: Sydney is now the bridge-and-water showcase track
    (game/src/app/showcase.ts). Numbers below are measured directly on the built route, not guessed --
    see pipeline scratch probes run against sr.route.build_route("sydney")."""
    from sr.route import build_route, overlap_length
    res = build_route("sydney")
    # Rerouted (routes/sydney.json notes): the research draft's Rocks/quayside waypoints
    # doubled back on themselves, so the shipped line is already just the bridge crossing and the
    # climb to the Opera House -- there is no long low-value approach left to halve, unlike Golden
    # Gate's Presidio approach. the course goes on round the Opera House's west side and
    # harbour tip on the promenade and starts just past the north pylons instead: measured 3266 m.
    assert 2_900 < res.length < 3_400, res.length
    assert overlap_length(res) < 120, "route doubles back on itself"
    assert res.bridge.any(), "must cross the Harbour Bridge"
    # Checked by building every pipeline/routes/*.json route: none of the 15 new tracks carries an
    # OSM-tagged tunnel segment on its driven line (Sydney Harbour Tunnel exists in the data but the
    # route crosses the bridge, not the tunnel), so only two combos are real here, not three.
    assert {(int(layer), bool(bridge), bool(tunnel))
            for layer, bridge, tunnel in zip(res.layer, res.bridge, res.tunnel)} >= {
                (0, False, False), (1, True, False)
            }, "OSM layer and bridge metadata must survive route resampling"
    names = {w.name for w in res.ways}
    assert "Bradfield Highway" in names and "Macquarie Street" in names
    # the floor gives way on a corner tighter than the road is wide -- a narrow road is still a
    # road, a ribbon folded over itself is not
    assert (res.half_width >= 3.0).all() and (res.half_width <= RACE_MAX_HALF).all()
    assert res.half_width.mean() > RACE_MIN_HALF
    # one spike is enough to make a track undriveable, so the worst corner is the thing to assert on
    assert np.degrees(sharpest_turn(res)) < 35, np.degrees(sharpest_turn(res))
    assert overlap_length(res) < 120


# "test_goldengate_starts_with_a_distant_view_straight_at_the_bridge" is deleted rather
# than retargeted: it read res.route["suspension"]["towers"], the Golden Gate route's own procedural
# suspension-bridge block (sr/bridge.py's suspension()). None of the 15 new pipeline/routes/*.json
# files declares a "suspension" block any more -- every new bridge (Sydney's Harbour Bridge, Shanghai's
# Waibaidu, Fuji's Kawaguchiko Ohashi, Paris's Pont d'Iena) is a hand-placed GLB landmark instead, so
# there is no towers-and-moved-start data left anywhere to test this against.


# Deleted rather than retargeted (all six tests below): each one's whole point was a feature that
# has no track any more.
#   - test_roof_loop_follows_the_osm_courtyard_and_keeps_the_whole_road_on_the_roof
#   - test_roof_loop_support_reaches_exactly_to_the_driving_plane
#   - test_roof_loop_keeps_apple_parks_floor_bands_and_solar_field_off_the_race_surface
#   - test_roof_support_is_not_built_again_as_two_full_height_trackside_walls
#   - test_roof_relation_exclusion_is_wired_into_the_ordinary_building_pass
#   - test_ground_streets_do_not_become_junctions_on_the_roof
#   - test_built_roof_loop_contains_the_support_shell_node
# All seven tested Apple Park's roof-loop (route["roofLoop"], Hangar One's Charleston canopy /
# rooftop ring) on wolfe-pruneridge, which is deleted with no replacement -- roofLoop is one of the
# named-deleted features, and no pipeline/routes/*.json among the 15 new tracks declares one.
#   - test_moffett_circuit_uses_the_real_runway_and_goes_around_hangar_one
# tested the airfield circuit (runways, taxiways, the Moffett display aircraft) on moffett-field,
# also a named-deleted feature with no replacement track.


def test_width_gives_way_on_a_corner_it_cannot_fit_round():
    """Lombard and then Rio's Corcovado climb carried this test; both are deleted.
    New York's Lower Manhattan grid now has the most corners tighter than 20 m of any route (67
    samples; Istanbul 63, Zhangjiajie's hairpins 53) and the only ones where the 0.7 / curvature cap
    actually binds -- on the other routes the mapped road is already narrower than the cap."""
    import numpy as np

    from sr.geom import curvature
    from sr.route import build_route

    res = build_route("new-york")
    c = np.abs(curvature(res.P, res.S))
    tight = c > 1 / 20.0
    assert tight.sum() > 20, "expected the grid corners to survive routing"
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


# test_bayshore_101_runs_from_moffett_past_menlo_park_within_twenty_km is deleted, not retargeted:
# its whole point was the 64.8 km bayshore-101 highway route, a named-deleted feature -- "there is no
# long route any more" per the remix mapping table. pipeline/routes/bayshore-101.json no longer
# exists (load_route/build_route both raise FileNotFoundError), and no new track is a motorway/ramp
# route at all, so there is no real data left to re-derive any of this test's numbers from.


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
    monkeypatch.setattr(route_module, "load_ways", lambda *_, **__: [
        _way(920, [[1000, 0], [1200, 0]], [1, 2])])
    with pytest.raises(ValueError, match="waypoint snap moved"):
        route_module.build_route("venue")


def test_race_way_clearance_pushes_a_promenade_off_a_landmark_podium(monkeypatch):
    """Round the Sydney Opera House the mapped footway runs 0.2-6 m from the podium the collision
    model stands on; raceWayClearM moves only the raceWays' nodes out to the asked distance."""
    from shapely.geometry import LineString, Point, Polygon
    from sr import landmark_data
    from sr.route import clear_race_ways
    podium = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    monkeypatch.setattr(landmark_data, "footprints", lambda frame, path=None, names=None: [podium])
    promenade = _way(1, [[12, -20], [12, 30]], [1, 2], highway="footway")   # 2 m off the east wall
    link = _way(2, [[12, 30], [40, 30]], [2, 3])                            # ordinary road at node 2
    far = _way(3, [[50, 0], [50, 10]], [4, 5])
    clear_race_ways([promenade, link, far], [1], None, {"opera-house": 6.0})
    assert min(podium.exterior.distance(Point(p)) for p in promenade.xy) >= 6.0 - 1e-6
    # densified before the push, so no straight edge between two pushed nodes cuts the corner:
    # without it the two original nodes stay put and the edge between them runs 2 m off the wall
    assert podium.distance(LineString(promenade.xy)) > 5.5
    assert np.allclose(promenade.xy[[0, -1]], [[12, -20], [12, 30]])       # ends were already clear
    assert np.allclose(link.xy, [[12, 30], [40, 30]]) and np.allclose(far.xy, [[50, 0], [50, 10]])
    # a pushed node that another way shares moves in that way too: the graph keeps one position
    inner = _way(4, [[5, 13], [5, 20]], [6, 7], highway="footway")
    side = _way(5, [[5, 13], [-20, 13]], [6, 8])
    clear_race_ways([inner, side], [4], None, {"opera-house": 6.0})
    assert np.allclose(inner.xy[0], [5, 16]) and np.allclose(side.xy[0], [5, 16])


def test_a_race_way_island_is_joined_to_the_street_beside_it():
    """A pedestrian square mapped as an area shares no node with the street beside it; declared as a
    race way it must still be routable, joined where its outline passes close to the street."""
    import networkx as nx
    from sr.route import link_race_ways
    street = _way(921, [[x, 0] for x in range(0, 220, 20)], list(range(1, 12)))
    square = _way(922, [[20, 20], [180, 20], [180, 150], [20, 150], [20, 20]], [111, 112, 113, 114, 111])
    far = _way(923, [[0, 500], [50, 500]], [121, 122])
    ways = [street, square, far]
    G = build_graph(ways)
    assert not nx.has_path(G, 1, 113)
    added = link_race_ways(G, ways, [922, 923], 30.0)
    assert added >= 2 and nx.has_path(G, 1, 113)
    assert not nx.has_path(G, 1, 121), "a race way far from every street stays unjoined"
    assert link_race_ways(build_graph(ways), ways, [], 30.0) == 0
