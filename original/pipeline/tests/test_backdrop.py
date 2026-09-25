import os

import numpy as np
from shapely.geometry import Polygon, Point
import pytest

from sr.backdrop import (FAR_SPACING, NEAR_RADIUS, NEAR_SPACING, WATER_SINK, sample_grid,
                        terrain)
from sr.fetch_osm import CACHE_DIR
from tests.test_terrain import FakeDem, straight_route

HAS_CACHE = os.path.exists(os.path.join(CACHE_DIR, "goldengate", "backdrop.json.gz"))


def test_the_grid_leaves_the_corridor_alone():
    """The streamed tiles already cover that ground at 2.5 m. Two meshes of the same hillside at
    different resolutions z-fight the whole way along."""
    res = straight_route(length=1000.0)
    pad = 340.0
    xz = sample_grid(res, 4000.0, pad)
    d = np.abs(xz[:, 1])                       # route runs along x, so |z| is distance from it
    near_route = (xz[:, 0] > 100) & (xz[:, 0] < 900)
    assert (d[near_route] >= pad - 1e-6).all()


def test_the_grid_is_fine_near_the_route_and_coarse_far_away():
    res = straight_route(length=1000.0)
    xz = sample_grid(res, 4000.0, 340.0)
    d = np.abs(xz[:, 1])          # route runs along x, so |z| is distance from it
    # One column at a time, and one side only: the middle is the corridor hole, and that gap is the
    # whole point of the corridor. The two lattices do not share columns, so they are read apart.
    near = xz[(d > 400) & (d < NEAR_RADIUS)]
    fine = np.unique(np.round(near[np.abs(near[:, 0] - 500) < 1][:, 1], 3))
    fine = fine[fine > 0]
    far = xz[d > NEAR_RADIUS + FAR_SPACING]
    coarse = np.unique(np.round(far[np.abs(far[:, 0] - 600) < 1][:, 1], 3))
    assert len(fine) > 5 and len(coarse) > 5
    assert np.diff(np.sort(fine)).max() <= NEAR_SPACING + 1e-6
    assert np.diff(np.sort(coarse)).min() >= FAR_SPACING - 1e-6
    assert len(xz) < 40_000, "the backdrop is resident, so it has to stay small"


def test_the_grid_reaches_the_radius_and_no_further():
    res = straight_route(length=1000.0)
    radius = 3000.0
    xz = sample_grid(res, radius, 340.0)
    assert np.abs(xz[:, 1]).max() <= radius + FAR_SPACING
    assert np.abs(xz[:, 1]).max() > radius * 0.9


def test_land_and_sea_come_out_as_separate_meshes_at_the_right_heights():
    res = straight_route(length=1000.0)
    dem = FakeDem(res.frame, lambda x, z: np.where(np.abs(z) > 1200, -30.0, 40.0))
    # `terrain` returns the land as a list now: one mesh per kind of ground when land use says so
    #And one called `terrain` when nothing does -- which is this fixture's case.
    land, sea = terrain(res, dem, 3000.0, 340.0, water_level=0.0)
    assert len(land) == 1 and sea is not None
    land = land[0]
    assert land.material == "terrain" and sea.material == "water"
    # A hair under the water level, never at it: the streamed corridor's own sea is flat at exactly
    # the water level and the two overlap by design, so equal heights would z-fight.
    assert np.allclose(sea.positions[:, 1], -WATER_SINK)
    assert 0.0 < WATER_SINK < 0.1
    assert land.positions[:, 1].max() == pytest.approx(40.0, abs=0.5)


def test_a_route_with_no_water_gets_no_sea_mesh():
    res = straight_route(length=1000.0)
    dry = FakeDem(res.frame, lambda x, z: np.full(np.shape(x), 25.0))
    land, sea = terrain(res, dry, 3000.0, 340.0)
    assert len(land) == 1 and sea is None


