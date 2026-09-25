"""Arc de Triomphe de l'Etoile, Paris (Chalgrin, 1806-1836), on its paved island in Place Charles de Gaulle.

Sources of the numbers (every figure below is tagged with one of these):
  [W]   Wikipedia infobox / card: 49.54 m high, 44.82 m wide, 22.21 m deep; main vault 29.19 m high x 14.62 m
        wide; transverse vaults 18.68 m high x 8.44 m wide; the great frieze is 2.10 m high.
  [ABZ] Allgemeine Bauzeitung 1838, plate CLXXXII, measured cross-section with a metre scale (Wikimedia
        Commons "Arc de Triomphe Querschnitt ABZ Wien 1838 Plan 182.jpg"): steps, socle, group pedestals,
        impost entablature with the Greek key, cornice, attic, attic window, roof over the vault, coffers.
  [PH]  photo estimate from frontal Commons photographs (layout along the faces: pier widths, group and
        panel positions, 11 + 4 attic shields, palm pilasters, lion-head sima, crest).
  [OSM] way 226413508: outline 50.3 x 27.9 m = the stepped platform round the body (groups included).
  [GAME] the finished ground of the built paris route (sampled read-only with the pipeline's own
        ground_height, relative to the model datum = the lowest ground under the OSM outline).

Author frame: s along the long 44.82 m axis (model v; +s = SSW end, the Austerlitz face towards Avenue
Kleber), d across the 22.21 m depth (model u; +d = the Champs-Elysees face with Rude and Cortot), y up.
Symmetric parts are authored once and mirrored with XF.
No text anywhere: shields are plain, the Tomb of the Unknown Soldier is a plain slab.
Run: Blender --background --python assets-src/landmarks/build_arc-de-triomphe.py
"""
import math
import tempfile
import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'arc-de-triomphe'
SCRATCH = (Path(tempfile.gettempdir()) / 'sr-landmarks' / 'arc-de-triomphe')

# ---------------------------------------------------------------- dimensions (m)
Y0 = 0.30                      # drawing ground line; one extra 0.3 m of step so the platform clears the slope [GAME]
HS, HD = 22.41, 11.105         # half width / half depth of the body at the pier faces [W]
REC = 0.85                     # the arch bay is set back from the pier faces [ABZ]
HDR = HD - REC
SJ = 8.80                      # half width of the set-back arch bay [PH]
MR, MSPR = 7.31, Y0 + 21.88    # main vault half span, springing (crown 29.19) [W]
TR, TSPR = 4.22, Y0 + 14.46    # transverse vault half span, springing (crown 18.68) [W]
PLAT = Y0 + 1.00               # top of the two steps = passage floor [ABZ]
ENT0, ENT1 = Y0 + 19.50, MSPR  # impost entablature with the Greek key [ABZ]
BODY_TOP = Y0 + 30.40          # top of the set-back arch bay, just over the keystone [ABZ]
FR0, FR1 = Y0 + 32.60, Y0 + 34.70   # the great frieze, 2.1 m of figures [W], its level from the section [ABZ]
CORN1 = Y0 + 38.20             # top of the main cornice [ABZ]
AT_IN = 0.40                   # attic face set back from the pier faces [ABZ]
AT0, AT1 = CORN1, Y0 + 43.40   # attic die [ABZ]
ATC1 = Y0 + 44.70              # top of the attic cornice = roof terrace [ABZ]
PAR1 = Y0 + 45.30              # top of the terrace parapet with its palmette crest [ABZ/PH]
TOP = Y0 + 49.54               # crown of the roof over the vault = the published height [W]
GROUP_C = (SJ + HS) / 2        # centre of each pier face (groups, panels) [PH]
R_ISL = 50.5                   # island radius: to the built ring road's inner edge (54 m) less a kerb margin [GAME]

m = Model(ID)
m.material('stone', (0.80, 0.76, 0.67), 0.0, 0.80, ID + '_stone')
m.material('carved', (0.77, 0.73, 0.64), 0.0, 0.85, ID + '_carved')
m.material('granite', (0.55, 0.54, 0.52), 0.0, 0.70, ID + '_granite')
m.material('setts', (0.47, 0.46, 0.44), 0.0, 0.90, ID + '_granite_setts')
m.material('steel', (0.10, 0.10, 0.11), 0.6, 0.45, ID + '_steel')
m.material('bronze', (0.36, 0.25, 0.13), 0.8, 0.40, ID + '_bronze')
m.material('glass', (0.07, 0.08, 0.10), 0.1, 0.15, ID + '_glass')

XF = [1, 1]


def emit(label, verts, faces, mat, smooth=False):
    sx, sd = XF
    m.mesh(label, [(sd * p[2], p[1], sx * p[0]) for p in verts], faces, mat, smooth)


def stack(label, stations, mat, closed=False, smooth=False):
    """Loft equal-length section loops (s, y, d); open lofts are capped at both ends."""
    K, M = len(stations), len(stations[0])
    verts = [tuple(p) for st in stations for p in st]
    faces = []
    for k in range(K if closed else K - 1):
        a, b = k * M, ((k + 1) % K) * M
        faces += [(a + j, a + (j + 1) % M, b + (j + 1) % M, b + j) for j in range(M)]
    if not closed:
        faces += [tuple(reversed(range(M))), tuple((K - 1) * M + j for j in range(M))]
    emit(label, verts, faces, mat, smooth)


def mblock(label, sc, dc, hs, hd, prof, mat):
    """Moulded rectangular block round (sc, dc): prof = [(y, offset)] or [(y, off_s, off_d)], bottom to top."""
    st = []
    for p in prof:
        y, os_, od = (p[0], p[1], p[1]) if len(p) == 2 else p
        a, b = hs + os_, hd + od
        st.append([(sc - a, y, dc - b), (sc + a, y, dc - b), (sc + a, y, dc + b), (sc - a, y, dc + b)])
    stack(label, st, mat)


def box(label, s0, s1, y0, y1, d0, d1, mat):
    mblock(label, (s0 + s1) / 2, (d0 + d1) / 2, abs(s1 - s0) / 2, abs(d1 - d0) / 2, [(y0, 0), (y1, 0)], mat)


def olathe(label, c, nrm, prof, mat, sides=16, petals=0, amp=0.0, smooth=True, stretch=1.0):
    """Surface of revolution about the axis through c along nrm; prof = [(h along axis, radius)]."""
    c = np.array(c, float)
    n = np.array(nrm, float)
    n /= np.linalg.norm(n)
    o = np.array((0.0, 1.0, 0.0)) if abs(n[1]) < .9 else np.array((1.0, 0.0, 0.0))
    u = np.cross(n, o)
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    st = []
    for h, r in prof:
        ring = []
        for k in range(sides):
            a = k * math.tau / sides
            rr = max(r, .008) * (1 + amp * math.cos(petals * a)) if petals else max(r, .008)
            ring.append(tuple(c + n * h + rr * (u * math.cos(a) * stretch + v * math.sin(a))))
        st.append(ring)
    stack(label, st, mat, smooth=smooth)


def tube(label, pts, r, mat, sides=6):
    st = []
    for i, p in enumerate(pts):
        a, b = np.array(pts[max(0, i - 1)], float), np.array(pts[min(len(pts) - 1, i + 1)], float)
        t = b - a
        t /= np.linalg.norm(t)
        o = np.array((0, 1, 0)) if abs(t[1]) < .9 else np.array((1, 0, 0))
        u = np.cross(t, o)
        u /= np.linalg.norm(u)
        v = np.cross(t, u)
        rr = r[i] if isinstance(r, (list, tuple)) else r
        st.append([tuple(np.array(p) + rr * (u * math.cos(j * math.tau / sides) + v * math.sin(j * math.tau / sides)))
                   for j in range(sides)])
    stack(label, st, mat, smooth=True)


class Face:
    """A vertical wall plane: x along the wall, y up, e outward. o, t, n are (s, d) pairs."""

    def __init__(self, o, t, n):
        self.o, self.t, self.n = np.array(o, float), np.array(t, float), np.array(n, float)

    def __call__(self, x, y, e):
        p = self.o + self.t * x + self.n * e
        return (float(p[0]), float(y), float(p[1]))


def fbox(label, F, x0, x1, y0, y1, e0, e1, mat):
    lo = [F(x0, y0, e0), F(x1, y0, e0), F(x1, y0, e1), F(x0, y0, e1)]
    hi = [F(x0, y1, e0), F(x1, y1, e0), F(x1, y1, e1), F(x0, y1, e1)]
    stack(label, [lo, hi], mat)


def fbar(label, F, x0, y0, x1, y1, w, e0, e1, mat):
    """Straight raised strip in a wall plane from (x0, y0) to (x1, y1), width w."""
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * w / 2, dx / L * w / 2
    q = [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)]
    stack(label, [[F(x, y, e0) for x, y in q], [F(x, y, e1) for x, y in q]], mat)


def fprofile(label, F, x0, x1, prof, mat):
    """A section [(e, y)] (closed outline) extruded along the wall from x0 to x1."""
    stack(label, [[F(x0, y, e) for e, y in prof], [F(x1, y, e) for e, y in prof]], mat)


def arc_face(label, F, xc, yc, section, n, mat, th0=0.0, th1=math.pi):
    """Section [(r, e)] swept round a horizontal-axis arc lying in wall plane F."""
    st = []
    for k in range(n + 1):
        th = th0 + (th1 - th0) * k / n
        st.append([F(xc + r * math.cos(th), yc + r * math.sin(th), e) for r, e in section])
    stack(label, st, mat)


def outward_edges(poly):
    """(a, t, n, L) for every edge of a closed plan polygon [(s, d)], n pointing out of it."""
    P = [np.array(p, float) for p in poly]
    k = len(P)
    area = sum(P[i][0] * P[(i + 1) % k][1] - P[(i + 1) % k][0] * P[i][1] for i in range(k))
    sg = 1 if area > 0 else -1
    out = []
    for i in range(k):
        a, b = P[i], P[(i + 1) % k]
        L = float(np.linalg.norm(b - a))
        t = (b - a) / L
        out.append((a, t, sg * np.array((t[1], -t[0])), L))
    return out


def ring_sweep(label, poly, section, mat):
    """Closed moulding round a plan polygon; section [(e outward, y)] is a closed outline; mitred corners."""
    E = outward_edges(poly)
    k = len(E)
    st = []
    for i in range(k):
        na, nb = E[i - 1][2], E[i][2]
        mv = (na + nb) / (1 + float(np.dot(na, nb)))
        p = E[i][0]
        st.append([(p[0] + e * mv[0], y, p[1] + e * mv[1]) for e, y in section])
    stack(label, st, mat, closed=True)


def path_sweep(label, path, inside, section, mat):
    """Open moulding along a plan polyline [(s, d)], pushed away from `inside`; capped ends."""
    P = [np.array(p, float) for p in path]
    ns = []
    for a, b in zip(P, P[1:]):
        t = (b - a) / np.linalg.norm(b - a)
        n = np.array((t[1], -t[0]))
        if np.dot(n, (a + b) / 2 - np.array(inside)) < 0:
            n = -n
        ns.append(n)
    st = []
    for i, p in enumerate(P):
        if i == 0:
            mv = ns[0]
        elif i == len(P) - 1:
            mv = ns[-1]
        else:
            mv = (ns[i - 1] + ns[i]) / (1 + float(np.dot(ns[i - 1], ns[i])))
        st.append([(p[0] + e * mv[0], y, p[1] + e * mv[1]) for e, y in section])
    stack(label, st, mat)


# ---------------------------------------------------------------- sculpture: relief height fields
class Relief:
    """Union (max) of ellipsoidal bumps: the carved figures of a relief, heights in metres off the wall."""

    def __init__(self):
        self.blobs = []

    def add(self, cx, cy, rx, ry, ang, d):
        self.blobs.append((cx, cy, max(rx, .02), max(ry, .02), ang, d))

    def h(self, X, Y, k=.07):
        """Smooth union of the bumps, so overlapping bodies melt into one carved mass instead of creasing."""
        acc = np.zeros_like(X)
        for cx, cy, rx, ry, a, d in self.blobs:
            c, s = math.cos(a), math.sin(a)
            dx, dy = X - cx, Y - cy
            u = (dx * c + dy * s) / rx
            v = (-dx * s + dy * c) / ry
            q = np.clip(1 - u * u - v * v, 0, None)
            hb = d * q ** .75
            acc += np.where(q > 0, np.expm1(np.minimum(hb / k, 60.0)), 0.0)
        return k * np.log1p(acc)


