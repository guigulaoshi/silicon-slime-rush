"""Monument to the People's Heroes (人民英雄纪念碑), Tiananmen Square, Beijing.

Original geometry authored from public reference photographs (Wikimedia Commons)
and the published figures: total height 37.94 m, lower terrace 50.44 x 61.5 m,
north core stone 14.7 x 2.9 m, relief band 2 m high, 40.68 m of reliefs in
eight large and two small panels, eight carved wreaths on the small pedestal.
Vertical proportions between the parts were measured off near-frontal photos
and scaled to the 37.94 m total. Inscriptions are blank recessed panels: no text.

Author frame: u across (east), y up, v along the footprint axis (south).
Run: Blender --background --python assets-src/landmarks/build_heroes_monument.py
"""
import math
import tempfile
import random
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

SCRATCH = (Path(tempfile.gettempdir()) / 'sr-landmarks' / 'heroes-monument')

# Monument body centre inside the OSM terrace outline (midpoint of the terrace body).
CU, CV = 0.25, 0.25

# Heights (m), measured off photos and scaled so the ridge scrolls crest at 37.94.
LOWER_TOP = 1.5
UPPER_TOP = 3.0
BIG_TOP = 7.0
SET1_TOP = 7.77
SET2_TOP = 8.54
SMALL_TOP = 11.77
SHAFT_TOP = 31.32
FRIEZE_TOP = 34.09
SLAB_TOP = 35.48
RIDGE_Y = 36.95
TOTAL = 37.94
BOX_FACES = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


# ---------------------------------------------------------------- primitives
def loft(m, label, rings, mat, cu=CU, cv=CV):
    """Stack of axis-aligned rectangles (y, half-u, half-v), capped both ends."""
    verts = []
    for y, hu, hv in rings:
        verts += [(cu-hu, y, cv-hv), (cu+hu, y, cv-hv), (cu+hu, y, cv+hv), (cu-hu, y, cv+hv)]
    n = len(rings)
    faces = [(3, 2, 1, 0)]
    for i in range(n-1):
        a, b = 4*i, 4*(i+1)
        faces += [(a+j, a+(j+1) % 4, b+(j+1) % 4, b+j) for j in range(4)]
    t = 4*(n-1)
    faces.append((t, t+1, t+2, t+3))
    m.mesh(label, verts, faces, mat)


def lathe(m, label, cu, cv, y0, profile, mat, sides=8):
    """Solid of revolution about a vertical axis; profile = [(dy, r)] bottom to top."""
    verts = []
    for dy, r in profile:
        verts += [(cu+r*math.cos(k*math.tau/sides), y0+dy, cv+r*math.sin(k*math.tau/sides)) for k in range(sides)]
    n = len(profile)
    faces = [tuple(reversed(range(sides))), tuple((n-1)*sides+k for k in range(sides))]
    for i in range(n-1):
        a, b = i*sides, (i+1)*sides
        faces += [(a+k, a+(k+1) % sides, b+(k+1) % sides, b+k) for k in range(sides)]
    m.mesh(label, verts, faces, mat, True)


def obox(m, label, p0, p1, w, h, mat):
    """Box whose bottom centre line runs p0->p1 (may slope); w across, h up."""
    du, dv = p1[0]-p0[0], p1[2]-p0[2]
    L = math.hypot(du, dv)
    nu, nv = -dv/L*w/2, du/L*w/2
    base = [(p0[0]+nu, p0[1], p0[2]+nv), (p1[0]+nu, p1[1], p1[2]+nv),
            (p1[0]-nu, p1[1], p1[2]-nv), (p0[0]-nu, p0[1], p0[2]-nv)]
    top = [(x, y+h, z) for x, y, z in base]
    m.mesh(label, base+top, BOX_FACES, mat)


def vprism(m, label, pts, origin, d, thick, mat):
    """Vertical-plane outline pts=[(s, y)] along horizontal unit d from origin (u, v), extruded across."""
    nu, nv = -d[1], d[0]
    outline = [(origin[0]+s*d[0]-nu*thick/2, y, origin[1]+s*d[1]-nv*thick/2) for s, y in pts]
    m.shell(label, outline, (nu*thick, 0, nv*thick), mat)


