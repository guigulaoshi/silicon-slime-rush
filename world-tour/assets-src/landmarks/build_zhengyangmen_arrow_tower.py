"""Original Zhengyangmen Arrow Tower (正阳门箭楼) model, Beijing.

Visual references consulted (comparison only, nothing reused):
https://commons.wikimedia.org/wiki/File:Qian_Men_IMG_4273_Zhengyang_Gate_Arrow_Tower.jpg (north face, stairs)
https://commons.wikimedia.org/wiki/File:正阳门箭楼（南）.jpg (south face)
https://commons.wikimedia.org/wiki/File:正阳门箭楼（北）.jpg (north face)
https://commons.wikimedia.org/wiki/File:20130830-Beijing-Zhengyangmen(Qianmen)_正阳门箭楼_1.JPG
https://zh.wikipedia.org/wiki/正阳门 (platform 12 m, 94 arrow windows on E/S/W,
重檐歇山顶 灰筒瓦绿琉璃剪边, 1915 marble balustrades, projecting platforms, arched window hoods)

Layout, in the tool's (u across = south, y up, v along = west) frame, anchor = OSM centroid:
- brick platform 0-12 m over the OSM footprint (u -15.3..18, v +-30.1), battered faces,
  one gateway passage straight through it north-south (outer arches 7 m, door section 5.4 m);
- the 1915 zig-zag stairs against the platform's north face fill the footprint's north strip;
- main block 53 x 20 m at the platform's south edge: three rows of arrow windows, a pent eave,
  a set-back upper storey with the fourth row, then the double-eave hip-and-gable roof;
- north annex (抱厦) 41 x 12 m with its own hip-and-gable roof tucked under the pent eave.
Arrow windows: south 4 x 13 = 52; each side 4 x 4 on the block + 3 + 2 on the annex = 21; total 94.
Footprint and height stay owned by pipeline/landmarks.json.
Run: cd world-tour && Blender --background --python assets-src/landmarks/build_zhengyangmen_arrow_tower.py
Optional: -- --render-dir <directory>
"""
import argparse
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'zhengyangmen-arrow-tower'
QUADS = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]

# ---------------------------------------------------------------- dimensions (metres)
PLAT_TOP = 12.0
PLAT_S, PLAT_N, PLAT_V = 18.0, -15.3, 30.1       # platform faces at ground
BATTER = 0.4                                     # platform faces lean in 0.4 m over 12 m
BLOCK_S, BLOCK_N, BLOCK_V = 17.4, -2.6, 26.5     # main block outer walls
BLOCK_UC = (BLOCK_S + BLOCK_N) / 2
UPPER_SET = 2.8                                  # upper storey set back from the main walls
ANNEX_N, ANNEX_V = -14.7, 20.5
WIN_W = 1.5
ROWS_MAIN = [(14.3, 15.7), (17.6, 19.0), (20.9, 22.3)]
ROW_UPPER = (27.3, 28.5)
RIDGE_Y = 34.0                                   # roof surface at the main ridge line


def hexa(m, label, pts, mat):
    m.mesh(label, list(pts), QUADS, mat)


def aabb(m, label, u0, u1, y0, y1, v0, v1, mat):
    hexa(m, label, [(u0, y0, v0), (u1, y0, v0), (u1, y0, v1), (u0, y0, v1),
                    (u0, y1, v0), (u1, y1, v0), (u1, y1, v1), (u0, y1, v1)], mat)


def seg_box(m, label, a, b, w, h0, h1, mat):
    """Box of width w between two base points; heights are relative to each base point."""
    du, dv = b[0] - a[0], b[2] - a[2]
    L = math.hypot(du, dv)
    nu, nv = -dv / L * w / 2, du / L * w / 2

    def p(q, sg, h):
        return (q[0] + sg * nu, q[1] + h, q[2] + sg * nv)
    hexa(m, label, [p(a, -1, h0), p(b, -1, h0), p(b, 1, h0), p(a, 1, h0),
                    p(a, -1, h1), p(b, -1, h1), p(b, 1, h1), p(a, 1, h1)], mat)


class Face:
    """A wall face: s runs along the wall, d runs inward from the outer surface."""

    def __init__(self, origin, along, inward, lean=None):
        self.o, self.t, self.n, self.lean = origin, along, inward, lean or (lambda y: 0.0)

    def F(self, s, y, d):
        d = d + self.lean(y)
        return (self.o[0] + s * self.t[0] + d * self.n[0], y, self.o[1] + s * self.t[1] + d * self.n[1])

    def box(self, m, label, s0, s1, y0, y1, d0, d1, mat):
        F = self.F
        hexa(m, label, [F(s0, y0, d0), F(s1, y0, d0), F(s1, y0, d1), F(s0, y0, d1),
                        F(s0, y1, d0), F(s1, y1, d0), F(s1, y1, d1), F(s0, y1, d1)], mat)


