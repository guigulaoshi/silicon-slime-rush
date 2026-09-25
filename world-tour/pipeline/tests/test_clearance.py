import numpy as np
from shapely.ops import unary_union
from sr.clearance import _triangles, buildings_over_the_road, MIN_OVERLAP
from sr.mesh import box, merge


def test_local_road_overlap_matches_the_complete_surface_including_duplicate_ribbons():
    roads = [box((0, 0, 0), (50, .1, 5), material="road"),
             box((20, 0, 0), (30, .1, 5), material="road"),
             box((10000, 0, 10000), (50, .1, 5), material="road")]
    buildings = merge([box((10, 5, 6), (3, 5, 3)), box((30, 5, 50), (3, 5, 3)),
                       box((10000, 5, 10000), (2, 5, 2))], "building")
    entire = unary_union(_triangles(roads))
    expected = []
    for triangle in _triangles([buildings]):
        hit = triangle.intersection(entire)
        if not hit.is_empty and hit.area > MIN_OVERLAP:
            expected.append((float(hit.area), float(hit.centroid.x), float(hit.centroid.y)))
    assert expected
    np.testing.assert_allclose(buildings_over_the_road(roads, buildings), sorted(expected, reverse=True), atol=1e-6)
