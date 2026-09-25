"""Oriental Pearl Tower (东方明珠广播电视塔), Lujiazui, Shanghai (route shanghai, seen across the Huangpu at night).

Sources (no photo is copied into the game; see the modelling report for the URLs):
- zh.wikipedia 东方明珠广播电视塔 [W-zh]: 468 m total; three reinforced-concrete cylinders 9 m in diameter,
  7 m apart, in a 品 arrangement; three 7 m braces at 60 degrees to the ground; 11 spheres; lower sphere 50 m
  at about 100 m; five 12 m middle spheres between 118 and 210 m; upper sphere at 250+ m with the 259 m glass
  corridor, 263 m deck and 267 m revolving restaurant; 16 m space module; 118 m antenna.
- en.wikipedia Oriental Pearl Tower [W-en]: top floor 351 m; spheres clad in laminated red glass.
- Commons OrientalPearl-outline.svg [SVG], an elevation silhouette scaled to 468 m: lower sphere 67-117 m,
  column bundle 24.6 m wide, upper sphere centre 273 m (45.7 m wide), shaft 10.5 m wide 294-338 m with a
  collar at 312 m, space module 336-352 m, neck to 357 m.
- Photos [P01..P13] (Commons, list in the report): node spheres on the legs with a brace down to each column
  foot, silver beads hanging under red-glass collars between the columns, the upper sphere's bowl bottom and
  glass corridor ring, triangulated red glass bands, porthole rows on the lower sphere, mast stages, podium.
- OSM way 40778038: the 24.5 m round podium and the three leg arms to 58 m (leg azimuths and feet from it).

Author frame: u across, y up, v along the footprint axis; the tower axis is the podium circle's centre.
Run: Blender --background --python assets-src/landmarks/build_oriental_pearl_tower.py
"""
import math
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'oriental-pearl-tower'
SCRATCH = Path(tempfile.gettempdir()) / 'sr-landmarks' / ID

TOP = 468.0                       # [W-zh]
COL_R = 4.5                       # 9 m cylinders [W-zh]
COL_RING = (9.0 + 7.0) / math.sqrt(3)   # centres 16 m apart (9 m + 7 m gap) [W-zh] -> 9.24 m from the axis
LEG_R = 3.5                       # 7 m braces [W-zh]
LEG_SLOPE = math.tan(math.radians(60))  # 60 degrees to the ground [W-zh]
NODE_Y, NODE_R = 37.0, 5.0        # node sphere on each leg [P03 measured against the lower sphere; P12 size]
BRACE_R = 2.5                     # node-to-column-foot brace [P12 estimate]
LOW_C, LOW_R = 92.0, 25.0         # lower sphere 50 m [W-zh], 67-117 m [SVG]
UP_C, UP_R = 273.0, 22.5          # upper sphere 45 m, centre from [SVG]
COLLARS = [121.0, 144.0, 166.0, 188.0, 210.0, 232.0]   # red-glass collars [SVG gaps, P03, P12]
BEAD_R = 6.0                      # five 12 m middle spheres [W-zh]
SPACE_C, SPACE_R = 344.0, 8.0     # 16 m space module [W-zh], 336-352 m [SVG]

m = Model(ID)
M = m.materials


def mat(key, color, metal, rough, emission=None):
    m.material(key, color, metal, rough, ID + '_' + key)
    if emission:
        node = M[key].node_tree.nodes.get('Principled BSDF')
        node.inputs['Emission Color'].default_value = (*emission, 1)
        node.inputs['Emission Strength'].default_value = 1.0


mat('concrete', (.68, .65, .60), 0, .75)            # columns, legs, shaft: floodlit white at night [P10]
mat('sphere_glass', (.52, .11, .30), .35, .18)      # laminated red glass [W-en, P07]; lit at night
mat('panel_steel', (.74, .75, .77), .75, .30)       # silver aluminium honeycomb panels [W-zh, P01]
mat('frame_steel', (.84, .85, .87), .80, .28)       # space-frame members over the glass [P07]
mat('steel_dark', (.28, .29, .31), .70, .45)        # antenna mast, ribbed transmitter section [P03]
mat('glass', (.15, .21, .23), .20, .10)             # windows, corridor, podium, elevator
mat('paint_white', (.90, .90, .88), 0, .55)
mat('paint_red', (.78, .10, .08), 0, .50)
mat('granite', (.55, .51, .48), 0, .80)
mat('light_red', (1.0, .08, .05), 0, .40, emission=(1.0, .05, .03))