def arc_band(m, label, F, sc, yc, ri, ro, d0, d1, mat, n=12, a0=0.0, a1=math.pi):
    V = []
    for k in range(n + 1):
        a = a0 + (a1 - a0) * k / n
        c, s = math.cos(a), math.sin(a)
        for r in (ri, ro):
            for d in (d0, d1):
                V.append(F(sc + r * c, yc + r * s, d))
    faces = []
    for k in range(n):
        i, j = 4 * k, 4 * (k + 1)
        faces += [(i, j, j + 2, i + 2), (i + 1, i + 3, j + 3, j + 1), (i, i + 1, j + 1, j), (i + 2, j + 2, j + 3, i + 3)]
    faces += [(0, 1, 3, 2), (4 * n, 4 * n + 2, 4 * n + 3, 4 * n + 1)]
    m.mesh(label, V, faces, mat)


def pierced_wall(m, label, face, length, y0, y1, thick, rows, mat, reveal=0.75, back='window_dark', frame=True):
    """Solid wall with rectangular openings of real depth; rows = [(yb, yt, [(s0, s1), ...])]."""
    y = y0
    for yb, yt, wins in rows:
        face.box(m, label, 0, length, y, yb, 0, thick, mat)
        edges = [0.0] + [x for w in sorted(wins) for x in w] + [length]
        for a, b in zip(edges[0::2], edges[1::2]):
            if b - a > 1e-3:
                face.box(m, label, a, b, yb, yt, 0, thick, mat)
        for s0, s1 in wins:
            face.box(m, label + ' opening back', s0, s1, yb, yt, reveal, reveal + 0.12, back)
            face.box(m, label, s0, s1, yb, yt, reveal + 0.12, thick, mat)
            if frame:   # red-painted timber frame of the arrow window, set inside the reveal
                for a0, a1, b0, b1 in ((s0, s0 + 0.14, yb, yt), (s1 - 0.14, s1, yb, yt),
                                       (s0, s1, yb, yb + 0.14), (s0, s1, yt - 0.14, yt)):
                    face.box(m, 'Arrow window frame', a0, a1, b0, b1, reveal - 0.1, reveal, 'paint_red')
        y = yt
    face.box(m, label, 0, length, y, y1, 0, thick, mat)


def window_hoods(m, face, centres, yt):
    """1915 Western-style semicircular hoods linked by a string course (rows 1 and 2)."""
    for sc in centres:
        arc_band(m, 'Arched window hood', face.F, sc, yt + 0.02, WIN_W / 2 + 0.12, WIN_W / 2 + 0.32, -0.16, 0.05, 'stucco', 12)
    face.box(m, 'Hood string course', min(centres) - 1.25, max(centres) + 1.25, yt - 0.06, yt + 0.1, -0.13, 0.05, 'stucco')


def win_spans(centres):
    return [(c - WIN_W / 2, c + WIN_W / 2) for c in centres]


def lin(a, b, n):
    return [a + (b - a) * i / n for i in range(n + 1)]


# ---------------------------------------------------------------- roofs
class Roof:
    """Four-sided eave ring (hip) with curved profile, lifted and swept corners.

    e is the horizontal inset from the eave line; the height runs from ye at e=0 to ytop at
    e=run (the ridge line of a hip-and-gable roof, or the wall line of a pent eave), flat at
    the eave and steep near the top.
    """

    def __init__(self, uc, vc, U0, V0, ye, ytop, run, a=0.5, lift=1.0, sweep=0.8, Lc=4.0, thick=0.35):
        self.uc, self.vc, self.U0, self.V0 = uc, vc, U0, V0
        self.ye, self.ytop, self.run, self.a = ye, ytop, run, a
        self.lift, self.sweep, self.Lc, self.thick = lift, sweep, Lc, thick

    def y(self, e):
        q = e / self.run
        return self.ye + (self.ytop - self.ye) * (self.a * q + (1 - self.a) * q * q)

    def k(self, u, v):
        cu = min(1.0, max(0.0, 1 - (self.U0 - abs(u - self.uc)) / self.Lc))
        cv = min(1.0, max(0.0, 1 - (self.V0 - abs(v - self.vc)) / self.Lc))
        return cu * cu * cv * cv

    def pt(self, side, f, e, bump=0.0):
        if side in 'SN':
            sg = 1 if side == 'S' else -1
            u = self.uc + sg * (self.U0 - e)
            h = self.V0 - e
            v = self.vc - h + 2 * h * f
        else:
            sg = 1 if side == 'W' else -1
            v = self.vc + sg * (self.V0 - e)
            h = self.U0 - e
            u = self.uc - h + 2 * h * f
        k = self.k(u, v)
        u += self.sweep * k * math.copysign(1, u - self.uc)
        v += self.sweep * k * math.copysign(1, v - self.vc)
        return (u, self.y(e) + self.lift * k + bump, v)

    def length(self, side):
        return 2 * (self.V0 if side in 'SN' else self.U0)

    def tangent(self, side):
        return (0.0, 1.0) if side in 'SN' else (1.0, 0.0)


