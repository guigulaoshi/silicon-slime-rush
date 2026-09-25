"""Placed landmark models against the road, sliced at car height.

A landmark footprint is not what a car hits: a gateway's footprint covers its passage, a bridge's
covers its deck. So the check cuts the placed model at the heights a car occupies where the road
passes it -- 0.3, 1.0 and 1.8 m above the tarmac there, bridge decks included -- and compares the
solid it finds with the road surface. Anything on the road fails the build. It runs for every
landmark, including the ones a route drives through."""
import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

CAR_HEIGHTS = (0.3, 1.0, 1.8)
TOLERANCE_M2 = 0.5
HEIGHT_BAND = 2.5        # a road sample this far from the slice's own road height is another level


def load_placed(path, pos, yaw):
    """The GLB as one trimesh in track coordinates (rotation about y by `yaw`, then translation)."""
    import trimesh
    scene = trimesh.load(path, force="scene")
    mesh = scene.to_geometry() if hasattr(scene, "to_geometry") else scene.dump(concatenate=True)
    c, s = np.cos(yaw), np.sin(yaw)
    rot = np.array([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]])
    mesh.apply_transform(rot)
    mesh.apply_translation(pos)
    return mesh


def _section(mesh, y):
    """Solid plan area of `mesh` at height y, as a polygon (possibly empty)."""
    sec = mesh.section(plane_origin=[0, y, 0], plane_normal=[0, 1, 0])
    if sec is None:
        return Polygon()
    lines = []
    for entity in sec.entities:
        pts = np.round(sec.vertices[entity.points][:, [0, 2]], 3)   # snap ends so rings close
        if len(pts) >= 2:
            lines.append(LineString(pts))
    if not lines:
        return Polygon()
    merged = unary_union(lines)                     # node crossing shells before polygonizing
    return unary_union(list(polygonize(merged)))


def conflicts(mesh, P, road_y, half_width):
    """[(height, area, x, z)] where the model's solid at car height covers the racing surface."""
    lo, hi = mesh.bounds[0], mesh.bounds[1]
    near = ((P[:, 0] > lo[0] - 30) & (P[:, 0] < hi[0] + 30) & (P[:, 2] > lo[2] - 30) & (P[:, 2] < hi[2] + 30))
    idx = np.flatnonzero(near)
    if not len(idx):
        return []
    out = []
    levels = np.unique(np.round(road_y[idx] / 0.5) * 0.5)
    for level in levels:
        band = idx[np.abs(road_y[idx] - level) <= HEIGHT_BAND]
        if len(band) < 2:
            continue
        runs = np.split(band, np.flatnonzero(np.diff(band) > 1) + 1)
        road = unary_union([LineString(P[r][:, [0, 2]]).buffer(float(half_width[r].min()), cap_style="flat")
                            for r in runs if len(r) >= 2])
        for dy in CAR_HEIGHTS:
            y = float(level + dy)
            if y < lo[1] or y > hi[1]:
                continue
            hit = _section(mesh, y).intersection(road)
            if hit.area > TOLERANCE_M2:
                c = hit.centroid
                out.append((y, float(hit.area), float(c.x), float(c.y)))
    return out
