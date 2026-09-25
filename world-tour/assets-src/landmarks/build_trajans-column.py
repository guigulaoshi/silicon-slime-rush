"""Trajan's Column (Colonna Traiana), Rome, dedicated AD 113 -- built from published dimensions and photos.

Fact card
  Map object   OpenStreetMap relation 3376015 "Colonna di Traiano" (historic=monument, man_made=column,
               building=yes). Outline 5.59 x 5.62 m, faces looking NNE / ESE / SSW / WNW. The author frame is the
               outline's own: +v = the face towards the Basilica Ulpia (SE: door and inscription), -u = the face
               towards Via dei Fori Imperiali / Piazza Venezia (WSW).
  Where seen   The rome route passes 71.6 m WSW of it, approaching the finish at the Vittoriano from the SE: the -u
               face is square on at the closest point, the SE face at an angle on the approach. Maximum view
               elevation ~31 deg, the "drive up to it" tier: frieze, capital and statue carry real geometry.
  Heights      all from the court floor (y 0, the placement datum):
               pedestal 6.16 m incl. plinth (5.29 m without), 6.18 m square ......... trajans-column.org "Facts and
                                                                                    Metrics"
               column 29.78 m = base 1.685 + shaft 26.92 + capital 1.16 ............. same; de.wikipedia
               shaft diameter 3.695 m at the foot, 3.20 m at the top ................ trajans-column.org
               abacus 4.34 m square, face 0.65 m .................................... trajans-column.org
               top of the statue base 38.40 m above the plinth (35.07 to the column
               top) -> statue base 3.33 m ........................................... de.wikipedia, trajans-column.org
               frieze 23 turns (de/en.wikipedia, archeoroma); band 0.89 -> 1.25 m bottom to top (it.wikipedia,
               trajans-column.org). 23 turns at those heights fill 24.6 m, the shaft offers 27.2 m above the torus,
               so the bands keep the published ratio and are scaled 1.10x (0.98 -> 1.38 m).
               St Peter (bronze, 1587-88) ~4.1 m incl. halo: PHOTO ESTIMATE (no published figure found), scaled on
               ref29 against the 3.20 m shaft top and the 3.33 m statue base.
               Built top: 6.16 + 29.78 + 3.33 + 4.1 = 43.4 m above the court floor.
  Setting      The column stands in the excavated court between the Basilica Ulpia and the two libraries. The
               street railing is level with about the pedestal cornice / laurel torus (photo estimate ref01, ref08,
               ref27), so the court floor is ~5 m below the modern street.

Parts a Roman would name -- built / simplified / not built
  pedestal: lower block, base moulding, die, cornice, top moulding ........... built
  trophies of captured Dacian arms on three faces and beside the door ........ simplified: carved height field of
                                                                               shields, helmets, cuirasses, cloaks,
                                                                               spears (arrangement invented)
  inscription panel on the SE face held by two winged Victories .............. built: framed plain panel (no text) +
                                                                               Victory height fields
  door to the tomb chamber under the inscription ............................. built: real recess, frame, dark leaf
  eagles at the four corners holding laurel garlands, head mid-face .......... built
  laurel-wreath torus (column base) .......................................... built, leaves as crossing ridges
  shaft with the spiral frieze, 23 turns ..................................... built: helical groove between the
                                                                               bands, band faces carved (noise); the
                                                                               2,500 figures (60-80 cm) are not
                                                                               modelled -- a pixel or two from 70 m
  43 window slits of the internal stair ...................................... not built: ~10 cm wide, not visible
                                                                               from the road, would cut the frieze
  Doric capital: astragal, egg-and-dart echinus (24 eggs), abacus ............ built
  railing round the viewing platform ......................................... built (iron posts and two rails)
  drum-and-dome statue base, bronze moulded plinth ........................... built
  bronze St Peter: keys held out in the right hand, book, halo ............... simplified figure (lathed robe, arms,
                                                                               keys, book, halo); facing SE is
                                                                               UNVERIFIED (photo estimate)
  sunken court, its retaining walls and the street railing ................... not built: that is terrain, a GLB
                                                                               cannot cut the ground; needs a route
                                                                               `levelAreas` pit with heightM
  Basilica Ulpia column stumps, library walls ................................ not built: separate ruins
Style grammar (classical): base mouldings, cornice with corona, torus, astragal, echinus, abacus -- all built.

Reference photos (Wikimedia Commons, kept outside the repository): ref01 from the Basilica Ulpia, ref08 1880s
engraving from the forum, ref27 whole column from the Basilica Ulpia (pedestal proportions), ref29 HD elevation
(capital, statue), ref34 from Piazza Venezia (the route's side), ref38 the SE face door and inscription.
Run: Blender --background --python assets-src/landmarks/build_trajans-column.py
"""
import math
import random
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'trajans-column'
SCRATCH = Path(tempfile.gettempdir()) / 'sr-landmarks' / ID

