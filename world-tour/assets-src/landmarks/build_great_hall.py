"""Great Hall of the People (人民大会堂), Beijing: original architectural model.

Massing follows the OSM outline (relation 8848388) and its building parts (relation 8848390:
31 m general mass, 39 m east central block, 45 m auditorium and north/south end strips, 38 m
south office block, the inner south courtyard). The east front faces Tiananmen Square (+u = east):
a 5 m granite base, wide front stairs, twelve 25 m grey marble columns with a wider central bay,
two solid pylons, a frieze of carved panels, a blank disc where the national emblem hangs, and the
yellow glazed tile eave over a green bracket band that runs round every roofline. The wings carry
engaged giant-order columns between window bays; end pavilions, the north/south porticos and all
other walls carry pilasters between window bays.

Reference photos (comparison only, never shipped): Wikimedia Commons category
"Great Hall of the People" (east front from the Square, south facade, Chang'an Avenue view).
No text, emblem artwork or signage is modelled; the emblem position is a plain disc.
Authoring frame: u across (east +), y up, v along the long axis (south +).
Run: Blender --background --python assets-src/landmarks/build_great_hall.py [-- --render-dir DIR]
"""
import argparse
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

m = None


def P(line, s, y, d):
    """Facade-local point: s along the wall, y up, d outward from the wall line."""
    ax, c, n = line
    return (c+n*d, y, s) if ax == 'u' else (s, y, c+n*d)


def lbox(line, s0, s1, y0, y1, d0, d1, mat, label='part'):
    if s1-s0 < 1e-3 or y1-y0 < 1e-3 or abs(d1-d0) < 1e-3:
        return
    a = P(line, s0, y0, d0); b = P(line, s1, y1, d1)
    u0, u1 = sorted((a[0], b[0])); v0, v1 = sorted((a[2], b[2]))
    m.box(label, ((u0+u1)/2, (y0+y1)/2, (v0+v1)/2), (u1-u0, y1-y0, v1-v0), mat)


def ubox(u0, u1, y0, y1, v0, v1, mat, label='block'):
    m.box(label, ((u0+u1)/2, (y0+y1)/2, (v0+v1)/2), (u1-u0, y1-y0, v1-v0), mat)


def lathe(label, line, s, d, profile, mat, sides=16):
    """Closed surface of revolution about a vertical axis; profile = [(radius, y), ...]."""
    cu, _, cv = P(line, s, 0, d)
    verts = []
    for r, y in profile:
        verts += [(cu+r*math.cos(j*math.tau/sides), y, cv+r*math.sin(j*math.tau/sides)) for j in range(sides)]
    n = len(profile)
    bottom = len(verts); verts.append((cu, profile[0][1], cv))
    top = len(verts); verts.append((cu, profile[-1][1], cv))
    faces = []
    for i in range(n-1):
        for j in range(sides):
            a = i*sides+j; b = i*sides+(j+1) % sides
            faces.append((a, b, b+sides, a+sides))
    faces += [(bottom, (j+1) % sides, j) for j in range(sides)]
    faces += [(top, (n-1)*sides+j, (n-1)*sides+(j+1) % sides) for j in range(sides)]
    m.mesh(label, verts, faces, mat, True)


def disc(label, line, s, y, r, d0, d1, mat, sides=28):
    """Closed disc whose axis is the wall normal (the emblem position, rosettes)."""
    verts = [P(line, s+r*math.cos(j*math.tau/sides), y+r*math.sin(j*math.tau/sides), d) for d in (d0, d1) for j in range(sides)]
    c0 = len(verts); verts.append(P(line, s, y, d0))
    c1 = len(verts); verts.append(P(line, s, y, d1))
    faces = [(j, (j+1) % sides, sides+(j+1) % sides, sides+j) for j in range(sides)]
    faces += [(c0, (j+1) % sides, j) for j in range(sides)]
    faces += [(c1, sides+j, sides+(j+1) % sides) for j in range(sides)]
    m.mesh(label, verts, faces, mat)


def frustum(label, lo, y0, hi, y1, mat):
    """Closed truncated pyramid between two axis-aligned rectangles (u0,u1,v0,v1)."""
    def ring(r, y):
        return [(r[0], y, r[2]), (r[1], y, r[2]), (r[1], y, r[3]), (r[0], y, r[3])]
    verts = ring(lo, y0)+ring(hi, y1)
    faces = [(3, 2, 1, 0), (4, 5, 6, 7)]+[(i, (i+1) % 4, 4+(i+1) % 4, 4+i) for i in range(4)]
    m.mesh(label, verts, faces, mat)


