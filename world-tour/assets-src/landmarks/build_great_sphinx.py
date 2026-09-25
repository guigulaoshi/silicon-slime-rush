"""Great Sphinx of Giza, its sunken enclosure, the Sphinx Temple and the Valley Temple of Khafre.

Sources (marked per number below):
  [W]   Wikipedia "Great Sphinx of Giza": 73 m long, 20 m high, 19 m across the haunches, faces east;
        face 4.1 m wide.
  [OSM] way 540058405 / relation 7728526 (building=sphinx): the base outline in the model frame runs
        from the rump at x=-34.4 to the paw tips at x=+40.8; haunches +-9.5 m, mid body +-5.5 m, shoulders
        +-8.9 m, two paws 5.1 / 5.6 m wide with a 5.2 m gap, and the head outline x 10.5..20.3, +-4.2 m.
        Sphinx Temple = way 297954353 + 297960344, Valley Temple = relation 7393266 (wall outlines).
  [PLAN] Commons "Kahfre valley sphinx.svg" (plan of the Sphinx ditch and both temples): west ditch ~5 m
        behind the rump, north wall ~22 m from the centre line, south edge 12 m at the rump widening to
        ~31 m at the paws along the causeway, paws end ~6 m short of the Sphinx Temple.
  [PH]  photo estimates (Commons "Side photo of Sphinx", "Great Sphinx of Giza 2022" (side, 11 px/m),
        "Profile Sphinx" (head profile), "Great Sphinx of Giza May 2015" (front quarter)): back 11-12.9 m,
        chin 14.2 m, nemes wing bottom 14.8 m, face 5 m from headband to chin, lips 2.8-3 m in front of
        the wing's front edge, paws ~2.6-3.4 m high cased in small-block masonry, lower 3 m of the body
        cased, body cut in horizontal hard/soft erosion bands, neck eroded thin.
  [DEM] enclosure rim heights: the elevation data around the ditch, relative to the lowest ground under
        the footprint (the model's floor), clamped to 3..8.5 m.
Model frame: x east, z south, metres, origin = footprint centroid (the Model's anchor), y up, floor y=0.
Run: Blender --background --python assets-src/landmarks/build_great_sphinx.py
"""
import json
import tempfile
import math
import os
import random
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model, ROOT

ID = 'great-sphinx'
m = Model(ID)
AC, AX = m.spec['across'], m.spec['axis']
m.material('carved', (0.78, 0.63, 0.44), 0.0, 0.92, ID + '_carved')          # bedrock sculpture
m.material('limestone', (0.84, 0.74, 0.57), 0.0, 0.88, ID + '_limestone')    # masonry, rock walls
m.material('granite', (0.56, 0.37, 0.32), 0.0, 0.6, ID + '_granite')         # Aswan granite
rng = random.Random(1926)


def P(x, y, z):
    """Model frame (x east, y up, z south) -> the Model's (u across, y, v along)."""
    return (x * AC[0] + z * AC[1], y, x * AX[0] + z * AX[1])


def add(label, verts, faces, mat, smooth=False):
    m.mesh(label, [P(*p) for p in verts], faces, mat, smooth)


def loft(label, rings, mat, smooth=False):
    """Closed solid through equal-length rings, capped with a fan at each end."""
    n = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    for k in range(len(rings) - 1):
        for i in range(n):
            a, b = k * n + i, k * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    for ring, base, flip in ((rings[0], 0, True), (rings[-1], (len(rings) - 1) * n, False)):
        c = len(verts)
        verts.append(tuple(sum(p[k] for p in ring) / n for k in range(3)))
        for i in range(n):
            f = (c, base + i, base + (i + 1) % n)
            faces.append(f[::-1] if flip else f)
    add(label, verts, faces, mat, smooth)


def prism(label, poly, y0, y1, mat):
    """Vertical extrusion of a simple polygon [(x, z)]."""
    n = len(poly)
    verts = [(x, y0, z) for x, z in poly] + [(x, y1, z) for x, z in poly]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + \
            [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    add(label, verts, faces, mat)


def resample(poly, n):
    """n points evenly by arc length round a closed polygon, starting at poly[0]."""
    pts = np.asarray(poly + [poly[0]], float)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, cum[-1], n, endpoint=False)
    return np.c_[np.interp(t, cum, pts[:, 0]), np.interp(t, cum, pts[:, 1])]


def ki(keys, x):
    k = np.asarray(keys, float)
    return float(np.interp(x, k[:, 0], k[:, 1]))


# ---------------------------------------------------------------- erosion bands [PH]
# Member II of the plateau: alternating hard ledges and soft recessed layers, 0.5-1.4 m thick.
LAYERS = []
yy = 0.0
soft = False
while yy < 22:
    t = rng.uniform(0.5, 1.4)
    LAYERS.append((yy, yy + t, soft, rng.uniform(0.25, 0.55)))
    yy += t
    soft = not soft