# ---------------------------------------------------------------- dimensions (m, court floor = 0)
HW_BASE = 3.09                 # lower block, 6.18 m square (published)
HW_DIE = 2.79                  # die, from the OSM outline (5.59 x 5.62 m)
HW_CORE = 2.50                 # solid core behind the carved skins; back wall of the door recess
Y_BASE, Y_MOULD = 1.45, 1.76   # lower block, base moulding (ref27 proportions)
Y_DIE = 4.47                   # die top (ref27, ref38)
Y_CORNICE = 4.97               # projecting cornice
Y_GARLAND = 5.97               # garland / eagle zone
Y_PED = 6.16                   # pedestal top incl. plinth (published)
Y_TORUS = 7.00                 # laurel torus 6.16 .. 7.00, ~4.9 m across (ref27)
Y_FRIEZE0, Y_FRIEZE1 = 7.30, 34.50
Y_SHAFT = Y_PED + 1.685 + 26.92                     # 34.765: top of the shaft proper (published base + shaft)
Y_ABACUS0, Y_TOP = Y_SHAFT + 0.51, Y_PED + 29.78    # abacus face 0.65 m; column top 35.94 (published)
R_FOOT, R_TOP = 3.695 / 2, 3.20 / 2
HW_ABACUS = 4.34 / 2
Y_STATUE = Y_TOP + 3.33        # statue base top 39.27 (published: 38.40 above the plinth)
STATUE_H = 4.1                 # photo estimate
DOOR_S, DOOR_Y0, DOOR_Y1 = 0.53, 0.88, 2.70         # door half width, sill, head (ref38, ref27)
TURNS = 23
BAND_RATIO = 1.25 / 0.89                            # band height top / bottom (published)

m = Model(ID)
m.material('marble', (0.75, 0.69, 0.59), 0.0, 0.72, ID + '_marble')      # same stone as the Arch of Constantine
m.material('carved', (0.73, 0.67, 0.57), 0.0, 0.82, ID + '_carved')
m.material('bronze', (0.13, 0.22, 0.18), 0.55, 0.50, ID + '_bronze')     # green-patinated bronze (ref09, ref24)
m.material('iron', (0.05, 0.06, 0.06), 0.4, 0.6, ID + '_iron')
m.material('door', (0.07, 0.11, 0.11), 0.2, 0.6, ID + '_door_iron')      # painted iron door (ref38)

# ---------------------------------------------------------------- face frames
# face k: outward normal N[k] and tangent T[k] in (u, v); a face point is (s along T, e out along N, y).
N = [(1, 0), (0, 1), (-1, 0), (0, -1)]
T = [(-n[1], n[0]) for n in N]
SE = 1                          # +v faces the Basilica Ulpia (inscription, door); -u (k = 2) faces the route


def v3(p2):
    return (p2[0], 0.0, p2[1])


def fp(k, s, e, y):
    return (N[k][0] * e + T[k][0] * s, y, N[k][1] * e + T[k][1] * s)


def emit(label, verts, faces, mat, smooth=False):
    m.mesh(label, [tuple(float(c) for c in p) for p in verts], faces, mat, smooth)


def stack(label, stations, mat, closed=False, smooth=False):
    """Loft equal-length loops; open lofts are capped at both ends."""
    K, M = len(stations), len(stations[0])
    verts = [p for st in stations for p in st]
    faces = []
    for k in range(K if closed else K - 1):
        a, b = k * M, ((k + 1) % K) * M
        faces += [(a + j, a + (j + 1) % M, b + (j + 1) % M, b + j) for j in range(M)]
    if not closed:
        faces += [tuple(reversed(range(M))), tuple((K - 1) * M + j for j in range(M))]
    emit(label, verts, faces, mat, smooth)