def test_every_official_route_has_one_cited_vista_profile():
    from sr.routes import all_route_ids, load_route
    from sr.vistas import PROFILES

    route_ids = set(all_route_ids())
    assert set(PROFILES) == route_ids
    assert all(profile.source_key for profile in PROFILES.values())
    assert all(abs(sum(share for _, share in profile.far_roofs) - 1.0) < 1e-9
               for profile in PROFILES.values())
    assert all(abs(sum(share for _, share in profile.near_roofs) - 1.0) < 1e-9
               for profile in PROFILES.values())
    assert all(PROFILES[route_id].near_m <= load_route(route_id).get("terrainPadM", 300)
               for route_id in route_ids), "low-rise massing must overlap the streamed scenery band"


def test_local_roof_mixes_make_cupertino_and_twin_peaks_visibly_different():
    from collections import Counter
    from sr.vistas import choose_roof

    samples = {route: Counter(choose_roof(route, i, near=True) for i in range(10_000))
               for route in ("wolfe-pruneridge", "twin-peaks")}
    apple, twin = samples["wolfe-pruneridge"], samples["twin-peaks"]
    assert apple["flat"] / 10_000 < .16 and apple["gable"] / 10_000 > .56
    assert .48 < twin["flat"] / 10_000 < .52
    assert twin["gable"] > 2_500 and twin["hip"] > 1_200


def test_open_land_masks_keep_houses_off_waterfronts_airfield_and_peak():
    from sr.vistas import settlement_mask

    assert settlement_mask("shoreline", [37.435, 37.420], [-122.08, -122.08]).tolist() == [False, True]
    assert settlement_mask("moffett-field", [37.413, 37.403], [-122.052, -122.052]).tolist() == [False, True]


def test_backdrop_roads_never_flatten_bridges_or_tunnels_onto_the_dem(monkeypatch):
    import sr.backdrop as backdrop

    res = straight_route(length=1000.0)
    dem = FakeDem(res.frame, lambda x, z: np.full(np.shape(x), 20.0))
    def way(osm_id, tags, z):
        lat, lon = res.frame.to_latlon(np.array([-200.0, 1200.0]), np.array([z, z]))
        return {"id": osm_id, "tags": {"highway": "primary", **tags}, "geometry": [
            {"lat": float(a), "lon": float(b)} for a, b in zip(lat, lon)]}
    monkeypatch.setattr(backdrop, "load_layer", lambda *_: {"elements": [
        way(1, {}, 500.0), way(2, {"bridge": "yes"}, 650.0), way(3, {"tunnel": "yes"}, 800.0)]})
    mesh, footprints = backdrop.arterial_roads(res, dem, "test", 100.0)
    assert mesh is not None and footprints is not None
    assert mesh.positions[:, 2].min() < 550 and mesh.positions[:, 2].max() < 550


def test_route_fallback_replaces_unmapped_tan_without_overwriting_known_cover():
    res = straight_route(length=1000.0)
    dem = FakeDem(res.frame, lambda x, z: np.full(np.shape(x), 25.0))
    grass = Polygon([(-4000, -4000), (0, -4000), (0, 4000), (-4000, 4000)])
    land, _ = terrain(res, dem, 2000.0, 340.0, cover=[("terrain_grass", grass)],
                      fallback="terrain_scrub")
    assert {mesh.material for mesh in land} == {"terrain_grass", "terrain_scrub"}


@pytest.mark.skipif(not HAS_CACHE, reason="needs the goldengate backdrop cache")
def test_goldengate_backdrop_has_hills_water_and_a_skyline():
    from sr.backdrop import build
    from sr.dem import DemSampler
    from sr.fetch_dem import BACKDROP_ZOOM
    from sr.route import build_route

    out = build(build_route("goldengate"), "goldengate", DemSampler(BACKDROP_ZOOM))
    assert {"backdrop_terrain", "backdrop_water"} <= set(out)
    assert any(k.startswith("backdrop_buildings_") for k in out), sorted(out)
    # the route asks for Alcatraz and Sutro Tower, and they ride along in the backdrop
    assert any(k.startswith("backdrop_landmark") for k in out), sorted(out)
    total = sum(m.triangle_count for m in out.values())
    # Whole-scene limits belong to tools/resource_limits.json and the real renderer probe.
    # The retired per-backdrop cap would reject the explicitly approved richer architecture.
    assert total > 0
    assert out["backdrop_water"].triangle_count > 1000, "half the view from the bridge is water"


