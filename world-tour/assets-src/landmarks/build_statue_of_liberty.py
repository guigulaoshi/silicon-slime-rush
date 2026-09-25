"""Statue of Liberty (Liberty Enlightening the World), Liberty Island, New York Harbor.

Original geometry. Sources for the numbers, marked in the code as [NPS], [photo] or [est]:
- [NPS] published dimensions: ground to torch tip 93.0 m (305 ft 1 in); heel to torch 46.05 m
  (151 ft 1 in); pedestal 27.1 m (89 ft) on a 19.8 m (65 ft) foundation; tablet 7.19 x 4.14 x 0.61 m.
- [photo] measured on Wikimedia Commons reference photos (listed in the modelling report; used for
  comparison only, never copied into the repository). The scale for every photo measurement is the
  statue itself: heel to torch tip = 46.05 m. Main source: "Front view of Statue of Liberty with
  pedestal and base 2024" (CC0, a straight front view from the water, 27.25 px/m at full size),
  checked against "Statue of liberty front", "Statue of Liberty, Liberty Island, New York - April
  2026", "Liberty Island photo Don Ramey Logan" (aerial from the front) and "FortWood" (c. 1900).
- [est] estimates where no photo shows the part (the depth of the figure, the back of the base).
The tablet carries no inscription.

What the photos changed against the first (memory-only) model:
- Fort Wood is bigger and much taller: an 11-point star about 97 m across at the salient tips
  (measured 96-100 m in three photos from three sides) with near-vertical granite walls about 10 m
  high; a salient, not a re-entrant, points at the statue's front.
- Between the fort and the pedestal there are two broad stepped tiers, 44 m and 27.5 m square
  [photo], each with a pair of stair flights climbing its front face toward the centre.
- The pedestal's roundel frieze sits LOW, just above the door-and-pediment base; above it come a
  battered band with a row of pointed shield blocks, the rusticated shaft, a loggia of four square
  columns and three openings per face, a heavy cornice, the observation parapet with six piers per
  face and the top block under a copper plinth.
- The figure is wider (11.4 m across the hem), the raised arm is almost vertical (torch at 4.7 m to
  her right of the centre line, not 6.1 m), the crown's seven rays open as a flat fan with the
  outer rays level with the diadem, and the tablet leans out about 22 degrees.

Author frame: u across, y up, v along the footprint axis. The footprint was registered with its
long axis on the statue's facing (bearing ~140 deg, south-east), so +v is where she looks and
-u is her right hand (the torch arm). Photo "camera right" in the front views is +u.
Run: Blender --background --python assets-src/landmarks/build_statue_of_liberty.py
"""
import math
import tempfile
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

SCRATCH = (Path(tempfile.gettempdir()) / 'sr-landmarks' / 'statue-of-liberty')

# Absolute levels, metres above the lowest ground under the footprint (the lawn round the fort).
FORT_TOP = 10.4         # top of the fort's coping [photo: walls 8.5-9.5 m above the lawn in 3 photos]
TIER_A_TOP = 15.6       # the 44 m tier [photo 4.1-4.5 m, scaled with the rest to the NPS 19.8 m]
P0 = 19.8               # pedestal base = top of the foundation [NPS 65 ft]
HEEL = P0 + 27.1        # top of the pedestal and its copper plinth [NPS 89 ft]
TORCH_TIP = HEEL + 46.05  # [NPS 151 ft 1 in] -> 92.95 m


# ---------------------------------------------------------------- primitives
def loft(m, label, rings, mat, smooth=False):
    """Stack of rings with equal counts; a ring of one point is an apex. Capped both ends."""
    verts, faces, starts = [], [], []
    for ring in rings:
        starts.append(len(verts))
        verts += list(ring)
    n = max(len(r) for r in rings)
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k+1]
        sa, sb = starts[k], starts[k+1]
        if len(a) == 1:
            faces += [(sa, sb+(j+1) % n, sb+j) for j in range(n)]
        elif len(b) == 1:
            faces += [(sa+j, sa+(j+1) % n, sb) for j in range(n)]
        else:
            faces += [(sa+j, sa+(j+1) % n, sb+(j+1) % n, sb+j) for j in range(n)]
    for k, top in ((0, False), (len(rings)-1, True)):
        ring = rings[k]
        if len(ring) == 1:
            continue
        c = tuple(sum(p[i] for p in ring)/len(ring) for i in range(3))
        ci = len(verts)
        verts.append(c)
        s = starts[k]
        faces += [(s+j, s+(j+1) % n, ci) if top else (s+(j+1) % n, s+j, ci) for j in range(n)]
    m.mesh(label, verts, faces, mat, smooth)


def ring_wall(m, label, outer, inner, y0, y1, mat):
    """A closed wall ring between two (u, v) outlines with the same count."""
    n = len(outer)
    verts = [(u, y0, v) for u, v in outer] + [(u, y1, v) for u, v in outer] + \
            [(u, y0, v) for u, v in inner] + [(u, y1, v) for u, v in inner]
    faces = []
    for j in range(n):
        k = (j+1) % n
        faces += [(j, k, n+k, n+j), (2*n+k, 2*n+j, 3*n+j, 3*n+k), (n+j, n+k, 3*n+k, 3*n+j), (k, j, 2*n+j, 2*n+k)]
    m.mesh(label, verts, faces, mat)


def square(h):
    return [(-h, -h), (h, -h), (h, h), (-h, h)]


