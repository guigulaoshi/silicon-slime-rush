import numpy as np
import pytest

from sr.markings import (ARROW_BEFORE, CROSSWALK_BARS, DASH_OFF, DASH_ON, EDGE_INSET, LINE_W,
                         STOP_BEFORE, WHITE, YELLOW, junction_markings, lane_count, markings, offsets)
from sr.roads import ROAD_LIFT, RoadJunction
from sr.route import LANE_W
from tests.test_terrain import FakeDem, straight_route


def route(oneway, half_width=7.0, length=600.0):
    res = straight_route(length=length, half_width=half_width)
    res.oneway = np.full(len(res.P), oneway)
    return res


def flat(res, y=10.0):
    return FakeDem(res.frame, lambda x, z: np.full(np.shape(x), y))


def test_lane_count_never_goes_below_one():
    assert lane_count(0.1, LANE_W) == 1
    assert lane_count(LANE_W * 3.4, LANE_W) == 3


def test_a_two_way_road_gets_a_double_yellow_down_the_middle():
    res = route(False)
    lines = offsets(res, 0, LANE_W)
    yellows = sorted(o for o, mat, _ in lines.values() if mat == YELLOW)
    assert len(yellows) == 2
    assert yellows[0] == pytest.approx(-yellows[1])
    gap = yellows[1] - yellows[0] - LINE_W
    assert gap > 0, "the two lines of a double yellow must not touch"


def test_a_divided_carriageway_has_no_centre_line_and_a_yellow_median_edge():
    """A one-way way in the map data is one carriageway of a divided road. Its centre is not a
    boundary between directions, so nothing is painted there; the median is on its left, and in
    right-hand traffic that edge line is yellow."""
    res = route(True)
    lines = offsets(res, 0, LANE_W)
    assert not any(k[0] == "centre" for k in lines)
    left, left_mat, left_dashed = lines[("edge", -1)]
    right, right_mat, _ = lines[("edge", 1)]
    assert left < 0 < right
    assert (left_mat, right_mat) == (YELLOW, WHITE)
    assert not left_dashed


def test_edge_lines_sit_inside_the_painted_edge():
    for oneway in (False, True):
        res = route(oneway, half_width=9.0)
        lines = offsets(res, 0, LANE_W)
        for side in (-1, 1):
            offset = lines[("edge", side)][0]
            assert abs(offset) == pytest.approx(9.0 - EDGE_INSET)


def test_lane_dividers_are_dashed_white_and_split_the_carriageway_evenly():
    res = route(True, half_width=11.0)
    lines = offsets(res, 0, LANE_W)
    dividers = sorted(o for k, (o, _, _) in lines.items() if k[0] == "divider")
    assert dividers, "an eleven metre carriageway is more than one lane"
    for k, (_, mat, dashed) in lines.items():
        if k[0] == "divider":
            assert (mat, dashed) == (WHITE, True)
    edges = [lines[("edge", -1)][0], lines[("edge", 1)][0]]
    spacing = np.diff([edges[0]] + dividers + [edges[1]])
    assert np.allclose(spacing, spacing[0]), "lanes should come out the same width"


def test_a_wider_road_gets_more_lanes():
    narrow = len([k for k in offsets(route(False, half_width=6.0), 0, LANE_W) if k[0] == "divider"])
    wide = len([k for k in offsets(route(False, half_width=13.0), 0, LANE_W) if k[0] == "divider"])
    assert wide > narrow


def test_airfield_surfaces_use_airfield_markings_instead_of_road_lanes():
    res = route(False, half_width=30.5)
    res.highway = ["runway"] * len(res.P)
    runway = offsets(res, 0, LANE_W)
    assert set(runway) == {("runway-centre", 0), ("runway-edge", -1), ("runway-edge", 1)}
    assert runway[("runway-centre", 0)] == (0.0, WHITE, True)
    assert all(value[1] == WHITE for value in runway.values())

    res.highway = ["taxiway"] * len(res.P)
    taxiway = offsets(res, 0, LANE_W)
    assert set(taxiway) == {("taxiway-centre", 0), ("taxiway-edge", -1), ("taxiway-edge", 1)}
    assert all(value[1:] == (YELLOW, False) for value in taxiway.values())


