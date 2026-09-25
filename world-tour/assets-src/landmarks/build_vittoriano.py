"""Vittoriano (Altare della Patria / Monumento a Vittorio Emanuele II), Piazza Venezia, Rome.

The rome route starts at the foot of its stairs and drives away along its east flank
(Via dei Fori Imperiali), so the front (north) face and the east flank are the faces that matter.

Original geometry authored from public facts and from comparison with reference photographs
(Wikimedia Commons, listed in the modelling report; no image or third-party mesh is shipped):
  footprint  OSM relation 1849830 "Altare della Patria" (owned by pipeline/landmarks.json,
             registered with levelGround: it stands on the level Piazza Venezia pad)
  size       published: 135 m wide, 70 m to the propylaea roofs, 81 m with the bronze quadrigas;
             16 Corinthian columns in the curved portico; equestrian statue 12 m high.
Plan read off the OSM outline: the facade line runs at -17 deg (it faces NNW up Via del Corso),
the symmetry axis sits 2.8 m west of the footprint centroid, the stair block is 38 m wide and
projects to f = 86, the lower wings' front is at f = 49 (a = 33..57), the propylaea podia step out
to a = 63 behind f = 5.

Authoring frame: a = across the facade (+ = east, the viewer's right when facing the monument),
f = toward Piazza Venezia (front), y = up from the piazza datum, metres.

Vertical layout (y above the piazza). Photo ratios were measured on near-orthographic telephoto
front views (column height = unit) and scaled so the propylaea top is ~70 m and the quadriga
Victories reach ~81 m, the published figures:
  grand stair 0 -> 10.4 (altar landing, lower wings' terrace 12), altar 10.4 -> 21 with the relief
  friezes 13.4-17.8, equestrian terrace 27.5, statue pedestal 27.5 -> 40.5, statue 40.5 -> ~52.5
  (rider's head below the portico capitals, as in the photos), portico terrace 33, portico and
  propylaea floor 40, columns 16 m (photo: column : portico floor-to-attic-top = 16 : 27.3),
  portico entablature 56 -> 60.3, attic 60.3 -> 67.3 with the 16 region statues standing in front
  of it (heads under its cornice), propylaea entablature 56 -> 59.6, pediment apex 63.6, attic
  and cornice to 68.2, two top steps to 70.2, quadriga Victories to ~81.
Propylaea (photos): temple fronts, distyle in antis with a sculpted pediment; the outer side is
solid for its front third, then four columns and a corner pier; a tall attic with a panel frieze
and a heavy cornice carries the quadriga, four horses abreast facing the piazza.
Everything is white Botticino marble except the bronze sculpture, the pink-marble shafts of the
four rostral columns, the gilded Victories on them, the gold niche behind Dea Roma, the dark
portico mosaics and the dark tomb panel.
No text: the propylaea inscription bands, the pedestal band and the tomb panel are blank.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model
from build_moffett_aircraft import xyz

ID = 'vittoriano'
M = Model(ID)
M.material('marble', (0.88, 0.86, 0.80), 0.0, 0.5, ID + '_marble')
M.material('carved', (0.93, 0.91, 0.86), 0.0, 0.6, ID + '_carved')
M.material('bronze', (0.24, 0.20, 0.13), 0.85, 0.42, ID + '_bronze')
M.material('gold', (0.84, 0.65, 0.28), 1.0, 0.3, ID + '_gold')
M.material('water', (0.16, 0.30, 0.34), 0.0, 0.06, ID + '_water')
M.material('marble_pink', (0.80, 0.62, 0.56), 0.0, 0.45, ID + '_marble_pink')
M.material('mosaic', (0.30, 0.18, 0.09), 0.35, 0.5, ID + '_mosaic')
M.material('steel', (0.20, 0.21, 0.22), 0.8, 0.4, ID + '_steel')
M.material('granite', (0.13, 0.12, 0.12), 0.0, 0.35, ID + '_granite')
M.material('glass', (0.06, 0.08, 0.10), 0.2, 0.15, ID + '_glass')
M.material('flame', (1.0, 0.55, 0.12), 0.0, 0.9, ID + '_flame')

AC, AX = M.spec['across'], M.spec['axis']
TH = math.radians(-17.0)
EA = (math.cos(TH), math.sin(TH))          # +a in (x east, z south)
EF = (math.sin(TH), -math.cos(TH))         # +f (front, NNW)
SHIFT = -2.8                               # symmetry axis relative to the footprint centroid


def W(p):
    a, y, f = p
    x = (a + SHIFT) * EA[0] + f * EF[0]
    z = (a + SHIFT) * EA[1] + f * EF[1]
    return (x * AC[0] + z * AC[1], y, x * AX[0] + z * AX[1])


def raw(verts, faces, mat, smooth=None):
    """Append one closed component (monument coordinates) with per-face smoothing."""
    g = M.groups.setdefault(mat, [[], [], []])
    off = len(g[0])
    g[0].extend(xyz(M.point(W(p))) for p in verts)
    g[1].extend(tuple(i + off for i in f) for f in faces)
    if smooth is None or smooth is False:
        smooth = [False] * len(faces)
    elif smooth is True:
        smooth = [True] * len(faces)
    g[2].extend(smooth)
    M.authored_components += 1


# ------------------------------------------------------------------ frames and primitives

class Fr:
    """Plan frame: u along t, d along the outward normal n (n = t rotated +90 deg in (a, f))."""
    def __init__(s, a0, f0, phi=0.0):
        s.a0, s.f0 = a0, f0
        s.t = (math.cos(phi), math.sin(phi))
        s.n = (-math.sin(phi), math.cos(phi))

    def p(s, u, y, d):
        return (s.a0 + u * s.t[0] + d * s.n[0], y, s.f0 + u * s.t[1] + d * s.n[1])


MF = Fr(0.0, 0.0, 0.0)   # u = a, d = f


def facing(nx, nf, a0=0.0, f0=0.0):
    return Fr(a0, f0, math.atan2(-nx, nf))


BOXF = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def hexa(c, mat):
    raw(c, BOXF, mat)


def box(fr, u0, u1, y0, y1, d0, d1, mat):
    q = [(u0, d0), (u1, d0), (u1, d1), (u0, d1)]
    hexa([fr.p(u, y0, d) for u, d in q] + [fr.p(u, y1, d) for u, d in q], mat)


def mbox(a0, a1, y0, y1, f0, f1, mat='marble'):
    box(MF, a0, a1, y0, y1, f0, f1, mat)


def slope_box(fr, u0, u1, d0, d1, yb, yt0, yt1, mat):
    """Box whose top slopes from yt0 at d0 to yt1 at d1 (stair cheeks)."""
    q = [(u0, d0), (u1, d0), (u1, d1), (u0, d1)]
    tops = [yt0, yt0, yt1, yt1]
    hexa([fr.p(u, yb, d) for u, d in q] + [fr.p(u, t, d) for (u, d), t in zip(q, tops)], mat)


def prism(fr, pts, y0, y1, mat):
    n = len(pts)
    v = [fr.p(u, y0, d) for u, d in pts] + [fr.p(u, y1, d) for u, d in pts]
    f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    raw(v, f, mat)


def lathe(fr, uc, dc, prof, sides, mat, mod=None, phase=0.0, su=1.0, sd=1.0, smooth=False):
    v = []
    for r, y in prof:
        for j in range(sides):
            t = phase + 2 * math.pi * j / sides
            m = mod(j) if mod else 1.0
            v.append(fr.p(uc + r * m * su * math.cos(t), y, dc + r * m * sd * math.sin(t)))
    n = len(prof)
    f = [tuple(reversed(range(sides))), tuple(range((n - 1) * sides, n * sides))]
    for i in range(n - 1):
        for j in range(sides):
            a = i * sides + j
            b = i * sides + (j + 1) % sides
            f.append((a, b, b + sides, a + sides))
    raw(v, f, mat, [False, False] + [smooth] * (len(f) - 2))


def sub(a, b): return tuple(x - y for x, y in zip(a, b))
def add3(a, b): return tuple(x + y for x, y in zip(a, b))
def mul(a, k): return tuple(x * k for x in a)
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def norm(a):
    l = math.sqrt(sum(x * x for x in a)) or 1.0
    return tuple(x / l for x in a)


def loft(pts, radii, sides, mat, T=None, ref=None, smooth=True):
    """Closed tube through local points with elliptical sections (r_side, r_other)."""
    n = len(pts)
    if ref is None:
        tt = norm(sub(pts[-1], pts[0]))
        ref = (1.0, 0.0, 0.0) if abs(tt[1]) > 0.7 else (0.0, 1.0, 0.0)
    v = []
    for i, p in enumerate(pts):
        t = norm(sub(pts[min(i + 1, n - 1)], pts[max(i - 1, 0)]))
        u = cross(t, ref)
        if sum(x * x for x in u) < 1e-6:
            u = cross(t, (0.0, 0.0, 1.0))
        u = norm(u)
        w = norm(cross(t, u))
        r1, r2 = radii[i] if isinstance(radii[i], tuple) else (radii[i], radii[i])
        for j in range(sides):
            th = 2 * math.pi * j / sides
            q = add3(p, add3(mul(u, r1 * math.cos(th)), mul(w, r2 * math.sin(th))))
            v.append(T(q) if T else q)
    f = [tuple(reversed(range(sides))), tuple(range((n - 1) * sides, n * sides))]
    for i in range(n - 1):
        for j in range(sides):
            a = i * sides + j
            b = i * sides + (j + 1) % sides
            f.append((a, b, b + sides, a + sides))
    raw(v, f, mat, [False, False] + [smooth] * (len(f) - 2))


def pose(A, Y, F, heading, s, pitch=0.0, pivot=(0.0, 0.0), kx=1.0, kz=1.0):
    """Local statue frame: x forward (heading deg in the (a, f) plane, 90 = toward the piazza),
    y up, z to the statue's right; uniform scale s, optional pitch about a pivot (x, y)."""
    h = math.radians(heading)
    hx, hf = math.cos(h), math.sin(h)
    sx, sf = math.sin(h), -math.cos(h)
    cp, sp = math.cos(pitch), math.sin(pitch)

    def T(p):
        x, y, z = p
        if pitch:
            x0, y0 = x - pivot[0], y - pivot[1]
            x, y = pivot[0] + x0 * cp - y0 * sp, pivot[1] + x0 * sp + y0 * cp
        x *= kx
        z *= kz
        return (A + s * (x * hx + z * sx), Y + s * y, F + s * (x * hf + z * sf))
    return T


def lbox(T, x0, x1, y0, y1, z0, z1, mat):
    q = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    hexa([T((x, y0, z)) for x, z in q] + [T((x, y1, z)) for x, z in q], mat)


# ------------------------------------------------------------------ plan polylines

def offset(pl, d):
    """Mitred offset of an open polyline [(a, f)] along its outward normal (-t_f, t_a)."""
    out = []
    n = len(pl)
    def nrm(i):
        t = norm((pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1], 0.0))
        return (-t[1], t[0])
    for i in range(n):
        if i == 0:
            m = nrm(0); k = 1.0
        elif i == n - 1:
            m = nrm(n - 2); k = 1.0
        else:
            n1, n2 = nrm(i - 1), nrm(i)
            m = norm((n1[0] + n2[0], n1[1] + n2[1], 0.0))[:2]
            k = 1.0 / max(0.3, m[0] * n1[0] + m[1] * n1[1])
        out.append((pl[i][0] + m[0] * d * k, pl[i][1] + m[1] * d * k))
    return out


