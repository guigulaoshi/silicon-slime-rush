"""Real coarse distant relief and sea water outside the detailed backdrop.

The sea is read from the elevation data: Terrarium tiles carry bathymetry, so open water is below
zero and the shoreline is the zero line. The original read the Bay Area's cached OSM coastline here,
which does not exist anywhere else and made every other city's build fail."""
import math

import numpy as np
from scipy.spatial import Delaunay
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from sr.buildings import _roof_triangles
from sr.geom import grid_chunks
from sr.mesh import from_triangles, orient_to

RADIUS = 35000.0
SPACING = 1500.0
FETCH_MARGIN = 2000.0  # cover the outer lattice and bilinear samples at tile borders
PEAK_MARGIN = 6000.0   # beyond a declared peak, so its far flank is on the horizon too
PEAK_TOP = 60.0        # innermost ring round a declared summit, metres
PEAK_GROWTH = 1.3      # each ring this much wider than the last
PEAK_RINGS_TO = 9000.0
PEAK_RESTORE = 2500.0  # radius over which a flattened summit is pulled back to its surveyed height
SNOW_MATERIAL = "terrain_snow"


def peaks(route):
    """The distant mountains a route declares it exists for: [{name, lat, lon, heightM, snowlineM?}]."""
    return list(route.get("distantPeaks", ()))


def radius_for(route, frame=None):
    """At least RADIUS, and far enough to take in every declared peak with its far flank.

    Downloading and building both read this, so the mountain a route is for is never missing from
    one of them: a 45 km volcano was neither fetched nor built in one remix and the road that exists
    for it looked at an empty band of haze."""
    r = RADIUS
    if frame is None:
        from sr.geo import LocalFrame
        frame = LocalFrame(route["origin"]["lat"], route["origin"]["lon"])
    pts = [frame.to_local(w[0], w[1]) for w in route.get("waypoints", []) if isinstance(w, (list, tuple))]
    pts = pts or [(0.0, 0.0)]
    for peak in peaks(route):
        px, pz = frame.to_local(peak["lat"], peak["lon"])
        d = max(math.hypot(float(px) - float(x), float(pz) - float(z)) for x, z in pts)
        r = max(r, d + PEAK_MARGIN)
    return r


def peak_rings(frame, route):
    """Concentric sample rings round each declared summit, so the coarse lattice cannot shave it."""
    out = []
    for peak in peaks(route):
        cx, cz = (float(v) for v in frame.to_local(peak["lat"], peak["lon"]))
        out.append([cx, cz])
        r = PEAK_TOP
        while r <= PEAK_RINGS_TO:
            n = max(12, int(2 * math.pi * r / max(r * 0.35, 40.0)))
            a = np.linspace(0, 2 * math.pi, n, endpoint=False)
            out.extend(np.c_[cx + r * np.cos(a), cz + r * np.sin(a)].tolist())
            r *= PEAK_GROWTH
    return np.asarray(out, dtype=np.float64).reshape(-1, 2)


def restore_summits(frame, route, xz, y):
    """Pull each declared summit back to its surveyed height, fading out over PEAK_RESTORE.

    Coarse tiles average the top away: a 3776 m cone reads a hundred metres low. The correction is
    zero at the edge of the circle and never lowers anything."""
    y = np.asarray(y, dtype=np.float64).copy()
    for peak in peaks(route):
        cx, cz = (float(v) for v in frame.to_local(peak["lat"], peak["lon"]))
        d = np.hypot(xz[:, 0] - cx, xz[:, 1] - cz)
        near = d < PEAK_RESTORE
        if not near.any():
            continue
        top = float(y[near].max())
        lift = max(0.0, float(peak["heightM"]) - top)
        w = np.clip(1 - d / PEAK_RESTORE, 0, 1)
        y = y + lift * (w * w * (3 - 2 * w))
    return y


def snowline(route):
    lines = [float(p["snowlineM"]) for p in peaks(route) if p.get("snowlineM") is not None]
    return min(lines) if lines else None


def _clipped_triangles(xz, simplices, shape):
    """Clip coarse triangles with the polygon triangulation already used for concave roofs."""
    points = []
    for indices in simplices:
        triangle = Polygon(xz[indices])
        if not shape.intersects(triangle):
            continue
        if shape.covers(triangle):
            points.extend(xz[indices])
            continue
        clipped = triangle.intersection(shape)
        for piece in getattr(clipped, "geoms", [clipped]):
            if not isinstance(piece, Polygon) or piece.area < 1e-6:
                continue
            for part in _roof_triangles(piece):
                points.extend(np.asarray(part.exterior.coords)[:3])
    return np.asarray(points).reshape(-1, 2)


def sea_polygon(grid, triangles, heights, known, water_level):
    """The union of lattice triangles whose three corners all read as sea (and were downloaded)."""
    wet = (heights <= water_level) & known
    tri_wet = wet[triangles].all(axis=1)
    if not tri_wet.any():
        return Polygon()
    return unary_union([Polygon(grid[t]) for t in triangles[tri_wet]]).buffer(0)


def build(res, dem, detail_radius, water_level=0.0):
    route = LineString(res.P[:, [0, 2]])
    radius = radius_for(res.route, res.frame) if getattr(res, "route", None) else RADIUS
    outer = route.buffer(radius, quad_segs=32)
    # Coarse and detailed heights need a small overlap, not an exposed ring between samples.
    inner = route.buffer(max(0, detail_radius - 400), quad_segs=24)
    domain = outer.difference(inner)
    lo = np.asarray(outer.bounds[:2]); hi = np.asarray(outer.bounds[2:])
    grid = np.vstack(list(grid_chunks(lo, hi, SPACING)))
    if getattr(res, "route", None):
        rings = peak_rings(res.frame, res.route)
        if len(rings):
            grid = np.vstack([grid, rings])
    triangles = Delaunay(grid).simplices
    lat, lon = res.frame.to_latlon(grid[:, 0], grid[:, 1])
    heights = dem.heights(lat, lon)
    known = dem.known(lat, lon) if hasattr(dem, "known") else np.ones(len(grid), dtype=bool)
    sea = sea_polygon(grid, triangles, heights, known, water_level).intersection(domain)
    land = domain.difference(sea)
    snow = snowline(res.route) if getattr(res, "route", None) else None
    out = {}
    for name, shape in (("land", land), ("water", sea)):
        if shape.is_empty:
            continue
        xz = _clipped_triangles(grid, triangles, shape)
        if not len(xz):
            continue
        lat, lon = res.frame.to_latlon(xz[:, 0], xz[:, 1])
        if name == "land":
            y = np.maximum(dem.heights(lat, lon), water_level)
            if getattr(res, "route", None):
                y = restore_summits(res.frame, res.route, xz, y)
        else:
            y = np.full(len(xz), water_level)
        points = np.c_[xz[:, 0], y, xz[:, 1]]
        indices = orient_to(points, np.arange(len(points)).reshape(-1, 3), [0, 1, 0])
        if name == "land" and snow is not None:
            # A snow-capped peak is recognised by its white cap; below the line it is grey-blue haze.
            high = points[indices][:, :, 1].mean(axis=1) >= snow
            if high.any():
                out["backdrop_horizon_snow"] = from_triangles(points, indices[high], SNOW_MATERIAL, uv_scale=1500)
            indices = indices[~high]
        if len(indices):
            out["backdrop_horizon_" + name] = from_triangles(
                points, indices, "terrain" if name == "land" else "water", uv_scale=1500)
    return out