def box(label, u0, u1, y0, y1, v0, v1, mat):
    u0, u1 = sorted((u0, u1)); v0, v1 = sorted((v0, v1))
    stack(label, [[(u0, y, v0), (u1, y, v0), (u1, y, v1), (u0, y, v1)] for y in (y0, y1)], mat)


def fbox(label, k, s0, s1, e0, e1, y0, y1, mat):
    a, b = fp(k, s0, e0, 0), fp(k, s1, e1, 0)
    box(label, a[0], b[0], y0, y1, a[2], b[2], mat)


def square(label, prof, mat):
    """Moulded square block: prof = [(y, half width)], bottom to top."""
    stack(label, [[(-h, y, -h), (h, y, -h), (h, y, h), (-h, y, h)] for y, h in prof], mat)


def lathe(label, prof, mat, sides=48):
    stack(label, [[(r * math.cos(j * math.tau / sides), y, r * math.sin(j * math.tau / sides)) for j in range(sides)]
                  for y, r in prof], mat, smooth=True)


def tube(label, pts, r, mat, sides=8):
    st = []
    for i, p in enumerate(pts):
        a, b = np.array(pts[max(0, i - 1)], float), np.array(pts[min(len(pts) - 1, i + 1)], float)
        t = (b - a) / np.linalg.norm(b - a)
        o = np.array((0, 1, 0)) if abs(t[1]) < .9 else np.array((1, 0, 0))
        u = np.cross(t, o); u /= np.linalg.norm(u)
        v = np.cross(t, u)
        rr = r[i] if isinstance(r, (list, tuple)) else r
        st.append([tuple(np.array(p) + rr * (u * math.cos(j * math.tau / sides) + v * math.sin(j * math.tau / sides)))
                   for j in range(sides)])
    stack(label, st, mat, smooth=True)


def ellipsoid(label, c, radii, axes, mat, nu=10, nv=7):
    """Closed ellipsoid; axes = (a, b, c) directions in (u, y, v) for radii (ra, rb, rc); b is the pole axis."""
    A, B, C = (np.array(x, float) / np.linalg.norm(x) for x in axes)
    st = []
    for i in range(nv + 1):
        ph = -math.pi / 2 + math.pi * (0.04 + 0.92 * i / nv)       # stop short of the poles: no collapsed rings
        st.append([tuple(np.array(c, float) + radii[0] * math.cos(ph) * math.cos(j * math.tau / nu) * A
                         + radii[1] * math.sin(ph) * B + radii[2] * math.cos(ph) * math.sin(j * math.tau / nu) * C)
                   for j in range(nu)])
    stack(label, st, mat, smooth=True)


# ---------------------------------------------------------------- carved height fields
class Relief:
    def __init__(self):
        self.blobs = []

    def add(self, cx, cy, rx, ry, ang, d):
        self.blobs.append((cx, cy, rx, ry, ang, d))

    def h(self, S, Y):
        H = np.zeros_like(S)
        for cx, cy, rx, ry, a, d in self.blobs:
            ds, dy = S - cx, Y - cy
            c, s = math.cos(a), math.sin(a)
            q = ((ds * c + dy * s) / rx) ** 2 + ((-ds * s + dy * c) / ry) ** 2
            H = np.maximum(H, d * np.sqrt(np.clip(1 - q ** 3, 0, None)))   # flat-topped, steep-edged: carving
        return H


def hfield(label, k, D, s0, s1, y0, y1, ns, ny, R, back=0.25, mat='carved'):
    """Closed carved slab on face k: front at D + relief, back at D - back."""
    S, Y = np.meshgrid(np.linspace(s0, s1, ns), np.linspace(y0, y1, ny))
    H = R.h(S, Y) if R else np.zeros_like(S)
    front = [fp(k, S[j, i], D + H[j, i], Y[j, i]) for j in range(ny) for i in range(ns)]
    backp = [fp(k, S[j, i], D - back, Y[j, i]) for j in range(ny) for i in range(ns)]
    n = len(front)
    faces = []
    for j in range(ny - 1):
        for i in range(ns - 1):
            a = j * ns + i; b = a + 1; c = a + ns + 1; d = a + ns
            faces += [(a, b, c, d), (n + d, n + c, n + b, n + a)]
    bd = list(range(ns)) + [j * ns + ns - 1 for j in range(1, ny)] + \
        [(ny - 1) * ns + i for i in range(ns - 2, -1, -1)] + [j * ns for j in range(ny - 2, 0, -1)]
    faces += [(a, b, n + b, n + a) for a, b in zip(bd, bd[1:] + bd[:1])]
    emit(label, front + backp, faces, mat, smooth=True)