def band(pl, d0, d1, y0, y1, mat='marble'):
    prism(MF, offset(pl, d0) + list(reversed(offset(pl, d1))), y0, y1, mat)


def mirror_pl(pl):
    return [(-a, f) for a, f in reversed(pl)]


def plen(pl):
    return sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(pl, pl[1:]))


def along(pl, s):
    """Point, unit tangent at arc length s."""
    for p, q in zip(pl, pl[1:]):
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        if s <= L or q is pl[-1]:
            k = min(1.0, s / L) if L else 0.0
            return (p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k), ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
        s -= L
    raise ValueError


# ------------------------------------------------------------------ balustrade

BAL_PROF = [(0.085, 0.0), (0.055, 0.12), (0.13, 0.33), (0.055, 0.55), (0.1, 0.68)]
BAL_COUNT = [0]


def balustrade(p0, p1, y0, y1=None, h=1.05, spacing=0.5, post=4.6, mat='marble'):
    """Balustrade from plan point p0 to p1 with base height y0 -> y1 (sloped on stairs)."""
    y1 = y0 if y1 is None else y1
    L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    if L < 0.8:
        return
    phi = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    fr = Fr(p0[0], p0[1], phi)
    def yy(u): return y0 + (y1 - y0) * u / L
    for ya, yb, w in ((0.0, 0.2, 0.28), (h - 0.16, h, 0.3)):
        c = [(0, -w), (L, -w), (L, w), (0, w)]
        hexa([fr.p(u, yy(u) + ya, d) for u, d in c] + [fr.p(u, yy(u) + yb, d) for u, d in c], mat)
    nposts = max(1, int(round(L / post)))
    posts = [L * i / nposts for i in range(nposts + 1)]
    for u in posts:
        uu = min(max(u, 0.3), L - 0.3)
        box(fr, uu - 0.3, uu + 0.3, yy(uu), yy(uu) + h + 0.08, -0.32, 0.32, mat)
    for a, b in zip(posts, posts[1:]):
        span = b - a - 0.6
        k = max(1, int(span / spacing))
        for i in range(k):
            u = a + 0.3 + span * (i + 0.5) / k
            base = yy(u) + 0.2
            top = yy(u) + h - 0.16
            prof = [(r, base + (top - base) * t / 0.68) for r, t in BAL_PROF]
            lathe(fr, u, 0.0, prof, 6, mat, smooth=True)
            BAL_COUNT[0] += 1


def bal_pl(pl, y, inset=0.45):
    q = offset(pl, -inset)
    for p0, p1 in zip(q, q[1:]):
        balustrade(p0, p1, y)


def stair(fr, u0, u1, d0, d1, y0, y1, n, mat='marble', base=None):
    """n steps from d0 (bottom, top of first step y0 + rise) to d1 (top of last step y1)."""
    rise = (y1 - y0) / n
    run = (d1 - d0) / n
    yb = y0 if base is None else base
    for i in range(n):
        box(fr, u0, u1, yb, y0 + (i + 1) * rise, d0 + i * run, d0 + (i + 1) * run, mat)


# ------------------------------------------------------------------ the Corinthian order

def column(fr, uc, dc, y0, H=16.0, D=1.9, mat='marble'):
    """Corinthian column: plinth, Attic base, 24-flute shaft with entasis, two rows of
    acanthus, corner volutes and a chamfered abacus (square to the frame).
    Detail offsets were drawn for D = 1.6 and scale with k = D / 1.6."""
    k = D / 1.6
    r = D / 2
    box(fr, uc - 0.72 * D, uc + 0.72 * D, y0, y0 + 0.35 * k, dc - 0.72 * D, dc + 0.72 * D, mat)
    lathe(fr, uc, dc, [(0.68 * D, y0 + 0.35 * k), (0.68 * D, y0 + 0.5 * k), (0.61 * D, y0 + 0.62 * k), (0.55 * D, y0 + 0.67 * k),
                       (0.54 * D, y0 + 0.79 * k), (0.6 * D, y0 + 0.87 * k), (0.57 * D, y0 + 0.97 * k), (0.51 * D, y0 + 1.0 * k)], 16, mat,
          smooth=True)
    ys, ye = y0 + 1.0 * k, y0 + H - 1.9 * k
    prof = [(r * (1 - 0.13 * (i / 4) ** 1.4), ys + (ye - ys) * i / 4) for i in range(5)]
    lathe(fr, uc, dc, prof, 48, mat, mod=lambda j: 1.0 if j % 2 == 0 else 0.93)
    rt = prof[-1][0]
    lathe(fr, uc, dc, [(rt * 1.06, ye - 0.22 * k), (rt * 1.1, ye - 0.12 * k), (rt * 1.06, ye)], 16, mat, smooth=True)
    lathe(fr, uc, dc, [(rt, ye), (rt, ye + 0.4 * k), (rt * 1.08, ye + 1.0 * k), (rt * 1.22, ye + 1.56 * k)], 16, mat, smooth=True)
    for row, (yb, yt, rb, ro, w, k0) in enumerate(((ye + 0.05 * k, ye + 0.78 * k, rt - 0.03 * k, rt + 0.26 * k, 0.2 * k, 0.0),
                                                     (ye + 0.5 * k, ye + 1.36 * k, rt + 0.02 * k, rt + 0.42 * k, 0.18 * k, 0.5))):
        for i in range(8):
            a = 2 * math.pi * (i + k0) / 8 + math.pi / 8
            ca, sa = math.cos(a), math.sin(a)
            tx, tz = -sa, ca
            pts = []
            for y, rr in ((yb, rb), (yt, ro)):
                for side in (-1, 1):
                    for th in (0.0, -0.12 * k):
                        pts.append((uc + (rr + th) * ca + side * w * tx, y, dc + (rr + th) * sa + side * w * tz))
            b = [pts[0], pts[2], pts[3], pts[1]]
            t = [pts[4], pts[6], pts[7], pts[5]]
            hexa([fr.p(q[0], q[1], q[2]) for q in b] + [fr.p(q[0], q[1], q[2]) for q in t], mat)
    ab = 0.72 * D
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        ca, sa = math.cos(a), math.sin(a)
        tx, tz = -sa, ca
        pts = []
        for y, rr in ((ye + 1.1 * k, rt + 0.15 * k), (ye + 1.62 * k, ab * 1.33)):
            for side in (-1, 1):
                for th in (0.0, -0.3 * k):
                    pts.append((uc + (rr + th) * ca + side * 0.16 * k * tx, y, dc + (rr + th) * sa + side * 0.16 * k * tz))
        b = [pts[0], pts[2], pts[3], pts[1]]
        t = [pts[4], pts[6], pts[7], pts[5]]
        hexa([fr.p(q[0], q[1], q[2]) for q in b] + [fr.p(q[0], q[1], q[2]) for q in t], mat)
    c = 0.26 * k
    oct8 = [(-ab + c, -ab), (ab - c, -ab), (ab, -ab + c), (ab, ab - c), (ab - c, ab), (-ab + c, ab), (-ab, ab - c), (-ab, -ab + c)]
    prism(fr, [(uc + x, dc + z) for x, z in oct8], ye + 1.56 * k, y0 + H, mat)


def pilaster(fr, u, y0, y1, w=1.2, proj=0.4, d=0.0, mat='marble'):
    """Flat pilaster on a face at depth d: base, shaft, capital block."""
    box(fr, u - w / 2 - 0.12, u + w / 2 + 0.12, y0, y0 + 0.5, d, d + proj + 0.12, mat)
    box(fr, u - w / 2, u + w / 2, y0 + 0.5, y1 - 0.7, d, d + proj, mat)
    box(fr, u - w / 2 - 0.08, u + w / 2 + 0.08, y1 - 0.7, y1 - 0.3, d, d + proj + 0.1, mat)
    box(fr, u - w / 2 - 0.18, u + w / 2 + 0.18, y1 - 0.3, y1, d, d + proj + 0.2, mat)


def window(fr, u, y0, y1, w, d=0.0, mat='marble', glass=True, pediment=True):
    """Framed window on a face: architrave frame proud of the wall, dark glass set back in it."""
    fw, fp = 0.32, 0.26
    if glass:
        box(fr, u - w / 2, u + w / 2, y0, y1, d - 0.02, d + 0.03, 'glass')
        for k in range(1, 3):  # glazing bars
            yy = y0 + (y1 - y0) * k / 3
            box(fr, u - w / 2, u + w / 2, yy - 0.05, yy + 0.05, d, d + 0.08, mat)
        box(fr, u - 0.05, u + 0.05, y0, y1, d, d + 0.08, mat)
    box(fr, u - w / 2 - fw, u - w / 2, y0, y1, d, d + fp, mat)
    box(fr, u + w / 2, u + w / 2 + fw, y0, y1, d, d + fp, mat)
    box(fr, u - w / 2 - fw - 0.15, u + w / 2 + fw + 0.15, y0 - 0.3, y0, d, d + fp + 0.12, mat)
    box(fr, u - w / 2 - fw, u + w / 2 + fw, y1, y1 + fw, d, d + fp, mat)
    if pediment:
        box(fr, u - w / 2 - fw - 0.25, u + w / 2 + fw + 0.25, y1 + fw + 0.35, y1 + fw + 0.6, d, d + fp + 0.28, mat)
        box(fr, u - w / 2 - fw, u + w / 2 + fw, y1 + fw, y1 + fw + 0.35, d, d + 0.1, mat)


def cornice(pl, y1, scale=1.0, mat='marble'):
    """Classical cornice ending at y1 along a polyline: fascia, bed mould, corona, cyma."""
    k = scale
    for dy0, dy1, pr in ((1.3, 0.85, 0.22), (0.85, 0.55, 0.5), (0.55, 0.18, 0.9), (0.18, 0.0, 1.05)):
        band(pl, 0.0, pr * k, y1 - dy0 * k, y1 - dy1 * k, mat)


def rustic(pl, y0, y1, mat='marble'):
    """Plinth course and horizontal rusticated courses (channels between proud courses)."""
    band(pl, 0.0, 0.4, y0, y0 + 1.0, mat)
    y = y0 + 1.12
    while y + 0.8 <= y1:
        band(pl, 0.0, 0.08, y, y + 0.78, mat)
        y += 0.9
    band(pl, 0.0, 0.32, y1, y1 + 0.45, mat)


def seg_frames(pl):
    """(frame, length) for each straight segment of a polyline, outward normal = +d."""
    out = []
    for p, q in zip(pl, pl[1:]):
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        out.append((Fr(p[0], p[1], math.atan2(q[1] - p[1], q[0] - p[0])), L))
    return out


def bays(pl, y0, y1, bay=6.0, win=None, pil=True, margin=1.2):
    """Pilasters every `bay` metres along each straight segment, optional window between them."""
    for fr, L in seg_frames(pl):
        if L < bay * 0.8:
            continue
        n = max(1, int(round((L - 2 * margin) / bay)))
        us = [margin + (L - 2 * margin) * i / n for i in range(n + 1)]
        if pil:
            for u in us:
                pilaster(fr, u, y0, y1)
        if win:
            wy0, wy1, ww = win
            for a, b in zip(us, us[1:]):
                window(fr, (a + b) / 2, wy0, wy1, min(ww, (b - a) - 2.4))