def corrugated(m, label, fn, f0, f1, es, length, mat, thick, period=0.62, amp=0.13):
    """Closed roof slab whose top carries tube-tile rolls (valleys on both side edges)."""
    nper = max(1, round(length * (f1 - f0) / period))
    ncol = 2 * nper + 1
    rows = [[fn(f0 + (f1 - f0) * i / (ncol - 1), e, amp if i % 2 else 0.0) for i in range(ncol)] for e in es]
    m.patch(label, rows, (0, -thick, 0), mat)


def ring(m, roof, e1, sides='SNEW', green=0.9, nrows=7):
    for side in sides:
        fn = (lambda sd: (lambda f, e, bump: roof.pt(sd, f, e, bump)))(side)
        L = roof.length(side)
        corrugated(m, 'Green glazed eave trim (剪边)', fn, 0, 1, lin(0, green, 2), L, 'tile_green', roof.thick)
        corrugated(m, 'Grey tube-tile slope', fn, 0, 1, lin(green, e1, nrows), L, 'tile_grey', roof.thick)


def hip_ridges(m, roof, e1, beasts=5):
    for side, f in (('S', 0), ('S', 1), ('N', 0), ('N', 1)):
        pts = [roof.pt(side, f, e, 0.26) for e in lin(-0.3, e1, 10)]
        m.tube('Hip ridge', pts, 0.22, 'tile_green', 6)
        tip = roof.pt(side, f, -0.4, 0.1)
        aabb(m, 'Corner beast cap (套兽)', tip[0] - 0.22, tip[0] + 0.22, tip[1] - 0.3, tip[1] + 0.15, tip[2] - 0.22, tip[2] + 0.22, 'tile_green')
        for i in range(beasts):
            p = roof.pt(side, f, 0.35 + 0.5 * i, 0.45)
            s = 0.2 if i else 0.26
            aabb(m, 'Ridge beast', p[0] - s / 2, p[0] + s / 2, p[1], p[1] + (0.42 if i else 0.52), p[2] - s / 2, p[2] + s / 2, 'tile_green')


def hip_gable(m, roof, d, gable_over=0.55, finial=0.85):
    """Upper part of a 歇山 roof: two slopes to the main ridge, red gable pediments, ridges."""
    Vg = roof.V0 - d + gable_over
    fg = 0.75 / (2 * Vg)
    es = lin(d, roof.run, 8)
    for sg in (1, -1):
        def fn(f, e, bump, sg=sg):
            return (roof.uc + sg * (roof.U0 - e), roof.y(e) + bump, roof.vc - Vg + 2 * Vg * f)
        for f0, f1, mat in ((0, fg, 'tile_green'), (fg, 1 - fg, 'tile_grey'), (1 - fg, 1, 'tile_green')):
            corrugated(m, 'Gable slope', fn, f0, f1, es, 2 * Vg, mat, roof.thick)
        for vs in (-1, 1):   # 垂脊 down each gable edge
            pts = [(roof.uc + sg * (roof.U0 - e), roof.y(e) + 0.24, roof.vc + vs * (Vg - 0.3)) for e in lin(d, roof.run, 6)]
            m.tube('Gable ridge', pts, 0.18, 'tile_green', 6)
    for vs in (-1, 1):       # red gable pediments (山花) under the overhang
        v = roof.vc + vs * (roof.V0 - d - 0.05)
        top = [(roof.uc + (roof.U0 - e), roof.y(e) - roof.thick + 0.05, v) for e in lin(d, roof.run, 8)]
        top += [(roof.uc - (roof.U0 - e), roof.y(e) - roof.thick + 0.05, v) for e in lin(roof.run, d, 8)[1:]]
        yb = roof.y(d) - 0.7
        outline = top + [(roof.uc - (roof.U0 - d), yb, v), (roof.uc + (roof.U0 - d), yb, v)]
        m.shell('Gable pediment (山花)', outline, (0, 0, -vs * 0.3), 'paint_red')
    yt = roof.ytop
    aabb(m, 'Main ridge', roof.uc - 0.34, roof.uc + 0.34, yt - 0.25, yt + 0.62, roof.vc - Vg + 0.1, roof.vc + Vg - 0.1, 'tile_green')
    aabb(m, 'Main ridge cap', roof.uc - 0.42, roof.uc + 0.42, yt + 0.55, yt + 0.72, roof.vc - Vg + 0.1, roof.vc + Vg - 0.1, 'tile_green')
    for vs in (-1, 1):       # dragon-head ridge finials (正吻)
        v = roof.vc + vs * (Vg - 0.6)
        base = yt + 0.3
        aabb(m, 'Ridge finial (正吻) body', roof.uc - 0.3, roof.uc + 0.3, base, base + finial, v - 0.5, v + 0.5, 'tile_green')
        curl = [(roof.uc, base + finial * (0.55 + 0.45 * math.sin(a)), v - vs * (0.55 - 0.55 * math.cos(a))) for a in lin(0.2, 2.8, 8)]
        m.tube('Ridge finial curled tail', curl, 0.2, 'tile_green', 6)
        aabb(m, 'Ridge finial jaw', roof.uc - 0.34, roof.uc + 0.34, base + 0.1, base + 0.55, v + vs * 0.45 - 0.3, v + vs * 0.45 + 0.3, 'tile_green')


