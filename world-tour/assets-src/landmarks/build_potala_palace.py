"""Potala Palace (布达拉宫), Lhasa: central white base, Red Palace, golden roofs, White Palace, wings, stairways.

Original geometry. Reference photographs (Wikimedia Commons) were used only to compare shape, counts and
colours; no photograph, drawing or third-party mesh is used or shipped.

Sources for the numbers (marked in the code as [zh], [en], [osm], [photo], [dem]):
  [zh]    Chinese Wikipedia "布达拉宫": main building 117.2 m high, 360 m east-west, 13 storeys seen from outside
          (9 real, the lower 4 are retaining walls built up from the rock), walls 2-5 m thick, White Palace 7
          storeys, five stupa halls in the Red Palace, the 13th Dalai Lama's hall at its west end.
  [en]    English Wikipedia "Potala Palace": battered walls 3 m thick, 5 m at the base; straight rows of windows
          on the upper walls only; a series of staircases leads up the rock.
  [osm]   OSM way 31475419 (the registered footprint, 380 x 105 m) and the Shöl buildings round it.
  [dem]   The game's own ground: sr.bare_earth over the route (building footprints masked and refilled), the
          sampler every terrain tile, road and building of the route reads. Datum y = 0 is the lowest of that
          ground round the outline (3662.25 m, the value the route build places the model at). The top of
          the main golden roof is kept at y = 103.7 (3766 m; 117.2 m above the 3649 m foot of the palace [zh]).
  [photo] Heights and widths scaled off the south elevation photographed from the Square (p01 in the report,
          ~0.14 m/px at the palace), cross-checked on p02, p05, p13, p14, p19.

Authoring frame: the palace grid (OSM outline and every Shöl building agree) is turned 11.5 deg from east,
its east end further north. a runs along the south face (east-north-east), s runs out of the south face
(south-south-east), y up; metres; origin at the footprint centroid.
Run:
  Blender --background --python assets-src/landmarks/build_potala_palace.py -- --render-dir <dir>
"""
import argparse
import json
import math
import os
import random
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model, ROOT
from build_moffett_aircraft import xyz
import bpy
from mathutils import Vector

ID = 'potala-palace'
TH = math.radians(-11.5)
CT, ST = math.cos(TH), math.sin(TH)
TOP = 103.7                      # main golden roof finial above the datum (registered height)
m = None
G = None
RNG = random.Random(1645)

SAMPLE = r'''
import json, sys, math
import numpy as np
from shapely.geometry import Polygon
from sr.geo import LocalFrame
from sr.dem import DemSampler
from sr.fetch_osm import load_layer
from sr.route import build_route
from sr.routes import load_route
from sr.bare_earth import for_route
lat, lon, th = map(float, sys.argv[1:4])
f = LocalFrame(lat, lon)
ct, st = math.cos(th), math.sin(th)
route = load_route('lhasa')
res = build_route('lhasa')
dem = for_route(DemSampler(), res, 'lhasa', float(route.get('terrainPadM', 300)), float(route.get('waterLevelM', 0.0)))
entry = next(e for e in json.load(open('landmarks.json'))['landmarks'] if e['id'] == 'potala-palace')
fx, fz = f.to_local(*np.asarray(entry['footprint']).T)
ring = np.c_[fx, fz]
samples = []
for p, q in zip(ring[:-1], ring[1:]):
    n = max(1, int(np.ceil(np.hypot(*(q - p)) / 8)))
    samples += [p + (q - p) * i / n for i in range(n)]
samples.append(np.asarray(Polygon(ring).centroid.coords[0]))
samples = np.asarray(samples)
y0 = float(dem.heights(*f.to_latlon(samples[:, 0], samples[:, 1])).min())
A = np.arange(-240, 250.01, 2.5)
S = np.arange(-120, 140.01, 2.5)
AA, SS = np.meshgrid(A, S)
X, Z = AA * ct - SS * st, AA * st + SS * ct
H = dem.heights(*f.to_latlon(X.ravel(), Z.ravel())).reshape(AA.shape) - y0
others = []
for e in load_layer('lhasa', 'buildings')['elements']:
    g = e.get('geometry')
    if not g or e['id'] == 31475419:
        continue
    x, z = f.to_local(np.array([p['lat'] for p in g]), np.array([p['lon'] for p in g]))
    a, s = x * ct + z * st, -x * st + z * ct
    if -260 < a.mean() < 260 and -140 < s.mean() < 170:
        others.append([e['id'], np.c_[a, s].round(2).tolist()])
print(json.dumps(dict(y0=y0, a0=-240.0, s0=-120.0, step=2.5, na=len(A), ns=len(S), h=H.round(2).tolist(), others=others)))
'''


def survey_ground(lat, lon):
    out = subprocess.check_output([str(ROOT / 'pipeline/.venv/bin/python'), '-c', SAMPLE, str(lat), str(lon), str(TH)],
                                  cwd=ROOT / 'pipeline', env={**os.environ, 'PYTHONPATH': str(ROOT / 'pipeline')}, text=True)
    return json.loads(out.strip().splitlines()[-1])


def ground(a, s):
    g = G
    fi, fj = (a - g['a0']) / g['step'], (s - g['s0']) / g['step']
    i = min(max(int(math.floor(fi)), 0), g['na'] - 2)
    j = min(max(int(math.floor(fj)), 0), g['ns'] - 2)
    u, v = min(max(fi - i, 0.0), 1.0), min(max(fj - j, 0.0), 1.0)
    h = g['h']
    return (h[j][i] * (1 - u) * (1 - v) + h[j][i + 1] * u * (1 - v) + h[j + 1][i] * (1 - u) * v + h[j + 1][i + 1] * u * v)


def ground_range(a0, a1, s0, s1, step=2.0):
    na, ns = max(2, int((a1 - a0) / step) + 1), max(2, int((s1 - s0) / step) + 1)
    vals = [ground(a0 + (a1 - a0) * i / (na - 1), s0 + (s1 - s0) * j / (ns - 1)) for i in range(na) for j in range(ns)]
    return min(vals), max(vals)

# ------------------------------------------------------------------ primitives (a along, y up, s out of the south face)


def add(mat, verts, faces, smooth=False):
    m.mesh('part', verts, faces, mat, smooth)


HEX_F = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def hexa(mat, P):
    add(mat, P, HEX_F)


def box(mat, a0, a1, y0, y1, s0, s1):
    assert a1 > a0 + 1e-4 and y1 > y0 + 1e-4 and s1 > s0 + 1e-4, (mat, a0, a1, y0, y1, s0, s1)
    hexa(mat, [(a0, y0, s0), (a1, y0, s0), (a1, y0, s1), (a0, y0, s1), (a0, y1, s0), (a1, y1, s0), (a1, y1, s1), (a0, y1, s1)])


def lathe(mat, ca, cs, prof, n=12, smooth=True):
    """Solid of revolution round a vertical axis; prof [(r, y)] bottom to top, every r > 0, both ends capped."""
    V = []
    for r, y in prof:
        V += [(ca + r * math.cos(k * math.tau / n), y, cs + r * math.sin(k * math.tau / n)) for k in range(n)]
    L = len(prof)
    F = [tuple(reversed(range(n))), tuple((L - 1) * n + k for k in range(n))]
    F += [(i * n + k, i * n + (k + 1) % n, (i + 1) * n + (k + 1) % n, (i + 1) * n + k) for i in range(L - 1) for k in range(n)]
    add(mat, V, F, smooth)


def sweep(mat, pts, w, h, centred=False):
    """Closed rectangular section swept along a polyline; base on the path unless centred."""
    P = [Vector(p) for p in pts]
    rings = []
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        side = t.cross(Vector((0, 1, 0)))
        if side.length < 1e-6:
            side = Vector((1, 0, 0))
        side.normalize()
        nrm = side.cross(t).normalized()
        if nrm.y < 0:
            nrm = -nrm
        b = -h / 2 if centred else 0.0
        rings.append([p - side * w / 2 + nrm * b, p + side * w / 2 + nrm * b,
                      p + side * w / 2 + nrm * (b + h), p - side * w / 2 + nrm * (b + h)])
    k = len(rings)
    verts = [tuple(v) for r in rings for v in r]
    faces = [(3, 2, 1, 0), (4 * (k - 1), 4 * (k - 1) + 1, 4 * (k - 1) + 2, 4 * (k - 1) + 3)]
    for i in range(k - 1):
        for j in range(4):
            faces.append((4 * i + j, 4 * i + (j + 1) % 4, 4 * (i + 1) + (j + 1) % 4, 4 * (i + 1) + j))
    add(mat, verts, faces)