# ------------------------------------------------------------------ sculpture (simplified, no faces)

def figure(T, mat, arms=('down', 'down'), wings=False, robe=1.0):
    """Standing draped figure, height 1 in local units (x forward, z right)."""
    ys = [0.0, 0.12, 0.35, 0.55, 0.68, 0.78, 0.84]
    rs = [(0.16 * robe, 0.13 * robe), (0.15 * robe, 0.12 * robe), (0.12, 0.09), (0.11, 0.08), (0.125, 0.085), (0.14, 0.075), (0.06, 0.05)]
    loft([(0.0, y, 0.0) for y in ys], rs, 10, mat, T)
    loft([(0.0, 0.83, 0.0), (0.005, 0.87, 0.0), (0.01, 0.9, 0.0), (0.012, 0.95, 0.0), (0.008, 0.99, 0.0), (0.0, 1.0, 0.0)],
         [(0.035, 0.035), (0.04, 0.04), (0.058, 0.062), (0.06, 0.064), (0.045, 0.05), (0.015, 0.015)], 8, mat, T)
    poses = {'down': [(0.0, 0.8), (0.02, 0.62), (0.06, 0.47)],
             'raise': [(0.0, 0.8), (0.03, 0.93), (0.05, 1.1)],
             'forward': [(0.0, 0.8), (0.14, 0.72), (0.3, 0.76)],
             'hip': [(0.0, 0.8), (-0.04, 0.64), (0.03, 0.56)],
             'spear': [(0.0, 0.8), (0.08, 0.7), (0.14, 0.82)]}
    for side, arm in zip((-1, 1), arms):
        pts = poses[arm]
        z = [0.15, 0.2, 0.19] if arm != 'raise' else [0.15, 0.22, 0.2]
        loft([(x, y, side * zz) for (x, y), zz in zip(pts, z)], [(0.04, 0.04), (0.034, 0.034), (0.028, 0.028)], 6, mat, T)
        if arm == 'spear':
            loft([(0.16, 0.2, side * 0.2), (0.12, 1.25, side * 0.2)], [(0.012, 0.012), (0.012, 0.012)], 5, mat, T)
    if wings:
        for side in (-1, 1):
            pts = [(-0.06, 0.8, side * 0.05), (-0.18, 0.95, side * 0.2), (-0.3, 1.15, side * 0.42), (-0.36, 1.32, side * 0.55)]
            loft(pts, [(0.02, 0.14), (0.02, 0.2), (0.02, 0.16), (0.015, 0.04)], 6, mat, T, ref=(0.0, 0.0, 1.0))


def recliner(T, mat):
    """Reclining river/sea figure (fountain groups), length ~1.3, height ~0.6."""
    loft([(-0.65, 0.12, 0.0), (-0.3, 0.16, 0.0), (0.0, 0.2, 0.0), (0.18, 0.3, 0.0), (0.26, 0.45, 0.0), (0.28, 0.52, 0.0)],
         [(0.1, 0.08), (0.14, 0.11), (0.16, 0.13), (0.15, 0.12), (0.13, 0.1), (0.05, 0.05)], 8, mat, T)
    loft([(0.28, 0.51, 0.0), (0.3, 0.56, 0.0), (0.31, 0.6, 0.0), (0.3, 0.63, 0.0)],
         [(0.03, 0.03), (0.055, 0.055), (0.05, 0.05), (0.015, 0.015)], 8, mat, T)
    loft([(0.26, 0.47, 0.13), (0.15, 0.3, 0.2), (0.1, 0.18, 0.2)], [(0.035, 0.035), (0.03, 0.03), (0.03, 0.03)], 6, mat, T)
    loft([(0.26, 0.47, -0.13), (0.4, 0.5, -0.2), (0.52, 0.62, -0.2)], [(0.035, 0.035), (0.03, 0.03), (0.03, 0.03)], 6, mat, T)


def seated(T, mat, arms=('forward', 'down')):
    """Seated draped figure (fountain attendants), sitting height ~0.75, knees forward."""
    loft([(0.0, 0.4, 0.0), (0.0, 0.55, 0.0), (0.0, 0.7, 0.0), (0.0, 0.78, 0.0)],
         [(0.15, 0.12), (0.12, 0.085), (0.135, 0.08), (0.06, 0.05)], 10, mat, T)
    loft([(0.0, 0.77, 0.0), (0.005, 0.81, 0.0), (0.01, 0.86, 0.0), (0.008, 0.9, 0.0), (0.0, 0.92, 0.0)],
         [(0.035, 0.035), (0.058, 0.062), (0.06, 0.064), (0.045, 0.05), (0.015, 0.015)], 8, mat, T)
    for zs in (-1, 1):
        loft([(-0.02, 0.42, zs * 0.08), (0.2, 0.45, zs * 0.09), (0.36, 0.44, zs * 0.1), (0.4, 0.22, zs * 0.1), (0.42, 0.02, zs * 0.1)],
             [(0.08, 0.08), (0.075, 0.07), (0.06, 0.06), (0.05, 0.05), (0.055, 0.05)], 8, mat, T)
    loft([(0.0, 0.4, 0.0), (0.25, 0.36, 0.0), (0.4, 0.12, 0.0), (0.44, 0.0, 0.0)], [(0.17, 0.08), (0.2, 0.08), (0.2, 0.05), (0.2, 0.03)], 8, mat, T)
    poses = {'down': [(0.0, 0.74), (0.06, 0.58), (0.2, 0.46)], 'forward': [(0.0, 0.74), (0.14, 0.66), (0.3, 0.7)],
             'raise': [(0.0, 0.74), (0.03, 0.88), (0.05, 1.04)]}
    for zs, arm in zip((-1, 1), arms):
        loft([(x, y, zs * zz) for (x, y), zz in zip(poses[arm], (0.14, 0.18, 0.17))], [0.04, 0.034, 0.028], 6, mat, T)


def rocks(T, mat, n=7, seed=1):
    """Rough rock base for fountain groups: tilted blocks."""
    rnd = seed
    for i in range(n):
        rnd = (rnd * 1103515245 + 12345) % 2 ** 31
        a = (rnd % 1000) / 1000.0
        rnd = (rnd * 1103515245 + 12345) % 2 ** 31
        b = (rnd % 1000) / 1000.0
        x = -1.0 + 2.0 * i / max(1, n - 1)
        w, h = 0.35 + 0.3 * a, 0.25 + 0.45 * b
        tilt = (a - 0.5) * 0.25
        pts = []
        for y in (0.0, h):
            for dx, dz in ((-w, -0.5), (w, -0.45), (w * 0.8, 0.5), (-w * 0.9, 0.45)):
                pts.append((x + dx + tilt * y, y, dz * (1.0 - 0.3 * y / max(h, 0.1))))
        hexa([T(p) for p in pts], mat)


def horse(T, mat, gait='stand', sides=10):
    """Life-size horse in local metres (x forward, y up, z right), hooves at y=0.
    gait: 'stand' (equestrian, near foreleg lifted) or 'rear' (quadriga, forelegs raised)."""
    pitch = math.radians(16.0) if gait == 'rear' else 0.0
    piv = (-0.75, 1.2)
    cp, sp = math.cos(pitch), math.sin(pitch)
    def R(p):
        x, y, z = p
        x0, y0 = x - piv[0], y - piv[1]
        return (piv[0] + x0 * cp - y0 * sp, piv[1] + x0 * sp + y0 * cp, z)
    def Lf(pts, radii, n=sides, ref=None, rot=True):
        loft([R(p) if rot else p for p in pts], radii, n, mat, T, ref=ref)
    Lf([(-1.0, 1.42, 0), (-0.86, 1.41, 0), (-0.5, 1.36, 0), (0.0, 1.33, 0), (0.4, 1.37, 0), (0.66, 1.43, 0), (0.83, 1.47, 0)],
       [(0.12, 0.12), (0.28, 0.33), (0.33, 0.39), (0.32, 0.37), (0.31, 0.39), (0.26, 0.34), (0.12, 0.16)], 12)
    Lf([(0.6, 1.6, 0), (0.8, 1.86, 0), (0.94, 2.1, 0), (1.01, 2.26, 0)],
       [(0.16, 0.3), (0.14, 0.24), (0.11, 0.18), (0.1, 0.13)], sides)
    Lf([(0.97, 2.32, 0), (1.1, 2.24, 0), (1.28, 2.04, 0), (1.37, 1.93, 0)],
       [(0.1, 0.13), (0.1, 0.13), (0.08, 0.1), (0.06, 0.07)], sides)
    for zs in (-1, 1):
        Lf([(0.99, 2.36, zs * 0.06), (0.97, 2.48, zs * 0.07)], [(0.03, 0.03), (0.008, 0.008)], 5)
    Lf([(0.58, 1.84, 0), (0.78, 2.1, 0), (0.95, 2.36, 0)], [(0.04, 0.07), (0.04, 0.08), (0.03, 0.04)], 6)
    Lf([(-1.0, 1.46, 0), (-1.14, 1.32, 0), (-1.2, 1.02, 0), (-1.18, 0.72, 0)], [0.08, 0.08, 0.06, 0.05], 6, ref=(0.0, 0.0, 1.0))
    lr = [(0.12, 0.13), (0.085, 0.09), (0.055, 0.06), (0.05, 0.05), (0.065, 0.06)]
    for zs in (-1, 1):
        # hind legs stay planted: the hip moves with the pitch, the hoof does not
        hip = R((-0.74, 1.22, zs * 0.17))
        foot = (-0.86 + (0.12 if zs > 0 else -0.05), 0.02, zs * 0.17)
        hock = (hip[0] * 0.45 + foot[0] * 0.55 - 0.16, 0.55, zs * 0.17)
        Lf([hip, (hip[0] - 0.05, (hip[1] + 0.55) / 2 + 0.1, zs * 0.17), hock, (foot[0] + 0.04, 0.14, zs * 0.17), foot],
           lr, 6, ref=(0.0, 0.0, 1.0), rot=False)
        if gait == 'rear':
            pts = [(0.55, 1.22, zs * 0.17), (0.74, 0.98, zs * 0.17), (0.96, 1.05 + (0.08 if zs > 0 else 0), zs * 0.17),
                   (0.92, 0.82, zs * 0.17), (0.95, 0.74, zs * 0.17)]
        elif zs < 0:   # near foreleg raised, walking
            pts = [(0.55, 1.22, zs * 0.17), (0.64, 0.82, zs * 0.17), (0.82, 0.62, zs * 0.17), (0.78, 0.4, zs * 0.17), (0.82, 0.33, zs * 0.17)]
        else:
            pts = [(0.55, 1.22, zs * 0.17), (0.58, 0.82, zs * 0.17), (0.58, 0.45, zs * 0.17), (0.6, 0.13, zs * 0.17), (0.62, 0.02, zs * 0.17)]
        Lf(pts, lr, 6, ref=(0.0, 0.0, 1.0), rot=gait == 'rear')


