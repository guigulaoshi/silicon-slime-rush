"""Blue Mosque (Sultan Ahmed Mosque / Sultanahmet Camii), Istanbul -- route `istanbul`.

The race runs the length of the Hippodrome (Atmeydani) past the north-west end of the forecourt, 30-35 m
from its outer wall, so the forecourt wall with its gate, the two forecourt minarets and the whole cascade
of domes behind them are the faces that matter; the qibla (south-east) end is seen only from far away.

Original geometry authored from public facts only (no image or third-party mesh is shipped).
Sources of every number (marked in the code as [osm], [wiki], [photo]):
  [osm]   relation 18055570 (outer ring = forecourt + prayer hall, inner ring = open court), measured in the
          model frame: 65.5 m across; forecourt v -56.9..-1.7 (55.2 m), prayer hall v -1.7..57.3 (59 m);
          open court 47 x 38 m; arcade depth 8.3-9.3 m.  Sadirvan way 400319967 (5 m hexagon).
  [wiki]  central dome 23.5 m diameter, 43 m high; six minarets, four with three serefe and two with two
          (sixteen balconies); minarets 64 m (OSM est_height 66.5).  Thirty small domes over the forecourt
          arcade, 26 columns.  28 windows in the dome drum.
  [photo] Wikimedia Commons views (listed in the report; not shipped): top-down aerial (plan of the domes,
          flat lead roofs over the side galleries, 8 facade turrets, gate dome), NW three-quarter view from
          above (stage heights of minarets and cascade), courtyard views (arcade columns, alternating
          voussoirs, hexagonal sadirvan with arches and a dome), street views from the Hippodrome.
          Heights of the arcade, walls, turrets and balcony stages are photo estimates scaled to the
          43 m dome and 64 m minarets.

Authoring frame (Model): u across the footprint (+ = north-east), v along it (+ = south-east, toward the
qibla wall), y up.  Ground: the DEM falls 2.3-2.6 m from the Hippodrome end (39.7 m) to the qibla end
(37.4 m); the game stands the model on the lowest ground, so the floor of the forecourt and prayer hall
sits on a stone podium FL = 2.4 m above the datum and every wall, pier and minaret is built down to y = 0.
No text anywhere: the calligraphic panels over the portals are left as blank stone panels.
"""
import math
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model
from build_moffett_aircraft import xyz

ID = 'blue-mosque'
M = Model(ID)
M.material('stone', (0.61, 0.59, 0.55), 0.0, 0.82, ID + '_stone')          # grey ashlar (kufeki limestone)
M.material('stone_dark', (0.56, 0.35, 0.29), 0.0, 0.8, ID + '_stone_red')   # red ablaq voussoirs [photo p15]
M.material('marble', (0.80, 0.80, 0.77), 0.0, 0.45, ID + '_marble')         # columns, sills, parapets
M.material('carved', (0.76, 0.75, 0.71), 0.0, 0.75, ID + '_carved')         # muqarnas corbels and capitals
M.material('lead', (0.47, 0.50, 0.54), 0.35, 0.55, ID + '_lead')            # lead-sheet domes and roofs
M.material('gold', (0.84, 0.66, 0.28), 1.0, 0.3, ID + '_gold')              # alem finials
M.material('glass', (0.07, 0.09, 0.11), 0.1, 0.2, ID + '_glass')            # window panes
M.material('iron', (0.10, 0.10, 0.10), 0.6, 0.5, ID + '_iron')              # window grilles
M.material('wood', (0.30, 0.19, 0.11), 0.0, 0.7, ID + '_wood')              # portal doors

FL = 2.4                                   # floor above the lowest ground [DEM survey]
def H(h): return FL + h
TAU = 2 * math.pi


# ------------------------------------------------------------------ primitive writers

def raw(verts, faces, mat, smooth=False):
    g = M.groups.setdefault(mat, [[], [], []])
    off = len(g[0])
    g[0].extend(xyz(M.point(p)) for p in verts)
    g[1].extend(tuple(i + off for i in f) for f in faces)
    g[2].extend(smooth if isinstance(smooth, list) else [smooth] * len(faces))
    M.authored_components += 1


class SF:
    """Straight wall frame: x along t, d along the outward normal n, both in (u, v)."""
    curved = False

    def __init__(s, o, t, n):
        s.o, s.t, s.n = o, t, n

    def p(s, x, y, d):
        return (s.o[0] + x * s.t[0] + d * s.n[0], y, s.o[1] + x * s.t[1] + d * s.n[1])


class CF:
    """Curved wall frame round centre c: x is arc length on radius R from angle a0, d is radial."""
    curved = True

    def __init__(s, c, R, a0=0.0):
        s.c, s.R, s.a0 = c, R, a0

    def p(s, x, y, d):
        a = s.a0 + x / s.R
        r = s.R + d
        return (s.c[0] + r * math.cos(a), y, s.c[1] + r * math.sin(a))


