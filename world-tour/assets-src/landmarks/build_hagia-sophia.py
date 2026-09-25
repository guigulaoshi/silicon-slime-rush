"""Hagia Sophia (Ayasofya), Sultanahmet, Istanbul -- route `istanbul`.

The route crosses Ayasofya square south-west of the building (closest ~55 m), so the south flank,
the south-west corner and the west front are the faces the player sees; the dome, the four
minarets and the south tympanum carry the silhouette from everywhere else on the route.

Original geometry authored from public facts only (no photo, texture or third-party mesh shipped):
  footprint  OSM way 109862851 "Ayasofya" (owned by pipeline/landmarks.json)
  dome       31 m span, 55.6 m crown above the floor, ring of 40 windows at its base
  plan       main block ~74 x 76 m, inner narthex + exonarthex ~17 m deep on the west,
             semi-domes east and west, two exedrae on each, apse on the east
  minarets   four, not alike: SE red brick shaft on a white stone pedestal (Mehmed II), NE slender
             white (Bayezid II), the two western ones thick white with a square base, a tall faceted
             transition and one serefe (Selim II / Murad III) -- the western pair is one design.
  proportions of the pier tops, tympanum windows, drum and minarets were read off public Commons
  photographs of the south and south-east sides (comparison only; nothing from them is shipped).
Plan read off the OSM outline in the survey frame (u across, + = north flank; v along the long
axis, + = east, the apse end; the walls run 34 deg off east so the survey axis is the church axis):
  south wall u=-34.3, north wall u=40.0, dome centre (2.85, 3.4), west wall of the nave v=-34.3,
  exonarthex front v=-51.3, east wall v=41.7.  Floor sits 3.0 m above the lowest ground under the
  outline (the ground rises ~9 m from the north-west corner to the east end); every wall is carried
  down to the datum so no part floats where the ground is low.
"""
import math
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model
from build_moffett_aircraft import xyz

ID = 'hagia-sophia'
M = Model(ID)
M.material('plaster', (0.74, 0.45, 0.35), 0.0, 0.85, ID + '_plaster')        # ochre/pink render
M.material('plaster_red', (0.62, 0.22, 0.12), 0.0, 0.85, ID + '_plaster_red')  # tympanum infill
M.material('lead', (0.40, 0.42, 0.45), 0.35, 0.55, ID + '_lead')              # domes and roofs
M.material('stone', (0.80, 0.76, 0.68), 0.0, 0.7, ID + '_stone')              # limestone trim
M.material('brick', (0.48, 0.20, 0.13), 0.0, 0.85, ID + '_brick')             # exposed brick
M.material('glass', (0.05, 0.06, 0.07), 0.2, 0.2, ID + '_glass')
M.material('gold', (0.86, 0.66, 0.26), 1.0, 0.3, ID + '_gold')

F = 3.0                      # floor above the model datum (lowest ground under the outline)
U0, V0 = 2.85, 3.4           # dome centre in the survey frame
US, UN = -34.3, 40.0         # outer aisle walls (south, north)
VW, VE = -34.3, 41.7         # nave west wall, east wall
TAU = 2 * math.pi


def raw(verts, faces, mat, smooth=False):
    """One closed component in (u, y, v) building coordinates."""
    g = M.groups.setdefault(mat, [[], [], []])
    off = len(g[0])
    g[0].extend(xyz(M.point(p)) for p in verts)
    g[1].extend(tuple(i + off for i in f) for f in faces)
    g[2].extend(smooth if isinstance(smooth, list) else [smooth] * len(faces))
    M.authored_components += 1


BOXF = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def hexa(c, mat):
    raw(c, BOXF, mat)


class Fr:
    """Wall frame: s along the wall (tangent t), d outward (normal n), in the (u, v) plan."""
    def __init__(s, u0, v0, t, n):
        s.u0, s.v0, s.t, s.n = u0, v0, t, n

    def p(s, a, y, d):
        return (s.u0 + a * s.t[0] + d * s.n[0], y, s.v0 + a * s.t[1] + d * s.n[1])


def fr_ang(u0, v0, ang):
    """Frame whose outward normal points at angle `ang` in the (u, v) plan."""
    n = (math.cos(ang), math.sin(ang))
    return Fr(u0, v0, (-n[1], n[0]), n)


# the four walls of the main block, s running left-to-right for a viewer outside
SOUTH = Fr(0.0, 0.0, (0.0, 1.0), (-1.0, 0.0))    # s = v, d = -u  (outside is -u)
NORTH = Fr(0.0, 0.0, (0.0, -1.0), (1.0, 0.0))    # s = -v, d = u
WEST = Fr(0.0, 0.0, (-1.0, 0.0), (0.0, -1.0))    # s = -u, d = -v
EAST = Fr(0.0, 0.0, (1.0, 0.0), (0.0, 1.0))      # s = u, d = v


def box(fr, a0, a1, y0, y1, d0, d1, mat):
    q = [(a0, d0), (a1, d0), (a1, d1), (a0, d1)]
    hexa([fr.p(a, y0, d) for a, d in q] + [fr.p(a, y1, d) for a, d in q], mat)


def ubox(u0, u1, y0, y1, v0, v1, mat):
    hexa([(u0, y0, v0), (u1, y0, v0), (u1, y0, v1), (u0, y0, v1),
          (u0, y1, v0), (u1, y1, v0), (u1, y1, v1), (u0, y1, v1)], mat)


def slope_box(fr, a0, a1, d0, d1, yb, yt0, yt1, mat):
    """Box whose top falls from yt0 at d0 to yt1 at d1 (battered buttress caps, lean-to roofs)."""
    q = [(a0, d0), (a1, d0), (a1, d1), (a0, d1)]
    t = [yt0, yt0, yt1, yt1]
    hexa([fr.p(a, yb, d) for a, d in q] + [fr.p(a, y, d) for (a, d), y in zip(q, t)], mat)


def prism(pts, y0, y1, mat):
    """Vertical prism over a plan polygon [(u, v)...]."""
    n = len(pts)
    v = [(u, y0, w) for u, w in pts] + [(u, y1, w) for u, w in pts]
    f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    raw(v, f, mat)


def revolve(cu, cv, prof, sides, mat, th0=0.0, th1=TAU, smooth=True, apex=None, flat_base=True, rot=0.0, sx=1.0, sv=1.0):
    """Solid of revolution about the vertical axis at (cu, cv).

    prof: [(r, y)...] bottom to top (r > 0).  A full turn closes with discs; a partial turn
    (th0..th1) closes with the planar section through the axis.  apex=(y) adds a single top vertex."""
    full = abs((th1 - th0) - TAU) < 1e-9
    m = sides if full else sides + 1
    V = []
    for r, y in prof:
        for j in range(m):
            t = rot + th0 + (th1 - th0) * j / sides
            V.append((cu + sx * r * math.cos(t), y, cv + sv * r * math.sin(t)))
    n = len(prof)
    faces = []
    sm = []
    for i in range(n - 1):
        for j in range(m if full else m - 1):
            a = i * m + j
            b = i * m + (j + 1) % m
            faces.append((a, b, b + m, a + m)); sm.append(smooth)
    top = (n - 1) * m
    if apex is not None:
        V.append((cu, apex, cv))
        ai = len(V) - 1
        for j in range(m if full else m - 1):
            faces.append((top + j, top + (j + 1) % m, ai)); sm.append(smooth)
    if full:
        faces.append(tuple(reversed(range(m)))); sm.append(False)
        if apex is None:
            faces.append(tuple(range(top, top + m))); sm.append(False)
    else:
        # base half-disc closed by the chord, and the section plane through the axis
        V.append((cu, prof[0][1], cv)); c0 = len(V) - 1
        faces.append(tuple(reversed(range(m))) + (c0,)); sm.append(False)
        if apex is None:
            V.append((cu, prof[-1][1], cv)); c1 = len(V) - 1
            faces.append(tuple(range(top, top + m)) + (c1,)); sm.append(False)
            up = [c1]
        else:
            up = [ai]
        # section: axis bottom -> first edge up -> (apex/axis top) -> last edge down
        sec = [c0] + [i * m for i in range(n)] + up + [i * m + m - 1 for i in range(n - 1, -1, -1)]
        faces.append(tuple(sec)); sm.append(False)
    raw(V, faces, mat, sm)


