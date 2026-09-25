"""Shared geometry for the Sultanahmet monuments on the Blue Mosque side of route `istanbul`.

Used by build_tomb-of-ahmed-i.py, build_sultan-ahmed-madrasa.py, build_fountain-of-ahmed-iii.py,
build_german-fountain.py, build_obelisk-of-theodosius.py, build_walled-obelisk.py,
build_serpent-column.py and build_sultanahmet-park-fountain.py.

Everything is authored in the survey frame of build_landmark_tools.Model: u across the footprint's
long axis, v along it, y up from the ground datum (Model.finish puts the lowest vertex on y = 0, so
nothing is built below it). Every helper adds one closed component; Model.finish refuses an open one.
Materials are named `<id>_<what>`: the game reads the suffix (world/materials.ts) to give stone and
marble their weathering and to floodlight the monument at night, so a carved relief is `_carved`, a
wall `_marble` / `_stone`, and metal or water keeps a plain name.

The wall, arch and window writers follow build_blue-mosque.py (same two-centred Ottoman arch, the same
alternating voussoirs, the same glazed-and-grilled window), so the tomb, the madrasa and the mosque
beside them read as one building campaign.
"""
import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model  # noqa: E402
from build_moffett_aircraft import xyz  # noqa: E402

TAU = 2 * math.pi

# One palette for the whole group; stone, marble, lead and gold are the Blue Mosque's own values.
PALETTE = {
    'marble': ((0.80, 0.80, 0.77), 0.0, 0.45),      # Proconnesian marble cladding (tomb, fountains)
    'stone': ((0.61, 0.59, 0.55), 0.0, 0.82),       # grey kufeki ashlar (madrasa, annexes)
    'stone_red': ((0.56, 0.35, 0.29), 0.0, 0.80),   # red ablaq voussoirs
    'carved': ((0.76, 0.75, 0.71), 0.0, 0.75),      # reliefs, capitals, muqarnas
    'lead': ((0.47, 0.50, 0.54), 0.35, 0.55),       # lead-sheet domes and roofs
    'gold': ((0.84, 0.66, 0.28), 1.0, 0.30),        # gilded alem finials
    'glass': ((0.07, 0.09, 0.11), 0.1, 0.20),       # window panes
    'iron': ((0.10, 0.10, 0.11), 0.6, 0.50),        # grilles and railings
    'wood': ((0.30, 0.19, 0.11), 0.0, 0.70),        # doors
    'tile': ((0.66, 0.33, 0.22), 0.0, 0.75),        # red clay roof tiles
    'soffit': ((0.46, 0.20, 0.13), 0.0, 0.70),      # painted eave soffit (tomb portico)
}

OUT = Path(tempfile.gettempdir()) / 'sr-landmarks'


class SF:
    """Straight wall frame: x along t, d along the outward normal n, both in (u, v)."""
    curved = False

    def __init__(s, o, t, n):
        s.o, s.t, s.n = o, t, n

    def p(s, x, y, d):
        return (s.o[0] + x * s.t[0] + d * s.n[0], y, s.o[1] + x * s.t[1] + d * s.n[1])


class CF:
    """Curved wall frame round centre c: x is arc length on radius R from angle a0, d is radial."""
    curved = True

    def __init__(s, c, R, a0=0.0):
        s.c, s.R, s.a0 = c, R, a0

    def p(s, x, y, d):
        a = s.a0 + x / s.R
        r = s.R + d
        return (s.c[0] + r * math.cos(a), y, s.c[1] + r * math.sin(a))