def tube(mat, pts, r, sides=5):
    m.tube('part', pts, r, mat, sides)

# ------------------------------------------------------------------ battered blocks and their wall grammar


OCCLUDERS = []      # (a0, a1, s0, s1, top): anything a window must not sit behind


def occluded(a, s, y, own=None):
    return any(o is not own and o[0] <= a <= o[1] and o[2] <= s <= o[3] and y <= o[4] for o in OCCLUDERS)


class Face:
    """One face of a battered block: t along it, o outward from the face plane at the block top.
    Everything placed through P follows the batter, so bands and windows lie on the sloping wall."""

    def __init__(self, blk, side):
        self.b, self.side = blk, side
        self.t0, self.t1 = (blk.a0, blk.a1) if side in 'SN' else (blk.s0, blk.s1)

    def P(self, t, y, o):
        b = self.b
        o = o + b.k * ((b.yc(t) if callable(b.yc) else b.yc) - y)
        if self.side == 'S':
            return (t, y, b.s1 + o)
        if self.side == 'N':
            return (t, y, b.s0 - o)
        if self.side == 'E':
            return (b.a1 + o, y, t)
        return (b.a0 - o, y, t)

    def hexa(self, mat, t0, t1, y0, y1, o0, o1):
        P = self.P
        hexa(mat, [P(t0, y0, o0), P(t1, y0, o0), P(t1, y0, o1), P(t0, y0, o1),
                   P(t0, y1, o0), P(t1, y1, o0), P(t1, y1, o1), P(t0, y1, o1)])

    def ring(self, mat, outer, inner, o0, o1):
        """A closed frame between two 4-point loops [(t, y)] (same winding), from o0 back to o1 front."""
        P = self.P
        V = ([P(t, y, o1) for t, y in outer] + [P(t, y, o1) for t, y in inner] +
             [P(t, y, o0) for t, y in outer] + [P(t, y, o0) for t, y in inner])
        F = []
        for i in range(4):
            j = (i + 1) % 4
            F += [(i, j, 4 + j, 4 + i), (8 + i, 8 + j, 12 + j, 12 + i), (i, j, 8 + j, 8 + i), (4 + i, 4 + j, 12 + j, 12 + i)]
        add(mat, V, F)

    def disc(self, mat, t, y, o0, o1, r, n=12):
        P = self.P
        c = [(t + r * math.cos(k * math.tau / n), y + r * math.sin(k * math.tau / n)) for k in range(n)]
        V = [P(a, b, o1) for a, b in c] + [P(a, b, o0) for a, b in c]
        F = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))] + [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
        add(mat, V, F, True)

    def world(self, t, y, o):
        return self.P(t, y, o)


def window(F, t, yb, w, h, full=True, frame='paint_black', valance=True):
    """A Tibetan window [photo p04, p13]: dark opening, black trapezoid surround wider at the sill standing proud
    of the wall so the opening has a real reveal, a two-tier red-brown timber lintel and a white valance."""
    yt = yb + h
    F.hexa('glass', t - w / 2, t + w / 2, yb, yt, -0.3, 0.03)
    bw = 0.2 + 0.1 * w
    fl = 0.22 + 0.12 * w
    F.ring(frame, [(t - w / 2 - bw - fl, yb - 0.3), (t + w / 2 + bw + fl, yb - 0.3), (t + w / 2 + bw, yt + 0.1), (t - w / 2 - bw, yt + 0.1)],
           [(t - w / 2, yb), (t + w / 2, yb), (t + w / 2, yt), (t - w / 2, yt)], -0.1, 0.34)
    if not full:
        return
    if w >= 1.5:
        F.hexa('wood', t - 0.07, t + 0.07, yb, yt, 0.0, 0.2)
    F.hexa('wood_red', t - w / 2 - bw - 0.1, t + w / 2 + bw + 0.1, yt + 0.1, yt + 0.34, -0.1, 0.62)
    F.hexa('wood_red', t - w / 2 - bw - 0.25, t + w / 2 + bw + 0.25, yt + 0.34, yt + 0.52, -0.1, 0.8)
    if valance:
        F.hexa('canvas', t - w / 2 - bw + 0.05, t + w / 2 + bw - 0.05, yt - 0.3, yt + 0.1, 0.52, 0.58)


def vent(F, t, yb, w=0.5, h=0.62):
    """One of the small square light-and-air openings gridded over the lower walls [photo p04, p05, p13]."""
    F.hexa('glass', t - w / 2, t + w / 2, yb, yb + h, -0.3, 0.06)


BLOCKS = []


class Blk:
    """A flat-roofed, battered masonry block standing on the hill: its walls go 4 m below the lowest
    ground under it, its roof is kept at least 1.5 m above the highest.
    Window grammar [photo, en]: `full` rows of full windows under the pema band, then `vents` rows of small
    square vents on a regular grid, then blank wall down to the ground."""

    def __init__(self, name, a0, a1, s0, s1, yt, mat='plaster_white', k=0.08, pema=1.4, win=None, gold=0.0,
                 sides='SNEW', cope='plaster_white', pema_mat='pema'):
        lo, hi = ground_range(a0, a1, s0, s1)
        if yt < hi + 1.5:
            print(f'  {name}: roof raised {yt:.1f} -> {hi + 1.5:.1f} to clear the hill', flush=True)
            yt = round(hi + 1.5, 1)
        self.name, self.a0, self.a1, self.s0, self.s1 = name, a0, a1, s0, s1
        # never below y = 0: finish() stands the lowest vertex on the datum
        self.yt, self.yc, self.yb = yt, yt - 0.45, max(0.0, lo - 4.0)
        self.mat, self.k, self.pema, self.win, self.gold, self.sides, self.cope = mat, k, pema, win or {}, gold, sides, cope
        self.pema_mat = pema_mat
        self.occ = (a0, a1, s0, s1, yt + 0.6)
        OCCLUDERS.append(self.occ)
        BLOCKS.append(self)

    def faces(self):
        return [Face(self, s) for s in 'SNEW']

    def build(self):
        a0, a1, s0, s1, yb, yc = self.a0, self.a1, self.s0, self.s1, self.yb, self.yc
        o = self.k * (yc - yb)
        hexa(self.mat, [(a0 - o, yb, s0 - o), (a1 + o, yb, s0 - o), (a1 + o, yb, s1 + o), (a0 - o, yb, s1 + o),
                        (a0, yc, s0), (a1, yc, s0), (a1, yc, s1), (a0, yc, s1)])
        box('adobe', a0 + 0.5, a1 - 0.5, yc - 0.1, yc + 0.08, s0 + 0.5, s1 - 0.5)
        for F in self.faces():
            k = self.k
            e = 0.35 + k * (self.pema + 0.6)
            t0, t1 = F.t0 - e, F.t1 + e
            # parapet and coping over the roof deck
            F.hexa(self.cope, t0, t1, yc - 0.05, yc + 0.6, -0.55, 0.3)
            if self.pema > 0:
                # the pema band (dyed tamarisk-twig frieze) under the coping, a white string course below it
                # and a thin white line through its top third [photo p04, p16]
                F.hexa(self.pema_mat, t0 + 0.05, t1 - 0.05, yc - self.pema, yc - 0.05, -0.1, 0.16)
                F.hexa('plaster_white', t0 + 0.08, t1 - 0.08, yc - 0.42, yc - 0.3, -0.1, 0.2)
                F.hexa(self.mat, t0 + 0.1, t1 - 0.1, yc - self.pema - 0.32, yc - self.pema, -0.1, 0.26)
                if self.gold and F.side in self.win.get('gold_sides', 'SEW'):
                    n = max(1, int((F.t1 - F.t0 - 4) / self.gold))
                    for i in range(n + 1):
                        t = F.t0 + 2 + (F.t1 - F.t0 - 4) * (i / n if n else 0.5)
                        F.disc('gold', t, yc - self.pema / 2 - 0.02, 0.05, 0.3, min(0.8, self.pema * 0.26))
            if F.side in self.sides and self.win:
                self.windows(F)

    def windows(self, F):
        w = self.win
        sp, sh, ww, wh = w.get('sp', 3.5), w.get('sh', 3.3), w.get('w', 1.2), w.get('h', 1.6)
        full_rows, vent_rows, skip = w.get('full', 99), w.get('vents', 0), w.get('skip', 0.04)
        L = F.t1 - F.t0 - 2 * w.get('edge', 2.2)
        if L < 1.0:
            return
        n = int(L / sp) + 1
        ts = [F.t0 + (F.t1 - F.t0) / 2 + (i - (n - 1) / 2) * (L / max(n - 1, 1) if n > 1 else 0) for i in range(n)]
        yrow = self.yc - self.pema - 0.32 - 0.9
        for r in range(full_rows + vent_rows):
            full = r < full_rows
            for t in ts:
                if full:
                    ww_, wh_ = ww, wh
                    yb = yrow - r * sh - wh_
                else:
                    ww_, wh_ = 0.5, 0.62
                    yb = yrow - full_rows * sh - (r - full_rows) * w.get('vsh', 3.0) - 0.6
                if yb < self.yb + 1:
                    continue
                if full and RNG.random() < skip:
                    continue
                if any(x0 <= t <= x1 and y0 <= yb + wh_ / 2 <= y1 for side, x0, x1, y0, y1 in w.get('blank', []) if side == F.side):
                    continue
                a, _, s = F.world(t, yb, 1.4)
                if ground(a, s) > yb - 1.0:
                    continue
                a, _, s = F.world(t, yb + wh_ / 2, 1.1)
                if occluded(a, s, yb + wh_ / 2, self.occ) or any(occluded(*F.world(tt, yb + wh_, 1.1)[::2], yb + wh_, self.occ) for tt in (t - ww_, t + ww_)):
                    continue
                if full:
                    window(F, t, yb, ww_, wh_, True, valance=w.get('valance', True))
                else:
                    vent(F, t, yb)


def drum(name, ca, cs, r, yt, k=0.05, band=1.6, slits=((-5.0,), (0.0,))):
    """A round battered tower: the west drum at the top of the west wing [photo p01, p14] and the east
    round bastion [photo p19]; white body, a dark maroon band just under the rim, white coping, slits."""
    lo, hi = ground_range(ca - r, ca + r, cs - r, cs + r)
    yb = max(0.0, lo - 4.0)
    yc = yt - 0.45
    rb = r + k * (yc - yb)
    n = 40
    lathe('plaster_white', ca, cs, [(rb, yb), (r, yc)], n, False)
    lathe('pema', ca, cs, [(r + k * band + 0.18, yc - band), (r + 0.18, yc - 0.05)], n, False)
    lathe('plaster_white', ca, cs, [(r + k * (band + 0.3) + 0.26, yc - band - 0.3), (r + k * band + 0.26, yc - band)], n, False)
    lathe('plaster_white', ca, cs, [(r + 0.32, yc - 0.05), (r + 0.32, yc + 0.6)], n, False)
    box('adobe', ca - r * 0.68, ca + r * 0.68, yc - 0.1, yc + 0.08, cs - r * 0.68, cs + r * 0.68)
    for i in range(14):
        th = math.tau * (i + 0.5) / 14
        for dy in (4.2, 8.6, 13.0):
            yy = yc - band - dy
            ca2, cs2 = ca + math.cos(th) * (r + k * (yc - yy)), cs + math.sin(th) * (r + k * (yc - yy))
            if yy < yb + 1 or ground(ca2 + math.cos(th) * 1.2, cs2 + math.sin(th) * 1.2) > yy - 1:
                continue
            if occluded(ca2 + math.cos(th) * 1.2, cs2 + math.sin(th) * 1.2, yy + 0.5):
                continue
            nx, nz = math.cos(th), math.sin(th)
            tx, tz = -nz, nx

            def P(t, y, o, ca2=ca2, cs2=cs2, nx=nx, nz=nz, tx=tx, tz=tz):
                return (ca2 + nx * o + tx * t, y, cs2 + nz * o + tz * t)
            hexa('glass', [P(-0.35, yy, -0.4), P(0.35, yy, -0.4), P(0.35, yy, 0.05), P(-0.35, yy, 0.05),
                           P(-0.35, yy + 1.2, -0.4), P(0.35, yy + 1.2, -0.4), P(0.35, yy + 1.2, 0.05), P(-0.35, yy + 1.2, 0.05)])
            V = [P(t, y, 0.3) for t, y in ((-0.9, yy - 0.3), (0.9, yy - 0.3), (0.65, yy + 1.3), (-0.65, yy + 1.3))]
            V += [P(t, y, 0.3) for t, y in ((-0.35, yy), (0.35, yy), (0.35, yy + 1.2), (-0.35, yy + 1.2))]
            V += [P(t, y, -0.3) for t, y in ((-0.9, yy - 0.3), (0.9, yy - 0.3), (0.65, yy + 1.3), (-0.65, yy + 1.3))]
            V += [P(t, y, -0.3) for t, y in ((-0.35, yy), (0.35, yy), (0.35, yy + 1.2), (-0.35, yy + 1.2))]
            Fc = []
            for q in range(4):
                j = (q + 1) % 4
                Fc += [(q, j, 4 + j, 4 + q), (8 + q, 8 + j, 12 + j, 12 + q), (q, j, 8 + j, 8 + q), (4 + q, 4 + j, 12 + j, 12 + q)]
            add('paint_black', V, Fc)
    OCCLUDERS.append((ca - r, ca + r, cs - r, cs + r, yt))
    print(f'  {name}: base {yb:.1f}, top {yt:.1f}, ground {lo:.1f}..{hi:.1f}', flush=True)

# ------------------------------------------------------------------ stairways


FLIGHT_WALLS = []


def flight(name, a_from, a_to, y_from, y_to, s_back, s_out, width=5.0, k=0.08, seg=4.0):
    """One long straight flight [photo p01, p02, p09, p18, p19]: a battered white retaining wall that fills back
    to s_back, the steps on its outer (south) edge, and the outer parapet as a sawtooth of level segments each
    stepping up, capped by a rounded tan coping over a dark maroon band."""
    lo_a, hi_a = min(a_from, a_to), max(a_from, a_to)

    def Y(a):
        return y_from + (a - a_from) / (a_to - a_from) * (y_to - y_from)
    lo, hi = ground_range(lo_a, hi_a, s_back, s_out)
    yb = max(0.0, lo - 3.0)
    worst = min(Y(lo_a + (hi_a - lo_a) * i / 30) - ground_range(lo_a + (hi_a - lo_a) * i / 30 - 0.1, lo_a + (hi_a - lo_a) * i / 30 + 0.1,
                                                                 s_out - width, s_out)[1] for i in range(31))
    print(f'  {name}: {y_from:.1f}->{y_to:.1f} over {hi_a - lo_a:.0f} m, slope {abs(y_to - y_from) / (hi_a - lo_a):.2f}, '
          f'least clearance over the hill {worst:.1f} m, base {yb:.1f}', flush=True)
    yl, yh = Y(lo_a), Y(hi_a)
    hexa('plaster_white', [(lo_a, yb, s_back), (hi_a, yb, s_back), (hi_a, yb, s_out + k * (yh - yb)), (lo_a, yb, s_out + k * (yl - yb)),
                           (lo_a, yl - 0.2, s_back), (hi_a, yh - 0.2, s_back), (hi_a, yh - 0.2, s_out), (lo_a, yl - 0.2, s_out)])
    # stone steps, 0.3 m risers
    n = max(2, math.ceil(abs(y_to - y_from) / 0.3))
    run = (a_to - a_from) / n
    rise = (y_to - y_from) / n
    for i in range(n):
        x0, x1 = a_from + i * run, a_from + (i + 1) * run
        ytop = y_from + (i + 1) * rise if rise > 0 else y_from + i * rise
        box('stone', min(x0, x1), max(x0, x1), ytop - 0.45, ytop, s_out - width, s_out - 0.75)
    # low inner kerb wall on the uphill side of the steps
    hexa('plaster_white', [(lo_a, yl - 0.4, s_out - width - 0.5), (hi_a, yh - 0.4, s_out - width - 0.5), (hi_a, yh - 0.4, s_out - width), (lo_a, yl - 0.4, s_out - width),
                           (lo_a, yl + 0.6, s_out - width - 0.5), (hi_a, yh + 0.6, s_out - width - 0.5), (hi_a, yh + 0.6, s_out - width), (lo_a, yl + 0.6, s_out - width)])
    # the sawtooth parapet: level segments, each topped at the height of its uphill end
    nseg = max(1, round((hi_a - lo_a) / seg))
    L = (hi_a - lo_a) / nseg
    so, si = s_out, s_out - 0.75
    for i in range(nseg):
        x0, x1 = lo_a + i * L, lo_a + (i + 1) * L
        top = max(Y(x0), Y(x1)) + 1.25
        bot = min(Y(x0), Y(x1)) - 0.4
        box('plaster_white', x0, x1, bot, top - 0.3, si, so)
        box('pema', x0 - 0.02, x1 + 0.02, top - 0.85, top - 0.3, si - 0.04, so + 0.06)
        # rounded tan coping: a half-octagon section extruded along the segment
        cs_ = (si + so) / 2
        hw = 0.5
        prof = [(-hw, 0.0), (hw, 0.0), (hw, 0.12), (hw * 0.7, 0.3), (0.0, 0.38), (-hw * 0.7, 0.3), (-hw, 0.12)]
        V = [(x0 - 0.05, top - 0.3 + y, cs_ + u) for u, y in prof] + [(x1 + 0.05, top - 0.3 + y, cs_ + u) for u, y in prof]
        k7 = len(prof)
        Fc = [tuple(reversed(range(k7))), tuple(range(k7, 2 * k7))] + [(j, (j + 1) % k7, k7 + (j + 1) % k7, k7 + j) for j in range(k7)]
        add('paint_tan', V, Fc)
    occ = (lo_a, hi_a, s_back, s_out, max(yl, yh) + 1.6)
    OCCLUDERS.append(occ)
    FLIGHT_WALLS.append((name, lo_a, hi_a, s_back, s_out, Y, k, occ))


def path_stair(name, pts, width=4.2, seg=3.5):
    """A stair that follows the hillside down a polyline [(a, s)] (the west-slope stairs, photo p01 left, p14):
    each leg a straight flight a metre over the highest ground under it, on a low white embankment, with the
    sawtooth parapet on both sides."""
    ys = []
    for a, s in pts:
        lo, hi = ground_range(a - width / 2, a + width / 2, s - width / 2, s + width / 2, 1.0)
        ys.append(hi + 1.0)
    for i in range(1, len(ys)):                         # keep it monotone downhill
        ys[i] = min(ys[i], ys[i - 1])
    yprev = ys[0]
    for (a0, s0), (a1, s1), y1 in zip(pts, pts[1:], ys[1:]):
        y0 = yprev                                    # legs join end to end
        y1 = min(y0, y1)
        L = math.hypot(a1 - a0, s1 - s0)
        da, ds = (a1 - a0) / L, (s1 - s0) / L
        na, ns = -ds, da
        hi = max(ground(a0 + da * L * f + na * u, s0 + ds * L * f + ns * u) for f in (0, .25, .5, .75, 1) for u in (-width / 2, 0, width / 2))
        if y1 < hi + 0.4:
            y1 = hi + 0.4
        yprev = y1
        lo = min(ground(a0 + da * L * f + na * u, s0 + ds * L * f + ns * u) for f in (0, .5, 1) for u in (-width / 2, width / 2))
        yb = max(0.0, lo - 2.0)

        def M(t, y, u):
            return (a0 + da * t + na * u, y, s0 + ds * t + ns * u)

        def Y(t):
            return y0 + (y1 - y0) * t / L
        w2 = width / 2 + 0.7
        hexa('plaster_white', [M(0, yb, -w2), M(L, yb, -w2), M(L, yb, w2), M(0, yb, w2),
                               M(0, y0 - 0.2, -w2), M(L, y1 - 0.2, -w2), M(L, y1 - 0.2, w2), M(0, y0 - 0.2, w2)])
        n = max(2, math.ceil(abs(y1 - y0) / 0.3))
        for i in range(n):
            ta, tb = L * i / n, L * (i + 1) / n
            yt = max(Y(ta), Y(tb))
            hexa('stone', [M(ta, yt - 0.45, -width / 2), M(tb, yt - 0.45, -width / 2), M(tb, yt - 0.45, width / 2), M(ta, yt - 0.45, width / 2),
                           M(ta, yt, -width / 2), M(tb, yt, -width / 2), M(tb, yt, width / 2), M(ta, yt, width / 2)])
        nseg = max(1, round(L / seg))
        for u0, u1 in ((-w2, -width / 2), (width / 2, w2)):
            for i in range(nseg):
                ta, tb = L * i / nseg, L * (i + 1) / nseg
                top = max(Y(ta), Y(tb)) + 1.2
                bot = min(Y(ta), Y(tb)) - 0.4
                hexa('plaster_white', [M(ta, bot, u0), M(tb, bot, u0), M(tb, bot, u1), M(ta, bot, u1),
                                       M(ta, top - 0.3, u0), M(tb, top - 0.3, u0), M(tb, top - 0.3, u1), M(ta, top - 0.3, u1)])
                hexa('pema', [M(ta - 0.02, top - 0.8, u0 - 0.04), M(tb + 0.02, top - 0.8, u0 - 0.04), M(tb + 0.02, top - 0.8, u1 + 0.04), M(ta - 0.02, top - 0.8, u1 + 0.04),
                              M(ta - 0.02, top - 0.3, u0 - 0.04), M(tb + 0.02, top - 0.3, u0 - 0.04), M(tb + 0.02, top - 0.3, u1 + 0.04), M(ta - 0.02, top - 0.3, u1 + 0.04)])
                hexa('paint_tan', [M(ta - 0.05, top - 0.3, u0 - 0.05), M(tb + 0.05, top - 0.3, u0 - 0.05), M(tb + 0.05, top - 0.3, u1 + 0.05), M(ta - 0.05, top - 0.3, u1 + 0.05),
                                   M(ta - 0.05, top, u0 + 0.1), M(tb + 0.05, top, u0 + 0.1), M(tb + 0.05, top, u1 - 0.1), M(ta - 0.05, top, u1 - 0.1)])
        xs = [M(0, 0, -w2), M(L, 0, -w2), M(L, 0, w2), M(0, 0, w2)]
        OCCLUDERS.append((min(p[0] for p in xs), max(p[0] for p in xs), min(p[2] for p in xs), max(p[2] for p in xs), max(y0, y1) + 1.6))
        print(f'  {name}: leg ({a0:.0f},{s0:.0f})->({a1:.0f},{s1:.0f}) y {y0:.1f}->{y1:.1f}', flush=True)


class _Wall:
    def __init__(self, a0, a1, s0, s1, Y, k):
        self.a0, self.a1, self.s0, self.s1, self.yc, self.k = a0, a1, s0, s1, Y, k


def flight_vents():
    """The tall retaining walls under the flights are nearly blank: one or two rows of vents under the parapet."""
    for name, lo_a, hi_a, s_back, s_out, Y, k, occ in FLIGHT_WALLS:
        F = Face(_Wall(lo_a, hi_a, s_back, s_out, Y, k), 'S')
        n = int((hi_a - lo_a - 6) / 6.0)
        for i in range(n + 1):
            t = lo_a + 3 + (hi_a - lo_a - 6) * i / max(n, 1)
            for r in (1, 2):
                yb = Y(t) - 1.4 - r * 3.2
                a, _, s = F.world(t, yb, 1.4)
                if ground(a, s) > yb - 1.0:
                    continue
                a, _, s = F.world(t, yb + 0.3, 1.1)
                if occluded(a, s, yb + 0.3, occ):
                    continue
                vent(F, t, yb)


def landing(name, a0, a1, y, s_back, s_out, open_ends='', k=0.08):
    lo, hi = ground_range(a0, a1, s_back, s_out)
    yb = max(0.0, lo - 3.0)
    if hi > y - 0.3:
        print(f'  {name}: WARNING hill {hi:.1f} over landing {y:.1f}', flush=True)
    o = k * (y - yb)
    hexa('plaster_white', [(a0, yb, s_back), (a1, yb, s_back), (a1, yb, s_out + o), (a0, yb, s_out + o),
                           (a0, y - 0.2, s_back), (a1, y - 0.2, s_back), (a1, y - 0.2, s_out), (a0, y - 0.2, s_out)])
    box('stone', a0 + 0.3, a1 - 0.3, y - 0.3, y, s_back + 0.3, s_out - 0.3)
    box('plaster_white', a0, a1, y - 0.3, y + 0.95, s_out - 0.75, s_out)
    box('pema', a0 - 0.02, a1 + 0.02, y + 0.63, y + 0.95, s_out - 0.79, s_out + 0.06)
    box('paint_tan', a0 - 0.05, a1 + 0.05, y + 0.95, y + 1.3, s_out - 0.8, s_out + 0.05)
    for end in open_ends:
        x0, x1 = (a0, a0 + 0.75) if end == 'W' else (a1 - 0.75, a1)
        box('plaster_white', x0, x1, y - 0.3, y + 0.95, s_back, s_out - 0.75)
        box('paint_tan', x0 - 0.05, x1 + 0.05, y + 0.95, y + 1.3, s_back, s_out - 0.75)
    OCCLUDERS.append((a0, a1, s_back, s_out, y + 1.6))

# ------------------------------------------------------------------ gilt Chinese roofs over the stupa halls


def fpt(side, t, o):
    return {'S': (t, o), 'N': (-t, -o), 'E': (o, -t), 'W': (-o, t)}[side]


class Hip:
    """Concave hipped roof with upturned corners round a rectangle (half sizes hx along a, hz along s).
    d is the plan distance in from the eave; top < D makes it a skirt (the lower roof of a double eave)."""

    def __init__(self, ca, cs, hx, hz, y0, R, D=None, top=None, out=0.55, lift=0.8, Lc=3.2, Ld=1.9, alpha=0.38, p=2.2, thick=0.2):
        self.ca, self.cs, self.hx, self.hz, self.y0, self.R = ca, cs, hx, hz, y0, R
        self.D = D if D is not None else hz - 0.05
        self.top = top if top is not None else self.D
        self.out, self.lift, self.Lc, self.Ld, self.alpha, self.p, self.thick = out, lift, Lc, Ld, alpha, p, thick

    def F(self, d):
        u = min(max(d / self.D, 0.0), 1.0)
        return self.R * (self.alpha * u + (1 - self.alpha) * u ** self.p)

    def half(self, side):
        return self.hx if side in 'SN' else self.hz

    def pt(self, side, t, d):
        half = self.half(side)
        other = self.hz if side in 'SN' else self.hx
        q = max(0.0, (half - d) - abs(t))
        c = max(0.0, 1 - q / self.Lc) ** 2 * max(0.0, 1 - max(d, 0.0) / self.Ld) ** 1.5
        y = self.y0 + self.F(d) + self.lift * c
        o = other - d + self.out * c
        a = t + math.copysign(self.out * c, t)
        x, z = fpt(side, a, o)
        return (self.ca + x, y, self.cs + z)

    def hip_pt(self, sx, sz, d, lift=0.0):
        side = 'S' if sz > 0 else 'N'
        t = sx * (self.hx - d) if sz > 0 else -sx * (self.hx - d)
        x, y, z = self.pt(side, t, d)
        return (x, y + lift, z)

    def slab(self, mat):
        for side in 'SNEW':
            half = self.half(side)
            nv = max(3, int(self.top / 0.8) + 2)
            nu = max(3, int(2 * half / 1.1) + 1)
            rows = []
            for i in range(nv):
                d = self.top * i / (nv - 1)
                w = max(half - d, 0.04)
                rows.append([self.pt(side, -w + 2 * w * j / (nu - 1), d) for j in range(nu)])
            m.patch('roof', rows, (0, -self.thick, 0), mat)

    def rolls(self, mat, sp=0.6):
        """Gilt cover-tile rolls from the eave up the slope."""
        for side in 'SNEW':
            half = self.half(side)
            n = int(2 * half / sp)
            for kk in range(1, n):
                t = -half + 2 * half * kk / n
                d1 = min(self.top - 0.2, half - abs(t) - 0.15)
                if d1 < 0.5:
                    continue
                nseg = max(1, math.ceil(d1 / 1.4))
                pts = []
                for i in range(nseg + 1):
                    x, y, z = self.pt(side, t, -0.05 + (d1 + 0.05) * i / nseg)
                    pts.append((x, y + 0.07, z))
                tube(mat, pts, 0.09, 4)

    def hips(self, mat, w=0.34, h=0.38):
        for sx in (1, -1):
            for sz in (1, -1):
                pts = [self.hip_pt(sx, sz, self.top * (1 - i / 10) - (0.03 if i == 10 else 0.0), -0.05) for i in range(11)]
                sweep(mat, pts, w, h)
                # makara-head hook curling up off each corner
                tip = Vector(self.hip_pt(sx, sz, -0.15))
                out = Vector((sx * 0.35, 0.0, sz * 0.35))
                sweep(mat, [tuple(tip + Vector((0, 0.2, 0))), tuple(tip + out + Vector((0, 0.35, 0))),
                            tuple(tip + out * 1.6 + Vector((0, 0.85, 0)))], 0.22, 0.22, True)

    def ridge(self, mat, finial=None):
        L = self.hx - self.hz + 0.05
        yr = self.y0 + self.F(self.D)
        box(mat, self.ca - L - 0.2, self.ca + L + 0.2, yr - 0.3, yr + 0.45, self.cs - 0.3, self.cs + 0.3)
        for sx in (1, -1):
            x = self.ca + sx * (L + 0.1)
            sweep(mat, [(x, yr + 0.3, self.cs), (x + sx * 0.25, yr + 0.9, self.cs), (x + sx * 0.05, yr + 1.45, self.cs)], 0.3, 0.32, True)
        if finial:
            # gilt ganjira: stupa-shaped vase on a lotus base, tapering to a point at `finial`
            y = yr + 0.4
            H = finial - y
            lathe('gold', self.ca, self.cs, [(0.55, y), (0.6, y + 0.1 * H), (0.35, y + 0.18 * H), (0.62, y + 0.34 * H), (0.66, y + 0.44 * H),
                                             (0.4, y + 0.56 * H), (0.22, y + 0.64 * H), (0.34, y + 0.72 * H), (0.12, y + 0.86 * H), (0.03, finial)], 12)
            # the two smaller ganjira at the ridge ends [photo p07, p14]
            for sx in (1, -1):
                x = self.ca + sx * (L - 0.3)
                h2 = min(1.6, H * 0.45)
                lathe('gold', x, self.cs, [(0.3, yr + 0.4), (0.36, yr + 0.4 + 0.3 * h2), (0.2, yr + 0.4 + 0.55 * h2), (0.24, yr + 0.4 + 0.7 * h2),
                                           (0.02, yr + 0.4 + h2)], 10)
        return yr


def brackets(ca, cs, wx, wz, y0, y1, mat='wood_red', cap='gold'):
    """Bracket sets under a gilt eave: a painted block ring with projecting arms, gilt caps."""
    for side in 'SNEW':
        half, other = (wx, wz) if side in 'SN' else (wz, wx)
        n = max(2, int(2 * half / 0.9))
        for i in range(n + 1):
            t = -half + 2 * half * i / n
            pts = [fpt(side, t + dt, other + do) for dt, do in ((-0.18, -0.1), (0.18, -0.1), (0.18, 0.75), (-0.18, 0.75))]
            hexa(mat, [(ca + x, y0, cs + z) for x, z in pts] + [(ca + x, y1 - 0.12, cs + z) for x, z in pts])
            pts = [fpt(side, t + dt, other + do) for dt, do in ((-0.2, 0.45), (0.2, 0.45), (0.2, 0.85), (-0.2, 0.85))]
            hexa(cap, [(ca + x, y1 - 0.12, cs + z) for x, z in pts] + [(ca + x, y1, cs + z) for x, z in pts])
    box(mat, ca - wx - 0.2, ca + wx + 0.2, y0 - 0.25, y0, cs - wz - 0.2, cs + wz + 0.2)


def golden_hall(ca, cs, hx, hz, y0, eave, R, finial, double=None):
    """A stupa hall's roof pavilion on the Red Palace: red walls, pema band, brackets, gilt hip roof.
    double = (upper eave, upper rise): a skirt roof at `eave` and a smaller full roof above it."""
    wx, wz = hx - 1.25, hz - 1.25
    box('plaster_red', ca - wx, ca + wx, y0, eave - 0.8, cs - wz, cs + wz)
    box('pema', ca - wx - 0.12, ca + wx + 0.12, eave - 1.9, eave - 0.95, cs - wz - 0.12, cs + wz + 0.12)
    box('plaster_white', ca - wx - 0.2, ca + wx + 0.2, eave - 2.15, eave - 1.9, cs - wz - 0.2, cs + wz + 0.2)
    brackets(ca, cs, wx, wz, eave - 0.8, eave - 0.05)
    for side in 'SNEW':
        half, other = (wx, wz) if side in 'SN' else (wz, wx)
        for t in (-half * 0.5, 0.0, half * 0.5):
            pts = [fpt(side, t + dt, other + do) for dt, do in ((-0.55, -0.2), (0.55, -0.2), (0.55, 0.12), (-0.55, 0.12))]
            hexa('glass', [(ca + x, eave - 4.1, cs + z) for x, z in pts] + [(ca + x, eave - 2.6, cs + z) for x, z in pts])
            pts = [fpt(side, t + dt, other + do) for dt, do in ((-0.8, 0.0), (0.8, 0.0), (0.8, 0.25), (-0.8, 0.25))]
            hexa('gold', [(ca + x, eave - 2.6, cs + z) for x, z in pts] + [(ca + x, eave - 2.35, cs + z) for x, z in pts])
    if double:
        eave2, R2 = double
        dtop = 2.3
        skirt = Hip(ca, cs, hx, hz, eave, R * 1.25, D=hz - 0.05, top=dtop)
        skirt.slab('gold')
        skirt.rolls('gold', 0.65)
        skirt.hips('gold')
        ux, uz = hx - dtop - 0.5, hz - dtop - 0.5
        ytop_skirt = eave + skirt.F(dtop)
        box('plaster_red', ca - ux, ca + ux, ytop_skirt - 0.6, eave2 - 0.8, cs - uz, cs + uz)
        box('pema', ca - ux - 0.1, ca + ux + 0.1, eave2 - 1.8, eave2 - 0.9, cs - uz - 0.1, cs + uz + 0.1)
        brackets(ca, cs, ux, uz, eave2 - 0.8, eave2 - 0.05)
        roof = Hip(ca, cs, ux + 1.2, uz + 1.2, eave2, R2)
    else:
        roof = Hip(ca, cs, hx, hz, eave, R)
    roof.slab('gold')
    roof.rolls('gold', 0.6)
    roof.hips('gold')
    return roof.ridge('gold', finial)


def gyaltsen(a, s, y, h=2.8):
    """Gilt victory banner (gyaltsen) standing on a parapet."""
    lathe('gold', a, s, [(0.28, y), (0.28, y + 0.15 * h), (0.52, y + 0.2 * h), (0.58, y + 0.7 * h), (0.62, y + 0.74 * h),
                         (0.42, y + 0.84 * h), (0.16, y + 0.92 * h), (0.04, y + h)], 10)


def black_banner(a, s, y, h=2.6):
    """Black yak-hair victory banner: a black drum with a white band, a gilt trident tip [photo p04, p13]."""
    lathe('canvas_black', a, s, [(0.42, y), (0.46, y + 0.1 * h), (0.46, y + 0.72 * h), (0.3, y + 0.8 * h)], 10)
    lathe('canvas', a, s, [(0.49, y + 0.3 * h), (0.49, y + 0.42 * h)], 10)
    lathe('gold', a, s, [(0.08, y + 0.8 * h), (0.06, y + 0.95 * h), (0.2, y + 1.0 * h), (0.02, y + 1.15 * h)], 6)


def gallery(F, t0, t1, y0, n, sh, pink=True, yellow=True):
    """A column of stacked timber galleries on the Red Palace [photo p04, p05, p13]: each storey a wide opening
    hung with a yellow curtain, a projecting red balcony with a rail, and a pink-and-white valance above."""
    for i in range(n):
        yb = y0 + i * sh
        yt = yb + sh - 0.75
        F.hexa('canvas_yellow' if yellow else 'glass', t0 + 0.3, t1 - 0.3, yb + 0.25, yt, -0.4, 0.05)
        for t in (t0 + (t1 - t0) / 3, t0 + 2 * (t1 - t0) / 3):
            F.hexa('wood', t - 0.09, t + 0.09, yb + 0.25, yt, -0.1, 0.25)
        F.hexa('wood_red', t0, t1, yb - 0.05, yb + 0.25, -0.1, 0.95)          # balcony floor
        F.hexa('wood_red', t0 + 0.05, t1 - 0.05, yb + 0.25, yb + 1.05, 0.8, 0.92)  # rail
        F.hexa('wood_red', t0 - 0.2, t1 + 0.2, yt, yt + 0.28, -0.1, 0.9)       # lintel
        F.hexa('canvas_pink' if pink else 'canvas', t0 - 0.12, t1 + 0.12, yt - 0.85, yt, 0.8, 0.88)  # valance
        F.hexa('canvas', t0 - 0.12, t1 + 0.12, yt - 0.97, yt - 0.85, 0.8, 0.88)
    F.hexa('paint_black', t0 - 0.35, t0, y0 - 0.2, y0 + n * sh - 0.4, -0.1, 0.3)
    F.hexa('paint_black', t1, t1 + 0.35, y0 - 0.2, y0 + n * sh - 0.4, -0.1, 0.3)


def curtain_stack(F, t0, t1, y0, n, th):
    """The tiered black yak-hair curtains over the stair-head entrance [photo p02, p09, p13, p18]: black panels
    with white stripes, each tier under its own small canopy; the doorway at the foot has a real reveal."""
    for i in range(n):
        yb = y0 + 5.0 + i * th
        F.hexa('canvas_black', t0, t1, yb, yb + th - 0.3, 0.1, 0.35)
        for f in (0.25, 0.6):
            F.hexa('canvas', t0, t1, yb + f * th, yb + f * th + 0.16, 0.34, 0.4)
        F.hexa('canvas_black', t0 - 0.2, t1 + 0.2, yb + th - 0.45, yb + th - 0.15, 0.1, 1.0)
        F.hexa('canvas', t0 - 0.2, t1 + 0.2, yb + th - 0.6, yb + th - 0.45, 0.9, 1.0)
    # the doorway: dark opening, heavy black-painted surround, red lintel
    tc, w = (t0 + t1) / 2, 3.0
    F.hexa('glass', tc - w / 2, tc + w / 2, y0, y0 + 4.3, -0.3, 0.05)
    F.ring('paint_black', [(tc - w / 2 - 0.7, y0 - 0.05), (tc + w / 2 + 0.7, y0 - 0.05), (tc + w / 2 + 0.5, y0 + 4.7), (tc - w / 2 - 0.5, y0 + 4.7)],
           [(tc - w / 2, y0), (tc + w / 2, y0), (tc + w / 2, y0 + 4.3), (tc - w / 2, y0 + 4.3)], -0.1, 0.9)
    F.hexa('wood_red', tc - w / 2 - 0.8, tc + w / 2 + 0.8, y0 + 4.7, y0 + 5.0, -0.1, 1.2)


# ------------------------------------------------------------------ the palace


def build():
    global m, G
    m = Model(ID)
    G = survey_ground(*m.spec['centre'])
    print(f'datum y0 = {G["y0"]:.2f} m a.s.l. (bare-earth ground, as the route build places it); '
          f'golden roof tip {G["y0"] + TOP:.1f} m', flush=True)

    def point(p):
        a, y, s = p
        return (a * CT - s * ST, y, a * ST + s * CT)
    m.point = point

    # colours from the photographs (linear RGB)
    for key, color, metal, rough in [
            ('plaster_white', (.82, .80, .74), 0, .9), ('plaster_red', (.21, .022, .016), 0, .88),
            ('plaster_yellow', (.70, .40, .06), 0, .85), ('pema', (.105, .022, .015), 0, .95),
            ('gold', (.80, .52, .13), .9, .28), ('paint_black', (.02, .018, .017), 0, .6),
            ('paint_tan', (.52, .42, .30), 0, .9),
            ('glass', (.025, .02, .018), .2, .3), ('wood', (.12, .035, .02), 0, .7),
            ('wood_red', (.26, .03, .02), 0, .6), ('canvas', (.80, .77, .70), 0, .9),
            ('canvas_black', (.02, .018, .016), 0, .95), ('canvas_yellow', (.78, .50, .08), 0, .85),
            ('canvas_pink', (.72, .16, .18), 0, .85), ('stone', (.42, .40, .36), 0, .85),
            ('adobe', (.36, .33, .29), 0, .95)]:
        m.material(key, color, metal, rough)

    std = dict(sp=3.4, sh=3.3, w=1.2, h=1.6)
    big = dict(sp=3.6, sh=3.4, w=1.45, h=1.9)
    red = dict(sp=3.4, sh=3.2, w=1.05, h=1.5, valance=False)   # red-wall windows: black frames, no white valance [photo p04]

    # ---- stairways first, so windows never sit behind them. [photo p01, p02, p19]: three long flights
    # switch back up the east half to the stair-head entrance; a west system climbs to the central terraces.
    print('stairways:', flush=True)
    flight('E0', 198, 110, 3.0, 19.0, 47.0, 55.0)
    landing('L0', 102, 110, 19.0, 39.0, 55.0, 'W')
    flight('E1', 110, 182, 19.0, 32.0, 39.0, 47.0)
    landing('L1', 182, 190, 32.0, 31.0, 47.0, 'E')
    flight('E2', 182, 36, 32.0, 50.0, 31.0, 39.0)
    landing('LT', 16, 36, 50.0, 24.0, 40.0)
    flight('W0', 14, -66, 14.0, 30.0, 48.0, 55.0)
    landing('LW0', -73, -66, 30.0, 40.0, 55.0, 'W')
    flight('W1', -66, -16, 30.0, 40.0, 40.0, 48.0)
    landing('LW1', -22, -16, 40.0, 28.0, 48.0, 'E')
    flight('W2', -16, 16, 40.0, 50.0, 28.0, 36.0)
    path_stair('WS', [(-150, 46), (-168, 48), (-176, 62), (-186, 70), (-187, 80), (-188, 90), (-189, 100), (-190, 108)])

    # ---- the palace blocks, west to east along the ridge. Tops scaled off the south elevation [photo p01]
    W = dict(std)
    # the west end steps down the ridge; west-wing tops averaged between p01 (camera west of centre) and ref04
    # (camera east of centre, from Beijing Middle Road): about level with the central base [photo p06, p14, ref03]
    Blk('west_end', -178, -160, 2, 34, 60, pema=1.4, win=dict(W, full=3, vents=2))
    Blk('west_back', -160, -130, -4, 22, 72, pema=1.6, win=dict(W, full=4, vents=2))
    Blk('west_front', -160, -96, 22, 40, 68, pema=1.6, win=dict(W, full=4, vents=3))
    Blk('west_front_e', -96, -80, 18, 38, 66, pema=1.6, win=dict(W, full=3, vents=3))
    Blk('namgyal', -130, -96, -10, 22, 80, pema=2.2, win=dict(W, full=5, vents=2))
    Blk('yellow_w', -96, -86, -14, 8, 85, mat='plaster_yellow', pema=2.4, win=dict(red, full=4))
    # Red Palace (Potrang Marpo): strongly battered crimson mass, top stepped west-low to east-high [photo p05]
    Blk('red_wing_w', -86, -72, -30, 6, 88.5, mat='plaster_red', k=0.1, pema=3.2, win=dict(red, full=6), gold=5.0)
    Blk('red_w', -72, -54, -40, 14, 91.5, mat='plaster_red', k=0.11, pema=3.8, win=dict(red, full=8, gold_sides='S'), gold=6.0)
    Blk('red_c', -54, -36, -40, 14, 93.3, mat='plaster_red', k=0.11, pema=3.8,
        win=dict(red, full=8, blank=[('S', -51.5, -41.5, 60, 95)], gold_sides='S'), gold=0)
    Blk('red_e', -36, -18, -40, 14, 94.5, mat='plaster_red', k=0.11, pema=3.8, win=dict(red, full=8, gold_sides='S'), gold=6.0)
    Blk('red_north', -66, -8, -56, -40, 80, pema=2.0, win=dict(W, full=5, vents=2))
    Blk('yellow_e', -18, -6, -28, 6, 90.5, mat='plaster_yellow', pema=2.6, win=dict(red, full=5))
    # the central white base: one massive battered block under the red [photo p01, p05, p13; zh: lower storeys
    # are retaining walls built up from the rock]
    Blk('red_base', -80, -12, -6, 20, 66.0, k=0.12, pema=1.8, win=dict(W, sp=4.2, full=3, vents=4, vsh=2.6, skip=0.0))
    # White Palace (Potrang Karpo) east of the red: its lower front block with the big window grid, the
    # stair-head tower with the black curtains, the tall palace and the Sunlight Hall on top [photo p01, p04, p13]
    Blk('wp_front', -12, 16, -8, 21, 74.0, pema=2.2, win=dict(big, full=6, vents=3, skip=0.0))
    Blk('stairhead', 16, 28, -6, 20, 77.0, pema=2.0, win=dict(W, full=2), sides='NEW')
    Blk('white_palace', 28, 82, -34, 18, 83.5, pema=3.0, win=dict(W, full=9, vents=3), gold=8.0)
    Blk('sunlight_hall', 38, 72, -28, 0, 87.5, pema=2.6, win=dict(sp=3.2, sh=3.4, w=1.7, h=2.0, full=1))
    # east wing, stepping down to the east round bastion and the east gate tower [photo p01, p19]
    Blk('east_wing', 82, 132, -6, 26, 71.0, pema=1.6, win=dict(W, full=5, vents=3))
    Blk('ds_north', 70, 116, -30, -20, 44.0, pema=1.4, win=dict(W, full=3))
    Blk('ds_east', 116, 132, -20, -6, 44.0, pema=1.4, win=dict(W, full=3))
    Blk('east_2', 132, 166, -4, 24, 58.0, pema=1.6, win=dict(W, full=4, vents=3))
    Blk('east_tower', 182, 200, 4, 27, 36.0, pema=1.6, win=dict(W, full=5, vents=2))
    for b in BLOCKS:
        print(f'  block {b.name}: base {b.yb:.1f}, roof {b.yt:.1f}', flush=True)

    print('blocks:', flush=True)
    for b in BLOCKS:
        b.build()
    flight_vents()
    drum('west_drum', -152.0, 17.0, 8.5, 80.0)     # the west end of the upper palace [photo ref00, ref01, ref03, p14]
    drum('east_bastion', 172.0, 17.0, 9.5, 50.0)

    # ---- Red Palace front: the gallery column, top-storey galleries, gilt medallions, banners on the parapet
    B = {b.name: b for b in BLOCKS}
    rc = B['red_c']
    F = Face(rc, 'S')
    gallery(F, -51.0, -42.0, 66.8, 7, 3.2)
    for name, t0, t1 in (('red_w', -66.5, -61.5), ('red_e', -31.5, -26.5)):
        Fb = Face(B[name], 'S')
        gallery(Fb, t0, t1, B[name].yc - B[name].pema - 3.6 - 3.3, 2, 3.3)
    Fw = Face(B['red_wing_w'], 'S')
    gallery(Fw, -82.0, -76.0, 72.0, 4, 3.3)
    for t in (-56.5, -52.5, -40.5, -36.5):
        blk = rc if -54 <= t <= -36 else B['red_w']
        Fm = Face(blk, 'S')
        Fm.disc('gold', t, blk.yc - blk.pema / 2, 0.05, 0.36, 1.05, 16)
    for name in ('red_wing_w', 'red_w', 'red_c', 'red_e'):
        b = B[name]
        o = b.k * 0.0
        n = max(2, int((b.a1 - b.a0) / 4.6))
        for i in range(n + 1):
            a = b.a0 + 0.6 + (b.a1 - b.a0 - 1.2) * i / n
            (gyaltsen if i % 2 else black_banner)(a, b.s1 + 0.1, b.yt, 2.6)
    for a, s in ((-71.4, -39.4), (-18.6, -39.4)):
        gyaltsen(a, s, B['red_w'].yt if a < -50 else B['red_e'].yt)
    wp = B['white_palace']
    for i in range(7):
        a = wp.a0 + 1 + (wp.a1 - wp.a0 - 2) * i / 6
        (gyaltsen if i % 2 else black_banner)(a, wp.s1 + 0.1, wp.yt, 2.3)
    sh = B['sunlight_hall']
    for a, s in ((38.4, -0.4), (71.6, -0.4)):
        gyaltsen(a, s, sh.yt, 2.2)
    for name in ('namgyal', 'wp_front', 'east_wing'):
        b = B[name]
        for a in (b.a0 + 0.6, b.a1 - 0.6):
            black_banner(a, b.s1 + 0.1, b.yt, 2.0)

    # ---- the stair-head entrance: tiered black curtains over the door at the top landing [photo p09, p18]
    Fs = Face(B['stairhead'], 'S')
    curtain_stack(Fs, 17.5, 26.5, 50.0, 5, 4.1)

    # ---- Deyang Shar: the east courtyard between the White Palace and the east wing, with the White Palace's
    # columned east porch (seen from the route's finish on the north-west only in glimpses)
    lo, hi = ground_range(82, 116, -20, -6)
    yc = hi + 0.3
    box('stone', 82, 116, max(0.0, lo - 3), yc, -20, -6)
    for s in (-16.0, -13.0, -10.0):
        lathe('wood_red', 84.4, s, [(0.32, yc), (0.3, yc + 7.0)], 8)
        box('wood', 84.0, 84.8, yc + 7.0, yc + 7.5, s - 0.4, s + 0.4)
    box('wood', 82.0, 85.2, yc + 7.5, yc + 8.1, -18.0, -8.0)
    box('pema', 82.0, 85.4, yc + 8.1, yc + 9.0, -18.2, -7.8)
    box('plaster_white', 82.0, 85.6, yc + 9.0, yc + 9.4, -18.4, -7.6)
    box('canvas_black', 82.0, 82.3, yc, yc + 6.8, -15.0, -11.0)

    # ---- the golden roofs over the stupa halls [zh: five stupa halls, the 5th Dalai Lama's the largest, the
    # 13th's at the west end], set on the back and west of the Red Palace roof so the south parapet hides most of
    # them from the Square [photo p01, p06, p07, p12, p14]
    rw, rcb, re_ = B['red_w'], B['red_c'], B['red_e']
    tips = [golden_hall(-47, -20, 8.0, 6.2, rcb.yc, 97.0, 1.7, TOP, double=(99.2, 1.7)),
            golden_hall(-79, -12, 5.6, 4.8, B['red_wing_w'].yc, 94.4, 2.4, 99.8),
            golden_hall(-64, -30, 5.4, 4.4, rw.yc, 96.0, 2.3, 101.0),
            golden_hall(-28, -28, 5.4, 4.4, re_.yc, 97.4, 2.3, 102.2),
            golden_hall(-47, -36, 4.6, 3.4, rcb.yc, 96.2, 2.0, 100.6)]
    print('golden roof ridges', [round(t, 1) for t in tips], flush=True)
    golden_hall(48, -16, 4.6, 3.8, sh.yc, 91.0, 2.0, 94.4)
    golden_hall(63, -16, 3.8, 3.2, sh.yc, 90.6, 1.8, 93.4)

    # ---- clearance against the Shöl buildings the pipeline builds from OSM
    rects = [(b.a0 - b.k * (b.yc - b.yb), b.a1 + b.k * (b.yc - b.yb), b.s0 - b.k * (b.yc - b.yb), b.s1 + b.k * (b.yc - b.yb)) for b in BLOCKS]
    rects += [(o[0], o[1], o[2], o[3] + 1.5) for o in OCCLUDERS]

    def inside(ring, x, y):
        c = False
        for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
            if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
                c = not c
        return c
    for oid, ring in G['others']:
        xs, ys = [p[0] for p in ring], [p[1] for p in ring]
        hit = 0
        for i in range(int(min(xs)), int(max(xs)) + 1):
            for j in range(int(min(ys)), int(max(ys)) + 1):
                x, y = i + 0.5, j + 0.5
                if inside(ring, x, y) and any(r[0] <= x <= r[1] and r[2] <= y <= r[3] for r in rects):
                    hit += 1
        if hit > 1:
            print(f'  WARNING overlaps OSM building {oid}: ~{hit} m2', flush=True)
    print(f'checked clearance against {len(G["others"])} nearby OSM buildings (Shöl etc.)', flush=True)
    return m


def render_views(model, directory):
    """Preview renders with the route's own (bare-earth) hill under the palace and the car's eye on Beijing
    Middle Road."""
    scene = bpy.context.scene
    g = G
    for obj in [o for o in bpy.data.objects if o.name.startswith('Plane')]:
        bpy.data.objects.remove(obj, do_unlink=True)   # the flat preview ground sits above the road here
    verts, faces = [], []
    for j in range(g['ns']):
        for i in range(g['na']):
            a, s = g['a0'] + i * g['step'], g['s0'] + j * g['step']
            verts.append(xyz(model.point((a, g['h'][j][i] - 0.15, s))))
    for j in range(g['ns'] - 1):
        for i in range(g['na'] - 1):
            q = j * g['na'] + i
            faces.append((q, q + 1, q + 1 + g['na'], q + g['na']))
    mesh = bpy.data.meshes.new('hill')
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new('hill', mesh)
    mat = bpy.data.materials.new('hill')
    mat.diffuse_color = (.30, .22, .14, 1)
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.30, .22, .14, 1)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    # export frame (+X east, +Z south): Beijing Middle Road runs east-west ~307 m south of the anchor, ~9.5 m
    # below the datum
    views = [('raceline-east', (260, -8.0, 306), (-20, 55, 0), 30),
             ('raceline-front', (-40, -8.0, 307), (-20, 55, 0), 30),
             ('raceline-west', (-330, -8.0, 300), (0, 50, 0), 30),
             ('detail-front', (-40, 40, 150), (-20, 65, 0), 35),
             ('finish-northwest', (-184, -9.5, -391), (0, 50, 0), 30)]
    for label, pos, aim, lens in views:
        loc = Vector(xyz(pos))
        target = Vector(xyz(aim))
        bpy.ops.object.camera_add(location=loc)
        cam = bpy.context.object
        cam.rotation_euler = (target - loc).to_track_quat('-Z', 'Y').to_euler()
        cam.data.type = 'PERSP'
        cam.data.lens = lens
        cam.data.clip_end = 5000
        scene.camera = cam
        scene.render.filepath = str(directory / (ID + '-' + label + '.png'))
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--render-dir', type=Path)
    parser.add_argument('--no-views', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    model = build()
    directory = None if args.render_dir is None else (args.render_dir if args.render_dir.is_absolute() else ROOT / args.render_dir)
    model.finish(directory)
    if directory and not args.no_views:
        render_views(model, directory)
