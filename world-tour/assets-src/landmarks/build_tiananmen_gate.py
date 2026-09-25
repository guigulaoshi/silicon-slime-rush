"""Tiananmen (Gate of Heavenly Peace), Beijing: gate tower, rostrum platform and its forecourt.

Original geometry authored from public facts and photographs used for comparison only
(no image or third-party mesh is shipped). Photos (Wikimedia Commons):
  File:Front_view_of_Tiananmen_gate_from_north_end_of_Tiananmen_Square.jpg  (far telephoto; heights)
  File:20090528_Beijing_Tiananmen_7642.jpg, 7655.jpg, 7628.jpg                (from Chang'an Ave)
  File:Tiananmen_Gate_view_from_southeast.jpg, Flickr archer10 China-6117/6123/6126
  File:Huabiao_(Tiananmen).jpg, Huabiao_pole_near_Gate_of_Heavenly_Peace.jpg, Tiananmen_pillar.jpg
  File:Tiananmen_lions.jpg, Tianang_Mei-Pekin-China8469.JPG, Tiananmen_Square_21_(4934524035).jpg
Public data: total height 34.7 m, platform 13 m (zh.wikipedia 天安门, Sohu); central gateway 5.25 m
wide (建筑之窗); portrait frame 6.4 x 5.0 m, slogans 30 m long; outer Jinshui bridges are five
three-arch white-marble bridges (zh.wikipedia 金水桥); huabiao 9.57 m tall, shaft 0.98 m (网易).
Footprint (OSM relation 8847697, the platform) and height are owned by pipeline/landmarks.json.
Bridge, huabiao and river positions come from OSM (bridges 637833012-16, river 523763740, huabiao
nodes 6013096562/6013107811/6015523774/6015524394), shifted 3.85 m east onto the gate axis.
Vertical layout measured on the far telephoto photo (13.4 px/m from the portrait width) up from the
coping at 13.5 m: lower eave 20.9, upper eave 25.7, ridge top 32.5, chiwen top 34.7 m.
The portrait frame is EMPTY and the two slogan boards are blank: no likeness, no text, no emblem.
Authoring frame: x east along the gate, y up, z south (the famous face is +z), metres,
origin at the platform centre. Run:
  Blender --background --python assets-src/landmarks/build_tiananmen_gate.py -- --render-dir <dir>
"""
import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model, ROOT
from build_moffett_aircraft import xyz
import bpy
from mathutils import Vector, Matrix

ID = 'tiananmen-gate'
m = None
SECTION = ['start']
TALLY = {}
_PRIM = {'add', 'prism', 'box', 'fbox', 'elev', 'sweep', 'cylinder', 'ellipsoid', 'tube', 'mesh', 'patch', 'shell', 'counted'}


def sec(name):
    SECTION[0] = name


def install_tally(model):
    import inspect
    raw = model.mesh

    def counted(label, vertices, faces, material, smooth=False):
        fn = next((f.function for f in inspect.stack()[1:] if f.function not in _PRIM), '?')
        key = SECTION[0] + '/' + fn
        TALLY[key] = TALLY.get(key, 0) + sum(len(f) - 2 for f in faces)
        raw(label, vertices, faces, material, smooth)
    model.mesh = counted

# ------------------------------------------------------------------ primitives (x east, y up, z south)


def add(mat, verts, faces, smooth=False):
    m.mesh('part', verts, faces, mat, smooth)


def prism(mat, outline, y0, y1):
    """Vertical extrusion of a simple plan polygon [(x, z)]."""
    n = len(outline)
    assert y1 > y0 + 1e-4, (y0, y1)
    v = [(x, y0, z) for x, z in outline] + [(x, y1, z) for x, z in outline]
    f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    add(mat, v, f)


def box(mat, x0, x1, y0, y1, z0, z1):
    assert x1 > x0 + 1e-4 and z1 > z0 + 1e-4, (x0, x1, z0, z1)
    prism(mat, [(x0, z0), (x1, z0), (x1, z1), (x0, z1)], y0, y1)


def elev(mat, outline, mapfn):
    """Extrude a simple polygon [(a, y)] between two mapped copies (k = 0 front, 1 back)."""
    n = len(outline)
    v = [mapfn(a, y, 0) for a, y in outline] + [mapfn(a, y, 1) for a, y in outline]
    f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    add(mat, v, f)


FACES = {'S': ((1, 0), (0, 1)), 'N': ((-1, 0), (0, -1)), 'E': ((0, -1), (1, 0)), 'W': ((0, 1), (-1, 0))}


def fpt(face, a, o):
    """Plan point in a face frame: a along the face, o outward from the building centre."""
    t, n = FACES[face]
    return (n[0] * o + t[0] * a, n[1] * o + t[1] * a)


def fbox(mat, face, off, a0, a1, y0, y1, o0, o1, cx=0.0, cz=0.0):
    assert a1 > a0 + 1e-4 and o1 > o0 + 1e-4, (a0, a1, o0, o1)
    pts = [fpt(face, a, off + o) for a, o in ((a0, o0), (a1, o0), (a1, o1), (a0, o1))]
    prism(mat, [(cx + x, cz + z) for x, z in pts], y0, y1)


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


def cylinder(mat, cx, cz, y0, y1, r0, r1, sides=16, smooth=True):
    v = []
    for y, r in ((y0, r0), (y1, r1)):
        v += [(cx + r * math.cos(j * math.tau / sides), y, cz + r * math.sin(j * math.tau / sides)) for j in range(sides)]
    f = [tuple(reversed(range(sides))), tuple(range(sides, 2 * sides))]
    f += [(j, (j + 1) % sides, (j + 1) % sides + sides, j + sides) for j in range(sides)]
    add(mat, v, f, smooth)


def ellipsoid(mat, c, r, nlat=8, nlon=12, rot=None):
    rot = rot or Matrix.Identity(3)
    c = Vector(c)
    v = []
    for i in range(1, nlat):
        phi = math.pi * i / nlat
        for j in range(nlon):
            th = math.tau * j / nlon
            v.append(tuple(c + rot @ Vector((math.sin(phi) * math.cos(th) * r[0], math.cos(phi) * r[1],
                                              math.sin(phi) * math.sin(th) * r[2]))))
    top = len(v)
    v.append(tuple(c + rot @ Vector((0, r[1], 0))))
    bot = len(v)
    v.append(tuple(c + rot @ Vector((0, -r[1], 0))))
    f = []
    for i in range(nlat - 2):
        for j in range(nlon):
            a = i * nlon + j
            b = i * nlon + (j + 1) % nlon
            f.append((a, b, b + nlon, a + nlon))
    last = (nlat - 2) * nlon
    for j in range(nlon):
        f.append((top, (j + 1) % nlon, j))
        f.append((bot, last + j, last + (j + 1) % nlon))
    add(mat, v, f, True)


def tube(mat, pts, r, sides=6):
    m.tube('part', pts, r, mat, sides)


def rot_x(angle):
    return Matrix.Rotation(angle, 3, 'X')


def lathe(mat, cx, cz, y0, prof, sides=8, smooth=True, phase=0.0):
    """Closed solid of revolution about a vertical axis; prof = [(radius, dy)] bottom to top.
    A zero radius at either end closes with a pole, otherwise with a flat cap."""
    rings = []
    verts = []
    for r, dy in prof:
        if r < 1e-4:
            rings.append([len(verts)])
            verts.append((cx, y0 + dy, cz))
        else:
            rings.append(list(range(len(verts), len(verts) + sides)))
            verts += [(cx + r * math.cos(phase + j * math.tau / sides), y0 + dy,
                       cz + r * math.sin(phase + j * math.tau / sides)) for j in range(sides)]
    faces = []
    if len(rings[0]) > 1:
        faces.append(tuple(reversed(rings[0])))
    if len(rings[-1]) > 1:
        faces.append(tuple(rings[-1]))
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            faces += [(a[0], b[(j + 1) % sides], b[j]) for j in range(sides)]
        elif len(b) == 1:
            faces += [(a[j], a[(j + 1) % sides], b[0]) for j in range(sides)]
        else:
            faces += [(a[j], a[(j + 1) % sides], b[(j + 1) % sides], b[j]) for j in range(sides)]
    add(mat, verts, faces, smooth)


BULB = [(0.62, 0.0), (0.66, 0.05), (0.5, 0.1), (0.62, 0.17), (0.7, 0.3), (0.62, 0.44), (0.38, 0.55), (0.2, 0.62), (0.0, 0.68)]


def bulb_post(mat, x, z, y0, h, post, sides=6):
    """Square marble post with the onion-shaped (flame-pearl) head of Beijing imperial balustrades."""
    box(mat, x - post / 2, x + post / 2, y0, y0 + h, z - post / 2, z + post / 2)
    lathe(mat, x, z, y0 + h - 0.01, [(post * r, post * 1.55 * dy) for r, dy in BULB], sides, True, math.pi / sides)

# ------------------------------------------------------------------ Chinese roof


