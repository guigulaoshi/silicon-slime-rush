"""Brooklyn Bridge, Lower Manhattan (route new-york): the race finishes where Pearl Street passes
under the Manhattan approach beside the anchorage.

Authored from published figures, then redone against 13 Wikimedia Commons reference photos (towers
from the promenade, the shore, the river and under the deck; sources in the modelling report). The
photos rewrote the towers (lancet arches with toothed voussoir rings in recessed spandrel panels,
imposts, a flush frieze, corbelled pier caps the cables run into, a roadway band and sloped set-off,
end-face channels, recessed webs below the deck), the colours, and the promenade's lattice railings.
Published figures used:
- main span 486.3 m between tower centres (the OSM tower outlines 1255363983 / 317352708 are 486.5 m
  apart), land spans 930 ft = 283.5 m tower to anchorage face (the OSM Manhattan anchorage outline
  1255363984 starts exactly 284.8 m from the tower centre), Manhattan approach 1,562 ft to Park Row;
- towers 84.8 m (278 ft) above the water, 42.8 m across (OSM roof outline = 140 ft at high water),
  18.0 m deep at the water and 16.2 m at the roadway (59 ft / 53 ft), 16.6 m over the cap cornices
  (OSM); two Gothic pointed arches 10.3 m (33.75 ft) wide and 35.7 m (117 ft) tall from the roadway;
- four main cables (two outer on the deck edges, two inner either side of the elevated promenade),
  vertical suspenders every 7.5 ft (2.29 m), diagonal stays fanning from each tower top over roughly
  the first 30 % of every span, lattice stiffening trusses with a darker panel inside them (rule 7),
  roadway 36.5 m above the water at the towers and 41.5 m at mid-span, 3.3 % grade on the land spans;
- Manhattan approach: steel spans over Pearl Street, Rose Street and Park Row on granite piers,
  granite arcades of open round/segmental arches between them, a battered embankment with blind
  arches down to grade at the Park Row / Centre Street end.

Cable and suspender radii are thicker than the real wire ropes (suspenders 16 cm instead of ~5 cm)
so the web survives at game resolution; every length, height and span is real.

Author frame: (t, y, n) in the bridge's own axes -- t metres from the Manhattan tower centre toward
Manhattan (negative = over the river / Brooklyn), n across (positive = south-west side), y metres
above the water surface. P() maps that onto the footprint frame (u across, y up, v along) with the
footprint's lowest ground (the river, clamped to -0.5 m) as the model's y = 0.
Run: Blender --background --python assets-src/landmarks/build_brooklyn_bridge.py
"""
import math
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'brooklyn-bridge'
SCRATCH = Path(tempfile.gettempdir()) / 'sr-landmarks' / ID

TC = 172.5          # footprint centroid, metres along t from the Manhattan tower
Y0 = 0.5            # model y = height above water + 0.5 (lowest ground in the footprint is -0.5)

T_MT, T_BT = 0.0, -486.5            # tower centres
T_MA0, T_MA1 = 284.8, 349.1         # Manhattan anchorage (OSM outline), tower face -> Pearl St face
T_BA0, T_BA1 = -770.0, -837.0       # Brooklyn anchorage (OSM bridge way split), tower face -> far face
T_END = 792.0                       # Manhattan approach meets grade just short of Centre St

R_TOWER, R_MID = 36.5, 41.5         # roadway height above water
LAND_GRADE = (R_TOWER - 27.0) / 284.8
R_MA1 = 27.0 - 0.0325 * (T_MA1 - T_MA0)
APP_GRADE = (R_MA1 - 10.35) / (790.0 - T_MA1)

TOWER_TOP = 84.8
SADDLE = 83.2                       # cable centre in the pier caps (cables leave the cap tops, ref07/ref10)
CABLE_LOW = R_MID + 3.6 + 1.6
OUT_N, IN_N = 12.3, 3.4             # cable / truss planes
PROM = 3.6                          # promenade above the roadway
SPACING = 2.29                      # 7.5 ft suspender pitch
PANEL = 2 * SPACING

# finished ground along the axis, every 10 m from t = -900 (min over n = -14, 0, +14)
_G = [11.3,11.1,10.8,10.5,10.2,9.9,9.5,9.2,8.8,8.4,8.0,7.6,7.3,6.9,6.6,6.2,5.8,5.4,5.1,4.8,4.6,4.4,4.1,3.9,3.2,3.2,
      2.9,2.7,2.5,2.4,2.2,2.1,1.9,1.8,1.6,1.4,1.2,1.0,0.8,0.7,0.5,0.4,0.2,-0.2]+[-0.5]*57+[
      1.8,2.0,2.2,2.4,2.7,2.8,2.9,2.8,2.6,2.6,2.5,2.6,2.7,2.8,2.9,3.1,3.2,3.4,3.5,3.6,3.8,3.9,4.1,4.3,4.6,4.6,4.6,4.6,
      4.7,4.9,5.0,5.0,5.1,5.2,5.3,5.4,5.4,5.5,5.5,5.6,5.7,5.7,5.8,5.9,6.0,6.1,6.2,6.3,6.4,6.6,6.7,6.9,7.1,7.2,7.4,7.6,
      7.8,8.1,8.2,8.5,8.7,8.9,9.2,9.4,9.6,9.8,10.0,10.1,10.2,10.4,10.5,10.5,10.6,10.6,10.6,10.7,10.7,10.7]


def ground(t):
    x = (t + 900.0) / 10.0
    i = max(0, min(len(_G) - 2, int(math.floor(x))))
    f = min(1.0, max(0.0, x - i))
    return _G[i] * (1 - f) + _G[i + 1] * f


def ground_min(t0, t1):
    return min(ground(t0 + (t1 - t0) * k / 8) for k in range(9))


def R(t):
    """Roadway surface height above water."""
    if t < T_BA0:
        return 27.0 - 0.0325 * (T_BA0 - t)
    if t < T_BT:
        return R_TOWER - LAND_GRADE * (T_BT - t)
    if t < T_MT:
        x = (t - (T_BT + T_MT) / 2) / ((T_MT - T_BT) / 2)
        return R_TOWER + (R_MID - R_TOWER) * (1 - x * x)
    if t < T_MA0:
        return R_TOWER - LAND_GRADE * t
    if t < T_MA1:
        return 27.0 - 0.0325 * (t - T_MA0)
    return max(R_MA1 - APP_GRADE * (t - T_MA1), 10.2)