def offset_poly(poly, dist):
    """Offset a rectilinear polygon outward by dist (negative = inward)."""
    area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(poly, poly[1:]+poly[:1]))
    sgn = 1 if area > 0 else -1

    def normal(p, q):
        dx, dy = q[0]-p[0], q[1]-p[1]
        L = math.hypot(dx, dy)
        return (dy/L*sgn, -dx/L*sgn)
    out = []
    for i in range(len(poly)):
        a, b, c = poly[i-1], poly[i], poly[(i+1) % len(poly)]
        n1, n2 = normal(a, b), normal(b, c)
        out.append((b[0]+dist*(n1[0]+n2[0]), b[1]+dist*(n1[1]+n2[1])))
    return out


class Face:
    """Local frame on one side of the body: s along the face, e outward from the centre line."""
    def __init__(self, normal, half):
        self.n = normal
        self.t = (-normal[1], normal[0])
        self.half = half

    def P(self, s, y, e):
        return (CU+self.t[0]*s+self.n[0]*e, y, CV+self.t[1]*s+self.n[1]*e)

    def box(self, m, label, s0, s1, y0, y1, e0, e1, mat):
        v = [self.P(s0, y0, e0), self.P(s1, y0, e0), self.P(s1, y0, e1), self.P(s0, y0, e1),
             self.P(s0, y1, e0), self.P(s1, y1, e0), self.P(s1, y1, e1), self.P(s0, y1, e1)]
        m.mesh(label, v, BOX_FACES, mat)

    def plate(self, m, label, pts, e0, e1, mat):
        """Outline pts=[(s, y)] in the face plane, extruded from e0 to e1."""
        outline = [self.P(s, y, e0) for s, y in pts]
        m.shell(label, outline, (self.n[0]*(e1-e0), 0, self.n[1]*(e1-e0)), mat)


def faces_for(hu, hv):
    """Four faces with the distance of their plane from the centre (N/S run along u, E/W along v)."""
    return {'N': (Face((0, -1), hu), hv), 'S': (Face((0, 1), hu), hv),
            'E': (Face((1, 0), hv), hu), 'W': (Face((-1, 0), hv), hu)}


# ---------------------------------------------------------------- balustrade
POSTS = set()


def post(m, u, y, v):
    key = (round(u, 2), round(y, 2), round(v, 2))
    if key in POSTS:
        return
    POSTS.add(key)
    # Square marble post (望柱) with a stepped lotus-bud capital.
    loft(m, 'Balustrade post', [(y, .11, .11), (y+1.12, .11, .11), (y+1.12, .135, .135), (y+1.18, .145, .145),
                                (y+1.25, .14, .14), (y+1.31, .115, .115), (y+1.37, .07, .07), (y+1.41, .03, .03)],
         'marble', u, v)


VASE = [(0, .09), (.05, .11), (.10, .045), (.17, .10), (.23, .055), (.30, .15)]


def balustrade(m, a, b, ya, yb):
    """Qing-style marble railing from (u, v) a to b; base heights ya -> yb (sloped on stairs)."""
    L = math.dist(a, b)
    if L < .3:
        return
    d = ((b[0]-a[0])/L, (b[1]-a[1])/L)
    bays = max(1, round(L/1.9))
    pts = [(a[0]+(b[0]-a[0])*k/bays, ya+(yb-ya)*k/bays, a[1]+(b[1]-a[1])*k/bays) for k in range(bays+1)]
    for p in pts:
        post(m, *p)
    for p, q in zip(pts, pts[1:]):
        s0 = (p[0]+d[0]*.09, p[1], p[2]+d[1]*.09)
        s1 = (q[0]-d[0]*.09, q[1], q[2]-d[1]*.09)
        obox(m, 'Balustrade sill', s0, s1, .24, .12, 'marble')
        obox(m, 'Balustrade panel', (s0[0], s0[1]+.12, s0[2]), (s1[0], s1[1]+.12, s1[2]), .11, .42, 'marble')
        m.tube('Balustrade handrail', [(s0[0], s0[1]+.93, s0[2]), (s1[0], s1[1]+.93, s1[2])], .065, 'marble', 6)
        span = math.dist((s0[0], s0[2]), (s1[0], s1[2]))
        count = 3 if span > 1.4 else 2
        for k in range(count):
            t = (k+.5)/count
            cu, cv = s0[0]+(s1[0]-s0[0])*t, s0[2]+(s1[2]-s0[2])*t
            y0 = s0[1]+(s1[1]-s0[1])*t+.54
            outline = [(w, y0+dy) for dy, w in VASE]+[(-w, y0+dy) for dy, w in reversed(VASE)]
            vprism(m, 'Balustrade vase baluster', outline, (cu, cv), d, .09, 'marble')