def rider(T, mat):
    """Mounted figure on a horse(stand): torso, head with a plumed helmet, arms, legs on the flanks."""
    loft([(-0.1, 1.72, 0), (-0.08, 1.95, 0), (-0.05, 2.2, 0), (-0.04, 2.38, 0)],
         [(0.2, 0.15), (0.21, 0.14), (0.23, 0.14), (0.12, 0.1)], 10, mat, T)
    loft([(-0.04, 2.36, 0), (-0.03, 2.42, 0), (-0.02, 2.5, 0), (-0.02, 2.58, 0), (-0.03, 2.64, 0)],
         [(0.05, 0.05), (0.09, 0.1), (0.1, 0.11), (0.1, 0.11), (0.03, 0.03)], 8, mat, T)
    loft([(-0.03, 2.62, 0), (-0.02, 2.7, 0), (-0.1, 2.76, 0)], [(0.08, 0.1), (0.05, 0.06), (0.02, 0.02)], 6, mat, T)
    for zs in (-1, 1):
        loft([(-0.05, 2.3, zs * 0.22), (0.05, 2.08, zs * 0.28), (0.22, 1.98, zs * 0.18)], [0.055, 0.045, 0.04], 6, mat, T)
        loft([(-0.1, 1.8, zs * 0.18), (0.18, 1.62, zs * 0.33), (0.14, 1.28, zs * 0.34), (0.2, 1.1, zs * 0.32)],
             [0.09, 0.075, 0.055, 0.05], 6, mat, T)
    loft([(0.22, 1.98, 0.18), (0.24, 2.06, 0.18), (0.26, 2.6, 0.12)], [0.02, 0.02, 0.012], 5, mat, T)


def relief_row(fr, u0, u1, y0, h, d, n, mat='carved', seed=0):
    """Bas-relief procession on a face: n flattened figures between u0 and u1, base y0, height h."""
    poses = [('down', 'forward'), ('raise', 'down'), ('forward', 'hip'), ('spear', 'down'), ('down', 'raise')]
    for i in range(n):
        u = u0 + (u1 - u0) * (i + 0.5) / n
        a, y, f = fr.p(u, y0, d)
        heading = math.degrees(math.atan2(fr.n[1], fr.n[0]))
        T = pose(a, y, f, heading, h, kx=0.28)
        figure(T, mat, arms=poses[(i + seed) % len(poses)])


# ------------------------------------------------------------------ monument helpers

R = 111.0            # radius of the portico's column line (concave toward the piazza)
FMID = -12.0         # column line on the axis
FC = FMID + R        # circle centre, in front of the monument
COLS = [-36.0 + 4.8 * i for i in range(16)]   # 16 columns, 4.8 m apart (photos: spacing ~2.5 diameters)


def arc_af(a, r):
    return (a, FC - math.sqrt(r * r - a * a))


def arc_frame(a, r=R):
    th = math.asin(a / r)
    return Fr(r * math.sin(th), FC - r * math.cos(th), th)


def sector(A, r0, r1, y0, y1, mat='marble', n=48):
    """Plan band between radii r0 < r1 (larger = further back), clipped to |a| <= A."""
    front = [arc_af(-A + 2 * A * k / n, r0) for k in range(n + 1)]
    back = [arc_af(-A + 2 * A * k / n, r1) for k in range(n, -1, -1)]
    prism(MF, front + back, y0, y1, mat)


def eprism(pts, a0, a1, mat='marble'):
    """Elevation polygon [(f, y)] extruded across a0..a1."""
    n = len(pts)
    v = [(a0, y, f) for f, y in pts] + [(a1, y, f) for f, y in pts]
    fc = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    raw(v, fc, mat)


def gable(fr, u0, u1, y0, h, d0, d1, mat='marble'):
    tri = [(u0, y0), (u1, y0), ((u0 + u1) / 2, y0 + h)]
    v = [fr.p(u, y, d0) for u, y in tri] + [fr.p(u, y, d1) for u, y in tri]
    raw(v, [(2, 1, 0), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)], mat)


def ellipse_pts(ca, cf, ra, rf, t0, t1, n):
    return [(ca + ra * math.cos(math.radians(t0 + (t1 - t0) * k / n)), cf + rf * math.sin(math.radians(t0 + (t1 - t0) * k / n)))
            for k in range(n + 1)]


def heading_of(fr):
    return math.degrees(math.atan2(fr.n[1], fr.n[0]))


def shifted(T, dz=0.0, dx=0.0):
    return lambda p: T((p[0] + dx, p[1], p[2] + dz))


def group(A, Y, F, heading, s, mat, kind, wings=False):
    """Allegorical group (simplified): a principal figure with attendants on a rough base."""
    T = pose(A, Y, F, heading, s)
    rocks(lambda p: T((p[0] * 0.35, p[1] * 0.25, p[2] * 0.6)), mat, n=4, seed=len(kind) + int(abs(A)))
    figure(shifted(T, 0.0, 0.05), mat, arms=('raise', 'forward') if kind != 'thought' else ('hip', 'down'), wings=wings)
    if kind == 'thought':
        recliner(lambda p: T((p[0] * 0.6 + 0.1, p[1] * 0.6 + 0.12, p[2] * 0.6 + 0.3)), mat)
    else:
        figure(lambda p: T((p[0] * 0.8 + 0.12, p[1] * 0.8 + 0.12, p[2] * 0.8 - 0.28)), mat, arms=('spear', 'down'))
    figure(lambda p: T((p[0] * 0.72 - 0.05, p[1] * 0.72 + 0.12, p[2] * 0.72 + 0.3)), mat, arms=('forward', 'down'))


def dress_front(fr, u0, u1, y0, y1):
    """Plain front face treatment on a straight segment (plinth + cornice)."""
    pl = [fr.p(u0, 0, 0), fr.p(u1, 0, 0)]
    pl = [(p[0], p[2]) for p in pl]
    band(pl, 0.0, 0.3, y0, y0 + 0.7)
    cornice(pl, y1, 0.8)


def mir(s, pl):
    return pl if s > 0 else mirror_pl(pl)


# ------------------------------------------------------------------ extra sculpture and helpers

REG = [('raise', 'down'), ('spear', 'down'), ('forward', 'hip'), ('down', 'spear'), ('hip', 'forward'), ('down', 'raise')]


def aprism(pts, f0, f1, mat='marble'):
    """Elevation polygon [(a, y)] extruded along f from f0 to f1."""
    n = len(pts)
    v = [(a, y, f0) for a, y in pts] + [(a, y, f1) for a, y in pts]
    fc = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    raw(v, fc, mat)


def winged_lion(T, mat):
    """Seated winged lion (the pair at the head of the grand stair), height ~2.3 local units."""
    lbox(T, -0.95, 0.95, 0.0, 0.16, -0.5, 0.5, mat)
    L = lambda pts, rr, n=10, ref=None: loft(pts, rr, n, mat, T, ref=ref)
    L([(-0.72, 0.6, 0), (-0.45, 0.88, 0), (-0.05, 1.18, 0), (0.25, 1.43, 0), (0.38, 1.56, 0)],
      [(0.3, 0.36), (0.28, 0.36), (0.25, 0.3), (0.24, 0.28), (0.18, 0.2)])
    L([(0.3, 1.49, 0), (0.45, 1.66, 0), (0.6, 1.72, 0), (0.75, 1.69, 0), (0.84, 1.63, 0)],
      [(0.2, 0.25), (0.25, 0.27), (0.2, 0.2), (0.13, 0.12), (0.07, 0.07)])
    for zs in (-1, 1):
        L([(0.32, 1.34, zs * 0.14), (0.36, 0.74, zs * 0.15), (0.4, 0.2, zs * 0.15), (0.52, 0.17, zs * 0.15)], [0.1, 0.08, 0.07, 0.06], 6)
        L([(-0.6, 0.69, zs * 0.22), (-0.3, 0.39, zs * 0.24), (-0.05, 0.24, zs * 0.24), (0.12, 0.18, zs * 0.22)], [0.18, 0.14, 0.09, 0.07], 6)
        L([(0.05, 1.34, zs * 0.2), (-0.2, 1.69, zs * 0.36), (-0.45, 2.09, zs * 0.46), (-0.7, 2.39, zs * 0.5)],
          [(0.03, 0.28), (0.03, 0.36), (0.03, 0.3), (0.02, 0.08)], 6, (0.0, 0.0, 1.0))
    L([(-0.72, 0.6, 0.0), (-0.9, 0.34, 0.1), (-0.7, 0.19, 0.35)], [0.05, 0.05, 0.04], 5)


def rostral(A, F):
    """Rostral column of the propylaea terraces: pink-marble shaft with bronze prows,
    white base and capital, gilded winged Victory on a globe (photos: ~17 m in all)."""
    fr = Fr(A, F, 0.0)
    box(fr, -1.0, 1.0, 40.0, 40.5, -1.0, 1.0, 'marble')
    box(fr, -0.85, 0.85, 40.5, 42.6, -0.85, 0.85, 'marble')
    box(fr, -0.95, 0.95, 42.6, 42.9, -0.95, 0.95, 'marble')
    lathe(fr, 0.0, 0.0, [(0.62, 42.9), (0.62, 43.2), (0.52, 43.35), (0.5, 43.5)], 16, 'marble', smooth=True)
    lathe(fr, 0.0, 0.0, [(0.48, 43.5), (0.46, 47.5), (0.43, 51.6)], 20, 'marble_pink', smooth=True)
    for y in (45.0, 47.4, 49.8):
        for k in range(4):
            t = math.pi / 4 + k * math.pi / 2 + (0.0 if y != 47.4 else math.pi / 4)
            c, s_ = math.cos(t), math.sin(t)
            loft([(A + 0.38 * c, y, F + 0.38 * s_), (A + 0.85 * c, y + 0.22, F + 0.85 * s_), (A + 1.1 * c, y + 0.55, F + 1.1 * s_)],
                 [(0.16, 0.3), (0.11, 0.2), (0.03, 0.05)], 6, 'bronze')
    lathe(fr, 0.0, 0.0, [(0.45, 51.6), (0.52, 51.8), (0.47, 51.95), (0.55, 52.6), (0.72, 53.2)], 12, 'marble', smooth=True)
    box(fr, -0.78, 0.78, 53.2, 53.55, -0.78, 0.78, 'marble')
    lathe(fr, 0.0, 0.0, [(0.2, 53.55), (0.4, 53.75), (0.4, 53.95), (0.2, 54.15)], 12, 'gold', smooth=True)
    figure(pose(A, 54.15, F, 90.0, 2.5), 'gold', arms=('raise', 'forward'), wings=True)


def medallion(fr, u, y, d, r=0.85, mat='carved'):
    """Wreath medallion standing proud of a face (frame d = face depth)."""
    p0, p1 = fr.p(u, y, d - 0.02), fr.p(u, y, d + 0.26)
    loft([p0, p1], [(r, r), (r, r)], 16, mat, smooth=False)
    q0, q1 = fr.p(u, y, d + 0.26), fr.p(u, y, d + 0.36)
    loft([q0, q1], [(r * 0.55, r * 0.55), (r * 0.5, r * 0.5)], 12, mat, smooth=False)