def opening_loop(ax, ay, w, yb, ys, seg=10):
    """Arched opening outline (counter-clockwise in the wall's (s, y) plane)."""
    r = w / 2
    pts = [(ax - r, yb), (ax + r, yb), (ax + r, ys)]
    for k in range(1, seg):
        t = math.pi * k / seg
        pts.append((ax + r * math.cos(t), ys + r * math.sin(t)))
    pts.append((ax - r, ys))
    return pts


def _ray_poly(c, ang, poly):
    """Distance from c along angle to the (convex, containing c) polygon boundary."""
    dx, dy = math.cos(ang), math.sin(ang)
    best = None
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        ex, ey = x2 - x1, y2 - y1
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        t = ((x1 - c[0]) * ey - (y1 - c[1]) * ex) / den
        s = ((x1 - c[0]) * dy - (y1 - c[1]) * dx) / den
        if t > 1e-9 and -1e-9 <= s <= 1 + 1e-9:
            best = t if best is None else min(best, t)
    return best


def pierced(fr, a0, a1, y0, y1, d0, d1, hole, mat, glass=True, glass_mat='glass', flat=False):
    """A wall slab (fr, a0..a1, y0..y1, depth d0..d1 outward) with one arched opening that goes
    right through it.  hole = (centre a, width, sill y, springing y).  A dark pane closes the back
    of the reveal so the opening reads as a window with real depth."""
    ax, w, yb, ys = hole
    inner = opening_loop(ax, 0, w, yb, ys)
    if flat:   # square-headed opening
        inner = [(ax - w / 2, yb), (ax + w / 2, yb), (ax + w / 2, ys), (ax - w / 2, ys)]
    c = (ax, (yb + ys) / 2)
    outer_poly = [(a0, y0), (a1, y0), (a1, y1), (a0, y1)]
    angs = {round(math.atan2(y - c[1], x - c[0]) % TAU, 9) for x, y in inner}
    angs |= {round(math.atan2(y - c[1], x - c[0]) % TAU, 9) for x, y in outer_poly}
    angs = sorted(angs)
    I, O = [], []
    for g in angs:
        ri = _ray_poly(c, g, inner); ro = _ray_poly(c, g, outer_poly)
        I.append((c[0] + ri * math.cos(g), c[1] + ri * math.sin(g)))
        O.append((c[0] + ro * math.cos(g), c[1] + ro * math.sin(g)))
    n = len(I)
    V = ([fr.p(s, y, d1) for s, y in I] + [fr.p(s, y, d1) for s, y in O] +
         [fr.p(s, y, d0) for s, y in I] + [fr.p(s, y, d0) for s, y in O])
    fi, fo, bi, bo = 0, n, 2 * n, 3 * n
    faces = []
    for k in range(n):
        k1 = (k + 1) % n
        faces.append((fi + k, fi + k1, fo + k1, fo + k))
        faces.append((bo + k, bo + k1, bi + k1, bi + k))
        faces.append((fo + k, fo + k1, bo + k1, bo + k))
        faces.append((bi + k, bi + k1, fi + k1, fi + k))
    raw(V, faces, mat)
    if glass:
        top = ys if flat else ys + w / 2
        box(fr, ax - w / 2 - 0.05, ax + w / 2 + 0.05, yb - 0.05, top + 0.05, d0 - 0.12, d0 + 0.04, glass_mat)


def arch_ring(fr, ax, r0, r1, ys, d0, d1, mat, seg=12, legs=0.0):
    """Half-annulus moulding (voussoir band) round an arch, optionally with short legs down."""
    pts_o, pts_i = [], []
    for k in range(seg + 1):
        t = math.pi * k / seg
        pts_o.append((ax + r1 * math.cos(t), ys + r1 * math.sin(t)))
        pts_i.append((ax + r0 * math.cos(t), ys + r0 * math.sin(t)))
    if legs > 0:
        pts_o = [(ax + r1, ys - legs)] + pts_o + [(ax - r1, ys - legs)]
        pts_i = [(ax + r0, ys - legs)] + pts_i + [(ax - r0, ys - legs)]
    n = len(pts_o)
    V = ([fr.p(s, y, d1) for s, y in pts_o] + [fr.p(s, y, d1) for s, y in pts_i] +
         [fr.p(s, y, d0) for s, y in pts_o] + [fr.p(s, y, d0) for s, y in pts_i])
    fo, fi, bo, bi = 0, n, 2 * n, 3 * n
    faces = []
    for k in range(n - 1):
        faces.append((fo + k, fo + k + 1, fi + k + 1, fi + k))
        faces.append((bi + k, bi + k + 1, bo + k + 1, bo + k))
        faces.append((bo + k, bo + k + 1, fo + k + 1, fo + k))
        faces.append((fi + k, fi + k + 1, bi + k + 1, bi + k))
    faces.append((fo, fi, bi, bo))
    faces.append((fo + n - 1, bo + n - 1, bi + n - 1, fi + n - 1))
    raw(V, faces, mat)


def window_bay(fr, a0, a1, y0, y1, d0, d1, w, yb, ys, mat, ring=None, flat=False):
    pierced(fr, a0, a1, y0, y1, d0, d1, ((a0 + a1) / 2, w, yb, ys), mat, flat=flat)
    if w >= 2.2 and yb > F + 1.0:
        # tall gallery windows are three lights divided by two stone mullions
        for k in (-1, 1):
            c = (a0 + a1) / 2 + k * w / 6
            box(fr, c - 0.09, c + 0.09, yb, ys, d0 + 0.02, d0 + 0.3, 'stone')
    if ring and not flat:
        arch_ring(fr, (a0 + a1) / 2, w / 2, w / 2 + 0.35, ys, d1 - 0.05, d1 + 0.12, ring, seg=10)


def blank(fr, a0, a1, y0, y1, d0, d1, mat):
    box(fr, a0, a1, y0, y1, d0, d1, mat)


def band(fr, a0, a1, y, h, d0, d1, mat='stone'):
    """String course / cornice band."""
    box(fr, a0, a1, y, y + h, d0, d1, mat)