def rows_for(y0, y1, storey=6.0, pad_b=1.2, pad_t=1.4):
    n = max(1, round((y1-y0)/storey)); h = (y1-y0)/n
    return [(y0+i*h+pad_b, y0+(i+1)*h-pad_t) for i in range(n)]


def grid(line, s0, s1, y0, y1, nb, ww, rows, dface, wall, surround=False, mull=True):
    """Wall plane from d=-0.7 to dface with real window openings; glass sits on the recessed core."""
    bw = (s1-s0)/nb
    ww = min(ww, bw-.8)
    wins = [(s0+(i+.5)*bw-ww/2, s0+(i+.5)*bw+ww/2) for i in range(nb)]
    edges = [s0]+[x for w in wins for x in w]+[s1]
    for a, b in zip(edges[0::2], edges[1::2]):
        lbox(line, a, b, y0, y1, -.7, dface, wall, 'pier')
    rows = [(max(y0, a), min(y1, b)) for a, b in rows if min(y1, b)-max(y0, a) > .5]
    ys = [y0]+[y for r in rows for y in r]+[y1]
    for wl, wr in wins:
        sc = (wl+wr)/2
        for a, b in zip(ys[0::2], ys[1::2]):
            lbox(line, wl, wr, a, b, -.7, dface, wall, 'spandrel')
        for yb, yt in rows:
            lbox(line, wl, wr, yb, yt, -.78, -.62, 'glass', 'window glass')
            if mull:
                lbox(line, sc-.07, sc+.07, yb, yt, -.66, -.52, 'frame', 'mullion')
            if mull and yt-yb > 2.6:
                ym = yb+(yt-yb)*.64
                lbox(line, wl, wr, ym-.07, ym+.07, -.66, -.52, 'frame', 'transom')
            lbox(line, wl-.15, wr+.15, yb-.2, yb, -.1, dface+.22, wall, 'sill')
            if surround:
                lbox(line, wl-.32, wl, yb, yt, dface, dface+.13, 'stone', 'window surround')
                lbox(line, wr, wr+.32, yb, yt, dface, dface+.13, 'stone', 'window surround')
                lbox(line, wl-.4, wr+.4, yt, yt+.42, dface, dface+.18, 'stone', 'window head')


def base_storey(line, s0, s1, nb, ww=2.4, mull=True):
    """The 5 m granite base: plinth course, ground-floor windows, top moulding."""
    lbox(line, s0, s1, 0, .9, -.7, .38, 'granite', 'plinth course')
    grid(line, s0, s1, .9, 4.5, nb, ww, [(1.6, 3.8)], .16, 'granite', mull=mull)
    lbox(line, s0, s1, 4.5, 5.0, -.7, .36, 'granite', 'base moulding')
    lbox(line, s0, s1, 4.5, 4.7, -.7, .46, 'granite', 'base drip')


def pilaster_facade(line, s0, s1, y0, H, bay=4.6, ww=2.0, surround=False, corner=0.0, mull=True):
    top = H-4.6
    if s1-s0 < .5 or top-y0 < 1:
        return
    if s1-s0 < 2*corner+2.5:
        corner = 0.0
    inner0, inner1 = s0+corner, s1-corner
    nb = max(1, round((inner1-inner0)/bay))
    if s1-s0 < 2.6:
        # A return wall too short for a window: solid ashlar with the same courses.
        if y0 == 0:
            lbox(line, s0, s1, 0, .9, -.7, .38, 'granite', 'plinth course')
            lbox(line, s0, s1, .9, 5.0, -.7, .16, 'granite', 'base wall')
            lbox(line, s0, s1, 4.5, 5.0, -.7, .36, 'granite', 'base moulding')
        lbox(line, s0, s1, max(5.0, y0) if y0 == 0 else y0, top, -.7, 0, 'stone', 'return wall')
        return
    if y0 == 0:
        base_storey(line, s0, s1, nb, mull=mull)
        ys = 5.0
    else:
        lbox(line, s0, s1, y0, y0+.45, -.7, .22, 'stone', 'attic plinth')
        ys = y0+.45
    if corner:
        for a, b in ((s0, inner0), (inner1, s1)):
            lbox(line, a, b, ys, top, -.7, .34, 'stone', 'corner pilaster strip')
            lbox(line, a-.05, b+.05, top-.55, top, -.7, .5, 'stone', 'pilaster cap')
    grid(line, inner0, inner1, ys, top, nb, ww, rows_for(ys, top), 0, 'stone', surround, mull)
    bw = (inner1-inner0)/nb
    for i in range(1, nb):
        sb = inner0+i*bw
        lbox(line, sb-.5, sb+.5, ys, top-.55, 0, .28, 'stone', 'pilaster')
        lbox(line, sb-.7, sb+.7, top-.55, top, 0, .44, 'stone', 'pilaster capital')
        lbox(line, sb-.66, sb+.66, ys, ys+.5, 0, .4, 'stone', 'pilaster base')