def band(y):
    for a, b, s, d in LAYERS:
        if a <= y < b:
            return d * math.sin(math.pi * (y - a) / (b - a)) ** 0.35 if s else 0.0
    return 0.0


# ---------------------------------------------------------------- ground [DEM]
dem_code = '''
import json, sys, numpy as np
from sr.dem import DemSampler
from sr.geo import LocalFrame
e = next(e for e in json.load(open('landmarks.json'))['landmarks'] if e['id'] == sys.argv[1])
lat, lon = float(sys.argv[2]), float(sys.argv[3])
d = DemSampler(); ring = np.asarray(e['footprint'])
base = float(d.heights(ring[:, 0], ring[:, 1]).min())
f = LocalFrame(lat, lon)
xs = np.arange(-70, 111, 2.0); zs = np.arange(-60, 101, 2.0)
X, Z = np.meshgrid(xs, zs, indexing='ij')
la, lo = f.to_latlon(X.ravel(), Z.ravel())
print(json.dumps(dict(base=base, xs=xs.tolist(), zs=zs.tolist(), h=(d.heights(la, lo).reshape(X.shape) - base).tolist())))
'''
DEM = json.loads(subprocess.check_output(
    [str(ROOT / 'pipeline/.venv/bin/python'), '-c', dem_code, ID, *map(str, m.spec['centre'])],
    cwd=ROOT / 'pipeline', env={**os.environ, 'PYTHONPATH': str(ROOT / 'pipeline')}, text=True))
DX, DZ, DH = np.asarray(DEM['xs']), np.asarray(DEM['zs']), np.asarray(DEM['h'])


def ground(x, z):
    i = np.clip((x - DX[0]) / 2.0, 0, len(DX) - 1.001); j = np.clip((z - DZ[0]) / 2.0, 0, len(DZ) - 1.001)
    i0, j0 = int(i), int(j); fi, fj = i - i0, j - j0
    return float(DH[i0, j0] * (1 - fi) * (1 - fj) + DH[i0 + 1, j0] * fi * (1 - fj) +
                 DH[i0, j0 + 1] * (1 - fi) * fj + DH[i0 + 1, j0 + 1] * fi * fj)


# ---------------------------------------------------------------- lion body [OSM][PH][W]
# Back line: rump rounds down at x=-30, back 11-11.4 m, shoulders behind the neck ~11.5 m so 3.5 m of
# eroded neck shows under the nemes wings [PH: 2022 side photo, back/head-top = 0.57]; chest front 22.3 m.
H_KEYS = [(-34.4, 2.0), (-33.2, 3.4), (-32.0, 4.1), (-30.8, 4.6), (-30.1, 5.6), (-29.5, 7.3),
          (-28.7, 8.9), (-27.6, 10.0), (-26.0, 10.7), (-20, 11.0), (-10, 11.2), (0, 11.3), (8, 11.4),
          (12, 11.6), (16, 11.6), (19, 11.3), (21.0, 10.9), (22.3, 10.4)]
WT_KEYS = [(-34.4, 0.8), (-33, 2.0), (-31, 3.5), (-30, 5.0), (-28, 5.8), (-20, 6.0), (-8, 5.8), (0, 5.5),
           (8, 5.6), (12, 6.2), (16, 7.0), (19, 7.5), (22.3, 7.4)]
# Base half-width from the OSM outline: rump semicircle, haunches, hind paws end at -6.5, shoulders from 14.6.
WH_KEYS = [(-34.4, 1.2), (-34.0, 2.6), (-32.4, 5.0), (-29.9, 7.6), (-27.5, 9.0), (-25.9, 9.5), (-8.5, 9.5),
           (-7.2, 9.1), (-6.8, 6.3), (-6.5, 5.8), (0, 5.5), (8, 5.6), (12.0, 6.2), (13.4, 6.8), (14.3, 7.8),
           (14.6, 8.9), (22.3, 8.6)]
# hind legs lie low on the ground: the haunch lump is ~2-3 m high in the side photos [PH]
HH_KEYS = [(-34.4, 0.8), (-32, 2.6), (-30, 2.9), (-26, 3.2), (-21, 3.4), (-15, 3.0), (-10, 2.6), (-7.5, 2.2),
           (-6.5, 2.0), (12.0, 2.0), (14.3, 3.4), (15.0, 5.2), (22.3, 5.5)]
NOISE = [(rng.uniform(0.25, 1.5), rng.uniform(0, 6.3)) for _ in range(6)]


def back_noise(x):
    return 0.2 * sum(math.sin(x * f + p) for f, p in NOISE) / 3      # eroded, uneven back line


