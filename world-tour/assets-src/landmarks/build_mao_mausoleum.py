"""Chairman Mao Memorial Hall (毛主席纪念堂), south part of Tiananmen Square, Beijing.

Square hall on a two-tier red granite platform with white marble balustrades,
ringed by 44 granite piers (12 per face, corners shared, wider centre bay),
ceramic frieze panels between the pier heads, a double eave of glazed tile
with a recessed relief attic storey between, and four carved sculpture groups
flanking the north (front) and south approaches. No text: the name plaque over
the north centre bay is a blank framed panel.

Proportions: platform follows the OSM outline (relation 8848142, 105 m square
plus the north/south stair projections and the east/west side-stair recesses);
total 33.6 m, platform 4 m, piers 17.5 m (data card). Colonnade, eave and
attic widths are measured off frontal photos against the 17.5 m pier height:
colonnade ~78 m, lower eave ~89 m, attic ~62 m, upper eave ~69 m.
Front is NORTH (-v, -Z in the export frame).

Run: Blender --background --python assets-src/landmarks/build_mao_mausoleum.py
Optional: -- --render-dir <dir>
"""
import argparse
import math
import random
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model, ROOT

ID = 'mao-mausoleum'
# Platform outline straight from the survey ring (u across ~east, v along ~south).
U0, U1, V0, V1 = -52.45, 52.62, -52.29, 52.86
UC, VC = (U0 + U1) / 2, (V0 + V1) / 2
NORTH_STAIR_V, SOUTH_STAIR_V = -61.17, 59.58
W_RECESS = (-48.96, -11.11, 11.06)   # u of recessed edge, v range
E_RECESS = (48.85, -12.15, 10.38)

LOWER_TOP, UPPER_TOP = 1.9, 4.0          # two platform tiers
UPPER_HALF = 44.1                        # upper tier half width
COL_HALF = 38.0                          # corner pier centres
COL_TOP = UPPER_TOP + 17.5               # 21.5
WALL_HALF = 33.0
ATTIC_HALF = 31.0

# Along-face pier centres: 10 equal bays and a 1.35x centre bay.
_bay = COL_HALF / (5 + 1.35 / 2)
PIERS = sorted({s * (1.35 * _bay / 2 + k * _bay) for s in (-1, 1) for k in range(6)})

# Face-local frame: a along the face, d outward distance from the centre, y up.
SIDES = {'N': ((1, 0), (0, -1)), 'E': ((0, 1), (1, 0)),
         'S': ((-1, 0), (0, 1)), 'W': ((0, -1), (-1, 0))}

m = None


def fp(side, a, y, d):
    (au, av), (ou, ov) = SIDES[side]
    return (UC + a * au + d * ou, y, VC + a * av + d * ov)


def fbox(side, a, y0, y1, d0, d1, sa, mat, label='part'):
    c = fp(side, a, (y0 + y1) / 2, (d0 + d1) / 2)
    size = (sa, y1 - y0, d1 - d0) if side in 'NS' else (d1 - d0, y1 - y0, sa)
    m.box(label, c, size, mat)


def fmesh(side, verts, faces, mat, label='part'):
    m.mesh(label, [fp(side, *p) for p in verts], faces, mat)


def fprism(side, profile, a0, a1, mat, label='prism'):
    """Extrude a (d, y) profile along a from a0 to a1."""
    n = len(profile)
    verts = [(a0, y, d) for d, y in profile] + [(a1, y, d) for d, y in profile]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    fmesh(side, verts, faces, mat, label)


def fdisc(side, a, y, d0, d1, r, mat, sides=12, label='disc'):
    m.tube(label, [fp(side, a, y, d0), fp(side, a, y, d1)], r, mat, sides)