def wing_column(line, s, d, y0, top, mat='stone', r=.8):
    lathe('wing column', line, s, d, [
        (r+.27, y0), (r+.27, y0+.4), (r+.14, y0+.55), (r+.14, y0+.75), (r+.02, y0+.95), (r, y0+1.05),
        (r-.02, y0+(top-y0)*.35), (r-.07, top-1.25), (r, top-1.1), (r, top-.95), (r+.14, top-.65), (r+.26, top-.36)], mat, 16)
    lbox(line, s-(r+.32), s+(r+.32), top-.36, top, d-(r+.32), d+(r+.32), mat, 'column abacus')


def wing_facade(line, s0, s1, H, bay=6.2):
    """East wings: granite base, three window storeys, engaged giant columns between bays."""
    top = H-4.6
    nb = max(1, round((s1-s0)/bay)); bw = (s1-s0)/nb
    base_storey(line, s0, s1, nb, 2.6)
    grid(line, s0, s1, 5.0, top, nb, 2.8, [(6.3, 10.3), (12.1, 16.1), (17.9, 21.9)], 0, 'stone')
    xs = [s0+1.25]+[s0+i*bw for i in range(1, nb)]+[s1-1.25]
    for x in xs:
        wing_column(line, x, .85, 5.0, top)


def eave(rect, H, proj=None, ribs='NESW', back='', rib_step=.9):
    """Architrave, green bracket frieze, yellow glazed tile eave and coping round a rectangle."""
    u0, u1, v0, v1 = rect
    p = dict(E=.35, W=.35, N=.35, S=.35); p.update(proj or {})
    def ex(k):
        return (u0-p['W']-k, u1+p['E']+k, v0-p['N']-k, v1+p['S']+k)
    def exbox(k, y0, y1, mat, label):
        r = ex(k); ubox(r[0], r[1], y0, y1, r[2], r[3], mat, label)
    exbox(0, H-4.6, H-3.4, 'stone', 'architrave')
    exbox(.18, H-3.4, H-2.35, 'tile_green', 'green glazed frieze')
    exbox(1.4, H-1.85, H-1.58, 'tile_green', 'eave soffit')
    frustum('yellow glazed tile eave', ex(1.55), H-1.58, ex(.3), H-.42, 'tile_yellow')
    exbox(.18, H-.5, H-.26, 'roof', 'flat roof')
    r = ex(.3)
    for side in 'NESW':
        if side in 'NS':
            v = r[2] if side == 'N' else r[3]
            ubox(r[0], r[1], H-.62, H, v-.35, v+.35, 'tile_yellow', 'ridge coping')
        else:
            u = r[0] if side == 'W' else r[1]
            ubox(u-.35, u+.35, H-.62, H, r[2], r[3], 'tile_yellow', 'ridge coping')
    lo, hi = ex(1.55), ex(.32)
    # Brackets under the eave and tile rolls down the slope, only on the exposed sides.
    for side in ribs+back:
        step = rib_step if side in ribs else 1.8
        if side in 'NS':
            a, b = lo[0]+.4, lo[1]-.4
            vb = lo[2] if side == 'N' else lo[3]; vt = hi[2] if side == 'N' else hi[3]
            vf = ex(.18)[2] if side == 'N' else ex(.18)[3]; sg = -1 if side == 'N' else 1
            n = int((b-a)/step)
            for i in range(n+1):
                x = a+(b-a)*i/max(1, n)
                m.tube('glazed tile roll', [(x, H-1.5, vb-sg*.05), (x, H-.36, vt)], .085, 'tile_yellow', 4)
                if hi[0]+.3 < x < hi[1]-.3:
                    lo_v, hi_v = sorted((vf, vf+sg*.62))
                    ubox(x-.17, x+.17, H-2.35, H-1.85, lo_v, hi_v, 'tile_green', 'eave bracket')
        else:
            a, b = lo[2]+.4, lo[3]-.4
            ub = lo[0] if side == 'W' else lo[1]; ut = hi[0] if side == 'W' else hi[1]
            uf = ex(.18)[0] if side == 'W' else ex(.18)[1]; sg = -1 if side == 'W' else 1
            n = int((b-a)/step)
            for i in range(n+1):
                x = a+(b-a)*i/max(1, n)
                m.tube('glazed tile roll', [(ub-sg*.05, H-1.5, x), (ut, H-.36, x)], .085, 'tile_yellow', 4)
                if hi[2]+.3 < x < hi[3]-.3:
                    lo_u, hi_u = sorted((uf, uf+sg*.62))
                    ubox(lo_u, hi_u, H-2.35, H-1.85, x-.17, x+.17, 'tile_green', 'eave bracket')


