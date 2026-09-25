"""Arch of Constantine (Arco di Costantino), Rome, dedicated AD 315 -- rebuilt from reference photos.

Sources for every number (full list in the modelling report):
  published: 21.0 m tall, 25.9 m wide, 7.4 m deep at the top; central arch 6.5 x 11.45 m, lateral arches 3.4 x 7.4 m.
  photo ref02 (south face, frontal, pixel grid): the vertical split, column / roundel / panel positions along the face.
  photo ref13 (west end, frontal): wall depth 6.3 m (end wall : attic cornice = 755 : 881 px, cornice = 7.4 m),
    columns 0.7 m in front of the wall, the west end's plaque, raised door and attic door.
  photos ref04 / ref07 / ref09 / ref12: Dacian statues on tall blocks, fluted pilasters, the porphyry field behind the
    roundels of the north face's west bay, the VOTIS band, modillion cornice.
Reliefs are carved height fields of figures (invented scenes, real placement and size). The dedicatory inscription
field, the VOTIS / SIC bands and the west-end plaque are blank: no text anywhere.

Author frame: s along the 25.9 m face (footprint long axis, +s = east), d through the depth (+d = north face,
towards the Colosseum), y up. Symmetric parts are authored for one quadrant and mirrored with XF.
The landmark is registered with levelGround (a level pad): the base stays flat at y = 0.
Run: Blender --background --python assets-src/landmarks/build_arch-of-constantine.py
"""
import math
import tempfile
import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'arch-of-constantine'
SCRATCH = (Path(tempfile.gettempdir()) / 'sr-landmarks' / 'arch-of-constantine')

# ---------------------------------------------------------------- dimensions (m)
HS = 12.95            # half width of the body: 25.9 m (published)
HD = 3.15             # half depth of the pier walls: 6.3 m (ref13; the 7.4 m published depth is the attic cornice)
C_R, C_SPR = 3.25, 8.20              # central arch: half span 3.25, crown 11.45 (published)
L_C, L_R, L_SPR = 8.15, 1.70, 5.70   # lateral arches: centre (ref02), half span, crown 7.40 (published)
INNER_PIER = (C_R, L_C - L_R)        # 3.25 .. 6.45
OUTER_PIER = (L_C + L_R, HS)         # 9.85 .. 12.95
COLS = (5.05, 11.90)                 # column axes along s (ref02)
COL_D = HD + 0.70                    # column axis depth (ref13)
PED_HW = 0.95                        # pedestal die half width; outer pedestals end 0.1 m short of the ends (ref01)
POD_TOP = 4.05                       # pedestal top (ref02)
SHAFT0, SHAFT1 = 4.50, 12.00
CAP0, CAP1 = 12.10, 13.10            # capital (ref02)
ENT_TOP = 15.20                      # main entablature 13.1 .. 15.2 (ref02)
ATT0, ATT_BASE_TOP, ATT_DIE_TOP, TOP = 15.18, 16.30, 19.90, 21.00   # attic (ref02; 21.0 published)
HDA, HSA = 3.08, HS - 0.05           # attic face, a few cm behind the wall face
PIL_HW, PIL_E = 0.45, 0.12           # fluted pilaster behind each column: half width, projection
RES_D0, RES_D1 = HD - 0.30, COL_D + 0.42   # entablature ressaut over each column
STAT_Y = 16.50                       # statue blocks 15.2 .. 16.5, figures 16.5 .. 19.5 (ref02, ref04)

m = Model(ID)
m.material('marble', (0.75, 0.69, 0.59), 0.0, 0.72, ID + '_marble')
m.material('grey', (0.71, 0.65, 0.55), 0.0, 0.80, ID + '_marble_grey')
m.material('giallo', (0.80, 0.69, 0.50), 0.0, 0.50, ID + '_marble_giallo')
m.material('carved', (0.73, 0.67, 0.57), 0.0, 0.82, ID + '_carved')
m.material('porphyry', (0.25, 0.10, 0.12), 0.0, 0.35, ID + '_marble_porphyry')
m.material('steel', (0.30, 0.32, 0.31), 0.0, 0.7, ID + '_steel')

XF = [1, 1]
DEF = [None]      


def emit(label, verts, faces, mat, smooth=False):
    sx, sd = XF
    if DEF[0]:
        verts = [DEF[0](p) for p in verts]
    m.mesh(label, [(sd * d, y, sx * s) for s, y, d in verts], faces, mat, smooth)


def stack(label, stations, mat, closed=False, smooth=False):
    """Loft equal-length section loops; open lofts are capped at both ends."""
    K, M = len(stations), len(stations[0])
    verts = [p for st in stations for p in st]
    faces = []
    for k in range(K if closed else K - 1):
        a, b = k * M, ((k + 1) % K) * M
        faces += [(a + j, a + (j + 1) % M, b + (j + 1) % M, b + j) for j in range(M)]
    if not closed:
        faces += [tuple(reversed(range(M))), tuple((K - 1) * M + j for j in range(M))]
    emit(label, verts, faces, mat, smooth)


def mblock(label, sc, dc, hs, hd, prof, mat):
    """Moulded rectangular block: prof = [(y, offset)], bottom to top."""
    st = []
    for y, o in prof:
        a, b = hs + o, hd + o
        st.append([(sc - a, y, dc - b), (sc + a, y, dc - b), (sc + a, y, dc + b), (sc - a, y, dc + b)])
    stack(label, st, mat)


def box(label, s0, s1, y0, y1, d0, d1, mat):
    mblock(label, (s0 + s1) / 2, (d0 + d1) / 2, abs(s1 - s0) / 2, abs(d1 - d0) / 2, [(y0, 0), (y1, 0)], mat)


def lathe(label, sc, dc, y0, prof, mat, sides=12, squash=1.0, smooth=True):
    st = [[(sc + r * math.cos(k * math.tau / sides), y0 + dy, dc + squash * r * math.sin(k * math.tau / sides))
           for k in range(sides)] for dy, r in prof]
    stack(label, st, mat, smooth=smooth)


