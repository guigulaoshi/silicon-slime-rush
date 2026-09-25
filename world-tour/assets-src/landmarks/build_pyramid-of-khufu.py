"""Great Pyramid of Khufu (Cheops), Giza -- and the shared Giza pyramid kit the Khafre and Menkaure
scripts load from this file (`build_pyramid-of-khafre.py`, `build_pyramid-of-menkaure.py`).

Original geometry from published figures (sources in the report under
$SCRATCH/modelling/pyramid-of-khufu/data): base 230.33 m, seked 5 1/2 palms = 51 deg 50' 40",
original height 146.6 m, current height 138.5 m, 203 remaining courses, first course 1.49 m,
summit courses about 0.5 m (Petrie 1883 via Wikipedia). The original entrance is in the 19th course,
about 17 m up and 15 royal cubits (7.86 m) east of the centre line, under a double row of chevron
blocks; the Robbers' Tunnel is forced into courses 6-7, about 7 m up, near the centre line. A few
lowest-course casing blocks survive in situ, best on the north face below the entrances. Gill's
survey mast (1874) stands on the summit platform.

How a pyramid is built here: every course is its own closed prism whose outline walks the four faces
in block-length segments. Each segment is pushed in by a small per-block jitter (the vertical joints),
by scars and holes (missing blocks, robbers' cuts, the entrances), and by the ragged corner arrises;
the step nose of every course lies on the pyramid's slope, so the silhouette is the real sawtooth of
the exposed core. Casing survives as separate sloped prisms laid over the core courses.

Ground: the game stands the model on the lowest finished ground on the footprint outline (y = 0 here).
The pyramid's level base sits at the median ground of its outline; a pavement/bedrock apron runs from
its foot down to wherever the game's ground is lower, so nothing floats and nothing is cut short.

Author frame: e east, y up, s south (metres, from the footprint centroid); converted to the
tool's (u, y, v) by projection on its across/axis vectors.
Run: Blender --background --python assets-src/landmarks/build_pyramid-of-khufu.py
"""
import json
import tempfile
import math
import os
import random
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ROUTE = 'giza'
SCRATCH = (Path(tempfile.gettempdir()) / 'sr-landmarks')

# ============================================================== plan (runs under the pipeline venv)
PLAN = r'''
import json, sys
import numpy as np
from shapely.geometry import Polygon
from scipy.spatial import cKDTree, Delaunay
from sr.geo import LocalFrame
from sr.dem import DemSampler
from sr.route import build_route
from sr.routes import load_route
from sr.bare_earth import for_route
from sr.landmark_data import entries, model_anchor
from sr.terrain import road_profile, ground_height
from sr.fetch_dem import BACKDROP_ZOOM
from sr.backdrop import sample_grid
from sr.fetch_osm import load_layer

ident, half, cell, ids = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), [int(i) for i in sys.argv[4].split(',') if i]
route = load_route('giza'); res = build_route('giza')
raw = DemSampler(); pad = float(route.get('terrainPadM', 300))
bare = for_route(raw, res, 'giza', pad, float(route.get('waterLevelM', 0.0)))
# the same road profile the build uses (no roof support on this route)
road_y = road_profile(res, bare, route.get('bridgeDeckM'), route.get('bridgeMinLengthM', 200.0))
tree = cKDTree(res.P[:, [0, 2]])
e = entries()[ident]; lat, lon = model_anchor(e); ax, az = res.frame.to_local(lat, lon); ax, az = float(ax), float(az)
fp = np.asarray(e['footprint']); fx, fz = res.frame.to_local(fp[:, 0], fp[:, 1]); poly = Polygon(np.c_[fx, fz])
samples = []; ring = np.asarray(poly.exterior.coords)
for a, b in zip(ring[:-1], ring[1:]):
    st = max(1, int(np.ceil(np.hypot(*(b - a)) / 8.0))); samples.extend(a + (b - a) * (i / st) for i in range(st))
samples.append(np.asarray(poly.centroid.coords[0])); samples = np.asarray(samples)
hs = ground_height(res, road_y, bare, samples, tree); datum = float(hs.min()); low = samples[int(hs.argmin())] - [ax, az]
# the backdrop's coarse ground where the streamed terrain stops (lowest of the two is what may show)
over = bare.over(DemSampler(BACKDROP_ZOOM))
grid = sample_grid(res, float(route.get('backdropM', 3000)), pad - 20)
grid = grid[np.hypot(grid[:, 0] - ax, grid[:, 1] - az) < half + 600]
gla, glo = res.frame.to_latlon(grid[:, 0], grid[:, 1]); gy = over.heights(gla, glo); tri = Delaunay(grid)
xs = np.arange(-half, half + cell / 2, cell)
E, S = np.meshgrid(xs, xs); q = np.c_[E.ravel() + ax, S.ravel() + az]
g = ground_height(res, road_y, bare, q, tree); d = tree.query(q)[0]
s = tri.find_simplex(q); T = tri.transform[np.maximum(s, 0)]
bc = np.einsum('ijk,ik->ij', T[:, :2], q - T[:, 2]); bc = np.c_[bc, 1 - bc.sum(1)]
c = (gy[tri.simplices[np.maximum(s, 0)]] * bc).sum(1)
g = np.where((s >= 0) & (d > pad - 60), np.minimum(g, c), g) - datum
rp = res.P[:, [0, 2]] - [ax, az]; m = np.abs(rp).max(1) < half + 60
rings = {}
for layer in ('buildings', 'landuse', 'backdrop', 'roads'):
    try: els = load_layer('giza', layer)['elements']
    except FileNotFoundError: continue
    for el in els:
        if el.get('id') in ids and el.get('geometry') and el['id'] not in rings:
            la = np.array([p['lat'] for p in el['geometry']]); lo = np.array([p['lon'] for p in el['geometry']])
            x, z = res.frame.to_local(la, lo); rings[el['id']] = np.c_[x - ax, z - az].round(3).tolist()
json.dump(dict(datum=datum, low=low.tolist(), outline=(samples[:-1] - [ax, az]).tolist(), outlineG=(hs[:-1] - datum).tolist(),
               x0=-half, cell=cell, n=len(xs), g=g.reshape(E.shape).round(3).tolist(),
               road=np.c_[rp[m], res.half_width[m]].round(2).tolist(), rings={str(k): v for k, v in rings.items()}),
          open(sys.argv[5], 'w'))
'''


