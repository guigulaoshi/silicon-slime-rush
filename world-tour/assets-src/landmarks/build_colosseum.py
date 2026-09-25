"""Colosseum (Flavian Amphitheatre), Piazza del Colosseo, Rome.

Original geometry from the published dimensions (outer ellipse 188 x 156 m, 48.5 m to the attic
cornice, 80 bays, three arcaded orders Tuscan / Ionic / Corinthian and a pilastered attic with
windows in alternate bays and three corbels per bay) and the OSM outline (relation 1834818). The
ellipse is fitted to the intact north arc of that outline: centre, axis and extent of the surviving
outer ring (bays between the two brick buttresses) all come from the map; the semi-axes are the
published ones (the wall face sits 0.8 m inside them, the half-columns reach them).

Ruin state: the outer ring survives on the north from Valadier's west buttress (1820s, last bays
rebuilt in brick, stepped end by storey: each storey stops one bay beyond the one above and ends in a
sloping brick spur -- attic, third, second and ground storey alike, photos ref11/ref06/ref02) to
Stern's east buttress (1807, sloping brick spur, last arches walled up). Everywhere else only low pier
stumps of the outer ring remain, and the second ring is the facade: two whole arcades, a row of
smaller arches, travertine blocks capping its pilastered piers at ~23.6 m, and a brick wall with a
window in about every other bay up to a nearly level top at ~29 m (photos ref02/ref03/ref08; heights
scaled off ref02 against the outer ring's known storey heights). The outer ring's third-storey gallery
is open to the sky -- no vault behind the third order or the attic (ref01/ref04). Broken ends are
vertical sections through the wall by storey; nothing is capped.
Reference photos (comparison only, never in the repo): Wikimedia Commons, listed in the modelling
report ($SCRATCH/modelling/colosseum/report.md).

Authoring frame: the Model's (u across, y up, v along) is rotated once more into the ellipse's own
frame (q0 along the major axis, pointing ESE; q1 along the minor axis, negative = north). Around the
ring everything is placed by arc length s along the wall-face ellipse and by d, the distance inward
along its normal, so radial members line up through every ring.
Run: Blender --background --python assets-src/landmarks/build_colosseum.py
"""
import bisect
import math
import random
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model
from build_moffett_aircraft import xyz

ID = 'colosseum'
# Ellipse fitted to the intact outer arc of the OSM outline, in the Model's (u, v) frame.
CU, CV = 4.024, 3.832
PHI = math.radians(-68.105)
MAJ = (math.cos(PHI), math.sin(PHI))
MNR = (-math.sin(PHI), math.cos(PHI))
A, B = 93.2, 77.2          # wall face; half-column fronts reach 94 x 78 (188 x 156 m)
NB = 80                    # bays per ring
SEG = 10                   # facets on a half-column

# Arc-length table of the wall-face ellipse, s = 0 on the east (ESE) end of the major axis.
_N = 7200
_TH = [2 * math.pi * i / _N for i in range(_N + 1)]
_S = [0.0]
for _i in range(_N):
    _tm = (_TH[_i] + _TH[_i + 1]) / 2
    _S.append(_S[-1] + math.hypot(A * math.sin(_tm), B * math.cos(_tm)) * (_TH[_i + 1] - _TH[_i]))
P = _S[-1]
BAY = P / NB


def theta(s):
    s %= P
    i = min(bisect.bisect_right(_S, s) - 1, _N - 1)
    f = (s - _S[i]) / (_S[i + 1] - _S[i])
    return _TH[i] + f * (_TH[i + 1] - _TH[i])


def s_at(deg):
    t = math.radians(deg % 360)
    i = min(int(t / (2 * math.pi) * _N), _N - 1)
    return _S[i]


def Qp(q0, q1, y):
    return (CU + q0 * MAJ[0] + q1 * MNR[0], y, CV + q0 * MAJ[1] + q1 * MNR[1])


def W(s, d, y):
    """Point at arc length s on the wall face, d metres inward along the normal, height y."""
    t = theta(s)
    c, sn = math.cos(t), math.sin(t)
    nx, ny = B * c, A * sn
    L = math.hypot(nx, ny)
    return Qp(A * c - d * nx / L, B * sn - d * ny / L, y)


def frame(s, d=0.0):
    a, b = W(s - .05, d, 0), W(s + .05, d, 0)
    tx, tz = b[0] - a[0], b[2] - a[2]
    L = math.hypot(tx, tz)
    o, p = W(s, d, 0), W(s, d - 1.0, 0)
    nx, nz = p[0] - o[0], p[2] - o[2]
    M = math.hypot(nx, nz)
    return o, (tx / L, tz / L), (nx / M, nz / M)


def g(s, d):
    """Metres of wall per unit of s at depth d."""
    a, b = W(s - .25, d, 0), W(s + .25, d, 0)
    return math.hypot(b[0] - a[0], b[2] - a[2]) / .5


def within(s, a, b):
    return (s - a) % P <= (b - a)