# ---------------------------------------------------------------- stairs and terraces
def stair(m, edge_mid, out, width, yb, yt, proj, steps):
    """Flight from terrace edge outward: stepped prism, cheek walls, sloped railings, drum stones."""
    lat = (-out[1], out[0])
    rise, tread = (yt-yb)/steps, (proj-.1)/steps
    pts = [(.1, yb), (proj, yb)]
    for k in range(1, steps+1):
        pts += [(proj-(k-1)*tread, yb+k*rise), (proj-k*tread, yb+k*rise)]
    vprism(m, 'Stair flight', pts, edge_mid, out, width-.2, 'granite_grey')

    def cheek_y(s):
        return yt+.12+(s-.1)*((yb+.3)-(yt+.12))/(proj+.2)
    for side in (-1, 1):
        off = side*(width/2-.35)
        o = (edge_mid[0]+lat[0]*off, edge_mid[1]+lat[1]*off)
        vprism(m, 'Stair cheek wall (垂带)', [(.1, yb), (proj+.3, yb), (proj+.3, yb+.3), (.1, yt+.12)], o, out, .7, 'granite_grey')
        top = (o[0]-out[0]*.35, o[1]-out[1]*.35)
        foot_s = proj-.55
        foot = (o[0]+out[0]*foot_s, o[1]+out[1]*foot_s)
        balustrade(m, top, foot, yt, cheek_y(foot_s))
        # Drum stone (抱鼓石) closing the railing at the foot of the flight.
        c = (o[0]+out[0]*(proj-.05), o[1]+out[1]*(proj-.05))
        yd = cheek_y(proj-.05)-.05
        obox(m, 'Drum stone block', (c[0]-out[0]*.4, yd, c[1]-out[1]*.4), (c[0]+out[0]*.35, yd, c[1]+out[1]*.35), .3, .5, 'marble')
        dc = (c[0]-out[0]*.05, yd+.72, c[1]-out[1]*.05)
        m.tube('Drum stone disc', [(dc[0]-lat[0]*.14, dc[1], dc[2]-lat[1]*.14), (dc[0]+lat[0]*.14, dc[1], dc[2]+lat[1]*.14)],
               .3, 'marble', 12)


def terrace(m, poly, y0, y1, stairs, label):
    """Granite retaining wall with base course and coping, balustrade inset on the coping."""
    m.shell(label+' base course', [(u, y0, v) for u, v in offset_poly(poly, .08)], (0, .3, 0), 'granite_grey')
    m.shell(label+' wall', [(u, y0, v) for u, v in poly], (0, y1-y0-.18, 0), 'granite_grey')
    m.shell(label+' coping and paving', [(u, y1-.18, v) for u, v in offset_poly(poly, .1)], (0, .18, 0), 'granite_grey')
    rail = offset_poly(poly, -.35)
    for a, b in zip(rail, rail[1:]+rail[:1]):
        horizontal = abs(a[1]-b[1]) < .05
        axis = 0 if horizontal else 1
        cuts = []
        for (mid, out, width, proj) in stairs:
            if horizontal and abs(out[1]) > .5 and abs(mid[1]-a[1]) < 1.0:
                cuts.append((mid[0]-(width/2-.35), mid[0]+(width/2-.35)))
            if not horizontal and abs(out[0]) > .5 and abs(mid[0]-a[0]) < 1.0:
                cuts.append((mid[1]-(width/2-.35), mid[1]+(width/2-.35)))
        lo, hi = sorted((a[axis], b[axis]))
        runs, start = [], lo
        for c0, c1 in sorted(cuts):
            runs.append((start, c0))
            start = c1
        runs.append((start, hi))
        for r0, r1 in runs:
            if r1-r0 < .3:
                continue
            if horizontal:
                balustrade(m, (r0, a[1]), (r1, a[1]), y1, y1)
            else:
                balustrade(m, (a[0], r0), (a[0], r1), y1, y1)
    for (mid, out, width, proj) in stairs:
        stair(m, mid, out, width, y0, y1, proj, 10)