class Roof:
    """Concave hipped roof around a rectangle: a skirt (top = d of its upper edge) or a ridged
    roof whose end slopes stop at dg (hip-and-gable when a gable is added, plain hip otherwise).

    d is the plan distance in from the eave line. The eave flares out and up towards the corners
    (upturned eaves); tiles, rafters, ridges and beasts all sample pt(), so they follow one surface."""

    def __init__(self, cx, cz, hx, hz, D, y0, R, top=None, dg=None, ov=0.0, lift=1.0,
                 out=0.7, Lc=9.0, Ld=4.5, a=0.45, p=2.2, thick=0.35):
        self.cx, self.cz, self.hx, self.hz, self.D, self.y0, self.R = cx, cz, hx, hz, D, y0, R
        self.top, self.dg, self.ov, self.lift, self.out, self.Lc, self.Ld = top, dg, ov, lift, out, Lc, Ld
        self.a, self.p, self.thick = a, p, thick

    def F(self, d):
        u = min(max(d / self.D, 0.0), 1.0)
        return self.R * (self.a * u + (1 - self.a) * u ** self.p)

    def pt(self, side, t, d):
        long_ = side in 'SN'
        half, other = (self.hx, self.hz) if long_ else (self.hz, self.hx)
        q = max(0.0, (half - d) - abs(t))
        c = max(0.0, 1 - q / self.Lc) ** 2 * max(0.0, 1 - max(d, 0.0) / self.Ld) ** 1.5
        y = self.y0 + self.F(d) + self.lift * c
        o = other - d + self.out * c
        a = t + math.copysign(self.out * c, t)
        x, z = fpt(side, a, o)
        return (self.cx + x, y, self.cz + z)

    def hip_pt(self, sx, sz, d, lift=0.0):
        side = 'S' if sz > 0 else 'N'
        t = sx * (self.hx - d) if sz > 0 else -sx * (self.hx - d)
        x, y, z = self.pt(side, t, d)
        return (x, y + lift, z)

    def half(self, side):
        return self.hx if side in 'SN' else self.hz

    def slab(self, mat):
        for side in 'SNEW':
            long_ = side in 'SN'
            half = self.half(side)
            if self.top is not None:
                segs = [(0.0, self.top, False)]
            else:
                segs = [(0.0, self.dg, False)] + ([(self.dg, self.D, True)] if long_ else [])
            for d0, d1, upper in segs:
                nv = max(3, int((d1 - d0) / 0.7) + 2)
                nu = max(3, int(2 * half / 0.9) + 1)
                rows = []
                for i in range(nv):
                    d = d0 + (d1 - d0) * i / (nv - 1)
                    w = (half - self.dg + self.ov) if upper else (half - d)
                    rows.append([self.pt(side, -w + 2 * w * j / (nu - 1), d) for j in range(nu)])
                m.patch('roof', rows, (0, -self.thick, 0), mat)

    def tiles(self, mat, sp=0.56, r=0.11):
        """Round cover-tile rolls from the eave (their caps are the eave tile ends) up the slope."""
        for side in 'SNEW':
            long_ = side in 'SN'
            half = self.half(side)
            n = int(2 * half / sp)
            for k in range(1, n):
                t = -half + 2 * half * k / n
                lim = half - abs(t) - 0.12
                runs = []
                if self.top is not None:
                    runs.append((-0.08, min(self.top - 0.3, lim)))
                elif long_:
                    if abs(t) <= half - self.dg - 0.12:
                        runs.append((-0.08, self.D - 0.45))
                    else:
                        runs.append((-0.08, min(lim, self.dg)))
                        if abs(t) <= half - self.dg + self.ov - 0.2:
                            runs.append((self.dg + 0.1, self.D - 0.45))
                else:
                    runs.append((-0.08, min(lim, self.dg - 0.25)))
                for d0, d1 in runs:
                    if d1 - d0 < 0.4:
                        continue
                    nseg = max(1, math.ceil((d1 - d0) / 1.3))
                    pts = []
                    for i in range(nseg + 1):
                        x, y, z = self.pt(side, t, d0 + (d1 - d0) * i / nseg)
                        pts.append((x, y + r * 0.6, z))
                    tube(mat, pts, r, 5)

    def rafters(self, mat_round, mat_fly, inner):
        """Two tiers of rafter ends under the eave: square flying rafters over round rafters."""
        for side in 'SNEW':
            half = self.half(side)
            span = half - 0.35
            n = int(2 * span / 0.4)
            for k in range(n + 1):
                t = -span + 2 * span * k / n
                lim = half - abs(t) - 0.1
                d0, d1 = 0.06, min(1.7, lim)
                if d1 - d0 > 0.3:
                    pts = [self.pt(side, t, d) for d in (d0, (d0 + d1) / 2, d1)]
                    sweep(mat_fly, [(x, y - self.thick - 0.09, z) for x, y, z in pts], 0.15, 0.16, True)
                d0, d1 = 0.85, min(inner, lim)
                if d1 - d0 > 0.3:
                    pts = [self.pt(side, t, d) for d in (d0, d1)]
                    tube(mat_round, [(x, y - self.thick - 0.27, z) for x, y, z in pts], 0.085, 6)

    def hips(self, mat, beasts_mat, w=0.46, h=0.55, beasts=9):
        """Hip ridges down to the upturned corners, corner beast caps, immortal and ridge beasts."""
        dtop = self.top if self.top is not None else self.dg
        for sx in (1, -1):
            for sz in (1, -1):
                pts = [self.hip_pt(sx, sz, dtop * (1 - i / 14) - (0.05 if i == 14 else 0.0), -0.06) for i in range(15)]
                sweep(mat, pts, w, h)
                tip = Vector(self.hip_pt(sx, sz, -0.1))
                inner = Vector(self.hip_pt(sx, sz, 0.9))
                sweep(mat, [tuple(inner + Vector((0, -self.thick - 0.55, 0))),
                            tuple(tip + Vector((0, -self.thick - 0.45, 0)))], 0.34 * w / 0.46, 0.36 * w / 0.46, True)
                for k in range(beasts + 1):
                    d = 0.32 + k * 0.30
                    if d > dtop - 0.6:
                        break
                    p = Vector(self.hip_pt(sx, sz, d, h - 0.08))
                    q = Vector(self.hip_pt(sx, sz, d - 0.2, h - 0.08))
                    dirn = q - p
                    dirn.y = 0
                    dirn.normalize()
                    tall = (0.42 if k == 0 else 0.26) * w / 0.46
                    sweep(beasts_mat, [tuple(p - dirn * 0.12), tuple(p + dirn * 0.14)], 0.17 * w / 0.46, tall)
                    head = p + dirn * 0.12 + Vector((0, tall - 0.04, 0))
                    sweep(beasts_mat, [tuple(head), tuple(head + dirn * 0.15)], 0.13 * w / 0.46, 0.15 * w / 0.46)

    def ridge_top(self, mat, h=1.15, w=0.8):
        L = self.hx - self.dg + self.ov
        yr = self.y0 + self.F(self.D)
        box(mat, self.cx - L, self.cx + L, yr - 0.35, yr + 0.25, self.cz - w * 0.7, self.cz + w * 0.7)
        box(mat, self.cx - L, self.cx + L, yr + 0.25, yr + h - 0.15, self.cz - w / 2, self.cz + w / 2)
        tube(mat, [(self.cx - L, yr + h - 0.08, self.cz), (self.cx + L, yr + h - 0.08, self.cz)], 0.13, 8)
        return L, yr

    def gable_parts(self, mat_ridge, mat_board, mat_gable, mat_gold):
        """Hip-and-gable end: vertical ridges, bargeboards, gable triangle and the ridge at its foot."""
        hz, dg, D = self.hz, self.dg, self.D
        edge = self.hx - dg + self.ov
        for sx in (1, -1):
            for sz in (1, -1):
                side = 'S' if sz > 0 else 'N'
                sgn = sx if sz > 0 else -sx
                pts = [self.pt(side, (edge - 0.3) * sgn, D - (D - dg) * i / 10) for i in range(11)]
                sweep(mat_ridge, [(x, y - 0.05, z) for x, y, z in pts], 0.46, 0.62)
                pts = [self.pt(side, (edge - 0.05) * sgn, D - (D - dg) * i / 10) for i in range(11)]
                sweep(mat_board, [(x, y - 0.75, z) for x, y, z in pts], 0.14, 0.72)
            face = 'E' if sx > 0 else 'W'
            w = hz - dg
            sweep(mat_ridge, [self.pt(face, -w, dg - 0.02), self.pt(face, w, dg - 0.02)], 0.42, 0.42)
            xg = self.cx + sx * (self.hx - dg - 0.1)
            yb = self.y0 + self.F(dg) - 0.25
            top = [(z, self.y0 + self.F(hz - abs(z)) - self.thick * 0.6) for z in [w - 2 * w * i / 16 for i in range(17)]]
            outline = [(-w, yb), (w, yb)] + top[1:-1]
            elev(mat_gable, outline, lambda a, y, k: (xg - sx * 0.35 * k, y, self.cz + a))
            inner = [(z * 0.72, yb + 0.25 + (y - yb - 0.25) * 0.72) for z, y in outline]
            elev(mat_gold, inner, lambda a, y, k: (xg + sx * (0.06 - 0.1 * k), y, self.cz + a))
            # Gilded relief (photos 02/03/06): the gable reads as a field of raised gold scrollwork with
            # a central medallion, not a flat panel. Rows of low bosses inside the inset outline.
            def inside(pz, py, poly=inner):
                c = False
                for (z1, y1), (z2, y2) in zip(poly, poly[1:] + poly[:1]):
                    if (y1 > py) != (y2 > py) and pz < z1 + (py - y1) * (z2 - z1) / (y2 - y1):
                        c = not c
                return c
            ytop_ = max(py for _, py in inner)
            row = 0
            yy = yb + 0.55
            while yy < ytop_ - 0.3:
                off = 0.3 if row % 2 else 0.0
                zz = -w + off
                while zz < w:
                    if inside(zz, yy) and inside(zz - 0.3, yy - 0.25) and inside(zz + 0.3, yy + 0.25):
                        ellipsoid(mat_gold, (xg + sx * 0.08, yy, self.cz + zz), (0.09, 0.2, 0.26), 3, 6)
                    zz += 0.6
                yy += 0.5
                row += 1
            ellipsoid(mat_gold, (xg + sx * 0.12, yb + (ytop_ - yb) * 0.42, self.cz), (0.16, 0.7, 0.7), 4, 10)

    def skirt_top_ridge(self, mat, w=0.5, h=0.55):
        for side in 'SNEW':
            half = self.half(side) - self.top
            sweep(mat, [self.pt(side, -half - 0.25, self.top - 0.02), self.pt(side, half + 0.25, self.top - 0.02)], w, h)