def facade_rows(fr, a0, a1, rows, d0, d1, mat, bay=4.6, ring='brick'):
    """Fill a wall strip with rows of arched windows.  rows = [(y0, y1, w, sill, spring)...]."""
    L = a1 - a0
    if L < 1.0:
        for y0, y1, *_ in rows:
            blank(fr, a0, a1, y0, y1, d0, d1, mat)
        return
    nb = max(1, int(round(L / bay)))
    bw = L / nb
    for y0, y1, w, yb, ys in rows:
        ww = min(w, bw * 0.62)
        for k in range(nb):
            b0 = a0 + k * bw
            if ww < 0.5:
                blank(fr, b0, b0 + bw, y0, y1, d0, d1, mat)
            else:
                window_bay(fr, b0, b0 + bw, y0, y1, d0, d1, ww, yb, ys, mat, ring)


def ring_solid(cu, cv, r0, r1, y0, y1, sides, mat, sides_rot=0.0):
    """Annulus (parapet, cornice ring) about a vertical axis."""
    V = []
    for r, y in ((r1, y0), (r1, y1), (r0, y1), (r0, y0)):
        for j in range(sides):
            t = sides_rot + TAU * j / sides
            V.append((cu + r * math.cos(t), y, cv + r * math.sin(t)))
    faces = []
    for i in range(4):
        i1 = (i + 1) % 4
        for j in range(sides):
            j1 = (j + 1) % sides
            faces.append((i * sides + j, i * sides + j1, i1 * sides + j1, i1 * sides + j))
    raw(V, faces, mat)


def slab_slope(fr, a0, a1, d0, d1, ya, yb, th, mat):
    """Sloped slab (buttress cap, roof skin): underside from ya at d0 to yb at d1, thickness th."""
    q = [(a0, d0), (a1, d0), (a1, d1), (a0, d1)]
    lo = [ya, ya, yb, yb]
    hexa([fr.p(a, y, d) for (a, d), y in zip(q, lo)] + [fr.p(a, y + th, d) for (a, d), y in zip(q, lo)], mat)


def wall_frame(side):
    """Frames whose origin sits on each outer wall line of the main block (d = distance outside)."""
    return {'S': Fr(US, 0.0, (0.0, 1.0), (-1.0, 0.0)),
            'N': Fr(UN, 0.0, (0.0, -1.0), (1.0, 0.0)),
            'W': Fr(0.0, VW, (-1.0, 0.0), (0.0, -1.0)),
            'E': Fr(0.0, VE, (1.0, 0.0), (0.0, 1.0))}[side]


def buttress(fr, a0, a1, tiers, mat='plaster', niche=True, bands=(10.5,)):
    """Battered masonry buttress against a wall: tiers = [(depth out, top at the wall, fall)...],
    outermost first.  Each tier gets a sloped lead cap and blind arched niches on its face."""
    W = a1 - a0
    for k, (dout, top, fall) in enumerate(tiers):
        y_top, y_face = F + top, F + top - fall
        face_d = dout - (0.55 if niche else 0.0)
        slope_box(fr, a0, a1, -0.8, face_d, 0.0, y_top, y_top - fall * (face_d + 0.8) / (dout + 0.8), mat)
        slab_slope(fr, a0 - 0.18, a1 + 0.18, -0.8, dout + 0.25, y_top - 0.05, y_face - 0.05 - fall * 0.25 / (dout + 0.8), 0.32, 'lead')
        if niche:
            # outer face: 1-3 blind arched niches 0.55 m deep (real recesses, not paint)
            nn = max(1, min(3, int(W / 4.2)))
            cw = W / nn
            if k == 0:
                lower, base = 0.0, F + 1.4
            else:
                pd, pt, pf = tiers[k - 1]
                lower = F + pt - pf - 0.5
                base = F + pt - pf * (dout + 0.8) / (pd + 0.8) + 0.8
            for i in range(nn):
                c0 = a0 + i * cw
                nw = min(cw * 0.6, 3.2)
                sill = max(lower + 0.6, base)
                spring = y_face - nw / 2 - 1.2
                if spring - sill > 1.0:
                    pierced(fr, c0, c0 + cw, lower, y_face, face_d, dout, (c0 + cw / 2, nw, sill, spring), mat, glass=False)
                    arch_ring(fr, c0 + cw / 2, nw / 2, nw / 2 + 0.3, spring, dout - 0.02, dout + 0.1, 'brick', seg=10)
                else:
                    box(fr, c0, c0 + cw, lower, y_face, face_d, dout, mat)
        for b in bands:
            if F + b + 0.6 < y_face:
                box(fr, a0 - 0.2, a1 + 0.2, F + b, F + b + 0.35, -0.8, dout + 0.2, 'stone')


def wall_rows_main():
    """Aisle / gallery storeys of the long walls: (y0, y1, window width, sill, springing)."""
    return [(0.0, F + 10.5, 1.9, F + 3.6, F + 7.4),
            (F + 10.5, F + 18.5, 2.5, F + 11.6, F + 15.6),
            (F + 18.5, F + 24.0, 2.2, F + 19.2, F + 21.6)]


def long_wall(side, spans):
    fr = wall_frame(side)
    for a0, a1 in spans:
        facade_rows(fr, a0, a1, wall_rows_main(), 0.0, 0.8, 'plaster', bay=4.4)
    for a0, a1 in spans:
        for y in (F + 10.5, F + 18.5):
            band(fr, a0, a1, y - 0.18, 0.36, 0.0, 1.05)


# ------------------------------------------------------------------ ground: plinth under the whole outline
ring = [tuple(p) for p in M.spec['ring']]
prism(ring, 0.0, F + 0.25, 'stone')

# ------------------------------------------------------------------ main block: nave core and aisles
ubox(-14.15, 19.85, 0.0, F + 27.0, VW, VE, 'plaster')                  # nave core (under the upper works)
ubox(-14.15, 19.85, F + 27.0, F + 27.35, VW, VE, 'lead')
ubox(US + 0.8, -14.15, 0.0, F + 24.0, VW, VE, 'plaster')               # south aisle + gallery
ubox(19.85, UN - 0.8, 0.0, F + 24.0, VW, VE, 'plaster')                # north aisle + gallery
# long walls between the buttresses (the rest is covered by buttress masses)
long_wall('S', [(-34.3, -27.8), (-2.0, 0.5), (8.8, 16.0), (25.8, 32.8)])
long_wall('N', [(16.4, 22.9), (-1.4, 1.6), (-7.0, -6.5), (-37.7, -26.1)])
for side, (a0, a1) in (('S', (VW - 0.5, VE + 0.5)), ('N', (-VE - 0.5, -VW + 0.5))):
    fr = wall_frame(side)
    box(fr, a0, a1, F + 23.7, F + 24.3, -0.8, 1.35, 'stone')           # main cornice
    # gallery roofs: lead lean-to from the eaves up to the nave core, with standing seams
    d_in = (-14.15 - US) if side == 'S' else (UN - 19.85)
    slab_slope(fr, a0, a1, -d_in, 1.4, F + 27.1, F + 24.25, 0.35, 'lead')
    L = a1 - a0
    for k in range(1, int(L / 2.2)):
        a = a0 + k * L / int(L / 2.2)
        slab_slope(fr, a - 0.07, a + 0.07, -d_in, 1.4, F + 27.4, F + 24.55, 0.12, 'lead')

