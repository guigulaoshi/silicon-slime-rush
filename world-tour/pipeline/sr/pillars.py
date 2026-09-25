"""Sandstone pillar fields: the Wulingyuan landscape the elevation data is too coarse to draw.

The pillars of a quartz-sandstone karst are what is left of a plateau after its joints were cut into
gorges: every pillar is a remnant of the plateau, so its top stands close to the plateau surface and
its foot is on the gorge floor. A 30 m elevation grid keeps the gorges (hundreds of metres deep round
Yuanjiajie) and loses the pillars between them, so a route that declares a `pillarField` gets them
back here, generated into the backdrop: never driven on, always in view, no collider.

Each pillar is a jointed prism -- an irregular, sometimes blade-shaped cross-section, a slight taper,
horizontal ledges where the bedding steps in and out, a lean -- capped with a crown of trees that
overhangs its edge, and a few pines on the skyline of the nearer ones. The rock is `rock_sandstone`,
which the runtime draws with horizontal bedding and vertical joints (`landmarkSurface` in
game/src/world/materials.ts); the crown is the forest's own `foliage_dark`.

Shape numbers are photo estimates from the research card (height:width 4:1 to 6:1, shafts 15-50 m at
the base, gaps of a few metres in the dense clusters to 50+ in the open), not measurements.
"""
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from sr.mesh import from_triangles, merge

ROCK = "rock_sandstone"
CROWN = "foliage_dark"
GRID = 20.0            # metres per cell of the height grid the placement reads
PLATEAU_WINDOW = 600.0  # the local plateau is the 90th percentile of the ground in this window
SINK = 25.0            # the shaft starts this far underground: the tile terrain and the backdrop disagree
LIFT_REACH = 1500.0   # pillars nearer the road than this rise clear of the roadside canopy
NEAR = 800.0          # pillars nearer the route than this get more sides, ledges and pines on top


def _plateau(h):
    size = max(3, int(PLATEAU_WINDOW / GRID) | 1)
    return ndimage.percentile_filter(h, 90, size=size, mode="nearest")


def _ring(centre, radii, angles, axes, y):
    """Points of one horizontal ring: `radii` along `angles` in the pillar's own (major, minor) axes."""
    u, v = axes
    c, s = np.cos(angles) * radii, np.sin(angles) * radii
    x = centre[0] + c * u[0] + s * v[0]
    z = centre[1] + c * u[1] + s * v[1]
    return np.c_[x, np.full(len(angles), y), z]


def _strip(lo, hi):
    """An open band between two matching polylines."""
    m = len(lo)
    P = np.vstack([lo, hi])
    T = [(k, k + 1, m + k + 1) for k in range(m - 1)] + [(k, m + k + 1, m + k) for k in range(m - 1)]
    return P, np.asarray(T, dtype=np.int64)


def _tube(rings, closed_top_at=None):
    """Triangles joining consecutive rings of the same vertex count, plus an optional apex."""
    n = len(rings[0])
    P = np.vstack(rings)
    tris = []
    for j in range(len(rings) - 1):
        a, b = j * n, (j + 1) * n
        for k in range(n):
            k1 = (k + 1) % n
            tris += [(a + k, a + k1, b + k1), (a + k, b + k1, b + k)]
    if closed_top_at is not None:
        apex = len(P)
        P = np.vstack([P, closed_top_at])
        a = (len(rings) - 1) * n
        for k in range(n):
            tris.append((a + k, a + (k + 1) % n, apex))
    return P, np.asarray(tris, dtype=np.int64)


def _outward(P, tris, axis_xz):
    """Wind every triangle to face away from the pillar's axis (or up, for the flat parts of a cap)."""
    a, b, c = P[tris[:, 0]], P[tris[:, 1]], P[tris[:, 2]]
    n = np.cross(b - a, c - a)
    mid = (a + b + c) / 3.0
    out = np.c_[mid[:, 0] - axis_xz[0], np.zeros(len(mid)), mid[:, 2] - axis_xz[1]]
    out[:, 1] = 0.25 * np.linalg.norm(out, axis=1) + 1e-3
    flip = np.einsum("ij,ij->i", n, out) < 0
    tris = tris.copy()
    tris[flip] = tris[flip][:, [0, 2, 1]]
    return tris


def _faceted(rings, centre):
    """Side walls with a vertex set per face column: hard edges between columns (the vertical
    joints the rock splits along), smooth shading up each column."""
    n = len(rings[0])
    P, T = [], []
    for k in range(n):
        k1 = (k + 1) % n
        base = len(P)
        for ring in rings:
            P.append(ring[k]); P.append(ring[k1])
        for j in range(len(rings) - 1):
            a, b = base + 2 * j, base + 2 * (j + 1)
            T += [(a, a + 1, b + 1), (a, b + 1, b)]
    P = np.asarray(P); T = np.asarray(T, dtype=np.int64)
    return from_triangles(P, _outward(P, T, centre), ROCK)


