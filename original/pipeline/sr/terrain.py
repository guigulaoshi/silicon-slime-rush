"""Road elevation profile, adaptive corridor terrain and water surfaces.

The road is a drivable trimesh generated in sr.roads; terrain here covers everything beside it and
meets it flush, so the car never drives on the terrain mesh but also never sees a gap.
Elevation comes from Terrarium tiles, which include bathymetry: open water reads tens of meters
negative, which is why bridge decks must be synthesised rather than sampled."""
from dataclasses import dataclass

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.spatial import Delaunay, cKDTree
from shapely.geometry import LineString

from sr.geom import grid_chunks
from sr.mesh import Mesh, from_triangles, merge, orient_to, ribbon
from sr.route import spans

APRON = 3.0            # flat shoulder beyond the road half width, meters
BLEND = 24.0           # distance over which terrain returns to natural elevation
FINE_SPACING = 2.5     # terrain sample spacing within FINE_RADIUS of the road
FINE_RADIUS = 40.0
COARSE_SPACING = 10.0
PROFILE_WINDOW = 60.0  # smoothing window for the road profile, meters
MAX_SLOPE = 0.15
WATER_Y = 0.0
WATER_LEVEL = 0.0      # elevation below which sampled ground is sea floor, not land
SHORE_CLAMP = -0.5     # how far under the water surface land is allowed to sink, so the beach meets the sea
GROUND_CUT_LIFT = 1.5  # how far a roadbed may sit off the finished ground and still be subtracted from it


@dataclass
class TerrainResult:
    road_y: np.ndarray          # elevation per spline point, bridges included
    terrain: Mesh
    water: Mesh
    water_area: float           # square meters of water surface generated
    # the ground split by what it is made of: {material name -> mesh}. One entry called `terrain`
    # when nothing said otherwise, which is what a synthetic fixture and a route with no land-use
    # data both get.
    covers: dict


# ---------------------------------------------------------------- road profile

def smooth_profile(S, y, window_m=PROFILE_WINDOW):
    """Gaussian smoothing with a window measured in meters, not samples."""
    step = float(np.median(np.diff(S))) if len(S) > 1 else 1.0
    sigma = max(window_m / 6.0 / max(step, 1e-6), 0.5)
    return gaussian_filter1d(np.asarray(y, dtype=np.float64), sigma=sigma, mode="nearest")


def limit_slope(S, y, max_slope=MAX_SLOPE, passes=3):
    """Clamp the profile so no segment exceeds max_slope, alternating forward and backward sweeps."""
    y = np.asarray(y, dtype=np.float64).copy()
    for _ in range(passes):
        for i in range(1, len(y)):
            lim = max_slope * (S[i] - S[i - 1])
            y[i] = min(max(y[i], y[i - 1] - lim), y[i - 1] + lim)
        for i in range(len(y) - 2, -1, -1):
            lim = max_slope * (S[i + 1] - S[i])
            y[i] = min(max(y[i], y[i + 1] - lim), y[i + 1] + lim)
    return y


def merge_spans(intervals, max_gap=50.0):
    """Join intervals separated by less than max_gap. One untagged node mid-bridge splits a span in two,
    and each half would then anchor its ramp on the other half's mid-water elevation."""
    out = []
    for a, b in intervals:
        if out and a - out[-1][1] <= max_gap:
            out[-1][1] = b
        else:
            out.append([a, b])
    return out


def bridge_deck(S, y, bridge_mask, deck_m, min_length=200.0, ramp_frac=0.15):
    """Replace long bridge spans with a level deck at deck_m, ramped from the land height at each end.

    Short spans (an overpass, a culvert) keep their sampled profile: they sit on the terrain anyway."""
    y = np.asarray(y, dtype=np.float64).copy()
    if deck_m is None:
        return y
    for s0, s1 in merge_spans(spans(bridge_mask, S)):
        if s1 - s0 < min_length:
            continue
        idx = np.where((S >= s0) & (S <= s1))[0]
        if len(idx) < 4:
            continue
        a, b = idx[0], idx[-1]
        y_a = y[max(a - 1, 0)]
        y_b = y[min(b + 1, len(y) - 1)]
        t = (S[idx] - S[a]) / max(S[b] - S[a], 1e-6)
        ramp = np.clip(t / ramp_frac, 0, 1) * np.clip((1 - t) / ramp_frac, 0, 1)
        ramp = ramp * ramp * (3 - 2 * ramp)  # smoothstep, so the deck leaves the abutments tangentially
        ends = y_a * (1 - t) + y_b * t
        y[idx] = ends * (1 - ramp) + deck_m * ramp
    return y