def tube(label, pts, r, mat, sides=8):
    st = []
    for i, p in enumerate(pts):
        a, b = np.array(pts[max(0, i - 1)]), np.array(pts[min(len(pts) - 1, i + 1)])
        t = b - a
        t /= np.linalg.norm(t)
        o = np.array((0, 1, 0)) if abs(t[1]) < .9 else np.array((1, 0, 0))
        u = np.cross(t, o); u /= np.linalg.norm(u)
        v = np.cross(t, u)
        rr = r[i] if isinstance(r, (list, tuple)) else r
        st.append([tuple(np.array(p) + rr * (u * math.cos(j * math.tau / sides) + v * math.sin(j * math.tau / sides)))
                   for j in range(sides)])
    stack(label, st, mat, smooth=True)


def plate(label, rows, depth, mat, smooth=True):
    """Closed thin surface: a grid of points plus the same grid offset by `depth`."""
    nv, nu = len(rows), len(rows[0])
    front = [p for row in rows for p in row]
    back = [tuple(p[k] + depth[k] for k in range(3)) for p in front]
    n = len(front)
    faces = []
    for j in range(nv - 1):
        for i in range(nu - 1):
            a = j * nu + i; b = a + 1; c = a + nu + 1; d = a + nu
            faces += [(a, b, c, d), (n + d, n + c, n + b, n + a)]
    bd = list(range(nu)) + [j * nu + nu - 1 for j in range(1, nv)] + \
        [(nv - 1) * nu + i for i in range(nu - 2, -1, -1)] + [j * nu for j in range(nv - 2, 0, -1)]
    faces += [(a, b, n + b, n + a) for a, b in zip(bd, bd[1:] + bd[:1])]
    emit(label, front + back, faces, mat, smooth)


def _normals(P, closed, inside=None):
    ns = []
    segs = list(zip(P, P[1:] + (P[:1] if closed else [])))
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(P, P[1:] + P[:1]))
    for a, b in segs:
        t = (b - a) / np.linalg.norm(b - a)
        n = np.array((t[1], -t[0]))
        if closed:
            n = n if area > 0 else -n
        elif np.dot(n, (a + b) / 2 - np.array(inside)) < 0:
            n = -n
        ns.append(n)
    return ns


def sweep(label, path, inside, section, mat, closed=False):
    """Moulding along a plan polyline [(s, d)]; section [(e outward, y)]; mitred corners.
    closed=True: the path is a closed loop and the section a closed ring (no caps)."""
    P = [np.array(p, float) for p in path]
    ns = _normals(P, closed, inside)
    st = []
    for i, p in enumerate(P):
        if closed:
            n0, n1 = ns[i - 1], ns[i]
        else:
            n0, n1 = ns[max(0, i - 1)], ns[min(i, len(ns) - 1)]
        mv = n0 + n1
        mv = mv / np.dot(mv, n1)
        st.append([(p[0] + e * mv[0], y, p[1] + e * mv[1]) for e, y in section])
    stack(label, st, mat, closed=closed)


def arc_sweep(label, sc, ys, section, n, mat, D=None, th0=0.0, th1=math.pi):
    """Section swept round a horizontal-axis arc. D given: face moulding, section [(r, e)] at depth D+e.
    D None: vault rib, section [(r, d)]."""
    st = []
    for k in range(n + 1):
        th = th0 + (th1 - th0) * k / n
        c, s_ = math.cos(th), math.sin(th)
        st.append([(sc + r * c, ys + r * s_, (D + e) if D is not None else e) for r, e in section])
    stack(label, st, mat)


# ---------------------------------------------------------------- relief height fields
class Relief:
    def __init__(self):
        self.blobs = []

    def add(self, cx, cy, rx, ry, ang, d):
        self.blobs.append((cx, cy, rx, ry, ang, d))

    def h(self, X, Y):
        H = np.zeros_like(X)
        for cx, cy, rx, ry, a, d in self.blobs:
            dx, dy = X - cx, Y - cy
            c, s = math.cos(a), math.sin(a)
            u = (dx * c + dy * s) / rx
            v = (-dx * s + dy * c) / ry
            q = u * u + v * v            # flat-topped figures with steep edges read as carving, not as bumps
            H = np.maximum(H, d * np.sqrt(np.clip(1 - q ** 3, 0, None)))
        return H


def person(R, x, y0, fh, d, rng):
    lean = rng.uniform(-.1, .1)
    R.add(x + lean * fh, y0 + .905 * fh, .062 * fh, .072 * fh, 0, d)
    R.add(x + lean * .65 * fh, y0 + .67 * fh, .115 * fh, .165 * fh, -lean, d * .9)
    R.add(x + lean * .35 * fh, y0 + .44 * fh, .13 * fh, .11 * fh, 0, d * .8)
    for sd in (-1, 1):
        R.add(x + sd * .05 * fh, y0 + .21 * fh, .045 * fh, .21 * fh, sd * .07, d * .7)
    up = rng.random() < .35
    R.add(x + .15 * fh + lean * .5 * fh, y0 + (.8 if up else .6) * fh, .04 * fh, .15 * fh, -.6 if up else .25, d * .75)
    R.add(x - .15 * fh + lean * .5 * fh, y0 + .6 * fh, .04 * fh, .15 * fh, -.2, d * .75)


def horse(R, x, y0, fh, d, f):
    R.add(x, y0 + .55 * fh, .30 * fh, .14 * fh, 0, d)
    R.add(x + f * .30 * fh, y0 + .72 * fh, .07 * fh, .16 * fh, -f * .6, d * .9)
    R.add(x + f * .41 * fh, y0 + .84 * fh, .10 * fh, .05 * fh, -f * .3, d * .85)
    for lx in (-.22, -.13, .15, .24):
        R.add(x + f * lx * fh, y0 + .22 * fh, .032 * fh, .22 * fh, 0, d * .7)
    R.add(x - f * .33 * fh, y0 + .45 * fh, .03 * fh, .14 * fh, f * .4, d * .6)