def limb(R, x0, y0, x1, y1, r, d):
    """An arm, leg, sword or trumpet as one elongated bump from (x0, y0) to (x1, y1)."""
    R.add((x0 + x1) / 2, (y0 + y1) / 2, math.hypot(x1 - x0, y1 - y0) / 2 + r, r, math.atan2(y1 - y0, x1 - x0), d)


def figure(R, x, y0, fh, d, rng, lean=0.0, arm=None, cloak=False):
    """Standing heroic figure, feet at y0, height fh; arm = (dx, dy) of the raised hand relative to the shoulder."""
    hx = x + lean * fh
    R.add(hx, y0 + .91 * fh, .065 * fh, .075 * fh, 0, d * 1.05)                    # head
    R.add(x + lean * .66 * fh, y0 + .68 * fh, .12 * fh, .17 * fh, -lean, d)          # chest
    R.add(x + lean * .40 * fh, y0 + .46 * fh, .125 * fh, .11 * fh, 0, d * .9)        # hips
    for sd in (-1, 1):
        limb(R, x + sd * .05 * fh + lean * .3 * fh, y0 + .44 * fh, x + sd * (.07 + rng.uniform(0, .05)) * fh,
             y0 + .03 * fh, .045 * fh, d * .75)                                        # legs
    sx0, sy0 = x + .13 * fh + lean * .72 * fh, y0 + .80 * fh
    if arm:
        limb(R, sx0, sy0, sx0 + arm[0] * fh, sy0 + arm[1] * fh, .035 * fh, d * .85)
    else:
        limb(R, sx0, sy0, sx0 + .05 * fh, sy0 - .36 * fh, .035 * fh, d * .8)
    limb(R, x - .13 * fh + lean * .72 * fh, sy0, x - .17 * fh, sy0 - .34 * fh, .035 * fh, d * .8)
    if cloak:
        R.add(x - .1 * fh, y0 + .5 * fh, .16 * fh, .36 * fh, .1, d * .55)


def wing(R, x, y, L, ang, d):
    """A spread wing: three overlapping feather masses fanning out from the shoulder at (x, y)."""
    for k, (f, w) in enumerate(((1.0, .20), (.82, .16), (.62, .13))):
        a = ang + (k - 1) * .22
        R.add(x + math.cos(a) * L * f * .5, y + math.sin(a) * L * f * .5, L * f * .5, L * w, a, d * (1 - .15 * k))


def flyer(R, hx, hy, fx, fy, d, wing_ang, wing_len, arm_to=None):
    """Flying winged figure: head at (hx, hy), feet at (fx, fy); wings from the shoulders."""
    L = math.hypot(fx - hx, fy - hy)
    a = math.atan2(fy - hy, fx - hx)
    R.add(hx, hy, .075 * L * 1.2, .085 * L * 1.2, 0, d)                               # head
    R.add(hx + math.cos(a) * .33 * L, hy + math.sin(a) * .33 * L, .20 * L, .11 * L, a, d * .95)   # torso
    R.add(hx + math.cos(a) * .66 * L, hy + math.sin(a) * .66 * L, .22 * L, .09 * L, a, d * .8)    # legs, drapery
    R.add(hx + math.cos(a) * .9 * L, hy + math.sin(a) * .9 * L, .12 * L, .05 * L, a + .3, d * .6)
    sx, sy = hx + math.cos(a) * .16 * L, hy + math.sin(a) * .16 * L
    wing(R, sx, sy, wing_len, wing_ang, d * .55)
    if arm_to:
        limb(R, sx, sy, arm_to[0], arm_to[1], .03 * L, d * .8)


def horse(R, x, y0, fh, d, f):
    R.add(x, y0 + .55 * fh, .30 * fh, .14 * fh, 0, d)
    R.add(x + f * .30 * fh, y0 + .72 * fh, .07 * fh, .16 * fh, -f * .6, d * .9)
    R.add(x + f * .41 * fh, y0 + .84 * fh, .10 * fh, .05 * fh, -f * .3, d * .85)
    for lx in (-.22, -.13, .15, .24):
        R.add(x + f * lx * fh, y0 + .22 * fh, .032 * fh, .22 * fh, 0, d * .7)
    R.add(x - f * .33 * fh, y0 + .45 * fh, .03 * fh, .14 * fh, f * .4, d * .6)


def crowd(R, x0, x1, y0, fh, d, rng, horses=0.0, raised=.3):
    """Two ranks of marching figures (the back rank lower relief) with occasional riders."""
    x = x0 + .3 * fh
    while x < x1 - .3 * fh:
        figure(R, x, y0 + .04 * fh, fh * .94, d * .5, rng, lean=rng.uniform(-.05, .05))
        x += rng.uniform(.3, .42) * fh
    x = x0 + .2 * fh
    while x < x1 - .2 * fh:
        if rng.random() < horses and x + .8 * fh < x1:
            f = rng.choice((-1, 1))
            horse(R, x + .4 * fh, y0, fh * .9, d, f)
            figure(R, x + .4 * fh, y0 + .42 * fh, fh * .58, d * 1.05, rng)
            x += .85 * fh
        else:
            arm = (rng.uniform(-.2, .25), rng.uniform(.15, .35)) if rng.random() < raised else None
            figure(R, x, y0, fh, d, rng, lean=rng.uniform(-.08, .08), arm=arm)
            x += rng.uniform(.26, .38) * fh


def relief_slab(label, face, mapping, nu, nv, R, base, back, mat):
    """Closed carved slab: the relief surface over a mapped (x, y) grid, pushed `back` into the wall."""
    A, B = np.linspace(0, 1, nu), np.linspace(0, 1, nv)
    X = np.zeros((nv, nu))
    Y = np.zeros((nv, nu))
    for j, b in enumerate(B):
        for i, a in enumerate(A):
            X[j, i], Y[j, i] = mapping(a, b)
    H = R.h(X, Y) + base
    front = [face(X[j, i], Y[j, i], H[j, i]) for j in range(nv) for i in range(nu)]
    bd = list(range(nu)) + [j * nu + nu - 1 for j in range(1, nv)] + \
        [(nv - 1) * nu + i for i in range(nu - 2, -1, -1)] + [j * nu for j in range(nv - 2, 0, -1)]
    n, L = len(front), len(bd)
    back_pts = [face(X.flat[k], Y.flat[k], -back) for k in bd]
    faces = [(j * nu + i, j * nu + i + 1, (j + 1) * nu + i + 1, (j + 1) * nu + i)
             for j in range(nv - 1) for i in range(nu - 1)]
    faces += [(bd[k], bd[(k + 1) % L], n + (k + 1) % L, n + k) for k in range(L)]
    faces.append(tuple(n + k for k in range(L)))
    emit(label, front + back_pts, faces, mat, True)


def rect_map(x0, x1, y0, y1):
    return lambda a, b: (x0 + a * (x1 - x0), y0 + b * (y1 - y0))


def panel(label, F, x0, x1, y0, y1, dens, R, base=0.03, back=0.15, mat='carved'):
    nu = max(4, int((x1 - x0) * dens) + 1)
    nv = max(4, int((y1 - y0) * dens) + 1)
    relief_slab(label, F, rect_map(x0, x1, y0, y1), nu, nv, R, base, back, mat)


def frame(label, F, x0, x1, y0, y1, w, e):
    """Raised moulded frame round a panel: an outer band and a lower inner lip."""
    for xa, xb, ya, yb, ww, ee in ((x0 - w, x1 + w, y0 - w, y1 + w, w, e), (x0, x1, y0, y1, w * .4, e * .55)):
        for p0, p1, q0, q1 in ((xa, xb, ya, ya + ww), (xa, xb, yb - ww, yb), (xa, xa + ww, ya + ww, yb - ww),
                               (xb - ww, xb, ya + ww, yb - ww)):
            fbox(label, F, p0, p1, q0, q1, -.05, ee, 'stone')


# ---------------------------------------------------------------- the four groups on the pier pedestals
def group_marseillaise(R, rng):
    """Rude, Le Depart des Volontaires de 1792: volunteers below, the winged Genius of Liberty above,
    shouting, sword thrust forward, wings spread up and back. x across the pier, y from the plinth top."""
    R.add(0, 2.6, 3.4, 2.8, 0, .95)                                                  # the carved mass of bodies
    R.add(.2, 5.3, 2.7, 1.2, 0, .8)
    R.add(.5, 9.0, 2.9, 1.7, .45, .75)                                               # the Genius and her wings
    figure(R, -.4, .0, 5.6, 1.7, rng, lean=-.06, arm=(-.25, .35), cloak=True)        # old warrior, arm raised
    figure(R, .5, .0, 4.2, 1.5, rng, lean=.03)                                       # nude youth at his side
    figure(R, -2.3, .0, 5.2, 1.35, rng, lean=.05, arm=(.1, .3))                      # archer
    figure(R, 1.9, .0, 5.4, 1.45, rng, lean=-.04, arm=(.2, .25), cloak=True)         # helmeted soldier
    figure(R, 2.9, .3, 4.6, 1.0, rng, lean=-.08)                                     # figure behind
    R.add(-2.9, 1.2, .6, 1.1, .2, .9)                                                # shields, trophy heap
    R.add(0.1, 5.8, 1.9, .7, 0, 1.0)                                                 # shoulders and heads mass
    flyer(R, -1.5, 9.9, 1.8, 6.4, 1.8, 1.0, 4.8, arm_to=(-3.4, 9.3))                 # Genius of Liberty
    limb(R, -3.4, 9.2, -3.55, 10.4, .14, .7)                                        # the sword
    wing(R, .4, 9.3, 3.4, .45, 1.0)                                                  # second wing
    R.add(2.8, 8.4, .5, 1.6, -.2, .7)                                                # banner and spears


def group_triumph(R, rng):
    """Cortot, Le Triomphe de 1810: the emperor in a toga crowned by Victory, Fame flying above with her
    trumpet, History writing at left, a kneeling captive and the kneeling City below."""
    R.add(0, 2.8, 3.3, 3.0, 0, .9)                                                   # the carved mass of bodies
    R.add(.3, 7.2, 2.2, 1.6, .3, .7)
    R.add(-.6, 9.7, 3.0, 1.3, .25, .6)                                               # Fame's wings and drapery
    figure(R, .0, .0, 6.2, 1.75, rng, arm=(.05, -.1), cloak=True)                     # the emperor
    R.add(0, 2.2, .75, 2.2, 0, 1.45)                                                 # the toga fall
    flyer(R, 1.0, 7.4, 2.4, 2.6, 1.5, .9, 2.8, arm_to=(.15, 6.4))                    # Victory crowning
    R.add(.1, 6.55, .45, .18, 0, 1.6)                                                # the wreath
    flyer(R, -1.2, 10.4, 2.8, 8.9, 1.2, 2.3, 3.2, arm_to=(-2.8, 10.9))                # Fame with trumpet
    limb(R, -2.8, 10.9, -3.4, 11.2, .12, 1.0)
    figure(R, -2.3, 1.4, 4.9, 1.2, rng, lean=.04, arm=(.15, .05), cloak=True)        # History writing
    R.add(-2.5, .9, .7, .9, 0, 1.1)                                                  # kneeling captive
    R.add(-2.6, 2.0, .35, .4, 0, 1.2)
    R.add(2.4, 1.1, .8, 1.1, .1, 1.2)                                                # kneeling City
    R.add(2.5, 2.4, .32, .38, 0, 1.3)