def rafters(m, roof, side, overhang, spacing=0.42):
    """Two layers of rafter ends (飞椽 over 檐椽) under the eave, fanning at the corners."""
    L = roof.length(side)
    n = int(L / spacing)
    tu, tv = roof.tangent(side)
    t = roof.thick
    for i in range(1, n):
        f = i / n
        for e0, e1, h0, h1, w, mat in ((-0.12, 1.0, -0.15, 0.0, 0.13, 'paint_green'),
                                       (0.35, overhang, -0.33, -0.17, 0.15, 'paint_blue')):
            a, b = roof.pt(side, f, e0), roof.pt(side, f, e1)
            P = []
            for h in (h0, h1):
                for q, sg in ((a, -1), (b, -1), (b, 1), (a, 1)):
                    P.append((q[0] + sg * tu * w / 2, q[1] - t + h, q[2] + sg * tv * w / 2))
            hexa(m, 'Rafter', P, mat)


def eave_band(m, face, length, yb, ytop):
    """Painted architraves (额枋), bracket sets (斗栱) and the red board behind them."""
    face.box(m, 'Lower architrave', -0.1, length + 0.1, yb, yb + 0.24, -0.14, 0.02, 'paint_green')
    face.box(m, 'Upper architrave', -0.1, length + 0.1, yb + 0.24, yb + 0.5, -0.16, 0.02, 'paint_blue')
    face.box(m, 'Bracket board', 0, length, yb + 0.5, ytop, -0.05, 0.02, 'paint_red')
    y0 = yb + 0.5
    n = max(1, int(length / 1.3))
    for i in range(n):
        s = (i + 0.5) * length / n
        face.box(m, 'Dougong block', s - 0.2, s + 0.2, y0, y0 + 0.2, -0.3, 0.0, 'paint_green')
        face.box(m, 'Dougong arm', s - 0.55, s + 0.55, y0 + 0.2, y0 + 0.38, -0.25, -0.05, 'paint_blue')
        face.box(m, 'Dougong lever', s - 0.1, s + 0.1, y0 + 0.2, y0 + 0.38, -0.75, 0.0, 'paint_green')
        face.box(m, 'Dougong arm', s - 0.7, s + 0.7, y0 + 0.38, y0 + 0.56, -0.7, -0.48, 'paint_blue')
        face.box(m, 'Dougong lever', s - 0.1, s + 0.1, y0 + 0.38, y0 + 0.56, -1.15, 0.0, 'paint_green')
    face.box(m, 'Eave purlin beam', 0, length, y0 + 0.56, y0 + 0.74, -1.15, -0.95, 'paint_blue')


def outline_faces(U0, U1, V):
    return [(Face((U1, -V), (0, 1), (-1, 0)), 2 * V), (Face((U0, V), (0, -1), (1, 0)), 2 * V),
            (Face((U0, -V), (1, 0), (0, 1)), U1 - U0), (Face((U1, V), (-1, 0), (0, -1)), U1 - U0)]