def crowd(R, x0, x1, y0, fh, d, rng, horses=0.0):
    x = x0 + .3 * fh
    while x < x1 - .3 * fh:
        person(R, x, y0 + .06 * fh, fh * .92, d * .5, rng)
        x += rng.uniform(.3, .4) * fh
    x = x0 + .18 * fh
    while x < x1 - .18 * fh:
        if rng.random() < horses and x + .7 * fh < x1:
            f = rng.choice((-1, 1))
            horse(R, x + .35 * fh, y0, fh * .85, d, f)
            person(R, x + .35 * fh, y0 + .38 * fh, fh * .62, d * 1.1, rng)
            x += .8 * fh
        else:
            person(R, x, y0, fh, d, rng)
            x += rng.uniform(.26, .36) * fh


def victory(R, x, y, L, d, f):
    """Flying Victory: diagonal body, spread wings, trailing drapery, arm with a trophy."""
    R.add(x, y, .13 * L, .40 * L, f * 1.05, d)
    R.add(x + f * .30 * L, y + .20 * L, .07 * L, .08 * L, 0, d)
    R.add(x - f * .02 * L, y + .28 * L, .38 * L, .12 * L, f * .45, d * .6)
    R.add(x - f * .12 * L, y + .38 * L, .30 * L, .08 * L, f * .75, d * .5)
    R.add(x + f * .45 * L, y + .02 * L, .05 * L, .26 * L, f * 1.2, d * .7)
    R.add(x - f * .40 * L, y - .22 * L, .07 * L, .30 * L, f * 1.3, d * .7)
    R.add(x - f * .55 * L, y - .30 * L, .16 * L, .07 * L, f * .2, d * .45)


def reclining(R, x, y, L, d, f):
    R.add(x, y + .12 * L, .42 * L, .12 * L, f * .12, d)
    R.add(x + f * .38 * L, y + .30 * L, .08 * L, .09 * L, 0, d)
    R.add(x - f * .18 * L, y + .20 * L, .07 * L, .18 * L, f * .7, d * .8)
    R.add(x + f * .5 * L, y + .12 * L, .09 * L, .10 * L, 0, d * .7)


def relief_slab(label, face, mapping, nu, nv, R, base, back, mat):
    A, B = np.linspace(0, 1, nu), np.linspace(0, 1, nv)
    X = np.zeros((nv, nu)); Y = np.zeros((nv, nu))
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


def disk_map(cx, cy, r):
    def f(a, b):
        u, v = 2 * a - 1, 2 * b - 1
        return cx + r * u * math.sqrt(1 - v * v / 2), cy + r * v * math.sqrt(1 - u * u / 2)
    return f


def face_d(D):          # plane d = D, outward +d, x = s
    return lambda x, y, e: (x, y, D + e)


def face_s(S, sign=1):  # plane s = S, outward sign*s, x = d
    return lambda x, y, e: (S + sign * e, y, x)


def panel(label, face, x0, x1, y0, y1, dens, R, base=0.03, back=0.15):
    nu = max(4, int((x1 - x0) * dens) + 1)
    nv = max(4, int((y1 - y0) * dens) + 1)
    relief_slab(label, face, rect_map(x0, x1, y0, y1), nu, nv, R, base, back, 'carved')


def frame(label, face, x0, x1, y0, y1, w, e, mat='marble'):
    """Raised rectangular moulded frame round a panel: an outer band and a lower inner lip."""
    for xa, xb, ya, yb, ww, ee in ((x0 - w, x1 + w, y0 - w, y1 + w, w, e), (x0, x1, y0, y1, w * .45, e * .55)):
        bars = [(xa, xb, ya, ya + ww), (xa, xb, yb - ww, yb), (xa, xa + ww, ya + ww, yb - ww),
                (xb - ww, xb, ya + ww, yb - ww)]
        for p0, p1, q0, q1 in bars:
            lo = [face(p0, q0, -.05), face(p1, q0, -.05), face(p1, q0, ee), face(p0, q0, ee)]
            hi = [face(p0, q1, -.05), face(p1, q1, -.05), face(p1, q1, ee), face(p0, q1, ee)]
            stack(label, [lo, hi], mat)


def slab(label, face, x0, x1, y0, y1, e0, e1, mat):
    lo = [face(x0, y0, e0), face(x1, y0, e0), face(x1, y0, e1), face(x0, y0, e1)]
    hi = [face(x0, y1, e0), face(x1, y1, e0), face(x1, y1, e1), face(x0, y1, e1)]
    stack(label, [lo, hi], mat)


def tondo(label, face, cx, cy, r, rng, dens=11):
    R = Relief()
    fh = 1.3 * r
    y0 = cy - .72 * r
    horse(R, cx - .15 * r, y0, fh, .20, rng.choice((-1, 1)))
    person(R, cx - .15 * r, y0 + .38 * fh, fh * .62, .21, rng)
    for x in (cx + .55 * r, cx - .7 * r):
        person(R, x, y0 - .05 * r, fh * .9, .17, rng)
    R.add(cx + .2 * r, cy + .55 * r, .35 * r, .22 * r, 0, .07)   # tree crown / background
    n = max(8, int(2 * r * dens))
    relief_slab(label, face, disk_map(cx, cy, r), n, n, R, .06, .12, 'carved')
    sec = [(r - .03, -.05), (r - .03, .14), (r + .06, .19), (r + .14, .15), (r + .17, -.05)]
    st = [[face(cx + rr * math.cos(t), cy + rr * math.sin(t), e) for rr, e in sec]
          for t in np.linspace(0, math.tau, 32, endpoint=False)]
    stack(label + ' frame', st, 'marble', closed=True)


# ---------------------------------------------------------------- the body
def arc_pts(c, ys, r, n):
    return [(c + r * math.cos(math.pi - math.pi * k / n), ys + r * math.sin(math.pi - math.pi * k / n))
            for k in range(n + 1)]