def panel(fr, u, y0, y1, w, d, t=0.28, proj=0.2, mat='marble'):
    """Square moulded frame on a face."""
    for u0, u1, a0, a1 in ((u - w / 2, u + w / 2, y0, y0 + t), (u - w / 2, u + w / 2, y1 - t, y1),
                           (u - w / 2, u - w / 2 + t, y0 + t, y1 - t), (u + w / 2 - t, u + w / 2, y0 + t, y1 - t)):
        box(fr, u0, u1, a0, a1, d, d + proj, mat)


# ================================================================== A  grand stair, Thought and Action, lions, masts
stair(MF, -16.2, 16.2, 86.5, 62.0, 0.0, 10.4, 40)
mbox(-16.2, 16.2, 0.0, 10.4, 56.5, 62.0)                                    # landing before the altar
for s in (1, -1):
    slope_box(MF, s * 16.2, s * 19.2, 82.5, 62.0, 0.0, 1.2, 12.0, 'marble')  # stair cheek
    mbox(s * 16.2, s * 19.2, 0.0, 12.0, 56.5, 62.0)
    balustrade((s * 17.7, 82.2), (s * 17.7, 63.0), 1.25, 11.45)
    def fmax(y): return 82.5 - (y - 1.2) * 20.5 / 10.8
    mbox(s * 19.2, s * 19.55, 0.0, 0.9, 57.7, 82.5)
    y = 1.0
    while y + 0.8 < 11.2:
        mbox(s * 19.2, s * 19.28, y, y + 0.78, 57.7, min(82.5, fmax(y + 0.78) - 0.4))
        y += 0.9
    mbox(s * 19.2, s * 19.5, 11.35, 12.05, 57.7, 62.0)
    hexa([(s * a, yy, f) for a, f, yy in ((19.2, 82.5, 0.55), (19.5, 82.5, 0.55), (19.5, 62.0, 11.35), (19.2, 62.0, 11.35))] +
         [(s * a, yy, f) for a, f, yy in ((19.2, 82.5, 1.25), (19.5, 82.5, 1.25), (19.5, 62.0, 12.05), (19.2, 62.0, 12.05))], 'marble')
    # Il Pensiero (east) and L'Azione (west): bronze groups on 7 m pedestals at the foot of the stair
    # (OSM squares a 19.2-22.7, f 83.6-87.9 are the pedestal cores; photos: pedestal ~ group height)
    P0, P1, Q0, Q1 = 16.4, 23.6, 82.0, 88.6
    mbox(s * P0, s * P1, 0.0, 1.0, Q0, Q1)
    mbox(s * (P0 + 0.35), s * (P1 - 0.35), 1.0, 1.5, Q0 + 0.35, Q1 - 0.35)
    mbox(s * (P0 + 0.6), s * (P1 - 0.6), 1.5, 5.9, Q0 + 0.6, Q1 - 0.6)
    mbox(s * (P0 + 0.35), s * (P1 - 0.35), 5.9, 6.3, Q0 + 0.35, Q1 - 0.35)
    mbox(s * P0, s * P1, 6.3, 6.8, Q0, Q1)
    mbox(s * (P0 + 0.3), s * (P1 - 0.3), 6.8, 7.2, Q0 + 0.3, Q1 - 0.3)
    medallion(Fr(s * 20.0, Q1 - 0.6, 0.0), 0.0, 3.7, 0.0, 1.2)
    medallion(Fr(s * (P1 - 0.6), 85.3, -math.pi / 2 if s > 0 else math.pi / 2), 0.0, 3.7, 0.0, 1.2)
    # photos: the winged group stands on the viewer's left (east, s > 0), the banner group on the right
    group(s * 20.0, 7.2, 85.3, 90.0, 6.6, 'bronze', 'thought' if s > 0 else 'action', wings=s > 0)
    # winged marble lions on the cheek heads and the two bronze flag masts behind them (flags left off)
    mbox(s * 16.4, s * 19.0, 12.0, 13.4, 59.8, 62.4)
    mbox(s * 16.25, s * 19.15, 13.4, 13.6, 59.65, 62.55)
    winged_lion(pose(s * 17.7, 13.6, 61.1, 90.0, 1.3), 'carved')
    fb = Fr(s * 17.7, 58.0, 0.0)
    lathe(fb, 0.0, 0.0, [(0.95, 12.0), (0.95, 12.6), (0.72, 12.9), (0.58, 14.4), (0.78, 14.8), (0.5, 15.3), (0.3, 16.0)], 12, 'bronze', smooth=True)
    lathe(fb, 0.0, 0.0, [(0.28, 16.0), (0.2, 30.0), (0.13, 44.0), (0.11, 44.6)], 8, 'bronze', smooth=True)
    lathe(fb, 0.0, 0.0, [(0.02, 44.6), (0.3, 44.8), (0.3, 45.2), (0.02, 45.5)], 8, 'gold', smooth=True)

# ================================================================== C  Altar of the Fatherland
# Photos: the altar front is ~0.7 of the stair width; a long relief procession runs either side of the
# gold-ground aedicule of Dea Roma; the Tomb of the Unknown Soldier sits at its foot.
FA = Fr(0.0, 56.5, 0.0)                                   # altar face, d = f - 56.5
mbox(-12.0, 12.0, 0.0, 21.0, 41.0, 55.5)
for s in (1, -1):
    mbox(s * 3.2, s * 12.0, 0.0, 21.0, 55.5, 56.5)
mbox(-3.2, 3.2, 0.0, 12.4, 55.5, 56.5)
mbox(-3.2, 3.2, 18.6, 21.0, 55.5, 56.5)
mbox(-3.2, 3.2, 12.4, 18.6, 55.44, 55.5, 'gold')         # gold ground of the Dea Roma niche
mbox(-1.1, 1.1, 12.4, 13.0, 55.5, 56.4, 'carved')
figure(pose(0.0, 13.0, 55.9, 90.0, 5.2), 'carved', arms=('spear', 'down'))           # Dea Roma
for s in (1, -1):
    pilaster(FA, s * 3.75, 12.2, 18.6, w=1.0, proj=0.45)
box(FA, -4.7, 4.7, 18.6, 19.5, 0.0, 0.65, 'marble')
gable(FA, -4.9, 4.9, 19.5, 1.6, 0.0, 0.7)
band([(-12.0, 56.5), (12.0, 56.5)], 0.0, 0.3, 10.4, 11.1)
cornice([(-12.0, 56.5), (-4.9, 56.5)], 21.0, 0.8)
cornice([(4.9, 56.5), (12.0, 56.5)], 21.0, 0.8)
for s in (1, -1):
    for u0, u1, y0, y1 in ((4.7, 11.7, 13.0, 13.3), (4.7, 11.7, 18.1, 18.4), (4.7, 5.0, 13.0, 18.4), (11.4, 11.7, 13.0, 18.4)):
        box(FA, s * u0, s * u1, y0, y1, 0.0, 0.25, 'marble')
    relief_row(FA, s * 5.2, s * 11.2, 13.4, 4.4, 0.0, 6, seed=2 if s > 0 else 0)   # the processions
    cornice(mir(s, [(12.0, 56.5), (12.0, 41.0)]), 21.0, 0.7)
    balustrade((s * 5.1, 56.05), (s * 11.55, 56.05), 21.0)
    balustrade((s * 11.55, 56.05), (s * 11.55, 41.4), 21.0)
# Tomb of the Unknown Soldier: blank dark panel in a marble frame, eternal-flame braziers
mbox(-4.5, 4.5, 10.4, 12.2, 56.5, 58.0)
box(FA, -3.6, 3.6, 10.75, 11.85, 1.45, 1.55, 'granite')
for u0, u1, y0, y1 in ((-4.5, -3.6, 10.4, 12.2), (3.6, 4.5, 10.4, 12.2), (-3.6, 3.6, 11.85, 12.2), (-3.6, 3.6, 10.4, 10.75)):
    box(FA, u0, u1, y0, y1, 1.5, 1.72, 'marble')
box(FA, -4.8, 4.8, 12.2, 12.5, 0.9, 1.9, 'marble')
for s in (1, -1):
    Tb = pose(s * 6.9, 10.4, 59.4, 90.0, 1.0)
    for k in range(3):
        t = 2 * math.pi * k / 3
        loft([(0.45 * math.cos(t), 0.0, 0.45 * math.sin(t)), (0.2 * math.cos(t), 0.9, 0.2 * math.sin(t)), (0.35 * math.cos(t), 1.45, 0.35 * math.sin(t))],
             [0.05, 0.045, 0.04], 5, 'bronze', Tb)
    lathe(Fr(s * 6.9, 59.4, 0.0), 0.0, 0.0, [(0.12, 11.7), (0.45, 11.85), (0.62, 12.15), (0.58, 12.25)], 12, 'bronze', smooth=True)
    lathe(Fr(s * 6.9, 59.4, 0.0), 0.0, 0.0, [(0.45, 12.25), (0.3, 12.7), (0.08, 13.2)], 8, 'flame', smooth=True)

# ================================================================== D  flights beside the altar (platform -> second terrace)
for s in (1, -1):
    mbox(s * 12.0, s * 19.2, 0.0, 10.4, 36.5, 56.5)
    stair(MF, s * 12.0, s * 19.2, 56.5, 36.5, 10.4, 21.0, 40)
    slope_box(MF, s * 19.2, s * 20.4, 56.5, 41.0, 0.0, 11.6, 19.8, 'marble')
    balustrade((s * 19.8, 55.5), (s * 19.8, 41.3), 11.6 + 1.0 / 15.5 * 8.2, 11.6 + 15.2 / 15.5 * 8.2)

