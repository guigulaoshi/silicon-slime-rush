"""Shanghai Tower (上海中心大厦), Lujiazui -- seen across the Huangpu from the Bund (route shanghai, night).

Sources (saved under the modelling report's data/ and photos/ folders; photos are for comparison only):
- 632 m architectural top, roof 587.4 m, top floor 583.5 m (L127), 128 floors, facade "completes a 120 degree
  twist as it rises", nine zones stacked -- Wikipedia "Shanghai Tower" infobox and Design section.
- Base plan = the OSM outline (way 165792123): a rounded triangle ~52 m to the vertices and ~39 m to the
  sides from the centroid, with a kink on its west-south-west vertex where the notch is (OSM survey).
- Taper, notch, crown slope and zone lines: photo estimates from Commons "20191114 Shanghai Tower.jpg",
  "3 main Shanghai Tower 11-08-2018.jpg", "Lujiazui tallest buildings.jpg": the plan shrinks to about half at
  the roof with a convex silhouette, the notch spirals up clockwise seen from above, the crown top is cut by
  a sloping plane that is lowest at the notch, zone boundaries show as double dark lines, one floor = one
  shingled glass band.
- Night: Commons "2014.11.15.191355 ... night": the skin reads as lit floors behind glass, with a dotted
  white line along zone boundaries and red aviation lights -> `_glass` skin + thin `_light` zone rings.

Author frame: everything below is written in the route's own east/south metres around the footprint centroid
and converted to the tool's (u, y, v) frame by W().
Run: Blender --background --python assets-src/landmarks/build_shanghai_tower.py
"""
import math
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'shanghai-tower'
SCRATCH = Path(tempfile.gettempdir()) / 'sr-landmarks' / ID

ROOF = 587.4              # Wikipedia infobox: roof
TOP = 632.0               # Wikipedia infobox: architectural height (crown's high point)
CROWN_LOW = 617.0         # photo estimate (ref09/ref10): the crown's cut plane is ~15 m lower at the notch side
FLOOR = ROOF / 128        # 4.59 m per shingled band (128 floors to the roof)
TWIST = math.radians(120)  # Wikipedia: 120 degree twist, roof to ground
NOTCH0 = math.radians(156)  # OSM kink: notch faces WSW at the ground (angle from east towards south)
R_MEAN, R_AMP = 45.5, 6.5   # OSM: ~52 m to the rounded vertices, ~39 m to the sides
NOTCH_DEPTH, NOTCH_HALF = 0.13, math.radians(9)  # photo estimate: a V groove about 6 m deep at the base
SIDES = 120                 # 3 degree sampling: the notch lips (+-9 deg) land exactly on samples
ZONES = [32.0, 97.0, 166.0, 235.0, 308.0, 382.0, 460.0, 538.0]  # refuge/plant floors 7,21,36,51,67,83,100,117 x 4.6 m

m = Model(ID)
AX, AC = m.spec['axis'], m.spec['across']


def W(e, y, s):
    """Route east/south metres (about the centroid) -> the tool's (u, y, v)."""
    return (e*AC[0] + s*AC[1], y, e*AX[0] + s*AX[1])


def mesh(label, verts, faces, mat, smooth=False):
    m.mesh(label, [W(*p) for p in verts], faces, mat, smooth)


def loft(label, rings, mat, smooth=False):
    """Closed solid through equal-length loops of (e, y, s) points, capped by centre fans."""
    n = len(rings[0]); verts = [p for r in rings for p in r]; faces = []
    for j in range(len(rings) - 1):
        for i in range(n):
            a, b = j*n + i, j*n + (i+1) % n
            faces.append((a, b, b+n, a+n))
    for ring, base, flip in ((rings[0], 0, True), (rings[-1], (len(rings)-1)*n, False)):
        c = len(verts); verts.append(tuple(sum(p[k] for p in ring)/n for k in range(3)))
        for i in range(n):
            f = (base+i, base+(i+1) % n, c); faces.append(tuple(reversed(f)) if flip else f)
    mesh(label, verts, faces, mat, smooth)


def annulus(label, outer_rings, inner_rings, mat):
    """Closed tube wall between an outer and an inner lofted surface (same sampling)."""
    n = len(outer_rings[0]); k = len(outer_rings)
    verts = [p for r in outer_rings for p in r] + [p for r in inner_rings for p in r]
    off = k*n; faces = []
    for j in range(k - 1):
        for i in range(n):
            a, b = j*n + i, j*n + (i+1) % n
            faces += [(a, b, b+n, a+n), (off+b, off+a, off+a+n, off+b+n)]
    for i in range(n):
        a, b = i, (i+1) % n
        faces.append((b, a, off+a, off+b))
        t = (k-1)*n; faces.append((t+a, t+b, off+t+b, off+t+a))
    mesh(label, verts, faces, mat)


