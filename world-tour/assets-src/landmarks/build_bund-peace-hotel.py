"""Sassoon House (north building of the Peace Hotel), the Bund at Nanjing East Road, Shanghai.

Art Deco granite hotel-and-office block by Palmer & Turner (1929), registered from OSM relation 2376366.
The OSM outline is a wedge: 133 m along Nanjing East Road (south), 144 m along the north lane, and a
narrow ~20 m face on the Bund (east) between two chamfered corners. The race drives north along
Zhongshan East 1st Road about 25 m in front of that Bund face, at night.

Dimensions (sources, see $SCRATCH/modelling/bund-peace-hotel/report.md):
  * total 77 m to the lantern cap, flag mast to 83 m      -- Wikipedia "Peace Hotel" (77 m roofline, 83 m spire)
  * every other height                                     -- photogrammetry on Commons photo
    "和平饭店北楼·华懋饭店·上海.jpg" (near-frontal drone view of the Bund face), scaled so the lantern cap is 77 m
  * plan widths                                             -- OSM outline; tower = the flat Bund face width,
    drum/pyramid widths as fractions of it from the same photo
  * bay rhythm of the long facades (pavilion 7.2 m + 8 windows at 2.29 m) -- Commons "Peace Hotel - Sassoon
    House 20251127.jpg" (frontal Nanjing Road elevation), scaled by the 3.69 m storey height
Author frame: u across (+ = south, toward Nanjing Road), y up, v along the long axis (+ = west, inland).
Run: Blender --background --python assets-src/landmarks/build_bund-peace-hotel.py
"""
import math
import tempfile
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'bund-peace-hotel'
SCRATCH = (Path(tempfile.gettempdir()) / 'sr-landmarks' / 'bund-peace-hotel')
BOXF = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]

m = Model(ID)
m.material('stone', (0.50, 0.40, 0.29), 0, .82, ID+'_stone')         # buff granite facing
m.material('carved', (0.46, 0.37, 0.26), 0, .78, ID+'_carved')       # friezes, cartouches, consoles
m.material('glass', (0.05, 0.06, 0.07), .3, .12, ID+'_glass')        # windows (lit at night)
m.material('bronze', (0.15, 0.11, 0.07), .85, .4, ID+'_bronze')      # window frames, doors, canopy
m.material('copper', (0.13, 0.32, 0.20), .15, .6, ID+'_copper')      # verdigris pyramid and drum
m.material('red', (0.50, 0.08, 0.05), 0, .6, ID+'_paint_red')        # eave, hip and lantern trim
m.material('steel', (0.52, 0.52, 0.54), .8, .35, ID+'_steel')        # flag mast

# ------------------------------------------------------------------ heights (m), photo-derived
G_TOP = 7.6            # ground storey (arches crown 6.8)
BELT = (7.6, 8.8)      # carved belt course over the ground storey
FL0, FH = 8.8, 3.69    # floors 2-9
STRING = 34.25         # string course under floor 9
CORN = 38.3            # main cornice band 38.3-40.7 (frieze, corona, parapet)
ROOF = 40.7
FLOORS = [(FL0 + k*FH + .95, FL0 + k*FH + 3.0) for k in range(8)]   # floor-2..9 window openings
FLOORS[-1] = (FLOORS[-1][0] + .1, CORN - .75)                        # floor 9 under the frieze


# ------------------------------------------------------------------ plan helpers
def sub(a, b): return (a[0]-b[0], a[1]-b[1])
def add(a, b, k=1.0): return (a[0]+b[0]*k, a[1]+b[1]*k)
def unit(a): L = math.hypot(*a); return (a[0]/L, a[1]/L)


def area(ring):
    return sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]+ring[:1]))/2


def normals(ring):
    s = 1 if area(ring) > 0 else -1
    out = []
    for a, b in zip(ring, ring[1:]+ring[:1]):
        t = unit(sub(b, a)); out.append((t[1]*s, -t[0]*s))
    return out


def offset(ring, d):
    """Mitre offset, + outward."""
    ns = normals(ring); out = []
    for i, p in enumerate(ring):
        n1, n2 = ns[i-1], ns[i]
        k = d/(1 + n1[0]*n2[0] + n1[1]*n2[1])
        out.append((p[0] + (n1[0]+n2[0])*k, p[1] + (n1[1]+n2[1])*k))
    return out


