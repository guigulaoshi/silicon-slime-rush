"""Sydney Opera House (Bennelong Point): original architectural model, redone from reference photos.

Footprint = OSM relation 9596872 (building outline incl. the Monumental Steps, 170 m x 114 m). Authoring frame
from the shared tools: u across (east +), v along the long axis (south +, toward the forecourt), y up.
Datum y = 0 is the Broadwalk (about 2 m above sea level); the tallest shell tip is 65 m above it
(67 m above sea level, official figure).

Sources of the numbers (photo estimates unless said otherwise):
- Sphere radius 75.2 m for every shell (the "spherical solution", official figure).
- Tallest tip 67 m ASL (official). The rest comes from a true side view from the west (Commons "Sydney opera house
  side view.jpg", 5.9 px per m, calibrated on that 67 m): Concert Hall tips 44 / 52 / 65 m above datum, facing
  north and rising toward the south; the south-facing shell over the steps 37.5 m; tips at v = -79 / -54 / -36 /
  +40 and pedestals at v = -58 / -39 / -21 / +29. The Joan Sutherland Theatre comes from the east views ("Sydney Opera
  House and Harbour Bridge Dusk" 2019): 36 / 46 / 60 / 33 m. The restaurant has two back-to-back shells about
  27 m high at the south-west corner, and the south one faces the forecourt.
- Podium top 12 m above datum under the halls, about 10.5 m under the restaurant (side view). Monumental Steps:
  one long flight with a narrow landing near the bottom (forecourt photo), 0.167 m risers, 0.42 m treads.
- Shell side edges are lifted off the podium over a dark glazed band (side view); nested shells show green-glazed
  mouths above the back of the shell in front; the harbour-end walls bulge out into a bronze-ribbed brim.
- Tiles: smooth lids between straight rib joints, chevron (V) course joints (tile close-up). Podium: pink-brown
  precast granite panels with vertical joints and dark window strips.
No text, logos or signage.
Run: Blender --background --python assets-src/landmarks/build_opera_house.py [-- --render-dir DIR]
"""
import argparse
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

R_SPHERE = 75.2
HP = 11.5          # podium top above the Broadwalk datum (under the halls)
HR = 9.5           # restaurant block top
m = None


def unit(x):
    return x/np.linalg.norm(x)


def solid(label, A, B, mat, smooth=False):
    """Closed solid between two grids A, B (rows x cols x 3). With smooth, the two big faces are smooth-shaded
    and the thin rim faces flat, so thin plates keep crisp edges instead of pillow shading."""
    A = np.asarray(A, float); B = np.asarray(B, float)
    nr, nc = A.shape[:2]
    verts = [tuple(p) for p in A.reshape(-1, 3)]+[tuple(p) for p in B.reshape(-1, 3)]
    n = nr*nc
    faces = []
    for r in range(nr-1):
        for c in range(nc-1):
            a = r*nc+c; b = a+1; d = a+nc; e = d+1
            faces += [(a, b, e, d), (n+d, n+e, n+b, n+a)]
    ring = list(range(nc))+[r*nc+nc-1 for r in range(1, nr)]+[(nr-1)*nc+c for c in range(nc-2, -1, -1)]+[r*nc for r in range(nr-2, 0, -1)]
    rim = [(a, b, n+b, n+a) for a, b in zip(ring, ring[1:]+ring[:1])]
    m.mesh(label, verts, faces+rim, mat, smooth)
    if smooth:
        flags = m.groups[mat][2]
        flags[len(flags)-len(rim):] = [False]*len(rim)


def prism(label, outline, y0, y1, mat):
    """Vertical extrusion of a plan outline [(u, v)] from y0 to y1."""
    m.shell(label, [(u, y0, v) for u, v in outline], (0, y1-y0, 0), mat)


def ubox(u0, u1, y0, y1, v0, v1, mat, label='block'):
    m.box(label, ((u0+u1)/2, (y0+y1)/2, (v0+v1)/2), (abs(u1-u0), abs(y1-y0), abs(v1-v0)), mat)


# ---------------------------------------------------------------- plan helpers
def dedupe(ring, eps=.05):
    out = []
    for p in ring:
        if not out or math.dist(p, out[-1]) > eps:
            out.append(tuple(p))
    if math.dist(out[0], out[-1]) <= eps:
        out.pop()
    clean = []
    for i, p in enumerate(out):
        a = out[i-1]; b = out[(i+1) % len(out)]
        cross = (p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0])
        if abs(cross) > 1e-3:
            clean.append(p)
    return clean


