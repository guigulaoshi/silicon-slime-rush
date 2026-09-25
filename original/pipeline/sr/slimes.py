"""Deterministic route-aware slime placement, exported as instanced tile metadata."""
from dataclasses import dataclass
import zlib
import json
from pathlib import Path

import numpy as np

from sr.geom import curvature
from sr.mesh import box, yaw_for_z_axis


KINDS = ("popper", "slick", "burst", "boost", "colossus")
WEIGHTS = json.loads((Path(__file__).parent / "schema/slime-population.json").read_text())
SHAPES = json.loads((Path(__file__).parent / "schema/slime-shapes.json").read_text())


def round_slime_scale(radius):
    if radius <= SHAPES["popper"]["radius"][1]:
        return (radius, radius * SHAPES["ordinaryHeightRatio"], radius)
    fraction = np.clip((radius - SHAPES["popper"]["radius"][0]) /
                       (SHAPES["colossus"]["radius"][1] - SHAPES["popper"]["radius"][0]), 0, 1)
    ratio = SHAPES["heightRatio"][0] + fraction * (SHAPES["heightRatio"][1] - SHAPES["heightRatio"][0])
    return (radius, radius * ratio, radius)


def slime_scale(kind, fraction):
    shape = SHAPES[kind]
    radius = shape["radius"][0] + fraction * (shape["radius"][1] - shape["radius"][0])
    ground = SHAPES["colossusGroundFraction"] if kind == "colossus" else 1
    return (radius * shape["aspect"][0], round_slime_scale(radius)[1] * 2 / (1 + ground),
            radius * shape["aspect"][1])


SCALES = {kind: slime_scale(kind, .5) for kind in KINDS}
BASE_SPACING_M = 55.0
BURST_CLEAR_M = 18.0
SHARP_TURN_CLEAR_M = 65.0
SCENERY_SPACING_M = 200.0
# Closest two normal-density purple hazards may stand along the route.
SLICK_GAP_M = 28.0
GIANT_CLEAR_M = 44.0


@dataclass(frozen=True)
class SlimePlacement:
    kind: str
    s: float
    position: tuple[float, float, float]
    yaw: float
    scale: tuple[float, float, float]
    density: str = "normal"