# ------------------------------------------------------------------ survey: axis, legs, orientation
ring = m.spec['ring']
core = [p for p in ring if math.hypot(*p) < 30]
CU = sum(p[0] for p in core) / len(core)
CV = sum(p[1] for p in core) / len(core)
arms = [(math.atan2(p[1] - CV, p[0] - CU), math.hypot(p[0] - CU, p[1] - CV)) for p in ring
        if math.hypot(p[0] - CU, p[1] - CV) > 40]
groups = []
for a, r in sorted(arms):
    if groups and abs(math.remainder(a - groups[-1][-1][0], math.tau)) < math.radians(25):
        groups[-1].append((a, r))
    else:
        groups.append([(a, r)])
if len(groups) > 3 and abs(math.remainder(groups[0][0][0] - groups[-1][-1][0], math.tau)) < math.radians(25):
    groups[0] += groups.pop()
assert len(groups) == 3, groups
LEGS = []
for g in groups:
    a = math.atan2(sum(math.sin(x) for x, _ in g), sum(math.cos(x) for x, _ in g))
    tip = max(r for _, r in g)
    LEGS.append((a, tip - LEG_R / math.sin(math.radians(60))))   # foot centre inside the arm tip
print('axis', (round(CU, 2), round(CV, 2)), 'legs', [(round(math.degrees(a), 1), round(r, 1)) for a, r in LEGS], flush=True)


def world_to_author(x, z):
    a, b = m.spec['across'], m.spec['axis']
    return x * a[0] + z * a[1], x * b[0] + z * b[1]


def P(r, y, a):
    return (CU + r * math.cos(a), y, CV + r * math.sin(a))


# ------------------------------------------------------------------ primitives
def lathe(label, prof, material, sides=48, cu=None, cv=None, smooth=True):
    cu = CU if cu is None else cu; cv = CV if cv is None else cv
    verts = [(cu + r * math.cos(i * math.tau / sides), y, cv + r * math.sin(i * math.tau / sides))
             for r, y in prof for i in range(sides)]
    k = len(prof)
    faces = [tuple(reversed(range(sides))), tuple((k - 1) * sides + i for i in range(sides))]
    faces += [(j * sides + i, j * sides + (i + 1) % sides, (j + 1) * sides + (i + 1) % sides, (j + 1) * sides + i)
              for j in range(k - 1) for i in range(sides)]
    m.mesh(label, verts, faces, material, smooth)


def revolve(label, loop, material, sides=96, smooth=True, cu=None, cv=None):
    """A closed ring: a closed (r, y) loop swept round the axis."""
    cu = CU if cu is None else cu; cv = CV if cv is None else cv
    n = len(loop)
    verts = [(cu + r * math.cos(i * math.tau / sides), y, cv + r * math.sin(i * math.tau / sides))
             for i in range(sides) for r, y in loop]
    faces = [(i * n + j, i * n + (j + 1) % n, ((i + 1) % sides) * n + (j + 1) % n, ((i + 1) % sides) * n + j)
             for i in range(sides) for j in range(n)]
    m.mesh(label, verts, faces, material, smooth)


def sphere(label, c, R, material, seg=64, rings=40):
    cu, cy, cv = c
    verts = [(cu, cy - R, cv)]
    for j in range(1, rings):
        lat = -math.pi / 2 + j * math.pi / rings
        verts += [(cu + R * math.cos(lat) * math.cos(i * math.tau / seg), cy + R * math.sin(lat),
                   cv + R * math.cos(lat) * math.sin(i * math.tau / seg)) for i in range(seg)]
    verts.append((cu, cy + R, cv))
    top = len(verts) - 1
    faces = [(0, 1 + (i + 1) % seg, 1 + i) for i in range(seg)]
    for j in range(rings - 2):
        b = 1 + j * seg
        faces += [(b + i, b + (i + 1) % seg, b + seg + (i + 1) % seg, b + seg + i) for i in range(seg)]
    b = 1 + (rings - 2) * seg
    faces += [(b + i, b + (i + 1) % seg, top) for i in range(seg)]
    m.mesh(label, verts, faces, material, True)