# ================================================================== E  lower wings, fountains, marble groups
# The lower wings run back at terrace height 12 all the way to the propylaea podia (photos: the
# podium fronts with their windows rise straight from this terrace; no second wing in between).
ARC = ellipse_pts(19.2, 49.0, 14.2, 8.7, 90.0, 0.0, 12)
for s in (1, -1):
    face = ARC + [(36.7, 49.0), (36.7, 47.5), (52.7, 47.5), (52.7, 49.0), (56.0, 49.0), (56.0, 5.0)]
    top = ARC + [(56.0, 49.0), (56.0, 5.0)]
    outline = [(19.2, 5.0)] + face
    prism(MF, [(s * a, f) for a, f in outline], 0.0, 12.0, 'marble')
    mbox(s * 36.7, s * 52.7, 9.5, 12.0, 47.5, 49.0)                    # lintel over the fountain niche
    rustic(mir(s, face), 0.0, 8.6)
    band(mir(s, top), 0.0, 0.2, 9.6, 9.9)
    cornice(mir(s, top), 12.0, 0.9)
    bal_pl(mir(s, top), 12.0)
    flank = Fr(s * 56.0, 0.0, -math.pi / 2 if s > 0 else math.pi / 2)   # u = -f (east) / u = f (west)
    for f in (38.5, 32.0, 25.5, 19.0, 12.5):
        u = -f if s > 0 else f
        window(flank, u, 2.6, 7.0, 2.4, glass=False)
    # fountain basin (Adriatic east, Tyrrhenian west): water, rim, rocks, three figures
    ell = ellipse_pts(44.7, 49.0, 10.0, 8.5, 180.0, 0.0, 20)
    water = [(54.7, 49.0)] + list(reversed(ell))[1:-1] + [(34.7, 49.0), (36.7, 49.0), (36.7, 47.5), (52.7, 47.5), (52.7, 49.0)]
    prism(MF, [(s * a, f) for a, f in water], 0.0, 0.55, 'water')
    band(mir(s, ell), -0.6, 0.0, 0.0, 0.8)
    band(mir(s, ell), -0.75, 0.12, 0.8, 1.0)
    Tf = pose(s * 44.7, 0.3, 49.4, 90.0, 5.0)
    rocks(Tf, 'carved', n=7, seed=3 if s > 0 else 5)
    figure(pose(s * 44.7, 2.6, 49.6, 90.0, 5.4), 'carved', arms=('raise', 'down') if s > 0 else ('down', 'raise'), robe=1.1)
    for k in (-1, 1):
        rocks(pose(s * 44.7 + k * 4.3, 0.3, 51.0, 90.0 - k * 25.0, 2.6), 'carved', n=4, seed=7 + k)
        seated(pose(s * 44.7 + k * 4.3, 1.9, 51.3, 90.0 - k * 25.0, 4.2), 'carved', arms=('forward', 'raise') if k > 0 else ('raise', 'down'))
    # the four marble groups (Force, Concord, Sacrifice, Right): one on a tall pedestal rising from the
    # piazza at each wing's outer corner, one on the terrace in front of each propylaeum podium
    mbox(s * 51.8, s * 57.2, 0.0, 1.0, 44.2, 49.9)
    mbox(s * 52.2, s * 56.8, 1.0, 12.4, 44.6, 49.5)
    mbox(s * 51.9, s * 57.1, 12.4, 13.0, 44.3, 49.8)
    mbox(s * 52.1, s * 56.9, 13.0, 13.5, 44.5, 49.6)
    medallion(Fr(s * 54.5, 49.5, 0.0), 0.0, 9.2, 0.0, 1.1)
    group(s * 54.5, 13.5, 47.05, 90.0, 5.6, 'carved', 'action' if s > 0 else 'force')
    mbox(s * 36.3, s * 40.3, 12.0, 15.0, 42.0, 46.0)
    mbox(s * 36.1, s * 40.5, 15.0, 15.4, 41.8, 46.2)
    group(s * 38.3, 15.4, 44.0, 90.0, 5.0, 'carved', 'thought' if s > 0 else 'concord')

# ================================================================== F  second terrace, cross flights, equestrian terrace
for s in (1, -1):
    mbox(s * 12.0, s * 19.2, 0.0, 21.0, 12.0, 36.5)                    # second terrace behind the altar flights
    mbox(s * 19.2, s * 33.0, 0.0, 21.0, 12.0, 41.0)
    pl2 = mir(s, [(20.4, 41.0), (33.0, 41.0)])
    band(pl2, 0.0, 0.3, 12.0, 12.6)
    cornice(pl2, 21.0, 0.8)
    for fr, L in seg_frames(pl2):
        for i in range(3):
            pilaster(fr, 1.2 + (L - 2.4) * i / 2, 12.6, 20.0, w=0.9, proj=0.3)
        for i in range(2):
            window(fr, 1.2 + (L - 2.4) * (i + 0.5) / 2, 14.2, 18.0, 1.6, glass=False, pediment=False)
    # cross flight rising outward from the second terrace (21) to the landing (33), photos: the
    # diagonal stairs seen either side of the altar climbing toward the propylaea
    fr2 = Fr(0.0, 0.0, -math.pi / 2) if s > 0 else Fr(0.0, 0.0, math.pi / 2)
    u0, u1 = (-38.0, -30.0) if s > 0 else (30.0, 38.0)
    stair(fr2, u0, u1, 19.5, 31.0, 21.0, 33.0, 26)
    balustrade((s * 19.5, 38.3), (s * 31.0, 38.3), 21.46, 33.0)
    balustrade((s * 19.5, 29.7), (s * 31.0, 29.7), 21.46, 33.0)
    mbox(s * 31.0, s * 36.0, 0.0, 33.0, 12.0, 38.6)                    # landing
    band(mir(s, [(31.0, 38.6), (36.0, 38.6)]), 0.0, 0.3, 21.0, 21.6)
    cornice(mir(s, [(31.0, 38.6), (36.0, 38.6)]), 33.0, 0.8)
    balustrade((s * 31.4, 38.15), (s * 35.7, 38.15), 33.0)
    balustrade((s * 31.45, 29.3), (s * 31.45, 12.4), 33.0)
    cornice(mir(s, [(31.0, 12.0), (31.0, 29.7)]), 33.0, 0.7)
    band(mir(s, [(36.0, 38.6), (36.0, 5.0)]), 0.0, 0.3, 21.0, 21.6)
    cornice(mir(s, [(36.0, 38.6), (36.0, 5.0)]), 33.0, 0.8)
# equestrian terrace above the altar, reached by the flights round the altar
mbox(-12.0, 12.0, 0.0, 27.5, 12.0, 41.0)
band([(-12.0, 41.0), (12.0, 41.0)], 0.0, 0.25, 21.0, 21.6)
FT = Fr(0.0, 41.0, 0.0)
for s in (1, -1):
    for k in range(3):
        u = s * (5.0 + 1.7 * k)
        box(FT, u - 0.55, u + 0.55, 23.2, 24.9, -0.05, 0.08, 'bronze')      # the small square grilles
        panel(FT, u, 23.0, 25.1, 1.5, 0.0, t=0.2, proj=0.15)
    cornice(mir(s, [(12.0, 41.0), (12.0, 12.0)]), 27.5, 0.6)
    balustrade((s * 11.55, 40.55), (s * 11.55, 12.4), 27.5)
cornice([(-12.0, 41.0), (12.0, 41.0)], 27.5, 0.7)
balustrade((-11.55, 40.55), (11.55, 40.55), 27.5)

# ================================================================== G  equestrian statue of Victor Emmanuel II
# Photos: the tall pedestal (relief band of the Italian cities, blank band, cornice) carries the statue
# so its hooves are level with the portico floor and the rider's head stays below the capitals.
EQ = 26.0
mbox(-6.4, 6.4, 27.5, 28.2, EQ - 7.8, EQ + 7.8)
mbox(-5.9, 5.9, 28.2, 28.9, EQ - 7.3, EQ + 7.3)
mbox(-4.8, 4.8, 28.9, 33.3, EQ - 6.2, EQ + 6.2)
for fr, u0, u1 in ((Fr(0.0, EQ + 6.2, 0.0), -3.6, 3.6), (Fr(0.0, EQ - 6.2, math.pi), -3.6, 3.6),
                   (Fr(4.8, 0.0, -math.pi / 2), -(EQ + 5.0), -(EQ - 5.0)), (Fr(-4.8, 0.0, math.pi / 2), EQ - 5.0, EQ + 5.0)):
    panel(fr, (u0 + u1) / 2, 29.6, 32.6, u1 - u0, 0.0, t=0.3, proj=0.2)
    medallion(fr, (u0 + u1) / 2, 31.1, 0.0, 0.9)
mbox(-5.1, 5.1, 33.3, 33.8, EQ - 6.5, EQ + 6.5)
mbox(-4.3, 4.3, 33.8, 38.2, EQ - 5.5, EQ + 5.5)
relief_row(Fr(0.0, EQ + 5.5, 0.0), -3.7, 3.7, 33.9, 4.1, 0.0, 5)
relief_row(Fr(0.0, EQ - 5.5, math.pi), -3.7, 3.7, 33.9, 4.1, 0.0, 5, seed=1)
relief_row(Fr(4.3, 0.0, -math.pi / 2), -(EQ + 4.9), -(EQ - 4.9), 33.9, 4.1, 0.0, 7, seed=2)
relief_row(Fr(-4.3, 0.0, math.pi / 2), EQ - 4.9, EQ + 4.9, 33.9, 4.1, 0.0, 7, seed=3)
mbox(-4.55, 4.55, 38.2, 39.4, EQ - 5.75, EQ + 5.75)                   # blank band (no inscription)
mbox(-4.95, 4.95, 39.4, 40.0, EQ - 6.15, EQ + 6.15)
mbox(-4.6, 4.6, 40.0, 40.5, EQ - 5.8, EQ + 5.8)
TE = pose(0.0, 40.5, EQ, 90.0, 4.35)                                   # 12 m high overall (published)
horse(TE, 'bronze', 'stand', sides=12)
rider(TE, 'bronze')

# ================================================================== H  podium of the portico (terrace at 33)
mbox(-36.0, 36.0, 0.0, 33.0, -30.0, 12.0)
PL3 = [(-31.0, 12.0), (31.0, 12.0)]
band(PL3, 0.0, 0.3, 28.3, 28.8)
FP = Fr(0.0, 12.0, 0.0)
for i in range(18):
    u = -25.5 + 3.0 * i
    if abs(u) < 7.0:
        continue
    box(FP, u - 0.6, u + 0.6, 29.6, 31.2, -0.05, 0.08, 'bronze')
    panel(FP, u, 29.4, 31.4, 1.6, 0.0, t=0.2, proj=0.15)
cornice(PL3, 33.0, 1.0)
bal_pl(PL3, 33.0)

# ================================================================== J  the curved portico
# 16 columns, 16 m, D 1.9 (photos: column : floor-to-attic-top = 16 : 27.3, diameter ~ 1/8.5 of the
# height), entablature with festoon frieze, a 7 m attic with wreath panels, the 16 region statues
# standing on the cornice in front of it, dark mosaic lunettes on the back wall.
E = 38.8                                                  # entablature and attic run into the propylaea
sector(36.0, R - 3.5, R + 10.5, 0.0, 38.5)
sector(36.0, R - 3.75, R - 3.5, 33.0, 33.8)
sector(36.0, R - 3.8, R - 3.5, 38.1, 38.5)
for a in COLS:
    box(arc_frame(a), -0.55, 0.55, 33.8, 38.1, 3.5, 3.72, 'marble')
sector(36.0, R - 3.5, R - 3.0, 38.5, 39.0)
sector(36.0, R - 3.0, R - 2.5, 38.5, 39.5)
sector(36.0, R - 2.5, R - 2.0, 38.5, 40.0)
sector(36.0, R - 2.0, R + 10.5, 38.5, 40.0)
stair(MF, -12.0, 12.0, 5.0, -8.5, 33.0, 38.5, 20)
for s in (1, -1):
    slope_box(MF, s * 12.0, s * 13.0, 5.6, -8.0, 33.0, 34.0, 39.6, 'marble')
    balustrade((s * 12.5, 5.3), (s * 12.5, -7.7), 34.0 + 0.3 / 13.6 * 5.6, 34.0 + 13.3 / 13.6 * 5.6)
for a in COLS:
    column(arc_frame(a), 0.0, 0.0, 40.0, 16.0, 1.9)
for r0, y0, y1 in ((R - 0.85, 56.0, 56.4), (R - 0.91, 56.4, 56.85), (R - 0.97, 56.85, 57.3),      # architrave
                   (R - 0.88, 57.3, 58.8),                                                          # frieze
                   (R - 1.1, 58.8, 59.1), (R - 1.05, 59.1, 59.45), (R - 1.45, 59.45, 59.8),         # bed mould, dentils
                   (R - 2.25, 59.8, 60.1), (R - 2.35, 60.1, 60.3)):                                 # corona, cyma
    sector(E, r0, R + 1.0, y0, y1)