def mass(rect, H, proj=None, ribs='NESW', core=None, back=''):
    u0, u1, v0, v1 = core or (rect[0]+.7, rect[1]-.7, rect[2]+.7, rect[3]-.7)
    ubox(u0, u1, 0, H-4.6, v0, v1, 'stone', 'mass core')
    eave(rect, H, proj, ribs, back)


def pole(u, y, v, h=8.5):
    m.tube('roof flagpole', [(u, y-.3, v), (u, y+h, v)], .075, 'steel', 6)
    m.tube('flagpole finial', [(u, y+h, v), (u, y+h+.35, v)], .14, 'steel', 6)


def stairs(line, s0, s1, d0, rise, run, cheek=3.0):
    """Stepped granite stair from the terrace edge d0 down to the ground, with sloping cheek walls."""
    n = int(round(rise/.1667)); h = rise/n; t = run/n
    for k in range(1, n):
        lbox(line, s0, s1, 0, rise-k*h, d0+(k-1)*t, d0+k*t, 'granite', 'stair step')
    for a, b in ((s0-cheek, s0), (s1, s1+cheek)):
        pts = [(d0-8, 0), (d0+run+.5, 0), (d0+run+.5, 1.1), (d0+.5, rise+1.0), (d0-8, rise+1.0)]
        outline = [P(line, a, y, d) for d, y in pts]
        off = tuple(q-p for p, q in zip(P(line, a, 0, 0), P(line, b, 0, 0)))
        m.shell('stair cheek wall', outline, off, 'granite')