def oblique(label, p0, p1, r, material, sides=40):
    """A straight cylinder cut by horizontal planes at both ends (feet sit flat on the ground)."""
    d = [p1[k] - p0[k] for k in range(3)]
    L = math.sqrt(sum(x * x for x in d)); cos_t = d[1] / L
    hx, hz = d[0], d[2]; hl = math.hypot(hx, hz) or 1.0
    hx, hz = hx / hl, hz / hl; px, pz = -hz, hx
    verts = []
    for c in (p0, p1):
        for i in range(sides):
            t = i * math.tau / sides
            a, b = r / cos_t * math.cos(t), r * math.sin(t)
            verts.append((c[0] + a * hx + b * px, c[1], c[2] + a * hz + b * pz))
    faces = [tuple(reversed(range(sides))), tuple(range(sides, 2 * sides))]
    faces += [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    m.mesh(label, verts, faces, material, True)


def stick(label, p0, p1, r, material, sides=4):
    m.tube(label, [p0, p1], r, material, sides)


def radial_box(label, a, r0, r1, y0, y1, width, material):
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for y in (y0, y1):
        for r, s in ((r0, -1), (r1, -1), (r1, 1), (r0, 1)):
            pts.append((CU + r * ca - s * width / 2 * sa, y, CV + r * sa + s * width / 2 * ca))
    m.mesh(label, pts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], material)


def band(label, cy, R, lat0, lat1, material, out=.15, depth=.5, steps=10, sides=96):
    loop = [((R + out) * math.cos(math.radians(l)), cy + (R + out) * math.sin(math.radians(l)))
            for l in [lat0 + (lat1 - lat0) * k / steps for k in range(steps + 1)]]
    loop += [((R - depth) * math.cos(math.radians(l)), cy + (R - depth) * math.sin(math.radians(l)))
             for l in [lat1 - (lat1 - lat0) * k / steps for k in range(steps + 1)]]
    revolve(label, loop, material, sides)


def lattice(label, cy, R, lat0, lat1, rows, n, material, rad=.13):
    """Triangulated space frame over a glass band: latitude rings plus alternating diagonals [P07]."""
    Rf = R + .22
    lats = [math.radians(lat0 + (lat1 - lat0) * j / rows) for j in range(rows + 1)]
    for l in lats:
        r, y = Rf * math.cos(l), cy + Rf * math.sin(l)
        revolve(label + ' ring', [(r - rad, y - rad), (r + rad, y - rad), (r + rad, y + rad), (r - rad, y + rad)],
                material, sides=n * 2, smooth=False)
    for j in range(rows):
        l0, l1 = lats[j], lats[j + 1]
        for i in range(n):
            a0 = (i + .5 * (j % 2)) * math.tau / n
            b = [(i + .5 * (j % 2) + s) * math.tau / n for s in (-.5, .5)]
            p0 = P(Rf * math.cos(l0), cy + Rf * math.sin(l0), a0)
            for a1 in b:
                stick(label, p0, P(Rf * math.cos(l1), cy + Rf * math.sin(l1), a1), rad, material)


def portholes(label, cy, R, lat, n, material):
    l = math.radians(lat)
    for i in range(n):
        a = (i + .5) * math.tau / n
        stick(label, P((R - .3) * math.cos(l), cy + (R - .3) * math.sin(l), a),
              P((R + .12) * math.cos(l), cy + (R + .12) * math.sin(l), a), .55, material, 12)


