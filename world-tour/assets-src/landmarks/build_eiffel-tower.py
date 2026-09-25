"""Eiffel Tower, Champ de Mars (route paris; the race finishes on Quai Jacques Chirac at its foot).

Authored from published figures and the route's research card; no photographs downloaded:
125 m square base (OSM way 5013364: the four leg feet sit in the footprint corners, 25.5 m square each,
73 m apart), platforms at 57.6 m, 115.7 m and 276.1 m, lattice to ~300 m, antenna to 330 m.

Shape: the outer edge of each face follows an exponential flare (62 m half-width at the ground,
34.4 m at the first level, 19 m at the second, 5.2 m at the third), the leg width shrinks 25.5 -> 13 m,
so the four legs stay separate to the second level and meet under it; above it one shaft.
Decorative arches between the legs spring tangent to the legs' inner edges at 28 m, crown 45 m.

Lattice (brief rule 7): every leg and the upper shaft has a dark `_steel` inner panel 0.9 m inside
its faces; the brown `_paint_brown` lattice stands in front. Detail is spent where the car sees it:
legs (lattice box montants with lacing, lattice horizontals, twin-bar diagonals), the arches and the
first-level frieze; the upper shaft is fewer, larger members (horizontals and X braces).

Author frame: u across, y up, v along (the footprint is a square aligned with u/v).
Run: Blender --background --python assets-src/landmarks/build_eiffel-tower.py
"""
import math
import tempfile
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'eiffel-tower'
SCRATCH = Path(tempfile.gettempdir()) / 'sr-landmarks' / ID

# ---- published figures -------------------------------------------------------------------------
Y1, Y2, Y3 = 57.6, 115.7, 276.1          # platform levels
W0, W2, W3 = 62.0, 19.0, 5.2             # outer half-width of the structure at 0 / Y2 / Y3
L0, L2 = 25.5, 13.0                      # leg width at the ground (footprint) and at the 2nd level
K1 = math.log(W0 / W2) / Y2
K2 = math.log(W2 / W3) / (Y3 - Y2)
KL = math.log(L0 / L2) / Y2
R = 0.3                                  # half size of the angle-iron chords
CORE_IN = 0.9                            # dark inner panel this far inside the lattice faces


def W(y):
    return W0 * math.exp(-K1 * y) if y <= Y2 else W2 * math.exp(-K2 * (y - Y2))


def L(y):
    return L0 * math.exp(-KL * y)


def I(y):
    return W(y) - L(y)


def MW(y):                               # montant (leg corner box girder) width
    return 0.15 * L(y)


def C(y):                                # corner column width of the upper shaft
    return 3.2 * math.exp(-math.log(3.2 / 1.4) * (y - Y2) / (Y3 - Y2))


m = Model(ID)
m.material('paint', (0.20, 0.16, 0.115), 0.35, 0.55, 'eiffel-tower_paint_brown')
m.material('steel', (0.075, 0.062, 0.05), 0.3, 0.75, 'eiffel-tower_steel')
m.material('glass', (0.30, 0.36, 0.40), 0.1, 0.12, 'eiffel-tower_glass')
m.material('stone', (0.43, 0.40, 0.34), 0.0, 0.85, 'eiffel-tower_stone')

HEX = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
STATS = {}


def strut(label, p0, p1, w, d, mat='paint', n=None, smooth=False):
    """Square-section member between two points; w in the face plane, d along the face normal n."""
    p0, p1 = Vector(p0), Vector(p1)
    a = p1 - p0
    if a.length < 1e-3:
        return
    a.normalize()
    ref = Vector(n) if n is not None else (Vector((0, 1, 0)) if abs(a.y) < 0.9 else Vector((1, 0, 0)))
    s = a.cross(ref)
    if s.length < 1e-6:
        s = a.cross(Vector((1, 0, 0)))
    s.normalize()
    t = s.cross(a).normalized()
    verts = []
    for p in (p0, p1):
        for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            q = p + s * (i * w / 2) + t * (j * d / 2)
            verts.append((q.x, q.y, q.z))
    m.mesh(label, verts, HEX, mat, smooth)
    STATS[label] = STATS.get(label, 0) + 1


def loft(label, rings, mat, smooth=False):
    k = len(rings[0])
    verts = [p for ring in rings for p in ring]
    faces = [tuple(reversed(range(k))), tuple((len(rings) - 1) * k + j for j in range(k))]
    for i in range(len(rings) - 1):
        for j in range(k):
            faces.append((i * k + j, i * k + (j + 1) % k, (i + 1) * k + (j + 1) % k, (i + 1) * k + j))
    m.mesh(label, verts, faces, mat, smooth)