def scenery_placements(res, dem, building_boxes, route_id, water_level=0.0):
    """Sparse off-road bodies share the ordinary popper size range."""
    from shapely.geometry import Point
    from shapely.strtree import STRtree
    from sr.buildings import box_polygon, road_footprint
    from sr.geom import project

    rng = np.random.default_rng(zlib.crc32((route_id + ":scenery").encode("utf-8")))
    road = road_footprint(res, margin=.5)
    buildings = STRtree([box_polygon(b[0], b[2], b[3], b[5], b[6]) for b in building_boxes])
    cells = max(1, int(round(res.length / SCENERY_SPACING_M)))
    step = res.length / cells
    roofs = {}
    for b in building_boxes:
        if min(float(b[3]), float(b[5])) < 2.5 or float(b[4]) < 2.0:
            continue
        s, lateral, _ = project(res.P, res.S, b[0], b[2], res.closed)
        if abs(lateral) <= 100:
            roofs.setdefault(min(cells - 1, int(s / step)), []).append((s, b))
    out = []

    def accept(s, position, scale, density):
        bound = scale[0] * 1.04
        footprint = Point(position[0], position[2]).buffer(bound)
        if road.intersects(footprint):
            return False
        # A route can double back: separation must be measured in world space, not route distance.
        if any(np.hypot(position[0] - other.position[0], position[2] - other.position[2])
               < bound + other.scale[0] * 1.04 + 12 for other in out):
            return False
        out.append(SlimePlacement("popper", float(s), position, 0.0, scale, density))
        return True

    for density, fraction in (("normal", .25), ("many", .75)):
        for cell in range(cells):
            target = (cell + fraction + rng.uniform(-.1, .1)) * step
            # At most one rooftop per interval, using the same population budget as ground bodies.
            candidates = roofs.get(cell, []) if density == "normal" else []
            placed = False
            for roof_s, b in sorted(candidates, key=lambda item: abs(item[0] - target)):
                if abs(roof_s - target) > step * .3:
                    continue
                cx, cy, cz, hx, hy, hz, yaw = b
                scale = slime_scale("popper", rng.uniform())
                if scale[0] > min(hx / 1.04, hz / 1.04):
                    continue
                if accept(roof_s, (float(cx), float(cy + hy + scale[1] + .03), float(cz)), scale, density):
                    placed = True
                    break
            if placed:
                continue
            # Alternatives stay in this interval; water or a building never shifts its quota to
            # the start of the route. Keep a clear view of facades and avoid overlapping bodies.
            for attempt in range(12):
                s = float(np.clip(target + rng.uniform(-.12, .12) * step, 0, res.length))
                i = int(np.clip(np.searchsorted(res.S, s), 0, len(res.S) - 1))
                side = (-1.0 if (cell + attempt) % 2 else 1.0)
                scale = slime_scale("popper", rng.uniform())
                radius = scale[0]
                bound = radius * 1.04
                distance = float(res.half_width[i] + bound + rng.uniform(14, 65))
                x = float(res.P[i, 0] + res.R[i, 0] * side * distance)
                z = float(res.P[i, 2] + res.R[i, 2] * side * distance)
                if len(buildings.query(Point(x, z).buffer(bound + 3), predicate="intersects")):
                    continue
                lat, lon = res.frame.to_latlon(np.array([x]), np.array([z]))
                ground = float(dem.heights(lat, lon)[0])
                if ground <= water_level + .25:
                    continue
                if accept(s, (x, ground + scale[1] + .03, z), scale, density):
                    break
    return sorted(out, key=lambda item: (item.s, item.density))


def road_lateral(half_width, radius, rng):
    """Sample the complete racing carriageway, retaining the body's clearance from its edges."""
    limit = max(0.0, half_width - radius - .2)
    return float(rng.uniform(-limit, limit))


def _place_without_overlap(res, kind, preferred_s, legal_sites, rng, size_rng, density, occupied,
                           station_clearance=.5):
    """Materialize one station, moving only among terrain-legal samples until its body fits."""
    fraction = size_rng.uniform()
    if kind == "colossus":
        low, high = SHAPES[kind]["radius"]
        i = int(np.clip(np.searchsorted(res.S, preferred_s), 0, len(res.S) - 1))
        road_fraction = np.clip((float(res.half_width[i]) - low) / (high - low), 0, 1)
        fraction = road_fraction + fraction * (1 - road_fraction)
    scale = slime_scale(kind, fraction)
    radius = max(scale[0], scale[2])
    sites = sorted(set([float(preferred_s), *(float(s) for s in legal_sites)]),
                   key=lambda s: float(_distance(s, preferred_s, res.length, res.closed)))
    for site_s in sites:
        if any(float(_distance(site_s, other.s, res.length, res.closed))
               < (BURST_CLEAR_M if density == "normal" and other.density == "normal"
                  and (kind == "burst" or other.kind == "burst")
                  else station_clearance if other.kind == kind else .5)
               for other in occupied):
            continue
        i = int(np.clip(np.searchsorted(res.S, site_s), 0, len(res.S) - 1))
        p, right, tangent = res.P[i], res.R[i], res.T[i]
        half = float(res.half_width[i])
        limit = max(0.0, half - radius - .2)
        if kind == "colossus":
            laterals = [0.0]
        else:
            first = road_lateral(half, radius, rng)
            laterals = [first, *np.linspace(-limit, limit, 11).tolist()]
        for lateral in laterals:
            x = float(p[0] + right[0] * lateral)
            z = float(p[2] + right[2] * lateral)
            if any(np.hypot(x - other.position[0], z - other.position[2])
                   < radius + max(other.scale[0], other.scale[2]) + .35 for other in occupied):
                continue
            yaw = yaw_for_z_axis(-tangent)
            if kind in ("slick", "popper", "burst"):
                yaw += float(rng.uniform(-0.28, 0.28))
            ground = SHAPES["colossusGroundFraction"] if kind == "colossus" else 1
            return SlimePlacement(kind, site_s,
                (x, float(p[1] + scale[1] * ground + .04), z), yaw, scale, density)
    raise ValueError(f"cannot place non-overlapping {density} {kind} near {preferred_s:.1f} m")