def body():
    """Piers, spandrels and the three barrel-vaulted passages, open right through (6.3 m deep)."""
    o = [(-HS, 0.0), (-L_C - L_R, 0.0)] + arc_pts(-L_C, L_SPR, L_R, 16)
    o += [(-L_C + L_R, 0.0), (-C_R, 0.0)] + arc_pts(0, C_SPR, C_R, 32) + [(C_R, 0.0), (L_C - L_R, 0.0)]
    o += arc_pts(L_C, L_SPR, L_R, 16) + [(L_C + L_R, 0.0), (HS, 0.0), (HS, CAP1), (-HS, CAP1)]
    stack('piers, spandrels and passage vaults', [[(s, y, -HD) for s, y in o], [(s, y, HD) for s, y in o]], 'grey')


# main entablature: 3-fascia architrave, frieze, dentil band, modillion band, corona, cyma (ref04, ref13)
ENT = [(13.10, .03), (13.30, .03), (13.30, .06), (13.52, .06), (13.52, .09), (13.72, .09), (13.80, .16),
       (13.80, .05), (14.30, .05), (14.40, .12), (14.58, .12), (14.66, .30), (14.86, .30), (14.86, .85),
       (15.06, .85), (15.14, .93), (ENT_TOP, .93)]
PODIUM = [(0, .12), (.48, .12), (.54, .08), (.64, .06), (.72, .03), (.84, .03)]
PEDESTAL = [(0, .16), (.55, .16), (.62, .12), (.72, .09), (.80, .05), (.92, .02), (3.40, .02), (3.46, .06),
            (3.56, .10), (3.68, .14), (3.82, .18), (POD_TOP, .18)]
ATT_BASE = [(-.35, ATT0), (.12, ATT0), (.12, 15.40), (.06, 15.46), (.03, 15.54), (.03, 16.22), (.07, 16.26),
            (.07, ATT_BASE_TOP), (-.35, ATT_BASE_TOP)]            # (e, y) ring section for the attic base sweep
ATT_CORN = [(ATT_DIE_TOP - .02, .03), (19.98, .06), (20.06, .12), (20.16, .20), (20.26, .34), (20.52, .34),
            (20.60, .40), (20.70, .42), (20.70, -.25), (TOP, -.25)]
# Blocks that overlap another block's exposed top sit a few centimetres lower so no two exposed faces share a
# plane (coplanar faces z-fight in the game and render black in Cycles).
ENT_RES = [(ENT[0][0] - .02, ENT[0][1])] + [(y - .02, o) for y, o in ENT[1:]]
ATT_CORN_RES = [ATT_CORN[0]] + [(y - .03, o) for y, o in ATT_CORN[1:-2]]


def cornice_items(label, p0, p1, n, skip=(), dentil=True, modillion=True):
    """Dentils and modillions along a straight cornice run whose face line goes from p0 to p1 (plan s, d),
    sticking out along the outward normal n. skip = s or d intervals (along the run axis) left empty."""
    p0, p1, n = np.array(p0, float), np.array(p1, float), np.array(n, float)
    L = np.linalg.norm(p1 - p0)
    t = (p1 - p0) / L
    ax = 0 if abs(t[0]) > .5 else 1

    def ok(c):
        return not any(a <= c[ax] <= b for a, b in skip)

    if dentil:
        k = int(L / .17)
        for i in range(k):
            c = p0 + t * ((L - (k - 1) * .17) / 2 + i * .17)
            if ok(c):
                q = [c - t * .045 + n * .10, c + t * .045 + n * .10, c + t * .045 + n * .26, c - t * .045 + n * .26]
                stack(label + ' dentil', [[(p[0], 14.40, p[1]) for p in q], [(p[0], 14.58, p[1]) for p in q]], 'marble')
    if modillion:
        side = [(.28, 14.60), (.46, 14.64), (.66, 14.71), (.80, 14.76), (.82, 14.88), (.28, 14.88)]
        k = int(L / .55)
        for i in range(k):
            c = p0 + t * ((L - (k - 1) * .55) / 2 + i * .55)
            if ok(c):
                st = [[(c[0] + t[0] * w + n[0] * e, y, c[1] + t[1] * w + n[1] * e) for e, y in side]
                      for w in (-.08, .08)]
                stack(label + ' modillion', st, 'marble')


def entablature_and_attic():
    mblock('main entablature', 0, 0, HS, HD, ENT, 'marble')
    # long faces: skip the stretches hidden inside the ressauts
    skip = []
    for c in COLS:
        for sx in (-1, 1):
            a, b = sorted((sx * (c - .72), sx * (c + .72 if c < 11 else HS + 2)))
            skip.append((a, b))
    for sd in (-1, 1):
        XF[:] = [1, sd]
        cornice_items('main cornice', (-HS, HD), (HS, HD), (0, 1), skip)
    for sx in (-1, 1):
        XF[:] = [sx, 1]
        cornice_items('main cornice', (HS, -(RES_D0 - .05)), (HS, RES_D0 - .05), (1, 0))
    XF[:] = [1, 1]
    # attic base: a moulded ring swept round the attic, with the door to the internal stair cut into the west end
    # (ref01, ref13: 0.6 m wide, 0.9 m north of the end's centre line, under the Trajanic panel)
    door = (.63, 1.23)
    path = [(-HSA, -HDA), (HSA, -HDA), (HSA, HDA), (-HSA, HDA), (-HSA, door[1]), (-HSA + .6, door[1]),
            (-HSA + .6, door[0]), (-HSA, door[0])]
    sweep('attic base', path, None, ATT_BASE, 'marble', closed=True)
    box('attic die', -HSA, HSA, ATT_BASE_TOP - .02, ATT_DIE_TOP, -HDA, HDA, 'marble')
    mblock('attic cornice', 0, 0, HSA, HDA, ATT_CORN, 'marble')


# ---------------------------------------------------------------- column order (one quadrant)
def fluted_ring(sc, dc, y, r, fd, nfl=24):
    pts = []
    for i in range(nfl):
        for f, k in ((0, 0), (.25, .7), (.5, 1), (.75, .7)):
            a = (i + f) * math.tau / nfl
            rr = r - fd * k
            pts.append((sc + rr * math.cos(a), y, dc + rr * math.sin(a)))
    return pts


K, KV = .95, .91      # capital scaled to the 0.39 m top radius and 1.0 m height seen in ref02


