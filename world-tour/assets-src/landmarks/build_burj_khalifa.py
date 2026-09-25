"""Burj Khalifa, Downtown Dubai (route dubai, night; the race starts at the tower's drop-off).

Sources for the numbers (marked on each constant below):
  [OSM]  way 446646206 outline in the route cache: Y plan, wing tips 88-93 m from the centroid,
         wings 25-31 m wide at the ground, three curved entrance pavilions (radius 35-41 m) in the
         crotches between the wings.
  [GWR]  828 m tip height (Guinness World Records; OSM maxheight=828), 163 floors.
  [PUB]  widely published SOM/Emaar figures: 27 spiralling setbacks, 3-storey podium, highest
         occupied floor ~585 m, mechanical floors every ~30 levels, stainless-steel vertical fins
         on reflective glazing.
  [PHOTO] measured from the reference photos (scratchpad/modelling/burj-khalifa/photos): silhouette
         width against height in two telephoto skyline views (ref00, ref05), rounded wing ends,
         the stepped, ribbed spire enclosure between ~585 m and ~760 m, needle above it.
  [EST]  estimated where neither gives a number.

Author frame: the shared Model frame (u across, y up, v along); every point is written in the
route's local east/south frame (x east, z south) and converted by P(), because the plan is a
three-fold Y whose wing bearings come straight from the OSM outline.
Run: Blender --background --python assets-src/landmarks/build_burj_khalifa.py
"""
import math
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'burj-khalifa'
SCRATCH = Path(tempfile.gettempdir()) / 'sr-landmarks' / ID

TIP = 828.0                  # [GWR]
R_PODIUM = 90.0              # wing tips of the podium at the ground [OSM 88-93 m]
PODIUM_TOP = 16.0            # 3-storey podium [PUB], storey height [EST]
B_BASE, B_TOP = 14.0, 9.5    # wing half-width: 28 m at the foot [OSM 25-31 m], narrower at the top [PHOTO]
SETBACKS = 24                # spiralling setbacks modelled (27 [PUB]; the smallest merged) --
H_LOW, H_SPAN = 45.0, 540.0  # spaced ~33 m apart low down and ~14 m near the top [PHOTO: tall
                             # cylindrical tiers below, tightly stacked steps under the spire]
CORE_TOP = 588.0             # glass of the last core stubs [PUB ~585 m top floor]
PARAPET = 3.4                # fins stand proud of each terrace [PHOTO: bright rim on every tier top]
MECH = [65.0, 155.0, 275.0, 405.0, 500.0]   # louvred mechanical floors, levels 17/41/74/110/137 [PUB]
# spire enclosure stages above the core, (radius, bottom, top) [PHOTO: widths 31/20/15/11/8 m]
STAGES = [(10.5, CORE_TOP - 2, 640.0), (8.0, 640.0, 690.0), (5.8, 690.0, 730.0), (4.0, 730.0, 762.0)]

m = Model(ID)
AC, AX = m.spec['across'], m.spec['axis']
m.material('glass', (.30, .38, .44), .6, .12, ID + '_glass')
m.material('door', (.10, .13, .15), .3, .1, ID + '_glass_door')
m.material('steel', (.76, .78, .80), .85, .28, ID + '_steel')
m.material('louvre', (.70, .64, .50), .75, .38, ID + '_steel_louvre')   # [PHOTO: pale gold bands]
m.material('spire', (.80, .81, .83), .8, .28, ID + '_steel_spire')
m.material('stone', (.80, .75, .66), 0, .72, ID + '_stone')
m.material('light', (1.0, .35, .25), 0, .4, ID + '_beacon')


def P(x, y, z):
    """East/up/south metres -> the Model's (u, y, v)."""
    return (x * AC[0] + z * AC[1], y, x * AX[0] + z * AX[1])


RING = [(u * AC[0] + v * AX[0], u * AC[1] + v * AX[1]) for u, v in m.spec['ring']]