# --------------------------------------------------------------------------
# Marble balustrade: sill, posts with caps, carved panel, open gap, top rail.
def balustrade(side, a0, a1, d, y, mat='marble'):
    length = a1 - a0
    if length < 1.2:
        return
    n = max(1, round(length / 2.0))
    posts = [a0 + length * i / n for i in range(n + 1)]
    fbox(side, (a0 + a1) / 2, y, y + .16, d - .24, d + .24, length, mat, 'Balustrade sill')
    for p in posts:
        fbox(side, p, y + .16, y + 1.22, d - .13, d + .13, .26, mat, 'Balustrade post')
        fbox(side, p, y + 1.22, y + 1.46, d - .09, d + .09, .18, mat, 'Balustrade post cap')
    for p, q in zip(posts, posts[1:]):
        mid, w = (p + q) / 2, q - p - .26
        fbox(side, mid, y + .16, y + .62, d - .07, d + .07, w, mat, 'Balustrade carved panel')
        fbox(side, mid, y + .62, y + .86, d - .06, d + .06, .22, mat, 'Balustrade vase support')
        fbox(side, mid, y + .86, y + .98, d - .08, d + .08, w, mat, 'Balustrade top rail')


def sloped_balustrade(side, a, d_low, y_low, d_high, y_high, mat='marble'):
    """Balustrade on a stair cheek, climbing from d_low (outer) to d_high (inner)."""
    run = d_low - d_high
    n = max(1, round(run / 1.9))
    pts = [(d_low - run * i / n, y_low + (y_high - y_low) * i / n) for i in range(n + 1)]
    for d, y in pts:
        fbox(side, a, y, y + 1.3, d - .13, d + .13, .26, mat, 'Stair post')
        fbox(side, a, y + 1.3, y + 1.52, d - .09, d + .09, .18, mat, 'Stair post cap')
    slope = (y_high - y_low) / (d_high - d_low)
    for (da, ya), (db, yb) in zip(pts, pts[1:]):
        da2, db2 = da - .13, db + .13
        ta, tb = ya + slope * (da2 - da), ya + slope * (db2 - da)
        fprism(side, [(da2, ta + .1), (db2, tb + .1), (db2, tb + .62), (da2, ta + .62)],
               a - .07, a + .07, mat, 'Stair carved panel')
        fprism(side, [(da2, ta + .86), (db2, tb + .86), (db2, tb + .98), (da2, ta + .98)],
               a - .08, a + .08, mat, 'Stair top rail')


def stair(side, width, d_out, d_in, y0, y1, steps, rail=True, centre_slab=True):
    """A flight rising from d_out (ground side, y0) inward to d_in (y1)."""
    tread = (d_out - d_in) / steps
    rise = (y1 - y0) / steps
    base = max(0, y0 - .01)
    for k in range(steps):
        fbox(side, 0, base, y0 + rise * (k + 1), d_in - .05, d_out - tread * k, width, 'granite_step', 'Stair step')
    for s in (-1, 1):
        a = s * (width / 2 + .55)
        prof = [(d_out, base), (d_out, y0 + .15 + rise), (d_in - .05, y1 + .15), (d_in - .05, base)]
        fprism(side, prof, a - .55, a + .55, 'marble', 'Stair cheek (垂带)')
        if rail:
            sloped_balustrade(side, a, d_out - .3, y0 + .15 + rise + .3 * rise / tread, d_in + .2,
                              y1 + .15 - .2 * rise / tread)
    if centre_slab:
        # Carved central slab (御路) splitting the flight.
        prof = [(d_out - .02, base), (d_out - .02, y0 + rise + .04), (d_in - .05, y1 + .04), (d_in - .05, base)]
        fprism(side, prof, -1.6, 1.6, 'carved', 'Carved centre slab')


