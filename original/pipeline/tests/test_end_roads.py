import numpy as np
import pytest
from shapely.geometry import Point

from sr.clearance import surface
from sr.dem import DemSampler
from sr.end_roads import continuations
from sr.roads import JunctionLayout, barrier_lines, race_ribbons, side_roads
from sr.route import RoadWay, build_route
from sr.terrain import build_terrain, corridor_polygon, ground_height, road_profile
from tests.test_terrain import FakeDem, straight_route


@pytest.mark.parametrize("route_id", ["fishermans-wharf", "goldengate", "bayshore-101", "twin-peaks", "lombard"])
def test_real_open_courses_have_joined_mapped_roads_beyond_both_timing_lines(route_id):
    route = build_route(route_id)
    dem = DemSampler()
    y = road_profile(route, dem, route.route.get("bridgeDeckM"), route.route.get("bridgeMinLengthM", 200.))
    route.P[:, 1] = y
    roads = continuations(route, y, dem, route_id)
    assert set(roads) == {"start", "finish"}
    for name, endpoint in (("start", 0), ("finish", -1)):
        extension = roads[name]
        assert extension.length >= 200
        assert np.allclose(extension.P[0], route.P[endpoint], atol=.011)
        assert extension.half_width[0] == route.half_width[endpoint]
        expected = route.T[endpoint, [0, 2]] * (-1 if name == "start" else 1)
        actual = extension.T[0, [0, 2]]
        assert np.dot(expected, actual) / np.linalg.norm(expected) / np.linalg.norm(actual) > 1 - 1e-9
        assert np.isfinite(extension.P).all()
        assert np.max(np.abs(np.diff(extension.P[:, 1]))) < 1.5, "the continuation must not step off a deck"


def test_empty_cache_is_not_needed_for_a_circuit():
    route = straight_route(); route.closed = True
    assert continuations(route, route.P[:, 1], None, "no-such-cache") == {}


def test_continuation_keeps_a_full_width_painted_join(monkeypatch):
    route = straight_route(length=300, half_width=6)
    street = RoadWay(1, "residential", "Main Street", [1, 2, 3, 4],
                    np.array([[-300., 0.], [0., 0.], [300., 0.], [600., 0.]]),
                    2, False, False, False, 0)
    route.ways = [street]
    monkeypatch.setattr("sr.end_roads.load_ways", lambda *_: [street])
    monkeypatch.setattr("sr.roads.load_ways", lambda *_: [street])
    dem = FakeDem(route.frame, lambda x, z: np.zeros_like(x))
    roads = continuations(route, route.P[:, 1], dem, "test")
    mesh, paint = side_roads(route, route.P[:, 1], dem, "test", end_roads=roads)
    ground = surface(mesh, *race_ribbons(route, route.P[:, 1]).values())
    for x in np.linspace(-200, 500, 141):
        for z in [-5., 0., 5.]:
            assert ground.covers(Point(x, z)), (x, z)
    for x in np.linspace(500, 590, 91):
        assert ground.covers(Point(x, 0)), x
    assert paint, "the view beyond the timing line needs the same road paint"


def test_a_real_dead_end_is_reported_instead_of_inventing_a_street(monkeypatch):
    route = straight_route(length=300)
    route.ways = [RoadWay(1, "residential", "Dead End", [1, 2], np.array([[0., 0.], [300., 0.]]),
                         2, False, False, False, 0)]
    monkeypatch.setattr("sr.end_roads.load_ways", lambda *_: [])
    with pytest.raises(ValueError, match="mapped continuation ends"):
        continuations(route, route.P[:, 1], FakeDem(route.frame, lambda x, z: np.zeros_like(x)), "dead-end")


def test_sloping_ground_cannot_cover_the_visible_continuation():
    route = straight_route(length=100, half_width=6)
    route.P[:, 1] = 10
    tail = straight_route(length=220, half_width=6)
    tail.P[:, 0] += 100; tail.P[:, 1] = 10
    route.end_roads = {"finish": tail}
    dem = FakeDem(route.frame, lambda x, z: 10 + z * .2)
    probes = np.array([[200., -6.], [200., 0.], [200., 6.]])
    assert np.allclose(ground_height(route, route.P[:, 1], dem, probes), 10)
    terrain = build_terrain(route, dem, route.P[:, 1], corridor_polygon(route, 260), pad=260)
    tarmac = surface(*race_ribbons(tail, tail.P[:, 1]).values())
    assert surface(terrain.terrain).intersection(tarmac).area < 1e-5


def test_old_side_street_barriers_do_not_block_the_finishers_approach():
    route = straight_route(length=100, half_width=6)
    tail = straight_route(length=220, half_width=6); tail.P[:, 0] += 100
    dem = FakeDem(route.frame, lambda x, z: np.zeros_like(x))
    layout = JunctionLayout((), ((np.array([140., 0.]), np.pi/2, 4.),
                                (np.array([140., 40.]), np.pi/2, 4.)))
    before = barrier_lines(route, route.P[:, 1], dem, "test", layout)
    assert any(abs(pos[2]) < 6 for pos, _ in before)
    route.end_roads = {"finish": tail}
    after = barrier_lines(route, route.P[:, 1], dem, "test", layout)
    assert after and all(abs(pos[2]) > 6 for pos, _ in after)
