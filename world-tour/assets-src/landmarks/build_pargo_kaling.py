"""Pargo Kaling (帕廓·噶林, the west-gate white stupas / 西门白塔), Lhasa, as rebuilt in 1995.

Modelled from photographs (2008-2019, Wikimedia Commons; list in the modelling report) and OpenStreetMap:
- the CENTRAL gate chorten stands on a kerbed traffic island in the middle of 北京中路, between the westbound
  and eastbound carriageways (OSM node 8285588447 `man_made=tower`, name 白塔). Its passage runs along the road
  (east-west). The built racing surface is wider than the real carriageway, so the island sits 5.4 m south of
  the OSM node to keep its north kerb 1.2 m off the racing surface.
- the CHAKPORI chorten stands on a whitewashed battered bastion at the foot of Chakpori, south-west of the
  island (OSM building way 176850390, whose outline this model rebuilds, including its stair wing).
- the MARPORI chorten stands on the rock spur of Marpori, north-east of the island across the westbound road
  (position read from photos, not mapped). The elevation data smooths that spur to a slope, so the model
  carries its own crag up to ~7.5 m above the road, as in the photos.
- two bell lines (thin wire, small bells) run from the central spire to the two side spires.

Dimensions: no published measurements exist. Every number below is read from photos, scaled by people and
cars standing next to the structure (photo estimate unless marked OSM). Central chorten: 18.2 m above its
island; widths from the frontal 2012 photo, heights averaged over the 2011 and 2012 photos.

Author frame: route-local metres (x east, z south) relative to the registered footprint's anchor, y up
from the model datum (the pipeline's lowest finished ground round the footprint). Every part is founded
at y = 0 and rises through the ground to where it really stands; ground heights come from the pipeline.
Run: Blender --background --python assets-src/landmarks/build_pargo_kaling.py
"""
import json
import tempfile
import math
import os
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model, ROOT

SCRATCH = (Path(tempfile.gettempdir()) / 'sr-landmarks' / 'pargo-kaling')
HEX = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]

# ---------------------------------------------------------------- positions (route-local x, z)
CENTRAL = (-812.5, 7.5)           # OSM node 8285588447 at z = 2.1, moved 5.4 m south (see docstring)
CHAKPORI = (-864.0, 32.2)         # on the bastion's east block, near its NE corner (photo)
MARPORI = (-785.0, -33.0)         # on the Marpori rock spur (photo estimate)
BASTION_EAST = [(-880.8, 26.3), (-852.8, 26.9), (-852.7, 29.3), (-856.0, 34.1), (-865.5, 42.3),
                (-877.5, 39.2), (-880.8, 39.2)]                                   # OSM way 176850390
BASTION_WING = [(-865.5, 42.3), (-877.5, 39.2), (-900.4, 49.7), (-896.9, 56.9)]  # OSM, stair wing
BASTION_WEST = [(-908.4, 25.5), (-880.8, 26.3), (-880.8, 31.9), (-902.3, 32.0), (-902.6, 54.4),
                (-909.3, 54.3)]                                                  # OSM, cliff-foot wall
ISLAND = [(-823.0, 0.6), (-796.0, 0.6), (-789.0, 3.5), (-786.0, 7.5), (-789.0, 11.5), (-796.0, 14.4),
          (-823.0, 14.4), (-826.0, 11.0), (-826.0, 4.0)]                          # kerb outline

GROUND_CODE = r'''
import json, sys, numpy as np
from sr.routes import load_route
from sr.dem import DemSampler
from sr.route import build_route, reparameterize
from sr.terrain import road_profile, ground_height
from sr.bare_earth import for_route as bare_earth
from sr.build import parallel_flat_extents, _curvature, landmark_base
from sr.landmark_data import entries, model_anchor
route = load_route('lhasa'); dem = DemSampler(); res = build_route('lhasa')
dem = bare_earth(dem, res, 'lhasa', float(route.get('terrainPadM', 300)), float(route.get('waterLevelM', 0.0)))
road_y = road_profile(res, dem, route.get('bridgeDeckM'), route.get('bridgeMinLengthM', 200.0))
res.P[:, 1] = road_y; res.export_curvature = _curvature(res); res.P[:] = np.round(res.P, 2); road_y = res.P[:, 1].copy()
reparameterize(res)
res.flat_left, res.flat_right = parallel_flat_extents(res, res.ways, road_y, dem)
entry = entries()['pargo-kaling']
lat, lon = model_anchor(entry)
x, z = res.frame.to_local(lat, lon)
datum = landmark_base(res, road_y, dem, entry, float(x), float(z), lat, lon)
pts = np.asarray(json.loads(sys.argv[1]), dtype=float)
h = ground_height(res, road_y, dem, pts)
print(json.dumps(dict(anchor=[float(x), float(z)], datum=float(datum), heights=[float(v) for v in h])))
'''


def ground(points):
    out = subprocess.check_output([str(ROOT/'pipeline/.venv/bin/python'), '-c', GROUND_CODE, json.dumps(points)],
                                  cwd=ROOT/'pipeline', env={**os.environ, 'PYTHONPATH': str(ROOT/'pipeline')}, text=True)
    return json.loads(out.strip().splitlines()[-1])


class GateModel(Model):
    """Authoring in anchor-relative route-local (x, y, z); converted to the tools' (u, y, v) frame."""
    def mesh(self, label, vertices, faces, material, smooth=False):
        a, b = self.spec['across'], self.spec['axis']
        conv = [(p[0]*a[0]+p[2]*a[1], p[1], p[0]*b[0]+p[2]*b[1]) for p in vertices]
        super().mesh(label, conv, faces, material, smooth)


# ---------------------------------------------------------------- primitives (x, y, z)
def hexa(m, label, b, t, mat):
    m.mesh(label, list(b)+list(t), HEX, mat)