def arms(R, s0, s1, y0, y1, rng):
    """A heap of captured Dacian arms: oval shields with bosses, helmets, cuirasses, cloaks, spears (ref38)."""
    area = (s1 - s0) * (y1 - y0)
    for _ in range(max(2, int(area * 1.8))):
        x, y = rng.uniform(s0 + .3, s1 - .3), rng.uniform(y0 + .25, y1 - .2)
        R.add(x, y, rng.uniform(.28, .46), rng.uniform(.22, .36), rng.uniform(-.6, .6), rng.uniform(.09, .15))
        R.add(x, y, .07, .07, 0, .19)                                              # shield boss
    for _ in range(max(2, int(area * 1.4))):
        x, y = rng.uniform(s0 + .2, s1 - .2), rng.uniform(y0 + .15, y1 - .15)
        kind = rng.random()
        if kind < .3:
            R.add(x, y, .15, .13, 0, .15); R.add(x, y + .12, .06, .10, 0, .15)     # helmet with crest
        elif kind < .55:
            R.add(x, y, .20, .28, 0, .12); R.add(x, y - .3, .24, .06, 0, .10)      # cuirass and skirt
        elif kind < .8:
            R.add(x, y, rng.uniform(.5, .9), .025, rng.uniform(-1.2, 1.2), .07)    # spear / sword / trumpet
        else:
            R.add(x, y, .35, .09, rng.uniform(-.5, .5), .05)                       # folded cloak


def victory(R, x, y, L, d, f):
    """Winged Victory beside the inscription panel (ref38): body, head, two wings, raised arm, drapery."""
    R.add(x, y, .13 * L, .42 * L, f * .12, d)
    R.add(x + f * .03 * L, y + .48 * L, .07 * L, .08 * L, 0, d * .9)
    R.add(x - f * .12 * L, y + .12 * L, .30 * L, .14 * L, f * 1.05, d * .55)
    R.add(x - f * .10 * L, y + .30 * L, .24 * L, .09 * L, f * .85, d * .5)
    R.add(x + f * .15 * L, y + .28 * L, .20 * L, .035 * L, -f * .6, d * .7)
    R.add(x - f * .02 * L, y - .38 * L, .20 * L, .12 * L, 0, d * .6)


# ================================================================ pedestal
rng = random.Random(113)
box('pedestal core', -HW_CORE, HW_CORE, 0, Y_DIE, -HW_CORE, HW_CORE, 'marble')
for k in range(4):              # lower block: a skirt on each face, split round the door on the SE face
    if k == SE:
        fbox('lower block', k, -HW_BASE, -DOOR_S, HW_CORE - .05, HW_BASE, 0, Y_BASE, 'marble')
        fbox('lower block', k, DOOR_S, HW_BASE, HW_CORE - .05, HW_BASE, 0, Y_BASE, 'marble')
        fbox('door threshold', k, -DOOR_S, DOOR_S, HW_CORE - .05, HW_BASE, 0, DOOR_Y0, 'marble')
    else:
        fbox('lower block', k, -HW_BASE, HW_BASE, HW_CORE - .05, HW_BASE, 0, Y_BASE, 'marble')

# base moulding: one mitred sweep round the pedestal, from the SE door frame round to its other side
MOULD = [(0.00, Y_BASE), (0.00, Y_BASE + .08), (-.10, Y_BASE + .16), (-.20, Y_BASE + .23), (-.28, Y_BASE + .26),
         (-.30, Y_MOULD), (-.60, Y_MOULD), (-.60, Y_BASE)]          # (outward offset, y) from the block face
c = HW_BASE
loop = [np.array(p, float) for p in ((-.68, c), (-c, c), (-c, -c), (c, -c), (c, c), (.68, c))]   # SE face: v = +c
normals = []
for a, b in zip(loop, loop[1:]):
    t = (b - a) / np.linalg.norm(b - a)
    n = np.array((t[1], -t[0]))
    normals.append(n if np.dot(n, (a + b) / 2) > 0 else -n)