def run_plan(ident, half, cell, ids):
    out = SCRATCH / ident / 'plan.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    code = SCRATCH / ident / 'plan_code.py'
    code.write_text(PLAN)
    subprocess.check_call([str(ROOT / 'pipeline/.venv/bin/python'), str(code), ident, str(half), str(cell),
                           ','.join(str(i) for i in ids), str(out)], cwd=ROOT / 'pipeline',
                          env={**os.environ, 'PYTHONPATH': str(ROOT / 'pipeline')})
    return json.loads(out.read_text())


class Ground:
    """Finished game ground (relative to the model datum) on the plan's grid, bilinear."""
    def __init__(self, plan):
        self.x0, self.cell, self.n, self.g = plan['x0'], plan['cell'], plan['n'], plan['g']

    def __call__(self, e, s):
        fx = min(max((e - self.x0) / self.cell, 0), self.n - 1.001)
        fy = min(max((s - self.x0) / self.cell, 0), self.n - 1.001)
        i, j = int(fx), int(fy); a, b = fx - i, fy - j
        g = self.g
        return ((g[j][i] * (1 - a) + g[j][i + 1] * a) * (1 - b) + (g[j + 1][i] * (1 - a) + g[j + 1][i + 1] * a) * b)

    def low(self, e, s, r):
        return min(self(e + dx, s + ds) for dx in (-r, 0, r) for ds in (-r, 0, r))


# ============================================================== geometry kit (Blender side)
# faces in walking order: outward normal n and tangent t in (e, s); s points south
FACES = {'N': ((0, -1), (1, 0)), 'E': ((1, 0), (0, 1)), 'S': ((0, 1), (-1, 0)), 'W': ((-1, 0), (0, -1))}
ORDER = ['N', 'E', 'S', 'W']


