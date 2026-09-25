"""The roof route must show the residential blocks already present in its OSM source."""
from collections import Counter

import numpy as np
from shapely import contains_xy
from sr.build import roof_support_details
from sr.route import build_route
from sr.routes import load_route
from sr.buildings import LEVEL_HEIGHT, estimate_height, extrude, footprint_by_osm_id, footprints
from sr.terrain import corridor_polygon
from sr.vistas import choose_roof


def test_roof_surroundings_include_cached_residential_neighborhoods():
    route = load_route("wolfe-pruneridge")
    res = build_route("wolfe-pruneridge")
    corridor = corridor_polygon(res, pad=route.get("terrainPadM", 300))
    homes = [poly for poly, tags in footprints("wolfe-pruneridge", res.frame,
             exclude_osm_ids=(route["roofLoop"]["osmRelation"],))
             if tags.get("building") in ("house", "detached", "residential", "apartments")]
    assert len(homes) > 200, "The cached OSM source must actually contain residential blocks"
    omitted = [poly for poly in homes if not contains_xy(corridor, poly.centroid.x, poly.centroid.y)]
    assert not omitted, f"{len(omitted)} known homes fall outside the generated neighborhood"


def test_real_cached_houses_receive_the_two_distinct_local_roof_mixes():
    results = {}
    for route_id in ("wolfe-pruneridge", "twin-peaks"):
        route = []
        for poly, tags in footprints(route_id, build_route(route_id).frame):
            use = str(tags.get("building", "")).lower()
            height = estimate_height(tags, poly.area)
            residential = use in ("house", "detached", "residential", "apartments", "terrace",
                                  "semidetached_house", "bungalow")
            residential |= use in ("yes", "") and poly.area <= 520 and height <= 3 * LEVEL_HEIGHT
            rect = poly.minimum_rotated_rectangle
            if residential and rect.area > 0 and poly.area / rect.area >= .94:
                route.append(choose_roof(route_id, f"{poly.centroid.x:.1f}:{poly.centroid.y:.1f}", near=True))
        results[route_id] = Counter(route)

    apple, twin = results["wolfe-pruneridge"], results["twin-peaks"]
    assert sum(apple.values()) >= 100 and apple["gable"] > apple["flat"] * 3
    assert sum(twin.values()) >= 1_500 and .45 < twin["flat"] / sum(twin.values()) < .55
    assert apple["hip"] > 20 and twin["gable"] > 500


def test_corporate_ring_windows_follow_each_curved_wall_below_a_windowless_top_band():
    route = load_route("wolfe-pruneridge")
    res = build_route("wolfe-pruneridge")
    poly, _tags = footprint_by_osm_id(route["id"], res.frame, route["roofLoop"]["osmRelation"])
    shell = extrude(poly, 0.0, 30.0, material="building_landmark_glass")
    wall = np.abs(shell.normals[:, 1]) < 1e-6
    top = wall & np.isclose(shell.positions[:, 1], 30.0)
    assert top.sum() > 100
    assert np.allclose(shell.uvs[top, 1], 10.0), "every curved segment keeps rows parallel to the roof"
    directions = np.unique(np.round(shell.normals[wall][:, [0, 2]], 2), axis=0)
    assert len(directions) > 20, "the window grid follows the ring instead of one world direction"

    details = roof_support_details(route, res, 30.0)
    band = details["roof_top_band"]
    assert band.material == "building_landmark_roof"
    assert band.positions[:, 1].min() == 27.0
    assert band.positions[:, 1].max() == 30.10
    assert np.allclose(band.uvs, .02)
