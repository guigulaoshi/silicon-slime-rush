"""Trees: the ones the map records, plus a reproducible scatter through the woods and scrub.

Bare hillsides are what most makes a greybox look like a greybox, and both ends of the Golden Gate
route are green in real life -- the Presidio forest and the scrub of the Marin headlands. The map
carries individual trees around the corridor and a set of wood, scrub and heath polygons; the
recorded trees go exactly where they are recorded, the polygons get a scatter.

The scatter is seeded from the route id with a stable hash, so the same route always grows the same
forest. Python's own string hash is randomised per process, which would move every tree on every
build and make the visual baseline worthless."""
import zlib

import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import Point, Polygon
from shapely.prepared import prep

from sr import landcover
from sr.fetch_osm import load_layer
from sr.geom import curvature
from sr.mesh import Mesh, merge, orient_by_shading
from sr.terrain import flat_inner, ground_height

# square metres of ground per scattered tree, by what the map calls the ground
DENSITY = {"wood": 90.0, "forest": 90.0, "scrub": 260.0, "heath": 400.0}
# Where people live and work the Bay Area is full of street, yard and campus trees that OSM
# almost never maps one by one, so these zones are planted by area too -- sparser than woodland, and
# never on a street, a building or a car park (`positions` takes those out).
ZONED_DENSITY = {"residential": 240.0, "commercial": 420.0, "retail": 650.0, "park": 170.0,
                 "garden": 200.0, "village_green": 300.0, "recreation_ground": 420.0,
                 "cemetery": 300.0, "grass": 480.0}
PAVED = {"parking", "garages", "apron", "construction", "railway", "pitch"}
STREET_CLEAR = 2.0        # from a mapped street's edge to a zoned tree's trunk
BUILDING_CLEAR = 1.5      # from a building's footprint to a zoned tree's trunk
ZONED_CONIFER = 0.18      # share of zoned trees that are conifers, for a mixed skyline
SCATTER_RADIUS = 260.0    # inside the 300 m corridor: past that there is no ground mesh to plant in
CLEAR = 2.5               # from the painted edge to the nearest trunk
MAX_TREES = 24000         # a ceiling on instance count, per route
FOLIAGE = "foliage"
TRUNK = "trunk"
TREE_KINDS = ("broadleaf", "conifer", "palm", "orchard", "scrub")
PALM_VARIANT_COUNT = 5
FLOWER_MATERIALS = ("flower_pink", "flower_white", "flower_blue", "flower_purple")
FOLIAGE_BY_KIND = {
    "broadleaf": FOLIAGE,
    "conifer": "foliage_dark",
    "palm": "foliage_palm",
    "orchard": "foliage_orchard",
    "scrub": "foliage_scrub",
}
SCATTER_KIND = {"wood": "broadleaf", "forest": "conifer", "scrub": "scrub", "heath": "scrub"}


def _cone(radius, y0, y1, sides=8, material=FOLIAGE):
    """A low cone, flat shaded."""
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    ring = np.stack([np.cos(ang) * radius, np.full(sides, y0), np.sin(ang) * radius], axis=1)
    pos = np.vstack([ring, [[0.0, y1, 0.0]]])
    slope = radius / max(y1 - y0, 1e-6)
    nor = np.vstack([np.stack([np.cos(ang), np.full(sides, slope), np.sin(ang)], axis=1),
                     [[0.0, 1.0, 0.0]]])
    nor /= np.linalg.norm(nor, axis=1, keepdims=True)
    tri = np.array([[i, (i + 1) % sides, sides] for i in range(sides)]).reshape(-1)
    return orient_by_shading(Mesh(pos, nor, np.zeros((len(pos), 2)), tri, material))


def _trunk(radius, height, sides=6):
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    lo = np.stack([np.cos(ang) * radius, np.zeros(sides), np.sin(ang) * radius], axis=1)
    pos = np.vstack([lo, lo + np.array([0.0, height, 0.0])])
    side_normals = np.stack([np.cos(ang), np.zeros(sides), np.sin(ang)], axis=1)
    nor = np.vstack([side_normals, side_normals])
    tri = []
    for i in range(sides):
        j = (i + 1) % sides
        tri += [i, j, sides + i, j, sides + j, sides + i]
    return orient_by_shading(Mesh(pos, nor, np.zeros((len(pos), 2)), np.array(tri), TRUNK))


