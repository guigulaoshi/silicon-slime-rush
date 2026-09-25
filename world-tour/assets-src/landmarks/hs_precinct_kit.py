"""Shared geometry for the Ottoman buildings round Hagia Sophia (route `istanbul`).

Used by build_tomb-of-*.py and build_hagia-sophia-{school,muvakkithane,sadirvan,west-portico}.py.
Everything is authored in the survey frame of build_landmark_tools.Model: u across the footprint's long
axis, v along it, y up from the ground datum. Each helper adds closed components; Model.finish() checks
they are closed and writes the GLB.

Conventions shared by every precinct building:
  * a wall is a slab d in [-depth, 0] in front of a solid core, so every window is a real recess
    (the reveal is `depth` deep) closed at the back by a dark iron grille;
  * domes carry standing-seam ribs as geometry (every third meridian stands proud), because the
    ribbed lead is what a lead dome reads as from the road;
  * materials are named `<id>_<what>` so the game tells marble and stone from lead (world/materials.ts).
"""
import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model  # noqa: E402
from build_moffett_aircraft import xyz  # noqa: E402

TAU = 2 * math.pi

# One palette for the whole precinct, so the tombs match each other and the church beside them.
PALETTE = {
    'marble': ((0.80, 0.78, 0.73), 0.0, 0.55),      # Proconnesian marble cladding of the sultans' tombs
    'stone': ((0.72, 0.68, 0.60), 0.0, 0.85),       # weathered limestone / kufeki ashlar
    'brick': ((0.55, 0.28, 0.18), 0.0, 0.85),       # brick courses of the striped (almasik) walls
    'plaster': ((0.52, 0.16, 0.12), 0.0, 0.85),     # the ox-blood render of the small drums
    'lead': ((0.40, 0.42, 0.45), 0.35, 0.55),       # lead sheet on domes and roofs (as hagia-sophia)
    'grille': ((0.06, 0.06, 0.06), 0.5, 0.5),       # iron window grilles over dark glass
    'gold': ((0.86, 0.66, 0.26), 1.0, 0.3),         # gilded finials
    'wood': ((0.30, 0.17, 0.09), 0.0, 0.7),         # doors
    'tile': ((0.18, 0.36, 0.55), 0.0, 0.35),        # Iznik tile panels in the porticos
    'paint': ((0.33, 0.47, 0.40), 0.0, 0.6),        # painted green eave soffit (sadirvan)
    'redstone': ((0.62, 0.30, 0.24), 0.0, 0.8),     # red voussoirs of the striped portico arches
}


def out_dir(ident):
    return Path(tempfile.gettempdir()) / 'sr-landmarks' / ident


class Fr:
    """Wall frame: a along the wall (tangent t), d outward (normal n), in the (u, v) plan."""
    def __init__(s, u0, v0, t, n):
        s.u0, s.v0, s.t, s.n = u0, v0, t, n

    def p(s, a, y, d):
        return (s.u0 + a * s.t[0] + d * s.n[0], y, s.v0 + a * s.t[1] + d * s.n[1])


def radial(cu, cv, t, r):
    """Frame on a circle of radius r round (cu, cv), facing outward at angle t."""
    return Fr(cu + r * math.cos(t), cv + r * math.sin(t), (-math.sin(t), math.cos(t)), (math.cos(t), math.sin(t)))