def sq_loft(m, label, y0, h0, y1, h1, mat):
    """Square block centred on the axis, half-width h0 at y0 and h1 at y1 (a batter when they differ)."""
    loft(m, label, [[(u, y0, v) for u, v in square(h0)], [(u, y1, v) for u, v in square(h1)]], mat)


def obox(m, label, c, ex, ey, ez, mat):
    """Oriented box from a centre and three half-extent vectors."""
    c, ex, ey, ez = (Vector(x) for x in (c, ex, ey, ez))
    verts = [tuple(c + sx*ex + sy*ey + sz*ez) for sy in (-1, 1) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    m.mesh(label, verts, faces, mat)


def frames(points):
    """Rotation-minimising frames along a polyline."""
    pts = [Vector(p) for p in points]
    out = []
    prev = None
    for i, p in enumerate(pts):
        t = (pts[min(i+1, len(pts)-1)] - pts[max(0, i-1)]).normalized()
        if prev is None:
            other = Vector((0, 1, 0)) if abs(t.y) < .9 else Vector((1, 0, 0))
            a = t.cross(other).normalized()
        else:
            a = (prev - t*prev.dot(t)).normalized()
        b = t.cross(a).normalized()
        out.append((p, t, a, b))
        prev = a
    return out


def sweep(m, label, points, radii, mat, sides=12, smooth=True, cap_apex=False):
    """Closed tube with per-point radius (r or (ra, rb)); optional pointed end."""
    rings = []
    for (p, t, a, b), r in zip(frames(points), radii):
        ra, rb = (r, r) if not isinstance(r, tuple) else r
        rings.append([tuple(p + ra*math.cos(j*math.tau/sides)*a + rb*math.sin(j*math.tau/sides)*b) for j in range(sides)])
    if cap_apex:
        p, t, _, _ = frames(points)[-1]
        rings.append([tuple(Vector(points[-1]) + t*cap_apex)])
    loft(m, label, rings, mat, smooth)


def lathe(m, label, cu, cv, profile, mat, sides=16, rfun=None, smooth=True):
    """Solid of revolution about a vertical axis; profile [(y, r)], r = 0 at an end is an apex."""
    rings = []
    for y, r in profile:
        if r == 0:
            rings.append([(cu, y, cv)])
            continue
        ring = []
        for j in range(sides):
            t = math.tau*j/sides
            k = rfun(t, y) if rfun else 1.0
            ring.append((cu + r*k*math.sin(t), y, cv + r*k*math.cos(t)))
        rings.append(ring)
    loft(m, label, rings, mat, smooth)


def ellipsoid(m, label, c, s, mat, nu=16, nv=10, rfun=None):
    cu, cy, cv = c
    rings = [[(cu, cy - s[1], cv)]]
    for i in range(1, nv):
        phi = -math.pi/2 + math.pi*i/nv
        ring = []
        for j in range(nu):
            t = math.tau*j/nu
            k = rfun(t, phi) if rfun else 1.0
            ring.append((cu + s[0]*k*math.cos(phi)*math.sin(t), cy + s[1]*math.sin(phi), cv + s[2]*k*math.cos(phi)*math.cos(t)))
        rings.append(ring)
    rings.append([(cu, cy + s[1], cv)])
    loft(m, label, rings, mat, True)


def offset_poly(pts, d):
    """Miter offset of a closed 2-D polygon, positive = outward."""
    n = len(pts)
    area = sum(pts[i][0]*pts[(i+1) % n][1] - pts[(i+1) % n][0]*pts[i][1] for i in range(n))
    sgn = 1 if area > 0 else -1
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(pts[i-1]), Vector(pts[i]), Vector(pts[(i+1) % n])
        e0, e1 = (p1-p0).normalized(), (p2-p1).normalized()
        n0 = Vector((e0.y, -e0.x))*sgn
        n1 = Vector((e1.y, -e1.x))*sgn
        bis = (n0+n1).normalized()
        out.append(tuple(p1 + bis*(d/max(bis.dot(n1), .35))))
    return out


def face_frame(side, axis):
    """(along, out) unit vectors in (u, v) for one face of a square block: side +-1, axis 'u' or 'v'."""
    if axis == 'v':
        return (1.0, 0.0), (0.0, float(side))
    return (0.0, 1.0), (float(side), 0.0)


def face_box(m, label, side, axis, along, out, y0, y1, width, depth, mat):
    """Box on one face of a square block: `along` across the face, `out` = distance of its centre from the axis."""
    (au, av), (ou, ov) = face_frame(side, axis)
    c = (au*along + ou*out, (y0+y1)/2, av*along + ov*out)
    size = (abs(au)*width + abs(ou)*depth, y1-y0, abs(av)*width + abs(ov)*depth)
    m.box(label, c, size, mat)


def faces4():
    return [(s, a) for s in (-1, 1) for a in ('u', 'v')]


def wall_with_openings(m, label, side, axis, half, face, y0, y1, openings, depth, mat):
    """Skin of one face from -half..half along it, `depth` thick outside `face`, with real openings.

    openings: [(centre along, width, bottom, top)], not overlapping along the face. The skin sits on a
    core block whose surface is `face`, so an opening is a recess `depth` deep."""
    cuts = sorted(openings)
    x = -half
    out = face + depth/2
    for c, w, yb, yt in cuts:
        if c - w/2 > x:
            face_box(m, label, side, axis, (x + c - w/2)/2, out, y0, y1, c - w/2 - x, depth, mat)
        if yb > y0:
            face_box(m, label+' sill', side, axis, c, out, y0, yb, w, depth, mat)
        if yt < y1:
            face_box(m, label+' head', side, axis, c, out, yt, y1, w, depth, mat)
        x = c + w/2
    if half > x:
        face_box(m, label, side, axis, (x + half)/2, out, y0, y1, half - x, depth, mat)


# ---------------------------------------------------------------- Fort Wood
R_FORT = 48.5           # salient tips at the top of the wall [photo: 96-100 m across from 3 sides]
r_FORT = 0.84*R_FORT    # re-entrants; salient angle ~100 deg [photo, aerial]


def star(R, r, points=11, rot=0.0):
    out = []
    for i in range(2*points):
        a = rot + math.pi*i/points
        rad = R if i % 2 == 0 else r
        out.append((rad*math.sin(a), rad*math.cos(a)))
    return out


def fort_wood(m):
    # 11 salients; one points at the statue's front (+v) [photo: aerial from the front].
    top = star(R_FORT, r_FORT)
    wall_top = FORT_TOP - .7
    # Near-vertical granite walls with a slight batter, on a plinth course.
    loft(m, 'fort walls', [[(u, 0.0, v) for u, v in offset_poly(top, 0.45)], [(u, wall_top, v) for u, v in top]], 'granite')
    ring_wall(m, 'fort plinth course', offset_poly(top, 0.95), offset_poly(top, -0.5), 0.0, 0.8, 'granite')
    # Rounded coping band, projecting, and the paved terrace inside it at the same height [photo].
    ring_wall(m, 'fort coping', offset_poly(top, 0.3), offset_poly(top, -1.2), wall_top-.05, FORT_TOP-.25, 'granite')
    ring_wall(m, 'fort coping roll', offset_poly(top, 0.15), offset_poly(top, -1.05), FORT_TOP-.3, FORT_TOP, 'granite')
    inner = offset_poly(top, -1.1)
    loft(m, 'fort terrace', [[(u, wall_top-.1, v) for u, v in inner], [(u, FORT_TOP-.1, v) for u, v in inner]], 'concrete')
    # Recessed sally-port doors in the middle of the faces that turn toward the front and the back
    # (between the re-entrant at 16.4 deg and the salient at 32.7 deg) [photo: niches at +-19.5 m].
    pts = [(R_FORT*math.sin(math.pi*i/11), R_FORT*math.cos(math.pi*i/11)) if i % 2 == 0 else
           (r_FORT*math.sin(math.pi*i/11), r_FORT*math.cos(math.pi*i/11)) for i in range(22)]
    for i in (1, 20, 10, 11):          # faces 1-2 / 20-21 (front, both sides), 10-11 / 11-12 (back)
        a, b = Vector(pts[i]), Vector(pts[(i+1) % 22])
        mid = (a+b)/2
        along = (b-a).normalized()
        n = Vector((along.y, -along.x))
        if n.dot(mid) < 0:
            n = -n
        for s in (-1, 1):
            # Splayed jambs: the door reads as a niche 1.2 m deep in the ashlar.
            c = mid + along*s*2.1 + n*.6
            obox(m, 'fort sally port jamb', (c.x, 2.4, c.y), (along.x*.55, 0, along.y*.55), (0, 2.4, 0), (n.x*.6, 0, n.y*.6), 'granite')
        c = mid + n*.6
        obox(m, 'fort sally port lintel', (c.x, 5.35, c.y), (along.x*2.65, 0, along.y*2.65), (0, .55, 0), (n.x*.6, 0, n.y*.6), 'granite')
        for k in range(5):             # voussoir-like relieving arch over the lintel
            t = (k - 2)/2.0
            c2 = mid + along*t*1.3 + n*.35
            obox(m, 'fort sally port arch', (c2.x, 6.15 + .35*(1-t*t), c2.y), (along.x*.6, 0, along.y*.6), (0, .3, 0), (n.x*.35, 0, n.y*.35), 'granite')


# ---------------------------------------------------------------- the two foundation tiers
def stair_flights(m, label, face, y0, y1, w_bottom, w_top, depth, mat, steps):
    """A pair of flights on the +v face climbing from |u| = w_bottom up toward |u| = w_top [photo]."""
    rise = (y1 - y0)/steps
    for s in (-1, 1):
        for k in range(steps):
            w = w_bottom + (w_top - w_bottom)*k/steps
            ya, yb = y0 + k*rise, y0 + (k+1)*rise
            # Each tread and everything under it, out to the inner end of the flight.
            m.box(label, (s*(w + w_top)/2, (y0 + yb)/2, face + depth/2), (abs(w - w_top), yb - y0, depth), mat)
        # Low parapet (stringer) along the outer edge of the flight.
        a = Vector((s*w_bottom, y0 + .5, face + depth - .2))
        b = Vector((s*w_top, y1 + .5, face + depth - .2))
        d = b - a
        obox(m, label+' parapet', tuple((a+b)/2), tuple(d/2), (0, .5, 0), (0, 0, .2), mat)


def tiers(m):
    # Tier A: 44 m square [photo 44.2 m], FORT_TOP..TIER_A_TOP, grilled windows sunk in its faces.
    H = 22.0
    sq_loft(m, 'tier A core', FORT_TOP - .1, H - .45, TIER_A_TOP - .3, H - .45, 'concrete')
    wins = [(-20.0, 1.4, FORT_TOP+.9, FORT_TOP+3.0), (-17.7, 1.4, FORT_TOP+.9, FORT_TOP+3.0),
            (-5.8, 1.4, FORT_TOP+.9, FORT_TOP+3.0), (5.8, 1.4, FORT_TOP+.9, FORT_TOP+3.0),
            (17.7, 1.4, FORT_TOP+.9, FORT_TOP+3.0), (20.0, 1.4, FORT_TOP+.9, FORT_TOP+3.0)]
    for side, axis in faces4():
        half = H if axis == 'v' else H - .45
        wall_with_openings(m, 'tier A wall', side, axis, half, H - .45, FORT_TOP - .1, TIER_A_TOP - .3, wins, .45, 'concrete')
    sq_loft(m, 'tier A coping', TIER_A_TOP - .3, H + .12, TIER_A_TOP, H + .12, 'concrete')
    stair_flights(m, 'tier A stairs', H, FORT_TOP - .1, TIER_A_TOP, 14.7, 7.2, 3.2, 'steps', 14)
    # Tier B: 27.5 m square [photo], TIER_A_TOP..P0, one window in the middle of each face.
    h = 13.75
    sq_loft(m, 'tier B core', TIER_A_TOP - .1, h - .4, P0 - .3, h - .4, 'concrete')
    for side, axis in faces4():
        half = h if axis == 'v' else h - .4
        wall_with_openings(m, 'tier B wall', side, axis, half, h - .4, TIER_A_TOP - .1, P0 - .3,
                           [(0.0, 1.1, TIER_A_TOP + .7, TIER_A_TOP + 1.9), (12.3, .7, TIER_A_TOP + .9, TIER_A_TOP + 2.2),
                            (-12.3, .7, TIER_A_TOP + .9, TIER_A_TOP + 2.2)], .4, 'concrete')
    sq_loft(m, 'tier B coping', P0 - .3, h + .1, P0, h + .1, 'concrete')
    stair_flights(m, 'tier B stairs', h, TIER_A_TOP - .05, P0, 9.7, 5.7, 2.8, 'steps', 12)


# ---------------------------------------------------------------- pedestal
# Heights above P0 and widths [photo, ref "Front view ... 2024": 27.25 px/m, scaled x0.975 so the
# copper plinth top lands on the NPS 89 ft].
def pedestal(m):
    b = P0
    # Base block with the door, slightly battered.
    sq_loft(m, 'pedestal base', b, 10.0, b+3.55, 9.8, 'stone')
    for side, axis in faces4():
        for x in (-1.25, 1.25):
            face_box(m, 'pedestal door jamb', side, axis, x, 10.05, b, b+2.3, .7, .5, 'stone')
        face_box(m, 'pedestal door lintel', side, axis, 0, 10.1, b+2.3, b+2.75, 3.9, .55, 'stone')
        # Pediment over the door: a triangular prism.
        (au, av), (ou, ov) = face_frame(side, axis)
        tri = [(-2.2, b+2.75), (2.2, b+2.75), (0, b+3.4)]
        verts = []
        for d in (9.8, 10.4):
            verts += [(au*x + ou*d, y, av*x + ov*d) for x, y in tri]
        m.mesh('pedestal pediment', verts, [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], 'stone')
    # Roundel frieze: ten discs a face [photo: 1.65 m discs at 1.8 m spacing].
    sq_loft(m, 'pedestal roundel band', b+3.55, 9.7, b+5.3, 9.3, 'stone')
    for side, axis in faces4():
        (au, av), (ou, ov) = face_frame(side, axis)
        for i in range(10):
            x = -8.1 + i*1.8
            p0 = (au*x + ou*9.35, b+4.42, av*x + ov*9.35)
            p1 = (au*x + ou*9.62, b+4.42, av*x + ov*9.62)
            sweep(m, 'pedestal roundel', [p0, p1], [.78, .72], 'stone', sides=14, smooth=False)
    sq_loft(m, 'pedestal band', b+5.3, 9.1, b+5.9, 9.1, 'stone')
    # Battered fascia carrying a row of pointed shield blocks [photo: nine a face].
    sq_loft(m, 'pedestal fascia', b+5.9, 9.0, b+7.65, 8.4, 'stone')
    for side, axis in faces4():
        (au, av), (ou, ov) = face_frame(side, axis)
        for i in range(9):
            x = -8.0 + i*2.0
            shape = [(-.42, 6.15), (.42, 6.15), (.42, 7.0), (0, 7.45), (-.42, 7.0)]
            verts = []
            for off in (-.05, .3):
                for px, py in shape:
                    d = 9.0 - .6*(py - 5.9)/1.75 + off      # the battered fascia's face at that height
                    verts.append((au*(x+px) + ou*d, b+py, av*(x+px) + ov*d))
            n = 5
            faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))] + [(j, (j+1) % n, (j+1) % n+n, j+n) for j in range(n)]
            m.mesh('pedestal shield block', verts, faces, 'stone')
    sq_loft(m, 'pedestal step', b+7.65, 8.4, b+8.7, 8.4, 'stone')
    sq_loft(m, 'pedestal plinth band', b+8.7, 7.95, b+9.8, 7.95, 'stone')
    # Shaft: plain centre panel between rusticated corners.
    sq_loft(m, 'pedestal shaft', b+9.8, 7.55, b+12.5, 7.55, 'stone')
    rustication(m, b+9.8, b+12.5)
    sq_loft(m, 'pedestal string course', b+12.5, 7.95, b+13.0, 7.95, 'stone')
    # Loggia: recessed back wall, corner piers, four square columns and three openings a face.
    sq_loft(m, 'pedestal loggia back wall', b+13.0, 5.95, b+18.4, 5.95, 'stone')
    for su in (-1, 1):
        for sv in (-1, 1):
            m.box('pedestal corner pier', (su*6.19, b+15.7, sv*6.19), (2.72, 5.4, 2.72), 'stone')
    rustication(m, b+13.0, b+18.4)
    for side, axis in faces4():
        face_box(m, 'pedestal loggia parapet', side, axis, 0, 7.25, b+13.0, b+14.1, 9.7, .5, 'stone')
        face_box(m, 'pedestal loggia floor', side, axis, 0, 6.4, b+13.0, b+13.2, 9.7, 1.3, 'stone')
        for x in (-4.26, -1.43, 1.43, 4.26):
            (au, av), (ou, ov) = face_frame(side, axis)
            cu, cv = au*x + ou*6.95, av*x + ov*6.95
            m.box('pedestal column base', (cu, b+14.3, cv), (1.35 if ou == 0 else 1.2, .4, 1.2 if ou == 0 else 1.35), 'stone')
            # Fluted shaft: a 20-sided prism with shallow flutes, squared in plan [photo].
            lathe(m, 'pedestal column', cu, cv, [(b+14.5, .62), (b+17.75, .56)], 'stone', sides=20,
                  rfun=lambda t, y: (1/max(abs(math.cos(t)), abs(math.sin(t))))**.35 * (1 - .05*math.cos(10*t)**2), smooth=False)
            m.box('pedestal column capital', (cu, b+18.05, cv), (1.4 if ou == 0 else 1.25, .6, 1.25 if ou == 0 else 1.4), 'stone')
    # Entablature, heavy cornice in two layers, observation parapet with six piers a face.
    sq_loft(m, 'pedestal entablature', b+18.4, 7.95, b+19.6, 7.95, 'stone')
    sq_loft(m, 'pedestal cornice', b+19.6, 8.1, b+20.1, 8.35, 'stone')
    sq_loft(m, 'pedestal cornice', b+20.1, 8.35, b+20.9, 8.35, 'stone')
    ring_wall(m, 'pedestal observation parapet', square(8.35), square(7.95), b+20.9, b+22.0, 'stone')
    for side, axis in faces4():
        for x in (-8.05, -4.85, -1.6, 1.6, 4.85):
            face_box(m, 'pedestal parapet pier', side, axis, x, 8.15, b+20.9, b+22.5, .62, .55, 'stone')
    # Top block under the statue, its cap and the balcony door on the front.
    sq_loft(m, 'pedestal top block', b+20.9, 6.72, b+25.0, 6.72, 'stone')
    face_box(m, 'pedestal top door jamb', 1, 'v', -.75, 6.9, b+20.9, b+23.3, .5, .4, 'stone')
    face_box(m, 'pedestal top door jamb', 1, 'v', .75, 6.9, b+20.9, b+23.3, .5, .4, 'stone')
    face_box(m, 'pedestal top door head', 1, 'v', 0, 6.9, b+23.3, b+23.8, 2.0, .4, 'stone')
    for side, axis in faces4():
        face_box(m, 'pedestal top panel', side, axis, 0, 6.8, b+23.9, b+24.7, 10.0, .16, 'stone')
    sq_loft(m, 'pedestal top cap', b+25.0, 6.87, b+25.6, 6.87, 'stone')
    # The statue's own copper plinth [photo: 12.3 m square, 1.5 m tall].
    sq_loft(m, 'copper plinth', b+25.6, 6.15, b+26.0, 6.15, 'copper')
    sq_loft(m, 'copper plinth', b+26.0, 6.0, b+26.9, 6.0, 'copper')
    sq_loft(m, 'copper plinth', b+26.9, 6.0, HEEL, 5.8, 'copper')