def section(x):
    """Right-hand profile (s lateral, y) from the bottom centre to the top centre, with a fixed number
    of points per part so neighbouring stations line up (haunch step collapses where there is none)."""
    Wt, Wh, Hh = ki(WT_KEYS, x), ki(WH_KEYS, x), ki(HH_KEYS, x)
    H = max(ki(H_KEYS, x) + back_noise(x) * (x > -28), Hh + 1.2)
    Wh = max(Wh, Wt)
    k = min(1.0, (Wh - Wt) / 1.0)
    r = max(0.05, min(1.2, Hh * 0.35) * k)
    pr = [(0.0, 0.0)] + [((Wh - 0.3) * i / 4, 0.0) for i in range(1, 5)]
    pr += [(Wh + 0.05 * math.sin(math.pi * i / 15), 0.3 + (Hh - r - 0.3) * i / 15) for i in range(16)]
    pr += [(Wh - r + r * math.cos(a), Hh - r + r * math.sin(a)) for a in np.linspace(0.3, math.pi / 2, 4)]
    pr += [(Wt + 0.4 * k, Hh + 0.35), (Wt, Hh + 1.0)]
    R = min(2.4, Wt * 0.45)
    y0, y1 = Hh + 1.0, H - R
    for i in range(1, 41):
        y = y0 + (y1 - y0) * i / 40
        pr.append((Wt + 0.15 * math.sin(math.pi * i / 40), y))
    pr += [(Wt - R + R * math.cos(a), H - R + R * math.sin(a)) for a in np.linspace(0.2, math.pi / 2 - 0.1, 7)]
    pr.append((0.0, H))
    return pr, H, Hh


def full_ring(pr):
    return pr + [(-s, y) for s, y in reversed(pr[1:-1])]


CHEST0, CHEST1 = 19.6, 22.0
body_rings = []
xs_body = np.concatenate([np.linspace(-34.4, -29.0, 16), np.arange(-28.6, CHEST0, 0.45), np.linspace(CHEST0, CHEST1, 12)])
for x in xs_body:
    pr, H, Hh = section(x)
    out = []
    lo = Hh + 1.1
    f = 1.0
    if x > CHEST0:                                     # chest front: flat, rounded at the corners in plan
        f = (1 - (0.8 * (x - CHEST0) / (CHEST1 - CHEST0)) ** 4) ** 0.25
    front = 0.0
    for s, y in full_ring(pr):
        xx = x
        if lo < y < H - 0.9:
            b = band(y)
            s -= math.copysign(b * (1 - front), s) if abs(s) > 0.8 else 0.0   # erosion bands, flanks
            xx -= b * front ** 2 * 1.1                                         # and across the chest
        out.append((xx, y, s * f))
    body_rings.append(out)
loft('lion body', body_rings, 'carved', smooth=True)

# chest front: the hard layers stand out as eroded, uneven ledges straight across the chest [PH]
for a, b, soft_, d in LAYERS:
    if not soft_ and 5.6 < a and b < 10.2 and b - a > 0.45:
        w = ki(WT_KEYS, CHEST1) * 0.86
        zs_ = np.linspace(-w, w, 25)
        ph = rng.uniform(0, 6.3)
        front = [(CHEST1 + d * (0.55 + 0.3 * math.sin(z * 1.3 + ph) + 0.15 * math.sin(z * 3.7 + 2 * ph)), z) for z in zs_]
        front[0] = (CHEST1 - 0.2, -w); front[-1] = (CHEST1 - 0.2, w)
        prism('chest ledge', [(CHEST1 - 0.4, w)] + [(CHEST1 - 0.4, -w)] + front, a + 0.05, b - 0.05, 'carved')


# restoration casing: small-block masonry round the lower 3.3 m of the body, in 0.55 m courses [PH]
def width_at(pr, y):
    ys = [p[1] for p in pr[4:-1]]; ss = [p[0] for p in pr[4:-1]]
    return float(np.interp(y, ys, ss))


COURSE = 0.55
casing_rings = []
for x in np.concatenate([np.linspace(-34.3, -29.0, 12), np.arange(-28.6, 21.6, 0.5)]):
    pr, H, Hh = section(x)
    # masonry reaches ~5 m up the middle of the flanks, less at the rump and chest [PH panorama from the south]
    Hc = min(ki([(-34, 2.4), (-28, 3.4), (-20, 4.8), (0, 5.0), (12, 4.2), (22, 3.0)], x), H - 0.25)
    nc = 9                                           # fixed count keeps the rings aligned
    side = []
    for c in range(nc):
        y0, y1 = min(Hc, COURSE * c), min(Hc, COURSE * (c + 1))   # level courses; spare ones fold flat at the top
        o = 0.28 if c % 2 == 0 else 0.22
        o -= 0.05 * (((int((x + 40) / 1.2) + c) % 3) == 0)   # staggered block faces
        ya = min(y0 + 0.05, Hc); yb = max(ya, min(y1 - 0.05, Hc))
        side += [(width_at(pr, ya) + o, ya), (width_at(pr, yb) + o, yb), (width_at(pr, y1) + o - 0.08, y1)]
    right = [(0.0, 0.0), (width_at(pr, 0.0) + 0.2, 0.0)] + side + [(0.0, Hc)]
    ring = right + [(-s, y) for s, y in reversed(right[1:-1])]
    casing_rings.append([(x, y, s) for s, y in ring])