def road_profile(res, dem, deck_m=None, bridge_min_length=200.0):
    """Elevation per spline point: sampled, bridge gaps bridged linearly, smoothed, slope limited, decks applied."""
    lat, lon = res.frame.to_latlon(res.P[:, 0], res.P[:, 2])
    raw = dem.heights(lat, lon)
    # a sample is untrustworthy where the road is on a bridge or the reading is bathymetry rather than ground
    untrusted = res.bridge | (raw < 0.0)
    land = raw.copy()
    if untrusted.any() and (~untrusted).any():
        land = np.interp(res.S, res.S[~untrusted], raw[~untrusted])
    y = limit_slope(res.S, smooth_profile(res.S, land))
    y = bridge_deck(res.S, y, res.bridge, deck_m, bridge_min_length)
    # Clamping an already-smoothed profile can create a new knife-edge crest: on Mission Peak
    # +15% becomes -15% in one two-metre segment. A long chassis then bridges the crest with
    # unloaded wheels. Round the constrained profile too, using the same metre-based owner.
    # A positive Gaussian average preserves the slope ceiling on the evenly sampled interior.
    # The final interval can be shorter than two metres, so retain its metric slope bound too.
    return limit_slope(res.S, smooth_profile(res.S, limit_slope(res.S, y)))


# ---------------------------------------------------------------- terrain mesh

def sample_points(res, pad, fine_radius=FINE_RADIUS, fine=FINE_SPACING, coarse=COARSE_SPACING):
    """Adaptive ground samples: dense along the road, sparse out to the corridor edge."""
    offsets = np.arange(-fine_radius, fine_radius + fine, fine)
    stride = max(int(round(fine / float(res.S[1] - res.S[0]))), 1)
    base = res.P[::stride]
    right = res.R[::stride]
    near = (base[:, None, [0, 2]] + right[:, None, [0, 2]] * offsets[None, :, None]).reshape(-1, 2)
    # merge duplicates from the inside of tight curves onto a half-spacing lattice
    key = np.round(near / (fine * 0.5)).astype(np.int64)
    near = near[np.unique(key, axis=0, return_index=True)[1]]

    # A ring of samples exactly on the painted edge, added after the merge so it keeps its position.
    # Without it the fine lattice sits at fixed offsets while the road width varies, so triangles
    # straddle the edge; dropping them by centroid then leaves slivers of sky along the whole route.
    hw = res.half_width[::stride]
    edge = np.concatenate([(base[:, [0, 2]] + right[:, [0, 2]] * (side * (hw + gap))[:, None])
                           for side in (-1.0, 1.0) for gap in (0.0, APRON)])
    near = np.vstack([near, edge])

    lo = res.P[:, [0, 2]].min(axis=0) - pad
    hi = res.P[:, [0, 2]].max(axis=0) + pad
    tree = cKDTree(res.P[:, [0, 2]])
    parts = []
    for grid in grid_chunks(lo, hi, coarse):
        d = tree.query(grid, distance_upper_bound=np.nextafter(float(pad), np.inf))[0]
        parts.append(grid[(d > fine_radius) & (d <= pad)])
    far = np.vstack(parts)
    extensions = [sample_points(road, fine_radius, fine_radius, fine, coarse)
                  for road in getattr(res, "end_roads", {}).values()]
    return np.vstack([near, far, *extensions])


def flat_inner(res, idx, xz):
    """Distance from the spline at which the level roadbed ends for each point, on its own side."""
    inner = res.half_width[idx] + APRON
    if getattr(res, "flat_left", None) is None:     # lightweight route stand-ins carry no roadbed
        return inner
    side = np.sum((xz - res.P[idx][:, [0, 2]]) * res.R[idx][:, [0, 2]], axis=1)
    return inner + np.where(side < 0, res.flat_left[idx], res.flat_right[idx])