def _shaft(rng, x, z, ground, height, radius, near):
    """One jointed shaft: (rock mesh, crown mesh)."""
    n = int(rng.integers(8, 11)) if near else int(rng.integers(6, 8))
    angles = np.sort(np.linspace(0, 2 * np.pi, n, endpoint=False) + rng.uniform(-.2, .2, n))
    phi = rng.uniform(0, np.pi)
    aspect = rng.uniform(1.0, 2.0)
    axes = (np.array([np.cos(phi), np.sin(phi)]), np.array([-np.sin(phi), np.cos(phi)]))
    ell = 1.0 / np.sqrt((np.cos(angles) ** 2) + (aspect * np.sin(angles)) ** 2)
    section = radius * np.sqrt(aspect) * ell * rng.uniform(.75, 1.2, n)
    lean = rng.normal(0, .02, 2)
    cap = float(np.clip(radius * .45, 4.0, 10.0))
    top_rock = ground + height - cap
    ys = [ground - SINK, ground]
    y = ground
    while True:
        y += rng.uniform(6, 18) if near else rng.uniform(15, 35)
        if y >= top_rock - 3:
            break
        ys.append(y)
    ys.append(top_rock)
    rings = []
    ledges = []
    step = np.ones(n)
    shoulder = {len(ys) - 1: .72, len(ys) - 2: .9}      # the top rounds off; a flat top reads as a roof
    for j, yy in enumerate(ys):
        t = max(0.0, (yy - ground) / max(height, 1.0))
        scale = (1.0 - .28 * t) * shoulder.get(j, 1.0)
        if yy <= ground:
            scale *= 1.25                                   # talus flaring out under the foot
        if 1 < j < len(ys) - 1:
            # a bed steps in or out, the whole ring or one side of it, and each corner wanders
            if rng.random() < .35:
                step = step * rng.uniform(.88, 1.1)
                if near and rng.random() < .6:
                    ledges.append(j)                        # shrubs root on the shelf a bed leaves
            wobble = rng.uniform(.93, 1.07, n)
        else:
            wobble = np.ones(n)
        centre = (x + lean[0] * (yy - ground), z + lean[1] * (yy - ground))
        rings.append(_ring(centre, section * scale * step * wobble, angles, axes, yy))
    rock = _faceted(rings, (x, z))
    green = []
    for j in ledges:
        # a band of shrubs hugging part of the wall above the ledge
        lo, hi = rings[j], rings[j].copy()
        k0 = int(rng.integers(0, n)); span = int(rng.integers(n // 3, n // 2 + 2))
        idx = [(k0 + i) % n for i in range(span)]
        c = np.array([x, z])
        band_lo = lo[idx].copy(); band_hi = lo[idx].copy()
        for band, grow, rise in ((band_lo, 1.06, 0.0), (band_hi, 1.02, rng.uniform(2.5, 5.0))):
            band[:, [0, 2]] = c + (band[:, [0, 2]] - c) * grow
            band[:, 1] += rise
        GP, gtris = _strip(band_lo, band_hi)
        green.append(from_triangles(GP, _outward(GP, gtris, (x, z)), CROWN))
    # The crown: trees on the top, their tops ragged, not a lid. It stays inside the rim: an overhang of
    # 4-14 % read from the road as a green slab wider than the rock it sits on (a player's screenshot).
    top = ground + height
    rim = rings[-1]
    cx, cz = rim[:, 0].mean(), rim[:, 2].mean()
    out = np.c_[rim[:, 0] - cx, rim[:, 2] - cz]
    over = rim.copy(); k = rng.uniform(.94, 1.0, n)
    over[:, 0] = cx + out[:, 0] * k; over[:, 2] = cz + out[:, 1] * k
    over[:, 1] = top_rock + cap * rng.uniform(.2, .6, n)
    dome = rim.copy(); dome[:, 0] = cx + out[:, 0] * .75; dome[:, 2] = cz + out[:, 1] * .75
    dome[:, 1] = top_rock + cap * rng.uniform(.55, 1.0, n)
    CP, ctris = _tube([rim, over, dome], closed_top_at=np.array([[cx, top, cz]]))
    crown = [from_triangles(CP, _outward(CP, ctris, (cx, cz)), CROWN), *green]
    if near:
        # Pines stand on the top, never over the drop: a spot is picked inside the rim itself (towards a
        # rim corner, at most 55 % of the way), and a pine's spread is kept inside the rim from there.
        # Picking by the shaft's nominal radius put some in thin air past the narrow side of the top.
        edge = [(rim[i, [0, 2]], rim[(i + 1) % n, [0, 2]]) for i in range(n)]
        def room(px, pz):
            p = np.array([px, pz]); best = np.inf
            for a, b in edge:
                ab = b - a; t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-9), 0, 1)
                best = min(best, float(np.linalg.norm(p - (a + t * ab))))
            return best
        for _ in range(int(rng.integers(2, 6))):
            corner = rim[int(rng.integers(0, n))]
            f = rng.uniform(0, .55)
            px, pz = cx + (corner[0] - cx) * f, cz + (corner[2] - cz) * f
            spread = .9 * room(px, pz)
            if spread < 1.5:
                continue
            base = top_rock + cap * .5
            h = min(rng.uniform(8, 16), spread / .45)
            for tier, (lo, hi, rr) in enumerate(((0, .6, .45), (.35, 1.0, .3))):
                cone = np.linspace(0, 2 * np.pi, 5, endpoint=False) + rng.uniform(0, 1)
                ring = _ring((px, pz), np.full(5, h * rr), cone, (np.array([1., 0.]), np.array([0., 1.])), base + h * lo)
                TP, ttris = _tube([ring], closed_top_at=np.array([[px, base + h * hi, pz]]))
                crown.append(from_triangles(TP, _outward(TP, ttris, (px, pz)), CROWN))
    return rock, merge(crown, CROWN)


