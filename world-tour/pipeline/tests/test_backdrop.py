import os

import numpy as np
from shapely.geometry import Polygon, Point
import pytest

from sr.backdrop import (FAR_SPACING, NEAR_RADIUS, NEAR_SPACING, WATER_SINK, sample_grid,
                        terrain)
from sr.fetch_osm import CACHE_DIR
from tests.test_terrain import FakeDem, straight_route

HAS_CACHE = os.path.exists(os.path.join(CACHE_DIR, "sydney", "backdrop.json.gz"))


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
    from sr.vistas import profile

    # `sr.vistas` no longer precomputes a `PROFILES` table; `profile(route_id)` derives each
    # route's VistaProfile on demand (from the route's own `vista` JSON block, or the shared
    # `DEFAULT` when it has none -- true for all 15 current tracks). Covering "every official
    # route" now means calling it once per id instead of reading a dict.
    route_ids = set(all_route_ids())
    profiles = {route_id: profile(route_id) for route_id in route_ids}
    assert set(profiles) == route_ids
    assert all(p.source_key for p in profiles.values())
    assert all(abs(sum(share for _, share in p.far_roofs) - 1.0) < 1e-9
               for p in profiles.values())
    assert all(abs(sum(share for _, share in p.near_roofs) - 1.0) < 1e-9
               for p in profiles.values())
    assert all(profiles[route_id].near_m <= load_route(route_id).get("terrainPadM", 300)
               for route_id in route_ids), "low-rise massing must overlap the streamed scenery band"


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


@pytest.mark.skipif(not HAS_CACHE, reason="needs the sydney backdrop cache")
def test_sydney_backdrop_has_hills_water_and_a_skyline():
    """Retargeted from the deleted `goldengate` route to `sydney`, the new showcase track with the
    same shape: a route that crosses open water on a bridge, ringed by a real city skyline.

    The old assertion that Alcatraz and Sutro Tower "ride along in the backdrop" is dropped, not
    weakened: every current landmark (including sydney's own `opera-house` and `harbour-bridge`)
    is authored as a GLB loaded independently near the road, and `sr.landmarks.build` only ever
    contributes to the backdrop for the non-GLB procedural landmarks the Bay Area routes used
    (Alcatraz, Sutro Tower, the two bridges) -- explicitly a deleted feature. No current route has
    any landmark that can populate a `backdrop_landmark*` key any more, so there is nothing left
    of that line to retarget.
    """
    from sr.backdrop import build
    from sr.dem import DemSampler
    from sr.fetch_dem import BACKDROP_ZOOM
    from sr.route import build_route

    out = build(build_route("sydney"), "sydney", DemSampler(BACKDROP_ZOOM))
    assert {"backdrop_terrain", "backdrop_water"} <= set(out)
    assert any(k.startswith("backdrop_buildings_") for k in out), sorted(out)
    total = sum(m.triangle_count for m in out.values())
    # Whole-scene limits belong to tools/resource_limits.json and the real renderer probe.
    # The retired per-backdrop cap would reject the explicitly approved richer architecture.
    assert total > 0
    # goldengate's `backdrop_water` (water beyond the streamed corridor, within the backdrop
    # radius) was San Francisco Bay: huge open water on both sides, easily > 1000 triangles.
    # Sydney Harbour is a real, different shape -- narrower and more enclosed, with land wrapping
    # around most of it -- and its 450 m corridor pad already covers the water closest to the
    # bridge as part of the streamed tiles, not the backdrop's job. Measured on the actual cached
    # data: `sr.backdrop.build(build_route("sydney"), ...)["backdrop_water"].triangle_count == 702`.
    # The bar is re-derived from that real number (with headroom below it, not against it) rather
    # than reused from the old bay: it still checks that the harbour gets a real subdivided mesh,
    # not a degenerate one- or two-triangle rectangle standing in for "there is water here".
    assert out["backdrop_water"].triangle_count > 500, \
        "the harbour must get real tessellation, not a token rectangle"


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


def test_no_backdrop_geometry_is_stretched_over_the_route():
    """Delaunay triangulates a point cloud, not a polygon with a hole.

    Dropping the sample points inside the corridor is not enough: given a six-hundred-metre gap the
    triangulation joins one side to the other, and the result is a sheet of coarse hillside stretched
    straight over the road. On an early flat, open route it sat two thirds of a metre above the tarmac and the race
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
    fall, and `_clear_of_corridor` then pushes the edge further out again, which on an early
    bridge-and-water route left the first backdrop triangle 315 m out against a corridor ending at
    300. Fifteen metres of nothing, seen from the bridge as a hairline of sky across the water and
    over the far hills, and the same ring around every route in the game.

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