loft('restoration casing', casing_rings, 'limestone')

# tail curling round the right (south) haunch on the ground [PH]
tail = [(-33.6, 0.45, 3.2), (-33.4, 0.5, 5.2), (-32.2, 0.55, 7.3), (-30.2, 0.55, 8.9), (-27.5, 0.55, 9.85),
        (-24, 0.5, 10.05), (-20.5, 0.5, 10.0), (-18.5, 0.6, 9.75)]
m.tube('tail', [P(*p) for p in tail], 0.5, 'carved', sides=10)


# ---------------------------------------------------------------- forepaws [OSM][PH]
def paw_ring(x, cz, w, h):
    r = min(0.9, h * 0.35, w * 0.4)
    side = []
    nc = 5
    top = h - r
    for c in range(nc):
        y0, y1 = top * c / nc, top * (c + 1) / nc
        side += [(w, y0 + 0.04), (w, y1 - 0.04), (w - 0.06, y1)]
    arc = [(w - r + r * math.cos(a), top + r * math.sin(a)) for a in np.linspace(0.2, math.pi / 2 - 0.15, 6)]
    right = [(0.0, 0.0), (w - 0.1, 0.0)] + side + arc + [(0.0, h)]
    ring = right + [(-s, y) for s, y in reversed(right[1:-1])]
    return [(x, y, cz + s) for s, y in ring]


for label, (c0, w0, c1, w1) in {'north paw': (-5.15, 2.55, -4.8, 2.2), 'south paw': (5.4, 2.8, 5.35, 2.5)}.items():
    rings = []
    for x in np.concatenate([np.arange(19.4, 38.0, 0.45), np.linspace(38.0, 40.75, 10)]):
        t = (x - 22) / 17
        cz, w = c0 + (c1 - c0) * t, w0 + (w1 - w0) * max(0, t)
        h = ki([(19.4, 3.6), (22, 3.2), (30, 2.8), (38, 2.6)], x)
        if x > 38.0:                                     # loaf-shaped rounded paw end
            e = math.sqrt(max(0.02, 1 - ((x - 38.0) / 2.8) ** 2))
            w *= max(0.25, e); h *= max(0.35, e ** 0.5)
        rings.append(paw_ring(x, cz, w, h))
    loft(label, rings, 'limestone')
    # four toes on each paw front, low rounded bumps
    for k in range(4):
        tz = cz + (k - 1.5) * w1 * 0.45
        m.tube('toe', [P(39.4, 0.45, tz), P(40.25, 0.42, tz), P(40.55, 0.35, tz)], 0.36, 'limestone', sides=8)

# Dream Stele of Thutmose IV between the paws against the chest: 3.6 m granite slab, round top [W]
st = [(-1.1, 0.0), (1.1, 0.0), (1.1, 2.9)] + [(1.1 * math.cos(a), 2.9 + 0.7 * math.sin(a))
                                                 for a in np.linspace(0.15, math.pi - 0.15, 9)] + [(-1.1, 2.9)]
loft('dream stele', [[(x, y, s) for s, y in st] for x in (21.55, 22.25)], 'granite')
prism('altar', [(25.4, -0.7), (26.6, -0.7), (26.6, 0.7), (25.4, 0.7)], 0.0, 1.0, 'limestone')
# low walls closing the chapel between the paws at its east end [PH]
prism('chapel wall', [(31.0, -2.6), (31.8, -2.6), (31.8, -0.9), (31.0, -0.9)], 0.0, 1.3, 'limestone')
prism('chapel wall', [(31.0, 0.9), (31.8, 0.9), (31.8, 2.7), (31.0, 2.7)], 0.0, 1.3, 'limestone')


# ---------------------------------------------------------------- head, nemes, neck [PH][W][OSM]
# face profile: forehead sloping back 1.2 m behind the lips, jutting mouth and chin [PH profile photo]
XF_KEYS = [(13.6, 18.2), (14.0, 19.2), (14.3, 19.7), (14.7, 20.0), (15.1, 20.2), (15.45, 20.3), (15.8, 20.15),
           (16.1, 19.95), (16.8, 19.8), (17.4, 19.75), (17.8, 19.75), (18.3, 19.6), (18.8, 19.4), (19.2, 19.15),
           (19.4, 19.05),
           (19.6, 18.75), (19.8, 18.1), (19.95, 17.3), (20.05, 16.4)]