def face_frames(u0, u1, v0, v1):
    """The four outward wall frames of a plan rectangle, x measured from each wall's middle and running
    left to right as seen from outside: {'-v': (frame, half length), '+u': ..., '+v': ..., '-u': ...}."""
    cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
    return {'-v': (SF((cu, v0), (-1, 0), (0, -1)), (u1 - u0) / 2),
            '+v': (SF((cu, v1), (1, 0), (0, 1)), (u1 - u0) / 2),
            '+u': (SF((u1, cv), (0, -1), (1, 0)), (v1 - v0) / 2),
            '-u': (SF((u0, cv), (0, 1), (-1, 0)), (v1 - v0) / 2)}


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def densify(outline, step):
    out = []
    for a, b in zip(outline, outline[1:] + outline[:1]):
        out.append(a)
        n = int(abs(b[0] - a[0]) / step)
        for k in range(1, n):
            t = k / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def arch(c, w, ys, kind, n=6):
    """Intrados from the left springing to the right springing, and the crown height."""
    if kind == 'flat':
        return [(c - w / 2, ys), (c + w / 2, ys)], ys
    if kind == 'round':
        R = w / 2
        return [(c + R * math.cos(math.pi * (1 - i / (2 * n))), ys + R * math.sin(math.pi * (1 - i / (2 * n))))
                for i in range(2 * n + 1)], ys + R
    e = 0.12 * w                                           # Ottoman two-centred arch, slightly pointed
    R = w / 2 + e
    t1 = math.acos(-e / R)
    left = [(c + e + R * math.cos(t), ys + R * math.sin(t)) for t in [math.pi + (t1 - math.pi) * i / n for i in range(n + 1)]]
    right = [(2 * c - x, y) for x, y in reversed(left[:-1])]
    return left + right, left[-1][1]


def opening_outline(o, n=6):
    pts, _ = arch(o['c'], o['w'], o['ys'], o['kind'], n)
    out = list(reversed(pts))
    if o['ys'] - o['sill'] > 1e-3:
        out = [(o['c'] - o['w'] / 2, o['sill']), (o['c'] + o['w'] / 2, o['sill'])] + out
    return out