def pillar(rng, x, z, ground, height, radius, near):
    """A pillar: one shaft, or (half the time) a clump of two to four fused shafts of unequal height,
    which is what most of the forest is -- a lone smooth column reads as a chimney."""
    shafts = [(x, z, height, radius)]
    if rng.random() < .5:
        for _ in range(int(rng.integers(1, 4))):
            a = rng.uniform(0, 2 * np.pi); d = radius * rng.uniform(.6, 1.0)
            shafts.append((x + np.cos(a) * d, z + np.sin(a) * d, height * rng.uniform(.6, .95), radius * rng.uniform(.5, .8)))
    rock, crown = [], []
    for sx, sz, h, r in shafts:
        a, b = _shaft(rng, sx, sz, ground, h, r, near)
        rock.append(a); crown.append(b)
    return merge(rock, ROCK), merge(crown, CROWN)


def _clear_of(placed_xz, placed_r, x, z, radius, spacing, rng):
    """Whether a pillar at (x, z) keeps its gap to every one already placed."""
    if not placed_xz:
        return True
    xz = np.asarray(placed_xz); r = np.asarray(placed_r)
    d = np.hypot(xz[:, 0] - x, xz[:, 1] - z)
    return bool(np.all(d >= np.maximum(spacing * rng.uniform(.8, 1.3), radius + r + 6.0)))


