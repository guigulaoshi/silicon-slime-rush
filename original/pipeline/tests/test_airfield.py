import numpy as np

from sr.airfield import _runway_lights
from tests.test_terrain import straight_route


def test_runway_edge_lights_stay_outside_both_painted_edges_at_regular_spacing():
    res = straight_route(length=320, half_width=30.5)
    res.highway = ["runway"] * len(res.P)
    road_y = np.full(len(res.P), 11.0)
    mesh, placements = _runway_lights(res, road_y)

    assert mesh.triangle_count > 0
    assert 20 <= len(placements) <= 24
    assert {round(abs(position[2]), 1) for position in placements} == {31.5}
    assert all(position[1] > 11.0 for position in placements)