def bearing_of(x, z): return math.degrees(math.atan2(x, -z)) % 360


# Wing bearings: circular mean of 3*bearing over the far outline points, so the three wings stay
# exactly 120 deg apart and sit on the OSM wings. Clockwise seen from above = increasing bearing.
far = [bearing_of(x, z) for x, z in RING if math.hypot(x, z) > 55]
s_ = sum(math.sin(math.radians(3 * b)) for b in far); c_ = sum(math.cos(math.radians(3 * b)) for b in far)
PHI = (math.degrees(math.atan2(s_, c_)) / 3) % 120
TH = sorted((PHI + 120 * k) % 360 for k in range(3))
print('wing bearings', [round(t, 1) for t in TH])


def dirs(theta):
    t = math.radians(theta)
    return (math.sin(t), -math.cos(t)), (math.cos(t), math.sin(t))   # along the wing, clockwise side


def half_width_at(h): return B_BASE + (B_TOP - B_BASE) * min(1.0, h / CORE_TOP)


def envelope(h):
    """Tip radius of a wing at height h, fitted so the silhouette width matches the telephoto photos
    (ref00/ref05: ~60 m across at 340 m, ~52 m at 440 m, ~33 m at 560 m, ~21 m at 610 m) [PHOTO]."""
    return 12 + 44 * max(0.0, 1 - h / 600.0) ** 0.85


def nose_len(R, b): return max(1.0, min(b, R - b / math.sqrt(3) - 0.5))


NOSE_A = [i * 90 / 8 for i in range(8)]     # the rounded wing end, sampled every 11.25 deg


def wing_outline(w, R, b):
    """Crotch before wing w, out along its anticlockwise side, round the rounded end, back."""
    d, q = dirs(TH[w]); n = nose_len(R, b); s1 = R - n
    pts = [(d[0] * b / math.sqrt(3) - q[0] * b, d[1] * b / math.sqrt(3) - q[1] * b)]
    for a in NOSE_A:
        sp, hw = s1 + n * math.sin(math.radians(a)), b * math.cos(math.radians(a))
        pts.append((d[0] * sp - q[0] * hw, d[1] * sp - q[1] * hw))
    pts.append((d[0] * R, d[1] * R))
    for a in reversed(NOSE_A):
        sp, hw = s1 + n * math.sin(math.radians(a)), b * math.cos(math.radians(a))
        pts.append((d[0] * sp + q[0] * hw, d[1] * sp + q[1] * hw))
    return pts


def outline(Rs, b):
    return [p for w in range(3) for p in wing_outline(w, Rs[w], b)]


# ---- setback schedule: the podium, then 27 steps spiralling clockwise one wing at a time -----------
steps = []
def setback_height(k):
    x = k / (SETBACKS - 1)
    return H_LOW + H_SPAN * x * (1.4 - 0.4 * x)


for k in range(SETBACKS):
    h = setback_height(k)
    stub = k >= SETBACKS - 3
    b_next = half_width_at(h + 10)
    ahead = setback_height(min(SETBACKS - 1, k + 1.5)) if k + 1.5 <= SETBACKS - 1 else h + 20
    steps.append((h, k % 3, b_next / math.sqrt(3) + b_next * .6 if stub else envelope(ahead)))
tiers = [(0.0, PODIUM_TOP, [R_PODIUM] * 3)]
Rs = [envelope(PODIUM_TOP + 30)] * 3
levels = [PODIUM_TOP] + [h for h, _, _ in steps] + [CORE_TOP]
for i in range(len(levels) - 1):
    if i > 0:
        _, w, R = steps[i - 1]; Rs = list(Rs); Rs[w] = R
    tiers.append((levels[i], levels[i + 1], list(Rs)))
tiers = [(y0, y1, R, half_width_at((y0 + y1) / 2)) for y0, y1, R in tiers]


def area_sign(poly):
    return 1 if sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1])) > 0 else -1