def _ellipsoid(radius, half_height, centre_y, material, sides=8):
    """A smooth low-poly crown: three latitude rings and two poles."""
    latitudes = (-np.pi / 4, 0.0, np.pi / 4)
    pos = [[0.0, centre_y - half_height, 0.0]]
    nor = [[0.0, -1.0, 0.0]]
    for lat in latitudes:
        ring_r = radius * np.cos(lat)
        y = centre_y + half_height * np.sin(lat)
        for ang in np.linspace(0, 2 * np.pi, sides, endpoint=False):
            x, z = ring_r * np.cos(ang), ring_r * np.sin(ang)
            n = np.array([x / radius ** 2, (y - centre_y) / half_height ** 2, z / radius ** 2])
            n /= np.linalg.norm(n)
            pos.append([x, y, z]); nor.append(n)
    top = len(pos)
    pos.append([0.0, centre_y + half_height, 0.0]); nor.append([0.0, 1.0, 0.0])
    tri = []
    for i in range(sides):
        j = (i + 1) % sides
        tri += [0, 1 + i, 1 + j]
    for ring in range(len(latitudes) - 1):
        a = 1 + ring * sides; b = a + sides
        for i in range(sides):
            j = (i + 1) % sides
            tri += [a + i, b + i, a + j, a + j, b + i, b + j]
    last = 1 + (len(latitudes) - 1) * sides
    for i in range(sides):
        j = (i + 1) % sides
        tri += [last + i, top, last + j]
    return orient_by_shading(Mesh(np.array(pos), np.array(nor), np.zeros((len(pos), 2)),
                                  np.array(tri), material))


def _palm_profile(variant):
    """Repeatable trunk and crown proportions for one of the shared palm silhouettes."""
    profiles = (
        (7.5, (0.85, 0.15), (0.12, -0.16), 0.30, 0.05, 1.35),
        (6.8, (-0.48, 0.72), (0.18, 0.10), 0.34, 0.37, 1.18),
        (8.1, (1.08, -0.42), (-0.14, 0.18), 0.28, 0.70, 1.52),
        (7.2, (0.18, 0.64), (-0.22, -0.08), 0.32, 1.03, 1.28),
        (7.8, (-0.78, -0.30), (0.16, 0.22), 0.29, 1.36, 1.44),
    )
    return profiles[int(variant) % len(profiles)]


def _palm_centreline(height, lean, sweep, levels=10):
    f = np.linspace(0.0, 1.0, levels)
    ease = 0.12 * f + 0.88 * f ** 1.65
    belly = np.sin(np.pi * f)
    centres = np.zeros((levels, 3))
    centres[:, 0] = lean[0] * ease + sweep[0] * belly
    centres[:, 1] = height * f
    centres[:, 2] = lean[1] * ease + sweep[1] * belly
    return centres


def _palm_trunk(height=7.2, lean=(0.55, 0.0), sweep=(0.0, 0.0),
                base_radius=0.3, sides=9, levels=10):
    """A tapered trunk following a smooth, individually varied centreline."""
    pos, nor, tri = [], [], []
    centres = _palm_centreline(height, lean, sweep, levels)
    tangents = np.gradient(centres, axis=0)
    tangents /= np.linalg.norm(tangents, axis=1, keepdims=True)
    for level in range(levels):
        f = level / (levels - 1)
        radius = base_radius * (1.0 - 0.38 * f)
        tangent = tangents[level]
        if level == 0:
            # A slanted first ring digs one side below the terrain. The root flare is level; the
            # following rings turn progressively with the centreline.
            axis_x = np.array([1.0, 0.0, 0.0])
            axis_z = np.array([0.0, 0.0, 1.0])
        else:
            axis_x = np.array([1.0, 0.0, 0.0])
            axis_x -= tangent * np.dot(axis_x, tangent)
            axis_x /= np.linalg.norm(axis_x)
            axis_z = np.cross(tangent, axis_x)
        for ang in np.linspace(0, 2 * np.pi, sides, endpoint=False):
            normal = axis_x * np.cos(ang) + axis_z * np.sin(ang)
            pos.append(centres[level] + normal * radius)
            nor.append(normal)
    for level in range(levels - 1):
        a = level * sides; b = a + sides
        for i in range(sides):
            j = (i + 1) % sides
            tri += [a + i, a + j, b + i, a + j, b + j, b + i]
    return orient_by_shading(Mesh(np.array(pos), np.array(nor), np.zeros((len(pos), 2)),
                                  np.array(tri), TRUNK))


