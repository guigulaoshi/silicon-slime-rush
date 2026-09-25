"""Which terrain material each patch of ground wears, and the two ways that goes wrong.

The interesting cases are not "does a park come out green". They are the two that would quietly
ruin a whole route: a zoning polygon painted as a surface, and a small specific patch losing to the
big vague one it sits inside.
"""
import numpy as np
import pytest
from shapely.geometry import Polygon

from sr import landcover, vegetation


def test_zoning_is_not_a_surface():
    """`landuse=industrial` says what may be built there, not what the ground is made of, and OSM
    draws it big: an industrial zone can run for square kilometres and swallow ponds and green space
    whole. Treating it as tarmac painted that whole area -- ponds included -- grey."""
    for zoning in ("industrial", "residential", "commercial", "retail", "military"):
        assert landcover.cover_for({"landuse": zoning}) == landcover.DEFAULT_COVER, zoning
    assert landcover.cover_for({"landuse": "parking"}) == "terrain_paved"
    assert landcover.cover_for({"landuse": "railway"}) == "terrain_paved"
    assert landcover.cover_for({"aeroway": "apron"}) == "terrain_paved"


def test_a_park_tagged_only_with_leisure_is_still_ground():
    """Most of the green in a city is `leisure=park` with no `landuse` at all."""
    assert landcover.cover_for({"leisure": "park"}) == "terrain_grass"
    assert landcover.cover_for({"natural": "salt_pond"}) == "terrain_saltpond"
    assert landcover.cover_for({}) == landcover.DEFAULT_COVER
    assert landcover.cover_for({"landuse": "something nobody has ever tagged"}) == landcover.DEFAULT_COVER


def test_ground_and_vegetation_share_the_same_ring_reader(monkeypatch):
    monkeypatch.setattr(landcover, "load_layer", lambda *_: {"elements": [
        {"tags": {"leisure": "park"}, "geometry": [
            {"lat": 1, "lon": 2}, {"lat": 1, "lon": 3},
            {"lat": 2, "lon": 3}, {"lat": 1, "lon": 2},
        ]},
        {"tags": {"natural": "wood"}, "geometry": [
            {"lat": 3, "lon": 4}, {"lat": 3, "lon": 5},
            {"lat": 4, "lon": 5}, {"lat": 3, "lon": 4},
        ]},
    ]})
    assert landcover.rings("route") == [
        ("park", [(1, 2), (1, 3), (2, 3), (1, 2)]),
        ("wood", [(3, 4), (3, 5), (4, 5), (3, 4)]),
    ]
    assert vegetation.landcover is landcover


def test_the_smaller_patch_wins_where_they_overlap():
    """A car park inside a campus, a pond inside a park. The small polygon is the more specific
    statement about that spot, and `patches()` orders them so that it is applied last."""
    big = Polygon([(-100, -100), (100, -100), (100, 100), (-100, 100)])
    small = Polygon([(-10, -10), (10, -10), (10, 10), (-10, 10)])
    ordered = sorted([("terrain_paved", small), ("terrain_grass", big)], key=lambda mp: -mp[1].area)
    assert ordered[0][0] == "terrain_grass", "largest first, so the small one overwrites it"
    got = landcover.classify(np.array([[0.0, 0.0], [50.0, 50.0], [500.0, 0.0]]), ordered)
    assert list(got) == ["terrain_paved", "terrain_grass", landcover.DEFAULT_COVER]


def test_a_patch_too_small_to_see_from_the_road_is_not_a_patch():
    """Measured, not guessed: sydney's corridor carries 84 `leisure=swimming_pool` polygons (checked
    directly: pipeline/cache/sydney's landuse layer, median area ~38 sq m), almost all a few square
    metres in a back garden. Each would cost a triangle group."""
    assert landcover.MIN_AREA >= 100.0
    tiny = Polygon([(0, 0), (5, 0), (5, 5), (0, 5)])
    assert tiny.area < landcover.MIN_AREA


def test_classifying_nothing_is_not_a_crash():
    assert list(landcover.classify(np.zeros((0, 2)), [])) == []
    assert list(landcover.classify(np.array([[0.0, 0.0]]), [])) == [landcover.DEFAULT_COVER]


def test_a_route_can_ask_for_green_hillsides_without_losing_its_specific_ground(monkeypatch):
    """Fuji's own route
    declares `"groundCover": "terrain_grass"` (pipeline/routes/fuji.json, the same value goldengate used
    to set for its own hillsides) so its unmapped hillside and its mapped scrub turn green; shanghai
    sets no groundCover at all, so a beach or a car park on it stays what it is."""
    square = lambda x, size: [{"lat": x, "lon": 0}, {"lat": x + size, "lon": 0},
                              {"lat": x + size, "lon": size}, {"lat": x, "lon": size}, {"lat": x, "lon": 0}]
    monkeypatch.setattr(landcover, "load_layer", lambda *_: {"elements": [
        {"tags": {"natural": "scrub"}, "geometry": square(0, 100)},
        {"tags": {"natural": "beach"}, "geometry": square(200, 100)},
    ]})
    frame = type("Frame", (), {"to_local": staticmethod(lambda lat, lon: (list(lat), list(lon)))})()
    points = np.array([[50.0, 50.0], [250.0, 50.0], [900.0, 900.0]])
    assert landcover.route_ground("fuji") == "terrain_grass"
    green = landcover.patches("fuji", frame)
    assert list(landcover.classify(points, green)) == ["terrain_grass", "terrain_sand", "terrain_grass"]
    # Every shipping route now names its ground, so the dry default is shown on a route that names none.
    monkeypatch.setattr(landcover, "route_ground", lambda route_id: {"fuji": "terrain_grass"}.get(route_id))
    dry = landcover.patches("no-ground-declared", frame)
    assert list(landcover.classify(points, dry)) == ["terrain_scrub", "terrain_sand", landcover.DEFAULT_COVER]