# --------------------------------------------------------------------------
def eave(d_edge, y_edge, d_top, y_top, soffit_y, label):
    """Glazed tile skirt on all four sides: slab, tile rolls, hips, ridge, cresting."""
    def surf(t):
        return d_edge - (d_edge - d_top) * t, y_edge + (y_top - y_edge) * t ** 1.35
    ts = [i / 6 for i in range(7)]
    for side in SIDES:
        rows = []
        for t in ts:
            d, y = surf(t)
            rows.append([fp(side, -d, y, d), fp(side, d, y, d)])
        m.patch(label + ' tile slab', rows, (0, -.32, 0), 'tile_yellow')
        # Tile rolls (筒瓦) down the slope; shortened near the mitred hips.
        spacing = .52
        count = int(2 * d_edge / spacing)
        for i in range(count + 1):
            a = -d_edge + .35 + i * (2 * d_edge - .7) / count
            t_end = min(1, (d_edge - (abs(a) + .28)) / (d_edge - d_top))
            if t_end < .12:
                continue
            pts = []
            for j in range(4):
                d, y = surf(t_end * j / 3)
                pts.append(fp(side, a, y + .09, d))
            m.tube(label + ' tile roll', pts, .1, 'tile_yellow', 6)
        # Drip edge along the eave line (the eave-end tile course).
        d, y = surf(0)
        fbox(side, 0, y - .36, y - .02, d - .14, d + .06, 2 * d - .3, 'tile_yellow', label + ' drip edge')
        # Hip roll along the corner diagonal.
        hip = []
        for j in range(6):
            d, y = surf(j / 5)
            hip.append(fp(side, d - .05, y + .16, d - .05))
        m.tube(label + ' hip roll', hip, .22, 'tile_yellow', 8)
        # Ridge roll where the skirt meets the flat roof, with cresting finials.
        d, y = surf(1)
        m.tube(label + ' ridge roll', [fp(side, -d, y + .1, d - .1), fp(side, d, y + .1, d - .1)], .24, 'tile_yellow', 8)
        n = int(2 * d / 2.2)
        for i in range(n + 1):
            a = -d + .4 + (2 * d - .8) * i / n
            fbox(side, a, y + .2, y + .6, d - .2, d, .18, 'tile_yellow', label + ' cresting finial')
        # Rafter-end blocks under the fascia (the eave's dentil course).
        n = int(2 * d_edge / .9)
        for i in range(n + 1):
            a = -d_edge + .8 + (2 * d_edge - 1.6) * i / n
            fbox(side, a, soffit_y + .25, soffit_y + .65, d_edge - .42, d_edge - .15, .3, 'granite', label + ' rafter end')


# --------------------------------------------------------------------------
def pier(cu, cv):
    """One 17.5 m granite pier: base, chamfered fluted shaft, stepped capital."""
    m.box('Pier plinth', (cu, UPPER_TOP + .225, cv), (2.5, .45, 2.5), 'granite')
    m.box('Pier base moulding', (cu, UPPER_TOP + .625, cv), (2.2, .35, 2.2), 'granite')
    h, ch, fw, fd = .95, .18, .17, .09
    face = [(h, -h + ch), (h, -fw), (h - fd, -fw), (h - fd, fw), (h, fw), (h, h - ch)]
    outline = []
    for k in range(4):
        c, s = math.cos(k * math.pi / 2), math.sin(k * math.pi / 2)
        outline += [(cu + x * c - z * s, UPPER_TOP + .8, cv + x * s + z * c) for x, z in face]
    m.shell('Pier shaft', outline, (0, COL_TOP - .9 - (UPPER_TOP + .8), 0), 'granite_pier')
    m.box('Pier capital necking', (cu, COL_TOP - .72, cv), (2.15, .36, 2.15), 'granite')
    m.box('Pier capital', (cu, COL_TOP - .27, cv), (2.45, .54, 2.45), 'granite')


def colonnade():
    count = 0
    for side in SIDES:
        for a in PIERS[:-1]:
            u, _, v = fp(side, a, 0, COL_HALF)
            pier(u, v)
            count += 1
        # Architrave beam and ceramic frieze panel in every bay.
        for i, (p, q) in enumerate(zip(PIERS, PIERS[1:])):
            mid, w = (p + q) / 2, q - p - 1.9
            fbox(side, mid, 17.95, 18.75, COL_HALF - .65, COL_HALF + .65, w, 'granite', 'Architrave beam')
            fbox(side, mid, 18.75, COL_TOP, COL_HALF - .55, COL_HALF - .05, w, 'ceramic', 'Ceramic frieze panel')
            if side == 'N' and i == 5:
                # Name plaque: a blank framed panel, no characters.
                fbox(side, mid, 19.05, 21.2, COL_HALF - .05, COL_HALF + .12, 6.2, 'gold', 'Plaque frame')
                fbox(side, mid, 19.25, 21.0, COL_HALF + .12, COL_HALF + .2, 5.8, 'ceramic', 'Blank plaque panel')
                continue
            fbox(side, mid, 19.0, 21.25, COL_HALF - .05, COL_HALF + .07, w - .6, 'granite', 'Frieze panel frame')
            fbox(side, mid, 19.2, 21.05, COL_HALF + .07, COL_HALF + .1, w - 1.0, 'ceramic', 'Frieze panel field')
            fdisc(side, mid, 20.12, COL_HALF + .1, COL_HALF + .32, .72, 'carved', 12, 'Frieze medallion')
            fdisc(side, mid, 20.12, COL_HALF + .32, COL_HALF + .45, .34, 'carved', 10, 'Frieze medallion boss')
            for s in (-1, 1):
                fbox(side, mid + s * (w / 2 - 1.05), 19.6, 20.65, COL_HALF + .1, COL_HALF + .26, .6, 'carved', 'Frieze scroll')
    assert count == 44, count