a = -E + 0.3
while a < E - 0.3:
    box(arc_frame(a), -0.13, 0.13, 59.1, 59.45, 1.05, 1.32, 'marble')     # dentils
    a += 0.42
a = -E + 0.6
while a < E - 0.5:
    box(arc_frame(a), -0.2, 0.2, 59.45, 59.8, 1.45, 2.15, 'marble')      # modillions
    a += 1.2
for i in range(15):                                                       # festoons in the frieze
    for h in (0.25, 0.75):
        a0 = COLS[i] + 4.8 * (h - 0.25)
        a1 = a0 + 2.4
        pts = []
        for k in range(5):
            aa = a0 + (a1 - a0) * k / 4
            fr = arc_frame(aa)
            pts.append(fr.p(0.0, 58.45 - 0.55 * math.sin(math.pi * k / 4), 0.95))
        loft(pts, [0.1, 0.17, 0.2, 0.17, 0.1], 6, 'carved')
sector(E, R + 1.0, R + 10.5, 56.0, 60.3)                                  # ceiling / roof slab over the portico
sector(E, R - 1.0, R + 10.5, 60.3, 60.8)                                  # attic base moulding
sector(E, R - 0.7, R + 10.5, 60.8, 66.4)                                  # attic
sector(E, R - 1.05, R + 10.5, 66.4, 66.8)
sector(E, R - 1.4, R + 10.5, 66.8, 67.3)                                  # attic cornice
a = -E + 0.5
while a < E - 0.4:
    box(arc_frame(a), -0.14, 0.14, 67.3, 67.72, 1.12, 1.32, 'marble')    # crest ornaments (small palmettes)
    a += 0.8
for i, a in enumerate(COLS):
    fr = arc_frame(a)
    box(fr, -1.0, 1.0, 60.8, 66.4, 0.7, 0.9, 'marble')                  # pilaster strip behind each statue
    box(fr, -0.85, 0.85, 60.3, 61.25, 0.9, 2.2, 'marble')                # statue plinth on the cornice
    p = fr.p(0.0, 61.25, 1.55)
    figure(pose(p[0], p[1], p[2], heading_of(fr), 4.6), 'carved', arms=REG[i % len(REG)])   # the Italian regions
for i in range(15):
    fr = arc_frame((COLS[i] + COLS[i + 1]) / 2)
    panel(fr, 0.0, 61.9, 65.1, 2.9, 0.7, t=0.3, proj=0.22)
    medallion(fr, 0.0, 63.5, 0.7, 0.9)
# back wall: pilasters, coffer beams, dark mosaic lunettes above a plain dado
sector(E, R + 9.0, R + 10.5, 40.0, 56.0)
for i, a in enumerate(COLS):
    fr = arc_frame(a)
    pilaster(fr, 0.0, 40.0, 56.0, w=1.3, proj=0.4, d=-9.0)
    box(fr, -0.45, 0.45, 55.2, 56.0, -9.0, -0.6, 'marble')
for i in range(15):
    fr = arc_frame((COLS[i] + COLS[i + 1]) / 2)
    box(fr, -1.55, 1.55, 50.2, 55.2, -9.0, -8.93, 'mosaic')
    box(fr, -1.75, 1.75, 49.9, 50.2, -9.0, -8.8, 'marble')
    panel(fr, 0.0, 41.2, 48.8, 2.6, -9.0, t=0.25, proj=0.12)
# glass lift house on the roof terrace, centre back (a dark box in every front photo)
for a0 in (-6.0, 6.0):
    for f0 in (-14.5, -20.5):
        mbox(a0 - 0.15, a0 + 0.15, 67.3, 69.6, f0 - 0.15, f0 + 0.15, 'steel')
mbox(-6.4, 6.4, 69.6, 70.0, -20.9, -14.1, 'steel')
for f0 in (-14.5, -20.5):
    mbox(-5.85, 5.85, 67.3, 69.6, f0 - 0.04, f0 + 0.04, 'glass')
for a0 in (-6.0, 6.0):
    mbox(a0 - 0.04, a0 + 0.04, 67.3, 69.6, -20.35, -14.65, 'glass')

# ================================================================== K  propylaea with the quadrigas
def slab(s, a0, a1, f0, f1, e, y0, y1):
    mbox(s * (a0 - e), s * (a1 + e), y0, y1, f0 - e, f1 + e)