rnd = random.Random(1834818)
m = Model(ID)
for key, color, metal, rough in [
        # Linear colours read off the daylight photos (sRGB -> linear): weathered warm grey-beige
        # travertine, clearly darker than the Vittoriano's white marble; orange-brown brick.
        ('travertine', (.56, .50, .39), 0, .86),
        ('brick', (.40, .21, .12), 0, .9),
        ('stone', (.46, .41, .32), 0, .88),      # tufa and concrete of the inner rings
        ('wood', (.30, .21, .13), 0, .8)]:
    m.material(key, color, metal, rough, ID + '_' + key)
TRAV, BRICK, TUFA, WOOD = 'travertine', 'brick', 'stone', 'wood'


# ---- primitives ---------------------------------------------------------------------------
def grid_solid(label, F, Bk, mat, flags=None):
    nv, nu = len(F), len(F[0])
    front = [p for row in F for p in row]
    back = [p for row in Bk for p in row]
    n = len(front)
    faces = []
    for j in range(nv - 1):
        for i in range(nu - 1):
            a = j * nu + i; b = a + 1; c = a + nu + 1; d = a + nu
            faces += [(a, b, c, d), (n + d, n + c, n + b, n + a)]
    boundary = (list(range(nu)) + [j * nu + nu - 1 for j in range(1, nv)] +
                [(nv - 1) * nu + i for i in range(nu - 2, -1, -1)] + [j * nu for j in range(nv - 2, 0, -1)])
    faces += [(a, b, n + b, n + a) for a, b in zip(boundary, boundary[1:] + boundary[:1])]
    m.mesh(label, front + back, faces, mat)


def loft(label, rings, mat, smooth_sides=None):
    """Closed solid through horizontal rings of equal point count (columns, capitals)."""
    k = len(rings[0])
    verts = [p for r in rings for p in r]
    faces, flags = [], []
    for i in range(len(rings) - 1):
        for j in range(k):
            a = i * k + j; b = i * k + (j + 1) % k
            faces.append((a, b, b + k, a + k))
            flags.append(bool(smooth_sides and smooth_sides(j)))
    faces += [tuple(reversed(range(k))), tuple((len(rings) - 1) * k + j for j in range(k))]
    flags += [False, False]
    m.mesh(label, verts, faces, mat)
    group = m.groups[mat][2]
    group[len(group) - len(faces):] = flags


def sweep(label, s0, s1, profile, mat, step=None):
    """Closed (d, y) profile swept along the ellipse from s0 to s1."""
    n = max(1, int(math.ceil(abs(s1 - s0) / (step or BAY / 2))))
    ss = [s0 + (s1 - s0) * i / n for i in range(n + 1)]
    k = len(profile)
    verts = [W(s, d, y) for s in ss for (d, y) in profile]
    faces = [(i * k + j, i * k + (j + 1) % k, (i + 1) * k + (j + 1) % k, (i + 1) * k + j)
             for i in range(n) for j in range(k)]
    faces += [tuple(reversed(range(k))), tuple(n * k + j for j in range(k))]
    m.mesh(label, verts, faces, mat)


def cbox(label, s0, s1, d0, d1, y0, y1, mat):
    n = max(1, int(math.ceil(abs(s1 - s0) / 3.4)))
    ss = [s0 + (s1 - s0) * i / n for i in range(n + 1)]
    grid_solid(label, [[W(s, d0, y) for s in ss] for y in (y0, y1)],
               [[W(s, d1, y) for s in ss] for y in (y0, y1)], mat)


def lbox(label, s, dt0, dt1, dn0, dn1, y0, y1, mat, d=0.0):
    """Box in the local frame at s: dt along the wall, dn outward from depth d."""
    o, T, N = frame(s, d)
    def p(a, b, y): return (o[0] + a * T[0] + b * N[0], y, o[2] + a * T[1] + b * N[1])
    grid_solid(label, [[p(dt0, dn0, y0), p(dt1, dn0, y0)], [p(dt0, dn0, y1), p(dt1, dn0, y1)]],
               [[p(dt0, dn1, y0), p(dt1, dn1, y0)], [p(dt0, dn1, y1), p(dt1, dn1, y1)]], mat)


def arc(sc, d, spring, r, a0=0.0, a1=math.pi, n=12):
    gs = g(sc, d)
    return [(sc - r * math.cos(a0 + (a1 - a0) * i / n) / gs, spring + r * math.sin(a0 + (a1 - a0) * i / n))
            for i in range(n + 1)]


def arch_top(label, sc, d0, d1, spring, r, top, mat, n=12):
    """The solid over an open round arch, from its intrados up to `top`, through the wall."""
    a = arc(sc, d0, spring, r, n=n)
    grid_solid(label, [[W(s, d0, y) for s, y in a], [W(s, d0, top) for s, y in a]],
               [[W(s, d1, y) for s, y in a], [W(s, d1, top) for s, y in a]], mat)


def archivolt(sc, spring, r, w, proj, mat, n=12):
    inner, outer = arc(sc, 0, spring, r, n=n), arc(sc, 0, spring, r + w, n=n)
    grid_solid('archivolt', [[W(s, -proj, y) for s, y in inner], [W(s, -proj, y) for s, y in outer]],
               [[W(s, .06, y) for s, y in inner], [W(s, .06, y) for s, y in outer]], mat)