def hall_walls():
    m.box('Hall core', (UC, (UPPER_TOP + COL_TOP) / 2, VC), (2 * 32.1, COL_TOP - UPPER_TOP, 2 * 32.1), 'granite')
    d0, d1 = 32.1, WALL_HALF
    for side in SIDES:
        bays = list(zip(PIERS, PIERS[1:]))
        front = side in 'NS'
        openings = []
        for i, (p, q) in enumerate(bays):
            if front and 2 <= i <= 8:
                openings.append(((p + q) / 2, .6 * (q - p), 4.3, 17.5, 4 <= i <= 6))
            elif not front and 4 <= i <= 6:
                openings.append(((p + q) / 2, .3 * (q - p), 5.2, 17.5, False))
        edges = [-WALL_HALF] + [x for c, w, *_ in openings for x in (c - w / 2, c + w / 2)] + [WALL_HALF]
        for a, b in zip(edges[::2], edges[1::2]):
            fbox(side, (a + b) / 2, UPPER_TOP, COL_TOP, d0, d1, b - a, 'granite', 'Hall wall pier')
            fbox(side, (a + b) / 2, UPPER_TOP, UPPER_TOP + .7, d1, d1 + .25, b - a, 'granite', 'Wall base course')
            fbox(side, (a + b) / 2, 17.8, 18.2, d1, d1 + .2, b - a, 'granite', 'Wall string course')
        for c, w, y0, y1, door in openings:
            fbox(side, c, y1, COL_TOP, d0, d1, w, 'granite', 'Window head')
            if y0 > UPPER_TOP + .05:
                fbox(side, c, UPPER_TOP, y0, d0, d1, w, 'granite', 'Window sill')
            # Surround standing proud of the wall.
            for s in (-1, 1):
                fbox(side, c + s * (w / 2 + .15), y0, y1 + .3, d1, d1 + .16, .3, 'granite', 'Window surround')
            fbox(side, c, y1, y1 + .3, d1, d1 + .16, w, 'granite', 'Window surround')
            fbox(side, c, y0, y1, d0 + .1, d0 + .22, w, 'glass', 'Glazing')
            n = max(2, round(w / 1.5))
            for k in range(1, n):
                fbox(side, c - w / 2 + w * k / n, y0, y1, d0 + .22, d0 + .4, .14, 'frame', 'Mullion')
            y = (10.1 if door else y0) + 2.4
            while y < y1 - .5:
                fbox(side, c, y - .07, y + .07, d0 + .22, d0 + .4, w, 'frame', 'Transom')
                y += 2.4
            if door:
                fbox(side, c, y0, 9.7, d0 + .22, d0 + .5, w - .2, 'bronze', 'Bronze door')
                fbox(side, c, 9.7, 10.1, d0 + .22, d0 + .55, w, 'bronze', 'Door head')
                for k in range(1, 4):
                    fbox(side, c - (w - .2) / 2 + (w - .2) * k / 4, y0, 9.7, d0 + .5, d0 + .62, .16, 'bronze', 'Door leaf stile')
                for yy in (5.8, 7.9):
                    fbox(side, c, yy - .08, yy + .08, d0 + .5, d0 + .62, w - .3, 'bronze', 'Door rail')