def _palm_fronds(centre, rotation=0.0, droop=1.35, count=15):
    """Curved rachises with feathered leaflets, instead of a ring of hard triangles."""
    pos, nor, tri = [], [], []
    centre = np.asarray(centre, dtype=float)

    def ribbon(points, widths, side):
        base = len(pos)
        for point, width in zip(points, widths):
            pos.extend([point - side * width, point + side * width])
            nor.extend([[0.0, 1.0, 0.0]] * 2)
        for i in range(len(points) - 1):
            a = base + i * 2; b = a + 2
            tri.extend([a, b, a + 1, a + 1, b, b + 1])

    def leaflet(start, direction, length, width, fall):
        direction = np.asarray(direction, dtype=float)
        direction /= max(np.linalg.norm(direction), 1e-6)
        across = np.array([-direction[2], 0.0, direction[0]])
        tip = start + direction * length + np.array([0.0, -fall, 0.0])
        mid = start * 0.46 + tip * 0.54 + np.array([0.0, 0.08, 0.0])
        base = len(pos)
        pos.extend([start, mid - across * width, tip, mid + across * width])
        nor.extend([[0.0, 1.0, 0.0]] * 4)
        tri.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    for index, ang in enumerate(np.linspace(0, 2 * np.pi, count, endpoint=False) + rotation):
        d = np.array([np.cos(ang), 0.0, np.sin(ang)])
        r = np.array([-d[2], 0.0, d[0]])
        length = 3.55 + 0.42 * np.sin(index * 2.31 + rotation)
        lift = 0.48 + 0.17 * (index % 3)
        side_curve = 0.22 * np.sin(index * 1.73 + rotation)
        t = np.linspace(0.0, 1.0, 7)
        points = np.asarray([
            centre + d * (length * f) + r * (side_curve * np.sin(np.pi * f))
            + np.array([0.0, lift * np.sin(np.pi * f) - droop * f ** 2, 0.0])
            for f in t
        ])
        ribbon(points, 0.13 * (1.0 - t) + 0.025, r)
        for f in np.linspace(0.18, 0.83, 7):
            spine = (centre + d * (length * f) + r * (side_curve * np.sin(np.pi * f))
                     + np.array([0.0, lift * np.sin(np.pi * f) - droop * f ** 2, 0.0]))
            leaf_length = (0.58 + 0.55 * np.sin(np.pi * f)) * (0.95 + 0.05 * (index % 2))
            for sign in (-1.0, 1.0):
                direction = d * (0.28 - 0.12 * f) + r * sign
                leaflet(spine + r * sign * 0.045, direction, leaf_length,
                        0.095 * np.sin(np.pi * f) + 0.025, 0.10 + 0.18 * f)
    return orient_by_shading(Mesh(np.array(pos), np.array(nor), np.zeros((len(pos), 2)),
                                  np.array(tri), FOLIAGE_BY_KIND["palm"]))


def kind_for_tags(tags):
    """Use the species facts OSM supplies; unknown individual trees stay broadleaf."""
    values = " ".join(str(tags.get(key, "")).lower()
                      for key in ("leaf_type", "species", "genus", "taxon", "taxon:family"))
    if "palm" in values or "phoenix" in values or "arecaceae" in values:
        return "palm"
    if "malus" in values:
        return "orchard"
    if "needleleaved" in values or any(name in values for name in
                                        ("pinus", "cupress", "sequoia", "cedrus", "picea")):
        return "conifer"
    return "broadleaf"