def box(label, lo, hi, mat='paint'):
    m.box(label, tuple((a + b) / 2 for a, b in zip(lo, hi)), tuple(b - a for a, b in zip(lo, hi)), mat)


def ring_tube(label, centre, radius, r, axis_a, axis_b, mat='paint', n=16, arc=(0, math.tau), sides=5):
    """A circle (or arc) of tube in the plane spanned by axis_a / axis_b."""
    c, A, B = Vector(centre), Vector(axis_a), Vector(axis_b)
    closed = abs(arc[1] - arc[0] - math.tau) < 1e-6
    count = n if closed else n + 1
    pts = [c + radius * (A * math.cos(arc[0] + (arc[1] - arc[0]) * i / n) + B * math.sin(arc[0] + (arc[1] - arc[0]) * i / n))
           for i in range(count)]
    if closed:
        # torus: tube rings joined end to end
        tan = [(pts[(i + 1) % n] - pts[i - 1]).normalized() for i in range(n)]
        verts = []
        for p, tg in zip(pts, tan):
            out = (p - c).normalized()
            up = tg.cross(out).normalized()
            for j in range(sides):
                q = p + r * (out * math.cos(j * math.tau / sides) + up * math.sin(j * math.tau / sides))
                verts.append((q.x, q.y, q.z))
        faces = [(i * sides + j, i * sides + (j + 1) % sides, ((i + 1) % n) * sides + (j + 1) % sides, ((i + 1) % n) * sides + j)
                 for i in range(n) for j in range(sides)]
        m.mesh(label, verts, faces, mat, True)
    else:
        m.tube(label, [tuple(p) for p in pts], r, mat, sides)


def steps(y0, y1, pitch):
    """Stations from y0 to y1 with a height-dependent pitch."""
    ys = [y0]
    while True:
        y = ys[-1] + pitch(ys[-1])
        if y > y1 - 0.35 * pitch(ys[-1]):
            break
        ys.append(y)
    ys.append(y1)
    return ys


# ---- legs -----------------------------------------------------------------------------------------
LEG_TOP = Y2 - 0.6
LEG_SIGNS = [(1, 1), (1, -1), (-1, 1), (-1, -1)]


def legp(su, sv, a, y, b):
    return (su * a, y, sv * b)