class Cut:
    """A region of a face pushed in by `depth`: missing blocks, a robbers' cut, an entrance.
    x0, x1 along the face (walking direction) or, with `corner` = -1/+1, distances from that end.
    `blob` makes it an irregular scar (elliptic in x, y) and `jag` roughens its edges course by course."""
    _n = 0

    def __init__(self, face, x0, x1, y0, y1, depth, corner=0, jag=0.0, blob=False):
        self.face, self.x0, self.x1, self.y0, self.y1, self.depth, self.corner = face, x0, x1, y0, y1, depth, corner
        self.jag, self.blob = jag, blob
        Cut._n += 1
        self.seed = Cut._n * 7919

    def shifted(self, dy):
        c = Cut(self.face, self.x0, self.x1, self.y0 + dy, self.y1 + dy, self.depth, self.corner, self.jag, self.blob)
        c.seed = self.seed
        return c

    def at(self, w, ym):
        """(x0, x1, depth) of this cut in the course whose mid height is ym, or None."""
        if not (self.y0 <= ym < self.y1):
            return None
        r = random.Random(hash((self.seed, int(round(ym * 1000)))))
        j = self.jag
        depth = self.depth * (1 + j * 0.35 * r.uniform(-1, 1))
        if self.blob:
            yc = (self.y0 + self.y1) / 2; ry = (self.y1 - self.y0) / 2; t = (ym - yc) / ry
            f = math.sqrt(max(0.0, 1 - t * t))
            xc = (self.x0 + self.x1) / 2 + j * 0.25 * (self.x1 - self.x0) * r.uniform(-1, 1)
            half = (self.x1 - self.x0) / 2 * (0.25 + 0.75 * f) * (1 + j * r.uniform(-0.6, 0.4))
            return xc - half, xc + half, depth * (0.45 + 0.55 * f)
        x0 = self.x0 + j * r.uniform(-1, 1); x1 = self.x1 + j * r.uniform(-1, 1)
        if self.corner > 0:
            return w - x1, w - x0 + 50, depth
        if self.corner < 0:
            return -w - 50 + x0, -w + x1, depth
        return x0, x1, depth


def corner_erosion(rng, faces_order, heights, Y, base_fn, walk=0.35, length=(1.2, 2.6), extra=(0.5, 3.0)):
    """Ragged arrises: for every corner a random walk of how far each course is broken back, shared
    (with different lengths) by the two faces that meet there. Returns {course index: [Cut]}."""
    out = {k: [] for k in range(len(heights))}
    for i, f in enumerate(faces_order):
        nf = faces_order[(i + 1) % 4]
        d = 0.0
        for k in range(len(heights)):
            ym = (Y[k] + Y[k + 1]) / 2
            d = max(-0.6, min(3.5, d + rng.gauss(0, walk) - 0.08 * d))
            depth = max(0.0, base_fn(ym) + d + rng.uniform(0, 0.7))
            if depth < 0.15:
                continue
            L1 = depth * rng.uniform(*length) + rng.uniform(*extra)
            L2 = depth * rng.uniform(*length) + rng.uniform(*extra)
            out[k].append(Cut(f, 0.0, L1, -1e9, 1e9, depth, corner=1))
            out[k].append(Cut(nf, 0.0, L2, -1e9, 1e9, depth * rng.uniform(0.7, 1.15), corner=-1))
    return out