WF_KEYS = [(13.6, 0.9), (14.0, 1.25), (14.4, 1.5), (15.0, 1.75), (15.8, 1.95), (16.6, 2.05), (17.6, 2.05),
           (18.4, 2.0), (19.0, 1.95), (19.4, 1.9)]
N_KEYS = [(14.8, 4.3), (16.0, 4.3), (17.5, 4.2), (18.5, 4.0), (19.2, 3.6), (19.6, 3.0), (19.85, 2.2), (20.05, 1.0)]
XB_KEYS = [(10.5, 10.1), (12.0, 10.6), (14.8, 10.8), (16.0, 10.8), (17.0, 10.95), (17.8, 11.3), (18.5, 11.8),
           (19.1, 12.5), (19.55, 13.3), (19.85, 14.2), (20.05, 15.4)]   # big rounded back of the nemes [PH profile]
XW = 17.3     # front edge of the nemes wings, 2.8-3 m behind the lips [PH]
WING_BOTTOM = 14.8


def head_plan(y):
    """Closed plan polygon (x, z) of the head/neck at height y (right half mirrored)."""
    xb = ki(XB_KEYS, y)
    right = []
    if y >= WING_BOTTOM:
        xf, N = ki(XF_KEYS, y), ki(N_KEYS, y)
        if y <= 19.4:
            wf = ki(WF_KEYS, y)
            right += [(xf - 1.1 * (k / 8) ** 2.2, wf * k / 8) for k in range(9)]
            right += [(XW + 0.05, wf), (XW, wf + 0.05)]
            right += [(XW, N - 0.3), (XW - 0.3, N)]
        else:                                            # top of the nemes rolling back
            right += [(xf - 0.8 * (k / 6) ** 2, N * 0.8 * k / 6) for k in range(7)]
            right += [(min(XW, xf - 1.0), N)]
        right += [(xb + 1.8, N), (xb + 0.6, N * 0.82), (xb + 0.1, N * 0.5)]
    else:
        nw = ki([(10.5, 5.2), (11.5, 4.2), (12.5, 3.4), (13.5, 3.1), (14.8, 3.1)], y)
        xt = ki([(10.5, 20.4), (11.5, 19.1), (12.5, 18.1), (13.6, 17.4)], y)   # throat sloping into the chest
        if y >= 13.6:                                    # jaw and chin in front of the neck
            xf, wf = ki(XF_KEYS, y), ki(WF_KEYS, y)
            right += [(xf - 1.0 * (k / 6) ** 2, wf * k / 6) for k in range(7)]
            right += [(max(xt, 18.1), wf)]
        else:
            right += [(xt, 0.0), (xt - 0.15, 1.0), (xt - 0.35, 1.9)]
        if y >= 11.3:                                    # front lappets of the nemes on the chest
            lf = max(xt + 0.3, 18.5)
            right += [(lf - 0.1, 2.2), (lf, 2.6), (lf - 0.1, 3.3), (lf - 1.1, 3.45)]
        right += [(min(16.8, xt - 1.0), nw), (xb + 1.5, nw), (xb + 0.4, nw * 0.8), (xb, nw * 0.4)]
    right.append((xb, 0.0))
    right = right if right[0][1] == 0.0 else [(right[0][0], 0.0)] + right
    return right + [(x, -z) for x, z in reversed(right[1:-1])]


def ray(poly, c, ang):
    d = (math.cos(ang), math.sin(ang)); best = 0.0
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        ex, ez = x2 - x1, z2 - z1
        den = d[0] * ez - d[1] * ex
        if abs(den) < 1e-12:
            continue
        t = ((x1 - c[0]) * ez - (z1 - c[1]) * ex) / den
        u = ((x1 - c[0]) * d[1] - (z1 - c[1]) * d[0]) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9:
            best = max(best, t)
    return best


NA = 240
ANG = [math.pi * math.copysign(abs(t) ** 1.45, t) for t in np.linspace(-1, 1, NA, endpoint=False)]
ANG = sorted(ANG)


def g(z, y, cz, cy, sz, sy):
    return math.exp(-((z - cz) / sz) ** 2 - ((y - cy) / sy) ** 2)