def chiwen(mat, x_end, y0, cz, sx, scale=1.0, thick=0.6):
    """Stylised ridge-end dragon (鸱吻): mouth biting the ridge, tail curling outward."""
    outline = [(0.0, 0.0), (1.6, 0.0), (1.75, 0.9), (1.7, 1.8), (1.95, 2.5), (2.0, 3.0), (1.75, 3.4),
               (1.4, 3.3), (1.5, 2.9), (1.35, 2.5), (1.05, 2.6), (0.75, 2.9), (0.6, 2.6), (0.35, 2.3),
               (0.25, 1.6), (-0.25, 1.3), (-0.3, 0.95), (0.1, 0.85), (0.0, 0.5)]
    x_in = x_end - 1.75 * scale * sx
    elev(mat, [(a * scale, y * scale) for a, y in outline],
         lambda a, y, k: (x_in + sx * a, y0 + y, cz + (thick / 2 if k == 0 else -thick / 2)))


# ------------------------------------------------------------------ building blocks


def sumeru_ring(mat, hx, hz, y0, bands, cx=0.0, cz=0.0):
    """Sumeru (须弥座) base as stacked rectangular mouldings: [(height, outset)]; returns the top."""
    y = y0
    for dy, out in bands:
        box(mat, cx - hx - out, cx + hx + out, y, y + dy, cz - hz - out, cz + hz + out)
        y += dy
    return y


def balustrade(mat, pts, spacing=1.5, height=1.1, post=0.22, balusters=1):
    """Beijing marble balustrade (透瓶栏板) along base points: base rail, square posts with onion
    heads, a solid lower panel and an OPEN upper part where vase balusters carry the handrail."""
    P = [Vector(p) for p in pts]
    L = sum((P[i + 1] - P[i]).length for i in range(len(P) - 1))
    if L < 0.8:
        return
    n = max(1, round(L / spacing))

    def at(s):
        for i in range(len(P) - 1):
            seg = (P[i + 1] - P[i]).length
            if s <= seg or i == len(P) - 2:
                return P[i] + (P[i + 1] - P[i]) * min(1.0, s / max(seg, 1e-6))
            s -= seg
    sweep(mat, [tuple(p + Vector((0, -0.02, 0))) for p in P], post * 1.55, 0.16)
    posts = [at(L * i / n) for i in range(n + 1)]
    ph = height - 0.05
    for i, p in enumerate(posts):
        bulb_post(mat, p.x, p.z, p.y + 0.12, ph, post)
        if i < n:
            q = posts[i + 1]
            dirn = (q - p).normalized()
            a = p + dirn * post / 2
            b = q - dirn * post / 2
            lo = 0.14 + (height - 0.14) * 0.42
            sweep(mat, [tuple(a + Vector((0, 0.14, 0))), tuple(b + Vector((0, 0.14, 0)))], post * 0.45, lo - 0.14)
            sweep(mat, [tuple(a + Vector((0, height - 0.17, 0))), tuple(b + Vector((0, height - 0.17, 0)))], post * 0.62, 0.14)
            for k in range(balusters):
                c = a + (b - a) * (k + 1) / (balusters + 1)
                sweep(mat, [tuple(c - dirn * 0.07 + Vector((0, lo, 0))), tuple(c + dirn * 0.07 + Vector((0, lo, 0)))],
                      post * 0.5, height - 0.17 - lo)


def lattice_bay(face, off, a0, a1, y0, y1, door):
    """A bay of four lattice leaves (隔扇) over a dark backing; window bays stand on a sill wall."""
    fbox('glass', face, off, a0, a1, y0, y1, -0.24, -0.14)
    if not door:
        fbox('plaster_red', face, off, a0, a1, y0, y0 + 0.95, -0.3, 0.08)
        fbox('marble', face, off, a0 - 0.02, a1 + 0.02, y0 + 0.95, y0 + 1.05, -0.3, 0.12)
        y0 += 1.05
    else:
        fbox('paint_red', face, off, a0, a1, y0, y0 + 0.25, -0.12, 0.08)
        y0 += 0.25
    leaves = 4
    wl = (a1 - a0) / leaves
    split = y0 + (y1 - y0) * 0.38
    for i in range(leaves):
        b0 = a0 + i * wl
        b1 = b0 + wl
        fbox('paint_red', face, off, b0, b0 + 0.1, y0, y1, -0.07, 0.07)
        fbox('paint_red', face, off, b1 - 0.1, b1, y0, y1, -0.07, 0.07)
        fbox('paint_red', face, off, b0 + 0.1, b1 - 0.1, y1 - 0.12, y1, -0.07, 0.07)
        fbox('paint_red', face, off, b0 + 0.1, b1 - 0.1, y0, y0 + 0.12, -0.07, 0.07)
        top = y1 - 0.12
        if door:
            fbox('paint_red', face, off, b0 + 0.1, b1 - 0.1, split - 0.08, split + 0.08, -0.07, 0.07)
            fbox('paint_red', face, off, b0 + 0.1, b1 - 0.1, y0 + 0.12, split - 0.08, -0.04, 0.03)
            fbox('gold', face, off, b0 + 0.3, b1 - 0.3, y0 + 0.5, split - 0.4, 0.03, 0.05)
            bot = split + 0.08
        else:
            bot = y0 + 0.12
        for j in range(1, 4):
            a = b0 + 0.1 + (wl - 0.2) * j / 4
            fbox('paint_red', face, off, a - 0.025, a + 0.025, bot, top, -0.04, 0.04)
        nh = max(2, int((top - bot) / 0.42))
        for j in range(1, nh):
            y = bot + (top - bot) * j / nh
            fbox('paint_red', face, off, b0 + 0.1, b1 - 0.1, y - 0.025, y + 0.025, -0.04, 0.04)


def dougong_set(face, off, a, yb):
    """One bracket set (斗栱): bearing block, three tiers of crossed arms stepping outward, beam end."""
    fbox('paint_teal', face, off, a - 0.26, a + 0.26, yb, yb + 0.22, -0.26, 0.26)
    for k in range(3):
        y = yb + 0.22 + k * 0.24
        L = 0.9 + 0.35 * k
        o = k * 0.34
        mat = 'paint_blue' if k % 2 == 0 else 'paint_teal'
        fbox(mat, face, off, a - L / 2, a + L / 2, y, y + 0.19, o - 0.09, o + 0.09)
        fbox(mat, face, off, a - 0.09, a + 0.09, y, y + 0.19, -0.3, o + 0.44)
    y = yb + 0.22 + 3 * 0.24
    fbox('paint_blue', face, off, a - 0.09, a + 0.09, y, y + 0.2, -0.3, 1.18)