def inside(poly, p):
    hit = False
    for a, b in zip(poly, poly[1:] + poly[:1]):
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]):
            hit = not hit
    return hit


def prism(label, poly, y0, y1, mat):
    m.shell(label, [P(x, y0, z) for x, z in poly], (0, y1 - y0, 0), mat)


def quad_box(label, corners, y0, y1, mat):
    """Closed box over a plan quadrilateral (4 x,z corners in order)."""
    v = [P(x, y0, z) for x, z in corners] + [P(x, y1, z) for x, z in corners]
    m.mesh(label, v, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat)


def fin(label, c, out, along, y0, y1, width, depth, mat, taper=0.45):
    """A vertical stainless blade on the wall point c, pointing along the outward normal `out`: a
    tapered profile with a rounded nose, smooth-shaded so it catches a highlight like the real fins."""
    w0, w1 = width / 2, max(.05, width / 2 * taper)
    prof = [(-w0, -.12), (w0, -.12), (w0 * .9, depth * .4), (w1, depth - w1), (0, depth),
            (-w1, depth - w1), (-w0 * .9, depth * .4)]
    ring = [(c[0] + along[0] * a + out[0] * o, c[1] + along[1] * a + out[1] * o) for a, o in prof]
    n = len(ring)
    verts = [P(x, y0, z) for x, z in ring] + [P(x, y1, z) for x, z in ring]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    m.mesh(label, verts, faces, mat, True)


def walk(poly, pitch, start=0.5):
    """Points every `pitch` metres round a closed outline: (point, edge direction, outward normal)."""
    sg = area_sign(poly); acc, nxt = 0.0, pitch * start
    for a, b in zip(poly, poly[1:] + poly[:1]):
        dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz)
        if L < 1e-6: continue
        t = (dx / L, dz / L); n = (sg * t[1], -sg * t[0])
        while acc + L >= nxt:
            k = (nxt - acc) / L
            yield (a[0] + dx * k, a[1] + dz * k), t, n
            nxt += pitch
        acc += L


def edge_band(label, poly, y0, y1, o0, o1, mat):
    """A horizontal ledge/louvre along every edge of a closed outline, from o0 to o1 outside it."""
    sg = area_sign(poly)
    for a, b in zip(poly, poly[1:] + poly[:1]):
        dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz)
        if L < .3: continue
        n = (sg * dz / L, -sg * dx / L)
        quad_box(label, [(a[0] + n[0] * o0, a[1] + n[1] * o0), (b[0] + n[0] * o0, b[1] + n[1] * o0),
                         (b[0] + n[0] * o1, b[1] + n[1] * o1), (a[0] + n[0] * o1, a[1] + n[1] * o1)], y0, y1, mat)


# ---- 1. glass tiers and their fins ------------------------------------------------------------------
polys = [outline(R, b) for _, _, R, b in tiers]
for i, ((y0, y1, R, b), poly) in enumerate(zip(tiers, polys)):
    prism('podium' if i == 0 else 'tower tier', poly, y0, y1, 'glass')
    above = polys[i + 1] if i + 1 < len(polys) else None
    # fin pitch widens with height: every mullion where the car is, every third one up the shaft
    pitch = 1.6 if y0 < 150 else 2.4 if y0 < 380 else 3.2
    for c, t, n in walk(poly, pitch):
        probe = (c[0] - n[0] * 1.2, c[1] - n[1] * 1.2)
        exposed = above is None or not inside(above, probe)
        # the podium's rim is a solid coping (below), the tower terraces a crown of proud fins
        top = y1 + (PARAPET if exposed and above is not None and i > 0 else 0)
        fin('fin', c, n, t, y0, top, .44 if y0 < 150 else .6, .75 if y0 < 150 else .95, 'steel')
