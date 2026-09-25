"""The opening map's geometry: shoreline in, water polygons out.

Every failure this module can have is silent. A coastline joined the wrong way, a ring closed the
wrong way round the frame, and the menu draws a Bay Area where San Jose is under water -- no
exception, no warning, just a map that lies. So the tests here ask about *sides*: which places end
up wet.
"""
import json
import os

import pytest

from sr import menumap as M

RECT = (0.0, 0.0, 10.0, 10.0)          # s, w, n, e -- a plain square frame for the unit tests


def wet(rings, pt):
    """Ray casting, the same question the runtime asks when it fills a ring."""
    x, y = pt
    hits = 0
    for ring in rings:
        odd = False
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                odd = not odd
        hits += odd
    return hits % 2 == 1


def test_chains_join_forwards_and_backwards():
    # The middle way is listed first on purpose: joining forwards only would leave the shoreline in
    # two, and the half ending inside the frame has no boundary crossing to close a polygon against.
    mid = [(2.0, 5.0), (5.0, 5.0)]
    head = [(-1.0, 5.0), (2.0, 5.0)]
    tail = [(5.0, 5.0), (11.0, 5.0)]
    joined = M.chains([mid, head, tail])
    assert len(joined) == 1
    assert joined[0][0] == (-1.0, 5.0) and joined[0][-1] == (11.0, 5.0)


def test_clip_chain_cuts_at_the_frame():
    piece, = M.clip_chain([(-1.0, 5.0), (11.0, 5.0)], RECT)
    assert piece[0] == pytest.approx((0.0, 5.0))
    assert piece[-1] == pytest.approx((10.0, 5.0))


def test_water_is_on_the_right_of_the_shoreline():
    # OSM's rule: land on the left of the way's direction. Travelling east means land to the north,
    # water to the south. Getting this backwards floods the continent and nothing throws.
    water, islands = M.water_rings([[(-1.0, 5.0), (11.0, 5.0)]], RECT)
    assert not islands
    assert wet(water, (5.0, 2.0)) and not wet(water, (5.0, 8.0))


def test_reversing_the_shoreline_swaps_the_sides():
    water, _ = M.water_rings([[(11.0, 5.0), (-1.0, 5.0)]], RECT)
    assert wet(water, (5.0, 8.0)) and not wet(water, (5.0, 2.0))


def test_a_closed_way_inside_the_frame_is_an_island():
    island = [(4.0, 4.0), (6.0, 4.0), (6.0, 6.0), (4.0, 6.0), (4.0, 4.0)]
    water, islands = M.water_rings([[(-1.0, 5.0), (11.0, 5.0)], island], RECT)
    assert len(islands) == 1 and islands[0][0] == islands[0][-1]
    assert water                                   # the shoreline still makes its own ring


def test_simplify_ring_keeps_a_ring():
    # Straight through `simplify`, a ring collapses to two points: its first and last point are the
    # same, so every distance from that zero-length base line comes out zero.
    ring = [(0.0, 0.0), (4.0, 0.1), (8.0, 0.0), (8.0, 8.0), (0.0, 8.0), (0.0, 0.0)]
    kept = M.simplify_ring(ring, 0.5)
    assert 4 <= len(kept) <= len(ring)
    assert kept[0] == kept[-1]
    assert (4.0, 0.1) not in kept                  # the near-straight point is the one it may drop


@pytest.mark.skipif(not os.path.exists(M.LAND_CACHE), reason="world land not generated")
@pytest.mark.skipif(not os.path.exists(M.LAND_CACHE)
                    or not os.path.isdir(os.path.join(M.ROOT, "game", "public", "tracks")),
                    reason="needs the world land and built tracks")
def test_the_cli_command_runs(tmp_path, capsys):
    """The one command that regenerates the map, actually run.

    It was the only path here with no test, and it was broken: `build` stopped returning `coast`
    and the summary line still read `doc["coast"]`, so the command wrote the file and then died
    with a KeyError. Nothing else in the repository would have noticed.
    """
    from sr import cli
    out = tmp_path / "menu-map.json"
    assert cli.main(["menu-map", "--out", str(out)]) == 0
    assert "water rings" in capsys.readouterr().out
    assert json.loads(out.read_text())["version"] == 5


@pytest.mark.skipif(not os.path.exists(M.LAND_CACHE), reason="world land not generated")
def test_loop_distance_is_the_whole_race_and_not_one_lap(tmp_path):
    tracks = tmp_path / "tracks"
    route = tracks / "ring"
    route.mkdir(parents=True)
    (route / "track.json").write_text(json.dumps({
        "id": "ring", "category": "campus", "laps": 3,
        "origin": {"lat": 37.3, "lon": -122.0},
        "spline": {"length": 1326.0, "points": [[i * 10.0, 0.0, 0.0] for i in range(30)]},
        "checkpoints": [{}, {}, {}],
    }))
    doc = M.build(tracks_root=str(tracks))
    assert doc["routes"] == [{
        "id": "ring", "category": "campus", "km": 3.98, "checkpoints": 3,
        "line": M.route_line(json.loads((route / "track.json").read_text())),
        "streets": [],
    }]
    assert doc["places"] == [{"id": "ring", "lon": -122.0, "lat": 37.3}]    # one pin per city, at its origin


def test_nearby_streets_share_the_routes_real_world_coordinates(tmp_path):
    track = {
        "origin": {"lat": 37.4, "lon": -122.1},
        "spline": {"points": [[0.0, 0.0, 0.0], [100.0, 0.0, 0.0]]},
    }
    map_path = tmp_path / "map.json"
    map_path.write_text(json.dumps({"roads": [
        {"c": "b", "p": [0, 10, 100, 10]},
        {"c": "c", "p": [1000, 1000, 1100, 1000]},
    ]}))
    assert M.nearby_streets(track, map_path) == [{
        "class": "b", "line": M.local_line(track, [[0, 10], [100, 10]]),
    }]


@pytest.mark.skipif(not os.path.exists(M.OUT), reason="menu-map.json not built")
def test_the_written_document_is_the_world_with_its_seas_the_right_way_round():
    with open(M.OUT, encoding="utf-8") as fh:
        doc = json.load(fh)
    assert doc["version"] == 5 and doc["world"] is True and doc["region"] == list(M.REGION)
    # Land is the continents; `water` is the seas they close round, painted back over the land.
    for place, pt in {"Sahara": (10.0, 23.0), "Tibet": (88.0, 32.0), "Amazon": (-60.0, -5.0),
                      "outback": (133.0, -25.0)}.items():
        assert wet(doc["land"], pt) and not wet(doc["water"], pt), place
    for place, pt in {"Mediterranean": (18.0, 35.0), "Black Sea": (34.0, 43.5), "Caspian": (51.0, 42.0)}.items():
        assert wet(doc["water"], pt), place
    for place, pt in {"mid-Atlantic": (-35.0, 20.0), "Indian Ocean": (75.0, -20.0)}.items():
        assert not wet(doc["land"], pt), place
    # One pin per route, no duplicates, all inside the frame.
    assert sorted(p["id"] for p in doc["places"]) == sorted(r["id"] for r in doc["routes"])
    s, w, n, e = M.REGION
    for ring in doc["water"] + doc["land"]:
        for x, y in ring:
            assert w - 1e-6 <= x <= e + 1e-6 and s - 1e-6 <= y <= n + 1e-6