def test_dashes_are_painted_for_part_of_their_period_and_solid_lines_are_not_broken():
    res = route(True, half_width=11.0, length=1200.0)
    road_y = np.full(len(res.P), 10.0)
    out = markings(res, road_y, LANE_W)
    assert set(out) == {WHITE, YELLOW}
    # the yellow median edge runs the whole way; the white lines include dashes, so per metre of
    # route the white geometry is not simply proportional to the number of white lines
    duty = DASH_ON / (DASH_ON + DASH_OFF)
    assert 0.0 < duty < 1.0
    solid = out[YELLOW]
    lo, hi = solid.bounds()
    assert hi[0] - lo[0] > 1100.0, "the median edge line should run the length of the route"
    assert lo[2] < 0.0, "and it should be on the left of a route running along +x"


def test_markings_float_above_the_driving_surface_not_above_the_ground():
    """The race ribbon is itself lifted off the terrain. Paint measured from the ground ends up
    under the tarmac and shows through only where the road dips, which is what happened first."""
    res = route(False)
    road_y = np.full(len(res.P), 10.0)
    surface = 10.0 + ROAD_LIFT
    for mesh in markings(res, road_y, LANE_W).values():
        ys = mesh.positions[:, 1]
        assert np.all(ys > surface), "paint under the asphalt is invisible"
        assert np.all(ys < surface + 0.1), "and paint floating above it is a kerb"


def test_lines_stay_on_the_road():
    res = route(False, half_width=7.0)
    road_y = np.full(len(res.P), 10.0)
    for mesh in markings(res, road_y, LANE_W).values():
        assert np.all(np.abs(mesh.positions[:, 2]) <= 7.0 + 1e-6)


def test_a_line_that_only_exists_on_part_of_the_route_is_drawn_only_there():
    """Where the surface narrows a lane runs out. The divider has to stop there rather than being
    dropped from the whole route, which is what an index-keyed layout would have done."""
    res = route(False, half_width=13.0, length=1200.0)
    res.half_width[len(res.P) // 2:] = 6.0
    road_y = np.full(len(res.P), 10.0)
    out = markings(res, road_y, LANE_W)
    assert WHITE in out and YELLOW in out
    lo, hi = out[YELLOW].bounds()
    assert hi[0] - lo[0] > 1100.0, "the centre line survives a change of width"


def test_junction_paint_uses_the_network_index_and_stays_on_the_road():
    res = route(False, half_width=7.0, length=120.0)
    road_y = np.full(len(res.P), 10.0)
    junction = RoadJunction(route_index=40, turn_side=1)
    mesh = junction_markings(res, road_y, LANE_W, [junction])
    assert mesh is not None and mesh.material == WHITE
    assert mesh.triangle_count == (1 + CROSSWALK_BARS + 4) * 2
    assert np.all(np.abs(mesh.positions[:, 2]) <= 7.0 + 1e-6)
    assert mesh.positions[:, 1].min() == pytest.approx(10.0 + ROAD_LIFT + 0.02)
    xs = mesh.positions[:, 0]
    assert xs.min() < res.P[junction.route_index, 0] - ARROW_BEFORE
    assert xs.max() > res.P[junction.route_index, 0] - STOP_BEFORE


def test_turn_arrow_follows_the_side_reported_by_the_shared_junction_result():
    res = route(False, half_width=7.0, length=120.0)
    road_y = np.zeros(len(res.P))
    right = junction_markings(res, road_y, LANE_W, [RoadJunction(40, 1)])
    left = junction_markings(res, road_y, LANE_W, [RoadJunction(40, -1)])
    # The four arrow strips are appended last. Zebra and stop bars span the whole road and would
    # otherwise hide which side the arrow head itself chose.
    right_arrow = right.positions[-16:]
    left_arrow = left.positions[-16:]
    assert right_arrow[:, 2].max() > left_arrow[:, 2].max()
    assert right_arrow[:, 2].mean() > left_arrow[:, 2].mean()


def test_build_connection_feeds_shared_junctions_into_the_paint(monkeypatch):
    from sr import build
    from sr.roads import JunctionLayout

    res = route(False, half_width=7.0, length=120.0)
    road_y = np.zeros(len(res.P))
    expected = JunctionLayout((RoadJunction(40, 1),), ())
    monkeypatch.setattr(build, "junction_layout", lambda route, route_id: expected)
    painted, layout = build.road_markings(res, road_y, "synthetic")
    without = markings(res, road_y, LANE_W)
    assert layout is expected
    assert painted[WHITE].triangle_count == without[WHITE].triangle_count + (1 + CROSSWALK_BARS + 4) * 2
