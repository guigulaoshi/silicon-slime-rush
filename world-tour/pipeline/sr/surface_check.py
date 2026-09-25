"""Sweep the assembled, tiled road surface for holes: every metre along the route, every metre across.

One remix shipped a two-metre hole 1557 m into a route, right where one tile's stretch of road ended
and the next began: the wheels dropped 12 cm onto the safety net and the car jolted. Nothing checked
the tiled result -- only the ribbon before it was cut. This runs on what the tiles actually carry."""
import numpy as np
import shapely
from shapely import STRtree

EDGE_INSET = 0.6       # metres in from the painted edge: the very edge may be ramped into the kerb
STEP_ALONG = 1.0
STEP_ACROSS = 1.0
HEIGHT_TOLERANCE = 0.25


def road_triangles(ts, names=("road", "bridge")):
    """All triangles of the named nodes across every tile, as an (N, 3, 3) array."""
    out = []
    for tile in ts.meshes.values():
        for name, meshes in tile.items():
            if name not in names:
                continue
            for mesh in meshes:
                idx = np.asarray(mesh.indices).reshape(-1, 3)
                if len(idx):
                    out.append(np.asarray(mesh.positions)[idx])
    return np.concatenate(out) if out else np.zeros((0, 3, 3))


def holes(res, road_y, triangles, lift):
    """[(s, lateral)] of racing-surface points with no road triangle under them at road height."""
    if not len(triangles):
        return [(0.0, 0.0)]
    polys = shapely.polygons(triangles[:, :, [0, 2]])
    tree = STRtree(polys)
    # Half a step in from each end: the timing line itself is the seam where the course ribbon and the
    # end-road overlap meet exactly, and a point on that line is outside both by rounding alone.
    stations = np.arange(STEP_ALONG / 2, float(res.S[-1]) - STEP_ALONG / 2, STEP_ALONG)
    # Sample between the ribbon's cross-sections, not on them. A cross-section is where the road and
    # a bridge deck (or a timing line and its run-out) are two meshes meeting edge to edge, stored in
    # float32: a point placed exactly on that edge falls into a 1e-5 m rounding crack no wheel can find.
    S = np.asarray(res.S, dtype=np.float64)
    j = np.clip(np.searchsorted(S, stations, side="right") - 1, 0, len(S) - 2)
    f = np.clip((stations - S[j]) / np.maximum(S[j + 1] - S[j], 1e-9), 0.0, 1.0)[:, None]
    centre = res.P[j][:, [0, 2]] * (1 - f) + res.P[j + 1][:, [0, 2]] * f
    across = res.R[j][:, [0, 2]] * (1 - f) + res.R[j + 1][:, [0, 2]] * f
    across /= np.linalg.norm(across, axis=1, keepdims=True)
    halves = np.asarray(res.half_width, dtype=np.float64)
    ys = np.asarray(road_y, dtype=np.float64)
    pts, meta = [], []
    for k in range(len(stations)):
        a, b, t = j[k], j[k] + 1, float(f[k, 0])
        half = min(halves[a], halves[b]) - EDGE_INSET
        if half <= 0:
            continue
        for lat in np.arange(-half, half + 1e-6, STEP_ACROSS):
            pts.append(centre[k] + across[k] * lat)
            meta.append((float(stations[k]), float(lat), float(ys[a] * (1 - t) + ys[b] * t) + lift))
    pts = np.asarray(pts)
    hit_pt, hit_tri = tree.query(shapely.points(pts), predicate="intersects")
    covered = np.zeros(len(pts), dtype=bool)
    if len(hit_pt):
        tri = triangles[hit_tri]
        p = pts[hit_pt]
        a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
        v0, v1, v2 = b[:, [0, 2]] - a[:, [0, 2]], c[:, [0, 2]] - a[:, [0, 2]], p - a[:, [0, 2]]
        den = v0[:, 0] * v1[:, 1] - v1[:, 0] * v0[:, 1]
        den = np.where(np.abs(den) < 1e-12, 1e-12, den)
        u = (v2[:, 0] * v1[:, 1] - v1[:, 0] * v2[:, 1]) / den
        v = (v0[:, 0] * v2[:, 1] - v2[:, 0] * v0[:, 1]) / den
        y = a[:, 1] + u * (b[:, 1] - a[:, 1]) + v * (c[:, 1] - a[:, 1])
        want = np.array([meta[k][2] for k in hit_pt])
        ok = np.abs(y - want) <= HEIGHT_TOLERANCE
        covered[hit_pt[ok]] = True
    return [(meta[k][0], meta[k][1]) for k in np.flatnonzero(~covered)]
