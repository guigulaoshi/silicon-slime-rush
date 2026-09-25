"""Route-specific low-rise districts joining streamed streets to the real far skyline.

The DEM owns mountains and water, and the wide OSM cache owns tall buildings and arterial roads.
What was absent was ordinary city: no backdrop building below eight storeys was fetched, leaving a
bare kilometre between each streamed neighbourhood and its skyline.  This module fills only that
missing scale with deterministic low-poly massing.  The observations behind each profile are cited
in ``docs/vista-reference.md``; this mapping owns the executable numeric choices.
"""
from dataclasses import dataclass
import zlib

import numpy as np
from scipy.spatial import cKDTree
from shapely.prepared import prep

from sr.mesh import box, merge, pitched_roof_parts, yaw_for_x_axis
from sr.terrain import ground_height


@dataclass(frozen=True)
class VistaProfile:
    spacing: float
    density: float
    near_m: float
    far_m: float
    max_grade: float
    height_m: tuple[float, float]
    far_roofs: tuple[tuple[str, float], ...]
    near_roofs: tuple[tuple[str, float], ...]
    fallback: str
    source_key: str


DEFAULT = VistaProfile(110, .70, 250, 1700, .25, (8, 20),
    (("flat", .70), ("gable", .18), ("hip", .12)), (("flat", .65), ("gable", .20), ("hip", .15)),
    "terrain", "generic")


def profile(route_id):
    """The route's own `vista` declaration, else a generic city.

    What the low-rise town between the streets and the skyline looks like is the route's to say
    (spacing, density, height range, roof mix, house style)."""
    from sr.routes import load_route
    try:
        spec = load_route(route_id).get("vista")
    except FileNotFoundError:
        spec = None
    if spec:
        base = DEFAULT
        roofs = lambda v, d: tuple((k, float(x)) for k, x in v.items()) if v else d
        return VistaProfile(float(spec.get("spacingM", base.spacing)), float(spec.get("density", base.density)),
                            float(spec.get("nearM", base.near_m)), float(spec.get("farM", base.far_m)),
                            float(spec.get("maxGrade", base.max_grade)),
                            tuple(spec.get("heightM", base.height_m)),
                            roofs(spec.get("farRoofs"), base.far_roofs), roofs(spec.get("nearRoofs"), base.near_roofs),
                            spec.get("fallback", base.fallback), spec.get("houseStyle", base.source_key))
    return DEFAULT


def _fraction(key):
    return zlib.crc32(str(key).encode("utf-8")) / 0xffffffff


def choose_roof(route_id, key, near=False):
    """Stable roof selection from the route's observed mix; returns flat/gable/hip."""
    mix = profile(route_id).near_roofs if near else profile(route_id).far_roofs
    value, total = _fraction(f"{route_id}:{key}:roof"), 0.0
    for kind, share in mix:
        total += share
        if value <= total + 1e-12:
            return kind
    return mix[-1][0]


def settlement_mask(route_id, lat, lon):
    """Where the low-rise town may stand; everywhere, until a route needs open ground kept open."""
    lat, lon = np.asarray(lat), np.asarray(lon)
    return np.ones(np.broadcast(lat, lon).shape, dtype=bool)


def _candidate_grid(res, spacing, far):
    lo = res.P[:, [0, 2]].min(axis=0) - far
    hi = res.P[:, [0, 2]].max(axis=0) + far
    xs = np.arange(np.floor(lo[0] / spacing) * spacing, hi[0] + spacing, spacing)
    zs = np.arange(np.floor(lo[1] / spacing) * spacing, hi[1] + spacing, spacing)
    out = []
    for start in range(0, len(zs), 256):
        x, z = np.meshgrid(xs, zs[start:start + 256])
        out.append(np.c_[x.ravel(), z.ravel()])
    return np.vstack(out)


