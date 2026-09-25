"""Shanghai World Financial Center (上海环球金融中心, "the bottle opener"), Lujiazui -- seen across the
Huangpu from the Bund (route shanghai, night).

Form (KPF): a square prism cut by two sweeping faces that rise from two opposite base corners and meet the
full width at the top, so the square plan at the ground becomes a thin slab at the roof; a trapezoid aperture
is punched through the top of the slab.

Sources (report data/ and photos/; photos for comparison only):
- 492 m roof/top (Wikipedia infobox and text: "roof height is set at 492 m"), 101 floors, observation floors
  94F 423 m, 97F 439 m (the bridge at the foot of the aperture), 100F 474 m (the skywalk over its top).
- Base square = OSM way 10691100: 60 m sides, the cut corners are the NW and SE ones (OSM survey + photos).
- Orientation: the aperture looks NW-SE, i.e. almost straight at the Bund -- Commons night photo
  "2014.11.15.191355 ... night" (taken on the Bund) shows the aperture nearly face-on with the vertical edge
  on the right, and "20090426 5223 Shanghai SWFC.jpg" shows the broad face with two vertical edges and the
  V of the cut face.
- Aperture: inverted trapezoid, about 0.52 of the slab's width at its foot and 0.73 at its top; the slab at
  the top is ~70 m wide, so the two vertical corners are chamfered (the narrow light stripe down each edge
  in "20090426 5223") -- photo estimates.
- Night: blue LED lines across the cut faces every few floors, down the vertical corner edges and round the
  aperture (Bund night photo) -> `_light` in blue; the glass is `_glass` so the offices light up.

Author frame: route east/south metres about the centroid, written as (p, q): p along the SW->NE diagonal
(the two vertical corners), q along the NW->SE diagonal (the aperture axis).
Run: Blender --background --python assets-src/landmarks/build_shanghai_world_financial_center.py
"""
import math
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'shanghai-world-financial-center'
SCRATCH = Path(tempfile.gettempdir()) / 'sr-landmarks' / ID

TOP = 492.0            # Wikipedia: roof 492 m
FLOOR = 4.3            # ~ (474 m at 100F) / 101 with a taller lobby, used for floor lines and LED rhythm
D = 42.4               # OSM: half diagonal of the 60 m base square
CH = 7.4               # photo estimate: vertical-corner chamfer, making the top slab ~70 m wide
S0, S_TOP = D - .25, 8.0   # half-thickness along q: full square at the ground, 16 m slab at the top
AP_LOW, AP_HIGH = 438.0, 474.0   # aperture: 97F bridge at its foot (439 m), 100F skywalk over it (474 m)
AP_HALF_LOW, AP_HALF_HIGH = 18.5, 25.5   # photo estimate: 37 m and 51 m wide
MECH = [26.0, 77.0, 129.0, 181.0, 232.0, 284.0, 335.0, 387.0]  # mechanical/refuge floors every ~12 floors
P = (0.6446, -0.7646)  # OSM: SW corner -> NE corner direction (east, south)
Q = (0.7692, 0.6390)   # OSM: NW corner -> SE corner direction

m = Model(ID)
AX, AC = m.spec['axis'], m.spec['across']


def W(p, y, q):
    e, s = p*P[0] + q*Q[0], p*P[1] + q*Q[1]
    return (e*AC[0] + s*AC[1], y, e*AX[0] + s*AX[1])


def mesh(label, verts, faces, mat, smooth=False):
    m.mesh(label, [W(*v) for v in verts], faces, mat, smooth)


def loft(label, rings, mat):
    n = len(rings[0]); verts = [p for r in rings for p in r]; faces = []
    for j in range(len(rings) - 1):
        for i in range(n):
            a, b = j*n + i, j*n + (i+1) % n
            faces.append((a, b, b+n, a+n))
    for ring, base, flip in ((rings[0], 0, True), (rings[-1], (len(rings)-1)*n, False)):
        c = len(verts); verts.append(tuple(sum(p[k] for p in ring)/n for k in range(3)))
        for i in range(n):
            f = (base+i, base+(i+1) % n, c); faces.append(tuple(reversed(f)) if flip else f)
    mesh(label, verts, faces, mat)