def half_ring(s, rad, y, emb=.3, star=0.0, seg=SEG):
    o, T, N = frame(s)
    pts = []
    for i in range(seg + 1):
        b = math.pi * i / seg
        rr = rad * (1 + (star if i % 2 else 0))
        pts.append((o[0] + rr * (math.cos(b) * T[0] + math.sin(b) * N[0]), y,
                    o[2] + rr * (math.cos(b) * T[1] + math.sin(b) * N[1])))
    pts.append((o[0] - rad * T[0] - emb * N[0], y, o[2] - rad * T[1] - emb * N[1]))
    pts.append((o[0] + rad * T[0] - emb * N[0], y, o[2] + rad * T[1] - emb * N[1]))
    return pts


# ---- the orders ---------------------------------------------------------------------------
def column(s, y0, y1, r, order, shaft_mat):
    """Engaged half-column on the wall face with its base and its order's capital."""
    gs = g(s, 0)
    lbox('column plinth', s, -(r + .22), r + .22, -.1, r + .22, y0, y0 + .28, TRAV)
    smooth = lambda j: j < SEG
    rings = [half_ring(s, r + .13, y0 + .28), half_ring(s, r + .13, y0 + .46), half_ring(s, r, y0 + .58),
             half_ring(s, r * .86, y1 - .78), half_ring(s, r * .95, y1 - .74), half_ring(s, r * .86, y1 - .68)]
    loft('column shaft', rings, shaft_mat, smooth)
    if order == 'tuscan':
        loft('echinus', [half_ring(s, r * .86, y1 - .68), half_ring(s, r * 1.16, y1 - .34)], TRAV, smooth)
        lbox('abacus', s, -r * 1.3, r * 1.3, -.1, r * 1.3, y1 - .34, y1, TRAV)
    elif order == 'ionic':
        loft('echinus', [half_ring(s, r * .86, y1 - .68), half_ring(s, r * 1.02, y1 - .42)], TRAV, smooth)
        o, T, N = frame(s)
        for side in (-1, 1):
            c = (o[0] + side * r * 1.02 * T[0], o[2] + side * r * 1.02 * T[1])
            yv = y1 - .5
            m.tube('volute', [(c[0] - .05 * N[0], yv, c[1] - .05 * N[1]), (c[0] + (r + .12) * N[0], yv, c[1] + (r + .12) * N[1])],
                   .24, TRAV, 8)
        lbox('abacus', s, -r * 1.35, r * 1.35, -.1, r * 1.2, y1 - .28, y1, TRAV)
    else:  # corinthian: bell with two rows of acanthus and a broad abacus
        loft('bell', [half_ring(s, r * .86, y1 - 1.25), half_ring(s, r * 1.0, y1 - .7), half_ring(s, r * 1.22, y1 - .3)],
             TRAV, smooth)
        for y, h, k in ((y1 - 1.25, .45, .16), (y1 - .85, .42, .2)):
            loft('acanthus', [half_ring(s, r * .95, y, star=k, seg=16), half_ring(s, r * 1.02, y + h, star=k * 1.3, seg=16)],
                 TRAV)
        lbox('abacus', s, -r * 1.42, r * 1.42, -.1, r * 1.35, y1 - .3, y1, TRAV)


def entablature(s0, s1, ye, back):
    prof = [(back, ye), (-.60, ye), (-.60, ye + .30), (-.66, ye + .33), (-.66, ye + .68), (-.60, ye + .72),
            (-.60, ye + 1.30), (-.82, ye + 1.36), (-.98, ye + 1.50), (-1.26, ye + 1.62), (-1.32, ye + 1.84),
            (-1.32, ye + 2.0), (back, ye + 2.0)]
    sweep('entablature', s0, s1, prof, TRAV)


def plinth_band(s0, s1, yb, back, h=1.8):
    prof = [(back, yb), (-.36, yb), (-.36, yb + .24), (-.26, yb + .30), (-.26, yb + h - .24), (-.42, yb + h - .14),
            (-.42, yb + h), (back, yb + h)]
    sweep('plinth band', s0, s1, prof, TRAV)


# ---- outer ring --------------------------------------------------------------------------
TA = 2.4                                   # outer wall thickness
HW = 2.1                                   # half-width of an outer arch
J_W = math.ceil(s_at(-165) / BAY - .5)     # last surviving pier at the west (Valadier) end
J_E = math.floor(s_at(-6) / BAY - .5)      # last surviving pier at the east (Stern) end
def SJ(j): return (j + .5) * BAY
def HP(s, d=0.0): return BAY / 2 - HW / g(s, d)   # half a pier, in s
VALADIER = set(range(J_W, J_W + 5))        # piers and bays rebuilt in brick
STERN_INFILL = {J_E - 1, J_E}              # bays walled up by the buttress
STERN_L, VALADIER_L = 13.0, 5.0
S_EAST = SJ(J_E) + HP(SJ(J_E))
S_WEST = SJ(J_W) - HP(SJ(J_W))
# (name, first pier, pier foot, pier top, arch sill, springing, order, column radius)
STOREYS = [('S1', J_W, 0.0, 9.2, .9, 5.85, 'tuscan', .62),
           ('S2', J_W + 1, 13.0, 21.0, 13.0, 17.3, 'ionic', .56),
           ('S3', J_W + 2, 24.8, 32.6, 24.8, 29.0, 'corinthian', .52)]