# ---------------------------------------------------------------- balustrades and corbels
def balustrade(m, a, b, spacing=1.9, mat='marble'):
    """Marble balustrade: sill, posts with caps, low panels, balusters, handrail (slopes allowed)."""
    du, dv = b[0] - a[0], b[2] - a[2]
    L = math.hypot(du, dv)
    tu, tv = du / L, dv / L
    n = max(1, round(L / spacing))

    def lerp(t):
        return (a[0] + du * t, a[1] + (b[1] - a[1]) * t, a[2] + dv * t)

    def span(c, r):
        return (c[0] - tu * r, c[1], c[2] - tv * r), (c[0] + tu * r, c[1], c[2] + tv * r)
    seg_box(m, 'Balustrade sill', a, b, 0.36, 0, 0.16, mat)
    for i in range(n + 1):
        c = lerp(i / n)
        seg_box(m, 'Balustrade post', *span(c, 0.12), 0.24, 0, 1.2, mat)
        seg_box(m, 'Balustrade post cap', *span(c, 0.15), 0.3, 1.2, 1.4, mat)
    for i in range(n):
        p, q = lerp(i / n), lerp((i + 1) / n)
        seg_box(m, 'Balustrade panel', p, q, 0.12, 0.16, 0.62, mat)
        seg_box(m, 'Balustrade handrail', p, q, 0.16, 0.86, 1.02, mat)
        for t in (0.3, 0.7):
            c = tuple(p[k] + (q[k] - p[k]) * t for k in range(3))
            seg_box(m, 'Balustrade baluster', *span(c, 0.07), 0.12, 0.62, 0.86, mat)


def corbel(m, u_wall, out, v, y_top, height, width, big=False):
    """Scrolled marble balcony corbel in the u-y plane; out = +1 south / -1 north."""
    n = 10 if big else 5
    depth = 2.2 if big else 1.75
    pts = []
    for i in range(n + 1):     # underside curve from the tip back to the wall
        t = i / n
        uu = depth * (1 - t) + (0.18 * math.sin(t * math.pi * 3) if big else 0.0)
        yy = y_top - 0.3 - height * (0.15 + 0.85 * math.sin(t * math.pi / 2) ** 1.4)
        pts.append((u_wall + out * uu, yy, v - width / 2))
    pts += [(u_wall - out * 0.3, y_top - height - 0.1, v - width / 2), (u_wall - out * 0.3, y_top, v - width / 2),
            (u_wall + out * depth, y_top, v - width / 2)]
    m.shell('Balcony corbel', pts, (0, 0, width), 'marble')


