"""Road-geometry limits every route has to meet, whatever city it is in (remix fixes, 2.12)."""
import numpy as np

from sr import route
from sr.geom import curvature, resample
from sr.terrain import limit_slope, smooth_profile


def _corner(radius_hint=0.0):
    return np.r_[np.c_[np.zeros(60), np.linspace(-120, 0, 60)], np.c_[np.linspace(2, 120, 60), np.zeros(60)]]


def test_a_street_corner_is_eased_to_the_fleet_radius():
    sm = route.smooth_polyline(_corner())
    P, S = resample(sm, 2.0)
    assert route.tight_spots(P, S, False), "the fixture must start tighter than the limit"
    eased = route.ease_tight_spots(sm, False, min_radius=route.MIN_RADIUS * route.EASE_HEADROOM)
    P, S = resample(eased, 2.0)
    assert not route.tight_spots(P, S, False)
    assert 1 / np.abs(curvature(P, S, False)).max() >= route.MIN_RADIUS
    # Away from the corner the line stays on the street.
    assert np.allclose(P[:10, 0], 0.0, atol=1e-6)


def test_a_u_turn_between_close_legs_is_named_not_hidden():
    t = np.linspace(0, np.pi, 40)
    xz = np.r_[np.c_[np.zeros(50), np.linspace(-100, 0, 50)], np.c_[4 - 4 * np.cos(t), 4 * np.sin(t)],
               np.c_[np.full(50, 8), np.linspace(0, -100, 50)]]
    eased = route.ease_tight_spots(route.smooth_polyline(xz), False)
    P, S = resample(eased, 2.0)
    assert route.tight_spots(P, S, False), "an 8 m hairpin cannot be opened to 10 m; the build must refuse it"


def _hairpin(gap):
    t = np.linspace(0, np.pi, 40)
    r = gap / 2
    xz = np.r_[np.c_[np.zeros(50), np.linspace(-100, 0, 50)], np.c_[r - r * np.cos(t), r * np.sin(t)],
               np.c_[np.full(50, gap), np.linspace(0, -100, 50)]]
    return xz


def test_a_declared_switchback_opens_into_a_keyhole_the_fleet_can_turn():
    eased = route.ease_tight_spots(route.smooth_polyline(_hairpin(14.0)), False,
                                   min_radius=route.MIN_RADIUS * route.EASE_HEADROOM, switchbacks=True)
    P, S = resample(eased, 2.0)
    assert not route.tight_spots(P, S, False)
    # The legs stay where the map has them; only the turn swings out.
    assert np.allclose(P[:15, 0], 0.0, atol=1e-6) and np.allclose(P[-15:, 0], 14.0, atol=1e-6)
    assert P[:, 2].max() < 45, "the bulb reaches past the hairpin by a bus-sized turn, not across the hillside"


def test_a_street_driven_down_and_back_is_refused_even_on_a_mountain():
    # Up a dead end, round its little turning circle, and back down the same street.
    there = np.c_[np.zeros(60), np.linspace(-120, 0, 60)]
    t = np.linspace(0, 2 * np.pi, 30)[1:-1]
    circle = np.c_[-5 * np.sin(t), 5 - 5 * np.cos(t)]
    xz = np.r_[there, circle, there[::-1]]
    eased = route.ease_tight_spots(route.smooth_polyline(xz), False,
                                   min_radius=route.MIN_RADIUS * route.EASE_HEADROOM, switchbacks=True)
    P, S = resample(eased, 2.0)
    assert route.tight_spots(P, S, False), "a waypoint on a dead end must be named, not drawn as a loop"


def test_a_way_id_picks_one_carriageway_of_a_divided_road():
    from sr.geo import LocalFrame
    frame = LocalFrame(0.0, 0.0)
    mk = lambda i, x: route.RoadWay(i, "motorway", "Bridge Road", [1, 2], np.array([[x, 0.0], [x, -500.0]]), 2, True,
                                    False, False, 0, ("",), False, 0.0)
    ways = [mk(1, 0.0), mk(2, 20.0)]
    spec = {"waypoints": [{"road": "Bridge Road", "pick": "nearest:0,0.0001"}, {"way": 2, "pick": "northmost"}]}
    (xa, _), (xb, zb) = route.resolve_waypoints(spec, ways, frame)
    assert xb == 20.0 and zb == -500.0