def test_the_backdrop_never_gets_a_collider():
    """Its nodes are named so the contract's table resolves them to nothing: it is scenery, and a
    thirty thousand triangle collider around the whole route would be paid for on every step."""
    from sr.export import collider_for
    for node in ("backdrop_terrain", "backdrop_water", "backdrop_buildings_building_glass"):
        assert collider_for(node) == "none"


def test_an_unknown_landmark_is_an_error_rather_than_silence():
    """A typo in a route file should stop the build, not quietly leave the skyline empty."""
    import pytest as _pytest
    from sr.landmarks import build as build_landmarks
    from tests.test_terrain import FakeDem, straight_route
    res = straight_route()
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))
    assert build_landmarks(None, res.frame, dem) is None
    assert build_landmarks([], res.frame, dem) is None
    with _pytest.raises(KeyError):
        build_landmarks(["no-such-place"], res.frame, dem)


def test_fishermans_wharf_bridges_keep_real_axes_scale_and_distinct_colours():
    """The two bridges are geographic landmarks, so moving either closer for visibility is a bug."""
    from sr.landmarks import BAY_BRIDGE_WEST, GOLDEN_GATE, build as build_landmarks
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route()
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))
    golden = build_landmarks(["golden-gate-bridge"], res.frame, dem)
    bay = build_landmarks(["bay-bridge-west"], res.frame, dem)
    assert set(golden) == {"landmark_steel"}, "Golden Gate alone must be International Orange"
    assert {"landmark_bridge_metal", "landmark_pale"} == set(bay), "Bay Bridge must stay grey"

    def distance(a, b):
        x, z = res.frame.to_local([a[0], b[0]], [a[1], b[1]])
        return float(np.hypot(x[1] - x[0], z[1] - z[0]))

    assert distance(*GOLDEN_GATE["towers"]) == pytest.approx(1280.0, abs=18.0)
    assert distance(BAY_BRIDGE_WEST["anchors"][0], BAY_BRIDGE_WEST["anchors"][-1]) \
        == pytest.approx(3140.0, abs=35.0)
    assert golden["landmark_steel"].bounds()[1][1] == pytest.approx(227.0, abs=3.0)
    assert bay["landmark_bridge_metal"].bounds()[1][1] == pytest.approx(160.0, abs=3.0)

    # Literal map points keep this independent of the generator's constants: equal-length bridges
    # translated or rotated elsewhere in the bay must fail.
    for mesh, points, crown in (
        (golden["landmark_steel"], ((37.81406, -122.47768), (37.82550, -122.47920)), 220.0),
        (bay["landmark_bridge_metal"], ((37.78892, -122.38776), (37.79376, -122.38258),
                                         (37.80078, -122.37506), (37.80562, -122.36988)), 153.0),
    ):
        x, z = res.frame.to_local([p[0] for p in points], [p[1] for p in points])
        high = mesh.positions[mesh.positions[:, 1] >= crown][:, [0, 2]]
        for tx, tz in zip(x, z):
            assert np.min(np.linalg.norm(high - np.array([tx, tz]), axis=1)) < 22.0


def test_fishermans_wharf_route_asks_for_its_three_act_landmark_sequence():
    from sr.routes import load_route

    assert load_route("fishermans-wharf")["landmarks"] == [
        "alcatraz", "golden-gate-bridge", "bay-bridge-west"]


def test_landmarks_are_a_silhouette_not_a_slab():
    """Sutro Tower is 297 m of open lattice: three legs and two crossbars is the whole shape, and a
    solid model at this range reads as a wall."""
    from sr.landmarks import build as build_landmarks
    from tests.test_terrain import FakeDem, straight_route
    res = straight_route()
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))
    out = build_landmarks(["sutro-tower"], res.frame, dem)
    red, white = out["landmark_steel"], out["landmark_roof"]
    lo = np.minimum(red.bounds()[0], white.bounds()[0])
    hi = np.maximum(red.bounds()[1], white.bounds()[1])
    assert hi[1] > 250.0, "the tower has to be tall enough to be the tower"
    assert red.triangle_count + white.triangle_count < 1800, "it is an open lattice, not a solid slab"
    assert red.bounds()[1][1] - red.bounds()[0][1] > 220.0
    assert white.bounds()[1][1] - white.bounds()[0][1] > 220.0, \
        "aviation bands must alternate through the whole tower, not only at its crown"


