"""Former HSBC Building (No. 12 the Bund, Shanghai), the neoclassical bank with the central dome.

The shanghai route drives north up Zhongshan East No.1 Road about 26 m in front of the east facade
(tier: touching), at night, so the east facade, its south flank and the dome are the faces that matter.

Original geometry authored from public facts only (no image or third-party mesh is shipped):
  footprint  OSM relation 2380996 (owned by pipeline/landmarks.json); facade line 83 m, NE corner rounded
  storeys    zh.wikipedia / Shanghai gazetteer: 5 storeys, centre 7; six Ionic columns through floors 2-4,
             single-double-double-single; rusticated granite base with 3 arched doorways; octagonal hall
             under the dome
  heights    photo estimates from a near-orthographic frontal photo (facade 83 m = 1670 px):
             base 0-9.5, main cornice 22.9-24.3, attic parapet 28.5-29.0, tower 28.5-40.3,
             dome crown ~48, spire tip ~54.5 (the star finial above it is left out)
  plan       dome centre 13.6 m behind the facade (1920s ground floor plan, 100 ft scale bar)

Authoring frame: s along the facade (+ = south), n outward from the facade (+ = east, toward the
road), y up, metres; W() turns it into the survey's (u, y, v) frame. No text or emblems anywhere:
the name band over the doors is not built and the star finial is replaced by a plain ball.
"""
import math
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model
from build_moffett_aircraft import xyz

ID = 'bund-hsbc-building'
M = Model(ID)
M.material('stone', (0.80, 0.68, 0.49), 0.0, 0.72, ID + '_stone')          # warm granite, floodlit gold at night
M.material('dome', (0.84, 0.78, 0.66), 0.0, 0.6, ID + '_stone_dome')      # pale granite dome
M.material('granite', (0.46, 0.41, 0.35), 0.0, 0.55, ID + '_granite')     # darker plinth
M.material('carved', (0.86, 0.76, 0.58), 0.0, 0.65, ID + '_carved')      # capitals, pediments, balusters
M.material('glass', (0.09, 0.09, 0.08), 0.2, 0.15, ID + '_glass')         # lit windows at night
M.material('bronze', (0.26, 0.19, 0.11), 0.85, 0.4, ID + '_bronze')       # doors, frames, lions, lamps

# Facade frame from the surveyed footprint: east edge (32.4,-37.9) -> (27.7,45.0) in (u, v).
FA, FB = (32.4, -37.9), (27.7, 45.0)
_L = math.dist(FA, FB)
T = ((FB[0] - FA[0]) / _L, (FB[1] - FA[1]) / _L)     # +s (south)
N = (T[1], -T[0])                                     # +n (east, outward)
C = ((FA[0] + FB[0]) / 2, (FA[1] + FB[1]) / 2)


def W(p):
    s, y, n = p
    return (C[0] + s * T[0] + n * N[0], y, C[1] + s * T[1] + n * N[1])


def raw(verts, faces, mat, smooth=False):
    g = M.groups.setdefault(mat, [[], [], []])
    off = len(g[0])
    g[0].extend(xyz(M.point(W(p))) for p in verts)
    g[1].extend(tuple(i + off for i in f) for f in faces)
    if isinstance(smooth, bool):
        smooth = [smooth] * len(faces)
    g[2].extend(smooth)
    M.authored_components += 1


BOXF = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


class Fr:
    """Wall frame: x along the wall, y up, d outward; origin (s0, n0)."""
    def __init__(s, s0, n0, t, o):
        s.s0, s.n0, s.t, s.o = s0, n0, t, o

    def p(s, x, y, d):
        return (s.s0 + x * s.t[0] + d * s.o[0], y, s.n0 + x * s.t[1] + d * s.o[1])


def seg_frame(a, b, outward_sign=1):
    """Frame along plan segment a->b (s, n); outward normal chosen by sign."""
    L = math.dist(a, b)
    t = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
    o = (t[1] * outward_sign, -t[0] * outward_sign)
    return Fr(a[0], a[1], t, o), L


PLAN = Fr(0, 0, (1, 0), (0, 1))          # x = s, d = n


def box(fr, x0, x1, y0, y1, d0, d1, mat='stone'):
    if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or d1 - d0 < 1e-4:
        return
    q = [(x0, d0), (x1, d0), (x1, d1), (x0, d1)]
    raw([fr.p(x, y0, d) for x, d in q] + [fr.p(x, y1, d) for x, d in q], BOXF, mat)


def pbox(s0, s1, y0, y1, n0, n1, mat='stone'):
    box(PLAN, s0, s1, y0, y1, n0, n1, mat)


def prism(fr, pts, d0, d1, mat='stone'):
    """Outline (x, y) extruded along d."""
    n = len(pts)
    v = [fr.p(x, y, d0) for x, y in pts] + [fr.p(x, y, d1) for x, y in pts]
    f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    raw(v, f, mat)


def plan_prism(pts, y0, y1, mat='stone'):
    """Plan outline (s, n) extruded in y."""
    n = len(pts)
    v = [(s, y0, q) for s, q in pts] + [(s, y1, q) for s, q in pts]
    f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    raw(v, f, mat)


def lathe(sc, nc, prof, sides, mat='stone', phase=0.0, mod=None, smooth=True):
    v = []
    for r, y in prof:
        for j in range(sides):
            t = phase + 2 * math.pi * j / sides
            m = mod(j) if mod else 1.0
            v.append((sc + r * m * math.cos(t), y, nc + r * m * math.sin(t)))
    n = len(prof)
    f = [tuple(reversed(range(sides))), tuple(range((n - 1) * sides, n * sides))]
    for i in range(n - 1):
        for j in range(sides):
            a = i * sides + j
            b = i * sides + (j + 1) % sides
            f.append((a, b, b + sides, a + sides))
    raw(v, f, mat, [False, False] + [smooth] * (len(f) - 2))


def sweep(path, prof, mat='stone', closed=False, smooth=False):
    """Closed profile (d, y) swept along plan points [(s, n, os, on)] (o = offset direction incl. miter)."""
    k = len(prof)
    v = []
    for s, q, os_, on in path:
        v.extend((s + d * os_, y, q + d * on) for d, y in prof)
    m = len(path)
    f = []
    last = m if closed else m - 1
    for i in range(last):
        a, b = i * k, ((i + 1) % m) * k
        for j in range(k):
            f.append((a + j, a + (j + 1) % k, b + (j + 1) % k, b + j))
    if not closed:
        f += [tuple(reversed(range(k))), tuple(range((m - 1) * k, m * k))]
    raw(v, f, mat, smooth)


