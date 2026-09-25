"""Custom House (江海关大楼 / 上海海关大楼), No. 13 Zhongshan East 1st Road, the Bund, Shanghai.

Palmer & Turner, 1925-27: a granite Greek-revival office block facing the Huangpu with an in-antis
Greek Doric portico of four fluted columns, a mezzanine, a four-storey shaft of recessed window strips
between giant piers, a deep modillion cornice, corner pavilions with pedimented niche windows, and the
stepped clock tower (lower stage with slit windows and corner blocks, four 5.3 m dials, a step stage
and a gilded lantern under the flagpole).

Registered from OSM way 178407318 (23.4 x 36.3 m). Dimensions: zh/en Wikipedia (main block 36.2 m,
dial 5.3 m, storey heights) and measurements off Commons photos (people and the dial as scale); the
full list is in the report's data/dimensions.md. The flagpole top lands at ~72 m: the photo chain
cannot reach the 79.2 m "total" quoted by zh Wikipedia (see report).

Author frame: u across (+ = east, the Bund front), y up, v along the frontage (+ = south, toward HSBC).
Run: Blender --background --python assets-src/landmarks/build_bund-customs-house.py
"""
import math
import tempfile
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'bund-customs-house'
SCRATCH = (Path(tempfile.gettempdir()) / 'sr-landmarks' / 'bund-customs-house')

M = Model(ID)
M.material('stone', (0.56, 0.47, 0.36), 0.0, 0.8, ID + '_stone')        # Suzhou granite, warm beige
M.material('granite', (0.44, 0.41, 0.37), 0.0, 0.75, ID + '_granite')   # darker base course
M.material('glass', (0.10, 0.13, 0.15), 0.2, 0.15, ID + '_glass')       # lit windows at night
M.material('bronze', (0.22, 0.15, 0.09), 0.7, 0.45, ID + '_bronze')     # doors, gates, spandrels
M.material('iron', (0.05, 0.05, 0.05), 0.5, 0.5, ID + '_iron')          # dial rims, hands, railings
M.material('dial', (0.93, 0.91, 0.84), 0.0, 0.35, ID + '_dial')         # backlit dial glass
M.material('gold', (0.80, 0.60, 0.25), 0.9, 0.3, ID + '_gold')          # gilded lantern
M.material('shadow', (0.04, 0.04, 0.04), 0.0, 0.9, ID + '_shadow')      # dark interior behind openings
M.material('roof', (0.30, 0.29, 0.27), 0.0, 0.9, ID + '_concrete')      # flat roofs

U0, U1, V0, V1 = -11.71, 11.71, -18.17, 18.17     # registered footprint in the author frame