# ---------------------------------------------------------------- build
def build():
    m = Model(ID)
    # Colours are linear (glTF baseColorFactor), converted from sRGB samples of the reference photos.
    for key, color, metal, rough in [
            ('brick', (.314, .287, .238), 0, .9), ('brick_dark', (.162, .168, .168), 0, .92),
            ('marble', (.753, .730, .658), 0, .5), ('stucco', (.807, .791, .730), 0, .7),
            ('tile_grey', (.115, .122, .122), 0, .7), ('tile_green', (.021, .141, .071), .05, .38),
            ('paint_red', (.305, .017, .010), 0, .55), ('paint_blue', (.013, .045, .188), 0, .55),
            ('paint_green', (.017, .115, .080), 0, .55), ('stone', (.402, .381, .328), 0, .8),
            ('window_dark', (.02, .018, .016), 0, .9)]:
        m.material(key, color, metal, rough)
    b = BATTER / PLAT_TOP

    # --- platform (城台): two battered masses either side of the passage, vaults over it
    for vs in (-1, 1):
        hexa(m, 'Platform mass', [
            (PLAT_S, 0, vs * 3.5), (PLAT_S, 0, vs * PLAT_V), (PLAT_N, 0, vs * PLAT_V), (PLAT_N, 0, vs * 3.5),
            (PLAT_S - BATTER, PLAT_TOP, vs * 3.5), (PLAT_S - BATTER, PLAT_TOP, vs * (PLAT_V - BATTER)),
            (PLAT_N + BATTER, PLAT_TOP, vs * (PLAT_V - BATTER)), (PLAT_N + BATTER, PLAT_TOP, vs * 3.5)], 'brick_dark')
        aabb(m, 'Door section jamb', 4.0, 8.0, 0, PLAT_TOP, vs * 2.7, vs * 3.5, 'brick_dark')
        aabb(m, 'Gate leaf (open)', 8.05, 10.75, 0, 3.85, vs * 3.28, vs * 3.46, 'paint_red')
        for k in range(4):
            aabb(m, 'Gate leaf iron band', 8.0, 10.8, 0.5 + k * 0.95, 0.62 + k * 0.95, vs * 3.22, vs * 3.3, 'window_dark')

    def arch_block(label, uf, ub, w, spring, n=18):
        V, r = [], w / 2
        for k in range(n + 1):
            th = math.pi * k / n
            v, y = -r * math.cos(th), spring + r * math.sin(th)
            V += [(uf(y), y, v), (ub, y, v), (uf(PLAT_TOP), PLAT_TOP, v), (ub, PLAT_TOP, v)]
        faces = []
        for k in range(n):
            i, j = 4 * k, 4 * (k + 1)
            faces += [(i, j, j + 2, i + 2), (i + 1, i + 3, j + 3, j + 1), (i, i + 1, j + 1, j), (i + 2, j + 2, j + 3, i + 3)]
        faces += [(0, 2, 3, 1), (4 * n, 4 * n + 1, 4 * n + 3, 4 * n + 2)]
        m.mesh(label, V, faces, 'brick_dark')
    arch_block('South gateway vault', lambda y: PLAT_S - b * y, 8.0, 7.0, 3.4)
    arch_block('Door section vault', lambda y: 8.0, 4.0, 5.4, 2.8)
    arch_block('North gateway vault', lambda y: PLAT_N + b * y, 4.0, 7.0, 3.4)
    fS = Face((PLAT_S, 0.0), (0, 1), (-1, 0), lambda y: b * y)
    fN = Face((PLAT_N, 0.0), (0, 1), (1, 0), lambda y: b * y)
    for f in (fS, fN):
        arc_band(m, 'Gateway voussoir ring (券)', f.F, 0, 3.4, 3.5, 4.2, -0.1, 0.3, 'brick_dark', 18)
        arc_band(m, 'Gateway header ring (伏)', f.F, 0, 3.4, 4.25, 4.5, -0.06, 0.3, 'brick_dark', 18)
        for vs in (-1, 1):
            f.box(m, 'Arch impost', vs * 3.5 - 0.35, vs * 3.5 + 0.35, 3.2, 3.45, -0.12, 0.3, 'stone')
            f.box(m, 'Plinth course', vs * 3.5, vs * (PLAT_V + 0.1), 0, 0.8, -0.14, 0.3, 'stone')
    fS.box(m, 'Blank stone plaque frame', -1.6, 1.6, 8.7, 10.1, -0.22, 0.3, 'stone')
    fS.box(m, 'Blank stone plaque', -1.35, 1.35, 8.9, 9.9, -0.28, 0.3, 'stone')
    for vs in (-1, 1):
        fE = Face((PLAT_S, vs * PLAT_V), (-1, 0), (0, -vs), lambda y: b * y)
        fE.box(m, 'Plinth course', -0.1, PLAT_S - PLAT_N + 0.1, 0, 0.8, -0.14, 0.3, 'stone')
        fE.box(m, 'Platform coping', 0.3, PLAT_S - PLAT_N - 0.3, 11.55, 11.85, -0.12, 0.3, 'brick_dark')
    fN.box(m, 'Platform coping', -PLAT_V + 0.4, PLAT_V - 0.4, 11.55, 11.85, -0.12, 0.3, 'brick_dark')

    # --- zig-zag stairs against the north face (1915), filling the footprint's north strip
    UO0, UO1, UI1 = -18.1, -16.7, PLAT_N + BATTER + 0.05
    n_steps = 34
    for vs in (-1, 1):
        for i in range(n_steps):    # lower flight: ground at the corner rising toward the centre
            va, vb = 29.9 - 17.3 * i / n_steps, 29.9 - 17.3 * (i + 1) / n_steps
            aabb(m, 'Lower stair flight', UO0, UO1, 0, 6.0 * (i + 1) / n_steps, vs * vb, vs * va, 'brick_dark')
        for i in range(n_steps):    # upper flight: landing back out to the platform top
            va, vb = 12.6 + 16.8 * i / n_steps, 12.6 + 16.8 * (i + 1) / n_steps
            aabb(m, 'Upper stair flight', UO1, UI1, 0, 6.0 + 6.0 * (i + 1) / n_steps, vs * va, vs * vb, 'brick_dark')
        aabb(m, 'Stair landing', UO0, UI1, 0, 6.0, vs * 9.4, vs * 12.6, 'brick_dark')
        aabb(m, 'Stair head', UO1, UI1, 0, PLAT_TOP, vs * 29.4, vs * PLAT_V, 'brick_dark')
        balustrade(m, (-17.95, 0.3, vs * 29.6), (-17.95, 6.0, vs * 12.7))
        balustrade(m, (-17.95, 6.0, vs * 12.6), (-17.95, 6.0, vs * 9.5))
        balustrade(m, (-17.95, 6.0, vs * 9.5), (-15.2, 6.0, vs * 9.5))
        balustrade(m, (-16.55, 6.1, vs * 12.7), (-16.55, 12.0, vs * 29.4))
        balustrade(m, (-14.75, PLAT_TOP, vs * 10.2), (-14.75, PLAT_TOP, vs * 28.0))

    # --- south balcony (1915): marble slab on corbels along the whole south face
    aabb(m, 'South balcony slab', BLOCK_S - 0.1, 19.75, 11.78, 12.12, -30.2, 30.2, 'marble')
    aabb(m, 'South balcony moulding', 17.5, 19.9, 11.62, 11.8, -30.3, 30.3, 'marble')
    balustrade(m, (19.55, 12.12, -30.0), (19.55, 12.12, 30.0), 2.0)
    for vs in (-1, 1):
        balustrade(m, (19.55, 12.12, vs * 30.0), (17.0, 12.0, vs * 29.55))
        balustrade(m, (17.0, PLAT_TOP, vs * 29.55), (-14.7, PLAT_TOP, vs * 29.55), 2.1)
        corbel(m, PLAT_S - BATTER, 1, vs * 29.2, 11.8, 2.6, 0.7, True)
    for k in range(-8, 9):
        corbel(m, PLAT_S - BATTER, 1, k * 3.5, 11.8, 1.3, 0.34)
    # --- north balcony over the gateway
    aabb(m, 'North balcony slab', -17.6, PLAT_N + BATTER + 0.05, 11.78, 12.12, -9.6, 9.6, 'marble')
    aabb(m, 'North balcony moulding', -17.75, PLAT_N + 0.3, 11.62, 11.8, -9.7, 9.7, 'marble')
    balustrade(m, (-17.45, 12.12, -9.5), (-17.45, 12.12, 9.5), 2.0)
    for vs in (-1, 1):
        balustrade(m, (-17.45, 12.12, vs * 9.5), (-15.0, 12.0, vs * 9.5))
        corbel(m, PLAT_N + BATTER, -1, vs * 9.1, 11.8, 2.6, 0.8, True)
    for v in (-6.3, -3.2, 0.0, 3.2, 6.3):
        corbel(m, PLAT_N + BATTER, -1, v, 11.8, 1.2, 0.34)

    # --- main block walls with three rows of arrow windows
    T = 2.0
    wall_top_main = 25.35
    s_centres = [BLOCK_V + 3.5 * (k - 6) for k in range(13)]
    side_centres = [u - (BLOCK_N + T) for u in (BLOCK_UC - 6.3, BLOCK_UC - 2.1, BLOCK_UC + 2.1, BLOCK_UC + 6.3)]
    fSouth = Face((BLOCK_S, -BLOCK_V), (0, 1), (-1, 0))
    fNorth = Face((BLOCK_N, -BLOCK_V), (0, 1), (1, 0))
    pierced_wall(m, 'Main block south wall', fSouth, 2 * BLOCK_V, 11.9, wall_top_main, T,
                 [(yb, yt, win_spans(s_centres)) for yb, yt in ROWS_MAIN], 'brick')
    pierced_wall(m, 'Main block north wall', fNorth, 2 * BLOCK_V, 11.9, wall_top_main, T, [], 'brick')
    for yb, yt in ROWS_MAIN[:2]:
        window_hoods(m, fSouth, s_centres, yt)
    for vs in (-1, 1):
        fSide = Face((BLOCK_N + T, vs * BLOCK_V), (1, 0), (0, -vs))
        pierced_wall(m, 'Main block side wall', fSide, BLOCK_S - BLOCK_N - 2 * T, 11.9, wall_top_main, T,
                     [(yb, yt, win_spans(side_centres)) for yb, yt in ROWS_MAIN], 'brick')
        for yb, yt in ROWS_MAIN[:2]:
            window_hoods(m, fSide, side_centres, yt)
    for f, L in outline_faces(BLOCK_N, BLOCK_S, BLOCK_V):
        eave_band(m, f, L, 23.7, wall_top_main)

    # --- pent eave (腰檐) around the main block
    pent_run = 2.8 + UPPER_SET
    pent = Roof(BLOCK_UC, 0.0, (BLOCK_S - BLOCK_N) / 2 + 2.8, BLOCK_V + 2.8, 24.7, 26.9, pent_run,
                a=0.6, lift=0.5, sweep=0.4, Lc=4.0, thick=0.3)
    ring(m, pent, pent_run, nrows=6)
    hip_ridges(m, pent, pent_run, 4)
    for side in 'SNEW':
        rafters(m, pent, side, 2.8)

    # --- upper storey with the fourth row of arrow windows
    Tu = 1.0
    US, UN, UV = BLOCK_S - UPPER_SET, BLOCK_N + UPPER_SET, BLOCK_V - UPPER_SET
    up_top = 30.4
    u_centres = [UV + 3.5 * (k - 6) for k in range(13)]
    up_side = [u - (UN + Tu) for u in (BLOCK_UC - 4.8, BLOCK_UC - 1.6, BLOCK_UC + 1.6, BLOCK_UC + 4.8)]
    pierced_wall(m, 'Upper storey south wall', Face((US, -UV), (0, 1), (-1, 0)), 2 * UV, 26.0, up_top, Tu,
                 [(ROW_UPPER[0], ROW_UPPER[1], win_spans(u_centres))], 'brick', reveal=0.55)
    pierced_wall(m, 'Upper storey north wall', Face((UN, -UV), (0, 1), (1, 0)), 2 * UV, 26.0, up_top, Tu, [], 'brick')
    for vs in (-1, 1):
        pierced_wall(m, 'Upper storey side wall', Face((UN + Tu, vs * UV), (1, 0), (0, -vs)), US - UN - 2 * Tu, 26.0, up_top, Tu,
                     [(ROW_UPPER[0], ROW_UPPER[1], win_spans(up_side))], 'brick', reveal=0.55)
    for f, L in outline_faces(UN, US, UV):
        eave_band(m, f, L, 29.0, up_top)

    # --- upper roof: hip-and-gable (重檐歇山, upper eave)
    U0 = (US - UN) / 2 + 3.1
    upper = Roof(BLOCK_UC, 0.0, U0, UV + 3.1, 29.9, RIDGE_Y, U0, a=0.5, lift=0.55, sweep=0.45, Lc=4.0)
    ring(m, upper, 4.0)
    hip_ridges(m, upper, 4.0, 5)
    hip_gable(m, upper, 4.0)
    for side in 'SNEW':
        rafters(m, upper, side, 3.1)

    # --- north annex (抱厦)
    Ta = 1.5
    ann_top = 20.4
    fAN = Face((ANNEX_N, -ANNEX_V), (0, 1), (1, 0))
    pierced_wall(m, 'Annex north wall', fAN, 2 * ANNEX_V, 11.9, ann_top, Ta,
                 [(16.0, 18.4, [(ANNEX_V - 1.2, ANNEX_V + 1.2)])], 'brick', reveal=0.45, frame=False)
    for k in range(6):   # red lattice of the central window
        s = ANNEX_V - 1.2 + 2.4 * k / 5
        fAN.box(m, 'Window lattice', s - 0.05, s + 0.05, 16.0, 18.4, 0.3, 0.45, 'paint_red')
    for k in range(5):
        y = 16.0 + 2.4 * k / 4
        fAN.box(m, 'Window lattice', ANNEX_V - 1.2, ANNEX_V + 1.2, y - 0.05, y + 0.05, 0.3, 0.45, 'paint_red')
    for vs in (-1, 1):
        fSide = Face((ANNEX_N + Ta, vs * ANNEX_V), (1, 0), (0, -vs))
        r1 = [u - (ANNEX_N + Ta) for u in (-11.3, -8.4, -5.5)]
        r2 = [u - (ANNEX_N + Ta) for u in (-9.85, -6.95)]
        pierced_wall(m, 'Annex side wall', fSide, BLOCK_N - ANNEX_N - Ta, 11.9, ann_top, Ta,
                     [(*ROWS_MAIN[0], win_spans(r1)), (*ROWS_MAIN[1], win_spans(r2))], 'brick')
        window_hoods(m, fSide, r1, ROWS_MAIN[0][1])
        window_hoods(m, fSide, r2, ROWS_MAIN[1][1])
    for f, L in [(fAN, 2 * ANNEX_V), (Face((ANNEX_N, -ANNEX_V), (1, 0), (0, 1)), BLOCK_N - ANNEX_N),
                 (Face((BLOCK_N, ANNEX_V), (-1, 0), (0, -1)), BLOCK_N - ANNEX_N)]:
        eave_band(m, f, L, 19.1, ann_top)
    aU0 = (BLOCK_N - ANNEX_N) / 2 + 2.4
    annex = Roof((ANNEX_N + BLOCK_N) / 2, 0.0, aU0, ANNEX_V + 2.4, 20.0, 23.6, aU0,
                 a=0.5, lift=0.45, sweep=0.35, Lc=3.0, thick=0.3)
    ring(m, annex, 3.0, nrows=5)
    hip_ridges(m, annex, 3.0, 4)
    hip_gable(m, annex, 3.0, finial=0.6)
    for side in 'NEW':
        rafters(m, annex, side, 2.4)
    return m


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--render-dir')
    args = parser.parse_args(argv)
    build().finish(directory=Path(args.render_dir) if args.render_dir else None)