def _ground_profile(res, road_y, dem, xz, tree=None, water_level=WATER_LEVEL):
    """One nearest roadbed and terrain blend for the visible mesh and everything placed on it."""
    tree = tree or cKDTree(res.P[:, [0, 2]])
    dist, idx = tree.query(xz)
    inner = flat_inner(res, idx, xz)
    profile = road_y[idx].copy()
    bridge = res.bridge[idx].copy()
    bridge_distance = np.full(len(xz), np.inf)
    if np.any(res.bridge):
        bridge_distance = cKDTree(res.P[res.bridge][:, [0, 2]]).query(xz)[0]
    for road in getattr(res, "end_roads", {}).values():
        distance, nearest = cKDTree(road.P[:, [0, 2]]).query(xz)
        use = distance < dist
        dist = np.where(use, distance, dist)
        inner = np.where(use, flat_inner(road, nearest, xz), inner)
        profile = np.where(use, road.P[nearest, 1], profile)
        bridge = np.where(use, road.bridge[nearest], bridge)
        if np.any(road.bridge):
            bridge_distance = np.minimum(
                bridge_distance, cKDTree(road.P[road.bridge][:, [0, 2]]).query(xz)[0])
    lat, lon = res.frame.to_latlon(xz[:, 0], xz[:, 1])
    natural = dem.heights(lat, lon)
    t = np.clip((dist - inner) / BLEND, 0., 1.)
    t = np.where(bridge, 1., t * t * (3 - 2 * t))
    # OSM bridge masks stop on one exact route sample. At a shoreline, the immediately adjacent
    # sample can therefore be classified as ordinary road and blend bathymetry up to the deck,
    # while its neighbour under the bridge stays at the sea floor. Delaunay joins the two into a
    # freestanding vertical terrain fin. Extend the bridge's natural-ground rule only across wet
    # samples in its shoulder/blend distance; dry abutment terrain and ordinary coastal roads keep
    # their normal roadbed blend.
    # Compare the bridge-end gap along the road, not a plain radial distance: a sample 15 m to the
    # side and 28 m before the first bridge point is still inside the road's 31 m shoulder/blend,
    # even though its straight-line distance to that point is 32 m. Outside the road blend `t` is
    # already one, so the extension has no work and deliberately changes nothing.
    blend_edge = inner + BLEND
    wet_bridge_edge = ((natural < water_level) & (dist <= blend_edge)
                       & (bridge_distance <= np.hypot(dist, blend_edge)))
    t = np.where(wet_bridge_edge, 1., t)
    return profile * (1 - t) + natural * t, natural, t


def ground_height(res, road_y, dem, xz, tree=None, water_level=WATER_LEVEL):
    """Elevation of the finished ground at arbitrary points, using the same blend as the terrain mesh.

    Anything placed on the ground -- barriers, buildings, props -- has to agree with the mesh it sits on,
    so they all come through here rather than sampling the elevation data directly."""
    xz = np.asarray(xz, dtype=np.float64).reshape(-1, 2)
    if len(xz) == 0:
        return np.zeros(0)
    y, _, _ = _ground_profile(res, road_y, dem, xz, tree, water_level)
    return np.maximum(y, water_level + SHORE_CLAMP)


def build_terrain(res, dem, road_y, corridor, pad=300.0, water_level=WATER_LEVEL, cover=None, sea=None):
    """Delaunay ground mesh that meets the road flush and a flat sea surface.

    Water is found from the elevation data rather than from OSM coastlines. Terrarium tiles carry
    bathymetry, so the sea floor reads tens of meters negative and the shoreline is exactly where the
    samples cross zero. Closing coastline ways against the corridor does not work here: the corridor
    is a narrow snake and the shoreline mostly runs along it instead of across it, so it splits
    nothing.

    `water_level` is the elevation the sea reads at in this route's tiles. It is zero almost
    everywhere, but the dataset has no bathymetry off some coasts and puts the sea surface at a
    small positive value instead; a route that runs along one of those says so in `waterLevelM`.

    `sea` is polygons that are water whatever the elevation reads -- bridge supports standing in the
    sea, which the tiles see as a metre of ground (`landcover.bridge_supports`)."""
    xz = sample_points(res, pad)
    simp = Delaunay(xz).simplices

    y, natural, t = _ground_profile(res, road_y, dem, xz, water_level=water_level)
    if sea:
        from shapely.ops import unary_union
        under = _contains(unary_union(sea), xz) & (t >= 0.999)
        natural = np.where(under, np.minimum(natural, water_level - 1.0), natural)
        y = np.where(under, np.minimum(y, natural), y)

    wet = (natural < water_level) & (t >= 0.999)
    centroids = xz[simp].mean(axis=1)
    inside = _contains(corridor, centroids)
    is_water = wet[simp].all(axis=1)
    P = np.stack([xz[:, 0], np.maximum(y, water_level + SHORE_CLAMP), xz[:, 1]], axis=1)
    up = np.array([0.0, 1.0, 0.0])
    # Clip crossing faces rather than dropping whole faces by their centroid. The footprint
    # comes from the same ribbon triangles as the driving surface, including variable widths.
    from sr.clearance import surface
    # The spine carries `road_y`, not `res.P`'s own height: `road_y` is what the roadbed is built at
    # and what the terrain is blended to, and a route stand-in may leave `res.P` flat at zero.
    spine = np.column_stack([res.P[:, 0], road_y, res.P[:, 2]])
    laid = [_lying_on_the_ground(mesh, res, road_y, dem, water_level) for mesh in
            (ribbon(spine, res.R, res.half_width, closed=res.closed),
             *(ribbon(road.P, road.R, road.half_width)
               for road in getattr(res, "end_roads", {}).values()))]
    footprint = surface(*[mesh for mesh in laid if mesh is not None])
    P, land_tris = cut_ground(P, simp[inside & ~is_water], footprint)
    land_tris = orient_to(P, land_tris, up)
    land_centroids = P[land_tris][:, :, [0, 2]].mean(axis=1)
    covers = {}
    if cover:
        from sr.landcover import classify
        names = classify(land_centroids, cover)
        for material in sorted(set(names.tolist())):
            picked = land_tris[names == material]
            if len(picked):
                covers[material] = from_triangles(P, picked, material)
    if not covers:
        covers = {"terrain": from_triangles(P, land_tris, "terrain")}
    # Keep the combined surface for geometric checks independently of its cover materials.
    terrain = merge(list(covers.values()), material="terrain") if len(covers) > 1 \
        else next(iter(covers.values()))
    Pw = np.stack([xz[:, 0], np.full(len(xz), water_level), xz[:, 1]], axis=1)
    water_tris = orient_to(Pw, simp[inside & is_water], up)
    water = from_triangles(Pw, water_tris, "water", uv_scale=32.0)
    area = plan_area(xz, water_tris)
    # This surface already connects the roadbed to natural ground. Adding vertical faces based
    # on raw DEM differences here would stand above the blended slope as disconnected panels.
    return TerrainResult(road_y, terrain, water, area, covers)