def bracket_ring(hx, hz, cols_x, cols_z, yb):
    """Bracket sets along a column ring, red panels between them and the eave beams on top."""
    for face in 'SNEW':
        long_ = face in 'SN'
        half = hx if long_ else hz
        off = hz if long_ else hx
        cols = sorted(cols_x if long_ else cols_z)
        pos = []
        for a0, a1 in zip(cols, cols[1:]):
            n = max(0, round((a1 - a0) / 1.3) - 1)
            pos += [a0 + (a1 - a0) * i / (n + 1) for i in range(n + 1)]
        pos.append(cols[-1])
        fbox('plaster_red', face, off, -half, half, yb + 0.22, yb + 0.95, -0.06, 0.06)
        for a in pos:
            dougong_set(face, off, a, yb)
        fbox('paint_teal', face, off, -half - 0.3, half + 0.3, yb + 0.94, yb + 1.1, -0.15, 0.15)
        fbox('paint_blue', face, off, -half - 1.2, half + 1.2, yb + 0.92, yb + 1.12, 1.05, 1.25)


def architrave_ring(hx, hz, cols_x, cols_z, y, deep=True):
    """Painted beams along a column ring (small beam, frieze, big beam, plate) with hexi panels."""
    for face in 'SNEW':
        long_ = face in 'SN'
        half = hx if long_ else hz
        off = hz if long_ else hx
        cols = sorted(cols_x if long_ else cols_z)
        if deep:
            fbox('paint_blue', face, off, -half - 0.2, half + 0.2, y - 1.45, y - 1.05, -0.18, 0.18)
            fbox('plaster_red', face, off, -half - 0.2, half + 0.2, y - 1.05, y - 0.85, -0.1, 0.1)
        fbox('paint_teal', face, off, -half - 0.25, half + 0.25, y - 0.85, y - 0.2, -0.25, 0.25)
        fbox('paint_blue', face, off, -half - 0.3, half + 0.3, y - 0.2, y, -0.31, 0.31)
        for a0, a1 in zip(cols, cols[1:]):
            c = (a0 + a1) / 2
            w = (a1 - a0) / 6
            for o0, o1 in ((0.25, 0.28), (-0.28, -0.25)):
                fbox('paint_blue', face, off, c - w, c + w, y - 0.78, y - 0.27, o0, o1)
                for e in (c - w, c + w):
                    fbox('gold', face, off, e - 0.06, e + 0.06, y - 0.83, y - 0.22, o0 - 0.002, o1 + 0.01)
            if deep:
                for col, sgn in ((a0, 1), (a1, -1)):
                    outline = [(0.0, 0.0), (1.25, 0.0), (0.9, -0.22), (0.45, -0.42), (0.0, -0.62)]

                    def mp(u, v, k, col=col, sgn=sgn, face=face, off=off):
                        x, z = fpt(face, col + sgn * (0.42 + u), off + (0.08 if k == 0 else -0.08))
                        return (x, y - 1.45 + v, z)
                    elev('gold', outline, mp)


# ------------------------------------------------------------------ forecourt pieces


def small_lion(x, y, z, face, scale):
    """Little seated lion on a lotus cushion, used on the corner posts of the huabiao railings."""
    lathe('marble_carved', x, z, y, [(0.0, 0.0), (0.2 * scale, 0.02), (0.26 * scale, 0.1), (0.22 * scale, 0.16), (0.0, 0.17)], 8)
    b = y + 0.16 * scale

    def P(px, py, pz):
        return (x + px * scale, b + py * scale, z + face * pz * scale)
    ellipsoid('marble_carved', P(0, 0.2, -0.05), (0.19 * scale, 0.2 * scale, 0.22 * scale), 5, 8)
    ellipsoid('marble_carved', P(0, 0.42, 0.05), (0.16 * scale, 0.22 * scale, 0.15 * scale), 5, 8)
    ellipsoid('marble_carved', P(0, 0.66, 0.08), (0.17 * scale, 0.15 * scale, 0.16 * scale), 5, 8)


def huabiao(x, z, face):
    """Carved marble column (华表), 9.57 m tall, shaft 0.98 m across (网易 figures). From photos 04/05/12:
    a square carved plinth ringed by a marble railing whose four corner posts carry small lions, an
    octagonal sumeru pedestal, an octagonal shaft with a dragon coiling up it in low relief, a long
    cloud board (云板) through the shaft near the top with its ends sweeping upward, a double lotus
    dew plate (承露盘) and a seated hou (犼) on top facing `face` (+1 south)."""
    hp = 2.55
    box('marble_carved', x - hp - 0.12, x + hp + 0.12, 0.0, 0.14, z - hp - 0.12, z + hp + 0.12)
    box('marble_carved', x - hp, x + hp, 0.14, 0.5, z - hp, z + hp)
    box('marble', x - hp - 0.08, x + hp + 0.08, 0.5, 0.6, z - hp - 0.08, z + hp + 0.08)
    ri = hp - 0.18
    corners = [(x - ri, z - ri), (x + ri, z - ri), (x + ri, z + ri), (x - ri, z + ri)]
    for (ax, az), (bx, bz) in zip(corners, corners[1:] + corners[:1]):
        balustrade('marble', [(ax, 0.6, az), (bx, 0.6, bz)], 2.3, 0.95, 0.24)
    for cx_, cz_ in corners:
        box('marble', cx_ - 0.19, cx_ + 0.19, 0.6, 1.62, cz_ - 0.19, cz_ + 0.19)
        small_lion(cx_, 1.62, cz_, face, 1.0)
    # octagonal sumeru pedestal
    y = 0.6
    for dy, r in ((0.16, 1.28), (0.12, 1.16), (0.5, 0.98), (0.12, 1.16), (0.12, 1.24), (0.3, 1.1)):
        cylinder('marble_carved', x, z, y, y + dy, r, r, 8, False)
        y += dy
    ys = y
    # shaft
    cylinder('marble_carved', x, z, ys, 8.15, 0.49, 0.47, 8, False)
    helix = []
    for i in range(80):
        t = i / 79
        ang = t * 2.4 * math.tau + (0.0 if face > 0 else math.pi)
        rr = 0.43 + 0.01 * (1 - t)
        helix.append((x + rr * math.cos(ang), ys + 0.35 + t * 4.6, z + rr * math.sin(ang)))
    # the dragon is carved in low relief: its body stands only about 7 cm proud of the shaft
    tube('marble_carved', helix, 0.11, 6)
    hx_, hy_, hz_ = helix[-1]
    ellipsoid('marble_carved', (x + (hx_ - x) * 1.05, hy_ + 0.15, z + (hz_ - z) * 1.05), (0.16, 0.24, 0.16), 5, 8)
    # cloud board: centre about 7.7 m, tips sweep up to about 9.0 m (photo 05 at 148 px/m)
    cloud = [(-0.32, -0.5), (0.32, -0.5), (0.62, -0.42), (0.92, -0.2), (1.18, 0.12), (1.38, 0.5), (1.5, 0.92),
             (1.46, 1.22), (1.3, 1.3), (1.2, 1.12), (1.2, 0.86), (1.02, 0.62), (0.78, 0.4), (0.5, 0.28), (0.32, 0.26),
             (-0.32, 0.26), (-0.5, 0.28), (-0.78, 0.4), (-1.02, 0.62), (-1.2, 0.86), (-1.2, 1.12), (-1.3, 1.3),
             (-1.46, 1.22), (-1.5, 0.92), (-1.38, 0.5), (-1.18, 0.12), (-0.92, -0.2), (-0.62, -0.42)]
    elev('marble_carved', cloud, lambda a, yy, k: (x + a, 7.72 + yy, z + (0.14 if k == 0 else -0.14)))
    for sg in (1, -1):
        for u, v in ((0.62, -0.1), (0.95, 0.3), (1.25, 0.8)):
            elev('marble_carved', [(a * 0.16 + u * sg, b * 0.13 + v) for a, b in
                                   ((-1, -1), (1, -1), (1.2, 0), (0.6, 1), (-0.6, 1), (-1.2, 0))],
                 lambda a, yy, k: (x + a, 7.72 + yy, z + (0.18 if k == 0 else -0.18)))
    # dew plate: lotus bowl, beaded band, plate
    lathe('marble_carved', x, z, 8.12, [(0.47, 0.0), (0.58, 0.05), (0.68, 0.14), (0.72, 0.24), (0.66, 0.3), (0.56, 0.32),
                                        (0.58, 0.38), (0.64, 0.46), (0.66, 0.56), (0.6, 0.62), (0.0, 0.63)], 16)
    # hou (犼) seated on the plate, about 0.8 m, top at 9.57 m
    b = 8.75

    def P(px, py, pz):
        return (x + px, b + py, z + face * pz)
    ellipsoid('marble_carved', P(0, 0.17, -0.1), (0.2, 0.17, 0.26), 6, 8)
    ellipsoid('marble_carved', P(0, 0.36, 0.06), (0.15, 0.24, 0.14), 6, 8, rot_x(face * 0.3))
    for sx in (1, -1):
        tube('marble_carved', [P(sx * 0.1, 0.36, 0.14), P(sx * 0.1, 0.03, 0.2)], 0.05, 5)
    ellipsoid('marble_carved', P(0, 0.62, 0.12), (0.14, 0.13, 0.15), 6, 8)
    ellipsoid('marble_carved', P(0, 0.6, 0.27), (0.08, 0.07, 0.08), 5, 6)
    tube('marble_carved', [P(0, 0.72, 0.02), P(0, 0.72, -0.12), P(0, 0.52, -0.22), P(0, 0.3, -0.24)], 0.06, 5)
    tube('marble_carved', [P(0, 0.1, -0.34), P(0, 0.3, -0.42), P(0, 0.55, -0.36)], 0.06, 5)