PA0, PA1, PF0, PF1 = 38.5, 60.0, -22.5, 1.5          # hall walls (photos: ~21.5 wide, deeper than wide)
CXF = (46.25, 52.25)                                  # front and back column axes (distyle in antis)
for s in (1, -1):
    fu = (lambda f: -f) if s > 0 else (lambda f: f)
    # ---- podium below the hall: arched side portal, rusticated base, windows, cornice and balustrade
    outline = [(36.0, 5.0), (63.5, 5.0), (63.5, -4.0), (62.3, -4.0), (62.3, -11.0), (63.5, -11.0), (63.5, -30.0), (36.0, -30.0)]
    prism(MF, [(s * a, f) for a, f in outline], 0.0, 40.0, 'marble')
    arch = [(-11.0 + 3.5 - 3.5 * math.cos(math.pi * k / 12), 8.0 + 3.5 * math.sin(math.pi * k / 12)) for k in range(13)]
    eprism([(-11.0, 40.0)] + arch + [(-4.0, 40.0)], s * 62.3, s * 63.5)
    mbox(s * 62.3, s * 62.38, 0.0, 8.0, -10.6, -4.4, 'bronze')
    eprism([(f, y) for f, y in arch], s * 62.3, s * 62.34, 'glass')
    ring = [(-7.5 + 4.4 * math.cos(math.pi * k / 12), 8.0 + 4.4 * math.sin(math.pi * k / 12)) for k in range(13)]
    inner = [(-7.5 + 3.5 * math.cos(math.pi * k / 12), 8.0 + 3.5 * math.sin(math.pi * k / 12)) for k in range(12, -1, -1)]
    eprism(ring + inner, s * 63.5, s * 63.8)
    mbox(s * 63.5, s * 63.95, 11.1, 12.7, -8.1, -6.9)
    for f0, f1 in ((-4.0, -3.1), (-11.9, -11.0)):
        mbox(s * 63.5, s * 63.85, 0.0, 8.0, f0, f1)
        mbox(s * 63.5, s * 64.0, 7.6, 8.1, f0 - 0.15, f1 + 0.15)
    rustic(mir(s, [(53.0, 5.0), (63.5, 5.0), (63.5, -4.0)]), 0.0, 12.0)
    rustic(mir(s, [(63.5, -11.0), (63.5, -20.0)]), 0.0, 12.0)
    band(mir(s, [(63.5, -4.0), (63.5, -11.0)]), 0.0, 0.32, 12.0, 12.45)
    topP = mir(s, [(36.0, 5.0), (63.5, 5.0), (63.5, -30.0)])
    cornice(topP, 40.0, 1.0)
    bal_pl(mir(s, [(63.5, 5.0), (63.5, -30.0)]), 40.0)
    balustrade((s * 36.45, 4.55), (s * 63.05, 4.55), 40.0)                # front edge, before the rostral columns
    fl = Fr(s * 63.5, 0.0, -math.pi / 2 if s > 0 else math.pi / 2)
    for f in (4.2, -2.6, -12.4, -19.4, -26.0):
        pilaster(fl, fu(f), 12.45 if f > -20.0 else 30.0, 38.7, w=1.2, proj=0.4)
    for f in (0.8, -16.0):
        window(fl, fu(f), 15.5, 21.5, 2.4)
        window(fl, fu(f), 26.0, 31.5, 2.4)
    medallion(fl, fu(-7.5), 28.8, 0.0, 1.6)
    window(fl, fu(-23.0), 32.2, 36.8, 2.2, pediment=False)
    # front of the podium above the lower wings' terrace (photos: a triple window high up, a tall
    # window below it in the outer bay, a pedimented window in the inner bay)
    ff = Fr(0.0, 5.0, 0.0)
    band(mir(s, [(36.0, 5.0), (63.5, 5.0)]), 0.0, 0.3, 12.0, 12.6)
    for a in (36.9, 50.0, 62.6):
        pilaster(ff, s * a, 12.6, 38.7, w=1.4, proj=0.45)
    for a in (55.4, 56.85, 58.3):
        window(ff, s * a, 33.0, 36.4, 1.0, pediment=False)
    window(ff, s * 56.85, 14.0, 22.0, 2.6)
    window(ff, s * 43.4, 25.0, 29.6, 2.2)
    panel(ff, s * 43.4, 14.0, 21.0, 4.2, 0.0, t=0.35, proj=0.25)
    # ---- four rostral columns: outside the outer front corner and before the inner anta
    for ra in (40.2, 61.7):
        rostral(s * ra, 3.1)
    # ---- the hall: antae, 2 front + 2 back columns, outer side 4 columns and a corner pier
    mbox(s * PA0, s * 42.0, 40.0, 56.0, -7.5, PF1)
    mbox(s * 56.5, s * PA1, 40.0, 56.0, -7.5, PF1)
    mbox(s * PA0, s * 40.3, 40.0, 56.0, PF0, -7.5)
    mbox(s * 56.5, s * PA1, 40.0, 56.0, PF0, -20.9)
    mbox(s * PA0, s * 42.0, 40.0, 56.0, PF0, -20.9)
    for a0, a1, f0, f1 in ((PA0, 42.0, -7.5, PF1), (56.5, PA1, -7.5, PF1), (56.5, PA1, PF0, -20.9), (PA0, 42.0, PF0, -20.9)):
        mbox(s * (a0 - 0.15), s * (a1 + 0.15), 40.0, 40.6, f0 - 0.15, f1 + 0.15)
        mbox(s * (a0 - 0.08), s * (a1 + 0.08), 40.6, 40.9, f0 - 0.08, f1 + 0.08)
        mbox(s * (a0 - 0.12), s * (a1 + 0.12), 54.5, 55.3, f0 - 0.12, f1 + 0.12)
        mbox(s * (a0 - 0.25), s * (a1 + 0.25), 55.3, 56.0, f0 - 0.25, f1 + 0.25)
    for a in CXF:
        column(MF, s * a, 0.4, 40.0, 16.0, 1.9)
        column(MF, s * a, -21.4, 40.0, 16.0, 1.9)
    for f in (-9.8, -13.0, -16.2, -19.4):
        column(MF, s * 59.05, f, 40.0, 16.0, 1.9)
    frO = Fr(s * PA1, 0.0, -math.pi / 2 if s > 0 else math.pi / 2)       # the solid front third of the outer side
    panel(frO, fu(-3.0), 43.5, 53.8, 4.4, 0.0, t=0.35, proj=0.22)
    relief_row(frO, fu(-3.0) - 1.0, fu(-3.0) + 1.0, 45.0, 6.4, 0.0, 1, seed=s + 2)
    medallion(frO, fu(-3.0), 51.6, 0.0, 0.8)
    # ---- entablature with a blank inscription band, dentils and modillions
    X0, X1, Z0, Z1 = PA0 - 0.25, PA1 + 0.25, PF0 - 0.25, PF1 + 0.25
    for e, y0, y1 in ((0.0, 56.0, 56.4), (0.06, 56.4, 56.8), (0.12, 56.8, 57.2), (0.02, 57.2, 58.4), (0.25, 58.4, 58.7),
                      (0.2, 58.7, 59.0), (0.6, 59.0, 59.3), (1.05, 59.3, 59.5), (1.15, 59.5, 59.6)):
        slab(s, X0, X1, Z0, Z1, e, y0, y1)
    for a0, a1, y0, y1 in ((42.4, 56.1, 57.25, 57.45), (42.4, 56.1, 58.15, 58.35), (42.4, 42.6, 57.45, 58.15), (55.9, 56.1, 57.45, 58.15)):
        mbox(s * a0, s * a1, y0, y1, Z1 + 0.02, Z1 + 0.14)
    for sp, y0, y1, d0, d1, w in ((0.42, 58.7, 59.0, 0.2, 0.45, 0.13), (1.2, 59.0, 59.3, 0.6, 1.05, 0.2)):
        n = int((X1 - X0) / sp)
        for k in range(n):
            a = X0 + (X1 - X0) * (k + 0.5) / n
            mbox(s * (a - w), s * (a + w), y0, y1, Z1 + d0, Z1 + d1)
            mbox(s * (a - w), s * (a + w), y0, y1, Z0 - d1, Z0 - d0)
        n = int((Z1 - Z0) / sp)
        for k in range(n):
            f = Z0 + (Z1 - Z0) * (k + 0.5) / n
            mbox(s * (X1 + d0), s * (X1 + d1), y0, y1, f - w, f + w)
    # ---- pediments front and back: recessed tympanum with a sculpture group, raking cornices
    am = (X0 + X1) / 2
    half = (X1 - X0) / 2 + 1.15
    for face, dirn in ((Z1, 1.0), (Z0, -1.0)):
        dt, db = face - dirn * 0.3, face - dirn * 2.4
        gable(MF, s * X0, s * X1, 59.6, 3.8, min(dt, db), max(dt, db))
        for side in (-1, 1):
            e0 = am + side * half
            m = 3.8 / (half - 1.15)
            aprism([(s * e0, 59.6 - m * 1.15), (s * am, 63.4), (s * am, 64.25), (s * e0, 60.45 - m * 1.15)],
                   min(face + dirn * 1.2, db), max(face + dirn * 1.2, db))
        for k in (-2, -1, 0, 1, 2):
            h = (3.3, 2.3, 1.25)[abs(k)]
            ak = am + k * 3.4
            head = 90.0 if dirn > 0 else -90.0
            if abs(k) == 2:
                recliner(pose(s * ak, 59.65, dt + dirn * 0.35, 0.0 if k * s < 0 else 180.0, 1.8, kz=0.35), 'carved')
            else:
                figure(pose(s * ak, 59.65, dt + dirn * 0.25, head, h, kx=0.35), 'carved', arms=REG[(k + 2) % len(REG)])
    # ---- attic: panel frieze, heavy cornice, two top steps
    AT0, AT1, AF0, AF1 = PA0 + 0.3, PA1 - 0.3, PF0 + 0.3, PF1 - 0.3
    mbox(s * AT0, s * AT1, 59.6, 65.4, AF0, AF1)
    frA = Fr(s * AT1, 0.0, -math.pi / 2 if s > 0 else math.pi / 2)
    for k in range(5):
        f = AF1 - 2.6 - (AF1 - AF0 - 5.2) * k / 4
        panel(frA, fu(f), 60.6, 64.6, 3.0, 0.0, t=0.3, proj=0.2)
        if k % 2 == 0:
            medallion(frA, fu(f), 62.6, 0.0, 0.9)
        else:
            box(frA, fu(f) - 0.25, fu(f) + 0.25, 61.0, 64.2, 0.0, 0.3, 'carved')     # trophy
            box(frA, fu(f) - 0.9, fu(f) + 0.9, 63.2, 63.6, 0.0, 0.3, 'carved')
    for face, dirn in ((AF1, 1.0), (AF0, -1.0)):
        for k in range(6):
            a = AT0 + 1.8 + (AT1 - AT0 - 3.6) * k / 5
            if abs(a - am) < 3.0:
                continue
            mbox(s * (a - 0.5), s * (a + 0.5), 64.45, 65.25, min(face, face + dirn * 0.22), max(face, face + dirn * 0.22), 'carved')
    for e, y0, y1 in ((0.25, 65.4, 65.8), (0.55, 65.8, 66.4), (0.95, 66.4, 67.2), (1.35, 67.2, 67.8), (1.45, 67.8, 68.2)):
        slab(s, AT0, AT1, AF0, AF1, e, y0, y1)
    for sp, y0, y1, d0, d1, w in ((0.5, 65.8, 66.4, 0.55, 0.8, 0.15), (1.4, 66.4, 67.2, 0.95, 1.35, 0.22)):
        n = int((AT1 - AT0) / sp)
        for k in range(n):
            a = AT0 + (AT1 - AT0) * (k + 0.5) / n
            mbox(s * (a - w), s * (a + w), y0, y1, AF1 + d0, AF1 + d1)
            mbox(s * (a - w), s * (a + w), y0, y1, AF0 - d1, AF0 - d0)
        n = int((AF1 - AF0) / sp)
        for k in range(n):
            f = AF0 + (AF1 - AF0) * (k + 0.5) / n
            mbox(s * (AT1 + d0), s * (AT1 + d1), y0, y1, f - w, f + w)
            mbox(s * (AT0 - d1), s * (AT0 - d0), y0, y1, f - w, f + w)
    mbox(s * (AT0 + 1.2), s * (AT1 - 1.2), 68.2, 69.2, AF0 + 1.2, AF1 - 1.2)
    mbox(s * (AT0 + 2.4), s * (AT1 - 2.4), 69.2, 70.2, AF0 + 2.4, AF1 - 2.4)
    # ---- bronze quadriga facing the piazza: four rearing horses abreast, chariot, winged Victory
    QA, QF = 49.25, -9.6
    TQ = pose(s * QA, 70.2, QF, 90.0, 2.6)
    for z in (-2.2, -0.73, 0.73, 2.2):
        horse(shifted(TQ, z, 0.0 if abs(z) > 1.0 else 0.25), 'bronze', 'rear', sides=10)
    lbox(TQ, -2.45, -1.55, 0.45, 1.3, -0.85, 0.85, 'bronze')
    lbox(TQ, -1.62, -1.45, 0.45, 1.75, -0.8, 0.8, 'bronze')
    for zs in (-1, 1):
        loft([(-2.2, 0.56, zs * 0.97), (-2.2, 0.56, zs * 0.85)], [(0.56, 0.56), (0.56, 0.56)], 14, 'bronze', TQ, smooth=False)
    loft([(-1.5, 0.9, 0.0), (-0.4, 1.3, 0.0), (0.55, 1.55, 0.0)], [0.05, 0.05, 0.05], 6, 'bronze', TQ)
    loft([(0.5, 1.6, -2.5), (0.5, 1.6, 2.5)], [0.06, 0.06], 6, 'bronze', TQ)
    # photos: the Victory stands high in the chariot, head ~1.15 and wing tips ~1.5 horse-heights above the roof
    figure(pose(s * QA, 70.2 + 1.3 * 2.6, QF - 2.0 * 2.6, 90.0, 5.8), 'bronze', arms=('raise', 'raise'), wings=True)

# ================================================================== L  rear block and the flanks behind
for s in (1, -1):
    mbox(s * 56.0, s * 72.0, 0.0, 30.0, -50.0, -30.0)
    mbox(s * 63.5, s * 72.0, 0.0, 30.0, -30.0, -20.0)
mbox(37.0, 72.0, 0.0, 30.0, -73.0, -50.0)
mbox(-69.0, -42.0, 0.0, 30.0, -57.0, -50.0)
rb = [(-56.0, -50.0), (56.0, -50.0), (56.0, -30.0), (36.0, -30.0)] + \
     [arc_af(36.0 - 72.0 * k / 24, R + 10.5) for k in range(25)] + [(-36.0, -30.0), (-56.0, -30.0)]
prism(MF, rb, 0.0, 52.0, 'marble')
for s in (1, -1):
    pl = mir(s, [(36.0, -30.0), (56.0, -30.0), (56.0, -50.0), (0.0, -50.0)])
    cornice(pl, 52.0, 1.0)
    band(pl, 0.0, 0.3, 40.0, 40.6)
    fr1 = Fr(0.0, -30.0, 0.0)
    for a in (38.5, 43.5, 48.5, 53.5):
        window(fr1, s * a, 43.0, 48.0, 2.0)
    for a in (41.0, 46.0, 51.0):
        pilaster(fr1, s * a, 40.6, 50.7, w=1.0, proj=0.35)
    fl = Fr(s * 56.0, 0.0, -math.pi / 2 if s > 0 else math.pi / 2)
    fu = (lambda f: -f) if s > 0 else (lambda f: f)
    for f in (-32.5, -37.5, -42.5, -47.5):
        window(fl, fu(f), 33.0, 37.5, 2.0)
        window(fl, fu(f), 43.0, 48.0, 2.0)
    for f in (-35.0, -40.0, -45.0):
        pilaster(fl, fu(f), 30.0, 50.7, w=1.0, proj=0.35)
PBK = [(56.0, -50.0), (-56.0, -50.0)]
rustic(PBK, 0.0, 10.0)
band(PBK, 0.0, 0.3, 30.0, 30.6)
for fr, L in seg_frames(PBK):
    us = [(L - 6.5 * 17) / 2 + 6.5 * i for i in range(18)]
    for u in us:
        pilaster(fr, u, 10.45, 50.7, w=1.1, proj=0.35)
    for u0, u1 in zip(us, us[1:]):
        for y0, y1 in ((13.0, 17.5), (21.0, 25.5), (33.0, 37.5), (43.0, 48.0)):
            window(fr, (u0 + u1) / 2, y0, y1, 2.2)
PB = {1: [(63.5, -20.0), (72.0, -20.0), (72.0, -73.0), (37.0, -73.0)],
      -1: [(-42.0, -57.0), (-69.0, -57.0), (-69.0, -50.0), (-72.0, -50.0), (-72.0, -20.0), (-63.5, -20.0)]}
for s, pl in PB.items():
    rustic(pl, 0.0, 10.0)
    cornice(pl, 30.0, 1.0)
    bal_pl(pl, 30.0)
    for fr, L in seg_frames(pl):
        n = int(L / 6.5)
        if n < 1:
            continue
        us = [(L - 6.5 * n) / 2 + 6.5 * i for i in range(n + 1)]
        for u in us:
            pilaster(fr, u, 10.45, 28.7, w=1.1, proj=0.35)
        for u0, u1 in zip(us, us[1:]):
            window(fr, (u0 + u1) / 2, 13.0, 17.5, 2.2)
            window(fr, (u0 + u1) / 2, 21.0, 25.5, 2.2)

print('balusters', BAL_COUNT[0], flush=True)
info = M.finish(directory=Path(sys.argv[sys.argv.index('--render-dir') + 1]) if '--render-dir' in sys.argv else None)