def kind_counts(total, weights=WEIGHTS):
    """Largest-remainder shared population split, with every kind present on a short route."""
    total = max(int(total), len(KINDS))
    raw = {kind: total * weights[kind] / 100.0 for kind in KINDS}
    counts = {kind: int(np.floor(raw[kind])) for kind in KINDS}
    for kind in KINDS[1:]:
        counts[kind] = max(2 if kind == "colossus" else 1, counts[kind])
    while sum(counts.values()) < total:
        kind = max(KINDS, key=lambda k: (raw[k] - counts[k], weights[k]))
        counts[kind] += 1
    while sum(counts.values()) > total:
        kind = max((k for k in KINDS if counts[k] > (2 if k == "colossus" else 1 if k != "popper" else 0)),
                   key=lambda k: counts[k] - raw[k])
        counts[kind] -= 1
    return counts


def _distance(a, b, length, closed):
    d = abs(a - b)
    return np.minimum(d, length - d) if closed else d


def _pick(candidates, count, length, closed, exclude=(), clearance=0.0, min_separation=None,
          strict_separation=False, target_range=None, targets=None):
    """Pick the same nearest allowed sites, updating separation once per new choice."""
    candidates = np.array(sorted(set(float(s) for s in candidates
                            if 20.0 <= s <= length - (0.0 if closed else 20.0))))
    if not len(candidates) or count <= 0:
        return []
    available = np.ones(len(candidates), dtype=bool)
    for site in exclude:
        available &= _distance(candidates, site, length, closed) >= clearance
    separated = available.copy()
    gap = min_separation if min_separation is not None else min(55.0, length / max(count, 1) * 0.45)
    picked = []
    target_start, target_end = target_range or (length * 0.12, length * 0.88)
    for target in (targets if targets is not None else np.linspace(target_start, target_end, count)):
        pool = np.flatnonzero(separated)
        if not len(pool) and not strict_separation:
            pool = np.flatnonzero(available)
        if not len(pool):
            break
        index = int(pool[np.argmin(_distance(candidates[pool], target, length, closed))])
        choice = float(candidates[index])
        picked.append(choice)
        available[index] = False
        separated &= _distance(candidates, choice, length, closed) >= gap
        separated[index] = False
    return picked


def giant_stations(length, count):
    """Both densities' giants share one even spacing: normal takes the even stations, many the odd.

    Stations sit at (j + 0.5) / (2 * count) of the route, so a loop's last and first giant are as far
    apart across the start line as any other neighbours (12 %/88 % targets paired them there,
    and the dense population's own 12-88 % targets landed each extra giant 44-92 m from a normal one).
    """
    stations = [length * (j + .5) / (2 * count) for j in range(2 * count)]
    return stations[0::2], stations[1::2]


def giant_gap(length, total):
    """The closest two giants may stand along the route: half their even spacing."""
    return length / max(total, 1) / 2


def _clear_of(candidates, excluded, length, closed, clearance):
    return [s for s in candidates
            if all(_distance(s, bend, length, closed) >= clearance for bend in excluded)]