class Kit:
    def __init__(self, ident, materials):
        self.M = Model(ident)
        self.id = ident
        for key in materials:
            color, metal, rough = PALETTE[key]
            self.M.material(key, color, metal, rough, ident + '_' + key)

    def finish(self):
        return self.M.finish(directory=out_dir(self.id))

    # ------------------------------------------------------------------ raw primitives
    def raw(self, verts, faces, mat, smooth=False):
        g = self.M.groups.setdefault(mat, [[], [], []])
        off = len(g[0])
        g[0].extend(xyz(self.M.point(p)) for p in verts)
        g[1].extend(tuple(i + off for i in f) for f in faces)
        g[2].extend(smooth if isinstance(smooth, list) else [smooth] * len(faces))
        self.M.authored_components += 1

    BOXF = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]

    def hexa(self, c, mat):
        self.raw(c, self.BOXF, mat)

    def ubox(self, u0, u1, y0, y1, v0, v1, mat):
        self.hexa([(u0, y0, v0), (u1, y0, v0), (u1, y0, v1), (u0, y0, v1),
                   (u0, y1, v0), (u1, y1, v0), (u1, y1, v1), (u0, y1, v1)], mat)

    def box(self, fr, a0, a1, y0, y1, d0, d1, mat):
        q = [(a0, d0), (a1, d0), (a1, d1), (a0, d1)]
        self.hexa([fr.p(a, y0, d) for a, d in q] + [fr.p(a, y1, d) for a, d in q], mat)

    def prism(self, pts, y0, y1, mat):
        self.frustum(pts, y0, pts, y1, mat)

    def frustum(self, lo, y0, hi, y1, mat):
        """Closed solid between plan polygon `lo` at y0 and `hi` (same vertex count) at y1."""
        n = len(lo)
        v = [(u, y0, w) for u, w in lo] + [(u, y1, w) for u, w in hi]
        f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        self.raw(v, f, mat)

    def roof_ring(self, outer, y_out, inner, y_in, th, mat, soffit=None, soffit_th=0.06):
        """Sloped roof band between a plan polygon at the eaves and a smaller one (same vertex count)
        higher up: a closed slab `th` thick, optionally with a painted soffit skin under it."""
        n = len(outer)
        V = ([(u, y_out, w) for u, w in outer] + [(u, y_in, w) for u, w in inner] +
             [(u, y_in - th, w) for u, w in inner] + [(u, y_out - th, w) for u, w in outer])
        F = []
        for i in range(n):
            j = (i + 1) % n
            F.append((i, j, n + j, n + i))                       # top
            F.append((n + i, n + j, 2 * n + j, 2 * n + i))       # inner edge
            F.append((2 * n + i, 2 * n + j, 3 * n + j, 3 * n + i))   # underside
            F.append((3 * n + i, 3 * n + j, j, i))               # fascia
        self.raw(V, F, mat)
        if soffit:
            V2 = ([(u, y_out - th, w) for u, w in outer] + [(u, y_in - th, w) for u, w in inner] +
                  [(u, y_in - th - soffit_th, w) for u, w in inner] + [(u, y_out - th - soffit_th, w) for u, w in outer])
            self.raw(V2, F, soffit)

    def revolve(self, cu, cv, prof, sides, mat, smooth=True, apex=None, rot=0.0):
        """Solid of revolution about the vertical axis at (cu, cv); prof = [(r, y)...] bottom to top."""
        m = sides
        V = []
        for r, y in prof:
            for j in range(m):
                t = rot + TAU * j / m
                V.append((cu + r * math.cos(t), y, cv + r * math.sin(t)))
        n = len(prof)
        faces, sm = [], []
        for i in range(n - 1):
            for j in range(m):
                a = i * m + j
                b = i * m + (j + 1) % m
                faces.append((a, b, b + m, a + m)); sm.append(smooth)
        top = (n - 1) * m
        if apex is not None:
            V.append((cu, apex, cv))
            ai = len(V) - 1
            for j in range(m):
                faces.append((top + j, top + (j + 1) % m, ai)); sm.append(smooth)
        faces.append(tuple(reversed(range(m)))); sm.append(False)
        if apex is None:
            faces.append(tuple(range(top, top + m))); sm.append(False)
        self.raw(V, faces, mat, sm)

    def ribbed_dome(self, cu, cv, y0, r, rise, mat='lead', ribs=40, rings=12, rib=0.07):
        """Lead dome with standing seams: an elliptical cap whose every third meridian stands `rib` metres proud.
        Returns the height of the small flat collar left at the crown for the finial."""
        sides = ribs * 3
        V = []
        top_phi = math.radians(84)
        for i in range(rings + 1):
            phi = top_phi * i / rings
            rr, yy = r * math.cos(phi), y0 + rise * math.sin(phi)
            for j in range(sides):
                t = TAU * j / sides
                k = 1.0 + (rib / r if j % 3 == 0 else 0.0) * math.cos(phi) ** 0.5
                V.append((cu + rr * k * math.cos(t), yy, cv + rr * k * math.sin(t)))
        n = rings + 1
        faces = []
        for i in range(n - 1):
            for j in range(sides):
                a = i * sides + j
                b = i * sides + (j + 1) % sides
                faces.append((a, b, b + sides, a + sides))
        faces.append(tuple(reversed(range(sides))))
        faces.append(tuple(range((n - 1) * sides, n * sides)))
        sm = [True] * (len(faces) - 2) + [False, False]
        self.raw(V, faces, mat, sm)
        return y0 + rise * math.sin(top_phi)

    def dormer(self, cu, cv, t, r_face, y0, w, h, back=1.4, mat='lead'):
        """Small round-arched window standing out of a dome's base (Selim II, Mehmed III): a lead-clad
        frame round a recessed opening, facing outward at angle t, its back buried in the dome."""
        fr = radial(cu, cv, t, r_face)
        self.pierced(fr, -w / 2 - 0.3, w / 2 + 0.3, y0, y0 + h + w / 2 + 0.3, -back, 0.0,
                     (0.0, w, y0 + 0.3, y0 + h), mat)
        self.arch_ring(fr, 0.0, w / 2 + 0.3, w / 2 + 0.5, y0 + h, -back, 0.1, mat, seg=8, legs=h + 0.05 - 0.3)

    def finial(self, cu, cv, y0, s):
        """Gilded alem: stacked bulbs and a crescent (same profile as the hagia-sophia alem)."""
        prof = [(0.35, 0.0), (0.35, 0.4), (0.12, 0.6), (0.12, 0.9), (0.45, 1.1), (0.55, 1.35), (0.45, 1.6), (0.12, 1.8),
                (0.3, 2.0), (0.36, 2.2), (0.3, 2.4), (0.1, 2.6), (0.1, 3.0)]
        self.revolve(cu, cv, [(r * s, y0 + y * s) for r, y in prof], 12, 'gold', apex=y0 + 3.15 * s)
        arc = [(cu + 0.55 * s * math.cos(math.radians(a)), y0 + 3.75 * s + 0.55 * s * math.sin(math.radians(a)), cv)
               for a in range(200, 345, 12)]
        self.M.tube('crescent', arc, 0.07 * s, 'gold', sides=6)
        return y0 + 4.3 * s

    # ------------------------------------------------------------------ walls with real openings
    def pierced(self, fr, a0, a1, y0, y1, d0, d1, hole, mat, pane='grille', kind='round'):
        """Slab (a0..a1, y0..y1, depth d0..d1 outward) with one opening right through it.
        hole = (centre a, width, sill y, springing y); kind round | pointed | rect.
        A dark grille closes the back of the reveal."""
        ax, w, yb, ys = hole
        inner = opening_loop(ax, w, yb, ys, kind)
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
        self.raw(V, faces, mat)
        if pane:
            top = max(y for _, y in inner)
            self.box(fr, ax - w / 2 - 0.05, ax + w / 2 + 0.05, yb - 0.05, top + 0.05, d0 - 0.06, d0 + 0.12, pane)

    def arch_ring(self, fr, ax, r0, r1, ys, d0, d1, mat, seg=12, legs=0.0, kind='round'):
        """Voussoir band round an arch (optionally with legs down the jambs)."""
        po = arch_curve(ax, r1 * 2, ys, kind, seg)
        pi_ = arch_curve(ax, r0 * 2, ys, kind, seg)
        if legs > 0:
            po = [(ax + r1, ys - legs)] + po + [(ax - r1, ys - legs)]
            pi_ = [(ax + r0, ys - legs)] + pi_ + [(ax - r0, ys - legs)]
        n = len(po)
        V = ([fr.p(s, y, d1) for s, y in po] + [fr.p(s, y, d1) for s, y in pi_] +
             [fr.p(s, y, d0) for s, y in po] + [fr.p(s, y, d0) for s, y in pi_])
        fo, fi, bo, bi = 0, n, 2 * n, 3 * n
        faces = []
        for k in range(n - 1):
            faces.append((fo + k, fo + k + 1, fi + k + 1, fi + k))
            faces.append((bi + k, bi + k + 1, bo + k + 1, bo + k))
            faces.append((bo + k, bo + k + 1, fo + k + 1, fo + k))
            faces.append((fi + k, fi + k + 1, bi + k + 1, bi + k))
        faces.append((fo, fi, bi, bo))
        faces.append((fo + n - 1, bo + n - 1, bi + n - 1, fi + n - 1))
        self.raw(V, faces, mat)

    def wall(self, fr, a0, a1, y0, y1, depth, openings=(), mat='marble', bands=None, pane='grille'):
        """Wall slab d in [-depth, 0] from a0 to a1, y0 to y1, with openings cut right through.

        openings: (centre a, width, sill, springing, kind[, fill]) -- kind rect | round | pointed.  A
        rect opening is a hole in the block grid; an arched one gets a `pierced` cell of its own.
        fill (optional) is the material closing the reveal (default the grille; 'wood' for a door).
        bands: [(y_top, material)...] ascending -- horizontal courses (striped masonry, plinths)."""
        cells = []
        for o in openings:
            ac, w, sill, spring, kind = o[:5]
            fill = o[5] if len(o) > 5 else pane
            if kind == 'rect':
                cells.append((ac - w / 2, ac + w / 2, sill, spring, None, fill))
            else:
                top = max(y for _, y in opening_loop(ac, w, sill, spring, kind)) + 0.3
                cells.append((ac - w / 2 - 0.25, ac + w / 2 + 0.25, max(y0, sill - 0.15), min(top, y1),
                              (ac, w, sill, spring, kind), fill))

        def mat_at(y):
            if not bands:
                return mat
            for yt, m in bands:
                if y < yt - 1e-6:
                    return m
            return bands[-1][1]

        ys = {y0, y1}
        for c in cells:
            ys |= {c[2], c[3]}
        if bands:
            ys |= {yt for yt, _ in bands if y0 < yt < y1}
        ys = sorted(y for y in ys if y0 - 1e-9 <= y <= y1 + 1e-9)
        for ya, yb in zip(ys, ys[1:]):
            if yb - ya < 1e-4:
                continue
            ym = (ya + yb) / 2
            cuts = sorted((c[0], c[1]) for c in cells if c[2] <= ym <= c[3])
            a = a0
            for c0, c1 in cuts:
                if c0 > a + 1e-4:
                    self.box(fr, a, c0, ya, yb, -depth, 0.0, mat_at(ym))
                a = max(a, c1)
            if a1 > a + 1e-4:
                self.box(fr, a, a1, ya, yb, -depth, 0.0, mat_at(ym))
        for c0, c1, cy0, cy1, hole, fill in cells:
            if hole is None:
                if fill:
                    self.box(fr, c0 - 0.03, c1 + 0.03, cy0 - 0.03, cy1 + 0.03, -depth - 0.06, -depth + 0.14, fill)
            else:
                ac, w, sill, spring, kind = hole
                self.pierced(fr, c0, c1, cy0, cy1, -depth, 0.0, (ac, w, sill, spring), mat_at((cy0 + cy1) / 2),
                             pane=fill, kind=kind)

    def polygon_body(self, ring, y0, y1, depth, openings_for, mat='marble', core=None, bands=None, pane='grille',
                     mat_for=None):
        """A building on a convex plan polygon: a solid core inset by `depth` plus one wall slab per
        edge carrying that edge's openings.  openings_for(i, frame, length) -> openings list;
        mat_for(i, frame, length) -> that wall's material, when one face differs (a rendered rear)."""
        pts = ccw(ring)
        self.prism(offset_poly(pts, -depth), y0, y1, core or mat)
        frames = []
        for i in range(len(pts)):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            t = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
            n = (t[1], -t[0])                       # outward for a counter-clockwise ring
            fr = Fr(p[0], p[1], t, n)
            self.wall(fr, 0.0, L, y0, y1, depth, openings_for(i, fr, L), mat_for(i, fr, L) if mat_for else mat, bands, pane)
            frames.append((fr, L))
        return frames

    def moulding(self, ring, y, h, out, mat='marble'):
        """Horizontal band round a plan polygon, standing `out` proud of it."""
        self.prism(offset_poly(ccw(ring), out), y, y + h, mat)

    def corbel_cornice(self, ring, y, steps, mat='marble'):
        """Stepped (muqarnas-like) cornice: steps = [(height, projection)...] bottom to top."""
        for h, out in steps:
            self.moulding(ring, y, h, out, mat)
            y += h
        return y