def capital(sc, dc):
    y0 = CAP0
    lathe('capital bell', sc, dc, y0, [(0, .41 * K), (.90 * KV, .47 * K)], 'marble', sides=16)
    a, sag = .66 * K, .09 * K        # abacus: concave-sided square with clipped corners
    outline = []
    for q in range(4):
        ang0 = q * math.pi / 2
        for k in range(7):
            t = k / 6
            x = -a + 2 * a * t
            y = a - sag * math.sin(math.pi * t)
            if k in (0, 6):
                x = x * .93
            ca, sa = math.cos(ang0), math.sin(ang0)
            outline.append((x * ca - y * sa, x * sa + y * ca))
    for y_, e in ((.90 * KV, 0), (1.0 * KV, .03)):
        st = [[(sc + (x * (1 + e)), y0 + y_ + yy, dc + z * (1 + e)) for x, z in outline] for yy in (0, .1 * KV)]
        stack('capital abacus', st, 'marble')
    box('capital fleuron', sc - .07, sc + .07, y0 + .93 * KV, y0 + 1.08 * KV, dc + .55 * K, dc + .66 * K, 'marble')
    for row, (off, hL, wmax, curl, base) in enumerate(((0, .42, .17, .10, 0), (math.pi / 8, .74, .16, .15, .02))):
        for k in range(8):
            phi = off + k * math.pi / 4
            dr, tg = np.array((math.cos(phi), math.sin(phi))), np.array((-math.sin(phi), math.cos(phi)))
            rows = []
            for j in range(5):
                t = j / 4
                yl = base + hL * t - .07 * max(0, t - .7) / .3
                rb = .41 + .06 * yl / .9
                hw = wmax * (.55 + .45 * math.sin(math.pi * min(t, .9))) * (1 - .85 * t ** 4)
                row_ = []
                for i in range(4):
                    w = -1 + i * 2 / 3
                    r = rb + .012 + curl * t ** 2.5 + .02 * (1 - abs(w)) + .012 * (j % 2) * abs(w)
                    p = np.array((sc, dc)) + (dr * r + tg * w * hw) * K
                    row_.append((p[0], y0 + yl * KV, p[1]))
                rows.append(row_)
            plate('acanthus leaf', rows, (-.03 * dr[0], 0, -.03 * dr[1]), 'marble')
    for q in range(4):                     # corner volutes under the abacus points
        phi = math.pi / 4 + q * math.pi / 2
        dr = np.array((math.cos(phi), math.sin(phi)))
        pts = []
        for k in range(11):
            t = k / 10
            if t < .35:
                r, y = .45 + .6 * t, .55 + .9 * t
            else:
                u = (t - .35) / .65 * 1.5 * math.tau
                rad = .085 * (1 - .75 * (t - .35) / .65)
                r, y = .66 + rad * math.sin(u), .80 + rad * math.cos(u) + .06
            p = np.array((sc, dc)) + dr * r * K
            pts.append((p[0], y0 + y * KV, p[1]))
        tube('capital volute', pts, .03, 'marble', 6)
    for q in range(4):                     # inner helices at the middle of each face
        phi = q * math.pi / 2
        dr, tg = np.array((math.cos(phi), math.sin(phi))), np.array((-math.sin(phi), math.cos(phi)))
        for sgn in (-1, 1):
            pts = []
            for k in range(6):
                t = k / 5
                p = np.array((sc, dc)) + (dr * (.46 + .06 * t) + tg * sgn * (.04 + .12 * t)) * K
                pts.append((p[0], y0 + (.6 + .28 * t - .06 * t ** 3) * KV, p[1]))
            tube('capital helix', pts, .021, 'marble', 5)


def fluted_pilaster(c):
    """Fluted pilaster on the wall behind the column (ref07, ref09, ref12): 7 flutes, base and capital."""
    front = HD + PIL_E
    pts = [(c - PIL_HW, HD - .05), (c - PIL_HW, front)]
    wf = (2 * PIL_HW - .14) / 7
    for i in range(7):
        xa = c - PIL_HW + .07 + i * wf
        pts += [(xa + .012, front), (xa + .03, front - .028), (xa + wf / 2, front - .038),
                (xa + wf - .03, front - .028), (xa + wf - .012, front)]
    pts += [(c + PIL_HW, front), (c + PIL_HW, HD - .05)]
    stack('fluted pilaster', [[(s, y, d) for s, d in pts] for y in (POD_TOP + .30, CAP0)], 'marble')
    mblock('pilaster base', c, HD, PIL_HW, PIL_E, [(POD_TOP - .02, .08), (POD_TOP + .12, .08), (POD_TOP + .18, .04),
                                                    (POD_TOP + .32, .01)], 'marble')
    mblock('pilaster capital', c, HD, PIL_HW, PIL_E, [(CAP0 - .02, .0), (CAP0 + .08, .03), (12.72, .07),
                                                      (12.78, .11), (CAP1 - .02, .11)], 'marble')
    for x in (-.28, 0, .28):               # a row of acanthus on the pilaster capital
        rows = [[(c + x + w * (.13 - .05 * t), CAP0 + .06 + .55 * t, front + .01 + .06 * t * t) for w in (-1, 0, 1)]
                for t in (0, .35, .7, 1)]
        plate('pilaster capital leaf', rows, (0, 0, -.03), 'marble')


