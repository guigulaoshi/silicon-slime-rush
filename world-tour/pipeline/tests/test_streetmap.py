"""The street network the map panels draw."""
import json
import os

import numpy as np

from sr.streetmap import MIN_LENGTH, road_class, street_map, write
from tests.test_terrain import straight_route


class FakeWay:
    def __init__(self, highway, name, xy):
        self.highway = highway
        self.name = name
        self.xy = np.asarray(xy, dtype=float)


def route_with_ways(ways):
    res = straight_route(length=600.0)
    res.ways = ways
    return res


def test_road_class_collapses_osm_into_three_weights():
    assert road_class("motorway") == "a"
    assert road_class("trunk_link") == "a"
    assert road_class("primary") == "b"
    assert road_class("residential") == "c"
    assert road_class("service") == "c"


def test_a_way_becomes_a_polyline_with_its_name_and_class():
    line = [[0.0, 0.0], [100.0, 0.0], [200.0, 5.0]]
    doc = street_map(route_with_ways([FakeWay("primary", "Amphitheatre Parkway", line)]))
    assert len(doc["roads"]) == 1
    road = doc["roads"][0]
    assert road["c"] == "b"
    assert road["n"] == "Amphitheatre Parkway"
    assert len(road["p"]) % 2 == 0 and len(road["p"]) >= 4
    assert all(isinstance(v, int) for v in road["p"]), "metres, not centimetres: this file is drawn small"


def test_pavements_and_junction_stubs_are_left_out():
    """A 150 pixel panel cannot draw a footpath, and a five metre stub is noise around a junction."""
    stub = [[0.0, 0.0], [MIN_LENGTH / 3, 0.0]]
    long_path = [[0.0, 50.0], [400.0, 50.0]]
    doc = street_map(route_with_ways([
        FakeWay("residential", "Kept Street", [[0.0, 0.0], [400.0, 0.0]]),
        FakeWay("residential", "Stub", stub),
        FakeWay("footway", "A Path", long_path),
    ]))
    assert [r.get("n") for r in doc["roads"]] == ["Kept Street"]


def test_a_straight_run_is_thinned_to_its_ends():
    """Simplification is most of why this file is small: a straight road is two points."""
    dense = [[float(x), 0.0] for x in range(0, 400, 5)]
    doc = street_map(route_with_ways([FakeWay("residential", "Straight", dense)]))
    assert len(doc["roads"][0]["p"]) == 4, doc["roads"][0]["p"]


def test_bounds_cover_every_road_drawn():
    doc = street_map(route_with_ways([
        FakeWay("residential", "A", [[-50.0, -20.0], [300.0, -20.0]]),
        FakeWay("residential", "B", [[10.0, 0.0], [10.0, 240.0]]),
    ]))
    assert doc["bounds"] == [-50, -20, 300, 240]


def test_the_racing_line_travels_with_the_map():
    """Both panels draw the route on top of the streets, so it lives in the same file."""
    res = route_with_ways([FakeWay("residential", "A", [[0.0, 0.0], [400.0, 0.0]])])
    doc = street_map(res)
    assert len(doc["line"]) >= 4
    assert doc["closed"] is False


def test_the_file_stays_small_enough_to_ship_with_every_track(tmp_path):
    """Twenty kilometres of street is a big route's worth, and it has to cost nothing to download."""
    ways = []
    for k in range(50):
        z = float(k * 40)
        ways.append(FakeWay("residential", f"Street {k}", [[0.0, z], [400.0, z], [800.0, z + 10]]))
    doc = street_map(route_with_ways(ways))
    size = write(os.path.join(tmp_path, "map.json"), doc)
    assert size < 60_000, f"{size} bytes for 50 streets"
    with open(os.path.join(tmp_path, "map.json"), encoding="utf-8") as f:
        assert json.load(f)["roads"], "and it has to be readable afterwards"