def rustication(m, y0, y1):
    """Rusticated corner blocks, long and short in alternate courses [photo: 0.5-0.55 m courses]."""
    rows = max(1, round((y1-y0)/.54))
    hh = (y1-y0)/rows
    for i in range(rows):
        ya = y0 + i*hh
        long = i % 2 == 0
        for su in (-1, 1):
            for sv in (-1, 1):
                a, c = (2.72, 1.9) if long else (1.9, 2.72)
                m.box('pedestal rustication', (su*(7.63 - a/2), ya + hh/2, sv*(7.63 - c/2)), (a, hh - .07, c), 'stone')


# ---------------------------------------------------------------- the copper figure
# Robe section table (height above heel; her right edge u0, her left edge u1 [photo, front view];
# half-depth rv and centre cv along v [est, no side photo]). The mantle hanging on her left and the
# sleeve drape under the raised arm are separate parts on top of this.
ROBE = [(0.0, -5.45, 5.45, 4.3, 0.3), (0.8, -5.2, 5.35, 4.2, 0.3), (2.0, -5.0, 5.3, 4.05, .25),
        (4.0, -4.8, 5.25, 3.85, .2), (6.0, -4.55, 5.2, 3.65, .15), (8.0, -4.35, 5.1, 3.5, .1),
        (10.0, -4.2, 5.0, 3.4, .05), (12.0, -4.2, 4.9, 3.35, 0.0), (14.0, -4.4, 4.9, 3.3, -.05),
        (16.0, -4.5, 5.0, 3.2, -.1), (18.0, -4.7, 5.0, 3.1, -.1), (20.0, -4.8, 5.0, 3.1, -.05),
        (22.0, -4.6, 4.9, 3.15, 0.0), (24.0, -4.6, 4.7, 3.1, 0.0), (25.5, -4.4, 4.4, 2.9, -.05),
        (26.5, -3.9, 4.0, 2.6, -.1), (27.3, -2.8, 3.0, 2.1, -.1), (28.0, -1.55, 1.85, 1.45, .05)]


