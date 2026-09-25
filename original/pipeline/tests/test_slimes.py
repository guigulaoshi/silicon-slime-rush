import os
from types import SimpleNamespace

import pytest

import numpy as np

from sr.geom import curvature, resample, rights, tangents
from sr.slimes import (BURST_CLEAR_M, SCALES, SHARP_TURN_CLEAR_M,
                       add_scenery_to_tiles, add_to_tiles, kind_counts, placements,
                       SHAPES, slime_scale, scenery_placements)
from sr.tiles import TileSet


def route_shape(points, closed=False, half=6.0):
    P, S = resample(np.asarray(points, dtype=float), 2.0, closed=closed)
    T = tangents(P, closed)
    return SimpleNamespace(P=P, S=S, T=T, R=rights(T), half_width=np.full(len(P), half),
                           bridge=np.zeros(len(P), dtype=bool),
                           closed=closed, length=float(S[-1] + (S[1] - S[0] if closed else 0)))


def test_density_and_starting_mix_are_owned_by_the_pipeline():
    res = route_shape([(0, 0, 0), (2000, 0, 0)])
    campus = placements(res, {"id": "campus", "category": "campus"})
    # 349: tracks are not classed, so the old scenic label changes nothing; density is only explicit.
    unlabelled = placements(res, {"id": "scenic", "category": "scenic"})
    halved = placements(res, {"id": "halved", "category": "campus", "slimeDensity": 0.5})
    campus_normal = [item for item in campus if item.density == "normal"]
    halved_normal = [item for item in halved if item.density == "normal"]
    assert len(campus_normal) == 88 and len(halved_normal) == 48
    assert len([item for item in unlabelled if item.density == "normal"]) == 88
    assert len(campus) == len(campus_normal) * 2
    assert len(halved) == len(halved_normal) * 2
    assert {kind: sum(item.kind == kind for item in campus_normal) for kind in SCALES} == {
        kind: sum(item.kind == kind for item in campus if item.density == "many") for kind in SCALES}
    assert len({(item.s, item.position) for item in campus}) == len(campus)
    target = kind_counts(88)
    actual = {kind: sum(p.kind == kind for p in campus_normal) for kind in SCALES}
    assert actual["boost"] >= 4, "a normal lap needs several spaced boost encounters"
    assert actual["popper"] >= target["popper"]
    assert actual["slick"] >= target["slick"]
    assert sum(actual.values()) == 88
    assert all(actual[kind] == target[kind] for kind in ("burst", "colossus"))


def assert_giants_spread(res, items, label):
    """Neighbouring giants, across a loop's start line too, stand at least half their even spacing apart."""
    from sr.slimes import _distance
    for density in ("normal", "many"):
        giants = sorted(item.s for item in items if item.kind == "colossus"
                        and (density == "many" or item.density == "normal"))
        if len(giants) < 2:
            continue
        need = res.length / len(giants) / 2
        pairs = list(zip(giants, giants[1:])) + ([(giants[-1], giants[0])] if res.closed else [])
        closest = min(float(_distance(a, b, res.length, res.closed)) for a, b in pairs)
        assert closest >= need, (label, density, giants, closest, need)


def test_giants_never_stand_in_pairs_on_a_loop_or_in_the_dense_setting():
    # Before 375 the loop's 12 %/88 % giants met across the start line, and each dense giant stood
    # 44 m from a normal one because both populations aimed at the same stations.
    loop = route_shape([(0, 0, 0), (700, 0, 0), (700, 0, 500), (0, 0, 500), (0, 0, 0)], closed=True, half=8)
    line = route_shape([(0, 0, 0), (3000, 0, 0)], half=8)
    for label, res in (("loop", loop), ("line", line)):
        items = placements(res, {"id": f"giants-{label}"})
        assert sum(item.kind == "colossus" and item.density == "normal" for item in items) >= 2
        assert_giants_spread(res, items, label)