def main_portico():
    """East front: terrace, stairs, twelve marble columns, glazed rear wall, pylons, frieze, disc."""
    vc = (-57.5+59.4)/2; half = (59.4+57.5)/2
    rear = ('u', 68.5, 1)                     # glazed wall behind the colonnade
    front_d = 76.9-68.5                       # entablature/pylon front, 8.4 m in front of it
    cols = sorted(vc+sg*x for sg in (-1, 1) for x in (5.2, 12.2, 19.2, 26.2, 33.2, 40.2))
    span = 43.5
    # Terrace and stairs.
    lbox(rear, vc-span-3, vc+span+3, 0, 5.0, -.7, front_d+.9, 'granite', 'portico terrace')
    lbox(rear, vc-span-3, vc+span+3, 4.6, 5.0, -.7, front_d+1.2, 'granite', 'terrace lip')
    stairs(rear, vc-span+2, vc+span-2, front_d+1.2, 5.0, 14.5, 3.0)
    # Columns: red granite base drum, grey marble shaft with slight entasis, carved flared capital.
    cd = 75.2-68.5
    for s in cols:
        lbox(rear, s-1.55, s+1.55, 5.0, 5.6, cd-1.55, cd+1.55, 'granite_red', 'column plinth')
        lathe('column base', rear, s, cd, [(1.36, 5.6), (1.36, 6.1), (1.24, 6.25), (1.24, 6.95), (1.14, 7.2)], 'granite_red', 32)
        lathe('marble column shaft', rear, s, cd, [(1.08, 7.2), (1.1, 7.45), (1.08, 7.7), (1.07, 12.0), (1.04, 17.0),
              (.99, 22.0), (.94, 26.8), (1.0, 27.0), (1.0, 27.3), (.95, 27.45)], 'marble', 32)
        lathe('carved capital', rear, s, cd, [(.95, 27.45), (1.02, 27.9), (1.16, 28.4), (1.34, 28.9), (1.5, 29.3), (1.58, 29.5)], 'carved', 32)
        lbox(rear, s-1.62, s+1.62, 29.5, 30.0, cd-1.62, cd+1.62, 'marble', 'column abacus')
        lbox(rear, s-.65, s+.65, 29.0, 30.0, 0, cd, 'stone', 'portico ceiling beam')
    # Rear wall: piers behind every column, full-height glazing between, five gilded doors.
    piers = [(vc-span, cols[0]+1.3)]+[(s-1.3, s+1.3) for s in cols[1:-1]]+[(cols[-1]-1.3, vc+span)]
    lbox(rear, vc-span, vc+span, 0, 30.0, -8, -.7, 'stone', 'portico core')
    for a, b in piers:
        lbox(rear, a, b, 5.0, 30.0, -.7, .32, 'stone', 'rear pier')
        lbox(rear, a-.1, b+.1, 5.0, 5.8, -.7, .45, 'granite', 'rear pier base')
    for (a0, a1), (b0, b1) in zip(piers, piers[1:]):
        wl, wr = a1, b0; mid = (wl+wr)/2
        door = abs(mid-vc) < 20
        for y0, y1 in ((13.2, 13.9), (21.4, 22.1)):
            lbox(rear, wl, wr, y0, y1, -.7, -.12, 'stone', 'glazing band')
        lbox(rear, wl, wr, 28.6, 30.0, -.7, -.12, 'stone', 'glazing head')
        lbox(rear, wl, wr, 5.0, 28.6, -.78, -.62, 'glass', 'portico glazing')
        k = max(2, round((wr-wl)/1.3))
        for i in range(1, k):
            x = wl+(wr-wl)*i/k
            lbox(rear, x-.07, x+.07, 11.2 if door else 5.0, 28.6, -.66, -.5, 'frame', 'glazing mullion')
        for y in (8.2, 11.2, 16.8, 19.4, 24.6, 26.8):
            if not (door and y < 11):
                lbox(rear, wl, wr, y-.07, y+.07, -.66, -.5, 'frame', 'glazing transom')
        if door:
            lbox(rear, mid-2.3, mid+2.3, 5.0, 11.2, -.66, -.42, 'gold', 'gilded door')
            lbox(rear, mid-2.55, mid+2.55, 11.0, 11.35, -.7, -.3, 'gold', 'door head')
            lbox(rear, mid-.06, mid+.06, 5.0, 11.0, -.45, -.36, 'frame', 'door meeting stile')
    # Entablature over the colonnade (the architrave band of eave() sits above it).
    lbox(rear, vc-span, vc+span, 30.0, 34.9, -8, front_d, 'stone', 'portico entablature')
    lbox(rear, vc-span, vc+span, 30.0, 30.6, -8, front_d+.18, 'stone', 'architrave fascia')
    # Pylons with a tall recessed blind panel and a granite base.
    for a, b in ((vc-half, vc-span), (vc+span, vc+half)):
        lbox(rear, a, b, 0, 34.9, -.7, front_d-.3, 'stone', 'pylon')
        lbox(rear, a, b, 0, 5.0, front_d-.3, front_d+.35, 'granite', 'pylon base')
        lbox(rear, a, b, 4.5, 5.0, front_d-.3, front_d+.5, 'granite', 'pylon base moulding')
        p0, p1 = a+3.2, b-3.2
        lbox(rear, a, p0, 5.0, 34.9, front_d-.3, front_d, 'stone', 'pylon frame')
        lbox(rear, p1, b, 5.0, 34.9, front_d-.3, front_d, 'stone', 'pylon frame')
        lbox(rear, p0, p1, 5.0, 8.0, front_d-.3, front_d, 'stone', 'pylon frame')
        lbox(rear, p0, p1, 27.6, 34.9, front_d-.3, front_d, 'stone', 'pylon frame')
        lbox(rear, p0-.25, p1+.25, 27.3, 27.6, front_d-.3, front_d+.12, 'stone', 'panel cornice')
    # Carved frieze panels above each bay and on the pylons; the central bay carries the disc instead.
    bays = [(vc-half+1.5, vc-span-1.5)]+[((a+b)/2-2.4, (a+b)/2+2.4) for a, b in zip(cols, cols[1:])]+[(vc+span+1.5, vc+half-1.5)]
    for a, b in bays:
        if abs((a+b)/2-vc) < 1:
            continue
        lbox(rear, a, b, 31.5, 34.2, front_d-.1, front_d+.08, 'carved', 'carved frieze panel')
        lbox(rear, a-.2, b+.2, 34.2, 34.45, front_d, front_d+.2, 'stone', 'panel frame')
        lbox(rear, a-.2, b+.2, 31.25, 31.5, front_d, front_d+.2, 'stone', 'panel frame')
        k = max(2, round((b-a)/1.6))
        for i in range(k):
            disc('carved rosette', rear, a+(b-a)*(i+.5)/k, 32.85, .55, front_d+.05, front_d+.26, 'carved', 12)
    disc('emblem position disc rim', rear, vc, 34.6, 2.75, front_d, front_d+.75, 'gold', 40)
    disc('emblem position disc face', rear, vc, 34.6, 2.3, front_d+.7, front_d+.95, 'paint_red', 40)
    return vc, half