def lion(x, z, face, male):
    """Seated guardian lion on a draped sumeru pedestal; face = +1 looks south. From photos 09/10/13/14:
    a big head (about a third of the body) covered in rows of spiral curls, heavy brow, bulging eyes,
    broad nose, open mouth, a collar with a hanging bell and tassels, straight front legs; the male
    rests a paw on a ball, the female on a cub."""
    y = 0.0
    for dy, hx_, hz_ in ((0.2, 1.1, 1.6), (0.1, 1.0, 1.5), (0.62, 0.88, 1.38), (0.1, 1.0, 1.5), (0.26, 1.1, 1.6)):
        box('carved', x - hx_, x + hx_, y, y + dy, z - hz_, z + hz_)
        y += dy
    b = y
    # draped brocade over the pedestal top, hanging on the front and sides, corner tassels
    box('carved', x - 1.02, x + 1.02, b - 0.36, b + 0.03, z - 1.52, z + 1.52)
    for sx in (1, -1):
        for sz_ in (1, -1):
            ellipsoid('carved', (x + sx * 1.02, b - 0.45, z + sz_ * 1.52), (0.08, 0.14, 0.08), 4, 6)

    def P(px, py, pz):
        return (x + px, b + py, z + face * pz)
    box('carved', x - 0.8, x + 0.8, b + 0.03, b + 0.13, z - 1.3, z + 1.3)
    b0 = 0.13
    ellipsoid('carved', P(0, b0 + 0.48, -0.55), (0.66, 0.5, 0.74), 8, 12)
    ellipsoid('carved', P(0, b0 + 1.05, -0.02), (0.55, 0.72, 0.52), 8, 12, rot_x(face * 0.22))
    for sx in (1, -1):
        tube('carved', [P(sx * 0.3, b0 + 1.2, 0.26), P(sx * 0.33, b0 + 0.62, 0.5), P(sx * 0.34, b0 + 0.12, 0.66)], 0.18, 8)
        ellipsoid('carved', P(sx * 0.34, b0 + 0.1, 0.78), (0.22, 0.12, 0.26), 6, 8)
        ellipsoid('carved', P(sx * 0.5, b0 + 0.35, -0.4), (0.24, 0.36, 0.52), 6, 8)
        ellipsoid('carved', P(sx * 0.52, b0 + 0.1, -0.05), (0.2, 0.11, 0.24), 5, 6)
    # collar with bell and tassels
    col = [P(0.52 * math.sin(a), b0 + 1.42 - 0.08 * math.cos(a), 0.12 + 0.36 * math.cos(a)) for a in
           [-2.2 + 4.4 * i / 14 for i in range(15)]]
    tube('carved', col, 0.07, 6)
    ellipsoid('carved', P(0, b0 + 1.22, 0.52), (0.16, 0.17, 0.14), 6, 8)
    for sx in (1, -1):
        tube('carved', [P(sx * 0.2, b0 + 1.34, 0.46), P(sx * 0.26, b0 + 1.0, 0.5)], 0.05, 5)
    # head: skull, brow, eyes, nose, open jaws, ears, curls
    hy = b0 + 1.98
    ellipsoid('carved', P(0, hy, 0.24), (0.52, 0.48, 0.46), 8, 12)
    ellipsoid('carved', P(0, hy + 0.1, 0.56), (0.42, 0.13, 0.16), 5, 8)
    for sx in (1, -1):
        ellipsoid('carved', P(sx * 0.2, hy - 0.02, 0.64), (0.1, 0.09, 0.07), 5, 6)
        ellipsoid('carved', P(sx * 0.46, hy + 0.08, 0.3), (0.1, 0.15, 0.08), 4, 6)
    ellipsoid('carved', P(0, hy - 0.16, 0.7), (0.2, 0.13, 0.13), 5, 8)
    ellipsoid('carved', P(0, hy - 0.26, 0.58), (0.32, 0.12, 0.18), 5, 8)
    ellipsoid('carved', P(0, hy - 0.52, 0.48), (0.26, 0.09, 0.16), 5, 8)
    for sx in (1, -1):
        tube('carved', [P(sx * 0.2, hy - 0.36, 0.64), P(sx * 0.2, hy - 0.48, 0.6)], 0.035, 4)
    for i in range(7):
        ang = -2.3 + 4.6 * i / 6
        for j in range(4):
            r = 0.5 + 0.04 * j
            ellipsoid('carved', P(r * math.sin(ang) * 1.02, hy + 0.34 - 0.22 * j + 0.06 * math.cos(ang),
                                  0.24 - r * 0.62 * abs(math.cos(ang)) * (1 if abs(ang) > 1.6 else 0.3) - 0.1 * j),
                      (0.12, 0.11, 0.1), 4, 6)
    for i in range(5):
        for j in range(3):
            ang = -1.6 + 3.2 * i / 4
            ellipsoid('carved', P(0.46 * math.sin(ang), hy - 0.4 - 0.2 * j, -0.05 - 0.2 * abs(math.cos(ang)) - 0.1 * j),
                      (0.13, 0.12, 0.12), 4, 6)
    tube('carved', [P(0, b0 + 0.5, -1.22), P(0, b0 + 0.95, -1.38), P(0, b0 + 1.3, -1.18)], 0.13, 6)
    ellipsoid('carved', P(0, b0 + 1.42, -1.12), (0.24, 0.22, 0.2), 5, 6)
    if male:
        ellipsoid('carved', P(0.36, b0 + 0.3, 0.9), (0.3, 0.28, 0.3), 6, 10)
    else:
        ellipsoid('carved', P(-0.4, b0 + 0.24, 0.84), (0.2, 0.2, 0.3), 6, 8)
        ellipsoid('carved', P(-0.4, b0 + 0.46, 1.04), (0.14, 0.13, 0.13), 5, 6)


# ------------------------------------------------------------------ build