def prom(t):
    """Height of the elevated promenade above the roadway (it comes down to the roadway near Park Row)."""
    if t < 640:
        return PROM
    return max(0.0, PROM * (720 - t) / 80)


def cable_end(n):
    t = 290.0
    return R(t) + (2.0 if abs(n) > 8 else PROM + 2.0)


def cable_y(t, n):
    """Main cable centre height; None outside the suspended spans."""
    if T_BT <= t <= T_MT:
        x = (t - (T_BT + T_MT) / 2) / ((T_MT - T_BT) / 2)
        return CABLE_LOW + (SADDLE - CABLE_LOW) * x * x
    for ts_, te in ((T_MT, 290.0), (T_BT, -776.0)):
        x = (t - ts_) / (te - ts_)
        if 0 <= x <= 1:
            return SADDLE + (cable_end(n) - SADDLE) * x - 7.0 * 4 * x * (1 - x)
    return None


def P(t, y, n):
    return (-n, y + Y0, TC - t)


m = Model(ID)
# colours from the reference photos: warm buff granite/limestone ashlar (ref01, ref05, ref07),
# brown-painted deck steel (ref01, ref09), tan cables, stays and promenade railings (ref06, ref11)
m.material('limestone', (0.50, 0.42, 0.335), 0.0, 0.86, ID + '_limestone')
m.material('granite', (0.42, 0.37, 0.32), 0.0, 0.88, ID + '_granite')
m.material('steel', (0.235, 0.155, 0.105), 0.3, 0.6, ID + '_steel')
m.material('cable', (0.45, 0.36, 0.27), 0.35, 0.5, ID + '_steel_cable')
m.material('rail', (0.46, 0.33, 0.26), 0.3, 0.55, ID + '_paint_tan')
m.material('shadow', (0.05, 0.048, 0.045), 0.0, 0.9, ID + '_paint_dark')
m.material('asphalt', (0.045, 0.045, 0.048), 0.0, 0.93, ID + '_asphalt')
m.material('wood', (0.27, 0.18, 0.105), 0.0, 0.8, ID + '_wood')
m.material('iron', (0.035, 0.04, 0.036), 0.6, 0.5, ID + '_iron')
m.material('lamp', (1.0, 0.86, 0.62), 0.0, 0.3, ID + '_glass_lamp')
_lamp = m.materials['lamp'].node_tree.nodes['Principled BSDF']
_lamp.inputs['Emission Color'].default_value = (1.0, 0.82, 0.55, 1)
_lamp.inputs['Emission Strength'].default_value = 1.0


# ---------------------------------------------------------------- primitives in bridge coordinates
def box_b(label, t0, t1, y0, y1, n0, n1, mat):
    m.box(label, P((t0 + t1) / 2, (y0 + y1) / 2, (n0 + n1) / 2), (abs(n1 - n0), y1 - y0, abs(t1 - t0)), mat)


def hexa(label, c, mat):
    """Closed six-sided solid from 4 bottom + 4 matching top corners (t, y, n)."""
    m.mesh(label, [P(*p) for p in c],
           [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat)


def member(label, a, b, w, h, mat):
    """Straight bar in the t-y plane from a to b, w across n, h across its own length."""
    dt, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dt, dy)
    pt, py = -dy / L * h / 2, dt / L * h / 2

    def ring(p):
        return [(p[0] - pt, p[1] - py, p[2] - w / 2), (p[0] - pt, p[1] - py, p[2] + w / 2),
                (p[0] + pt, p[1] + py, p[2] + w / 2), (p[0] + pt, p[1] + py, p[2] - w / 2)]
    hexa(label, ring(a) + ring(b), mat)


def sweep(label, ts, yb, yt, n0, n1, mat):
    """Rectangular section n0..n1 x yb(t)..yt(t) swept along t through the samples ts."""
    V, F = [], []
    for t in ts:
        V += [P(t, yb(t), n0), P(t, yb(t), n1), P(t, yt(t), n1), P(t, yt(t), n0)]
    k = len(ts)
    F.append((0, 1, 2, 3))
    F.append(tuple(4 * (k - 1) + i for i in (3, 2, 1, 0)))
    for i in range(k - 1):
        a, b = 4 * i, 4 * i + 4
        for j in range(4):
            F.append((a + j, a + (j + 1) % 4, b + (j + 1) % 4, b + j))
    m.mesh(label, V, F, mat)


def slab(label, t0, t1, yb, yt, n0, n1, mat, step=PANEL):
    sweep(label, samples(t0, t1, step), yb, yt, n0, n1, mat)


def samples(t0, t1, step):
    k = max(1, int(math.ceil((t1 - t0) / step - 1e-6)))
    pts = [t0 + (t1 - t0) * i / k for i in range(k + 1)]
    for brk in (T_BA0, T_BT, T_MT, T_MA0, T_MA1, 640.0, 720.0):
        if t0 < brk < t1:
            pts.append(brk)
    return sorted(set(round(p, 4) for p in pts))


def shell_t(label, outline_ty, n0, n1, mat):
    """Outline in the t-y plane extruded across n."""
    m.shell(label, [P(t, y, n0) for t, y in outline_ty], (-(n1 - n0), 0, 0), mat)


def shell_n(label, outline_ny, t0, t1, mat):
    """Outline in the n-y plane extruded along t."""
    m.shell(label, [P(t0, y, n) for n, y in outline_ny], (0, 0, -(t1 - t0)), mat)


def rod(label, a, b, r, mat, sides=3):
    m.tube(label, [P(*a), P(*b)], r, mat, sides)


def bead(label, c, r, mat):
    t, y, n = c
    v = [P(t + r, y, n), P(t - r, y, n), P(t, y + r, n), P(t, y - r, n), P(t, y, n + r), P(t, y, n - r)]
    m.mesh(label, v, [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)], mat)


def arc(tm, ys, half, rise, n=14):
    """Points (t, y) of a round (rise == half) or segmental arch head from left to right springing."""
    rr = (half * half + rise * rise) / (2 * rise)
    yc = ys + rise - rr
    a0 = math.asin(max(-1.0, min(1.0, (ys - yc) / rr)))
    return [(tm + rr * math.cos(a), yc + rr * math.sin(a))
            for a in [math.pi - a0 - (math.pi - 2 * a0) * i / n for i in range(n + 1)]], (tm, yc, rr, a0)