def _lying_on_the_ground(mesh, res, road_y, dem, water_level):
    """The part of a road mesh that actually rests on the ground, as a mesh or None.

    Only that part may be subtracted from the terrain. A deck up in the air hides nothing below it,
    so cutting its plan shadow out of the ground opens a hole the player looks straight through:
    the Golden Gate's approach viaduct took the Presidio with it, from the Presidio all the way to
    Fort Point, and the sky showed through the ground on every bearing of the home page's orbit.

    The comparison is against the *finished* ground -- the same blended profile the mesh is built
    from -- not the raw elevation. Ordinary roads have the terrain ramped up to meet them, so their
    lift is zero however high the embankment is, and they still cut. Only a span that keeps its
    natural ground underneath (`_ground_profile` holds the blend at 1 over a bridge) reads as lifted.
    """
    P = np.asarray(mesh.positions, dtype=np.float64)
    triangles = np.asarray(mesh.indices, dtype=np.int64).reshape(-1, 3)
    if not len(triangles):
        return None
    centroids = P[triangles].mean(axis=1)
    ground = ground_height(res, road_y, dem, centroids[:, [0, 2]], water_level=water_level)
    # One-sided on purpose. A roadbed *below* the finished ground must still cut, or the ground
    # closes over the tarmac -- bayshore-101 has a 60 m span at s=1454 m whose deck sits 4 m under
    # the ground beside it (too short for `bridge_deck`, but `_ground_profile` still holds the blend
    # at 1 over it, so the ground stays natural). Only a deck in the air hides nothing below it.
    kept = triangles[centroids[:, 1] - ground <= GROUND_CUT_LIFT]
    return from_triangles(P, kept, "road") if len(kept) else None


def cut_ground(P, triangles, footprint):
    """Subtract tarmac from ground faces, keeping the outside of every crossing triangle."""
    from shapely import (constrained_delaunay_triangles, covers, get_parts, intersects,
                         polygons, prepare)

    faces = polygons(P[triangles][:, :, [0, 2]])
    prepare(footprint)
    touching = intersects(footprint, faces)
    contained = covers(footprint, faces)
    kept = triangles[~touching].tolist()
    vertices = P.tolist()
    for index in np.flatnonzero(touching & ~contained):
        face = faces[index].difference(footprint)
        original = P[triangles[index]]
        # The cut stays on its original triangle plane, preserving slopes and cover UVs.
        plane = np.column_stack([original[:, 0], original[:, 2], np.ones(3)])
        if abs(np.linalg.det(plane)) < 1e-12:
            continue
        heights = np.linalg.solve(plane, original[:, 1])
        for tri in get_parts(constrained_delaunay_triangles(face)):
            coords = np.asarray(tri.exterior.coords)[:3]
            y = np.column_stack([coords, np.ones(3)]) @ heights
            first = len(vertices)
            vertices.extend(np.column_stack([coords[:, 0], y, coords[:, 1]]).tolist())
            kept.append([first, first + 1, first + 2])
    return np.asarray(vertices), np.asarray(kept, dtype=np.int64).reshape(-1, 3)


def plan_area(xz, tris):
    """Total horizontal area of a triangle set, by the shoelace formula."""
    if len(tris) == 0:
        return 0.0
    a, b, c = xz[tris[:, 0]], xz[tris[:, 1]], xz[tris[:, 2]]
    cross = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    return float(np.abs(cross).sum() / 2.0)


def _contains(geom, points):
    if geom is None:
        return np.zeros(len(points), dtype=bool)
    from shapely import contains_xy
    return contains_xy(geom, points[:, 0], points[:, 1])


def corridor_polygon(res, pad=300.0):
    return LineString(res.P[:, [0, 2]]).buffer(pad, quad_segs=4)