stations = []
for i, p in enumerate(loop):
    n0, n1 = normals[max(0, i - 1)], normals[min(i, len(normals) - 1)]
    mv = (n0 + n1) / np.dot(n0 + n1, n1)
    stations.append([(p[0] + e * mv[0], y, p[1] + e * mv[1]) for e, y in MOULD])
stack('base moulding', stations, 'marble')

# die: carved skins; the SE face carries the door, the inscription panel and the Victories
for k in range(4):
    if k != SE:
        R = Relief()
        arms(R, -HW_DIE, HW_DIE, Y_MOULD, Y_DIE, rng)
        hfield('trophies of Dacian arms', k, HW_DIE, -HW_DIE, HW_DIE, Y_MOULD, Y_DIE, 46, 24, R)
Y_PANEL = 3.13
for s0, s1 in ((-HW_DIE, -.68), (.68, HW_DIE)):
    R = Relief()
    arms(R, s0, s1, Y_MOULD, Y_PANEL, rng)
    hfield('trophies either side of the door', SE, HW_DIE, s0, s1, Y_MOULD, Y_PANEL, 18, 12, R)
hfield('field over the door', SE, HW_DIE, -.68, .68, 2.85, Y_PANEL, 3, 2, None, mat='marble')
R = Relief()
victory(R, -2.12, 3.78, 1.25, .14, 1)
victory(R, 2.12, 3.78, 1.25, .14, -1)
hfield('Victories holding the inscription', SE, HW_DIE, -HW_DIE, HW_DIE, Y_PANEL, Y_DIE, 44, 14, R)
fbox('inscription panel (blank)', SE, -1.42, 1.42, HW_DIE - .05, HW_DIE - .02, 3.20, 4.40, 'marble')
for s0, s1, y0, y1 in ((-1.52, 1.52, 3.13, 3.23), (-1.52, 1.52, 4.37, 4.47), (-1.52, -1.42, 3.13, 4.47),
                       (1.42, 1.52, 3.13, 4.47)):
    fbox('inscription frame', SE, s0, s1, HW_DIE - .05, HW_DIE + .05, y0, y1, 'marble')
# the door: a real recess back to the core, a moulded frame, a dark leaf (ref38)
for s0, s1, y0, y1 in ((-.68, -DOOR_S, DOOR_Y0, 2.85), (DOOR_S, .68, DOOR_Y0, 2.85), (-.68, .68, DOOR_Y1, 2.85)):
    fbox('door frame', SE, s0, s1, HW_CORE - .05, HW_DIE + .07, y0, y1, 'marble')
fbox('door leaf', SE, -DOOR_S + .02, DOOR_S - .02, HW_CORE - .05, HW_CORE + .04, DOOR_Y0, DOOR_Y1 - .02, 'door')
fbox('door step', SE, -.7, .7, HW_BASE - .05, HW_BASE + .35, 0, .22, 'marble')

# cornice, garland zone with the corner eagles, top moulding
square('cornice', [(Y_DIE - .02, HW_DIE - .02), (Y_DIE + .05, HW_DIE + .02), (Y_DIE + .11, HW_DIE + .06),
                   (Y_DIE + .17, HW_DIE + .12), (Y_DIE + .23, HW_DIE + .19), (Y_DIE + .27, HW_DIE + .26),
                   (Y_CORNICE - .08, HW_DIE + .28), (Y_CORNICE - .03, HW_DIE + .24), (Y_CORNICE, HW_DIE + .16)],
       'marble')
HW_G = HW_DIE - .06
square('garland block', [(Y_CORNICE - .01, HW_G), (Y_GARLAND, HW_G)], 'marble')
square('pedestal top moulding', [(Y_GARLAND - .01, HW_G), (Y_GARLAND + .06, HW_G + .05), (Y_GARLAND + .13, HW_G + .08),
                                 (Y_PED, HW_G + .08)], 'marble')