def clip_half(ring, v_max):
    out = []
    for p, q in zip(ring, ring[1:]+ring[:1]):
        pin, qin = p[1] <= v_max, q[1] <= v_max
        if pin:
            out.append(p)
        if pin != qin:
            t = (v_max-p[1])/(q[1]-p[1]); out.append((p[0]+(q[0]-p[0])*t, v_max))
    return out


def ccw(ring):
    area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]+ring[:1]))
    return 1 if area > 0 else -1


def offset_ring(ring, dist):
    """Inward miter offset; dist(i) gives the inset of edge i (ring[i] -> ring[i+1])."""
    n = len(ring)
    sgn = ccw(ring)
    lines = []
    for i in range(n):
        a = np.array(ring[i]); b = np.array(ring[(i+1) % n])
        t = unit(b-a); nrm = sgn*np.array([-t[1], t[0]])   # inward
        d = dist(i)
        lines.append((a+nrm*d, t, d))
    out = []
    for i in range(n):
        p1, t1, d1 = lines[i-1]; p2, t2, d2 = lines[i]
        den = t1[0]*t2[1]-t1[1]*t2[0]
        corner = np.array(ring[i])
        if abs(den) < 1e-6:
            q = p2
        else:
            s = ((p2-p1)[0]*t2[1]-(p2-p1)[1]*t2[0])/den
            q = p1+t1*s
        lim = 3*max(d1, d2, .01)
        if np.linalg.norm(q-corner) > lim:
            q = corner+unit(q-corner)*lim
        out.append((float(q[0]), float(q[1])))
    return out