def tree_mesh(kind, variant=0):
    """One tree at roughly its real size, as {part name: mesh}. Instances scale it.

    Five silhouettes cover the OSM facts and Bay Area landcover without one mesh per species."""
    if kind == "conifer":
        trunk_h = 2.0
        canopy = [_cone(2.7 - k * 0.7, trunk_h + k * 2.4, trunk_h + k * 2.4 + 4.3,
                        material=FOLIAGE_BY_KIND[kind]) for k in range(3)]
        trunk = _trunk(0.22, trunk_h + 1.0)
    elif kind == "broadleaf":
        trunk_h = 2.7
        canopy = [_ellipsoid(3.5, 2.65, 5.25, FOLIAGE_BY_KIND[kind])]
        trunk = _trunk(0.3, trunk_h + 0.5)
    elif kind == "orchard":
        canopy = [_ellipsoid(2.9, 2.25, 4.7, FOLIAGE_BY_KIND[kind])]
        trunk = _trunk(0.26, 3.0)
    elif kind == "scrub":
        canopy = [_ellipsoid(2.5, 1.45, 1.85, FOLIAGE_BY_KIND[kind], sides=7)]
        trunk = _trunk(0.18, 1.0, sides=5)
    elif kind == "palm":
        height, lean, sweep, radius, rotation, droop = _palm_profile(variant)
        crown = _palm_centreline(height, lean, sweep)[-1]
        canopy = [_palm_fronds(crown, rotation, droop)]
        trunk = _palm_trunk(height, lean, sweep, radius)
    else:
        raise ValueError(f"unknown tree kind {kind}")
    foliage = FOLIAGE_BY_KIND[kind]
    return {TRUNK: trunk, foliage: merge(canopy, material=foliage)}


def scatter(poly, per_tree, rng):
    """Points inside a polygon at roughly one per `per_tree` square metres, rejection sampled."""
    if poly.is_empty or poly.area <= 0:
        return np.zeros((0, 2))
    want = int(poly.area / per_tree)
    if want <= 0:
        return np.zeros((0, 2))
    x0, y0, x1, y1 = poly.bounds
    tries = int(min(want * 4, 80_000))
    cand = np.stack([rng.uniform(x0, x1, tries), rng.uniform(y0, y1, tries)], axis=1)
    inside = prep(poly)
    keep = [p for p in cand if inside.contains(Point(p[0], p[1]))]
    return np.array(keep[:want]) if keep else np.zeros((0, 2))


