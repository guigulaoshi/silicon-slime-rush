import os

import numpy as np
import pytest

from sr.fetch_osm import CACHE_DIR
from sr.geo import LocalFrame
from sr.geom import resample, rights, tangents
from sr.route import RouteResult
from sr.terrain import (APRON, BLEND, FINE_RADIUS, SHORE_CLAMP, WATER_LEVEL, bridge_deck, build_terrain,
                        corridor_polygon, limit_slope, merge_spans, plan_area, road_profile, sample_points,
                        smooth_profile)

# The Golden Gate route (and its cache) is deleted; Sydney is the new bridge-and-water showcase
# track (goldengate -> sydney, per the remix mapping table), so this real-route smoke test now
# gates on its cache instead.
HAS_CACHE = os.path.exists(os.path.join(CACHE_DIR, "sydney", "roads.json.gz"))


class FakeDem:
    """Elevation as a function of local x/z, so a test can describe terrain in meters, not degrees."""

    def __init__(self, frame, fn):
        self.frame, self.fn = frame, fn

    def heights(self, lat, lon):
        x, z = self.frame.to_local(lat, lon)
        return self.fn(np.asarray(x, dtype=float), np.asarray(z, dtype=float))


def straight_route(length=600.0, half_width=4.0, bridge_span=None):
    frame = LocalFrame(37.8, -122.45)
    P, S = resample([[0, 0, 0], [length, 0, 0]], 2.0)
    T = tangents(P)
    bridge = np.zeros(len(P), dtype=bool)
    if bridge_span:
        bridge[(S >= bridge_span[0]) & (S <= bridge_span[1])] = True
    return RouteResult(route={"id": "test"}, frame=frame, P=P, S=S, T=T, R=rights(T),
                       half_width=np.full(len(P), half_width), highway=["residential"] * len(P),
                       bridge=bridge, tunnel=np.zeros(len(P), dtype=bool), lanes=np.full(len(P), 2),
                       closed=False)


# ------------------------------------------------------------------ profile

def test_smooth_profile_window_is_in_meters():
    S = np.arange(0, 400, 2.0)
    noisy = 10 + np.where(np.arange(len(S)) % 2, 1.0, -1.0)  # 2 m sawtooth
    out = smooth_profile(S, noisy, window_m=60.0)
    interior = out[30:-30]  # the ends extrapolate with the nearest value and keep a little of the ripple
    assert np.ptp(interior) < 0.05 and abs(out.mean() - 10) < 0.05