def group_resistance(R, rng):
    """Etex, La Resistance de 1814: a young warrior defending his family, his father clinging to him,
    a woman with a dead child, a fallen rider, and the Genius of the Future flying above."""
    R.add(0, 2.6, 3.4, 2.8, 0, .9)                                                   # the carved mass of bodies
    R.add(.3, 5.8, 2.0, 1.6, 0, .75)
    R.add(.2, 9.3, 2.8, 1.5, .3, .65)                                                # the Genius and her wings
    figure(R, .4, .3, 6.0, 1.7, rng, lean=-.05, arm=(-.25, .3))                      # warrior, sword raised
    R.add(-1.1, 1.8, .7, 1.7, .2, 1.3)                                               # father at his legs
    R.add(-1.2, 3.6, .35, .4, 0, 1.4)
    figure(R, -2.3, .2, 4.8, 1.2, rng, lean=.05, cloak=True)                         # the woman
    R.add(-2.0, 2.4, .8, .35, .5, 1.25)                                              # the dead child
    horse(R, 1.9, .0, 2.6, 1.3, -1)                                                  # fallen horse and rider
    R.add(2.5, .7, 1.0, .4, -.2, 1.2)
    flyer(R, .6, 10.6, -1.8, 7.0, 1.4, 2.0, 3.6, arm_to=(1.9, 11.0))                 # Genius of the Future
    wing(R, 1.2, 9.8, 2.8, .7, .9)


def group_peace(R, rng):
    """Etex, La Paix de 1815: a warrior sheathing his sword, a mother with her children, a farmer taming
    a bull, and Minerva crowned with laurel standing above them."""
    R.add(0, 2.6, 3.4, 2.8, 0, .9)                                                   # the carved mass of bodies
    R.add(0, 8.4, 1.9, 2.6, 0, .7)                                                   # Minerva's drapery
    figure(R, .1, .2, 6.0, 1.7, rng, lean=.03, cloak=True)                           # warrior sheathing
    limb(R, .6, 2.2, .9, 4.4, .15, 1.1)                                               # the sword
    R.add(-2.2, 1.5, 1.0, 1.4, .1, 1.3)                                              # seated mother
    R.add(-2.0, 3.3, .35, .42, 0, 1.4)
    R.add(-1.4, 1.0, .35, .6, 0, 1.4)                                                # children
    R.add(-2.9, .8, .3, .55, 0, 1.2)
    R.add(2.0, 1.3, 1.1, .6, 0, 1.3)                                                 # the bull
    R.add(2.8, 1.8, .35, .3, 0, 1.35)
    figure(R, 2.4, .5, 4.6, 1.2, rng, lean=-.06, arm=(-.2, .1))                      # the farmer
    figure(R, .0, 6.7, 4.4, 1.35, rng, arm=(.1, .35), cloak=True)                    # Minerva / Peace
    R.add(.45, 11.0, .5, .25, 0, 1.1)                                                # laurel crown held up
    R.add(-1.2, 8.4, .45, 1.7, .15, .9)                                              # shield and spear


GROUPS = {(+1, -1): group_marseillaise, (+1, +1): group_triumph,     # Champs-Elysees face: Rude at NNE,
          (-1, -1): group_resistance, (-1, +1): group_peace}           # Cortot at SSW; Grande Armee face: Etex


# ---------------------------------------------------------------- body: piers, vaults, platform
def arc_pts(xc, yc, r, n, th0=math.pi, th1=0.0):
    return [(xc + r * math.cos(th0 + (th1 - th0) * k / n), yc + r * math.sin(th0 + (th1 - th0) * k / n))
            for k in range(n + 1)]


def platform():
    # two steps round the whole body; together they are the OSM outline (50.3 x 27.9 m) [ABZ/OSM]
    box('lower step', -25.0, 25.0, 0.0, Y0 + 0.40, -13.9, 13.9, 'stone')
    box('upper step', -24.4, 24.4, Y0 + 0.40, PLAT, -13.3, 13.3, 'stone')


def pier_prism(label, s0, s1, W):
    """Pier mass between s0 and s1, half depth W, pierced by the transverse vault."""
    outline = [(-W, PLAT), (-TR, PLAT)] + arc_pts(0, TSPR, TR, 28) + [(TR, PLAT), (W, PLAT), (W, BODY_TOP),
                                                                        (-W, BODY_TOP)]
    stack(label, [[(s, y, d) for d, y in outline] for s in (s0, s1)], 'stone')


def body():
    for sx in (-1, 1):
        XF[:] = [sx, 1]
        pier_prism('arch jamb', MR, SJ, HDR)
        pier_prism('pier', SJ, HS, HD)
    XF[:] = [1, 1]
    outline = arc_pts(0, MSPR, MR, 48) + [(MR, BODY_TOP), (-MR, BODY_TOP)]
    stack('main vault and spandrels', [[(s, y, d) for s, y in outline] for d in (-HDR, HDR)], 'stone')


QUAD = [(MR, TR), (HS, TR), (HS, HD), (SJ, HD), (SJ, HDR), (MR, HDR)]
HALF = [(MR, -HDR), (SJ, -HDR), (SJ, -HD), (HS, -HD), (HS, HD), (SJ, HD), (SJ, HDR), (MR, HDR)]
SOCLE = [(-.3, PLAT), (.45, PLAT), (.45, Y0 + 1.90), (.38, Y0 + 1.95), (.32, Y0 + 2.05), (.26, Y0 + 2.15),
         (.20, Y0 + 2.25), (.14, Y0 + 2.30), (-.3, Y0 + 2.30)]
DADO = [(-.2, Y0 + 5.55), (.05, Y0 + 5.55), (.12, Y0 + 5.65), (.2, Y0 + 5.8), (.25, Y0 + 5.95), (.25, Y0 + 6.1),
        (-.2, Y0 + 6.1)]
TIMP = [(-.2, TSPR - .85), (.05, TSPR - .85), (.1, TSPR - .7), (.1, TSPR - .45), (.18, TSPR - .3), (.25, TSPR - .1),
        (.25, TSPR), (-.2, TSPR)]
ENT = [(-.3, ENT0), (.1, ENT0), (.1, ENT0 + .12), (.06, ENT0 + .16), (.06, ENT0 + 1.12), (.1, ENT0 + 1.16),
       (.18, ENT0 + 1.25), (.27, ENT0 + 1.35), (.35, ENT0 + 1.45), (.35, ENT0 + 1.7), (.85, ENT0 + 1.7),
       (.85, ENT0 + 2.12), (.9, ENT0 + 2.2), (.95, ENT0 + 2.3), (.95, ENT1), (-.3, ENT1)]


def greek_key(F, x0, x1, y0, y1, e0, e1):
    """Running Greek key on a band: one key per band height, in raised stone strips."""
    h = y1 - y0
    n = int((x1 - x0) / h)
    if n < 1:
        return
    w = .08
    fbar('key border', F, x0, y0 + .04, x1, y0 + .04, w, e0, e1, 'stone')
    fbar('key border', F, x0, y1 - .04, x1, y1 - .04, w, e0, e1, 'stone')
    xs = x0 + ((x1 - x0) - n * h) / 2
    key = [(.1, .08), (.1, .86), (.86, .86), (.86, .30), (.36, .30), (.36, .62), (.62, .62)]
    for k in range(n):
        for (a, b), (c, d) in zip(key, key[1:]):
            fbar('Greek key', F, xs + (k + a) * h, y0 + b * h, xs + (k + c) * h, y0 + d * h, w, e0, e1, 'stone')


def mouldings():
    for sx in (-1, 1):
        for sd in (-1, 1):
            XF[:] = [sx, sd]
            ring_sweep('pier socle', QUAD, SOCLE, 'stone')
            ring_sweep('dado cornice', QUAD, DADO, 'stone')
            path_sweep('transverse impost', [(HS, TR + .8), (HS, TR), (MR, TR), (MR, TR + .8)], (15, 8), TIMP, 'stone')
        XF[:] = [sx, 1]
        ring_sweep('impost entablature', HALF, ENT, 'stone')
        for a, t, n, L in outward_edges(HALF):
            if L < 1.0:
                continue
            F = Face(a, t, n)
            greek_key(F, .15, L - .15, ENT0 + .16, ENT0 + 1.12, .03, .11)
            k = int((L - .3) / .25)
            for i in range(k):
                x = .15 + (L - .3 - (k - 1) * .25) / 2 + i * .25
                fbox('entablature dentils', F, x - .065, x + .065, ENT0 + 1.46, ENT0 + 1.68, .3, .5, 'stone')
    XF[:] = [1, 1]


# ---------------------------------------------------------------- vaults: coffers and rosettes
def rosette(label, c, nrm, r, h=.2, petals=8):
    olathe(label, c, nrm, [(-.03, r), (.05, r * .97), (.10, r * .8), (.15, r * .5), (h, r * .15), (h + .02, .01)],
           'stone', sides=20, petals=petals, amp=.16)


def coffers(label, P, R, t_edges, nth, rib_w, rib_h, ros_r, th_n=36):
    """Coffered barrel vault: P(theta, r, t) -> (s, y, d); circumferential ribs at t_edges, nth panels round."""
    th = [math.pi * j / nth for j in range(nth + 1)]
    for tc in t_edges:
        st = []
        for k in range(th_n + 1):
            a = math.pi * k / th_n
            st.append([P(a, R + .05, tc - rib_w / 2), P(a, R - rib_h, tc - rib_w / 2), P(a, R - rib_h, tc + rib_w / 2),
                       P(a, R + .05, tc + rib_w / 2)])
        stack(label + ' rib', st, 'stone')
    ta, tb = t_edges[0], t_edges[-1]
    for j in range(1, nth):
        da = rib_w / 2 / R
        st = [[P(th[j] - da, R + .05, t), P(th[j] - da, R - rib_h, t), P(th[j] + da, R - rib_h, t),
               P(th[j] + da, R + .05, t)] for t in (ta, tb)]
        stack(label + ' rib', st, 'stone')
    inset, fw, fh = .22, .09, rib_h * .45
    for j in range(nth):
        for t0, t1 in zip(t_edges, t_edges[1:]):
            a0, a1 = th[j] + (rib_w / 2 + inset) / R, th[j + 1] - (rib_w / 2 + inset) / R
            u0, u1 = t0 + rib_w / 2 + inset, t1 - rib_w / 2 - inset
            for tc in (u0, u1):
                st = [[P(a, R + .03, tc - fw / 2), P(a, R - fh, tc - fw / 2), P(a, R - fh, tc + fw / 2),
                       P(a, R + .03, tc + fw / 2)] for a in np.linspace(a0, a1, 5)]
                stack(label + ' frame', st, 'stone')
            for ac in (a0, a1):
                df = fw / 2 / R
                st = [[P(ac - df, R + .03, t), P(ac - df, R - fh, t), P(ac + df, R - fh, t), P(ac + df, R + .03, t)]
                      for t in (u0, u1)]
                stack(label + ' frame', st, 'stone')
            am, tm = (th[j] + th[j + 1]) / 2, (t0 + t1) / 2
            c = np.array(P(am, R - .01, tm))
            inward = c - np.array(P(am, R + 1, tm))
            rosette(label + ' rosette', c, inward, ros_r)


def rosette_band(label, P, R, t0, t1, n, r):
    """Archivolt soffit band near a face: two border ribs and a chain of rosettes."""
    for tc in (t0, t1):
        st = [[P(a, R + .05, tc - .1), P(a, R - .16, tc - .1), P(a, R - .16, tc + .1), P(a, R + .05, tc + .1)]
              for a in np.linspace(0, math.pi, 37)]
        stack(label + ' rib', st, 'stone')
    tm = (t0 + t1) / 2
    for k in range(n):
        a = math.pi * (k + .5) / n
        for tt in (tm - (t1 - t0) / 4, tm + (t1 - t0) / 4):
            c = np.array(P(a, R - .01, tt))
            rosette(label + ' rosette', c, c - np.array(P(a, R + 1, tt)), r, h=.14, petals=6)


def vaults():
    XF[:] = [1, 1]

    def Pm(a, r, t):
        return (r * math.cos(a), MSPR + r * math.sin(a), t)
    g = HDR - 4.2
    coffers('main vault coffers', Pm, MR, [-g, -g / 3, g / 3, g], 7, .32, .30, .95)
    for sd in (-1, 1):
        lo, hi = sorted((sd * (HDR - .25), sd * (g + .25)))
        rosette_band('main archivolt soffit', Pm, MR, lo, hi, 18, .36)
    for sx in (-1, 1):
        XF[:] = [sx, 1]

        def Pt(a, r, t):
            return (t, TSPR + r * math.sin(a), r * math.cos(a))
        edges = list(np.linspace(MR + .35, HS - .35, 6))
        coffers('transverse vault coffers', Pt, TR, edges, 5, .24, .22, .55)
    XF[:] = [1, 1]