def build_leg(su, sv):
    ys = [LEG_TOP * (i / 36) ** 1.0 for i in range(37)]
    # dark inner panel (rule 7): the leg's core, just behind its lattice faces
    rings = []
    for y in ys:
        lo, hi = I(y) + CORE_IN, W(y) - CORE_IN
        rings.append([legp(su, sv, a, y, b) for a, b in ((lo, lo), (hi, lo), (hi, hi), (lo, hi))])
    loft('leg core', rings, 'steel')

    # four montants (the leg's corner box girders), lattice: three visible chords + lacing
    def edges(side, y):
        mw = MW(y)
        if side == 'out':
            return W(y) - R, W(y) - mw + R           # exposed, hidden
        return I(y) + R, I(y) + mw - R
    for A in ('out', 'in'):
        for B in ('out', 'in'):
            for pick in ((0, 0), (0, 1), (1, 0)):
                rings = []
                for y in ys:
                    a = edges(A, y)[pick[0]]
                    b = edges(B, y)[pick[1]]
                    rings.append([legp(su, sv, a + da, y, b + db) for da, db in ((-R, -R), (R, -R), (R, R), (-R, R))])
                loft('montant chord', rings, 'paint', smooth=True)
            # lacing on the two exposed faces
            st = steps(0.6, LEG_TOP, lambda y: 1.05 * MW(y))
            for face in ('a', 'b'):
                pts = []
                for k, y in enumerate(st):
                    ea, ha = edges(A, y)
                    eb, hb = edges(B, y)
                    if face == 'a':
                        pts.append(legp(su, sv, ea, y, eb if k % 2 == 0 else hb))
                    else:
                        pts.append(legp(su, sv, ea if k % 2 == 0 else ha, y, eb))
                nrm = (su, 0, 0) if face == 'a' else (0, 0, sv)
                for p0, p1 in zip(pts, pts[1:]):
                    strut('montant lacing', p0, p1, 0.22, 0.16, 'paint', nrm, smooth=True)
                # batten plates every third station
                for k, y in enumerate(st):
                    if k % 3:
                        continue
                    ea, ha = edges(A, y)
                    eb, hb = edges(B, y)
                    if face == 'a':
                        strut('montant batten', legp(su, sv, ea, y, eb), legp(su, sv, ea, y, hb), 0.35, 0.2, 'paint', nrm)
                    else:
                        strut('montant batten', legp(su, sv, ea, y, eb), legp(su, sv, ha, y, eb), 0.35, 0.2, 'paint', nrm)

    # the leg's four faces between the montants: lattice horizontals + twin-bar diagonals
    for face in ('aW', 'aI', 'bW', 'bI'):
        def fp(y, t, off=0.0):
            span_lo, span_hi = I(y) + MW(y), W(y) - MW(y)
            other = span_lo + t * (span_hi - span_lo)
            fix = W(y) - R - off if face[1] == 'W' else I(y) + R + off
            return legp(su, sv, fix, y, other) if face[0] == 'a' else legp(su, sv, other, y, fix)
        nrm = (su, 0, 0) if face[0] == 'a' else (0, 0, sv)
        st = steps(3.0, LEG_TOP - 1.0, lambda y: 0.58 * (L(y) - 2 * MW(y)))
        for j, y in enumerate(st):
            g = 0.075 * L(y)
            # lattice horizontal: two chords + lacing
            strut('leg horizontal', fp(y, -0.02), fp(y, 1.02), 0.45, 0.35, 'paint', nrm)
            strut('leg horizontal', fp(y + g, -0.02), fp(y + g, 1.02), 0.45, 0.35, 'paint', nrm)
            n = max(4, int(round((L(y) - 2 * MW(y)) / g)))
            for i in range(n):
                t0, t1 = i / n, (i + 1) / n
                ya, yb = (y, y + g) if i % 2 == 0 else (y + g, y)
                strut('leg horizontal lacing', fp(ya, t0), fp(yb, t1), 0.16, 0.12, 'paint', nrm, smooth=True)
            if j == len(st) - 1:
                break
            yn = st[j + 1]
            detailed = y < Y1 + 8
            for t0, t1 in ((0.0, 1.0), (1.0, 0.0)):
                p0, p1 = Vector(fp(y + g, t0)), Vector(fp(yn, t1))
                ax = (p1 - p0).normalized()
                side = ax.cross(Vector(nrm)).normalized()
                gap = 0.34 if detailed else 0.0
                if detailed:
                    for sgn in (-1, 1):
                        strut('leg diagonal', p0 + side * sgn * gap, p1 + side * sgn * gap, 0.26, 0.3, 'paint', nrm)
                    k = max(3, int((p1 - p0).length / 0.9))
                    for i in range(k):
                        a0 = p0 + (p1 - p0) * (i / k) + side * (gap if i % 2 == 0 else -gap)
                        a1 = p0 + (p1 - p0) * ((i + 1) / k) + side * (-gap if i % 2 == 0 else gap)
                        strut('leg diagonal lacing', a0, a1, 0.11, 0.1, 'paint', nrm, smooth=True)
                else:
                    strut('leg diagonal', p0, p1, 0.55, 0.35, 'paint', nrm)

    # masonry footings under each montant
    for A in ('out', 'in'):
        for B in ('out', 'in'):
            mw = MW(0)
            ca = W(0) - mw / 2 if A == 'out' else I(0) + mw / 2
            cb = W(0) - mw / 2 if B == 'out' else I(0) + mw / 2
            h = mw / 2 + 0.7
            p = legp(su, sv, ca, 0, cb)
            box('footing', (p[0] - h, 0.0, p[2] - h), (p[0] + h, 1.6, p[2] + h), 'stone')
            box('footing cap', (p[0] - h - 0.2, 1.6, p[2] - h - 0.2), (p[0] + h + 0.2, 2.0, p[2] + h + 0.2), 'stone')


for su, sv in LEG_SIGNS:
    build_leg(su, sv)


# ---- arches between the legs, spandrels ------------------------------------------------------------
# photos ref02/ref05: the arch crown sits right under the frieze, which sits under the arcade band
ARCH_CROWN, ARCH_SPRING, ARCH_DEPTH, ARCH_THICK = 40.5, 20.0, 3.2, 1.6
BELT1_LO, BELT1_HI = 44.4, Y1
ts = I(ARCH_SPRING)
RA = (ts ** 2 + (ARCH_CROWN - ARCH_SPRING) ** 2) / (2 * (ARCH_CROWN - ARCH_SPRING))
YC = ARCH_CROWN - RA


def facep(axis, s, n, y, t):
    return (s * n, y, t) if axis == 'u' else (t, y, s * n)