def roof():
    # Lower eave: soffit slab over the colonnade, cornice beam, tile skirt, deck.
    m.box('Lower eave soffit', (UC, COL_TOP + .55, VC), (2 * 44.3, 1.1, 2 * 44.3), 'granite')
    for side in SIDES:
        fbox(side, 0, COL_TOP - .35, COL_TOP, 43.0, 44.0, 87.0, 'granite', 'Eave cornice beam')
    m.box('Lower roof deck', (UC, 23.375, VC), (2 * 40.9, 1.55, 2 * 40.9), 'granite')
    eave(44.7, 22.62, 41.0, 24.2, COL_TOP, 'Lower eave')
    # Attic storey: sunflower relief panels between pilasters.
    m.box('Attic core', (UC, 26.775, VC), (2 * ATTIC_HALF, 5.25, 2 * ATTIC_HALF), 'granite')
    pil = sorted(s * x for s in (-1, 1) for x in (4.1, 10.83, 17.55, 24.28, 30.55))
    for side in SIDES:
        fbox(side, 0, 24.15, 24.6, ATTIC_HALF, ATTIC_HALF + .32, 2 * ATTIC_HALF + .64, 'granite', 'Attic base band')
        fbox(side, 0, 28.95, 29.4, ATTIC_HALF, ATTIC_HALF + .38, 2 * ATTIC_HALF + .76, 'granite', 'Attic top band')
        for a in pil:
            fbox(side, a, 24.6, 28.95, ATTIC_HALF, ATTIC_HALF + .4, .9, 'granite', 'Attic pilaster')
        for p, q in zip(pil, pil[1:]):
            mid, w = (p + q) / 2, q - p - .9
            inner = w - .8
            fbox(side, mid, 25.0, 25.18, ATTIC_HALF, ATTIC_HALF + .14, inner, 'granite', 'Relief frame')
            fbox(side, mid, 28.4, 28.58, ATTIC_HALF, ATTIC_HALF + .14, inner, 'granite', 'Relief frame')
            for s in (-1, 1):
                fbox(side, mid + s * (inner / 2 - .09), 25.18, 28.4, ATTIC_HALF, ATTIC_HALF + .14, .18, 'granite', 'Relief frame')
            fdisc(side, mid, 26.8, ATTIC_HALF, ATTIC_HALF + .24, 1.15, 'carved', 14, 'Sunflower relief')
            fdisc(side, mid, 26.8, ATTIC_HALF + .24, ATTIC_HALF + .38, .48, 'carved', 10, 'Sunflower relief boss')
            for s in (-1, 1):
                fbox(side, mid + s * (inner / 2 - 1.1), 26.1, 27.5, ATTIC_HALF, ATTIC_HALF + .2, 1.2, 'carved', 'Leaf scroll relief')
    # Upper eave and flat roof.
    m.box('Upper eave soffit', (UC, 30.0, VC), (2 * 34.3, 1.2, 2 * 34.3), 'granite')
    m.box('Upper roof deck', (UC, 31.75, VC), (2 * 31.5, 2.3, 2 * 31.5), 'granite')
    eave(34.7, 30.62, 31.6, 33.0, 29.4, 'Upper eave')