def test_osm_landmark_specs_are_valid_and_each_used_by_a_route():
    from sr.landmark_data import entries, footprints
    from sr.routes import all_route_ids, load_route
    from tests.test_terrain import straight_route

    specs = entries()
    assert set(specs) == {"twin-peaks-overlook", "charleston-canopy",
                          "hangar-one",
                          "moffett-fighter", "moffett-rescue-helicopter",
                          "moffett-rescue-transport", "moffett-f22-raptor",
                          "moffett-f16-falcon", "moffett-ah64-apache",
                          "moffett-v22-osprey"}
    used = {name for route in all_route_ids()
            for name in load_route(route).get("landmarks", [])}
    assert set(specs) <= used
    assert len(footprints(straight_route().frame)) == sum("footprint" in spec for spec in specs.values())
    assert all(spec["source"] for spec in specs.values())
    features = {feature for spec in specs.values() for feature in spec["features"]}
    assert {"overlook", "catenary-canopy", "photovoltaic-canopy", "clerestory",
            "hangar", "stealth", "single-engine",
            "attack-helicopter", "tiltrotor"} <= features


def test_campus_landmarks_keep_their_distinct_silhouettes():
    from sr.landmarks import build as build_landmarks
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route()
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))
    # Detailed canopy and hangar now come from their authored GLBs; no duplicate backdrop shell.
    assert build_landmarks(["charleston-canopy", "hangar-one"], res.frame, dem) is None

    overlook = build_landmarks(["twin-peaks-overlook"], res.frame, dem)
    deck = overlook["landmark_pale"]
    assert deck.bounds()[1][1] <= 0.5, \
        "only the thin deck and low coping may be solid; the viewpoint stays open"
    assert overlook["landmark_metal"].triangle_count > 400, \
        "all four sides need open rails with visible posts"


def test_authored_building_pivots_stay_inside_the_original_osm_exclusions():
    from sr.landmark_data import entries, model_anchor, footprints
    from sr.geo import LocalFrame
    for name in ("charleston-canopy", "hangar-one"):
        entry = entries()[name]
        assert entry["kind"] == "glb"
        frame = LocalFrame(*entry["footprint"][0])
        lat, lon = model_anchor(entry)
        x, z = frame.to_local(lat, lon)
        poly = footprints(frame, names=[name])[0]
        assert poly.centroid.distance(Point(float(x), float(z))) < .001
        assert entry["loadRadius"] >= 1800


def test_every_programmatic_landmark_material_is_made_only_of_closed_solids():
    """A backdrop landmark with one unmatched edge becomes a flat sheet from the other side."""
    from collections import Counter
    from sr.landmark_data import entries
    from sr.landmarks import build as build_landmarks
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route()
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))
    # Independently loaded GLBs have the same edge check on their actual exports in
    # game/test/landmark-assets.test.ts; build_landmarks only returns baked programmatic meshes.
    names = ["alcatraz", "sutro-tower", "golden-gate-bridge", "bay-bridge-west",
             *[name for name, entry in entries().items() if entry["kind"] != "glb"]]
    for name in names:
        for node, mesh in build_landmarks([name], res.frame, dem).items():
            points = [tuple(np.round(point, 5)) for point in mesh.positions]
            edges = Counter()
            for tri in np.asarray(mesh.indices).reshape(-1, 3):
                for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                    edges[tuple(sorted((points[a], points[b])))] += 1
            open_edges = [edge for edge, count in edges.items() if count % 2]
            assert not open_edges, f"{name}/{node} has {len(open_edges)} open geometric edges"


def test_alcatraz_cellhouse_is_buried_into_coarse_island_terrain():
    """The hand-built ridge height must not make the prison hover above a low-resolution DEM."""
    from sr.landmarks import build as build_landmarks
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route()
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))
    pale = build_landmarks(["alcatraz"], res.frame, dem)["landmark_pale"]
    assert pale.positions[:, 1].min() < 0.0
    x, z = res.frame.to_local(np.array([37.82670]), np.array([-122.42300]))
    cellhouse = np.linalg.norm(pale.positions[:, [0, 2]] - np.array([x[0], z[0]]), axis=1) < 75.0
    assert pale.positions[cellhouse, 1].max() >= 34.0, \
        "the cellhouse upper storeys must remain visible above the island ridge"
    glass = build_landmarks(["alcatraz"], res.frame, dem)["landmark_glass"]
    assert glass.triangle_count >= 1300, \
        "phone-distance recognition needs three rows of cellhouse windows plus the lighthouse"