def side_portico(line, s0, s1, H, disc_face):
    """North/south entrance: twelve columns, glazed rear wall, windowed attic, optional blank disc."""
    uc = (s0+s1)/2; span = 42.0; rd = 4.6; ctop = 28.0; top = H-4.6
    cols = sorted(uc+sg*(3.5+7.0*k) for sg in (-1, 1) for k in range(6))
    for a, b in ((s0, uc-span), (uc+span, s1)):
        lbox(line, a, b, 0, top, -rd-8, -.7, 'stone', 'end bay core')
        pilaster_facade(line, a, b, 0, H, bay=4.8, ww=2.2, surround=True)
    lbox(line, uc-span-2, uc+span+2, 0, 5.0, -rd-.7, .9, 'granite', 'portico terrace')
    lbox(line, uc-span-2, uc+span+2, 4.6, 5.0, -rd-.7, 1.2, 'granite', 'terrace lip')
    stairs(line, uc-span+1, uc+span-1, 1.2, 5.0, 13.0, 2.5)
    rear = (line[0], line[1]-line[2]*rd, line[2])
    # Window bays sit between the columns, piers stand behind them.
    edge = 3.5+7.0*5
    for a, b in ((uc-span, uc-edge), (uc+edge, uc+span)):
        lbox(rear, a, b, 5.0, ctop, -.7, 0, 'stone', 'rear end pier')
    grid(rear, uc-edge, uc+edge, 5.0, ctop, 11, 3.2, [(6.4, 10.6), (12.4, 16.6), (18.4, 22.6), (24.0, 26.8)], 0, 'stone')
    lbox(line, uc-span, uc+span, 0, top, -rd-8, -rd-.7, 'stone', 'portico core')
    for s in cols:
        lbox(line, s-1.3, s+1.3, 5.0, 5.5, -1.3-1.3, -1.3+1.3, 'granite_red', 'column plinth')
        lathe('marble column', line, s, -1.3, [(1.18, 5.5), (1.18, 5.9), (1.06, 6.05), (1.06, 6.5), (.96, 6.7), (.94, 7.0),
              (.92, 15), (.86, ctop-1.5), (.92, ctop-1.3), (.92, ctop-1.1), (1.1, ctop-.75), (1.28, ctop-.4)], 'marble', 24)
        lbox(line, s-1.35, s+1.35, ctop-.4, ctop, -1.3-1.35, -1.3+1.35, 'marble', 'column abacus')
    lbox(line, uc-span, uc+span, ctop, ctop+1.6, -rd-.7, .3, 'stone', 'portico architrave')
    lbox(line, uc-span, uc+span, ctop, top, -rd-.7, -.7, 'stone', 'attic core')
    for a, b in ((uc-span, uc-edge), (uc+edge, uc+span)):
        lbox(line, a, b, ctop+1.6, top, -.7, 0, 'stone', 'attic end pier')
    grid(line, uc-edge, uc+edge, ctop+1.6, top, 11, 2.4, [(ctop+2.6, ctop+5.0), (ctop+6.6, top-1.0)], 0, 'stone', True)
    for s in cols:
        lbox(line, s-.55, s+.55, ctop+1.6, top-.5, 0, .3, 'stone', 'attic pilaster')
    if disc_face:
        disc('emblem position disc rim', line, uc, ctop+4.5, 2.3, 0, .7, 'gold', 36)
        disc('emblem position disc face', line, uc, ctop+4.5, 1.9, .65, .9, 'paint_red', 36)