ATTIC_FIRST = J_W + 3
print(f'bay {BAY:.2f} m, perimeter {P:.1f} m, outer ring piers {J_W}..{J_E} ({J_E - J_W} bays)', flush=True)


def outer_ring():
    # Two travertine steps and the threshold under the ground-floor arches.
    sweep('steps', S_WEST - VALADIER_L / g(S_WEST, 0) - 1, S_EAST + STERN_L / g(S_EAST, 0),
          [(7.9, 0), (-2.6, 0), (-2.6, .45), (-1.6, .45), (-1.6, .9), (7.9, .9)], TRAV)
    for name, first, foot, top, sill, spring, order, r in STOREYS:
        s0 = SJ(first) - HP(SJ(first))
        for j in range(first, J_E + 1):
            s = SJ(j)
            mat = BRICK if j in VALADIER else TRAV
            hp = HP(s)
            cbox('pier', s - hp, s + hp, 0, TA, foot, top, mat)
            cbox('impost', s - hp - .14 / g(s, 0), s + hp + .14 / g(s, 0), -.14, TA + .14, spring - .32, spring, TRAV)
            if name != 'S1':
                lbox('pedestal', s, -(r + .26), r + .26, -.2, r + .3, foot - 1.8, foot - .2, mat)
                lbox('pedestal cap', s, -(r + .34), r + .34, -.2, r + .42, foot - .2, foot, TRAV)
            column(s, foot if name != 'S1' else .9, top, r, order, mat)
        for k in range(first + 1, J_E + 1):
            s = k * BAY
            mat = BRICK if k in VALADIER else TRAV
            arch_top('arch', s, 0, TA, spring, HW, top, mat, n=14)
            archivolt(s, spring, HW, .42, .12, TRAV, n=14)
            if k in STERN_INFILL:
                hw = HW / g(s, 0)
                cbox('stern infill', s - hw - .05, s + hw + .05, .38, TA - .3, sill, spring + HW, BRICK)
        if name != 'S1':
            plinth_band(s0, S_EAST, foot - 1.8, TA)
        entablature(s0, S_EAST, top, TA)
        # Vault of the outer ambulatory behind the two lower storeys. The third-storey gallery has
        # lost its vault: sky shows through the third-order arches and the attic windows (ref01, ref04).
        if name != 'S3':
            vault(s0, S_EAST, TA, 7.9, {'S1': 7.8, 'S2': 18.8}[name], {'S1': 11.2, 'S2': 23.0}[name], BRICK)
        if name != 'S1':
            # Valadier's end of this storey: a sloping brick spur standing on the storey below, whose
            # entablature runs on one more bay (ref11). The ground storey's spur is in buttresses().
            spur(name + ' spur', s0, 4.4, top + 2.0, foot - 1.8)
    attic()
    buttresses()


def spur(label, s_end, run, y_top, y_base, n=6):
    """Sloping brick spur along the ring, from y_top at the storey's end pier down to y_base + 0.6
    `run` metres further west, as thick as the wall, with a travertine coping along the slope."""
    gs = g(s_end, 0)
    cols = [s_end + .4 / gs - (run + .4) * i / n / gs for i in range(n + 1)]
    tops = [y_top + (y_base + .6 - y_top) * i / n for i in range(n + 1)]
    grid_solid(label, [[W(s, -.3, y_base) for s in cols], [W(s, -.3, t - .28) for s, t in zip(cols, tops)]],
               [[W(s, TA, y_base) for s in cols], [W(s, TA, t - .28) for s, t in zip(cols, tops)]], BRICK)
    grid_solid(label + ' coping', [[W(s, -.42, t - .33) for s, t in zip(cols, tops)], [W(s, -.42, t) for s, t in zip(cols, tops)]],
               [[W(s, TA + .05, t - .33) for s, t in zip(cols, tops)], [W(s, TA + .05, t) for s, t in zip(cols, tops)]], TRAV)