# ---------------------------------------------------------------- shells
class Shell:
    """One shell (two mirrored half-shells) in its own frame: a across, h above its base, s forward.
    T = tip (on the symmetry plane, ov in front of the pedestal line, H above the base), B = the back end of the
    ridge on the base plane, P = the pedestal at (w, 0, 0). All three lie on one sphere of radius 75.2 m."""

    def __init__(self, name, feet, facing, w, ov, H, M, base=HP, lift=4.0, kind='north', R=R_SPHERE):
        """M = (s, h) of a second ridge point read off the side-view photo. The back end B of the ridge is
        placed so that the sphere through T, M, B and P has the 75.2 m radius (the spherical solution)."""
        self.name = name
        self.F = np.array(feet, float); self.D = unit(np.array(facing, float))
        self.A = np.array([-self.D[1], self.D[0]])
        self.w, self.ov, self.H, self.base = w, ov, H, base
        self.lift, self.kind = lift, kind
        T = np.array([0, H, ov]); Mp = np.array([0, M[1], M[0]]); P = np.array([w, 0, 0])
        best = None
        for L in np.arange(-M[0]+1, 150, .25):
            B = np.array([0, 0, -L])
            A_ = np.array([[*p, 1.0] for p in (T, Mp, P, B)]); b_ = np.array([-(p @ p) for p in (T, Mp, P, B)])
            try:
                D, E, F, G = np.linalg.solve(A_, b_)
            except np.linalg.LinAlgError:
                continue
            c = -np.array([D, E, F])/2
            r = math.sqrt(max(1e-9, c @ c-G))
            if c[0] >= 0:
                continue
            if best is None or abs(r-R) < abs(best[1]-R):
                best = (L, r, c)
        self.L, self.R, self.C = best
        print(f'{name}: back length {self.L:.1f} m, sphere radius {self.R:.1f} m', flush=True)
        self.T, self.B, self.P = T, np.array([0, 0, -self.L]), P

    def world(self, p, mirror=1):
        a, h, s = p
        a *= mirror
        uv = self.F+self.A*a+self.D*s
        return (float(uv[0]), float(self.base+h), float(uv[1]))

    def boundary(self, n1, n2):
        C, R = self.C, self.R
        r1 = math.sqrt(R*R-C[0]**2)
        def ang(p): return math.atan2(p[1]-C[1], p[2]-C[2])
        t0, t1 = ang(self.T), ang(self.B)
        best = None
        for c in (t1, t1+math.tau, t1-math.tau):
            mid = (t0+c)/2
            h = C[1]+r1*math.sin(mid)
            if abs(c-t0) < math.pi*1.5 and (best is None or h > best[0]):
                best = (h, c)
        t1 = best[1]
        ridge_full = [np.array([0, C[1]+r1*math.sin(t), C[2]+r1*math.cos(t)]) for t in np.linspace(t0, t1, n1+1)]
        # the ridge stops where it comes down to the lifted side edge (its lower end is hidden in the
        # next shell); the side edge then runs from there to the pedestal at the lifted height
        ridge = []
        for p, q in zip(ridge_full, ridge_full[1:]):
            ridge.append(p)
            if q[1] < self.lift:
                f = (p[1]-self.lift)/(p[1]-q[1])
                e = p+(q-p)*f
                ridge.append(self.C+self.R*unit(e-self.C))
                break
        else:
            ridge.append(ridge_full[-1])
        r0 = math.sqrt(R*R-C[1]**2)
        def ang2(p): return math.atan2(p[0]-C[0], p[2]-C[2])
        f0, f1 = ang2(self.B), ang2(self.P)
        best = None
        for c in (f1, f1+math.tau, f1-math.tau):
            mid = (f0+c)/2
            a = C[0]+r0*math.sin(mid)
            if abs(c-f0) < math.pi*1.5 and (best is None or a > best[0]):
                best = (a, c)
        f1 = best[1]
        feet = [np.array([C[0]+r0*math.sin(f), 0, C[2]+r0*math.cos(f)]) for f in np.linspace(f0, f0+(f1-f0)*.93, n2+1)[1:]]
        # the side edge stands off the podium over a glazed band (side-view photo): lift each base point
        # up its meridian to the lifted height; only the rib back to the pedestal comes down to the podium
        base = []
        for k, q in enumerate(feet):
            h = self.lift
            d = unit(np.array([q[0]-C[0], q[2]-C[2]]))
            rh = math.sqrt(max(0, R*R-(h-C[1])**2))
            base.append(np.array([C[0]+rh*d[0], h, C[2]+rh*d[1]]))
        self.feet = feet
        return ridge+base, len(ridge)-1

    def rib(self, Q, t, radius):
        """Point at fraction t along the great-circle rib from the pedestal to boundary point Q."""
        a = unit(self.P-self.C); b = unit(Q-self.C)
        om = math.acos(max(-1, min(1, float(np.dot(a, b)))))
        if om < 1e-6:
            d = a
        else:
            d = (math.sin((1-t)*om)*a+math.sin(t*om)*b)/math.sin(om)
        return self.C+radius*unit(d)

    def Qat(self, bnd, j):
        j = max(0, min(len(bnd)-1-1e-9, j))
        k = int(j); f = j-k
        q = bnd[k]*(1-f)+bnd[min(k+1, len(bnd)-1)]*f
        return self.C+self.R*unit(q-self.C)

    def build(self):
        n1 = max(16, int(round(np.linalg.norm(self.T-self.B)/2.4)))
        n2 = max(6, int(round(self.w/2.4)))
        bnd, nridge = self.boundary(n1, n2)
        self.bnd = bnd
        self.nridge = nridge
        ni = 22
        t_body = .9
        for mirror in (1, -1):
            outer = [[self.rib(Q, t, self.R) for t in np.linspace(.035, 1, ni)] for Q in bnd]
            inner = [[self.rib(Q, t, self.R-t_body) for t in np.linspace(.035, 1, ni)] for Q in bnd]
            W = lambda g: [[self.world(p, mirror) for p in row] for row in g]
            solid(self.name+' body', W(outer), W(inner), 'concrete', True)
            self.lids(bnd, mirror)
            self.soffit_ribs(bnd, mirror)
            self.edge_beam(bnd, mirror)
            self.side_glazing(bnd, mirror)
        self.ridge_beam()
        self.pedestals()
        self.glass_wall()

    def lids(self, bnd, mirror):
        """Tile lids between the ribs: straight rib joints, chevron (V) course joints, smooth tops."""
        step = .83                      # about 2 m strips at the rim
        x = step
        while x < len(bnd)-1-1e-6:
            x0, x1 = x, min(len(bnd)-1, x+step)
            x = x1
            q0, q1 = self.Qat(bnd, x0), self.Qat(bnd, x1)
            riblen = self.R*math.acos(max(-1, min(1, float(np.dot(unit(self.P-self.C), unit((q0+q1)/2-self.C))))))
            if riblen < 6:
                continue
            tend = .99
            t_start = max(.14, 4.0/riblen)
            if tend-t_start < .05:
                continue
            nseg = max(2, int(round(riblen*(tend-t_start)/4.0)))
            edges = np.linspace(t_start, tend, nseg+1)
            chev = .9/riblen
            jg, cg = .045, .05/riblen   # rib joint (fraction of strip), course joint
            xm = (x0+x1)/2
            xs = (x0+jg*(x1-x0), xm, x1-jg*(x1-x0))
            for k in range(nseg):
                ta, tb = edges[k]+cg, edges[k+1]-cg
                rowsO, rowsI = [], []
                for xx in xs:
                    Q = self.Qat(bnd, xx)
                    off = chev*(1-abs((xx-xm)/((x1-x0)/2)))
                    tA = min(tend, ta+off) if k else ta
                    tB = min(tend, tb+off) if k < nseg-1 else tb
                    rowsO.append([self.world(self.rib(Q, t, self.R+.07), mirror) for t in (tA, tB)])
                    rowsI.append([self.world(self.rib(Q, t, self.R-.05), mirror) for t in (tA, tB)])
                solid(self.name+' lid', rowsO, rowsI, 'tile', True)

    def soffit_ribs(self, bnd, mirror):
        """Concrete rib fins under the overhang in front of the glass wall."""
        for j in range(0, len(bnd)-1):
            xj = j+.5 if j else .15
            ts = [t for t in np.linspace(.02, 1, 40) if self.rib(self.Qat(bnd, xj), t, self.R-.9)[2] > .8 and self.rib(self.Qat(bnd, xj), t, self.R-.9)[1] > 1.5]
            if len(ts) < 2:
                continue
            A_, B_ = [], []
            for side in (-.22, .22):
                Qs = self.Qat(bnd, xj+side/2.2)
                A_.append([self.world(self.rib(Qs, t, self.R-.85), mirror) for t in ts])
                B_.append([self.world(self.rib(Qs, t, self.R-1.75), mirror) for t in ts])
            solid(self.name+' soffit rib', A_, B_, 'concrete', True)

    def edge_beam(self, bnd, mirror):
        """Broad concrete edge band along the mouth (the precast edge segments), pedestal to tip."""
        ts = np.linspace(.03, 1, 34)
        rows_o, rows_i = [], []
        for x in (0, .42):
            Q = self.Qat(bnd, x)
            rows_o.append([self.world(self.rib(Q, t, self.R+.1), mirror) for t in ts])
            rows_i.append([self.world(self.rib(Q, t, self.R-1.6), mirror) for t in ts])
        solid(self.name+' edge band', rows_o, rows_i, 'concrete', True)

    def side_glazing(self, bnd, mirror):
        """Dark glazed band between the lifted side edge of the shell and its base, with bronze mullions."""
        cols = list(range(self.nridge, len(bnd)))
        top_o, top_i, bot_o, bot_i = [], [], [], []
        for j in cols:
            q = bnd[j]
            p_o = self.C+(self.R-.5)*unit(q-self.C); p_i = self.C+(self.R-.7)*unit(q-self.C)
            p_o[1] = max(p_o[1], .12); p_i[1] = max(p_i[1], .12)
            top_o.append(self.world(p_o, mirror)); top_i.append(self.world(p_i, mirror))
            bot_o.append(self.world((p_o[0], -.05, p_o[2]), mirror)); bot_i.append(self.world((p_i[0], -.05, p_i[2]), mirror))
        solid(self.name+' side glazing', [top_o, bot_o], [top_i, bot_i], 'glass_green')
        for j in cols[1::2]:
            q = self.C+(self.R-.4)*unit(bnd[j]-self.C)
            if q[1] > 1:
                m.tube(self.name+' side mullion', [self.world((q[0], 0, q[2]), mirror), self.world(q, mirror)], .07, 'bronze', 4)

    def ridge_beam(self):
        """Segmented ridge beam on the soffit of the overhang (close-ups under the tips)."""
        pts = []
        for k in range(len(self.bnd)):
            q = self.C+(self.R-.9)*unit(self.bnd[k]-self.C)
            if q[2] < -1.5 or q[1] < 2:
                break
            pts.append(q)
        if len(pts) < 2:
            return
        rows_o = [[self.world((a, q[1], q[2])) for q in pts] for a in (-.7, .7)]
        rows_i = [[self.world((a, q[1]-1.6, q[2])) for q in pts] for a in (-.7, .7)]
        solid(self.name+' ridge beam', rows_o, rows_i, 'concrete')

    def pedestals(self):
        for mirror in (1, -1):
            a = self.w*mirror
            pts = []
            for h, r in ((0, 2.4), (3.2, 1.3)):
                pts.append([self.world((a+dx*r, h, dz*r)) for dx, dz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
            verts = pts[0]+pts[1]
            faces = [(0, 1, 2, 3), (7, 6, 5, 4)]+[(i, (i+1) % 4, (i+1) % 4+4, i+4) for i in range(4)]
            m.mesh(self.name+' pedestal', verts, faces, 'concrete')

    def soffit_height(self, a, s=0.0):
        C, Ri = self.C, self.R-1.0
        q = Ri*Ri-(a-C[0])**2-(s-C[2])**2
        return C[1]+math.sqrt(q) if q > 0 else 0.0

    def glass_wall(self):
        """Glass wall hung from the soffit on the pedestal line. North (harbour) walls bulge out into a
        bronze-ribbed brim at foyer level; nested mouths are green glass; south mouths a plain fold."""
        na = 26
        As = np.linspace(-self.w+.9, self.w-.9, na)
        mat = 'glass_green' if self.kind == 'nested' else 'glass'
        peak, depth = {'north': (.28, 5.5), 'south': (.45, 2.2), 'nested': (.5, 1.0), 'rest': (.4, 1.6)}[self.kind]
        def top(a):
            return max(.5, self.soffit_height(abs(a))-.2)
        def fold(a, f):
            hmax = top(a)
            k = min(depth, .2*hmax)
            return k*(f/peak if f < peak else (1-f)/(1-peak))
        fr = sorted(set(np.linspace(0, 1, 9).tolist()+[peak]))
        O, I = [], []
        for a in As:
            hmax = top(a)
            O.append([self.world((a, f*hmax, -.4+fold(a, f))) for f in fr])
            I.append([self.world((a, f*hmax, -.58+fold(a, f))) for f in fr])
        solid(self.name+' glass', O, I, mat)
        spacing = 1.6 if self.kind == 'nested' else 2.4
        for a in np.linspace(-self.w+1.2, self.w-1.2, max(3, int(2*self.w/spacing))):
            hmax = top(a)
            if hmax < 2:
                continue
            pts = [self.world((a, f*hmax, -.28+fold(a, f))) for f in (0, peak, 1)]
            m.tube(self.name+' mullion', pts, .12 if self.kind != 'nested' else .09, 'bronze', 4)
        for f in ((peak, .15, .6, .8) if self.kind == 'north' else (.5, .25, .75)):
            pts = [self.world((a, f*top(a), -.28+fold(a, f))) for a in np.linspace(-self.w+1, self.w-1, 24)]
            m.tube(self.name+' transom', pts, .08, 'bronze', 4)


# ---------------------------------------------------------------- podium
def walls(outline, top, exposed, label, west_under=None):
    """Podium wall stack on a plan outline: base course, dark window strip, panelled wall with vertical joints
    (shallow granite fins), projecting coping and paving. exposed(i) says whether edge i is an outside face."""
    ins = lambda d: (lambda i: d if exposed(i) else 0.0)
    under = west_under or (lambda i: False)
    prism(label+' base', offset_ring(outline, lambda i: 3.2 if under(i) else (.45 if exposed(i) else 0)), 0, 4.6, 'granite')
    prism(label+' window strip', offset_ring(outline, ins(1.0)), 4.6, 5.4, 'glass')
    body = offset_ring(outline, ins(.4))
    prism(label+' wall', body, 5.4, top-1.0, 'granite')
    prism(label+' coping', outline, top-1.0, top-.35, 'granite')
    prism(label+' paving', offset_ring(outline, ins(.08)), top-.35, top, 'paving')
    # vertical panel joints: shallow fins standing proud of the wall face every 1.4 m
    n = len(outline)
    sgn = ccw(outline)
    for i in range(n):
        if not exposed(i):
            continue
        a = np.array(body[i]); b = np.array(body[(i+1) % n])
        L = np.linalg.norm(b-a)
        if L < 2:
            continue
        t = unit(b-a); nrm = sgn*np.array([-t[1], t[0]])
        cnt = int(L//1.4)
        for c in range(1, cnt):
            p = a+t*(L*c/cnt)
            q0 = p-nrm*.16; 
            fin = [tuple(q0-t*.14), tuple(q0+t*.14), tuple(q0+t*.14+nrm*.2), tuple(q0-t*.14+nrm*.2)]
            m.shell('podium panel joint', [(x, 5.4, y) for x, y in fin], (0, top-1.0-5.4, 0), 'granite')
        # window strip mullions on the base course level
        if not under(i):
            cnt2 = int(L//2.8)
            for c in range(1, cnt2):
                p = a+t*(L*c/cnt2)-nrm*0.0
                ubox(p[0]-.08, p[0]+.08, 4.6, 5.4, p[1]-.08, p[1]+.08, 'bronze', 'strip mullion')


def undercroft(outline, is_west):
    """Piers and a bronze-framed glazed frontage in the recessed western undercroft."""
    n = len(outline)
    cen = np.mean(np.array(outline), axis=0)
    for i in range(n):
        if not is_west(i):
            continue
        a, b = np.array(outline[i]), np.array(outline[(i+1) % n])
        L = np.linalg.norm(b-a)
        t = unit(b-a); nrm = np.array([t[1], -t[0]])
        if np.dot(cen-(a+b)/2, nrm) < 0:
            nrm = -nrm
        cnt = int(L//6.5)
        for c in range(1, cnt+1):
            p = a+t*(L*c/(cnt+1))+nrm*.9
            ubox(p[0]-.6, p[0]+.6, 0, 4.6, p[1]-.6, p[1]+.6, 'granite', 'undercroft pier')
        g0 = a+nrm*3.15; g1 = b+nrm*3.15
        segs = max(2, int(L//3.2))
        for c in range(segs):
            p = g0+(g1-g0)*(c+.12)/segs; q = g0+(g1-g0)*(c+.88)/segs
            outline_g = [(p[0], .3, p[1]), (q[0], .3, q[1]), (q[0]-nrm[0]*.12, .3, q[1]-nrm[1]*.12), (p[0]-nrm[0]*.12, .3, p[1]-nrm[1]*.12)]
            m.shell('undercroft glass', outline_g, (0, 3.9, 0), 'glass')
            mp = g0+(g1-g0)*c/segs-nrm*.1
            ubox(mp[0]-.09, mp[0]+.09, .3, 4.2, mp[1]-.09, mp[1]+.09, 'bronze', 'frontage frame')


# plan of the south end (v > 30): restaurant block | steps | east block
V_SPLIT = 30.0
U_REST = -27.5          # east face of the restaurant block (the side stair runs just east of it)
U_STEP0, U_STEP1 = -24.5, 39.9
V_BOT = 83.8
V_CON1 = 50.0          # north end of the side stair's landing
TREAD, RISERS_LOW, RISERS_UP, LANDING = .42, 12, 60, 1.6
RISER = HP/(RISERS_LOW+RISERS_UP)
V_TOP = V_BOT-(RISERS_LOW+RISERS_UP)*TREAD-LANDING


def podium(ring):
    north = dedupe(clip_half(ring, V_SPLIT))
    n = len(north)
    def is_clip(i):
        a, b = north[i], north[(i+1) % n]
        return abs(a[1]-V_SPLIT) < 1e-6 and abs(b[1]-V_SPLIT) < 1e-6
    def is_west(i):
        a, b = north[i], north[(i+1) % n]
        return a[0] < -45.5 and b[0] < -45.5 and -22 < a[1] and -22 < b[1]
    walls(north, HP, lambda i: not is_clip(i), 'podium', is_west)
    undercroft(north, is_west)
    west_u = min(p[0] for p in ring if p[1] > V_SPLIT)
    # restaurant block (south-west corner), with the vehicle entrance recessed into its south face
    e0, e1, eh, ed = -41.0, -30.0, 6.0, 9.0
    rest = [(west_u, V_SPLIT), (U_REST, V_SPLIT), (U_REST, V_BOT), (e1, V_BOT), (e1, V_BOT-ed), (e0, V_BOT-ed), (e0, V_BOT), (west_u, V_BOT)]
    walls(rest, HR, lambda i: i != 0, 'restaurant block')
    # (stacked, never overlapping: coplanar faces flicker in the game and render black in Cycles)
    ubox(e0, e1, eh, HR-.35, V_BOT-ed, V_BOT, 'granite', 'vehicle entrance lintel')
    ubox(e0, e1, HR-.35, HR, V_BOT-ed, V_BOT, 'paving', 'lintel paving')
    ubox(e0, e1, 0, eh, V_BOT-ed-.3, V_BOT-ed, 'glass', 'vehicle entrance back glazing')
    # solid podium under the plaza at the top of the steps, and the east block beside it
    ubox(U_REST, U_STEP1, 0, HP-.35, V_SPLIT, V_TOP, 'granite', 'plaza block')
    ubox(U_REST, U_STEP1, HP-.35, HP, V_SPLIT, V_TOP, 'paving', 'plaza paving')
    east = [(U_STEP1, V_SPLIT), (50.2, V_SPLIT), (49.6, 60.7), (U_STEP1, 60.7)]
    walls(east, HP, lambda i: i != 0, 'east block')


def clip_hp(poly, nu, nv, d):
    """Keep the part of a polygon where nu*u + nv*v <= d (Sutherland-Hodgman against one half-plane)."""
    out = []
    f = lambda p: nu*p[0]+nv*p[1]-d
    for p, q in zip(poly, poly[1:]+poly[:1]):
        fp, fq = f(p), f(q)
        if fp <= 0:
            out.append(p)
        if (fp < 0) != (fq < 0) and fp != fq:
            t = fp/(fp-fq); out.append((p[0]+(q[0]-p[0])*t, p[1]+(q[1]-p[1])*t))
    return dedupe(out, .05)


def plinth(outline, y0, top, label):
    """Raised hall base under the harbour-end shells: panelled granite walls with vertical joints, a dark
    window strip, coping and paving (the halls step down from the harbour end in the side-view photo)."""
    prism(label+' wall', offset_ring(outline, lambda i: .35), y0, top-.8, 'granite')
    ym = y0+(top-.8-y0)*.5
    prism(label+' window strip', offset_ring(outline, lambda i: .15), ym-.35, ym+.35, 'glass')
    prism(label+' coping', outline, top-.8, top-.3, 'granite')
    prism(label+' paving', offset_ring(outline, lambda i: .08), top-.3, top, 'paving')
    body = offset_ring(outline, lambda i: .35)
    n = len(body); sgn = ccw(body)
    for i in range(n):
        a = np.array(body[i]); b = np.array(body[(i+1) % n])
        L = np.linalg.norm(b-a)
        if L < 2:
            continue
        t = unit(b-a); nrm = sgn*np.array([-t[1], t[0]])
        cnt = int(L//1.4)
        for c in range(1, cnt):
            q0 = a+t*(L*c/cnt)-nrm*.16
            fin = [tuple(q0-t*.14), tuple(q0+t*.14), tuple(q0+t*.14+nrm*.2), tuple(q0-t*.14+nrm*.2)]
            m.shell(label+' panel joint', [(x, y0, y) for x, y in fin], (0, top-.8-y0, 0), 'granite')


def hall_plinths(ring):
    inner = offset_ring(ring, lambda i: 2.0)
    # Concert Hall: raised under A1 (to 20.4 m) and A2 (to 14.7 m)
    west = clip_hp(inner, 1, 0, 1.5)
    plinth(clip_hp(west, 0, 1, -35.8), HP, 20.4, 'concert hall north base')
    plinth(clip_hp(clip_hp(west, 0, 1, -16.4), 0, -1, 35.8), HP, 14.7, 'concert hall middle base')
    # Joan Sutherland Theatre: raised under B1 (18.5 m) and B2 (14.0 m)
    east = clip_hp(inner, -1, 0, -11.0)
    plinth(clip_hp(east, 0, 1, -34.0), HP, 18.5, 'theatre north base')
    plinth(clip_hp(clip_hp(east, 0, 1, -17.0), 0, -1, 34.0), HP, 14.0, 'theatre middle base')


def stair_profile(v_top, y_top, v_bot, flights, tread):
    """Nosing profile (v, y) from the top edge down to the ground, flights = [(risers, landing_after)]."""
    pts = [(v_top, y_top)]
    v, y = v_top, y_top
    riser = y_top/sum(r for r, _ in flights)
    for risers, landing in flights:
        for s in range(risers):
            y -= riser
            pts.append((v, y))
            v += tread
            pts.append((v, y))
        v += landing
        if landing:
            pts[-1] = (v, y)
    pts[-1] = (v_bot, 0.0)
    return dedupe(pts, 1e-4)


def steps():
    prof = stair_profile(V_TOP, HP, V_BOT, [(RISERS_UP, LANDING), (RISERS_LOW, 0)], TREAD)
    outline = prof+[(V_TOP, 0.0)]
    outline = [p for p in outline]
    m.shell('monumental steps', [(U_STEP0, y, v) for v, y in outline], (U_STEP1-.7-U_STEP0, 0, 0), 'paving')
    # cheek wall on the east end, low granite parapet 0.9 m above the nosings
    corners = [(V_TOP, HP), (V_TOP+RISERS_UP*TREAD, HP-RISERS_UP*RISER), (V_TOP+RISERS_UP*TREAD+LANDING, HP-RISERS_UP*RISER), (V_BOT, 0)]
    top = [(v, y+.9) for v, y in corners]
    ol = top+[(V_BOT, 0.0), (V_TOP, 0.0)]
    m.shell('steps cheek wall', [(U_STEP1-.7, y, v) for v, y in ol], (.7, 0, 0), 'granite')
    # side stair along the west end of the steps, up to the restaurant terrace (0.3 m treads)
    n = int(round(HR/.165))
    sprof = stair_profile(V_BOT-n*.3, HR, V_BOT, [(n, 0)], .3)
    so = [(V_CON1, HR)]+sprof+[(V_CON1, 0.0)]
    so = dedupe(so, 1e-4)
    m.shell('side stair', [(U_REST, y, v) for v, y in so], (U_STEP0-U_REST-.35, 0, 0), 'paving')
    # wall between the side stair and the main steps, stepping with both
    wt = [(V_CON1, HP+.9), (V_TOP, HP+.9), (V_BOT-n*.3, HR+.9), (V_BOT, 1.0), (V_BOT, 0.0), (V_CON1, 0.0)]
    m.shell('side stair wall', [(U_STEP0-.35, y, v) for v, y in wt], (.35, 0, 0), 'granite')


def main():
    global m
    ap = argparse.ArgumentParser()
    ap.add_argument('--render-dir')
    args = ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    m = Model('opera-house')
    m.material('tile', (.93, .91, .85), 0, .22, 'opera-house_tile')
    m.material('concrete', (.80, .76, .68), 0, .78, 'opera-house_concrete')
    m.material('glass', (.16, .12, .08), .35, .07, 'opera-house_glass')
    m.material('glass_green', (.05, .10, .08), .3, .06, 'opera-house_glass_green')
    m.material('bronze', (.36, .24, .14), .8, .42, 'opera-house_bronze')
    m.material('granite', (.66, .52, .44), 0, .72, 'opera-house_granite')
    m.material('paving', (.64, .53, .47), 0, .85, 'opera-house_granite_paving')
    ring = dedupe([tuple(p) for p in m.spec['ring']])
    podium(ring)
    steps()

    hall_plinths(ring)

    def hall(n0, s_dir, shells, prefix):
        n0 = np.array(n0, float); S = unit(np.array(s_dir, float))
        for name, v_feet, facing, w, ov, top, M, base, lift, kind in shells:
            feet = n0+S*(v_feet-n0[1])/S[1]
            Shell(prefix+name, feet, -S if facing == 'n' else S, w, ov, top-base, M, base=base, lift=lift, kind=kind).build()

    # All numbers from the side-view photo at 5.9 px per m, heights scaled so the tallest tip is 65 m.
    # name, pedestal line v, facing, half-span, tip overhang, tip height (datum), ridge point M (s, h above
    # base), base height, lifted side edge, glass kind
    hall((-31, -85), (18, 125), [('A1', -61.3, 'n', 24, 17.8, 42.5, (-12.3, 16.3), 20.4, 4.0, 'north'),
                                 ('A2', -35.8, 'n', 23, 17.8, 51.1, (-6.8, 29.5), 14.7, 7.0, 'nested'),
                                 ('A3', -16.4, 'n', 22, 19.4, 65.0, (-22.9, 18.0), HP, 7.0, 'nested'),
                                 ('A4', 29.4, 's', 19, 10.2, 36.0, (-22.9, 18.0), HP, 6.0, 'south')], 'concert hall ')
    # Joan Sutherland Theatre (east views, less certain): the same pattern a little lower
    hall((37, -76), (-14, 111), [('B1', -56.0, 'n', 19, 16.0, 35.0, (-11.0, 13.5), 18.5, 4.0, 'north'),
                                 ('B2', -34.0, 'n', 19, 16.0, 45.0, (-7.0, 25.0), 14.0, 6.0, 'nested'),
                                 ('B3', -17.0, 'n', 19, 17.0, 58.5, (-21.0, 16.0), HP, 6.0, 'nested'),
                                 ('B4', 25.0, 's', 16, 9.0, 31.5, (-20.0, 15.0), HP, 5.0, 'south')], 'theatre ')
    # Bennelong restaurant (south-west corner): two back-to-back shells on the restaurant block
    Shell('restaurant C1', (-37, 52.0), (0, -1), 9, 12.0, 25.1-HR, (-8.0, 8.0), base=HR, lift=4.0, kind='rest').build()
    Shell('restaurant C2', (-37, 73.8), (0, 1), 9, 12.4, 25.5-HR, (-13.8, 8.0), base=HR, lift=4.0, kind='rest').build()

    d = Path(args.render_dir) if args.render_dir else None
    m.finish(d)


main()