def test_a_route_that_drops_a_giant_respaces_the_rest():
    # Straight road only in the first third: four giants cannot keep their spacing there, and the
    # two that remain must keep the spacing of two, not of four.
    zigzag = [(1426.25 + 40 * k, 0, 0 if k % 2 == 0 else 30) for k in range(1, 69)]
    res = route_shape([(0, 0, 0), (1426.25, 0, 0), *zigzag], half=7)
    items = placements(res, {"id": "zig4075-0.35"})
    giants = [item for item in items if item.kind == "colossus" and item.density == "normal"]
    assert 1 <= len(giants) < 4
    assert_giants_spread(res, items, "front-straight")


def test_every_shipping_route_has_a_continuous_dense_second_population():
    from sr.route import build_route
    from sr.routes import all_route_ids, load_route
    from sr.slimes import _distance

    checked = 0
    route_ids = [route_id for route_id in all_route_ids() if not (os.environ.get("SR_SKIP_101") == "1" and route_id == "bayshore-101")]
    for route_id in route_ids:
        res = build_route(route_id)
        items = placements(res, load_route(route_id))
        normal = [item for item in items if item.density == "normal"]
        extras = [item for item in items if item.density == "many"]
        assert len(extras) == len(normal), route_id
        giants = [item for item in normal if item.kind == "colossus"]
        assert len(giants) >= 2, route_id
        dense_giants = [item for item in extras if item.kind == "colossus"]
        assert len(dense_giants) == len(giants), route_id
        assert {kind: sum(item.kind == kind for item in normal) for kind in SCALES} == {
            kind: sum(item.kind == kind for item in extras) for kind in SCALES}, route_id
        popper_share = sum(item.kind == "popper" for item in normal) / len(normal)
        assert popper_share >= .35, (route_id, popper_share)
        for giant in giants:
            i = int(np.searchsorted(res.S, giant.s))
            assert np.allclose(np.asarray(giant.position)[[0, 2]], res.P[i, [0, 2]]), route_id
            assert 9.9 <= giant.scale[2] <= 21.6, route_id
            assert giant.scale[0] >= res.half_width[i], route_id
            assert np.isclose(giant.scale[0] / giant.scale[2], 1), route_id

        assert_giants_spread(res, items, route_id)
        assert len({item.s for item in extras}) == len(extras), route_id
        dense_s = sorted(item.s for item in items)
        gaps = np.diff(dense_s)
        if res.closed:
            gaps = np.append(gaps, res.length - dense_s[-1] + dense_s[0])
        assert np.max(gaps) <= 125.0, (route_id, np.max(gaps))
        checked += 1
    assert checked == len(route_ids) and checked > 0


@pytest.mark.skipif(os.environ.get("SR_SKIP_101") == "1", reason="user requested skipping the route pending shortening")
def test_long_route_colossi_are_visibly_different_sizes():
    from sr.route import build_route
    from sr.routes import load_route
    items = placements(build_route("bayshore-101"), load_route("bayshore-101"))
    radii = [item.scale[0] for item in items if item.kind == "colossus"]
    assert len(radii) >= 5
    assert np.ptp(radii) >= 2.0