def attic():
    s0 = SJ(ATTIC_FIRST) - HP(SJ(ATTIC_FIRST))
    plinth_band(s0, S_EAST, 34.6, TA, h=1.6)
    for k in range(ATTIC_FIRST + 1, J_E + 1):
        sc = k * BAY
        gs = g(sc, 0)
        a, b = (k - .5) * BAY, (k + .5) * BAY
        mat = BRICK if k in VALADIER else TRAV
        # A large window (1.7 x 3.0 m, mid-height) in every other bay; the bays between have a small
        # square opening just above the attic plinth (ref01, ref04; sizes scaled off ref01's bay).
        if k % 2 == 0:
            w, y0, y1 = .85 / gs, 37.6, 40.6
        else:
            w, y0, y1 = .65 / gs, 36.2, 37.5
        cbox('attic wall', a, sc - w, 0, 2.2, 36.2, 46.7, mat)
        cbox('attic wall', sc + w, b, 0, 2.2, 36.2, 46.7, mat)
        if y0 > 36.2:
            cbox('attic wall', sc - w, sc + w, 0, 2.2, 36.2, y0, mat)
        cbox('attic wall', sc - w, sc + w, 0, 2.2, y1, 46.7, mat)
        if k % 2 == 0:
            cbox('window sill', sc - w - .12 / gs, sc + w + .12 / gs, -.14, .3, y0 - .18, y0, TRAV)
        for dt in (-2.2, 0.0, 2.2):   # three corbels a bay for the awning masts
            lbox('corbel', sc + dt / gs, -.24, .24, -.1, .72, 42.5, 43.35, TRAV)
            lbox('corbel foot', sc + dt / gs, -.18, .18, -.1, .45, 42.15, 42.5, TRAV)
    for j in range(ATTIC_FIRST, J_E + 1):
        s = SJ(j)
        mat = BRICK if j in VALADIER else TRAV
        lbox('pilaster base', s, -.82, .82, -.1, .46, 36.2, 36.75, TRAV)
        lbox('pilaster', s, -.65, .65, -.1, .3, 36.75, 45.8, mat)
        lbox('pilaster capital', s, -.82, .82, -.1, .52, 45.8, 46.7, TRAV)
    sweep('attic cornice', s0, S_EAST,
          [(2.2, 46.7), (-.3, 46.7), (-.3, 47.05), (-.55, 47.15), (-.8, 47.45), (-1.25, 47.62), (-1.6, 47.9),
           (-1.6, 48.5), (2.2, 48.5)], TRAV)
    # Valadier's end of the attic: the big slope seen from the Forum (ref00, ref11).
    spur('attic spur', s0, 4.8, 48.5, 34.6)


def wedge(label, s_from, length, top0, top1, d_out0, d_out1, d_in, sign, n=6, rows=5):
    """Sloping brick buttress along the curve: tall at the wall end, down to the ground outward."""
    gs = g(s_from, 0)
    cols = [s_from + sign * length * i / n / gs for i in range(n + 1)]
    tops = [top0 + (top1 - top0) * i / n for i in range(n + 1)]
    Fr = [[W(s, d_out0 + (d_out1 - d_out0) * (t * j / rows) / top0, t * j / rows) for s, t in zip(cols, tops)]
          for j in range(rows + 1)]
    Bk = [[W(s, d_in, t * j / rows) for s, t in zip(cols, tops)] for j in range(rows + 1)]
    grid_solid(label, Fr, Bk, BRICK)


def buttresses():
    # Stern (1807): a sloping brick spur against the east end, from the attic down to the square.
    wedge('stern buttress', SJ(J_E), STERN_L, 47.6, 2.4, -4.4, -.9, 8.1, 1)
    # Valadier (1820s): the rebuilt brick bays end in steps; the ground storey's spur is like the
    # ones above it, in the plane of the wall, leaving the ambulatory vault open in section (ref11).
    spur('valadier buttress', SJ(J_W) - HP(SJ(J_W)), VALADIER_L + .5, 11.2, 0.0)


def south_stumps():
    """Where the outer ring fell: its foundation course and the stumps of its piers."""
    a = S_EAST + STERN_L / g(S_EAST, 0)
    b = S_WEST - VALADIER_L / g(S_WEST, 0) + P
    sweep('outer foundation', a, b, [(2.6, 0), (-1.0, 0), (-1.0, .32), (2.6, .32)], TRAV)
    for j in range(NB):
        s = SJ(j)
        if within(s, a + 1, b - 1):
            hp = HP(s)
            cbox('pier stump', s - hp, s + hp, .05, TA - .05, 0, .35 + rnd.uniform(.1, 1.6) ** 1.5, TRAV)


# ---- inner rings, vaults ------------------------------------------------------------------
NZ0, NZ1 = S_WEST - 2 * BAY, S_EAST + 2 * BAY     # north zone: the rings stand to full height
def north(s): return within(s, NZ0, NZ1)


def ring_arcade(d0, d1, hw, foot, spring, top, mat, bays, arches=True, impost=True):
    for k in bays:
        s = k * BAY
        a = hw / g(s, d0)
        sl, sr = (k - .5) * BAY, (k + .5) * BAY
        cbox('ring pier', sl, s - a, d0, d1, foot, top, mat)
        cbox('ring pier', s + a, sr, d0, d1, foot, top, mat)
        if arches:
            arch_top('ring arch', s, d0, d1, spring, hw, top, mat, n=10)
        if impost:
            cbox('ring impost', s - a - .5 / g(s, d0), s - a + .1 / g(s, d0), d0 - .1, d1 + .1, spring - .28, spring, TRAV)
            cbox('ring impost', s + a - .1 / g(s, d0), s + a + .5 / g(s, d0), d0 - .1, d1 + .1, spring - .28, spring, TRAV)


def vault(s0, s1, da, db, ys, yt, mat):
    R = (db - da) / 2
    prof = [(da + R - R * math.cos(math.pi * i / 8), ys + R * math.sin(math.pi * i / 8)) for i in range(9)]
    sweep('vault', s0, s1, prof + [(db, yt), (da, yt)], mat)