class Kit:
    def __init__(self, ident, keys, extra=None):
        self.id = ident
        self.M = Model(ident)
        for key in keys:
            color, metal, rough = (extra or {}).get(key) or PALETTE[key]
            self.M.material(key, color, metal, rough, ident + '_' + key)

    # ------------------------------------------------------------------ writers

    def translucent(self, key, alpha):
        """Blend a material (water, spray): glTF alphaMode BLEND from the Principled alpha."""
        mat = self.M.materials[key]
        mat.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value = alpha
        mat.diffuse_color = (*mat.diffuse_color[:3], alpha)
        for attr, value in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
            try:
                setattr(mat, attr, value)
            except (AttributeError, TypeError):
                pass

    def raw(self, verts, faces, mat, smooth=False):
        g = self.M.groups.setdefault(mat, [[], [], []])
        off = len(g[0])
        g[0].extend(xyz(self.M.point(p)) for p in verts)
        g[1].extend(tuple(i + off for i in f) for f in faces)
        g[2].extend(smooth if isinstance(smooth, list) else [smooth] * len(faces))
        self.M.authored_components += 1

    def prism(self, fr, outline, d0, d1, mat):
        """Extrude a closed outline in the wall plane (x, y) through the wall (d0..d1)."""
        if fr.curved:
            outline = densify(outline, 1.0)
        n = len(outline)
        v = [fr.p(x, y, d0) for x, y in outline] + [fr.p(x, y, d1) for x, y in outline]
        f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        self.raw(v, f, mat)

    def box(self, u0, u1, y0, y1, v0, v1, mat):
        q = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        self.raw([(u, y0, v) for u, v in q] + [(u, y1, v) for u, v in q],
                 [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat)

    def extrude(self, poly, y0, y1, mat):
        """A plan polygon [(u, v)] (simple, either winding) extruded from y0 to y1."""
        self.frustum(poly, y0, poly, y1, mat)

    def frustum(self, poly0, y0, poly1, y1, mat, smooth=False):
        """Two plan polygons with the same vertex count joined into a closed solid (a tapering shaft)."""
        n = len(poly0)
        v = [(u, y0, w) for u, w in poly0] + [(u, y1, w) for u, w in poly1]
        f = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        self.raw(v, f, mat, [False, False] + [smooth] * n)

    def pyramid(self, poly, y0, apex, mat):
        n = len(poly)
        v = [(u, y0, w) for u, w in poly] + [apex]
        f = [tuple(reversed(range(n)))] + [(i, (i + 1) % n, n) for i in range(n)]
        self.raw(v, f, mat)

    def run(self, fr, xs, prof, mat):
        """Sweep a closed section [(d, y)] along a wall through the stations xs (a moulding)."""
        n, m = len(prof), len(xs)
        v = [fr.p(x, y, d) for x in xs for d, y in prof]
        f = [tuple(reversed(range(n))), tuple((m - 1) * n + i for i in range(n))]
        for k in range(m - 1):
            for i in range(n):
                a, b = k * n + i, k * n + (i + 1) % n
                f.append((a, b, b + n, a + n))
        self.raw(v, f, mat)

    def stations(self, fr, x0, x1):
        if not fr.curved:
            return [x0, x1]
        n = max(1, int(abs(x1 - x0) / 0.8))
        return [x0 + (x1 - x0) * k / n for k in range(n + 1)]

    def loop_sweep(self, path, prof, mat, smooth=False):
        """Sweep a closed section [(d, y)] round a closed plan path [(u, v)]: d is measured along each
        station's outward mitre, so a kerb, a cornice or an eave follows a polygon or a rounded outline
        without gaps at the corners. Torus topology, so it is closed."""
        n, m = len(prof), len(path)
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(path, path[1:] + path[:1]))
        sgn = 1.0 if area > 0 else -1.0
        verts = []
        for i in range(m):
            a, b, c = path[i - 1], path[i], path[(i + 1) % m]
            n1 = (sgn * (b[1] - a[1]), -sgn * (b[0] - a[0]))
            n2 = (sgn * (c[1] - b[1]), -sgn * (c[0] - b[0]))
            l1, l2 = math.hypot(*n1) or 1, math.hypot(*n2) or 1
            n1 = (n1[0] / l1, n1[1] / l1)
            n2 = (n2[0] / l2, n2[1] / l2)
            mx, mz = n1[0] + n2[0], n1[1] + n2[1]
            lm = math.hypot(mx, mz) or 1
            mx, mz = mx / lm, mz / lm
            k = 1.0 / max(0.35, mx * n1[0] + mz * n1[1])          # mitre length
            for d, y in prof:
                verts.append((b[0] + mx * d * k, y, b[1] + mz * d * k))
        faces = []
        for i in range(m):
            i2 = (i + 1) % m
            for j in range(n):
                j2 = (j + 1) % n
                faces.append((i * n + j, i * n + j2, i2 * n + j2, i2 * n + j))
        self.raw(verts, faces, mat, smooth)

    def revolve(self, c, prof, sides, mat, a0=None, a1=None, mod=None, smooth=True, phase=0.0):
        """Closed solid of revolution (full, or the sector a0..a1 closed by its two profile planes)."""
        uc, vc = c
        full = a0 is None
        apex = prof[-1][0] < 1e-6
        rp = prof[:-1] if apex else prof
        n = len(rp)
        angs = ([phase + TAU * j / sides for j in range(sides)] if full
                else [a0 + (a1 - a0) * j / sides for j in range(sides + 1)])
        cols = len(angs)
        V, F, S = [], [], []
        for r, y in rp:
            for j, a in enumerate(angs):
                m = mod(j) if mod else 1.0
                V.append((uc + r * m * math.cos(a), y, vc + r * m * math.sin(a)))
        idx = lambda i, j: i * cols + j
        js = range(cols) if full else range(cols - 1)
        for i in range(n - 1):
            for j in js:
                j2 = (j + 1) % cols
                F.append((idx(i, j), idx(i, j2), idx(i + 1, j2), idx(i + 1, j))); S.append(smooth)
        A = None
        if apex:
            A = len(V); V.append((uc, prof[-1][1], vc))
            for j in js:
                F.append((idx(n - 1, j), idx(n - 1, (j + 1) % cols), A)); S.append(smooth)
        if full:
            F.append(tuple(idx(0, j) for j in reversed(range(cols)))); S.append(False)
            if not apex:
                F.append(tuple(idx(n - 1, j) for j in range(cols))); S.append(False)
        else:
            Cb = len(V); V.append((uc, prof[0][1], vc))
            top = A
            if not apex:
                top = len(V); V.append((uc, prof[-1][1], vc))
            F.append(tuple([Cb] + [idx(i, 0) for i in range(n)] + [top])); S.append(False)
            F.append(tuple(reversed([Cb] + [idx(i, cols - 1) for i in range(n)] + [top]))); S.append(False)
            F.append(tuple([Cb] + [idx(0, j) for j in range(cols)])); S.append(False)
            if not apex:
                F.append(tuple(reversed([top] + [idx(n - 1, j) for j in range(cols)]))); S.append(False)
        self.raw(V, F, mat, S)

    def lathe(self, c, loop, sides, mat, smooth=True, phase=0.0):
        """Revolve a closed section loop [(r, y)] (r > 0 everywhere): a ring, a shell, a basin rim."""
        uc, vc = c
        n = len(loop)
        V = [(uc + r * math.cos(phase + TAU * j / sides), y, vc + r * math.sin(phase + TAU * j / sides))
             for r, y in loop for j in range(sides)]
        F = []
        for i in range(n):
            i2 = (i + 1) % n
            for j in range(sides):
                j2 = (j + 1) % sides
                F.append((i * sides + j, i * sides + j2, i2 * sides + j2, i2 * sides + j))
        self.raw(V, F, mat, smooth)

    def annulus(self, c, r0, r1, y0, y1, sides, mat, smooth=False, phase=0.0):
        self.lathe(c, [(r0, y0), (r1, y0), (r1, y1), (r0, y1)], sides, mat, smooth, phase)

    def cylinder(self, c, r, y0, y1, sides, mat, smooth=True, phase=0.0):
        self.revolve(c, [(r, y0), (r, y1)], sides, mat, smooth=smooth, phase=phase)

    def dome(self, c, r, y0, rise, mat='lead', sides=48, rings=12, ribs=0, rib_r=0.05, smooth=True):
        """A lead dome; `ribs` standing seams as geometry (they are what reads as lead from the road)."""
        ts = [0.5 * math.pi * k / rings for k in range(rings)]
        prof = [(r * math.cos(t), y0 + rise * math.sin(t)) for t in ts]
        self.revolve(c, prof + [(0.0, y0 + rise)], sides, mat, smooth=smooth)
        for k in range(ribs):
            a = TAU * k / ribs
            pts = [(c[0] + r * math.cos(t) * math.cos(a), y0 + rise * math.sin(t), c[1] + r * math.cos(t) * math.sin(a))
                   for t in [0.5 * math.pi * i / 8 for i in range(8)]]
            self.M.tube('seam', pts, rib_r, mat, 4)

    def vtube(self, points, radii, mat, sides=8, smooth=True):
        """A closed tube whose radius follows `radii` point by point (a tapering serpent, a jet)."""
        from mathutils import Vector
        V = []
        for i, p in enumerate(points):
            tangent = (Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(0, i - 1)])).normalized()
            other = Vector((0, 1, 0)) if abs(tangent.y) < .9 else Vector((1, 0, 0))
            a = tangent.cross(other).normalized()
            b = tangent.cross(a).normalized()
            V.extend(tuple(Vector(p) + radii[i] * (a * math.cos(j * TAU / sides) + b * math.sin(j * TAU / sides)))
                     for j in range(sides))
        F = [tuple(reversed(range(sides))), tuple((len(points) - 1) * sides + j for j in range(sides))]
        F += [(i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j)
              for i in range(len(points) - 1) for j in range(sides)]
        self.raw(V, F, mat, [False, False] + [smooth] * (len(F) - 2))

    def alem(self, c, y0, s=1.0, crescent=True):
        """Gilded finial: stacked bulbs on a rod and a crescent open to the sky (as the Blue Mosque);
        without the crescent the rod ends in a spike (the fountain's finials)."""
        prof = [(0.09, 0), (0.09, 0.3), (0.26, 0.42), (0.30, 0.58), (0.10, 0.78), (0.21, 0.92), (0.23, 1.06),
                (0.08, 1.24), (0.06, 1.62), (0.0, 1.66)]
        if not crescent:
            prof = prof[:-2] + [(0.12, 1.34), (0.14, 1.44), (0.05, 1.56), (0.03, 2.0), (0.0, 2.1)]
        self.revolve(c, [(r * s, y0 + y * s) for r, y in prof], 12, 'gold')
        if not crescent:
            return
        R = 0.36 * s
        pts = [(c[0] + R * math.cos(a), y0 + 1.98 * s + R * math.sin(a), c[1])
               for a in [math.radians(125 + 290 * k / 14) for k in range(15)]]
        self.M.tube('crescent', pts, 0.075 * s, 'gold', 6)

    # ------------------------------------------------------------------ walls, arches, windows

    def arched_wall(self, fr, x0, x1, y0, y1, d0, d1, ops, mat='stone', n=6):
        """A wall band with real openings: piers between them, sills below, arched spandrels above."""
        edge = x0
        for o in sorted(ops, key=lambda o: o['c']):
            L, R = o['c'] - o['w'] / 2, o['c'] + o['w'] / 2
            if L - edge > 1e-3:
                self.prism(fr, rect(edge, L, y0, y1), d0, d1, mat)
            if o['sill'] > y0 + 1e-3:
                self.prism(fr, rect(L, R, y0, o['sill']), d0, d1, mat)
            pts, crown = arch(o['c'], o['w'], o['ys'], o['kind'], n)
            assert y1 > crown + 0.04, (o, y1, crown)
            self.prism(fr, pts + [(R, y1), (L, y1)], d0, d1, mat)
            edge = R
        if x1 - edge > 1e-3:
            self.prism(fr, rect(edge, x1, y0, y1), d0, d1, mat)

    def voussoirs(self, fr, o, dface, band=0.4, k=10, proud=0.07, mats=('stone', 'stone_red')):
        """Alternating light and dark arch stones standing proud of the face round an opening."""
        c, w, ys, kind = o['c'], o['w'], o['ys'], o['kind']
        if kind == 'flat':
            return
        if kind == 'round':
            arcs = [((c, ys), w / 2, math.pi, 0.0, k)]
        else:
            e = 0.12 * w
            R = w / 2 + e
            t1 = math.acos(-e / R)
            arcs = [((c + e, ys), R, math.pi, t1, k // 2), ((c - e, ys), R, math.pi - t1, 0.0, k // 2)]
        i = 0
        for (cx, cy), R, ta, tb, kk in arcs:
            for g in range(kk):
                ts = [ta + (tb - ta) * (g + s / 2) / kk for s in range(3)]
                inner = [(cx + R * math.cos(t), cy + R * math.sin(t)) for t in ts]
                outer = [(cx + (R + band) * math.cos(t), cy + (R + band) * math.sin(t)) for t in reversed(ts)]
                self.prism(fr, inner + outer, dface, dface + proud, mats[i % 2])
                i += 1

    def window(self, fr, x, w, sill, ys, d0, d1, style, mats=('stone', 'stone_red'), wall='stone'):
        """Fill one opening cut by arched_wall.  lower: a rectangular light under a pointed relieving
        arch with a recessed tympanum and an iron grille; lattice: an arched light filled with a pierced
        stone screen (a pale grid over the dark glass); upper: a plain arched light."""
        o = dict(c=x, w=w, sill=sill, ys=ys, kind='pointed')
        mid = d0 + (d1 - d0) * 0.55
        if style == 'lower':
            self.prism(fr, rect(x - w / 2, x + w / 2, sill, ys - 0.28), mid - 0.06, mid + 0.06, 'glass')
            self.prism(fr, rect(x - w / 2, x + w / 2, ys - 0.28, ys), d0, d1 - 0.08, wall)        # lintel
            pts, _ = arch(x, w, ys, 'pointed')
            self.prism(fr, pts, d0, d1 - 0.22, wall)                                          # tympanum
            nb = max(3, int(w / 0.28))
            for b in range(1, nb):
                bx = x - w / 2 + w * b / nb
                self.prism(fr, rect(bx - 0.025, bx + 0.025, sill, ys - 0.28), d1 - 0.16, d1 - 0.1, 'iron')
            for by in (sill + (ys - sill) * 0.33, sill + (ys - sill) * 0.66):
                self.prism(fr, rect(x - w / 2, x + w / 2, by - 0.025, by + 0.025), d1 - 0.2, d1 - 0.16, 'iron')
            self.voussoirs(fr, o, d1, band=0.3, k=8, mats=mats)
        elif style == 'lattice':
            self.prism(fr, opening_outline(o), mid - 0.06, mid + 0.06, 'glass')
            _, crown = arch(x, w, ys, 'pointed')
            nx, ny = max(2, int(w / 0.3)), max(3, int((crown - sill) / 0.3))
            for b in range(1, nx):
                bx = x - w / 2 + w * b / nx
                top = ys + (crown - ys) * (1 - abs(2 * b / nx - 1)) * 0.85
                self.prism(fr, rect(bx - 0.03, bx + 0.03, sill, top), mid + 0.06, mid + 0.12, wall)
            for b in range(1, ny):
                by = sill + (crown - sill) * b / ny
                half = w / 2 if by <= ys else max(0.05, (w / 2) * (1 - (by - ys) / (crown - ys)) ** 0.8)
                self.prism(fr, rect(x - half, x + half, by - 0.03, by + 0.03), mid + 0.06, mid + 0.12, wall)
            self.voussoirs(fr, o, d1, band=0.24, k=8, proud=0.05, mats=(wall, wall))
        else:
            self.prism(fr, opening_outline(o), mid - 0.06, mid + 0.06, 'glass')
            self.voussoirs(fr, o, d1, band=0.28, k=8, mats=mats)

    def grille_window(self, fr, x, w, sill, top, d0, d1, frame='marble', bars=0.16):
        """A rectangular window in a moulded frame with a square iron grille (the enclosure walls).
        The opening itself is cut by punched_wall; this fills it."""
        self.prism(fr, rect(x - w / 2, x + w / 2, sill, top), d0 + (d1 - d0) * 0.4, d0 + (d1 - d0) * 0.5, 'glass')
        nb = max(2, int(w / bars))
        for b in range(1, nb):
            bx = x - w / 2 + w * b / nb
            self.prism(fr, rect(bx - 0.02, bx + 0.02, sill, top), d1 - 0.12, d1 - 0.08, 'iron')
        nh = max(2, int((top - sill) / 0.4))
        for b in range(1, nh):
            by = sill + (top - sill) * b / nh
            self.prism(fr, rect(x - w / 2, x + w / 2, by - 0.02, by + 0.02), d1 - 0.16, d1 - 0.12, 'iron')
        t = 0.14
        for a, b, c, dd in [(x - w / 2 - t, x - w / 2, sill - t, top + t), (x + w / 2, x + w / 2 + t, sill - t, top + t),
                            (x - w / 2, x + w / 2, sill - t, sill), (x - w / 2, x + w / 2, top, top + t)]:
            self.prism(fr, rect(a, b, c, dd), d1, d1 + 0.05, frame)

    def surface_grille(self, fr, x, w, sill, top, frame='marble', bars=0.2):
        """A grilled window laid on a solid wall face (a building seen from 30 m and more): dark glass,
        an iron grid in front of it and a moulded frame, all proud of the face."""
        self.prism(fr, rect(x - w / 2, x + w / 2, sill, top), -0.02, 0.02, 'glass')
        nb = max(2, int(w / bars))
        for b in range(1, nb):
            bx = x - w / 2 + w * b / nb
            self.prism(fr, rect(bx - 0.02, bx + 0.02, sill, top), 0.02, 0.05, 'iron')
        nh = max(2, int((top - sill) / 0.45))
        for b in range(1, nh):
            by = sill + (top - sill) * b / nh
            self.prism(fr, rect(x - w / 2, x + w / 2, by - 0.02, by + 0.02), 0.02, 0.05, 'iron')
        t = 0.13
        for a, b, c, dd in [(x - w / 2 - t, x - w / 2, sill - t, top + t), (x + w / 2, x + w / 2 + t, sill - t, top + t),
                            (x - w / 2, x + w / 2, sill - t, sill), (x - w / 2, x + w / 2, top, top + t)]:
            self.prism(fr, rect(a, b, c, dd), 0.0, 0.07, frame)

    def punched_wall(self, fr, x0, x1, y0, y1, d0, d1, holes, mat):
        """A wall band with rectangular holes [(x, w, sill, top)] cut clean through it."""
        edge = x0
        for x, w, s, t in sorted(holes):
            L, R = x - w / 2, x + w / 2
            if L - edge > 1e-3:
                self.prism(fr, rect(edge, L, y0, y1), d0, d1, mat)
            if s > y0 + 1e-3:
                self.prism(fr, rect(L, R, y0, s), d0, d1, mat)
            if y1 > t + 1e-3:
                self.prism(fr, rect(L, R, t, y1), d0, d1, mat)
            edge = R
        if x1 - edge > 1e-3:
            self.prism(fr, rect(edge, x1, y0, y1), d0, d1, mat)

    def cornice(self, fr, x0, x1, ytop, proj=0.5, mat='stone', dface=0.0, muq=True, carved='carved'):
        """Projecting cornice slab over a cavetto and (optionally) a band of muqarnas cells."""
        xs = self.stations(fr, x0 - proj * 0.6, x1 + proj * 0.6)
        self.run(fr, xs, [(dface - 0.3, ytop - 0.22), (dface + proj, ytop - 0.22), (dface + proj, ytop), (dface - 0.3, ytop)], mat)
        self.run(fr, self.stations(fr, x0, x1), [(dface - 0.3, ytop - 0.55), (dface + 0.06, ytop - 0.55),
                                                  (dface + proj * 0.8, ytop - 0.22), (dface - 0.3, ytop - 0.22)], carved)
        if not muq:
            return
        cell = 0.55
        n = max(1, int((x1 - x0) / cell))
        for i in range(n):
            xa = x0 + (x1 - x0) * i / n
            xb = x0 + (x1 - x0) * (i + 1) / n
            if i % 2 == 0:
                self.run(fr, [xa + 0.04, xb - 0.04], [(dface - 0.05, ytop - 1.0), (dface + 0.05, ytop - 1.0),
                                                     (dface + 0.26, ytop - 0.55), (dface - 0.05, ytop - 0.55)], carved)
            else:
                self.run(fr, [xa + 0.09, xb - 0.09], [(dface - 0.05, ytop - 0.82), (dface + 0.04, ytop - 0.82),
                                                     (dface + 0.16, ytop - 0.55), (dface - 0.05, ytop - 0.55)], carved)

    def string_course(self, fr, x0, x1, y, dface=0.0, h=0.2, proj=0.1, mat='stone'):
        self.run(fr, self.stations(fr, x0, x1), [(dface - 0.2, y), (dface + proj, y), (dface + proj, y + h), (dface - 0.2, y + h)], mat)

    def poly_drum(self, c, apothem, sides, y0, y1, thick, win=None, phase=0.0, mat='stone', glaze=True):
        """Polygonal drum: one straight wall per side, each with an optional arched window."""
        half = apothem * math.tan(math.pi / sides)
        for i in range(sides):
            a = phase + TAU * i / sides
            n = (math.cos(a), math.sin(a))
            t = (-math.sin(a), math.cos(a))
            fr = SF((c[0] + apothem * n[0], c[1] + apothem * n[1]), t, n)
            if win:
                w, sill, ys, kind = win
                o = dict(c=0.0, w=w, sill=sill, ys=ys, kind=kind)
                self.arched_wall(fr, -half, half, y0, y1, -thick, 0.0, [o], mat)
                if glaze:
                    self.prism(fr, opening_outline(o), -thick * 0.6, -thick * 0.45, 'glass')
            else:
                self.prism(fr, rect(-half - 0.001, half + 0.001, y0, y1), -thick, 0.0, mat)

    def hip_roof(self, u0, u1, v0, v1, y0, rise, mat='tile', over=0.6, thick=0.25):
        """A hipped roof slab over a plan rectangle: eaves `over` beyond the walls, the ridge along the
        longer side, a flat soffit underneath at y0 (so from below it is a roof, not a hole)."""
        u0, u1, v0, v1 = u0 - over, u1 + over, v0 - over, v1 + over
        du, dv = u1 - u0, v1 - v0
        yr = y0 + thick + rise
        if abs(du - dv) < 1e-6:
            V = [(u0, y0, v0), (u1, y0, v0), (u1, y0, v1), (u0, y0, v1)]
            V += [(u, y0 + thick, v) for u, _, v in V[:4]] + [((u0 + u1) / 2, yr, (v0 + v1) / 2)]
            F = [(3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 8), (5, 6, 8), (6, 7, 8), (7, 4, 8)]
            self.raw(V, F, mat)
            return
        if du >= dv:
            h = dv / 2
            ridge = [(u0 + h, yr, (v0 + v1) / 2), (u1 - h, yr, (v0 + v1) / 2)]
        else:
            h = du / 2
            ridge = [((u0 + u1) / 2, yr, v0 + h), ((u0 + u1) / 2, yr, v1 - h)]
        base = [(u0, y0, v0), (u1, y0, v0), (u1, y0, v1), (u0, y0, v1)]
        eave = [(u, y0 + thick, v) for u, _, v in base]
        V = base + eave + ridge
        if du >= dv:
            F = [(3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
                 (4, 5, 9, 8), (5, 6, 9), (6, 7, 8, 9), (7, 4, 8)]
        else:
            F = [(3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
                 (4, 5, 8), (5, 6, 9, 8), (6, 7, 9), (7, 4, 8, 9)]
        self.raw(V, F, mat)

    def railing(self, path, y0, h, closed=True, spacing=0.14, scroll_every=1.1, mat='iron', rail=0.03):
        """Wrought-iron railing along a plan path: two rails, close vertical bars and a row of scroll
        loops between them (the Hippodrome railings are scrollwork; from the road it reads as a fine
        dark lattice, which the bars give and the loops break up)."""
        pts = list(path) + ([path[0]] if closed else [])
        for yy in (y0 + 0.08, y0 + h):
            self.M.tube('rail', [(u, yy, v) for u, v in self._dense(pts, 1.0, closed)], rail, mat, 4)
        for a, b in zip(pts, pts[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 1e-6:
                continue
            n = max(1, int(L / spacing))
            for k in range(1, n):
                t = k / n
                u, v = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                self.box(u - 0.012, u + 0.012, y0 + 0.08, y0 + h, v - 0.012, v + 0.012, mat)
            ns = max(1, int(L / scroll_every))
            tx, tz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            R = min(0.24, h * 0.24)
            for k in range(ns):
                t = (k + 0.5) / ns
                cu, cv, cy = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, y0 + 0.08 + (h - 0.08) * 0.5
                ring = [(cu + tx * R * math.cos(q), cy + R * math.sin(q), cv + tz * R * math.cos(q))
                        for q in [math.radians(100 + 330 * i / 10) for i in range(11)]]
                self.M.tube('scroll', ring, 0.018, mat, 4)

    @staticmethod
    def _dense(pts, step, closed=False):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            n = max(1, int(L / step))
            out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(1, n + 1)]
        clean = [out[0]]
        for p in out[1:]:
            if math.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 1e-4:
                clean.append(p)
        if closed:
            # an open tube that stops a hair short of its start, so the ring never folds on itself
            a, b = clean[-2], clean[-1]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            clean[-1] = (b[0] - (b[0] - a[0]) / L * 0.03, b[1] - (b[1] - a[1]) / L * 0.03)
        return clean

    def finish(self):
        return self.M.finish(directory=OUT / self.id)