for axis in ('u', 'v'):
    for s in (1, -1):
        nrm = (s, 0, 0) if axis == 'u' else (0, 0, s)

        def ap(t, rad, back):
            y = YC + math.sqrt(max(rad * rad - t * t, 0.0))
            return facep(axis, s, W(y) - R - back, y, t)
        tmax = min(ts + 0.9, RA * 0.985)
        N = 44
        tt = [-tmax + 2 * tmax * i / N for i in range(N + 1)]
        for rad in (RA, RA + ARCH_DEPTH):
            for back in (0.0, ARCH_THICK):
                m.tube('arch chord', [ap(t, rad, back) for t in tt], 0.32, 'paint', 6)
        # lacing in the two arch planes, ties between them
        n = 64
        for back in (0.0, ARCH_THICK):
            for i in range(n):
                t0 = -tmax + 2 * tmax * i / n
                t1 = -tmax + 2 * tmax * (i + 1) / n
                r0, r1 = (RA, RA + ARCH_DEPTH) if i % 2 == 0 else (RA + ARCH_DEPTH, RA)
                strut('arch lacing', ap(t0, r0, back), ap(t1, r1, back), 0.2, 0.15, 'paint', nrm, smooth=True)
        for i in range(0, n + 1, 4):
            t0 = -tmax + 2 * tmax * i / n
            for rad in (RA, RA + ARCH_DEPTH):
                strut('arch tie', ap(t0, rad, 0.0), ap(t0, rad, ARCH_THICK), 0.25, 0.25, 'paint')
        # spandrels: a lattice of posts and cross lacing from the extrados up to the frieze girder,
        # with the ornamental rings where the bay is tall (near the legs)
        rad = RA + ARCH_DEPTH
        A = (0, 0, 1) if axis == 'u' else (1, 0, 0)
        edge = I(BELT1_LO) + 1.0
        posts = []
        t = -edge
        while t <= edge + 1e-6:
            ye = YC + math.sqrt(max(rad * rad - t * t, 0.0)) if abs(t) < rad else BELT1_LO
            ye = min(ye, BELT1_LO)
            posts.append((t, ye))
            t += 1.8
        for k, (t, ye) in enumerate(posts):
            gap = BELT1_LO - ye
            if gap > 0.6:
                strut('spandrel post', facep(axis, s, W(ye) - R, ye, t), facep(axis, s, W(BELT1_LO) - R, BELT1_LO, t), 0.26, 0.26, 'paint', nrm)
            if k + 1 < len(posts):
                t1, ye1 = posts[k + 1]
                lo0, lo1 = ye + 0.3, ye1 + 0.3
                if BELT1_LO - max(lo0, lo1) > 0.8:
                    strut('spandrel lacing', facep(axis, s, W(lo0) - R, lo0, t), facep(axis, s, W(BELT1_LO) - R, BELT1_LO - 0.2, t1), 0.13, 0.1, 'paint', nrm, smooth=True)
                    strut('spandrel lacing', facep(axis, s, W(BELT1_LO) - R, BELT1_LO - 0.2, t), facep(axis, s, W(lo1) - R, lo1, t1), 0.13, 0.1, 'paint', nrm, smooth=True)
                gap2 = BELT1_LO - max(ye, ye1)
                if gap2 > 4.0 and k % 2 == 0:
                    ym = max(ye, ye1) + gap2 * 0.5
                    ring_tube('spandrel ring', facep(axis, s, W(ym) - R - 0.25, ym, (t + t1) / 2), min(gap2 * 0.3, 2.4), 0.13, A, (0, 1, 0), 'paint', 18)


# ---- first level (photos ref02/ref05): lattice frieze, arcade band, glazed gallery, roof railing ----
# Bottom to top: X-lattice frieze girder 44.4-52.6, a band of small round arches 52.6-57.2 carrying the
# floor, the continuous glazed gallery round the whole level 57.6-63.2, its roof and a railing on it.
FRIEZE_TOP = 52.6
B1 = W(49.0) + 0.3


def rect(label, p, q, mat='paint'):
    box(label, tuple(min(x, y) for x, y in zip(p, q)), tuple(max(x, y) for x, y in zip(p, q)), mat)


