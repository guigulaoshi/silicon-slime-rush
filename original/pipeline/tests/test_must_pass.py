"""Every campus route has to go past the buildings it exists to show.

A route named after a road can follow that road and still miss the point: Shoreline listed
Amphitheatre Parkway as a waypoint and passed the main buildings 541 m away, because the waypoint
picked the far end of the road. Nobody found out by reading the file -- someone drove it and did not
recognise anything. So the claim is written down and the build measures it.
"""
import json
import os

import numpy as np
import pytest

from sr.fetch_osm import CACHE_DIR
from sr.route import must_pass
from sr.routes import ROUTES_DIR, all_route_ids, load_route

CAMPUS = [r for r in all_route_ids() if load_route(r).get("category") == "campus"]


def test_every_campus_route_declares_what_it_shows():
    """The point of a campus route is recognising your own building; a route that claims nothing
    cannot be checked, and 'we forgot' would look exactly like 'there is nothing to see'."""
    for rid in CAMPUS:
        items = load_route(rid).get("mustPass")
        assert items, f"{rid} is a campus route with no mustPass list"
        for item in items:
            assert {"name", "lat", "lon"} <= set(item), f"{rid}: {item}"
            assert 50 <= float(item.get("maxDistM", 120)) <= 2000, f"{rid}: {item['name']}"


def test_must_pass_names_never_reach_the_game():
    """They are notes for whoever edits the route. Track names use place and street names only --
This is the check that keeps a company name out of a shipped string."""
    names = " ".join(i["name"] for r in CAMPUS for i in load_route(r).get("mustPass", ())).lower()
    for banned in ("google", "apple", "meta", "facebook", "nvidia", "oracle", "stanford", "berkeley"):
        assert banned not in names, f"{banned!r} in a mustPass name; use what it looks like instead"


def test_must_pass_measures_the_distance_to_the_racing_line():
    """A straight route along +x: something beside it is close, something a kilometre away is not."""
    from tests.test_terrain import straight_route
    res = straight_route(length=1000.0)
    lat, lon = res.frame.to_latlon(np.array([0.0, 0.0]), np.array([80.0, 1500.0]))
    route = {"mustPass": [
        {"name": "near", "lat": float(lat[0]), "lon": float(lon[0]), "maxDistM": 120},
        {"name": "far", "lat": float(lat[1]), "lon": float(lon[1]), "maxDistM": 120},
    ]}
    near, far = must_pass(res, route)
    assert near["ok"] and near["dist"] < 120
    assert not far["ok"] and far["dist"] > 1000


def test_a_route_with_no_claims_reports_nothing_rather_than_failing():
    from tests.test_terrain import straight_route
    assert must_pass(straight_route(), {}) == []


@pytest.mark.parametrize("rid", CAMPUS)
def test_the_racing_line_really_goes_past_them(rid):
    """The build refuses a route that misses; this is the same check, run without building."""
    if not os.path.exists(os.path.join(CACHE_DIR, rid, "roads.json.gz")):
        pytest.skip(f"no cache for {rid}")
    from sr.route import build_route
    misses = [c for c in must_pass(build_route(rid), load_route(rid)) if not c["ok"]]
    assert not misses, "; ".join(f"{c['name']} at {c['dist']:.0f} m > {c['limit']:.0f}" for c in misses)


def test_route_files_stay_valid_json_with_the_new_field():
    for rid in all_route_ids():
        with open(os.path.join(ROUTES_DIR, f"{rid}.json"), encoding="utf-8") as f:
            json.load(f)