# ---------------------------------------------------------------- arches, keystones, spandrels
def fame(R, f):
    """Pradier's Fame in a main-arch spandrel: head under the architrave near the keystone, body lying
    down the curve of the arch, wings spread up and out, trumpet raised towards the keystone [PH]."""
    flyer(R, f * 4.2, MSPR + 7.95, f * 8.4, MSPR + 3.6, .55, math.pi / 2 + f * .3, 3.0,
          arm_to=(f * 2.2, MSPR + 8.25))
    wing(R, f * 5.4, MSPR + 7.6, 2.4, math.pi / 2 + f * .9, .35)                          # far wing
    limb(R, f * 2.2, MSPR + 8.25, f * 1.0, MSPR + 8.3, .12, .4)                          # trumpet
    R.add(f * 8.5, MSPR + 2.2, .22, 1.4, 0, .3)                                           # palm


def arches():
    for sd in (-1, 1):
        XF[:] = [1, sd]
        rng = random.Random(40 + sd)
        F = Face((0, HDR), (1, 0), (0, 1))
        arc_face('main archivolt', F, 0, MSPR,
                 [(MR - .02, -.1), (MR - .02, .1), (MR + .22, .12), (MR + .27, .2), (MR + .75, .2), (MR + .8, .28),
                  (MR + 1.12, .3), (MR + 1.2, .18), (MR + 1.2, -.1)], 64, 'stone')
        mblock('main keystone', 0, HDR + .32, .72, .42, [(MSPR + MR - .15, 0, 0), (MSPR + MR + .5, .1, 0),
                                                         (BODY_TOP - .2, .2, .06), (BODY_TOP - .02, .22, .06)],
               'stone')
        R = Relief()
        fame(R, -1)
        fame(R, 1)
        RO = MR + 1.20

        def spandrel(a, b, x0, x1):
            x = x0 + a * (x1 - x0)
            yb = MSPR + math.sqrt(max(0.0, RO * RO - x * x)) + .06 if abs(x) < RO else MSPR + .06
            yb = min(yb, BODY_TOP - .12)
            return x, yb + b * (BODY_TOP - .06 - yb)
        for x0, x1 in ((-SJ + .08, -.8), (.8, SJ - .08)):
            relief_slab('main spandrel Fame', F, lambda a, b, x0=x0, x1=x1: spandrel(a, b, x0, x1), 56, 30, R,
                        -.02, .12, 'carved')
    for sx in (-1, 1):
        XF[:] = [sx, 1]
        rng = random.Random(60 + sx)
        F = Face((HS, 0), (0, 1), (1, 0))
        arc_face('transverse archivolt', F, 0, TSPR,
                 [(TR - .02, -.1), (TR - .02, .08), (TR + .2, .1), (TR + .25, .16), (TR + .7, .18), (TR + .8, .1),
                  (TR + .8, -.1)], 40, 'stone')
        fbox('transverse keystone', F, -.38, .38, TSPR + TR - .1, TSPR + TR + .95, -.1, .32, 'stone')
        Fp = Face((MR, 0), (0, 1), (-1, 0))
        arc_face('transverse archivolt, passage', Fp, 0, TSPR,
                 [(TR - .02, -.1), (TR - .02, .08), (TR + .45, .12), (TR + .55, .06), (TR + .55, -.1)], 36, 'stone')
        RO = TR + .8
        R = Relief()
        for f in (-1, 1):
            flyer(R, f * 2.9, ENT0 - .45, f * 6.6, TSPR + 1.4, .42, math.pi / 2 + f * .5, 2.3,
                  arm_to=(f * 1.6, ENT0 - .3))
            R.add(f * 7.4, TSPR + 2.6, .3, 1.2, 0, .25)

        def side_sp(a, b, x0, x1):
            x = x0 + a * (x1 - x0)
            yb = TSPR + math.sqrt(max(0.0, RO * RO - x * x)) + .05 if abs(x) < RO else TSPR + .05
            yb = min(yb, ENT0 - .15)
            return x, yb + b * (ENT0 - .08 - yb)
        for x0, x1 in ((-HD + .6, -.45), (.45, HD - .6)):
            relief_slab('transverse spandrel Victory', F, lambda a, b, x0=x0, x1=x1: side_sp(a, b, x0, x1), 40, 18,
                        R, -.02, .12, 'carved')
    XF[:] = [1, 1]


# ---------------------------------------------------------------- groups, panels
def main_face(sd):
    """Wall plane of a wide face, x = s increasing to the right of a viewer standing in front of it."""
    return Face((0, sd * HD), (-sd, 0), (0, sd))


def groups():
    XF[:] = [1, 1]
    YB = Y0 + 7.10                                   # plinth top: the figures stand here [ABZ]
    for (sd, ss), compose in GROUPS.items():
        sc = ss * GROUP_C
        dc = sd * (HD + .8)
        # pedestal: base moulding, die and cornice, projecting 1.6 m (cornice 1.9 m) from the pier [ABZ]
        mblock('group pedestal', sc, dc, 3.3, .8,
               [(PLAT, .18), (PLAT + .2, .18), (PLAT + .3, .1), (PLAT + .45, .04), (Y0 + 2.0, 0.0), (Y0 + 5.55, 0.0),
                (Y0 + 5.6, .06), (Y0 + 5.75, .12), (Y0 + 5.9, .2), (Y0 + 6.1, .28)], 'stone')
        mblock('group plinth', sc, sd * (HD + .72), 3.0, .72,
               [(Y0 + 6.1, 0), (Y0 + 6.6, 0), (Y0 + 6.6, -.15), (YB, -.15)], 'stone')
        F = main_face(sd)
        x0 = -sd * sc                                 # the pier centre in the face's own x
        R = Relief()
        compose(R, random.Random(7 + 3 * sd + ss))
        face = (lambda F, x0: (lambda x, y, e: F(x + x0, y + YB, e)))(F, x0)
        relief_slab('sculpture group', face, rect_map(-3.8, 3.8, 0.0, 11.7), 72, 110, R, -.02, .2, 'carved')


def pier_panels():
    for sd in (-1, 1):
        F = main_face(sd)
        for ss in (-1, 1):
            rng = random.Random(200 + 10 * sd + ss)
            xc = -sd * ss * GROUP_C
            x0, x1, y0, y1 = xc - 4.75, xc + 4.75, Y0 + 24.65, Y0 + 29.55
            R = Relief()
            crowd(R, x0, x1, y0 + .05, 3.3, .42, rng, horses=.35, raised=.4)
            panel('battle relief', F, x0, x1, y0, y1, 8, R, base=.03, back=.15)
            frame('relief frame', F, x0, x1, y0, y1, .35, .2)
    for ss in (-1, 1):
        XF[:] = [ss, 1]
        rng = random.Random(300 + ss)
        F = Face((HS, 0), (0, 1), (1, 0))
        x0, x1, y0, y1 = -8.25, 8.25, Y0 + 24.65, Y0 + 29.55
        R = Relief()
        crowd(R, x0, x1, y0 + .05, 3.3, .42, rng, horses=.45, raised=.5)
        panel('battle relief (Austerlitz / Jemmapes)', F, x0, x1, y0, y1, 8, R, base=.03, back=.15)
        frame('relief frame', F, x0, x1, y0, y1, .35, .2)
    XF[:] = [1, 1]


# ---------------------------------------------------------------- entablature, frieze, cornice
CORN = [(34.7, 0.0), (34.8, .06), (34.9, .14), (35.02, .22), (35.1, .3), (35.2, .35), (35.95, .35), (35.95, 1.95),
        (36.7, 1.95), (36.75, 2.02), (37.0, 2.12), (37.2, 2.2), (38.0, 2.2), (38.1, 2.12), (38.2, 2.05),
        (38.4, -.3)]
MODILLION = [(.35, 35.2), (.35, 35.95), (1.85, 35.95), (1.85, 35.8), (1.6, 35.72), (1.3, 35.66), (1.0, 35.58),
             (.75, 35.45), (.55, 35.32), (.45, 35.22)]


def all_faces():
    """(Face, x0, x1) for the four outer faces at the pier planes."""
    out = []
    for sd in (-1, 1):
        out.append((main_face(sd), -HS, HS))
    for ss in (-1, 1):
        out.append((Face((ss * HS, 0), (0, ss), (ss, 0)), -HD, HD))
    return out


def entablature():
    XF[:] = [1, 1]
    mblock('architrave', 0, 0, HS, HD, [(BODY_TOP, 0.0), (Y0 + 31.9, 0.0), (Y0 + 31.9, .06), (Y0 + 32.0, .12),
                                        (Y0 + 32.3, .12), (Y0 + 32.3, .16), (FR0, .16)], 'stone')
    box('frieze core', -HS, HS, FR0, FR1, -HD, HD, 'stone')
    mblock('frieze border', 0, 0, HS, HD, [(FR0, .12), (FR0 + .14, .12)], 'stone')
    mblock('frieze border', 0, 0, HS, HD, [(FR1 - .14, .12), (FR1, .12)], 'stone')
    mblock('main cornice', 0, 0, HS, HD, [(Y0 + y, o) for y, o in CORN], 'stone')
    for i, (F, xa, xb) in enumerate(all_faces()):
        rng = random.Random(500 + i)
        R = Relief()
        crowd(R, xa + .05, xb - .05, FR0 + .16, 1.9, .28, rng, horses=.12, raised=.25)
        mid = (xa + xb) / 2                                   # the central group of each face
        for k in (-1, 0, 1):
            figure(R, mid + k * .75, FR0 + .16, 1.95, .34, rng, arm=(.1 * k, .3) if k else (0, .35))
        panel('great frieze (departure and return of the armies)', F, xa, xb, FR0 + .14, FR1 - .14, 7, R,
              base=.04, back=.12)
        n = int((xb - xa - 1.0) / .95)
        for k in range(n + 1):
            x = xa + .5 + k * (xb - xa - 1.0) / n
            fprofile('cornice modillion', F, x - .17, x + .17, [(e, Y0 + y) for e, y in MODILLION], 'stone')
        n = int((xb - xa - 1.0) / 2.6)
        for k in range(n + 1):
            x = xa + .5 + k * (xb - xa - 1.0) / n
            c = np.array(F(x, Y0 + 37.6, 2.17))
            nrm = np.array(F(x, Y0 + 37.6, 3.17)) - c
            olathe('lion head', c, nrm, [(-.05, .30), (.08, .32), (.17, .27), (.25, .19), (.31, .10), (.33, .02)],
                   'carved', sides=12, petals=9, amp=.12)


# ---------------------------------------------------------------- attic, crest, roof
ASI, ADI = HS - AT_IN, HD - AT_IN          # attic half extents
ACORN = [(0, 0.0), (.08, .08), (.18, .15), (.25, .2), (.3, .55), (.75, .6), (.85, .75), (1.05, .9), (1.12, 1.0),
         (1.25, 1.0), (1.3, .9)]
WIN0, WIN1, WHW = Y0 + 40.0, Y0 + 42.0, 1.0   # attic window on each narrow face (opening into the attic hall) [ABZ/PH]


def palm(F, x, y0, y1):
    """Palm branch carved on an attic pilaster strip."""
    fbar('palm stem', F, x, y0 + .1, x, y1 - .1, .06, .1, .16, 'carved')
    for k in range(9):
        y = y0 + .35 + k * (y1 - y0 - .6) / 8
        for sg in (-1, 1):
            fbar('palm leaf', F, x, y, x + sg * .27, y - .22, .07, .1, .15, 'carved')


def attic_face(F, xa, xb, nbays, window_bay=None):
    ys = (AT0 + .4 + AT1) / 2
    xs = [xa + .4 + k * (xb - xa - .8) / nbays for k in range(nbays + 1)]
    for x in xs:
        fbox('attic pilaster strip', F, x - .38, x + .38, AT0 + .4, AT1 - .02, -.05, .1, 'stone')
        fbox('attic pilaster cap', F, x - .48, x + .48, AT1 - .28, AT1 - .02, -.05, .2, 'stone')
        palm(F, x, AT0 + .7, AT1 - .45)
    for k in range(nbays):
        xc = (xs[k] + xs[k + 1]) / 2
        if k == window_bay:
            continue
        c = np.array(F(xc, ys, .0))
        nrm = np.array(F(xc, ys, 1.0)) - c
        olathe('attic shield (plain)', c, nrm, [(-.05, .98), (.16, .98), (.2, .92), (.2, .84), (.14, .8), (.14, .02)],
               'carved', sides=28)