def voussoirs(label, geom, nf, out, proj, depth, mat, count=13):
    """Separate wedge blocks round an arch head on the face n = nf, standing proj proud of it."""
    tm, yc, rr, a0 = geom
    span = math.pi - 2 * a0
    gap = 0.05 / rr
    for k in range(count):
        a1 = math.pi - a0 - span * k / count - gap
        a2 = math.pi - a0 - span * (k + 1) / count + gap
        extra = 0.35 if k == count // 2 else 0.0
        pts = []
        for a, rad in ((a1, rr), (a2, rr), (a2, rr + depth + extra), (a1, rr + depth + extra)):
            pts.append((tm + rad * math.cos(a), yc + rad * math.sin(a)))
        n1 = nf + out * (proj + (0.15 if extra else 0.0))
        hexa(label, [(t, y, nf) for t, y in pts] + [(t, y, n1) for t, y in pts], mat)


# ---------------------------------------------------------------- towers
# Rebuilt from the reference photos (report: photos/ref01,03-11). Plan: width from the OSM roof outline
# (42.8 m, i.e. the 140 ft published width at high water), depth 59 ft (18.0 m) at the water and 53 ft
# (16.2 m) at the roadway (published figures), 16.6 m over the cap cornices (OSM roof outline).
# Arch face, left to right: outer pier | arch 10.3 m (33.75 ft) | central pier | arch | outer pier.
ARCH_W = 10.3
ARCHES = [(2.85, 2.85 + ARCH_W), (-2.85 - ARCH_W, -2.85)]
N_IN = 2.85 + ARCH_W                  # outer pier inner face (arch outer jamb)
ARCH_TOP = R_TOWER + 35.7             # 117 ft from the roadway
# lancet heads: arc radius 1.35 x span, rise about 1.05 x span -- taller than equilateral, as every
# photo taken from the promenade shows (ref07, ref11)
ARCH_R = 1.35 * ARCH_W
ARCH_RISE = math.sqrt(ARCH_R ** 2 - (ARCH_R - ARCH_W / 2) ** 2)
ARCH_SPRING = ARCH_TOP - ARCH_RISE
Y_BAND = R_TOWER - 2.4                # roadway-level band under the set-off (photo ref01, ref05)
Y_SET0, Y_SET1 = R_TOWER - 1.6, R_TOWER + 0.4
Y_FRIEZE = 75.5                       # top of the recessed spandrel panels; flush frieze above (ref10)
Y_CAP0 = 76.0                         # corbelled pier caps start just over the frieze course (ref07)
Y_WALL = 81.4                         # cornice top over the walls between the caps
TOWER_TOP = 84.8                      # 278 ft to the top of the pier caps
LOW_D = (9.0, 8.5)                    # lower tower half-depth, water -> band
UP_D = (7.9, 7.45)                    # upper shaft half-depth, set-off -> caps
LOW_W = (21.8, 21.4)                  # outer face |n|, water -> band
UP_W = (21.0, 20.75)                  # outer face |n|, set-off -> caps
CAP_D = 8.3                           # OSM roof outline 16.6 m deep
PROM_CLEAR_D = 8.0                    # promenade overlook meets the pier face here


def lerp(a, b, f):
    return a + (b - a) * f


def up_d(y):
    return lerp(UP_D[0], UP_D[1], (y - Y_SET1) / (Y_CAP0 - Y_SET1))


def up_w(y):
    return lerp(UP_W[0], UP_W[1], (y - Y_SET1) / (Y_CAP0 - Y_SET1))


def low_d(y):
    return lerp(LOW_D[0], LOW_D[1], (y - 3.2) / (Y_SET0 - 3.2))


def low_w(y):
    return lerp(LOW_W[0], LOW_W[1], (y - 3.2) / (Y_SET0 - 3.2))


def frustum(label, tc, y0, y1, d0, d1, n00, n01, n10, n11, mat, t_lo=None, t_hi=None):
    """Block from y0 to y1, half-depth d0 -> d1 about tc (or one-sided t ranges), n n00..n01 at the
    bottom and n10..n11 at the top: the battered pier shapes."""
    a0, b0 = (tc - d0, tc + d0) if t_lo is None else (t_lo[0], t_hi[0])
    a1, b1 = (tc - d1, tc + d1) if t_lo is None else (t_lo[1], t_hi[1])
    hexa(label, [(a0, y0, n00), (b0, y0, n00), (b0, y0, n01), (a0, y0, n01),
                 (a1, y1, n10), (b1, y1, n10), (b1, y1, n11), (a1, y1, n11)], mat)


def pointed(n0, n1, extra=0.0, k=14):
    """Lancet arch over the opening n0..n1 springing at ARCH_SPRING, left to right; extra > 0 gives
    the concentric curve outside it (same two centres)."""
    w = n1 - n0
    c = n0 + ARCH_R                      # centre of the left-hand arc (right of the opening)
    r = ARCH_R + extra
    apex = math.acos(((n0 + n1) / 2 - c) / r)
    left = [(c + r * math.cos(a), ARCH_SPRING + r * math.sin(a))
            for a in [math.pi - (math.pi - apex) * i / k for i in range(k + 1)]]
    return left + [(n0 + n1 - nn, yy) for nn, yy in reversed(left[:-1])]


def arch_ring(label, tc, n0, n1, face, s):
    """Voussoir ring on one arch face (t = face, s = outward sign): radiating stones standing 0.3 m
    proud of the recessed spandrel, alternately long and short so the extrados is toothed (ref07, ref10)."""
    c = n0 + ARCH_R
    mid = (n0 + n1) / 2
    apex = math.acos((mid - c) / ARCH_R)
    per_half = 12
    t0_, t1_ = sorted((face, face + s * 0.3))
    for side in (0, 1):
        for i in range(per_half):
            a1 = math.pi - (math.pi - apex) * i / per_half
            a2 = math.pi - (math.pi - apex) * (i + 1) / per_half
            g = 0.004
            a1, a2 = a1 - g, a2 + g
            depth = 2.0 if i % 2 == 0 else 2.8
            pts = []
            for a, r in ((a1, ARCH_R), (a2, ARCH_R), (a2, ARCH_R + depth), (a1, ARCH_R + depth)):
                nn, yy = c + r * math.cos(a), ARCH_SPRING + r * math.sin(a)
                nn = min(nn, mid) if not side else nn
                if side:
                    nn = n0 + n1 - min(nn, mid)
                pts.append((nn, yy))
            hexa(label, [(t0_, y, nn) for nn, y in pts] + [(t1_, y, nn) for nn, y in pts], 'limestone')
    # keystone over the apex
    ya = ARCH_SPRING + ARCH_RISE
    box_b(label + ' keystone', t0_ - (0.1 if s < 0 else 0), t1_ + (0.1 if s > 0 else 0), ya - 0.3, ya + 2.3,
          mid - 0.6, mid + 0.6, 'limestone')