def face_dx(x, y, z):
    """Relief of the face towards +x: deep-set eyes under the brow, the broken-off nose (a flat, rough
    scar), cheekbones, full lips and a rounded, beardless chin. Face 4.1 m wide, mouth 2.3 m [W]."""
    dx = 0.0
    for sg in (-1, 1):
        dx -= 0.8 * g(z, y, sg * 1.05, 17.25, 0.5, 0.3)          # eye socket
        dx += 0.26 * g(z, y, sg * 1.05, 17.24, 0.3, 0.12)          # eyeball
        dx += 0.24 * g(z, y, sg * 1.0, 17.75, 0.7, 0.14)            # brow
        dx += 0.1 * g(z, y, sg * 1.5, 16.55, 0.45, 0.5)            # cheekbone
        dx -= 0.08 * g(z, y, sg * 0.95, 15.85, 0.22, 0.35)         # fold beside the mouth
    dx += 0.14 * g(z, y, 0, 17.45, 0.3, 0.2)                        # root of the nose (all that is left)
    scar = g(z, y, 0, 16.45, 0.5, 0.55)                             # where the nose was prised off
    dx += scar * (0.05 + 0.04 * math.sin(z * 19 + y * 13) * math.cos(y * 7 - z * 5))
    dx -= 0.1 * g(z, y, 0, 15.72, 0.7, 0.08)                        # under the nostrils
    dx += 0.1 * g(z, y, 0, 15.5, 0.9, 0.12)                         # upper lip
    dx += 0.08 * g(z, y, 0, 15.12, 0.75, 0.12)                      # lower lip
    dx -= 0.12 * g(z, y, 0, 15.32, 1.05, 0.06)                      # line of the mouth
    dx += 0.06 * g(z, y, 0, 14.5, 0.55, 0.25)                       # chin (no beard: it is lost)
    dx += 0.09 * math.exp(-((y - 19.0) / 0.1) ** 2)                 # nemes headband
    return dx


head_rings = []
levels = list(np.arange(10.5, 13.6, 0.25)) + list(np.arange(13.6, 18.4, 0.07)) + list(np.arange(18.4, 19.4, 0.1)) + [19.5, 19.6, 19.7, 19.8, 19.9, 19.97]
for y in levels:
    poly = head_plan(y)
    xs_ = [p[0] for p in poly]
    c = ((max(xs_) + min(xs_)) / 2, 0.0)
    ring = []
    for a in ANG:
        r = ray(poly, c, a)
        x, z = c[0] + r * math.cos(a), c[1] + r * math.sin(a)
        wf = ki(WF_KEYS, y)
        if y >= 13.6 and x > XW + 0.25 and abs(z) <= wf + 0.05:
            x += face_dx(x, y, z) * min(1.0, (x - XW - 0.25) / 0.6)
        elif y >= WING_BOTTOM and abs(z) > 2.3 and y < 19.2:    # fine nemes stripes, 0.3 m pitch [PH]
            k = 0.035 * (1 + math.sin(2 * math.pi * (y - WING_BOTTOM) / 0.6)) / max(r, 0.1)
            x, z = x - (x - c[0]) * k, z - z * k
        elif y < WING_BOTTOM - 0.05 and y > 11.0:              # eroded neck bands
            b = band(y) * 0.45
            k = b / max(r, 0.1)
            x, z = x - (x - c[0]) * k, z - z * k
        ring.append((x, y, z))
    head_rings.append(ring)
# pole on the flattish top of the nemes
last = head_rings[-1]
cx_ = sum(p[0] for p in last) / len(last)
head_rings.append([(cx_ + (p[0] - cx_) * 0.55, 20.04, p[2] * 0.55) for p in last])
loft('head and nemes', head_rings, 'carved', smooth=True)

# ears in front of the nemes wings, 1.37 m [W]
for sg in (-1, 1):
    ell = [(17.95 + 0.55 * math.cos(a), 16.6 + 0.72 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 16, endpoint=False)]
    rings = [[(x, y, sg * zz) for x, y in ell] for zz in (1.95, 2.2)]
    inner = [[(17.95 + 0.3 * math.cos(a), 16.6 + 0.42 * math.sin(a), sg * 2.12) for a in np.linspace(0, 2 * math.pi, 16, endpoint=False)]]
    loft('ear', rings + inner, 'carved')


# ---------------------------------------------------------------- enclosure [PLAN][DEM]
# floor of the ditch, level with the base of the Sphinx
floor = [(-40.5, -23.0), (47.5, -23.0), (47.5, 35.5), (43.0, 32.0), (30.0, 26.4), (15.0, 19.9), (0.0, 16.4),
         (-20.0, 13.9), (-40.5, 12.4)]
prism('ditch floor', floor, 0.0, 0.12, 'limestone')

# rock-cut walls: south along the causeway, west behind the rump, north; inner face on this polyline
wall_line = [(44.0, 32.2), (30.0, 26.4), (15.0, 19.9), (0.0, 16.4), (-20.0, 13.9), (-40.0, 12.4),
             (-40.0, -22.6), (-10.0, -22.6), (20.0, -22.6), (44.0, -22.6)]
pts = []
for (x0, z0), (x1, z1) in zip(wall_line, wall_line[1:]):
    n = max(1, int(math.hypot(x1 - x0, z1 - z0) / 1.6))
    pts += [(x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n) for k in range(n)]