# ------------------------------------------------------------------ buttresses along the flanks
FS, FN, FE = wall_frame('S'), wall_frame('N'), wall_frame('E')
# south flank (a = v, d = metres south of the wall)
buttress(FS, -10.9, -2.0, [(18.1, 16.0, 5.0), (9.0, 30.0, 5.0)])          # south-west Byzantine buttress
buttress(FS, 0.5, 8.8, [(11.6, 14.0, 4.0)])
buttress(FS, 16.0, 25.8, [(10.7, 20.0, 4.0), (6.0, 31.0, 5.0)])           # south-east Byzantine buttress
buttress(FS, 32.8, 37.3, [(10.2, 12.0, 3.0)])
buttress(FS, 37.3, 45.5, [(13.0, 24.0, 13.0), (6.5, 30.0, 6.0)], 'stone', niche=False)  # Ottoman ashlar buttress at the SE corner
# north flank (a = -v)
buttress(FN, 1.6, 16.4, [(12.4, 18.0, 4.0), (7.0, 32.0, 5.0)])           # north-west Byzantine buttress
buttress(FN, -6.5, -1.4, [(9.9, 13.0, 3.0)])
buttress(FN, -26.1, -7.0, [(18.8, 14.0, 4.0), (10.0, 32.0, 6.0)])        # north-east Byzantine buttress
# east end (a = u, d = metres east of the wall), either side of the apse
buttress(FE, -35.8, -27.0, [(15.0, 20.0, 12.0), (7.0, 26.0, 5.0)], 'stone', niche=False)
buttress(FE, -19.0, -12.0, [(15.0, 22.0, 13.0), (7.5, 27.0, 5.0)], 'stone', niche=False)
buttress(FE, 14.5, 19.0, [(16.0, 20.0, 12.0)], 'stone', niche=False)
for a0, a1 in ((-27.0, -19.0), (-12.0, -6.75)):
    facade_rows(FE, a0, a1, wall_rows_main(), 0.0, 0.8, 'plaster', bay=4.2)
box(FE, -35.0, 19.0, F + 23.7, F + 24.3, -0.8, 1.2, 'stone')

# the four main piers step down over the gallery roofs to the outer walls
for side, fr in (('S', FS), ('N', FN)):
    d_tower = (-18.15 - US) if side == 'S' else (UN - 23.85)       # tower face, measured outward
    for vc in (V0 - 15.5, V0 + 15.5):
        a = vc if side == 'S' else -vc
        slope_box(fr, a - 4.3, a + 4.3, -d_tower, 0.5, F + 23.5, F + 31.6, F + 30.2, 'plaster')
        slab_slope(fr, a - 4.5, a + 4.5, -d_tower, 0.75, F + 31.55, F + 30.12, 0.3, 'lead')
        pierced(fr, a - 4.3, a + 4.3, F + 24.0, F + 30.2, 0.5, 1.0, (a, 4.0, F + 24.6, F + 27.2), 'plaster', glass=False)

# north-west Byzantine flying buttresses: two outer piers, open arches under the flyers and between
NP = Fr(UN + 8.8, 0.0, (0.0, -1.0), (1.0, 0.0))
for a0, a1 in ((39.0, 45.0), (22.9, 28.5)):
    buttress(NP, a0, a1, [(7.5, 19.0, 3.0)])
    vc = -(a0 + a1) / 2
    fly = Fr(UN, vc, (0.0, 1.0), (1.0, 0.0))                          # a along v, d along u
    pierced(Fr(UN, vc, (1.0, 0.0), (0.0, -1.0)), -0.8, 8.0, 0.0, F + 17.9, -1.5, 1.5,
            (3.6, 5.2, F + 0.35, F + 9.5), 'plaster', glass=False)
    slope_box(fly, -1.5, 1.5, -0.8, 8.0, F + 17.8, F + 22.5, F + 18.5, 'plaster')
    slab_slope(fly, -1.7, 1.7, -0.8, 8.2, F + 22.45, F + 18.45, 0.3, 'lead')
pierced(FN, 28.5, 39.0, 0.0, F + 15.0, 12.5, 15.5, (33.75, 6.4, F + 0.35, F + 8.8), 'plaster', glass=False)
box(FN, 28.3, 39.2, F + 15.0, F + 15.4, 12.3, 15.7, 'lead')

# ------------------------------------------------------------------ west end: inner narthex, exonarthex
ubox(US, UN, 0.0, F + 20.5, -45.8, VW, 'plaster')
WN = Fr(0.0, -45.8, (-1.0, 0.0), (0.0, -1.0))                             # a = -u, d = metres west
facade_rows(WN, -40.0, 34.3, [(F + 12.3, F + 20.5, 2.6, F + 13.9, F + 17.2)], 0.0, 0.7, 'plaster', bay=5.3)
box(WN, -40.3, 34.6, F + 20.3, F + 20.8, -0.3, 1.2, 'stone')
slab_slope(WN, -40.5, 34.8, -11.5, 1.3, F + 22.6, F + 20.6, 0.3, 'lead')
WC = Fr(0.0, VW, (-1.0, 0.0), (0.0, -1.0))                                # nave west wall over the narthex
facade_rows(WC, -19.85, 14.15, [(F + 22.3, F + 27.2, 2.3, F + 23.1, F + 25.2)], 0.0, 0.7, 'plaster', bay=4.9)

ubox(-19.8, 27.6, 0.0, F + 11.2, -50.6, -45.8, 'plaster')
WX = Fr(0.0, -50.6, (-1.0, 0.0), (0.0, -1.0))
bays = [(-19.8, -14.4), (-14.4, -9.0), (-6.0, -1.7), (0.7, 5.5), (7.9, 12.8), (15.1, 21.35), (21.35, 27.6)]
for u0, u1 in bays:
    main = u0 == 0.7
    window_bay(WX, -u1, -u0, 0.0, F + 5.6, 0.0, 0.7, 2.7 if main else 2.0, F + 0.3, F + (3.6 if main else 3.2), 'plaster', 'stone')
    window_bay(WX, -u1, -u0, F + 5.6, F + 11.2, 0.0, 0.7, 1.8, F + 6.4, F + 8.9, 'plaster', 'brick')
for u0, u1 in ((-9.0, -6.0), (-1.7, 0.7), (5.5, 7.9), (12.8, 15.1)):
    box(WX, -u1, -u0, 0.0, F + 11.2, 0.0, 0.7, 'plaster')
    slope_box(WX, -u1, -u0, 0.0, 4.9, 0.0, F + 9.6, F + 6.4, 'plaster')
    slab_slope(WX, -u1 - 0.15, -u0 + 0.15, 0.0, 5.1, F + 9.55, F + 6.35 - 0.13, 0.28, 'lead')
    band(WX, -u1 - 0.15, -u0 + 0.15, F + 5.4, 0.3, 0.0, 5.1)
box(WX, -27.9, 20.1, F + 11.0, F + 11.4, -0.2, 1.1, 'stone')
slab_slope(WX, -27.9, 20.1, -4.8, 1.0, F + 12.6, F + 11.1, 0.3, 'lead')
# terrace and steps in front of the imperial door (the ground falls towards the north-west)
ubox(-19.8, 27.6, 0.0, F + 0.25, -55.5, -51.3, 'stone')
for k in range(1, 4):
    ubox(-2.0, 8.2, 0.0, F + 0.25 - 0.62 * k, -55.5 - 0.45 * k, -55.0, 'stone')