def build():
    global m
    m = Model(ID)
    install_tally(m)
    ax = m.spec['axis']
    dE = ax if ax[0] > 0 else [-ax[0], -ax[1]]
    dS = [-dE[1], dE[0]]
    ring = [(u * m.spec['across'][0] + v * ax[0], u * m.spec['across'][1] + v * ax[1]) for u, v in m.spec['ring']]
    es = [(x * dE[0] + z * dE[1], x * dS[0] + z * dS[1]) for x, z in ring]
    e0, e1 = min(p[0] for p in es), max(p[0] for p in es)
    s0, s1 = min(p[1] for p in es), max(p[1] for p in es)
    ec, sc = (e0 + e1) / 2, (s0 + s1) / 2
    W, D = (e1 - e0) / 2, (s1 - s0) / 2
    print(f'platform frame: centre ({ec:.2f},{sc:.2f}) half {W:.2f} x {D:.2f}, gate axis rotation '
          f'{math.degrees(math.atan2(-dE[1], dE[0])):.2f} deg', flush=True)

    def point(p):
        e, y, s = p[0] + ec, p[1], p[2] + sc
        return (e * dE[0] + s * dS[0], y, e * dE[1] + s * dS[1])
    m.point = point

    def osm_z(s):
        return s - sc

    for key, color, metal, rough in [
            ('plaster_red', (.36, .036, .03), 0, .85), ('paint_red', (.42, .026, .02), 0, .55),
            ('paint_red_bright', (.60, .016, .018), 0, .5), ('tile_yellow', (.80, .36, .025), 0, .32),
            ('marble', (.74, .72, .64), 0, .5), ('marble_carved', (.70, .68, .61), 0, .55),
            ('stone', (.40, .40, .38), 0, .8), ('granite', (.24, .24, .23), 0, .75),
            ('plaster_grey', (.56, .56, .53), 0, .85), ('paint_teal', (.02, .16, .13), 0, .55),
            ('paint_blue', (.014, .05, .19), 0, .55), ('gold', (.64, .40, .05), .6, .35),
            ('glass', (.09, .07, .19), .3, .2), ('wood', (.30, .16, .06), 0, .6),
            ('canvas', (.52, .50, .44), 0, .8), ('carved', (.52, .51, .47), 0, .7),
            ('water', (.035, .075, .07), .1, .08)]:
        m.material(key, color, metal, rough)

    # ---------------- platform (城台): battered red masonry pierced by five arched gateways
    sec('platform_67')
    H = 13.0
    bat = 0.45

    def sF(y):
        return D - bat * y / H
    arches = sorted([(0.0, 5.25, 6.25), (-13.85, 4.3, 4.9), (13.85, 4.3, 4.9), (-24.9, 3.6, 4.1), (24.9, 3.6, 4.1)])

    def arc(ae, w, crown, th0, th1, n):
        r = w / 2
        spring = crown - r
        return [(ae + r * math.cos(math.radians(th0 + (th1 - th0) * i / n)),
                 spring + r * math.sin(math.radians(th0 + (th1 - th0) * i / n))) for i in range(1, n)]
    pieces = []
    A = arches[0]
    r = A[1] / 2
    pieces.append([(-W, 0.0), (A[0] - r, 0.0), (A[0] - r, A[2] - r)] + arc(A[0], A[1], A[2], 180, 90, 12) +
                  [(A[0], A[2]), (A[0], H), (-W + bat, H)])
    for A, B in zip(arches, arches[1:]):
        ra, rb = A[1] / 2, B[1] / 2
        pieces.append([(A[0] + ra, 0.0), (B[0] - rb, 0.0), (B[0] - rb, B[2] - rb)] + arc(B[0], B[1], B[2], 180, 90, 12) +
                      [(B[0], B[2]), (B[0], H), (A[0], H), (A[0], A[2])] + arc(A[0], A[1], A[2], 90, 0, 12) +
                      [(A[0] + ra, A[2] - ra)])
    A = arches[-1]
    r = A[1] / 2
    pieces.append([(A[0] + r, 0.0), (W, 0.0), (W - bat, H), (A[0], H), (A[0], A[2])] + arc(A[0], A[1], A[2], 90, 0, 12) +
                  [(A[0] + r, A[2] - r)])
    for outline in pieces:
        elev('plaster_red', outline, lambda a, y, k: (a, y, sF(y) if k == 0 else -sF(y)))
    # Gate doors: photos 10/14 show the four side gateways closed by red two-leaf doors studded with
    # gilded nails (门钉, nine rows), set about 1.5 m inside the south face; the central gateway stands
    # open (the doors are folded back, so the tunnel reads as a passage). Not driven through.
    for ae, w, crown in arches:
        if abs(ae) < 1.0:
            continue
        r = w / 2
        spring = crown - r
        zd = D - 1.55
        for sg in (-1, 1):
            edge = ae + sg * r
            leaf = [(ae + sg * 0.015, 0.0), (edge, 0.0), (edge, spring)]
            leaf += [(ae + sg * r * math.cos(math.radians(t)), spring + r * math.sin(math.radians(t)))
                     for t in range(8, 90, 8)] + [(ae + sg * 0.015, crown)]
            if sg < 0:
                leaf = list(reversed(leaf))
            elev('paint_red', leaf, lambda a, y, k, zd=zd: (a, y, zd + (0.14 if k == 0 else -0.14)))
            cols = 6
            for i in range(9):
                yy = 0.55 + (spring - 0.35) * i / 8
                for j in range(cols):
                    xx = ae + sg * (0.22 + (r - 0.44) * (j + 0.5) / cols)
                    s0, s1 = 0.055, 0.03
                    prism('gold', [(xx - s0, zd + 0.14), (xx + s0, zd + 0.14), (xx + s1, zd + 0.2), (xx - s1, zd + 0.2)],
                          yy - 0.05, yy + 0.05)
    # white marble sumeru base along the foot, broken by every gateway
    bands = [(0.0, 0.22, 0.36), (0.22, 0.34, 0.26), (0.34, 0.78, 0.07), (0.78, 0.9, 0.26), (0.9, 1.05, 0.34)]
    segs = [(-W, arches[0][0] - arches[0][1] / 2)]
    segs += [(A[0] + A[1] / 2, B[0] - B[1] / 2) for A, B in zip(arches, arches[1:])]
    segs += [(arches[-1][0] + arches[-1][1] / 2, W)]
    for y0, y1, out in bands:
        for sz in (1, -1):
            for a0, a1 in segs:
                a0e = a0 - out if a0 == -W else a0
                a1e = a1 + out if a1 == W else a1
                z0, z1 = (D - 0.6, D + out) if sz > 0 else (-D - out, -D + 0.6)
                box('marble', a0e, a1e, y0, y1, z0, z1)
        for sx in (1, -1):
            x0, x1 = (W - 0.6, W + out) if sx > 0 else (-W - out, -W + 0.6)
            box('marble', x0, x1, y0, y1, -D - out, D + out)
    # Grey band, coping and rail. Photo 01 (far telephoto, 13.4 px/m from the portrait's 5 m width):
    # the light-grey band is about 1.05 m tall with a thin glazed coping on top; the chiwen tips stand
    # 21.1 m and the ridge 19.0 m above that coping, so with the official 34.7 m total the coping is at
    # 13.5 m. The portrait top hangs about 0.7 m below the coping, in front of the band. Above the coping
    # stands a row of white onion-headed marble posts with a handrail (photos 14/08/11).
    wt = W - bat * 12.45 / H
    dt = sF(12.45)
    box('plaster_grey', -wt - 0.08, wt + 0.08, 12.45, 13.0, -dt - 0.08, dt + 0.08)
    box('stone', -wt - 0.12, wt + 0.12, 12.4, 12.5, -dt - 0.12, dt + 0.12)
    wp, dp = W - bat + 0.1, sF(H) + 0.1
    for sz in (1, -1):
        za, zb = sorted((sz * (dp - 0.72), sz * dp))
        box('plaster_grey', -wp, wp, 12.95, 13.4, za, zb)
        za, zb = sorted((sz * (dp - 0.8), sz * (dp + 0.1)))
        box('tile_yellow', -wp - 0.1, wp + 0.1, 13.4, 13.5, za, zb)
    for sx in (1, -1):
        xa, xb = sorted((sx * (wp - 0.72), sx * wp))
        box('plaster_grey', xa, xb, 12.95, 13.4, -dp + 0.7, dp - 0.7)
        xa, xb = sorted((sx * (wp - 0.8), sx * (wp + 0.1)))
        box('tile_yellow', xa, xb, 13.4, 13.5, -dp + 0.72, dp - 0.72)
    box('stone', -wp + 0.7, wp - 0.7, 13.0, 13.05, -dp + 0.7, dp - 0.7)
    rail = []
    for sz in (1, -1):
        rail.append([(-wp + 0.36, sz * (dp - 0.36)), (wp - 0.36, sz * (dp - 0.36))])
    for sx in (1, -1):
        rail.append([(sx * (wp - 0.36), -dp + 0.36), (sx * (wp - 0.36), dp - 0.36)])
    for (x0, z0), (x1, z1) in rail:
        Ln = math.hypot(x1 - x0, z1 - z0)
        n = max(1, round(Ln / 2.3))
        for i in range(n + 1):
            bulb_post('marble', x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n, 13.5, 0.7, 0.22, 5)
        sweep('marble', [(x0, 14.05, z0), (x1, 14.05, z1)], 0.13, 0.11)
        sweep('marble', [(x0, 13.6, z0), (x1, 13.6, z1)], 0.1, 0.08)

    # ---------------- EMPTY portrait frame over the central gateway, blank slogan boards
    sec('EMPTY_66')
    ptop, pbot = 12.8, 12.8 - 6.4
    zf = sF(pbot) + 0.3
    box('wood', -2.5, 2.5, pbot, ptop, sF(ptop) - 0.06, zf + 0.22)
    box('canvas', -2.2, 2.2, pbot + 0.3, ptop - 0.3, zf, zf + 0.26)
    for x0, x1, y0, y1 in ((-2.5, 2.5, pbot, pbot + 0.3), (-2.5, 2.5, ptop - 0.3, ptop),
                           (-2.5, -2.2, pbot + 0.3, ptop - 0.3), (2.2, 2.5, pbot + 0.3, ptop - 0.3)):
        box('gold', x0, x1, y0, y1, zf, zf + 0.4)
    for sx in (1, -1):
        yb0, yb1 = 10.05 - 1.45, 10.05 + 1.45
        x0, x1 = (10.3, 40.7) if sx > 0 else (-40.7, -10.3)
        zf2 = sF(yb0) + 0.02
        box('paint_red_bright', x0, x1, yb0, yb1, sF(yb1) - 0.06, zf2 + 0.26)
        for bx0, bx1, by0, by1 in ((x0, x1, yb0, yb0 + 0.18), (x0, x1, yb1 - 0.18, yb1),
                                   (x0, x0 + 0.18, yb0 + 0.18, yb1 - 0.18), (x1 - 0.18, x1, yb0 + 0.18, yb1 - 0.18)):
            box('gold', bx0, bx1, by0, by1, zf2 + 0.1, zf2 + 0.32)

    # ---------------- tower base (台基) with marble balustrade and front/back stairs
    sec('tower_60')
    colx = [-28.0, -24.0, -17.5, -11.0, -4.4, 4.4, 11.0, 17.5, 24.0, 28.0]
    colz = [-12.7, -8.7, -2.9, 2.9, 8.7, 12.7]
    BX, BZ = 30.2, 14.9
    ybase = sumeru_ring('marble', BX, BZ, 13.05, [(0.2, 0.25), (0.12, 0.13), (0.5, 0.0), (0.12, 0.13), (0.21, 0.25)])
    for sz in (1, -1):
        for k in range(6):
            za, zb = sorted((sz * (BZ + 0.2), sz * (BZ + 0.25 + 0.32 * (6 - k))))
            box('marble', -4.2, 4.2, 13.05, 13.05 + (ybase - 13.05) * (k + 1) / 6, za, zb)
        for sx in (1, -1):
            sweep('marble', [(sx * 4.45, 13.05, sz * (BZ + 0.25 + 1.95)), (sx * 4.45, ybase, sz * (BZ + 0.1))], 0.5, 0.3)
    bi = 0.25
    runs = []
    for sz in (1, -1):
        runs.append([(-BX + bi, ybase, sz * (BZ - bi)), (-4.8, ybase, sz * (BZ - bi))])
        runs.append([(4.8, ybase, sz * (BZ - bi)), (BX - bi, ybase, sz * (BZ - bi))])
    for sx in (1, -1):
        runs.append([(sx * (BX - bi), ybase, -BZ + bi + 0.3), (sx * (BX - bi), ybase, BZ - bi - 0.3)])
    for pts in runs:
        balustrade('marble', pts, 1.55, 1.1)

    # ---------------- lower storey: outer colonnade, lattice hall front, painted beams, brackets
    sec('lower_74')
    # Storey heights from the far telephoto photo 01 (almost no perspective), measured up from the
    # coping (13.5 m): lower eave edge +6.8-7.2 m, lower roof visible to +9.1, upper eave edge +11.6,
    # ridge top +19.0, chiwen tips +21.1 (eave edges sit about 0.4-0.5 m under the eave line y0).
    yc1 = 19.7   # lower bracket base -> lower eave 20.9 m
    yb2 = 24.54  # upper bracket base -> upper eave 25.7 m
    outer = [(x, z) for x in colx for z in (colz[0], colz[-1])] + [(x, z) for z in colz[1:-1] for x in (colx[0], colx[-1])]
    for x, z in outer:
        cylinder('marble', x, z, ybase, ybase + 0.24, 0.66, 0.6, 16, False)
        cylinder('paint_red', x, z, ybase + 0.24, yc1, 0.45, 0.41, 16)
    icolx, icolz = colx[1:-1], colz[1:-1]
    inner = [(x, z) for x in icolx for z in (icolz[0], icolz[-1])] + [(x, z) for x in (icolx[0], icolx[-1]) for z in icolz[1:-1]]
    for x, z in inner:
        cylinder('marble', x, z, ybase, ybase + 0.24, 0.66, 0.6, 16, False)
        cylinder('paint_red', x, z, ybase + 0.24, yb2, 0.47, 0.43, 16)
    architrave_ring(28.0, 12.7, colx, colz, yc1)
    bracket_ring(28.0, 12.7, colx, colz, yc1)
    for face in 'SN':
        for a0, a1 in zip(icolx, icolx[1:]):
            lattice_bay(face, 8.7, a0 + 0.47, a1 - 0.47, ybase, yc1 - 1.0, abs((a0 + a1) / 2) < 8)
        fbox('paint_red', face, 8.7, -24.0, 24.0, yc1 - 1.0, yc1 - 0.78, -0.2, 0.12)
        fbox('paint_teal', face, 8.7, -24.2, 24.2, yc1 - 0.78, yc1 - 0.25, -0.25, 0.22)
        fbox('plaster_red', face, 8.7, -24.2, 24.2, yc1 - 0.25, 22.9, -0.4, 0.05)
    for face in 'EW':
        fbox('plaster_red', face, 24.0, -8.7, 8.7, ybase, 22.9, -0.45, 0.35)
        fbox('paint_teal', face, 24.0, -8.9, 8.9, yc1 - 0.78, yc1 - 0.25, 0.35, 0.42)
    for x in icolx:
        for sz in (1, -1):
            za, zb = sorted((sz * 8.7, sz * 12.7))
            box('paint_teal', x - 0.22, x + 0.22, yc1 - 0.85, yc1 - 0.3, za, zb)
    for z in icolz:
        for sx in (1, -1):
            xa, xb = sorted((sx * 24.0, sx * 28.0))
            box('paint_teal', xa, xb, yc1 - 0.85, yc1 - 0.3, z - 0.22, z + 0.22)
    lower = Roof(0, 0, 31.8, 16.5, 7.8, yc1 + 1.21, 1.85, top=7.8, lift=0.62, out=0.42, Lc=7.5, Ld=4.2)
    lower.slab('tile_yellow')
    lower.tiles('tile_yellow')
    lower.rafters('paint_blue', 'paint_teal', 3.4)
    lower.hips('tile_yellow', 'tile_yellow', beasts=9)
    lower.skirt_top_ridge('tile_yellow')

    # ---------------- upper storey: short wall band, beams, brackets, hip-and-gable roof
    sec('upper_66')
    for face in 'SNEW':
        long_ = face in 'SN'
        half, off = (24.0, 8.7) if long_ else (8.7, 24.0)
        fbox('plaster_red', face, off, -half, half, 22.6, yb2 - 0.84, -0.3, 0.2)
        cols = sorted(icolx if long_ else icolz)
        for a0, a1 in zip(cols, cols[1:]):
            fbox('paint_teal', face, off, a0 + 0.5, a1 - 0.5, 23.05, yb2 - 0.92, 0.2, 0.24)
    architrave_ring(24.0, 8.7, icolx, icolz, yb2, deep=False)
    bracket_ring(24.0, 8.7, icolx, icolz, yb2)
    upper = Roof(0, 0, 28.0, 12.7, 12.7, yb2 + 1.16, 5.6, dg=6.8, ov=0.35, lift=0.78, out=0.5, Lc=8.0, Ld=4.6)
    upper.slab('tile_yellow')
    upper.tiles('tile_yellow')
    upper.rafters('paint_blue', 'paint_teal', 3.6)
    upper.hips('tile_yellow', 'tile_yellow', beasts=9)
    L, yr = upper.ridge_top('tile_yellow')
    upper.gable_parts('tile_yellow', 'paint_red', 'paint_red', 'gold')
    for sx in (1, -1):
        chiwen('tile_yellow', sx * (L + 0.2), yr, 0.0, sx)
    print(f'upper ridge surface {yr:.2f}, ridge top {yr + 1.2:.2f}, chiwen top {yr + 3.4:.2f}', flush=True)

    # ---------------- side halls on the platform ends (yellow hip roofs seen beside the tower)
    sec('side_72')
    # Photo 01: eaves about 1.5 m and ridge about 3.9 m above the coping, 13.3-13.5 m long each.
    for sx in (1, -1):
        cx, cz = sx * 37.3, -4.0
        hx, hz = 5.8, 3.6
        box('plaster_red', cx - hx, cx + hx, 13.05, 14.85, cz - hz, cz + hz)
        for face in 'SNEW':
            long_ = face in 'SN'
            half, off = (hx, hz) if long_ else (hz, hx)
            fbox('paint_teal', face, off, -half - 0.1, half + 0.1, 14.2, 14.85, 0.0, 0.08, cx, cz)
            n = int(2 * half / 0.8)
            for i in range(n + 1):
                a = -half + 2 * half * i / n
                fbox('paint_blue', face, off, a - 0.14, a + 0.14, 14.85, 15.07, -0.1, 0.35, cx, cz)
        fbox('glass', 'S', hz, -1.1, 1.1, 13.05, 14.3, 0.0, 0.05, cx, cz)
        for a in (-3.6, 3.6):
            fbox('glass', 'S', hz, a - 0.9, a + 0.9, 13.5, 14.3, 0.0, 0.05, cx, cz)
            for j in range(1, 4):
                fbox('paint_red', 'S', hz, a - 0.9 + 0.45 * j - 0.03, a - 0.9 + 0.45 * j + 0.03, 13.5, 14.3, 0.0, 0.09, cx, cz)
        side = Roof(cx, cz, hx + 1.25, hz + 1.25, hz + 1.25, 15.0, 1.7, dg=hz + 1.25 - 0.3, ov=0.0,
                    lift=0.3, out=0.22, Lc=3.0, Ld=2.0, thick=0.25)
        side.slab('tile_yellow')
        side.tiles('tile_yellow', 0.5, 0.09)
        side.rafters('paint_blue', 'paint_teal', 1.2)
        side.hips('tile_yellow', 'tile_yellow', 0.34, 0.4, beasts=3)
        Ls, ys = side.ridge_top('tile_yellow', 0.7, 0.5)
        for s2 in (1, -1):
            chiwen('tile_yellow', cx + s2 * (Ls + 0.1), ys - 0.1, cz, s2, 0.4, 0.35)

    # ---------------- outer Jinshui river strip (bow-shaped, from OSM way 523763740) with banks
    sec('outer_73')
    def z_n(x):
        return osm_z(54.6 - 8.2 * (x / 110) ** 2)

    def z_s(x):
        return osm_z(71.1 - 10.4 * (x / 110) ** 2)
    xr = 118.0
    samples = [-xr + 2 * xr * i / 59 for i in range(60)]
    prism('water', [(x, z_n(x) - 0.3) for x in samples] + [(x, z_s(x) + 0.3) for x in reversed(samples)], 0.0, 0.1)
    # OSM bridge ways, e relative to the footprint centre plus the 3.85 m axis shift
    bridges = []
    for e_c, w, sa, sb, span, rise in ((-3.85, 9.7, 41.8, 82.7, 9.0, 0.85), (-17.7, 7.7, 44.6, 80.0, 7.6, 0.75),
                                       (9.9, 7.8, 45.2, 79.6, 7.6, 0.75), (-28.7, 6.6, 45.0, 79.8, 6.6, 0.7),
                                       (21.15, 6.5, 45.3, 78.3, 6.6, 0.7)):
        bridges.append((e_c + 3.85, w, osm_z(sa), osm_z(sb), span, rise))

    def on_bridge(p, pad):
        return any(abs(p[0] - b[0]) < b[1] / 2 + pad and b[2] - 1 < p[2] < b[3] + 1 for b in bridges)
    for bank, sgn in ((z_n, -1), (z_s, 1)):
        pts = [(x, 0.0, bank(x) + sgn * 0.05) for x in samples]
        sweep('granite', [(x, y, z + sgn * 0.3) for x, y, z in pts], 0.75, 0.42)
        seg = []
        for x, y, z in pts:
            p = (x, 0.42, z + sgn * 0.35)
            if on_bridge(p, 0.6):
                if len(seg) > 1:
                    balustrade('marble', seg, 2.2, 1.0)
                seg = []
            else:
                seg.append(p)
        if len(seg) > 1:
            balustrade('marble', seg, 2.2, 1.0)

    # ---------------- five outer Jinshui bridges: white marble humps, an arch over the water each
    sec('five_75')
    # zh.wikipedia 金水桥: five parallel THREE-ARCH white-marble bridges; the middle one (御路桥) is the
    # widest. Each body is one extruded profile whose bottom edge is notched by three open arches
    # (central opening larger), with raised arch-ring stones on both faces, a deck cornice, open
    # balustrades with onion-headed posts and drum stones (抱鼓石) at the four ends.
    for bi, (x, w, za, zb, span, rise) in enumerate(bridges):
        zn, zs = z_n(x) - 0.3, z_s(x) + 0.3
        zc = (zn + zs) / 2
        Wr = zs - zn
        crown = 1.95 if bi == 0 else 1.65
        Ln, Ls = zc - za, zb - zc

        def deck(z, zc=zc, Ln=Ln, Ls=Ls, crown=crown):
            t = (z - zc) / (Ln if z < zc else Ls)
            return 0.06 + (crown - 0.06) * max(0.0, 1 - t * t) ** 0.8
        sc, ss, pier = 0.34 * Wr, 0.235 * Wr, 0.095 * Wr
        rc, rs = (1.3, 0.98) if bi == 0 else (1.1, 0.82)
        openings = [(zc - sc / 2 - pier - ss / 2, ss, rs), (zc, sc, rc), (zc + sc / 2 + pier + ss / 2, ss, rs)]

        def arch_pts(z0, sp, ri, n=10):
            a = sp / 2
            rho = (a * a + ri * ri) / (2 * ri)
            yc = ri - rho
            th0 = math.atan2(-yc, -a)
            return [(z0 + rho * math.cos(th0 + (math.pi - 2 * th0) * i / n), yc + rho * math.sin(th0 + (math.pi - 2 * th0) * i / n))
                    for i in range(n + 1)], rho, yc
        bottom = [(za, 0.0)]
        rings = []
        for z0, sp, ri in openings:
            pts, rho, yc = arch_pts(z0, sp, ri)
            pts = [(z, max(y, 0.0)) for z, y in pts]
            bottom += [(z0 - sp / 2, 0.0)] + pts[1:-1] + [(z0 + sp / 2, 0.0)]
            rings.append((z0, sp, ri))
        bottom.append((zb, 0.0))
        top = [(z, deck(z)) for z in [zb - (zb - za) * i / 40 for i in range(41)]]
        top[0] = (zb, 0.06)
        top[-1] = (za, 0.06)
        outline = bottom + top
        elev('marble', outline, lambda a2, y, kk, x=x, w=w: (x + (w / 2 if kk == 0 else -w / 2), y, a2))
        for z0, sp, ri in rings:
            inner, rho, yc = arch_pts(z0, sp, ri, 12)
            ro = rho + 0.34
            t0 = math.asin(max(-1.0, min(1.0, -yc / ro)))
            outer = [(z0 + ro * math.cos(math.pi - t0 - (math.pi - 2 * t0) * i / 14),
                      max(0.0, yc + ro * math.sin(math.pi - t0 - (math.pi - 2 * t0) * i / 14))) for i in range(15)]
            ring = outer + list(reversed(inner))
            for sxf in (1, -1):
                xf = x + sxf * w / 2
                elev('marble', ring, lambda a2, y, kk, xf=xf, sxf=sxf: (xf + sxf * (0.06 if kk == 0 else -0.02), y, a2))
        for sx in (1, -1):
            xe = x + sx * (w / 2 - 0.22)
            zs_ = [za + 0.9 + (zb - za - 1.8) * i / 24 for i in range(25)]
            sweep('marble', [(x + sx * (w / 2 - 0.02), deck(z) - 0.32, z) for z in zs_], 0.2, 0.3, False)
            balustrade('marble', [(xe, deck(z), z) for z in zs_], 1.4, 1.05, 0.22)
            for zend, sg in ((za + 0.45, -1), (zb - 0.45, 1)):
                yd = deck(zend)
                tube('marble', [(xe - 0.13, yd + 0.5, zend), (xe + 0.13, yd + 0.5, zend)], 0.42, 10)
                box('marble', xe - 0.15, xe + 0.15, yd, yd + 0.3, zend - 0.55, zend + 0.55)

    # ---------------- huabiao (front pair south of the river, rear pair north of the gate), lions
    sec('huabiao_75')
    for sx in (1, -1):
        huabiao(sx * 47.45, osm_z(78.45), 1)
        huabiao(sx * 26.35, osm_z(-33.0), -1)
        lion(sx * 7.45, D + 6.9, 1, sx > 0)
        lion(sx * 7.45, osm_z(83.6), 1, sx > 0)
    return m