def attic():
    XF[:] = [1, 1]
    box('attic core', -(ASI - .6), ASI - .6, AT0 - .1, ATC1 - .02, -ADI, ADI, 'stone')
    mblock('attic base', 0, 0, ASI, ADI, [(AT0, .14), (AT0 + .22, .14), (AT0 + .3, .08), (AT0 + .4, .02)], 'stone')
    mblock('attic cornice', 0, 0, ASI, ADI, [(AT1 + y, o) for y, o in ACORN], 'stone')
    for ss in (-1, 1):
        XF[:] = [ss, 1]
        s0, s1 = ASI - .6, ASI
        # the narrow end wall of the attic with its window: real depth, a dark pane, an iron star grille
        box('attic end wall', s0, s1, AT0 - .1, ATC1 - .02, -ADI, -WHW, 'stone')
        box('attic end wall', s0, s1, AT0 - .1, ATC1 - .02, WHW, ADI, 'stone')
        box('attic end wall', s0, s1, AT0 - .1, WIN0, -WHW, WHW, 'stone')
        box('attic end wall', s0, s1, WIN1, ATC1 - .02, -WHW, WHW, 'stone')
        box('attic window pane', s0 - .03, s0 + .03, WIN0, WIN1, -WHW, WHW, 'glass')
        F = Face((s1, 0), (0, 1), (1, 0))
        for x0, x1, y0, y1 in ((-WHW - .28, -WHW, WIN0 - .28, WIN1 + .28), (WHW, WHW + .28, WIN0 - .28, WIN1 + .28),
                               (-WHW, WHW, WIN0 - .28, WIN0), (-WHW, WHW, WIN1, WIN1 + .28)):
            fbox('attic window frame', F, x0, x1, y0, y1, -.05, .14, 'stone')
        yc, sg = (WIN0 + WIN1) / 2, s0 + .32
        tube('window grille', [(sg, yc + .45 * math.sin(a), .45 * math.cos(a)) for a in np.linspace(0, math.tau * .97, 24)],
             .03, 'steel')
        for k in range(8):
            a = k * math.pi / 4
            L = WHW / max(abs(math.cos(a)), abs(math.sin(a)))
            tube('window grille', [(sg, yc, 0.0), (sg, yc + L * math.sin(a), L * math.cos(a))], .03, 'steel', 5)
    XF[:] = [1, 1]
    faces = [(main_face(sd), -ASI, ASI, 11, None) for sd in (-1, 1)] + \
        [(Face((ss * ASI, 0), (0, ss), (ss, 0)), -ADI, ADI, 5, 2) for ss in (-1, 1)]
    for F, xa, xb, nb, wb in faces:
        attic_face(F, xa, xb, nb, wb)
    # terrace parapet with the palmette crest and the modern iron railing
    PO, DO, T = ASI + .1, ADI + .1, .5
    for sd in (-1, 1):
        box('parapet', -PO, PO, ATC1 - .05, PAR1, sd * DO - (T if sd > 0 else 0), sd * DO + (0 if sd > 0 else T),
            'stone')
    for ss in (-1, 1):
        box('parapet', ss * PO - (T if ss > 0 else 0), ss * PO + (0 if ss > 0 else T), ATC1 - .05, PAR1, -DO + T,
            DO - T, 'stone')
    crest = [(Face((0, sd * DO), (-sd, 0), (0, sd)), -PO, PO, 13) for sd in (-1, 1)] + \
        [(Face((ss * PO, 0), (0, ss), (ss, 0)), -DO, DO, 6) for ss in (-1, 1)]
    for F, xa, xb, n in crest:
        xs = [xa + .6 + k * (xb - xa - 1.2) / (n - 1) for k in range(n)]
        for i, x in enumerate(xs):
            palmette(F, x, PAR1, -T / 2, 7, .62, .11)
            if i + 1 < n:
                palmette(F, (x + xs[i + 1]) / 2, PAR1, -T / 2, 3, .38, .08)
        k = int((xb - xa) / .6)
        for i in range(k + 1):
            x = xa + .15 + i * (xb - xa - .3) / k
            fbox('terrace railing post', F, x - .025, x + .025, PAR1, PAR1 + 1.15, -T + .02, -T + .07, 'steel')
        fbox('terrace railing rail', F, xa + .1, xb - .1, PAR1 + 1.1, PAR1 + 1.16, -T + .01, -T + .08, 'steel')
    # the raised roof over the great vault, the low hump seen from far down the avenues [ABZ/PH]
    box('roof over the vault', -13.5, 13.5, ATC1 - .05, Y0 + 47.6, -6.8, 6.8, 'stone')
    hr = TOP - (Y0 + 47.6)
    rho = (6.8 ** 2 + hr ** 2) / (2 * hr)
    a0 = math.asin(6.8 / rho)
    sec = [(rho * math.sin(a), TOP - rho + rho * math.cos(a)) for a in np.linspace(-a0, a0, 17)]
    stack('roof barrel', [[(s, y, d) for d, y in sec] for s in (-13.7, 13.7)], 'stone')


def palmette(F, x, y0, e, n, L, r):
    """Anthemion on the crest: n lobes fanning up from a small boss."""
    c = np.array(F(x, y0 + .12, e))
    olathe('crest boss', c, (0, 1, 0), [(-.12, .12), (0, .17), (.12, .12), (.2, .02)], 'carved', sides=8)
    for k in range(n):
        a = math.pi / 2 + (k - (n - 1) / 2) * (1.9 / max(n - 1, 1))
        ll = L * (1 - .25 * abs(k - (n - 1) / 2) / max((n - 1) / 2, 1))
        d = np.array(F(x + math.cos(a), y0 + .12 + math.sin(a), e)) - c
        olathe('crest palmette', c, d, [(.05, .02), (.3 * ll, r), (.7 * ll, r * .9), (ll, .02)], 'carved', sides=6)