def positions(res, road_y, dem, route_id, corridor, sight_clear=None, occupied=None):
    """Where every tree stands: (x, y, z, yaw, scale, kind).

    Anything on the racing surface or its shoulder is dropped: a tree in the road is worse than no
    tree at all. `occupied` (streets and buildings) and mapped paved ground additionally keep the
    zoned scatter off everything a yard tree could not stand on."""
    rng = np.random.default_rng(zlib.crc32(route_id.encode()))
    frame = res.frame
    xz, kinds = [], []

    mapped, mapped_kinds = [], []
    for e in load_layer(route_id, "trees")["elements"]:
        points = ([(e["lat"], e["lon"])] if e["type"] == "node" else
                  [(p["lat"], p["lon"]) for p in e.get("geometry", [])])
        mapped += points
        mapped_kinds += [kind_for_tags(e.get("tags", {}))] * len(points)
    if mapped:
        x, z = frame.to_local(np.array([m[0] for m in mapped]), np.array([m[1] for m in mapped]))
        xz.append(np.stack([x, z], axis=1))
        kinds += mapped_kinds

    zoned, paved = [], []
    # Car parks are tagged amenity=parking, which the land-use keys never see.
    for kind, ring in (landcover.rings(route_id, set(DENSITY) | set(ZONED_DENSITY) | PAVED, relations=True)
                       + landcover.rings(route_id, {"parking"}, keys=("amenity",), relations=True)):
        x, z = frame.to_local(np.array([p[0] for p in ring]), np.array([p[1] for p in ring]))
        poly = Polygon(np.stack([x, z], axis=1))
        if not poly.is_valid:
            poly = poly.buffer(0)
        poly = poly.intersection(corridor)
        if kind in PAVED:
            paved.append(poly)
            continue
        per_tree = DENSITY.get(kind) or ZONED_DENSITY[kind]
        for part in (poly.geoms if poly.geom_type == "MultiPolygon" else [poly]):
            if part.geom_type != "Polygon":
                continue
            pts = scatter(part, per_tree, rng)
            if len(pts):
                xz.append(pts)
                if kind in DENSITY:
                    kinds += [SCATTER_KIND[kind]] * len(pts)
                else:
                    kinds += ["conifer" if rng.random() < ZONED_CONIFER else "broadleaf" for _ in pts]
                zoned.append(np.full(len(pts), kind in ZONED_DENSITY))
    if not xz:
        return []

    P = np.vstack(xz)
    is_zoned = np.concatenate([np.zeros(len(P) - sum(len(z) for z in zoned), dtype=bool), *zoned])
    dist, idx = cKDTree(res.P[:, [0, 2]]).query(P)
    keep = (dist > flat_inner(res, idx, P) + CLEAR) & (dist < SCATTER_RADIUS)
    from shapely import contains_xy
    from shapely.ops import unary_union
    keep &= contains_xy(corridor, P[:, 0], P[:, 1])
    blocked = unary_union([g for g in [occupied, *paved] if g is not None and not g.is_empty])
    if is_zoned.any() and not blocked.is_empty:
        keep &= ~(is_zoned & contains_xy(blocked, P[:, 0], P[:, 1]))
    if sight_clear is not None and not sight_clear.is_empty:
        keep &= ~contains_xy(sight_clear, P[:, 0], P[:, 1])
    P = P[keep]
    kinds = [k for k, v in zip(kinds, keep) if v]
    if not len(P):
        return []
    if len(P) > MAX_TREES:
        pick = np.sort(rng.choice(len(P), MAX_TREES, replace=False))
        P, kinds = P[pick], [kinds[i] for i in pick]
    y = ground_height(res, road_y, dem, P)
    yaw = rng.uniform(0, 2 * np.pi, len(P))
    scl = rng.uniform(0.75, 1.45, len(P))
    return [(float(P[i, 0]), float(y[i]), float(P[i, 1]), float(yaw[i]), float(scl[i]), kinds[i])
            for i in range(len(P))]


def add_to_tiles(ts, trees):
    """Two instanced nodes per kind of tree, so trunks and canopies keep their own material."""
    meshes = {kind: [tree_mesh(kind)] for kind in TREE_KINDS if kind != "palm"}
    meshes["palm"] = [tree_mesh("palm", variant) for variant in range(PALM_VARIANT_COUNT)]
    for x, y, z, yaw, scl, kind in trees:
        token = zlib.crc32(f"{x:.3f}:{z:.3f}".encode())
        variant = token % PALM_VARIANT_COUNT if kind == "palm" else 0
        radial = scl * (0.88 + ((token >> 8) & 255) / 255.0 * 0.24) if kind == "palm" else scl
        height = scl * (0.94 + ((token >> 16) & 255) / 255.0 * 0.12) if kind == "palm" else scl
        for part, mesh in meshes[kind][variant].items():
            lo, hi = mesh.bounds()
            suffix = f"_v{variant}" if kind == "palm" else ""
            ts.add_instance(f"trees_{kind}{suffix}_{part}", (x, y, z), yaw, mesh,
                            ((hi - lo) / 2).tolist(), scale=(radial, height, radial))


def _translated(mesh, offset, material=None):
    """Copy one tiny plant primitive without mutating the shared source mesh."""
    return Mesh(mesh.positions + np.asarray(offset), mesh.normals.copy(), mesh.uvs.copy(),
                mesh.indices.copy(), material or mesh.material)