def column(c, rng, outer):
    dc = COL_D
    mblock('column pedestal', c, dc, PED_HW, PED_HW, PEDESTAL, 'marble')
    box('column plinth', c - .62, c + .62, POD_TOP - .01, POD_TOP + .15, dc - .62, dc + .62, 'marble')
    lathe('attic base', c, dc, POD_TOP + .15, [(0, .58), (.08, .61), (.12, .58), (.16, .52), (.22, .51),
                                                (.25, .54), (.30, .53), (.35, .48)], 'marble', sides=24)
    ys = [SHAFT0, SHAFT0 + .12, 7.0, 9.0, 10.8, SHAFT1]
    rs = [.47, .46, .455, .44, .415, .39]
    fds = [0, .034, .034, .033, .031, 0]
    stack('fluted giallo antico shaft', [fluted_ring(c, dc, y, r, f) for y, r, f in zip(ys, rs, fds)], 'giallo',
          smooth=True)
    lathe('astragal', c, dc, SHAFT1 - .02, [(0, .40), (.04, .43), (.08, .43), (.12, .40)], 'marble', sides=16)
    capital(c, dc)
    fluted_pilaster(c)
    # entablature ressaut over the column; the outer ones run out to the end face (ref13)
    s0, s1 = c - .62, (HS + .02 if outer else c + .62)
    mblock('entablature ressaut', (s0 + s1) / 2, (RES_D0 + RES_D1) / 2, (s1 - s0) / 2, (RES_D1 - RES_D0) / 2,
           ENT_RES, 'marble')
    cornice_items('ressaut cornice', (s0 - .05, RES_D1), (s1 + .05, RES_D1), (0, 1))
    cornice_items('ressaut cornice', (s0, HD + .98), (s0, RES_D1 + .05), (-1, 0))
    if outer:
        cornice_items('ressaut cornice', (s1, RES_D0 - .05), (s1, RES_D1 + .05), (1, 0))
    else:
        cornice_items('ressaut cornice', (s1, HD + .98), (s1, RES_D1 + .05), (1, 0))
    # attic pilaster behind the statue, with the attic cornice breaking forward over it (ref04)
    a0, a1 = c - .6, (HSA + .02 if outer else c + .6)
    box('attic pilaster', a0, a1, ATT0, ATT_DIE_TOP, HDA - .1, HDA + .30, 'marble')
    mblock('attic cornice ressaut', (a0 + a1) / 2, HDA + .05, (a1 - a0) / 2, .25, ATT_CORN_RES, 'marble')
    # statue block on the ressaut and the Dacian captive on it (ref02, ref04)
    mblock('statue block', c, 3.82, .65, .70, [(ENT_TOP - .04, .07), (15.34, .07), (15.40, .01), (16.30, .01),
                                               (16.36, .05), (16.44, .08), (STAT_Y, .08)], 'marble')
    dacian(c, 3.92, STAT_Y, rng)


def _body_r(y):
    prof = [(0.85, .34), (1.05, .33), (1.3, .29), (1.52, .265), (1.56, .285), (1.62, .285), (1.66, .27), (1.95, .31),
            (2.2, .34), (2.32, .33), (2.40, .24), (2.46, .12)]
    return float(np.interp(y, [p[0] for p in prof], [p[1] for p in prof])), prof


def dacian(sc, dc, y0, rng):
    """Captive Dacian, 3.0 m (ref04): boots, trousers, knee-length belted tunic, cloak over the shoulders and down
    the back, a fold over the left shoulder, hands crossed in front, bowed bearded head, long hair, soft cap."""
    def P(x, y, z):
        return (sc + x, y0 + y, dc + z)
    SQ = .68
    DEF[0] = lambda p: (sc + (p[0] - sc) * 1.22, p[1], dc + (p[2] - dc) * 1.15)   # chunkier figure (ref04)
    box('statue plinth', sc - .38, sc + .38, y0 - .02, y0 + .1, dc - .32, dc + .32, 'carved')
    for x in (-.13, .13):
        box('boot', sc + x - .07, sc + x + .07, y0 + .1, y0 + .2, dc - .08, dc + .17, 'carved')
        lathe('trouser leg', sc + x, dc + .01, y0 + .17, [(0, .09), (.3, .115), (.65, .13), (.95, .14)], 'carved',
              sides=10)
    _, prof = _body_r(1.0)
    lathe('tunic', sc, dc, y0, prof, 'carved', sides=18, squash=SQ)
    lathe('belt', sc, dc, y0 + 1.52, [(0, .272), (.02, .29), (.10, .29), (.12, .272)], 'carved', sides=18, squash=SQ)
    rows = []                                   # cloak down the back, a little wider than the body
    for j in range(8):
        t = j / 7
        y = 2.38 - 1.45 * t
        rows.append([P(w * (.37 + .08 * t), y, -(.235 + .075 * (1 - w * w)) - .04 * t - .03 * math.sin(7 * w) * t)
                     for w in np.linspace(-1, 1, 9)])
    plate('cloak', rows, (0, 0, .04), 'carved')
    rows = []                                   # fold over the left shoulder, lying on the front of the body
    for j in range(7):
        t = j / 6
        y = 2.34 - 1.32 * t
        rb, _ = _body_r(y)
        row = []
        for w in np.linspace(0, 1, 4):
            x = -(.40 - .20 * w) + .03 * t
            z = SQ * math.sqrt(max(0.0, (rb + .03) ** 2 - x * x)) + .03
            row.append(P(x, y, z))
        rows.append(row)
    plate('cloak fold', rows, (0, 0, -.04), 'carved')
    for sgn in (-1, 1):
        tube('arm', [P(sgn * .36, 2.24, 0), P(sgn * .38, 1.98, .03), P(sgn * .33, 1.76, .14),
                     P(sgn * .12, 1.64, .27), P(-sgn * .04, 1.60, .30)], [.095, .09, .08, .07, .06], 'carved', 8)
    lathe('crossed hands', sc, dc + .29, y0 + 1.53, [(0, .05), (.06, .09), (.14, .05)], 'carved', sides=10, squash=.8)
    lathe('neck', sc, dc + .03, y0 + 2.40, [(0, .08), (.14, .075)], 'carved', sides=10)
    lathe('head', sc, dc + .08, y0 + 2.49, [(0, .05), (.05, .105), (.13, .125), (.22, .12), (.28, .07), (.30, .02)],
          'carved', sides=12, squash=.95)
    lathe('long hair', sc, dc + .01, y0 + 2.36, [(0, .10), (.12, .14), (.26, .135), (.34, .06)], 'carved', sides=12,
          squash=.85)
    lathe('beard', sc, dc + .17, y0 + 2.38, [(0, .03), (.06, .085), (.16, .09), (.21, .05)], 'carved', sides=10,
          squash=.6)
    lathe('soft cap', sc, dc + .07, y0 + 2.70, [(0, .14), (.07, .135), (.15, .10), (.22, .05), (.26, .01)], 'carved',
          sides=12)
    lathe('cap tip', sc, dc + .15, y0 + 2.86, [(0, .06), (.05, .05), (.09, .01)], 'carved', sides=8)
    DEF[0] = None