def tower(tc):
    L = 'tower'
    # footing and plinth in the water
    box_b(L + ' footing', tc - 10.6, tc + 10.6, -0.5, 1.6, -23.4, 23.4, 'granite')
    box_b(L + ' plinth', tc - 9.8, tc + 9.8, 1.6, 3.2, -22.6, 22.6, 'granite')

    # --- lower tower: three piers standing 1.0 m proud of the webs that carry the deck (ref05)
    for s in (-1, 1):
        n_lo = s * N_IN
        frustum(L + ' outer pier (lower)', tc, 3.2, Y_SET0, LOW_D[0], LOW_D[1],
                *sorted((n_lo, s * LOW_W[0])), *sorted((n_lo, s * LOW_W[1])), 'limestone')
        # base flare: a sloped set-off round the foot (ref05)
        frustum(L + ' pier foot', tc, 3.2, 6.0, LOW_D[0] + 0.6, LOW_D[0] - 0.05,
                *sorted((n_lo, s * (LOW_W[0] + 0.6))), *sorted((n_lo, s * (LOW_W[0] - 0.05))), 'limestone')
    frustum(L + ' central pier (lower)', tc, 3.2, Y_SET0, LOW_D[0], LOW_D[1], -2.85, 2.85, -2.85, 2.85, 'limestone')
    frustum(L + ' central pier foot', tc, 3.2, 6.0, LOW_D[0] + 0.6, LOW_D[0] - 0.05, -2.85, 2.85, -2.85, 2.85, 'limestone')
    for n0, n1 in ARCHES:
        frustum(L + ' web below deck', tc, 3.2, R_TOWER - 3.3, LOW_D[0] - 1.0, LOW_D[1] - 1.0, n0, n1, n0, n1, 'limestone')
    # roadway band and the sloped set-off to the narrower upper shaft (ref01)
    for n0, n1 in ((N_IN, None), (-2.85, 2.85), (None, -N_IN)):
        if n0 is None:
            a, b = -LOW_W[1] - 0.4, n1
        elif n1 is None:
            a, b = n0, LOW_W[1] + 0.4
        else:
            a, b = n0, n1
        box_b(L + ' roadway band', tc - LOW_D[1] - 0.4, tc + LOW_D[1] + 0.4, Y_BAND, Y_SET0, a, b, 'limestone')
    for s in (-1, 1):
        frustum(L + ' set-off', tc, Y_SET0, Y_SET1, LOW_D[1] + 0.05, UP_D[0],
                *sorted((s * N_IN, s * (LOW_W[1] + 0.05))), *sorted((s * N_IN, s * UP_W[0])), 'limestone')
    frustum(L + ' set-off', tc, Y_SET0, Y_SET1, LOW_D[1] + 0.05, UP_D[0], -2.85, 2.85, -2.85, 2.85, 'limestone')

    # --- upper shaft: plain rock-faced piers; the outer piers carry a vertical channel down the
    # middle of their end faces (ref01, ref09)
    ch, chd = 0.75, 0.55
    for s in (-1, 1):
        core = lambda y: s * (up_w(y) - chd)
        frustum(L + ' outer pier', tc, Y_SET1, Y_CAP0, UP_D[0], UP_D[1],
                *sorted((s * N_IN, core(Y_SET1))), *sorted((s * N_IN, core(Y_CAP0))), 'limestone')
        for half in (-1, 1):             # the two halves of the end face either side of the channel
            c = []
            for y in (Y_SET1, Y_FRIEZE):
                ta, tb = sorted((tc + half * ch, tc + half * up_d(y)))
                na, nb = sorted((core(y) - s * 0.05, s * up_w(y)))
                c.append((ta, tb, na, nb, y))
            (ta0, tb0, na0, nb0, y0), (ta1, tb1, na1, nb1, y1) = c
            hexa(L + ' outer pier end', [(ta0, y0, na0), (tb0, y0, na0), (tb0, y0, nb0), (ta0, y0, nb0),
                                         (ta1, y1, na1), (tb1, y1, na1), (tb1, y1, nb1), (ta1, y1, nb1)], 'limestone')
        # the channel stops under the frieze course
        frustum(L + ' outer pier end', tc, Y_FRIEZE - 0.05, Y_CAP0, up_d(Y_FRIEZE), UP_D[1],
                *sorted((core(Y_FRIEZE) - s * 0.05, s * up_w(Y_FRIEZE))), *sorted((core(Y_CAP0) - s * 0.05, s * UP_W[1])),
                'limestone')
    frustum(L + ' central pier', tc, Y_SET1, Y_CAP0, UP_D[0], UP_D[1], -2.85, 2.85, -2.85, 2.85, 'limestone')

    # --- arches: recessed spandrel panel with the pointed opening, voussoir ring, imposts (ref07, ref10, ref11)
    DS = UP_D[1] - 0.2 - 0.75          # spandrel panel face, about 0.9 m behind the pier faces
    for n0, n1 in ARCHES:
        shell_n(L + ' spandrel', pointed(n0, n1) + [(n1, Y_FRIEZE), (n0, Y_FRIEZE)], tc - DS, tc + DS, 'limestone')
        for s in (-1, 1):
            arch_ring(L + ' voussoir', tc, n0, n1, tc + s * DS, s)
        for nn, sj in ((n0, -1), (n1, 1)):       # sj points from the opening into the pier
            a, b = sorted((nn - sj * 0.3, nn + sj * 1.5))
            d = up_d(ARCH_SPRING) + 0.3
            box_b(L + ' impost', tc - d, tc + d, ARCH_SPRING - 1.0, ARCH_SPRING, a, b, 'limestone')
            box_b(L + ' impost cap', tc - d - 0.15, tc + d + 0.15, ARCH_SPRING, ARCH_SPRING + 0.3,
                  a - 0.1, b + 0.1, 'limestone')
    # flush frieze over the whole width, with a string course at its foot (ref07, ref10)
    dF = up_d(Y_FRIEZE)
    box_b(L + ' frieze', tc - dF, tc + dF, Y_FRIEZE - 0.1, Y_WALL - 0.8, -N_IN, N_IN, 'limestone')
    for s in (-1, 1):
        a, b = sorted((s * N_IN, s * (up_w(Y_FRIEZE) + 0.3)))
        box_b(L + ' frieze course', tc - dF - 0.3, tc + dF + 0.3, Y_FRIEZE - 0.35, Y_FRIEZE + 0.2, a, b, 'limestone')
    box_b(L + ' frieze course', tc - dF - 0.3, tc + dF + 0.3, Y_FRIEZE - 0.35, Y_FRIEZE + 0.2, -N_IN, N_IN, 'limestone')
    # wall cornice and parapet between the caps
    box_b(L + ' wall cornice', tc - UP_D[1] - 0.6, tc + UP_D[1] + 0.6, Y_WALL - 0.8, Y_WALL, -N_IN, N_IN, 'limestone')
    box_b(L + ' wall parapet', tc - UP_D[1] + 0.2, tc + UP_D[1] - 0.2, Y_WALL, Y_WALL + 0.9, -N_IN, N_IN, 'limestone')

    # --- pier caps: corbelled out in three steps, a plain block, cornice and coping; the cables go
    # into them (ref07, ref10). The outer caps reach in over the outer cable (n = +-OUT_N).
    caps = [(-3.75, 3.75), (11.7, 21.4), (-21.4, -11.7)]
    for n0, n1 in caps:
        central = n0 < 0 < n1
        body_n0, body_n1 = n0, n1
        for k, (y0, y1) in enumerate(((Y_CAP0, Y_CAP0 + 0.8), (Y_CAP0 + 0.8, Y_CAP0 + 1.6), (Y_CAP0 + 1.6, Y_CAP0 + 2.4))):
            grow = 0.3 * (k + 1)
            if central:
                a, b = -2.85 - grow, 2.85 + grow
            elif n1 > 0:
                a, b = max(N_IN - grow * 1.6, n0), UP_W[1] + grow
            else:
                a, b = -UP_W[1] - grow, min(-N_IN + grow * 1.6, n1)
            box_b(L + ' cap corbel', tc - UP_D[1] - grow, tc + UP_D[1] + grow, y0, y1, a, b, 'limestone')
        box_b(L + ' cap', tc - CAP_D + 0.35, tc + CAP_D - 0.35, Y_CAP0 + 2.4, TOWER_TOP - 0.9, body_n0, body_n1, 'limestone')
        box_b(L + ' cap cornice', tc - CAP_D, tc + CAP_D, TOWER_TOP - 0.9, TOWER_TOP - 0.35,
              body_n0 - (0.35 if not (n1 > 0 and not central) else 0.0),
              body_n1 + (0.35 if not (n0 < 0 and not central) else 0.0), 'limestone')
        box_b(L + ' cap coping', tc - CAP_D + 0.25, tc + CAP_D - 0.25, TOWER_TOP - 0.35, TOWER_TOP,
              body_n0 + 0.1, body_n1 - 0.1, 'limestone')
    # promenade overlook round the central pier: walkways through both arches
    ts = samples(tc - 17, tc + 17, 2.0)
    for n0, n1 in ((2.85, 7.6), (-7.6, -2.85)):
        sweep('promenade overlook', ts, lambda t: R(t) + PROM - 0.28, lambda t: R(t) + PROM + 0.03, n0, n1, 'wood')
        nr = n1 if n1 > 0 else n0
        sweep('overlook railing', ts, lambda t: R(t) + PROM + 1.0, lambda t: R(t) + PROM + 1.1,
              nr - 0.05, nr + 0.05, 'rail')
    for a, b in ((tc - 17, tc - PROM_CLEAR_D), (tc + PROM_CLEAR_D, tc + 17)):
        sweep('promenade overlook', samples(a, b, 2.0), lambda t: R(t) + PROM - 0.28, lambda t: R(t) + PROM + 0.03,
              -7.6, 7.6, 'wood')