# ---------------------------------------------------------------- carving
def figure(m, face, rng, s, yb, h, eb, depth):
    """One standing figure in relief: legs, torso, head, arms; some carry a rifle or a flag."""
    lean = rng.uniform(-.08, .08)
    stride = rng.uniform(.04, .12)
    hip = yb+.47*h
    face.box(m, 'Relief figure leg', s-stride-.05, s-stride+.05, yb, hip, eb-.02, eb+depth*.55, 'carved')
    face.box(m, 'Relief figure leg', s+stride-.05+lean*.3, s+stride+.05+lean*.3, yb, hip, eb-.02, eb+depth*.55, 'carved')
    shoulder = yb+.8*h
    face.plate(m, 'Relief figure torso', [(s-.12, hip), (s+.12, hip), (s+.15+lean, shoulder), (s-.15+lean, shoulder)],
               eb-.02, eb+depth, 'carved')
    hc = face.P(s+lean*1.2, shoulder+.11*h, eb+depth*.45)
    lathe(m, 'Relief figure head', hc[0], hc[2], hc[1]-.09, [(0, .05), (.05, .1), (.13, .1), (.18, .05)], 'carved', 6)
    pose = rng.random()
    sl, sr = (s-.15+lean, shoulder-.04), (s+.15+lean, shoulder-.04)
    e = eb+depth*.7
    if pose < .3:      # raised arm
        hand = (sr[0]+rng.uniform(.05, .25), shoulder+.45*h*rng.uniform(.6, 1))
    else:              # arm forward
        hand = (sr[0]+rng.uniform(.2, .45), shoulder-rng.uniform(.05, .35))
    m.tube('Relief figure arm', [face.P(sr[0], sr[1], e), face.P(hand[0], hand[1], e)], .045, 'carved', 5)
    m.tube('Relief figure arm', [face.P(sl[0], sl[1], e), face.P(sl[0]-rng.uniform(.1, .3), shoulder-.35*h, e)], .045, 'carved', 5)
    if pose > .8:      # flag bearer
        top = (hand[0]+.1, hand[1]+.7)
        m.tube('Relief flag pole', [face.P(hand[0]-.05, hand[1]-.5, e), face.P(top[0], top[1], e)], .025, 'carved', 5)
        face.plate(m, 'Relief flag', [(top[0], top[1]), (top[0]+.55, top[1]-.08), (top[0]+.5, top[1]-.4), (top[0], top[1]-.35)],
                   eb, eb+depth*.5, 'carved')
    elif pose > .55:   # rifle held across the body
        m.tube('Relief rifle', [face.P(s-.25, hip+.1, e+.02), face.P(hand[0]+.15, hand[1]+.25, e+.02)], .03, 'carved', 5)