def flower_meshes():
    """One leafy hydrangea bush and four shared multi-head bloom variants."""
    bush = merge([
        _translated(_ellipsoid(0.88, 0.49, 0.48, FOLIAGE, sides=7), (-0.42, 0, 0)),
        _translated(_ellipsoid(0.92, 0.52, 0.52, FOLIAGE, sides=7), (0.22, 0, 0.08)),
        _translated(_ellipsoid(0.78, 0.43, 0.43, FOLIAGE, sides=7), (0.62, 0, -0.18)),
    ], FOLIAGE)
    heads = []
    for material in FLOWER_MATERIALS:
        parts = []
        for x, y, z, radius in ((-0.48, 0.92, 0.04, 0.31), (0.0, 1.08, -0.12, 0.36),
                                (0.48, 0.91, 0.08, 0.30), (-0.15, 0.80, 0.42, 0.27),
                                (0.28, 0.82, 0.40, 0.25)):
            parts.append(_translated(_ellipsoid(radius, radius * 0.76, 0, material, sides=7),
                                     (x, y, z), material))
        heads.append(merge(parts, material))
    return bush, dict(zip(FLOWER_MATERIALS, heads))


def lombard_flowers(res, road_y, dem, route_id, sight_clear=None):
    """Dense flower beds around Lombard's eight hairpins, derived from the racing line itself.

    OSM records this block as generic garden/greenery and does not carry individual hydrangeas.
    The route curvature is the stable public geometry that identifies the famous block; candidates
    are then checked against every leg of the road so a bed between two switchbacks never spills
    onto either racing surface.
    """
    if route_id != "lombard":
        return []
    # The route file already names the two ends of the famous one-way block as waypoint 1 and 2.
    # Use those snapped public-road positions rather than guessing from every sharp corner in the
    # following two kilometres of North Beach streets.
    snapped = getattr(res, "snapped", ())
    if len(snapped) >= 3:
        route_tree = cKDTree(res.P[:, [0, 2]])
        ends = route_tree.query(np.asarray([snapped[1], snapped[2]]))[1]
        lo = max(0.0, float(res.S[min(ends)]) - 12.0)
        hi = min(res.length, float(res.S[max(ends)]) + 12.0)
    else:
        bend = np.abs(curvature(res.P, res.S, res.closed)) > 1 / 18.0
        if not bend.any():
            return []
        lo = max(0.0, float(res.S[bend].min()) - 12.0)
        hi = min(res.length, float(res.S[bend].max()) + 12.0)
    rng = np.random.default_rng(zlib.crc32(b"lombard-hydrangeas"))
    tree = cKDTree(res.P[:, [0, 2]])
    candidates = []
    for serial, s in enumerate(np.arange(lo, hi, 1.60)):
        i = int(np.clip(np.searchsorted(res.S, s), 0, len(res.S) - 1))
        for side in (-1.0, 1.0):
            for row in range(4):
                lateral = side * (float(res.half_width[i]) + 1.18 + row * 1.05)
                lateral += float(rng.uniform(-0.18, 0.18))
                x = float(res.P[i, 0] + res.R[i, 0] * lateral)
                z = float(res.P[i, 2] + res.R[i, 2] * lateral)
                dist, nearest = tree.query([x, z])
                if dist <= float(res.half_width[int(nearest)]) + 0.72:
                    continue
                if sight_clear is not None and sight_clear.covers(Point(x, z)):
                    continue
                candidates.append((x, z, serial, row, side))
    if not candidates:
        return []
    xz = np.asarray([[p[0], p[1]] for p in candidates])
    y = ground_height(res, road_y, dem, xz)
    plants = []
    for i, (x, z, serial, row, side) in enumerate(candidates):
        colour = FLOWER_MATERIALS[(serial + row * 2 + (1 if side > 0 else 0)) % len(FLOWER_MATERIALS)]
        plants.append((x, float(y[i]), z, float(rng.uniform(0, 2 * np.pi)),
                       float(rng.uniform(0.90, 1.32)), colour))
    return plants


def add_flowers_to_tiles(ts, plants):
    bush, blooms = flower_meshes()
    bush_half = ((bush.bounds()[1] - bush.bounds()[0]) / 2).tolist()
    bloom_half = {kind: ((mesh.bounds()[1] - mesh.bounds()[0]) / 2).tolist()
                  for kind, mesh in blooms.items()}
    for x, y, z, yaw, scale, material in plants:
        ts.add_instance("flowers_foliage", (x, y, z), yaw, bush, bush_half,
                        scale=(scale, scale, scale))
        ts.add_instance(f"flowers_{material}", (x, y, z), yaw, blooms[material],
                        bloom_half[material], scale=(scale, scale, scale))