for k in range(4):
    for sgn in (-1, 1):                    # two laurel swags per face, from the corner eagle to the central head
        pts, rad = [], []
        for i in range(13):
            t = i / 12
            s = sgn * ((HW_G - .45) * (1 - t) + .18 * t)
            pts.append(fp(k, s, HW_G + .10, Y_GARLAND - .30 - .52 * math.sin(math.pi * t)))
            rad.append(.06 + .07 * math.sin(math.pi * t))
        tube('laurel garland', pts, rad, 'carved', sides=8)
    ellipsoid('garland head', fp(k, 0, HW_G + .02, Y_GARLAND - .38), (.17, .22, .10),
              (v3(T[k]), (0, 1, 0), v3(N[k])), 'carved', 8, 6)
for cu, cv in ((1, 1), (1, -1), (-1, 1), (-1, -1)):      # eagles at the corners, a wing along each face (ref27)
    c = np.array((cu, cv), float) * (HW_G - .12)
    out = np.array((cu, cv)) / math.sqrt(2)
    side = np.array((-out[1], out[0]))
    ax = (v3(side), (0, 1, 0), v3(out))
    ellipsoid('eagle body', (c[0] + out[0] * .12, Y_CORNICE + .45, c[1] + out[1] * .12), (.24, .40, .22), ax,
              'carved', 10, 7)
    ellipsoid('eagle head', (c[0] + out[0] * .26, Y_CORNICE + .88, c[1] + out[1] * .26), (.10, .12, .15), ax,
              'carved', 8, 5)
    for along, normal in ((np.array((0., -cv)), np.array((cu, 0.))), (np.array((-cu, 0.)), np.array((0., cv)))):
        w = c + along * .55 + normal * .06
        ellipsoid('eagle wing', (w[0], Y_CORNICE + .55, w[1]), (.55, .30, .06), (v3(along), (0, 1, 0), v3(normal)),
                  'carved', 10, 6)

# ================================================================ column
# laurel torus: the leaves read as crossing ridges round the ring
TR, TT = 2.03, (Y_TORUS - Y_PED) / 2
st = []
NT, NA = 96, 14
for j in range(NA):
    ph = j * math.tau / NA
    ring = []
    for i in range(NT):
        t = i * math.tau / NT
        r = TT + .035 * abs(math.sin(16 * t + 2 * ph)) + .035 * abs(math.sin(16 * t - 2 * ph))
        rr = TR + r * math.cos(ph) * 1.05
        ring.append((rr * math.cos(t), Y_PED + TT + r * math.sin(ph), rr * math.sin(t)))
    st.append(ring)
stack('laurel torus', st, 'carved', closed=True, smooth=True)
lathe('apophyge', [(Y_TORUS - .10, 2.08), (Y_TORUS + .02, 2.08), (Y_TORUS + .08, 2.00), (Y_TORUS + .16, 1.93),
                   (Y_TORUS + .28, R_FOOT + .02), (Y_FRIEZE0 + .25, R_FOOT - .01)], 'marble', sides=80)


def shaft_r(y):
    t = min(max((y - Y_TORUS) / (Y_SHAFT - Y_TORUS), 0), 1)
    return R_FOOT - (R_FOOT - R_TOP) * t ** 1.3        # slight entasis: nearly straight at the foot


# Spiral frieze. Vertex rows follow the helix: each band is a groove then a carved face, band height growing
# 0.89 -> 1.25 in proportion. The first and last turn fan out from flat rings so the body closes with plain caps.
PA = (Y_FRIEZE1 - Y_FRIEZE0) / (TURNS * (1 + (BAND_RATIO - 1) / 2))
PB = PA * (BAND_RATIO - 1) / TURNS


def band_y(q):
    return Y_FRIEZE0 + PA * q + PB * q * q / 2


# Band profile, bottom to top (fractions of a band, radial offsets): the underside of the ground line the
# figures stand on (in shadow from above: this is the line that reads as the spiral from the street), the
# ground line's face, then the carved field, recessed slightly towards its top edge.
NS, K = 80, 7
FRAC = [0.0, .025, .07, .30, .52, .74, .96]
DR = [-.065, .025, .0, .012, .014, .012, -.03]
M = TURNS * K
noise = np.random.default_rng(113).uniform(-.04, .04, size=(M + 1, NS))
verts = []
for row in range(M + 1):
    i, k = divmod(row, K)
    r_ = i + FRAC[k] if row < M else TURNS
    w = min(r_, 1.0, TURNS - r_)
    for j in range(NS):
        y = band_y(r_ + w * j / NS)
        th = j * math.tau / NS
        rr = shaft_r(y) + w * (DR[k] + (noise[row, j] if 3 <= k <= 5 else 0.0))
        verts.append((rr * math.cos(th), y, -rr * math.sin(th)))


