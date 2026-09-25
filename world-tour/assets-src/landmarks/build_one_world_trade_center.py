"""One World Trade Center, Lower Manhattan (route new-york). Redone from reference photos.

Sources (full list in the modelling report): Architectural Record (base 187 ft x 200 ft, 50 ft lobby,
top square 150 ft turned 45 degrees, parapet 1,362-1,368 ft, 65 ft tall x 125 ft diameter lattice ring at the
mast foot, mast in stacked sections, 5 ft x 13 ft 4 in glazing units); ADF Group (mast bottom section 5.5 m
diameter); Wikipedia (33 ft 4 in parapet, ~4,000 angled glass fins 13 ft tall on 8 in stainless strips,
tip 1,776 ft); Commons photographs for everything marked "photo estimate".

What the photos changed (see report): the podium is clad in wide glass panels angled a few degrees off the
wall in V pairs that flip every row (not deep louvre blades); the lobby is a 50 ft glazed band with a
cantilevered stainless canopy and bollards at the entrances; the spire rises from a 38 m, 20 m tall DARK
lattice ring (three decks with trusses between) and is a dark banded mast with a flared foot, eight guy
cables to a wide anchor platform, five platforms, a white section and a silver spear tip; the top square is
150 ft (not 141 ft) and the crease edges run to the very top of the parapet; mechanical floors show as dark
louvre bands on the four inverted facets.

Author frame: u across, y up, v along the footprint axis. +u faces NNE (Vesey St), -v faces WNW (West St).
No text, no logos. Openings: none are driven through.
Run: Blender --background --python assets-src/landmarks/build_one_world_trade_center.py
"""
import math
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'one-world-trade-center'
SCRATCH = Path(tempfile.gettempdir()) / 'sr-landmarks' / ID

FT = 0.3048
H = 100 * FT                  # 200 ft square base (official)
PODIUM_TOP = 187 * FT         # 57.0 m podium (Architectural Record)
Y0 = 58.0                     # facets start above a 1 m reveal (photo estimate)
YT = 1368 * FT                # 417.0 m parapet top = where the facets end (official)
YR = YT - (33 + 4/12) * FT    # 406.8 m roof slab: parapet is 33 ft 4 in (Wikipedia)
D = 150 * FT / math.sqrt(2)   # top square 150 ft a side, turned 45 deg -> half-diagonal 32.3 m (Arch. Record)
TIP = 1776 * FT               # 541.3 m
LOBBY_TOP = 50 * FT           # 15.24 m lobby (Architectural Record)
LOBBY_HALF = 12.5             # the lobby portal is ~25 m wide, 8 cable-net bays (photo ref13, estimate)
MECH0, MECH1 = 360.0, 388.0   # mechanical floors: unlit band at dusk (ref03), louvres (2021 photo) - estimate
MOD = 5 * FT                  # 1.524 m curtain wall / fin module (official IGU width)
FLOOR = (13 + 4/12) * FT      # 4.064 m panel height (official)
FIN_Y0, FIN_Y1, FIN_ROWS = 1.2, 55.6, 14   # rows of 13 ft fins over a granite base course
FIN_PITCH = (FIN_Y1 - FIN_Y0) / FIN_ROWS
CORE = 29.9                   # dark stainless backing the fins stand on
RING_R, RING_Y1 = 125 * FT / 2, YR + 65 * FT   # lattice ring 125 ft dia, 65 ft tall (Arch. Record)


def add(a, b): return tuple(x + y for x, y in zip(a, b))
def sub(a, b): return tuple(x - y for x, y in zip(a, b))
def mul(a, k): return tuple(x * k for x in a)
def dot(a, b): return sum(x * y for x, y in zip(a, b))
def norm(a):
    length = math.sqrt(dot(a, a)); return tuple(x / length for x in a)
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


HEX = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]


def obox(m, label, c, axes, half, mat):
    (a1, a2, a3), (e1, e2, e3) = axes, half
    verts = []
    for s3 in (-1, 1):
        for s1, s2 in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(add(add(add(c, mul(a1, s1*e1)), mul(a2, s2*e2)), mul(a3, s3*e3)))
    m.mesh(label, verts, HEX, mat)