def B(u0, u1, y0, y1, v0, v1, mat):
    if u1 - u0 < 1e-4 or y1 - y0 < 1e-4 or v1 - v0 < 1e-4:
        return
    M.box('b', ((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2), (u1 - u0, y1 - y0, v1 - v0), mat)


class Rect:
    """An axis-aligned plan rectangle; faces E/W/N/S with an along-face coordinate s and outward n."""
    def __init__(self, u0, u1, v0, v1):
        self.u0, self.u1, self.v0, self.v1 = u0, u1, v0, v1
        self.faces = {'E': ('u', u1, 1, v0, v1), 'W': ('u', u0, -1, v0, v1),
                      'N': ('v', v0, -1, u0, u1), 'S': ('v', v1, 1, u0, u1)}

    def F(self, f, s0, s1, y0, y1, n0, n1, mat):
        ax, pl, sg = self.faces[f][:3]
        a, b = pl + sg * n0, pl + sg * n1
        lo, hi = min(a, b), max(a, b)
        if ax == 'u':
            B(lo, hi, y0, y1, s0, s1, mat)
        else:
            B(s0, s1, y0, y1, lo, hi, mat)

    def P(self, f, s, y, n):
        ax, pl, sg = self.faces[f][:3]
        return (pl + sg * n, y, s) if ax == 'u' else (s, y, pl + sg * n)

    def prism(self, f, poly, n0, n1, mat, smooth=False):
        """Extrude a 2D (s, y) outline between two depths along the face normal."""
        k = len(poly)
        verts = [self.P(f, s, y, n0) for s, y in poly] + [self.P(f, s, y, n1) for s, y in poly]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))] + \
                [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        M.mesh('prism', verts, faces, mat, smooth)

    def annulus(self, f, sc, yc, r0, r1, n0, n1, mat, seg=64):
        vs = []
        for n in (n0, n1):
            for r in (r1, r0):
                vs += [self.P(f, sc + r * math.cos(a), yc + r * math.sin(a), n)
                       for a in (i * math.tau / seg for i in range(seg))]
        fo, fi, bo, bi = 0, seg, 2 * seg, 3 * seg
        faces = []
        for i in range(seg):
            j = (i + 1) % seg
            faces += [(fo + i, fo + j, fi + j, fi + i), (bo + j, bo + i, bi + i, bi + j),
                      (fo + j, fo + i, bo + i, bo + j), (fi + i, fi + j, bi + j, bi + i)]
        M.mesh('ring', vs, faces, mat)


def circle(sc, yc, r, seg=48, a0=0.0, a1=math.tau, closed=True):
    n = seg if closed else seg + 1
    return [(sc + r * math.cos(a0 + (a1 - a0) * i / seg), yc + r * math.sin(a0 + (a1 - a0) * i / seg))
            for i in range(n)]


def fill_wall(R, f, s0, s1, y0, y1, openings, t, off=0.0, mat='stone', rustic=None):
    """Solid wall n in [off-t, off] with rectangular openings (sa, sb, ya, yb) of full wall depth.
    rustic=(r0, r1): channelled horizontal rustication (0.6 m courses, 0.1 m grooves 0.08 deep)."""
    xs = sorted({s0, s1} | {o[k] for o in openings for k in (0, 1) if s0 < o[k] < s1})
    for a, b in zip(xs, xs[1:]):
        cover = sorted((o[2], o[3]) for o in openings if o[0] <= a + 1e-6 and o[1] >= b - 1e-6)
        segs, y = [], y0
        for ya, yb in cover:
            if ya > y:
                segs.append((y, ya))
            y = max(y, yb)
        if y < y1:
            segs.append((y, y1))
        for ya, yb in segs:
            if not rustic:
                R.F(f, a, b, ya, yb, off - t, off, mat)
                continue
            r0, r1 = rustic
            cuts = [ya] + [r0 + 0.6 * k for k in range(1, 40) if ya + 0.12 < r0 + 0.6 * k < min(yb, r1) - 0.12] + [yb]
            for c0, c1 in zip(cuts, cuts[1:]):
                lo = c0 + (0.05 if c0 != ya else 0.0)
                hi = c1 - (0.05 if c1 != yb else 0.0)
                R.F(f, a, b, lo, hi, off - t, off, mat)
                if c1 != yb:
                    R.F(f, a, b, c1 - 0.05, c1 + 0.05, off - t, off - 0.08, mat)


def glass_pane(R, f, sa, sb, ya, yb, n, mullions=(1, 1), bar=0.06):
    """Glass set back in an opening, with bronze glazing bars (cols, rows)."""
    R.F(f, sa, sb, ya, yb, n - 0.06, n, 'glass')
    cols, rows = mullions
    for i in range(1, cols):
        s = sa + (sb - sa) * i / cols
        R.F(f, s - bar / 2, s + bar / 2, ya, yb, n, n + 0.05, 'bronze')
    for j in range(1, rows):
        y = ya + (yb - ya) * j / rows
        R.F(f, sa, sb, y - bar / 2, y + bar / 2, n, n + 0.05, 'bronze')
    R.F(f, sa, sb, ya, ya + 0.08, n, n + 0.06, 'bronze')
    R.F(f, sa, sb, yb - 0.08, yb, n, n + 0.06, 'bronze')


def surround(R, f, sa, sb, ya, yb, off, w=0.18, d=0.1, sill=True, key=False):
    R.F(f, sa - w, sa, ya, yb + w, off, off + d, 'stone')
    R.F(f, sb, sb + w, ya, yb + w, off, off + d, 'stone')
    R.F(f, sa - w, sb + w, yb, yb + w, off, off + d, 'stone')
    if sill:
        R.F(f, sa - w - 0.1, sb + w + 0.1, ya - 0.16, ya, off, off + 0.22, 'stone')
    if key:
        c = (sa + sb) / 2
        R.prism(f, [(c - 0.22, yb - 0.25), (c + 0.22, yb - 0.25), (c + 0.3, yb + w + 0.05), (c - 0.3, yb + w + 0.05)],
                off, off + d + 0.08, 'stone')


def arch_head(R, f, sc, r, ys, top, n0, n1, mat='stone', seg=16):
    """Masonry filling a rectangle's head down to a semicircular arch of radius r springing at ys."""
    arc = circle(sc, ys, r, seg, math.pi, 0.0, closed=False)
    R.prism(f, [(sc - r, ys)] + [(sc - r, top), (sc + r, top)] + [(sc + r, ys)] + arc[::-1][1:-1], n0, n1, mat)


# --------------------------------------------------------------------------------------------------
# Heights (photo 14 at facade scale, photo 05 with people for scale; see data/dimensions.md)
PLINTH = 0.8
PORT_TOP = 7.4          # top of the Doric capitals / underside of the portico entablature
EAVE1 = (7.4, 9.9)      # first-storey entablature and eave
MEZZ = (9.9, 14.3)
BAND2 = (14.3, 15.3)    # second eave: the meander band
SHAFT = (15.3, 28.8)    # four storeys of recessed strips between giant piers
FRIEZE = (28.8, 30.8)
CORN = (30.8, 32.3)
T = 0.6                 # wall thickness (window reveal depth)
PAV_OFF = 0.25          # corner pavilions stand forward of the central zones

MAIN = Rect(U0, U1, V0, V1)
PAV_EW, PAV_NS = 8.6, 6.0   # pavilion width along the long faces / along the short faces


def zones(f):
    ax, pl, sg, s0, s1 = MAIN.faces[f]
    w = PAV_EW if f in 'EW' else PAV_NS
    nb = 5 if f in 'EW' else 3
    return [(s0, s0 + w, 'pav', 1), (s0 + w, s1 - w, 'mid', nb), (s1 - w, s1, 'pav', 1)]


def bays(a, b, n):
    w = (b - a) / n
    return [a + w * (i + 0.5) for i in range(n)], w


# Inner core behind every wall (never seen; closes any view deep into an opening).
B(U0 + 1.0, U1 - 1.0, 0.0, CORN[1], V0 + 1.0, V1 - 1.0, 'shadow')

# Base course all round.
for f in 'EWNS':
    for (a, b, kind, nb) in zones(f):
        if f == 'E' and kind == 'mid':
            continue
        off = PAV_OFF if kind == 'pav' else 0.0
        MAIN.F(f, a - (0.4 if kind == 'pav' else 0), b + (0.4 if kind == 'pav' else 0), 0.0, PLINTH,
               off - T, off + 0.15, 'granite')

for f in 'EWNS':
    for (a, b, kind, nb) in zones(f):
        off = PAV_OFF if kind == 'pav' else 0.0
        centres, w = bays(a, b, nb)
        openings = []
        portico = (f == 'E' and kind == 'mid')
        for c in centres:
            if kind == 'pav':
                openings += [(c - 0.7, c + 0.7, 3.0, 6.2), (c - 0.8, c + 0.8, 10.6, 13.4), (c - 1.0, c + 1.0, 15.6, 28.5)]
            else:
                if not portico:
                    openings.append((c - 0.9, c + 0.9, 2.2, 6.0))
                openings += [(c - 1.1, c + 1.1, 10.8, 13.5), (c - 1.0, c + 1.0, 15.6, 28.5)]
        y0 = PORT_TOP if portico else PLINTH
        rust = (PLINTH, EAVE1[0] + 1.8) if not portico else None
        # Pavilions wrap round the corner: the outer pier runs on by the projection to meet the next face.
        ax_, pl_, sg_, fs0, fs1 = MAIN.faces[f]
        wa = a - off if abs(a - fs0) < 1e-6 else a
        wb = b + off if abs(b - fs1) < 1e-6 else b
        fill_wall(MAIN, f, wa, wb, y0, FRIEZE[1], openings, T + off, off, 'stone', rustic=rust)
        # Openings: glass, surrounds, the recessed strips of the shaft.
        for (sa, sb, ya, yb) in openings:
            if yb <= 7.0:                     # ground-storey window: glass, stone surround with keystone
                glass_pane(MAIN, f, sa, sb, ya, yb, off - T + 0.12, (2, 3))
                surround(MAIN, f, sa, sb, ya, yb, off, key=True)
                MAIN.F(f, sa - 0.05, sb + 0.05, ya, ya + 0.9, off - T + 0.18, off - T + 0.24, 'iron')  # grille band
                for k in range(1, 8):
                    s = sa + (sb - sa) * k / 8
                    MAIN.F(f, s - 0.02, s + 0.02, ya, ya + 0.9, off - T + 0.24, off - T + 0.3, 'iron')
            elif yb <= 14.0:                  # mezzanine window with architrave
                glass_pane(MAIN, f, sa, sb, ya, yb, off - T + 0.12, (3, 2))
                surround(MAIN, f, sa, sb, ya, yb, off, w=0.2, d=0.12)
            else:                             # shaft strip: 4 windows, bronze spandrel panels between
                storeys = [(15.6 + 3.225 * k, 15.6 + 3.225 * (k + 1)) for k in range(4)]
                inner = off - T + 0.15
                for k, (sy0, sy1) in enumerate(storeys):
                    wy0, wy1 = sy0 + 0.12, sy1 - (1.0 if k < 3 else 0.12)
                    glass_pane(MAIN, f, sa + 0.08, sb - 0.08, wy0, wy1, inner, (3, 2))
                    if k < 3:                 # spandrel: bronze panel with a moulded frame and roundels
                        MAIN.F(f, sa, sb, wy1, sy1 + 0.12, inner - 0.06, inner + 0.02, 'bronze')
                        MAIN.F(f, sa + 0.1, sb - 0.1, wy1 + 0.1, sy1 + 0.02, inner + 0.02, inner + 0.08, 'bronze')
                        cs = (sa + sb) / 2
                        for dx in (-0.55, 0.0, 0.55):
                            MAIN.prism(f, circle(cs + dx, (wy1 + sy1 + 0.12) / 2, 0.22, 16), inner + 0.08, inner + 0.14, 'bronze')
                # strip sill and a stepped reveal moulding up both sides
                MAIN.F(f, sa - 0.1, sb + 0.1, 15.4, 15.6, off - T, off + 0.18, 'stone')
                MAIN.F(f, sa, sa + 0.12, 15.6, 28.5, off - T, off - 0.25, 'stone')
                MAIN.F(f, sb - 0.12, sb, 15.6, 28.5, off - T, off - 0.25, 'stone')
        # Giant piers of the shaft: flat pilasters with base and capital between the strips.
        if kind == 'mid':
            edges = [a + w * i for i in range(nb + 1)]
            for e in edges:
                MAIN.F(f, e - 0.72, e + 0.72, SHAFT[0], FRIEZE[0], 0.0, 0.14, 'stone')
                MAIN.F(f, e - 0.82, e + 0.82, SHAFT[0], SHAFT[0] + 0.5, 0.0, 0.22, 'stone')
                MAIN.F(f, e - 0.82, e + 0.82, FRIEZE[0] - 0.45, FRIEZE[0] - 0.2, 0.0, 0.22, 'stone')
                MAIN.F(f, e - 0.9, e + 0.9, FRIEZE[0] - 0.2, FRIEZE[0], 0.0, 0.3, 'stone')

# Portico: an in-antis Greek Doric porch across the central zone of the east front.
E_A, E_B = V0 + PAV_EW, V1 - PAV_EW
REC = 4.0                                   # depth of the porch behind the facade plane
centres, bw = bays(E_A, E_B, 5)
# floor, steps, side walls (antae returns), ceiling slab
MAIN.F('E', E_A, E_B, 0.0, 0.3, -REC, 0.55, 'granite')
MAIN.F('E', E_A - 0.3, E_B + 0.3, 0.0, 0.15, 0.55, 1.0, 'granite')
MAIN.F('E', E_A - 0.6, E_A, 0.0, PORT_TOP, -REC, 0.0, 'stone')
MAIN.F('E', E_B, E_B + 0.6, 0.0, PORT_TOP, -REC, 0.0, 'stone')
MAIN.F('E', E_A, E_B, PORT_TOP, EAVE1[1], -REC, 0.0, 'stone')
# back wall of the porch: bronze doors under pediments, tall bronze-framed windows above
back = []
for c in centres:
    back += [(c - 0.95, c + 0.95, 0.3, 3.5), (c - 1.35, c + 1.35, 4.3, 6.9)]
fill_wall(MAIN, 'E', E_A, E_B, 0.3, PORT_TOP, back, 0.5, -REC, 'stone')
for c in centres:
    n = -REC - 0.4
    MAIN.F('E', c - 0.95, c + 0.95, 0.3, 3.5, n - 0.1, n, 'bronze')
    for s in (c - 0.48, c + 0.48):          # two leaves with raised panels
        MAIN.F('E', s - 0.36, s + 0.36, 0.6, 1.7, n, n + 0.05, 'bronze')
        MAIN.F('E', s - 0.36, s + 0.36, 1.9, 3.2, n, n + 0.05, 'bronze')
    MAIN.F('E', c - 0.02, c + 0.02, 0.3, 3.5, n, n + 0.07, 'iron')
    # door case and triangular pediment
    MAIN.F('E', c - 1.2, c - 0.95, 0.3, 3.7, -REC, -REC + 0.2, 'bronze')
    MAIN.F('E', c + 0.95, c + 1.2, 0.3, 3.7, -REC, -REC + 0.2, 'bronze')
    MAIN.F('E', c - 1.3, c + 1.3, 3.5, 3.75, -REC, -REC + 0.25, 'bronze')
    MAIN.prism('E', [(c - 1.3, 3.75), (c + 1.3, 3.75), (c, 4.15)], -REC, -REC + 0.22, 'bronze')
    glass_pane(MAIN, 'E', c - 1.35, c + 1.35, 4.3, 6.9, -REC - 0.35, (4, 3), bar=0.08)
# columns: fluted Greek Doric, no base, entasis, necking grooves, echinus and abacus
COL_N = -0.62
def revolve(uc, vc, profile, seg, mat, flutes=0, depth=0.0, smooth=True):
    rings = []
    for (y, r, fl) in profile:
        ring = []
        for i in range(seg):
            a = i * math.tau / seg
            rr = r
            if flutes and fl:
                ph = (a * flutes / math.tau) % 1.0
                rr = r * (1.0 - depth * math.sin(math.pi * ph))
            ring.append((uc + rr * math.cos(a), y, vc + rr * math.sin(a)))
        rings.append(ring)
    verts = [p for ring in rings for p in ring]
    faces = [tuple(reversed(range(seg))), tuple((len(rings) - 1) * seg + i for i in range(seg))]
    for k in range(len(rings) - 1):
        faces += [(k * seg + i, k * seg + (i + 1) % seg, (k + 1) * seg + (i + 1) % seg, (k + 1) * seg + i)
                  for i in range(seg)]
    M.mesh('rev', verts, faces, mat, smooth)

col_centres = [(E_A + bw * i) for i in range(1, 5)]
for s in col_centres:
    uc, _, vc = MAIN.P('E', s, 0, COL_N)
    shaft = []
    for k in range(15):
        t = k / 14
        y = 0.3 + t * (6.25 - 0.3)
        r = 0.70 - 0.13 * t - 0.03 * math.sin(math.pi * t)   # entasis: 1.40 m at the foot, 1.14 m at the neck
        shaft.append((y, r, True))
    shaft += [(6.28, 0.555, False), (6.33, 0.57, True), (6.40, 0.555, False), (6.45, 0.57, True), (6.5, 0.57, True)]
    revolve(uc, vc, shaft, 80, 'stone', flutes=20, depth=0.06)
    ech = [(6.5, 0.6, False), (6.62, 0.72, False), (6.75, 0.82, False), (6.88, 0.87, False), (6.96, 0.88, False)]
    revolve(uc, vc, ech, 48, 'stone')
    MAIN.F('E', s - 0.92, s + 0.92, 6.96, PORT_TOP, COL_N - 0.92, COL_N + 0.92, 'stone')
# antae: square piers terminating the colonnade against the pavilions
for s0, s1 in ((E_A, E_A + 0.95), (E_B - 0.95, E_B)):
    MAIN.F('E', s0, s1, 0.3, 6.96, -1.2, 0.05, 'stone')
    MAIN.F('E', s0 - 0.08, s1 + 0.08, 6.96, PORT_TOP, -1.25, 0.12, 'stone')
# bronze gates between the columns, see-through bars
posts = [E_A + 0.95] + [s + x for s in col_centres for x in (-0.7, 0.7)] + [E_B - 0.95]
for g0, g1 in zip(posts[0::2], posts[1::2]):
    n = COL_N
    for y0, y1 in ((0.3, 0.42), (1.5, 1.6), (2.55, 2.7)):
        MAIN.F('E', g0, g1, y0, y1, n - 0.05, n + 0.05, 'bronze')
    k = int((g1 - g0) / 0.16)
    for i in range(1, k):
        s = g0 + (g1 - g0) * i / k
        MAIN.F('E', s - 0.022, s + 0.022, 0.42, 2.55, n - 0.022, n + 0.022, 'bronze')
    for i in range(k // 2):                  # lozenge band of the frieze rail
        s = g0 + (g1 - g0) * (i + 0.5) / (k // 2)
        MAIN.prism('E', [(s, 1.63), (s + 0.1, 1.9), (s, 2.17), (s - 0.1, 1.9)], n - 0.03, n + 0.03, 'bronze')
# portico entablature: architrave, triglyph frieze, cornice with mutules
MAIN.F('E', E_A, E_B, PORT_TOP, 8.3, -0.05, 0.12, 'stone')
MAIN.F('E', E_A, E_B, 8.3, 9.2, -0.05, 0.05, 'stone')
for i in range(int((E_B - E_A) / (bw / 2)) + 1):
    s = E_A + 0.5 + (E_B - E_A - 1.0) * i / int((E_B - E_A) / (bw / 2))
    MAIN.F('E', s - 0.33, s + 0.33, 8.35, 9.2, 0.05, 0.13, 'stone')
    for dx in (-0.11, 0.11):
        MAIN.F('E', s + dx - 0.035, s + dx + 0.035, 8.45, 9.2, 0.13, 0.16, 'stone')  # glyph ribs
    MAIN.F('E', s - 0.3, s + 0.3, 8.2, 8.3, 0.12, 0.18, 'stone')                        # regula
    for dx in (-0.22, -0.11, 0.0, 0.11, 0.22):
        MAIN.F('E', s + dx - 0.03, s + dx + 0.03, 8.12, 8.2, 0.12, 0.18, 'stone')        # guttae
# first eave, all round the building
for f in 'EWNS':
    ax, pl, sg, s0, s1 = MAIN.faces[f]
    MAIN.F(f, s0 - 0.55, s1 + 0.55, 9.2, 9.5, -T, 0.55, 'stone')
    MAIN.F(f, s0 - 0.75, s1 + 0.75, 9.5, 9.75, -T, 0.75, 'stone')
    MAIN.F(f, s0 - 0.68, s1 + 0.68, 9.75, 9.9, -T, 0.68, 'stone')
    # second eave: string course, with the meander balustrade band on the central zones
    MAIN.F(f, s0 - 0.5, s1 + 0.5, BAND2[0], BAND2[0] + 0.3, -T, 0.5, 'stone')
    for (a, b, kind, nb) in zones(f):
        if kind != 'mid':
            continue
        MAIN.F(f, a, b, BAND2[0] + 0.3, BAND2[1], -T, 0.4, 'stone')
        k = int((b - a) / 0.6)
        for i in range(k):                  # meander (Greek key) relief, one key per 0.6 m
            s = a + (b - a) * i / k
            for (x0, x1, y0, y1) in ((0.05, 0.1, 0.35, 0.9), (0.05, 0.5, 0.85, 0.9), (0.45, 0.5, 0.5, 0.9),
                                     (0.2, 0.5, 0.5, 0.55), (0.2, 0.25, 0.5, 0.7), (0.05, 0.55, 0.35, 0.4)):
                MAIN.F(f, s + x0, s + x1, BAND2[0] + y0, BAND2[0] + y1, 0.4, 0.46, 'stone')
        for i in range(int((b - a) / 1.3) + 1):   # small urns on the band
            s = a + 0.3 + (b - a - 0.6) * i / int((b - a) / 1.3)
            uc, _, vc = MAIN.P(f, s, 0, 0.1)
            revolve(uc, vc, [(15.3, 0.16, 0), (15.4, 0.1, 0), (15.55, 0.2, 0), (15.75, 0.18, 0), (15.85, 0.08, 0), (15.9, 0.06, 0)],
                    12, 'stone')

# Frieze with panels, dentils, modillions and the main cornice.
for f in 'EWNS':
    ax, pl, sg, s0, s1 = MAIN.faces[f]
    MAIN.F(f, s0 - 0.3, s1 + 0.3, FRIEZE[0], FRIEZE[1], -T, PAV_OFF + 0.05, 'stone')
    k = int((s1 - s0) / 1.15)
    for i in range(k):
        s = s0 + (s1 - s0) * (i + 0.5) / k
        MAIN.F(f, s - 0.38, s + 0.38, FRIEZE[0] + 0.3, FRIEZE[1] - 0.25, PAV_OFF + 0.05, PAV_OFF + 0.14, 'stone')
        MAIN.F(f, s - 0.2, s + 0.2, FRIEZE[0] + 0.55, FRIEZE[1] - 0.5, PAV_OFF + 0.14, PAV_OFF + 0.2, 'stone')
    MAIN.F(f, s0 - 0.6, s1 + 0.6, 30.8, 31.05, -T, PAV_OFF + 0.35, 'stone')           # bed moulding
    kd = int((s1 - s0 + 0.7) / 0.4)
    for i in range(kd):
        s = s0 - 0.35 + (s1 - s0 + 0.7) * (i + 0.5) / kd
        MAIN.F(f, s - 0.1, s + 0.1, 30.75, 30.95, PAV_OFF + 0.05, PAV_OFF + 0.28, 'stone')  # dentils
    km = int((s1 - s0 + 2.4) / 1.15)
    for i in range(km):
        s = s0 - 1.2 + (s1 - s0 + 2.4) * (i + 0.5) / km
        MAIN.prism(f, [(s - 0.17, 31.05), (s + 0.17, 31.05), (s + 0.17, 31.6), (s - 0.17, 31.6)],
                   PAV_OFF, PAV_OFF + 1.4, 'stone')                                       # modillions
        MAIN.F(f, s - 0.2, s + 0.2, 31.05, 31.2, PAV_OFF + 1.2, PAV_OFF + 1.42, 'stone')
    MAIN.F(f, s0 - 1.8, s1 + 1.8, 31.6, 32.0, -T, PAV_OFF + 1.55, 'stone')              # corona
    MAIN.F(f, s0 - 1.7, s1 + 1.7, 32.0, 32.3, -T, PAV_OFF + 1.45, 'stone')            # cyma
B(U0 + 0.2, U1 - 0.2, 31.05, 32.25, V0 + 0.2, V1 - 0.2, 'roof')

# Central attic set back behind an iron railing; pavilions rise at the corners.
ATT = 1.4
for f in 'EWNS':
    for (a, b, kind, nb) in zones(f):
        if kind != 'mid':
            continue
        centres, w = bays(a, b, nb)
        wins = [(c - 0.6, c + 0.6, 33.2, 34.5) for c in centres]
        fill_wall(MAIN, f, a - 0.01, b + 0.01, 32.3, 35.0, wins, 0.5, -ATT, 'stone')
        for (sa, sb, ya, yb) in wins:
            glass_pane(MAIN, f, sa, sb, ya, yb, -ATT - 0.38, (2, 1))
            surround(MAIN, f, sa, sb, ya, yb, -ATT, w=0.14, d=0.08)
        MAIN.F(f, a, b, 35.0, 35.45, -ATT - 0.5, -ATT + 0.3, 'stone')
        # railing along the cornice edge
        MAIN.F(f, a, b, 33.25, 33.32, PAV_OFF + 0.9, PAV_OFF + 0.98, 'iron')
        MAIN.F(f, a, b, 32.35, 32.42, PAV_OFF + 0.9, PAV_OFF + 0.98, 'iron')
        for i in range(int((b - a) / 0.14)):
            s = a + 0.07 + 0.14 * i
            MAIN.F(f, s - 0.015, s + 0.015, 32.42, 33.25, PAV_OFF + 0.925, PAV_OFF + 0.955, 'iron')
B(U0 + ATT - 0.2, U1 - ATT + 0.2, 35.0, 35.4, V0 + ATT - 0.2, V1 - ATT + 0.2, 'roof')

# Corner pavilions above the cornice: niche window with balcony and segmental-pedimented aedicule.
PT = 36.4
for (pu0, pu1) in ((U0, U0 + PAV_NS), (U1 - PAV_NS, U1)):
    for (pv0, pv1) in ((V0, V0 + PAV_EW), (V1 - PAV_EW, V1)):
        P = Rect(pu0 - PAV_OFF, pu1 + PAV_OFF, pv0 - PAV_OFF, pv1 + PAV_OFF)
        B(P.u0 + 0.5, P.u1 - 0.5, 32.3, PT, P.v0 + 0.5, P.v1 - 0.5, 'shadow')
        for f in 'EWNS':
            ax, pl, sg, s0, s1 = P.faces[f]
            outward = (f == 'E' and pu1 == U1) or (f == 'W' and pu0 == U0) or (f == 'N' and pv0 == V0) or (f == 'S' and pv1 == V1)
            if not outward:
                P.F(f, s0, s1, 32.3, PT, -0.5, 0.0, 'stone')
                continue
            c = (s0 + s1) / 2
            r = 0.62
            fill_wall(P, f, s0, s1, 32.3, PT, [(c - r, c + r, 33.1, 35.1 + r + 0.05)], 0.5, 0.0, 'stone',
                      rustic=(32.3, PT))
            arch_head(P, f, c, r, 35.1, 35.1 + r + 0.05, -0.5, 0.0)
            glass_pane(P, f, c - r, c + r, 33.1, 35.1, -0.4, (2, 2))
            P.prism(f, [(c - r, 35.1)] + circle(c, 35.1, r, 12, 0.0, math.pi, closed=False)[::-1][::-1] + [(c + r, 35.1)],
                    -0.46, -0.4, 'glass')
            # aedicule
            for x in (c - r - 0.45, c + r + 0.1):
                P.F(f, x, x + 0.35, 33.0, 35.9, 0.0, 0.2, 'stone')
            P.F(f, c - r - 0.55, c + r + 0.55, 35.9, 36.15, 0.0, 0.28, 'stone')
            seg = [(c + (r + 0.6) * math.cos(a), 36.15 + 0.45 * math.sin(a) / 1.0) for a in
                   [math.pi * (1 - i / 12) for i in range(13)]]
            P.prism(f, seg, 0.0, 0.32, 'stone')
            # balcony slab and railing
            P.F(f, c - r - 0.3, c + r + 0.3, 32.95, 33.1, 0.0, 0.55, 'stone')
            P.F(f, c - r - 0.3, c + r + 0.3, 33.95, 34.02, 0.48, 0.55, 'iron')
            for i in range(11):
                s = c - r - 0.25 + (2 * r + 0.5) * i / 10
                P.F(f, s - 0.015, s + 0.015, 33.1, 33.95, 0.5, 0.53, 'iron')
        # pavilion cornice and stepped cap
        B(P.u0 - 0.35, P.u1 + 0.35, PT, PT + 0.3, P.v0 - 0.35, P.v1 + 0.35, 'stone')
        B(P.u0 - 0.6, P.u1 + 0.6, PT + 0.3, PT + 0.65, P.v0 - 0.6, P.v1 + 0.6, 'stone')
        B(P.u0 - 0.5, P.u1 + 0.5, PT + 0.65, PT + 0.85, P.v0 - 0.5, P.v1 + 0.5, 'stone')
        B(P.u0 + 0.1, P.u1 - 0.1, PT + 0.85, PT + 1.35, P.v0 + 0.1, P.v1 - 0.1, 'stone')
        B(P.u0 + 0.6, P.u1 - 0.6, PT + 1.35, PT + 1.7, P.v0 + 0.6, P.v1 - 0.6, 'roof')

# --------------------------------------------------------------------------------------------------
# Clock tower, set back behind the attic, centred on the frontage.
UC = 0.6
def trect(h):
    return Rect(UC - h, UC + h, -h, h)

TB = trect(5.2)                              # lower stage, ~10.4 m (photos 13/14 at dial scale)
B(TB.u0 + 0.4, TB.u1 - 0.4, 32.3, 47.0, TB.v0 + 0.4, TB.v1 - 0.4, 'shadow')
for f in 'EWNS':
    ax, pl, sg, s0, s1 = TB.faces[f]
    c = (s0 + s1) / 2
    slits = [(c + dx - 0.42, c + dx + 0.42, 40.8, 46.2) for dx in (-1.9, 0.0, 1.9)]
    fill_wall(TB, f, s0, s1, 32.3, 47.0, slits, 0.55, 0.0, 'stone')
    for (sa, sb, ya, yb) in slits:
        glass_pane(TB, f, sa, sb, ya, yb, -0.45, (2, 6))
        TB.F(f, sa - 0.1, sb + 0.1, ya - 0.2, ya, 0.0, 0.2, 'stone')
    TB.F(f, s0 - 0.2, s1 + 0.2, 35.4, 35.9, 0.0, 0.2, 'stone')                           # base moulding
    TB.F(f, s0, s1, 38.2, 39.1, 0.0, 0.08, 'stone')                                      # key band
    k = int((s1 - s0) / 0.55)
    for i in range(k):
        s = s0 + (s1 - s0) * i / k
        for (x0, x1, y0, y1) in ((0.05, 0.1, 0.1, 0.8), (0.05, 0.45, 0.75, 0.8), (0.4, 0.45, 0.35, 0.8),
                                 (0.2, 0.45, 0.35, 0.4), (0.2, 0.25, 0.35, 0.6)):
            TB.F(f, s + x0, s + x1, 38.2 + y0, 38.2 + y1, 0.08, 0.13, 'stone')
    TB.F(f, s0 - 0.35, s1 + 0.35, 47.0, 47.35, -0.5, 0.35, 'stone')                      # cornice
    TB.F(f, s0 - 0.5, s1 + 0.5, 47.35, 47.8, -0.5, 0.5, 'stone')
    for i in range(int((s1 - s0 + 0.6) / 0.35)):
        s = s0 - 0.3 + 0.35 * i + 0.17
        TB.F(f, s - 0.08, s + 0.08, 47.12, 47.35, 0.3, 0.46, 'stone')
# corner blocks flanking the lower stage
for su in (-1, 1):
    for sv in (-1, 1):
        cu, cv = UC + su * 6.0, sv * 6.0
        CB = Rect(cu - 1.5, cu + 1.5, cv - 1.5, cv + 1.5)
        B(CB.u0, CB.u1, 32.3, 43.6, CB.v0, CB.v1, 'stone')
        for f in 'EWNS':
            ax, pl, sg, s0, s1 = CB.faces[f]
            CB.F(f, s0 + 0.35, s1 - 0.35, 38.2, 41.4, 0.0, 0.1, 'stone')                 # sunk panel frame
            CB.F(f, s0 + 0.55, s1 - 0.55, 38.4, 41.2, -0.08, 0.0, 'stone')
            for y in (34.0, 35.2, 36.4):
                CB.F(f, s0, s1, y, y + 0.08, -0.06, 0.0, 'stone')
        B(CB.u0 - 0.25, CB.u1 + 0.25, 43.6, 43.95, CB.v0 - 0.25, CB.v1 + 0.25, 'stone')
        B(CB.u0 - 0.1, CB.u1 + 0.1, 43.95, 44.2, CB.v0 - 0.1, CB.v1 + 0.1, 'stone')
        B(CB.u0 + 0.3, CB.u1 - 0.3, 44.2, 44.6, CB.v0 + 0.3, CB.v1 - 0.3, 'stone')

# clock stage: 8.0 m square, dials 5.3 m (en Wikipedia), corner pilaster strips
CS = trect(4.0)
DY = 52.0
B(CS.u0, CS.u1, 47.8, 56.3, CS.v0, CS.v1, 'stone')
for f in 'EWNS':
    ax, pl, sg, s0, s1 = CS.faces[f]
    c = (s0 + s1) / 2
    for x0, x1 in ((s0, s0 + 0.75), (s1 - 0.75, s1)):
        CS.F(f, x0, x1, 47.8, 56.3, 0.0, 0.18, 'stone')
    CS.F(f, s0, s1, 47.8, 48.3, 0.0, 0.25, 'stone')
    CS.F(f, s0 + 0.75, s1 - 0.75, 55.2, 55.35, 0.0, 0.1, 'stone')
    # dial: iron rim, backlit glass plate with glazing spokes, chapter ring, hour and minute marks
    CS.annulus(f, c, DY, 2.4, 2.65, 0.0, 0.2, 'iron', 96)
    CS.prism(f, circle(c, DY, 2.42, 96), 0.0, 0.1, 'dial')
    CS.annulus(f, c, DY, 1.9, 1.96, 0.1, 0.14, 'iron', 72)
    CS.annulus(f, c, DY, 0.55, 0.6, 0.1, 0.14, 'iron', 32)
    for i in range(12):
        a = i * math.tau / 12
        ca, sa_ = math.cos(a), math.sin(a)
        pts = [(0.6, -0.025), (1.9, -0.025), (1.9, 0.025), (0.6, 0.025)]
        CS.prism(f, [(c + x * ca - y * sa_, DY + x * sa_ + y * ca) for x, y in pts], 0.1, 0.13, 'iron')
        hw = 0.09 if i % 3 else 0.14
        pts = [(2.0, -hw), (2.36, -hw), (2.36, hw), (2.0, hw)]
        CS.prism(f, [(c + x * ca - y * sa_, DY + x * sa_ + y * ca) for x, y in pts], 0.1, 0.15, 'iron')
    for i in range(60):
        if i % 5 == 0:
            continue
        a = i * math.tau / 60
        ca, sa_ = math.cos(a), math.sin(a)
        pts = [(2.2, -0.02), (2.36, -0.02), (2.36, 0.02), (2.2, 0.02)]
        CS.prism(f, [(c + x * ca - y * sa_, DY + x * sa_ + y * ca) for x, y in pts], 0.1, 0.13, 'iron')
    # hands at ten past ten; the view mirrors on the back faces, so the angle follows the face
    # s runs to the viewer's left on the E and N faces, so mirror the clockwise angle there
    mirror = -1 if f in ('E', 'N') else 1
    for length, width, n0 in ((1.45, 0.14, 0.15), (2.15, 0.09, 0.2)):
        cw = math.radians(305.0 if length < 2 else 48.0)   # hour, minute: clockwise from 12
        dx, dy = math.sin(cw) * mirror, math.cos(cw)
        px, py = -dy, dx
        pts = [(-0.35, -width / 2), (length * 0.8, -width / 2), (length, 0.0), (length * 0.8, width / 2), (-0.35, width / 2)]
        CS.prism(f, [(c + x * dx + y * px, DY + x * dy + y * py) for x, y in pts], n0, n0 + 0.05, 'iron')
    CS.prism(f, circle(c, DY, 0.14, 16), 0.1, 0.3, 'iron')
    # stone spandrel blocks in the corners of the dial square
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = c + sx * 2.55, DY + sy * 2.55
            CS.prism(f, [(cx, cy), (cx - sx * 0.8, cy), (cx, cy - sy * 0.8)], 0.0, 0.08, 'stone')
B(CS.u0 - 0.3, CS.u1 + 0.3, 56.3, 56.7, CS.v0 - 0.3, CS.v1 + 0.3, 'stone')
B(CS.u0 - 0.55, CS.u1 + 0.55, 56.7, 57.0, CS.v0 - 0.55, CS.v1 + 0.55, 'stone')
B(CS.u0 - 0.35, CS.u1 + 0.35, 57.0, 57.2, CS.v0 - 0.35, CS.v1 + 0.35, 'stone')

# step stage with an arched opening each side, then the gilded lantern and the flagpole
SS = trect(3.1)
B(SS.u0 + 0.5, SS.u1 - 0.5, 57.2, 59.0, SS.v0 + 0.5, SS.v1 - 0.5, 'shadow')
for f in 'EWNS':
    ax, pl, sg, s0, s1 = SS.faces[f]
    c = (s0 + s1) / 2
    fill_wall(SS, f, s0, s1, 57.2, 59.0, [(c - 1.4, c + 1.4, 57.75, 58.55)], 0.5, 0.0, 'stone')
    for dx in (-0.7, 0.0, 0.7):
        SS.F(f, c + dx - 0.05, c + dx + 0.05, 57.75, 58.55, -0.35, -0.25, 'iron')
    SS.F(f, c - 1.55, c + 1.55, 57.6, 57.75, 0.0, 0.15, 'stone')
    SS.F(f, s0 - 0.12, s1 + 0.12, 59.0, 59.4, -0.5, 0.12, 'stone')
for (h, y0, y1) in ((2.3, 59.35, 60.2),):
    B(UC - h, UC + h, y0, y1, -h, h, 'stone')
LN = trect(1.9)
B(LN.u0 + 0.3, LN.u1 - 0.3, 60.2, 63.2, LN.v0 + 0.3, LN.v1 - 0.3, 'shadow')
for f in 'EWNS':
    ax, pl, sg, s0, s1 = LN.faces[f]
    c = (s0 + s1) / 2
    wins = [(c + dx - 0.25, c + dx + 0.25, 61.0, 62.5) for dx in (-1.0, 0.0, 1.0)]
    fill_wall(LN, f, s0, s1, 60.2, 63.2, wins, 0.3, 0.0, 'gold')
    for (sa, sb, ya, yb) in wins:
        glass_pane(LN, f, sa, sb, ya, yb, -0.22, (1, 2), bar=0.04)
    for x0, x1 in ((s0 - 0.05, s0 + 0.3), (s1 - 0.3, s1 + 0.05)):
        LN.F(f, x0, x1, 60.2, 63.2, 0.0, 0.08, 'gold')
    LN.F(f, s0 - 0.1, s1 + 0.1, 60.2, 60.5, 0.0, 0.12, 'gold')
for (h, y0, y1, m) in ((2.25, 63.2, 63.55, 'gold'), (2.05, 63.55, 63.75, 'gold'), (1.6, 63.75, 64.1, 'gold'),
                       (1.1, 64.1, 64.4, 'gold'), (0.45, 64.4, 64.7, 'gold')):
    B(UC - h, UC + h, y0, y1, -h, h, m)
M.tube('flagpole', [(UC, 64.7, 0.0), (UC, 68.0, 0.0), (UC, 71.5, 0.0)], 0.09, 'iron', 12)
revolve(UC, 0.0, [(71.45, 0.02, 0)] + [(71.6 + 0.16 * math.sin(a), 0.16 * math.cos(a) + 0.001, 0)
                                       for a in [math.pi * (i / 10 - 0.5) for i in range(11)]], 16, 'gold')

if __name__ == '__main__':
    M.finish(directory=SCRATCH)