for axis in ('u', 'v'):
    for s in (1, -1):
        nrm = (s, 0, 0) if axis == 'u' else (0, 0, s)
        A = (0, 0, 1) if axis == 'u' else (1, 0, 0)

        def fp1(n, y, t):
            return facep(axis, s, n, y, t)
        half = B1 + 0.4
        rect('frieze panel', fp1(B1 - 1.0, BELT1_LO, -half + 0.6), fp1(B1 - 0.7, FRIEZE_TOP, half - 0.6), 'steel')
        ym = (BELT1_LO + FRIEZE_TOP) / 2
        for y, w in ((BELT1_LO + 0.45, 0.8), (ym, 0.45), (FRIEZE_TOP - 0.4, 0.7)):
            strut('frieze chord', fp1(B1, y, -half), fp1(B1, y, half), w, 0.6, 'paint', nrm)
        nb = 36
        for i in range(nb + 1):
            t = -half + 2 * half * i / nb
            strut('frieze post', fp1(B1, BELT1_LO, t), fp1(B1, FRIEZE_TOP, t), 0.4, 0.5, 'paint', nrm)
            if i < nb:
                t1 = -half + 2 * half * (i + 1) / nb
                for y0, y1 in ((BELT1_LO + 0.8, ym - 0.2), (ym + 0.2, FRIEZE_TOP - 0.7)):
                    strut('frieze lacing', fp1(B1, y0, t), fp1(B1, y1, t1), 0.2, 0.14, 'paint', nrm, smooth=True)
                    strut('frieze lacing', fp1(B1, y1, t), fp1(B1, y0, t1), 0.2, 0.14, 'paint', nrm, smooth=True)
        # arcade band under the floor: posts and round arches standing slightly proud, dark behind
        ARC = B1 + 0.7
        ahalf = B1 + 1.3
        rect('arcade panel', fp1(B1 - 0.9, FRIEZE_TOP, -ahalf + 0.4), fp1(B1 - 0.6, Y1 - 0.4, ahalf - 0.4), 'steel')
        na = 30
        pitch = 2 * ahalf / na
        for i in range(na + 1):
            t = -ahalf + pitch * i
            strut('arcade post', fp1(ARC, FRIEZE_TOP, t), fp1(ARC, Y1 - 0.4, t), 0.45, 0.5, 'paint', nrm)
            # a console from the frieze out to the gallery floor behind each post
            strut('arcade console', fp1(B1, FRIEZE_TOP + 0.3, t), fp1(ARC + 1.0, Y1 - 0.45, t), 0.3, 0.3, 'paint', A)
            if i < na:
                c = fp1(ARC, Y1 - 0.9 - pitch / 2, t + pitch / 2)
                ring_tube('arcade arch', c, pitch / 2 - 0.22, 0.16, A, (0, 1, 0), 'paint', 10, arc=(0, math.pi))
        strut('arcade sill', fp1(ARC, FRIEZE_TOP + 0.25, -ahalf), fp1(ARC, FRIEZE_TOP + 0.25, ahalf), 0.5, 0.6, 'paint', nrm)
        # floor: thin slab on cross girders, overhanging to carry the gallery
        rect('first deck', fp1(16.0, Y1 - 0.45, -B1 - 1.9), fp1(B1 + 1.9, Y1, B1 + 1.9))
        for i in range(19):
            t = -16.0 + 32.0 * i / 18
            strut('deck girder', fp1(16.0, Y1 - 1.3, t), fp1(B1 - 0.8, Y1 - 1.3, t), 0.35, 1.6, 'paint', (0, 1, 0))
        IN1, IH = 16.0, 5.5
        rect('void panel', fp1(IN1 - 0.25, Y1 - IH, -IN1), fp1(IN1 + 0.05, Y1 - 0.45, IN1), 'steel')
        for y in (Y1 - IH + 0.35, Y1 - 0.8):
            strut('void chord', fp1(IN1 - 0.6, y, -IN1), fp1(IN1 - 0.6, y, IN1), 0.6, 0.45, 'paint', nrm)
        for i in range(13):
            t = -IN1 + 2 * IN1 * i / 12
            strut('void post', fp1(IN1 - 0.6, Y1 - IH, t), fp1(IN1 - 0.6, Y1 - 0.45, t), 0.35, 0.35, 'paint', nrm)
            if i < 12:
                t1 = -IN1 + 2 * IN1 * (i + 1) / 12
                strut('void lacing', fp1(IN1 - 0.6, Y1 - IH + 0.6, t), fp1(IN1 - 0.6, Y1 - 1.1, t1), 0.15, 0.12, 'paint', nrm, smooth=True)
                strut('void lacing', fp1(IN1 - 0.6, Y1 - 1.1, t), fp1(IN1 - 0.6, Y1 - IH + 0.6, t1), 0.15, 0.12, 'paint', nrm, smooth=True)
        # the glazed gallery all the way round the level, mullions, roof and railing
        GO, GT = B1 + 1.4, Y1 + 5.6
        rect('first gallery', fp1(B1 - 4.5, Y1, -GO), fp1(GO, GT, GO), 'glass')
        ng = 40
        for i in range(ng + 1):
            t = -GO + 2 * GO * i / ng
            strut('gallery mullion', fp1(GO + 0.08, Y1, t), fp1(GO + 0.08, GT, t), 0.22, 0.18, 'paint', nrm)
        strut('gallery transom', fp1(GO + 0.08, Y1 + 1.1, -GO), fp1(GO + 0.08, Y1 + 1.1, GO), 0.2, 0.18, 'paint', nrm)
        rect('gallery roof', fp1(B1 - 4.8, GT, -GO - 0.5), fp1(GO + 0.5, GT + 0.55, GO + 0.5))
        nr = 44
        for i in range(nr + 1):
            t = -GO - 0.3 + 2 * (GO + 0.3) * i / nr
            strut('roof rail post', fp1(GO + 0.3, GT + 0.55, t), fp1(GO + 0.3, GT + 1.9, t), 0.14, 0.14, 'paint', nrm, smooth=True)
        strut('roof rail', fp1(GO + 0.3, GT + 1.9, -GO - 0.35), fp1(GO + 0.3, GT + 1.9, GO + 0.35), 0.2, 0.2, 'paint', nrm)