def build():
    global m
    m = Model('great-hall')
    for key, color, metal, rough in [
        ('stone', (.60, .47, .36), 0, .72),          # light yellow granite cladding
        ('granite', (.33, .30, .27), 0, .66),         # grey granite base, terrace, stairs
        ('granite_red', (.30, .14, .10), 0, .55),     # ruddy column bases
        ('marble', (.40, .43, .46), 0, .38),          # grey marble portico columns
        ('carved', (.52, .40, .30), 0, .74),          # frieze relief panels and capitals
        ('tile_yellow', (.55, .24, .05), 0, .32),     # yellow glazed eave tiles
        ('tile_green', (.035, .085, .06), 0, .36),    # green glazed frieze and brackets
        ('roof', (.22, .21, .20), 0, .9),
        ('glass', (.035, .05, .062), .5, .14),
        ('frame', (.08, .07, .06), .6, .45),
        ('gold', (.62, .40, .10), .85, .3),
        ('paint_red', (.45, .03, .02), 0, .5),
        ('steel', (.70, .71, .72), .8, .3)]:
        names = dict(roof='great-hall_roof_concrete', frame='great-hall_bronze')
        m.material(key, color, metal, rough, names.get(key, 'great-hall_'+key))

    E = lambda c: ('u', c, 1)
    W = lambda c: ('u', c, -1)
    N = lambda c: ('v', c, -1)
    S = lambda c: ('v', c, 1)
    wing = dict(E=2.0)
    # ---- Masses (u0,u1,v0,v1), heights from OSM building parts.
    mass((-70.4, -39.6, -166.8, -136.8), 31, ribs='', back='NWS')                        # M1 north-west
    mass((-78.1, -70.4, -163.5, -139.7), 31, ribs='', back='NWS')                        # M2 NW bump
    mass((73.1, 99.3, -166.7, -137.8), 32, proj=dict(E=.5, N=.5, S=.5), ribs='NES')  # M3 NE pavilion
    mass((-39.6, 75.1, -166.8, -143.8), 44, core=(-38.9, 74.4, -161.5, -144.5), ribs='NE', back='SW')  # M4 north tall
    mass((-42.8, 73.1, -143.8, -57.5), 31, wing, ribs='E', back='W')                     # M5a1 east bar north
    mass((-42.8, 73.1, 59.4, 72.3), 31, wing, ribs='E', back='S')                        # M5a2
    mass((-41.7, -21.4, 72.3, 106.8), 31, ribs='', back='EW')                            # M5b courtyard west
    mass((53.4, 73.1, 72.3, 106.8), 31, wing, ribs='E', back='W')                        # M5c courtyard east
    mass((-41.7, 73.1, 106.8, 142.9), 31, wing, ribs='E', back='WN')                     # M5d
    mass((-21.7, 58.0, 109.0, 142.9), 38, ribs='', back='NEW')                           # M10 south offices
    mass((-70.2, -37.8, 139.1, 167.5), 31, ribs='', back='NWS')                          # M6 south-west
    mass((-75.7, -70.2, 141.9, 165.3), 31, ribs='', back='NWS')                          # M7 SW bump
    mass((73.1, 99.9, 138.7, 167.5), 32, proj=dict(E=.5, N=.5, S=.5), ribs='NES')  # M8 SE pavilion
    mass((-37.8, 75.8, 142.9, 167.5), 44, core=(-37.1, 75.1, 143.6, 162.2), ribs='SE', back='NW')  # M9 south tall
    mass((-109.5, -42.8, -61.2, 63.1), 31, ribs='', back='NWS')                          # M11 west centre
    mass((-72.8, -42.8, -64.8, -61.2), 31, ribs='', back='NW')
    mass((-70.6, -41.7, 63.1, 66.3), 31, ribs='', back='SW')
    mass((-44.3, 76.9, -57.5, 59.4), 39.5, proj=dict(E=.6), core=(-43.6, 67.8, -56.8, 58.7), ribs='NESW')  # M12 central
    mass((-91.7, -7.4, -36.1, 40.5), 46.5, ribs='', back='NESW')                         # M13 auditorium

    # ---- East front (faces the Square).
    vc, half = main_portico()
    wing_facade(E(73.1), -137.8, -57.5, 31)
    wing_facade(E(73.1), 59.4, 138.7, 31)
    for line, a, b in ((E(99.3), -166.7, -137.8), (N(-166.7), 75.1, 99.3), (S(-137.8), 73.1, 99.3),
                       (E(99.9), 138.7, 167.5), (S(167.5), 75.8, 99.9), (N(138.7), 73.1, 99.9)):
        pilaster_facade(line, a, b, 0, 32, bay=4.4, ww=2.1, surround=True, corner=2.8)
    # ---- North and south entrance fronts on the tall end strips.
    side_portico(S(167.5), -37.8, 75.8, 44, True)
    side_portico(N(-166.8), -39.6, 75.1, 44, False)
    # Upper storeys of the tall blocks above the lower roofs.
    for line, a, b, y0, H in ((E(75.1), -166.8, -143.8, 32, 44), (S(-143.8), -39.6, 75.1, 31, 44), (W(-39.6), -166.8, -143.8, 31, 44),
                              (E(75.8), 142.9, 167.5, 32, 44), (N(142.9), -37.8, 75.8, 31, 44), (W(-37.8), 142.9, 167.5, 31, 44),
                              (N(109.0), -21.7, 58.0, 31, 38), (E(58.0), 109.0, 142.9, 31, 38), (W(-21.7), 109.0, 142.9, 31, 38),
                              (N(-57.5), -44.3, 76.9, 31, 39.5), (S(59.4), -44.3, 76.9, 31, 39.5), (W(-44.3), -57.5, 59.4, 31, 39.5),
                              (W(-91.7), -36.1, 40.5, 31, 46.5), (N(-36.1), -91.7, -7.4, 31, 46.5), (S(40.5), -91.7, -7.4, 31, 46.5),
                              (E(-7.4), -36.1, 40.5, 39.5, 46.5)):
        pilaster_facade(line, a, b, y0, H, bay=5.0, ww=2.0, mull=line[0] == 'v' and b > 60)
    # ---- Remaining 31 m walls: west side, recesses, bumps and the south courtyard.
    for line, a, b in ((N(-166.8), -70.4, -39.6), (W(-70.4), -166.8, -163.5), (W(-70.4), -139.7, -136.8), (S(-136.8), -70.4, -42.8),
                       (W(-78.1), -163.5, -139.7), (N(-163.5), -78.1, -70.4), (S(-139.7), -78.1, -70.4),
                       (W(-42.8), -136.8, -64.8), (N(-64.8), -72.8, -42.8), (W(-72.8), -64.8, -61.2),
                       (N(-61.2), -109.5, -72.8), (W(-109.5), -61.2, 63.1), (S(63.1), -109.5, -70.6),
                       (W(-70.6), 63.1, 66.3), (S(66.3), -70.6, -41.7), (W(-41.7), 66.3, 139.1),
                       (N(139.1), -70.2, -41.7), (W(-70.2), 139.1, 141.9), (W(-70.2), 165.3, 167.5),
                       (W(-75.7), 141.9, 165.3), (N(141.9), -75.7, -70.2), (S(165.3), -75.7, -70.2), (S(167.5), -70.2, -37.8),
                       (E(-21.4), 72.3, 106.8), (W(53.4), 72.3, 106.8), (N(106.8), -21.4, 53.4), (S(72.3), -21.4, 53.4)):
        pilaster_facade(line, a, b, 0, 31, bay=4.6, ww=2.0, mull=False)

    # ---- Roof flagpoles along the fronts (the photos show a row on every roof edge).
    for i in range(13):
        pole(76.2, 39.5, vc-52.8+i*8.8)
    for a, b in ((-131.6, -63.7), (65.6, 132.5)):
        for i in range(6):
            pole(74.3, 31, a+(b-a)*i/5)
    for v in (-160.0, -152.2, -144.5, 145.4, 153.1, 160.8):
        pole(97.8, 32, v)
    for i in range(9):  # shorter on the 44 m end blocks: the building's registered height caps the silhouette
        pole(-26+i*11.0, 44, 166.2, h=6.5)
        pole(-28+i*11.0, 44, -165.5, h=6.5)
    return m


def main():
    argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(); parser.add_argument('--render-dir')
    args = parser.parse_args(argv)
    build().finish(Path(args.render_dir) if args.render_dir else None)


main()