def loop_path(pts):
    """Closed plan polygon -> sweep path with outward miter vectors."""
    n = len(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    sg = 1 if area < 0 else -1
    out = []
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        def nrm(a, b):
            L = math.dist(a, b)
            return (sg * (b[1] - a[1]) / L, -sg * (b[0] - a[0]) / L)
        n1, n2 = nrm(p0, p1), nrm(p1, p2)
        k = 1 + n1[0] * n2[0] + n1[1] * n2[1]
        out.append((p1[0], p1[1], (n1[0] + n2[0]) / k, (n1[1] + n2[1]) / k))
    return out


def circle(sc, nc, r, n):
    return [(sc + r * math.cos(2 * math.pi * i / n), nc + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def tube(pts, radius, mat, sides=6):
    v = []
    for i, p in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        t = [b[k] - a[k] for k in range(3)]
        L = math.sqrt(sum(x * x for x in t)) or 1
        t = [x / L for x in t]
        ref = (0, 1, 0) if abs(t[1]) < 0.9 else (1, 0, 0)
        u = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]]
        L = math.sqrt(sum(x * x for x in u)); u = [x / L for x in u]
        w = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]]
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        for j in range(sides):
            th = 2 * math.pi * j / sides
            v.append(tuple(p[k] + r * (u[k] * math.cos(th) + w[k] * math.sin(th)) for k in range(3)))
    m = len(pts)
    f = [tuple(reversed(range(sides))), tuple(range((m - 1) * sides, m * sides))]
    for i in range(m - 1):
        for j in range(sides):
            a = i * sides + j; b = i * sides + (j + 1) % sides
            f.append((a, b, b + sides, a + sides))
    raw(v, f, mat, True)


# ------------------------------------------------------------------ wall grammar

def holes_wall(fr, x0, x1, y0, y1, d0, d1, holes, mat='stone'):
    """Solid wall slab with rectangular holes (hx0, hx1, hy0, hy1), as boxes."""
    xs = sorted({x0, x1} | {min(max(h[i], x0), x1) for h in holes for i in (0, 1)})
    for a, b in zip(xs, xs[1:]):
        if b - a < 1e-4:
            continue
        cov = sorted((h[2], h[3]) for h in holes if h[0] <= a + 1e-6 and h[1] >= b - 1e-6)
        y = y0
        for ha, hb in cov:
            if ha > y:
                box(fr, a, b, y, min(ha, y1), d0, d1, mat)
            y = max(y, hb)
        if y < y1:
            box(fr, a, b, y, y1, d0, d1, mat)


def arch_spandrel(fr, xc, r, ys, ytop, d0, d1, mat='stone', n=14):
    pts = [(xc - r, ys), (xc - r, ytop), (xc + r, ytop), (xc + r, ys)]
    pts += [(xc + r * math.cos(math.pi * i / n), ys + r * math.sin(math.pi * i / n)) for i in range(1, n)]
    prism(fr, pts, d0, d1, mat)