def vid(row, j):
    return row * NS + j


faces = []
for row in range(M):
    for j in range(NS - 1):
        faces.append((vid(row, j), vid(row, j + 1), vid(row + 1, j + 1), vid(row + 1, j)))
    if row + K + 1 <= M:
        faces.append((vid(row, NS - 1), vid(row + K, 0), vid(row + K + 1, 0), vid(row + 1, NS - 1)))
faces.append(tuple(vid(0, j) for j in range(NS)))                                   # bottom cap
faces.append(tuple(vid(M, j) for j in range(NS)))                                   # top cap
faces.append((vid(0, NS - 1),) + tuple(vid(r, 0) for r in range(0, K + 1)))         # bottom seam sliver
faces.append(tuple(vid(r, NS - 1) for r in range(M - K, M + 1)) + (vid(M, 0),))     # top seam sliver
emit('spiral frieze shaft', verts, faces, 'carved', smooth=True)
lathe('shaft neck', [(Y_FRIEZE1 - .25, shaft_r(Y_FRIEZE1) - .01), (Y_SHAFT, R_TOP)], 'marble', sides=80)

# Doric capital: astragal, egg-and-dart echinus, abacus (ref29, ref15)
lathe('astragal', [(Y_SHAFT - .02, R_TOP), (Y_SHAFT + .02, R_TOP + .07), (Y_SHAFT + .09, R_TOP + .10),
                   (Y_SHAFT + .16, R_TOP + .07), (Y_SHAFT + .19, R_TOP + .02)], 'marble', sides=64)
lathe('echinus', [(Y_SHAFT + .18, R_TOP + .02), (Y_SHAFT + .24, R_TOP + .10), (Y_SHAFT + .31, R_TOP + .22),
                  (Y_SHAFT + .38, R_TOP + .34), (Y_SHAFT + .44, R_TOP + .44), (Y_SHAFT + .49, R_TOP + .50),
                  (Y_ABACUS0 + .01, R_TOP + .52)], 'marble', sides=64)
for e in range(24):
    t = e * math.tau / 24
    out = (math.cos(t), -.35, math.sin(t))                  # eggs lean out with the ovolo
    ellipsoid('echinus egg', ((R_TOP + .35) * math.cos(t), Y_SHAFT + .37, (R_TOP + .35) * math.sin(t)),
              (.20, .21, .12), ((-math.sin(t), 0, math.cos(t)), (.35 * math.cos(t), 1, .35 * math.sin(t)), out),
              'carved', 8, 5)
square('abacus', [(Y_ABACUS0, HW_ABACUS), (Y_TOP - .04, HW_ABACUS), (Y_TOP, HW_ABACUS - .03)], 'marble')

# iron railing round the viewing platform (ref29, ref27)
HR = HW_ABACUS - .07
for k in range(4):
    for i in range(13):
        s = -HR + 2 * HR * i / 12
        fbox('railing post', k, s - .02, s + .02, HR - .02, HR + .02, Y_TOP, Y_TOP + 1.05, 'iron')
    for y0 in (Y_TOP + .06, Y_TOP + 1.0):
        fbox('railing rail', k, -HR - .03, HR + .03, HR - .03, HR + .03, y0, y0 + .05, 'iron')

# statue base: drum with a cornice, low dome, bronze moulded plinth (ref29 proportions; 3.33 m published)
Y0 = Y_TOP
lathe('statue base drum', [(Y0 - .02, 1.62), (Y0 + .12, 1.62), (Y0 + .20, 1.54), (Y0 + .26, 1.50), (Y0 + 1.36, 1.50),
                           (Y0 + 1.42, 1.56), (Y0 + 1.50, 1.62), (Y0 + 1.58, 1.62)], 'marble')
dome = [(Y0 + 1.57, 1.47)] + [(Y0 + 1.58 + .92 * math.sin(a), .40 + 1.07 * math.cos(a))
                              for a in (i / 8 * math.pi / 2 * .86 for i in range(1, 9))]