# ---------------------------------------------------------------- arches, imposts, vaults
def archivolt(label, sc, ys, R, D, n, w):
    sec = [(R - .02, -.05), (R - .02, .06), (R + .3 * w, .08), (R + .3 * w, .11), (R + .75 * w, .11),
           (R + .8 * w, .15), (R + w, .15), (R + w + .05, .07), (R + w + .05, -.05)]
    arc_sweep(label, sc, ys, sec, n, 'marble', D=D)


def keystone(sc, y0, y1, w0, w1, e, D, rng):
    """Projecting console keystone with a standing figure on its face (ref09, ref10)."""
    o = [(sc - w0, y0), (sc + w0, y0), (sc + w1, y1), (sc - w1, y1)]
    stack('keystone', [[(x, y, D - .05) for x, y in o], [(x, y, D + e) for x, y in o]], 'marble')
    box('keystone cap', sc - w1 - .05, sc + w1 + .05, y1 - .08, y1, D - .05, D + e + .06, 'marble')
    R = Relief()
    person(R, sc, y0 + .05, (y1 - y0) * .85, .10, rng)
    relief_slab('keystone figure', face_d(D + e), rect_map(sc - w0 * .8, sc + w0 * .8, y0 + .04, y1 - .1),
                6, 9, R, .0, .03, 'carved')


def impost(label, pier, ys, arch_side, big):
    """Impost cornice round the pier face that carries an arch: front, through the passage, back."""
    s0, s1 = pier
    edge = s0 if arch_side < 0 else s1
    col = min(COLS, key=lambda c: abs(c - (s0 + s1) / 2))
    far = col - PIL_HW if arch_side < 0 else col + PIL_HW
    path = [(far, HD), (edge, HD), (edge, -HD), (far, -HD)]
    if big:        # the central arch's heavy impost cornice (ref10)
        sec = [(-.1, ys - .62), (.04, ys - .62), (.06, ys - .52), (.12, ys - .44), (.14, ys - .30), (.20, ys - .22),
               (.26, ys - .10), (.30, ys - .04), (.30, ys), (-.1, ys)]
    else:
        sec = [(-.1, ys - .4), (.04, ys - .4), (.06, ys - .3), (.10, ys - .22), (.14, ys - .08), (.17, ys), (-.1, ys)]
    sweep(label, path, ((s0 + s1) / 2, 0), sec, 'marble')


def vault_ribs(label, sc, ys, R, ntr, nlong):
    for k in range(ntr):
        d = -HD + .1 + k * (2 * HD - .2) / (ntr - 1)
        arc_sweep(label, sc, ys, [(R + .05, d - .07), (R - .11, d - .07), (R - .11, d + .07), (R + .05, d + .07)],
                  24, 'marble')
    for k in range(1, nlong):
        th = math.pi * k / nlong
        dt = .07 / R
        q = [(R + .05, th - dt), (R - .11, th - dt), (R - .11, th + dt), (R + .05, th + dt)]
        st = [[(sc + r * math.cos(t), ys + r * math.sin(t), d) for r, t in q] for d in (-HD + .1, HD - .1)]
        stack(label, st, 'marble')


# ---------------------------------------------------------------- assemble
body()
entablature_and_attic()

for sx in (-1, 1):
    XF[:] = [sx, 1]
    rng = random.Random(10 + sx)
    mblock('inner pier podium', sum(INNER_PIER) / 2, 0, (INNER_PIER[1] - INNER_PIER[0]) / 2, HD, PODIUM, 'grey')
    mblock('outer pier podium', sum(OUTER_PIER) / 2, 0, (OUTER_PIER[1] - OUTER_PIER[0]) / 2, HD, PODIUM, 'grey')
    impost('central impost', INNER_PIER, C_SPR, -1, True)
    impost('lateral impost', INNER_PIER, L_SPR, +1, False)
    impost('lateral impost', OUTER_PIER, L_SPR, -1, False)
    vault_ribs('lateral vault coffers', L_C, L_SPR, L_R, 7, 6)
    # Trajanic frieze on the central passage wall (pier face s = C_R, facing the passage), blank band above
    R = Relief()
    crowd(R, -1.9, 1.9, 3.5, 3.1, .26, rng, horses=.35)
    panel('great Trajanic frieze, passage', face_s(C_R, -1), -1.9, 1.9, 3.45, 6.9, 12, R)
    frame('passage panel frame', face_s(C_R, -1), -1.9, 1.9, 3.45, 6.9, .14, .12)
    slab('passage title band (blank)', face_s(C_R, -1), -1.6, 1.6, 7.08, 7.52, -.05, .05, 'marble')
    # east / west end: string course at the lateral imposts, Constantinian frieze, Sol / Luna roundel,
    # Trajanic panel on the attic (ref11, ref13)
    sweep('end string course', [(COLS[1] + PIL_HW, HD), (HS, HD), (HS, -HD), (COLS[1] + PIL_HW, -HD)], (0, 0),
          [(-.1, L_SPR - .36), (.04, L_SPR - .36), (.07, L_SPR - .26), (.12, L_SPR - .12), (.15, L_SPR),
           (-.1, L_SPR)], 'marble')
    R = Relief()
    crowd(R, -HD + .05, HD - .05, 7.97, .82, .12, rng, horses=.15)
    panel('Constantinian frieze, end', face_s(HS), -HD + .05, HD - .05, 7.95, 8.95, 20, R, base=.04)
    for yb in (7.87, 8.95):
        box('frieze border', HS - .05, HS + .1, yb, yb + .08, -HD, HD, 'marble')
    tondo('end roundel', face_s(HS), 0, 10.2, 1.07, rng)
    R = Relief()
    crowd(R, -2.1, 2.1, 16.7, 2.7, .30, rng, horses=.4)
    panel('great Trajanic frieze, attic end', face_s(HSA), -2.1, 2.1, 16.6, 19.5, 12, R)
    frame('attic end frame', face_s(HSA), -2.1, 2.1, 16.6, 19.5, .16, .12)