def test_width_springs_back_no_faster_than_half_a_metre_per_metre():
    hw = np.r_[np.full(10, 14.), np.full(3, 3.), np.full(10, 14.)]
    S = np.arange(len(hw)) * 2.0
    out = route.limit_widening(hw, S, False)
    assert np.max(np.abs(np.diff(out)) / 2.0) <= route.MAX_WIDENING + 1e-9
    assert out.min() == 3.0


def test_a_circuit_has_no_step_on_its_start_line():
    S = np.arange(200) * 2.0
    y = np.linspace(0, 30, 200)                 # a naive open profile ends 30 m above its start
    closed = limit_slope(S, smooth_profile(S, y, closed=True), closed=True, closing=2.0)
    ring = np.append(closed, closed[0])
    assert np.max(np.abs(np.diff(ring))) / 2.0 <= 0.15 + 1e-9
    opened = limit_slope(S, smooth_profile(S, y))
    assert abs(opened[-1] - opened[0]) > 5, "positive control: the open sweep leaves the seam stepped"


def test_a_short_tail_is_folded_into_the_last_segment():
    P = np.c_[np.linspace(0, 100.3, 50), np.zeros(50), np.zeros(50)]
    _, S = resample(P, 2.0)
    assert np.diff(S)[-1] >= 1.0


def test_bare_earth_takes_roofs_out_of_a_downtown_but_leaves_a_hill_alone():
    from sr.bare_earth import bare
    n = 240
    h = np.full((n, n), 10.0)
    mask = np.zeros((n, n), bool)
    for i in range(40, 160, 8):
        for j in range(40, 160, 8):
            h[i:i + 5, j:j + 5] = 50
            mask[i:i + 5, j:j + 5] = True
    yy, xx = np.mgrid[0:n, 0:n]
    h = h + 80 * np.exp(-(((xx - 200) ** 2 + (yy - 200) ** 2) / (2 * 15 ** 2)))
    out = bare(h, mask)
    assert h[40:160, 40:160].max() > 45, "positive control: the raw city is a 40 m plateau of roofs"
    assert out[40:160, 40:160].max() < 12
    assert abs(out[200, 200] - h[200, 200]) < 1e-9, "a hill with no buildings on it is ground"
    assert (out <= h + 1e-9).all()


def test_a_level_ground_landmark_stands_on_a_pad_that_blends_back():
    from shapely.geometry import box as sbox
    from sr.bare_earth import CELL, PAD_RAMP, _level_pad
    g = np.arange(0, 400, CELL)
    X, Z = np.meshgrid(g, g, indexing="ij")
    slope = 20.0 + 0.1 * Z                        # the data's hill: 40 m across the grid
    site = sbox(150, 150, 250, 250)
    out = _level_pad(slope, site, X, Z, water_level=0.0)
    inside = (X > 155) & (X < 245) & (Z > 155) & (Z < 245)
    assert np.ptp(slope[inside]) >= 8, "positive control: the raw ground under the site slopes"
    assert np.ptp(out[inside]) < 1e-6
    far = (Z > 250 + PAD_RAMP + CELL) | (Z < 150 - PAD_RAMP - CELL) | (X < 150 - PAD_RAMP - CELL)
    assert np.allclose(out[far], slope[far]), "beyond the ramp the ground is untouched"


def test_an_inland_lake_is_water_at_its_own_level_and_its_bed_is_under_it():
    from shapely.geometry import box as sbox
    from sr.terrain import build_terrain, corridor_polygon, road_profile
    from tests.test_terrain import FakeDem, straight_route
    res = straight_route(length=1200.0)
    dem = FakeDem(res.frame, lambda x, z: np.full(np.shape(x), 830.0))
    road_y = road_profile(res, dem)
    lake = sbox(200, 40, 800, 140)          # a lake beside the road, 830 m up in the hills
    res.inland_water = [(lake, 829.0)]
    tr = build_terrain(res, dem, road_y, corridor_polygon(res, 150.0), pad=150.0)
    assert tr.water_area > 0.8 * lake.area, tr.water_area
    assert np.allclose(tr.water.positions[:, 1], 829.0)
    tris = tr.terrain.positions[tr.terrain.indices.reshape(-1, 3)]
    over_lake = [t for t in tris if lake.buffer(-5).contains(sbox(*t[:, [0, 2]].min(0), *t[:, [0, 2]].max(0)))]
    assert all(t[:, 1].max() < 829.0 for t in over_lake), "no ground over the lake surface"
    res.inland_water = []
    dry = build_terrain(res, dem, road_y, corridor_polygon(res, 150.0), pad=150.0)
    assert dry.water_area == 0.0, "positive control: without the map's lake the elevation says land"