def outline_poly(d_gap, d_cut, grow=0.0):
    """Collar plan: triangle whose sides face the gaps between columns, corners cut behind the columns."""
    a0 = LEGS[0][0]
    lines = [(a0 + k * math.pi / 3, (d_cut if k % 2 == 0 else d_gap) + grow) for k in range(6)]
    pts = []
    for (t1, d1), (t2, d2) in zip(lines, lines[1:] + lines[:1]):
        det = math.cos(t1) * math.sin(t2) - math.sin(t1) * math.cos(t2)
        x = (d1 * math.sin(t2) - d2 * math.sin(t1)) / det
        z = (math.cos(t1) * d2 - math.cos(t2) * d1) / det
        pts.append((CU + x, CV + z))
    return pts


def prism(label, pts, y0, y1, material):
    m.shell(label, [(u, y0, v) for u, v in pts], (0, y1 - y0, 0), material)


# ------------------------------------------------------------------ podium (0 m hall) [OSM circle, P01, P09, P12]
lathe('podium plinth', [(25.0, 0), (25.0, .5)], 'granite', 96)
lathe('podium glass wall', [(23.6, .5), (23.6, 5.2)], 'glass', 96, smooth=False)
revolve('court glass wall', [(15.0, .5), (15.4, .5), (15.4, 5.2), (15.0, 5.2)], 'glass', 72, smooth=False)
for i in range(64):
    radial_box('podium mullion', i * math.tau / 64, 23.5, 23.85, .5, 5.2, .22, 'frame_steel')
revolve('podium roof', [(15.2, 5.2), (24.7, 5.2), (24.7, 6.6), (15.2, 6.6)], 'paint_white', 96)
revolve('podium parapet', [(24.1, 6.6), (24.8, 6.6), (24.8, 7.3), (24.1, 7.3)], 'paint_white', 96)
revolve('court parapet', [(15.2, 6.6), (15.8, 6.6), (15.8, 7.1), (15.2, 7.1)], 'paint_white', 72)
for i in range(9):                                   # oval skylights in the white roof ring [P09]
    a = (i + .5) * math.tau / 9
    ca, sa = math.cos(a), math.sin(a)
    pts = [(CU + (20.0 + 2.6 * math.cos(t)) * ca - 1.5 * math.sin(t) * sa, 6.6,
            CV + (20.0 + 2.6 * math.cos(t)) * sa + 1.5 * math.sin(t) * ca)
           for t in [k * math.tau / 20 for k in range(20)]]
    m.shell('skylight', pts, (0, .35, 0), 'glass')

# Entrance canopy: a sloped glass roof out along the leg that points south-east [P01, P09].
se = world_to_author(1 / math.sqrt(2), 1 / math.sqrt(2))
se_a = math.atan2(se[1], se[0])
ca_leg = min(LEGS, key=lambda L: abs(math.remainder(L[0] - se_a, math.tau)))[0]
cn, cs = (math.cos(ca_leg), math.sin(ca_leg)), (-math.sin(ca_leg), math.cos(ca_leg))


def cp(r, s, y):
    return (CU + r * cn[0] + s * cs[0], y, CV + r * cn[1] + s * cs[1])


# Trapezoid in plan, 26 m wide at the podium and 38 m at the front, glass roof falling 9 m -> 6 m [P01 vs podium].
rows = [[cp(22.0 + 16.0 * j / 6, (-13.0 - 6.0 * j / 6) * (1 - i / 4), 9.0 - 3.0 * j / 6)
         for i in range(9)] for j in range(7)]
m.patch('entrance canopy', rows, (0, -.25, 0), 'glass')
for i in range(9):
    stick('canopy rib', rows[0][i], rows[-1][i], .12, 'frame_steel')
for s in (-18.0, -9.0, 0.0, 9.0, 18.0):
    stick('canopy post', cp(37.6, s, 0), cp(37.6, s, 5.8), .22, 'frame_steel', 8)
stick('canopy fascia', rows[-1][0], rows[-1][-1], .25, 'frame_steel')

# ------------------------------------------------------------------ columns, legs, braces, nodes
for a, _ in LEGS:
    lathe('column', [(COL_R, 0), (COL_R, UP_C - 12)], 'concrete', 48, CU + COL_RING * math.cos(a), CV + COL_RING * math.sin(a))