# ---------------------------------------------------------------- tomb, island paving, bollards
GROUND_ROWS = """0.35 0.28 0.20 0.13 0.06 -0.02 -0.10 -0.17 -0.25 -0.32 -0.39 -0.47 -0.54 -0.61 -0.68 -0.75 -0.82 -0.88 -0.95 -1.01 -1.05 -1.10 -1.13 -1.15 -1.16 -1.16 -1.15 -1.12 -1.09 -1.05 -0.99 -0.93 -0.85 -0.78 -0.69 -0.60 -0.50 -0.40 -0.29 -0.20 -0.10 -0.01 0.07 0.14 0.21 0.27 0.33 0.39 0.43 0.49 0.53 0.58 0.62 0.67 0.72 0.76 0.81 0.86 0.92
0.28 0.21 0.14 0.07 -0.01 -0.08 -0.15 -0.22 -0.29 -0.35 -0.42 -0.49 -0.56 -0.62 -0.68 -0.75 -0.81 -0.87 -0.92 -0.98 -1.02 -1.05 -1.07 -1.08 -1.09 -1.08 -1.06 -1.03 -0.99 -0.94 -0.88 -0.81 -0.72 -0.64 -0.55 -0.46 -0.35 -0.25 -0.15 -0.06 0.03 0.11 0.18 0.25 0.31 0.37 0.41 0.46 0.50 0.54 0.58 0.62 0.66 0.69 0.74 0.78 0.82 0.87 0.92
0.20 0.14 0.07 0.01 -0.06 -0.13 -0.19 -0.26 -0.32 -0.38 -0.44 -0.50 -0.56 -0.62 -0.68 -0.73 -0.79 -0.84 -0.89 -0.93 -0.96 -0.98 -1.00 -1.00 -1.00 -0.99 -0.96 -0.93 -0.87 -0.81 -0.74 -0.67 -0.58 -0.49 -0.40 -0.30 -0.20 -0.10 -0.01 0.09 0.17 0.24 0.31 0.37 0.41 0.46 0.50 0.53 0.56 0.59 0.62 0.65 0.68 0.72 0.75 0.79 0.83 0.88 0.92
0.13 0.07 0.01 -0.05 -0.12 -0.17 -0.23 -0.29 -0.35 -0.40 -0.45 -0.51 -0.56 -0.61 -0.66 -0.70 -0.75 -0.79 -0.83 -0.86 -0.89 -0.90 -0.91 -0.91 -0.89 -0.88 -0.84 -0.79 -0.74 -0.67 -0.60 -0.52 -0.43 -0.33 -0.24 -0.14 -0.04 0.06 0.15 0.24 0.31 0.38 0.44 0.48 0.52 0.56 0.58 0.61 0.63 0.65 0.67 0.69 0.71 0.74 0.77 0.80 0.84 0.88 0.92
0.06 0.01 -0.05 -0.11 -0.16 -0.21 -0.27 -0.32 -0.37 -0.41 -0.46 -0.50 -0.55 -0.59 -0.63 -0.66 -0.70 -0.73 -0.76 -0.79 -0.80 -0.81 -0.80 -0.79 -0.77 -0.74 -0.70 -0.65 -0.59 -0.52 -0.44 -0.36 -0.26 -0.17 -0.07 0.03 0.13 0.23 0.32 0.39 0.47 0.52 0.57 0.60 0.63 0.66 0.67 0.69 0.69 0.70 0.71 0.72 0.74 0.76 0.78 0.81 0.84 0.88 0.92
-0.00 -0.06 -0.11 -0.16 -0.20 -0.25 -0.29 -0.34 -0.38 -0.42 -0.46 -0.49 -0.52 -0.56 -0.58 -0.61 -0.64 -0.67 -0.68 -0.69 -0.69 -0.69 -0.68 -0.66 -0.64 -0.60 -0.55 -0.49 -0.43 -0.36 -0.27 -0.19 -0.09 0.01 0.11 0.21 0.30 0.39 0.48 0.55 0.61 0.66 0.69 0.72 0.74 0.76 0.76 0.76 0.76 0.76 0.76 0.76 0.77 0.78 0.79 0.81 0.84 0.88 0.91
-0.06 -0.11 -0.16 -0.20 -0.24 -0.28 -0.32 -0.35 -0.39 -0.41 -0.44 -0.47 -0.49 -0.52 -0.53 -0.55 -0.57 -0.58 -0.59 -0.58 -0.58 -0.57 -0.55 -0.52 -0.49 -0.44 -0.39 -0.33 -0.26 -0.18 -0.10 -0.01 0.09 0.19 0.29 0.39 0.48 0.56 0.64 0.71 0.75 0.80 0.82 0.84 0.85 0.85 0.84 0.83 0.82 0.81 0.80 0.79 0.79 0.79 0.80 0.82 0.84 0.87 0.91
-0.12 -0.16 -0.20 -0.24 -0.28 -0.31 -0.34 -0.36 -0.38 -0.41 -0.42 -0.44 -0.45 -0.46 -0.47 -0.48 -0.49 -0.48 -0.48 -0.47 -0.45 -0.43 -0.41 -0.37 -0.33 -0.28 -0.22 -0.15 -0.08 0.00 0.09 0.18 0.28 0.37 0.47 0.57 0.65 0.73 0.80 0.85 0.90 0.93 0.95 0.95 0.95 0.94 0.93 0.91 0.88 0.86 0.84 0.82 0.81 0.81 0.81 0.82 0.84 0.87 0.91
-0.16 -0.20 -0.24 -0.27 -0.30 -0.32 -0.34 -0.36 -0.37 -0.39 -0.39 -0.40 -0.40 -0.40 -0.40 -0.40 -0.39 -0.38 -0.36 -0.34 -0.32 -0.29 -0.25 -0.21 -0.16 -0.10 -0.04 0.04 0.11 0.20 0.28 0.37 0.47 0.56 0.66 0.74 0.83 0.90 0.96 1.00 1.04 1.05 1.07 1.06 1.05 1.03 1.00 0.97 0.94 0.91 0.88 0.86 0.84 0.83 0.82 0.83 0.85 0.87 0.90
-0.20 -0.23 -0.26 -0.29 -0.31 -0.33 -0.34 -0.35 -0.36 -0.36 -0.36 -0.35 -0.34 -0.33 -0.32 -0.31 -0.28 -0.27 -0.24 -0.21 -0.17 -0.13 -0.09 -0.04 0.02 0.08 0.15 0.23 0.31 0.39 0.48 0.57 0.67 0.76 0.84 0.91 1.00 1.06 1.11 1.15 1.15 1.17 1.18 1.17 1.15 1.12 1.08 1.04 1.00 0.96 0.92 0.89 0.87 0.85 0.84 0.84 0.85 0.88 0.91
-0.23 -0.26 -0.28 -0.30 -0.32 -0.33 -0.34 -0.33 -0.33 -0.32 -0.31 -0.30 -0.28 -0.25 -0.23 -0.20 -0.17 -0.14 -0.11 -0.07 -0.02 0.03 0.08 0.14 0.20 0.27 0.35 0.42 0.50 0.57 0.66 0.75 0.86 0.95 0.97 1.01 1.08 1.18 1.26 1.27 1.23 1.22 1.23 1.25 1.24 1.20 1.16 1.11 1.06 1.01 0.96 0.93 0.90 0.88 0.86 0.86 0.87 0.89 0.92
-0.26 -0.28 -0.29 -0.30 -0.32 -0.32 -0.31 -0.31 -0.29 -0.28 -0.25 -0.23 -0.20 -0.17 -0.14 -0.10 -0.06 -0.01 0.03 0.08 0.14 0.19 0.25 0.32 0.39 0.45 0.52 0.61 0.69 0.76 0.83 0.87 0.95 1.04 1.06 1.06 1.10 1.17 1.25 1.30 1.28 1.22 1.25 1.26 1.27 1.26 1.23 1.17 1.12 1.06 1.01 0.97 0.93 0.91 0.92 0.88 0.91 0.97 1.07
-0.27 -0.28 -0.29 -0.30 -0.30 -0.30 -0.28 -0.27 -0.25 -0.22 -0.19 -0.15 -0.12 -0.07 -0.03 0.02 0.07 0.12 0.18 0.23 0.30 0.36 0.41 0.48 0.57 0.62 0.68 0.74 0.78 0.86 0.93 0.94 0.97 1.02 1.04 1.05 1.10 1.14 1.19 1.23 1.23 1.23 1.27 1.28 1.29 1.29 1.27 1.23 1.17 1.11 1.06 1.06 0.98 1.00 1.06 1.16 1.03 1.14 1.27
-0.27 -0.28 -0.28 -0.28 -0.28 -0.27 -0.25 -0.22 -0.20 -0.16 -0.12 -0.07 -0.02 0.03 0.08 0.14 0.20 0.26 0.32 0.38 0.45 0.52 0.56 0.62 0.67 0.72 0.80 0.82 0.84 0.89 0.92 0.94 0.96 1.00 1.02 1.04 1.08 1.10 1.13 1.18 1.18 1.23 1.25 1.28 1.32 1.32 1.31 1.27 1.26 1.18 1.18 1.22 1.31 1.16 1.27 1.40 1.23 1.37 1.53
-0.27 -0.27 -0.27 -0.26 -0.25 -0.22 -0.20 -0.17 -0.13 -0.09 -0.04 0.01 0.07 0.13 0.20 0.26 0.32 0.40 0.45 0.49 0.56 0.60 0.66 0.73 0.72 0.75 0.81 0.82 0.85 0.87 0.90 0.92 0.95 0.98 0.99 1.03 1.06 1.08 1.12 1.15 1.18 1.21 1.24 1.27 1.31 1.34 1.36 1.37 1.41 1.46 1.35 1.43 1.55 1.70 1.52 1.68 1.86 1.65 1.83
-0.25 -0.25 -0.24 -0.22 -0.20 -0.18 -0.14 -0.11 -0.06 -0.01 0.05 0.11 0.17 0.24 0.31 0.36 0.42 0.50 0.53 0.59 0.63 0.64 0.68 0.72 0.74 0.75 0.78 0.80 0.82 0.85 0.87 0.90 0.93 0.96 0.98 1.02 1.04 1.07 1.11 1.12 1.17 1.20 1.22 1.26 1.29 1.35 1.45 1.47 1.58 1.68 1.80 1.67 1.82 2.00 1.79 1.99 2.18 2.38 2.15
-0.23 -0.22 -0.20 -0.18 -0.15 -0.12 -0.08 -0.04 0.02 0.08 0.14 0.21 0.27 0.34 0.41 0.45 0.51 0.54 0.56 0.61 0.64 0.65 0.67 0.69 0.71 0.73 0.76 0.77 0.80 0.83 0.85 0.89 0.91 0.93 0.97 1.00 1.02 1.06 1.09 1.11 1.15 1.18 1.21 1.25 1.30 1.41 1.55 1.72 1.73 1.89 2.06 2.23 2.10 2.30 2.50 2.30 2.50 2.71 2.48
-0.20 -0.18 -0.16 -0.14 -0.10 -0.06 -0.02 0.04 0.10 0.17 0.24 0.30 0.36 0.43 0.46 0.48 0.54 0.56 0.56 0.59 0.61 0.63 0.65 0.66 0.68 0.71 0.73 0.75 0.78 0.80 0.82 0.86 0.89 0.91 0.95 0.97 1.00 1.04 1.06 1.10 1.13 1.16 1.20 1.26 1.34 1.50 1.69 1.90 2.11 2.12 2.31 2.51 2.71 2.59 2.80 3.00 2.81 3.01 3.18
-0.16 -0.14 -0.11 -0.08 -0.04 0.01 0.06 0.12 0.19 0.26 0.34 0.36 0.41 0.48 0.48 0.49 0.52 0.53 0.54 0.56 0.57 0.59 0.62 0.64 0.66 0.68 0.70 0.73 0.76 0.78 0.81 0.84 0.86 0.90 0.93 0.95 0.99 1.02 1.04 1.08 1.11 1.14 1.20 1.31 1.48 1.61 1.83 2.07 2.33 2.56 2.56 2.78 2.98 2.87 3.07 3.26 3.43 3.27 3.43
-0.12 -0.09 -0.06 -0.02 0.03 0.08 0.14 0.20 0.25 0.33 0.39 0.39 0.42 0.45 0.46 0.47 0.48 0.50 0.51 0.53 0.54 0.56 0.58 0.60 0.63 0.66 0.68 0.70 0.73 0.75 0.79 0.82 0.84 0.88 0.89 0.93 0.97 0.99 1.03 1.06 1.09 1.13 1.23 1.39 1.59 1.83 2.08 2.25 2.52 2.77 3.01 3.02 3.22 3.40 3.31 3.48 3.62 3.49 3.62
-0.07 -0.04 -0.00 0.04 0.09 0.15 0.22 0.26 0.29 0.36 0.37 0.39 0.40 0.41 0.42 0.44 0.45 0.46 0.47 0.49 0.52 0.54 0.55 0.57 0.59 0.62 0.65 0.68 0.70 0.73 0.76 0.79 0.82 0.85 0.87 0.91 0.94 0.97 1.01 1.04 1.07 1.14 1.28 1.49 1.73 1.99 2.27 2.54 2.71 2.97 3.21 3.42 3.42 3.59 3.72 3.65 3.76 3.84 3.76
-0.03 0.01 0.06 0.11 0.15 0.21 0.27 0.28 0.32 0.35 0.35 0.36 0.37 0.38 0.39 0.40 0.42 0.43 0.45 0.46 0.48 0.50 0.53 0.55 0.57 0.59 0.61 0.65 0.67 0.71 0.74 0.75 0.80 0.82 0.85 0.89 0.91 0.95 0.98 1.01 1.06 1.18 1.36 1.59 1.85 2.16 2.45 2.74 3.01 3.16 3.39 3.58 3.73 3.73 3.83 3.89 3.85 3.88 3.88
0.02 0.07 0.12 0.16 0.20 0.27 0.29 0.29 0.31 0.32 0.32 0.33 0.34 0.35 0.36 0.37 0.38 0.40 0.41 0.43 0.45 0.47 0.48 0.51 0.54 0.56 0.59 0.61 0.64 0.68 0.70 0.74 0.77 0.78 0.82 0.87 0.89 0.93 0.96 0.99 1.08 1.24 1.46 1.72 2.01 2.31 2.63 2.92 3.19 3.42 3.54 3.72 3.84 3.90 3.89 3.90 3.90 3.88 3.88
0.07 0.12 0.18 0.20 0.23 0.28 0.28 0.28 0.28 0.29 0.29 0.30 0.31 0.31 0.33 0.34 0.35 0.36 0.38 0.40 0.42 0.44 0.46 0.48 0.50 0.53 0.56 0.58 0.62 0.65 0.66 0.71 0.73 0.77 0.81 0.83 0.86 0.90 0.93 0.97 1.06 1.23 1.57 1.86 2.17 2.48 2.79 3.07 3.35 3.57 3.74 3.86 3.90 3.92 3.92 3.90 3.90 3.90 3.88
0.11 0.17 0.21 0.21 0.24 0.25 0.25 0.25 0.25 0.25 0.26 0.27 0.28 0.28 0.29 0.30 0.32 0.34 0.35 0.36 0.38 0.40 0.43 0.45 0.47 0.51 0.52 0.56 0.59 0.62 0.65 0.68 0.69 0.74 0.78 0.80 0.85 0.87 0.90 0.96 1.10 1.30 1.56 2.00 2.32 2.65 2.96 3.24 3.48 3.69 3.83 3.92 3.94 3.92 3.92 3.92 3.90 3.90 3.90
0.15 0.21 0.21 0.21 0.23 0.22 0.22 0.22 0.23 0.23 0.23 0.23 0.24 0.26 0.27 0.27 0.29 0.30 0.32 0.34 0.35 0.37 0.39 0.41 0.44 0.47 0.49 0.53 0.56 0.57 0.63 0.65 0.68 0.71 0.74 0.78 0.81 0.85 0.89 0.97 1.14 1.39 1.68 2.00 2.32 2.80 3.11 3.38 3.61 3.79 3.90 3.94 3.94 3.94 3.92 3.92 3.92 3.90 3.90
0.17 0.21 0.20 0.20 0.20 0.20 0.19 0.19 0.19 0.20 0.20 0.21 0.21 0.22 0.23 0.24 0.26 0.27 0.29 0.30 0.32 0.34 0.36 0.38 0.41 0.43 0.47 0.50 0.53 0.56 0.59 0.61 0.65 0.69 0.71 0.75 0.78 0.81 0.85 0.91 1.21 1.48 1.79 2.13 2.48 2.81 3.12 3.51 3.72 3.86 3.94 3.94 3.94 3.94 3.94 3.92 3.92 3.92 3.90
0.18 0.19 0.18 0.18 0.17 0.17 0.17 0.17 0.17 0.17 0.17 0.18 0.19 0.20 0.20 0.21 0.23 0.24 0.26 0.27 0.29 0.31 0.33 0.36 0.39 0.40 0.43 0.46 0.49 0.53 0.56 0.59 0.62 0.65 0.69 0.73 0.75 0.79 0.82 0.92 1.10 1.36 1.91 2.26 2.62 2.95 3.26 3.52 3.73 3.91 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.92 3.92
0.17 0.16 0.16 0.16 0.15 0.14 0.14 0.14 0.14 0.14 0.14 0.15 0.15 0.16 0.17 0.19 0.19 0.21 0.23 0.24 0.27 0.28 0.30 0.32 0.35 0.38 0.41 0.43 0.46 0.49 0.52 0.56 0.60 0.62 0.66 0.69 0.72 0.77 0.81 0.94 1.16 1.44 1.77 2.12 2.48 3.08 3.38 3.62 3.81 3.92 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.92
0.15 0.14 0.13 0.13 0.12 0.12 0.12 0.11 0.11 0.12 0.12 0.13 0.13 0.13 0.14 0.15 0.17 0.19 0.20 0.21 0.23 0.25 0.27 0.30 0.32 0.34 0.37 0.40 0.44 0.46 0.49 0.52 0.56 0.59 0.63 0.66 0.69 0.73 0.80 0.97 1.21 1.52 1.87 2.24 2.60 2.95 3.27 3.71 3.87 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94
0.13 0.12 0.12 0.10 0.10 0.10 0.09 0.09 0.10 0.09 0.09 0.10 0.11 0.11 0.12 0.12 0.14 0.15 0.17 0.19 0.20 0.21 0.24 0.27 0.29 0.32 0.35 0.37 0.40 0.43 0.47 0.50 0.52 0.56 0.60 0.63 0.67 0.71 0.74 0.83 1.26 1.60 1.96 2.35 2.71 3.06 3.38 3.63 3.82 3.92 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94
0.10 0.10 0.09 0.09 0.08 0.07 0.06 0.07 0.07 0.07 0.07 0.07 0.07 0.08 0.10 0.10 0.11 0.12 0.14 0.16 0.17 0.19 0.22 0.23 0.26 0.29 0.31 0.35 0.37 0.40 0.43 0.47 0.50 0.54 0.56 0.60 0.64 0.67 0.72 0.84 1.07 1.35 1.70 2.43 2.81 3.16 3.46 3.70 3.87 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94
0.08 0.08 0.06 0.06 0.06 0.06 0.05 0.04 0.04 0.04 0.04 0.05 0.05 0.06 0.06 0.07 0.09 0.10 0.12 0.13 0.14 0.17 0.19 0.21 0.24 0.26 0.28 0.32 0.34 0.37 0.41 0.43 0.47 0.50 0.54 0.58 0.61 0.64 0.69 0.85 1.10 1.41 1.77 2.15 2.53 2.91 3.24 3.76 3.90 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94
0.06 0.06 0.05 0.04 0.03 0.02 0.02 0.03 0.02 0.02 0.01 0.02 0.03 0.04 0.04 0.05 0.06 0.07 0.09 0.10 0.12 0.14 0.15 0.18 0.21 0.23 0.26 0.28 0.31 0.35 0.38 0.41 0.44 0.47 0.50 0.54 0.58 0.62 0.65 0.69 0.75 1.15 1.46 2.22 2.62 2.99 3.32 3.59 3.79 3.90 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94 3.94
0.03 0.03 0.03 0.02 0.01 0.01 -0.00 -0.01 -0.01 0.00 -0.00 -0.00 0.00 0.01 0.02 0.03 0.04 0.05 0.06 0.07 0.10 0.12 0.13 0.16 0.18 0.20 0.23 0.26 0.29 0.32 0.34 0.38 0.41 0.44 0.48 0.52 0.54 0.58 0.63 0.67 0.69 0.74 0.99 1.26 1.90 2.66 3.03 3.64 3.83 3.92 3.92 3.92 3.92 3.92 3.94 3.94 3.94 3.94 3.94
-0.00 0.00 -0.00 -0.01 -0.01 -0.01 -0.02 -0.02 -0.03 -0.03 -0.03 -0.02 -0.02 -0.02 -0.01 0.00 0.01 0.03 0.04 0.05 0.07 0.09 0.11 0.13 0.15 0.18 0.20 0.22 0.26 0.29 0.32 0.35 0.38 0.41 0.45 0.49 0.52 0.56 0.59 0.62 0.67 0.71 0.83 1.14 1.44 2.02 2.39 3.07 3.37 3.82 3.89 3.90 3.92 3.92 3.92 3.92 3.92 3.94 3.94
-0.04 -0.02 -0.01 -0.03 -0.04 -0.05 -0.04 -0.05 -0.04 -0.04 -0.05 -0.05 -0.04 -0.04 -0.03 -0.02 -0.01 0.00 0.01 0.03 0.05 0.06 0.08 0.10 0.12 0.15 0.17 0.20 0.23 0.26 0.29 0.33 0.36 0.39 0.42 0.46 0.50 0.53 0.57 0.60 0.63 0.68 0.80 1.04 1.37 1.69 2.22 2.57 3.16 3.42 3.80 3.85 3.85 3.90 3.90 3.90 3.92 3.92 3.92
-0.10 -0.04 -0.04 -0.05 -0.05 -0.06 -0.07 -0.08 -0.07 -0.07 -0.07 -0.06 -0.07 -0.06 -0.05 -0.04 -0.03 -0.02 -0.01 0.01 0.02 0.04 0.06 0.08 0.10 0.12 0.15 0.18 0.21 0.23 0.26 0.29 0.33 0.36 0.40 0.43 0.46 0.50 0.54 0.58 0.61 0.67 0.80 1.01 1.30 1.61 2.00 2.47 2.80 3.27 3.49 3.77 3.79 3.79 3.85 3.85 3.85 3.90 3.90
-0.18 -0.12 -0.09 -0.08 -0.08 -0.08 -0.08 -0.08 -0.09 -0.10 -0.09 -0.09 -0.08 -0.07 -0.07 -0.07 -0.06 -0.04 -0.03 -0.01 -0.01 0.02 0.04 0.05 0.08 0.10 0.12 0.15 0.18 0.21 0.24 0.27 0.30 0.33 0.37 0.40 0.44 0.47 0.50 0.54 0.60 0.67 0.79 0.94 1.30 1.63 2.01 2.33 2.74 3.01 3.39 3.54 3.71 3.71 3.79 3.79 3.79 3.85 3.85
-0.27 -0.19 -0.13 -0.10 -0.10 -0.11 -0.11 -0.11 -0.11 -0.11 -0.11 -0.12 -0.10 -0.09 -0.09 -0.08 -0.07 -0.07 -0.05 -0.04 -0.02 -0.00 0.01 0.03 0.06 0.07 0.10 0.12 0.15 0.18 0.20 0.24 0.28 0.30 0.34 0.37 0.41 0.45 0.49 0.53 0.58 0.68 0.80 0.97 1.18 1.60 1.94 2.33 2.59 2.96 3.30 3.44 3.62 3.62 3.62 3.71 3.71 3.79 3.79
-0.38 -0.27 -0.17 -0.13 -0.12 -0.12 -0.13 -0.14 -0.14 -0.13 -0.13 -0.12 -0.12 -0.12 -0.11 -0.10 -0.09 -0.08 -0.07 -0.07 -0.04 -0.03 -0.01 0.01 -0.00 0.04 0.04 0.04 0.11 0.11 0.11 0.20 0.21 0.28 0.31 0.34 0.38 0.41 0.45 0.51 0.59 0.70 0.83 0.97 1.20 1.34 1.74 2.22 2.57 2.91 3.09 3.34 3.37 3.50 3.50 3.62 3.62 3.71 3.71
-0.52 -0.41 -0.29 -0.21 -0.16 -0.14 -0.15 -0.15 -0.15 -0.16 -0.16 -0.15 -0.14 -0.14 -0.13 -0.13 -0.12 -0.10 -0.09 -0.08 -0.07 -0.08 -0.10 -0.07 -0.10 -0.04 -0.06 -0.09 0.02 -0.00 -0.03 0.10 0.10 0.25 0.28 0.32 0.35 0.38 0.42 0.47 0.56 0.69 0.84 0.96 1.19 1.43 1.58 1.95 2.44 2.72 3.00 3.21 3.21 3.37 3.37 3.50 3.50 3.50 3.62
-0.67 -0.56 -0.45 -0.36 -0.27 -0.21 -0.18 -0.18 -0.17 -0.17 -0.17 -0.17 -0.17 -0.16 -0.15 -0.14 -0.13 -0.12 -0.12 -0.12 -0.13 -0.17 -0.20 -0.18 -0.23 -0.29 -0.20 -0.25 -0.30 -0.16 -0.20 -0.23 -0.06 0.09 0.25 0.28 0.31 0.33 0.39 0.45 0.54 0.65 0.81 1.02 1.24 1.49 1.58 1.93 2.21 2.44 2.86 2.87 3.04 3.21 3.21 3.37 3.37 3.37 3.50
-0.84 -0.73 -0.61 -0.50 -0.40 -0.32 -0.26 -0.22 -0.20 -0.20 -0.19 -0.18 -0.19 -0.18 -0.18 -0.17 -0.15 -0.14 -0.17 -0.20 -0.26 -0.28 -0.35 -0.43 -0.39 -0.46 -0.37 -0.43 -0.50 -0.34 -0.39 -0.44 -0.24 -0.28 0.14 0.21 0.23 0.24 0.26 0.37 0.53 0.71 0.84 1.08 1.28 1.53 1.75 1.81 2.06 2.25 2.46 2.67 2.87 2.87 3.04 3.21 3.21 3.21 3.37
-1.02 -0.91 -0.80 -0.67 -0.53 -0.42 -0.34 -0.28 -0.24 -0.23 -0.22 -0.21 -0.20 -0.20 -0.20 -0.19 -0.18 -0.21 -0.25 -0.31 -0.39 -0.43 -0.52 -0.60 -0.57 -0.65 -0.74 -0.62 -0.70 -0.77 -0.59 -0.65 -0.44 -0.49 -0.11 0.05 0.11 0.15 0.20 0.21 0.50 0.79 0.94 1.13 1.39 1.47 1.61 1.81 1.80 2.03 2.25 2.25 2.46 2.67 2.87 3.04 3.04 3.04 3.21
-1.21 -1.11 -0.99 -0.86 -0.73 -0.59 -0.44 -0.34 -0.28 -0.25 -0.23 -0.24 -0.23 -0.23 -0.21 -0.21 -0.24 -0.27 -0.35 -0.46 -0.55 -0.64 -0.69 -0.77 -0.89 -0.85 -0.94 -0.82 -0.89 -0.96 -0.80 -0.86 -0.92 -0.70 -0.47 -0.17 -0.07 0.12 0.18 0.25 0.35 0.69 0.93 1.03 1.21 1.20 1.38 1.57 1.56 1.78 2.02 2.02 2.25 2.46 2.67 2.67 2.87 3.04 3.04
-1.41 -1.31 -1.20 -1.08 -0.94 -0.80 -0.65 -0.50 -0.35 -0.28 -0.26 -0.24 -0.20 -0.20 -0.23 -0.24 -0.33 -0.29 -0.33 -0.50 -0.70 -0.82 -0.90 -0.87 -0.97 -1.12 -1.12 -1.21 -1.04 -1.10 -1.18 -1.03 -1.12 -0.89 -0.91 -0.43 -0.17 0.01 0.13 0.16 0.18 0.36 0.55 0.81 0.96 1.14 1.12 1.33 1.55 1.55 1.78 2.02 2.02 2.25 2.46 2.46 2.67 2.87 2.87
-1.62 -1.53 -1.42 -1.30 -1.17 -1.03 -0.88 -0.72 -0.58 -0.46 -0.35 -0.22 -0.17 -0.14 -0.17 -0.25 -0.30 -0.28 -0.29 -0.47 -0.72 -0.93 -1.00 -0.96 -1.06 -1.24 -1.23 -1.34 -1.18 -1.24 -1.33 -1.17 -1.26 -1.05 -1.07 -0.56 -0.29 -0.23 -0.09 -0.09 -0.08 0.06 0.26 0.38 0.71 0.68 0.88 1.09 1.32 1.32 1.55 1.78 1.78 2.02 2.25 2.25 2.46 2.67 2.67
-1.83 -1.75 -1.65 -1.54 -1.41 -1.26 -1.11 -0.96 -0.81 -0.67 -0.53 -0.37 -0.20 -0.09 -0.16 -0.27 -0.29 -0.26 -0.34 -0.53 -0.78 -1.00 -1.12 -1.21 -1.23 -1.39 -1.51 -1.46 -1.54 -1.40 -1.48 -1.32 -1.40 -1.45 -1.25 -1.03 -0.65 -0.58 -0.44 -0.42 -0.39 -0.23 -0.15 0.12 0.27 0.44 0.65 0.86 1.09 1.32 1.32 1.55 1.78 1.78 2.02 2.25 2.25 2.46 2.46
-2.05 -1.98 -1.88 -1.77 -1.65 -1.51 -1.36 -1.21 -1.04 -0.88 -0.73 -0.57 -0.41 -0.28 -0.20 -0.30 -0.40 -0.46 -0.53 -0.80 -0.95 -1.12 -1.29 -1.41 -1.53 -1.56 -1.65 -1.59 -1.65 -1.69 -1.60 -1.63 -1.52 -1.55 -1.41 -1.44 -1.08 -0.81 -0.75 -0.71 -0.56 -0.49 -0.39 -0.12 0.04 0.23 0.42 0.65 0.86 1.09 1.32 1.32 1.55 1.55 1.78 2.02 2.02 2.25 2.46
-2.26 -2.20 -2.11 -2.01 -1.89 -1.76 -1.61 -1.46 -1.30 -1.13 -0.97 -0.81 -0.66 -0.54 -0.48 -0.46 -0.64 -0.72 -0.84 -0.97 -1.22 -1.36 -1.49 -1.60 -1.69 -1.69 -1.74 -1.77 -1.71 -1.72 -1.65 -1.66 -1.59 -1.59 -1.50 -1.51 -1.24 -1.13 -0.92 -0.86 -0.79 -0.71 -0.60 -0.32 -0.15 0.03 0.23 0.42 0.65 0.86 1.09 1.09 1.32 1.55 1.55 1.78 2.02 2.02 2.25
-2.47 -2.42 -2.34 -2.24 -2.13 -2.00 -1.86 -1.71 -1.55 -1.39 -1.22 -1.05 -0.89 -0.82 -0.77 -0.75 -0.78 -1.00 -1.11 -1.23 -1.36 -1.55 -1.66 -1.73 -1.78 -1.82 -1.77 -1.77 -1.72 -1.72 -1.72 -1.66 -1.66 -1.59 -1.59 -1.52 -1.45 -1.24 -1.15 -1.06 -0.98 -0.76 -0.63 -0.48 -0.33 -0.15 0.23 0.23 0.42 0.65 0.86 1.09 1.09 1.32 1.55 1.55 1.78 1.78 2.02
-2.68 -2.63 -2.56 -2.48 -2.37 -2.25 -2.11 -1.96 -1.80 -1.64 -1.47 -1.31 -1.15 -1.03 -1.04 -1.03 -1.06 -1.11 -1.34 -1.45 -1.56 -1.66 -1.78 -1.84 -1.82 -1.82 -1.82 -1.77 -1.77 -1.72 -1.72 -1.66 -1.66 -1.59 -1.59 -1.52 -1.46 -1.39 -1.30 -1.11 -1.01 -0.90 -0.78 -0.64 -0.48 -0.33 0.03 0.23 0.23 0.42 0.65 0.86 1.09 1.09 1.32 1.32 1.55 1.78 1.78
-2.87 -2.84 -2.77 -2.70 -2.60 -2.48 -2.35 -2.20 -2.05 -1.89 -1.73 -1.56 -1.41 -1.29 -1.21 -1.28 -1.30 -1.35 -1.43 -1.62 -1.71 -1.79 -1.86 -1.87 -1.88 -1.82 -1.82 -1.77 -1.77 -1.77 -1.72 -1.72 -1.66 -1.66 -1.59 -1.52 -1.52 -1.46 -1.30 -1.22 -1.11 -1.01 -0.90 -0.64 -0.48 -0.33 -0.15 0.03 0.23 0.42 0.42 0.65 0.86 0.86 1.09 1.32 1.32 1.55 1.78
-3.06 -3.02 -2.97 -2.90 -2.81 -2.70 -2.58 -2.44 -2.29 -2.13 -1.97 -1.80 -1.66 -1.54 -1.46 -1.41 -1.40 -1.55 -1.61 -1.68 -1.82 -1.87 -1.91 -1.88 -1.88 -1.88 -1.82 -1.82 -1.77 -1.77 -1.72 -1.72 -1.66 -1.66 -1.59 -1.59 -1.52 -1.46 -1.39 -1.22 -1.11 -1.01 -0.90 -0.78 -0.64 -0.48 -0.33 -0.15 0.03 0.23 0.42 0.42 0.65 0.86 0.86 1.09 1.32 1.32 1.55
-3.22 -3.20 -3.17 -3.09 -3.01 -2.91 -2.79 -2.66 -2.51 -2.36 -2.20 -2.04 -1.88 -1.74 -1.68 -1.62 -1.60 -1.62 -1.75 -1.80 -1.86 -1.91 -1.93 -1.93 -1.88 -1.88 -1.88 -1.82 -1.82 -1.77 -1.77 -1.72 -1.72 -1.66 -1.59 -1.59 -1.52 -1.46 -1.39 -1.30 -1.22 -1.11 -1.01 -0.90 -0.78 -0.64 -0.48 -0.33 -0.15 0.03 0.23 0.42 0.42 0.65 0.86 0.86 1.09 1.09 1.32
-3.38 -3.36 -3.33 -3.27 -3.20 -3.10 -2.99 -2.86 -2.73 -2.57 -2.42 -2.26 -2.10 -1.95 -1.83 -1.79 -1.76 -1.77 -1.79 -1.88 -1.92 -1.95 -1.93 -1.93 -1.93 -1.88 -1.88 -1.82 -1.82 -1.77 -1.77 -1.72 -1.72 -1.66 -1.66 -1.59 -1.52 -1.52 -1.46 -1.30 -1.22 -1.11 -1.01 -0.90 -0.78 -0.64 -0.48 -0.33 -0.33 -0.15 0.03 0.23 0.42 0.42 0.65 0.86 0.86 1.09 1.09
-3.51 -3.51 -3.48 -3.44 -3.36 -3.27 -3.18 -3.05 -2.92 -2.77 -2.63 -2.45 -2.28 -2.13 -2.01 -1.91 -1.89 -1.88 -1.89 -1.92 -1.95 -1.97 -1.97 -1.93 -1.93 -1.93 -1.88 -1.88 -1.82 -1.82 -1.77 -1.77 -1.72 -1.72 -1.66 -1.59 -1.59 -1.52 -1.46 -1.39 -1.30 -1.22 -1.11 -1.01 -0.90 -0.78 -0.64 -0.48 -0.33 -0.15 -0.15 0.03 0.23 0.42 0.42 0.65 0.65 0.86 1.09
-3.63 -3.64 -3.62 -3.57 -3.52 -3.43 -3.33 -3.22 -3.10 -2.96 -2.81 -2.65 -2.50 -2.29 -2.15 -2.05 -1.98 -1.94 -1.95 -1.97 -1.99 -1.97 -1.97 -1.97 -1.93 -1.93 -1.93 -1.88 -1.88 -1.82 -1.82 -1.77 -1.77 -1.72 -1.66 -1.66 -1.59 -1.52 -1.46 -1.39 -1.30 -1.22 -1.11 -1.01 -0.90 -0.78 -0.64 -0.64 -0.48 -0.33 -0.15 0.03 0.03 0.23 0.42 0.42 0.65 0.65 0.86"""
_G_SLOPED = np.array([[float(v) for v in row.split()] for row in GROUND_ROWS.strip().split('\n')])
# The table above is the Etoile as the elevation data first read it: a 6 m tilt across the island. The
# paris route now levels the Etoile (`levelAreas`, 120 m round the Arc), so the finished ground under the
# model is flat at its datum and the paving covers the whole island instead of stopping at the low side.
# Kept for the record; the ground the model is built on is the level one.
_G = np.zeros_like(_G_SLOPED)