def test_sparse_single_risks_hazards_and_roadblocks_follow_distinct_rules():
    res = route_shape([(0, 0, 0), (500, 0, 0), (500, 0, 400), (1100, 0, 400)])
    junction = SimpleNamespace(route_index=int(np.searchsorted(res.S, 240.0)))
    all_items = placements(res, {"id": "rules", "category": "campus"}, [junction])
    items = [item for item in all_items if item.density == "normal"]

    poppers = [p for p in items if p.kind == "popper"]
    popper_gaps = np.diff(sorted(p.s for p in poppers))
    assert len(popper_gaps) > 2
    assert np.min(popper_gaps) >= 12.0, "added ordinary slimes preserve a separate impact gap"
    assert np.ptp(popper_gaps) > 5.0, "road risks must not look measured out"
    laterals = [float(np.dot(np.asarray(p.position) - res.P[
        int(np.searchsorted(res.S, p.s))], res.R[int(np.searchsorted(res.S, p.s))]))
                for p in poppers]
    assert {int(np.sign(value)) for value in laterals} == {-1, 1}
    assert np.ptp(np.abs(laterals)) > 0.5, "single risks should vary from inner lane to rail"

    hazards = [p for p in items if p.kind == "slick"]
    corner_s = (500.0, 900.0)
    junction_exit_s = float(res.S[junction.route_index]) + 16.0
    anchors = (*corner_s, junction_exit_s)
    assert any(abs(p.s - junction_exit_s) <= 50 for p in hazards)

    curve = curvature(res.P, res.S, res.closed)
    sharp = [float(res.S[i]) for i in np.flatnonzero(np.abs(curve) >= 0.02)]
    assert sharp
    assert all(min(abs(p.s - bend) for bend in sharp) >= SHARP_TURN_CLEAR_M
               for p in items if p.kind != "slick")
    bursts = [p for p in items if p.kind == "burst"]
    for burst in bursts:
        i = int(np.searchsorted(res.S, burst.s))
        assert np.max(np.abs(curve[max(0, i - 15):i + 16])) <= 0.006
        assert all(abs(burst.s - other.s) >= BURST_CLEAR_M for other in items if other is not burst)

    for giant in (p for p in items if p.kind == "colossus"):
        i = int(np.searchsorted(res.S, giant.s))
        centre = res.P[i]
        lateral = abs(float(np.dot(np.asarray(giant.position) - centre, res.R[i])))
        assert lateral < 1e-9, "the giant must cover the racing carriageway centre"
        assert giant.scale[0] >= 9.9
        assert np.isclose(giant.position[1] - centre[1], giant.scale[1] * SHAPES["colossusGroundFraction"] + .04)

    for item in items:
        i = int(np.searchsorted(res.S, item.s))
        lateral = abs(float(np.dot(np.asarray(item.position) - res.P[i], res.R[i])))
        if item.kind != "colossus":
            assert lateral + item.scale[0] <= res.half_width[i]

    boosts = [p for p in items if p.kind == "boost"]
    assert boosts
    for boost in boosts:
        i = int(np.searchsorted(res.S, boost.s))
        end = int(np.searchsorted(res.S, boost.s + 68.0))
        assert np.max(np.abs(curve[i:end + 1])) <= 0.006

    dense_s = sorted(item.s for item in all_items)
    dense_gaps = np.diff(dense_s)
    assert len(all_items) == len(items) * 2
    if res.closed:
        dense_gaps = np.append(dense_gaps, res.length - dense_s[-1] + dense_s[0])
    assert np.max(dense_gaps) <= 60.0, "many mode fills the normal population's largest gaps"


def test_instances_carry_kind_position_rotation_and_per_instance_size():
    res = route_shape([(0, 0, 0), (1200, 0, 0)])
    items = placements(res, {"id": "export", "category": "campus"})
    tiles = TileSet()
    add_to_tiles(tiles, items)
    instances = [inst for tile in tiles.instances.values() for inst in tile.values()]
    names = {name for tile in tiles.instances.values() for name in tile}
    assert names == {*(f"props_slime_{kind}" for kind in SCALES),
                     *(f"props_slime_many_{kind}" for kind in SCALES)}
    assert sum(len(inst["positions"]) for inst in instances) == len(items)
    assert all(len(inst["positions"]) == len(inst["yaws"]) == len(inst["scales"])
               for inst in instances)
    assert {tuple(scale) for inst in instances for scale in inst["scales"]} == {item.scale for item in items}
    assert len({item.scale for item in items}) == len(items)