def box(label, c, size, mat):
    mesh(label, [(c[0]+sx*size[0]/2, c[1]+sy*size[1]/2, c[2]+sz*size[2]/2)
                 for sy in (-1, 1) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))],
         [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat)


def tube(label, pts, r, mat, sides=6):
    m.tube(label, [W(*p) for p in pts], r, mat, sides)


# ------------------------------------------------------------------ materials
m.material('glass', (.30, .40, .47), .45, .08, ID + '_glass')
m.material('steel', (.58, .62, .66), .8, .32, ID + '_steel')
m.material('dark', (.12, .14, .16), .6, .45, ID + '_steel_dark')
m.material('granite', (.52, .50, .48), 0, .7, ID + '_granite')
m.material('screen', (.60, .63, .66), .7, .35, ID + '_steel_screen')
m.material('light', (.92, .95, 1.0), 0, .4, ID + '_light')
lamp = m.materials['light'].node_tree.nodes.get('Principled BSDF')
lamp.inputs['Emission Color'].default_value = (.9, .95, 1.0, 1)
lamp.inputs['Emission Strength'].default_value = 1.0
m.material('red', (.9, .05, .04), 0, .4, ID + '_light_red')
red = m.materials['red'].node_tree.nodes.get('Principled BSDF')
red.inputs['Emission Color'].default_value = (1, .05, .03, 1)
red.inputs['Emission Strength'].default_value = 2.0


# ------------------------------------------------------------------ plan
def scale(y):
    """Photo estimate: plan halves by the roof, the taper speeding up with height (convex silhouette)."""
    t = y / ROOF
    return 1 - .50 * t**1.3


def notch_angle(y):
    return NOTCH0 + TWIST * y / ROOF


def plan(y, grow=0.0):
    """Outer skin at height y: rounded triangle (vertex on the notch), V notch, twisted and scaled.
    `grow` pushes the loop outward by that many metres (bands, sills)."""
    k, a0 = scale(y), notch_angle(y)
    pts = []
    for i in range(SIDES):
        phi = i * math.tau / SIDES                       # measured from the notch
        d = min(phi, math.tau - phi)
        r = (R_MEAN + R_AMP * math.cos(3*phi)) * (1 - NOTCH_DEPTH * max(0.0, 1 - d/NOTCH_HALF))
        r = r * k + grow
        a = a0 + phi
        pts.append((r*math.cos(a), y, r*math.sin(a)))
    return pts


# ------------------------------------------------------------------ skin: one shingled band per floor
# Each floor's panel hangs 0.28 m proud at its foot, which is what draws the fine horizontal lines on the
# real skin; flat shading keeps the kick as a line instead of smoothing it away.
rings = []
for f in range(128):
    y0 = f * FLOOR
    rings.append(plan(y0, .28 if f else 0.0))
    rings.append(plan(y0 + FLOOR*.93))
rings.append(plan(ROOF))
loft('twisted outer skin', rings, 'glass')

# ------------------------------------------------------------------ crown: skin carried past the roof, cut by a slope
CROWN_ROWS = 14
nd = notch_angle(TOP)
FAR = (-math.cos(nd), -math.sin(nd))                   # the crown rises away from the notch
REACH = max(p[0]*FAR[0] + p[2]*FAR[1] for p in plan(ROOF))
NEAR = min(p[0]*FAR[0] + p[2]*FAR[1] for p in plan(ROOF))


def crown_top(x, z):
    """Plane cut: CROWN_LOW at the notch, TOP on the far side (photo: a straight sloping rim)."""
    f = (x*FAR[0] + z*FAR[1] - NEAR) / (REACH - NEAR)
    return CROWN_LOW + f * (TOP - CROWN_LOW)


def crown_point(p, y):
    k = scale(y) / scale(ROOF)
    return (p[0]*k, y, p[2]*k)


outer, inner = [], []
for j in range(CROWN_ROWS + 1):
    f = j / CROWN_ROWS
    o_row, i_row = [], []
    for p_lo, p_in in zip(plan(ROOF), plan(ROOF, -1.1)):
        y = ROOF + f * (crown_top(p_lo[0], p_lo[2]) - ROOF)
        o_row.append(crown_point(p_lo, y)); i_row.append(crown_point(p_in, y))
    outer.append(o_row); inner.append(i_row)