# west corner blocks (Ottoman buttress masses that carry the two western minarets)
NWB = [(27.4, -64.9), (42.7, -65.2), (42.8, -59.1), (37.2, -59.0), (37.4, -51.7), (44.8, -51.9), (45.0, -45.0), (27.6, -45.8)]
prism(NWB, 0.0, F + 10.5, 'brick')
prism(NWB, F + 10.5, F + 10.9, 'lead')
SWB = [(-19.6, -65.2), (-28.9, -65.1), (-29.0, -62.5), (-41.8, -62.6), (-41.8, -52.0), (-34.3, -52.0), (-19.8, -51.3)]
prism(SWB, 0.0, F + 9.5, 'plaster')
prism(SWB, F + 9.5, F + 9.9, 'lead')
for pts, y in ((NWB, F + 10.5), (SWB, F + 9.5)):
    for (a, b), (c, d) in zip(pts, pts[1:] + pts[:1]):
        L = math.hypot(c - a, d - b)
        if L > 2.0:
            fr = Fr(a, b, ((c - a) / L, (d - b) / L), ((d - b) / L, -(c - a) / L))
            box(fr, -0.1, L + 0.1, y - 0.5, y, -0.35, 0.35, 'stone')

# south-west vestibule (the old south porch of the narthex)
ubox(-52.2, -34.3, 0.0, F + 12.5, -51.3, -34.2, 'plaster')
SV = Fr(-52.2, 0.0, (0.0, 1.0), (-1.0, 0.0))
facade_rows(SV, -51.3, -40.9, [(0.0, F + 6.5, 1.8, F + 2.2, F + 4.6), (F + 6.5, F + 12.5, 2.0, F + 7.3, F + 10.0)], 0.0, 0.7, 'plaster', bay=3.6)
box(SV, -40.9, -34.2, 0.0, F + 12.5, 0.0, 0.7, 'plaster')
ubox(-52.9, -34.3, 0.0, F + 12.5, -52.0, -51.3, 'plaster')
box(SV, -52.3, -33.6, F + 12.3, F + 12.8, -0.2, 1.1, 'stone')
slab_slope(Fr(0.0, -34.2, (1.0, 0.0), (0.0, -1.0)), -53.2, -34.0, -0.5, 18.2, F + 14.4, F + 12.6, 0.3, 'lead')

# the baptistery (now a sultan's tomb): square block, octagonal drum, lead dome
BC = (-51.55, -19.35)
ubox(-59.3, -43.8, 0.0, F + 12.5, -27.1, -10.9, 'plaster')
for fr, a0, a1 in ((Fr(-59.3, 0.0, (0.0, 1.0), (-1.0, 0.0)), -27.8, -10.9),
                   (Fr(0.0, -27.1, (-1.0, 0.0), (0.0, -1.0)), 43.1, 60.0)):
    facade_rows(fr, a0, a1, [(0.0, F + 6.0, 1.6, F + 2.4, F + 4.4), (F + 6.0, F + 12.5, 2.2, F + 7.2, F + 10.2)], 0.0, 0.7, 'plaster', bay=5.6)
    box(fr, a0 - 0.1, a1 + 0.1, F + 12.3, F + 12.9, -0.3, 1.05, 'stone')
ubox(-43.8, -34.3, 0.0, F + 10.0, -26.0, -12.6, 'plaster')
ubox(-44.0, -34.3, F + 10.0, F + 10.4, -26.2, -12.4, 'lead')
ubox(-59.9, -43.2, F + 12.5, F + 12.9, -27.7, -11.0, 'lead')
revolve(BC[0], BC[1], [(7.4, F + 12.9), (7.4, F + 16.2)], 8, 'plaster', rot=math.pi / 8, smooth=False)
for j in range(8):
    t = math.pi / 8 + TAU * (j + 0.5) / 8
    fr = Fr(BC[0], BC[1], (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))
    r_in = 7.4 * math.cos(math.pi / 8)
    window_bay(fr, -1.4, 1.4, F + 13.0, F + 16.1, r_in - 0.05, r_in + 0.55, 1.0, F + 13.5, F + 15.0, 'plaster')
ring_solid(BC[0], BC[1], 6.9, 8.0, F + 16.1, F + 16.5, 8, 'stone', math.pi / 8)
dome_prof = [(7.6 * math.cos(math.radians(t)), F + 16.4 + 4.6 * math.sin(math.radians(t))) for t in range(0, 90, 10)]
revolve(BC[0], BC[1], dome_prof, 48, 'lead', apex=F + 21.0)
revolve(BC[0], BC[1], [(0.35, F + 20.9), (0.35, F + 21.5), (0.12, F + 22.0), (0.3, F + 22.3), (0.12, F + 22.7)], 12, 'gold', apex=F + 23.3)

# low annex west of the baptistery, with a lead hipped roof
ubox(-71.5, -59.3, 0.0, F + 4.6, -34.0, -28.8, 'plaster')
PF = Fr(-72.2, 0.0, (0.0, 1.0), (-1.0, 0.0))
facade_rows(PF, -34.7, -28.1, [(0.0, F + 4.6, 1.3, F + 1.2, F + 3.0)], -0.7, 0.0, 'plaster', bay=3.3)
box(PF, -34.9, -27.9, F + 4.5, F + 4.9, -12.4, 0.2, 'stone')
for sgn in (-1, 1):
    fr = Fr(-66.0, -31.4, (1.0, 0.0), (0.0, float(sgn)))
    slab_slope(fr, -6.4, 6.4, -0.01, 3.7, F + 6.4, F + 4.85, 0.3, 'lead')

# south-east Ottoman annex (carries the red-brick minaret)
SEB = [(-34.3, 37.3), (-57.9, 36.8), (-58.2, 52.2), (-35.8, 53.1), (-34.3, 53.1)]
prism(SEB, 0.0, F + 8.0, 'stone')
prism(SEB, F + 8.0, F + 8.4, 'lead')

# ------------------------------------------------------------------ east end: the apse and the sultan's pavilion
APX = [(U0 - 9.6, VE - 1.0), (U0 - 9.6, VE + 1.5), (U0 - 4.4, VE + 6.5), (U0 + 4.4, VE + 6.5), (U0 + 9.6, VE + 1.5), (U0 + 9.6, VE - 1.0)]
APC = (U0, VE + 1.0)
inset = []
for (a, b) in APX:
    da, db = a - APC[0], b - APC[1]
    L = math.hypot(da, db)
    inset.append((a - 0.7 * da / L, b - 0.7 * db / L))
prism(inset, 0.0, F + 22.0, 'plaster')
for (a, b), (c, d) in zip(APX[1:4], APX[2:5]):
    L = math.hypot(c - a, d - b)
    t = ((c - a) / L, (d - b) / L)
    n = (t[1], -t[0])
    if n[0] * ((a + c) / 2 - APC[0]) + n[1] * ((b + d) / 2 - APC[1]) < 0:
        n = (-n[0], -n[1])
    fr = Fr(a, b, t, n)
    rows = [(0.0, F + 10.5, 2.0, F + 4.2, F + 8.0), (F + 10.5, F + 19.0, 2.6, F + 11.6, F + 15.6), (F + 19.0, F + 22.0, 0.0, 0, 0)]
    for y0, y1, w, yb, ys in rows:
        if w:
            window_bay(fr, 0.0, L, y0, y1, -0.7, 0.0, min(w, L * 0.55), yb, ys, 'plaster', 'brick')
        else:
            box(fr, 0.0, L, y0, y1, -0.7, 0.0, 'plaster')
    box(fr, -0.2, L + 0.2, F + 21.8, F + 22.4, -0.9, 0.5, 'stone')