lathe('statue base dome', dome, 'marble')
lathe('bronze statue plinth', [(Y0 + 2.40, .64), (Y0 + 2.52, .72), (Y0 + 2.64, .72), (Y0 + 2.74, .60),
                               (Y0 + 2.98, .52), (Y0 + 3.12, .60), (Y0 + 3.24, .68), (Y_STATUE, .68)],
      'bronze', sides=32)

# ================================================================ St Peter (bronze, simplified; facing SE unverified)
F = np.array(v3(N[SE]), float)      # front
Sd = np.array(v3(T[SE]), float)     # = F x up: his right
B = np.array((0, Y_STATUE, 0), float)


def P(side, up, front):
    return tuple(B + side * Sd + np.array((0, up, 0)) + front * F)


robe = [(0.00, .60, .48), (.10, .62, .50), (.35, .58, .45), (1.10, .52, .38), (1.90, .50, .36),
        (2.45, .54, .36), (2.90, .60, .36), (3.15, .62, .32), (3.30, .42, .24), (3.36, .15, .14)]   # robe and mantle
st = []
for dy, rs, rf in robe:
    ring = []
    for j in range(20):
        t = j * math.tau / 20
        drape = .03 * math.sin(7 * t + dy * 3) if dy < 2.4 else 0      # vertical folds of the robe
        ring.append(P((rs + drape) * math.cos(t), dy, (rf + drape) * math.sin(t) + (.05 if dy < .4 else 0)))
    st.append(ring)
stack('St Peter robe', st, 'bronze', smooth=True)
FA = (tuple(Sd), (0, 1, 0), tuple(F))
ellipsoid('St Peter head', P(0, 3.58, .03), (.19, .26, .21), FA, 'bronze', 12, 8)
ellipsoid('St Peter beard', P(0, 3.40, .15), (.13, .14, .08), FA, 'bronze', 8, 5)
halo = [P(.36 * math.cos(t), 3.70 + .36 * math.sin(t), -.18) for t in np.linspace(0, math.tau, 25)]
tube('St Peter halo', halo, .03, 'bronze', sides=5)
# right hand held out with the keys (ref29), left arm across the chest with the book
tube('St Peter right arm', [P(.55, 3.12, 0), P(.82, 2.78, .12), P(1.10, 2.80, .30)], [.15, .13, .10], 'bronze')
tube('St Peter keys', [P(1.12, 2.80, .32), P(1.70, 2.86, .42)], .04, 'bronze', sides=5)
tube('St Peter key bits', [P(1.62, 2.70, .40), P(1.70, 3.02, .44)], .045, 'bronze', sides=5)
tube('St Peter left arm', [P(-.55, 3.12, 0), P(-.66, 2.62, .12), P(-.26, 2.74, .44)], [.14, .12, .10], 'bronze')
ellipsoid('St Peter book', P(-.22, 2.80, .44), (.20, .26, .06), FA, 'bronze', 6, 4)

info = m.finish(directory=SCRATCH)

# ================================================================ street-level check renders (perspective)
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
from build_moffett_aircraft import xyz  # noqa: E402

scene = bpy.context.scene
for label, (x, z), eye, ty, lens in [
        ('road-closest-72m', (-51.8, 49.5), 3.0, 20.0, 24),      # closest route point: 51.8 m W, 49.5 m S
        ('road-approach-120m', (18.7, 118.8), 3.0, 20.0, 24),    # on the approach from the SE, column ahead
        ('road-closest-72m-pit', (-51.8, 49.5), 8.2, 20.0, 24),  # same point were the court sunk 5.2 m, as it is
        ('like-ref27', (14.0, 38.0), 8.0, 18.0, 20),             # from the Basilica Ulpia side, as photo ref27
        ('capital-closeup', (-6.0, 14.0), 36.0, 37.5, 35),
        ('statue-closeup', (2.0, 12.0), 41.0, 41.3, 50),
        ('pedestal-se', (4.0, 14.0), 3.0, 3.2, 24)]:      # capital and statue, compare ref29 / ref15
    bpy.ops.object.camera_add(location=Vector(xyz((x, eye, z))))
    cam = bpy.context.object
    cam.rotation_euler = (Vector(xyz((0, ty, 0))) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    scene.camera = cam
    scene.render.filepath = str(SCRATCH / f'{ID}-{label}.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