def full_ring_sweep(label_fn, *args):
    label_fn(0.0, P / 2, *args)
    label_fn(P / 2, P, *args)


def band(s0, s1, d0, d1, y0, y1, mat):
    sweep('ring band', s0, s1, [(d0, y0), (d1, y0), (d1, y1), (d0, y1)], mat)


def inner_rings():
    allb = range(NB)
    sb = [k for k in allb if not north(k * BAY)]
    # Second ring (B), travertine piers: the facade wherever the outer ring is gone. Its levels, scaled
    # off ref02 against the outer ring's storeys: arcade 0-7.1 m, band to 11.2, arcade to 18.3, a row of
    # smaller arches to ~22, capping blocks at 22.8-23.6, brick wall with windows to ~29 m.
    ring_arcade(7.9, 10.3, 1.9, 0, 5.2, 7.8, TRAV, allb)
    full_ring_sweep(band, 7.9, 10.3, 7.8, 11.2, TRAV)
    ring_arcade(7.9, 10.3, 1.9, 11.2, 16.4, 18.8, TRAV, allb)
    # Row of smaller arches: behind the outer ring's second-storey vault on the north it is solid.
    band(NZ0, NZ1, 7.9, 10.3, 18.8, 23.6, TRAV)
    for k in sb:
        s = k * BAY
        a = 1.3 / g(s, 7.9)
        sl, sr = (k - .5) * BAY, (k + .5) * BAY
        cbox('ring pier', sl, s - a, 7.9, 10.3, 18.8, 23.6, TRAV)
        cbox('ring pier', s + a, sr, 7.9, 10.3, 18.8, 23.6, TRAV)
        arch_top('ring arch', s, 7.9, 10.3, 20.6, 1.3, 23.6, BRICK, n=10)
        if rnd.random() < .45:   # blocked with brick, set back from the face (ref02)
            pts = arc(s, 8.5, 20.6, 1.3, n=10)
            grid_solid('arch infill', [[W(q, 8.5, 18.8) for q, y in pts], [W(q, 8.5, y) for q, y in pts]],
                       [[W(q, 10.3, 18.8) for q, y in pts], [W(q, 10.3, y) for q, y in pts]], BRICK)
    # Flat travertine pilaster strips on every pier, up to the projecting capping blocks.
    for j in range(NB):
        s = SJ(j)
        lbox('ring pilaster', s, -.55, .55, -.1, .2, 0.0, 22.8, TRAV, d=7.9)
        lbox('ring pilaster block', s, -.8, .8, -.1, .5, 22.8, 23.6, TRAV, d=7.9)
    # Brick wall with a rectangular window in about every other bay; the top wanders a little bay by
    # bay, each bay ending in vertical sections (nothing capped).
    for k in allb:
        s = k * BAY
        sl, sr = (k - .5) * BAY, (k + .5) * BAY
        top = 29.2 + rnd.uniform(-.8, .5)
        window = (k % 2 == 0) != (rnd.random() < .2)
        if window:
            w = .65 / g(s, 7.9)
            cbox('ring wall', sl, s - w, 7.9, 10.3, 23.6, top, BRICK)
            cbox('ring wall', s + w, sr, 7.9, 10.3, 23.6, top, BRICK)
            cbox('ring wall', s - w, s + w, 7.9, 10.3, 23.6, 24.8, BRICK)
            cbox('ring wall', s - w, s + w, 7.9, 10.3, 27.4, top, BRICK)
        else:
            cbox('ring wall', sl, sr, 7.9, 10.3, 23.6, top, BRICK)
    # Third ring (C), tufa.
    ring_arcade(15.0, 17.5, 1.6, 0, 4.8, 6.9, TUFA, allb, impost=False)
    full_ring_sweep(band, 15.0, 17.5, 6.9, 11.2, TUFA)
    ring_arcade(15.0, 17.5, 1.6, 11.2, 15.6, 17.6, TUFA, allb, impost=False)
    band(NZ0, NZ1, 15.0, 17.5, 17.6, 23.0, TUFA)
    # Vaults of the two ambulatories (brick-faced concrete).
    full_ring_sweep(vault, 10.3, 15.0, 7.8, 11.2, BRICK)
    vault(NZ0, NZ1, 10.3, 15.0, 18.8, 23.0, BRICK)
    for k in sb:
        sl, sr = (k - .5) * BAY, (k + .5) * BAY
        tc = 23.0 if rnd.random() < .5 else 18.0 + rnd.uniform(0, 4.8)
        cbox('broken band', sl, sr, 15.0, 17.5, 17.6, tc, TUFA)
        if tc > 22.4:
            vault(sl, sr, 10.3, 15.0, 18.8, tc, BRICK)
        # No springers of the lost outer vault: the second ring's face is flat travertine (ref02, ref03).


# ---- cavea, arena, hypogeum ---------------------------------------------------------------
def slope(d):
    return 23.0 - (d - 17.5) * (18.5 / 32.5)


AXES = {0, 20, 40, 60}                        # the four axial entrances run straight to the arena
RESTORED = {64, 65, 66}                        # a rebuilt sector of seating on the north side