def robe_at(y):
    for (y0, *a), (y1, *b) in zip(ROBE, ROBE[1:]):
        if y0 <= y <= y1:
            t = (y-y0)/(y1-y0)
            return [a[i]+(b[i]-a[i])*t for i in range(4)]
    return ROBE[-1][1:] if y > 0 else ROBE[0][1:]


def robe_scale(t, y):
    """Drapery folds, the bent right knee and the train behind [photo: vertical folds low, long
    diagonal folds across the body above the knee]."""
    ta = (t + math.pi) % math.tau - math.pi
    lower = max(0.0, min(1.0, (13.0-y)/7.0))
    k = 1.0
    k += lower * .055 * math.sin(22*t + .12*y) ** 3
    k += lower * .025 * math.sin(9*t - .3*y)
    k += (1-lower) * .035 * math.sin(11*t + .6*y + 1.3*math.sin(.35*y))
    k += .09 * math.exp(-((ta+0.45)/.35)**2 - ((y-10.5)/3.0)**2)       # right knee
    k += .06 * math.exp(-((ta-math.pi)/.8)**2 - ((y-5.0)/5.0)**2)      # train falling behind
    if y < 1.0:
        k += .03 * math.sin(7*t)                                        # uneven hem
    return k


def body_point(t, y, push=0.0):
    u0, u1, rv, cv = robe_at(y)
    cu, ru = (u0+u1)/2, (u1-u0)/2
    k = robe_scale(t, y)
    return (cu + ru*k*math.sin(t) + push*math.sin(t), HEEL+y, cv + rv*k*math.cos(t) + push*math.cos(t))


