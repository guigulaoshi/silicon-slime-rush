"""Aircraft rows use the same road boundary as the shipped guardrails."""
import numpy as np
from shapely.geometry import LineString
from shapely.ops import unary_union

from sr.airshow import placements
from sr.buildings import box_polygon
from sr.route import build_route
from sr.roads import rail_paths
from sr.landmark_data import entries


class FlatDem:
    def heights(self, lat, lon):
        return np.full_like(lat, 5)


def test_moffett_three_rows_reuse_seven_models_and_clear_guardrails():
    res = build_route('moffett-field')
    res.P[:, 1] = 5
    models, bays = placements(res, FlatDem())
    assert len(models) == len(bays) == 36
    assert len({m['id'] for m in models}) == 7
    assert all(m['collision'] and m['pos'][1] == 5 for m in models)
    assert len({tuple(m['pos']) for m in models}) == 36
    metadata = entries()
    assert all(m['file'] == metadata[m['id']]['file'] for m in models)
    boundary = unary_union([LineString(points) for points in rail_paths(res)])
    polygons = [box_polygon(b[0], b[2], b[3], b[5], b[6]) for b in bays]
    assert min(poly.distance(boundary) for poly in polygons) >= 13
    assert all(not first.intersects(second) for i, first in enumerate(polygons) for second in polygons[i+1:])
    for m in models:
        p = np.array(m['pos'])[[0, 2]]
        nearest = np.argmin(np.linalg.norm(res.P[:, [0, 2]] - p, axis=1))
        towards_road = res.P[nearest, [0, 2]] - p
        towards_road /= np.linalg.norm(towards_road)
        nose = -np.array([np.sin(m['yaw']), np.cos(m['yaw'])])
        assert np.dot(nose, towards_road) > .95


def test_routes_without_exhibition_do_not_gain_aircraft():
    class NoExhibition:
        route = {}
    assert placements(NoExhibition(), FlatDem()) == ([], [])