lathe('elevator shaft', [(2.8, .5), (2.8, 70)], 'glass', 24, smooth=False)
for a, foot in LEGS:
    top_y = (foot - COL_RING) * LEG_SLOPE
    oblique('leg', P(foot, 0, a), P(COL_RING, top_y, a), LEG_R, 'concrete')
    lathe('leg footing', [(5.4, 0), (5.4, .6), (4.4, 1.4)], 'granite', 32, *P(foot, 0, a)[::2])
    node_r = foot - NODE_Y / LEG_SLOPE
    sphere('leg node sphere', P(node_r, NODE_Y, a), NODE_R, 'panel_steel', 40, 28)
    oblique('brace', P(COL_RING + COL_R - .4, 0, a), P(node_r, NODE_Y, a), BRACE_R, 'concrete', 32)

# ------------------------------------------------------------------ lower sphere [W-zh 50 m, SVG, P01, P12]
sphere('lower sphere', (CU, LOW_C, CV), LOW_R, 'panel_steel', 96, 64)
band('lower sphere upper glass', LOW_C, LOW_R, 9, 30, 'sphere_glass')
band('lower sphere lower glass', LOW_C, LOW_R, -20, 5, 'sphere_glass')
band('lower sphere deck ring', LOW_C, LOW_R, 5, 9, 'panel_steel', out=.9, depth=.4, steps=3)
lattice('lower sphere frame', LOW_C, LOW_R, 9, 30, 4, 48, 'frame_steel')
lattice('lower sphere frame', LOW_C, LOW_R, -20, 5, 5, 48, 'frame_steel')
portholes('lower sphere portholes', LOW_C, LOW_R, 36, 40, 'sphere_glass')
portholes('lower sphere portholes', LOW_C, LOW_R, -30, 40, 'sphere_glass')

# ------------------------------------------------------------------ collars and beads between the spheres [P03, P12]
for k, yc in enumerate(COLLARS):
    prism('collar slab', outline_poly(8.0, 12.0, .3), yc - 2.2, yc - 1.4, 'panel_steel')
    prism('collar glass', outline_poly(8.0, 12.0, -.2), yc - 1.4, yc + 1.2, 'sphere_glass')
    prism('collar top', outline_poly(8.0, 12.0, .3), yc + 1.2, yc + 1.9, 'panel_steel')
    poly = outline_poly(8.0, 12.0, .15)
    rail = [(u, yc + 2.9, v) for u, v in poly]
    for p, q in zip(rail, rail[1:] + rail[:1]):
        stick('collar railing', p, q, .06, 'frame_steel')
    for u, v in poly:
        stick('collar railing post', (u, yc + 1.9, v), (u, yc + 2.9, v), .06, 'frame_steel')
    if k:                                           # the lowest collar sits on the lower sphere, no bead
        # A 12 m bead whose lower half tapers like a drop under the collar [P08, P12]; top hidden in the collar.
        drop = [(.9, -10.2), (2.4, -9.2), (3.9, -7.4), (5.1, -5.0), (5.8, -2.6), (BEAD_R, 0.0), (5.7, 1.9),
                (4.8, 3.6), (3.2, 4.9)]
        lathe('middle bead sphere', [(r, yc - 7.0 + y) for r, y in drop], 'panel_steel', 48)

# ------------------------------------------------------------------ upper sphere [SVG, P07]
prof = [(6.0, -22.4), (12.0, -21.9), (15.3, -19.5), (18.2, -15.6), (19.8, -11.5), (20.3, -8.7), (20.3, -5.9)]
lat0 = math.degrees(math.asin(-5.8 / UP_R))
lat_top = math.degrees(math.acos(5.3 / UP_R))
prof += [(UP_R * math.cos(math.radians(l)), UP_R * math.sin(math.radians(l)))
         for l in [lat0 + (lat_top - lat0) * k / 40 for k in range(41)]]