# ---- second level (photos ref02/ref05): X-lattice girder band, open storey, consoles, overhanging floor ----
B2 = W(102.0) + 0.3
G2_LO, G2_HI = 99.5, 105.0
C2_LO = 111.0
for axis in ('u', 'v'):
    for s in (1, -1):
        nrm = (s, 0, 0) if axis == 'u' else (0, 0, s)
        A = (0, 0, 1) if axis == 'u' else (1, 0, 0)

        def fp2(n, y, t):
            return facep(axis, s, n, y, t)
        half = B2 + 0.3
        rect('second girder panel', fp2(B2 - 1.0, G2_LO, -half + 0.5), fp2(B2 - 0.7, G2_HI, half - 0.5), 'steel')
        for y in (G2_LO + 0.35, G2_HI - 0.35):
            strut('second chord', fp2(B2, y, -half), fp2(B2, y, half), 0.7, 0.5, 'paint', nrm)
        nb = 12
        for i in range(nb + 1):
            t = -half + 2 * half * i / nb
            strut('second post', fp2(B2, G2_LO, t), fp2(B2, G2_HI, t), 0.4, 0.4, 'paint', nrm)
            if i < nb:
                t1 = -half + 2 * half * (i + 1) / nb
                strut('second lacing', fp2(B2, G2_LO + 0.6, t), fp2(B2, G2_HI - 0.6, t1), 0.26, 0.2, 'paint', nrm)
                strut('second lacing', fp2(B2, G2_HI - 0.6, t), fp2(B2, G2_LO + 0.6, t1), 0.26, 0.2, 'paint', nrm)
        # consoles: a row of round-arched brackets carrying the overhanging floor
        B2c = W(C2_LO) - R
        chalf = W(Y2) + 0.4
        rect('console panel', fp2(B2c - 1.0, C2_LO, -chalf + 0.4), fp2(B2c - 0.7, Y2 - 0.5, chalf - 0.4), 'steel')
        nc = 14
        pitch = 2 * chalf / nc
        for i in range(nc + 1):
            t = -chalf + pitch * i
            pts = [fp2(B2c + 2.2 * (1 - math.cos(a)), C2_LO + 4.2 * math.sin(a), t)
                   for a in (k * math.pi / 2 / 6 for k in range(7))]
            m.tube('second console', pts, 0.2, 'paint', 5)
            if i < nc:
                c = fp2(B2c + 2.0, Y2 - 0.6 - pitch / 2, t + pitch / 2)
                ring_tube('console arch', c, pitch / 2 - 0.2, 0.14, A, (0, 1, 0), 'paint', 10, arc=(0, math.pi))
        rect('second deck', fp2(3.0, Y2 - 0.6, -B2c - 2.6), fp2(B2c + 2.6, Y2, B2c + 2.6))
        rect('second fascia', fp2(B2c + 2.1, Y2 - 1.2, -B2c - 2.6), fp2(B2c + 2.6, Y2, B2c + 2.6))
        RL = B2c + 2.4
        nr = 22
        pitch = 2 * RL / nr
        for i in range(nr + 1):
            t = -RL + pitch * i
            strut('second rail post', fp2(RL, Y2, t), fp2(RL, Y2 + 2.2, t), 0.25, 0.25, 'paint', nrm)
            if i < nr:
                strut('second rail lacing', fp2(RL, Y2 + 0.2, t), fp2(RL, Y2 + 2.0, t + pitch), 0.12, 0.1, 'paint', nrm, smooth=True)
                strut('second rail lacing', fp2(RL, Y2 + 2.0, t), fp2(RL, Y2 + 0.2, t + pitch), 0.12, 0.1, 'paint', nrm, smooth=True)
        strut('second top rail', fp2(RL, Y2 + 2.25, -RL - 0.1), fp2(RL, Y2 + 2.25, RL + 0.1), 0.3, 0.3, 'paint', nrm)
        rect('second pavilion', fp2(B2c - 4.0, Y2, -9.0), fp2(B2c - 1.0, Y2 + 4.5, 9.0), 'glass')
        rect('second pavilion roof', fp2(B2c - 4.3, Y2 + 4.5, -9.3), fp2(B2c - 0.6, Y2 + 4.9, 9.3))