pts.append(wall_line[-1])
THICK = 6.0
wall_rings = []
for i, (x, z) in enumerate(pts):
    a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
    tx, tz = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, tz)
    nx, nz = tz / L, -tx / L
    if nx * x + nz * z < 0:
        nx, nz = -nx, -nz                                        # outward, away from the Sphinx
    if 0 < i < len(pts) - 1 and pts[i] in wall_line:              # mitre the corners
        a2 = (x - a[0], z - a[1]); b2 = (b[0] - x, b[1] - z)
        n1 = (a2[1], -a2[0]); n2 = (b2[1], -b2[0])
        n1 = [v / math.hypot(*n1) for v in n1]; n2 = [v / math.hypot(*n2) for v in n2]
        if n1[0] * x + n1[1] * z < 0: n1 = [-v for v in n1]
        if n2[0] * x + n2[1] * z < 0: n2 = [-v for v in n2]
        bx, bz = n1[0] + n2[0], n1[1] + n2[1]; bl = math.hypot(bx, bz)
        cosh = (bx / bl) * n1[0] + (bz / bl) * n1[1]
        nx, nz = bx / bl / cosh, bz / bl / cosh
    h = min(8.5, max(3.0, ground(x + nx * 4, z + nz * 4) + 0.3))
    ring = [(x + nx * 0.2, 0.0, z + nz * 0.2)]
    for k in range(1, 25):
        y = h * k / 24
        d = band(y) * 0.8 + 0.12 * math.sin(x * 0.9 + z * 0.7 + k)   # layered, eroded bedrock face
        ring.append((x + nx * d, y, z + nz * d))
    ring += [(x + nx * THICK, h, z + nz * THICK), (x + nx * THICK, 0.0, z + nz * THICK)]
    wall_rings.append(ring)
loft('enclosure walls', wall_rings, 'limestone')


# ---------------------------------------------------------------- temples [OSM][PH]
def clip_half(poly, axis, value, keep_below):
    out = []
    for p, q in zip(poly, poly[1:] + poly[:1]):
        pin = (p[axis] <= value) == keep_below or p[axis] == value
        qin = (q[axis] <= value) == keep_below or q[axis] == value
        if pin:
            out.append(p)
        if pin != qin:
            t = (value - p[axis]) / (q[axis] - p[axis])
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def area(poly):
    return 0.5 * abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1])))


def dedupe(poly):
    out = []
    for p in poly:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 0.05:
            out.append(p)
    if len(out) > 1 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < 0.05:
        out.pop()
    return out


def inside(poly, x, z):
    c = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            c = not c
    return c


def megalith_walls(label, poly, top_fn, courses, gran_courses=0):
    """Cut a wall plan into huge core blocks in staggered courses; each block stands to its own
    broken height (ruin tops are jagged by block, showing the full wall thickness). The plan is
    rasterised at 0.6 m so every block is a clean rectangle."""
    G = 0.6
    xs_, zs_ = [p[0] for p in poly], [p[1] for p in poly]
    x0g, z0g = min(xs_), min(zs_)
    nx, nz = int((max(xs_) - x0g) / G) + 1, int((max(zs_) - z0g) / G) + 1
    cov = [[inside(poly, x0g + (i + 0.5) * G, z0g + (j + 0.5) * G) for j in range(nz)] for i in range(nx)]
    y0 = 0.0
    for c, ch in enumerate(courses):
        bi = 5 if c % 2 == 0 else 4                      # blocks 3.0 / 2.4 m long, 2.4 m deep, staggered
        oi, oj = (0, 0) if c % 2 == 0 else (2, 2)
        for I in range(-oi, nx, bi):
            for J in range(-oj, nz, 4):
                cells = [(i, j) for i in range(max(0, I), min(nx, I + bi)) for j in range(max(0, J), min(nz, J + 4)) if cov[i][j]]
                if len(cells) < 2:
                    continue
                cx = x0g + (sum(i for i, j in cells) / len(cells) + 0.5) * G
                cz = z0g + (sum(j for i, j in cells) / len(cells) + 0.5) * G
                top = top_fn(cx, cz)
                if top <= y0 + 0.3:
                    continue
                y1 = min(y0 + ch, top)
                for j in sorted({j for i, j in cells}):          # one strip per raster row
                    row = sorted(i for i, jj in cells if jj == j)
                    runs, start = [], row[0]
                    for a_, b_ in zip(row, row[1:] + [None]):
                        if b_ != a_ + 1:
                            runs.append((start, a_)); start = b_
                    for i0, i1 in runs:
                        xa, xb = x0g + i0 * G + 0.04, x0g + (i1 + 1) * G - 0.04
                        za, zb = z0g + j * G, z0g + (j + 1) * G
                        za += 0.04 * (j == min(jj for i, jj in cells)); zb -= 0.04 * (j == max(jj for i, jj in cells))
                        prism(label, [(xa, za), (xb, za), (xb, zb), (xa, zb)], y0, y1,
                              'granite' if c < gran_courses else 'limestone')
        y0 += ch