# podium roof: pale paving over the low wing ends, with a steel coping on its rim
prism('podium roof', outline([R_PODIUM - .3] * 3, B_BASE - .3), PODIUM_TOP - .05, PODIUM_TOP + .35, 'stone')
edge_band('podium coping', polys[0], PODIUM_TOP - .6, PODIUM_TOP + 1.1, 0, .35, 'steel')

# ---- 2. louvred mechanical floors and the podium floor lines -----------------------------------------
def tier_index(h): return next(i for i, t in enumerate(tiers) if t[0] <= h < t[1])


for h in MECH:
    poly = polys[tier_index(h)]
    edge_band('louvre backing', poly, h - .3, h + 7.6, .03, .12, 'louvre')
    for i in range(7):
        edge_band('louvre', poly, h + i * 1.05, h + i * 1.05 + .38, .12, .55, 'louvre')
for h in (4.6, 8.4, 12.2):
    edge_band('floor line', polys[0], h, h + .24, .02, .32, 'steel')

# ---- 3. spire enclosure stages, ribs and the needle --------------------------------------------------
def lathe(label, profile, mat, sides=32, smooth=False):
    verts, rings = [], []
    for r, y in profile:
        if r <= 0:
            rings.append(('apex', len(verts))); verts.append(P(0, y, 0))
        else:
            rings.append(('ring', len(verts)))
            verts += [P(r * math.cos(a), y, r * math.sin(a)) for a in [i * math.tau / sides for i in range(sides)]]
    faces = [tuple(reversed(range(rings[0][1], rings[0][1] + sides)))]
    for (k0, a), (k1, b) in zip(rings, rings[1:]):
        if k1 == 'apex':
            faces += [(a + j, a + (j + 1) % sides, b) for j in range(sides)]
        else:
            faces += [(a + j, a + (j + 1) % sides, b + (j + 1) % sides, b + j) for j in range(sides)]
    if rings[-1][0] == 'ring':
        faces.append(tuple(range(rings[-1][1], rings[-1][1] + sides)))
    m.mesh(label, verts, faces, mat, smooth)


for k, (r, y0, y1) in enumerate(STAGES):
    mat = 'glass' if k < 2 else 'spire'
    lathe('spire stage', [(r, y0), (r, y1)], mat, 40, True)
    lathe('stage collar', [(r + .6, y1 - 1.6), (r + .6, y1), (r * .72, y1 + .8)], 'steel', 40)
    nfin = 18 if k < 2 else 12
    for i in range(nfin):
        a = (i + .5 * k) * math.tau / nfin; o = (math.cos(a), math.sin(a))
        fin('stage fin', (o[0] * r, o[1] * r), o, (-o[1], o[0]), y0, y1 + 2.2, .45, .8, 'steel')
    y = y0 + 4.0
    while y < y1 - 3:                     # the horizontal ribs that make the upper shaft read ribbed
        lathe('rib', [(r + .45, y), (r + .45, y + .55)], 'steel', 32)
        y += 4.0
NEEDLE = [(2.2, 761.0), (2.0, 780.0), (2.4, 780.4), (2.4, 781.6), (1.8, 782.2), (1.6, 801.0), (2.0, 801.4),
          (2.0, 802.4), (1.2, 803.0), (1.0, 818.0), (.7, 819.0), (.35, 826.0), (0.0, TIP)]   # [PHOTO/EST]
lathe('needle', NEEDLE, 'spire', 24, True)
for y in (700.0, 745.0, 790.0, 812.0):   # aircraft warning beacons
    r = 6.0 if y < 730 else 4.3 if y < 762 else 2.3 if y < 802 else 1.3
    lathe('beacon', [(r + .35, y), (r + .35, y + .9), (0.0, y + 1.3)], 'light', 12)

# ---- 4. base: entrance pavilions in the three crotches, canopies, forecourt paving -------------------
def arc(r, b0, b1, n):
    return [(math.sin(math.radians(b)) * r, -math.cos(math.radians(b)) * r)
            for b in [b0 + (b1 - b0) * i / n for i in range(n + 1)]]