def relief_panel(m, face, rng, s0, s1, y0, y1, e_back, depth):
    face.box(m, 'Relief panel ground', s0, s1, y0, y1, e_back-.08, e_back, 'carved')
    face.box(m, 'Relief groundline', s0, s1, y0, y0+.12, e_back-.02, e_back+depth*.5, 'carved')
    width = s1-s0
    for rank, (lift, dz, shrink) in enumerate([(.28, depth*.5, .9), (.12, depth, 1.0)]):
        n = max(2, int(width/(.55 if rank == 0 else .5)))
        for k in range(n):
            s = s0+.3+(width-.6)*(k+rng.uniform(.2, .8))/n
            h = min(rng.uniform(1.4, 1.7)*shrink, (y1-y0-lift)/1.12)
            figure(m, face, rng, s, y0+lift, h, e_back, dz)


def petals(m, face, half, y, e, up, mat='granite'):
    """Row of carved lotus petals (仰莲 up / 覆莲 down) along a sumeru moulding."""
    n = max(4, int(2*half/.42))
    w = 2*half/n
    h = .3 if up else -.3
    for k in range(n):
        c = -half+(k+.5)*w
        a, b = c-w*.44, c+w*.44
        outline = [(a, y), (b, y), (b, y+h*.55), (c+w*.2, y+h*.9), (c, y+h), (c-w*.2, y+h*.9), (a, y+h*.55)]
        face.plate(m, 'Lotus petal', outline, e-.06, e+.05, mat)


def wreath(m, face, s, yc, e):
    """Carved wreath: ring of leaves with flowers and trailing ribbons."""
    ring = [face.P(s+.52*math.cos(k*math.tau/18), yc+.5*math.sin(k*math.tau/18), e) for k in range(18)]
    ring.append(ring[0])
    m.tube('Carved wreath ring', ring, .1, 'carved', 6)
    for k in range(9):
        a = k*math.tau/9+.2
        p = face.P(s+.52*math.cos(a), yc+.5*math.sin(a), e+.06)
        lathe(m, 'Carved wreath flower', p[0], p[2], p[1]-.08, [(0, .05), (.08, .13), (.16, .05)], 'carved', 6)
    for side in (-1, 1):
        m.tube('Carved wreath ribbon', [face.P(s+side*.1, yc-.48, e), face.P(s+side*.3, yc-.7, e), face.P(s+side*.25, yc-.9, e)],
               .05, 'carved', 5)


def emblem(m, face, yc, e):
    """Star over draped flags and pine sprays carved on the side faces of the shaft."""
    star = []
    for k in range(10):
        r = .5 if k % 2 == 0 else .2
        a = math.pi/2+k*math.tau/10
        star.append((r*math.cos(a), yc+1.35+r*math.sin(a)))
    face.plate(m, 'Carved star', star, e-.04, e+.1, 'granite')
    for x in (-.55, -.2, .2, .55):
        drop = 2.3-abs(x)*.9
        face.plate(m, 'Carved draped flag', [(x-.17, yc+.95), (x+.17, yc+.95), (x+.12+x*.2, yc+.95-drop), (x-.12+x*.2, yc+.95-drop+.2)],
                   e-.04, e+.07, 'granite')
    for side in (-1, 1):
        m.tube('Carved pine spray', [face.P(side*.2, yc-1.6, e+.03), face.P(side*.6, yc-1.0, e+.03), face.P(side*.75, yc-.2, e+.03)],
               .07, 'granite', 5)