def rw_half(s, d):
    """Half-thickness of a radial wall: 0.55 m, thinner where the walls crowd in at the arena ends."""
    return min(.55, .3 * BAY * g(s, d))


def radial_piece(s, d0, d1, t0, t1, y0=0.0):
    def side(sign, d, y): return W(s + sign * rw_half(s, d) / g(s, d), d, y)
    grid_solid('radial wall', [[side(-1, d0, y0), side(-1, d1, y0)], [side(-1, d0, t0), side(-1, d1, t1)]],
               [[side(1, d0, y0), side(1, d1, y0)], [side(1, d0, t0), side(1, d1, t1)]], BRICK)


def radial_arch(s, d0, d1, spring, top_fn, n=8):
    R = (d1 - d0) / 2
    pts = [(d0 + R - R * math.cos(math.pi * i / n), spring + R * math.sin(math.pi * i / n)) for i in range(n + 1)]
    def side(sign, d, y): return W(s + sign * rw_half(s, d) / g(s, d), d, y)
    grid_solid('radial arch', [[side(-1, d, y) for d, y in pts], [side(-1, d, top_fn(d)) for d, y in pts]],
               [[side(1, d, y) for d, y in pts], [side(1, d, top_fn(d)) for d, y in pts]], BRICK)


def cavea():
    # Podium round the arena, with its parapet.
    prof = [(49.5, 0), (53.2, 0), (53.2, 3.8), (53.45, 3.95), (53.45, 4.25), (53.2, 4.3), (53.2, 5.3), (52.8, 5.3),
            (52.8, 4.5), (49.5, 4.5)]
    full_ring_sweep(lambda a, b: sweep('podium', a, b, prof, TRAV, step=BAY / 3))
    for j in range(NB):
        s = SJ(j)
        ruin = rnd.uniform(0, 2.2) if north(s) else rnd.uniform(1.0, 6.5)
        segs = [(17.5, 23.0), (26.5, 34.0), (37.0, 45.5), (45.5, 49.6)]
        for d0, d1 in segs:
            cut = ruin + rnd.uniform(0, 1.8)
            t0, t1 = max(1.2, slope(d0) - cut), max(1.0, slope(d1) - cut)
            radial_piece(s, d0, d1, t0, t1)
        # Arched openings where the two annular corridors pass through the radial wall.
        for d0, d1, sp in ((23.0, 26.5, 4.0), (34.0, 37.0, 3.0)):
            cut = ruin + rnd.uniform(0, 1.2)
            top = lambda d, c=cut: slope(d) - c
            if min(top(d0), top(d1)) > sp + (d1 - d0) / 2 + .5:
                radial_arch(s, d0, d1, sp, top)
    for k in range(NB):
        if k in AXES:
            continue
        s = k * BAY
        sl, sr = SJ(k - 1), SJ(k)
        nth = north(s)
        def inset(sv, d, sign): return sv + sign * (rw_half(sv, d) + .01) / g(sv, d)
        # Annular corridor walls and, where they survive, the corridor vaults.
        for dw, dt in ((22.2, 23.0), (26.5, 27.3), (33.2, 34.0), (37.0, 37.8)):
            cut = rnd.uniform(0, 2.0) + (0 if nth else rnd.uniform(0, 4.0))
            top = max(1.0, slope(dt) - cut)
            a, b = inset(sl, dw, 1), inset(sr, dw, -1)
            if rnd.random() < .25:     # a doorway through the corridor wall
                mid = (a + b) / 2
                w = .7 / g(mid, dw)
                cbox('annular wall', a, mid - w, dw, dt, 0, top, BRICK)
                cbox('annular wall', mid + w, b, dw, dt, 0, top, BRICK)
                if top > 3.0:
                    cbox('annular wall', mid - w, mid + w, dw, dt, 2.6, top, BRICK)
            else:
                cbox('annular wall', a, b, dw, dt, 0, top, BRICK)
        for d0, d1, sp in ((23.0, 26.5, 4.0), (34.0, 37.0, 3.0)):
            if rnd.random() < (.75 if nth else .45):
                R = (d1 - d0) / 2
                prof = [(d0 + R - R * math.cos(math.pi * i / 6), sp + R * math.sin(math.pi * i / 6)) for i in range(7)]
                top = slope(d1) - rnd.uniform(0, 1.0)
                if top > sp + R + .4:
                    sweep('corridor vault', inset(sl, d0, 1), inset(sr, d0, -1), prof + [(d1, top), (d0, top)], BRICK)
        # Raking vaults that carried the seats: broken into pieces, some gone.
        if k in RESTORED:
            n = 16
            d0, d1 = 37.8, 49.5
            prof = [(d1, 0)]
            for i in range(n):
                da = d1 - (d1 - d0) * i / n
                db = d1 - (d1 - d0) * (i + 1) / n
                prof += [(da, slope(da) + .05), (db, slope(da) + .05)]
            prof += [(d0, slope(d0) + .05), (d0, 0)]
            sweep('restored seats', inset(sl, 40, 1), inset(sr, 40, -1), prof, TRAV, step=BAY)
        for d0, d1 in ((17.5, 22.2), (27.3, 33.2), (37.8, 43.5), (43.5, 49.5)):
            if k in RESTORED and d0 >= 37.8:
                continue
            if rnd.random() > (.72 if nth else .42):
                continue
            cut = rnd.uniform(0, 1.6) + (0 if nth else rnd.uniform(0, 3.0))
            t0, t1 = slope(d0) - cut, slope(d1) - cut
            if min(t0, t1) < 1.6:
                continue
            a0, b0, a1, b1 = inset(sl, d0, 1), inset(sr, d0, -1), inset(sl, d1, 1), inset(sr, d1, -1)
            grid_solid('raking vault', [[W(a0, d0, t0), W(b0, d0, t0)], [W(a1, d1, t1), W(b1, d1, t1)]],
                       [[W(a0, d0, t0 - .9), W(b0, d0, t0 - .9)], [W(a1, d1, t1 - .9), W(b1, d1, t1 - .9)]], BRICK)