def obox(label, a, b, width, depth, normal, mat):
    """Bar from a to b (p,y,q points), `width` tall across the up-ish side, `depth` along `normal`."""
    ax = [b[k]-a[k] for k in range(3)]; L = math.sqrt(sum(v*v for v in ax)); ax = [v/L for v in ax]
    n = normal; side = [ax[1]*n[2]-ax[2]*n[1], ax[2]*n[0]-ax[0]*n[2], ax[0]*n[1]-ax[1]*n[0]]
    sl = math.sqrt(sum(v*v for v in side)); side = [v/sl for v in side]
    verts = []
    for t in (0, 1):
        base = a if t == 0 else b
        for sw, sd in ((-1, 0), (1, 0), (1, 1), (-1, 1)):
            verts.append(tuple(base[k] + side[k]*sw*width/2 + n[k]*sd*depth for k in range(3)))
    mesh(label, verts, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], mat)


def box(label, c, size, mat):
    """Axis box in (p, y, q)."""
    mesh(label, [(c[0]+sx*size[0]/2, c[1]+sy*size[1]/2, c[2]+sz*size[2]/2)
                 for sy in (-1, 1) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))],
         [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat)


m.material('glass', (.26, .38, .48), .5, .07, ID + '_glass')
m.material('steel', (.60, .64, .68), .8, .3, ID + '_steel')
m.material('dark', (.10, .12, .14), .6, .45, ID + '_steel_dark')
m.material('mullion', (.24, .27, .30), .7, .35, ID + '_steel_mullion')
m.material('granite', (.40, .39, .38), 0, .6, ID + '_granite')
m.material('light', (.25, .62, 1.0), 0, .4, ID + '_light')
led = m.materials['light'].node_tree.nodes.get('Principled BSDF')
led.inputs['Emission Color'].default_value = (.2, .6, 1.0, 1)
led.inputs['Emission Strength'].default_value = 1.6
m.material('red', (.9, .05, .04), 0, .4, ID + '_light_red')
red = m.materials['red'].node_tree.nodes.get('Principled BSDF')
red.inputs['Emission Color'].default_value = (1, .05, .03, 1)
red.inputs['Emission Strength'].default_value = 2.0


def s_of(y):
    """Half-thickness along q: nearly straight cut with a slight convex sweep (photo: the V of the cut face)."""
    t = y / TOP
    return S0 - (S0 - S_TOP) * (.75*t + .25*t*t)


def plan(y, grow=0.0):
    """Octagon at height y (p, y, q), counter-clockwise, grown outward by `grow`."""
    s, e = s_of(y), D - CH
    g = grow
    c = CH + g*.414
    return [(e+g, y, -c), (e+g, y, c), (D-s+g*.414, y, s+g), (-(D-s)-g*.414, y, s+g),
            (-e-g, y, c), (-e-g, y, -c), (-(D-s)-g*.414, y, -s-g), (D-s+g*.414, y, -s-g)]


def leg(y, sign, hw):
    """One side of the aperture: the octagon clipped to sign*p >= hw (a hexagon)."""
    s, e = s_of(y), D - CH
    pts = [(hw, y, -s), (D-s, y, -s), (e, y, -CH), (e, y, CH), (D-s, y, s), (hw, y, s)]
    return [(sign*p, yy, q) for p, yy, q in pts][::sign]


def ap_half(y):
    return AP_HALF_LOW + (AP_HALF_HIGH - AP_HALF_LOW) * (y - AP_LOW) / (AP_HIGH - AP_LOW)