def _fill_largest_gaps(occupied, count, length, closed):
    """Put each dense extra at the midpoint of the largest remaining route gap."""
    points = sorted(float(s) for s in occupied)
    out = []
    for _ in range(count):
        if closed:
            ends = [*points[1:], points[0] + length]
            gaps = np.asarray(ends) - np.asarray(points)
            index = int(np.argmax(gaps))
            left, gap = points[index], float(gaps[index])
            target = (left + gap * .5) % length
        else:
            anchors = [20.0, *points, max(20.01, length - 20.0)]
            gaps = np.diff(anchors)
            index = int(np.argmax(gaps))
            left, gap = anchors[index], float(gaps[index])
            target = left + gap * .5
        points.insert(int(np.searchsorted(points, target)), target)
        out.append(target)
    return sorted(out)


def _straight_sites(res, curve):
    """Centres of 60 m windows with no blind bend: the only legal volatile sites."""
    out = []
    radius = max(1, int(round(30.0 / max(float(res.S[1] - res.S[0]), 0.5))))
    for i in range(radius, len(res.S) - radius):
        if np.max(np.abs(curve[i - radius:i + radius + 1])) <= 0.006:
            out.append(float(res.S[i]))
    return out


def _straight_entry_sites(res, curve, min_length=100.0):
    """One safe entry per long straight, with at least about 70 m still ahead of the blob."""
    candidates = _straight_sites(res, curve)
    if not candidates:
        return []
    step = max(float(np.median(np.diff(res.S))), 0.5)
    groups = [[candidates[0]]]
    for s in candidates[1:]:
        if s - groups[-1][-1] <= step * 1.6:
            groups[-1].append(s)
        else:
            groups.append([s])
    # Each candidate already owns a clear 30 m window on both sides. The group's span is the
    # remainder of the straight, so its first member sits just after the bend and before the long
    # acceleration run instead of halfway down it.
    return [group[0] for group in groups if group[-1] - group[0] + 60.0 >= min_length]


def _corner_sites(res, curve):
    order = np.argsort(-np.abs(curve))
    sites = []
    for i in order:
        s = float(res.S[int(i)])
        if abs(float(curve[int(i)])) < 0.008:
            break
        if all(_distance(s, other, res.length, res.closed) >= 24.0 for other in sites):
            sites.append(s)
    return sites


def _sharp_turn_sites(res, curve):
    """All samples in bends too tight to combine fairly with a slime interaction."""
    return [float(res.S[int(i)]) for i in np.flatnonzero(np.abs(curve) >= 0.02)]