def city_massing(res, dem, route_id, water_level=0.0, keep_clear=None):
    """Merged material meshes for the missing middle-distance low-rise city."""
    p = profile(route_id)
    points = _candidate_grid(res, p.spacing, p.far_m)
    tree = cKDTree(res.P[:, [0, 2]])
    dist, nearest = tree.query(points)
    hashes = np.array([_fraction(f"{route_id}:{round(x)}:{round(z)}") for x, z in points])
    keep = (dist >= p.near_m) & (dist <= p.far_m) & (hashes < p.density)
    points, nearest, hashes = points[keep], nearest[keep], hashes[keep]
    if not len(points):
        return {}, {"candidates": 0, "buildings": 0, "roofs": {}}

    lat, lon = res.frame.to_latlon(points[:, 0], points[:, 1])
    keep = settlement_mask(route_id, lat, lon)
    points, nearest, hashes, lat, lon = (a[keep] for a in (points, nearest, hashes, lat, lon))
    centre_ground = dem.heights(lat, lon)
    probe = min(25.0, p.spacing * .22)
    la_x, lo_x = res.frame.to_latlon(points[:, 0] + probe, points[:, 1])
    la_z, lo_z = res.frame.to_latlon(points[:, 0], points[:, 1] + probe)
    grade = np.maximum(np.abs(dem.heights(la_x, lo_x) - centre_ground),
                       np.abs(dem.heights(la_z, lo_z) - centre_ground)) / probe
    keep = (centre_ground > water_level + .8) & (grade <= p.max_grade)
    points, nearest, hashes = points[keep], nearest[keep], hashes[keep]

    clear = prep(keep_clear) if keep_clear is not None and not keep_clear.is_empty else None
    by_material, roofs = {}, {"flat": 0, "gable": 0, "hip": 0}
    accepted = 0
    from sr.buildings import _building_base, box_polygon, finish_roof, roofline_bottom
    from sr.architecture import house_style, roof_material, house_details
    from sr.buildings import facade_for_route
    from sr.routes import load_route
    try:
        route = load_route(route_id)
    except FileNotFoundError:
        route = {}
    from sr.local_style import far_style, localise, types as local_types
    local = localise(local_types(route), res.frame) if route else []
    # The far town is the same city as the streets: its walls come from the route's own facade
    # palette and its low roofs from the route's own roofscape. A fixed pale stucco box with a
    # 70% flat roof read as rows of blank blocks in every city, not as houses.
    pitched = (route.get("architecture") or {}).get("pitched")
    for (x, z), i, h in zip(points, nearest, hashes):
        key = f"{round(x)}:{round(z)}"
        width = p.spacing * (.25 + .13 * _fraction(key + ":w"))
        depth = p.spacing * (.18 + .10 * _fraction(key + ":d"))
        height = p.height_m[0] + (p.height_m[1] - p.height_m[0]) * _fraction(key + ":h")
        if _fraction(key + ":block") > .93:
            height *= 1.55
        tangent = res.T[min(int(i), len(res.T) - 1)]
        yaw = yaw_for_x_axis((tangent[0], tangent[2])) + (_fraction(key + ":yaw") - .5) * .18
        footprint = box_polygon(float(x), float(z), width / 2, depth / 2, yaw)
        if clear is not None and clear.intersects(footprint):
            continue
        y = _building_base(res, res.P[:, 1], dem, footprint, tree)
        material = facade_for_route(route, {"building": "yes"}, area=width * depth,
                                    storeys=height / 3, at=(float(x), float(z)))
        # the city's own style when it has one (sr/local_style.py), so the far district is the same city
        far = far_style(local, height / 3, width * depth, (float(x), float(z))) if local else None
        if far:
            material = far[0]
        wall_height = roofline_bottom(y, y + height, material) - y
        body = box((x, y + wall_height / 2, z), (width / 2, wall_height / 2, depth / 2), yaw=yaw,
                   material=material)
        kind = choose_roof(route_id, key)
        if pitched and height / 3 <= float(pitched.get("maxStoreys", 4)) \
                and _fraction(key + ":pitched") < float(pitched.get("share", 0)):
            kind = pitched.get("kind", "hip")
        if far:
            kind = far[2]
        roofs[kind] += 1
        style = house_style(route_id, kind, height)
        cap, roof_base, _roof_top = finish_roof(footprint, y, y + height, material, kind)
        parts = [body, cap]
        if kind != "flat":
            parts.extend(pitched_roof_parts((x, roof_base, z), (width / 2, depth / 2), yaw=yaw,
                                            rise=max(1.4, min(3.4, min(width, depth) * .18)),
                                            kind=kind, material=far[1] if far else
                                            (pitched or {}).get("roofMaterial") or roof_material(style),
                                            end_material=material))
        if not far:
            parts.extend(house_details(footprint, y, roof_base, style, res.P[int(i), [0, 2]], keep_clear,
                                   lambda points: ground_height(res, res.P[:,1], dem, points, tree)))
        from sr.buildings import facade_identity
        for part in parts:
            facade_identity(part, f"{route_id}:vista:{key}", residential=True)
            by_material.setdefault(part.material, []).append(part)
        accepted += 1
    return ({name: merge(meshes, name) for name, meshes in by_material.items()},
            {"candidates": len(points), "buildings": accepted, "roofs": roofs})