def test_a_route_with_no_visible_straight_never_falls_back_to_a_blind_burst():
    angle = np.linspace(0, 2 * np.pi, 220, endpoint=False)
    circle = np.column_stack((55 * np.cos(angle), np.zeros(len(angle)), 55 * np.sin(angle)))
    res = route_shape(circle, closed=True)
    items = placements(res, {"id": "tight-ring", "category": "campus"})
    normal = [item for item in items if item.density == "normal"]
    previous = max(20, round(res.length / 55.0))
    assert len(normal) <= 2 * (previous + (previous + 4) // 5)
    assert len(items) == len(normal) * 2
    assert not [item for item in normal if item.kind == "burst"]
    assert not [item for item in normal if item.kind == "boost"]


def test_a_route_made_entirely_of_tight_turns_keeps_nonvolatile_risks():
    points = [(i * 36.0, 0, (i % 2) * 36.0) for i in range(18)]
    res = route_shape(points, half=6.0)
    items = [item for item in placements(res, {"id": "dense-turns", "category": "campus"})
             if item.density == "normal"]
    assert items
    assert {item.kind for item in items} <= {"popper", "slick", "colossus"}
    for item in (item for item in items if item.kind == "popper"):
        i = int(np.searchsorted(res.S, item.s))
        lateral = abs(float(np.dot(np.asarray(item.position) - res.P[i], res.R[i])))
        assert lateral + item.scale[0] <= res.half_width[i]


def test_static_scenery_slimes_use_roofs_and_distant_ground_without_gameplay_nodes():
    res = route_shape([(0, 0, 0), (1200, 0, 0)])
    res.frame = SimpleNamespace(to_latlon=lambda x, z: (z, x))
    dem = SimpleNamespace(heights=lambda lat, lon: np.full(len(lat), 8.0))
    roof_box = [25.0, 13.0, 70.0, 8.0, 7.0, 6.0, 0.0]
    items = scenery_placements(res, dem, [roof_box], "worldwide")
    assert len(items) == 12
    roof = [item for item in items if np.isclose(item.position[1] - item.scale[1], 20.03)]
    assert len(roof) == 1 and roof[0].position[0] == 25 and roof[0].position[2] == 70
    assert all(abs(item.position[2]) >= 9.0 for item in items)
    assert len({tuple(round(value, 2) for value in item.scale) for item in items}) >= 10

    tiles = TileSet()
    add_scenery_to_tiles(tiles, items)
    names = {name for tile in tiles.instances.values() for name in tile}
    assert names == {"scenery_slime", "scenery_slime_many"}
    assert sum(len(inst["positions"]) for tile in tiles.instances.values() for inst in tile.values()) == len(items)


def test_full_width_population_has_no_central_exclusion_in_either_density():
    res = route_shape([(0, 0, 0), (10000, 0, 0)], half=8)
    items = placements(res, {"id": "full-width", "category": "campus"})
    for density in ("normal", "many"):
        population = [item for item in items if item.density == density and item.kind != "colossus"]
        normalized = []
        for item in population:
            i = int(np.searchsorted(res.S, item.s))
            offset = float(np.dot(np.asarray(item.position) - res.P[i], res.R[i]))
            normalized.append(offset / (res.half_width[i] - item.scale[0] - .2))
            assert abs(offset) + item.scale[0] <= res.half_width[i]
        counts, _ = np.histogram(normalized, bins=5, range=(-1, 1))
        assert len(population) > 150
        assert np.all(counts > len(population) * .1), (density, counts)


def test_background_population_covers_long_routes_without_world_space_clumps():
    for length in (3000, 64800):
        res = route_shape([(0, 0, 0), (length, 0, 0)])
        res.frame = SimpleNamespace(to_latlon=lambda x, z: (z, x))
        dem = SimpleNamespace(heights=lambda lat, lon: np.full(len(lat), 8.0))
        items = scenery_placements(res, dem, [], "long-background")
        assert items == scenery_placements(res, dem, [], "long-background")
        for density in ("normal", "many"):
            population = [item for item in items if item.density == density]
            assert len(population) == round(length / 200)
            bins, _ = np.histogram([item.s for item in population], bins=10, range=(0, length))
            assert bins.min() >= len(population) // 10
        for i, item in enumerate(items):
            for other in items[i + 1:]:
                assert np.hypot(item.position[0] - other.position[0], item.position[2] - other.position[2]) >= (item.scale[0] + other.scale[0]) * 1.04 + 12


def test_background_rejects_water_without_reallocating_it_to_dry_start():
    res = route_shape([(0, 0, 0), (3000, 0, 0)])
    res.frame = SimpleNamespace(to_latlon=lambda x, z: (z, x))
    dem = SimpleNamespace(heights=lambda lat, lon: np.where(lon < 1500, 8., 0.))
    items = scenery_placements(res, dem, [], "water")
    assert len(items) == 15
    assert all(item.s < 1500 for item in items)


def test_shipped_normal_populations_are_twice_the_pre_247_counts():
    from sr.route import build_route
    from sr.routes import load_route
    baseline = {"fishermans-wharf":32, "goldengate":48, "lombard":21,
                "shoreline":43, "twin-peaks":17, "wolfe-pruneridge":24}
    for name, before in baseline.items():
        items = placements(build_route(name), load_route(name))
        normal = [x for x in items if x.density == "normal"]
        assert len(normal) == 2 * (before + (before + 4) // 5), name
        assert len(items) == 2 * len(normal), name


def test_ordinary_sizes_span_one_to_eight_metres_with_one_height_ratio():
    for kind in SCALES:
        samples = np.asarray([slime_scale(kind, u) for u in np.linspace(0, 1, 1001)])
        radii = samples[:, [0, 2]].max(axis=1)
        assert np.allclose(np.diff(radii), np.diff(radii)[0])
        assert np.allclose([radii[0], radii[-1]], SHAPES[kind]["radius"])
        if kind not in ("colossus", "slick"):
            assert np.allclose([radii[0] * 2, radii[-1] * 2], [1, 8])
            assert np.allclose(samples[:, 1] / radii, SHAPES["ordinaryHeightRatio"])
        if kind == "slick":
            assert np.allclose([radii[0] * 2, radii[-1] * 2], [1.5, 3.5])
        assert len(np.unique(samples[:, 0])) == 1001
    small, giant = slime_scale("popper", 0), slime_scale("colossus", 1)
    assert np.isclose(small[0] * 2, 1)
    assert np.isclose(giant[0] * 2, 24 * 1.8)
    assert giant[1] > small[1]



def test_doubled_scenery_bodies_stay_outside_every_bend_of_the_racing_surface():
    from shapely.geometry import Point
    from sr.buildings import road_footprint
    res = route_shape([(0,0,0),(300,0,0),(300,0,30),(0,0,30),(0,0,65),(300,0,65)])
    res.frame = SimpleNamespace(to_latlon=lambda x,z:(z,x))
    dem = SimpleNamespace(heights=lambda lat,lon:np.full(len(lat),8.0))
    bodies=scenery_placements(res,dem,[],"bends")
    assert len(bodies) >= 10
    road=road_footprint(res,margin=.5)
    for item in bodies:
        position, scale = item.position, item.scale
        assert SHAPES["popper"]["radius"][0] <= scale[0] <= SHAPES["popper"]["radius"][1]
        assert not road.intersects(Point(position[0],position[2]).buffer(max(scale[0],scale[2])*1.04))


def test_ground_scenery_yields_to_visible_buildings_beyond_collider_range():
    from shapely.geometry import Point
    from sr.buildings import box_polygon
    res = route_shape([(0, 0, 0), (3000, 0, 0)])
    res.frame = SimpleNamespace(to_latlon=lambda x, z: (z, x))
    dem = SimpleNamespace(heights=lambda lat, lon: np.full(len(lat), 8.0))
    before = scenery_placements(res, dem, [], "distant-building")
    obstructed = next(item for item in before if abs(item.position[2]) > 60)
    x, _, z = obstructed.position
    building = [x, 8., z, 10., 1., 10., 0.]
    footprint = box_polygon(x, z, 10., 10., 0.)
    assert footprint.intersects(Point(x, z).buffer(obstructed.scale[0] * 1.04))
    after = scenery_placements(res, dem, [building], "distant-building")
    ground = [item for item in after if np.isclose(item.position[1] - item.scale[1], 8.03)]
    assert len(ground) >= 25
    assert all(not footprint.intersects(Point(item.position[0], item.position[2]).buffer(item.scale[0] * 1.04 + 3))
               for item in ground)


def test_ordinary_share_uses_the_shared_population_contract():
    from sr.slimes import WEIGHTS, kind_counts
    assert sum(WEIGHTS.values()) == 100
    assert WEIGHTS["popper"] == 39
    assert WEIGHTS["boost"] == 24
    assert kind_counts(100)["popper"] == 39
    assert kind_counts(100)["boost"] == 24


def test_many_population_never_reuses_normal_stations_and_stays_spread_out():
    res = route_shape([(0, 0, 0), (3000, 0, 0)], half=8)
    items = placements(res, {"id": "spread", "category": "campus"})
    normal = [item for item in items if item.density == "normal"]
    many = [item for item in items if item.density == "many"]
    assert not ({round(item.s, 6) for item in normal} & {round(item.s, 6) for item in many})
    assert max(sum(np.hypot(item.position[0] - other.position[0],
                            item.position[2] - other.position[2]) < 16 for other in items)
               for item in items) <= 5
    for i, item in enumerate(items):
        for other in items[i + 1:]:
            distance = np.hypot(item.position[0] - other.position[0],
                                item.position[2] - other.position[2])
            assert distance >= (max(item.scale[0], item.scale[2])
                                + max(other.scale[0], other.scale[2]) + .35)


def test_road_population_does_not_clump_where_the_route_doubles_back():
    res = route_shape([(0, 0, 0), (900, 0, 0), (900, 0, 18),
                       (0, 0, 18), (0, 0, 42), (900, 0, 42)], half=8)
    items = placements(res, {"id": "road-hairpin", "category": "campus"})
    for i, item in enumerate(items):
        for other in items[i + 1:]:
            distance = np.hypot(item.position[0] - other.position[0],
                                item.position[2] - other.position[2])
            assert distance >= (max(item.scale[0], item.scale[2])
                                + max(other.scale[0], other.scale[2]) + .35)


def test_normal_lap_has_several_boosts_without_continuous_boosting():
    res = route_shape([(0, 0, 0), (3000, 0, 0)], half=8)
    boosts = [item for item in placements(res, {"id": "boost-cadence", "category": "campus"})
              if item.density == "normal" and item.kind == "boost"]
    assert len(boosts) >= 6
    assert np.min(np.diff([item.s for item in boosts])) >= 180.0


def test_route_population_uses_the_shared_mix_without_a_second_weight_source():
    res = route_shape([(0, 0, 0), (2000, 0, 0)])
    route = {"id": "campus", "category": "campus"}
    normal = [item for item in placements(res, route) if item.density == "normal"]
    target = kind_counts(len(normal))
    missing_boost = target["boost"] - sum(item.kind == "boost" for item in normal)
    assert sum(item.kind == "popper" for item in normal) == target["popper"] + (missing_boost + 1) // 2


def test_purple_hazards_keep_their_spacing_when_the_route_has_few_corners():
    """Golden Gate is corner-free for
    3.4 km, so every normal purple hazard crowded onto the few corner sites after it: ten in 70 m, some 2 m
    apart, because the pick dropped its spacing once the corner sites ran out."""
    arc = [(3000 + 80 * np.sin(a), 0, 80 - 80 * np.cos(a)) for a in np.linspace(0, np.pi / 2, 24)]
    hairpin = [(3080 + 20 - 20 * np.cos(a), 0, 900 + 20 * np.sin(a)) for a in np.linspace(0, np.pi, 24)]
    res = route_shape([(0, 0, 0), *arc, *hairpin, (3120, 0, 0)], half=7)
    items = placements(res, {"id": "few-corners", "category": "campus"})
    normal = [item for item in items if item.density == "normal"]
    hazards = sorted(item.s for item in normal if item.kind == "slick")
    assert len(hazards) >= 10
    assert float(np.min(np.diff(hazards))) >= 28.0, hazards
    # Spreading them out must not push them onto what the corner sites already avoided.
    curve = curvature(res.P, res.S, res.closed)
    sharp = [float(res.S[i]) for i in np.flatnonzero(np.abs(curve) >= 0.02)]
    assert sharp
    for s in hazards:
        assert min(abs(s - bend) for bend in sharp) >= SHARP_TURN_CLEAR_M, s
        assert all(abs(s - other.s) >= BURST_CLEAR_M for other in normal if other.kind in ("burst", "boost")), s