def arch_curve(ax, w, ys, kind='round', seg=10):
    """Points of an arch from the right springing over to the left one."""
    r = w / 2
    if kind == 'pointed':
        R = 0.8 * w
        th = math.acos((R - r) / R)
        right = [(ax + r - R + R * math.cos(th * k / seg), ys + R * math.sin(th * k / seg)) for k in range(seg + 1)]
        left = [(2 * ax - x, y) for x, y in reversed(right[:-1])]
        return right + left
    return [(ax + r * math.cos(math.pi * k / seg), ys + r * math.sin(math.pi * k / seg)) for k in range(seg + 1)]


def opening_loop(ax, w, yb, ys, kind='round', seg=10):
    """Opening outline, counter-clockwise in the wall's (a, y) plane."""
    r = w / 2
    if kind == 'rect':
        return [(ax - r, yb), (ax + r, yb), (ax + r, ys), (ax - r, ys)]
    return [(ax - r, yb), (ax + r, yb)] + arch_curve(ax, w, ys, kind, seg)


def _ray_poly(c, ang, poly):
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


def ccw(pts):
    pts = list(pts)
    a = sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(pts, pts[1:] + pts[:1]))
    return pts if a > 0 else list(reversed(pts))


def offset_poly(pts, d):
    """Offset a convex counter-clockwise polygon outward by d (inward if d < 0)."""
    n = len(pts)
    lines = []
    for i in range(n):
        p, q = pts[i], pts[(i + 1) % n]
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        t = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
        nn = (t[1], -t[0])
        lines.append(((p[0] + nn[0] * d, p[1] + nn[1] * d), t))
    out = []
    for i in range(n):
        (p1, t1), (p2, t2) = lines[i - 1], lines[i]
        den = t1[0] * t2[1] - t1[1] * t2[0]
        s = ((p2[0] - p1[0]) * t2[1] - (p2[1] - p1[1]) * t2[0]) / den
        out.append((p1[0] + s * t1[0], p1[1] + s * t1[1]))
    return out


def regular(cu, cv, n, flat, rot):
    """Regular n-gon with inradius `flat`; one flat faces the plan angle `rot`."""
    R = flat / math.cos(math.pi / n)
    return [(cu + R * math.cos(rot + math.pi / n + TAU * k / n), cv + R * math.sin(rot + math.pi / n + TAU * k / n))
            for k in range(n)]


def chamfered_rect(u0, u1, v0, v1, c):
    return [(u0 + c, v0), (u1 - c, v0), (u1, v0 + c), (u1, v1 - c), (u1 - c, v1), (u0 + c, v1), (u0, v1 - c), (u0, v0 + c)]