def test_alcatraz_route_view_sees_the_long_cellhouse_facade():
    """The Fisherman's Wharf route must not look straight into a generic square end wall."""
    from sr.landmarks import MATERIAL_PALE, alcatraz
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route()
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))
    pale = [mesh for mesh in alcatraz(res.frame, dem) if mesh.material == MATERIAL_PALE]
    cellhouse = max(pale, key=lambda mesh: np.ptp(mesh.positions[:, 0]) * np.ptp(mesh.positions[:, 2]))
    xz = np.unique(cellhouse.positions[:, [0, 2]], axis=0)
    covariance = np.cov(xz - xz.mean(axis=0), rowvar=False)
    long_axis = np.linalg.eigh(covariance)[1][:, -1]
    target_x, target_z = res.frame.to_local(np.array([37.82670]), np.array([-122.42300]))
    view_x, view_z = res.frame.to_local(np.array([37.80856463]), np.array([-122.41246696]))
    sight = np.array([view_x[0] - target_x[0], view_z[0] - target_z[0]])
    sight /= np.linalg.norm(sight)
    assert abs(float(long_axis @ sight)) < 0.35, \
        "the cellhouse long axis must cross the route sight line so its facade is visible"


def test_no_backdrop_geometry_is_stretched_over_the_route():
    """Delaunay triangulates a point cloud, not a polygon with a hole.

    Dropping the sample points inside the corridor is not enough: given a six-hundred-metre gap the
    triangulation joins one side to the other, and the result is a sheet of coarse hillside stretched
    straight over the road. On Shoreline it sat two thirds of a metre above the tarmac and the race
    started on grass -- the car was on the road the whole time, under a lid. Centroids alone do not
    catch it, because a long thin triangle spanning the gap has its centroid out on the far side.
    """
    import numpy as np
    from scipy.spatial import cKDTree

    from sr.backdrop import PROBE_SLACK, terrain
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=3000.0)
    res.P[:, 1] = 0.0
    pad = 280.0
    # a hillside that rises away from the road, so a sheet over the corridor would sit above it
    dem = FakeDem(res.frame, lambda x, z: np.abs(np.asarray(z)) * 0.1)
    land, _ = terrain(res, dem, 2000.0, pad)
    assert len(land) == 1 and not land[0].is_empty()
    land = land[0]

    P = np.asarray(land.positions)
    tri = np.asarray(land.indices).reshape(-1, 3)
    a, b, c = P[tri[:, 0]][:, [0, 2]], P[tri[:, 1]][:, [0, 2]], P[tri[:, 2]][:, [0, 2]]
    tree = cKDTree(res.P[:, [0, 2]])
    for probe, what in (((a + b + c) / 3.0, "centre"), ((a + b) / 2.0, "edge ab"),
                        ((b + c) / 2.0, "edge bc"), ((c + a) / 2.0, "edge ca")):
        nearest = tree.query(probe)[0].min()
        assert nearest >= pad - PROBE_SLACK, \
            f"a backdrop triangle's {what} is {nearest:.0f} m from the road"



