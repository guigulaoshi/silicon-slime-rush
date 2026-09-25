"""Zhengyangmen (Qianmen) gate tower on its city-wall platform, south end of Tiananmen Square.

Original geometry built from public photographs (Wikimedia Commons: "Zhengyangmen (gatehouse)
2010 April", "Zhengyangmen Gate 20160826", "20251026 Zhengyangmen", "Zhengyangmen gatehouse",
"Beijing Zhengyangmen ChenglouSide") and the published dimensions: tower seven bays by three,
36.7 m by 16.5 m inside its colonnade, 43.65 m to the top of the ridge finials; grey brick platform
95 m by 31.45 m at its foot. No text anywhere: both plaques are empty frames.

Authoring frame (see build_landmark_tools): u across (+u = south, the side the route passes),
y up, v along the long east-west axis. Tower heights are written as H0 + storey budget.
Run: Blender --background --python assets-src/landmarks/build_zhengyangmen_gate.py [-- --render-dir DIR]
"""
import argparse
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'zhengyangmen-gate'

# Platform (城台)
D2 = 31.45 / 2          # half thickness at the foot
L2 = 95.0 / 2           # half length at the foot
DECK = 13.5             # walking surface on top
BF = 0.075              # batter of the long faces (m inward per m up)
BE = 0.10               # batter of the end faces
W = 3.2                 # half width of the gate passage
SPRING, ECC = 4.0, 0.25 # springing height and two-centre offset of the passage arch
H0 = 14.0               # datum of the tower's storey budget
TOP = 43.65             # registered height: tip of the ridge finials


def Y(b):
    return H0 + b


def face_u(y):
    return D2 - BF * y


def end_v(y):
    return L2 - BE * y


def sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def add(a, b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def mul(a, s): return (a[0]*s, a[1]*s, a[2]*s)
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def length(a): return math.sqrt(a[0]**2+a[1]**2+a[2]**2)


def unit(a):
    n = length(a)
    return (a[0]/n, a[1]/n, a[2]/n)


def arch_arc(w, ys, e, n=10):
    """Two-centred arch from the left springing to the right springing, as (v, y)."""
    R = w + e
    tc = math.acos(e / R)
    left = [(e - R*math.cos(tc*i/n), ys + R*math.sin(tc*i/n)) for i in range(n+1)]
    right = [(-v, y) for v, y in reversed(left[:-1])]
    return left + right


def arch_opening(w, ys, e, n=10):
    return [(-w, 0.0)] + arch_arc(w, ys, e, n) + [(w, 0.0)]


class Gate:
    def __init__(self, m):
        self.m = m

    # ---- primitives -------------------------------------------------------
    def solid8(self, label, pts, mat):
        faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self.m.mesh(label, pts, faces, mat)

    def box(self, label, centre, size, mat):
        self.m.box(label, centre, size, mat)

    def boxr(self, label, u0, u1, y0, y1, v0, v1, mat):
        self.m.box(label, ((u0+u1)/2, (y0+y1)/2, (v0+v1)/2), (abs(u1-u0), abs(y1-y0), abs(v1-v0)), mat)

    def beam(self, label, p0, p1, w, h, mat, up=(0, 1, 0)):
        d = unit(sub(p1, p0))
        s = cross(d, up)
        if length(s) < 1e-6:
            s = cross(d, (1, 0, 0))
        s = unit(s)
        t = unit(cross(s, d))
        pts = []
        for p in (p0, p1):
            for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                pts.append(add(add(p, mul(s, a*w/2)), mul(t, b*h/2)))
        self.solid8(label, pts, mat)

    def column(self, label, u, v, y0, y1, r, mat, sides=12):
        self.m.tube(label, [(u, y0, v), (u, y1, v)], r, mat, sides)

    def arch_band(self, label, inner, outer, ufront, uback, mat):
        """Closed band between two (v, y) curves, spanning ufront(y)..uback(y) in u."""
        n = len(inner)
        verts = []
        for (vi, yi), (vo, yo) in zip(inner, outer):
            verts += [(ufront(yi), yi, vi), (ufront(yo), yo, vo), (uback(yo), yo, vo), (uback(yi), yi, vi)]
        faces = []
        for j in range(n-1):
            a, b = 4*j, 4*(j+1)
            for k in range(4):
                faces.append((a+k, a+(k+1) % 4, b+(k+1) % 4, b+k))
        faces.append((3, 2, 1, 0))
        last = 4*(n-1)
        faces.append((last, last+1, last+2, last+3))
        self.m.mesh(label, verts, faces, mat)

    def rect_ring(self, label, A, B, thick, y0, y1, mat):
        h = y1-y0
        for s in (1, -1):
            self.box(label, (s*B, (y0+y1)/2, 0), (thick, h, 2*A+thick), mat)
            self.box(label, (0, (y0+y1)/2, s*A), (2*B-thick, h, thick), mat)

    @staticmethod
    def rect_positions(A, B, spacing, corners=True):
        """Points around a rectangle with outward normals (u, v) for bracket sets and posts."""
        out = []
        if corners:
            for su in (1, -1):
                for sv in (1, -1):
                    out.append(((su*B, sv*A), (su/math.sqrt(2), sv/math.sqrt(2))))
        n = max(1, round(2*A/spacing))
        for j in range(1, n):
            v = -A + 2*A*j/n
            for su in (1, -1):
                out.append(((su*B, v), (su, 0)))
        n = max(1, round(2*B/spacing))
        for j in range(1, n):
            u = -B + 2*B*j/n
            for sv in (1, -1):
                out.append(((u, sv*A), (0, sv)))
        return out

    # ---- timber grammar ------------------------------------------------------
    def dougong(self, p, n, y0, hgt, sc, mat):
        """One bracket set: bearing block, crossing arms, cantilevers and the outer arm."""
        t = (-n[1], n[0])

        def P(a, b, y):
            return (p[0]+n[0]*a+t[0]*b, y, p[1]+n[1]*a+t[1]*b)
        z1, z2, z3 = y0+.30*hgt, y0+.52*hgt, y0+.74*hgt
        bm = self.beam
        bm('Bearing block', P(0, -.3*sc, y0+.15*hgt), P(0, .3*sc, y0+.15*hgt), .6*sc, .3*hgt, mat)
        bm('Short cross arm', P(0, -.7*sc, z1+.09*hgt), P(0, .7*sc, z1+.09*hgt), .22*sc, .18*hgt, mat)
        bm('Long cross arm', P(0, -1.0*sc, z2+.09*hgt), P(0, 1.0*sc, z2+.09*hgt), .22*sc, .18*hgt, mat)
        bm('First cantilever', P(-.3*sc, 0, z1+.1*hgt), P(.8*sc, 0, z1+.1*hgt), .24*sc, .2*hgt, mat)
        bm('Slanted cantilever', P(-.3*sc, 0, z2+.12*hgt), P(1.3*sc, 0, z2-.02*hgt), .24*sc, .2*hgt, mat)
        bm('Outer short arm', P(.8*sc, -.6*sc, z2+.08*hgt), P(.8*sc, .6*sc, z2+.08*hgt), .2*sc, .16*hgt, mat)
        bm('Outer purlin arm', P(1.25*sc, -.75*sc, z3+.06*hgt), P(1.25*sc, .75*sc, z3+.06*hgt), .2*sc, .16*hgt, mat)
        bm('Beam head', P(-.3*sc, 0, z3+.12*hgt), P(1.5*sc, 0, z3+.12*hgt), .24*sc, .22*hgt, mat)

    def bracket_tier(self, A, B, y0, hgt, sc, spacing, back_top):
        """Bracket sets on the architrave, a painted backing panel and the outer purlin."""
        self.rect_ring('Bracket backing panel', A-.12, B-.12, .3, y0, back_top, 'paint_bluegreen')
        for p, n in self.rect_positions(A, B, spacing):
            self.dougong(p, n, y0, hgt, sc, 'paint_bluegreen')
        a = 1.35*sc
        self.rect_ring('Outer eave purlin', A+a, B+a, .3, y0+hgt-.05, y0+hgt+.25, 'paint_red')

    def lattice_leaf(self, face, nb, a0, a1, y0, y1):
        """A 隔扇 leaf: frame, solid lower panel, see-through lattice in front of the dark room."""
        s = 1 if face in ('u+', 'v+') else -1
        along_v = face in ('u+', 'u-')

        def B(n0, n1, b0, b1, z0, z1, mat):
            if along_v:
                self.boxr('Lattice leaf', s*(nb+n0), s*(nb+n1), z0, z1, b0, b1, mat)
            else:
                self.boxr('Lattice leaf', b0, b1, z0, z1, s*(nb+n0), s*(nb+n1), mat)
        h = y1-y0
        mid = y0+.34*h
        B(0, .12, a0, a0+.09, y0, y1, 'paint_red')
        B(0, .12, a1-.09, a1, y0, y1, 'paint_red')
        for z in (y0, mid, y1-.09):
            B(0, .12, a0+.09, a1-.09, z, z+.09, 'paint_red')
        B(0, .06, a0+.09, a1-.09, y0+.09, mid, 'paint_red')
        w = a1-a0-.18
        for k in range(1, 4):
            b = a0+.09+w*k/4
            B(.02, .09, b-.025, b+.025, mid+.09, y1-.09, 'paint_red')
        top = y1-.09-(mid+.09)
        for k in range(1, 6):
            z = mid+.09+top*k/6
            B(.02, .09, a0+.09, a1-.09, z-.025, z+.025, 'paint_red')

    # ---- roofs -----------------------------------------------------------------
    def roof(self, label, A0, B0, A1, B1, yfun, ts, lift, flare, Dc, green_k, thick=.35,
             spacing=.5, hips=True):
        """A curved hipped eave: rings from the upturned eave edge up to the wall or gable line."""
        nl, ns = max(4, round(2*A0/spacing)), max(4, round(2*B0/spacing))
        params = [(side, j/n) for side, n in ((0, nl), (1, ns), (2, nl), (3, ns)) for j in range(n)]
        corners = [0, nl, nl+ns, 2*nl+ns]
        grid = []
        for t in ts:
            A, B = A0+(A1-A0)*t, B0+(B1-B0)*t
            y, k = yfun(t), (1-t)**1.3
            row = []
            for side, f in params:
                u, v = [(B, A-2*A*f), (B-2*B*f, -A), (-B, -A+2*A*f), (-B+2*B*f, A)][side]
                d = min(f, 1-f)*(2*A0 if side in (0, 2) else 2*B0)
                w = max(0, 1-d/Dc)**2
                if abs(u) > 1e-9:
                    u += math.copysign(flare*w*k, u)
                if abs(v) > 1e-9:
                    v += math.copysign(flare*w*k, v)
                row.append((u, y+lift*w*k, v))
            grid.append(row)
        self.slab(label+' glazed green edge', grid, 0, green_k, thick, 'tile_green')
        self.slab(label+' grey tile field', grid, green_k, len(ts)-1, thick, 'tile_grey')
        N = len(params)
        for i in range(N):
            if i in corners:
                continue
            col = [grid[k][i] for k in range(len(ts))]
            lifted = [(p[0], p[1]+.08, p[2]) for p in col]
            self.m.tube('Green drip tile roll', lifted[:green_k+1], .11, 'tile_green', 4)
            self.m.tube('Grey tile roll', lifted[green_k:], .11, 'tile_grey', 4)
            self.rafters(col, thick)
        for ci in corners:
            col = [grid[k][ci] for k in range(len(ts))]
            if hips:
                self.m.tube('Corner hip ridge', [(p[0], p[1]+.22, p[2]) for p in col], .22, 'tile_green', 6)
                self.ridge_beasts(col)
            self.rafters(col, thick)
        return grid, corners

    def ridge_beasts(self, col):
        tip = col[0]
        self.box('Ridge-end beast head', (tip[0], tip[1]+.05, tip[2]), (.5, .45, .5), 'tile_green')
        total = self.polylen(col)
        for k in range(1, 5):
            p = self.along(col, k*.07*total)
            self.box('Ridge beast', (p[0], p[1]+.55, p[2]), (.28, .42, .28), 'tile_green')

    @staticmethod
    def polylen(pts):
        return sum(length(sub(b, a)) for a, b in zip(pts, pts[1:]))

    @staticmethod
    def along(pts, s):
        for a, b in zip(pts, pts[1:]):
            L = length(sub(b, a))
            if s <= L:
                return add(a, mul(sub(b, a), s/L))
            s -= L
        return pts[-1]

    def rafters(self, col, thick):
        under = [(p[0], p[1]-thick, p[2]) for p in col]

        def q(s, dy):
            return add(self.along(under, s), (0, dy, 0))
        self.beam('Flying rafter end', q(0, -.09), q(.9, -.09), .15, .18, 'paint_bluegreen')
        self.beam('Eave rafter end', q(.5, -.3), q(1.9, -.3), .18, .2, 'paint_bluegreen')

    def slab(self, label, grid, ka, kb, thick, mat):
        rows = grid[ka:kb+1]
        R, N = len(rows), len(rows[0])
        verts = [p for row in rows for p in row]+[(p[0], p[1]-thick, p[2]) for row in rows for p in row]
        off = R*N
        faces = []
        for k in range(R-1):
            for i in range(N):
                a, b, c, d = k*N+i, k*N+(i+1) % N, (k+1)*N+(i+1) % N, (k+1)*N+i
                faces += [(a, b, c, d), (off+d, off+c, off+b, off+a)]
        for i in range(N):
            a, b = i, (i+1) % N
            faces.append((a, off+a, off+b, b))
            a, b = (R-1)*N+i, (R-1)*N+(i+1) % N
            faces.append((b, off+b, off+a, a))
        self.m.mesh(label, verts, faces, mat)

    # ---- the city platform -------------------------------------------------------
    def platform(self):
        top_u, top_v = face_u(DECK), end_v(DECK)
        for s in (1, -1):
            # Solid wall on each side of the passage; the passage stays open floor to vault.
            self.solid8('City platform wing', [
                (D2, 0, s*L2), (D2, 0, s*W), (-D2, 0, s*W), (-D2, 0, s*L2),
                (top_u, DECK, s*top_v), (top_u, DECK, s*W), (-top_u, DECK, s*W), (-top_u, DECK, s*top_v)], 'brick')
        arc = arch_arc(W, SPRING, ECC)
        self.arch_band('Masonry over the gate vault', arc, [(v, DECK) for v, _ in arc],
                       face_u, lambda y: -face_u(y), 'brick')
        # The narrower door section in the middle of the passage, where the leaves once hung.
        self.arch_band('Door section of the gate passage', arch_opening(2.75, 3.4, ECC), arch_opening(W, SPRING, ECC),
                       lambda y: 2.5, lambda y: -2.5, 'brick')
        ring_in, ring_out = arch_opening(W, SPRING, ECC), arch_opening(W+.8, SPRING, ECC)
        for s in (1, -1):
            if s > 0:
                front, back = (lambda y: face_u(y)+.14), (lambda y: face_u(y)-.25)
            else:
                front, back = (lambda y: -(face_u(y)-.25)), (lambda y: -(face_u(y)+.14))
            self.arch_band('Voussoir ring of the gate arch', ring_in, ring_out, front, back, 'brick_arch')
            # Empty stone name tablet above the arch.
            fu = face_u(9.9)
            self.boxr('Empty stone tablet frame', s*(fu-.3), s*(fu+.2), 9.0, 10.8, -1.9, 1.9, 'stone')
            self.boxr('Empty stone tablet field', s*(fu+.1), s*(fu+.24), 9.25, 10.55, -1.6, 1.6, 'brick_arch')
            # Stone footing course, interrupted at the arch.
            for a, b in ((-L2, -W-.8), (W+.8, L2)):
                self.boxr('Stone footing course', s*(D2-.3), s*(D2+.14), 0, .9, a, b, 'stone')
            self.boxr('Stone footing course', -D2, D2, 0, .9, s*(L2-.3), s*(L2+.14), 'stone')
            # String course, parapet and coping around the deck.
            yc = 13.15
            self.boxr('Brick string course', s*(face_u(yc)-.3), s*(face_u(yc)+.12), 13.05, 13.25,
                      -end_v(yc)-.12, end_v(yc)+.12, 'brick_arch')
            self.boxr('Brick string course', -face_u(yc), face_u(yc), 13.05, 13.25,
                      s*(end_v(yc)-.3), s*(end_v(yc)+.12), 'brick_arch')
            fu, ev = face_u(13.25), end_v(13.25)
            spans = [(-ev, ev)] if s > 0 else [(-ev, -45.3), (-41.3, 41.3), (45.3, ev)]
            for a, b in spans:
                self.boxr('Parapet', s*(fu-.75), s*fu, 13.25, 14.55, a, b, 'brick')
                self.boxr('Parapet coping', s*(fu-.81), s*(fu+.06), 14.55, 14.7, a, b, 'brick_arch')
                self.railing_line((s*(fu-.37), a+.3), (s*(fu-.37), b-.3), 14.7, 15.7, 2.4)
            self.boxr('Parapet', -fu+.75, fu-.75, 13.25, 14.55, s*(ev-.75), s*ev, 'brick')
            self.boxr('Parapet coping', -fu+.69, fu-.69, 14.55, 14.7, s*(ev-.81), s*(ev+.06), 'brick_arch')
            # Lower city-wall stubs at both ends, their tops falling away as in the photographs.
            h0, h1, v0, v1 = 12.0, 9.0, 46.0, 55.0
            d0 = 13.2
            self.solid8('City wall stub', [
                (d0, 0, s*v0), (-d0, 0, s*v0), (-d0, 0, s*v1), (d0, 0, s*v1),
                (d0-BF*h0, h0, s*v0), (-(d0-BF*h0), h0, s*v0), (-(d0-BF*h1), h1, s*(v1-BE*h1)), (d0-BF*h1, h1, s*(v1-BE*h1))],
                'brick')
            for su in (1, -1):
                ua, ub = su*(d0-BF*h0), su*(d0-BF*h0-.7)
                uc, ud = su*(d0-BF*h1), su*(d0-BF*h1-.7)
                ve = s*(v1-BE*h1)
                self.solid8('Wall stub parapet', [
                    (ua, h0-.3, s*v0), (ub, h0-.3, s*v0), (ub, h0+1.2, s*v0), (ua, h0+1.2, s*v0),
                    (uc, h1-.3, ve), (ud, h1-.3, ve), (ud, h1+1.2, ve), (uc, h1+1.2, ve)], 'brick')
        self.ramps()
        self.lions()

    def railing_line(self, p0, p1, y0, y1, spacing):
        (u0, v0), (u1, v1) = p0, p1
        L = math.hypot(u1-u0, v1-v0)
        n = max(1, round(L/spacing))
        for j in range(n+1):
            u, v = u0+(u1-u0)*j/n, v0+(v1-v0)*j/n
            self.box('Railing post', (u, (y0+y1)/2, v), (.09, y1-y0, .09), 'paint_red')
        for y in (y1-.05, (y0+y1)/2):
            self.beam('Railing rail', (u0, y, v0), (u1, y, v1), .06, .06, 'paint_red')

    def ramps(self):
        """The two horse ramps (马道) climbing the north face from the gate out to the deck."""
        steps, rise = 45, DECK/45
        run = (41.0-7.0)/steps
        for s in (1, -1):
            prof = [(7.0, 0.0)]
            for k in range(steps):
                prof += [(7.0+k*run, (k+1)*rise), (7.0+(k+1)*run, (k+1)*rise)]
            prof += [(45.8, DECK), (45.8, 0.0)]
            self.m.shell('Stepped horse ramp', [(-14.4, y, s*v) for v, y in prof], (-5.8, 0, 0), 'brick')
            ua, ub = -20.2, -19.55
            self.solid8('Horse ramp parapet', [
                (ua, 0, s*7), (ub, 0, s*7), (ub, 1.1, s*7), (ua, 1.1, s*7),
                (ua, DECK-.3, s*41), (ub, DECK-.3, s*41), (ub, DECK+1.1, s*41), (ua, DECK+1.1, s*41)], 'brick')
            self.boxr('Horse ramp landing parapet', ua, ub, DECK-.3, DECK+1.1, s*41, s*45.8, 'brick')

    def lions(self):
        """The pair of stone lions guarding the south arch."""
        u = face_u(0)+1.8
        for s in (1, -1):
            v = s*5.4
            self.boxr('Lion plinth', u-.7, u+.7, 0, 1.3, v-.55, v+.55, 'stone')
            self.boxr('Lion plinth cap', u-.8, u+.8, 1.3, 1.45, v-.62, v+.62, 'stone')
            self.boxr('Lion haunches', u-.6, u+.15, 1.45, 2.15, v-.4, v+.4, 'stone')
            self.boxr('Lion forelegs', u+.15, u+.55, 1.45, 2.3, v-.3, v+.3, 'stone')
            self.boxr('Lion chest', u-.1, u+.5, 2.1, 2.85, v-.36, v+.36, 'stone')
            self.boxr('Lion mane', u-.15, u+.45, 2.7, 3.35, v-.42, v+.42, 'stone')
            self.boxr('Lion face', u+.45, u+.7, 2.8, 3.25, v-.3, v+.3, 'stone')

    # ---- the gate tower ----------------------------------------------------------
    def tower(self):
        # Terrace (台基) with a plain brick-and-stone moulding and centre steps both ways.
        self.boxr('Tower terrace footing', -11.8, 11.8, DECK, 13.8, -21.9, 21.9, 'stone')
        self.boxr('Tower terrace', -11.6, 11.6, 13.8, 14.85, -21.7, 21.7, 'stone')
        self.boxr('Tower terrace kerb', -11.72, 11.72, 14.85, Y(1.0), -21.82, 21.82, 'stone')
        for s in (1, -1):
            for k in range(5):
                self.boxr('Terrace step', s*11.6, s*(11.6+(5-k)*.35), DECK, DECK+(k+1)*.3, -3.3, 3.3, 'stone')
        V = [-18.35, -13.283, -8.217, -3.15, 3.15, 8.217, 13.283, 18.35]
        U = [-8.25, -2.75, 2.75, 8.25]
        self.ground_floor(V, U)
        self.upper_floor(V, U)
        self.top_roof()

    def bracket_height(self, A0, A1, CL, a, yfun, thick=.35):
        t = (A0-(CL+a))/(A0-A1)
        return yfun(t)-thick-.12

    def ground_floor(self, V, U):
        f0, f1 = Y(1.0), Y(9.6)
        self.boxr('Ground floor hall', -7.9, 7.9, f0, f1, -18.0, 18.0, 'wood_dark')
        dw, dh = 1.6, Y(5.2)
        for s in (1, -1):
            for a, b in ((-18.35, -dw), (dw, 18.35)):
                self.boxr('Red plastered hall wall', s*7.9, s*8.25, f0, f1, a, b, 'paint_red')
            self.boxr('Red wall over door', s*7.9, s*8.25, dh, f1, -dw, dw, 'paint_red')
            for k in range(4):
                a = -dw+2*dw*k/4
                self.lattice_leaf('u+' if s > 0 else 'u-', 7.9, a+.02, a+2*dw/4-.02, f0, dh)
            ew = 1.3
            for a, b in ((-8.25, -ew), (ew, 8.25)):
                self.boxr('Red plastered hall wall', a, b, f0, f1, s*18.0, s*18.35, 'paint_red')
            self.boxr('Red wall over door', -ew, ew, Y(4.8), f1, s*18.0, s*18.35, 'paint_red')
            for k in range(4):
                a = -ew+2*ew*k/4
                self.lattice_leaf('v+' if s > 0 else 'v-', 18.0, a+.02, a+2*ew/4-.02, f0, Y(4.8))
        # Colonnade: outer columns follow the hall's bay grid plus the corners of the gallery.
        cols = [(su*10.25, v) for su in (1, -1) for v in [-20.35]+V+[20.35]]
        cols += [(u, sv*20.35) for sv in (1, -1) for u in U]
        for u, v in cols:
            self.boxr('Column base stone', u-.5, u+.5, Y(1.0), Y(1.25), v-.5, v+.5, 'stone')
            self.column('Red lacquered column', u, v, Y(1.25), Y(6.4), .38, 'paint_red')
        self.rect_ring('Painted architrave', 20.35, 10.25, .5, Y(6.2), Y(7.0), 'paint_bluegreen')
        # First (lowest) eave.
        A0, B0, A1, B1 = 23.55, 13.45, 20.05, 9.95
        ye, rise = Y(7.9), 2.3
        yfun = lambda t: ye+rise*(.45*t+.55*t*t)
        hgt = self.bracket_height(A0, A1, 20.35, 1.35, yfun)-Y(7.0)
        self.bracket_tier(20.35, 10.25, Y(7.0), hgt, 1.0, 1.25, Y(9.7))
        self.roof('First eave', A0, B0, A1, B1, yfun, [0, .09, .18, .3, .42, .55, .7, .85, 1], 1.1, .9, 5.5, 2)
        # Balcony level (平座): painted bracket band, gilded fascia and a red railing.
        self.boxr('Balcony bracket band', -10.35, 10.35, Y(9.6), Y(10.8), -20.45, 20.45, 'paint_bluegreen')
        for p, n in self.rect_positions(20.45, 10.35, .9):
            u, v = p
            self.beam('Balcony bracket', (u-n[0]*.05, Y(10.35), v-n[1]*.05), (u+n[0]*.35, Y(10.35), v+n[1]*.35),
                      .22, .3, 'paint_bluegreen')
            self.beam('Balcony bracket block', (u, Y(9.95), v), (u+n[0]*.16, Y(9.95), v+n[1]*.16), .3, .22, 'paint_bluegreen')
        self.boxr('Balcony gilded fascia', -10.55, 10.55, Y(10.8), Y(11.8), -20.65, 20.65, 'paint_gold')
        for (u0, v0), (u1, v1) in (((10.45, -20.45), (10.45, 20.45)), ((-10.45, -20.45), (-10.45, 20.45)),
                                   ((-10.45, 20.45), (10.45, 20.45)), ((-10.45, -20.45), (10.45, -20.45))):
            self.railing_line((u0, v0), (u1, v1), Y(11.8), Y(12.8), 1.1)
            L = math.hypot(u1-u0, v1-v0)
            n = round(L/.28)
            for j in range(1, n):
                if j % 4 == 0:
                    continue
                u, v = u0+(u1-u0)*j/n, v0+(v1-v0)*j/n
                self.box('Railing baluster', (u, Y(12.3), v), (.05, 1.0, .05), 'paint_red')

    def upper_floor(self, V, U):
        f0 = Y(11.8)
        self.boxr('Upper floor hall', -7.9, 7.9, f0, Y(19.7), -18.0, 18.0, 'wood_dark')
        self.rect_ring('Upper wall head', 18.18, 8.08, .35, Y(14.3), Y(19.0), 'paint_red')
        self.rect_ring('Upper wall sill', 18.18, 8.08, .35, f0, Y(12.0), 'paint_red')
        for s in (1, -1):
            for v in V:
                self.boxr('Upper wall pier', s*7.9, s*8.3, f0, Y(14.3), v-.3, v+.3, 'paint_red')
            for u in U:
                self.boxr('Upper wall pier', u-.3, u+.3, f0, Y(14.3), s*18.0, s*18.4, 'paint_red')
            for a, b in zip(V, V[1:]):
                w = (b-a-.6)/4
                for k in range(4):
                    x = a+.3+k*w
                    self.lattice_leaf('u+' if s > 0 else 'u-', 7.9, x+.01, x+w-.01, Y(12.0), Y(14.3))
            for a, b in zip(U, U[1:]):
                w = (b-a-.6)/4
                for k in range(4):
                    x = a+.3+k*w
                    self.lattice_leaf('v+' if s > 0 else 'v-', 18.0, x+.01, x+w-.01, Y(12.0), Y(14.3))
        cols = [(su*9.75, v) for su in (1, -1) for v in [-19.85]+V+[19.85]]
        cols += [(u, sv*19.85) for sv in (1, -1) for u in U]
        for u, v in cols:
            self.column('Red lacquered column', u, v, f0, Y(14.8), .32, 'paint_red')
        self.rect_ring('Painted architrave', 19.85, 9.75, .45, Y(14.6), Y(15.3), 'paint_bluegreen')
        A0, B0, A1, B1 = 22.85, 12.75, 18.1, 8.0
        ye, rise = Y(16.2), 2.2
        yfun = lambda t: ye+rise*(.45*t+.55*t*t)
        hgt = self.bracket_height(A0, A1, 19.85, 1.35*.9, yfun)-Y(15.3)
        self.bracket_tier(19.85, 9.75, Y(15.3), hgt, .9, 1.25, Y(17.3))
        self.roof('Second eave', A0, B0, A1, B1, yfun, [0, .09, .18, .3, .42, .55, .7, .85, 1], 1.0, .8, 5.0, 2)
        self.rect_ring('Wall ridge where the second eave meets the top storey', 18.45, 8.35, .45, Y(18.2), Y(18.75), 'tile_green')
        self.rect_ring('Painted architrave', 18.35, 8.25, .45, Y(19.0), Y(19.7), 'paint_bluegreen')

    def top_roof(self):
        """Double-eave hip-and-gable crown: hip skirt, gable slopes, red gables, ridges, finials."""
        A0, B0, A1, B1 = 21.15, 11.05, 16.3, 6.2
        ye, ridge = Y(21.0), Y(27.3)
        f = lambda s: .35*s+.65*s*s
        span = B0
        s1 = (B0-B1)/span
        yfun = lambda t: ye+(ridge-ye)*f(s1*t)
        hgt = self.bracket_height(A0, A1, 18.35, 1.35*.85, yfun)-Y(19.7)
        self.bracket_tier(18.35, 8.25, Y(19.7), hgt, .85, 1.2, yfun(.6)-.2)
        grid, corners = self.roof('Top eave', A0, B0, A1, B1, yfun,
                                  [0, .08, .16, .3, .45, .6, .75, .9, 1], 1.1, .9, 6.0, 2, hips=False)
        y1 = yfun(1)
        prof = lambda u: ye+(ridge-ye)*f(1-abs(u)/span)
        ge = A1+.6
        us = [B1*(1-i/10) for i in range(10)]+[0]+[-B1*i/10 for i in range(1, 11)]
        top = [(u, prof(u)) for u in us]
        th = .35
        outline = top+[(u, y-th) for u, y in reversed(top)]
        self.m.shell('Gable roof slopes', [(u, y, -ge) for u, y in outline], (0, 0, 2*ge), 'tile_grey')
        n = round(2*ge/.5)
        for j in range(n+1):
            v = -ge+.12+(2*ge-.24)*j/n
            mat = 'tile_green' if j in (0, n) else 'tile_grey'
            for sg in (1, -1):
                pts = [(sg*u, prof(u)+.08, v) for u in [B1*(1-i/8)+.35*i/8 for i in range(9)]]
                self.m.tube('Gable slope tile roll', pts, .11, mat, 4)
        # Main ridge and the two dragon finials (正吻); their tips set the registered height.
        self.boxr('Main ridge', -.38, .38, ridge-.2, ridge+.95, -ge-.1, ge+.1, 'tile_green')
        self.boxr('Main ridge cap', -.28, .28, ridge+.95, ridge+1.1, -ge-.1, ge+.1, 'tile_green')
        for sv in (1, -1):
            v = sv*(ge-.3)
            self.boxr('Ridge finial body', -.3, .3, ridge+.6, TOP-.55, v-sv*.9, v+sv*.25, 'tile_green')
            self.boxr('Ridge finial jaw', -.34, .34, ridge+.6, ridge+1.5, v-sv*1.25, v, 'tile_green')
            curl = [(0, TOP-.75-.9*math.sin(a), v-sv*(.9+.45*(1-math.cos(a)))) for a in [i*math.pi/6 for i in range(7)]]
            self.m.tube('Ridge finial curled tail', curl, .2, 'tile_green', 6)
            self.boxr('Ridge finial sword', -.12, .12, TOP-.6, TOP, v-sv*.2, v+sv*.05, 'tile_green')
            # Red gable wall with a gilded ornament, and the bargeboard under the gable eaves.
            gable = [(u, prof(u)-th) for u in us if abs(u) < B1-.01]
            outline = [(B1, y1)]+gable+[(-B1, y1)]
            self.m.shell('Red gable wall', [(u, y, sv*A1) for u, y in outline], (0, 0, -sv*.3), 'paint_red')
            yo = y1+(ridge-y1)*.42
            self.m.shell('Gilded gable ornament', [(0, yo+1.0, sv*A1), (1.6, yo, sv*A1), (0, yo-.8, sv*A1), (-1.6, yo, sv*A1)],
                         (0, 0, sv*.1), 'paint_gold')
            for su in (1, -1):
                self.m.tube('Gilded gable scroll', [(su*(.9+.9*math.cos(a)), yo-.3+.6*math.sin(a), sv*(A1+.12))
                                                     for a in [i*math.pi/5 for i in range(6)]], .09, 'paint_gold', 5)
            board = [(u, prof(u)-th) for u in us]+[(u, prof(u)-th-.55) for u in reversed(us)]
            self.m.shell('Red bargeboard', [(u, y, sv*(ge-.05)) for u, y in board], (0, 0, -sv*.12), 'paint_red')
            # Vertical gable ridges run into the hip ridges down to the upturned corners.
            for su in (1, -1):
                gpts = [(su*B1*i/8, prof(B1*i/8)+.25, sv*(ge-.2)) for i in range(9)]
                ci = corners[[(1, 1), (1, -1), (-1, -1), (-1, 1)].index((su, sv))]
                col = [grid[k][ci] for k in range(len(grid))]
                hip = [(p[0], p[1]+.22, p[2]) for p in reversed(col)]
                self.m.tube('Gable and hip ridge', gpts+hip[1:], .22, 'tile_green', 6)
                self.ridge_beasts(col)
        # Empty name board (匾额) under the top eave on both long faces.
        for su in (1, -1):
            self.boxr('Empty name board frame', su*9.35, su*9.6, Y(18.7), Y(20.9), -.85, .85, 'paint_gold')
            self.boxr('Empty name board field', su*9.5, su*9.66, Y(18.9), Y(20.7), -.65, .65, 'paint_bluegreen')


def build(render_dir=None):
    m = Model(ID)
    for key, color, metal, rough in [
            ('brick', (.24, .25, .24), 0, .92), ('brick_arch', (.34, .34, .32), 0, .9),
            ('stone', (.55, .54, .50), 0, .8), ('paint_red', (.46, .06, .04), 0, .55),
            ('paint_bluegreen', (.04, .19, .24), 0, .6), ('paint_gold', (.78, .55, .10), .3, .45),
            ('tile_grey', (.20, .22, .21), 0, .7), ('tile_green', (.06, .21, .13), 0, .45),
            ('wood_dark', (.07, .04, .03), 0, .8)]:
        m.material(key, color, metal, rough)
    g = Gate(m)
    g.platform()
    g.tower()
    return m.finish(directory=Path(render_dir) if render_dir else None)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--render-dir')
    build(parser.parse_args(argv).render_dir)