def test_a_route_that_plants_nothing_must_say_its_ground_is_bare(monkeypatch):
    import pytest
    from sr import vegetation
    monkeypatch.setattr(vegetation, "load_route_spec", lambda _id: {})
    with pytest.raises(ValueError, match="treeFill"):
        vegetation.check_density("savanna", [()] * 10, 3000.0)
    vegetation.check_density("forest", [()] * 200, 3000.0)
    monkeypatch.setattr(vegetation, "load_route_spec", lambda _id: {"bareGround": True})
    vegetation.check_density("desert", [], 3000.0)


def test_centre_line_and_median_side_follow_the_route():
    import pytest
    from types import SimpleNamespace
    from sr import markings
    def road(route, oneway):
        return SimpleNamespace(route=route, half_width=np.array([8.0]), highway=["primary"],
                               oneway=np.array([oneway]))
    us = markings.offsets(road({}, False), 0, 3.6)
    assert {v[1] for k, v in us.items() if k[0] == "centre"} == {markings.YELLOW} and len([k for k in us if k[0] == "centre"]) == 2
    eu = markings.offsets(road({"centreLine": "white"}, False), 0, 3.6)
    assert [v for k, v in eu.items() if k[0] == "centre"] == [(0.0, markings.WHITE, False)]
    uk = markings.offsets(road({"centreLine": "white", "traffic": "left"}, True), 0, 3.6)
    assert uk[("edge", 1)][1] == markings.WHITE and uk[("edge", 1)][0] > 0      # median on the right
    with pytest.raises(ValueError):
        markings.offsets(road({"traffic": "middle"}, False), 0, 3.6)
    # A dirt track through a junction: nothing is painted, and no stop line or arrow is attempted.
    from tests.test_terrain import straight_route
    track = straight_route(200)
    track.route = {"centreLine": "none"}
    junction = SimpleNamespace(route_index=50, turn_side=1)
    assert markings.markings(track, np.zeros(len(track.P)), 3.6, [junction]) == {}


def test_a_pier_on_the_road_is_found_at_car_height_but_a_gateway_over_it_is_not():
    import trimesh
    from sr.landmark_clearance import conflicts
    P = np.c_[np.linspace(-60, 60, 61), np.zeros(61), np.zeros(61)]
    road_y = np.zeros(61)
    hw = np.full(61, 6.0)
    # A gateway: two piers outside the 12 m road, a lintel 8 m up across it.
    piers = [trimesh.creation.box((3, 10, 3), trimesh.transformations.translation_matrix((0, 5, z)))
             for z in (-8.0, 8.0)]
    lintel = trimesh.creation.box((3, 2, 20), trimesh.transformations.translation_matrix((0, 9, 0)))
    gate = trimesh.util.concatenate([*piers, lintel])
    assert conflicts(gate, P, road_y, hw) == []
    # The same gate shifted 5 m sideways puts one pier on the tarmac.
    moved = gate.copy(); moved.apply_translation((0, 0, 5.0))
    hits = conflicts(moved, P, road_y, hw)
    assert hits and max(a for _h, a, _x, _z in hits) > 1.0