class Kit:
    def __init__(self, model, centre=(0.0, 0.0), seed=1):
        self.m = model
        self.cx, self.cs = centre
        self.rng = random.Random(seed)
        a, b = model.spec['across'], model.spec['axis']
        self.a, self.b = a, b
        self.tri_estimate = 0

    # e/y/s -> tool (u, y, v)
    def P(self, e, y, s):
        return (e * self.a[0] + s * self.a[1], y, e * self.b[0] + s * self.b[1])

    def prism(self, label, pts, y0, y1, mat):
        """Vertical extrusion of a simple polygon given in (e, s)."""
        self.m.shell(label, [self.P(e, y0, s) for e, s in pts], (0, y1 - y0, 0), mat)

    def loft(self, label, bottom, top, mat):
        """Closed solid between two polygons with matching vertex order: [(e,y,s)...]."""
        n = len(bottom)
        v = [self.P(*p) for p in bottom] + [self.P(*p) for p in top]
        faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        self.m.mesh(label, v, faces, mat)

    def block(self, label, centre, size, mat, yaw=0.0, jitter=0.0):
        """An oriented box (optionally with jittered corners: a broken block of stone)."""
        e, y, s = centre; a, h, d = size[0] / 2, size[1] / 2, size[2] / 2
        c, sn = math.cos(yaw), math.sin(yaw)
        rng = self.rng
        pts = []
        for dy in (-h, h):
            for de, ds in ((-a, -d), (a, -d), (a, d), (-a, d)):
                je = de + rng.uniform(-jitter, jitter) * a; js = ds + rng.uniform(-jitter, jitter) * d
                jy = dy + (rng.uniform(-jitter, 0) * h if dy > 0 else 0)
                pts.append((e + je * c - js * sn, y + jy, s + je * sn + js * c))
        self.loft(label, pts[:4], pts[4:], mat)

    def beam(self, label, p0, p1, width, depth_dir, depth, mat):
        """A straight beam from p0 to p1 (e,y,s) with a rectangular section: width in the plane
        perpendicular to depth_dir, extruded `depth` along depth_dir (unit (e,s))."""
        ax = [p1[i] - p0[i] for i in range(3)]; L = math.sqrt(sum(c * c for c in ax)); ax = [c / L for c in ax]
        dd = (depth_dir[0], 0.0, depth_dir[1])
        wv = [ax[1] * dd[2] - ax[2] * dd[1], ax[2] * dd[0] - ax[0] * dd[2], ax[0] * dd[1] - ax[1] * dd[0]]
        wl = math.sqrt(sum(c * c for c in wv)); wv = [c / wl * width / 2 for c in wv]
        def q(p, sw, dp):
            return tuple(p[i] + sw * wv[i] + dp * dd[i] * depth for i in range(3))
        bottom = [q(p0, -1, 0), q(p0, 1, 0), q(p0, 1, 1), q(p0, -1, 1)]
        top = [q(p1, -1, 0), q(p1, 1, 0), q(p1, 1, 1), q(p1, -1, 1)]
        self.loft(label, bottom, top, mat)

    def tube(self, label, pts, r, mat, sides=6):
        self.m.tube(label, [self.P(*p) for p in pts], r, mat, sides)

    # ------------------------------------------------------------------ face geometry helpers
    def fpt(self, face, w, x, o):
        """Point on the outline of face `face` of a course with nominal half-width w: x along the
        face, o inward from the face plane."""
        (ne, ns), (te, ts) = FACES[face]
        return (self.cx + ne * (w - o) + te * x, self.cs + ns * (w - o) + ts * x)

    # ------------------------------------------------------------------ one core course
    def course(self, label, y0, y1, w, faces, mat):
        """faces[f] = list of (x_start, x_end, offset) segments before corner clipping, ordered."""
        segs = {f: [list(s) for s in faces[f]] for f in ORDER}
        for _ in range(6):
            changed = False
            for i, f in enumerate(ORDER):
                prev, nxt = ORDER[i - 1], ORDER[(i + 1) % 4]
                x_start = -(w - segs[prev][-1][2]); x_end = w - segs[nxt][0][2]
                sl = segs[f]
                while len(sl) > 1 and sl[0][1] <= x_start + 0.2:
                    sl.pop(0); changed = True
                while len(sl) > 1 and sl[-1][0] >= x_end - 0.2:
                    sl.pop(); changed = True
                sl[0][0] = x_start; sl[-1][1] = x_end
            if not changed:
                break
        pts = []
        for f in ORDER:
            for x0, x1, o in segs[f]:
                if x1 - x0 < 1e-3:
                    continue
                pts.append(self.fpt(f, w, x0, o)); pts.append(self.fpt(f, w, x1, o))
        clean = []
        for p in pts:
            if not clean or abs(p[0] - clean[-1][0]) + abs(p[1] - clean[-1][1]) > 2e-3:
                clean.append(p)
        while len(clean) > 3 and abs(clean[0][0] - clean[-1][0]) + abs(clean[0][1] - clean[-1][1]) <= 2e-3:
            clean.pop()
        # drop collinear middle points (same offset runs) to save triangles
        out = []
        n = len(clean)
        for i in range(n):
            a, b, c = clean[i - 1], clean[i], clean[(i + 1) % n]
            cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if abs(cross) > 1e-6:
                out.append(b)
        self.prism(label, out, y0, y1, mat)
        self.tri_estimate += 4 * len(out)

    # ------------------------------------------------------------------ sloped casing run on one face
    def casing_run(self, label, face, y0, y1, w_env, tan, x0, x1, mat, blocks=None, full_start=True, full_end=True,
                   back=1.0):
        """Casing blocks between x0 and x1 on one face of the course y0..y1, outer face on the pyramid
        slope (w_env = envelope half-width at y0). `blocks` = [(xa, xb, jitter_out)] for rough faces.
        At a corner (x0 = -w_env / x1 = +w_env) the run either takes the full corner or starts behind
        the neighbour's casing."""
        h = y1 - y0; run_in = h / tan; depth = run_in + back
        blocks = blocks or [(x0, x1, 0.0)]
        def xt(x, top):
            # at a corner end, the top end sits on the neighbour's (sloped) plane
            if x >= w_env - 1e-6:
                return x - (run_in if top else 0.0)
            if x <= -w_env + 1e-6:
                return x + (run_in if top else 0.0)
            return x
        if x0 <= -w_env + 1e-6 and not full_start:
            x0 = -w_env + depth
        bottom, top = [], []
        outer = []
        for xa, xb, j in blocks:
            xa = max(xa, x0); xb = min(xb, x1)
            if xb - xa < 0.05:
                continue
            outer.append((xa, j)); outer.append((xb, j))
        if not outer:
            return
        outer[0] = (x0, outer[0][1]); outer[-1] = (x1, outer[-1][1])
        for x, j in outer:
            bottom.append((x, j)); top.append((xt(x, True), j + run_in))
        # at a corner the end face lies in the neighbouring face's (sloped) plane
        inner_b = [(x1, depth), (x0, depth)]
        inner_t = [(xt(x1, True), depth), (xt(x0, True), depth)]
        B = [(*self.fpt(face, w_env, x, o),) for x, o in bottom + inner_b]
        T = [(*self.fpt(face, w_env, x, o),) for x, o in top + inner_t]
        # dedupe coincident neighbours consistently in both rings
        keep = [i for i in range(len(B)) if abs(B[i][0] - B[i - 1][0]) + abs(B[i][1] - B[i - 1][1]) > 2e-3
                or abs(T[i][0] - T[i - 1][0]) + abs(T[i][1] - T[i - 1][1]) > 2e-3]
        B = [B[i] for i in keep]; T = [T[i] for i in keep]
        self.loft(label, [(e, y0, s) for e, s in B], [(e, y1, s) for e, s in T], mat)
        self.tri_estimate += 4 * len(B)

    # ------------------------------------------------------------------ segments of one face of one course
    def face_segments(self, face, w, y0, y1, seg_len, jitter, cuts):
        """Block-length segments of one face of one course: (x_start, x_end, inward offset)."""
        rng = self.rng
        ym = (y0 + y1) / 2
        bounds = [-w]
        x = -w
        while True:
            x += rng.uniform(*seg_len)
            if x >= w - 0.3:
                break
            bounds.append(x)
        bounds.append(w)
        spans = []
        for c in cuts:
            if c.face != face:
                continue
            got = c.at(w, ym)
            if got is None or got[1] - got[0] < 0.3:
                continue
            spans.append(got)
            for xb in got[:2]:
                if -w + 0.3 < xb < w - 0.3:
                    bounds.append(xb)
        bounds = sorted(bounds)
        clean = [bounds[0]]
        for xb in bounds[1:]:
            if xb - clean[-1] > 0.25:
                clean.append(xb)
        clean[-1] = w
        segs = []
        for xa, xb in zip(clean, clean[1:]):
            xm = (xa + xb) / 2
            o = rng.uniform(0, jitter)
            d = 0.0
            for a, b, dep in spans:
                if a <= xm <= b:
                    d = max(d, dep)
            segs.append((xa, xb, o + d))
        return segs

    # ------------------------------------------------------------------ an apron from the foot down to the ground
    def apron(self, label, ground, half, base_y, width, mat, step=6.0, slope=1.1, bury=0.6, top_lift=0.05,
              inside=1.5):
        """Pavement/bedrock ring round a square base (half-width `half` at base_y): level top out to
        `width`, then a bank down to the game's ground wherever that is lower (never below y = 0)."""
        ring = []
        for f in ORDER:
            (ne, ns), (te, ts) = FACES[f]
            n = max(2, int(2 * half / step))
            for i in range(n):
                x = -half + 2 * half * i / n
                if i == 0:
                    # corner: mitred direction
                    pe, ps = FACES[ORDER[ORDER.index(f) - 1]][0]
                    ring.append(((self.cx + ne * half + te * x, self.cs + ns * half + ts * x), (ne + pe, ns + ps)))
                else:
                    ring.append(((self.cx + ne * half + te * x, self.cs + ns * half + ts * x), (ne, ns)))
        prof = []
        k_in = max(0.05, (half - inside) / half)
        for (pe, ps), (de, ds) in ring:
            # inner edge pulled radially toward the centre, so neighbouring profiles never cross
            e_in, s_in = self.cx + (pe - self.cx) * k_in, self.cs + (ps - self.cs) * k_in
            e_o, s_o = pe + de * width, ps + ds * width
            g = ground.low(e_o, s_o, 2.5)
            drop = max(0.0, base_y - g)
            e_b, s_b = pe + de * (width + drop * slope), ps + ds * (width + drop * slope)
            gb = ground.low(e_b, s_b, 2.5)
            yb = max(0.0, min(g, gb, base_y) - bury)
            prof.append([(e_in, base_y + top_lift, s_in), (e_o, base_y + top_lift, s_o), (e_b, yb, s_b), (e_in, yb, s_in)])
        n = len(prof)
        verts = [self.P(*p) for pr in prof for p in pr]
        faces = []
        for i in range(n):
            j = (i + 1) % n
            for k in range(4):
                k2 = (k + 1) % 4
                faces.append((i * 4 + k, j * 4 + k, j * 4 + k2, i * 4 + k2))
        self.m.mesh(label, verts, faces, mat)
        self.tri_estimate += 8 * n

    def rubble(self, label, ground, pts, mat, road, clear=2.5, size=(0.5, 2.2), flat=0.6):
        """Broken blocks lying on the ground at the given (e, s) points, kept off the road."""
        rng = self.rng
        for e, s in pts:
            if road_gap(road, e, s) < clear:
                continue
            a = rng.uniform(*size); b = a * rng.uniform(0.5, 1.1); h = a * rng.uniform(0.35, flat)
            g = max(0.0, ground(e, s) - 0.25 * h)
            self.block(label, (e, g + h / 2, s), (a, h, b), mat, yaw=rng.uniform(0, math.pi), jitter=0.28)
            self.tri_estimate += 12