def ground(d, s):
    """Finished game ground relative to the model datum [GAME]; d = model u, s = model v (2 m grid over +-58 m)."""
    fu = min(max((d + 58.0) / 2.0, 0.0), _G.shape[0] - 1.001)
    fv = min(max((s + 58.0) / 2.0, 0.0), _G.shape[1] - 1.001)
    i, j = int(fu), int(fv)
    a, b = fu - i, fv - j
    return float((1 - a) * (1 - b) * _G[i, j] + a * (1 - b) * _G[i + 1, j] + (1 - a) * b * _G[i, j + 1] +
                 a * b * _G[i + 1, j + 1])


def tomb():
    XF[:] = [1, 1]
    box('Tomb of the Unknown Soldier (plain slab)', -.8, .8, PLAT - .02, PLAT + .06, -1.7, 1.7, 'granite')
    olathe('eternal flame burner', (0, PLAT, 2.15), (0, 1, 0), [(0, .5), (.1, .5), (.12, .4), (.22, .34), (.26, .08)],
           'bronze', sides=20)


def paving():
    """Granite setts over the island: they follow the finished ground and stop where it drops below the
    model datum (the Champs-Elysees side falls up to 1.9 m, which a model standing on its footprint cannot
    reach without hanging in the air)."""
    NT, NR = 200, 26
    RX, RZ = 24.7, 13.6
    T, B = [], []
    for j in range(NT):
        th = j * math.tau / NT
        c, s_ = math.cos(th), math.sin(th)
        r_in = min(RX / abs(c) if abs(c) > 1e-6 else 1e9, RZ / abs(s_) if abs(s_) > 1e-6 else 1e9)
        r = r_in
        while r < R_ISL:
            r2 = min(r + .25, R_ISL)
            if ground(r2 * s_, r2 * c) < -.12:
                break
            r = r2
        r_max = max(r, r_in + .6)
        for i in range(NR):
            rr = r_in + (r_max - r_in) * i / (NR - 1)
            g = ground(rr * s_, rr * c)
            top = max(g, 0.0) + .15
            T.append((rr * c, top, rr * s_))
            B.append((rr * c, min(max(g - .3, 0.0), top - .06), rr * s_))
    n = len(T)
    faces = []
    for j in range(NT):
        jn = (j + 1) % NT
        for i in range(NR - 1):
            a, b, cc, d = j * NR + i, j * NR + i + 1, jn * NR + i + 1, jn * NR + i
            faces += [(a, b, cc, d), (n + d, n + cc, n + b, n + a)]
        a, d = j * NR, jn * NR
        faces.append((a, d, n + d, n + a))
        a, d = j * NR + NR - 1, jn * NR + NR - 1
        faces.append((a, n + a, n + d, d))
    XF[:] = [1, 1]
    emit('island paving (granite setts)', T + B, faces, 'setts')