def strip(m, label, p0, p1, side, normal, width, depth, mat, lift=0.0):
    """A box on a surface: along p0->p1, `width` across `side`, standing `depth` out along `normal`."""
    along = sub(p1, p0); length = math.sqrt(dot(along, along))
    if length < .05: return
    c = add(mul(add(p0, p1), .5), mul(normal, lift + depth/2))
    obox(m, label, c, (mul(along, 1/length), side, normal), (length/2, width/2, depth/2), mat)


def ybox(m, label, u0, u1, y0, y1, v0, v1, mat):
    m.box(label, ((u0+u1)/2, (y0+y1)/2, (v0+v1)/2), (u1-u0, y1-y0, v1-v0), mat)


def fbox(m, label, q, n0, n1, y0, y1, t0, t1, mat):
    """Axis box on face q: n = distance out from the centre, t = along the face."""
    a, b = rot(n0, t0, q), rot(n1, t1, q)
    ybox(m, label, min(a[0], b[0]), max(a[0], b[0]), y0, y1, min(a[1], b[1]), max(a[1], b[1]), mat)


def prism(m, label, bottom, top, mat):
    n = len(bottom)
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))] + [(i, (i+1) % n, n+(i+1) % n, n+i) for i in range(n)]
    m.mesh(label, list(bottom)+list(top), faces, mat)


def ring(m, label, outer, inner, y0, y1, mat):
    """Closed annulus between two plan loops (u, v) of equal length."""
    n = len(outer)
    v = [(p[0], y0, p[1]) for p in outer] + [(p[0], y1, p[1]) for p in outer] + \
        [(p[0], y0, p[1]) for p in inner] + [(p[0], y1, p[1]) for p in inner]
    ob, ot, ib, it = 0, n, 2*n, 3*n
    f = []
    for i in range(n):
        j = (i+1) % n
        f += [(ob+i, ob+j, ot+j, ot+i), (ib+j, ib+i, it+i, it+j), (ot+i, ot+j, it+j, it+i), (ob+j, ob+i, ib+i, ib+j)]
    m.mesh(label, v, f, mat)


def circle(r, n, phase=0.0):
    return [(r*math.cos(phase + i*math.tau/n), r*math.sin(phase + i*math.tau/n)) for i in range(n)]


def lathe(m, label, profile, sides, mat, cu=0.0, cv=0.0, phase=0.0, smooth=True):
    """Closed solid of revolution about a vertical axis; profile = [(radius, y), ...] bottom to top."""
    verts = [(cu + r*math.cos(phase + i*math.tau/sides), y, cv + r*math.sin(phase + i*math.tau/sides))
             for r, y in profile for i in range(sides)]
    k = len(profile)
    faces = [tuple(reversed(range(sides))), tuple((k-1)*sides + i for i in range(sides))]
    faces += [(j*sides+i, j*sides+(i+1) % sides, (j+1)*sides+(i+1) % sides, (j+1)*sides+i) for j in range(k-1) for i in range(sides)]
    m.mesh(label, verts, faces, mat, smooth)


def rot(u, v, quarter):
    """Rotate a plan point by quarter turns: every face of the tower is the same."""
    for _ in range(quarter % 4): u, v = -v, u
    return u, v


def rot3(p, quarter):
    u, v = rot(p[0], p[2], quarter); return (u, p[1], v)


m = Model(ID)
print('footprint bounds', m.spec['bounds'], flush=True)
m.material('glass', (.13, .22, .33), .45, .07, ID + '_glass')            # blue mirror glass (photos)
m.material('fin', (.46, .52, .57), .45, .10, ID + '_glass_fin')           # silvery grey podium glass (photos)
m.material('concrete', (.46, .46, .44), 0, .85, ID + '_concrete')
m.material('granite', (.60, .60, .58), 0, .55, ID + '_granite')
m.material('steel', (.74, .75, .77), .85, .28, ID + '_steel')
m.material('mullion', (.36, .40, .44), .8, .35, ID + '_steel_mullion')   # thin, reads as a faint grid (photos)
m.material('dark', (.10, .11, .12), .6, .5, ID + '_steel_dark')
m.material('louvre', (.07, .08, .09), .5, .55, ID + '_louvre')
m.material('mech', (.13, .22, .33), .45, .07, ID + '_mechanical_glazing')   # same glass by day, no lit windows at night
m.material('spire', (.17, .18, .18), .55, .5, ID + '_steel_spire')     # the mast reads near black (photos)
m.material('white', (.86, .87, .87), 0, .45, ID + '_paint_white')
m.material('light', (1.0, .98, .94), 0, .4, ID + '_light')
lamp = m.materials['light'].node_tree.nodes.get('Principled BSDF')
lamp.inputs['Emission Color'].default_value = (1.0, .97, .92, 1)
lamp.inputs['Emission Strength'].default_value = 1.0