lathe('upper sphere', [(r, UP_C + y) for r, y in prof], 'panel_steel', 96)
band('upper sphere red glass', UP_C, UP_R, 0, 74, 'sphere_glass', steps=24)
band('upper sphere windows', UP_C, UP_R, -5.2, 0, 'glass', out=.12, steps=3)
lattice('upper sphere frame', UP_C, UP_R, 0, 74, 12, 48, 'frame_steel')
revolve('glass corridor', [(19.6, UP_C - 8.7), (20.9, UP_C - 8.7), (20.9, UP_C - 5.95), (19.6, UP_C - 5.95)], 'glass', 96, False)
revolve('corridor floor', [(19.8, UP_C - 9.4), (21.2, UP_C - 9.4), (21.2, UP_C - 8.7), (19.8, UP_C - 8.7)], 'panel_steel', 96)
for i in range(72):
    radial_box('corridor mullion', i * math.tau / 72, 20.8, 21.05, UP_C - 8.7, UP_C - 5.95, .14, 'frame_steel')

# ------------------------------------------------------------------ shaft, space module, antenna [SVG, P03, P07, P09]
lathe('upper shaft', [(5.7, UP_C + 18), (5.7, 296.5), (5.2, 300), (5.0, 336), (4.8, SPACE_C)], 'concrete', 48)
# Short plain neck, crown collar at ~306 m, then the dark ribbed section to the space module [P09, ref13].
revolve('shaft crown collar', [(4.9, 305.0), (7.0, 305.7), (7.0, 306.7), (4.9, 307.1)], 'panel_steel', 64)
for i in range(32):
    a = i * math.tau / 32
    stick('crown spoke', P(6.8, 306.7, a), P(8.4, 308.6, a), .07, 'frame_steel')
lathe('transmitter section', [(5.25, 308), (5.25, 334)], 'steel_dark', 48)
for i in range(28):
    radial_box('transmitter fin', i * math.tau / 28, 5.0, 5.75, 308.3, 333.7, .35, 'frame_steel')
revolve('transmitter band', [(4.9, 334), (5.6, 334), (5.6, 335), (4.9, 335)], 'panel_steel', 48)

sphere('space module', (CU, SPACE_C, CV), SPACE_R, 'panel_steel', 64, 40)
band('space module glass', SPACE_C, SPACE_R, -6, 62, 'sphere_glass', steps=16, sides=64)   # red upper half [ref13, P03]
lattice('space module frame', SPACE_C, SPACE_R, -6, 62, 6, 24, 'frame_steel', rad=.1)
band('space module deck ring', SPACE_C, SPACE_R, -24, -19, 'panel_steel', out=1.2, depth=.5, steps=3, sides=64)
lathe('neck', [(5.3, 350.5), (5.3, 355.3), (3.0, 357.0)], 'panel_steel', 48)

# Stage widths from P03/P09 against the 16 m space module: ~6 m, ~3.4 m, ~1.4 m.
lathe('mast lower', [(2.9, 356), (2.7, 390)], 'steel_dark', 24)
for y in range(359, 390, 3):
    revolve('mast lower ring', [(2.6, y), (3.15, y), (3.15, y + .5), (2.6, y + .5)], 'frame_steel', 24, False)
revolve('mast platform', [(2.0, 389.4), (4.2, 389.4), (4.2, 390.5), (2.0, 390.5)], 'panel_steel', 32)
lathe('mast middle', [(1.7, 390), (1.55, 427)], 'steel_dark', 20)
for y in range(393, 426, 3):
    revolve('mast middle ring', [(1.45, y), (1.9, y), (1.9, y + .45), (1.45, y + .45)], 'frame_steel', 20, False)
revolve('mast upper platform', [(1.0, 426.6), (2.4, 426.6), (2.4, 427.5), (1.0, 427.5)], 'panel_steel', 24)
lathe('mast upper', [(.8, 427), (.5, 457)], 'paint_white', 16)
y = 457.0
for k in range(8):                                  # red-and-white aviation bands at the tip [P12]
    r0, r1 = .5 - .02 * k, .5 - .02 * (k + 1)
    lathe('mast tip band', [(r0, y), (r1, y + 1.25)], 'paint_red' if k % 2 == 0 else 'paint_white', 16)
    y += 1.25
lathe('beacon', [(.34, 467.0), (.34, 467.6), (.12, TOP)], 'light_red', 12)

info = m.finish(directory=SCRATCH)