# west end only: the plaque (blank) and the raised door to the internal stair, framed, under the frieze (ref13)
XF[:] = [1, 1]
W = face_s(-HS, -1)
frame('west plaque frame', W, .60, 1.60, 5.95, 7.70, .12, .12)
slab('west plaque (blank)', W, .60, 1.60, 5.95, 7.70, -.05, .03, 'marble')
frame('west door frame', W, -1.55, -.45, 5.90, 7.70, .14, .18)
slab('west door leaf', W, -1.55, -.45, 5.90, 7.70, -.05, .01, 'steel')

vault_ribs('central vault coffers', 0, C_SPR, C_R, 9, 9)

for sd in (-1, 1):
    XF[:] = [1, sd]
    rng = random.Random(30 + sd)
    archivolt('central archivolt', 0, C_SPR, C_R, HD, 40, .6)
    keystone(0, 11.40, 12.80, .28, .42, .45, HD, rng)
    frame('inscription frame (blank field)', face_d(HDA), -4.15, 4.15, 16.45, 19.55, .26, .10)

for sx in (-1, 1):
    for sd in (-1, 1):
        XF[:] = [sx, sd]
        rng = random.Random(100 + 10 * sx + sd)
        F = face_d(HD)
        for c in COLS:
            column(c, rng, c > 11)
            # pedestal reliefs: Victory with a trophy and captives on the front, soldiers / captives on the sides
            R = Relief()
            person(R, c - .30, 1.05, 2.0, .16, rng)
            person(R, c + .32, 1.05, 1.5, .14, rng)
            victory(R, c + .22, 2.6, .8, .12, -1)
            FP = face_d(COL_D + PED_HW + .03)
            panel('pedestal relief', FP, c - .70, c + .70, 1.0, 3.3, 11, R, base=.0, back=.05)
            frame('pedestal panel frame', FP, c - .70, c + .70, 1.0, 3.3, .07, .05)
            for sgn in (-1, 1):
                R = Relief()
                person(R, COL_D - .25, 1.05, 2.0, .14, rng)
                person(R, COL_D + .35, 1.05, 1.6, .12, rng)
                FS = face_s(c + sgn * (PED_HW + .03), sgn)
                panel('pedestal side relief', FS, HD + .25, COL_D + .75, 1.0, 3.3, 6, R, base=.0, back=.05)
                frame('pedestal panel frame', FS, HD + .25, COL_D + .75, 1.0, 3.3, .07, .05)
        archivolt('lateral archivolt', L_C, L_SPR, L_R, HD, 24, .45)
        keystone(L_C, 7.34, 7.90, .17, .24, .22, HD, rng)
        # porphyry field behind the roundels: north face, west bay only (ref07, ref09; the other bays show stone)
        bay0, bay1 = COLS[0] + PIL_HW, COLS[1] - PIL_HW
        if sx < 0 and sd > 0:
            box('porphyry field', bay0, bay1, 9.0, 11.55, HD - .02, HD + .025, 'porphyry')
        # VOTIS / SIC band over the roundels, left blank (ref12)
        box('votis band (blank)', bay0, bay1, 11.55, 12.45, HD - .05, HD + .05, 'marble')
        box('votis band sill', bay0, bay1, 11.49, 11.55, HD - .05, HD + .08, 'marble')
        # Constantinian frieze over the lateral arch, with plain borders
        R = Relief()
        crowd(R, bay0 + .05, bay1 - .05, 7.97, .82, .12, rng, horses=.12)
        panel('Constantinian frieze', F, bay0 + .05, bay1 - .05, 7.95, 8.95, 20, R, base=.04)
        for yb in (7.87, 8.95):
            box('frieze border', bay0, bay1, yb, yb + .08, HD - .05, HD + .1, 'marble')
        # Hadrianic roundels, two per lateral bay (ref02: centres 6.8 and 9.5 m out, ~2.3 m across)
        for cx in (6.8, 9.5):
            tondo('Hadrianic roundel', F, cx, 10.2, 1.12, rng)
        # central spandrel Victory, filling the spandrel up to the architrave (ref10)
        def yb_c(x):
            return max(C_SPR + math.sqrt(max(0, 3.9 ** 2 - x * x)) + .05, 9.3) if x < 3.9 else 9.3
        R = Relief()
        victory(R, 2.95, 11.3, 2.4, .18, -1)
        relief_slab('spandrel Victory', F, lambda a, b: (1.35 + a * 3.2, yb_c(1.35 + a * 3.2) + b *
                    (13.0 - yb_c(1.35 + a * 3.2))), 24, 14, R, .02, .08, 'carved')
        # lateral spandrel river gods
        for sgn in (-1, 1):
            def yb_l(x):
                o = abs(x - L_C)
                return (L_SPR + math.sqrt(max(0, 2.2 ** 2 - o * o)) + .04) if o < 2.2 else L_SPR + .05
            x0, x1 = (L_C + 1.25, bay1 - .05) if sgn > 0 else (bay0 + .05, L_C - 1.25)
            R = Relief()
            reclining(R, (x0 + x1) / 2 + sgn * .15, 6.6, 1.3, .14, -sgn)
            relief_slab('lateral spandrel relief', F, lambda a, b, x0=x0, x1=x1:
                        (x0 + a * (x1 - x0), yb_l(x0 + a * (x1 - x0)) + b * (7.84 - yb_l(x0 + a * (x1 - x0)))),
                        10, 7, R, .02, .06, 'carved')
        # attic: two Aurelian panels per side bay (ref02, ref04)
        FA = face_d(HDA)
        for x0, x1 in ((5.85, 7.95), (8.15, 10.35)):
            R = Relief()
            crowd(R, x0, x1, 16.6, 2.75, .32, rng, horses=.25)
            panel('Aurelian attic panel', FA, x0, x1, 16.5, 19.5, 12, R)
            frame('attic panel frame', FA, x0, x1, 16.5, 19.5, .14, .12)

XF[:] = [1, 1]
info = m.finish(directory=SCRATCH)