def test_no_slime_stands_in_a_declared_memorial_zone_and_bombs_keep_off_boosts():
    from sr.slimes import BOOST_BURST_CLEAR_M, forbidden, placements, zone_reach
    from tests.test_terrain import straight_route
    res = straight_route(length=3000.0)
    lat, lon = res.frame.to_latlon(np.array([1500.0]), np.array([0.0]))
    route = {"id": "memorial", "mode": "p2p",
             "noSlimes": [{"lat": float(lat[0]), "lon": float(lon[0]), "radiusM": 60, "why": "memorial pools"}]}
    items = placements(res, route)
    zone = route["noSlimes"][0]
    for item in items:
        d = np.hypot(item.position[0] - 1500.0, item.position[2])
        assert d > zone_reach(zone, 0.0), (item.kind, item.s, d)
    assert forbidden(res, route).any()
    unrestricted = placements(res, {"id": "memorial", "mode": "p2p"})
    assert len(unrestricted) == len(items), "the count is a game setting: bodies move, they do not vanish"
    bursts = [i.s for i in items if i.kind == "burst" and i.density == "normal"]
    boosts = [i.s for i in items if i.kind == "boost" and i.density == "normal"]
    assert all(abs(a - b) >= BOOST_BURST_CLEAR_M for a in bursts for b in boosts)


def test_an_l_shaped_house_gets_a_hip_roof_that_stays_inside_its_outline():
    from shapely import contains_xy
    from shapely.geometry import Polygon
    from sr.buildings import ROOF_MAX_RISE, outline_hip_roof
    outline = Polygon([(0, 0), (14, 0), (14, 6), (6, 6), (6, 14), (0, 14)])
    roof = outline_hip_roof(outline, 5.0, "house_roof_tile")
    tris = roof.positions[roof.indices.reshape(-1, 3)]
    covered = sum(Polygon(t[:, [0, 2]]).area for t in tris)
    assert abs(covered - outline.area) < 0.5
    assert contains_xy(outline.buffer(0.01), roof.positions[:, 0], roof.positions[:, 2]).all()
    assert 1.0 < roof.positions[:, 1].max() - 5.0 <= ROOF_MAX_RISE
    # the eave is the outline itself: every vertex on the outline sits at eave height
    on_edge = np.array([outline.exterior.distance(__import__("shapely").geometry.Point(x, z)) < 1e-3
                        for x, _y, z in roof.positions])
    assert np.allclose(roof.positions[on_edge, 1], 5.0)


def test_a_building_as_tall_as_a_deck_beside_it_is_cut_back_from_the_deck():
    from sr.buildings import bridge_decks
    from tests.test_terrain import straight_route
    res = straight_route(length=600.0, bridge_span=(200.0, 400.0))
    decks = bridge_decks(res, np.full(len(res.P), 30.0))
    assert len(decks) == 1 and decks[0][1] == 30.0
    assert decks[0][0].area > 180 * 2 * res.half_width[0]


def test_a_declared_low_rise_circle_caps_guessed_heights_but_never_a_tagged_one():
    from sr.buildings import LEVEL_HEIGHT, parse_height, route_height_guess
    from sr.geo import LocalFrame
    frame = LocalFrame(39.9, 116.39)
    route = {"lowRise": [{"lat": 39.9, "lon": 116.39, "radiusM": 300, "maxStoreys": 1, "why": "courtyard houses"}]}
    guess = route_height_guess(route, frame)
    assert guess({"building": "yes"}, 3000.0, (0.0, 0.0)) <= LEVEL_HEIGHT + 1e-9
    assert guess({"building": "yes"}, 3000.0, (1000.0, 0.0)) > 3 * LEVEL_HEIGHT, "outside the circle: unchanged"
    assert parse_height({"height": "40"}) == 40.0      # the build uses a tag before it ever guesses


def test_the_tile_sweep_finds_a_hole_in_the_road_and_not_where_there_is_none():
    from sr.mesh import ribbon
    from sr.roads import ROAD_LIFT
    from sr.surface_check import holes
    from sr.tiles import TileSet
    from tests.test_terrain import straight_route
    res = straight_route(length=600.0)
    road_y = np.zeros(len(res.P))
    spine = np.c_[res.P[:, 0], road_y, res.P[:, 2]]
    ts = TileSet()
    ts.add_mesh("road", ribbon(spine, res.R, res.half_width, y_offset=ROAD_LIFT, material="road"))
    from sr.surface_check import road_triangles
    tris = road_triangles(ts)
    assert holes(res, road_y, tris, ROAD_LIFT) == []
    # cut a 2 m hole out of the middle
    centre = tris[:, :, 0].mean(axis=1)
    holed = tris[~((centre > 299) & (centre < 301))]
    found = holes(res, road_y, holed, ROAD_LIFT)
    assert found and all(298 <= s <= 302 for s, _l in found)
