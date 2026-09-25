"""Jin Mao Tower (金茂大厦), Lujiazui -- seen across the Huangpu from the Bund (route shanghai, night).

A modern pagoda: a 16-storey base block and fifteen more segments that step back and shorten as they rise,
a stepped crown of steel frames (the five spire floors, brightly lit at night) and a 35 m spire.

Sources (report data/ and photos/; photos for comparison only):
- 420.5 m to the spire tip, spire 35 m, so the crown ends at 385.5 m ("roof" in the Wikipedia infobox);
  88 floors + 5 spire floors; 88F skywalk ~340 m; office floors 4.0 m floor-to-floor (floors 1-50) --
  Wikipedia "Jin Mao Tower". The data card's "420.5 m to roof + 35 m antenna" double-counts the spire.
- Segment rhythm: "16 segments, each 1/8 shorter than the 16-storey base" read as floors 16, 14, 12, 10,
  8, 6, 4, 2 and then seven more 2-floor segments: 16+14+12+10+8+6+4+2+2x8 = 88 floors, which is the tower's
  real floor count (the reading that closes on 88 is the one used).
- Base plan = OSM way 376075961: a 54 m square tower with four 18 m-wide entrance wings on its axes.
- Stepped-corner plan, mega-column lines, fine vertical fins, the small eave at each setback and the crown
  of pointed steel frames: Commons "Jin Mao Tower Close-Up.jpg", "20090426 5223 Shanghai SWFC.jpg",
  "3 main Shanghai Tower 11-08-2018.jpg"; night: "2014.11.15.191355 ... night" (body dark with scattered
  lit windows, crown bright white) -> `_glass` body, crown frames in `_light`.

Author frame: route east/south metres about the footprint centroid (the plan is axis-aligned).
Run: Blender --background --python assets-src/landmarks/build_jin_mao_tower.py
"""
import math
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'jin-mao-tower'
SCRATCH = Path(tempfile.gettempdir()) / 'sr-landmarks' / ID

CX, CZ = -0.9, -0.15        # OSM: the tower square's centre relative to the footprint centroid
FLOORS = [16, 14, 12, 10, 8, 6, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2]   # segment floor counts (sum 88)
HALF = [27.1, 26.7, 26.3, 25.8, 25.2, 24.6, 23.9, 23.2, 22.5, 21.8, 21.1, 20.4, 19.7, 19.0, 18.3, 17.6]
# ^ OSM 54.2 m base; top segment ~0.65 of the base (photo estimate "20090426 5223", the taper speeding up)
CROWN_BASE = 340.0          # 88F skywalk level
CROWN_TOP = 385.5           # Wikipedia: 420.5 - 35 m spire
TIP = 420.5


def floor_height(n):
    """Top of floor n (1-based): 4.1 m floors to 50 (4.0 m + taller lobby), 3.55 m hotel floors to 88."""
    return 4.1*n if n <= 50 else 205.0 + (n - 50) * (CROWN_BASE - 205.0) / 38


m = Model(ID)
AX, AC = m.spec['axis'], m.spec['across']


def W(e, y, s):
    e, s = e + CX, s + CZ
    return (e*AC[0] + s*AC[1], y, e*AX[0] + s*AX[1])


def mesh(label, verts, faces, mat, smooth=False):
    m.mesh(label, [W(*v) for v in verts], faces, mat, smooth)


HEX = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def box(label, c, size, mat):
    mesh(label, [(c[0]+sx*size[0]/2, c[1]+sy*size[1]/2, c[2]+sz*size[2]/2)
                 for sy in (-1, 1) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))], HEX, mat)


def span(label, y0, y1, e0, e1, s0, s1, mat):
    box(label, ((e0+e1)/2, (y0+y1)/2, (s0+s1)/2), (abs(e1-e0), y1-y0, abs(s1-s0)), mat)


def prism(label, loop, y0, y1, mat, top_loop=None):
    """Closed prism (or frustum) from a plan loop [(e, s)...] -- fan caps from the centroid."""
    top_loop = top_loop or loop
    n = len(loop)
    verts = [(e, y0, s) for e, s in loop] + [(e, y1, s) for e, s in top_loop]
    faces = [(i, (i+1) % n, n+(i+1) % n, n+i) for i in range(n)]
    for base, y, lp, flip in ((0, y0, loop, True), (n, y1, top_loop, False)):
        c = len(verts); verts.append((sum(p[0] for p in lp)/n, y, sum(p[1] for p in lp)/n))
        for i in range(n):
            f = (base+i, base+(i+1) % n, c); faces.append(tuple(reversed(f)) if flip else f)
    mesh(label, verts, faces, mat)