revolve(APC[0], APC[1], [(10.3 * math.cos(math.radians(t)), F + 22.2 + 4.3 * math.sin(math.radians(t))) for t in range(0, 90, 10)],
        24, 'lead', th0=-math.pi / 2, th1=math.pi / 2, rot=math.pi / 2, apex=F + 26.5)

HK = [(18.5, 58.0), (18.1, 68.1), (29.7, 68.7), (39.5, 69.2), (39.5, 61.4), (46.8, 62.0), (46.6, 54.4), (45.1, 54.4), (44.9, 37.7), (40.9, 37.8), (40.0, 41.7), (18.5, 41.7)]
HKin = [(19.2, 58.0), (18.8, 67.4), (29.7, 68.0), (38.8, 68.5), (38.8, 60.7), (46.1, 61.3), (45.9, 54.4), (44.4, 54.4), (44.2, 37.7), (40.9, 37.8), (40.0, 41.7), (19.2, 41.7)]
prism(HKin, 0.0, F + 12.0, 'plaster')
prism(HK, F + 12.0, F + 12.5, 'stone')
prism(HKin, F + 12.5, F + 13.6, 'lead')
flat_rows = [(0.0, F + 6.0, 1.5, F + 2.2, F + 4.6), (F + 6.0, F + 12.0, 1.5, F + 7.4, F + 10.2)]
for fr, a0, a1 in ((Fr(0.0, 68.7, (1.0, 0.0), (0.0, 1.0)), 18.4, 39.5),
                   (Fr(46.6, 0.0, (0.0, -1.0), (1.0, 0.0)), -62.0, -54.4),
                   (Fr(44.9, 0.0, (0.0, -1.0), (1.0, 0.0)), -54.4, -41.0)):
    L = a1 - a0
    nb = max(1, int(round(L / 3.4)))
    for k in range(nb):
        b0 = a0 + k * L / nb
        for y0, y1, w, yb, ys in flat_rows:
            window_bay(fr, b0, b0 + L / nb, y0, y1, -0.7, 0.0, w, yb, ys, 'plaster', flat=True)

# ------------------------------------------------------------------ upper works: square under the dome, piers, tympana
ubox(U0 - 17.0, U0 + 17.0, F + 24.0, F + 41.0, V0 - 17.0, V0 + 17.0, 'plaster')
for fr in (Fr(U0, V0 - 17.0, (-1.0, 0.0), (0.0, -1.0)), Fr(U0, V0 + 17.0, (1.0, 0.0), (0.0, 1.0))):
    box(fr, -17.5, 17.5, F + 40.3, F + 41.0, -0.2, 0.55, 'stone')

# the tops of the four main piers stand in front of the arch feet (centres 31 m apart), so from
# outside each tympanum arch reads as a segment between two tall pink piers
TOWER_U = {'S': (U0 - 22.0, U0 - 9.0), 'N': (U0 + 9.0, U0 + 22.0)}
TOWER_V = ((V0 - 19.7, V0 - 11.3), (V0 + 11.3, V0 + 19.7))
for side, (ua, ub) in TOWER_U.items():
    for va, vb in TOWER_V:
        out_u = ua if side == 'S' else ub                               # the outward face
        inner = (ua + 0.55, ub) if side == 'S' else (ua, ub - 0.55)
        ubox(inner[0], inner[1], F + 24.0, F + 41.5, va + 0.5, vb - 0.5, 'plaster')
        fr = (Fr(ua, 0.0, (0.0, 1.0), (-1.0, 0.0)) if side == 'S' else Fr(ub, 0.0, (0.0, -1.0), (1.0, 0.0)))
        a0, a1 = (va, vb) if side == 'S' else (-vb, -va)
        pierced(fr, a0, a1, F + 24.0, F + 41.5, -0.55, 0.0, ((a0 + a1) / 2, 3.8, F + 28.5, F + 34.2), 'plaster', glass=False)
        arch_ring(fr, (a0 + a1) / 2, 1.9, 2.3, F + 34.2, -0.03, 0.12, 'brick', seg=12)
        # the round medallion near the top of each pier face (a local would name these)
        disc = []
        for j in range(20):
            t = TAU * j / 20
            disc.append(fr.p((a0 + a1) / 2 + 1.35 * math.cos(t), F + 38.9 + 1.35 * math.sin(t), -0.05))
        for j in range(20):
            t = TAU * j / 20
            disc.append(fr.p((a0 + a1) / 2 + 1.35 * math.cos(t), F + 38.9 + 1.35 * math.sin(t), 0.22))
        raw(disc, [tuple(reversed(range(20))), tuple(range(20, 40))] + [(j, (j + 1) % 20, (j + 1) % 20 + 20, j + 20) for j in range(20)], 'stone')
        # east/west faces of the pier get a tall blind niche too
        for fr2, b0, b1 in ((Fr(0.0, va, (-1.0, 0.0), (0.0, -1.0)), -ub, -ua), (Fr(0.0, vb, (1.0, 0.0), (0.0, 1.0)), ua, ub)):
            pierced(fr2, b0, b1, F + 24.0, F + 41.5, -0.5, 0.05, ((b0 + b1) / 2, 3.6, F + 29.0, F + 35.6), 'plaster', glass=False)
            arch_ring(fr2, (b0 + b1) / 2, 1.8, 2.2, F + 35.6, 0.02, 0.17, 'brick', seg=12)
        ubox(ua - 0.35, ub + 0.35, F + 41.3, F + 41.95, va - 0.35, vb + 0.35, 'stone')
        ubox(ua - 0.1, ub + 0.1, F + 41.95, F + 42.35, va - 0.1, vb + 0.1, 'lead')

for side in ('S', 'N'):
    T = Fr(U0 - 17.0, V0, (0.0, 1.0), (-1.0, 0.0)) if side == 'S' else Fr(U0 + 17.0, V0, (0.0, -1.0), (1.0, 0.0))
    # the great arch: a 3 m deep ring between the piers, open down to the gallery roof
    pierced(T, -15.8, 15.8, F + 24.0, F + 41.5, 0.9, 4.0, (0.0, 29.2, F + 24.3, F + 26.0), 'plaster', glass=False)
    arch_ring(T, 0.0, 14.6, 15.35, F + 26.0, 3.95, 4.2, 'stone', seg=28)
    # tympanum wall set back in the arch: 7 windows below, 5 above (red-ochre render)
    box(T, -15.8, 15.8, F + 24.0, F + 27.6, 0.0, 0.9, 'plaster_red')
    for a0, a1 in ((-15.8, -9.8), (9.8, 15.8)):
        box(T, a0, a1, F + 27.6, F + 32.6, 0.0, 0.9, 'plaster_red')
    for k in range(7):
        b0 = -9.8 + 2.8 * k
        window_bay(T, b0, b0 + 2.8, F + 27.6, F + 32.6, 0.0, 0.9, 1.55, F + 29.0, F + 31.4, 'plaster_red', 'stone')
    for a0, a1 in ((-15.8, -7.0), (7.0, 15.8)):
        box(T, a0, a1, F + 32.6, F + 37.4, 0.0, 0.9, 'plaster_red')
    for k in range(5):
        b0 = -7.0 + 2.8 * k
        window_bay(T, b0, b0 + 2.8, F + 32.6, F + 37.4, 0.0, 0.9, 1.5, F + 33.4, F + 35.6, 'plaster_red', 'stone')
    box(T, -15.8, 15.8, F + 37.4, F + 41.5, 0.0, 0.9, 'plaster_red')
    band(T, -15.8, 15.8, F + 32.45, 0.3, 0.0, 1.15)