# ---------------------------------------------------------------- deck: stiffening trusses and floor
def truss_line(label, ts, nc, yb, yt, inward, chord=0.5, bar=0.16):
    sweep(label + ' bottom chord', ts, lambda t: yb(t) - 0.2, lambda t: yb(t) + 0.25, nc - chord / 2, nc + chord / 2, 'steel')
    sweep(label + ' top chord', ts, lambda t: yt(t) - 0.35, yt, nc - chord * 0.45, nc + chord * 0.45, 'steel')
    for t in ts:
        box_b(label + ' post', t - 0.16, t + 0.16, yb(t), yt(t) - 0.2, nc - 0.16, nc + 0.16, 'steel')
    for a, b in zip(ts, ts[1:]):
        member(label + ' diagonal', (a, yb(a) + 0.2, nc), (b, yt(b) - 0.3, nc), bar, 0.2, 'steel')
        member(label + ' diagonal', (a, yt(a) - 0.3, nc), (b, yb(b) + 0.2, nc), bar, 0.2, 'steel')
    # dark panel a little inside the lattice so the deck reads solid from far away (rule 7)
    nd = nc + inward * 0.5
    sweep(label + ' inner panel', ts, lambda t: yb(t) + 0.15, lambda t: yt(t) - 0.2, nd - 0.03, nd + 0.03, 'shadow')


def deck(t0, t1, depth, floor=True, trusses=True, label='deck'):
    """Roadway, floor beams, lattice trusses (outer to roadway rail, inner up to the promenade)."""
    ts = samples(t0, t1, PANEL)
    if trusses:
        for s in (-1, 1):
            truss_line(label + ' outer truss', ts, s * OUT_N, lambda t: R(t) - depth, lambda t: R(t) + 1.3, -s)
            truss_line(label + ' inner truss', ts, s * IN_N, lambda t: R(t) - depth,
                       lambda t: R(t) + max(prom(t), 1.3), -s)
        for t in ts:
            box_b(label + ' floor beam', t - 0.22, t + 0.22, R(t) - min(1.5, depth - 0.3), R(t) - 0.35, -OUT_N, OUT_N, 'steel')
        for s in (-1, 1):
            sweep(label + ' stringer', ts, lambda t: R(t) - 1.1, lambda t: R(t) - 0.35, s * 7.6 - 0.2, s * 7.6 + 0.2, 'steel')
    if floor:
        sweep(label + ' roadway', ts, lambda t: R(t) - 0.4, R, -OUT_N + 0.25, OUT_N - 0.25, 'asphalt')