def ruin_top(base, amp, seed):
    r = random.Random(seed)
    ph = [r.uniform(0, 6.3) for _ in range(4)]
    return lambda x, z: base + amp * (0.5 * math.sin(x * 0.37 + ph[0]) + 0.3 * math.sin(z * 0.53 + ph[1]) +
                                      0.25 * math.sin((x + z) * 0.9 + ph[2]) + 0.15 * math.sin(x * 1.3 - z * 1.1 + ph[3]))


SPHINX_TEMPLE = [
    [(79.4, 29.5), (57.5, 28.5), (57.5, 26.2), (50.0, 26.2), (50.0, 13.7), (51.6, 13.7), (51.6, 24.1), (53.6, 24.1),
     (53.6, 20.6), (55.0, 20.6), (55.0, 24.3), (57.0, 24.3), (57.0, 19.1), (53.8, 19.1), (53.8, 12.4), (50.7, 12.3),
     (50.7, 9.6), (48.8, 9.6), (48.8, 7.3), (50.4, 7.3), (50.4, 4.4), (53.7, 4.4), (53.7, -1.4), (56.6, -1.4),
     (56.6, -6.5), (52.4, -6.5), (52.4, 0.5), (49.0, 0.5), (49.1, -11.4), (56.6, -11.3), (56.6, -16.0), (80.1, -16.0),
     (80.1, -13.9), (91.3, -13.8), (91.3, -18.8), (56.9, -18.4), (52.7, -14.6), (48.0, -14.2), (47.1, 30.5),
     (91.5, 33.2), (91.5, 26.8), (79.8, 26.7)],
    [(91.4, 10.6), (91.4, 2.2), (86.9, 2.2), (86.9, -2.9), (81.3, -2.9), (81.3, -5.0), (83.2, -5.0), (83.2, -10.2),
     (79.4, -10.2), (79.4, -2.1), (83.0, -2.1), (83.0, 2.5), (86.0, 2.5), (86.0, 5.0), (88.8, 5.0), (88.8, 8.2),
     (86.1, 8.2), (86.1, 11.0), (82.2, 11.0), (82.2, 17.5), (79.6, 17.5), (79.6, 23.6), (86.0, 23.6), (86.0, 20.0),
     (88.2, 20.0), (88.2, 15.6), (89.0, 15.6), (89.0, 10.6)]]
VALLEY_TEMPLE = [
    [(49.6, 44.5), (49.8, 36.9), (92.6, 37.9), (92.5, 44.7), (84.1, 44.5), (83.7, 59.7), (79.0, 59.6), (79.3, 45.3)],
    [(91.7, 78.6), (91.5, 83.5), (48.7, 82.5), (49.5, 47.2), (72.7, 47.7), (72.6, 55.0), (55.8, 54.6), (55.6, 65.7),
     (73.0, 66.1), (72.9, 68.5), (71.5, 68.4), (71.5, 67.5), (55.2, 67.1), (55.1, 71.8), (62.7, 72.0), (62.5, 76.7),
     (71.2, 76.9), (71.3, 72.9), (79.0, 73.1), (79.2, 63.2), (83.8, 63.3), (83.5, 74.0), (83.4, 78.4)],
    [(92.4, 47.8), (91.7, 75.2), (87.2, 75.1), (87.2, 74.1), (87.9, 47.7)]]
for k, poly in enumerate(SPHINX_TEMPLE):                  # ruined core-block walls, 2.5-6.5 m [PH]
    megalith_walls('sphinx temple', poly, ruin_top(4.4 if k == 0 else 3.0, 2.0, 11 + k), [2.2, 2.0, 1.6, 1.4])
for k, poly in enumerate(VALLEY_TEMPLE):                  # better preserved, ~8-9.5 m; granite-cased foot [PH]
    megalith_walls('valley temple', poly, ruin_top(8.6, 0.9, 21 + k), [2.4, 2.2, 2.1, 1.8, 1.4], gran_courses=1)

# monolithic granite pillars and architraves of the Valley Temple's roofless T-hall [PH, simplified]
for px in (58.5, 62.5, 66.5, 70.5):
    for pz in (57.0, 60.2, 63.4):
        prism('t-hall pillar', [(px - 0.55, pz - 0.55), (px + 0.55, pz - 0.55), (px + 0.55, pz + 0.55), (px - 0.55, pz + 0.55)],
              0.0, 4.1, 'granite')
    prism('architrave', [(px - 0.6, 56.3), (px + 0.6, 56.3), (px + 0.6, 64.1), (px - 0.6, 64.1)], 4.1, 5.1, 'granite')

info = m.finish(directory=(Path(tempfile.gettempdir()) / 'sr-landmarks' / 'great-sphinx'))