def road_gap(road, e, s):
    best = 1e9
    for re_, rs, hw in road:
        d = math.hypot(re_ - e, rs - s) - hw
        if d < best:
            best = d
    return best


def course_heights(n, total, h0, htop, tau, jumps, rng, noise=0.06):
    hs = []
    for k in range(n):
        h = htop + (h0 - htop) * math.exp(-k / tau)
        for j, amp in jumps:
            if k >= j:
                h *= 1 + amp * math.exp(-(k - j) / 3.0)
        hs.append(h * (1 + rng.uniform(-noise, noise)))
    s = sum(hs)
    return [h * total / s for h in hs]


def base_level(ground, cx, cs, half, step=4.0):
    """Median finished ground along a square base's outline: where its level base sits."""
    g = []
    for f in ORDER:
        (ne, ns), (te, ts) = FACES[f]
        n = max(2, int(2 * half / step))
        for i in range(n):
            x = -half + 2 * half * i / n
            g.append(ground(cx + ne * half + te * x, cs + ns * half + ts * x))
    g.sort()
    return g[len(g) // 2]


def datum_marker(kit, plan, mat):
    """A flat stone lying exactly on the lowest ground of the footprint outline, so the model's lowest
    vertex is that ground (the game puts the lowest vertex on it)."""
    e, s = plan['low']
    kit.m.box('datum stone', kit.P(e, 0.12, s), (0.9, 0.24, 0.7), mat)


def stepped_core(kit, label, B, Y, width_of, cuts, corner_cuts, seg_of, jitter_of, mat, skip=None):
    """The exposed stepped core: one closed prism per course (see the module docstring).
    width_of(k) = nominal half-width of course k's riser; cuts are in heights over the base B."""
    shifted = [c.shifted(B) for c in cuts]
    by_course = {}
    for k in range(len(Y) - 1):
        if skip and skip(k):
            continue
        y0, y1 = Y[k], Y[k + 1]
        ym = (y0 + y1) / 2
        w = width_of(k)
        active = [c for c in shifted if c.y0 <= B + ym < c.y1] + corner_cuts.get(k, [])
        faces = {f: kit.face_segments(f, w, B + y0, B + y1, seg_of(f, ym, w), jitter_of(f, ym), active) for f in ORDER}
        kit.course(f'{label} {k}', B + y0, B + y1, w, faces, mat)
        by_course[k] = w
    return by_course


def small_holes(rng, n_per_face, width_of_y, y_max, faces=ORDER, depth=(0.5, 1.3), size=(1.2, 3.2), tall=(0.6, 2.4)):
    """Single missing blocks and small clusters: the pock-marked look of the exposed core."""
    cuts = []
    for f in faces:
        for _ in range(n_per_face):
            y0 = rng.uniform(0, y_max) ** 1.0; hh = rng.uniform(*tall)
            w = width_of_y(y0)
            if w < 3:
                continue
            ww = rng.uniform(*size); x0 = rng.uniform(-w + 1, w - 1 - ww)
            cuts.append(Cut(f, x0, x0 + ww, y0, y0 + hh, rng.uniform(*depth), jag=0.3))
    return cuts


def scars(rng, n_per_face, width_of_y, y_max, faces=ORDER, depth=(0.8, 2.4), size=(3.0, 14.0), tall=(2.0, 9.0)):
    """Bigger irregular scars where blocks were robbed in patches."""
    cuts = []
    for f in faces:
        for _ in range(n_per_face):
            y0 = rng.uniform(0, y_max); hh = rng.uniform(*tall)
            w = width_of_y(y0)
            if w < 6:
                continue
            ww = rng.uniform(*size); x0 = rng.uniform(-w + 2, w - 2 - ww)
            cuts.append(Cut(f, x0, x0 + ww, y0, y0 + hh, rng.uniform(*depth), jag=0.6, blob=True))
    return cuts


def base_points(rng, cx, cs, half, n, spread=(-0.5, 7.0), corner_bias=0.4, corner_len=14.0, faces=ORDER):
    pts = []
    for f in faces:
        (ne, ns), (te, ts) = FACES[f]
        for _ in range(n):
            x = rng.uniform(-half - 3, half + 3)
            if rng.random() < corner_bias:
                x = math.copysign(half - rng.uniform(0, corner_len), rng.uniform(-1, 1))
            o = rng.uniform(*spread)
            pts.append((cx + ne * (half + o) + te * x, cs + ns * (half + o) + ts * x))
    return pts


# ============================================================== Khufu
KHUFU = dict(half=230.33 / 2, tan=math.tan(math.radians(51 + 50 / 60 + 40 / 3600)), height=138.5, courses=203)


def build_khufu():
    sys.path.insert(0, str(HERE))
    from build_landmark_tools import Model
    ident = 'pyramid-of-khufu'
    plan = run_plan(ident, 170.0, 4.0, [])
    ground = Ground(plan)
    model = Model(ident)
    kit = Kit(model, (0.0, 0.0), seed=4420397)
    rng = kit.rng
    road = plan['road']
    model.material('limestone', (0.50, 0.37, 0.215), 0.0, 0.93, ident + '_limestone')
    model.material('casing', (0.70, 0.61, 0.46), 0.0, 0.7, ident + '_casing')
    model.material('pavement', (0.55, 0.45, 0.31), 0.0, 0.95, ident + '_pavement_stone')
    model.material('rubble', (0.44, 0.33, 0.20), 0.0, 0.95, ident + '_rubble_stone')
    model.material('basalt', (0.09, 0.085, 0.08), 0.0, 0.8, ident + '_basalt_stone')
    model.material('steel', (0.30, 0.30, 0.31), 0.6, 0.5, ident + '_steel')
    b, tan, H = KHUFU['half'], KHUFU['tan'], KHUFU['height']
    B = base_level(ground, 0.0, 0.0, b)
    inset = 1.1                                     # casing thickness in front of the core steps
    hs = course_heights(KHUFU['courses'], H, 1.72, 0.55, 32.0,
                        [(19, 0.35), (35, 0.9), (44, 0.6), (67, 0.5), (90, 0.45), (98, 0.35), (118, 0.3), (144, 0.25)], rng)
    Y = [0.0]
    for h in hs:
        Y.append(Y[-1] + h)
    print(f'khufu base level {B:.2f} m over datum, {len(hs)} courses, first {hs[0]:.2f} m, top {hs[-1]:.2f} m', flush=True)
    core_w = lambda y: b - inset - y / tan

    cuts = []
    # Robbers' Tunnel: forced into courses 6-7, ~7 m up, near the centre line; a ragged mouth
    cuts += [Cut('N', -2.4, 1.0, 5.6, 8.9, 8.0), Cut('N', -3.6, 2.2, 4.6, 10.4, 1.4, jag=0.5),
             Cut('N', -5.0, 3.4, 3.8, 12.0, 0.6, jag=0.7)]
    # original entrance, 19th course (~17 m), 7.86 m east of centre, under the chevron recess
    ex = 7.86
    cuts += [Cut('N', ex - 0.53, ex + 0.53, 16.6, 17.9, 6.0),            # passage mouth 1.05 x 1.2
             Cut('N', ex - 3.4, ex + 3.4, 16.2, 24.8, 2.4),               # recess the chevrons stand in
             Cut('N', ex - 4.8, ex + 4.8, 15.4, 26.8, 0.9, jag=0.6)]
    # the great cleft low in the middle of the south face (photo: from the foot to about a fifth up)
    cuts += [Cut('S', -5.0, 4.0, 0.0, 30.0, 2.6, jag=0.8, blob=True), Cut('S', -2.6, 2.2, 1.0, 22.0, 4.8, jag=0.5, blob=True)]
    cuts += scars(rng, 14, core_w, 125.0)
    cuts += small_holes(rng, 210, core_w, 132.0)
    cuts += small_holes(rng, 110, core_w, 40.0, faces=('W', 'N'))
    corner = corner_erosion(rng, ORDER, hs, Y, lambda y: 0.3 + 3.6 * math.exp(-y / 34.0), walk=0.45)

    def seg_of(f, y, w):
        if w < 20:
            return (1.6, 3.2)
        if f in ('W', 'N') and y < 36:
            return (1.5, 3.0)
        return (2.6, 5.2) if y < 36 else (3.6, 7.2)
    jitter_of = lambda f, y: 0.32 if y < 60 else 0.26
    stepped_core(kit, 'course', B, Y, lambda k: core_w(Y[k + 1]), cuts, corner, seg_of, jitter_of, 'limestone')

    # casing blocks still in situ in the lowest course: best on the north below the entrances
    y0, y1 = B + Y[0], B + Y[1]
    for face, runs in (('N', [(-17.0, 13.0)]), ('E', [(-40.0, -33.0), (21.0, 26.5)]),
                       ('S', [(8.0, 14.0), (-52.0, -46.0)]), ('W', [(-6.0, 1.5), (61.0, 65.0)])):
        for xa, xb in runs:
            blocks = []
            x = xa
            while x < xb:
                xn = min(xb, x + rng.uniform(1.2, 2.2)); blocks.append((x, xn, rng.uniform(0.0, 0.05))); x = xn
            kit.casing_run(f'casing {face}', face, y0, y1, b, tan, xa, xb, 'casing', blocks, back=inset + 0.6)

    # chevron blocks over the original entrance: two rows of paired limestone beams leaning together
    def s_recess(y):          # 0.9 m in front of the stepped back of the recess, north face
        return -(b - inset - (y - B) / tan) + 1.5
    for yb, span, rise, width in ((B + 18.2, 2.8, 2.4, 1.2), (B + 20.8, 3.2, 2.9, 1.4)):
        for side in (-1, 1):
            p0 = (ex + side * span, yb, s_recess(yb)); p1 = (ex + side * 0.1, yb + rise, s_recess(yb + rise))
            kit.beam('chevron', p0, p1, width, (0, 1), 2.6, 'limestone')
    # stone steps up the rubble to the Robbers' Tunnel (the tourist way in)
    w0 = b - inset
    for i in range(8):
        top_y = 0.7 * (i + 1)
        s0 = -(w0 + 3.0) + i * 1.15                       # front edge of this step
        s1 = -(w0 - top_y / tan) + 1.5                    # runs back into the masonry
        gy = min(B, ground.low(-0.7, s0, 2.0))
        kit.prism('tunnel steps', [(-2.5, s0), (1.1, s0), (1.1, s1), (-2.5, s1)], max(0.0, gy - 0.4), B + top_y, 'pavement')
    # summit: loose blocks on the platform and Gill's 1874 survey mast marking the original apex
    wt = core_w(H)
    for i in range(7):
        e = rng.uniform(-wt + 1, wt - 1); s = rng.uniform(-wt + 1, wt - 1)
        kit.block('summit block', (e, B + H + 0.35, s), (rng.uniform(0.8, 1.6), 0.7, rng.uniform(0.7, 1.3)), 'limestone',
                  yaw=rng.uniform(0, 0.4), jitter=0.2)
    top = B + H + 0.05; apex = B + 146.6
    kit.tube('survey mast', [(0.0, top, 0.0), (0.0, apex, 0.0)], 0.14, 'steel', 6)
    for ang in (0.3, 2.4, 4.5):
        kit.tube('mast strut', [(1.8 * math.cos(ang), top, 1.8 * math.sin(ang)), (0.0, top + 3.6, 0.0)], 0.07, 'steel', 5)

    # pavement platform round the base and the bank down to the plateau where the ground is lower
    kit.apron('base platform', ground, b + 0.2, B, 6.5, 'pavement', inside=10.0)
    # the black basalt floor of the vanished mortuary temple against the east face
    e0 = b + 6.5
    g = min(ground.low(e0 + 20, 0, 20), B)
    kit.prism('basalt floor', [(e0, -26.0), (e0 + 40.0, -26.0), (e0 + 40.0, 26.0), (e0, 26.0)], max(0.0, g - 0.8), g + 0.35, 'basalt')
    # broken blocks along the foot, thickest under the damaged corners
    kit.rubble('rubble', ground, base_points(rng, 0.0, 0.0, b, 170), 'rubble', road, clear=3.0, size=(0.5, 2.0))
    datum_marker(kit, plan, 'pavement')
    print('triangle estimate', kit.tri_estimate, flush=True)
    return model.finish(directory=SCRATCH / ident)


if __name__ == '__main__':
    build_khufu()
