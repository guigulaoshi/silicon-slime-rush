"""A city's own ordinary buildings (sr/local_style.py): the route's description reaches the textures,
the footprint's type and the geometry, and nothing reaches a road."""
import json
import os

import numpy as np
from shapely.geometry import Polygon, box as rect

from sr import local_style as L

TYPE = {
    "share": 1, "storeyM": 3.0, "groundM": 4.0, "storeys": [4, 6], "tileBays": 2,
    "wall": {"kind": "stone", "colour": "#d9ceb6"},
    "window": {"shape": "tall", "w": 1.2, "h": 2.2, "bay": 3.2, "sill": .3, "frame": "#efe9df",
               "balcony": {"kind": "iron"}, "shutters": {"colour": "#557060"}},
    "ground": {"kind": "shops"},
    "roof": {"kind": "mansard", "material": "zinc", "colour": "#6f7880"},
    "details": {"chimneys": 1, "prayerFlags": 1, "waterTanks": 1},
}


def test_the_types_get_slots_and_a_fourth_is_refused():
    route = {"id": "x", "architecture": {"local": {"types": [TYPE, TYPE]}}}
    assert [t["slot"] for t in L.types(route)] == ["a", "b"]
    try:
        L.types({"id": "x", "architecture": {"local": {"types": [TYPE] * 4}}})
    except ValueError:
        pass
    else:
        raise AssertionError("four types should be refused")
    assert L.types({"id": "x"}) == []


def test_a_type_is_chosen_only_where_its_when_fits_and_by_share():
    tall = {**TYPE, "when": {"minStoreys": 10}, "slot": "a"}
    low = {**TYPE, "when": {"maxStoreys": 8}, "slot": "b"}
    assert L.choose([tall, low], {}, 3, 200, (0, 0))["slot"] == "b"
    assert L.choose([tall, low], {}, 20, 200, (0, 0))["slot"] == "a"
    assert L.choose([tall], {}, 3, 200, (0, 0)) is None
    half = [{**TYPE, "slot": "a", "share": 1}, {**TYPE, "slot": "b", "share": 1}]
    picks = [L.choose(half, {}, 3, 100, (x * 7.3, x * 3.1))["slot"] for x in range(400)]
    assert 150 < picks.count("a") < 250


def test_an_untagged_footprint_takes_the_types_storeys_and_a_tagged_one_keeps_its_height():
    ground, n, total = L.storeys_for({**TYPE, "slot": "a"}, None, 7.0, (1.0, 2.0))
    assert ground == 4.0 and 4 <= n + 1 <= 6 and total == ground + n * 3.0
    assert L.storeys_for({**TYPE, "slot": "a"}, 31.0, 7.0, (1.0, 2.0))[1] == 9


def test_every_texture_is_written_with_a_repeat_that_matches_what_it_depicts(tmp_path):
    route = {"id": "x", "architecture": {"local": {"types": [TYPE]}}}
    manifest = L.write_textures(route, str(tmp_path))
    names = {e["material"] for e in manifest["textures"]}
    assert names == {"building_local_wall_a", "building_local_ground_a", "local_roof_a", "local_flags", "local_rail"}
    wall = next(e for e in manifest["textures"] if e["material"] == "building_local_wall_a")
    # two bays of 3.2 m across, one 3 m storey down, in uv units of 3 m
    assert wall["repeat"] == [round(3 / 6.4, 4), 1.0]
    assert wall["facadePanes"][0] == 2
    for e in manifest["textures"]:
        assert os.path.getsize(tmp_path / e["map"]) == e["bytes"] > 0
    assert json.load(open(tmp_path / "manifest.json")) == manifest


def test_the_window_tile_really_has_windows_and_the_flags_really_have_five_colours():
    c, W, H, panes = L.wall_tile({**TYPE, "slot": "a"})
    img = np.asarray(c.image(), dtype=float) / 255
    wall, window = img[img.shape[0] // 3, 5], img[img.shape[0] // 3, img.shape[1] // 4 + 24]  # beside the mullion
    assert np.abs(wall - window).sum() > .3            # a window is not the wall colour
    flags, W, H = L.flags_tile()
    rgba = np.asarray(flags)
    cloth = rgba[rgba.shape[0] // 2]
    seen = {tuple((px[:3] // 40).tolist()) for px in cloth if px[3] > 200}
    assert len(seen) >= 5


def test_rooftop_and_street_parts_stay_on_the_building_and_off_the_road():
    poly = rect(0, 0, 14, 10)
    t = {**TYPE, "slot": "a", "details": {"waterTower": 1, "waterTanks": 1, "prayerFlags": 1,
                                          "columnStubs": 1, "bayWindow": 1, "veranda": 1}}
    parts = L.rooftop(poly, 20.0, t, (3.0, 4.0), True, 6)
    assert parts and all(p.positions[:, 1].min() >= 19.9 for p in parts)
    footprint = poly.buffer(.5)
    for p in parts:
        assert footprint.contains(Polygon(p.positions[:, [0, 2]]).convex_hull)
    road = rect(-10, -30, 30, -2)
    front = L.facade_parts(poly, 0.0, 4.0, 3.0, 5, t, (3.0, 4.0), towards=(7, -20), keep_clear=road)
    for p in front:
        assert not Polygon(p.positions[:, [0, 2]]).convex_hull.intersects(road)
    assert {p.material for p in parts} <= {L.DETAIL_DARK, L.DETAIL_LIGHT, L.FLAGS}


def test_a_mansard_steps_in_and_its_roof_carries_uv_in_metres():
    parts = L.mansard_parts((0, 10, 0), (6, 4), 0.0, 2.8, .9, .7, "local_roof_a")
    tops = max(float(p.positions[:, 1].max()) for p in parts)
    assert abs(tops - (10 + 2.8 + .7)) < 1e-4
    for p in parts:
        L.planar_uv(p)
        assert np.ptp(p.uvs[:, 0]) > 1          # metres over 3, not the constant roof uv