def test_a_skyline_building_never_stands_on_a_road():
    """The backdrop is drawn once and never streamed, and nothing else in the pipeline looks at it.

    A skyline building is placed as the minimum rectangle around its footprint -- bigger than the
    footprint -- and it was kept or dropped on where its *centre* fell. A block a few hundred metres
    off the racing line therefore passed, and was drawn straight across a side street, with no
    collider and nothing to clip it. Every other check said the road was clear, because every other
    check looks at the streamed tiles.

    The distance rule cannot cover this on its own: side streets are drawn out to three hundred
    metres, further than the backdrop's own pad. So the rule has to be said directly.
    """
    import numpy as np
    from shapely.geometry import LineString

    import sr.backdrop as B
    from sr.backdrop import skyline
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=2000.0)
    res.P[:, 1] = 0.0
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))
    # a side street three hundred metres off the racing line, which is where they really reach
    side = LineString([(0.0, 300.0), (2000.0, 300.0)]).buffer(6.0)

    def block(x0, x1, z0, z1):
        xs = np.array([x0, x1, x1, x0]); zs = np.array([z0, z0, z1, z1])
        la, lo = res.frame.to_latlon(xs, zs)
        return {"type": "way", "tags": {"building": "yes", "building:levels": "12"},
                "geometry": [{"lat": float(a), "lon": float(o)} for a, o in zip(la, lo)]}

    # centre at z = 590, well past the 280 m pad; its near end sits on the side street
    saved = B.load_layer
    B.load_layer = lambda *a, **k: {"elements": [block(900.0, 960.0, 295.0, 885.0)]}
    try:
        loose = skyline(res, dem, "t", 280.0)
        strict = skyline(res, dem, "t", 280.0, keep_clear=side)
    finally:
        B.load_layer = saved

    assert loose is not None, "the distance rule alone lets this one through, which is the bug"
    assert strict is None, "a skyline building reaching a road must be dropped"


def test_skyline_ignores_non_buildings_from_the_shared_backdrop_cache():
    """Coastlines, major roads and water share the fetch with towers; none may become a box."""
    import sr.backdrop as B
    from sr.backdrop import skyline
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=1000.0)
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))
    x = np.array([600.0, 1100.0, 1100.0, 600.0])
    z = np.array([500.0, 500.0, 900.0, 900.0])
    lat, lon = res.frame.to_latlon(x, z)
    geometry = [{"lat": float(a), "lon": float(o)} for a, o in zip(lat, lon)]
    non_buildings = [
        {"type": "way", "tags": {"natural": "coastline"}, "geometry": geometry},
        {"type": "way", "tags": {"highway": "primary"}, "geometry": geometry},
        {"type": "relation", "tags": {"natural": "water", "water": "bay"},
         "geometry": geometry},
    ]
    saved = B.load_layer
    B.load_layer = lambda *a, **k: {"elements": non_buildings}
    try:
        assert skyline(res, dem, "t", 280.0) is None
    finally:
        B.load_layer = saved


def test_skyline_uses_real_height_tags_and_established_facade_materials(monkeypatch):
    """Height-only downtown towers must not collapse to the eight-storey fallback."""
    import sr.backdrop as B
    from sr.backdrop import skyline
    from tests.test_terrain import FakeDem, straight_route

    res = straight_route(length=1000.0)
    dem = FakeDem(res.frame, lambda x, z: np.zeros(np.shape(x)))

    def block(osm_id, x0, height, kind, levels=None):
        x = np.array([x0, x0 + 50.0, x0 + 50.0, x0])
        z = np.array([500.0, 500.0, 550.0, 550.0])
        lat, lon = res.frame.to_latlon(x, z)
        tags = {"building": kind, "height": str(height)}
        if levels is not None:
            tags["building:levels"] = str(levels)
        return {"type": "way", "id": osm_id,
                "tags": tags,
                "geometry": [{"lat": float(a), "lon": float(o)} for a, o in zip(lat, lon)]}

    monkeypatch.setattr(B, "load_layer", lambda *args: {
        
        "elements": [block(1, 100.0, 326.0, "office", levels=61),
                     block(2, 700.0, 42.0, "apartments")]})
    monkeypatch.setattr(B, "landmark_footprints", lambda *args, **kwargs: [])
    meshes = skyline(res, dem, "t", 280.0)
    assert set(meshes) == {"building_glass", "building_stucco"}
    assert meshes["building_glass"].positions[:, 1].max() == pytest.approx(326.94, abs=.05)
    assert meshes["building_stucco"].positions[:, 1].max() == pytest.approx(42.94, abs=.05)