# ---- upper shaft (second level to third level): fewer, larger members ------------------------------
SH0, SH1 = Y2 - 1.0, Y3 - 0.4
ys = [SH0 + (SH1 - SH0) * i / 24 for i in range(25)]
loft('shaft core', [[(a * (W(y) - CORE_IN), y, b * (W(y) - CORE_IN)) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))] for y in ys], 'steel')
for su, sv in LEG_SIGNS:
    # corner column: three visible chords + lacing on its two outer faces
    for pa, pb in ((0, 0), (0, 1), (1, 0)):
        rings = []
        for y in ys:
            a = W(y) - R if pa == 0 else W(y) - C(y) + R
            b = W(y) - R if pb == 0 else W(y) - C(y) + R
            rings.append([(su * (a + da), y, sv * (b + db)) for da, db in ((-R, -R), (R, -R), (R, R), (-R, R))])
        loft('column chord', rings, 'paint', smooth=True)
    st = steps(SH0 + 0.5, SH1, lambda y: 1.5 * C(y))
    for face in ('a', 'b'):
        pts = []
        for k, y in enumerate(st):
            e, h = W(y) - R, W(y) - C(y) + R
            pts.append((su * e, y, sv * (e if k % 2 == 0 else h)) if face == 'a' else (su * (e if k % 2 == 0 else h), y, sv * e))
        nrm = (su, 0, 0) if face == 'a' else (0, 0, sv)
        for p0, p1 in zip(pts, pts[1:]):
            strut('column lacing', p0, p1, 0.22, 0.16, 'paint', nrm, smooth=True)
for axis in ('u', 'v'):
    for s in (1, -1):
        nrm = (s, 0, 0) if axis == 'u' else (0, 0, s)

        def fs(y, t):
            span = W(y) - C(y)
            return facep(axis, s, W(y) - R, y, -span + 2 * span * t)
        st = steps(Y2 + 1.2, SH1, lambda y: 0.42 * 2 * (W(y) - C(y)))
        for j, y in enumerate(st):
            strut('shaft horizontal', fs(y, -0.03), fs(y, 1.03), 0.5, 0.4, 'paint', nrm)
            if j == len(st) - 1:
                break
            yn = st[j + 1]
            strut('shaft diagonal', fs(y, 0.0), fs(yn, 1.0), 0.42, 0.35, 'paint', nrm)
            strut('shaft diagonal', fs(y, 1.0), fs(yn, 0.0), 0.42, 0.35, 'paint', nrm)
            # the strong centre vertical of each face (photos ref02/ref05)
            strut('shaft centre', fs(y, 0.5), fs(yn, 0.5), 0.5, 0.45, 'paint', nrm)


# ---- third level (photo ref05 crop): consoles under the platform, cabin, open deck, campanile, antennas ----
H3 = 8.8
box('third deck', (-H3, Y3 - 0.6, -H3), (H3, Y3 + 0.2, H3))
for axis in ('u', 'v'):
    for s in (1, -1):
        nrm = (s, 0, 0) if axis == 'u' else (0, 0, s)
        A = (0, 0, 1) if axis == 'u' else (1, 0, 0)
        # curved consoles from the shaft out to the platform edge, small arches between them
        y0 = Y3 - 7.0
        for i in range(7):
            t = -W(y0) + 2 * W(y0) * i / 6
            pts = []
            for k in range(7):
                a = k * math.pi / 2 / 6
                y = y0 + 6.4 * math.sin(a)
                pts.append(facep(axis, s, W(y) - R + (H3 - 0.4 - W(Y3)) * (1 - math.cos(a)), y, t * (1 + 0.6 * (1 - math.cos(a)))))
            m.tube('third console', pts, 0.22, 'paint', 5)
        for i in range(6):
            t = -H3 + 2 * H3 * (i + 0.5) / 6
            ring_tube('third console arch', facep(axis, s, H3 - 0.3, Y3 - 0.6 - 1.4, t), H3 / 6 - 0.15, 0.13, A, (0, 1, 0), 'paint', 8, arc=(0, math.pi))
        for i in range(11):
            t = -8.25 + 16.5 * i / 10
            strut('cabin mullion', facep(axis, s, 8.3, Y3 + 0.2, t), facep(axis, s, 8.3, Y3 + 3.6, t), 0.22, 0.15, 'paint', nrm)
        for i in range(12):
            t = -8.6 + 17.2 * i / 11
            strut('top rail post', facep(axis, s, 8.6, Y3 + 4.1, t), facep(axis, s, 8.6, Y3 + 5.5, t), 0.16, 0.16, 'paint', nrm)
        strut('top rail', facep(axis, s, 8.6, Y3 + 5.5, -8.7), facep(axis, s, 8.6, Y3 + 5.5, 8.7), 0.18, 0.18, 'paint', nrm)