WEST, VESEY = 3, 0            # face index: q=0 -> +u (NNE, Vesey St), q=3 -> -v (WNW, West St)

# ================================================================ podium (0 - 57 m)
ybox(m, 'podium core', -CORE, CORE, 0, FIN_Y1, -CORE, CORE, 'dark')
ybox(m, 'podium coping', -H - .05, H + .05, FIN_Y1, PODIUM_TOP, -H - .05, H + .05, 'steel')   # light band (photos)
ybox(m, 'podium reveal', -29.7, 29.7, PODIUM_TOP, Y0, -29.7, 29.7, 'dark')
for k in range(3):                                   # louvred reveal between podium and tower
    for q in range(4):
        y = PODIUM_TOP + .2 + k*.3
        fbox(m, 'reveal louvre', q, 29.7, 30.05, y, y + .1, -29.7, 29.7, 'steel')

for q in range(4):
    out = rot3((1, 0, 0), q); along = rot3((0, 0, 1), q)
    canopy = q in (WEST, VESEY)

    def in_lobby(t, y): return abs(t) < LOBBY_HALF + 1.7 and y < LOBBY_TOP + 1.4

    # granite base course under the fins, left and right of the lobby
    for t0, t1 in ((-H, -LOBBY_HALF), (LOBBY_HALF, H)):
        fbox(m, 'granite base', q, CORE, H + .05, 0, FIN_Y0, t0, t1, 'granite')
    # corner post: the podium corners are squared (Wikipedia; photos)
    cu, cv = rot(H - .25, H - .25, q)
    ybox(m, 'corner post', cu - .3, cu + .3, 0, FIN_Y1, cv - .3, cv + .3, 'steel')

    # horizontal stainless strips (8 in) the fin rows stand on, and fine slats seen between the fins
    for r in range(FIN_ROWS + 1):
        y = FIN_Y0 + r*FIN_PITCH
        spans = ((-H, -LOBBY_HALF - 1.0), (LOBBY_HALF + 1.0, H)) if y < LOBBY_TOP + 1.4 else ((-H, H),)
        for t0, t1 in spans:
            fbox(m, 'fin strip', q, CORE, H, y - .1, y + .1, t0 + .3, t1 - .3, 'steel')
    y = FIN_Y0 + .5
    while y < FIN_Y1 - .3:
        spans = ((-H, -LOBBY_HALF - 1.0), (LOBBY_HALF + 1.0, H)) if y < LOBBY_TOP + 1.4 else ((-H, H),)
        for t0, t1 in spans:
            fbox(m, 'backing slat', q, CORE, CORE + .12, y, y + .07, t0 + .3, t1 - .3, 'steel')
        y += .62

    # glass fins: 1.52 m panels, turned +-22 deg off the wall in V pairs that flip every row (photos)
    for r in range(FIN_ROWS):
        y0 = FIN_Y0 + r*FIN_PITCH + .1; y1 = y0 + FIN_PITCH - .2; yc = (y0 + y1)/2
        for j in range(40):
            t = -H + MOD/2 + j*MOD
            if in_lobby(t, y0): continue
            sign = 1 if (j + r) % 2 == 0 else -1
            yaw = math.radians(22 * sign)
            face_dir = norm(add(mul(along, math.cos(yaw)), mul(out, math.sin(yaw))))
            depth_dir = norm(cross(face_dir, (0, 1, 0)))
            if dot(depth_dir, out) < 0: depth_dir = mul(depth_dir, -1)
            c = add(add(mul(out, CORE + .36), mul(along, t)), (0, yc, 0))
            obox(m, 'podium fin', c, (face_dir, (0, 1, 0), depth_dir), (.66, (y1 - y0)/2, .03), 'fin')
            # stainless clips at the panel's foot and head (photos: dark ticks at every row line)
            for yy in (y0 + .12, y1 - .12):
                cc = add(add(mul(out, CORE + .2), mul(along, t + sign*.45)), (0, yy, 0))
                obox(m, 'fin clip', cc, (out, (0, 1, 0), along), (.2, .1, .04), 'steel')

    # ---------------- lobby: 50 ft glazed band, stainless frame, doors
    # a deep stainless portal round a cable-net glass wall with spider fittings (photos ref13, entrance)
    fbox(m, 'lobby glass', q, CORE, CORE + .12, 0, LOBBY_TOP, -LOBBY_HALF, LOBBY_HALF, 'glass')
    fbox(m, 'portal head', q, CORE, H + .6, LOBBY_TOP, LOBBY_TOP + 1.4, -LOBBY_HALF - 1.0, LOBBY_HALF + 1.0, 'steel')
    for s in (-1, 1):
        fbox(m, 'portal jamb', q, CORE, H + .6, 0, LOBBY_TOP, s*LOBBY_HALF - (1.0 if s < 0 else 0), s*LOBBY_HALF + (1.0 if s > 0 else 0), 'steel')
    nb = 8; bay = 2*LOBBY_HALF/nb
    for k in range(1, nb):
        t = -LOBBY_HALF + k*bay
        fbox(m, 'cable-net mullion', q, CORE + .12, CORE + .2, 3.4 if canopy else 0, LOBBY_TOP, t - .04, t + .04, 'steel')
        if canopy or k % 2 == 0:
            fbox(m, 'door post', q, CORE + .12, CORE + .5, 0, 3.4, t - .13, t + .13, 'steel')
    for y in (3.4, 6.3, 9.2, 12.2):
        fbox(m, 'cable-net transom', q, CORE + .12, CORE + .22, y - .05, y + .05, -LOBBY_HALF, LOBBY_HALF, 'steel')
        for k in range(1, nb):
            t = -LOBBY_HALF + k*bay
            if y > 4: fbox(m, 'spider fitting', q, CORE + .12, CORE + .3, y - .25, y + .25, t - .25, t + .25, 'steel')
    fbox(m, 'door head', q, CORE + .12, CORE + .5, 3.25, 3.55, -LOBBY_HALF, LOBBY_HALF, 'steel')
    fbox(m, 'lobby sill', q, CORE, CORE + .5, 0, .2, -LOBBY_HALF, LOBBY_HALF, 'steel')

    doors = (-9.4, -3.1, 3.1, 9.4) if canopy else (-3.1, 3.1)
    for td in doors:
        cu, cv = rot(CORE + .1, td, q)
        lathe(m, 'revolving door drum', [(1.5, .02), (1.5, 2.9)], 32, 'glass', cu, cv)
        lathe(m, 'revolving door crown', [(1.62, 2.9), (1.62, 3.3)], 32, 'steel', cu, cv)
        lathe(m, 'revolving door floor', [(1.62, 0), (1.62, .04)], 32, 'steel', cu, cv)
        for a in range(4):
            ang = a*math.pi/2 + math.pi/4
            p = (cu + 1.45*math.cos(ang), 0, cv + 1.45*math.sin(ang))
            strip(m, 'door wing', (cu, 1.45, cv), (p[0], 1.45, p[2]), (0, 1, 0), (-math.sin(ang), 0, math.cos(ang)), 2.7, .06, 'steel', lift=-.03)
        for s in (-1, 1):
            fbox(m, 'door frame', q, CORE + .1, CORE + .6, 0, 3.3, td + s*1.75 - .12, td + s*1.75 + .12, 'steel')
    if canopy:
        # swing-door frames between the drums and the cantilevered stainless canopy (entrance photo)
        for td in (-6.25, 0.0, 6.25):
            for s in (-1, 1):
                fbox(m, 'swing door frame', q, CORE + .12, CORE + .4, 0, 3.25, td + s*.9 - .05, td + s*.9 + .05, 'steel')
        # cantilevered canopy: a thin deck with stainless blades sweeping up and out (ref13)
        fbox(m, 'canopy deck', q, CORE + .12, 34.0, 5.3, 5.5, -LOBBY_HALF + .1, LOBBY_HALF - .1, 'steel')
        fbox(m, 'canopy back plate', q, CORE + .12, CORE + .5, 4.8, 5.6, -LOBBY_HALF + .1, LOBBY_HALF - .1, 'steel')
        for k in range(14):
            tb = -LOBBY_HALF + .9 + k*(2*LOBBY_HALF - 1.8)/13
            a, b = rot3((CORE + .3, 5.5, tb), q), rot3((34.0, 6.9, tb), q)
            d = norm(sub(b, a)); nrm = norm(cross(along, d))
            if nrm[1] < 0: nrm = mul(nrm, -1)
            strip(m, 'canopy blade', a, b, along, nrm, .28, .55, 'steel', lift=-.2)
        # security bollards along the entrance faces (entrance photo)
        t = -H + 1.4
        while t < H - 1.3:
            cu, cv = rot(32.0, t, q)
            lathe(m, 'bollard', [(.17, 0), (.17, .85), (.12, .92)], 12, 'steel', cu, cv)
            t += 1.55