def placements(res, route, junctions=()):
    """Place all five kinds from route shape, junctions and one route-level density multiplier."""
    density = float(route.get("slimeDensity", 1.0))   # no per-category default: tracks are not classed (349)
    previous = max(20, int(round(res.length * density / BASE_SPACING_M)))
    total = int(route.get("slimeCount", 2 * (previous + (previous + 4) // 5)))
    counts = kind_counts(total)
    curve = curvature(res.P, res.S, res.closed)
    rng = np.random.default_rng(zlib.crc32(route["id"].encode("utf-8")))
    straight = _straight_sites(res, curve)
    sharp_turns = _sharp_turn_sites(res, curve)
    # Seeded candidates keep rebuilds reproducible without making the road read like objects were
    # measured out by a crew. Selection below still owns the safety clearances.
    fallback = np.sort(rng.uniform(25.0, max(25.01, res.length - 25.0),
                                   max(40, total * 6))).tolist()
    # Ten extra metres cover a giant's long body and the car's landing.
    turn_anchor_clearance = SHARP_TURN_CLEAR_M + 10.0
    straight_safe = _clear_of(straight, sharp_turns, res.length, res.closed,
                              turn_anchor_clearance)
    fallback_safe = _clear_of(fallback, sharp_turns, res.length, res.closed,
                              turn_anchor_clearance)
    all_sites = [float(s) for s in res.S]
    all_safe = _clear_of(all_sites, sharp_turns, res.length, res.closed,
                         turn_anchor_clearance)
    burst_s = _pick(straight_safe, counts["burst"], res.length, res.closed)
    # A route with no 60 m clear window gets no volatile bubble. Quietly putting it on the least
    # bad bend would turn a declared safety rule into a guess; light or timed hazards take its share.
    missing_burst = counts["burst"] - len(burst_s)
    counts["burst"] = len(burst_s)
    counts["popper"] += (missing_burst + 1) // 2
    counts["slick"] += missing_burst // 2
    colossus_pool = straight_safe or straight or fallback
    giant_max = float(SHAPES["colossus"]["radius"][1])
    colossus_pool = [s for s in colossus_pool
                      if res.half_width[min(int(np.searchsorted(res.S, s)), len(res.S) - 1)] <= giant_max]
    # A route that cannot hold its giants apart gets fewer of them, never a pair: each
    # smaller count re-spaces its stations and widens the gap it must keep.
    for giants in range(counts["colossus"], 0, -1):
        normal_stations, many_stations = giant_stations(res.length, giants)
        colossus_s = _pick(colossus_pool, giants, res.length, res.closed,
                            exclude=burst_s, clearance=BURST_CLEAR_M + 12.0,
                            min_separation=giant_gap(res.length, giants),
                            strict_separation=True, targets=normal_stations)
        if len(colossus_s) == giants:
            break
    counts["popper"] += counts["colossus"] - len(colossus_s)
    counts["colossus"] = len(colossus_s)
    boost_candidates = _clear_of(straight, sharp_turns,
                                 res.length, res.closed, turn_anchor_clearance)
    boost_candidates = _clear_of(boost_candidates, colossus_s,
                                 res.length, res.closed, GIANT_CLEAR_M)
    boost_target = min(counts["boost"], max(3, int(round(res.length / 450.0))))
    boost_s = _pick(boost_candidates, boost_target, res.length, res.closed,
                    exclude=burst_s, clearance=BURST_CLEAR_M,
                    min_separation=180.0, strict_separation=True)
    # A boost on a bend is worse than no boost. Routes without enough long straights hand unused
    # boost slots to light or timed hazards instead of forcing the reward into an unsafe location.
    missing_boost = counts["boost"] - len(boost_s)
    counts["boost"] = len(boost_s)
    counts["popper"] += (missing_boost + 1) // 2
    counts["slick"] += missing_boost // 2

    junction_s = [min(res.length - 20.0, float(res.S[j.route_index]) + 16.0) for j in junctions]
    hazard_anchors = [*junction_s, *_corner_sites(res, curve)]
    hazard_sites = [float(np.clip(anchor + delta, 20.0, res.length - (0.0 if res.closed else 20.0)))
                    for anchor in hazard_anchors
                    for delta in (-48.0, -36.0, -24.0, -12.0, 0.0, 12.0, 24.0, 36.0, 48.0)]
    if not hazard_sites:
        hazard_sites = fallback_safe
    hazard_sites = _clear_of(hazard_sites, sharp_turns, res.length, res.closed,
                             turn_anchor_clearance)
    hazard_sites = _clear_of(hazard_sites, colossus_s, res.length, res.closed, GIANT_CLEAR_M)
    # Strict: once the corner sites are used up, the rest spread along the route instead of
    # stacking on the same few corners.
    slick_s = _pick(hazard_sites, counts["slick"], res.length, res.closed,
                    exclude=[*burst_s, *boost_s], clearance=BURST_CLEAR_M,
                    min_separation=SLICK_GAP_M, strict_separation=True)
    # The overflow keeps the corner sites' clearances where it can: no sharp turn, no bomb or boost
    # within the burst radius, no giant within its own clearance. Tighter spacing comes next, and a
    # route that is nothing but tight turns (wolfe-pruneridge) still keeps its purple hazards on them.
    for pool, gap in ((fallback_safe, SLICK_GAP_M), (fallback_safe, 12.0), (fallback, SLICK_GAP_M)):
        slick_need = counts["slick"] - len(slick_s)
        if slick_need <= 0:
            break
        slick_pool = _clear_of(pool, [*burst_s, *boost_s], res.length, res.closed, BURST_CLEAR_M)
        slick_pool = _clear_of(slick_pool, colossus_s, res.length, res.closed, GIANT_CLEAR_M)
        slick_s.extend(_pick(slick_pool, slick_need, res.length, res.closed,
                             exclude=slick_s, clearance=gap,
                             min_separation=gap, strict_separation=True))
    counts["popper"] += counts["slick"] - len(slick_s)
    counts["slick"] = len(slick_s)

    # Normal mode keeps distinct steering decisions. Many mode below is the intentional infestation.
    popper_pool = _clear_of(fallback_safe or fallback, colossus_s,
                            res.length, res.closed, GIANT_CLEAR_M)
    popper_s = _pick(popper_pool, counts["popper"], res.length, res.closed,
                     exclude=[*burst_s, *boost_s, *colossus_s, *slick_s],
                     clearance=28.0, min_separation=12.0, strict_separation=True)

    # Density is a hard gameplay setting. If the steering-oriented picker cannot fit every harmless
    # popper at its preferred clearance, fill the remaining longitudinal gaps instead of silently
    # shrinking the route population.
    accepted_s = [*burst_s, *boost_s, *colossus_s, *slick_s, *popper_s]
    missing = total - len(accepted_s)
    if missing > 0:
        fill_pool = _clear_of(fallback_safe or fallback, [*burst_s, *colossus_s],
                              res.length, res.closed, GIANT_CLEAR_M)
        filler = _pick(fill_pool, missing, res.length, res.closed,
                       exclude=accepted_s, clearance=6.0, min_separation=12.0,
                       strict_separation=True)
        popper_s.extend(filler)
        accepted_s.extend(filler)
        if len(filler) < missing:
            popper_s.extend(_fill_largest_gaps(
                accepted_s, missing - len(filler), res.length, res.closed))

    size_rng = np.random.default_rng(zlib.crc32((route["id"] + ":sizes").encode("utf-8")))
    normal_sites = {"popper": popper_s, "slick": slick_s,
                    "burst": burst_s, "boost": boost_s, "colossus": colossus_s}
    normal_pools = {"popper": all_safe or all_sites, "slick": all_sites,
                    "burst": straight_safe, "boost": boost_candidates,
                    "colossus": colossus_pool}

    # The dense setting adds a second population with the same complete kind mix.
    many_rng = np.random.default_rng(zlib.crc32((route["id"] + ":many").encode("utf-8")))
    actual = {kind: len(normal_sites[kind]) for kind in KINDS}
    occupied = [s for sites in normal_sites.values() for s in sites]
    normal_bursts = normal_sites["burst"]
    normal_boosts = normal_sites["boost"]
    many_sites = {}

    # Reuse each kind's declared safe terrain. The second population is denser, but volatile and
    # reward bodies still cannot be stacked on top of their normal-mode counterparts.
    fixed_many_sites = []
    volatile_pool = _clear_of(straight_safe, [*normal_bursts, *normal_boosts],
                              res.length, res.closed, 12.0)
    many_sites["burst"] = _pick(volatile_pool, actual["burst"], res.length, res.closed,
                                 exclude=fixed_many_sites, clearance=.1,
                                 min_separation=BURST_CLEAR_M)
    occupied.extend(many_sites["burst"])
    boost_pool = _clear_of(straight_safe, [*normal_bursts, *many_sites["burst"]],
                           res.length, res.closed, BURST_CLEAR_M)
    many_sites["boost"] = _pick(boost_pool, actual["boost"], res.length, res.closed,
                                 exclude=fixed_many_sites, clearance=.1,
                                 min_separation=28.0)
    occupied.extend(many_sites["boost"])
    giant_pool = _clear_of(all_sites, colossus_s, res.length, res.closed, GIANT_CLEAR_M)
    giant_pool = _clear_of(giant_pool, [*normal_bursts, *many_sites["burst"]],
                           res.length, res.closed, BURST_CLEAR_M + 12.0)
    normal_colossi = normal_sites["colossus"]
    # The dense giants fill the gaps between the normal ones, held to the spacing of the combined set.
    dense_gap = giant_gap(res.length, 2 * actual["colossus"])
    giant_pool = _clear_of(giant_pool, normal_colossi, res.length, res.closed, dense_gap)
    many_sites["colossus"] = _pick(giant_pool, actual["colossus"], res.length, res.closed,
                                    exclude=many_sites["boost"], clearance=GIANT_CLEAR_M,
                                    min_separation=max(dense_gap, GIANT_CLEAR_M), strict_separation=True,
                                    targets=many_stations[:actual["colossus"]])
    occupied.extend(many_sites["colossus"])
    # Never reuse the normal population's route stations. The previous exact reuse made two large
    # bodies intersect and turned "many" into a few road-blocking piles instead of an even spread.
    for kind in ("slick",):
        pool = all_sites
        many_sites[kind] = _pick(pool, actual[kind], res.length, res.closed,
                                  exclude=(), clearance=0.0,
                                  min_separation=10.0)
        occupied.extend(many_sites[kind])
    for kind in KINDS[1:]:
        if len(many_sites[kind]) != actual[kind]:
            raise ValueError(
                f'{route["id"]}: dense {kind} population needs {actual[kind]}, got {len(many_sites[kind])}')
    many_sites["popper"] = _fill_largest_gaps(occupied, actual["popper"], res.length, res.closed)

    normal = []
    extras = []
    many_pools = {"popper": all_sites, "slick": all_sites,
                  "burst": volatile_pool, "boost": boost_pool, "colossus": giant_pool}
    # Materialize both densities largest-first. This reserves the giant gates before small bodies
    # fill their space, then every later body checks actual world coordinates and radii.
    for kind in ("colossus", "burst", "boost", "slick", "popper"):
        for site_s in normal_sites[kind]:
            try:
                normal.append(_place_without_overlap(res, kind, site_s, normal_pools[kind], rng,
                    size_rng, "normal", [*normal, *extras],
                    12.0 if kind == "popper" and res.length >= 600 else .5))
            except ValueError:
                if res.length >= 600:
                    raise
        for site_s in many_sites[kind]:
            try:
                extras.append(_place_without_overlap(res, kind, site_s, many_pools[kind], many_rng,
                                                      size_rng, "many", [*normal, *extras]))
            except ValueError:
                if res.length >= 600:
                    raise
    if res.length < 600:
        matched = {kind: min(sum(item.kind == kind for item in normal),
                             sum(item.kind == kind for item in extras)) for kind in KINDS}
        normal = [item for kind in KINDS for item in [x for x in normal if x.kind == kind][:matched[kind]]]
        extras = [item for kind in KINDS for item in [x for x in extras if x.kind == kind][:matched[kind]]]
    normal.sort(key=lambda item: item.s)
    extras.sort(key=lambda item: item.s)
    if len(extras) != len(normal):
        raise ValueError(f'{route["id"]}: dense slime population needs {len(normal)} extras, got {len(extras)}')
    return sorted([*normal, *extras], key=lambda item: (item.s, item.density))


def add_to_tiles(tileset, items):
    """Write placement only; the game replaces these hidden carriers with its one jelly mesh."""
    carrier = box((0.0, 0.0, 0.0), (1.0, 1.0, 1.0), material="barrier")
    for item in items:
        prefix = "props_slime_many_" if item.density == "many" else "props_slime_"
        tileset.add_instance(f"{prefix}{item.kind}", item.position, item.yaw,
                             carrier, (1.0, 1.0, 1.0), scale=item.scale)


def add_scenery_to_tiles(tileset, items):
    """Transport off-road bodies to the same live jelly renderer as road bodies."""
    mesh = box((0.0, 0.0, 0.0), (1.0, 1.0, 1.0), material="barrier")
    for item in items:
        name = "scenery_slime_many" if item.density == "many" else "scenery_slime"
        tileset.add_instance(name, item.position, item.yaw, mesh, (1.0, 1.0, 1.0), scale=item.scale)