def promenade(t0, t1, label='promenade', substructure=False):
    ts = [t for t in samples(t0, t1, PANEL) if prom(t) > 0.05]
    if len(ts) < 2:
        return
    if substructure:
        for s in (-1, 1):
            truss_line(label + ' lattice', ts, s * IN_N, R, lambda t: R(t) + prom(t), -s, chord=0.4, bar=0.13)
    sweep(label + ' planks', ts, lambda t: R(t) + prom(t) - 0.3, lambda t: R(t) + prom(t), -IN_N + 0.1, IN_N - 0.1, 'wood')
    # diamond-lattice iron railings (ref11): top and bottom rails, a post every 2.29 m, crossed bars
    runs, cur = [], []
    for t in ts:
        if min(abs(t - T_MT), abs(t - T_BT)) < 17.0:      # the tower overlooks carry their own railing
            if len(cur) > 1:
                runs.append(cur)
            cur = []
        else:
            cur.append(t)
    if len(cur) > 1:
        runs.append(cur)
    for run in runs:
        for s in (-1, 1):
            nr = s * 3.2
            sweep(label + ' handrail', run, lambda t: R(t) + prom(t) + 1.15, lambda t: R(t) + prom(t) + 1.25,
                  nr - 0.06, nr + 0.06, 'rail')
            sweep(label + ' bottom rail', run, lambda t: R(t) + prom(t) + 0.05, lambda t: R(t) + prom(t) + 0.15,
                  nr - 0.04, nr + 0.04, 'rail')
            for a, b in zip(run, run[1:]):
                mid = (a + b) / 2
                for p, q in ((a, mid), (mid, b)):
                    box_b(label + ' post', p - 0.05, p + 0.05, R(p) + prom(p), R(p) + prom(p) + 1.15,
                          nr - 0.05, nr + 0.05, 'rail')
                    member(label + ' lattice bar', (p, R(p) + prom(p) + 0.15, nr), (q, R(q) + prom(q) + 1.15, nr),
                           0.03, 0.05, 'rail')
                    member(label + ' lattice bar', (p, R(p) + prom(p) + 1.15, nr), (q, R(q) + prom(q) + 0.15, nr),
                           0.03, 0.05, 'rail')


# ---------------------------------------------------------------- masonry: anchorages, piers, arcades
def blind_bays(label, t0, t1, nf, s, ybase, ytop_f, bays, mat):
    """Pilasters and arch frames standing 0.6 m proud of a wall face n = nf (s = outward sign)."""
    pw = 1.6
    clear = (t1 - t0 - (bays + 1) * pw) / bays
    for i in range(bays + 1):
        tp = t0 + i * (clear + pw)
        box_b(label + ' pilaster', tp, tp + pw, ybase, min(ytop_f(tp), ytop_f(tp + pw)),
              min(nf, nf + s * 0.6), max(nf, nf + s * 0.6), mat)
    for i in range(bays):
        ta = t0 + pw + i * (clear + pw)
        tb = ta + clear
        ytop = min(ytop_f(ta), ytop_f(tb))
        avail = ytop - ybase - 1.2
        rise = min(clear / 2, avail - 3.0)
        if rise < 0.8:
            continue
        ys = ytop - 1.2 - rise
        head, geom = arc((ta + tb) / 2, ys, clear / 2, rise)
        shell_t(label + ' blind arch', head + [(tb, ytop_f(tb)), (ta, ytop_f(ta))], nf, nf + s * 0.6, mat)
        voussoirs(label + ' voussoir', geom, nf + s * 0.6, s, 0.2, 1.0, mat, 11)


def cornice(label, t0, t1, nf_abs, mat, drop=1.9, corbel_step=1.5):
    ts = samples(t0, t1, 6.0)
    for s in (-1, 1):
        a, b = sorted((s * (nf_abs - 0.1), s * (nf_abs + 0.75)))
        sweep(label + ' cornice', ts, lambda t: R(t) - drop, lambda t: R(t) - drop + 0.75, a, b, mat)
        k = max(1, int((t1 - t0) / corbel_step))
        for i in range(k):
            t = t0 + (i + 0.5) * (t1 - t0) / k
            c0, c1 = sorted((s * nf_abs, s * (nf_abs + 0.45)))
            box_b(label + ' corbel', t - 0.25, t + 0.25, R(t) - drop - 0.7, R(t) - drop, c0, c1, mat)


def parapet(label, t0, t1, nf_abs, mat, top=1.15):
    ts = samples(t0, t1, 6.0)
    for s in (-1, 1):
        a, b = sorted((s * (nf_abs - 0.7), s * nf_abs))
        sweep(label + ' parapet', ts, lambda t: R(t) - 0.45, lambda t: R(t) + top, a, b, mat)
        a, b = sorted((s * (nf_abs - 0.8), s * (nf_abs + 0.1)))
        sweep(label + ' coping', ts, lambda t: R(t) + top, lambda t: R(t) + top + 0.2, a, b, mat)