annulus('crown screen', outer, inner, 'screen')
# roof deck inside the crown, and the plant/damper box that stands on it
loft('roof deck', [plan(ROOF - .6, -.8), plan(ROOF + .4, -.8)], 'dark')
box('crown plant core', (0, ROOF + 7, 0), (20, 14, 20), 'dark')


# crown grille: a band of dark louvre openings under the rim (photo), and a lit rim
def crown_loop(y, grow=0.0):
    return [crown_point(p, y) for p in plan(ROOF, grow)]


# the plant floors under the screen read as one dark band straddling the roof line (ref09, ref10)
loft('plant band', [plan(ROOF - 8.5, .12), plan(ROOF, .12)], 'dark')
loft('plant band crown', [crown_loop(ROOF, .12), crown_loop(ROOF + 4.0, .12)], 'dark')
# the screen's horizontal rails (it is a perforated metal screen, not glazing)
for yb in [ROOF + 7.5 + 4.5*i for i in range(7)]:
    if yb < CROWN_LOW - 1.5:
        loft('screen rail', [crown_loop(yb, .12), crown_loop(yb + .45, .12)], 'steel')
rim = [crown_point(p, crown_top(p[0], p[2]) - .3) for p in plan(ROOF, -.55)]
tube('crown rim light', rim + rim[:1], .3, 'light', 6)

# ------------------------------------------------------------------ zone boundaries: double band + lit strip
for y in ZONES:
    loft('zone band lower', [plan(y - 1.9, .55), plan(y - 1.1, .55)], 'dark')
    loft('zone band upper', [plan(y + 1.1, .55), plan(y + 1.9, .55)], 'dark')
    loft('zone light', [plan(y - .12, .35), plan(y + .12, .35)], 'light')

# ------------------------------------------------------------------ notch lips: the steel ridge on each side
# of the groove (the photo shows the skin's support lattice along both lips).
for side in (-1, 1):
    pts = []
    for j in range(0, 130):
        y = min(j * 4.6, ROOF - .5)
        a = notch_angle(y) + side * NOTCH_HALF
        r = (R_MEAN + R_AMP*math.cos(3*NOTCH_HALF)) * scale(y) + .15
        pts.append((r*math.cos(a), y + .2, r*math.sin(a)))
    tube('notch lip', pts, .45, 'steel', 6)
# groove floor: a dark steel spine deep in the V, the lattice seen through the glass
spine = []
for j in range(0, 130):
    y = min(j*4.6, ROOF - .5)
    a = notch_angle(y); r = (R_MEAN + R_AMP)*(1 - NOTCH_DEPTH)*scale(y) + .1
    spine.append((r*math.cos(a), y + .2, r*math.sin(a)))
tube('notch spine', spine, .6, 'dark', 6)

# ------------------------------------------------------------------ base: granite sill and lobby canopies
loft('granite sill', [plan(0, 1.4), plan(1.2, 1.4)], 'granite')
for k in range(3):
    a = NOTCH0 + math.pi/3 + k*math.tau/3        # the middle of each side of the rounded triangle
    r = (R_MEAN - R_AMP) + 5
    c = (r*math.cos(a), 7.5, r*math.sin(a))
    # canopy slab turned to the side's direction: build it as a rotated box by corners
    t, n = (-math.sin(a), math.cos(a)), (math.cos(a), math.sin(a))
    corners = []
    for sy in (-.35, .35):
        for st, sn in ((-9, -5), (9, -5), (9, 5), (-9, 5)):
            corners.append((c[0] + t[0]*st + n[0]*sn, c[1] + sy, c[2] + t[1]*st + n[1]*sn))
    mesh('lobby canopy', corners, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], 'steel')
    for st in (-8, 8):
        p = (c[0] + t[0]*st + n[0]*4.2, c[2] + t[1]*st + n[1]*4.2)
        box('canopy post', (p[0], 3.6, p[1]), (.5, 7.2, .5), 'steel')

# ------------------------------------------------------------------ aviation lights on the crown's high edge
for d in (-14, 0, 14):
    a = nd + math.pi + math.radians(d)
    r = (R_MEAN + R_AMP*math.cos(3*(math.pi + math.radians(d)))) * scale(ROOF) + .25
    x, z = r*math.cos(a), r*math.sin(a)
    box('aviation light', (x, crown_top(x, z) - 1.6, z), (.8, .8, .8), 'red')

m.finish(directory=SCRATCH)