# ------------------------------------------------------------------ the drum: 40 windows between 40 buttresses
revolve(U0, V0, [(15.3, F + 40.5), (15.3, F + 46.6)], 80, 'lead', smooth=False)
ring_solid(U0, V0, 14.9, 17.1, F + 40.4, F + 41.0, 80, 'stone')
for k in range(40):
    t = TAU * (k + 0.5) / 40
    fr = Fr(U0, V0, (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))
    pierced(fr, -1.27, 1.27, F + 41.0, F + 46.3, 15.25, 16.05, (0.0, 1.25, F + 41.9, F + 44.9), 'lead')
    t = TAU * k / 40
    fr = Fr(U0, V0, (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))
    slope_box(fr, -0.42, 0.42, 15.0, 16.95, F + 41.0, F + 47.9, F + 45.6, 'lead')
ring_solid(U0, V0, 15.1, 16.8, F + 46.3, F + 46.85, 80, 'stone')

# ------------------------------------------------------------------ the great dome: shallow lead cap with 40 ribs, gilded finial
DP = [(16.6 * math.cos(math.radians(t)), F + 46.8 + 9.5 * math.sin(math.radians(t))) for t in range(0, 88, 4)]
revolve(U0, V0, DP, 120, 'lead', apex=F + 56.3)
for k in range(40):
    t = TAU * k / 40
    pts = []
    for s in range(0, 76, 5):
        a = math.radians(s)
        r = 16.6 * math.cos(a) + 0.1
        pts.append((U0 + r * math.cos(t), F + 46.85 + 9.5 * math.sin(a) + 0.08, V0 + r * math.sin(t)))
    M.tube('rib', pts, 0.065, 'lead', sides=6)
revolve(U0, V0, [(1.9, F + 56.0), (1.9, F + 56.45), (1.3, F + 56.8)], 24, 'lead')


def alem(cu, cv, y0, s):
    prof = [(0.35, 0.0), (0.35, 0.4), (0.12, 0.6), (0.12, 0.9), (0.45, 1.1), (0.55, 1.35), (0.45, 1.6), (0.12, 1.8),
            (0.3, 2.0), (0.36, 2.2), (0.3, 2.4), (0.1, 2.6), (0.1, 3.0)]
    revolve(cu, cv, [(r * s, y0 + y * s) for r, y in prof], 14, 'gold', apex=y0 + 3.15 * s)
    arc = [(cu + 0.55 * s * math.cos(math.radians(a)), y0 + 3.75 * s + 0.55 * s * math.sin(math.radians(a)), cv)
           for a in range(200, 345, 12)]
    M.tube('crescent', arc, 0.07 * s, 'gold', sides=6)


alem(U0, V0, F + 56.7, 1.35)

# ------------------------------------------------------------------ semi-domes east and west, with their window drums
for sv, (th0, th1) in ((V0 - 15.8, (math.pi, TAU)), (V0 + 15.8, (0.0, math.pi))):
    revolve(U0, sv, [(15.4, F + 27.0), (15.4, F + 36.0)], 40, 'plaster', th0=th0, th1=th1, smooth=False)
    for i in range(5):
        t = th0 + (i + 0.5) * math.pi / 5
        fr = Fr(U0, sv, (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))
        pierced(fr, -1.9, 1.9, F + 27.2, F + 36.0, 15.35, 16.25, (0.0, 1.9, F + 31.8, F + 34.3), 'plaster')
        arch_ring(fr, 0.0, 0.95, 1.3, F + 34.3, 16.2, 16.35, 'brick', seg=10)
    for i in range(6):
        t = th0 + i * math.pi / 5
        fr = Fr(U0, sv, (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))
        slope_box(fr, -0.7, 0.7, 15.0, 17.6, F + 27.0, F + 37.4, F + 34.4, 'plaster')
        slab_slope(fr, -0.85, 0.85, 15.0, 17.8, F + 37.35, F + 34.3, 0.28, 'lead')
    SP = [(16.9 * math.cos(math.radians(a)), F + 36.0 + 5.2 * math.sin(math.radians(a))) for a in range(0, 88, 6)]
    revolve(U0, sv, SP, 60, 'lead', th0=th0, th1=th1, apex=F + 41.2)
    for i in range(1, 12):
        t = th0 + i * math.pi / 12
        pts = [(U0 + (16.9 * math.cos(math.radians(a)) + 0.08) * math.cos(t), F + 36.05 + 5.2 * math.sin(math.radians(a)) + 0.06,
                sv + (16.9 * math.cos(math.radians(a)) + 0.08) * math.sin(t)) for a in range(0, 70, 7)]
        M.tube('rib', pts, 0.12, 'lead', sides=6)

# exedrae: the four small half-domes on the diagonals of the nave
for scv, eu, ev in ((V0 - 15.8, U0 - 13.1, V0 - 27.5), (V0 - 15.8, U0 + 13.1, V0 - 27.5),
                    (V0 + 15.8, U0 - 13.1, V0 + 27.5), (V0 + 15.8, U0 + 13.1, V0 + 27.5)):
    phi = math.atan2(ev - scv, eu - U0)
    th0, th1 = phi - math.pi / 2, phi + math.pi / 2
    revolve(eu, ev, [(8.0, F + 22.0), (8.0, F + 30.8)], 24, 'plaster', th0=th0, th1=th1, smooth=False)
    for i in (-1, 0, 1):
        t = phi + i * math.pi / 3
        fr = Fr(eu, ev, (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))
        pierced(fr, -1.3, 1.3, F + 26.9, F + 30.8, 7.95, 8.7, (0.0, 1.4, F + 27.5, F + 29.4), 'plaster')
    for i in (-3, -1, 1, 3):
        t = phi + i * math.pi / 6
        fr = Fr(eu, ev, (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))
        slope_box(fr, -0.5, 0.5, 7.7, 9.6, F + 26.0, F + 31.9, F + 30.0, 'plaster')
        slab_slope(fr, -0.62, 0.62, 7.7, 9.75, F + 31.85, F + 29.9, 0.25, 'lead')
    EP = [(9.0 * math.cos(math.radians(a)), F + 30.8 + 3.6 * math.sin(math.radians(a))) for a in range(0, 88, 8)]
    revolve(eu, ev, EP, 32, 'lead', th0=th0, th1=th1, apex=F + 34.4)