def test_limit_slope_enforces_and_is_idempotent():
    S = np.arange(0, 100, 2.0)
    y = np.zeros(len(S)); y[len(S) // 2:] = 20.0  # a 20 m cliff
    a = limit_slope(S, y, 0.15)
    assert (np.abs(np.diff(a) / np.diff(S)) <= 0.15 + 1e-9).all()
    assert np.allclose(a, limit_slope(S, a, 0.15), atol=1e-9)



def test_road_profile_rounds_crests_reintroduced_by_grade_clamping():
    res = straight_route(length=600.0)
    dem = FakeDem(res.frame, lambda x, z: 40 + np.maximum(0, 100 - abs(x - 300)))
    y = road_profile(res, dem)
    grades = np.diff(y) / np.diff(res.S)
    assert np.max(np.abs(grades)) <= 0.15 + 1e-9
    assert np.max(np.abs(np.diff(grades))) < .03
    # A four-metre wheelbase must not straddle a peak tall enough to rest on the floor.
    # Before the fix the slope limiter manufactured a .3 m summit within this span.
    crest_above_axles = y[1:-1] - (y[:-2] + y[2:]) / 2
    assert np.max(crest_above_axles) < .04
    assert y.max() - y.min() > 20  # retain a real hill, rather than passing by flattening it


def test_road_profile_keeps_grade_bound_on_a_short_final_segment():
    res = straight_route(length=600.17)
    dem = FakeDem(res.frame, lambda x, z: 40 + .15 * x)
    y = road_profile(res, dem)
    
    assert 1.0 <= np.diff(res.S)[-1] < 3.0
    assert np.max(np.abs(np.diff(y) / np.diff(res.S))) <= .15 + 1e-9

def test_merge_spans_joins_small_gaps():
    assert merge_spans([[0, 100], [104, 300], [900, 950]], max_gap=50) == [[0, 300], [900, 950]]
    assert merge_spans([[0, 100], [200, 300]], max_gap=50) == [[0, 100], [200, 300]]


def test_bridge_deck_levels_mid_span_and_ramps_from_land():
    S = np.arange(0, 1000, 2.0)
    y = np.full(len(S), 10.0)
    mask = (S >= 200) & (S <= 800)
    out = bridge_deck(S, y, mask, deck_m=67.0, min_length=200.0)
    mid = np.argmin(np.abs(S - 500))
    assert abs(out[mid] - 67.0) < 0.1
    assert out[0] == 10.0 and out[-1] == 10.0
    assert abs(out[np.argmin(np.abs(S - 205))] - 10.0) < 2.0  # leaves the abutment tangentially


def test_bridge_deck_leaves_short_spans_alone():
    S = np.arange(0, 400, 2.0)
    y = np.full(len(S), 10.0)
    mask = (S >= 100) & (S <= 250)
    assert np.allclose(bridge_deck(S, y, mask, deck_m=67.0, min_length=200.0), y)


def test_road_profile_ignores_bathymetry_under_a_bridge():
    res = straight_route(length=1200.0, bridge_span=(300.0, 900.0))
    dem = FakeDem(res.frame, lambda x, z: np.where((x > 280) & (x < 920), -90.0, 30.0))
    y = road_profile(res, dem, deck_m=67.0, bridge_min_length=200.0)
    assert y.min() > 0, "the deck must never follow the sea floor"
    mid = len(y) // 2
    assert abs(y[mid] - 67.0) < 1.0
    assert (np.abs(np.diff(y) / np.diff(res.S)) <= 0.15 + 1e-6).all()


# ------------------------------------------------------------------ sampling and area

def test_sample_points_are_dense_near_the_road_and_sparse_away():
    res = straight_route()
    pts = sample_points(res, pad=200.0)
    d = np.abs(pts[:, 1])  # straight route along x, so |z| is distance from the road
    near = np.unique(np.round(pts[d < 30][:, 1], 3))
    assert np.diff(np.sort(near)).max() <= 2.5 + 1e-6
    far = np.unique(np.round(pts[d > 120][:, 1], 3))
    assert np.diff(np.sort(far)).min() >= 9.99


def test_sample_points_include_a_ring_on_the_painted_edge():
    """The fine lattice sits at fixed offsets while the road width varies, so without a ring on the
    edge itself the ground triangles straddle it. Dropping those by centroid then leaves slivers of
    sky along the whole route -- which is what every screenshot showed until this ring existed."""
    res = straight_route(half_width=4.0)
    pts = sample_points(res, pad=200.0)
    rows = np.unique(np.round(pts[np.abs(pts[:, 1]) < 30][:, 1], 3))
    for offset in (4.0, 4.0 + APRON):
        assert np.isclose(rows, offset, atol=1e-6).any(), f"no samples at +{offset}"
        assert np.isclose(rows, -offset, atol=1e-6).any(), f"no samples at -{offset}"


def test_plan_area_of_a_unit_square():
    xz = np.array([[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]])
    assert abs(plan_area(xz, np.array([[0, 1, 2], [0, 2, 3]])) - 100.0) < 1e-9


# ------------------------------------------------------------------ terrain mesh

def test_no_ground_is_generated_under_the_driving_surface():
    """The road is drawn only centimetres above the ground, so anything left underneath shows
    through it in patches wherever the two disagree."""
    res = straight_route()
    dem = FakeDem(res.frame, lambda x, z: np.full_like(x, 5.0))
    road_y = np.full(len(res.P), 20.0)
    tr = build_terrain(res, dem, road_y, corridor_polygon(res, 150.0), pad=150.0)
    # triangles are dropped by centroid, so edge triangles keep a vertex inside; the centroid is
    # what decides whether a face is drawn under the tarmac
    tris = tr.terrain.positions[tr.terrain.indices.reshape(-1, 3)]
    centroids = tris.mean(axis=1)
    middle = np.abs(centroids[:, 0] - 300) < 100
    under = np.abs(centroids[middle][:, 2]) < res.half_width[0] - 0.5
    assert not under.any(), f"{under.sum()} ground faces under the road"


def test_terrain_meets_the_road_and_returns_to_natural_ground():
    res = straight_route()
    dem = FakeDem(res.frame, lambda x, z: np.full_like(x, 5.0))
    road_y = np.full(len(res.P), 20.0)
    tr = build_terrain(res, dem, road_y, corridor_polygon(res, 150.0), pad=150.0)
    V = tr.terrain.positions
    lateral = np.abs(V[:, 2]); mid = np.abs(V[:, 0] - 300) < 100
    at_edge = mid & (lateral < res.half_width[0] + APRON)
    far = mid & (lateral > res.half_width[0] + APRON + BLEND + 5)
    assert abs(V[at_edge, 1].mean() - 20.0) < 0.01
    assert abs(V[far, 1].mean() - 5.0) < 0.01


def test_sea_floor_becomes_water_surface_and_never_land():
    res = straight_route(length=1200.0, bridge_span=(300.0, 900.0))
    dem = FakeDem(res.frame, lambda x, z: np.where((x > 280) & (x < 920), -40.0, 25.0))
    road_y = road_profile(res, dem, deck_m=67.0, bridge_min_length=200.0)
    tr = build_terrain(res, dem, road_y, corridor_polygon(res, 150.0), pad=150.0)
    # the trench is 640 m of a 300 m wide corridor; the rounded end caps take a little off
    assert tr.water_area > 150_000, tr.water_area
    assert np.allclose(tr.water.positions[:, 1], WATER_LEVEL)
    assert tr.terrain.positions[:, 1].min() >= SHORE_CLAMP - 1e-6
    under_bridge = np.abs(tr.terrain.positions[:, 0] - 600) < 200
    assert not under_bridge.any(), "no land may be generated under the span"


def test_wet_bridge_edge_does_not_connect_the_deck_to_the_sea_floor():
    """A one-sample OSM bridge transition must not grow a vertical terrain fin under the deck."""
    res = straight_route(length=1200.0, bridge_span=(300.0, 900.0))
    # The coastline falls just before the bridge flag starts, exactly like the Golden Gate's south
    # abutment. A deliberately high profile makes the old deck-to-sea connection unambiguous.
    dem = FakeDem(res.frame, lambda x, z: np.where((x > 200.0) & (x < 1000.0), -30.0, 20.0))
    road_y = np.full(len(res.P), 67.0)
    tr = build_terrain(res, dem, road_y, corridor_polygon(res, 150.0), pad=150.0)
    triangles = tr.terrain.positions[tr.terrain.indices.reshape(-1, 3)]
    transition = np.abs(triangles[:, :, 0].mean(axis=1) - 300.0) < 30.0
    fins = transition & (triangles[:, :, 1].min(axis=1) <= SHORE_CLAMP + 1e-5) \
        & (triangles[:, :, 1].max(axis=1) > 40.0)
    assert not fins.any(), f"{fins.sum()} terrain faces still join the bridge deck to the sea"


def test_ground_under_a_span_is_kept_not_cut_away():
    """A deck in the air hides nothing below it, so its plan shadow must not be cut out of the ground.

    It was, and the Golden Gate's approach viaduct took a band of the Presidio with it --
    from the home page's orbit the player looked straight through the ground at the sky. The valley
    here is dry land, so nothing but the cut can explain a hole under the span."""
    res = straight_route(length=1200.0, bridge_span=(300.0, 900.0))
    dem = FakeDem(res.frame, lambda x, z: np.where((x > 280) & (x < 920), 5.0, 45.0))
    road_y = road_profile(res, dem, deck_m=40.0, bridge_min_length=200.0)
    assert road_y[len(road_y) // 2] - 5.0 > 20.0, "the fixture must put the deck well above the ground"
    tr = build_terrain(res, dem, road_y, corridor_polygon(res, 150.0), pad=150.0)
    tris = tr.terrain.positions[tr.terrain.indices.reshape(-1, 3)]
    centroids = tris.mean(axis=1)
    # Right under the middle of the span, across the width the deck covers.
    under = (np.abs(centroids[:, 0] - 600) < 150) & (np.abs(centroids[:, 2]) < res.half_width[0] - 0.5)
    assert under.sum() > 10, "the ground under the span was cut away"
    assert abs(centroids[under][:, 1].mean() - 5.0) < 1.0, "and it stays at the valley floor"


def test_a_short_deck_is_never_left_under_the_ground_it_crosses():
    ""
    res = straight_route(length=1200.0, bridge_span=(585.0, 615.0))
    dem = FakeDem(res.frame, lambda x, z: np.where(np.abs(x - 600) < 35, 40.0, 20.0))
    road_y = road_profile(res, dem, deck_m=67.0, bridge_min_length=200.0)
    middle = len(road_y) // 2
    assert road_y[middle] >= 40.0 + 0.3 - 1e-6, road_y[middle]
    assert np.max(np.abs(np.diff(road_y) / np.diff(res.S))) <= .15 + 1e-9
    tr = build_terrain(res, dem, road_y, corridor_polygon(res, 150.0), pad=150.0)
    tris = tr.terrain.positions[tr.terrain.indices.reshape(-1, 3)]
    centroids = tris.mean(axis=1)
    over = (np.abs(centroids[:, 0] - 600) < 20) & (np.abs(centroids[:, 2]) < res.half_width[0] - 0.5)
    assert not over.any(), f"{over.sum()} ground faces closed over the roadbed"


def test_a_route_can_declare_the_sea_reads_above_zero():
    """Terrarium tiles carry bathymetry almost everywhere, but not off every coast: around Monterey
    the open sea reads a flat +1.22 m, so the default "below zero is water" finds no water at all on
    a route that runs along the shore. A route says what its sea reads at, and the surface, the
    threshold and the shore clamp all move with it."""
    res = straight_route(length=1200.0)
    dem = FakeDem(res.frame, lambda x, z: np.where(np.abs(z) > 60, 1.22, 25.0))
    road_y = road_profile(res, dem)
    corridor = corridor_polygon(res, 150.0)

    dry = build_terrain(res, dem, road_y, corridor, pad=150.0)
    assert dry.water_area == 0.0, "at the default sea level a +1.22 m sea is land"

    wet = build_terrain(res, dem, road_y, corridor, pad=150.0, water_level=1.5)
    assert wet.water_area > 100_000, wet.water_area
    assert np.allclose(wet.water.positions[:, 1], 1.5)
    assert wet.terrain.positions[:, 1].min() >= 1.5 + SHORE_CLAMP - 1e-6


@pytest.mark.parametrize("height", [0.0, 24.0])
def test_raw_dem_step_is_blended_ground_not_a_freestanding_vertical_panel(height):
    from sr.mesh import Mesh
    from sr.clearance import surface
    from shapely.geometry import box

    res = straight_route(length=80.0)
    dem = FakeDem(res.frame, lambda x, z: np.where(np.abs(z) > 6, height, 12.0))
    result = build_terrain(res, dem, np.full(len(res.P), 12.0), corridor_polygon(res, 60), pad=60)
    # Examine every output mesh, including any separately added walls, rather than only the
    # main ground mesh. The old builder adds zero-footprint faces up to 6.4 m above this slope.
    meshes = [value for value in vars(result).values() if isinstance(value, Mesh)]
    assert sum(mesh.triangle_count for mesh in meshes) > 100
    for mesh in meshes:
        tris = mesh.positions[mesh.indices.reshape(-1, 3)].astype(float)
        areas = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
        assert np.all(np.abs(areas[:, 1]) > 1e-8), "a vertical panel was added over the ground"
    assert np.ptp(result.terrain.positions[:, 1]) > 10, "retain the natural elevation change"
    # The road shoulders remain covered: removing the panel must not remove the slope itself.
    expected_shoulder = box(5, 4, 75, 7).union(box(5, -7, 75, -4))
    assert expected_shoulder.difference(surface(result.terrain)).area < 1e-5


# ------------------------------------------------------------------ the real route

@pytest.mark.skipif(not HAS_CACHE, reason="no cache")
def test_sydney_terrain():
    """Golden Gate's replacement for the one real-route terrain smoke test: Sydney is now the
    bridge-and-water showcase track. Unlike goldengate.json, sydney.json declares no "bridgeDeckM" /
    "bridgeMinLengthM" (grep confirms none of the 15 new pipeline/routes/*.json do), so road_profile
    gets deck_m=None exactly as sr/build.py calls it for every real route -- the Harbour Bridge crossing
    is the naturally sampled, smoothed, slope-limited profile, not a forced flat deck. Numbers below are
    measured directly on the built route."""
    from scipy.spatial import cKDTree

    from sr.dem import DemSampler
    from sr.route import build_route
    from sr.routes import load_route

    route = load_route("sydney")
    res = build_route("sydney")
    dem = DemSampler()
    y = road_profile(res, dem, route.get("bridgeDeckM"), route.get("bridgeMinLengthM", 200.0))
    # Measured: y ranges ~1.8-63.8 m -- the route ends on the waterfront promenade
    # round the Opera House, 1.8 m above the harbour, and climbs to the bridge's own rise; nothing like
    # Golden Gate's Conzelman-viewpoint summit. Above the water, never below it.
    assert 1 < y.min() < 20 and 50 < y.max() < 80, (y.min(), y.max())
    assert (np.abs(np.diff(y) / np.diff(res.S)) <= 0.15 + 1e-6).all()
    deck = y[res.bridge]
    # No configured deck_m to compare against (see docstring), so the check that matters here is that
    # the unforced, naturally smoothed profile still crosses the harbour as a level-ish deck rather
    # than a chaotic one: measured range across the 717 bridge samples is ~37.9-42.3 m, 4.4 m of rise.
    assert deck.max() - deck.min() < 10, (deck.min(), deck.max())

    tr = build_terrain(res, dem, y, corridor_polygon(res))
    # Measured water_area ~156_915 m^2 -- Sydney Harbour under the bridge deck is a smaller crossing
    # than the Golden Gate strait, but still the harbour, not a puddle.
    assert tr.water_area > 100_000, tr.water_area
    assert tr.terrain.triangle_count > 100_000
    assert tr.terrain.positions[:, 1].min() >= SHORE_CLAMP - 1e-6
    triangles = tr.terrain.positions[tr.terrain.indices.reshape(-1, 3)]
    bridge_tree = cKDTree(res.P[res.bridge][:, [0, 2]])
    near_bridge = bridge_tree.query(triangles[:, :, [0, 2]].mean(axis=1))[0] < FINE_RADIUS
    # 40 m still separates real hillside from a deck-to-sea fin here: the foreshore terrain near the
    # bridge tops out around 25-30 m (checked directly), well under the bridge's own ~38-42 m deck.
    fins = near_bridge & (triangles[:, :, 1].min(axis=1) <= SHORE_CLAMP + 1e-5) \
        & (triangles[:, :, 1].max(axis=1) > 40.0)
    assert not fins.any(), f"{fins.sum()} Sydney terrain faces join bridge height to the sea"


def test_ground_cut_preserves_outside_and_removes_all_tarmac_overlap():
    from shapely.geometry import Polygon
    from sr.clearance import surface
    from sr.mesh import from_triangles
    from sr.terrain import cut_ground

    # A diagonal road edge crosses both faces; neither centroid decides the visible boundary.
    P = np.array([[0., 10., 0.], [8., 14., 0.], [8., 16., 8.], [0., 12., 8.]])
    triangles = np.array([[0, 1, 2], [0, 2, 3]])
    road = Polygon([(2, -1), (5, -1), (7, 9), (4, 9)])
    V, T = cut_ground(P, triangles, road)
    actual = surface(from_triangles(V, T))
    expected = Polygon(P[:, [0, 2]]).difference(road)
    assert actual.symmetric_difference(expected).area < 1e-5
    assert actual.intersection(road).area < 1e-5
    assert np.allclose(V[:, 1], 10 + V[:, 0] * .5 + V[:, 2] * .25)


def test_variable_width_curving_terrain_has_no_road_overlap_or_edge_holes():
    from shapely import polygons, union_all
    from sr.clearance import surface
    from sr.mesh import ribbon
    from scipy.spatial import Delaunay

    res = straight_route(length=100)
    res.P[:, 2] = 9 * np.sin(res.S / 28)
    res.T = tangents(res.P)
    res.R = rights(res.T)
    res.half_width = 5 + 2 * np.sin(res.S / 17)
    y = 10 + res.S * .1
    res.P[:, 1] = y
    corridor = corridor_polygon(res, 60)
    dem = FakeDem(res.frame, lambda x, z: 10 + x * .1)
    ground = build_terrain(res, dem, y, corridor, pad=60)
    road = surface(ribbon(res.P, res.R, res.half_width))
    actual = surface(ground.terrain)
    samples = sample_points(res, 60)
    tris = Delaunay(samples).simplices
    from sr.terrain import _contains
    inside = _contains(corridor, samples[tris].mean(axis=1))
    original = union_all(polygons(samples[tris[inside]]))
    expected = original.difference(road)
    assert actual.intersection(road).area < .002
    assert actual.symmetric_difference(expected).area < .01


def test_bounded_far_query_keeps_the_same_terrain_samples():
    from sr.terrain import sample_points
    from scipy.spatial import cKDTree
    res = straight_route(length=600, half_width=6)
    pad, fine_radius, coarse = 100, 40, 10
    points = sample_points(res, pad, fine_radius=fine_radius, coarse=coarse)
    lo, hi = res.P[:, [0, 2]].min(axis=0) - pad, res.P[:, [0, 2]].max(axis=0) + pad
    grid = np.stack(np.meshgrid(np.arange(lo[0], hi[0] + coarse, coarse),
                    np.arange(lo[1], hi[1] + coarse, coarse), indexing="ij"), axis=-1).reshape(-1, 2)
    distance = cKDTree(res.P[:, [0, 2]]).query(grid)[0]
    expected = grid[(distance > fine_radius) & (distance <= pad)]
    np.testing.assert_array_equal(points[-len(expected):], expected)