# ------------------------------------------------------------------ the shaft, the aperture legs, the top bar
rows = [plan(min(k*12.0, AP_LOW)) for k in range(int(AP_LOW // 12) + 1)]
if rows[-1][0][1] < AP_LOW: rows.append(plan(AP_LOW))
loft('shaft', rows, 'glass')
for sign in (-1, 1):
    loft('aperture leg', [leg(AP_LOW + k*(AP_HIGH-AP_LOW)/6, sign, ap_half(AP_LOW + k*(AP_HIGH-AP_LOW)/6)) for k in range(7)], 'glass')
loft('top bar', [plan(AP_HIGH), plan(TOP - .9)], 'glass')
loft('roof coping', [plan(TOP - .9, .25), plan(TOP, .25)], 'steel')

# the aperture's soffit and sill are steel-lined (the 97F bridge and the 100F skywalk floor)
loft('aperture sill', [plan(AP_LOW - 2.2, .2), plan(AP_LOW + .3, .2)], 'steel')
loft('aperture soffit', [plan(AP_HIGH - .3, .2), plan(AP_HIGH + 2.4, .2)], 'steel')
for sign in (-1, 1):
    # the lining of each jamb, a steel return 0.6 m proud of the leg's inner face
    for q in (-1, 1):
        s0, s1 = s_of(AP_LOW), s_of(AP_HIGH)
        a = (sign*(ap_half(AP_LOW) - .3), AP_LOW, q*s0); b = (sign*(ap_half(AP_HIGH) - .3), AP_HIGH, q*s1)
        obox('aperture jamb trim', a, b, .9, .6, (0, 0, q), 'steel')

# ------------------------------------------------------------------ floor lines and mechanical bands
y = 6.0
while y < TOP - 3:
    if not (AP_LOW - 3 < y < AP_HIGH + 3):
        loft('floor line', [plan(y, .1), plan(y + .3, .1)], 'mullion')
    y += FLOOR
for y in MECH:
    loft('mechanical band', [plan(y, .16), plan(y + 1.5, .16)], 'dark')

# ------------------------------------------------------------------ inside the aperture
# 97F skywalk: a glass-roofed bridge along the foot of the opening, framed by steel ribs.
s_lo, s_hi = s_of(AP_LOW), s_of(AP_HIGH)
hb, ht = ap_half(AP_LOW), ap_half(AP_HIGH)
box('97F skywalk glass', (0, AP_LOW + 1.9, 0), (2*hb - .4, 3.2, 2*s_lo - 3.0), 'glass')
p = -hb + 1.5
while p < hb - 1:
    box('97F skywalk rib', (p, AP_LOW + 3.6, 0), (.35, .35, 2*s_lo - 2.6), 'steel')
    p += 3.0
for q in (-1, 1):
    box('97F skywalk rail', (0, AP_LOW + 3.6, q*(s_lo - 1.4)), (2*hb - .4, .4, .4), 'steel')
# 100F skywalk: the glass-floored corridor under the top bar -- a grid of steel beams in the soffit.
p = -ht + 1.5
while p < ht - 1:
    box('100F soffit beam', (p, AP_HIGH - .9, 0), (.45, 1.2, 2*s_hi - .6), 'dark')
    p += 3.0
for q in (-.45, .45):
    box('100F skywalk corridor', (0, AP_HIGH - 2.0, q*s_hi), (2*ht - 1, 2.2, 3.0), 'glass')
# jambs: the braced steel frame shows on each leg's inner face (two X panels per jamb, both faces).
for sign in (-1, 1):
    for q in (-1, 1):
        ys = [AP_LOW, (AP_LOW + AP_HIGH)/2, AP_HIGH]
        for y0, y1 in zip(ys, ys[1:]):
            for qa, qb in ((-.8, .8), (.8, -.8)):
                a_ = (sign*(ap_half(y0) - .2), y0, qa*s_of(y0)*.5 + q*s_of(y0)*.45)
                b_ = (sign*(ap_half(y1) - .2), y1, qb*s_of(y1)*.5 + q*s_of(y1)*.45)
                m.tube('jamb brace', [W(*a_), W(*b_)], .3, 'dark', 6)
# roof: window-cleaning gantry rails along the top bar and two gantries parked on them
for q in (-1, 1):
    box('gantry rail', (0, TOP + .35, q*(S_TOP - 1.2)), (2*(D - CH) - 4, .5, .4), 'steel')
for sign in (-1, 1):
    px = sign*(D - CH - 9)
    for q in (-1, 1):
        box('gantry leg', (px, TOP + 1.0, q*(S_TOP - 1.2)), (.6, 1.2, .6), 'steel')
    box('gantry beam', (px, TOP + 1.7, 0), (1.2, .6, 2*S_TOP - 1.4), 'steel')
    box('gantry arm', (px, TOP + 2.1, 0), (.8, .4, 2*S_TOP + 3.0), 'steel')

# ------------------------------------------------------------------ vertical mullions, 3 m module (the grid in
# every photo), each following its own face: straight on the chamfers and the planar faces until the cut
# face overtakes it, and running up the sloping cut face from the arris to the roof.
MOD = 2.0   # photo estimate: ~35 bays across the 70 m broad face


def in_hole(p, y):
    return AP_LOW < y < AP_HIGH and abs(p) < ap_half(y) + .5


def y_where_s(target):
    lo, hi = 0.0, TOP
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if s_of(mid) > target else (lo, mid)
    return lo


for sign in (-1, 1):                                        # chamfer faces
    for q in (-6.0, -4.0, -2.0, 0.0, 2.0, 4.0, 6.0):
        obox('chamfer mullion', (sign*(D - CH), .5, q), (sign*(D - CH), TOP - 1.0, q), .32, .3, (sign, 0, 0), 'mullion')
k = 1
while True:                                                 # planar faces, one run per side of each corner
    p = (D - CH) - k*MOD*.7071
    if p <= D - S0 + .5: break
    q = D - p
    y_end = y_where_s(q)
    if y_end > 2:
        for sp in (-1, 1):
            for sq in (-1, 1):
                nrm = (sp*.7071, 0, sq*.7071)
                obox('planar mullion', (sp*p, .5, sq*q), (sp*p, y_end, sq*q), .32, .3, nrm, 'mullion')
    k += 1
p = -34.0                                                   # cut faces
while p <= 34.01:
    y0 = y_where_s(D - abs(p)) + .5
    for sq in (-1, 1):
        run = []
        ys = [y0] + [y for y in [12.0*i for i in range(1, 42)] if y0 < y < TOP - 1] + [AP_LOW, AP_HIGH, TOP - 1.0]
        ys = sorted(set(y for y in ys if y0 <= y <= TOP - 1.0))
        for y in ys + [None]:
            if y is not None and not in_hole(p, y) and not (AP_LOW <= y <= AP_HIGH and abs(p) < ap_half(y) + .5):
                run.append((p, y, sq*(s_of(y) + .12)))
                continue
            if len(run) >= 2:
                m.tube('cut-face mullion', [W(*v) for v in run], .17, 'mullion', 4)
            run = []
    p += MOD

# ------------------------------------------------------------------ base: granite plinth with lobby openings
BASE = 18.0
outer_pts, y0 = plan(0, .7), 0.0
# Plinth as eight wall slabs round the octagon, 1.4 m thick, leaving an 18 m x 9 m lobby opening in the
# middle of the west-facing and east-facing walls (at the ground the cut faces are still corners).
FACES = [[(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]][0]
ring, inner = plan(0, .7), plan(0, -.7)


def at(p0, p1, t, y):
    return (p0[0]+(p1[0]-p0[0])*t, y, p0[2]+(p1[2]-p0[2])*t)


for i in range(8):
    a, b = ring[i], ring[(i+1) % 8]; ai, bi = inner[i], inner[(i+1) % 8]
    L = math.hypot(b[0]-a[0], b[2]-a[2])
    cut = i in (1, 5) and L > 30
    t0c, t1c = (L-18)/2/L, (L+18)/2/L
    spans = [(0, t0c), (t1c, 1)] if cut else [(0, 1)]
    for t0, t1 in spans:
        v = [at(a, b, t0, 0), at(a, b, t1, 0), at(ai, bi, t1, 0), at(ai, bi, t0, 0)]
        v += [(x, BASE, z) for x, _, z in v]
        mesh('granite plinth', v, FACES, 'granite')
    if cut:
        v = [at(a, b, t0c, 9), at(a, b, t1c, 9), at(ai, bi, t1c, 9), at(ai, bi, t0c, 9)]
        v += [(x, BASE, z) for x, _, z in v]
        mesh('granite lintel', v, FACES, 'granite')
        # canopy: a steel slab 6 m deep in front of the opening
        nx, nz = (b[2]-a[2])/L, -(b[0]-a[0])/L
        mx, mz = (a[0]+b[0])/2, (a[2]+b[2])/2
        if nx*mx + nz*mz < 0: nx, nz = -nx, -nz
        v = []
        for yy in (9.2, 9.8):
            for t, o in ((t0c - .03, 0), (t1c + .03, 0), (t1c + .03, 6), (t0c - .03, 6)):
                x, _, z = at(a, b, t, yy); v.append((x + nx*o, yy, z + nz*o))
        mesh('entrance canopy', v, FACES, 'steel')
# the openings show the shaft's own lobby glass 1.4 m behind the granite face.

# ------------------------------------------------------------------ night LEDs (blue)
# across both cut faces every three floors, stopping at the aperture
y = 3*FLOOR
while y < TOP - 4:
    s = s_of(y); half_face = D - s
    if half_face > 3:
        for q in (-1, 1):
            spans = [(-half_face, half_face)]
            if AP_LOW - 1 < y < AP_HIGH + 1:
                h = ap_half(y); spans = [(-half_face, -h), (h, half_face)]
            for p0, p1 in spans:
                if p1 - p0 > 1.5:
                    obox('cut-face LED', (p0 + .4, y, q*(s + .02)), (p1 - .4, y, q*(s + .02)), .28, .22, (0, 0, q), 'light')
    y += 3*FLOOR
# down both vertical corners (the chamfer faces), full height
for sign in (-1, 1):
    obox('corner LED', (sign*(D - CH + .02), .5, 0), (sign*(D - CH + .02), TOP - 1, 0), .35, .22, (sign, 0, 0), 'light')
# round the aperture on both faces
for q in (-1, 1):
    s0, s1 = s_of(AP_LOW), s_of(AP_HIGH)
    obox('aperture LED sill', (-ap_half(AP_LOW), AP_LOW - .4, q*(s0 + .25)), (ap_half(AP_LOW), AP_LOW - .4, q*(s0 + .25)), .3, .2, (0, 0, q), 'light')
    obox('aperture LED head', (-ap_half(AP_HIGH), AP_HIGH + .4, q*(s1 + .25)), (ap_half(AP_HIGH), AP_HIGH + .4, q*(s1 + .25)), .3, .2, (0, 0, q), 'light')
    for sign in (-1, 1):
        obox('aperture LED jamb', (sign*(ap_half(AP_LOW) + .4), AP_LOW, q*(s0 + .25)),
             (sign*(ap_half(AP_HIGH) + .4), AP_HIGH, q*(s1 + .25)), .3, .2, (0, 0, q), 'light')

# aviation lights on the roof ends
for sign in (-1, 1):
    box('aviation light', (sign*(D - CH - 1.5), TOP + .4, 0), (.8, .8, .8), 'red')

m.finish(directory=SCRATCH)