# stair turrets with little lead domes at the four corners of the nave
for tu, tv in ((U0 - 20.5, V0 - 33.5), (U0 + 20.5, V0 - 33.5), (U0 - 20.5, V0 + 33.0), (U0 + 20.5, V0 + 33.0)):
    revolve(tu, tv, [(2.4, F + 23.0), (2.4, F + 32.5)], 24, 'plaster', smooth=False)
    revolve(tu, tv, [(2.7, F + 32.4), (2.7, F + 32.9)], 24, 'stone', smooth=False)
    revolve(tu, tv, [(2.6 * math.cos(math.radians(a)), F + 32.9 + 2.2 * math.sin(math.radians(a))) for a in range(0, 90, 10)],
            24, 'lead', apex=F + 35.1)
    alem(tu, tv, F + 35.0, 0.45)
    for k in range(3):
        t = TAU * k / 3 + 0.4
        fr = Fr(tu, tv, (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))
        pierced(fr, -0.75, 0.75, F + 27.0, F + 31.5, 2.35, 2.85, (0.0, 0.6, F + 28.2, F + 30.3), 'plaster')

# ------------------------------------------------------------------ the four minarets (deliberately not alike)
def fluted(cu, cv, r, y0, y1, flutes, mat, depth=0.06):
    """Shaft with shallow vertical flutes: alternating radius round a 2*flutes-gon."""
    n = 2 * flutes
    V = []
    for y in (y0, y1):
        for j in range(n):
            t = TAU * j / n
            rr = r * (1.0 - depth * (j % 2))
            V.append((cu + rr * math.cos(t), y, cv + rr * math.sin(t)))
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(j, (j + 1) % n, (j + 1) % n + n, j + n) for j in range(n)]
    raw(V, faces, mat)


def balcony(cu, cv, r_shaft, y, r_out, mat='stone'):
    """Serefe: stepped muqarnas corbel, floor and a pierced parapet of posts and rails."""
    prof = [(r_shaft, y - 1.9), (r_shaft + 0.12, y - 1.5), (r_shaft + 0.12, y - 1.35), (r_shaft + (r_out - r_shaft) * 0.45, y - 0.95),
            (r_shaft + (r_out - r_shaft) * 0.45, y - 0.8), (r_shaft + (r_out - r_shaft) * 0.8, y - 0.4), (r_out, y - 0.2), (r_out, y)]
    revolve(cu, cv, prof, 32, mat, smooth=False)
    ring_solid(cu, cv, r_out - 0.16, r_out, y + 0.95, y + 1.12, 32, mat)       # hand rail
    ring_solid(cu, cv, r_out - 0.16, r_out, y, y + 0.22, 32, mat)              # kerb
    for j in range(24):
        t = TAU * j / 24
        pu, pv = cu + (r_out - 0.08) * math.cos(t), cv + (r_out - 0.08) * math.sin(t)
        ubox(pu - 0.07, pu + 0.07, y + 0.2, y + 0.97, pv - 0.07, pv + 0.07, mat)


def cone(cu, cv, y0, r, h, sides=24):
    prof = [(r * 1.08, y0), (r * 1.08, y0 + 0.35), (r, y0 + 0.5), (r * 0.82, y0 + 0.5 + h * 0.3),
            (r * 0.55, y0 + 0.5 + h * 0.6), (r * 0.25, y0 + 0.5 + h * 0.85)]
    revolve(cu, cv, prof, sides, 'lead', apex=y0 + 0.5 + h)
    return y0 + 0.5 + h


def minaret_west(cu, cv):
    """Selim II / Murad III type: square stone base, faceted transition, fluted shaft, one serefe."""
    ubox(cu - 3.5, cu + 3.5, 0.0, F + 13.0, cv - 3.5, cv + 3.5, 'stone')
    ubox(cu - 3.8, cu + 3.8, F + 13.0, F + 13.5, cv - 3.8, cv + 3.8, 'stone')
    revolve(cu, cv, [(3.5 / math.cos(math.pi / 8), F + 13.5), (2.5, F + 24.0)], 8, 'stone', rot=math.pi / 8, smooth=False)
    revolve(cu, cv, [(2.65, F + 23.9), (2.65, F + 24.5)], 24, 'stone', smooth=False)
    fluted(cu, cv, 2.25, F + 24.4, F + 36.6, 16, 'stone')
    revolve(cu, cv, [(2.35, F + 30.0), (2.35, F + 30.4)], 24, 'stone', smooth=False)
    balcony(cu, cv, 2.2, F + 38.5, 3.1)
    revolve(cu, cv, [(1.85, F + 38.4), (1.85, F + 49.0)], 24, 'stone')
    revolve(cu, cv, [(2.05, F + 48.7), (2.05, F + 49.3)], 24, 'stone', smooth=False)
    top = cone(cu, cv, F + 49.2, 1.95, 7.8)
    alem(cu, cv, top - 0.1, 0.8)


def minaret_red(cu, cv):
    """Mehmed II: the oldest, red brick shaft on an octagonal stone pedestal, one serefe."""
    ubox(cu - 3.0, cu + 3.0, 0.0, F + 13.0, cv - 3.0, cv + 3.0, 'stone')
    revolve(cu, cv, [(3.0 / math.cos(math.pi / 8), F + 13.0), (2.3, F + 17.0)], 8, 'stone', rot=math.pi / 8, smooth=False)
    revolve(cu, cv, [(2.45, F + 16.9), (2.45, F + 17.4)], 20, 'stone', smooth=False)
    revolve(cu, cv, [(2.0, F + 17.3), (1.85, F + 35.4)], 20, 'brick')
    balcony(cu, cv, 1.85, F + 37.3, 2.55)
    revolve(cu, cv, [(1.6, F + 37.2), (1.6, F + 45.2)], 20, 'brick')
    revolve(cu, cv, [(1.75, F + 45.0), (1.75, F + 45.5)], 20, 'stone', smooth=False)
    top = cone(cu, cv, F + 45.4, 1.65, 9.0, 20)
    alem(cu, cv, top - 0.1, 0.65)


def minaret_north_east(cu, cv):
    """Bayezid II: the slender white one on a square base, a moulded ring, one serefe."""
    ubox(cu - 2.2, cu + 2.2, 0.0, F + 13.5, cv - 2.2, cv + 2.2, 'stone')
    ubox(cu - 2.45, cu + 2.45, F + 13.5, F + 13.9, cv - 2.45, cv + 2.45, 'stone')
    revolve(cu, cv, [(2.2 / math.cos(math.pi / 8), F + 13.9), (1.55, F + 16.5)], 8, 'stone', rot=math.pi / 8, smooth=False)
    fluted(cu, cv, 1.45, F + 16.4, F + 38.1, 12, 'stone', depth=0.07)
    revolve(cu, cv, [(1.62, F + 27.5), (1.62, F + 28.0)], 20, 'stone', smooth=False)
    balcony(cu, cv, 1.45, F + 40.0, 2.15)
    revolve(cu, cv, [(1.2, F + 39.9), (1.2, F + 46.2)], 20, 'stone')
    revolve(cu, cv, [(1.35, F + 46.0), (1.35, F + 46.5)], 20, 'stone', smooth=False)
    top = cone(cu, cv, F + 46.4, 1.3, 8.6, 20)
    alem(cu, cv, top - 0.1, 0.55)


minaret_west(-26.5, -58.4)          # south-west
minaret_west(35.0, -58.4)           # north-west
minaret_red(-52.0, 47.0)            # south-east
minaret_north_east(42.5, 45.0)      # north-east

M.finish(directory=(Path(tempfile.gettempdir()) / 'sr-landmarks' / 'hagia-sophia'))