def qbox(label, q0a, q0b, q1a, q1b, y0, y1, mat):
    grid_solid(label, [[Qp(q0a, q1a, y0), Qp(q0b, q1a, y0)], [Qp(q0a, q1a, y1), Qp(q0b, q1a, y1)]],
               [[Qp(q0a, q1b, y0), Qp(q0b, q1b, y0)], [Qp(q0a, q1b, y1), Qp(q0b, q1b, y1)]], mat)


def hypogeum():
    """The arena's underground: long walls parallel to the major axis, cross walls between them for
    the lift cells, and the rebuilt stretch of arena floor at the east end. The model cannot go below
    its ground datum, so the walls stand on the arena ground and the floor sits on their tops."""
    ah, bh = 38.2, 22.4
    def reach(q1): return ah * math.sqrt(max(0.0, 1 - (q1 / bh) ** 2))
    lines = [1.8, 5.8, 9.8, 13.8, 17.8]
    for sgn in (-1, 1):
        for c in lines:
            q1 = sgn * c
            L = reach(abs(q1) + .4)
            x = -L
            while x < L - 1.0:
                seg = min(L, x + rnd.uniform(4.5, 8.0))
                qbox('hypogeum wall', x, seg, q1 - .35, q1 + .35, 0, rnd.uniform(2.3, 3.4), BRICK)
                x = seg + rnd.uniform(.9, 1.4)
        for c0, c1 in ((1.8, 5.8), (9.8, 13.8), (13.8, 17.8)):
            L = reach(c1 + .4)
            x = -L + 2.0
            while x < L - 2.0:
                q1a, q1b = sgn * (c0 + .35), sgn * (c1 - .35)
                qbox('hypogeum cell wall', x - .3, x + .3, min(q1a, q1b), max(q1a, q1b), 0, rnd.uniform(1.8, 3.3), BRICK)
                x += 4.2
    # Rebuilt arena floor over the east end of the hypogeum.
    ar, br = 40.3, 24.2
    q0s = 24.0
    ts = [math.acos(q0s / ar) * (1 - 2 * i / 16) for i in range(17)]
    ring = [(ar * math.cos(t), br * math.sin(t)) for t in ts]
    top = [Qp(q0, q1, 3.65) for q0, q1 in ring]
    bot = [Qp(q0, q1, 3.35) for q0, q1 in ring]
    k = len(ring)
    faces = [(i, (i + 1) % k, k + (i + 1) % k, k + i) for i in range(k)] + [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
    m.mesh('arena floor', top + bot, faces, WOOD)


# ---- build --------------------------------------------------------------------------------
outer_ring()
south_stumps()
inner_rings()
cavea()
hypogeum()

out = Path(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else None
info = m.finish(directory=out)


def views(directory):
    """Perspective views from the built route (car-height eye), for checking against photos."""
    import bpy
    from mathutils import Vector
    scene = bpy.context.scene
    shots = [('approach-far', (-277.9, -125.2, 2.6), (-40.0, -45.0, 22.0), 30),
             ('approach-near', (-165.7, -85.2, 2.6), (-60.0, -50.0, 20.0), 20),
             ('north-drive', (-45.0, -94.0, 2.6), (15.0, -79.0, 13.0), 18),
             ('north-close', (6.0, -96.5, 2.6), (6.0, -77.0, 19.0), 16),
             ('east-stern', (137.0, -40.0, 2.6), (96.0, 2.0, 16.0), 24),
             ('south-broken', (60.0, 105.0, 2.6), (8.0, 70.0, 14.0), 20),
             ('valadier-sw', (-175.0, 55.0, 1.7), (-80.0, -20.0, 20.0), 24),
             ('aerial', (150.0, 175.0, 150.0), (0.0, 0.0, 5.0), 28)]
    for name, eye, look, lens in shots:
        bpy.ops.object.camera_add(location=xyz(m.point(Qp(*eye))))
        cam = bpy.context.object
        cam.rotation_euler = (Vector(xyz(m.point(Qp(*look)))) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        scene.camera = cam
        scene.render.filepath = str(directory / (ID + '-' + name + '.png'))
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)


if out:
    views(out)