# ================================================================ tower: eight facets, 58 -> 417 m
B = [(H, -H), (H, H), (-H, H), (-H, -H)]           # base square corners
T = [(D, 0), (0, D), (-D, 0), (0, -D)]             # top square corners, over the base edge midpoints' direction
EDGES = [(0, 0), (1, 0), (1, 1), (2, 1), (2, 2), (3, 2), (3, 3), (0, 3)]   # (base corner, top corner) creases


def section(y, scale=1.0):
    t = (y - Y0)/(YT - Y0)
    return [(scale*(B[b][0] + (T[a][0]-B[b][0])*t), scale*(B[b][1] + (T[a][1]-B[b][1])*t)) for b, a in EDGES]


# glass mass up to the roof slab
top = section(MECH0)
verts = [(u, Y0, v) for u, v in B] + [(u, MECH0, v) for u, v in top]
faces = [(3, 2, 1, 0), tuple(range(4, 12))]
for k in range(8):
    n = (k+1) % 8; bk = ((k+1)//2) % 4; bn = ((n+1)//2) % 4
    faces.append((bk, 4+n, 4+k) if bk == bn else (bk, bn, 4+n, 4+k))
m.mesh('tower glass', verts, faces, 'glass')
prism(m, 'mechanical floors', [(u, MECH0, v) for u, v in section(MECH0)], [(u, MECH1, v) for u, v in section(MECH1)], 'mech')
prism(m, 'upper tower glass', [(u, MECH1, v) for u, v in section(MECH1)], [(u, YR, v) for u, v in section(YR)], 'glass')

# parapet: the facets carry on as a 10 m glass screen to the top square (photo: creases reach the top)
SC = 0.986
outer, inner = section(YR), section(YR, SC)
verts = [(u, YR, v) for u, v in outer] + [(u, YT, v) for u, v in T] + \
        [(u, YR, v) for u, v in inner] + [(SC*u, YT, SC*v) for u, v in T]
OB, OT, IB, IT = 0, 8, 12, 20
faces = []
for k in range(8):
    n = (k+1) % 8; tk, tn = k//2, n//2
    if tk == tn:
        faces += [(OB+k, OB+n, OT+tk), (IB+n, IB+k, IT+tk)]
    else:
        faces += [(OB+k, OB+n, OT+tn, OT+tk), (IB+n, IB+k, IT+tk, IT+tn)]
    faces.append((OB+n, OB+k, IB+k, IB+n))
for a in range(4):
    b = (a+1) % 4
    faces.append((OT+a, OT+b, IT+b, IT+a))
m.mesh('parapet screen', verts, faces, 'glass')
prism(m, 'roof slab', [(u, YR, v) for u, v in section(YR, .975)], [(u, YR + .5, v) for u, v in section(YR, .975)], 'concrete')


def facet(apex, e0, e1):
    mid = mul(add(e0, e1), .5)
    e = norm(sub(e1, e0)); w = math.sqrt(dot(sub(e1, e0), sub(e1, e0)))/2
    g = sub(mid, apex)
    n = norm(cross(e, g))
    if dot(n, (mid[0], 0, mid[2])) < 0: n = mul(n, -1)
    return mid, e, w, g, n


def at(apex, g, e, y, s):
    f = (y - apex[1])/(g[1]); return add(add(apex, mul(g, f)), mul(e, s))


def facet_grammar(apex, e0, e1):
    """Mullions every 5 ft along the facet's slope and a floor line every 13 ft 4 in."""
    mid, e, w, g, n = facet(apex, e0, e1)
    gu = norm(g)
    if gu[1] < 0: gu = mul(gu, -1)
    k = math.floor(w/MOD)
    for j in range(-k, k+1):
        t = j*MOD
        a = add(add(apex, mul(g, abs(t)/w)), mul(e, t))
        strip(m, 'mullion', a, add(mid, mul(e, t)), e, n, .09, .12, 'mullion')
    y = Y0 + FLOOR
    while y < YT - .5:
        f = (y - apex[1])/(mid[1] - apex[1])
        c = add(apex, mul(g, f)); half = f*w - .15
        if half > .3:
            strip(m, 'floor line', sub(c, mul(e, half)), add(c, mul(e, half)), gu, n, .12, .05, 'mullion')
        y += FLOOR


def louvre_band(apex, e0, e1, y0, y1, half):
    """Mechanical floors: a dark louvred panel with vertical blades (photos: on the inverted facets)."""
    mid, e, w, g, n = facet(apex, e0, e1)
    # vertical dark blades with glass between them: the photos show stripes, not a solid patch
    s = -half + .38
    while s < half:
        strip(m, 'louvre blade', at(apex, g, e, y0, s), at(apex, g, e, y1, s), e, n, .3, .12, 'louvre', lift=-.02)
        s += .76
    for y in (y0, y1):
        strip(m, 'louvre frame', at(apex, g, e, y, -half - .2), at(apex, g, e, y, half + .2), norm(g) if g[1] > 0 else mul(norm(g), -1), n, .35, .25, 'steel')


B3 = [(u, Y0, v) for u, v in B]
T3 = [(u, YT, v) for u, v in T]
for i in range(4):
    facet_grammar(T3[i], B3[i], B3[(i+1) % 4])              # upright facet on base edge i
    facet_grammar(B3[(i+1) % 4], T3[i], T3[(i+1) % 4])      # inverted facet on base corner i+1
    louvre_band(B3[(i+1) % 4], T3[i], T3[(i+1) % 4], MECH0 + 3.5, MECH1, 9.2)
# bright stainless crease trims on the eight sloping edges (photos: the lines that read from miles away)
for b, a in EDGES:
    p0, p1 = B3[b], T3[a]
    d = norm(sub(p1, p0)); radial = norm((p0[0]+p1[0], 0, p0[2]+p1[2]))
    side = norm(cross(d, radial)); nrm = norm(cross(side, d))
    if dot(nrm, radial) < 0: nrm = mul(nrm, -1)
    strip(m, 'crease trim', p0, p1, side, nrm, .6, .3, 'steel', lift=-.1)
for q in range(4):
    fbox(m, 'tower sill', q, 29.9, H + .15, Y0 - .15, Y0 + .25, -H, H, 'steel')
# parapet coping on the top square
for a in range(4):
    p0, p1 = T3[a], T3[(a+1) % 4]
    e = norm(sub(p1, p0)); nrm = norm((p0[0]+p1[0], 0, p0[2]+p1[2]))
    strip(m, 'parapet coping', add(p0, (0, -.35, 0)), add(p1, (0, -.35, 0)), e, (0, 1, 0), .7, .5, 'steel', lift=-.25)

# ================================================================ lattice ring on the roof (406.8 - 426.6 m)
DECKS = (YR + 5.2, YR + 12.6, RING_Y1)
lathe(m, 'ring inner drum', [(13.4, YR + .5), (13.4, RING_Y1 - .6)], 64, 'dark')   # dark panel behind the lattice
for y in DECKS:
    th = 1.1 if y == RING_Y1 else .7
    ring(m, 'ring deck', circle(RING_R, 96), circle(13.6, 96), y - th, y, 'spire')
ring(m, 'ring light band', circle(RING_R - .7, 96), circle(RING_R - .9, 96), RING_Y1 - 1.5, RING_Y1 - 1.1, 'light')   # under the top deck's lip
N_POST = 32
for i in range(N_POST):
    a0 = i*math.tau/N_POST; a1 = (i+1)*math.tau/N_POST
    for r in (RING_R - .4, 14.2):
        p = (r*math.cos(a0), 0, r*math.sin(a0))
        m.tube('ring post', [(p[0], YR + .5, p[2]), (p[0], RING_Y1 - .5, p[2])], .22, 'spire', 6)
    ys = (YR + .5,) + DECKS
    for lv in range(3):
        lo, hi = ys[lv] + (0 if lv == 0 else 0), ys[lv+1] - (1.1 if lv == 2 else .7)
        if lv > 0: lo = ys[lv]
        aa, bb = (a0, a1) if (i + lv) % 2 == 0 else (a1, a0)
        r = RING_R - .4
        m.tube('ring diagonal', [(r*math.cos(aa), lo, r*math.sin(aa)), (r*math.cos(bb), hi, r*math.sin(bb))], .16, 'spire', 6)

# ================================================================ spire (mast, cables, platforms, tip)
lathe(m, 'mast foot', [(3.4, YR + .5), (3.0, RING_Y1), (2.2, 433.0), (1.65, 440.0)], 32, 'spire')
PLAT = (465.0, 478.5, 491.5, 505.0, 517.0)           # photo estimate from the 2016 spire photograph
ANCHOR = 447.0


def mast_r(y): return 1.65 - .6*(y - 440.0)/(528.0 - 440.0)


profile = [(mast_r(440.0), 440.0), (mast_r(528.0), 528.0)]
lathe(m, 'mast', profile, 8, 'spire', phase=math.pi/8, smooth=False)
lathe(m, 'mast white section', [(mast_r(505.4) + .06, 505.4), (mast_r(516.6) + .06, 516.6)], 8, 'white', phase=math.pi/8, smooth=False)
y = 441.5
while y < 527:                                         # section collars: the banded look of the lattice mast
    if all(abs(y - p) > 1.5 for p in PLAT + (ANCHOR,)):
        lathe(m, 'mast collar', [(mast_r(y) + .18, y), (mast_r(y) + .18, y + .45)], 8, 'spire', phase=math.pi/8, smooth=False)
    y += 3.2
for c in range(4):                                     # corner chords of the lattice mast
    ang = c*math.pi/2 + math.pi/4
    pts = [((mast_r(yy) + .12)*math.cos(ang), yy, (mast_r(yy) + .12)*math.sin(ang)) for yy in (440.0, 528.0)]
    m.tube('mast chord', pts, .16, 'spire', 6)


def platform(y, r, mat='spire', levels=1):
    for lv in range(levels):
        yy = y + lv*2.2
        lathe(m, 'platform deck', [(r, yy), (r, yy + .4)], 8, mat, phase=math.pi/8, smooth=False)
        ring(m, 'platform rail', circle(r - .05, 8, math.pi/8), circle(r - .15, 8, math.pi/8), yy + 1.05, yy + 1.15, 'spire')
        for a in range(8):
            ang = a*math.tau/8 + math.pi/8
            p = ((r - .1)*math.cos(ang), yy + .4, (r - .1)*math.sin(ang))
            strip(m, 'rail post', p, (p[0], yy + 1.1, p[2]), (-math.sin(ang), 0, math.cos(ang)), (math.cos(ang), 0, math.sin(ang)), .08, .08, 'spire', lift=-.04)
    ring(m, 'platform light', circle(r * .8, 16), circle(r * .8 - .15, 16), y - .12, y, 'light')


platform(ANCHOR, 5.6, levels=2)
lathe(m, 'anchor housing', [(3.0, ANCHOR + .4), (3.0, ANCHOR + 2.2)], 8, 'spire', phase=math.pi/8, smooth=False)
for p in PLAT:
    platform(p, 3.6)
# eight aramid guy cables from the ring's top deck to the anchor platform (photos)
for c in range(8):
    ang = c*math.tau/8 + math.pi/8
    a = (15.2*math.cos(ang), RING_Y1, 15.2*math.sin(ang))
    b = (4.6*math.cos(ang), ANCHOR - .05, 4.6*math.sin(ang))
    m.tube('guy cable', [a, b], .13, 'spire', 6)
# beacon housing and the silver spear tip
lathe(m, 'beacon housing', [(1.05, 528.0), (1.25, 528.6), (1.25, 531.6), (1.1, 532.2)], 24, 'steel')
ring(m, 'beacon', circle(1.3, 24), circle(1.1, 24), 529.6, 531.0, 'light')
lathe(m, 'spear tip', [(1.1, 532.2), (1.0, 534.5), (.55, 538.5), (.12, TIP - .3), (.02, TIP)], 16, 'steel')

info = m.finish(directory=SCRATCH)