for w in range(3):
    th0, th1 = TH[w], TH[(w + 1) % 3] + (360 if w == 2 else 0)
    mid = (th0 + th1) / 2
    near = [math.hypot(x, z) for x, z in RING
            if abs((bearing_of(x, z) - mid + 180) % 360 - 180) < 22 and math.hypot(x, z) > 22]
    Rp = sorted(near)[len(near) // 2] if near else 36.0          # [OSM] pavilion radius
    a0 = th0 + math.degrees(math.asin(B_BASE / Rp)); a1 = th1 - math.degrees(math.asin(B_BASE / Rp))
    cr = dirs(mid)[0]; crotch = (cr[0] * 9.0, cr[1] * 9.0)      # a point inside the tower core
    door_half = math.degrees(7.5 / Rp); recess = 3.2; n_arc = 28
    upper = [crotch] + arc(Rp, a0, a1, n_arc)
    lower = ([crotch] + arc(Rp, a0, mid - door_half, n_arc // 2) + arc(Rp - recess, mid - door_half, mid + door_half, 8)
             + arc(Rp, mid + door_half, a1, n_arc // 2))
    prism('pavilion lower', lower, 0.0, 7.2, 'glass')
    prism('pavilion upper', upper, 7.2, 12.4, 'glass')
    prism('pavilion fascia', [crotch] + arc(Rp + .45, a0 + .4, a1 - .4, n_arc), 12.4, 13.8, 'steel')
    # canopy over the entrance: a curved slab on slim columns, its edge a steel fascia
    cb0, cb1 = mid - door_half * 2.2, mid + door_half * 2.2
    prism('canopy', arc(Rp - recess - .2, cb0, cb1, 16) + list(reversed(arc(Rp + 6.0, cb0, cb1, 16))), 7.2, 7.75, 'steel')
    for b in [cb0 + (cb1 - cb0) * i / 5 for i in range(6)]:
        p = (math.sin(math.radians(b)) * (Rp + 5.2), -math.cos(math.radians(b)) * (Rp + 5.2))
        m.tube('canopy column', [P(p[0], 0.0, p[1]), P(p[0], 7.3, p[1])], .32, 'steel', 12)
    # mullions round the drum; door mullions and transoms in the recess
    b = a0 + 1.5
    while b < a1 - 1:
        o, t_ = dirs(b)
        if abs(b - mid) < door_half:
            fin('door mullion', (o[0] * (Rp - recess), o[1] * (Rp - recess)), o, t_, 0.0, 7.2, .22, .35, 'steel', 1)
            fin('upper mullion', (o[0] * Rp, o[1] * Rp), o, t_, 7.75, 12.4, .22, .35, 'steel', 1)
            b += math.degrees(1.9 / Rp)
        else:
            fin('pavilion mullion', (o[0] * Rp, o[1] * Rp), o, t_, 0.0, 12.4, .22, .35, 'steel', 1)
            b += math.degrees(2.4 / Rp)
    rec = arc(Rp - recess + .05, mid - door_half, mid + door_half, 8)
    for y in (3.3, 6.6):
        prism('door transom', rec + list(reversed(arc(Rp - recess + .35, mid - door_half, mid + door_half, 8))),
              y, y + .18, 'steel')
    prism('door leaves', rec + list(reversed(arc(Rp - recess + .25, mid - door_half, mid + door_half, 8))),
          0.0, 3.2, 'door')
    # forecourt paving in front of the pavilion, a kerb's height above the ground
    prism('forecourt', [crotch] + arc(Rp + 8.0, a0 - 4, a1 + 4, n_arc), 0.0, .32, 'stone')

# apron of pale paving round the whole Y at the tower's foot
prism('apron', outline([R_PODIUM + 6] * 3, B_BASE + 6), 0.0, .2, 'stone')

info = m.finish(directory=SCRATCH)