class Line:
    """A wall line: s along it from a, d outward (+) from it, y up."""
    def __init__(self, a, b, n):
        self.a, self.t, self.n, self.L = a, unit(sub(b, a)), n, math.hypot(*sub(b, a))

    def P(self, s, d, y):
        return (self.a[0]+self.t[0]*s+self.n[0]*d, y, self.a[1]+self.t[1]*s+self.n[1]*d)

    def box(self, s0, s1, d0, d1, y0, y1, mat):
        if s1 - s0 < 1e-3 or y1 - y0 < 1e-3 or d1 - d0 < 1e-3:
            return
        v = [self.P(s, d, y0) for s, d in ((s0, d0), (s1, d0), (s1, d1), (s0, d1))]
        v += [self.P(s, d, y1) for s, d in ((s0, d0), (s1, d0), (s1, d1), (s0, d1))]
        m.mesh('box', v, BOXF, mat)

    def prism(self, outline, d0, d1, mat, smooth=False):
        """Closed prism of an (s, y) outline between depths d0 and d1."""
        n = len(outline)
        v = [self.P(s, d0, y) for s, y in outline] + [self.P(s, d1, y) for s, y in outline]
        f = [tuple(reversed(range(n))), tuple(range(n, 2*n))] + [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
        m.mesh('prism', v, f, mat, smooth)

    def tri(self, pts, d0, d1, mat):
        self.prism(pts, d0, d1, mat)


def lines(ring):
    return [Line(a, b, n) for a, b, n in zip(ring, ring[1:]+ring[:1], normals(ring))]


def slab(ring, d, y0, y1, mat):
    r = offset(ring, d)
    m.shell('slab', [(p[0], y0, p[1]) for p in r], (0, y1-y0, 0), mat)


def arc(sc, ys, r, n=12, a0=math.pi, a1=0.0):
    return [(sc + r*math.cos(a0 + (a1-a0)*i/n), ys + r*math.sin(a0 + (a1-a0)*i/n)) for i in range(n+1)]


RING = [tuple(p) for p in m.spec['ring']]
EDGES = lines(RING)
# ring order (author frame): 0-3 west notch, 4 Nanjing Road (south) wall west->east, 5 SE chamfer,
# 6 the Bund face south->north, 7 NE chamfer, 8 north lane wall east->west, 9-10 west end.
BUND = EDGES[6]


# ------------------------------------------------------------------ upper facade vocabulary
def column_bay(line, s0, s1, wins, front, y0, y1, floors, panels=True, string=True):
    """Granite pilasters with recessed window strips: glass, bronze frames and spandrel panels.
    wins: list of (centre, width). Everything between y0 and y1."""
    core = front - .62
    edges = [s0] + [x for c, w in sorted(wins) for x in (c - w/2, c + w/2)] + [s1]
    for a, b in zip(edges[0::2], edges[1::2]):                  # pilasters
        line.box(a, b, core, front, y0, y1, 'stone')
    for c, w in wins:
        a, b = c - w/2, c + w/2
        levels = [y0] + [y for f in floors for y in f] + [y1]
        for lo, hi in zip(levels[0::2], levels[1::2]):         # spandrels
            line.box(a, b, core, front - .30, lo, hi, 'stone')
            if panels and hi - lo > .9:
                line.box(a + .16, b - .16, front - .30, front - .24, lo + .22, hi - .22, 'carved')
        for lo, hi in floors:                                  # glass + bronze frame
            line.box(a, b, core - .04, front - .55, lo, hi, 'glass')
            line.box(c - .035, c + .035, front - .55, front - .50, lo, hi, 'bronze')
            tr = lo + .72*(hi - lo)
            line.box(a, b, front - .55, front - .50, tr, tr + .07, 'bronze')
            line.box(a - .04, b + .04, front - .30, front - .16, lo - .12, lo, 'stone')   # sill


def spaced(s0, s1, n, w):
    step = (s1 - s0)/n
    return [(s0 + step*(i + .5), w) for i in range(n)]


def pavilion(line, s0, s1, y0, y1, floors, crest=True):
    """Projecting end/centre pavilion: flat granite, a window pair, a crest above the cornice."""
    c = (s0 + s1)/2
    column_bay(line, s0, s1, [(c - .78, 1.05), (c + .78, 1.05)], .40, y0, y1, floors)
    if crest:
        top = ROOF + 3.7
        line.box(s0, s1, -3.2, .40, ROOF, top, 'stone')
        line.box(s0 + .5, s1 - .5, .40, .48, ROOF + .45, top - .9, 'carved')          # carved crest panel
        line.box(c - 1.1, c + 1.1, .25, .42, ROOF + .75, top - 1.3, 'glass')          # grille window
        for k in range(5):
            x = c - .9 + .45*k
            line.box(x - .04, x + .04, .42, .51, ROOF + .75, top - 1.3, 'bronze')
        line.box(s0 - .15, s1 + .15, -3.4, .70, top - .35, top, 'stone')              # coping
        line.box(s0 + .3, s1 - .3, -3.0, .55, top, top + .35, 'stone')


def section(line, s0, s1, nwin, y0, y1, floors):
    column_bay(line, s0, s1, spaced(s0, s1, nwin, 1.05), 0.0, y0, y1, floors)


# ------------------------------------------------------------------ ground storey vocabulary
def ground(line, s0, s1, openings):
    """Granite ground storey between s0 and s1. openings: (centre, width, kind) with kind
    'arch' (glazed arch), 'archdoor' (recessed arched doorway), 'shop' (shopfront), 'door' (rect)."""
    cuts = sorted((c - w/2, c + w/2, c, w, k) for c, w, k in openings)
    x = s0
    for a, b, c, w, k in cuts:                              # solid piers between openings
        line.box(x, a, -3.0, .15, 0, G_TOP, 'stone')
        line.box(x, a, -.2, .3, 0, .6, 'stone')                                     # base course
        x = b
    line.box(x, s1, -3.0, .15, 0, G_TOP, 'stone')
    line.box(x, s1, -.2, .3, 0, .6, 'stone')
    for a, b, c, w, k in cuts:
        r = w/2
        if k in ('arch', 'archdoor'):
            spring = 6.8 - r
            depth = -2.0 if k == 'archdoor' else -.75
            # head: solid granite above the arch, extrados to the belt
            line.prism([(a, spring)] + arc(c, spring, r, 16)[1:-1] + [(b, spring), (b, G_TOP), (a, G_TOP)],
                       -3.0, .15, 'stone')
            # archivolt moulding and keystone
            ring_out = arc(c, spring, r + .32, 16)
            ring_in = arc(c, spring, r, 16)
            line.prism(ring_in + list(reversed(ring_out)), .15, .28, 'stone')
            line.prism([(c - .35, spring + r - .1), (c + .35, spring + r - .1), (c + .5, spring + r + .75),
                        (c - .5, spring + r + .75)], .15, .38, 'carved')
            bot = 0 if k == 'archdoor' else .6
            line.prism([(a, bot), (b, bot)] + arc(c, spring, r, 16, 0.0, math.pi), depth - .14, depth, 'glass')
            if k == 'arch':
                line.box(a, b, -.9, -.2, 0, .6, 'stone')                                  # sill
            # bronze window/door grid inside the arch
            for i in range(1, 4):
                xx = a + w*i/4
                line.box(xx - .05, xx + .05, depth, depth + .08, 0 if k == 'archdoor' else .6,
                         spring + math.sqrt(max(r*r - (xx - c)**2, 0)) - .05, 'bronze')
            line.box(a, b, depth, depth + .08, spring - .06, spring + .06, 'bronze')
            if k == 'archdoor':
                line.box(a, b, depth, depth + .1, 2.9, 3.05, 'bronze')
        else:
            top = 4.6 if k == 'shop' else 3.8
            depth = -.8 if k == 'shop' else -1.6
            bot = .5 if k == 'shop' else 0
            line.box(a, b, -3.0, .15, top + (1.4 if k == 'shop' else 0), G_TOP, 'stone')   # head
            if k == 'shop':
                line.box(a, b, -3.0, -.35, top, top + 1.4, 'bronze')                       # dark transom panel
                line.box(a + .2, b - .2, -.35, -.28, top + .2, top + 1.2, 'bronze')
                line.box(a, b, -.9, -.2, 0, bot, 'stone')
            else:
                line.box(a - .3, b + .3, .15, .32, top + .3, top + 1.6, 'carved')           # panel over door
            line.box(a, b, depth - .14, depth, bot, top, 'glass')
            for i in range(1, 3):
                xx = a + w*i/3
                line.box(xx - .05, xx + .05, depth, depth + .08, bot, top, 'bronze')
            line.box(a, b, depth, depth + .08, top - 1.0, top - .92, 'bronze')
            line.box(a, b, -3.0, depth, top - .02, top, 'stone')                          # soffit


# ------------------------------------------------------------------ main block
slab(RING, -3.0, 0, G_TOP, 'stone')                 # ground storey core
slab(RING, -.62, BELT[1], CORN, 'stone')           # upper core
slab(RING, .15, BELT[0], BELT[0] + .7, 'carved')   # carved belt band
slab(RING, .42, BELT[0] + .7, BELT[1], 'stone')     # belt cornice
slab(RING, .12, STRING, STRING + .32, 'stone')      # string course under floor 9
slab(RING, .06, CORN, CORN + .8, 'carved')         # frieze
slab(RING, .35, CORN + .8, CORN + 1.3, 'stone')     # bed moulding
slab(RING, .75, CORN + 1.3, CORN + 1.8, 'stone')    # corona
slab(RING, .02, CORN + 1.8, ROOF, 'stone')          # parapet
slab(RING, .12, ROOF, ROOF + .18, 'stone')          # coping

# frieze and belt ornaments: carved medallions/brackets all round
for ln in EDGES:
    n = int(ln.L/1.15)
    for i in range(n):
        s = (i + .5)*ln.L/n
        ln.box(s - .22, s + .22, .06, .22, CORN + .12, CORN + .72, 'carved')
    n = int(ln.L/1.4)
    for i in range(n):
        s = (i + .5)*ln.L/n
        ln.box(s - .28, s + .28, .15, .27, BELT[0] + .12, BELT[0] + .58, 'carved')


def corner_fill(ring, front, inner, y0, y1, mat='stone'):
    """Close the wedge between two wall lines' boxes at every convex corner (a quoin strip)."""
    ns = normals(ring); sgn = 1 if area(ring) > 0 else -1
    for i, V in enumerate(ring):
        n1, n2 = ns[i-1], ns[i]
        t1 = (-n1[1]*sgn, n1[0]*sgn); t2 = (-n2[1]*sgn, n2[0]*sgn)
        if (t1[0]*t2[1] - t1[1]*t2[0])*sgn <= 0:
            continue                                            # reflex corner: boxes overlap already
        def mit(d):
            k = d/(1 + n1[0]*n2[0] + n1[1]*n2[1])
            return (V[0] + (n1[0]+n2[0])*k, V[1] + (n1[1]+n2[1])*k)
        quad = [add(V, n1, front), mit(front), add(V, n2, front), mit(inner)]
        if area(quad) < 0:
            quad.reverse()
        m.shell('corner', [(p[0], y0, p[1]) for p in quad], (0, y1 - y0, 0), mat)


corner_fill(RING, .15, -3.0, 0, CORN)


def generic_wall(line, first_pavilion=True, last_pavilion=True):
    """Pavilion - (section - pavilion)* rhythm, the way the Nanjing Road front is composed."""
    L = line.L
    if L < 30:
        k = max(2, round((L - 1.6)/2.29))
        section(line, .8, L - .8, k, BELT[1], CORN, FLOORS)
        line.box(0, .8, -.62, 0, BELT[1], CORN, 'stone'); line.box(L - .8, L, -.62, 0, BELT[1], CORN, 'stone')
        nshop = max(1, round(L/6.1))
        ground(line, 0, L, [(c, min(4.9, L/nshop - 1.3), 'shop') for c, _ in spaced(0, L, nshop, 1)])
        return
    nsec = max(1, round((L - 7.2)/25.5))
    pw = 7.2
    sec = (L - pw*(nsec + 1))/nsec
    s = 0
    for i in range(nsec + 1):
        pavilion(line, s, s + pw, BELT[1], CORN, FLOORS)
        ground(line, s, s + pw, [(s + pw/2, 3.2, 'arch')])
        s += pw
        if i < nsec:
            nw = max(2, round(sec/2.29))
            section(line, s, s + sec, nw, BELT[1], CORN, FLOORS)
            nshop = max(1, round(sec/6.1))
            ground(line, s, s + sec, [(c, sec/nshop - 1.3, 'shop') for c, _ in spaced(s, s + sec, nshop, 1)])
            s += sec


# Nanjing East Road (south) front, measured from the Bund end (east) westward, then mapped onto
# the edge that runs west -> east.
south = EDGES[4]
L = south.L
units = [('p', 0, 7.2, 'arch'), ('s', 7.2, 25.5, 'arches'), ('p', 25.5, 32.7, 'arch'),
         ('s', 32.7, 51.0, 'shops'), ('p', 51.0, 58.2, 'archdoor'), ('s', 58.2, 76.5, 'shops'),
         ('p', 76.5, 83.7, 'arch'), ('s', 83.7, 102.0, 'shops'), ('p', 102.0, 109.2, 'arch'),
         ('s', 109.2, 127.5, 'shops'), ('p', 127.5, L, 'arch')]
for kind, e0, e1, g in units:
    s0, s1 = L - e1, L - e0
    if kind == 'p':
        pavilion(south, s0, s1, BELT[1], CORN, FLOORS)
        ground(south, s0, s1, [((s0 + s1)/2, 3.2 if g != 'archdoor' else 3.6, g)])
    else:
        section(south, s0, s1, 8, BELT[1], CORN, FLOORS)
        if g == 'arches':
            ground(south, s0, s1, [(c, 3.2, 'arch') for c, _ in spaced(s0, s1, 4, 1)])
        else:
            ground(south, s0, s1, [(c, 4.9, 'shop') for c, _ in spaced(s0, s1, 3, 1)])
# hotel entrance canopy on Nanjing Road (bronze, stepped fascia)
c = L - 54.6
south.box(c - 2.6, c + 2.6, .15, 2.4, 6.9, 7.2, 'bronze')
south.box(c - 2.6, c + 2.6, 2.1, 2.4, 6.6, 6.9, 'bronze')
for x in (c - 2.2, c + 2.2):
    pts = [south.P(x, 2.25, 7.15), south.P(x, .2, 8.4)]
    m.tube('tie rod', pts, .05, 'bronze', 6)

# chamfered corners: window pairs over a doorway
for ch in (EDGES[5], EDGES[7]):
    c = ch.L/2
    column_bay(ch, 0, ch.L, [(c - .78, 1.05), (c + .78, 1.05)], .1, BELT[1], CORN, FLOORS)
    ground(ch, 0, ch.L, [(c, 1.9, 'door')])

# the Bund face: three window triplets between broad piers, three arches below (centre = door)
scale = BUND.L/19.7
trip = []
x = 1.8*scale
for g in range(3):
    for i in range(3):
        trip.append((x + (.5 + i*1.45)*scale, 1.0*scale))
    x += (3.9 + 2.2)*scale
TRIPLET_CENTRES = [(1.8 + 1.95 + 6.1*g)*scale for g in range(3)]
column_bay(BUND, 0, BUND.L, trip, .12, BELT[1], CORN, FLOORS)
ground(BUND, 0, BUND.L, [(TRIPLET_CENTRES[0], 3.6, 'arch'), (TRIPLET_CENTRES[1], 3.6, 'archdoor'),
                         (TRIPLET_CENTRES[2], 3.6, 'arch')])
# carved crest over the centre doorway
cc = TRIPLET_CENTRES[1]
BUND.box(cc - .9, cc + .9, .15, .4, BELT[0] - .1, BELT[1] + .9, 'carved')

# north lane wall and the west end (plainer, but the same grammar)
generic_wall(EDGES[8])
for i in (9, 10, 0, 1, 2, 3):
    generic_wall(EDGES[i])

# ------------------------------------------------------------------ penthouse storey behind the parapet
PENT = offset(RING, -2.8)
slab(PENT, -.62, ROOF, ROOF + 3.4, 'stone')
for ln in lines(PENT):
    if ln.L > 3:
        nw = max(1, int(ln.L/2.6))
        column_bay(ln, 0, ln.L, spaced(0, ln.L, nw, 1.0), 0, ROOF + .18, ROOF + 3.4, [(ROOF + .9, ROOF + 2.7)],
                   panels=False)
slab(PENT, .25, ROOF + 3.4, ROOF + 3.8, 'stone')
# dark metal railing round the penthouse roof terrace
for ln in lines(offset(PENT, -.3)):
    n = max(1, int(ln.L/1.6))
    for i in range(n + 1):
        ln.box(i*ln.L/n - .04, i*ln.L/n + .04, -.04, .04, ROOF + 3.8, ROOF + 4.85, 'bronze')
    ln.box(0, ln.L, -.05, .05, ROOF + 4.8, ROOF + 4.9, 'bronze')
    ln.box(0, ln.L, -.03, .03, ROOF + 4.3, ROOF + 4.36, 'bronze')

# ------------------------------------------------------------------ the Bund tower
A = BUND.a
e1 = BUND.t
e2 = (-BUND.n[0], -BUND.n[1])
HL = BUND.L/2
M = add(A, e1, HL)


def T(t, w):
    return (M[0] + e1[0]*t + e2[0]*w, M[1] + e1[1]*t + e2[1]*w)


def rect(t0, t1, w0, w1):
    r = [T(t0, w0), T(t1, w0), T(t1, w1), T(t0, w1)]
    return r if area(r) > 0 else list(reversed(r))


def front_of(ring):
    """The line of a tower rectangle that faces the Bund (outward normal closest to the Bund's)."""
    ls = lines(ring)
    return max(ls, key=lambda l: l.n[0]*BUND.n[0] + l.n[1]*BUND.n[1]), ls


DEPTH = 18.0
T1 = rect(-HL, HL, 0, DEPTH)
T1_TOP = 46.2
slab(T1, -.62, ROOF - .3, T1_TOP, 'stone')
f1, ls1 = front_of(T1)
for ln in ls1:
    if ln is f1:
        # centre arched window through floors 10-11, triplets either side, carved balcony under it
        s_mid = ln.L/2
        wins = [(s, w) for s, w in trip if abs(s - s_mid) > 3]
        column_bay(ln, 0, s_mid - 1.8, [w for w in wins if w[0] < s_mid], .12, ROOF, T1_TOP,
                   [(ROOF + .8, ROOF + 2.9), (ROOF + 4.3, T1_TOP - .5)])
        column_bay(ln, s_mid + 1.8, ln.L, [w for w in wins if w[0] > s_mid], .12, ROOF, T1_TOP,
                   [(ROOF + .8, ROOF + 2.9), (ROOF + 4.3, T1_TOP - .5)])
        r = 1.45; spring = T1_TOP - .6 - r
        ln.box(s_mid - 1.8, s_mid + 1.8, -.5, .12, ROOF, ROOF + .5, 'stone')
        ln.box(s_mid - 1.8, s_mid - r, -.5, .12, ROOF + .5, T1_TOP, 'stone')
        ln.box(s_mid + r, s_mid + 1.8, -.5, .12, ROOF + .5, T1_TOP, 'stone')
        ln.prism([(s_mid - r, spring)] + arc(s_mid, spring, r, 16)[1:-1] + [(s_mid + r, spring), (s_mid + r, T1_TOP),
                                                                             (s_mid - r, T1_TOP)], -.5, .12, 'stone')
        ln.prism([(s_mid - r, ROOF + .5), (s_mid + r, ROOF + .5)] + arc(s_mid, spring, r, 16, 0.0, math.pi)[1:-1],
                 -.8, -.62, 'glass')
        for xx in (s_mid - .5, s_mid + .5):
            ln.box(xx - .05, xx + .05, -.62, -.55, ROOF + .5, spring + math.sqrt(r*r - (xx - s_mid)**2), 'bronze')
        ln.box(s_mid - r, s_mid + r, -.62, -.55, ROOF + 2.9, ROOF + 3.0, 'bronze')
        ln.prism(arc(s_mid, spring, r, 16) + list(reversed(arc(s_mid, spring, r + .3, 16))), .12, .26, 'stone')
        # carved projecting balcony across the centre, riding the main cornice
        ln.box(s_mid - 2.9, s_mid + 2.9, .5, 1.25, CORN + .4, CORN + 1.5, 'carved')
        ln.box(s_mid - 3.0, s_mid + 3.0, .4, 1.4, CORN + 1.5, CORN + 1.75, 'stone')
        for k in range(4):
            xx = s_mid - 2.4 + 1.6*k
            ln.prism([(xx - .3, CORN + .4), (xx + .3, CORN + .4), (xx + .15, CORN - 1.2), (xx - .15, CORN - 1.2)],
                     .1, 1.1, 'carved')
    else:
        nw = max(2, round(ln.L/3.0))
        column_bay(ln, 0, ln.L, spaced(1.2, ln.L - 1.2, nw, 1.05), .12, ROOF - .3, T1_TOP,
                   [(ROOF + .8, ROOF + 2.9), (ROOF + 4.3, T1_TOP - .5)])
corner_fill(T1, .12, -.7, ROOF - .3, T1_TOP)
slab(T1, .1, T1_TOP, T1_TOP + .5, 'carved')        # tower frieze
slab(T1, .45, T1_TOP + .5, T1_TOP + .9, 'stone')   # tower cornice
slab(T1, .05, T1_TOP + .9, T1_TOP + 1.2, 'stone')

# stage 2 (floor 12): stepped in, balustraded terraces on the shoulders
T2 = rect(-8.4, 8.4, 1.0, 17.0)
T2_TOP = 51.2
slab(T2, -.62, T1_TOP + 1.2, T2_TOP, 'stone')
for ln in lines(T2):
    ws = [(ln.L/2 - 5.2, 1.0), (ln.L/2 - 1.6, 1.0), (ln.L/2 + 1.6, 1.0), (ln.L/2 + 5.2, 1.0)]
    column_bay(ln, 0, ln.L, ws, .1, T1_TOP + 1.2, T2_TOP, [(T1_TOP + 1.9, T2_TOP - .9)], panels=True)
corner_fill(T2, .1, -.7, T1_TOP + 1.2, T2_TOP)
for ln in lines(offset(T1, -.25)):
    y0 = T1_TOP + 1.2
    ln.box(0, ln.L, -.2, .1, y0, y0 + .2, 'stone')                                 # curb
    ln.box(0, ln.L, -.08, .0, y0 + 1.05, y0 + 1.12, 'bronze')                      # metal railing (photos)
    n = int(ln.L/.3)
    for i in range(n):
        s = (i + .5)*ln.L/n
        ln.box(s - .025, s + .025, -.065, -.015, y0 + .2, y0 + 1.05, 'bronze')

# stage 3: top cornice with corner consoles and a cartouche on every face
T3_TOP = 53.4
slab(T2, .05, T2_TOP, T2_TOP + 1.2, 'carved')
slab(T2, .55, T2_TOP + 1.2, T2_TOP + 1.7, 'stone')
slab(T2, .25, T2_TOP + 1.7, T3_TOP, 'stone')
DRUM = rect(-6.7, 6.7, 2.3, 15.7)
for ln in lines(DRUM):
    c = ln.L/2
    # cartouche: shield with two scrolls, standing on the cornice against the drum
    ln.prism([(c - 1.0, T3_TOP), (c + 1.0, T3_TOP), (c + 1.1, T3_TOP + 1.9), (c + .6, T3_TOP + 2.5),
              (c, T3_TOP + 2.8), (c - .6, T3_TOP + 2.5), (c - 1.1, T3_TOP + 1.9)], 0, .45, 'carved')
    for sgn in (-1, 1):
        pts = []
        for i in range(22):
            a = i/21*2.6*math.pi
            r = .9*(1 - i/26)
            pts.append(ln.P(c + sgn*(1.9 + r*math.cos(a)*.9), .25, T3_TOP + .95 + r*math.sin(a)*.9))
        m.tube('scroll', pts, .17, 'carved', 8)
    # corner consoles (volutes) at the drum corners
    for s in (-.4, ln.L + .4):
        pts = []
        for i in range(20):
            a = i/19*2.2*math.pi
            r = .75*(1 - i/24)
            pts.append(ln.P(s, .2 + .75 + r*math.cos(a), T3_TOP + .9 + r*math.sin(a)))
        m.tube('console', pts, .22, 'carved', 8)

# copper drum with standing ribs
slab(DRUM, 0, T3_TOP, 56.5, 'copper')
for ln in lines(DRUM):
    n = int(ln.L/.62)
    for i in range(1, n):
        s = i*ln.L/n
        ln.box(s - .05, s + .05, 0, .09, T3_TOP, 56.5, 'copper')
slab(DRUM, .3, 56.5, 56.8, 'red')                   # eave band

# pyramid frustum with standing seams, red hip rolls
PY0, PY1, B0, B1 = 56.8, 71.0, 6.7, 1.8
cw = 9.0
base = [T(sx*B0, cw + sw*B0) for sx, sw in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
top = [T(sx*B1, cw + sw*B1) for sx, sw in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
m.mesh('pyramid', [(p[0], PY0, p[1]) for p in base] + [(p[0], PY1, p[1]) for p in top], BOXF, 'copper')
for i in range(4):
    a0, a1 = base[i], base[(i+1) % 4]
    b0, b1 = top[i], top[(i+1) % 4]
    ctr = T(0, cw)
    side = unit(sub(a1, a0))
    fn = unit(sub(((a0[0]+a1[0])/2, (a0[1]+a1[1])/2), ctr))       # face normal in plan
    L3 = math.hypot(PY1 - PY0, B0 - B1)
    nh, ny = (PY1 - PY0)/L3, (B0 - B1)/L3                         # face normal: horizontal, vertical parts

    def lift(pt, y, h):
        return (pt[0] + fn[0]*nh*h, y + ny*h, pt[1] + fn[1]*nh*h)
    n = 18
    for k in range(1, n):                                        # standing seams, a hair proud of the face
        f = k/n
        p = add(a0, sub(a1, a0), f); q = add(b0, sub(b1, b0), f)
        ring4 = [(add(p, side, -.045), PY0 + .02), (add(p, side, .045), PY0 + .02),
                 (add(q, side, .045), PY1 - .02), (add(q, side, -.045), PY1 - .02)]
        vv = [lift(pt, y, -.02) for pt, y in ring4] + [lift(pt, y, .07) for pt, y in ring4]
        m.mesh('seam', vv, BOXF, 'copper')
    m.tube('hip', [(a0[0], PY0, a0[1]), (b0[0], PY1, b0[1])], .2, 'red', 8)
# eave kick: red trim a little proud at the base, copper band at the top
slab(rect(-6.95, 6.95, cw - 6.95, cw + 6.95), 0, PY0, PY0 + .35, 'red')
slab(rect(-1.9, 1.9, cw - 1.9, cw + 1.9), 0, PY1, 72.2, 'red')               # red box
slab(rect(-2.05, 2.05, cw - 2.05, cw + 2.05), 0, 72.05, 72.35, 'red')
# lantern: red corner piers, glazed on four sides, green cap
L0, L1 = 72.35, 76.0
LR = rect(-1.25, 1.25, cw - 1.25, cw + 1.25)
slab(LR, -.35, L0, L1, 'glass')
for p in LR:
    m.box('lantern pier', (p[0], (L0 + L1)/2, p[1]), (.55, L1 - L0, .55), 'red')
for ln in lines(LR):
    ln.box(0, ln.L, -.35, .08, L0, L0 + .5, 'red')
    ln.box(0, ln.L, -.35, .08, L1 - .6, L1, 'red')
    ln.box(ln.L/2 - .04, ln.L/2 + .04, -.35, -.25, L0 + .5, L1 - .6, 'red')
slab(LR, .25, L1, L1 + .2, 'copper')
cap0 = [T(sx*1.35, cw + sw*1.35) for sx, sw in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
cap1 = [T(sx*.35, cw + sw*.35) for sx, sw in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
m.mesh('cap', [(p[0], L1 + .2, p[1]) for p in cap0] + [(p[0], 77.0, p[1]) for p in cap1], BOXF, 'copper')
# flag mast (no flag): the "spire" of the 83 m figure
cx = T(0, cw)
m.tube('mast', [(cx[0], 76.9, cx[1]), (cx[0], 83.0, cx[1])], .07, 'steel', 8)
m.box('mast ball', (cx[0], 83.0, cx[1]), (.22, .22, .22), 'steel')

info = m.finish(directory=SCRATCH)