def anchorage(label, ta, tb, half=15.5):
    t0, t1 = min(ta, tb), max(ta, tb)
    yb = ground_min(t0, t1) - 2.0
    top = lambda t: R(t) - 0.4
    b = 0.3                                       # batter
    hexa(label + ' mass', [(t0 - b, yb, -half - b), (t1 + b, yb, -half - b), (t1 + b, yb, half + b), (t0 - b, yb, half + b),
                           (t0, top(t0), -half), (t1, top(t1), -half), (t1, top(t1), half), (t0, top(t0), half)], 'granite')
    gtop = max(ground(t0), ground(t1)) + 1.1
    box_b(label + ' plinth', t0 - 1.5, t1 + 1.5, yb, gtop, -half - 1.4, half + 1.4, 'granite')
    ytop = lambda t: R(t) - 2.6
    bays = max(2, round((t1 - t0) / 13))
    for s in (-1, 1):
        blind_bays(label, t0, t1, s * half, s, gtop, ytop, bays, 'granite')
    # end faces: two bays each, as the outline (t, y) cannot hold them, build in n-y
    for tf, s in ((t0, -1), (t1, 1)):
        clear = (2 * half - 3 * 1.6) / 2
        for i in range(3):
            n0 = -half + i * (clear + 1.6)
            box_b(label + ' pilaster', min(tf, tf + s * 0.6), max(tf, tf + s * 0.6), gtop, ytop(tf), n0, n0 + 1.6, 'granite')
        for i in range(2):
            na = -half + 1.6 + i * (clear + 1.6)
            nb = na + clear
            yt = ytop(tf)
            rise = min(clear / 2, yt - gtop - 4.2)
            if rise < 0.8:
                continue
            ys = yt - 1.2 - rise
            head, geom = arc((na + nb) / 2, ys, clear / 2, rise)
            shell_n(label + ' blind arch', head + [(nb, yt), (na, yt)], tf, tf + s * 0.6, 'granite')
    # cornice with a corbel table, parapets, roadway on top
    hexa(label + ' cornice', [(t0 - 0.9, R(t0) - 2.6, -half - 0.9), (t1 + 0.9, R(t1) - 2.6, -half - 0.9),
                              (t1 + 0.9, R(t1) - 2.6, half + 0.9), (t0 - 0.9, R(t0) - 2.6, half + 0.9),
                              (t0 - 0.9, R(t0) - 1.6, -half - 0.9), (t1 + 0.9, R(t1) - 1.6, -half - 0.9),
                              (t1 + 0.9, R(t1) - 1.6, half + 0.9), (t0 - 0.9, R(t0) - 1.6, half + 0.9)], 'granite')
    for s in (-1, 1):
        k = int((t1 - t0) / 1.5)
        for i in range(k):
            t = t0 + (i + 0.5) * (t1 - t0) / k
            c0, c1 = sorted((s * half, s * (half + 0.5)))
            box_b(label + ' corbel', t - 0.25, t + 0.25, R(t) - 3.3, R(t) - 2.6, c0, c1, 'granite')
    parapet(label, t0, t1, half, 'granite')
    slab(label + ' roadway', t0, t1, lambda t: R(t) - 0.4, R, -half + 0.7, half - 0.7, 'asphalt')
    promenade(t0, t1, label + ' promenade', substructure=True)


def cable_portals(tface, s):
    """Granite housings on the anchorage top where the four cables go in (s = direction into the
    anchorage): tall on the span side where the cable enters, sloping down to the roadway behind."""
    for n in (-OUT_N, -IN_N, IN_N, OUT_N):
        ta, tb = tface + s * 1.0, tface + s * 12.0
        yb = R(ta) - 0.4
        hi, lo = cable_end(n) + 1.0, R(tb) + 0.5
        c = [(ta, yb, n - 1.3), (tb, yb, n - 1.3), (tb, yb, n + 1.3), (ta, yb, n + 1.3),
             (ta, hi, n - 1.3), (tb, lo, n - 1.3), (tb, lo, n + 1.3), (ta, hi, n + 1.3)]
        hexa('cable portal', c, 'granite')
        box_b('cable portal cap', min(ta, ta + s * 1.2) - 0.25, max(ta, ta + s * 1.2) + 0.25, hi - 0.1, hi + 0.35,
              n - 1.55, n + 1.55, 'granite')


def pier(label, t0, t1, half=13.2):
    yb = ground_min(t0, t1) - 1.5
    hexa(label, [(t0 - 0.5, yb, -half - 0.5), (t1 + 0.5, yb, -half - 0.5), (t1 + 0.5, yb, half + 0.5), (t0 - 0.5, yb, half + 0.5),
                 (t0, R(t0) - 0.4, -half), (t1, R(t1) - 0.4, -half), (t1, R(t1) - 0.4, half), (t0, R(t0) - 0.4, half)], 'granite')
    for s in (-1, 1):
        a, b = sorted((s * half, s * (half + 0.5)))
        box_b(label + ' pilaster', t0 + 0.4, t1 - 0.4, yb, min(R(t0), R(t1)) - 2.6, a, b, 'granite')
    box_b(label + ' plinth', t0 - 0.9, t1 + 0.9, yb, ground_min(t0, t1) + 1.2, -half - 0.9, half + 0.9, 'granite')


def arcade(label, t0, t1, bays, half=13.2, pw=3.4):
    clear = (t1 - t0 - (bays + 1) * pw) / bays
    top = lambda t: R(t) - 0.4
    for i in range(bays + 1):
        tp = t0 + i * (clear + pw)
        pier(label + ' pier', tp, tp + pw, half)
    for i in range(bays):
        ta = t0 + pw + i * (clear + pw)
        tb = ta + clear
        gr = max(ground(ta), ground(tb), ground((ta + tb) / 2))
        yt = min(top(ta), top(tb))
        avail = yt - 1.5 - gr
        rise = min(clear / 2, avail - 2.4)
        if rise < 1.0:                                     # too low for an opening: a solid bay with a blind arch
            hexa(label + ' solid bay', [(ta, gr - 1.5, -half), (tb, gr - 1.5, -half), (tb, gr - 1.5, half), (ta, gr - 1.5, half),
                                        (ta, top(ta), -half), (tb, top(tb), -half), (tb, top(tb), half), (ta, top(ta), half)], 'granite')
            continue
        ys = yt - 1.5 - rise
        head, geom = arc((ta + tb) / 2, ys, clear / 2, rise)
        shell_t(label + ' vault', head + [(tb, top(tb)), (ta, top(ta))], -half, half, 'granite')
        for s in (-1, 1):
            voussoirs(label + ' voussoir', geom, s * half, s, 0.3, 1.2, 'granite', 13)
            a, b = sorted((s * half, s * (half + 0.35)))
            for tt in (ta, tb):
                box_b(label + ' impost', tt - 0.5, tt + 0.5, ys - 0.6, ys, a, b, 'granite')
    cornice(label, t0, t1, half, 'granite')
    parapet(label, t0, t1, half, 'granite')
    slab(label + ' roadway', t0, t1, lambda t: R(t) - 0.4, R, -half + 0.7, half - 0.7, 'asphalt')
    promenade(t0, t1, label + ' promenade', substructure=True)