def bollards():
    """The ring of 100 granite bollards linked by chains round the monument [PH]."""
    OFF = 6.5
    L1, L2, arc = 2 * HS, 2 * HD, math.pi / 2 * OFF
    P = 2 * L1 + 2 * L2 + 4 * arc
    pts = []
    for k in range(100):
        q = k * P / 100
        for (sx0, dx0, sx1, dx1, cs, cd, a0) in (
                (-HS, HD + OFF, HS, HD + OFF, None, None, None), (None, None, None, None, HS, HD, math.pi / 2),
                (HS + OFF, HD, HS + OFF, -HD, None, None, None), (None, None, None, None, HS, -HD, 0.0),
                (HS, -HD - OFF, -HS, -HD - OFF, None, None, None), (None, None, None, None, -HS, -HD, -math.pi / 2),
                (-HS - OFF, -HD, -HS - OFF, HD, None, None, None), (None, None, None, None, -HS, HD, math.pi)):
            seg = arc if cs is not None else math.hypot(sx1 - sx0, dx1 - dx0)
            if q <= seg:
                if cs is None:
                    t = q / seg
                    pts.append((sx0 + (sx1 - sx0) * t, dx0 + (dx1 - dx0) * t))
                else:
                    a = a0 - q / OFF
                    pts.append((cs + OFF * math.cos(a), cd + OFF * math.sin(a)))
                break
            q -= seg
    tops = []
    for s, d in pts:
        yb = max(ground(d, s), 0.0) + .07
        olathe('granite bollard', (s, yb, d), (0, 1, 0),
               [(0, .24), (.1, .24), (.13, .2), (.75, .18), (.8, .21), (.87, .21), (.95, .13), (1.0, .03)],
               'granite', sides=8, smooth=False)
        tops.append((s, yb + .8, d))
    for i in range(len(tops)):
        a, b = np.array(tops[i]), np.array(tops[(i + 1) % len(tops)])
        chain = [tuple(a + (b - a) * t - np.array((0, .22 * 4 * t * (1 - t), 0))) for t in np.linspace(0, 1, 7)]
        tube('bollard chain', chain, .025, 'steel', 5)


# ---------------------------------------------------------------- assemble
platform()
body()
mouldings()
vaults()
arches()
groups()
pier_panels()
entablature()
attic()
tomb()
paving()
bollards()
XF[:] = [1, 1]
info = m.finish(directory=SCRATCH)