# ---------------------------------------------------------------- build
def build():
    m = Model('heroes-monument')
    m.material('granite', (.60, .58, .54), 0, .74, 'heroes-monument_granite')
    m.material('granite_grey', (.50, .49, .47), 0, .82, 'heroes-monument_granite_grey')
    m.material('marble', (.88, .87, .84), 0, .45, 'heroes-monument_marble')
    m.material('carved', (.84, .83, .79), 0, .55, 'heroes-monument_carved')
    rng = random.Random(1958)

    # --- Lower terrace: OSM crabapple (海棠) outline with notched corners and four flights.
    lower = [(-25.11, -24.59), (-19.46, -24.59), (-19.46, -29.61), (19.55, -29.61), (19.55, -24.11), (25.60, -24.11),
             (25.60, 24.22), (19.37, 24.22), (19.37, 30.15), (-19.43, 30.15), (-19.43, 24.68), (-25.11, 24.68)]
    lower_stairs = [((.145, -29.61), (0, -1), 14.81, 5.0), ((.2, 30.15), (0, 1), 16.46, 3.37),
                    ((25.60, -.64), (1, 0), 14.36, 2.77), ((-25.11, .405), (-1, 0), 15.55, 3.77)]
    terrace(m, lower, 0, LOWER_TOP, lower_stairs, 'Lower terrace')

    # --- Upper terrace: square (上层座呈方形), flights in the middle of every side.
    H = 12.5
    upper = [(CU-H, CV-H), (CU+H, CV-H), (CU+H, CV+H), (CU-H, CV+H)]
    upper_stairs = [((CU, CV-H), (0, -1), 7.0, 3.0), ((CU, CV+H), (0, 1), 7.0, 3.0),
                    ((CU+H, CV), (1, 0), 7.0, 3.0), ((CU-H, CV), (-1, 0), 7.0, 3.0)]
    terrace(m, upper, LOWER_TOP, UPPER_TOP, upper_stairs, 'Upper terrace')

    # --- Great sumeru pedestal (大须弥座) carrying the relief band.
    Wu, Wv = 7.3, 5.9          # pilaster plane of the relief waist
    core = .15
    y = UPPER_TOP
    rings = [(y, Wu+.55, Wv+.55), (y+.35, Wu+.55, Wv+.55), (y+.35, Wu+.45, Wv+.45), (y+.55, Wu+.45, Wv+.45)]
    for k in range(1, 5):   # lower ogee (下枭) curving in
        t = k/4
        o = .45-.4*math.sin(t*math.pi/2)
        rings.append((y+.55+.4*t, Wu+o, Wv+o))
    rings += [(y+1.15, Wu+.05, Wv+.05), (y+1.15, Wu-core, Wv-core), (6.35, Wu-core, Wv-core), (6.35, Wu+.05, Wv+.05)]
    for k in range(1, 5):   # upper ogee (上枭) curving out
        t = k/4
        o = .05+.45*(1-math.cos(t*math.pi/2))
        rings.append((6.35+.4*t, Wu+o, Wv+o))
    rings += [(6.75, Wu+.55, Wv+.55), (BIG_TOP, Wu+.55, Wv+.55)]
    loft(m, 'Great sumeru pedestal', rings, 'granite')
    layout = {'N': [2.0, 6.4, 2.0], 'S': [4.0, 4.0, 4.0], 'E': [4.57, 4.57], 'W': [4.57, 4.57]}
    for key, (face, e_full) in faces_for(Wu, Wv).items():
        half = face.half
        widths = layout[key]
        pil = (2*half-sum(widths))/(len(widths)+1)
        trim = core+.05 if key in 'EW' else 0   # E/W corner pilasters stop at the N/S ones
        s = -half
        for i, w in enumerate(widths+[None]):
            p0, p1 = s, s+pil
            if i == 0:
                p0 += trim
            if w is None:
                p1 -= trim
            face.box(m, 'Pedestal pilaster', p0, p1, UPPER_TOP+1.15, 6.35, e_full-core-.05, e_full, 'granite')
            s += pil
            if w is not None:
                relief_panel(m, face, rng, s, s+w, 4.25, 6.25, e_full-.1, .16)
                s += w
        petals(m, face, half+.25, UPPER_TOP+.55, e_full+.27, False)
        petals(m, face, half+.25, 6.37, e_full+.3, True)

    # --- Two setback tiers between the pedestals, each with a carved scroll band.
    for (hu_, hv_, y0, y1) in ((5.55, 4.15, BIG_TOP, SET1_TOP), (4.9, 3.65, SET1_TOP, SET2_TOP)):
        loft(m, 'Setback tier', [(y0, hu_, hv_), (y1, hu_, hv_)], 'granite')
        for key, (face, e_full) in faces_for(hu_, hv_).items():
            n = int(2*face.half/.7)
            for k in range(n):
                c = -face.half+(k+.5)*2*face.half/n
                face.plate(m, 'Carved scroll band', [(c-.25, y0+.18), (c+.25, y0+.18), (c+.3, y0+.36), (c, y0+.54), (c-.3, y0+.36)],
                           e_full-.03, e_full+.04, 'granite')

    # --- Small sumeru pedestal (小须弥座) with eight carved wreaths.
    Su, Sv = 4.1, 3.05
    y = SET2_TOP
    rings = [(y, Su+.6, Sv+.6), (y+.3, Su+.6, Sv+.6)]
    for k in range(1, 4):
        t = k/3
        o = .6-.55*math.sin(t*math.pi/2)
        rings.append((y+.3+.36*t, Su+o, Sv+o))
    rings += [(y+.66, Su, Sv), (10.95, Su, Sv)]
    for k in range(1, 4):
        t = k/3
        o = .55*(1-math.cos(t*math.pi/2))
        rings.append((10.95+.4*t, Su+o, Sv+o))
    rings += [(11.35, Su+.6, Sv+.6), (SMALL_TOP, Su+.6, Sv+.6)]
    loft(m, 'Small sumeru pedestal', rings, 'granite')
    for key, (face, e_full) in faces_for(Su, Sv).items():
        L = face.half*1.3
        face.box(m, 'Wreath panel', -L/2-.4, L/2+.4, 9.35, 10.8, e_full-.05, e_full+.04, 'carved')
        for s in (-L/4, L/4):
            wreath(m, face, s, 10.12, e_full+.1)
        petals(m, face, face.half+.3, SET2_TOP+.3, e_full+.32, False)
        petals(m, face, face.half+.3, 10.97, e_full+.3, True)

    # --- Shaft: tapering granite obelisk with blank recessed inscription panels on N and S.
    hu0, hv0, hu1, hv1 = 3.7, 2.75, 3.58, 2.66
    rec = .08

    def hu(y):
        return hu0+(hu1-hu0)*(y-SMALL_TOP)/(SHAFT_TOP-SMALL_TOP)

    def hv(y):
        return hv0+(hv1-hv0)*(y-SMALL_TOP)/(SHAFT_TOP-SMALL_TOP)
    loft(m, 'Obelisk shaft core', [(SMALL_TOP, hu0, hv0-rec), (SHAFT_TOP, hu1, hv1-rec)], 'granite')
    panels = {-1: (1.45, 14.47, 29.17), 1: (2.3, 13.2, 30.55)}   # north core stone 2.9 x 14.7; south epitaph
    for sign, (pw, py0, py1) in panels.items():
        def P(s, y, outer):
            s = max(-hu(y), min(hu(y), s))
            return (CU+s, y, CV+sign*(hv(y) if outer else hv(y)-rec))

        def slab(s0, s1, y0, y1):
            v = [P(s0, y0, 0), P(s1, y0, 0), P(s1, y0, 1), P(s0, y0, 1), P(s0, y1, 0), P(s1, y1, 0), P(s1, y1, 1), P(s0, y1, 1)]
            m.mesh('Shaft face around inscription panel', v, BOX_FACES, 'granite')
        slab(-9, -pw, SMALL_TOP, SHAFT_TOP)
        slab(pw, 9, SMALL_TOP, SHAFT_TOP)
        slab(-pw, pw, SMALL_TOP, py0)
        slab(-pw, pw, py1, SHAFT_TOP)
        face = Face((0, sign), 0)
        for (a, b, c, d) in ((-pw-.12, -pw, py0-.12, py1+.12), (pw, pw+.12, py0-.12, py1+.12),
                             (-pw, pw, py0-.12, py0), (-pw, pw, py1, py1+.12)):
            yc = (c+d)/2
            face.box(m, 'Inscription panel frame', a, b, c, d, hv(yc)-.02, hv(yc)+.04, 'granite')
    loft(m, 'Shaft base band', [(SMALL_TOP, hu0+.08, hv0+.08), (SMALL_TOP+.55, hu0+.08, hv0+.08)], 'granite')
    for sign in (-1, 1):
        emblem(m, Face((sign, 0), 0), 27.2, hu(27.2))

    # --- Frieze (垂幔 band) with corbel tabs and hanging scallops.
    fu, fv = hu1+.12, hv1+.12
    loft(m, 'Capital frieze', [(SHAFT_TOP, fu, fv), (FRIEZE_TOP, fu, fv)], 'granite')
    for key, (face, e_full) in faces_for(fu, fv).items():
        n = int(2*face.half/.62)
        step = 2*face.half/n
        for k in range(n):
            c = -face.half+(k+.5)*step
            face.box(m, 'Frieze corbel tab', c-.16, c+.16, 33.15, 33.92, e_full-.02, e_full+.07, 'granite')
            face.plate(m, 'Frieze hanging scallop', [(c-.27, 32.95), (c+.27, 32.95), (c+.27, 32.55), (c, 32.25), (c-.27, 32.55)],
                       e_full-.02, e_full+.06, 'granite')

    loft(m, 'Frieze bead band', [(31.85, fu+.04, fv+.04), (31.97, fu+.04, fv+.04)], 'granite')

    # --- Cornice: cove flaring out to the eave slab.
    rings = [(FRIEZE_TOP, fu, fv), (FRIEZE_TOP+.12, fu+.1, fv+.1)]
    for k in range(1, 7):
        t = k/6
        o = .1+.9*(1-math.sqrt(1-t*t))
        rings.append((FRIEZE_TOP+.12+.68*t, fu+o, fv+o))
    rings += [(35.33, fu+1.0, fv+1.0), (SLAB_TOP, fu+.9, fv+.9)]
    loft(m, 'Cornice and eave slab', rings, 'granite')

    # --- Small hip roof (庑殿顶): concave slopes, hips, main ridge, curled ridge ends, corner scrolls.
    ru, rv = fu+.82, fv+.82
    rings = []
    for k in range(7):
        t = k/6
        rings.append((SLAB_TOP+(RIDGE_Y-SLAB_TOP)*t, 1.25+(ru-1.25)*(1-t)**1.5, .14+(rv-.14)*(1-t)**1.5))
    loft(m, 'Hip roof', rings, 'granite')
    for su in (-1, 1):
        for sv in (-1, 1):
            m.tube('Hip ridge', [(CU+su*r[1], r[0]+.02, CV+sv*r[2]) for r in rings], .1, 'granite', 6)
            cx, cy, cz = CU+su*(ru-.2), SLAB_TOP+.2, CV+sv*(rv-.2)
            curl = []
            for k in range(11):
                a = -math.pi/2+k*.5
                r = .2*(1-k/16)
                curl.append((cx+su*r*math.cos(a)*.7, cy+r*math.sin(a), cz+sv*r*math.cos(a)*.7))
            m.tube('Eave corner scroll', curl, .06, 'granite', 6)
    obox(m, 'Main ridge', (CU-1.45, RIDGE_Y-.08, CV), (CU+1.45, RIDGE_Y-.08, CV), .34, .32, 'granite')
    for su in (-1, 1):
        obox(m, 'Ridge-end block', (CU+su*1.0, RIDGE_Y+.15, CV), (CU+su*1.5, RIDGE_Y+.15, CV), .36, .32, 'granite')
        # Scroll curling inward toward the ridge centre; its crest is the registered 37.94 m.
        angles = [-math.pi/2+.25+k*.42 for k in range(15)]
        radii = [.36*(1-k/24) for k in range(15)]
        top_r = max(r*math.sin(a) for a, r in zip(angles, radii))
        cx, cy = CU+su*1.2, TOTAL-.07-top_r
        spiral = [(cx+su*r*math.cos(a), cy+r*math.sin(a), CV) for a, r in zip(angles, radii)]
        m.tube('Ridge-end scroll', spiral, .07, 'granite', 8)
    lathe(m, 'Ridge centre finial', CU, CV, RIDGE_Y+.2, [(0, .14), (.12, .16), (.28, .1), (.38, .04)], 'granite', 8)

    print('BALUSTRADE POSTS', len(POSTS))
    return m.finish(directory=SCRATCH)


build()