def platform():
    ring = [(U0, V0), (U1, V0), (U1, E_RECESS[1]), (E_RECESS[0], E_RECESS[1]), (E_RECESS[0], E_RECESS[2]),
            (U1, E_RECESS[2]), (U1, V1), (U0, V1), (U0, W_RECESS[2]), (W_RECESS[0], W_RECESS[2]),
            (W_RECESS[0], W_RECESS[1]), (U0, W_RECESS[1])]
    m.shell('Lower platform tier', [(u, 0, v) for u, v in ring], (0, LOWER_TOP - .15, 0), 'granite_red')
    m.shell('Lower tier paving', [(u, LOWER_TOP - .15, v) for u, v in ring], (0, .15, 0), 'paving')
    m.box('Upper platform tier', (UC, (LOWER_TOP - .02 + UPPER_TOP - .15) / 2, VC),
          (2 * UPPER_HALF, UPPER_TOP - .15 - LOWER_TOP + .02, 2 * UPPER_HALF), 'granite_red')
    m.box('Upper tier paving', (UC, UPPER_TOP - .075, VC), (2 * UPPER_HALF + .2, .15, 2 * UPPER_HALF + .2), 'paving')
    for side in SIDES:
        # Marble coping course at the top of each tier face.
        fbox(side, 0, UPPER_TOP - .5, UPPER_TOP - .15, UPPER_HALF, UPPER_HALF + .12, 2 * UPPER_HALF + .24, 'marble', 'Upper tier coping')
    half_n, half_s = abs(V0 - VC), abs(V1 - VC)
    halfu = (U1 - U0) / 2
    for side, half in (('N', half_n), ('S', half_s)):
        fbox(side, 0, LOWER_TOP - .5, LOWER_TOP - .15, half, half + .12, 2 * halfu, 'marble', 'Lower tier coping')
    # Balustrades, open at every stair. Face-local a on N runs +u, on S -u,
    # on E +v, on W -v (see SIDES).
    for side, half in (('N', half_n), ('S', half_s)):
        balustrade(side, -halfu + .35, -16.3, half - .35, LOWER_TOP)
        balustrade(side, 16.3, halfu - .35, half - .35, LOWER_TOP)
    wr, er = W_RECESS, E_RECESS
    balustrade('W', -(V1 - VC) + .35, -(wr[2] - VC) - .15, halfu - .35, LOWER_TOP)
    balustrade('W', -(wr[1] - VC) + .15, -(V0 - VC) - .35, halfu - .35, LOWER_TOP)
    balustrade('E', (V0 - VC) + .35, (er[1] - VC) - .15, halfu - .35, LOWER_TOP)
    balustrade('E', (er[2] - VC) + .15, (V1 - VC) - .35, halfu - .35, LOWER_TOP)
    for side in SIDES:
        e = UPPER_HALF - .35
        if side in 'NS':
            balustrade(side, -e, -13.3, e, UPPER_TOP)
            balustrade(side, 13.3, e, e, UPPER_TOP)
        else:
            balustrade(side, -e, e, e, UPPER_TOP)
    # Main stairs: north (front) and south, two flights each.
    stair('N', 30.0, abs(NORTH_STAIR_V - VC), half_n, 0, LOWER_TOP, 13)
    stair('S', 30.0, abs(SOUTH_STAIR_V - VC), half_s, 0, LOWER_TOP, 11)
    for side, half in (('N', half_n), ('S', half_s)):
        stair(side, 24.0, UPPER_HALF + 6.0, UPPER_HALF, LOWER_TOP, UPPER_TOP, 13)
    # Side stairs filling the east/west recesses of the lower tier (OSM notches).
    stair('W', abs(wr[2] - wr[1]) - 1.4, halfu, abs(wr[0] - UC), 0, LOWER_TOP, 10, rail=False, centre_slab=False)
    stair('E', abs(er[2] - er[1]) - 1.4, halfu, abs(er[0] - UC), 0, LOWER_TOP, 10, rail=False, centre_slab=False)


# --------------------------------------------------------------------------
def figure(cx, cz, base, h, rng, facing, lean=0.0):
    """An abstract standing figure: lathed body mass and a head, no face."""
    prof = [(0, .30), (.04, .36), (.22, .40), (.44, .50), (.52, .55), (.70, .60),
            (.78, .56), (.82, .24), (.85, .27), (.92, .28), (.98, .17), (1.0, .06)]
    sides = 8
    verts = []
    for t, r in prof:
        rr = r * h * .19
        ox = lean * t * h
        for j in range(sides):
            ang = j * math.tau / sides
            verts.append((cx + ox + rr * math.cos(ang), base + t * h, cz + .72 * rr * math.sin(ang)))
    faces = [tuple(reversed(range(sides))), tuple(range((len(prof) - 1) * sides, len(prof) * sides))]
    faces += [(i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j)
              for i in range(len(prof) - 1) for j in range(sides)]
    m.mesh('Sculpture figure', verts, faces, 'carved', True)
    # Arms: one along the body, one sometimes raised.
    sh = base + .76 * h
    for s in (-1, 1):
        x0 = cx + lean * .76 * h + s * .5 * h * .19
        if rng.random() < .3:
            end = (x0 + s * .15 * h, sh + .3 * h, cz + facing * .1 * h)
        else:
            end = (x0 + s * .05 * h, sh - .35 * h, cz + facing * .12 * h)
        m.tube('Sculpture arm', [(x0, sh, cz), ((x0 + end[0]) / 2, (sh + end[1]) / 2 + .05 * h, (cz + end[2]) / 2), end],
               .055 * h, 'carved', 6)