def build(res, route, dem, water_level=0.0, keep_clear=None):
    """{node name: mesh} for the route's `pillarField`, or {} when it declares none. `keep_clear` is
    the drawn roads' footprint: the race road is kept clear by distance, but a side street 160 m off
    it had a 200 m pillar standing across it."""
    spec = route.get("pillarField")
    if not spec:
        return {}
    rng = np.random.default_rng(int(spec.get("seed", 1)))
    reach = float(spec.get("radiusM", 3000.0))
    clear = float(spec.get("clearM", 90.0))
    spacing = float(spec.get("spacingM", 70.0))
    drop = float(spec.get("dropM", 70.0))
    most = int(spec.get("max", 600))
    lo = res.P[:, [0, 2]].min(axis=0) - reach
    hi = res.P[:, [0, 2]].max(axis=0) + reach
    gx = np.arange(lo[0], hi[0] + GRID, GRID)
    gz = np.arange(lo[1], hi[1] + GRID, GRID)
    X, Z = np.meshgrid(gx, gz, indexing="ij")
    lat, lon = res.frame.to_latlon(X.ravel(), Z.ravel())
    h = dem.heights(lat, lon).reshape(X.shape)
    plateau = _plateau(h)

    def grid_at(field, x, z):
        return ndimage.map_coordinates(field, [(x - gx[0]) / GRID, (z - gz[0]) / GRID], order=1, mode="nearest")

    rock, crown = [], []
    placed_xz, placed_r = [], []
    from shapely import prepare
    from shapely.geometry import Point
    if keep_clear is not None:
        prepare(keep_clear)

    def on_a_road(x, z, radius):
        # a clump's other shafts stand up to 1.8 radii off its centre
        return keep_clear is not None and keep_clear.intersects(Point(x, z).buffer(radius * 1.9 + 4.0, quad_segs=4))

    def place(x, z, height, radius, near):
        # The foot is read off the same sampler the backdrop terrain uses; SINK covers the rest.
        la, lo_ = res.frame.to_latlon(np.array([x]), np.array([z]))
        ground = float(dem.heights(la, lo_)[0])
        r, c = pillar(rng, x, z, ground, height, radius, near)
        rock.append(r); crown.append(c)
        placed_xz.append((x, z)); placed_r.append(radius)

    for named in spec.get("named", ()):
        x, z = res.frame.to_local(np.array([named["lat"]]), np.array([named["lon"]]))
        place(float(x[0]), float(z[0]), float(named["heightM"]), float(named["radiusM"]), True)

    # Candidates, densest first: clusters where a low-frequency field is high, like the real forest's
    # walls and open stretches, rather than an even scatter.
    count = 40 * most
    cx = rng.uniform(lo[0], hi[0], count)
    cz = rng.uniform(lo[1], hi[1], count)
    field = ndimage.gaussian_filter(rng.random(X.shape), sigma=250.0 / GRID, mode="wrap")
    field = (field - field.min()) / max(float(np.ptp(field)), 1e-9)
    order = np.argsort(-(grid_at(field, cx, cz) + rng.uniform(0, .35, count)))
    cx, cz = cx[order], cz[order]
    tree_route = cKDTree(res.P[:, [0, 2]])
    dist, nearest = tree_route.query(np.c_[cx, cz])
    rl, ro = res.frame.to_latlon(res.P[:, 0], res.P[:, 2])
    road = dem.heights(rl, ro)[nearest]
    ground = grid_at(h, cx, cz)
    top = grid_at(plateau, cx, cz)
    keep = (dist >= clear) & (dist <= reach) & (ground > water_level + 1) & (top - ground >= drop)
    cx_all, cz_all, dist_all, ground_all, road_all = cx, cz, dist, ground, road
    cx, cz, dist, ground, top, road = cx[keep], cz[keep], dist[keep], ground[keep], top[keep], road[keep]
    # The near stand: pillars rising out of the forest beside the road, tops well above it. From a
    # road on the plateau the deep gorges are a kilometre or two off and their pillars show only as
    # stubs over the trees; these are the ones a driver sees go past.
    near_most = int(spec.get("nearMax", 0))
    near_reach = float(spec.get("nearM", 900.0))
    near_ok = (dist_all >= clear + 50) & (dist_all <= near_reach) & (ground_all > water_level + 1)
    placed_near = 0
    for x, z, d, g, rd in zip(cx_all[near_ok], cz_all[near_ok], dist_all[near_ok], ground_all[near_ok], road_all[near_ok]):
        if placed_near >= near_most:
            break
        height = float(np.clip(rd - g + rng.uniform(80, 200), 60.0, 340.0))
        radius = float(np.clip(height / (2 * rng.uniform(3.0, 5.5)), 9.0, 28.0))
        if d < clear + 50 + radius or on_a_road(x, z, radius) \
                or not _clear_of(placed_xz, placed_r, x, z, radius, max(spacing, 110.0), rng):
            continue
        place(float(x), float(z), height, radius, True)
        placed_near += 1
    for x, z, d, g, t, rd in zip(cx, cz, dist, ground, top, road):
        if len(placed_r) >= most:
            break
        # tops at the plateau surface give or take the ridges the grid smooths away, so they break the
        # skyline over the forest the way they do from the real road
        top_y = t + rng.uniform(-30, 60)
        if d < LIFT_REACH:
            # Seen from a road on the plateau, tops level with it hide behind the roadside trees. The
            # nearer pillars stand clear of the canopy instead (a liberty: the real ones do from the
            # viewpoints, not from the road), falling back to the plateau level with distance.
            top_y = max(top_y, rd + rng.uniform(20, 110) * (1 - d / LIFT_REACH))
        height = float(np.clip(top_y - g, drop, 340.0))
        radius = float(np.clip(height / (2 * rng.uniform(2.5, 5.5)), 8.0, 30.0))
        if d < clear + radius or on_a_road(x, z, radius):
            continue
        if not _clear_of(placed_xz, placed_r, x, z, radius, spacing, rng):
            continue
        place(float(x), float(z), height, radius, d < NEAR)
    if not rock:
        return {}
    return {"backdrop_pillars_rock": merge(rock, ROCK), "backdrop_pillars_crown": merge(crown, CROWN)}