box('third cabin', (-8.2, Y3 + 0.2, -8.2), (8.2, Y3 + 3.6, 8.2), 'glass')
box('third upper deck', (-8.8, Y3 + 3.6, -8.8), (8.8, Y3 + 4.1, 8.8))
box('summit room', (-4.8, Y3 + 4.1, -4.8), (4.8, Y3 + 7.2, 4.8), 'steel')
box('summit roof', (-5.4, Y3 + 7.2, -5.4), (5.4, Y3 + 7.6, 5.4))
CB, CT = Y3 + 7.6, 291.0
for su, sv in LEG_SIGNS:
    strut('campanile post', (su * 4.5, CB, sv * 4.5), (su * 3.0, CT, sv * 3.0), 0.7, 0.7)


def post_x(y):
    return 4.5 + (3.0 - 4.5) * (y - CB) / (CT - CB)


for axis in ('u', 'v'):
    for s in (1, -1):
        nrm = (s, 0, 0) if axis == 'u' else (0, 0, s)
        ys, hh = CB + 1.0, CT - CB - 1.6
        pts = []
        for i in range(13):
            th = math.pi * i / 12
            y = ys + hh * math.sin(th)
            pts.append(facep(axis, s, post_x(y) - 0.1, y, -(post_x(y) - 0.3) * math.cos(th)))
        m.tube('campanile arch', pts, 0.22, 'paint', 6)
        yb = CB + 0.9
        strut('campanile tie', facep(axis, s, post_x(yb), yb, -post_x(yb)), facep(axis, s, post_x(yb), yb, post_x(yb)), 0.3, 0.3, 'paint', nrm)
# equipment cabinets on the summit roof (the antenna clutter seen from the street)
for i, (cu, cv, h) in enumerate(((3.6, 0.0, 1.6), (-3.6, 1.0, 1.2), (0.5, 3.7, 1.4), (-1.2, -3.7, 1.8), (3.4, 3.4, 1.0), (-3.4, -3.3, 1.3))):
    box('summit cabinet', (cu - 0.5, CB, cv - 0.5), (cu + 0.5, CB + h, cv + 0.5), 'steel')
box('campanile platform', (-3.4, CT, -3.4), (3.4, CT + 0.9, 3.4))
box('lantern', (-2.0, CT + 0.9, -2.0), (2.0, CT + 3.4, 2.0), 'steel')
box('lantern cap', (-2.3, CT + 3.4, -2.3), (2.3, CT + 3.9, 2.3))
# lattice antenna mast: four chords converging, X lacing, antenna panels
MB, MT = CT + 3.9, 313.0
def mh(y):
    return 1.5 + (0.7 - 1.5) * (y - MB) / (MT - MB)
for su, sv in LEG_SIGNS:
    strut('mast chord', (su * mh(MB), MB, sv * mh(MB)), (su * mh(MT), MT, sv * mh(MT)), 0.28, 0.28, 'steel')
yk = [MB + (MT - MB) * i / 8 for i in range(9)]
for axis in ('u', 'v'):
    for s in (1, -1):
        nrm = (s, 0, 0) if axis == 'u' else (0, 0, s)
        for a, b in zip(yk, yk[1:]):
            strut('mast lacing', facep(axis, s, mh(a), a, -mh(a)), facep(axis, s, mh(b), b, mh(b)), 0.12, 0.12, 'steel', nrm, smooth=True)
            strut('mast lacing', facep(axis, s, mh(a), a, mh(a)), facep(axis, s, mh(b), b, -mh(b)), 0.12, 0.12, 'steel', nrm, smooth=True)
            strut('mast strut', facep(axis, s, mh(a), a, -mh(a)), facep(axis, s, mh(a), a, mh(a)), 0.14, 0.14, 'steel', nrm, smooth=True)
        for y in (MB + 3.0, MB + 9.0, MB + 14.0):
            rect('antenna panel', facep(axis, s, mh(y) + 0.1, y, -0.35), facep(axis, s, mh(y) + 0.4, y + 2.2, 0.35), 'steel')
loft('antenna mast', [[(r * math.cos(i * math.tau / 8), y, r * math.sin(i * math.tau / 8)) for i in range(8)]
                      for r, y in ((0.45, MT), (0.3, 320.0), (0.18, 326.0), (0.1, 330.0))], 'steel', smooth=True)
strut('antenna crossbar', (-1.6, 325.5, 0), (1.6, 325.5, 0), 0.14, 0.14, 'steel')
strut('antenna crossbar', (0, 324.0, -1.1), (0, 324.0, 1.1), 0.12, 0.12, 'steel')

print({k: v for k, v in sorted(STATS.items())})
info = m.finish(directory=SCRATCH)
