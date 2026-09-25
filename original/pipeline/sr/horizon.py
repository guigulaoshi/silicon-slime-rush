"""Real coarse distant relief and shoreline water outside the detailed backdrop."""
import numpy as np
from scipy.spatial import Delaunay
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from sr.buildings import _roof_triangles
from sr.geom import grid_chunks
from sr.menumap import _load_region_ways, chains, water_rings
from sr.mesh import from_triangles, orient_to

RADIUS = 35000.0
SPACING = 1500.0
FETCH_MARGIN = 2000.0  # cover the outer lattice and bilinear samples at tile borders


def coastal_water(frame, bounds):
    """Use the existing directed coastline assembler, retaining islands as holes."""
    ways = _load_region_ways()
    if not ways:
        raise FileNotFoundError("horizon needs pipeline/cache/bayarea/coast.json.gz; run sr menu-map --fetch")
    x0, z0, x1, z1 = bounds
    lat, lon = frame.to_latlon([x0, x0, x1, x1], [z0, z1, z0, z1])
    rect = (float(lat.min()) - .01, float(lon.min()) - .01,
            float(lat.max()) + .01, float(lon.max()) + .01)
    water, islands = water_rings(chains(ways), rect)
    def project(rings):
        polygons = []
        for ring in rings:
            ll = np.asarray(ring)
            x, z = frame.to_local(ll[:, 1], ll[:, 0])
            shape = Polygon(np.c_[x, z]).buffer(0)
            if not shape.is_empty:
                polygons.append(shape)
        return unary_union(polygons)
    return project(water).difference(project(islands)).simplify(30, preserve_topology=True)


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


def build(res, dem, detail_radius, water_level=0.0):
    route = LineString(res.P[:, [0, 2]])
    outer = route.buffer(RADIUS, quad_segs=32)
    # Coarse and detailed heights need a small overlap, not an exposed ring between samples.
    inner = route.buffer(max(0, detail_radius - 400), quad_segs=24)
    domain = outer.difference(inner)
    sea = coastal_water(res.frame, outer.bounds).intersection(domain)
    land = domain.difference(sea)
    lo = np.asarray(outer.bounds[:2]); hi = np.asarray(outer.bounds[2:])
    grid = np.vstack(list(grid_chunks(lo, hi, SPACING)))
    triangles = Delaunay(grid).simplices
    out = {}
    for name, shape, material in (("land", land, "terrain"), ("water", sea, "water")):
        xz = _clipped_triangles(grid, triangles, shape)
        if not len(xz):
            continue
        lat, lon = res.frame.to_latlon(xz[:, 0], xz[:, 1])
        y = (np.maximum(dem.heights(lat, lon), water_level) if name == "land"
             else np.full(len(xz), water_level))
        points = np.c_[xz[:, 0], y, xz[:, 1]]
        indices = np.arange(len(points)).reshape(-1, 3)
        out["backdrop_horizon_" + name] = from_triangles(
            points, orient_to(points, indices, [0, 1, 0]), material, uv_scale=1500)
    return out