def embankment(label, t0, t1, half=13.2):
    ts = samples(t0, t1, 6.0)
    sweep(label + ' fill', ts, lambda t: ground(t) - 1.5, lambda t: R(t) - 0.4, -half, half, 'granite')
    bays = max(1, round((t1 - t0) / 10.5))
    for s in (-1, 1):
        pw = 1.4
        clear = (t1 - t0 - (bays + 1) * pw) / bays
        for i in range(bays + 1):
            tp = t0 + i * (clear + pw)
            yt = min(R(tp), R(tp + pw)) - 1.9
            gb = ground_min(tp, tp + pw) - 1.0
            if yt - gb > 0.8:
                box_b(label + ' pilaster', tp, tp + pw, gb, yt, min(s * half, s * (half + 0.5)), max(s * half, s * (half + 0.5)), 'granite')
        for i in range(bays):
            ta = t0 + pw + i * (clear + pw)
            tb = ta + clear
            yt = min(R(ta), R(tb)) - 1.9
            gr = max(ground(ta), ground(tb))
            rise = min(clear / 2, yt - gr - 2.6)
            if rise < 0.8:
                continue
            ys = yt - 1.0 - rise
            head, geom = arc((ta + tb) / 2, ys, clear / 2, rise)
            nf = s * half
            shell_t(label + ' blind arch', head + [(tb, R(tb) - 1.9), (ta, R(ta) - 1.9)], nf, nf + s * 0.5, 'granite')
            voussoirs(label + ' voussoir', geom, nf + s * 0.5, s, 0.15, 0.8, 'granite', 9)
    cornice(label, t0, t1, half, 'granite', drop=1.9)
    parapet(label, t0, t1, half, 'granite')
    slab(label + ' roadway', t0, t1, lambda t: R(t) - 0.4, R, -half + 0.7, half - 0.7, 'asphalt')
    promenade(t0, t1, label + ' promenade', substructure=True)


# ---------------------------------------------------------------- build
tower(T_MT)
tower(T_BT)

# suspended deck from anchorage to anchorage (runs through both towers' arches)
deck(T_BA0, T_MA0, 3.0)
promenade(T_BA0, T_MA0)

anchorage('manhattan anchorage', T_MA0, T_MA1, 15.5)
cable_portals(T_MA0, 1)
anchorage('brooklyn anchorage', T_BA1, T_BA0, 15.5)
cable_portals(T_BA0, -1)

# Brooklyn approach stub (far away behind DUMBO): a battered granite block ending in a pier face
anchorage('brooklyn approach', -900.0, T_BA1 - 0.01, 13.2)

# Manhattan approach, anchorage -> Park Row
deck(T_MA1, 404.0, 4.5, label='pearl street span')
promenade(T_MA1, 404.0)
arcade('approach arcade', 404.0, 590.0, 13)
deck(590.0, 628.0, 3.0, label='rose street span')
promenade(590.0, 628.0)
arcade('approach arcade', 628.0, 680.0, 4)
deck(680.0, 713.0, 1.4, label='park row span')
promenade(680.0, 713.0)
pier('park row pier', 713.0, 716.4)
embankment('approach embankment', 716.4, T_END)

# main cables: one continuous tube anchorage to anchorage, over both saddles
for n in (-OUT_N, -IN_N, IN_N, OUT_N):
    ts = sorted(set(samples(-776.0, 290.0, 5.0) + [T_BT, T_MT]))
    m.tube('main cable', [P(t, cable_y(t, n), n) for t in ts], 0.24, 'cable', 10)

# vertical suspenders every 7.5 ft on all four cables
spans = [(T_BA0 + 1.0, T_BT - 9.5), (T_BT + 9.5, T_MT - 9.5), (T_MT + 9.5, T_MA0 - 1.0)]
count_susp = 0
for a, b in spans:
    k0 = math.ceil(a / SPACING)
    k1 = math.floor(b / SPACING)
    for k in range(k0, k1 + 1):
        t = k * SPACING
        for n in (-OUT_N, -IN_N, IN_N, OUT_N):
            yc = cable_y(t, n)
            yd = R(t) + (1.3 if abs(n) > 8 else PROM)
            if yc is None or yc - yd < 0.4:
                continue
            rod('suspender', (t, yc - 0.1, n), (t, yd - 0.1, n), 0.065, 'cable')
            count_susp += 1

# diagonal stays fanning from each tower top over the first ~30 % of every span
for tt in (T_MT, T_BT):
    for s in (-1, 1):
        reach = 27 if (tt == T_MT and s < 0) or (tt == T_BT and s > 0) else 25
        for n in (-OUT_N, -IN_N, IN_N, OUT_N):
            top = (tt + s * 3.6, SADDLE - 0.8, n)
            for j in range(reach):
                t = tt + s * (6 * SPACING + j * PANEL)
                yd = R(t) + (1.3 if abs(n) > 8 else PROM)
                rod('stay', top, (t, yd, n), 0.075, 'cable')

# necklace lights along the outer cables, and period lamps on the promenade
for n in (-OUT_N, OUT_N):
    t = -770.0
    while t < 286.0:
        if abs(t - T_MT) > 9 and abs(t - T_BT) > 9:
            bead('cable light', (t, cable_y(t, n) + 0.3, n), 0.3, 'lamp')
        t += 6.1
for t in [x * 27.5 for x in range(-27, 26)]:
    if abs(t - T_MT) < 20 or abs(t - T_BT) < 20 or t > 700 or t < -765:
        continue
    for s in (-1, 1):
        n = s * 2.9
        y0 = R(t) + prom(t)
        m.tube('lamp post', [P(t, y0, n), P(t, y0 + 2.6, n), P(t, y0 + 3.4, n)], 0.075, 'iron', 6)
        box_b('lamp base', t - 0.2, t + 0.2, y0, y0 + 0.5, n - 0.2, n + 0.2, 'iron')
        box_b('lamp lantern', t - 0.2, t + 0.2, y0 + 3.4, y0 + 3.95, n - 0.2, n + 0.2, 'lamp')
        box_b('lamp cap', t - 0.28, t + 0.28, y0 + 3.95, y0 + 4.1, n - 0.28, n + 0.28, 'iron')
        box_b('lamp finial', t - 0.06, t + 0.06, y0 + 4.1, y0 + 4.35, n - 0.06, n + 0.06, 'iron')

print('suspenders', count_susp)
info = m.finish(directory=SCRATCH)