def arch_glass(fr, xc, r, y0, ys, d0, d1, mat='glass', n=14):
    pts = [(xc - r, y0), (xc + r, y0)] + [(xc + r * math.cos(math.pi * i / n), ys + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    prism(fr, pts, d0, d1, mat)


def voussoirs(fr, xc, ys, r0, r1, d0, d1, count=9, key=0.3, mat='stone'):
    for i in range(count):
        a0 = math.pi * i / count + 0.012
        a1 = math.pi * (i + 1) / count - 0.012
        mid = i == count // 2
        ro = r1 + (key if mid else 0)
        dd = d1 + (0.06 if mid else 0)
        c = [(r0, a0), (ro, a0), (ro, a1), (r0, a1)]
        v = [fr.p(xc + r * math.cos(a), ys + r * math.sin(a), d0) for r, a in c]
        v += [fr.p(xc + r * math.cos(a), ys + r * math.sin(a), dd) for r, a in c]
        raw(v, BOXF, mat)


def courses(fr, x0, x1, y0, y1, d0, d1, shapes, pitch=0.55, gap=0.07, mat='stone'):
    """Channelled rustication: course slabs, cut around openings.
    shapes: ('rect', xa, xb, ya, yb, margin) or ('arch', xc, ys, R)."""
    y = y0
    while y < y1 - 0.05:
        yl, yh = y, min(y + pitch - gap, y1)
        ex = []
        for sh in shapes:
            if sh[0] == 'rect':
                _, xa, xb, ya, yb, m = sh
                if yl < yb + m and yh > ya - m:
                    ex.append((xa - m, xb + m))
            else:
                _, xc, ys, R = sh
                if yh > ys and yl < ys + R:
                    hw = R if yl <= ys else math.sqrt(max(0.0, R * R - (yl - ys) ** 2))
                    ex.append((xc - hw, xc + hw))
        ex.sort()
        xa = x0
        for a, b in ex:
            if a > xa:
                box(fr, xa, min(a, x1), yl, yh, d0, d1, mat)
            xa = max(xa, b)
        if xa < x1:
            box(fr, xa, x1, yl, yh, d0, d1, mat)
        y += pitch


def architrave(fr, xa, xb, ya, yb, w=0.18, d0=0.4, d1=0.53, mat='stone'):
    box(fr, xa - w, xa, ya, yb + w, d0, d1, mat)
    box(fr, xb, xb + w, ya, yb + w, d0, d1, mat)
    box(fr, xa, xb, yb, yb + w, d0, d1, mat)


def glazing(fr, xa, xb, ya, yb, transom=True, mullion=True):
    box(fr, xa, xb, ya, yb, -0.05, 0.08, 'glass')
    xc = (xa + xb) / 2
    if mullion:
        box(fr, xc - 0.04, xc + 0.04, ya, yb, 0.08, 0.14, 'bronze')
    if transom:
        yt = ya + (yb - ya) * 0.72
        box(fr, xa, xb, yt - 0.04, yt + 0.04, 0.08, 0.14, 'bronze')


def sill(fr, xa, xb, y, ext=0.2, d1=0.62, brackets=True):
    box(fr, xa - ext, xb + ext, y - 0.2, y, 0.0, d1, 'stone')
    if brackets:
        for x in (xa + 0.05, xb - 0.27):
            box(fr, x, x + 0.22, y - 0.55, y - 0.2, 0.4, d1 - 0.06, 'carved')


def hood(fr, xa, xb, y, kind='flat'):
    """Window head: frieze + cornice hood on consoles, optional pediment."""
    box(fr, xa - 0.2, xb + 0.2, y, y + 0.2, 0.4, 0.55, 'stone')
    for x in (xa - 0.38, xb + 0.18):
        box(fr, x, x + 0.2, y - 0.65, y + 0.2, 0.4, 0.68, 'carved')
    box(fr, xa - 0.45, xb + 0.45, y + 0.2, y + 0.42, 0.4, 0.8, 'stone')
    xc, hw = (xa + xb) / 2, (xb - xa) / 2 + 0.45
    if kind == 'tri':
        prism(fr, [(xc - hw, y + 0.42), (xc + hw, y + 0.42), (xc, y + 1.05)], 0.4, 0.78, 'carved')
    elif kind == 'seg':
        pts = [(xc - hw, y + 0.42), (xc + hw, y + 0.42)]
        R = (hw * hw + 0.5 ** 2) / (2 * 0.5)
        for i in range(1, 12):
            x = xc + hw - 2 * hw * i / 12
            pts.append((x, y + 0.42 + math.sqrt(R * R - (x - xc) ** 2) - (R - 0.5)))
        prism(fr, pts, 0.4, 0.78, 'carved')


def baluster(sc, nc, y0, h=0.9, sides=8):
    k = h / 0.9
    prof = [(0.1, 0), (0.1, 0.07), (0.065, 0.11), (0.085, 0.2), (0.125, 0.36), (0.115, 0.48), (0.07, 0.62),
            (0.055, 0.68), (0.085, 0.74), (0.1, 0.8), (0.1, 0.9)]
    lathe(sc, nc, [(r * min(k, 1.2), y0 + y * k) for r, y in prof], sides, 'carved')


def balustrade(fr, x0, x1, y0, dc, h=1.0, spacing=0.34, depth=0.34):
    box(fr, x0, x1, y0, y0 + 0.14, dc - depth / 2, dc + depth / 2, 'stone')
    box(fr, x0 - 0.02, x1 + 0.02, y0 + h - 0.14, y0 + h, dc - depth / 2 - 0.04, dc + depth / 2 + 0.04, 'stone')
    n = max(1, int((x1 - x0) / spacing))
    for i in range(n):
        x = x0 + (i + 0.5) * (x1 - x0) / n
        s, _, q = fr.p(x, 0, dc)
        baluster(s, q, y0 + 0.14, h - 0.28)


# ------------------------------------------------------------------ plan and heights

Y_PLINTH, Y_BASE, Y_BELT = 0.9, 8.6, 9.5
Y_CORN0, Y_CORN1 = 22.9, 24.3
Y_ATTIC, Y_PARA = 28.5, 29.0
F1, F2, F3 = (10.2, 13.4), (14.8, 17.3), (18.7, 21.0)
GROUND, MEZZ = (1.4, 4.3), (5.4, 6.9)
ATTIC_WIN = (25.0, 26.8)
SOUTH, NORTH, BACK_S, BACK_N = 41.5, -44.0, -55.5, -63.5
RC = 2.5                                   # NE corner radius (OSM chamfer)
TOWER = (0.0, -13.6)                       # dome axis (ground floor plan)
LOGGIA = 9.25                              # colonnade half width
COLS = [-8.4, -4.0, -2.25, 2.25, 4.0, 8.4]
ARCHES = [-6.3, 0.0, 6.3]

corner_arc = [(-41.5 + RC * math.cos(math.radians(a)), -RC + RC * math.sin(math.radians(a))) for a in range(90, 181, 10)]
PERIM = [(SOUTH, 0.0), (SOUTH, BACK_S), (NORTH, BACK_N), (NORTH, -RC)] + corner_arc[::-1][1:-1] + [(-41.5, 0.0)]


def perimeter(notch):
    """Plan outline, with the loggia/door recess `notch` metres deep between the anta piers."""
    pts = list(PERIM)
    if notch:
        pts += [(-LOGGIA, 0.0), (-LOGGIA, -notch), (LOGGIA, -notch), (LOGGIA, 0.0)]
    return pts


# core masses
plan_prism(perimeter(1.5), 0.0, Y_BELT)
plan_prism(perimeter(2.5), Y_BELT, 21.5)
plan_prism(perimeter(0), 21.5, Y_ATTIC)

# horizontal bands all the way round (mitred at every corner)
LOOP = loop_path(PERIM)
sweep(LOOP, [(0, 0), (0.78, 0), (0.78, 0.7), (0.62, Y_PLINTH), (0, Y_PLINTH)], 'granite', closed=True)
sweep(LOOP, [(0, Y_BASE), (0.66, Y_BASE), (0.66, 8.78), (0.76, 8.95), (0.76, 9.25), (0.56, 9.4), (0.45, Y_BELT), (0, Y_BELT)], closed=True)
sweep(LOOP, [(0, Y_CORN0), (0.52, Y_CORN0), (0.52, 23.45), (0.64, 23.45), (0.64, 23.7), (1.5, 23.72), (1.5, 24.08),
             (1.3, 24.17), (0.95, Y_CORN1), (0, Y_CORN1)], closed=True)
sweep(LOOP, [(0, 27.8), (0.5, 27.8), (0.5, 28.0), (0.9, 28.1), (0.9, 28.36), (0.7, Y_ATTIC), (0, Y_ATTIC)], closed=True)
sweep(LOOP, [(-0.45, Y_ATTIC), (0.42, Y_ATTIC), (0.42, 28.9), (0.5, 28.95), (0.5, Y_PARA), (-0.45, Y_PARA)], closed=True)
# modillions under the main cornice corona, all round
for (s0, n0, _, _), (s1, n1, _, _) in zip(LOOP, LOOP[1:] + LOOP[:1]):
    fr, L = seg_frame((s0, n0), (s1, n1), 1 if sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(PERIM, PERIM[1:] + PERIM[:1])) < 0 else -1)
    k = int(L / 0.85)
    for i in range(1, k):
        x = L * i / k
        box(fr, x - 0.12, x + 0.12, 23.3, 23.72, 0.5, 1.32, 'carved')


def bay_windows(fr, xc, hw, trims, base='rect', attic=True, rustic=True, xr=None):
    """One vertical window stack on a flat wall run: base (ground + mezzanine or an arched door),
    three main floors and the attic. trims: per floor ('hood-flat'|'hood-tri'|'hood-seg'|'sill'|'balc')."""
    x0, x1 = xr
    # base
    shapes = []
    if base == 'rect':
        holes = [(xc - hw, xc + hw, *GROUND), (xc - hw, xc + hw, *MEZZ)]
        shapes = [('rect', xc - hw, xc + hw, *GROUND, 0.18), ('rect', xc - hw, xc + hw, *MEZZ, 0.18)]
        holes_wall(fr, x0, x1, Y_PLINTH, Y_BASE, 0, 0.4, holes)
        for ya, yb in (GROUND, MEZZ):
            glazing(fr, xc - hw, xc + hw, ya, yb, transom=(yb - ya > 2))
            architrave(fr, xc - hw, xc + hw, ya, yb, 0.16, 0.4, 0.58)
            box(fr, xc - hw - 0.16, xc + hw + 0.16, ya - 0.16, ya, 0.0, 0.6)
    elif base == 'door':
        r, ys = 1.3, 4.8
        holes_wall(fr, x0, x1, Y_PLINTH, Y_BASE, 0, 0.4, [(xc - r, xc + r, Y_PLINTH, ys + r + 0.4)])
        arch_spandrel(fr, xc, r, ys, ys + r + 0.4, 0, 0.4)
        box(fr, xc - r, xc + r, Y_PLINTH, ys, -1.0, -0.9, 'bronze')
        arch_glass(fr, xc, r, ys, ys, -1.0, -0.92)
        box(fr, xc - 0.04, xc + 0.04, ys, ys + r, -0.92, -0.86, 'bronze')
        voussoirs(fr, xc, ys, r, r + 0.75, 0.4, 0.62, 7, 0.3)
        shapes = [('rect', xc - r, xc + r, Y_PLINTH, ys, 0.0), ('arch', xc, ys, r + 0.75)]
        for k in range(3):
            box(fr, xc - r - 0.4 + 0.1 * k, xc + r + 0.4 - 0.1 * k, 0, Y_PLINTH - 0.3 * k, 0.4, 1.2 - 0.3 * k, 'granite')
    if rustic:
        courses(fr, x0, x1, Y_PLINTH, Y_BASE, 0.4, 0.55, shapes)
    # main floors
    holes = [(xc - hw, xc + hw, *F1), (xc - hw, xc + hw, *F2), (xc - hw * 0.95, xc + hw * 0.95, *F3)]
    holes_wall(fr, x0, x1, Y_BELT, Y_CORN0, 0, 0.4, holes)
    if rustic:      # the whole facade is banded ashlar: shallow channel joints between the windows
        courses(fr, x0, x1, Y_BELT + 0.1, Y_CORN0 - 0.1, 0.4, 0.46,
                [('rect', xa, xb, ya, yb, 0.2) for xa, xb, ya, yb in holes], pitch=0.62, gap=0.07)
    for (xa, xb, ya, yb), trim in zip(holes, trims):
        glazing(fr, xa, xb, ya, yb)
        architrave(fr, xa, xb, ya, yb)
        if trim == 'balc':
            balustrade(fr, xa - 0.25, xb + 0.25, ya - 0.95, 0.55, 0.9, 0.3, 0.3)
            box(fr, xa - 0.35, xb + 0.35, ya - 1.05, ya - 0.95, 0.0, 0.8)
        else:
            sill(fr, xa, xb, ya, brackets=(trim != 'sill'))
        if trim.startswith('hood') or trim == 'balc':
            hood(fr, xa, xb, yb + 0.18, {'hood-tri': 'tri', 'hood-seg': 'seg', 'balc': 'seg'}.get(trim, 'flat'))
    # attic
    if attic:
        ya, yb = ATTIC_WIN
        holes_wall(fr, x0, x1, Y_CORN1, 27.8, 0, 0.4, [(xc - hw * 0.8, xc + hw * 0.8, ya, yb)])
        if rustic:
            courses(fr, x0, x1, Y_CORN1 + 0.1, 27.2, 0.4, 0.46, [('rect', xc - hw * 0.8, xc + hw * 0.8, ya, yb, 0.2)],
                    pitch=0.62, gap=0.07)
        glazing(fr, xc - hw * 0.8, xc + hw * 0.8, ya, yb, transom=False)
        architrave(fr, xc - hw * 0.8, xc + hw * 0.8, ya, yb, 0.15)
        box(fr, xc - hw * 0.8 - 0.2, xc + hw * 0.8 + 0.2, ya - 0.18, ya, 0.0, 0.58)
        # carved lozenge panel under the parapet
        box(fr, xc - 0.7, xc + 0.7, 27.25, 27.65, 0.4, 0.5, 'carved')
    else:
        box(fr, x0, x1, Y_CORN1, 27.8, 0, 0.4)


def pier_strip(fr, x0, x1, pilaster=True):
    """Solid wall strip: rusticated base, channelled giant pilaster, plain attic."""
    box(fr, x0, x1, Y_PLINTH, Y_BASE, 0, 0.4)
    courses(fr, x0, x1, Y_PLINTH, Y_BASE, 0.4, 0.55, [])
    box(fr, x0, x1, Y_BELT, Y_CORN0, 0, 0.4)
    if pilaster:
        box(fr, x0 + 0.1, x1 - 0.1, Y_BELT, 9.95, 0.4, 0.95)
        box(fr, x0 + 0.2, x1 - 0.2, 9.95, 22.2, 0.4, 0.72)
        courses(fr, x0 + 0.2, x1 - 0.2, 9.95, 22.2, 0.72, 0.8, [], pitch=0.62, gap=0.08)
        box(fr, x0 + 0.05, x1 - 0.05, 22.2, Y_CORN0, 0.4, 0.9, 'carved')
    box(fr, x0, x1, Y_CORN1, 27.8, 0, 0.4)


def lamp_urn(s, q, y0):
    pbox(s - 0.45, s + 0.45, y0, y0 + 0.8, q - 0.45, q + 0.45)
    lathe(s, q, [(0.3, y0 + 0.8), (0.34, y0 + 0.95), (0.3, y0 + 1.1), (0.34, y0 + 1.8), (0.4, y0 + 1.95), (0.18, y0 + 2.05),
                 (0.12, y0 + 2.15)], 10, 'bronze')
    lathe(s, q, [(0.05, y0 + 2.12), (0.2, y0 + 2.2), (0.25, y0 + 2.35), (0.2, y0 + 2.5), (0.05, y0 + 2.58)], 10, 'carved')


def aedicule(fr, xc):
    """Raised attic window on a pavilion: three-light window under a cornice, lamp urns either side."""
    holes_wall(fr, xc - 2.1, xc + 2.1, Y_CORN1, 29.3, 0.0, 0.62, [(xc - 1.5, xc + 1.5, 25.0, 27.6)])
    box(fr, xc - 1.5, xc + 1.5, 25.0, 27.6, 0.3, 0.42, 'glass')
    box(fr, xc - 1.7, xc + 1.7, 24.85, 25.0, 0.0, 0.75)
    for x in (xc - 0.5, xc + 0.5):
        box(fr, x - 0.12, x + 0.12, 25.0, 27.6, 0.42, 0.56, 'stone')

    architrave(fr, xc - 1.5, xc + 1.5, 25.0, 27.6, 0.2, 0.62, 0.76)
    box(fr, xc - 2.3, xc + 2.3, 29.3, 29.75, -0.2, 0.95)
    box(fr, xc - 2.0, xc + 2.0, 29.75, 30.1, -0.1, 0.7)


# ------------------------------------------------------------------ east facade (the one the car passes)

FF = Fr(0, 0, (1, 0), (0, 1))
for sg in (-1, 1):
    def X(a, b):
        return (min(sg * a, sg * b), max(sg * a, sg * b))
    # end pavilion 33.5..41.5: pier strips at the edges, one rich window stack between
    for a, b in ((33.5, 35.5), (39.5, 41.5)):
        pier_strip(FF, *X(a, b))
    bay_windows(FF, sg * 37.5, 0.85, ('balc', 'hood-tri', 'sill'), base='door', attic=False, xr=X(35.5, 39.5))
    aedicule(FF, sg * 37.5)
    for x in (34.5, 40.5):
        lamp_urn(sg * x, 0.0, Y_PARA)
    # wing 17.75..33.5: five bays
    for i in range(5):
        a = 17.75 + 3.15 * i
        bay_windows(FF, sg * (a + 1.575), 0.75, ('hood-flat', 'sill-b', 'sill'), xr=X(a, a + 3.15))
    # intermediate pavilion 9.25..17.75
    for a, b in ((9.25, 11.25), (15.75, 17.75)):
        pier_strip(FF, *X(a, b))
    bay_windows(FF, sg * 13.5, 0.85, ('balc', 'hood-tri', 'sill'), attic=False, xr=X(11.25, 15.75))

    aedicule(FF, sg * 13.5)
    for x in (10.25, 16.75):
        lamp_urn(sg * x, 0.0, Y_PARA)

# NE rounded corner: base, wall and attic bands swept round the arc, rusticated base courses
arc_path = [(s, q, (s + 41.5) / RC, (q + RC) / RC) for s, q in corner_arc]
sweep(arc_path, [(0, Y_PLINTH), (0.4, Y_PLINTH), (0.4, Y_BASE), (0, Y_BASE)])
y = Y_PLINTH
while y < Y_BASE - 0.05:
    sweep(arc_path, [(0.3, y), (0.55, y), (0.55, min(y + 0.48, Y_BASE)), (0.3, min(y + 0.48, Y_BASE))])
    y += 0.55
sweep(arc_path, [(0, Y_BELT), (0.4, Y_BELT), (0.4, Y_CORN0), (0, Y_CORN0)])
sweep(arc_path, [(0, Y_CORN1), (0.4, Y_CORN1), (0.4, 27.8), (0, 27.8)])

# colonnade: portico base with three arched doorways, loggia wall, six Ionic columns
PB = Fr(0, 0, (1, 0), (0, 1))
R_ARCH, YS_ARCH = 1.8, 4.4
holes_wall(PB, -LOGGIA, LOGGIA, Y_PLINTH, Y_BASE, -1.5, 0.4, [(x - R_ARCH, x + R_ARCH, Y_PLINTH, YS_ARCH + R_ARCH + 0.5) for x in ARCHES])
shapes = []
for x in ARCHES:
    arch_spandrel(PB, x, R_ARCH, YS_ARCH, YS_ARCH + R_ARCH + 0.5, -1.5, 0.4)
    voussoirs(PB, x, YS_ARCH, R_ARCH, R_ARCH + 1.0, 0.4, 0.66, 11, 0.45)
    shapes += [('rect', x - R_ARCH, x + R_ARCH, Y_PLINTH, YS_ARCH, 0.0), ('arch', x, YS_ARCH, R_ARCH + 1.0)]
    # bronze doors (paired leaves with raised panels) and the fanlight, 1.5 m inside the reveal
    box(PB, x - R_ARCH, x + R_ARCH, Y_PLINTH, YS_ARCH, -1.62, -1.5, 'bronze')
    for side in (-1, 1):
        for ya, yb in ((1.3, 2.6), (2.9, 4.1)):
            xa = x + side * 0.15 if side > 0 else x - R_ARCH + 0.2
            box(PB, xa, xa + R_ARCH - 0.35, ya, yb, -1.5, -1.44, 'bronze')
    arch_glass(PB, x, R_ARCH, YS_ARCH, YS_ARCH, -1.62, -1.52)
    for i in range(1, 6):
        a = math.pi * i / 6
        tube([(x + 0.1 * math.cos(a), YS_ARCH + 0.1 * math.sin(a), -1.5), (x + (R_ARCH - 0.05) * math.cos(a), YS_ARCH + (R_ARCH - 0.05) * math.sin(a), -1.5)], 0.05, 'bronze', 4)
    box(PB, x - R_ARCH, x + R_ARCH, YS_ARCH - 0.08, YS_ARCH + 0.08, -1.5, -1.42, 'bronze')
    # entrance steps up to the thresholds
    for k in range(3):
        box(PB, x - R_ARCH - 0.3 + 0.1 * k, x + R_ARCH + 0.3 - 0.1 * k, 0, 0.3 * (k + 1), -1.5, 1.4 - 0.45 * k, 'granite')
courses(PB, -LOGGIA, LOGGIA, Y_PLINTH, Y_BASE, 0.4, 0.55, shapes)
for x in (-3.15, 3.15):      # blank panels on the piers between the doorways
    box(PB, x - 0.7, x + 0.7, 2.2, 3.8, 0.55, 0.65, 'carved')

LW = Fr(0, -2.5, (1, 0), (0, 1))
holes = []
for xc in (-6.2, 0.0, 6.2):
    holes += [(xc - 0.8, xc + 0.8, *F1), (xc - 0.8, xc + 0.8, *F2), (xc - 0.75, xc + 0.75, *F3)]
holes_wall(LW, -LOGGIA, LOGGIA, Y_BELT, 21.5, 0, 0.3, holes)
for x in COLS:        # flat pilasters on the loggia wall answering each column
    box(LW, x - 0.5, x + 0.5, Y_BELT, 21.35, 0.3, 0.55)
    box(LW, x - 0.62, x + 0.62, 20.8, 21.35, 0.3, 0.68, 'carved')

for xa, xb, ya, yb in holes:
    glazing(LW, xa, xb, ya, yb)
    architrave(LW, xa, xb, ya, yb, 0.16, 0.3, 0.42)
    sill(LW, xa, xb, ya, brackets=True)
    if yb < 14:
        hood(LW, xa, xb, yb + 0.18, 'flat')
# entablature over the colonnade (architrave + frieze), flush with the wall line
pbox(-LOGGIA, LOGGIA, 21.5, 22.2, -0.3, 0.3)
pbox(-LOGGIA, LOGGIA, 22.2, Y_CORN0, -0.3, 0.42)
pbox(-LOGGIA, LOGGIA, 21.35, 21.5, -2.5, 0.1)               # loggia soffit coffer band
for i in range(9):
    x = -8.1 + 2.025 * i
    pbox(x - 0.5, x + 0.5, 21.15, 21.35, -2.2, -0.35, 'carved')


def ionic_column(sc, nc, y0, y1, D):
    """Attic base, smooth shaft with entasis, Ionic capital with bolster volutes facing the street."""
    r = D / 2
    pbox(sc - 0.65 * D, sc + 0.65 * D, y0, y0 + 0.16 * D, nc - 0.65 * D, nc + 0.65 * D)
    lathe(sc, nc, [(0.62 * D, y0 + 0.16 * D), (0.64 * D, y0 + 0.24 * D), (0.6 * D, y0 + 0.3 * D), (0.54 * D, y0 + 0.33 * D),
                   (0.57 * D, y0 + 0.4 * D), (0.52 * D, y0 + 0.46 * D), (0.5 * D, y0 + 0.5 * D)], 24)
    ys0, ys1 = y0 + 0.5 * D, y1 - 0.62 * D
    prof = []
    for i in range(9):
        t = i / 8
        prof.append((r * (1 - 0.14 * max(0.0, (t - 0.33) / 0.67) ** 1.6), ys0 + (ys1 - ys0) * t))
    prof.append((r * 0.93, ys1 + 0.05 * D))
    # 24 flutes (the photos show fluted shafts): alternate arris and flute radii
    lathe(sc, nc, prof, 48, mod=lambda j: 1.0 if j % 2 == 0 else 0.93)
    # echinus and abacus
    lathe(sc, nc, [(0.47 * D, ys1 + 0.05 * D), (0.56 * D, ys1 + 0.2 * D), (0.6 * D, ys1 + 0.32 * D), (0.5 * D, ys1 + 0.36 * D)], 24, 'carved')
    pbox(sc - 0.66 * D, sc + 0.66 * D, ys1 + 0.3 * D, ys1 + 0.44 * D, nc - 0.55 * D, nc + 0.55 * D, 'carved')
    pbox(sc - 0.72 * D, sc + 0.72 * D, y1 - 0.12 * D, y1, nc - 0.72 * D, nc + 0.72 * D, 'carved')
    for side in (-1, 1):   # volute bolsters run front to back; spiral discs on the street face
        cx = sc + side * 0.62 * D
        yc = ys1 + 0.22 * D
        tube([(cx, yc, nc - 0.55 * D), (cx, yc, nc + 0.55 * D)], [0.2 * D, 0.2 * D], 'carved', 12)
        spiral = []
        for i in range(14):
            a = side * (math.pi / 2 + i * 0.5)
            rr = 0.2 * D * (1 - i / 16)
            spiral.append((cx + rr * math.cos(a), yc + rr * math.sin(a), nc + 0.57 * D))
        tube(spiral, 0.03 * D, 'carved', 4)


D_COL = 1.2
for x in COLS:
    pbox(x - 0.8, x + 0.8, Y_BELT, 10.6, -1.4, 0.2)                    # pedestal
    pbox(x - 0.9, x + 0.9, 10.45, 10.6, -1.5, 0.3)
    ionic_column(x, -0.6, 10.6, 21.5, D_COL)
# balustrades between the pedestals (balconies in front of the loggia windows)
for a, b in ((-7.6, -4.8), (-1.45, 1.45), (4.8, 7.6)):
    balustrade(PLAN, a, b, Y_BELT, -0.6, 1.0, 0.32, 0.36)
# small cartouche on the centre pedestal line
pbox(-0.6, 0.6, 9.55, 10.45, -0.4, 0.25, 'carved')

# ------------------------------------------------------------------ flanks and rear (same grammar, lighter)

def run(fr, L, x_start, pitch, first_pier=0.0, trims=('hood-flat', 'sill-b', 'sill'), rustic=True):
    x = x_start
    if first_pier:
        pier_strip(fr, x, x + first_pier)
        x += first_pier
    n = int((L - x) / pitch)
    extra = (L - x) - n * pitch
    for i in range(n):
        bay_windows(fr, x + pitch / 2, 0.72, trims, rustic=rustic, xr=(x, x + pitch))
        x += pitch
    if extra > 0.01:
        pier_strip(fr, x, L, pilaster=False)


fr, L = seg_frame((SOUTH, 0.0), (SOUTH, BACK_S), 1)       # south flank (the car sees it approaching)
if fr.o[0] < 0:
    fr, L = seg_frame((SOUTH, 0.0), (SOUTH, BACK_S), -1)
run(fr, L, 0.0, 3.2, first_pier=2.0)
fr, L = seg_frame((NORTH, -RC), (NORTH, BACK_N), 1)       # north flank
if fr.o[0] > 0:
    fr, L = seg_frame((NORTH, -RC), (NORTH, BACK_N), -1)
run(fr, L, 0.0, 3.2, first_pier=1.5)
fr, L = seg_frame((SOUTH, BACK_S), (NORTH, BACK_N), 1)    # rear (service wing side)
if fr.o[1] > 0:
    fr, L = seg_frame((SOUTH, BACK_S), (NORTH, BACK_N), -1)
run(fr, L, 0.0, 3.5, first_pier=1.0, trims=('sill-b', 'sill', 'sill'), rustic=False)

# glazed banking-hall rooflight behind the tower
pbox(-11.5, 11.5, Y_ATTIC, 29.3, -44.0, -27.0)
rl = [(-11, 29.3, -43.5), (11, 29.3, -43.5), (11, 29.3, -27.5), (-11, 29.3, -27.5), (-6, 31.4, -35.5), (6, 31.4, -35.5)]
raw(rl, [(0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4)], 'glass')
for i in range(9):
    s = -10 + 2.5 * i
    tube([(s, 29.35, -43.4), (s * 0.55 if abs(s) < 11 else s, 31.45, -35.5), (s, 29.35, -27.6)], 0.06, 'bronze', 4)

# ------------------------------------------------------------------ tower, dome and lantern

TS, TN = TOWER


def octagon(a, c):
    pts = [(a, -(a - c)), (a, a - c), (a - c, a), (-(a - c), a), (-a, a - c), (-a, -(a - c)), (-(a - c), -a), (a - c, -a)]
    return [(TS + x, TN + z) for x, z in pts]


def face_frames(a):
    """Frames on the four main faces of a tower stage, x along the face, d outward from half width a."""
    out = []
    for k in range(4):
        th = math.pi / 2 * k
        o = (math.cos(th), math.sin(th))
        t = (-o[1], o[0])
        out.append(Fr(TS + a * o[0], TN + a * o[1], t, o))
    return out


def chamfer_frames(a, c):
    out = []
    off = (2 * a - c) / math.sqrt(2)
    for k in range(4):
        th = math.pi / 4 + math.pi / 2 * k
        o = (math.cos(th), math.sin(th))
        t = (-o[1], o[0])
        out.append(Fr(TS + off * o[0], TN + off * o[1], t, o))
    return out


# stage A (sixth floor): chamfered square, a recessed three-light window between two columns on each face
YA0, YA1 = Y_ATTIC, 34.0
plan_prism(octagon(9.0, 2.41), YA0, YA1)
for fr in face_frames(9.0):
    for xa, xb in ((-7.0, -3.0), (3.0, 7.0)):
        box(fr, xa, xb, YA0, YA1, 0, 1.0)
        courses(fr, xa + 0.3, xb - 0.3, YA0 + 0.6, YA1 - 0.8, 1.0, 1.08, [], pitch=0.6, gap=0.08)
        box(fr, xa + 1.0, xb - 1.0, 29.9, 32.6, 1.0, 1.1, 'carved')   # sunk panel frame
        box(fr, xa + 1.2, xb - 1.2, 30.1, 32.4, 1.0, 1.13, 'stone')
    box(fr, -3.0, 3.0, YA0, 29.0, 0, 1.0)
    box(fr, -3.0, 3.0, 33.3, YA1, 0, 1.0)
    box(fr, -3.0, 3.0, 29.0, 33.3, -0.05, 0.06, 'glass')
    for x in (-2.0, 2.0):
        box(fr, x - 0.05, x + 0.05, 29.0, 33.3, 0.06, 0.12, 'bronze')
    for x in (-1.0, 1.0):
        s, _, q = fr.p(x, 0, 0.5)
        lathe(s, q, [(0.36, 29.0), (0.36, 29.2), (0.3, 29.35), (0.29, 32.7), (0.34, 32.9), (0.4, 33.05)], 14)
        pbox(s - 0.42, s + 0.42, 33.05, 33.3, q - 0.42, q + 0.42, 'carved')
    # pediment over the stage cornice
    prism(fr, [(-5.6, 34.75), (5.6, 34.75), (0, 36.2)], 0.1, 1.2, 'carved')
    prism(fr, [(-6.0, 34.65), (6.0, 34.65), (0, 36.4)], 1.2, 1.4, 'stone')
for fr in chamfer_frames(9.0, 2.41):
    holes_wall(fr, -2.15, 2.15, YA0, YA1, 0, 1.0, [(-0.55, 0.55, 29.4, 32.9)])
    box(fr, -0.55, 0.55, 29.4, 32.9, -0.05, 0.06, 'glass')
    architrave(fr, -0.55, 0.55, 29.4, 32.9, 0.15, 1.0, 1.12)
sweep(loop_path(octagon(10.0, 3.0)), [(-1.2, 34.0), (0.25, 34.0), (0.25, 34.3), (0.55, 34.4), (0.55, 34.75), (-1.2, 34.75)], closed=True)

# stage B (seventh floor): smaller chamfered square with balconies, corner pedestals carrying lamps
YB0, YB1 = 34.75, 39.0
plan_prism(octagon(8.8, 2.8), YB0, YB1)
for fr in face_frames(8.8):
    for x, hw in ((0.0, 1.2), (-3.2, 0.55), (3.2, 0.55)):
        box(fr, x - hw, x + hw, 36.3, 38.4, -0.05, 0.06, 'glass')
        architrave(fr, x - hw, x + hw, 36.3, 38.4, 0.18, 0.0, 0.25)
        box(fr, x - 0.04, x + 0.04, 36.3, 38.4, 0.06, 0.12, 'bronze')
    for x in (-5.4, 5.4):
        box(fr, x - 0.5, x + 0.5, YB0, YB1, 0.0, 0.35)
    balustrade(fr, -4.2, 4.2, 36.35, 0.75, 0.95, 0.34, 0.34)
    box(fr, -4.4, 4.4, 36.2, 36.35, 0.0, 1.0)
for fr in chamfer_frames(8.8, 2.8):
    box(fr, -0.5, 0.5, 36.1, 38.3, -0.05, 0.06, 'glass')
    architrave(fr, -0.5, 0.5, 36.1, 38.3, 0.16, 0.0, 0.22)
    balustrade(fr, -1.6, 1.6, 35.0, 0.8, 0.95, 0.34, 0.34)
    box(fr, -1.8, 1.8, 34.75, 35.0, 0.0, 1.05)
sweep(loop_path(octagon(8.8, 2.8)), [(-0.8, 39.0), (0.2, 39.0), (0.2, 39.2), (0.6, 39.35), (0.6, 39.7), (-0.8, 39.7)], closed=True)
for fr in chamfer_frames(8.8, 2.8):            # corner pedestals
    s, _, q = fr.p(0, 0, -0.3)
    pbox(s - 0.75, s + 0.75, 39.7, 41.4, q - 0.75, q + 0.75)
    pbox(s - 0.9, s + 0.9, 41.3, 41.6, q - 0.9, q + 0.9)
    lathe(s, q, [(0.45, 41.6), (0.55, 41.9), (0.3, 42.3), (0.35, 42.7), (0.08, 43.0)], 12, 'carved')

# dome: balustrade ring, stepped base rings, dome shell with ledges, four lucarnes
R_BAL = 8.0
for r0, r1, y0, y1 in ((R_BAL - 0.2, R_BAL + 0.2, 39.7, 39.85), (R_BAL - 0.22, R_BAL + 0.22, 40.55, 40.7)):
    sweep([(TS + math.cos(a) * R_BAL, TN + math.sin(a) * R_BAL, math.cos(a), math.sin(a))

           for a in [2 * math.pi * i / 72 for i in range(72)]], [(r0 - R_BAL, y0), (r1 - R_BAL, y0), (r1 - R_BAL, y1), (r0 - R_BAL, y1)], closed=True)
for i in range(120):
    a = 2 * math.pi * (i + 0.5) / 120
    baluster(TS + R_BAL * math.cos(a), TN + R_BAL * math.sin(a), 39.85, 0.7, 6)
lathe(TS, TN, [(7.2, 39.7), (7.2, 40.5), (6.85, 40.5), (6.85, 41.1)], 72, 'dome', smooth=False)
RD, HD, YD = 6.6, 5.6, 41.1
prof = []
for i in range(17):
    ph = math.radians(78 * i / 16)
    prof.append((RD * math.cos(ph), YD + HD * math.sin(ph)))
lathe(TS, TN, prof, 72, 'dome')
for yl in (41.7, 42.35):
    ph = math.asin((yl - YD) / HD)
    rr = RD * math.cos(ph)
    sweep([(TS + math.cos(a) * rr, TN + math.sin(a) * rr, math.cos(a), math.sin(a)) for a in [2 * math.pi * i / 72 for i in range(72)]],
          [(-0.3, yl - 0.12), (0.12, yl - 0.12), (0.12, yl + 0.1), (-0.3, yl + 0.1)], 'dome', closed=True)
for fr in face_frames(0.0):
    box(fr, -0.85, 0.85, 41.1, 42.4, 5.2, 6.9, 'dome')
    box(fr, -0.5, 0.5, 41.3, 42.2, 6.85, 6.95, 'glass')
    prism(fr, [(-1.05, 42.4), (1.05, 42.4), (0, 42.95)], 5.2, 7.05, 'dome')

# lantern drum, flared cap with brackets, spire pedestal, mast and ball finial
lathe(TS, TN, [(1.6, 46.0), (1.6, 47.2)], 24, 'dome', smooth=False)
for i in range(12):
    a = 2 * math.pi * i / 12
    pbox(TS + 1.6 * math.cos(a) - 0.17, TS + 1.6 * math.cos(a) + 0.17, 46.3, 47.0,
         TN + 1.6 * math.sin(a) - 0.17, TN + 1.6 * math.sin(a) + 0.17, 'glass')
lathe(TS, TN, [(0.05, 46.85), (2.9, 46.95), (3.05, 47.12), (1.5, 47.8), (0.05, 47.82)], 48, 'dome')
for i in range(24):
    a = 2 * math.pi * i / 24
    c, s_ = math.cos(a), math.sin(a)
    raw([(TS + c * r - s_ * w, y, TN + s_ * r + c * w) for r, y, w in
         [(1.55, 46.5, -0.1), (2.7, 46.88, -0.1), (2.7, 46.88, 0.1), (1.55, 46.5, 0.1),
          (1.55, 47.0, -0.1), (2.7, 47.0, -0.1), (2.7, 47.0, 0.1), (1.55, 47.0, 0.1)]], BOXF, 'carved')
lathe(TS, TN, [(1.1, 47.75), (1.1, 48.1), (0.9, 48.3), (0.68, 49.4), (0.52, 49.65), (0.28, 49.8)], 8, 'dome', phase=math.pi / 8, smooth=False)
lathe(TS, TN, [(0.14, 49.75), (0.12, 53.3), (0.08, 53.5)], 10, 'bronze')
lathe(TS, TN, [(0.05, 53.35)] + [(0.32 * math.sin(math.pi * i / 8), 53.65 - 0.32 * math.cos(math.pi * i / 8)) for i in range(1, 8)] + [(0.05, 53.97)], 12, 'bronze')


# ------------------------------------------------------------------ bronze lions on the forecourt

def lion(s0, n0, flip):
    """A recumbent bronze lion on a granite plinth, facing the street (+n)."""
    pbox(s0 - 0.75, s0 + 0.75, 0, 0.9, n0 - 1.4, n0 + 1.4, 'granite')
    pbox(s0 - 0.82, s0 + 0.82, 0.9, 1.0, n0 - 1.48, n0 + 1.48, 'granite')
    Y = 1.0

    def xl(stations, sides=12):
        """Loft along the lion's forward axis: stations (f, y, half-width, half-height)."""
        v = []
        for f, yc, hw_, hh in stations:
            for j in range(sides):
                th = 2 * math.pi * j / sides
                v.append((s0 + hw_ * math.cos(th), Y + yc + hh * math.sin(th), n0 + f))
        m = len(stations)
        fc = [tuple(reversed(range(sides))), tuple(range((m - 1) * sides, m * sides))]
        for i in range(m - 1):
            for j in range(sides):
                a = i * sides + j; b = i * sides + (j + 1) % sides
                fc.append((a, b, b + sides, a + sides))
        raw(v, fc, 'bronze', True)

    xl([(-1.2, 0.35, 0.12, 0.12), (-1.05, 0.42, 0.3, 0.3), (-0.75, 0.48, 0.38, 0.4), (-0.35, 0.47, 0.34, 0.38),
        (0.05, 0.52, 0.36, 0.42), (0.35, 0.58, 0.4, 0.48), (0.5, 0.6, 0.3, 0.4)])
    xl([(0.2, 0.75, 0.2, 0.2), (0.35, 0.82, 0.46, 0.5), (0.6, 0.88, 0.5, 0.52), (0.85, 0.86, 0.36, 0.38),
        (1.0, 0.8, 0.22, 0.22), (1.12, 0.76, 0.18, 0.17), (1.2, 0.74, 0.08, 0.08)])
    for side in (-1, 1):
        tube([(s0 + side * 0.22, Y + 0.3, n0 + 0.3), (s0 + side * 0.22, Y + 0.12, n0 + 0.8), (s0 + side * 0.22, Y + 0.1, n0 + 1.25)],
             [0.14, 0.12, 0.14], 'bronze', 8)
        # haunches and hind paws
        tube([(s0 + side * 0.33, Y + 0.42, n0 - 0.95), (s0 + side * 0.38, Y + 0.32, n0 - 0.6), (s0 + side * 0.36, Y + 0.1, n0 - 0.3),
              (s0 + side * 0.34, Y + 0.08, n0 + 0.05)], [0.3, 0.28, 0.12, 0.1], 'bronze', 10)
        tube([(s0 + side * 0.18, Y + 1.25, n0 + 0.55), (s0 + side * 0.22, Y + 1.36, n0 + 0.5)], [0.08, 0.04], 'bronze', 6)
    tail = [(s0 + flip * (0.1 + 0.35 * math.sin(t)), Y + 0.08, n0 - 1.15 + 0.6 * t / math.pi) for t in [i * math.pi / 6 for i in range(7)]]
    tube(tail, 0.05, 'bronze', 6)


for sg in (-1, 1):
    lion(sg * 13.5, 2.6, sg)

info = M.finish(directory=(Path(tempfile.gettempdir()) / 'sr-landmarks' / 'bund-hsbc-building'))