def preview_scene(model):
    """The same scene Model.render builds (sun, sky, ground), without its two default shots."""
    path = ROOT / 'game/public/models/landmarks' / (ID + '.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(path))
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 960
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (.55, .66, .80, 1)
    bg.inputs[1].default_value = .6
    scene.view_settings.view_transform = 'AgX'
    bpy.ops.object.light_add(type='SUN', location=(0, -30, 100))
    bpy.context.object.data.energy = 3
    bpy.context.object.data.angle = .12
    bpy.context.object.rotation_euler = (.3, -.45, -.7)
    bpy.ops.mesh.primitive_plane_add(size=4000, location=(0, 0, -.035))
    mat = bpy.data.materials.new('Preview ground')
    mat.diffuse_color = (.22, .25, .22, 1)
    bpy.context.object.data.materials.append(mat)


def render_views(model, directory, only=None):
    """Race-line views from Chang'an Avenue (about 110-120 m south) plus a close look at the eaves."""
    scene = bpy.context.scene
    views = [('raceline-west', (-80, 1.6, 112), (-5, 16, 0), 30),
             ('raceline-front', (0, 1.6, 118), (0, 15, 5), 32),
             ('detail-eaves', (30, 17, 50), (17, 23, 8), 40),
             ('detail-forecourt', (34, 4.5, 104), (4, 2.5, 72), 35),
             ('compare-front-tele', (0, 1.6, 150), (0, 19, 0), 55),
             ('compare-far', (0, 1.6, 700), (0, 17, 0), 230),
             ('compare-far-se', (230, 1.6, 560), (0, 17, 0), 190),
             ('detail-huabiao-lion', (-40, 3.0, 100), (-44, 4.5, 80), 45),
             ('detail-bridges', (18, 2.2, 92), (0, 1.0, 62), 32),
             ('detail-gate-foot', (-14, 3.0, 45), (-8, 5.0, 20), 35)]
    for label, pos, aim, lens in views:
        if only and label not in only:
            continue
        loc = Vector(xyz(model.point(pos)))
        target = Vector(xyz(model.point(aim)))
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
    parser.add_argument('--views', default='')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    model = build()
    directory = None if args.render_dir is None else (args.render_dir if args.render_dir.is_absolute() else ROOT / args.render_dir)
    for k, v in sorted(TALLY.items(), key=lambda kv: -kv[1]):
        print(f'TALLY {v:8d} {k}')
    print('TALLY total', sum(TALLY.values()))
    if args.views and directory:
        info = model.finish(None)
        directory.mkdir(parents=True, exist_ok=True)
        preview_scene(model)
        render_views(model, directory, args.views.split(','))
    else:
        model.finish(directory)
        if directory and not args.no_views:
            render_views(model, directory)