def panel(m, label, outer, inner, mat):
    """Close a surface grid (outer) against a matching inner grid: a thick draped cloth."""
    nv, nu = len(outer), len(outer[0])
    front = [p for row in outer for p in row]
    back = [p for row in inner for p in row]
    N = len(front)
    faces = []
    for j in range(nv-1):
        for i in range(nu-1):
            a = j*nu+i; b = a+1; c = a+nu+1; d = a+nu
            faces += [(a, b, c, d), (N+d, N+c, N+b, N+a)]
    boundary = list(range(nu)) + [j*nu+nu-1 for j in range(1, nv)] + [(nv-1)*nu+i for i in range(nu-2, -1, -1)] + [j*nu for j in range(nv-2, 0, -1)]
    faces += [(a, b, N+b, N+a) for a, b in zip(boundary, boundary[1:]+boundary[:1])]
    m.mesh(label, front+back, faces, mat, True)


def figure(m):
    n = 96
    levels = [0.0, .3, .6, .9] + [.75*i for i in range(2, 34)] + [25.0, 25.4, 25.9, 26.4, 26.8, 27.2, 27.5, 27.8, 28.0]
    rings = [[body_point(math.tau*j/n, y) for j in range(n)] for y in levels]
    loft(m, 'robe', rings, 'copper', True)
    # The mantle (palla) laid over the upper body: its lower edge crosses the front diagonally from
    # the right hip up to the left shoulder [photo], a cloth layer standing proud of the robe.
    tt = [-2.3 + 3.0*i/40 for i in range(41)]
    outer, inner = [], []
    for j in range(16):
        s_ = j/15
        row_o, row_i = [], []
        for t in tt:
            edge = max(9.6, 11.0 + 7.25*(t + 1.3))
            y = edge + (26.4 - edge)*s_
            push = .06 + .34*(1 - s_)**1.5 + .09*math.sin(8*t + .35*y)**2*(1 - s_)
            row_o.append(body_point(t, y, push))
            row_i.append(body_point(t, y, -.05))
        outer.append(row_o); inner.append(row_i)
    panel(m, 'mantle over the chest', outer, inner, 'copper')
    # Its rolled lower edge.
    roll = [body_point(t, max(9.6, 11.0 + 7.25*(t + 1.3)) + .15, .38) for t in tt[::3]]
    sweep(m, 'mantle edge', roll, [(.32, .22)]*len(roll), 'copper', sides=8)
    # Mantle hanging down her left side in heavy folds, to u ~ +6.1 [photo].
    nu, nv = 34, 20
    outer, inner = [], []
    for j in range(nv):
        row_o, row_i = [], []
        for i in range(nu):
            t = .35 + 2.45*i/(nu-1)
            top = 24.5 - 3.0*abs(i/(nu-1) - .2)
            hem = 6.5 + .9*math.sin(5.5*t) + 3.0*(i/(nu-1))
            y = top + (hem-top)*j/(nv-1)
            fold = .45 + .35*math.sin(9*t + .12*y)**2 + .5*math.exp(-((t-1.6)/.35)**2)*(1 - abs(y-12)/12)
            row_o.append(body_point(t, y, fold))
            row_i.append(body_point(t, y, .04))
        outer.append(row_o); inner.append(row_i)
    panel(m, 'mantle', outer, inner, 'copper')
    # Left foot showing under the hem.
    ellipsoid(m, 'left foot', (1.7, HEEL+.45, 4.45), (.85, .5, 1.45), 'copper', 12, 7)

    # Neck, head and hair [photo: chin at heel+29.8, diadem 32.5-34.0].
    lathe(m, 'neck', .45, .1, [(HEEL+27.4, 1.35), (HEEL+28.4, 1.12), (HEEL+29.9, 1.05)], 'copper', 14)
    H = (0.45, HEEL+31.45, .3)

    def face(t, phi):
        ta = (t + math.pi) % math.tau - math.pi
        k = 1.0
        k -= .05 * math.exp(-(ta/1.1)**2)                                  # flatter face plane
        k += .18 * math.exp(-(ta/.2)**2 - ((phi+.05)/.2)**2)               # nose
        k += .06 * math.exp(-(ta/.5)**2 - ((phi+.55)/.15)**2)              # chin
        k += .05 * math.exp(-((abs(ta)-.35)/.12)**2 - ((phi-.2)/.1)**2)    # brow
        k += .12 * math.exp(-((abs(ta)-math.pi)/.7)**2 - ((phi-.1)/.5)**2)  # hair knot behind
        k += .08 * math.exp(-((abs(ta)-1.57)/.5)**2 - ((phi+.1)/.6)**2)    # hair over the ears
        return k
    ellipsoid(m, 'head', H, (1.45, 2.05, 1.8), 'copper', 40, 24, face)
    ellipsoid(m, 'cranium and hair', (H[0], HEEL+32.9, H[2] - .1), (1.62, 1.1, 1.78), 'copper', 24, 10)
    for s in (-1, 1):                  # locks falling behind the ears to the shoulders [photo]
        sweep(m, 'hair lock', [(H[0]+s*1.35, HEEL+31.6, -.1), (H[0]+s*1.55, HEEL+30.0, -.35), (H[0]+s*1.75, HEEL+28.4, -.5)],
              [.45, .42, .3], 'copper', 10)
    # Diadem: band with its row of window openings as a ribbed band, and a rim.
    nb = 32
    band_o = [(H[0]+1.95*math.sin(math.tau*j/nb), H[2]+2.1*math.cos(math.tau*j/nb)) for j in range(nb)]
    band_i = [(H[0]+1.55*math.sin(math.tau*j/nb), H[2]+1.7*math.cos(math.tau*j/nb)) for j in range(nb)]
    ring_wall(m, 'crown band', band_o, band_i, HEEL+32.45, HEEL+33.0, 'copper')
    ring_wall(m, 'crown rim', [(H[0]+(u-H[0])*1.05, H[2]+(v-H[2])*1.05) for u, v in band_o], band_i, HEEL+33.7, HEEL+34.0, 'copper')
    for j in range(25):                # 25 window mullions between the band and the rim, front half
        a = math.radians(-100 + 200*j/24)
        c = (H[0]+1.9*math.sin(a), HEEL+33.35, H[2]+2.05*math.cos(a))
        obox(m, 'crown mullion', c, (.12*math.cos(a), 0, -.12*math.sin(a)), (0, .36, 0), (.14*math.sin(a), 0, .14*math.cos(a)), 'copper')
    back = [(H[0]+1.9*math.sin(math.tau*j/nb), H[2]+2.05*math.cos(math.tau*j/nb)) for j in range(nb)]
    back_i = [(H[0]+1.55*math.sin(math.tau*j/nb), H[2]+1.7*math.cos(math.tau*j/nb)) for j in range(nb)]
    ring_wall(m, 'crown inner band', back, back_i, HEEL+33.0, HEEL+33.7, 'copper')
    # Seven rays opening as a fan: screen angles from the front photo, the fan tilted back 25 deg.
    tilt = math.radians(25)
    up = Vector((0, math.cos(tilt), -math.sin(tilt)))
    centre = Vector((H[0], HEEL+33.3, H[2] - .2))
    for psi in (-13, 5, 36, 90, 144, 175, 193):
        p = math.radians(psi)
        d = (Vector((math.cos(p), 0, 0)) + up*math.sin(p)).normalized()
        side = d.cross(Vector((0, 0, 1)) if abs(d.z) < .9 else Vector((1, 0, 0))).normalized()
        nrm = d.cross(side).normalized()
        base = centre + d*1.55
        L = 3.0
        verts = [tuple(base + sx*.34*side + sz*.18*nrm) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        verts.append(tuple(base + L*d))
        m.mesh('crown ray', verts, [(3, 2, 1, 0), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], 'copper')

    # Raised right arm, almost vertical [photo: shoulder -3.4, fist centre -4.7 at heel+39.6].
    arm = [(-3.2, HEEL+26.3, 0.1), (-3.6, HEEL+28.8, .25), (-3.95, HEEL+31.5, .4), (-4.25, HEEL+34.0, .55),
           (-4.5, HEEL+36.3, .65), (-4.65, HEEL+38.2, .72)]
    sweep(m, 'right arm', arm, [(1.75, 1.6), (1.6, 1.45), (1.3, 1.2), (1.05, .98), (.9, .86), (.82, .8)], 'copper', 20)
    # The loose sleeve bunched at the shoulder and falling in a heavy drape [photo: to u -5.8].
    sweep(m, 'right sleeve', [(-3.7, HEEL+31.8, .2), (-4.7, HEEL+29.6, 0.0), (-5.25, HEEL+27.2, -.3), (-5.1, HEEL+24.6, -.5),
                              (-4.7, HEEL+22.3, -.6)],
          [(.9, .6), (1.3, .9), (1.3, 1.0), (1.0, .8), (.55, .45)], 'copper', 12)
    sweep(m, 'right sleeve fold', [(-3.3, HEEL+30.8, .9), (-4.2, HEEL+28.2, 1.1), (-4.5, HEEL+25.0, 1.0), (-4.6, HEEL+19.5, .8)],
          [.6, .7, .55, .35], 'copper', 10)
    ellipsoid(m, 'right fist', (-4.7, HEEL+39.5, .75), (.95, 1.35, 1.0), 'copper', 16, 10)
    tu, tv = -4.75, .8

    def cup(t, y):
        return 1.0 + (.07*math.sin(14*t) if HEEL+41.6 < y < HEEL+42.9 else 0)
    lathe(m, 'torch handle and cup', tu, tv,
          [(HEEL+38.0, 0), (HEEL+38.1, .4), (HEEL+40.7, .48), (HEEL+40.9, .62), (HEEL+41.1, .5), (HEEL+41.6, .6),
           (HEEL+42.2, 1.05), (HEEL+42.8, 1.4), (HEEL+43.0, 1.5), (HEEL+43.05, 0)], 'copper', 24, cup)
    lathe(m, 'torch balcony', tu, tv, [(HEEL+42.9, 0), (HEEL+42.95, 1.8), (HEEL+43.2, 1.8), (HEEL+43.25, 0)], 'copper', 32, smooth=False)
    ring_wall(m, 'torch railing',
              [(tu+1.78*math.sin(math.tau*j/32), tv+1.78*math.cos(math.tau*j/32)) for j in range(32)],
              [(tu+1.66*math.sin(math.tau*j/32), tv+1.66*math.cos(math.tau*j/32)) for j in range(32)],
              HEEL+43.2, HEEL+43.95, 'copper')

    def flame(t, y):
        s = (y - (HEEL+43.2)) / 2.85
        return 1.0 + (.08 + .22*s) * math.sin(5*t + 3.5*s)
    lathe(m, 'torch flame', tu, tv,
          [(HEEL+43.2, .6), (HEEL+43.6, .85), (HEEL+44.2, .92), (HEEL+44.8, .82), (HEEL+45.3, .6),
           (HEEL+45.7, .32), (TORCH_TIP, 0)], 'gold', 24, flame)

    # Tablet [NPS 7.19 x 4.14 x 0.61]: its face turned out to her left-front (seen obliquely from the
    # front, 2.2 m wide there) and its top leaning out ~18 deg [photo].
    n_ = Vector((math.sin(math.radians(58)), 0, math.cos(math.radians(58))))
    ax = Vector((.27, .88, -.3)).normalized()
    ax = (ax - n_*ax.dot(n_)).normalized()
    w = ax.cross(n_).normalized()
    if w.x < 0:
        w = -w
    C = Vector((7.0, HEEL+20.4, .7))
    obox(m, 'tablet', tuple(C), tuple(w*2.07), tuple(ax*3.595), tuple(n_*.305), 'copper')
    obox(m, 'tablet rim', tuple(C + n_*.36 + ax*3.3), tuple(w*2.0), tuple(ax*.18), tuple(n_*.06), 'copper')
    hand = C - ax*1.1 + w*1.75 + n_*.35
    # Left arm: upper arm inside the mantle, forearm rising to the hand at the tablet's outer edge.
    elbow = Vector((5.9, HEEL+17.4, .1))
    sweep(m, 'left upper arm', [(3.9, HEEL+25.6, -.2), (4.9, HEEL+22.0, -.2), tuple(elbow + Vector((-.1, .5, 0)))],
          [(1.45, 1.3), (1.3, 1.15), (1.15, 1.05)], 'copper', 16)
    sweep(m, 'left forearm', [tuple(elbow), tuple(elbow*.5 + hand*.5 + Vector((0, -.3, .2))), tuple(hand - ax*.2)],
          [1.0, .9, .78], 'copper', 16)
    ellipsoid(m, 'left hand', tuple(hand), (.75, 1.0, .7), 'copper', 14, 8)


def views(model_bounds):
    """Extra previews: the start line's view (bearing 57 deg from the statue), the front (the
    photos' view), the torch side and two figure close-ups."""
    scene = bpy.context.scene
    top = model_bounds[1][1]
    for label, bearing, elev, scale, ty in (('from-start', 57, .6, 150, top*.5), ('front', 140, 1.5, 150, top*.5),
                                           ('torch-side', 230, 4, 150, top*.5), ('figure-closeup', 57, 8, 62, top*.75),
                                           ('figure-front', 140, 6, 62, top*.75), ('aerial-front', 140, 12, 130, top*.3)):
        b = math.radians(bearing)
        d = Vector((math.sin(b)*math.cos(math.radians(elev)), math.cos(b)*math.cos(math.radians(elev)), math.sin(math.radians(elev))))
        target = Vector((0, 0, ty))
        bpy.ops.object.camera_add(location=target + d*400)
        cam = bpy.context.object
        cam.rotation_euler = (target-cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = scale; cam.data.clip_end = 2000
        scene.camera = cam
        scene.render.filepath = str(SCRATCH/('statue-of-liberty-'+label+'.png'))
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)


def main():
    m = Model('statue-of-liberty')
    m.material('copper', (.19, .43, .35), .12, .62, 'statue-of-liberty_copper')
    m.material('gold', (.80, .47, .07), .75, .32, 'statue-of-liberty_gold')
    m.material('stone', (.46, .39, .34), 0, .82, 'statue-of-liberty_stone')          # pinkish-brown pedestal granite
    m.material('concrete', (.55, .54, .51), 0, .88, 'statue-of-liberty_concrete')    # pale grey tiers
    m.material('steps', (.66, .65, .62), 0, .8, 'statue-of-liberty_stone_steps')     # pale stair granite
    m.material('granite', (.36, .34, .31), 0, .88, 'statue-of-liberty_granite')      # grey fort ashlar
    fort_wood(m)
    tiers(m)
    pedestal(m)
    figure(m)
    info = m.finish(directory=SCRATCH)
    views(info['bounds'])


main()