def sculpture_group(cu, cv, facing, tall_end, seed):
    """Carved group on a stepped granite pedestal, long axis east-west."""
    rng = random.Random(seed)
    m.box('Sculpture pedestal', (cu, .5, cv), (17.5, 1.0, 7.8), 'granite')
    m.box('Sculpture pedestal upper', (cu, 1.75, cv), (16.2, 1.5, 6.6), 'granite')
    # Rough-hewn rock base the figures stand on.
    rock = [(cu - 7.6, cv - 2.9), (cu - 2, cv - 3.1), (cu + 4, cv - 2.8), (cu + 7.7, cv - 2.4),
            (cu + 7.9, cv + 2.6), (cu + 1, cv + 3.05), (cu - 5, cv + 2.8), (cu - 7.8, cv + 2.2)]
    m.shell('Sculpture rock base', [(u, 2.5, v) for u, v in rock], (0, .9, 0), 'carved')
    m.shell('Sculpture rock step', [(cu + (u - cu) * .8, 3.4, cv + (v - cv) * .7) for u, v in rock], (0, .55, 0), 'carved')
    # Carved core mass the figures are cut from, rising toward the tall end,
    # so the group reads as one sculpted block rather than separate posts.
    core = [(cu + 6.3 * math.cos(k * math.tau / 18), cv + 1.25 * math.sin(k * math.tau / 18)) for k in range(18)]
    tops = [3.8 + 2.8 * (((u - cu) * tall_end / 6.3) + 1) / 2 + rng.uniform(-.7, .5) for u, _ in core]
    n = len(core)
    verts = [(u, 3.3, v) for u, v in core] + [(u, t, v) for (u, v), t in zip(core, tops)]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    m.mesh('Sculpture core mass', verts, faces, 'carved')
    rows = [(-1.4, 10), (1.0, 7)]
    for r, (dz, n) in enumerate(rows):
        for i in range(n):
            x = -6.6 + 13.2 * (i + rng.uniform(-.25, .25)) / (n - 1)
            climb = (x * tall_end + 6.6) / 13.2   # 0 at the low end, 1 at the tall end
            h = 4.6 + 2.2 * climb + rng.uniform(-.4, .4) - .5 * r
            base = 3.4 + (.55 if r else 0)
            figure(cu + x, cv + facing * dz, base, h, rng, facing, rng.uniform(-.25, .25))
    # Banner: a pole with a swept flag mass above the tall end.
    px = cu + tall_end * 5.2
    m.tube('Sculpture banner pole', [(px, 5.5, cv + facing * .3), (px + tall_end * .6, 12.0, cv + facing * .1)], .12, 'carved', 6)
    flag = []
    for j in range(3):
        y = 9.4 + 1.3 * j
        flag.append([(px + tall_end * (.6 * (y - 5.5) / 6.5) - tall_end * 3.2 * i / 4,
                      y - .25 * i, cv + facing * (.1 + .5 * math.sin(i * 1.3 + j * .4))) for i in range(5)])
    m.patch('Sculpture banner', flag, (0, 0, -facing * .28), 'carved')


def build():
    global m
    m = Model(ID)
    for key, color, metal, rough in [
            ('granite', (.70, .68, .63), 0, .72), ('granite_pier', (.76, .74, .69), 0, .66),
            ('granite_red', (.30, .12, .09), 0, .6), ('granite_step', (.58, .57, .54), 0, .75),
            ('paving', (.62, .60, .56), 0, .8), ('marble', (.90, .89, .86), 0, .45),
            ('tile_yellow', (.56, .23, .07), .05, .36), ('ceramic', (.80, .70, .50), 0, .5),
            ('carved', (.68, .58, .50), 0, .7), ('glass', (.05, .10, .12), .3, .12),
            ('frame', (.16, .18, .18), .5, .4), ('bronze', (.38, .24, .12), .7, .38),
            ('gold', (.78, .60, .24), .9, .3)]:
        m.material(key, color, metal, rough)
    platform()
    colonnade()
    hall_walls()
    roof()
    # Sculpture groups flank the north (front) and south approaches on the forecourts.
    for s in (-1, 1):
        sculpture_group(UC + s * 36.0, NORTH_STAIR_V - 26.0, -1, -s, 11 + s)
        sculpture_group(UC + s * 36.0, SOUTH_STAIR_V + 26.0, 1, -s, 21 + s)
    return m


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--render-dir', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    build().finish(ROOT / args.render_dir if args.render_dir else None)