def densify(outline, step):
    out = []
    for a, b in zip(outline, outline[1:] + outline[:1]):
        out.append(a)
        n = int(abs(b[0] - a[0]) / step)
        for k in range(1, n):
            t = k / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def prism(fr, outline, d0, d1, mat):
    """Extrude a closed outline in the wall plane (x, y) through the wall (d0..d1)."""
    if fr.curved:
        outline = densify(outline, 1.0)
    n = len(outline)
    v = [fr.p(x, y, d0) for x, y in outline] + [fr.p(x, y, d1) for x, y in outline]
    f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    raw(v, f, mat)


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def box(u0, u1, y0, y1, v0, v1, mat='stone'):
    q = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    raw([(u, y0, v) for u, v in q] + [(u, y1, v) for u, v in q],
        [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat)


def run(fr, xs, prof, mat):
    """Sweep a closed section [(d, y)] along the wall through the stations xs (a moulding)."""
    n, m = len(prof), len(xs)
    v = [fr.p(x, y, d) for x in xs for d, y in prof]
    f = [tuple(reversed(range(n))), tuple((m - 1) * n + i for i in range(n))]
    for k in range(m - 1):
        for i in range(n):
            a, b = k * n + i, k * n + (i + 1) % n
            f.append((a, b, b + n, a + n))
    raw(v, f, mat)


def stations(fr, x0, x1):
    if not fr.curved:
        return [x0, x1]
    n = max(1, int(abs(x1 - x0) / 0.8))
    return [x0 + (x1 - x0) * k / n for k in range(n + 1)]


def revolve(c, prof, sides, mat, a0=None, a1=None, mod=None, smooth=True, phase=0.0):
    """Closed solid of revolution (full, or the sector a0..a1 closed by its two profile planes)."""
    uc, vc = c
    full = a0 is None
    apex = prof[-1][0] < 1e-6
    rp = prof[:-1] if apex else prof
    n = len(rp)
    angs = ([phase + TAU * j / sides for j in range(sides)] if full
            else [a0 + (a1 - a0) * j / sides for j in range(sides + 1)])
    cols = len(angs)
    V, F, S = [], [], []
    for r, y in rp:
        for j, a in enumerate(angs):
            m = mod(j) if mod else 1.0
            V.append((uc + r * m * math.cos(a), y, vc + r * m * math.sin(a)))
    idx = lambda i, j: i * cols + j
    js = range(cols) if full else range(cols - 1)
    for i in range(n - 1):
        for j in js:
            j2 = (j + 1) % cols
            F.append((idx(i, j), idx(i, j2), idx(i + 1, j2), idx(i + 1, j))); S.append(smooth)
    A = None
    if apex:
        A = len(V); V.append((uc, prof[-1][1], vc))
        for j in js:
            F.append((idx(n - 1, j), idx(n - 1, (j + 1) % cols), A)); S.append(smooth)
    if full:
        F.append(tuple(idx(0, j) for j in reversed(range(cols)))); S.append(False)
        if not apex:
            F.append(tuple(idx(n - 1, j) for j in range(cols))); S.append(False)
    else:
        Cb = len(V); V.append((uc, prof[0][1], vc))
        top = A
        if not apex:
            top = len(V); V.append((uc, prof[-1][1], vc))
        F.append(tuple([Cb] + [idx(i, 0) for i in range(n)] + [top])); S.append(False)
        F.append(tuple(reversed([Cb] + [idx(i, cols - 1) for i in range(n)] + [top]))); S.append(False)
        F.append(tuple([Cb] + [idx(0, j) for j in range(cols)])); S.append(False)
        if not apex:
            F.append(tuple(reversed([top] + [idx(n - 1, j) for j in range(cols)]))); S.append(False)
    raw(V, F, mat, S)


def annulus(c, r0, r1, y0, y1, sides, mat, smooth=False):
    uc, vc = c
    rings = [(r0, y0), (r1, y0), (r1, y1), (r0, y1)]
    V = [(uc + r * math.cos(TAU * j / sides), y, vc + r * math.sin(TAU * j / sides)) for r, y in rings for j in range(sides)]
    F = []
    for i in range(4):
        i2 = (i + 1) % 4
        for j in range(sides):
            j2 = (j + 1) % sides
            F.append((i * sides + j, i * sides + j2, i2 * sides + j2, i2 * sides + j))
    raw(V, F, mat, smooth)


def dome(c, r, y0, rise, mat='lead', sides=64, rings=14, smooth=True):
    prof = [(r * math.cos(t), y0 + rise * math.sin(t)) for t in [0.5 * math.pi * k / rings for k in range(rings)]]
    revolve(c, prof + [(0.0, y0 + rise)], sides, mat, smooth=smooth)


def half_dome(c, r, y0, rise, facing, mat='lead', sides=40, rings=12):
    prof = [(r * math.cos(t), y0 + rise * math.sin(t)) for t in [0.5 * math.pi * k / rings for k in range(rings)]]
    revolve(c, prof + [(0.0, y0 + rise)], sides, mat, a0=facing - math.pi / 2, a1=facing + math.pi / 2)


def alem(c, y0, s=1.0):
    """Gilded finial: stacked bulbs on a rod and a crescent open to the sky."""
    prof = [(0.09, 0), (0.09, 0.3), (0.26, 0.42), (0.30, 0.58), (0.10, 0.78), (0.21, 0.92), (0.23, 1.06),
            (0.08, 1.24), (0.06, 1.62), (0.0, 1.66)]
    revolve(c, [(r * s, y0 + y * s) for r, y in prof], 12, 'gold')
    R = 0.36 * s
    pts = [(c[0] + R * math.cos(a), y0 + 1.98 * s + R * math.sin(a), c[1])
           for a in [math.radians(125 + 290 * k / 14) for k in range(15)]]
    M.tube('crescent', pts, 0.075 * s, 'gold', 6)


# ------------------------------------------------------------------ arches, windows, mouldings

def arch(c, w, ys, kind, n=6):
    """Intrados from the left springing to the right springing, and the crown height."""
    if kind == 'flat':
        return [(c - w / 2, ys), (c + w / 2, ys)], ys
    if kind == 'round':
        R = w / 2
        return [(c + R * math.cos(math.pi * (1 - i / (2 * n))), ys + R * math.sin(math.pi * (1 - i / (2 * n))))
                for i in range(2 * n + 1)], ys + R
    e = 0.12 * w                                           # Ottoman two-centred arch, slightly pointed
    R = w / 2 + e
    t1 = math.acos(-e / R)
    left = [(c + e + R * math.cos(t), ys + R * math.sin(t)) for t in [math.pi + (t1 - math.pi) * i / n for i in range(n + 1)]]
    right = [(2 * c - x, y) for x, y in reversed(left[:-1])]
    return left + right, left[-1][1]


def opening_outline(o, n=6):
    pts, _ = arch(o['c'], o['w'], o['ys'], o['kind'], n)
    out = list(reversed(pts))
    if o['ys'] - o['sill'] > 1e-3:
        out = [(o['c'] - o['w'] / 2, o['sill']), (o['c'] + o['w'] / 2, o['sill'])] + out
    return out


def arched_wall(fr, x0, x1, y0, y1, d0, d1, ops, mat='stone', n=6):
    """A wall band with real openings: piers between them, sills below, arched spandrels above."""
    edge = x0
    for o in sorted(ops, key=lambda o: o['c']):
        L, R = o['c'] - o['w'] / 2, o['c'] + o['w'] / 2
        if L - edge > 1e-3:
            prism(fr, rect(edge, L, y0, y1), d0, d1, mat)
        if o['sill'] > y0 + 1e-3:
            prism(fr, rect(L, R, y0, o['sill']), d0, d1, mat)
        pts, crown = arch(o['c'], o['w'], o['ys'], o['kind'], n)
        assert y1 > crown + 0.04, (o, y1, crown)
        prism(fr, pts + [(R, y1), (L, y1)], d0, d1, mat)
        edge = R
    if x1 - edge > 1e-3:
        prism(fr, rect(edge, x1, y0, y1), d0, d1, mat)


def voussoirs(fr, o, dface, band=0.4, k=10, proud=0.07, mats=('stone', 'stone_dark')):
    """Alternating light and dark arch stones standing proud of the face round an opening."""
    c, w, ys, kind = o['c'], o['w'], o['ys'], o['kind']
    if kind == 'flat':
        return
    if kind == 'round':
        arcs = [((c, ys), w / 2, math.pi, 0.0, k)]
    else:
        e = 0.12 * w
        R = w / 2 + e
        t1 = math.acos(-e / R)
        arcs = [((c + e, ys), R, math.pi, t1, k // 2), ((c - e, ys), R, math.pi - t1, 0.0, k // 2)]
    i = 0
    for (cx, cy), R, ta, tb, kk in arcs:
        for g in range(kk):
            ts = [ta + (tb - ta) * (g + s / 2) / kk for s in range(3)]
            inner = [(cx + R * math.cos(t), cy + R * math.sin(t)) for t in ts]
            outer = [(cx + (R + band) * math.cos(t), cy + (R + band) * math.sin(t)) for t in reversed(ts)]
            prism(fr, inner + outer, dface, dface + proud, mats[i % 2])
            i += 1


def window(fr, x, w, sill, ys, d0, d1, style):
    """Fill one opening cut by arched_wall.  lower: rectangular light under a pointed relieving arch with
    a recessed stone tympanum and an iron grille; upper: arched light; both glazed at mid-wall."""
    o = dict(c=x, w=w, sill=sill, ys=ys, kind='pointed')
    mid = d0 + (d1 - d0) * 0.55
    if style == 'lower':
        prism(fr, rect(x - w / 2, x + w / 2, sill, ys - 0.28), mid - 0.06, mid + 0.06, 'glass')
        prism(fr, rect(x - w / 2, x + w / 2, ys - 0.28, ys), d0, d1 - 0.08, 'marble')        # lintel
        pts, _ = arch(x, w, ys, 'pointed')
        prism(fr, pts, d0, d1 - 0.22, 'stone')                                            # tympanum
        nb = max(3, int(w / 0.28))
        for b in range(1, nb):
            bx = x - w / 2 + w * b / nb
            prism(fr, rect(bx - 0.025, bx + 0.025, sill, ys - 0.28), d1 - 0.16, d1 - 0.1, 'iron')
        for by in (sill + (ys - sill) * 0.33, sill + (ys - sill) * 0.66):
            prism(fr, rect(x - w / 2, x + w / 2, by - 0.025, by + 0.025), d1 - 0.2, d1 - 0.16, 'iron')
        voussoirs(fr, o, d1, band=0.3, k=8)
    else:
        prism(fr, opening_outline(o), mid - 0.06, mid + 0.06, 'glass')
        voussoirs(fr, o, d1, band=0.28, k=8)


def windowed_band(fr, x0, x1, y0, y1, d0, d1, xs, w, sill, ys, style, mat='stone'):
    ops = [dict(c=x, w=w, sill=sill, ys=ys, kind='pointed') for x in xs]
    arched_wall(fr, x0, x1, y0, y1, d0, d1, ops, mat)
    for x in xs:
        window(fr, x, w, sill, ys, d0, d1, style)


def cornice(fr, x0, x1, ytop, proj=0.65, muq=True, dface=0.0):
    """Projecting cornice slab over a cavetto and a band of muqarnas cells."""
    xs = stations(fr, x0 - proj * 0.6, x1 + proj * 0.6)
    run(fr, xs, [(dface - 0.3, ytop - 0.24), (dface + proj, ytop - 0.24), (dface + proj, ytop), (dface - 0.3, ytop)], 'stone')
    run(fr, stations(fr, x0, x1), [(dface - 0.3, ytop - 0.62), (dface + 0.08, ytop - 0.62), (dface + proj * 0.8, ytop - 0.24),
                                   (dface - 0.3, ytop - 0.24)], 'carved')
    if not muq:
        return
    cell = 0.62
    n = int((x1 - x0) / cell)
    for i in range(n):
        xa = x0 + (x1 - x0) * i / n
        xb = x0 + (x1 - x0) * (i + 1) / n
        if i % 2 == 0:
            run(fr, [xa + 0.04, xb - 0.04], [(dface - 0.05, ytop - 1.2), (dface + 0.06, ytop - 1.2), (dface + 0.3, ytop - 0.62),
                                             (dface - 0.05, ytop - 0.62)], 'carved')
        else:
            run(fr, [xa + 0.1, xb - 0.1], [(dface - 0.05, ytop - 0.98), (dface + 0.04, ytop - 0.98), (dface + 0.18, ytop - 0.62),
                                           (dface - 0.05, ytop - 0.62)], 'carved')


def string_course(fr, x0, x1, y, dface=0.0, h=0.22, proj=0.12):
    run(fr, stations(fr, x0, x1), [(dface - 0.2, y), (dface + proj, y), (dface + proj, y + h), (dface - 0.2, y + h)], 'stone')


def poly_drum(c, apothem, sides, y0, y1, thick, win=None, phase=0.0, mat='stone'):
    """Polygonal drum: one straight wall per side, each with an optional arched window."""
    half = apothem * math.tan(math.pi / sides)
    for i in range(sides):
        a = phase + TAU * i / sides
        n = (math.cos(a), math.sin(a))
        t = (-math.sin(a), math.cos(a))
        fr = SF((c[0] + apothem * n[0], c[1] + apothem * n[1]), t, n)
        if win:
            w, sill, ys, kind = win
            o = dict(c=0.0, w=w, sill=sill, ys=ys, kind=kind)
            arched_wall(fr, -half, half, y0, y1, -thick, 0.0, [o], mat)
            prism(fr, opening_outline(o), -thick * 0.6, -thick * 0.45, 'glass')
        else:
            prism(fr, rect(-half, half, y0, y1), -thick, 0.0, mat)


def curved_windows(c, R, a0, a1, y0, y1, thick, count, w, sill, ys, kind='round', buttress=None):
    """A drum (full or a sector) of real window openings between piers, glazed inside, with buttresses."""
    fr = CF(c, R, a0)
    L = (a1 - a0) * R
    step = L / count
    xs = [step * (k + 0.5) for k in range(count)]
    ops = [dict(c=x, w=w, sill=sill, ys=ys, kind=kind) for x in xs]
    arched_wall(fr, 0.0, L, y0, y1, -thick, 0.0, ops)
    for o in ops:
        prism(fr, opening_outline(o), -thick * 0.6, -thick * 0.45, 'glass')
    if buttress:
        bw, bd, btop = buttress
        for k in range(count + (0 if abs(a1 - a0 - TAU) < 1e-6 else 1)):
            x = step * k
            run(fr, [x - bw / 2, x + bw / 2], [(-0.1, y0), (bd, y0), (bd, btop - bd * 1.4), (-0.1, btop)], 'stone')


# ------------------------------------------------------------------ plan (all [osm] unless marked)

U_OUT = 32.7          # outer faces, both sides
V_NW = -56.9          # forecourt outer wall
V_HALL = -1.7         # prayer-hall north-west wall (outer face) / forecourt south-east edge
V_QIB = 56.0          # qibla wall outer face; mihrab projection to 57.2
HC = (0.0, 27.15)     # centre of the central dome: middle of the hall's inner faces (0.3 .. 54.0)
SQ = 12.6             # half side of the square under the drum [wiki 23.5 m dome + piers]
COURT_W = 1.6         # forecourt outer wall thickness [photo]

# forecourt arcade column lines (inner ring of the multipolygon, pulled out by half a column)
CL_NW, CL_SE, CL_SIDE = -48.65, -9.55, 23.85
US = [-CL_SIDE + 2 * CL_SIDE * k / 7 for k in range(8)]           # 8 columns on each end row
VS = [CL_NW + (CL_SE - CL_NW) * k / 6 for k in range(7)]          # 7 columns on each side row (corners shared)
ARC_SPRING, ARC_TOP = H(6.0), H(10.9)                              # [photo] tall columns, arcade roof
ROOF_A = H(11.5)

# ------------------------------------------------------------------ podium and paving

box(-U_OUT, U_OUT, 0.0, FL, V_NW, V_QIB, 'stone')
for fr, x0, x1 in [(SF((0, V_NW), (1, 0), (0, -1)), -U_OUT, U_OUT), (SF((0, V_QIB), (1, 0), (0, 1)), -U_OUT, U_OUT),
                   (SF((U_OUT, 0), (0, 1), (1, 0)), V_NW, V_QIB), (SF((-U_OUT, 0), (0, 1), (-1, 0)), V_NW, V_QIB)]:
    run(fr, [x0 - 0.3, x1 + 0.3], [(-0.2, 0.0), (0.3, 0.0), (0.3, 0.45), (0.12, 0.62), (-0.2, 0.62)], 'stone')
box(-23.4, 23.4, FL - 0.1, FL + 0.04, -48.2, -10.0, 'marble')                       # court paving
# arcade stylobates, one step up from the court
box(-U_OUT + COURT_W, U_OUT - COURT_W, FL, H(0.35), V_NW + COURT_W, CL_NW + 0.7, 'marble')
box(-U_OUT + COURT_W, U_OUT - COURT_W, FL, H(0.35), CL_SE - 0.7, V_HALL, 'marble')
for s in (-1, 1):
    box(s * (CL_SIDE - 0.7), s * (U_OUT - COURT_W), FL, H(0.35), CL_NW, CL_SE, 'marble')

# ------------------------------------------------------------------ forecourt outer walls

WALL_TOP = ARC_TOP
FR_NW = SF((0, V_NW), (1, 0), (0, -1))
FR_SIDE = {s: SF((s * U_OUT, 0), (0, 1), (s, 0)) for s in (-1, 1)}
nw_bays = [(US[k] + US[k + 1]) / 2 for k in range(7)]                  # 0 is the gate bay
side_bays = [(VS[k] + VS[k + 1]) / 2 for k in range(6)]
GATE_SIDE_V = side_bays[3]
LW, LS, LY = 1.9, H(1.3), H(3.9)            # lower windows [photo]
UW, US_, UY = 1.5, H(6.4), H(8.4)           # upper windows [photo]


def outer_wall(fr, x0, x1, xs, gaps):
    """Two tiers of windows; `gaps` are x ranges left for portals."""
    segs, a = [], x0
    for g0, g1 in sorted(gaps):
        segs.append((a, g0)); a = g1
    segs.append((a, x1))
    for s0, s1 in segs:
        ws = [x for x in xs if s0 + 1.2 < x < s1 - 1.2]
        windowed_band(fr, s0, s1, 0.0, H(5.4), -COURT_W, 0.0, ws, LW, LS, LY, 'lower')
        windowed_band(fr, s0, s1, H(5.4), WALL_TOP, -COURT_W, 0.0, ws, UW, US_, UY, 'upper')
        string_course(fr, s0, s1, H(5.4))
        cornice(fr, s0, s1, ROOF_A)
        # openwork parapet of square piers under a coping rail [photo p14, p09]
        n = max(1, int((s1 - s0) / 1.35))
        for k in range(n + 1):
            x = s0 + 0.25 + (s1 - s0 - 0.5) * k / n
            prism(fr, rect(x - 0.2, x + 0.2, ROOF_A, ROOF_A + 0.95), -0.55, -0.15, 'stone')
        run(fr, [s0, s1], [(-0.62, ROOF_A + 0.95), (-0.08, ROOF_A + 0.95), (-0.08, ROOF_A + 1.17), (-0.62, ROOF_A + 1.17)], 'stone')


outer_wall(FR_NW, -U_OUT, U_OUT, [x for x in nw_bays if abs(x) > 1], [(-5.4, 5.4)])
for s in (-1, 1):
    outer_wall(FR_SIDE[s], V_NW, V_HALL, [v for v in side_bays if abs(v - GATE_SIDE_V) > 1] + [(CL_SE + V_HALL) / 2],
               [(GATE_SIDE_V - 3.9, GATE_SIDE_V + 3.9)])


def portal(fr, x, half, top, niche_w, niche_spring, door_w, door_spring, thick, proud, dome_r=None, leaves_open=True):
    """Monumental gate: a projecting block with a deep pointed niche hooded by muqarnas, a door through
    the back of the niche, a blank panel over it, a frame moulding and a cresting."""
    d_back = -thick
    niche_d = proud - 1.35
    o = dict(c=x, w=niche_w, sill=FL, ys=niche_spring, kind='pointed')
    arched_wall(fr, x - half, x + half, 0.0, top, niche_d, proud, [o])
    voussoirs(fr, o, proud, band=0.55, k=14, proud=0.08)
    door = dict(c=x, w=door_w, sill=FL, ys=door_spring, kind='pointed')
    arched_wall(fr, x - half, x + half, 0.0, top, d_back, niche_d, [door])
    voussoirs(fr, door, niche_d, band=0.35, k=10, proud=0.06)
    # muqarnas hood: tiers of cells stepping out from the niche back toward the arch
    _, crown = arch(x, niche_w, niche_spring, 'pointed')
    tiers = 6
    for t in range(tiers):
        y0 = door_spring + 2.6 + (crown - door_spring - 2.6) * t / tiers
        y1 = door_spring + 2.6 + (crown - door_spring - 2.6) * (t + 1) / tiers
        frac = (t + 1) / tiers
        halfw = niche_w / 2 * (1 - 0.25 * frac * frac) - 0.02
        cells = max(2, int(2 * halfw / 0.55))
        for k in range(cells):
            xa = x - halfw + 2 * halfw * k / cells
            xb = x - halfw + 2 * halfw * (k + 1) / cells
            depth = 0.25 + 1.0 * frac * (0.7 if k % 2 else 1.0)
            run(fr, [xa + 0.02, xb - 0.02], [(niche_d - 0.02, y0), (niche_d + depth * 0.4, y0), (niche_d + depth, y1),
                                             (niche_d - 0.02, y1)], 'carved')
    # blank panel (inscription left empty) between door and hood, and a rectangular frame moulding
    prism(fr, rect(x - door_w / 2 - 0.6, x + door_w / 2 + 0.6, door_spring + 1.4, door_spring + 2.5), niche_d, niche_d + 0.1, 'marble')
    fw = 0.35
    for x0_, x1_, y0_, y1_ in [(x - half + 0.3, x - half + 0.3 + fw, FL, top - 0.8), (x + half - 0.3 - fw, x + half - 0.3, FL, top - 0.8),
                               (x - half + 0.3, x + half - 0.3, top - 0.8 - fw, top - 0.8)]:
        prism(fr, rect(x0_, x1_, y0_, y1_), proud, proud + 0.1, 'marble')
    cornice(fr, x - half, x + half, top, proj=0.5, muq=False, dface=proud)
    for s in (-1, 1):                                      # engaged corner colonettes [photo p14]
        cc = fr.p(x + s * (half - 0.25), 0.0, proud)
        revolve((cc[0], cc[2]), [(0.3, FL), (0.3, FL + 0.5), (0.21, FL + 0.7), (0.21, top - 1.3), (0.3, top - 1.05),
                                 (0.3, top - 0.8), (0.0, top - 0.8)], 12, 'marble')
    for k in range(int(2 * half / 0.9)):
        cx = x - half + 0.45 + 0.9 * k
        prism(fr, [(cx - 0.3, top), (cx + 0.3, top), (cx + 0.3, top + 0.35), (cx, top + 0.75), (cx - 0.3, top + 0.35)],
              proud - 0.25, proud - 0.05, 'stone')                                          # cresting
    # door leaves: bronze-studded wood, swung open against the inner face
    if leaves_open:
        for s in (-1, 1):
            prism(fr, rect(x + s * door_w / 2, x + s * (door_w / 2 + door_w / 2 - 0.05), FL, door_spring + 0.6),
                  d_back - 0.14, d_back - 0.02, 'wood')
    else:
        pts, _ = arch(x, door_w, door_spring, 'pointed')
        prism(fr, [(x - door_w / 2, FL), (x + door_w / 2, FL)] + list(reversed(pts)), niche_d - 0.55, niche_d - 0.4, 'wood')
    if dome_r:
        ctr = fr.p(x, 0, (proud + d_back) / 2)
        cc = (ctr[0], ctr[2])
        poly_drum(cc, dome_r + 0.15, 8, top, top + 1.4, 0.5, win=(0.6, top + 0.25, top + 0.85, 'round'), phase=math.pi / 8)
        dome(cc, dome_r + 0.25, top + 1.4, dome_r * 0.95, sides=40, rings=10)
        alem(cc, top + 1.4 + dome_r * 0.95, 0.8)


# main gate on the Hippodrome side, with its own dome [photo aerial]; side gates NE / SW
portal(FR_NW, 0.0, 5.4, H(15.2), 5.6, H(8.0), 3.0, H(4.4), COURT_W, 0.35, dome_r=3.0)
for s in (-1, 1):
    portal(FR_SIDE[s], GATE_SIDE_V, 3.9, H(13.4), 4.4, H(6.6), 2.6, H(3.8), COURT_W, 0.3)

# ------------------------------------------------------------------ forecourt arcade (26 columns, 30 domes)


def column(c, y0, y1, r=0.44):
    uc, vc = c
    pl = r * 1.41
    box(uc - pl, uc + pl, y0, y0 + 0.35, vc - pl, vc + pl, 'marble')                  # plinth
    revolve(c, [(r * 1.27, y0 + 0.35), (r * 1.27, y0 + 0.5), (r + 0.05, y0 + 0.62), (r, y0 + 0.75), (r * 0.93, y1 - 1.0),
                (r * 1.02, y1 - 0.95), (r * 0.95, y1 - 0.9)], 20, 'marble')
    # muqarnas capital: faceted flare to a square abacus
    revolve(c, [(r * 0.95, y1 - 0.9), (r * 1.05, y1 - 0.72), (r * 1.3, y1 - 0.45), (pl * 1.16, y1 - 0.22), (pl * 1.16, y1 - 0.18)],
            16, 'carved', mod=lambda j: 1.0 if j % 2 == 0 else 0.86, smooth=False)
    box(uc - pl, uc + pl, y1 - 0.2, y1, vc - pl, vc + pl, 'marble')


courtyard_arch_rows = [
    (SF((0, CL_NW), (1, 0), (0, 1)), US, V_NW + COURT_W),
    (SF((0, CL_SE), (1, 0), (0, -1)), US, V_HALL),
]
for fr, cols, _ in courtyard_arch_rows:
    ops = [dict(c=(a + b) / 2, w=b - a - 0.9, sill=ARC_SPRING, ys=ARC_SPRING, kind='pointed') for a, b in zip(cols, cols[1:])]
    arched_wall(fr, cols[0] - 0.45, cols[-1] + 0.45, ARC_SPRING, ARC_TOP, -0.45, 0.45, ops)
    for o in ops:
        voussoirs(fr, o, 0.45, band=0.5, k=12, proud=0.06)
        voussoirs(fr, o, -0.51, band=0.5, k=12, proud=0.06)
    cornice(fr, cols[0], cols[-1], ARC_TOP + 0.55, proj=0.55, dface=0.45)
for s in (-1, 1):
    fr = SF((s * CL_SIDE, 0), (0, 1), (-s, 0))
    ops = [dict(c=(a + b) / 2, w=b - a - 0.9, sill=ARC_SPRING, ys=ARC_SPRING, kind='pointed') for a, b in zip(VS, VS[1:])]
    arched_wall(fr, VS[0] - 0.45, VS[-1] + 0.45, ARC_SPRING, ARC_TOP, -0.45, 0.45, ops)
    for o in ops:
        voussoirs(fr, o, 0.45, band=0.5, k=12, proud=0.06)
        voussoirs(fr, o, -0.51, band=0.5, k=12, proud=0.06)
    cornice(fr, VS[0], VS[-1], ARC_TOP + 0.55, proj=0.55, dface=0.45)

colpos = set()
for u in US:
    colpos.add((round(u, 3), CL_NW)); colpos.add((round(u, 3), CL_SE))
for v in VS:
    colpos.add((CL_SIDE, round(v, 3))); colpos.add((-CL_SIDE, round(v, 3)))
for c in sorted(colpos):
    column(c, H(0.35), ARC_SPRING)


def transverse(p0, p1):
    """Arch across the arcade from a column to the wall behind it, with a respond on the wall."""
    du, dv = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(du, dv)
    t = (du / L, dv / L)
    fr = SF(p0, t, (-t[1], t[0]))
    o = dict(c=(0.45 + L - 0.3) / 2, w=L - 0.3 - 0.45, sill=ARC_SPRING, ys=ARC_SPRING, kind='pointed')
    arched_wall(fr, 0.0, L, ARC_SPRING, ARC_TOP, -0.35, 0.35, [o])
    prism(fr, rect(L - 0.4, L, H(0.35), ARC_SPRING), -0.45, 0.45, 'stone')              # wall respond


for u in US:
    transverse((u, CL_NW), (u, V_NW + COURT_W))
    transverse((u, CL_SE), (u, V_HALL))
for v in VS:
    for s in (-1, 1):
        transverse((s * CL_SIDE, v), (s * (U_OUT - COURT_W), v))

# arcade roof: stone vault fill, lead skin, and the thirty domes on low octagonal drums
for u0, u1, v0, v1 in [(-U_OUT, U_OUT, V_NW, CL_NW + 0.45), (-U_OUT, U_OUT, CL_SE - 0.45, V_HALL),
                       (-U_OUT, -CL_SIDE + 0.45, CL_NW, CL_SE), (CL_SIDE - 0.45, U_OUT, CL_NW, CL_SE)]:
    box(u0, u1, ARC_TOP, ROOF_A - 0.1, v0, v1, 'stone')
    box(u0 + 0.3, u1 - 0.3, ROOF_A - 0.1, ROOF_A + 0.02, v0 + 0.3, v1 - 0.3, 'lead')
bays = []
row_nw_v = (V_NW + COURT_W + CL_NW) / 2
row_se_v = (CL_SE + V_HALL) / 2
side_u = (CL_SIDE + U_OUT - COURT_W) / 2
for x in [-side_u] + nw_bays + [side_u]:
    bays.append((x, row_nw_v)); bays.append((x, row_se_v))
for v in side_bays:
    bays.append((-side_u, v)); bays.append((side_u, v))
for (u, v) in bays:
    big = abs(u) < 1 and v > -20            # central bay of the portico before the prayer hall [photo]
    r = 3.25 if big else 2.9
    y0 = ROOF_A + (0.9 if big else 0.0)
    poly_drum((u, v), r + 0.1, 8, ROOF_A - 0.1, y0 + 0.7, 0.45, phase=math.pi / 8)
    annulus((u, v), r - 0.1, r + 0.18, y0 + 0.62, y0 + 0.78, 24, 'stone')
    dome((u, v), r + 0.05, y0 + 0.7, r * 0.92, sides=32, rings=8)
    revolve((u, v), [(0.12, y0 + 0.7 + r * 0.92 - 0.05), (0.12, y0 + 0.9 + r * 0.92), (0.2, y0 + 1.05 + r * 0.92),
                     (0.05, y0 + 1.35 + r * 0.92), (0.0, y0 + 1.5 + r * 0.92)], 8, 'lead')

# ------------------------------------------------------------------ sadirvan (hexagonal ablution fountain)
SC = (0.0, -29.1)                     # centre of the court [photo]; OSM puts it 6 m off-centre
revolve(SC, [(3.7, FL), (3.7, H(0.2)), (3.3, H(0.2)), (3.3, H(0.4)), (0.0, H(0.4))], 6, 'marble', smooth=False, phase=math.pi / 6)
revolve(SC, [(2.0, H(0.4)), (2.0, H(1.2)), (1.7, H(1.3)), (1.4, H(1.3)), (1.4, H(3.2)), (0.0, H(3.2))], 6, 'marble',
        smooth=False, phase=math.pi / 6)
for k in range(24):                                                                 # grille round the basin
    a = TAU * k / 24
    M.tube('grille', [(SC[0] + 1.62 * math.cos(a), H(1.3), SC[1] + 1.62 * math.sin(a)),
                      (SC[0] + 1.62 * math.cos(a), H(3.1), SC[1] + 1.62 * math.sin(a))], 0.03, 'iron', 4)
annulus(SC, 1.55, 1.7, H(3.05), H(3.2), 24, 'iron')
R_COL = 2.9
for k in range(6):
    a = TAU * k / 6 + math.pi / 6
    column((SC[0] + R_COL * math.cos(a), SC[1] + R_COL * math.sin(a)), H(0.4), H(3.6), r=0.2)
for k in range(6):                     # arches between the columns
    a0 = TAU * k / 6 + math.pi / 6
    a1 = a0 + TAU / 6
    p0 = (SC[0] + R_COL * math.cos(a0), SC[1] + R_COL * math.sin(a0))
    p1 = (SC[0] + R_COL * math.cos(a1), SC[1] + R_COL * math.sin(a1))
    L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    t = ((p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L)
    mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    nrm = (mid[0] - SC[0], mid[1] - SC[1])
    nl = math.hypot(*nrm)
    fr = SF(p0, t, (nrm[0] / nl, nrm[1] / nl))
    o = dict(c=L / 2, w=L - 0.62, sill=H(3.6), ys=H(3.6), kind='pointed')
    arched_wall(fr, -0.2, L + 0.2, H(3.6), H(5.6), -0.3, 0.3, [o])
    voussoirs(fr, o, 0.3, band=0.3, k=8, proud=0.04)
revolve(SC, [(3.55, H(5.6)), (3.55, H(5.85)), (3.2, H(6.05)), (0.0, H(6.05))], 6, 'stone', smooth=False, phase=math.pi / 6)
dome(SC, 3.0, H(6.05), 2.5, sides=40, rings=10)
alem(SC, H(8.5), 0.6)

# ------------------------------------------------------------------ prayer hall walls
HALL_TOP = H(18.0)           # the hall wall stands well clear of the portico domes [photo p16]
FR_HNW = SF((0, V_HALL), (1, 0), (0, -1))
FR_Q = SF((0, V_QIB), (1, 0), (0, 1))
FR_HS = {s: SF((s * 26.5, 0), (0, 1), (s, 0)) for s in (-1, 1)}
T_H = 2.0

# north-west wall inside the portico: portal in the middle, windows in each portico bay
hn_x = [-23.5, -18.0, -8.7, 8.7, 18.0, 23.5]                 # clear of the portal and the buttress turrets
for x0, x1 in [(-27.7, -6.0), (6.0, 27.7)]:
    xs = [x for x in hn_x if x0 + 1.2 < x < x1 - 1.2]
    windowed_band(FR_HNW, x0, x1, 0.0, H(5.4), -T_H, 0.0, xs, LW, LS, LY, 'lower')
    windowed_band(FR_HNW, x0, x1, H(5.4), ARC_TOP, -T_H, 0.0, xs, UW, US_, UY, 'upper')
    string_course(FR_HNW, x0, x1, H(5.4))
windowed_band(FR_HNW, -27.7, 27.7, ARC_TOP, HALL_TOP, -T_H, 0.0, [-22.5, -16.5, -9.0, 9.0, 16.5, 22.5], 1.4, H(13.2), H(15.4), 'upper')
cornice(FR_HNW, -27.7, 27.7, HALL_TOP + 0.3, proj=0.75)
portal(FR_HNW, 0.0, 6.0, H(17.4), 6.8, H(9.2), 3.3, H(4.8), T_H, 1.0, leaves_open=False)

# qibla wall: three tiers of windows and the mihrab projection
qx = [-22.5, -17.5, -7.5, 7.5, 17.5, 22.5]
windowed_band(FR_Q, -27.7, 27.7, 0.0, H(5.6), -T_H, 0.0, qx, LW, LS, LY, 'lower')
windowed_band(FR_Q, -27.7, 27.7, H(5.6), H(10.8), -T_H, 0.0, qx, 1.6, H(6.6), H(8.6), 'upper')
windowed_band(FR_Q, -27.7, 27.7, H(10.8), HALL_TOP, -T_H, 0.0, qx + [0.0], 1.5, H(12.4), H(14.6), 'upper')
for y in (H(5.6), H(10.8)):
    string_course(FR_Q, -27.7, 27.7, y)
cornice(FR_Q, -27.7, 27.7, HALL_TOP + 0.3, proj=0.75)
FR_MIH = SF((0, V_QIB + 1.2), (1, 0), (0, 1))
windowed_band(FR_MIH, -3.6, 3.6, 0.0, H(10.4), -1.2, 0.0, [0.0], 1.2, H(6.2), H(8.2), 'upper')
cornice(FR_MIH, -3.6, 3.6, H(10.7), proj=0.5, muq=False)
for s in (-1, 1):
    prism(SF((s * 3.6, 0), (0, 1), (s, 0)), rect(V_QIB - 0.1, V_QIB + 1.2, 0.0, H(10.4)), -0.6, 0.0, 'stone')
box(-3.9, 3.9, H(10.4), H(10.9), V_QIB - 0.1, V_QIB + 1.5, 'lead')

# side walls behind the galleries
GAL0, GAL1 = 3.3, 51.0
gal_bays = [GAL0 + (GAL1 - GAL0) * (k + 0.5) / 7 for k in range(7)]
gal_joints = [GAL0 + (GAL1 - GAL0) * k / 7 for k in range(1, 7)]
SIDE_TURRETS = [gal_joints[1], gal_joints[4]]     # over gallery piers, symmetric about the dome [photo aerial]
for s in (-1, 1):
    fr = FR_HS[s]
    windowed_band(fr, V_HALL, V_QIB, 0.0, H(5.4), -T_H, 0.0, gal_bays, LW, LS, LY, 'lower')
    windowed_band(fr, V_HALL, V_QIB, H(5.4), H(12.2), -T_H, 0.0, gal_bays, UW, H(8.2), H(10.0), 'upper')
    windowed_band(fr, V_HALL, V_QIB, H(12.2), HALL_TOP, -T_H, 0.0, [v for v in gal_joints if min(abs(v - t) for t in SIDE_TURRETS) > 2],
                  1.3, H(14.4), H(16.2), 'upper')
    cornice(fr, V_HALL, V_QIB, HALL_TOP + 0.3, proj=0.75)

# hall roof: lead over a stone slab; masonry filling the slot between the hall walls and the corner minarets
for s in (-1, 1):
    box(min(s * 26.5, s * 27.7), max(s * 26.5, s * 27.7), 0.0, H(12.0), V_HALL, GAL0)
    box(min(s * 26.5, s * 27.7), max(s * 26.5, s * 27.7), 0.0, H(12.0), GAL1, V_QIB)
# hall roof: lead over a stone slab
box(-26.5, 26.5, HALL_TOP - 0.6, HALL_TOP, V_HALL, V_QIB, 'stone')
box(-26.2, 26.2, HALL_TOP, HALL_TOP + 0.3, V_HALL + 0.3, V_QIB - 0.3, 'lead')
ROOF = HALL_TOP + 0.3

# ------------------------------------------------------------------ side galleries (two storeys, flat lead roof)
GAL_TOP = H(12.0)
for s in (-1, 1):
    fr = SF((s * U_OUT, 0), (0, 1), (s, 0))
    lo = [dict(c=v, w=(GAL1 - GAL0) / 7 - 1.1, sill=FL, ys=H(3.5), kind='pointed') for v in gal_bays]
    arched_wall(fr, GAL0, GAL1, 0.0, H(7.4), -0.9, 0.0, lo)
    hi = [dict(c=v, w=(GAL1 - GAL0) / 7 - 1.7, sill=H(8.0), ys=H(8.0), kind='pointed') for v in gal_bays]
    arched_wall(fr, GAL0, GAL1, H(7.4), GAL_TOP, -0.9, 0.0, hi)
    for o in lo + hi:
        voussoirs(fr, o, 0.0, band=0.45, k=12, proud=0.06)
    for o in hi:                                    # marble balustrade in the upper arches
        prism(fr, rect(o['c'] - o['w'] / 2, o['c'] + o['w'] / 2, H(7.4), H(8.4)), -0.55, -0.35, 'marble')
    string_course(fr, GAL0, GAL1, H(7.4), proj=0.18)
    cornice(fr, GAL0, GAL1, GAL_TOP + 0.3, proj=0.6)
    # floor between storeys, transverse arches, end walls
    box(min(s * 26.5, s * 31.8), max(s * 26.5, s * 31.8), H(7.0), H(7.4), GAL0, GAL1, 'stone')
    for v in [GAL0] + gal_joints + [GAL1]:
        tf = SF((s * 26.5, v), (s, 0), (0, 1))
        if v in (GAL0, GAL1):
            prism(tf, rect(0.0, 6.2, 0.0, GAL_TOP), -0.35, 0.35, 'stone')
        else:
            o = dict(c=2.9, w=4.6, sill=FL, ys=H(3.6), kind='pointed')
            arched_wall(tf, 0.0, 5.8, 0.0, H(7.0), -0.3, 0.3, [o])
    # flat lead roof, pitched slightly outward [photo aerial]
    u_in, u_out = s * 26.5, s * (U_OUT + 0.35)
    q = [(u_in, GAL0 - 0.3), (u_out, GAL0 - 0.3), (u_out, GAL1 + 0.3), (u_in, GAL1 + 0.3)]
    raw([(u, GAL_TOP + (0.9 if abs(u) < 27 else 0.25), v) for u, v in q] + [(u, GAL_TOP - 0.1, v) for u, v in q],
        [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], 'lead')

# ------------------------------------------------------------------ the cascade: drum, dome, semi-domes


def facing_of(dirv):
    return math.atan2(dirv[1], dirv[0])


# square block over the four piers (pendentive zone), up to the drum
BLOCK_TOP = H(29.8)
box(HC[0] - SQ, HC[0] + SQ, ROOF - 0.2, BLOCK_TOP, HC[1] - SQ, HC[1] + SQ, 'stone')
for dirv in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
    t = (-dirv[1], dirv[0])
    fr = SF((HC[0] + SQ * dirv[0], HC[1] + SQ * dirv[1]), t, dirv)
    cornice(fr, -SQ, SQ, BLOCK_TOP, proj=0.55)
    # stepped arch buttresses on the extrados of each great arch [photo p09]
    for s in (-1, 1):
        for k in range(4):
            x0 = s * (SQ - 1.2 - 1.6 * k)
            prism(fr, rect(min(x0, x0 - s * 1.6), max(x0, x0 - s * 1.6), BLOCK_TOP - 3.0, BLOCK_TOP + 0.9 - 0.8 * k), -0.5, 0.35, 'stone')

# drum: 28 windows with buttresses between them [wiki count]
DRUM_R = 12.45
DRUM_TOP = H(34.0)           # the lead dome rises only ~0.7 of its radius [photo p06 p09]
curved_windows(HC, DRUM_R, 0.0, TAU, BLOCK_TOP, DRUM_TOP, 0.8, 28, 1.3, H(30.6), H(32.6), 'round',
               buttress=(0.55, 0.75, DRUM_TOP + 0.9))
cornice(CF(HC, DRUM_R), 0.0, TAU * DRUM_R, DRUM_TOP, proj=0.35, muq=False)
# central dome: 23.5 m span, crown at 43 m [wiki]
annulus(HC, DRUM_R - 0.3, DRUM_R + 0.45, DRUM_TOP, DRUM_TOP + 0.45, 96, 'lead')
dome(HC, DRUM_R + 0.2, DRUM_TOP, H(43.0) - DRUM_TOP, sides=128, rings=26)
revolve(HC, [(0.9, H(42.8)), (0.9, H(43.4)), (0.55, H(43.7)), (0.0, H(43.7))], 16, 'lead')
alem(HC, H(43.6), 1.7)

# four semi-domes, each on a half-drum of windows and ringed by three exedrae [photo p06 p09, interior p04]
SEMI_R = 10.0                # the semi-domes read about 0.8 of the dome's width from above [photo p08]
SEMI_SPRING = H(20.6)        # a tall half-drum of windows, then a shallow lead half-dome [photo p06 p09]
for dirv in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
    th = facing_of(dirv)
    c = (HC[0] + (SQ - 0.05) * dirv[0], HC[1] + (SQ - 0.05) * dirv[1])
    curved_windows(c, SEMI_R, th - math.pi / 2, th + math.pi / 2, ROOF - 0.2, SEMI_SPRING, 0.8, 11, 0.9, ROOF + 0.35, ROOF + 1.5,
                   'round', buttress=(0.5, 0.6, SEMI_SPRING + 0.6))
    half_dome(c, SEMI_R + 0.25, SEMI_SPRING, 6.4, th, sides=64, rings=16)
    for da in (-62, 0, 62):
        a = th + math.radians(da)
        ec = (c[0] + 8.4 * math.cos(a), c[1] + 8.4 * math.sin(a))
        revolve(ec, [(3.95, ROOF - 0.2), (3.95, ROOF + 0.8), (0.0, ROOF + 0.8)], 24, 'stone', a0=a - math.pi / 2, a1=a + math.pi / 2)
        half_dome(ec, 4.0, ROOF + 0.8, 3.7, a, sides=32, rings=10)

# four corner domes on octagonal drums [photo aerial]
for su in (-1, 1):
    for sv in (-1, 1):
        cc = (HC[0] + su * 18.55, HC[1] + sv * 18.55)
        poly_drum(cc, 5.7, 8, ROOF - 0.2, H(20.8), 0.6, win=(1.1, H(18.8), H(19.8), 'round'), phase=math.pi / 8)
        cornice(CF(cc, 5.95), 0.0, TAU * 5.95, H(20.8), proj=0.3, muq=False)
        dome(cc, 5.75, H(20.8), 4.9, sides=48, rings=12)
        alem(cc, H(20.8) + 4.85, 0.8)

# four weight turrets at the corners of the dome square [photo p06 p09]
for su in (-1, 1):
    for sv in (-1, 1):
        tc = (HC[0] + su * SQ, HC[1] + sv * SQ)
        revolve(tc, [(2.45, ROOF - 0.2), (2.45, H(30.4))], 8, 'stone', smooth=False, phase=math.pi / 8)
        string_course(CF(tc, 2.45), 0.0, TAU * 2.45, H(24.0))
        poly_drum(tc, 2.3, 8, H(30.4), H(33.2), 0.5, win=(0.8, H(31.0), H(32.2), 'round'), phase=0.0)
        cornice(CF(tc, 2.45), 0.0, TAU * 2.45, H(33.5), proj=0.3, muq=False)
        dome(tc, 2.35, H(33.5), 2.2, sides=32, rings=8)
        alem(tc, H(35.6), 0.75)

# eight facade buttress turrets rising above the walls [photo aerial]
bt = [((s * 12.6, V_HALL - 0.9)) for s in (-1, 1)] + [((s * 12.6, V_QIB + 0.9)) for s in (-1, 1)] + \
     [((s * 27.3, v)) for s in (-1, 1) for v in SIDE_TURRETS]
for c in bt:
    box(c[0] - 1.35, c[0] + 1.35, 0.0, HALL_TOP, c[1] - 1.35, c[1] + 1.35, "stone")
    revolve(c, [(1.45, HALL_TOP), (1.45, H(22.6))], 8, 'stone', smooth=False, phase=math.pi / 8)
    poly_drum(c, 1.36, 8, H(22.6), H(25.2), 0.3, win=(0.5, H(23.2), H(24.3), 'round'))
    cornice(CF(c, 1.45), 0.0, TAU * 1.45, H(25.4), proj=0.22, muq=False)
    dome(c, 1.5, H(25.4), 1.4, sides=24, rings=6)
    alem(c, H(26.8), 0.5)

# ------------------------------------------------------------------ six minarets


def minaret(c, ped, ped_top, balconies, petek_top, cone_top, r0=1.62):
    """Square pedestal with blind arches, faceted transition, fluted shaft, serefe on muqarnas corbels with
    an openwork parapet, upper shaft, tall lead cone and a gilded alem."""
    uc, vc = c
    h = ped / 2
    box(uc - h, uc + h, 0.0, ped_top, vc - h, vc + h, 'stone')
    for dirv in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        t = (-dirv[1], dirv[0])
        fr = SF((uc + h * dirv[0], vc + h * dirv[1]), t, dirv)
        for y in [H(5.4), ped_top - 4.2]:
            string_course(fr, -h - 0.12, h + 0.12, y, proj=0.1)
        o = dict(c=0.0, w=ped - 1.3, sill=ped_top - 3.6, ys=ped_top - 2.1, kind='pointed')
        voussoirs(fr, o, 0.0, band=0.3, k=8, proud=0.08)
        for s in (-1, 1):
            prism(fr, rect(s * (ped / 2 - 0.65) - 0.15 * (s + 1), s * (ped / 2 - 0.65) + 0.15 * (1 - s), H(5.7), ped_top - 2.1), 0.0, 0.08, 'stone')
        cornice(fr, -h, h, ped_top, proj=0.35, muq=False)
    # transition from the square to the sixteen-sided shaft
    revolve(c, [(h * 1.02, ped_top), (h * 1.02, ped_top + 0.3), (r0 * 1.12, ped_top + 2.6), (r0 * 1.12, ped_top + 2.8)], 16, 'stone',
            smooth=False, phase=math.pi / 16)
    flute = lambda j: 1.0 if j % 2 == 0 else 0.955
    y, r = ped_top + 2.8, r0
    annulus(c, r - 0.05, r + 0.14, y - 0.1, y + 0.18, 32, 'stone')
    for hb in balconies:
        base = hb - 2.2
        revolve(c, [(r, y), (r * 0.99, base)], 32, 'stone', mod=flute, smooth=False)
        rb = r + 1.25
        revolve(c, [(r + 0.02, base), (r + 0.12, base + 0.35), (r + 0.3, base + 0.75), (r + 0.55, base + 1.2),
                    (r + 0.85, base + 1.65), (rb - 0.02, hb - 0.12), (rb, hb)], 48, 'carved',
                mod=lambda j: 1.0 if j % 2 == 0 else 0.93, smooth=False)
        annulus(c, r * 0.5, rb + 0.05, hb, hb + 0.22, 48, 'stone')
        for k in range(24):
            a = TAU * (k + 0.5) / 24
            p = (uc + (rb - 0.1) * math.cos(a), vc + (rb - 0.1) * math.sin(a))
            fr = SF(p, (-math.sin(a), math.cos(a)), (math.cos(a), math.sin(a)))
            run(fr, [-0.07, 0.07], [(-0.07, hb + 0.22), (0.07, hb + 0.22), (0.07, hb + 1.05), (-0.07, hb + 1.05)], 'marble')
            a2 = TAU * (k + 1.5) / 24
            q0 = (uc + (rb - 0.1) * math.cos(a), hb + 0.3, vc + (rb - 0.1) * math.sin(a))
            q1 = (uc + (rb - 0.1) * math.cos(a2), hb + 0.95, vc + (rb - 0.1) * math.sin(a2))
            q2 = (uc + (rb - 0.1) * math.cos(a), hb + 0.95, vc + (rb - 0.1) * math.sin(a))
            q3 = (uc + (rb - 0.1) * math.cos(a2), hb + 0.3, vc + (rb - 0.1) * math.sin(a2))
            M.tube('lattice', [q0, q1], 0.028, 'marble', 4)
            M.tube('lattice', [q2, q3], 0.028, 'marble', 4)
        for y0_, y1_ in [(hb + 0.22, hb + 0.3), (hb + 0.6, hb + 0.66), (hb + 1.05, hb + 1.17)]:
            annulus(c, rb - 0.2, rb, y0_, y1_, 32, 'marble')
        y, r = hb + 0.22, r * 0.97
    rp = r * 0.86
    revolve(c, [(r, y), (rp, y + 0.3), (rp, petek_top)], 32, 'stone', mod=flute, smooth=False)
    annulus(c, rp - 0.05, rp + 0.2, petek_top - 0.55, petek_top - 0.25, 32, 'stone')
    revolve(c, [(rp + 0.3, petek_top), (rp + 0.3, petek_top + 0.18), (rp + 0.08, petek_top + 0.5), (0.14, cone_top - 0.1),
                (0.0, cone_top)], 32, 'lead')
    alem(c, cone_top - 0.1, 1.08)


# stage heights from the photos, scaled so the alem tops out at 64 m [wiki]; forecourt minarets carry
# the lower two balconies only and stop one stage short [photo p09]
HALL_BALC = [H(27.4), H(36.3), H(45.2)]
for s in (-1, 1):
    minaret((s * 30.2, 0.8), 5.0, H(18.6), HALL_BALC, H(51.5), H(61.4))
    minaret((s * 30.2, 53.5), 5.0, H(18.6), HALL_BALC, H(51.5), H(61.4))
    minaret((s * 30.7, -54.9), 4.0, H(12.6), HALL_BALC[:2], H(42.6), H(52.5))

M.finish(directory=(Path(tempfile.gettempdir()) / 'sr-landmarks' / 'blue-mosque'))