def rbox(m, label, x0, x1, y0, y1, z0, z1, mat):
    x0, x1 = sorted((x0, x1)); z0, z1 = sorted((z0, z1))
    hexa(m, label, [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
         [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], mat)


def frustum(m, label, cx, cz, hb, ht, y0, y1, mat, hbz=None, htz=None):
    """Square/rect frustum (battered block) centred at cx, cz."""
    hbz = hb if hbz is None else hbz
    htz = ht if htz is None else htz
    hexa(m, label, [(cx-hb, y0, cz-hbz), (cx+hb, y0, cz-hbz), (cx+hb, y0, cz+hbz), (cx-hb, y0, cz+hbz)],
         [(cx-ht, y1, cz-htz), (cx+ht, y1, cz-htz), (cx+ht, y1, cz+htz), (cx-ht, y1, cz+htz)], mat)


def prism(m, label, outline, y0, y1, mat):
    m.shell(label, [(x, y0, z) for x, z in outline], (0, y1-y0, 0), mat)


def loft(m, label, rings, mat, smooth=False):
    """Closed solid through horizontal rings of equal point count [(y, [(x, z), ...]), ...]."""
    n = len(rings[0][1])
    verts = [(x, y, z) for y, ring in rings for x, z in ring]
    faces = [tuple(reversed(range(n))), tuple((len(rings)-1)*n+k for k in range(n))]
    for i in range(len(rings)-1):
        a, b = i*n, (i+1)*n
        faces += [(a+k, a+(k+1) % n, b+(k+1) % n, b+k) for k in range(n)]
    m.mesh(label, verts, faces, mat, smooth)


def lathe(m, label, cx, cz, y0, profile, mat, sides=48, smooth=True):
    ring = [(math.cos(k*math.tau/sides), math.sin(k*math.tau/sides)) for k in range(sides)]
    loft(m, label, [(y0+dy, [(cx+r*c, cz+r*s) for c, s in ring]) for dy, r in profile], mat, smooth)


def indented(h, c):
    """Square of half-size h with one re-entrant step at each corner (Tibetan chorten plan), CCW."""
    pts = []
    for q in range(4):
        ca, sa = math.cos(q*math.pi/2), math.sin(q*math.pi/2)
        for x, y in [(h, h-c), (h-c, h-c), (h-c, h)]:
            pts.append((x*ca-y*sa, x*sa+y*ca))
    return pts


def iprism(m, label, cx, cz, h, c, y0, y1, mat):
    prism(m, label, [(cx+x, cz+z) for x, z in indented(h, c)], y0, y1, mat)


def bar(m, label, a, b, w, d, mat, up=(0, 1, 0)):
    """Thin box from point a to point b, width w (across, in the plane normal to `up` x dir), depth d along `up`."""
    t = [b[k]-a[k] for k in range(3)]
    L = math.sqrt(sum(v*v for v in t)) or 1
    t = [v/L for v in t]
    s = [t[1]*up[2]-t[2]*up[1], t[2]*up[0]-t[0]*up[2], t[0]*up[1]-t[1]*up[0]]
    sl = math.sqrt(sum(v*v for v in s)) or 1
    s = [v/sl*w/2 for v in s]
    u = [v*d/2 for v in up]
    def p(q, i, j):
        return tuple(q[k]+i*s[k]+j*u[k] for k in range(3))
    hexa(m, label, [p(a, -1, -1), p(a, 1, -1), p(a, 1, 1), p(a, -1, 1)],
         [p(b, -1, -1), p(b, 1, -1), p(b, 1, 1), p(b, -1, 1)], mat)


def ball(m, label, c, r, mat, sides=10, rings=6):
    prof = [(r-r*math.cos(math.pi*i/rings), max(r*math.sin(math.pi*i/rings), r*.04)) for i in range(rings+1)]
    lathe(m, label, c[0], c[2], c[1]-r, prof, mat, sides)


def curve(a, b, sag, n):
    return [tuple(a[k]+(b[k]-a[k])*t-(sag*4*t*(1-t) if k == 1 else 0) for k in range(3))
            for t in (i/(n-1) for i in range(n))]


def hashf(*v):
    s = math.sin(sum(x*k for x, k in zip(v, (12.9898, 78.233, 37.719, 4.581)))) * 43758.5453
    return s - math.floor(s)


# ---------------------------------------------------------------- niche (flame-arch frame)
def torana(w, h, hs, n=14):
    """Closed outline (t, y) of a flame arch: straight sides to hs, pointed ogee top at h. Same count for any size."""
    pts = [(-w/2, 0.0)]
    pts += [(-w/2, hs*i/4) for i in range(1, 5)]
    for i in range(1, n):
        a = i/n
        pts.append((-w/2+a*w, hs+(h-hs)*(1-abs(2*a-1))**.62))
    pts += [(w/2, hs*(4-i)/4) for i in range(0, 5)]
    pts += [(w/2-w*i/6, 0.0) for i in range(1, 6)]
    return pts


def niche(m, name, cx, cz, d, ybase, surf, w, h, lattice, S, gilt=True):
    """Niche on the vase facing d = (dx, dz): frame proud of the vase surface at radius `surf`."""
    dx, dz = d
    px, pz = -dz, dx
    def P(s, t, y):
        return (cx+dx*s+px*t, y, cz+dz*s+pz*t)
    G, K = ('gold' if gilt else 'plaster'), 'paint_black'
    band = .16*w
    outer = torana(w, h, .56*h)
    inner = [(t*(w-2*band)/w, band*.8+y*(h-1.9*band)/h) for t, y in torana(w, h, .56*h)]
    s0, s1 = surf-.55*S, surf+.12*S
    n = len(outer)
    verts = ([P(s1, t, ybase+y) for t, y in outer]+[P(s1, t, ybase+y) for t, y in inner] +
             [P(s0, t, ybase+y) for t, y in outer]+[P(s0, t, ybase+y) for t, y in inner])
    faces = []
    for i in range(n):
        j = (i+1) % n
        faces += [(i, j, n+j, n+i), (3*n+i, 3*n+j, 2*n+j, 2*n+i), (2*n+i, 2*n+j, j, i), (n+i, n+j, 3*n+j, 3*n+i)]
    m.mesh(f'{name} niche frame', verts, faces, G)
    # relief beads round the frame face
    for k in range(0, n, 2 if S > .6 else 3):
        t0, y0 = outer[k]
        t1, y1 = inner[k]
        ball(m, f'{name} niche bead', P(s1+.02*S, (t0+t1)/2, ybase+(y0+y1)/2), .06*S, G, 6, 3)
    # dark recess inside the opening
    back = surf-.42*S
    m.shell(f'{name} niche recess', [P(back, t, ybase+y) for t, y in inner], (dx*.08*S, 0, dz*.08*S), K)
    ti = (w-2*band)/2
    ylo, yhi = ybase+band*.8, ybase+band*.8+.56*h*(h-1.9*band)/h
    if lattice:
        sp, s = .2*S, back+.2*S
        k0 = int(-(ti+(yhi-ylo))/sp)-1
        for sign in (1, -1):
            for k in range(k0, -k0+1):
                # line t = sign*(y - ylo) + k*sp, clipped to the rectangle
                seg = []
                for yy in (ylo, yhi):
                    seg.append((sign*(yy-ylo)+k*sp, yy))
                (ta, ya), (tb, yb) = seg
                pts = []
                for (t, y) in [(ta, ya), (tb, yb)]:
                    pts.append((t, y))
                # clip to |t| <= ti
                def clip(p, q):
                    (t1, y1), (t2, y2) = p, q
                    if t1 > t2:
                        t1, y1, t2, y2 = t2, y2, t1, y1
                    if t2 < -ti or t1 > ti:
                        return None
                    if t1 < -ti:
                        y1 = y1+(y2-y1)*(-ti-t1)/(t2-t1); t1 = -ti
                    if t2 > ti:
                        y2 = y1+(y2-y1)*(ti-t1)/(t2-t1) if t2 != t1 else y2; t2 = ti
                    return (t1, y1), (t2, y2)
                c = clip(*pts)
                if not c or math.dist(c[0], c[1]) < .05*S:
                    continue
                (t1, y1), (t2, y2) = c
                bar(m, f'{name} lattice', P(s, t1, y1), P(s, t2, y2), .045*S, .05*S, G, (dx, 0, dz))
        # arched head of the window filled with a gilt panel
        top = [(t, y) for t, y in inner if y > yhi-ybase-1e-6]
    else:
        # seated figure in red cloth (as photographed in 2012)
        fx = back+.35*S
        c = P(fx, 0, 0)
        lathe(m, f'{name} figure seat', c[0], c[2], ylo, [(0, .42*S), (.14*S, .45*S), (.2*S, .34*S)], G, 20)
        lathe(m, f'{name} figure', c[0], c[2], ylo+.2*S,
              [(0, .4*S), (.22*S, .36*S), (.5*S, .24*S), (.8*S, .2*S), (.9*S, .1*S), (.96*S, .15*S),
               (1.14*S, .16*S), (1.26*S, .1*S), (1.34*S, .02*S)], G, 20)
        # draped khata cloth over the shoulders
        for side in (-1, 1):
            a = P(fx+.12*S, side*.22*S, ylo+1.0*S)
            b = P(fx+.2*S, side*.34*S, ylo+.25*S)
            bar(m, f'{name} figure cloth', a, b, .2*S, .04*S, 'cloth_red', (dx, 0, dz))
        bar(m, f'{name} figure cloth', P(fx+.26*S, -.3*S, ylo+.55*S), P(fx+.26*S, .3*S, ylo+.55*S), .3*S, .04*S,
            'cloth_red', (dx, 0, dz))


# ---------------------------------------------------------------- chorten upper parts
def vase_and_spire(m, name, cx, cz, y, D, niches):
    """Vase (bumpa), harmika, spire, crown, moon, sun and point. D: dimension dict. Returns attach points."""
    W, G = 'plaster', 'gold'
    S = D['S']
    # thin rim under the vase
    lathe(m, f'{name} vase rim', cx, cz, y, [(0, D['r0']+.1*S), (.12*S, D['r0']+.1*S)], W, D['sides'])
    y += .12*S
    H, r0, rm = D['vh'], D['r0'], D['rm']
    prof = [(0, r0), (.15*H, r0+.08*(rm-r0)*4.5*.15), (.35*H, r0+.4*(rm-r0)), (.55*H, r0+.68*(rm-r0)),
            (.68*H, r0+.88*(rm-r0)), (.76*H, rm), (.83*H, rm-.012*S), (.89*H, rm-.07*S), (.935*H, rm-.2*S),
            (.965*H, rm-.4*S), (.988*H, rm-.75*S), (H, D['rt'])]
    prof.append((H, 0.02))
    lathe(m, f'{name} vase', cx, cz, y, prof[:-1], W, D['sides'])
    # stone block joints: shallow proud courses round the vase
    for f in (.2, .42, .62):
        yy = f*H
        r = r0+(rm-r0)*min(1.0, f/.76)**1.05+.01*S
        lathe(m, f'{name} vase course', cx, cz, y+yy, [(0, r), (.025*S, r+.012*S), (.05*S, r)], W, D['sides'], True)
    for d, lat in niches:
        niche(m, name, cx, cz, d, y, rm*.93, D['nw'], D['nh'], lat, S, D['gilt'])
    y += H
    # harmika: plain box with a projecting moulding top and bottom
    hh, hw = D['hh'], D['hw']
    rbox(m, f'{name} harmika', cx-hw, cx+hw, y-.05*S, y+hh, cz-hw, cz+hw, W)
    rbox(m, f'{name} harmika foot', cx-hw-.06*S, cx+hw+.06*S, y-.05*S, y+.06*S, cz-hw-.06*S, cz+hw+.06*S, W)
    rbox(m, f'{name} harmika cap', cx-hw-.1*S, cx+hw+.1*S, y+hh-.02*S, y+hh+.09*S, cz-hw-.1*S, cz+hw+.1*S, W)
    for s in (-1, 1):  # carved panel lines on each face
        rbox(m, f'{name} harmika panel', cx-hw+.12*S, cx+hw-.12*S, y+.14*S, y+hh-.12*S, cz+s*hw-.02*S, cz+s*hw+.02*S, W)
        rbox(m, f'{name} harmika panel', cx+s*hw-.02*S, cx+s*hw+.02*S, y+.14*S, y+hh-.12*S, cz-hw+.12*S, cz+hw-.12*S, W)
    y += hh+.09*S
    # spire: foot disc and 13 deeply grooved rings
    lathe(m, f'{name} spire foot', cx, cz, y, [(0, D['sr0']+.08*S), (.08*S, D['sr0']+.1*S), (.2*S, D['sr0'])], G, D['sides'])
    y += .2*S
    prof, n, sh = [], 13, D['sh']
    ring = sh/n
    for i in range(n):
        r = D['sr0']+(D['sr1']-D['sr0'])*i/(n-1)
        yy = i*ring
        prof += [(yy, r*.84), (yy+.12*ring, r*.97), (yy+.3*ring, r), (yy+.7*ring, r), (yy+.86*ring, r*.95), (yy+ring, r*.84)]
    lathe(m, f'{name} spire rings', cx, cz, y, prof, 'gilt_bronze', D['sides'])
    attach = [(y+k*ring, D['sr0']+(D['sr1']-D['sr0'])*k/(n-1)) for k in range(n)]
    y += sh
    # crown (parasol): collar, bell-shaped canopy with a bead band and a scalloped hem
    cr = D['cr']
    lathe(m, f'{name} crown collar', cx, cz, y, [(0, D['sr1']*.9), (.15*S*cr, D['sr1']*.95)], G, 32)
    y += .15*S*cr
    lathe(m, f'{name} crown', cx, cz, y, [(0, .5*cr), (.06*S*cr, .72*cr), (.2*S*cr, .68*cr), (.35*S*cr, .58*cr),
                                           (.55*S*cr, .5*cr), (.72*S*cr, .43*cr), (.85*S*cr, .3*cr), (.9*S*cr, .12*cr)], G, 40)
    for k in range(24):
        a = k*math.tau/24
        ball(m, f'{name} crown bead', (cx+.6*cr*math.cos(a), y+.28*S*cr, cz+.6*cr*math.sin(a)), .05*cr, G, 6, 3)
    for k in range(16):
        a = k*math.tau/16
        c = (cx+.7*cr*math.cos(a), y-.02*S*cr, cz+.7*cr*math.sin(a))
        ball(m, f'{name} crown hem', c, .07*cr, G, 6, 3)
    y += .9*S*cr
    # neck, crescent moon (horns up, facing east-west), sun ball, point
    lathe(m, f'{name} finial neck', cx, cz, y-.02*S*cr, [(0, .1*cr), (.16*S*cr, .08*cr)], G, 16)
    y += .14*S*cr
    R = .52*cr
    mc = y+R*1.02
    outer = [(R*math.cos(t), mc+R*math.sin(t)) for t in (math.radians(185+i*170/16) for i in range(17))]
    inner = [(R*.84*math.cos(t), mc+.22*cr+R*.8*math.sin(t)) for t in (math.radians(355-i*170/16) for i in range(17))]
    outline = outer+inner
    th = .09*cr
    m.shell(f'{name} crescent moon', [(cx-th/2, y_, cz+t) for t, y_ in outline], (th, 0, 0), G)
    m.shell(f'{name} crescent moon', [(cx+t, y_, cz-th/2) for t, y_ in outline], (0, 0, th), G)
    ball(m, f'{name} sun', (cx, mc+.14*cr, cz), .2*cr, G, 16, 8)
    lathe(m, f'{name} point', cx, cz, mc+.3*cr, [(0, .08*cr), (.1*cr, .1*cr), (.24*cr, .05*cr), (.34*cr, .005*cr)], G, 12)
    return attach, mc+.64*cr


def steps(m, name, cx, cz, y, widths, hstep, c, lip):
    """Stepped bang-rim: each tier an indented-corner block with a thin projecting top lip."""
    for i, w in enumerate(widths):
        iprism(m, f'{name} step {i}', cx, cz, w/2, c, y, y+hstep-lip, 'plaster')
        iprism(m, f'{name} step lip {i}', cx, cz, w/2+lip*.6, c, y+hstep-lip, y+hstep, 'plaster')
        y += hstep
    return y


# ---------------------------------------------------------------- central gate chorten
CENTRAL_D = dict(S=1.0, sides=96, r0=2.33, rm=2.68, rt=1.08, vh=3.08, nw=2.65, nh=3.0, gilt=True,
                 hh=.62, hw=1.05, sr0=.92, sr1=.45, sh=3.4, cr=1.0)
PASS_HALF, PASS_H = 1.3, 3.9       # passage 2.6 m wide, 3.9 m clear (photo)


def central(m, cx, cz, Y, Yx):
    W, S_, D = 'plaster', 'stone', 'wood'
    # plinth: 13.4 m, three tiers to 1.6 m, split by the passage (runs along x)
    for s in (-1, 1):
        for (h, y0, y1) in [(6.7, 0, Y+1.0), (6.35, Y+1.0, Y+1.3), (6.0, Y+1.3, Y+1.6)]:
            rbox(m, 'plinth', cx-h, cx+h, y0, y1, cz+s*PASS_HALF, cz+s*h, W)
        rbox(m, 'plinth toe', cx-6.78, cx+6.78, Y, Y+.18, cz+s*PASS_HALF, cz+s*6.78, W)
        # a row of white stones along the plinth ledge
        for k in range(22):
            t = -5.6+k*11.2/21
            for (px, pz) in [(cx+t, cz+s*5.4), (cx+5.35*(1 if k % 2 else -1), cz+s*(PASS_HALF+.35+(k//2)*.38))]:
                if abs(pz-cz) > 5.8 or abs(pz-cz) < PASS_HALF+.2:
                    continue
                ball(m, 'plinth white stone', (px, Y+1.6+.08, pz), .13+.05*hashf(k, s, px), 'plaster', 7, 3)
    # passage block (9.0 m, slight batter) either side of the passage, and the lintel over it
    for s in (-1, 1):
        z0, z1 = sorted((cz+s*PASS_HALF, cz+s*4.5))
        z2, z3 = sorted((cz+s*PASS_HALF, cz+s*4.42))
        hexa(m, 'passage block', [(cx-4.5, Y, z0), (cx+4.5, Y, z0), (cx+4.5, Y, z1), (cx-4.5, Y, z1)],
             [(cx-4.42, Y+4.4, z2), (cx+4.42, Y+4.4, z2), (cx+4.42, Y+4.4, z3), (cx-4.42, Y+4.4, z3)], W)
    rbox(m, 'passage lintel', cx-4.44, cx+4.44, Y+PASS_H, Y+4.4, cz-PASS_HALF-.01, cz+PASS_HALF+.01, W)
    # stone courses (the photos show the coursing through the whitewash): thin proud bands every 0.46 m
    for i in range(1, 6):
        yy = Y+1.6+i*.46
        if yy > Y+4.3:
            break
        h = 4.5-.08*(yy-Y)/4.4+.012
        for s in (-1, 1):
            rbox(m, 'block course', cx-h, cx+h, yy-.025, yy+.025, cz+s*4.4, cz+s*h, W)
            if yy < Y+PASS_H-.05:
                for e in (-1, 1):
                    rbox(m, 'block course', cx+e*4.4, cx+e*h, yy-.025, yy+.025, cz+s*PASS_HALF, cz+s*h, W)
            else:
                rbox(m, 'block course', cx+s*4.4, cx+s*h, yy-.025, yy+.025, cz-h, cz+h, W)
    for yy in (Y+.35, Y+.7):
        for s in (-1, 1):
            rbox(m, 'plinth course', cx-6.712, cx+6.712, yy-.02, yy+.02, cz+s*PASS_HALF, cz+s*6.712, W)
    # passage lining: dark wooden frame at both mouths, ceiling boards and beams, low dado
    for e in (-1, 1):
        fx = cx+e*4.45
        for s in (-1, 1):
            rbox(m, 'passage frame post', fx-e*.35, fx+e*.05, Y, Y+PASS_H, cz+s*(PASS_HALF-.2), cz+s*(PASS_HALF+.02), D)
        rbox(m, 'passage frame head', fx-e*.35, fx+e*.05, Y+PASS_H-.22, Y+PASS_H+.02, cz-PASS_HALF-.02, cz+PASS_HALF+.02, D)
        rbox(m, 'passage threshold', fx-e*.3, fx+e*.05, Y, Y+.08, cz-PASS_HALF+.2, cz+PASS_HALF-.2, S_)
    rbox(m, 'passage ceiling', cx-4.3, cx+4.3, Y+PASS_H-.1, Y+PASS_H+.01, cz-PASS_HALF, cz+PASS_HALF, D)
    for i in range(11):
        x = cx-3.9+i*7.8/10
        rbox(m, 'passage beam', x-.08, x+.08, Y+PASS_H-.3, Y+PASS_H-.09, cz-PASS_HALF+.01, cz+PASS_HALF-.01, D)
    for s in (-1, 1):
        rbox(m, 'passage dado', cx-4.3, cx+4.3, Y, Y+1.0, cz+s*(PASS_HALF-.04), cz+s*PASS_HALF, 'plaster_grey')
    hexa(m, 'passage paving', [(cx-6.7, Y-.4, cz-PASS_HALF), (cx+6.7, Y-.4, cz-PASS_HALF), (cx+6.7, Y-.4, cz+PASS_HALF),
                               (cx-6.7, Y-.4, cz+PASS_HALF)],
         [(cx-6.7, Yx(cx-6.7)+.02, cz-PASS_HALF), (cx+6.7, Yx(cx+6.7)+.02, cz-PASS_HALF),
          (cx+6.7, Yx(cx+6.7)+.02, cz+PASS_HALF), (cx-6.7, Yx(cx-6.7)+.02, cz+PASS_HALF)], S_)
    # two-tier cornice: set-back band then a heavy projecting slab with a chamfered top edge
    rbox(m, 'cornice band', cx-4.75, cx+4.75, Y+4.4, Y+4.95, cz-4.75, cz+4.75, W)
    frustum(m, 'cornice slab', cx, cz, 5.2, 5.2, Y+4.95, Y+5.45, W)
    frustum(m, 'cornice slab top', cx, cz, 5.2, 5.05, Y+5.45, Y+5.6, W)
    rbox(m, 'cornice drip', cx-5.24, cx+5.24, Y+4.95, Y+5.03, cz-5.24, cz+5.24, W)
    # four tall steps with indented corners
    y = steps(m, 'central', cx, cz, Y+5.6, [8.1, 7.45, 6.8, 6.15], .72, .32, .1)
    attach, top = vase_and_spire(m, 'central', cx, cz, y, CENTRAL_D, [((1, 0), False), ((-1, 0), True)])
    return attach, top


# ---------------------------------------------------------------- small side chortens
SMALL_D = dict(S=.47, sides=64, r0=.9, rm=1.05, rt=.42, vh=1.25, nw=.95, nh=1.08, gilt=False,
               hh=.3, hw=.42, sr0=.36, sr1=.18, sh=1.55, cr=.42)


def small_chorten(m, name, cx, cz, y, face):
    """Base block 5.6 m, second base 3.9 m with cornice slab, two steps, vase with a lattice niche facing `face`."""
    W = 'plaster'
    rbox(m, f'{name} base', cx-2.8, cx+2.8, 0, y+1.18, cz-2.8, cz+2.8, W)
    rbox(m, f'{name} base cornice', cx-2.9, cx+2.9, y+1.18, y+1.3, cz-2.9, cz+2.9, W)
    for k in range(4):   # framed panel on each face of the base block
        d = [(1, 0), (-1, 0), (0, 1), (0, -1)][k]
        for (a, b, c0, c1) in [(-2.3, 2.3, .95, 1.07), (-2.3, 2.3, .2, .32), (-2.3, -2.18, .32, .95), (2.18, 2.3, .32, .95)]:
            if d[0]:
                rbox(m, f'{name} base panel', cx+d[0]*2.8, cx+d[0]*2.86, y+c0, y+c1, cz+a, cz+b, W)
            else:
                rbox(m, f'{name} base panel', cx+a, cx+b, y+c0, y+c1, cz+d[1]*2.8, cz+d[1]*2.86, W)
    y += 1.3
    frustum(m, f'{name} second base', cx, cz, 1.95, 1.9, y, y+.95, W)
    rbox(m, f'{name} second cornice', cx-2.05, cx+2.05, y+.95, y+1.2, cz-2.05, cz+2.05, W)
    y = steps(m, name, cx, cz, y+1.2, [3.4, 2.9], .5, .14, .06)
    attach, top = vase_and_spire(m, name, cx, cz, y, SMALL_D, [(face, True)])
    return attach, top


def incense_burner(m, cx, cz, y):
    """White bell-shaped incense burner (桑炉) with a small chimney, as at the bastion chorten's NE corner."""
    lathe(m, 'incense burner', cx, cz, y, [(0, .62), (.12, .64), (.2, .56), (.5, .62), (.9, .66), (1.2, .6), (1.45, .44),
                                            (1.62, .24), (1.72, .1), (1.78, .06)], 'plaster', 32)
    lathe(m, 'incense burner chimney', cx, cz, y+1.74, [(0, .07), (.28, .06), (.32, .1), (.4, .02)], 'plaster', 12)
    rbox(m, 'incense burner mouth', cx-.22, cx+.22, y+.35, y+.75, cz-.66, cz-.5, 'paint_black')


# ---------------------------------------------------------------- bastion (OSM way 176850390)
def battered(m, label, outline, y0, y1, batter, mat):
    """Prism whose top ring is the outline pushed inward by `batter` (convex/near-convex outlines)."""
    n = len(outline)
    cxm = sum(p[0] for p in outline)/n
    czm = sum(p[1] for p in outline)/n
    top = []
    for x, z in outline:
        dx, dz = cxm-x, czm-z
        L = math.hypot(dx, dz) or 1
        top.append((x+dx/L*batter, z+dz/L*batter))
    loft(m, label, [(y0, outline), (y1, top)], mat)


def offset(outline, d):
    """Outline pushed out by d from its centroid (small offsets only)."""
    n = len(outline)
    cxm = sum(p[0] for p in outline)/n
    czm = sum(p[1] for p in outline)/n
    out = []
    for x, z in outline:
        dx, dz = x-cxm, z-czm
        L = math.hypot(dx, dz) or 1
        out.append((x+dx/L*d, z+dz/L*d))
    return out


def rounded_east(outline):
    """Round the bastion's NE corner (photo: a curved corner), replacing the OSM chamfer by an arc."""
    out = []
    for p in outline:
        if p == (-852.7, 29.3):
            a, b = (-852.8, 26.9), (-856.0, 34.1)
            for k in range(1, 8):
                t = k/8
                # quadratic bezier through the chamfer, bulging to the corner
                c = (-852.2, 31.2)
                out.append(((1-t)**2*a[0]+2*(1-t)*t*c[0]+t*t*b[0], (1-t)**2*a[1]+2*(1-t)*t*c[1]+t*t*b[1]))
        else:
            out.append(p)
    return out


def bastion(m, top, west_top, wing_top, L):
    W, R = 'plaster', 'stone_red'
    east = [L(p) for p in rounded_east(BASTION_EAST)]
    battered(m, 'bastion wall', east, 0, top-1.35, .5, W)
    inner = offset(east, -.5)
    # reddish-brown rubble-stone band under the coping, and the white coping ledge
    loft(m, 'bastion stone band', [(top-1.35, inner), (top-.3, offset(inner, -.03))], R)
    loft(m, 'bastion coping', [(top-.3, offset(inner, .18)), (top-.05, offset(inner, .18)), (top, offset(inner, .08))], W)
    rbox(m, 'bastion spout', *(lambda c: (c[0]-.1, c[0]+.1, top-1.6, top-1.3, c[1]-.9, c[1]-.3))(L((-866.0, 26.6))), 'stone')
    # stair wing climbing Chakpori: solid under the flight, steps, stepped parapets
    a0, a1, b1, b0 = [L(p) for p in BASTION_WING]      # a: NE end at the bastion top, b: SW end
    n = 26
    for i in range(n):
        t0, t1 = i/n, (i+1)/n
        y = top+(wing_top-top)*t1
        q = [(a0[k]+(b0[k]-a0[k])*t0, a1[k]+(b1[k]-a1[k])*t0) for k in range(2)]
        r = [(a0[k]+(b0[k]-a0[k])*t1, a1[k]+(b1[k]-a1[k])*t1) for k in range(2)]
        pts = [(q[0][0], q[1][0]), (q[0][1], q[1][1]), (r[0][1], r[1][1]), (r[0][0], r[1][0])]
        pts = [(q[0][0], q[1][0]), (q[0][1], q[1][1])]
        quad = [(a0[0]+(b0[0]-a0[0])*t0, a0[1]+(b0[1]-a0[1])*t0), (a1[0]+(b1[0]-a1[0])*t0, a1[1]+(b1[1]-a1[1])*t0),
                (a1[0]+(b1[0]-a1[0])*t1, a1[1]+(b1[1]-a1[1])*t1), (a0[0]+(b0[0]-a0[0])*t1, a0[1]+(b0[1]-a0[1])*t1)]
        # the flight is laid on the Chakpori rock (grey rock with whitewash splashes in the photos)
        prism(m, 'stair wing rock', quad, 0, y-.9, 'rock')
        # tread (stone) inset between the parapets
        inset = []
        for (x, z), (xo, zo) in zip(quad, [quad[1], quad[0], quad[3], quad[2]]):
            inset.append((x+(xo-x)*.14, z+(zo-z)*.14))
        prism(m, 'stair tread', inset, y-.9, y, 'stone')
        for side in (0, 1):
            e0 = quad[side]; e1 = quad[3-side]
            inn0 = inset[side]; inn1 = inset[3-side]
            prism(m, 'stair parapet', [e0, inn0, inn1, e1], y-.9, y+1.0, W)
    # low wall at the foot of the Chakpori cliff (the rest of the OSM outline), with a coping
    west = [L(p) for p in BASTION_WEST]
    prism(m, 'cliff-foot wall', west, 0, west_top-.15, W)
    prism(m, 'cliff-foot wall coping', west, west_top-.15, west_top, 'plaster_grey')


# ---------------------------------------------------------------- Marpori crag
def crag(m, cx, cz, top, gfoot):
    """Rock spur under the Marpori chorten: a steep cliff toward the road (south, +z), a flat top the
    chorten's plinth stands on, and a long back running up-slope to the north-east into the hill."""
    n = 48
    ridge = (.6, -.8)                            # up-slope direction (towards Marpori)
    levels = [0.0, gfoot-1.5]+[gfoot+k*(top-gfoot)/8 for k in range(1, 9)]+[top+.25]
    rings = []
    for j, y in enumerate(levels):
        f = max(0.0, min(1.0, (y-gfoot)/(top-gfoot)))
        ring = []
        for k in range(n):
            a = k*math.tau/n
            c, s_ = math.cos(a), math.sin(a)
            along = c*ridge[0]+s_*ridge[1]
            # the plateau is ~5 m round; lower down the rock widens, most toward the up-slope back
            r = 4.9+(1-f)**1.3*(4.5+7.5*max(0.0, along)+.8*max(0.0, -along))
            if j == len(levels)-1:
                r = 4.6
            r += (1.0*(hashf(k, j, 3)-.5)+.5*math.sin(5*a+1.7*j))*(1-.6*f) if j < len(levels)-1 else 0
            ring.append((cx+r*c, cz+r*s_))
        yj = y+(.35*(hashf(j, 9)-.5) if 1 < j < len(levels)-2 else 0)
        rings.append((yj, ring))
    loft(m, 'marpori crag', rings, 'rock')
    for k in range(9):
        a = k*math.tau/9+.4
        r = 7.5+2.0*hashf(k, 1)
        ball(m, 'crag boulder', (cx+r*math.cos(a), gfoot+.1, cz+r*math.sin(a)), .5+.5*hashf(k, 2), 'rock', 7, 4)


# ---------------------------------------------------------------- island
def island(m, pts, Yx):
    """Kerbed island whose top follows the road grade (Yx(x) = road height + kerb)."""
    for label, ring, dy, mat in [('island kerb', pts, 0, 'granite'), ('island paving', offset(pts, -.3), .015, 'stone')]:
        n = len(ring)
        verts = [(x, 0 if dy == 0 else Yx(x)-.3, z) for x, z in ring]+[(x, Yx(x)+dy, z) for x, z in ring]
        faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]+[(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
        m.mesh(label, verts, faces, mat)


def flowers(m, cx, cz, x0, x1, z0, z1, Y, key):
    """Planter strip with low flower clumps."""
    rbox(m, 'planter', x0, x1, Y, Y+.3, z0, z1, 'granite')
    rbox(m, 'planter soil', x0+.08, x1-.08, Y+.1, Y+.33, z0+.08, z1-.08, 'soil')
    nx, nz = max(1, int((x1-x0)/.24)), max(1, int((z1-z0)/.24))
    for i in range(nx):
        for j in range(nz):
            x = x0+.16+(i+.5)*(x1-x0-.32)/nx
            z = z0+.16+(j+.5)*(z1-z0-.32)/nz
            mat = key[(i+2*j) % len(key)]
            ball(m, 'flowers', (x, Y+.38, z), .11, mat, 6, 3)


def bush(m, c, r):
    ball(m, 'topiary', c, r, 'foliage', 14, 8)


# ---------------------------------------------------------------- bell lines
def bell_line(m, a, b, sag):
    pts = curve(a, b, sag, 90)
    m.tube('bell line wire', pts, .018, 'iron', 6)
    length = sum(math.dist(p, q) for p, q in zip(pts, pts[1:]))
    cum = [0.0]
    for p, q in zip(pts, pts[1:]):
        cum.append(cum[-1]+math.dist(p, q))
    s = 1.2
    while s < length-1.0:
        i = next(k for k in range(1, len(cum)) if cum[k] >= s)
        t = (s-cum[i-1])/(cum[i]-cum[i-1])
        c = tuple(pts[i-1][k]+(pts[i][k]-pts[i-1][k])*t for k in range(3))
        m.tube('bell hanger', [c, (c[0], c[1]-.16, c[2])], .008, 'iron', 4)
        lathe(m, 'bell', c[0], c[2], c[1]-.38, [(0, .004), (.015, .085), (.04, .095), (.09, .08), (.17, .065), (.21, .045),
                                                 (.23, .015)], 'bronze', 12)
        lathe(m, 'bell clapper', c[0], c[2], c[1]-.44, [(0, .012), (.03, .022), (.07, .008)], 'iron', 6)
        s += 1.5


# ---------------------------------------------------------------- build
m = GateModel('pargo-kaling')
for key, col, metal, rough in [
        ('plaster', (.90, .89, .85), 0, .92), ('plaster_grey', (.74, .73, .70), 0, .9),
        ('stone', (.58, .57, .55), 0, .85), ('granite', (.66, .65, .63), 0, .8), ('stone_red', (.40, .23, .16), 0, .95),
        ('rock', (.40, .36, .31), 0, .95), ('gold', (.70, .52, .24), 1, .38), ('gilt_bronze', (.50, .37, .17), 1, .45), ('wood', (.26, .14, .08), 0, .8),
        ('paint_black', (.03, .03, .03), 0, .85), ('iron', (.16, .16, .17), 1, .55), ('bronze', (.55, .40, .20), 1, .4),
        ('cloth_red', (.62, .06, .05), 0, .9), ('soil', (.24, .17, .11), 0, 1), ('foliage', (.14, .30, .10), 0, .9),
        ('flower_red', (.78, .06, .07), 0, .8), ('flower_yellow', (.92, .70, .08), 0, .8), ('flower_pink', (.86, .36, .52), 0, .8)]:
    m.material(key, col, metal, rough, 'pargo-kaling_'+key)

ROAD_X = [-836, -830, -824, -818, -812, -806, -800, -794, -788, -782, -776]
ROAD_Z = [-7.8, -7.77, -7.69, -7.64, -7.59, -7.5, -7.16, -6.6, -5.61, -4.9, -4.13]   # built spline centre (track.json)
queries = {'road': [[x, z] for x, z in zip(ROAD_X, ROAD_Z)],
           'island': [list(CENTRAL), [-822.0, 1.0], [-822.0, 14.0], [-790.0, 7.5], [-800.0, 1.0], [-800.0, 14.0]],
           'bastion': [[-880.0, 26.4], [-866.0, 26.7], [-853.5, 27.2], [-853.0, 30.0]],
           'west': [[-905.0, 25.8], [-890.0, 26.0], [-906.0, 40.0], [-906.0, 54.0]],
           'wing': [[-897.0, 56.0], [-899.0, 50.5]],
           'crag': [[MARPORI[0]+8*math.cos(a), MARPORI[1]+8*math.sin(a)] for a in [k*math.tau/12 for k in range(12)]]+[list(MARPORI)]}
flat = [p for v in queries.values() for p in v]
g = ground(flat)
ax, az = g['anchor']
datum = g['datum']
hs, k = {}, 0
for key, v in queries.items():
    hs[key] = [h-datum for h in g['heights'][k:k+len(v)]]
    k += len(v)
print('ground above datum', json.dumps({k_: [round(h, 2) for h in v] for k_, v in hs.items()}), 'datum', datum, flush=True)


def L(p):
    return (p[0]-ax, p[1]-az)


def Yx(xl):
    """Island top at anchor-relative x: the road's height there plus a 0.18 m kerb."""
    x = xl+ax
    r = hs['road']
    if x <= ROAD_X[0]:
        return r[0]+.18
    for i in range(1, len(ROAD_X)):
        if x <= ROAD_X[i]:
            t = (x-ROAD_X[i-1])/(ROAD_X[i]-ROAD_X[i-1])
            return r[i-1]+(r[i]-r[i-1])*t+.18
    return r[-1]+.18


cxl, czl = L(CENTRAL)
Y = Yx(cxl)                                   # the chorten's own base level (road at its centre + kerb)
road = Y-.18
island(m, [L(p) for p in ISLAND], Yx)
c_attach, c_top = central(m, cxl, czl, Y, Yx)
# flower strip along both passage faces, topiary each side of the mouths, round beds at the east tip
for e in (-1, 1):
    fx = cxl+e*7.25
    for s in (-1, 1):
        flowers(m, cxl, czl, *sorted((fx-.35, fx+.35)), *sorted((czl+s*1.6, czl+s*6.4)), Yx(fx),
                ['flower_red', 'flower_red', 'flower_yellow'])
        bush(m, (fx, Yx(fx)+.95, czl+s*1.25), .55)
    bush(m, (cxl+e*6.2, Yx(cxl+e*6.2)+.8, czl), .5)
for dz in (-2.3, 2.3):
    c = (cxl+19.5, czl+dz)
    Yb = Yx(c[0])
    lathe(m, 'round flower bed', c[0], c[1], Yb-.3, [(0, 1.8), (.6, 1.8), (.6, 1.6), (.64, 0.02)], 'granite', 24, False)
    for kk in range(48):
        a, r = kk*2.4, 1.45*math.sqrt((kk+.5)/48)
        ball(m, 'flowers', (c[0]+r*math.cos(a), Yb+.7, c[1]+r*math.sin(a)), .13,
             ['flower_red', 'flower_red', 'flower_yellow', 'flower_pink'][kk % 4], 6, 3)
    for kk in range(9):   # spiky ornamental plant in the middle
        a = kk*math.tau/9
        m.tube('bed plant leaf', [(c[0], Yb+.6, c[1]), (c[0]+.3*math.cos(a), Yb+1.2, c[1]+.3*math.sin(a)),
                                  (c[0]+.65*math.cos(a), Yb+1.35, c[1]+.65*math.sin(a))], .04, 'foliage', 5)

# Chakpori bastion and its chorten
bast_ground = max(hs['bastion'])
btop = bast_ground+6.2                      # wall 6.2 m above the pavement at its foot (photo, people for scale)
west_top = max(hs['west'][:2])+3.0
wing_top = btop+3.6
bastion(m, btop, west_top, wing_top, L)
kx, kz = L(CHAKPORI)
k_attach, k_top = small_chorten(m, 'chakpori', kx, kz, btop, (0, -1))
incense_burner(m, kx+3.35, kz-2.0, btop)

# Marpori crag and its chorten (top of the rock ~7.5 m above the road, photo)
mx, mz = L(MARPORI)
crag_top = road+7.5
crag(m, mx, mz, crag_top, min(hs['crag']))
rbox(m, 'marpori plinth', mx-3.2, mx+3.2, crag_top-.6, crag_top+.6, mz-3.2, mz+3.2, 'plaster')
m_attach, m_top = small_chorten(m, 'marpori', mx, mz, crag_top+.6, (0, 1))

# bell lines from the central spire to both side spires
for (attach, (sx, sz)) in [(k_attach, (kx, kz)), (m_attach, (mx, mz))]:
    ya, ra = c_attach[9]
    yb, rb = attach[6]
    d = (sx-cxl, sz-czl)
    L_ = math.hypot(*d)
    u = (d[0]/L_, d[1]/L_)
    a = (cxl+u[0]*ra*.95, ya, czl+u[1]*ra*.95)
    b = (sx-u[0]*rb*.95, yb, sz-u[1]*rb*.95)
    bell_line(m, a, b, 1.6)

info = m.finish(directory=SCRATCH)
print('island top above datum', Y, 'road', road, 'central top', c_top, flush=True)