def stepped(w, c=None):
    """Square of half-width w with each corner cut back in two steps (the Jin Mao plan), counter-clockwise."""
    c = c if c is not None else .11*w
    q = []
    corner = [(w, w-2*c), (w-c, w-2*c), (w-c, w-c), (w-2*c, w-c), (w-2*c, w)]
    for k in range(4):
        for x, z in corner:
            for _ in range(k): x, z = -z, x
            q.append((x, z))
    return q


def grow(loop, g):
    """Offset an axis-aligned stepped loop outward by g (every edge is axis-parallel)."""
    return [(x + math.copysign(g, x), z + math.copysign(g, z)) for x, z in loop]


def tube(label, pts, r, mat, sides=6):
    m.tube(label, [W(*p) for p in pts], r, mat, sides)


m.material('glass', (.34, .34, .33), .6, .18, ID + '_glass')      # glass behind a silver-grey metal grid
m.material('steel', (.66, .66, .63), .85, .3, ID + '_steel')        # stainless/aluminium lattice and fins
m.material('gold', (.62, .52, .34), .9, .3, ID + '_steel_gold')     # the warm mega-column lines (photo)
m.material('dark', (.12, .13, .14), .6, .45, ID + '_steel_dark')
m.material('granite', (.46, .42, .38), 0, .6, ID + '_granite')
m.material('lattice', (.62, .62, .60), .6, .4, ID + '_light_lattice')
lat = m.materials['lattice'].node_tree.nodes.get('Principled BSDF')
lat.inputs['Emission Color'].default_value = (1.0, .95, .85, 1)
lat.inputs['Emission Strength'].default_value = .45
m.material('light', (.95, .93, .86), .2, .4, ID + '_light')
lamp = m.materials['light'].node_tree.nodes.get('Principled BSDF')
lamp.inputs['Emission Color'].default_value = (1.0, .95, .85, 1)
lamp.inputs['Emission Strength'].default_value = .9
m.material('red', (.9, .05, .04), 0, .4, ID + '_light_red')
red = m.materials['red'].node_tree.nodes.get('Principled BSDF')
red.inputs['Emission Color'].default_value = (1, .05, .03, 1)
red.inputs['Emission Strength'].default_value = 2.0

# ------------------------------------------------------------------ segments
tops, floor = [], 0
for n in FLOORS:
    floor += n; tops.append(floor_height(floor))
bottoms = [0.0] + tops[:-1]
for k, (y0, y1, w) in enumerate(zip(bottoms, tops, HALF)):
    loop = stepped(w)
    prism('segment glass', loop, y0, y1, 'glass')
    # pagoda eave: a thin flared ledge at the head of the segment, stepping out 0.9 m
    prism('segment eave', grow(loop, .5), y1 - 1.5, y1 - .6, 'steel', grow(loop, 1.4))
    prism('segment eave cap', grow(loop, 1.4), y1 - .6, y1, 'steel')
    # mega-column lines: two per face, 1.6 m wide, 0.5 m proud (the gold lines in the close-up)
    for side in range(4):
        for t in (-.36, .36):
            e0, s0 = w + .25, t*w
            pts = [(e0, s0)]
            for _ in range(side): pts = [(-z, x) for x, z in pts]
            (x, z), = pts
            size = (1.0, y1 - y0 - 1.3, 1.6) if side % 2 == 0 else (1.6, y1 - y0 - 1.3, 1.0)
            box('mega-column line', (x, (y0 + y1 - 1.3)/2, z), size, 'gold')
    # fine vertical fins every ~3.2 m across each face and on the corner steps (the metal lattice)
    wf = w - 2*.11*w
    nfin = max(2, int(2*wf / 3.2))
    for side in range(4):
        for i in range(nfin + 1):
            t = -wf + i * 2*wf / nfin
            if any(abs(t - c*w) < 1.4 for c in (-.36, .36)):
                continue
            pts = [(w + .3, t)]
            for _ in range(side): pts = [(-z, x) for x, z in pts]
            (x, z), = pts
            size = (.6, y1 - y0 - 1.3, .28) if side % 2 == 0 else (.28, y1 - y0 - 1.3, .6)
            box('facade fin', (x, (y0 + y1 - 1.3)/2, z), size, 'steel')
        # corner step fins: one on each of the two step faces at the corner
        for (fx, fz) in ((w - .11*w + .15, w - 1.5*.11*w), (w - 1.5*.11*w, w - .11*w + .15)):
            pts = [(fx, fz)]
            for _ in range(side): pts = [(-z, x) for x, z in pts]
            (x, z), = pts
            box('corner fin', (x, (y0 + y1 - 1.3)/2, z), (.3, y1 - y0 - 1.3, .3), 'steel')
    # band of spandrel between floors every 4 floors on the big segments: horizontal lattice rails
    if y1 - y0 > 20:
        y = y0 + 16.4
        while y < y1 - 4:
            prism('lattice rail', grow(loop, .15), y, y + .5, 'steel')
            y += 16.4