def _first_covered_distance(res, land, pad, reach=200.0):
    """How far out, on each side of each route point, the backdrop first covers the ground.

    The distance from a triangle to the road says nothing about a hole: a hole is a *direction* in
    which nothing is covered, and the mesh a hundred metres further along is no help. So walk
    outwards from the route along its own normal and report where cover actually begins.
    """
    import numpy as np
    from scipy.spatial import cKDTree

    P = np.asarray(land.positions)[:, [0, 2]]
    tri = np.asarray(land.indices).reshape(-1, 3)
    a, b, c = P[tri[:, 0]], P[tri[:, 1]], P[tri[:, 2]]
    v0, v1 = b - a, c - a
    d00, d01, d11 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1)
    den = d00 * d11 - d01 * d01
    den[den == 0] = 1e-12
    tree = cKDTree(res.P[:, [0, 2]])

    def covered(point):
        v2 = point - a
        d20, d21 = (v2 * v0).sum(1), (v2 * v1).sum(1)
        u = (d11 * d20 - d01 * d21) / den
        v = (d00 * d21 - d01 * d20) / den
        return bool(np.any((u >= -1e-9) & (v >= -1e-9) & (u + v <= 1 + 1e-9)))

    worst, where = 0.0, None
    step = max(1, len(res.P) // 120)
    for i in range(0, len(res.P), step):
        here = res.P[i][[0, 2]]
        tangent = res.P[min(i + 3, len(res.P) - 1)][[0, 2]] - res.P[max(i - 3, 0)][[0, 2]]
        length = float(np.linalg.norm(tangent))
        if length == 0:
            continue
        tangent /= length
        normal = np.array([-tangent[1], tangent[0]])
        for side in (1, -1):
            for out in np.arange(pad, pad + reach, 2.5):
                point = here + normal * out * side
                # Only ground the backdrop is responsible for: inside the pad is the corridor's.
                if tree.query(point)[0] < pad - 1e-9:
                    continue
                if covered(point):
                    distance = float(tree.query(point)[0])
                    if distance > worst:
                        worst, where = distance, (i, side)
                    break
    return worst, where


def test_the_backdrop_closes_on_the_corridor_from_every_direction():
    """The seam between the two grounds has to be an overlap, not a gap, all the way round.

    `sample_grid` asks for the backdrop twenty metres inside where the streamed corridor stops so
    the two overlap. They did not: the lattice's own nearest point is wherever its grid happens to
    fall, and `_clear_of_corridor` then pushes the edge further out again, which on the Golden Gate
    left the first backdrop triangle 315 m out against a corridor ending at 300. Fifteen metres of
    nothing, seen from the bridge as a hairline of sky across the bay and over the far hills, and
    the same ring around every route in the game.

    A curve is the hard case -- the end caps are where the triangulation strings its longest chords
    -- and distance-to-the-road alone cannot see any of this: it answers with the nearest triangle
    anywhere, while a hole is about one direction having none.
    """
    import numpy as np

    from sr.backdrop import terrain
    from sr.route import RouteResult
    from sr.geo import LocalFrame
    from sr.geom import resample, rights, tangents
    from tests.test_terrain import FakeDem

    angle = np.linspace(0, np.pi, 60)
    bend = np.stack([400 * np.cos(angle), np.zeros_like(angle), 400 * np.sin(angle)], axis=1)
    P, S = resample(bend.tolist(), 2.0)
    T = tangents(P)
    res = RouteResult(route={"id": "test"}, frame=LocalFrame(37.8, -122.45), P=P, S=S, T=T,
                      R=rights(T), half_width=np.full(len(P), 4.0),
                      highway=["residential"] * len(P), bridge=np.zeros(len(P), dtype=bool),
                      tunnel=np.zeros(len(P), dtype=bool), lanes=np.full(len(P), 2), closed=False)
    pad = 280.0
    dem = FakeDem(res.frame, lambda x, z: np.full(np.shape(z), 40.0))
    land, _ = terrain(res, dem, 2000.0, pad)
    assert len(land) == 1

    worst, where = _first_covered_distance(res, land[0], pad)
    # The corridor itself reaches pad + 20 (`build.py` hands the backdrop that much less), so this
    # is the line between overlapping and leaving sky behind.
    assert worst <= pad + 20.0, \
        f"the backdrop first covers the ground {worst:.1f} m out at route point {where}, " \
        f"past the {pad + 20:.0f} m the streamed corridor reaches: that is a ring of nothing"