# ------------------------------------------------------------------ crown: stepped frames round a dark core
CROWN = [(340.0, 16.6), (348.0, 14.6), (355.0, 12.6), (361.5, 10.6), (367.5, 8.6), (373.0, 6.6), (378.5, 4.8),
         (383.0, 3.2)]
for (y0, w0), (y1, w1) in zip(CROWN, CROWN[1:] + [(CROWN_TOP, 2.4)]):
    # each tier: a vertical lattice lantern set in from a ledge, with posts at the corner steps that end in
    # spikes above the ledge of the next tier -- the stepped, pointed crown of the photos
    loop = stepped(w0)
    prism('crown ledge', grow(loop, .3), y0, y0 + .8, 'steel')
    prism('crown lantern', stepped(w0 - 1.4), y0 + .8, y1, 'lattice')
    for a, b in zip(loop, loop[1:] + loop[:1]):
        if math.hypot(b[0]-a[0], b[1]-a[1]) < .3: continue
        tube('crown rail', [(a[0], y0 + 1.0, a[1]), (b[0], y0 + 1.0, b[1])], .2, 'light', 4)
    for x, z in loop[::5] + loop[2::5] + loop[4::5]:
        tube('crown post', [(x, y0 + .8, z), (x, y1 - .2, z)], .22, 'light', 4)
        mesh('crown spike', [(x-.35, y1 - .2, z-.35), (x+.35, y1 - .2, z-.35), (x+.35, y1 - .2, z+.35), (x-.35, y1 - .2, z+.35),
                             (x*1.03, y1 + 2.8, z*1.03)],
             [(0, 3, 2, 1), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], 'light')
    # lattice rails across the lantern faces (two per tier)
    for f in (.4, .75):
        prism('crown lattice rail', grow(stepped(w0 - 1.4), .15), y0 + .8 + f*(y1 - y0 - .8), y0 + 1.1 + f*(y1 - y0 - .8), 'light')

# top finial: a cluster of curved blades round the spire's foot (the "lotus" in the night photo)
for k in range(8):
    a = k * math.tau / 8 + math.pi/8
    pts = [(1.8*math.cos(a), CROWN_TOP, 1.8*math.sin(a))]
    for j in range(1, 7):
        t = j / 6
        r = 1.8 + 2.4*math.sin(t*math.pi*.8)
        pts.append((r*math.cos(a), CROWN_TOP + t*12, r*math.sin(a)))
    tube('finial blade', pts, .32, 'light', 5)
# spire: tapering mast with rings
prof = [(1.5, CROWN_TOP), (1.3, 395.0), (1.0, 402.0), (.7, 410.0), (.35, 417.0), (.12, TIP)]
for (r0, y0), (r1, y1) in zip(prof, prof[1:]):
    prism('spire', [(r0*math.cos(i*math.tau/8), r0*math.sin(i*math.tau/8)) for i in range(8)], y0, y1, 'steel',
          [(r1*math.cos(i*math.tau/8), r1*math.sin(i*math.tau/8)) for i in range(8)])
for y, r in ((392.0, 2.0), (399.0, 1.7), (406.0, 1.3)):
    prism('spire ring', [(r*math.cos(i*math.tau/12), r*math.sin(i*math.tau/12)) for i in range(12)], y, y + .8, 'steel')
box('aviation light', (0, TIP - 1.2, 0), (.5, .6, .5), 'red')

# ------------------------------------------------------------------ ground: granite base course and the four
# entrance wings on the OSM outline (two storeys, glass between granite piers, a flat steel canopy)
prism('granite base course', grow(stepped(HALF[0]), .4), 0, 6.0, 'granite')
WINGS = [((26.2, 45.8), (-9.1, 9.1)), ((-43.2, -28.0), (-9.1, 9.3)), ((-9.5, 8.6), (26.9, 47.3)), ((-9.5, 8.6), (-47.2, -27.2))]
for (e0, e1), (s0, s1) in WINGS:
    e0 -= CX; e1 -= CX; s0 -= CZ; s1 -= CZ          # OSM coordinates are about the centroid; W adds CX/CZ back
    span('wing glass', 0, 11.0, e0 + .6, e1 - .6, s0 + .6, s1 - .6, 'glass')
    span('wing roof', 11.0, 12.2, e0, e1, s0, s1, 'granite')
    span('wing canopy', 8.2, 8.8, e0 - 3, e1 + 3, s0 - 3, s1 + 3, 'steel')
    # granite piers at the four corners
    for pe in (e0 + .6, e1 - .6):
        for ps in (s0 + .6, s1 - .6):
            box('wing pier', (pe, 5.5, ps), (1.4, 11.0, 1.4), 'granite')

m.finish(directory=SCRATCH)
