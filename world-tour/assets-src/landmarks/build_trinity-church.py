"""Trinity Church (Wall Street), Broadway at the head of Wall Street, Lower Manhattan.

Gothic Revival brownstone parish church by Richard Upjohn (1846), registered from OSM way 278039453.
Redone from reference photographs (Wikimedia Commons, listed in the modelling report) and the NYC
Landmarks Preservation Commission designation report LP-0048 (1966). Where a dimension comes from:
  [OSM]   the registered footprint (tower 13.7 m square with its buttresses, aisles 25.2 m wide);
  [LPC]   LP-0048: tower double-buttressed at each corner, buttresses diminishing as it rises; four
          corner pinnacles with flying buttresses behind them to the octagonal spire; aisle windows
          between buttresses; clerestory piers ending in pinnacles;
  [WIKI]  Wikipedia: spire and cross 281 ft = 86 m; Withers's one-storey rear extension of 1876-77;
          the church is 166 ft (50.6 m) long, which puts Upjohn's altar gable 50.6 m behind the
          tower front (v = -14);
  [PHOTO] heights read off a near-orthographic telephoto of the Broadway front from far down Wall
          Street, scaled by the 13.7 m tower width (belfry lancets 29.8-37.1 m, clock lozenge centre
          24 m, great west window 8-17 m, parapet 41.8 m, corner pinnacles 53.7 m, spire 7.2 m across
          its foot), and bay counts from a c.1912 photograph of the north flank and rear (eight
          clerestory bays, a one-bay chancel as tall as the nave with a huge window and a roundel in
          its gable), and from photographs taken on Trinity Place (4 m rubble retaining wall with a
          railing on top, the open pointed arcade of the north-west loggia, the All Saints' Chapel
          gable between two octagonal turrets).

Author frame: u across (+ = north-north-east, toward Pine St), y up, v along the church axis
(+ = east-south-east, toward Broadway). The tower stands at the Broadway (+v) end; the altar end
faces Trinity Place (-v), which is where the built race route passes, ~6.4 m lower than Broadway.
The model datum is the lowest finished ground under the footprint (Trinity Place pavement).

The churchyards (OSM relation 15080415) are built outside the footprint: iron railing on a stone
curb (on the retaining wall along Trinity Place), headstones following the finished ground,
Hamilton's pyramid tomb and the Gothic Soldiers' Monument; the church footbridge over Trinity Place
(OSM way 112692315) lands on the north-west loggia.
Run: Blender --background --python assets-src/landmarks/build_trinity-church.py
"""
import json
import tempfile
import math
import os
import random
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model, ROOT

ID = 'trinity-church'
SCRATCH = (Path(tempfile.gettempdir()) / 'sr-landmarks' / 'trinity-church')
BOXF = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]

# The finished ground the game builds round the church (the same road/terrain blend as
# sr.terrain._ground_profile, without the per-side roadbed widening), relative to the lowest ground
# under the footprint, which is where the game stands the model. Also the two churchyard outlines
# and the mapped paths through them, in the author frame.
GROUND = r'''
import json, sys
import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import Polygon
from sr.geo import LocalFrame
from sr.dem import DemSampler
from sr.fetch_osm import load_layer
from sr.buildings import element_polygons
from sr.terrain import APRON, BLEND
spec = json.loads(sys.argv[1])
track = json.load(open('game/public/tracks/new-york/track.json'))
TF = LocalFrame(track['origin']['lat'], track['origin']['lon'])
AF = LocalFrame(*spec['centre'])
across, axis = np.array(spec['across']), np.array(spec['axis'])
P = np.asarray(track['spline']['points']); hw = np.asarray(track['spline']['halfWidth'])
tree = cKDTree(P[:, [0, 2]]); dem = DemSampler()
def ground(U, V):
    U = np.asarray(U, float).ravel(); V = np.asarray(V, float).ravel()
    lat, lon = AF.to_latlon(U*across[0] + V*axis[0], U*across[1] + V*axis[1])
    X, Z = TF.to_local(lat, lon)
    d, i = tree.query(np.c_[X, Z])
    t = np.clip((d - (hw[i] + APRON)) / BLEND, 0, 1); t = t*t*(3 - 2*t)
    return P[i, 1]*(1 - t) + np.asarray(dem.heights(lat, lon))*t
ring = np.asarray(spec['ring'] + [spec['ring'][0]])
pts = []
for a, b in zip(ring[:-1], ring[1:]):
    n = max(1, int(np.ceil(np.hypot(*(b - a)) / 8.0)))
    pts += [a + (b - a)*k/n for k in range(n)]
c = Polygon(ring).centroid; pts.append([c.x, c.y]); pts = np.asarray(pts)
base = float(ground(pts[:, 0], pts[:, 1]).min())
u0, v0, nu, nv = -62.0, -46.0, 152, 98
us = u0 + np.arange(nu); vs = v0 + np.arange(nv)
UU, VV = np.meshgrid(us, vs)
h = (ground(UU, VV) - base).reshape(UU.shape)
def uv(poly):
    xy = np.asarray(poly.exterior.coords[:-1]); return np.round(np.c_[xy @ across, xy @ axis], 3).tolist()
yards = []
for e in load_layer('new-york', 'landuse')['elements']:
    if e.get('type') == 'relation' and int(e['id']) == 15080415:
        yards = [uv(p) for p in element_polygons(e, AF)]
paths = []
for e in load_layer('new-york', 'roads')['elements']:
    g = e.get('geometry') or []
    if e.get('tags', {}).get('highway') not in ('footway', 'path', 'pedestrian') or len(g) < 2: continue
    x, z = AF.to_local([p['lat'] for p in g], [p['lon'] for p in g]); xy = np.c_[x, z]
    U, V = xy @ across, xy @ axis
    if ((U > -52) & (U < 84) & (V > -36) & (V < 44)).any():
        paths.append(np.round(np.c_[U, V], 3).tolist())
lat, lon = TF.to_latlon(P[:, 0], P[:, 2]); x, z = AF.to_local(lat, lon)
RU, RV = x*across[0] + z*across[1], x*axis[0] + z*axis[1]
sel = np.hypot(RU, RV) < 160
route = np.round(np.c_[RU[sel], P[sel, 1] - base, RV[sel]], 2).tolist()
print(json.dumps(dict(base=base, u0=u0, v0=v0, nu=nu, nv=nv, h=np.round(h, 3).ravel().tolist(), yards=yards, paths=paths, route=route)))
'''

m = Model(ID)
env = json.loads(subprocess.check_output(
    [str(ROOT/'pipeline/.venv/bin/python'), '-c', GROUND,
     json.dumps(dict(centre=m.spec['centre'], across=m.spec['across'], axis=m.spec['axis'], ring=m.spec['ring']))],
    cwd=ROOT, env={**os.environ, 'PYTHONPATH': str(ROOT/'pipeline')}, text=True))
GH, GU0, GV0, GNU, GNV = env['h'], env['u0'], env['v0'], env['nu'], env['nv']
SCRATCH.mkdir(parents=True, exist_ok=True)
(SCRATCH/'ground.json').write_text(json.dumps(env))   # for the route-view preview renders


def G(u, v):
    """Finished ground height (m above the model datum) at an author-frame point, bilinear."""
    fu = min(max(u - GU0, 0), GNU - 1.001); fv = min(max(v - GV0, 0), GNV - 1.001)
    i, j = int(fu), int(fv); a, b = fu - i, fv - j
    h00, h10 = GH[j*GNU+i], GH[j*GNU+i+1]
    h01, h11 = GH[(j+1)*GNU+i], GH[(j+1)*GNU+i+1]
    return (h00*(1-a) + h10*a)*(1-b) + (h01*(1-a) + h11*a)*b




F = round(G(1.9, 39.0), 2)          # Broadway pavement in front of the tower
FL = F + 0.75                       # church floor, four steps up
W_TER = 4.6                         # top of the Trinity Place retaining wall / north-west loggia floor [PHOTO]
print('GROUND base %.2f  front F %.2f' % (env['base'], F))

m.material('stone', (0.34, 0.21, 0.17), 0, .86, ID+'_stone')          # brownstone ashlar
m.material('carved', (0.41, 0.27, 0.21), 0, .8, ID+'_carved')         # tracery, crockets, finials
m.material('rubble', (0.26, 0.18, 0.15), 0, .95, ID+'_stone_rubble')  # Trinity Place retaining wall
m.material('roof', (0.33, 0.34, 0.34), .45, .55, ID+'_metal_roof')    # standing-seam metal roofs
m.material('glass', (0.05, 0.06, 0.085), .2, .14, ID+'_glass')        # leaded stained glass
m.material('shadow', (0.018, 0.017, 0.016), 0, 1, ID+'_shadow')       # dark belfry / loggia interior
m.material('bronze', (0.27, 0.18, 0.09), 1, .45, ID+'_bronze')        # the bronze doors
m.material('gold', (0.83, 0.62, 0.25), 1, .3, ID+'_gold')             # cross, clock hands
m.material('iron', (0.03, 0.03, 0.035), .7, .5, ID+'_iron')           # churchyard railing
m.material('steel', (0.10, 0.11, 0.11), .7, .45, ID+'_steel')         # footbridge
m.material('dial', (0.035, 0.035, 0.04), .3, .45, ID+'_clock_dial')    # black dial, gilt numerals [PHOTO 2024]
m.material('granite', (0.21, 0.20, 0.19), 0, .9, ID+'_granite')      # dark slate/brownstone headstones
m.material('marble', (0.66, 0.65, 0.61), 0, .7, ID+'_marble')
dial = m.materials['dial'].node_tree.nodes['Principled BSDF']
dial.inputs['Emission Color'].default_value = (1.0, .82, .5, 1)
dial.inputs['Emission Strength'].default_value = 0.0

# ------------------------------------------------------------------ primitives
class Face:
    """A vertical wall plane: s runs along the wall (absolute u or v), d outward from the plane."""
    def __init__(self, side, c):
        self.side, self.c = side, c
        self.n = {'N': (1, 0), 'S': (-1, 0), 'E': (0, 1), 'W': (0, -1)}[side]

    def P(self, s, y, d):
        if self.side in 'NS':
            return (self.c + self.n[0]*d, y, s)
        return (s, y, self.c + self.n[1]*d)

    def off(self, dd):
        return (self.n[0]*dd, 0, self.n[1]*dd)

    def along(self, ds):
        return (0, 0, ds) if self.side in 'NS' else (ds, 0, 0)


def spear(u, v, y0, h, ang, r=0.018):
    """One railing bar with its spear point as a single 14-triangle solid."""
    ca, sa = math.cos(ang+math.pi/4), math.sin(ang+math.pi/4)
    ring = [(u+r*1.414*math.cos(ang+math.pi/4+k*math.pi/2), v+r*1.414*math.sin(ang+math.pi/4+k*math.pi/2)) for k in range(4)]
    verts = [(a, y0, b) for a, b in ring]+[(a, y0+h-0.12, b) for a, b in ring]+[(u, y0+h+0.05, v)]
    faces = [(3, 2, 1, 0)]+[(k, (k+1) % 4, 4+(k+1) % 4, 4+k) for k in range(4)]+[(4+k, 4+(k+1) % 4, 8) for k in range(4)]
    m.mesh('spear', verts, faces, 'iron')


def dedupe(pts):
    out = []
    for p in pts:
        if not out or abs(p[0]-out[-1][0]) > 1e-4 or abs(p[1]-out[-1][1]) > 1e-4:
            out.append(p)
    while len(out) > 1 and abs(out[0][0]-out[-1][0]) < 1e-4 and abs(out[0][1]-out[-1][1]) < 1e-4:
        out.pop()
    return out


def area(pts):
    return sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(pts, pts[1:]+pts[:1]))/2


def prism(face, outline, d0, d1, mat):
    pts = dedupe(outline)
    if len(pts) < 3 or abs(area(pts)) < 1e-4:
        return
    m.shell('prism', [face.P(s, y, d0) for s, y in pts], face.off(d1-d0), mat)


def side_prism(face, profile, s0, s1, mat):
    pts = dedupe(profile)
    m.shell('side', [face.P(s0, y, d) for d, y in pts], face.along(s1-s0), mat)


def fbox(face, s0, s1, y0, y1, d0, d1, mat):
    prism(face, [(s0, y0), (s1, y0), (s1, y1), (s0, y1)], d0, d1, mat)


def box(u0, u1, y0, y1, v0, v1, mat):
    m.box('box', ((u0+u1)/2, (y0+y1)/2, (v0+v1)/2), (u1-u0, y1-y0, v1-v0), mat)


def rbox(c, yaw, size, mat):
    """Box turned by yaw in plan: size = (along yaw, up, across)."""
    cu, cy, cv = c; sx, sy, sz = size
    ca, sa = math.cos(yaw), math.sin(yaw)
    verts = []
    for dy in (-sy/2, sy/2):
        for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append((cu+ca*a*sx/2-sa*b*sz/2, cy+dy, cv+sa*a*sx/2+ca*b*sz/2))
    m.mesh('rbox', verts, BOXF, mat)


def lathe(cu, cv, y0, profile, mat, sides=8, phase=0.0, smooth=False):
    verts = []
    for dy, r in profile:
        verts += [(cu+r*math.cos(phase+k*math.tau/sides), y0+dy, cv+r*math.sin(phase+k*math.tau/sides))
                  for k in range(sides)]
    n = len(profile)
    faces = [tuple(reversed(range(sides))), tuple((n-1)*sides+k for k in range(sides))]
    for i in range(n-1):
        a, b = i*sides, (i+1)*sides
        faces += [(a+k, a+(k+1) % sides, b+(k+1) % sides, b+k) for k in range(sides)]
    m.mesh('lathe', verts, faces, mat, smooth)


def slab(p0, p1, width, y0a, y1a, y0b, y1b, mat):
    """A wall piece along p0->p1 in plan whose bottom and top can slope with the ground."""
    du, dv = p1[0]-p0[0], p1[1]-p0[1]; L = math.hypot(du, dv)
    nu, nv = -dv/L*width/2, du/L*width/2
    verts = [(p0[0]+nu, y0a, p0[1]+nv), (p1[0]+nu, y0b, p1[1]+nv), (p1[0]-nu, y0b, p1[1]-nv), (p0[0]-nu, y0a, p0[1]-nv),
             (p0[0]+nu, y1a, p0[1]+nv), (p1[0]+nu, y1b, p1[1]+nv), (p1[0]-nu, y1b, p1[1]-nv), (p0[0]-nu, y1a, p0[1]-nv)]
    m.mesh('slab', verts, BOXF, mat)


def tube_face(face, pts, d, r, mat, sides=6):
    m.tube('tube', [face.P(s, y, d) for s, y in pts], r, mat, sides)


def ring_face(face, sc, yc, r, d, rt, mat, n=18):
    pts = [(sc+r*math.cos(k*math.tau/n), yc+r*math.sin(k*math.tau/n)) for k in range(n+1)]
    tube_face(face, pts, d, rt, mat, 6)


# ------------------------------------------------------------------ openings
def arch_pts(sl, sr, spring, k=1.0, n=7):
    """Two-centred pointed arch from the left springer to the right one; k=1 is equilateral."""
    w = sr-sl; h = w/2; sc = (sl+sr)/2; R = k*w
    cx = sl+R
    rise = math.sqrt(R*R-(R-h)**2)
    a1 = math.atan2(rise, sc-cx)
    left = [(cx+R*math.cos(math.pi+(a1-math.pi)*i/n), spring+R*math.sin(math.pi+(a1-math.pi)*i/n)) for i in range(n+1)]
    left[-1] = (sc, spring+rise)
    return left+[(2*sc-s, y) for s, y in reversed(left[:-1])], spring+rise


def arch_hole(sl, sr, sill, spring, k=1.0, n=7):
    top, apex = arch_pts(sl, sr, spring, k, n)
    return dict(kind='arch', sl=sl, sr=sr, sill=sill, spring=spring, apex=apex, k=k,
                bottom=[(sl, sill), (sr, sill)], top=top)


def rect_hole(sl, sr, sill, head):
    return dict(kind='rect', sl=sl, sr=sr, sill=sill, spring=head, apex=head, k=None,
                bottom=[(sl, sill), (sr, sill)], top=[(sl, head), (sr, head)])


def circle_hole(sc, yc, r, n=20):
    bot = [(sc+r*math.cos(math.pi+math.pi*i/(n//2)), yc+r*math.sin(math.pi+math.pi*i/(n//2))) for i in range(n//2+1)]
    top = [(sc+r*math.cos(math.pi-math.pi*i/(n//2)), yc+r*math.sin(math.pi-math.pi*i/(n//2))) for i in range(n//2+1)]
    bot[0], bot[-1], top[0], top[-1] = (sc-r, yc), (sc+r, yc), (sc-r, yc), (sc+r, yc)
    return dict(kind='circle', sl=sc-r, sr=sc+r, sc=sc, yc=yc, r=r, sill=yc-r, spring=yc, apex=yc+r, k=None,
                bottom=bot, top=top)


def ytop(top, s):
    if not isinstance(top, list):
        return top
    for (sa, ya), (sb, yb) in zip(top, top[1:]):
        if sa-1e-6 <= s <= sb+1e-6:
            return ya+(yb-ya)*(s-sa)/(sb-sa)
    return top[0][1] if s < top[0][0] else top[-1][1]


def top_path(top, a, b):
    if not isinstance(top, list):
        return [(b, top), (a, top)]
    return [(b, ytop(top, b))]+[(s, y) for s, y in reversed(top) if a+1e-4 < s < b-1e-4]+[(a, ytop(top, a))]


def wall_face(face, s0, s1, y0, top, holes, th, mat='stone', d1=0.0):
    """A wall slab with real openings: piers, and for each column of stacked openings the solid
    pieces below, between, beside and above them. top is a height or a gable polyline [(s, y)]."""
    d0 = d1-th
    cols = []
    for h in sorted(holes, key=lambda h: h['sl']):
        if cols and h['sl'] < cols[-1]['cr']-1e-6:
            c = cols[-1]; c['hs'].append(h); c['cl'] = min(c['cl'], h['sl']); c['cr'] = max(c['cr'], h['sr'])
        else:
            cols.append(dict(cl=h['sl'], cr=h['sr'], hs=[h]))
    polys = []
    cur = s0
    for c in cols:
        cl, cr = c['cl'], c['cr']
        if cl-cur > 1e-3:
            polys.append([(cur, y0), (cl, y0)]+top_path(top, cur, cl))
        st = sorted(c['hs'], key=lambda h: h['bottom'][0][1])
        yb = st[0]['bottom'][0][1]
        if yb-y0 > 1e-3:
            polys.append([(cl, y0), (cr, y0), (cr, yb)]+list(reversed(st[0]['bottom']))+[(cl, yb)])
        for h in st:
            ybs, yts = h['bottom'][0][1], h['top'][0][1]
            if yts-ybs > 1e-3:
                if h['sl']-cl > 1e-3:
                    polys.append([(cl, ybs), (h['sl'], ybs), (h['sl'], yts), (cl, yts)])
                if cr-h['sr'] > 1e-3:
                    polys.append([(h['sr'], ybs), (cr, ybs), (cr, yts), (h['sr'], yts)])
        for a, b in zip(st, st[1:]):
            ya, yb2 = a['top'][0][1], b['bottom'][0][1]
            polys.append([(cl, ya)]+a['top']+[(cr, ya), (cr, yb2)]+list(reversed(b['bottom']))+[(cl, yb2)])
        a = st[-1]; ya = a['top'][0][1]
        polys.append([(cl, ya)]+a['top']+[(cr, ya)]+top_path(top, cl, cr))
        cur = cr
    if s1-cur > 1e-3:
        polys.append([(cur, y0), (s1, y0)]+top_path(top, cur, s1))
    for p in polys:
        prism(face, p, d0, d1, mat)


def dress(face, h, th, lights=2, hood=True, sill=True, d1=0.0, glass_at=.55, pane='glass'):
    """Glass set back in the reveal, mullions and head tracery in front of it, sill and hood mould."""
    sl, sr = h['sl'], h['sr']; w = sr-sl
    gd = d1-th*glass_at
    prism(face, h['bottom']+list(reversed(h['top'])), gd-0.05, gd, pane)
    if h['kind'] == 'arch' and lights > 1:
        lw = w/lights
        for i in range(1, lights):
            s = sl+lw*i
            fbox(face, s-0.075, s+0.075, h['sill'], h['spring']+0.05, gd, gd+0.2, 'carved')
        for i in range(lights):
            pts, _ = arch_pts(sl+lw*i, sl+lw*(i+1), h['spring'], 1.0, 5)
            tube_face(face, pts, gd+0.1, 0.06, 'carved')
        gap = h['apex']-(h['spring']+0.866*lw)
        if gap > 0.5:
            r = min(gap*0.36, w*0.22)
            ring_face(face, (sl+sr)/2, h['spring']+0.866*lw+gap*0.47, r, gd+0.1, 0.055, 'carved')
            if lights >= 4:
                for sgn in (-1, 1):
                    ring_face(face, (sl+sr)/2+sgn*w*0.25, h['spring']+0.866*lw+gap*0.2, r*0.55, gd+0.1, 0.045, 'carved')
    elif h['kind'] == 'circle':
        ring_face(face, h['sc'], h['yc'], h['r']*0.5, gd+0.1, 0.06, 'carved')
        for k in range(6):
            a = k*math.pi/3
            tube_face(face, [(h['sc']+h['r']*0.5*math.cos(a), h['yc']+h['r']*0.5*math.sin(a)),
                             (h['sc']+h['r']*0.98*math.cos(a), h['yc']+h['r']*0.98*math.sin(a))], gd+0.1, 0.05, 'carved')
        ring_face(face, h['sc'], h['yc'], h['r']+0.2, d1+0.06, 0.1, 'stone')
    if sill and h['kind'] != 'circle':
        fbox(face, sl-0.12, sr+0.12, h['sill']-0.16, h['sill'], d1-0.02, d1+0.14, 'stone')
    if hood and h['kind'] == 'arch':
        pts, _ = arch_pts(sl-0.18, sr+0.18, h['spring'], h['k'], 8)
        tube_face(face, [(sl-0.5, h['spring'])]+pts+[(sr+0.5, h['spring'])], d1+0.07, 0.09, 'stone')


def door(face, h, th, d1=0.0, orders=3):
    """Deep Gothic doorway: bronze leaves at the back, stepped orders of shafts and rolls in the reveal."""
    sl, sr = h['sl'], h['sr']
    prism(face, h['bottom']+list(reversed(h['top'])), d1-th, d1-th+0.18, 'bronze')
    fbox(face, (sl+sr)/2-0.04, (sl+sr)/2+0.04, h['sill'], h['spring']+0.4, d1-th+0.18, d1-th+0.24, 'bronze')
    for i in range(orders):
        inset = 0.16+0.22*i
        dd = d1-0.25-(th-0.5)*i/max(1, orders-1) if orders > 1 else d1-th/2
        for s in (sl+inset, sr-inset):
            m.tube('shaft', [face.P(s, h['sill'], dd), face.P(s, h['spring'], dd)], 0.11, 'carved', 8)
        pts, _ = arch_pts(sl+inset, sr-inset, h['spring'], h['k'], 8)
        tube_face(face, pts, dd, 0.12, 'carved', 6)
    pts, _ = arch_pts(sl-0.25, sr+0.25, h['spring'], h['k'], 9)
    tube_face(face, [(sl-0.6, h['spring'])]+pts+[(sr+0.6, h['spring'])], d1+0.08, 0.11, 'stone')


def buttress(face, sc, bw, y0, stages, d1=0.0, cap=1.2, mat='stone'):
    """Stepped buttress with sloped weatherings; stages = [(top y, projection)]. Returns the top."""
    prof = [(d1, y0)]; y = y0; prev = None
    for yt, p in stages:
        prof.append((d1+p, y if prev is None else y+(prev-p)))
        prof.append((d1+p, yt)); y = yt; prev = p
    prof.append((d1, y+prev*cap))
    side_prism(face, prof, sc-bw/2, sc+bw/2, mat)
    return y


def pinnacle(cu, cv, y0, size, shaft, spire, crockets=3, mat='stone'):
    m.box('pinnacle', (cu, y0+shaft/2, cv), (size, shaft, size), mat)
    cap = 0.12*size+0.04
    m.box('pinnacle cap', (cu, y0+shaft+cap/2, cv), (size*1.18, cap, size*1.18), 'carved')
    yb = y0+shaft+cap
    r0 = size/2*1.414*0.98
    lathe(cu, cv, yb, [(0, r0), (spire, 0.02)], 'carved', 4, math.pi/4)
    for k in range(4):
        a = math.pi/4+k*math.pi/2
        for j in range(crockets):
            t = (j+1)/(crockets+1)
            rr = r0*(1-t)+0.04*size
            rbox((cu+rr*math.cos(a), yb+t*spire, cv+rr*math.sin(a)), a, (0.3*size, 0.2*size, 0.2*size), 'carved')
    lathe(cu, cv, yb+spire-0.04, [(0, 0.03), (0.07*size+0.04, 0.09*size+0.04), (0.2*size+0.1, 0.02)], 'carved', 6)


def gable_coping(face, s0, s1, ye, yr, d0, d1, cross=True):
    sc = (s0+s1)/2
    prism(face, [(s0-0.2, ye-0.15), (s0-0.2, ye+0.3), (sc, yr+0.35), (s1+0.2, ye+0.3), (s1+0.2, ye-0.15), (sc, yr-0.15)], d0, d1, 'carved')
    if cross:
        c = face.P(sc, yr+0.3, (d0+d1)/2)
        m.box('gable cross', (c[0], c[1]+0.8, c[2]), (0.22, 1.6, 0.22), 'carved')
        a = face.P(sc-0.45, yr+1.15, (d0+d1)/2); b = face.P(sc+0.45, yr+1.15, (d0+d1)/2)
        m.box('gable cross arm', ((a[0]+b[0])/2, a[1], (a[2]+b[2])/2),
              (abs(a[0]-b[0])+0.22, 0.22, abs(a[2]-b[2])+0.22), 'carved')


def parapet_top(face, s0, s1, y, d0, d1, crenel=False):
    """Coping on a parapet, and a corbelled string course under it on the outer face."""
    fbox(face, s0, s1, y, y+0.18, d0-0.1, d1+0.1, 'carved')
    fbox(face, s0, s1, y-1.3, y-1.1, d1, d1+0.16, 'stone')
    n = max(2, int((s1-s0)/0.9))
    for i in range(n):
        s = s0+(s1-s0)*(i+0.5)/n
        fbox(face, s-0.12, s+0.12, y-1.45, y-1.3, d1, d1+0.13, 'stone')
    if crenel:
        n = max(2, int((s1-s0)/1.4))
        for i in range(n):
            s = s0+(s1-s0)*(i+0.5)/n
            fbox(face, s-0.35, s+0.35, y+0.18, y+0.75, d0, d1, 'stone')
            fbox(face, s-0.4, s+0.4, y+0.75, y+0.85, d0-0.05, d1+0.05, 'carved')




class LFace:
    """A vertical plane at any heading a (outward normal (cos a, sin a) in u, v) at distance dist from
    (cu, cv); s runs along the plane from the foot of that perpendicular, d outward from the plane."""
    def __init__(self, a, cu, cv, dist):
        self.n = (math.cos(a), math.sin(a)); self.t = (-math.sin(a), math.cos(a))
        self.cu, self.cv, self.dist, self.side = cu, cv, dist, 'L'

    def P(self, s, y, d):
        k = self.dist+d
        return (self.cu+self.t[0]*s+self.n[0]*k, y, self.cv+self.t[1]*s+self.n[1]*k)

    def off(self, dd):
        return (self.n[0]*dd, 0, self.n[1]*dd)

    def along(self, ds):
        return (self.t[0]*ds, 0, self.t[1]*ds)


def ribbon(path, tops, bots, width, mat):
    """A closed strip of wall along a plan path whose top and bottom heights vary point by point."""
    n = len(path); verts = []
    for i, (p, yt, yb) in enumerate(zip(path, tops, bots)):
        a, b = path[max(i-1, 0)], path[min(i+1, n-1)]
        du, dv = b[0]-a[0], b[1]-a[1]; L = math.hypot(du, dv) or 1
        nu, nv = -dv/L*width/2, du/L*width/2
        verts += [(p[0]+nu, yb, p[1]+nv), (p[0]-nu, yb, p[1]-nv), (p[0]-nu, yt, p[1]-nv), (p[0]+nu, yt, p[1]+nv)]
    faces = [(0, 1, 2, 3), tuple(4*(n-1)+k for k in (3, 2, 1, 0))]
    for i in range(n-1):
        a, b = 4*i, 4*(i+1)
        faces += [(a+k, b+k, b+(k+1) % 4, a+(k+1) % 4) for k in range(4)]
    m.mesh('ribbon', verts, faces, mat)


def leaf(p, yaw, s, mat='carved'):
    """One crocket: a small leaf block turned outward."""
    rbox(p, yaw, (0.55*s, 0.4*s, 0.45*s), mat)


def crocket_line(a, b, step, s, yaw, mat='carved'):
    """Crockets along a sloping edge from a to b (author-frame points), plus nothing at the ends."""
    L = math.dist(a, b); n = max(1, int(L/step))
    for i in range(1, n):
        t = i/n
        leaf(tuple(a[k]+(b[k]-a[k])*t for k in range(3)), yaw, s, mat)


def finial(cu, cv, y, s, mat='carved'):
    lathe(cu, cv, y, [(0, 0.05*s), (0.25*s, 0.3*s), (0.55*s, 0.34*s), (0.8*s, 0.12*s), (1.3*s, 0.02)], mat, 6)


def turret(cu, cv, y0, r, shaft_top, cap_top, lancet=False, gablets=True, crockets=True):
    """Octagonal turret-pinnacle: panelled shaft, a ring of gablets, crocketed spirelet, finial.
    r is the corner radius; the flats face the axes."""
    rf = r*math.cos(math.pi/8)
    lathe(cu, cv, y0, [(0, r), (shaft_top-y0, r)], 'stone', 8, math.pi/8)
    lathe(cu, cv, shaft_top-0.1, [(0, r+0.1), (0.35, r+0.1)], 'carved', 8, math.pi/8)
    side = 2*rf*math.tan(math.pi/8)
    for k in range(8):
        a = k*math.pi/4
        face = LFace(a, cu, cv, rf)
        ph = min(3.0, (shaft_top-y0)*0.45)
        pts, _ = arch_pts(-side*0.3, side*0.3, shaft_top-0.5-side*0.3, 1.0, 4)
        tube_face(face, [(-side*0.3, shaft_top-0.5-ph)]+pts+[(side*0.3, shaft_top-0.5-ph)], 0.02, 0.035, 'carved', 4)
        if lancet and k % 2 == 0:
            prism(face, [(-side*0.18, shaft_top-0.6-ph*0.8), (side*0.18, shaft_top-0.6-ph*0.8), (side*0.18, shaft_top-0.9),
                         (0, shaft_top-0.65), (-side*0.18, shaft_top-0.9)], -0.02, 0.01, 'shadow')
        if gablets:
            yb = shaft_top+0.25
            prism(face, [(-side/2, yb), (side/2, yb), (0, yb+side*0.9)], -0.25, 0.05, 'carved')
    yb = shaft_top+0.25
    H = cap_top-yb-0.4*r
    lathe(cu, cv, yb, [(0, rf*0.95/math.cos(math.pi/8)), (H, 0.03)], 'stone', 8, math.pi/8)
    if crockets:
        for k in range(8):
            a = math.pi/8+k*math.pi/4
            n = max(2, int(H/0.7))
            for j in range(1, n):
                t = j/n; rr = r*0.95*(1-t)+0.06
                leaf((cu+rr*math.cos(a), yb+t*H, cv+rr*math.sin(a)), a, 0.28+0.25*r*(1-t))
    finial(cu, cv, yb+H-0.05, 0.4*r+0.25)


def gable_hood(face, sl, sr, spring, apex, d, crock=0.3, fin=0.5, rad=0.08):
    """Crocketed straight-sided gable over an arch: two coping rolls, crockets, finial."""
    sc = (sl+sr)/2
    tube_face(face, [(sl, spring), (sc, apex), (sr, spring)], d, rad, 'carved', 6)
    for a, b in (((sl, spring), (sc, apex)), ((sr, spring), (sc, apex))):
        pa, pb = face.P(a[0], a[1], d+0.05), face.P(b[0], b[1], d+0.05)
        n = max(1, int(math.dist(pa, pb)/0.6))
        for i in range(1, n):
            t = i/n
            p = tuple(pa[k]+(pb[k]-pa[k])*t for k in range(3))
            leaf((p[0], p[1]+0.12, p[2]), 0, crock)
    c = face.P(sc, apex, d)
    finial(c[0], c[2], c[1], fin)


# ------------------------------------------------------------------ the church
TU, TV, C = 1.9, 29.8, 5.4           # tower centre and half core [OSM: 13.7 m with buttresses]
NU = 1.85                            # nave axis
CL_S, CL_N = NU-6.6, NU+6.6          # clerestory / chancel outer faces
AI_S, AI_N = -10.73, 14.45           # aisle outer faces [OSM]
NAVE_E, BAY, NB = 22.9, 4.0, 8       # eight clerestory bays from the tower [PHOTO c.1912]
NAVE_W = NAVE_E-NB*BAY               # -9.1: chancel arch
CH_W = -14.0                         # altar gable, 50.6 m behind the tower front [WIKI]
EXT_W = -23.4                        # Withers's 1877 one-storey extension [OSM, WIKI]
AISLE_TOP, CLER_TOP = F+10.6, F+19.2
RIDGE = CLER_TOP+5.9*1.35            # steep standing-seam roof [PHOTO]
LOW_TOP = F+6.0                      # extension / sacristies / chapel eaves [PHOTO Trinity Place]


def street_v(u):
    """The Trinity Place property line (the OSM yard edges either side of the church)."""
    return -28.1-0.077*(u+23.5)


def seams(u0, y0, u1, y1, v0, v1, step=0.6):
    """Standing seams on a roof slope running across the ridge (in u), repeated along v."""
    n = int((v1-v0)/step)
    for i in range(1, n):
        v = v0+(v1-v0)*i/n
        slab((u0, v), (u1, v), 0.05, y0, y0+0.07, y1, y1+0.07, 'roof')


def plinths():
    blocks = [(-4.96, 8.7, 22.9, 36.68), (AI_S, AI_N, NAVE_W, NAVE_E), (-13.04, AI_N, EXT_W, NAVE_W),
              (-13.04, AI_S, NAVE_W, 0.45), (AI_N, 20.15, -23.6, 1.4), (-23.54, -13.04, -25.5, 0.42),
              (-17.12, AI_S, 15.21, 23.32), (AI_N, 19.95, 16.11, 22.98)]
    for u0, u1, v0, v1 in blocks:
        box(u0-0.25, u1+0.25, 0, FL-0.35, v0-0.25, v1+0.25, 'stone')
        box(u0-0.38, u1+0.38, FL-0.35, FL-0.12, v0-0.38, v1+0.38, 'carved')   # water table
        box(u0-0.2, u1+0.2, FL-0.12, FL, v0-0.2, v1+0.2, 'stone')
    # Basement storey above the Trinity Place terrace and where the yards fall away: windows set in a
    # skin standing proud of the plinth, so each opening has 0.45 m of real depth.
    for face, s0, s1 in [(Face('W', EXT_W-0.25), -13.29, 7.98), (Face('W', -25.5-0.25), -23.79, -12.79),
                         (Face('S', -23.54-0.25), -25.75, 0.67), (Face('N', 20.15+0.25), -23.85, 1.65)]:
        def g(s):
            p = face.P(s, 0, 0.3)
            return max(G(p[0], p[2]), W_TER if p[2] < street_v(p[0])+8.5 and p[0] < 7.7 else 0)
        gmin = min(g(s0+(s1-s0)*i/20) for i in range(21))
        y0 = max(0.0, gmin-0.4); topy = FL-0.35
        if topy-y0 < 0.3:
            continue
        holes = []
        n = int((s1-s0)/3.4)
        for i in range(n):
            sc = s0+(s1-s0)*(i+0.5)/n
            gl = max(g(sc-0.8), g(sc+0.8), g(sc))
            head = topy-0.5
            sill = max(gl+0.6, head-2.3)
            if head-sill >= 0.9:
                holes.append(rect_hole(sc-0.55, sc+0.55, sill, head))
        wall_face(face, s0, s1, y0, topy, holes, 0.45, d1=0.45)
        for h in holes:
            prism(face, h['bottom']+list(reversed(h['top'])), 0.02, 0.06, 'glass')
            fbox(face, h['sl']-0.18, h['sr']+0.18, h['apex'], h['apex']+0.3, 0.4, 0.6, 'stone')
            fbox(face, (h['sl']+h['sr'])/2-0.05, (h['sl']+h['sr'])/2+0.05, h['sill'], h['apex'], 0.06, 0.2, 'iron')


def clock(face, sc, yc):
    """The black, gilt-figured dial in a lozenge (square set on its point) frame [PHOTO]."""
    hw, hh = 2.4, 2.9
    outer = [(sc, yc-hh), (sc+hw, yc), (sc, yc+hh), (sc-hw, yc)]
    inner = [(sc+(s-sc)*0.8, yc+(y-yc)*0.8) for s, y in outer]
    for i in range(4):
        a, b = outer[i], outer[(i+1) % 4]; ai, bi = inner[i], inner[(i+1) % 4]
        prism(face, [a, b, bi, ai], 0, 0.32, 'carved')
    prism(face, inner, 0, 0.06, 'stone')
    for sgn in (-1, 1):    # tracery cusps filling the lozenge's side points
        ring_face(face, sc+sgn*1.55, yc, 0.28, 0.08, 0.05, 'carved', 10)
        ring_face(face, sc, yc+sgn*1.95, 0.3, 0.08, 0.05, 'carved', 10)
    m.tube('clock dial', [face.P(sc, yc, 0.05), face.P(sc, yc, 0.18)], 1.45, 'dial', 36)
    ring_face(face, sc, yc, 1.47, 0.2, 0.07, 'gold', 36)
    for k in range(12):
        a = k*math.pi/6
        c = face.P(sc+1.22*math.cos(a), yc+1.22*math.sin(a), 0.21)
        m.box('hour mark', c, (0.12, 0.3, 0.1) if k % 3 else (0.3, 0.3, 0.1), 'gold')
    for ang, L, wdt in ((math.radians(90-300-4), 0.85, 0.16), (math.radians(90-48), 1.3, 0.1)):
        ca, sa = math.cos(ang), math.sin(ang)
        prism(face, [(sc-sa*wdt/2-ca*0.2, yc+ca*wdt/2-sa*0.2), (sc+sa*wdt/2-ca*0.2, yc-ca*wdt/2-sa*0.2),
                     (sc+ca*L, yc+sa*L)], 0.2, 0.25, 'gold')


def tower():
    th = 1.2
    y0 = FL-0.2
    top = F+40.6                        # deck behind the parapet; parapet top F+42.2 [PHOTO 41.8]
    faces = {'E': (Face('E', TV+C), TU-C, TU+C, 2.2), 'W': (Face('W', TV-C), TU-C, TU+C, th),
             'N': (Face('N', TU+C), TV-C+th, TV+C-2.2, th), 'S': (Face('S', TU-C), TV-C+th, TV+C-2.2, th)}
    for key, (face, s0, s1, t) in faces.items():
        sc = TU if key in 'EW' else TV
        holes = []
        bel = [arch_hole(sc+o-1.05, sc+o+1.05, F+29.8, F+35.3, 1.0) for o in (-1.6, 1.6)]   # [PHOTO 29.8-37.1]
        holes += bel
        if key == 'E':
            portal = arch_hole(sc-2.0, sc+2.0, FL, F+3.9, 0.8, 9)
            big = arch_hole(sc-2.1, sc+2.1, F+9.6, F+13.8, 1.0, 9)                         # [PHOTO 9-17.5]
            holes += [portal, big]
        elif key in 'NS':
            low = arch_hole(sc-0.8, sc+0.8, F+4.5, F+8.0, 1.0)
            mid = arch_hole(sc-1.2, sc+1.2, F+11.2, F+15.0, 1.0)
            holes += [low, mid]
        wall_face(face, s0, s1, y0, top, holes, t)
        ext0 = s0-(t if key in 'NS' else 0); ext1 = s1+(2.2 if key in 'NS' else 0)
        # belfry: two tall lancets, each of two louvred lights under its own crocketed gable [PHOTO]
        for b in bel:
            dress(face, b, t, lights=2, glass_at=0.95, pane='shadow', hood=False)
            bc = (b['sl']+b['sr'])/2
            for j in range(16):
                y = b['sill']+0.25+j*0.4
                if y > b['spring']+0.4:
                    break
                side_prism(face, [(-0.3, y), (-0.3, y+0.06), (-0.85, y-0.3), (-0.85, y-0.36)], b['sl'], b['sr'], 'stone')
            pts, _ = arch_pts(b['sl']-0.15, b['sr']+0.15, b['spring'], 1.0, 8)
            tube_face(face, pts, 0.08, 0.1, 'carved')
            gable_hood(face, b['sl']-0.35, b['sr']+0.35, b['spring']+0.3, F+39.3, 0.2, 0.3, 0.55)
        fbox(face, sc-0.3, sc+0.3, F+29.6, F+39.0, 0, 0.35, 'stone')     # central pier between the lancets
        c = face.P(sc, 0, 0.18)
        pinnacle(c[0], c[2], F+36.8, 0.45, 1.3, 1.6, 2, 'carved')
        if key == 'E':
            door(face, portal, t, orders=4)
            prism(face, [(portal['sl']+0.7, portal['spring'])]+[(s, y) for s, y in portal['top'] if portal['sl']+0.7 < s < portal['sr']-0.7]
                  + [(portal['sr']-0.7, portal['spring'])], -t+0.3, -t+0.5, 'carved')   # sculpted tympanum
            fbox(face, portal['sl']-0.5, portal['sr']+0.5, FL-0.02, FL+0.02, -t, 0, 'stone')
            # projecting frontispiece: openwork parapet over the portal, a central gablet, pinnacles [PHOTO]
            fbox(face, sc-3.5, sc+3.5, F+7.6, F+8.0, 0, 0.9, 'carved')
            fbox(face, sc-3.5, sc+3.5, F+8.9, F+9.15, 0, 0.9, 'carved')
            for i in range(10):
                s = sc-3.5+7.0*(i+0.5)/10
                fbox(face, s-0.07, s+0.07, F+8.0, F+8.9, 0.55, 0.75, 'carved')
                ring_face(face, s, F+8.5, 0.22, 0.65, 0.04, 'carved', 8)
            fbox(face, sc-3.5, sc+3.5, F+8.0, F+8.9, 0.1, 0.2, 'stone')
            prism(face, [(sc-1.1, F+9.15), (sc+1.1, F+9.15), (sc, F+11.3)], 0, 0.8, 'stone')
            gable_hood(face, sc-1.2, sc+1.2, F+9.15, F+11.4, 0.85, 0.22, 0.4)
            for s in (sc-3.75, sc+3.75):
                c = face.P(s, 0, 0.45)
                pinnacle(c[0], c[2], F+7.0, 0.7, 3.2, 2.4, 3)
            dress(face, big, t, lights=4, hood=False)
            pts, _ = arch_pts(big['sl']-0.25, big['sr']+0.25, big['spring'], 1.0, 9)
            tube_face(face, [(big['sl']-0.55, big['spring'])]+pts+[(big['sr']+0.55, big['spring'])], 0.08, 0.1, 'stone')
            gable_hood(face, big['sl']-0.6, big['sr']+0.6, big['spring']+1.2, F+19.6, 0.22, 0.34, 0.6)
        elif key in 'NS':
            dress(face, low, t, lights=1)
            dress(face, mid, t, lights=2)
        if key != 'W':
            clock(face, sc, F+24.0)                                                          # [PHOTO]
        for ys in (F+9.2, F+20.2, F+28.7):
            fbox(face, ext0, ext1, ys, ys+0.3, 0, 0.22, 'carved')
        # corbel table of heads under the parapet [PHOTO]
        fbox(face, ext0, ext1, top-0.8, top-0.55, 0, 0.3, 'carved')
        n = int((s1-s0)/0.7)
        for i in range(n):
            s = s0+(s1-s0)*(i+0.5)/n
            fbox(face, s-0.14, s+0.14, top-1.15, top-0.8, 0, 0.28, 'carved')
        fbox(face, ext0, ext1, top-0.45, top, 0, 0.4, 'carved')
        # double corner buttresses stepping back stage by stage [LPC]; small pinnacles on their heads
        stages = [(F+9.2, 1.45), (F+20.2, 1.15), (F+28.7, 0.85), (F+38.6, 0.6)]
        for sb in (sc-C+0.75, sc+C-0.75):
            yt = buttress(face, sb, 1.5, 0, stages)
            for ys, ofs in ((F+9.2, 1.45), (F+20.2, 1.15), (F+28.7, 0.85)):
                prism(face, [(sb-0.75, ys), (sb+0.75, ys), (sb, ys+1.3)], ofs-0.3, ofs+0.02, 'carved')
    # dark interior behind the belfry louvres, and the deck the spire stands on
    box(TU-C+th+0.05, TU+C-th-0.05, F+26.5, top-0.9, TV-C+th+0.05, TV+C-2.2-0.05, 'shadow')
    box(TU-C+0.2, TU+C-0.2, top-0.9, top-0.4, TV-C+0.2, TV+C-0.2, 'stone')
    # openwork arcaded parapet [PHOTO]
    for key, face, s0, s1 in [('E', Face('E', TV+C), TU-C, TU+C), ('W', Face('W', TV-C), TU-C, TU+C),
                              ('N', Face('N', TU+C), TV-C, TV+C), ('S', Face('S', TU-C), TV-C, TV+C)]:
        fbox(face, s0, s1, top, top+0.3, -0.35, 0.12, 'stone')
        n = 11
        for i in range(n+1):
            s = s0+(s1-s0)*i/n
            fbox(face, s-0.09, s+0.09, top+0.3, top+1.35, -0.3, 0.0, 'stone')
        for i in range(n):
            s = s0+(s1-s0)*(i+0.5)/n
            pts, _ = arch_pts(s-0.38, s+0.38, top+0.85, 1.0, 4)
            tube_face(face, pts, -0.15, 0.06, 'carved', 4)
        fbox(face, s0, s1, top+1.35, top+1.6, -0.4, 0.12, 'carved')
        sc = (s0+s1)/2
        for off in (-2.2, 0, 2.2):
            c = face.P(sc+off, 0, -0.1)
            prism(face, [(sc+off-0.45, top+1.6), (sc+off+0.45, top+1.6), (sc+off, top+2.4)], -0.35, 0.1, 'carved')
    # octagonal corner turrets with the flying buttresses behind them [LPC, PHOTO: tops 53.7 m]
    for su in (-1, 1):
        for sv in (-1, 1):
            cu, cv = TU+su*(C+0.15), TV+sv*(C+0.15)
            turret(cu, cv, F+38.2, 1.35, F+46.3, F+53.7, lancet=True)
            a = math.atan2(-sv, -su)
            p0 = (cu+1.2*math.cos(a), cv+1.2*math.sin(a))
            R = 3.6*(1-3.0/41.9)     # spire flat radius where the flyer meets it
            p1 = (TU+su*(R-0.4)*0.7071, TV+sv*(R-0.4)*0.7071)
            N = 8; path = [(p0[0]+(p1[0]-p0[0])*i/N, p0[1]+(p1[1]-p0[1])*i/N) for i in range(N+1)]
            tops = [F+46.2-(1.9*i/N) for i in range(N+1)]
            bots = [tp-0.5-1.9*(i/N)**1.6 for i, tp in enumerate(tops)]
            ribbon(path, tops, bots, 0.45, 'stone')
            for i in range(1, N):
                leaf((path[i][0], tops[i]+0.12, path[i][1]), a, 0.3)


def spire():
    B, T = F+42.2, F+84.3                # foot inside the parapet; cross top at F+86 [WIKI]
    H = T-B
    RF = 3.6                             # 7.2 m across its foot [PHOTO]
    R0 = RF/math.cos(math.pi/8)
    lathe(TU, TV, B-1.6, [(0, R0*1.05), (1.6, R0*1.05)], 'stone', 8, math.pi/8)
    lathe(TU, TV, B, [(0, R0), (H, 0.07)], 'stone', 8, math.pi/8)
    for k in range(8):                   # rolls on the arrises and dense crockets [PHOTO]
        a = math.pi/8+k*math.pi/4
        m.tube('arris', [(TU+(R0+0.02)*math.cos(a), B, TV+(R0+0.02)*math.sin(a)),
                         (TU+0.25*math.cos(a), T-1.5, TV+0.25*math.sin(a))], 0.1, 'carved', 4)
        y = 2.0
        while y < H-2.0:
            t = y/H
            rr = R0*(1-t)+0.2
            leaf((TU+rr*math.cos(a), B+y, TV+rr*math.sin(a)), a, 0.75-0.35*t)
            y += 1.15
    for f in (0.12,):
        r = R0*(1-f)
        lathe(TU, TV, B+H*f, [(0, r+0.15), (0.35, r+0.15-0.35*R0/H)], 'carved', 8, math.pi/8)
    # spire lights: a big gabled lucarne on each cardinal face at the foot, then alternating tiers of
    # small gabled lights on the diagonal and cardinal faces [PHOTO]
    tiers = [(0.0, 0.0, 2.8, 5.4, 8.4, 2), (math.pi/4, 0.27, 1.3, 2.2, 3.3, 1),
             (0.0, 0.49, 1.05, 1.8, 2.7, 1), (math.pi/4, 0.69, 0.8, 1.4, 2.1, 1)]
    for a0, f, w, ye, ya, lights in tiers:
        yb = B+f*H
        for k in range(4):
            a = a0+k*math.pi/2
            rf_top = RF*(1-(f*H+ya)/H)
            D = RF*(1-f)+(0.9 if lights == 2 else 0.35)
            face = LFace(a, TU, TV, D)
            depth = D-max(0.25, rf_top*0.5)
            gable = [(-w/2, yb+ye), (0, yb+ya), (w/2, yb+ye)]
            tf = 0.45 if lights == 2 else 0.25
            hw = w*(0.3 if lights == 2 else 0.22)
            hole = arch_hole(-hw, hw, yb+0.35*ye, yb+0.35*ye+max(0.6, 0.62*ye-2*hw*0.866), 1.0, 6)
            wall_face(face, -w/2, w/2, yb, gable, [hole], tf)
            prism(face, [(-w/2, yb), (w/2, yb), (w/2, yb+ye), (0, yb+ya), (-w/2, yb+ye)], -depth, -tf, 'stone')
            prism(face, hole['bottom']+list(reversed(hole['top'])), -tf-0.02, -tf+0.02, 'shadow')
            if lights == 2:
                fbox(face, -0.07, 0.07, hole['sill'], hole['spring']+0.1, -tf+0.02, -0.1, 'carved')
            gable_hood(face, -w/2-0.1, w/2+0.1, yb+ye, yb+ya+0.1, 0.1, 0.18+0.1*w, 0.25+0.12*w, 0.06+0.02*w)
            if lights == 2:
                for s in (-w/2-0.1, w/2+0.1):
                    c = face.P(s, 0, -0.25)
                    pinnacle(c[0], c[2], yb, 0.5, ye-0.2, 2.2, 3)
    # orb and gilded cross; the cross top is 86 m above the Broadway pavement
    lathe(TU, TV, T-0.2, [(0, 0.12), (0.25, 0.32), (0.55, 0.36), (0.85, 0.22), (1.0, 0.06)], 'gold', 12, 0, True)
    box(TU-0.1, TU+0.1, T+0.8, F+86.0, TV-0.1, TV+0.1, 'gold')
    box(TU-0.1, TU+0.1, F+85.05, F+85.27, TV-0.45, TV+0.45, 'gold')


def nave():
    # aisles: exposed bays between the chapel / wing and the porches; crenellated parapet, and a tall
    # crocketed pinnacle on every buttress [PHOTO, LPC]
    for side, u, s0, s1 in (('N', AI_N, 1.4, 16.1), ('S', AI_S, 0.45, 15.2)):
        face = Face(side, u)
        holes = []
        for i in range(NB):
            vc = NAVE_E-BAY*(i+0.5)
            if s0+1.3 < vc < s1-1.3:
                holes.append(arch_hole(vc-1.25, vc+1.25, F+2.8, F+6.85, 1.0))
        wall_face(face, NAVE_W, NAVE_E, FL-0.2, AISLE_TOP, holes, 0.8)
        for h in holes:
            dress(face, h, 0.8, lights=3)
        parapet_top(face, NAVE_W, NAVE_E, AISLE_TOP, -0.8, 0, crenel=True)
        fbox(face, NAVE_W, NAVE_E, F+2.5, F+2.7, 0, 0.14, 'stone')
        for i in range(NB+1):
            vb = NAVE_E-BAY*i
            if s0+0.5 < vb < s1-0.5:
                top = buttress(face, vb, 0.9, FL-0.2, [(F+5.5, 1.1), (F+10.0, 0.75)], cap=0)
                c = face.P(vb, 0, 0.38)
                pinnacle(c[0], c[2], top, 0.72, 2.6, 3.2, 4)
    # aisle east ends beside the tower, facing Broadway
    for s0, s1 in ((AI_S, -4.96), (8.7, AI_N)):
        face = Face('E', NAVE_E)
        sc = (s0+s1)/2
        h = arch_hole(sc-1.3, sc+1.3, F+2.8, F+6.85, 1.0)
        wall_face(face, s0, s1, FL-0.2, AISLE_TOP, [h], 0.8)
        dress(face, h, 0.8, lights=3)
        parapet_top(face, s0, s1, AISLE_TOP, -0.8, 0, crenel=True)
        for sb in (s0+0.45, s1-0.45):
            top = buttress(face, sb, 0.9, FL-0.2, [(F+5.5, 1.0), (F+10.0, 0.7)], cap=0)
            c = face.P(sb, 0, 0.35)
            pinnacle(c[0], c[2], top, 0.72, 2.6, 3.2, 4)
    # aisle west ends above the low rear block
    for s0, s1 in ((AI_S, CL_S), (CL_N, AI_N)):
        face = Face('W', NAVE_W)
        wall_face(face, s0, s1, LOW_TOP-0.5, AISLE_TOP, [], 0.8)
        parapet_top(face, s0, s1, AISLE_TOP, -0.8, 0, crenel=True)
    # lean-to aisle roofs with standing seams
    for uo, ui in ((AI_N-0.8, CL_N), (AI_S+0.8, CL_S)):
        prism(Face('E', 0), [(uo, AISLE_TOP-0.2), (uo, AISLE_TOP+0.1), (ui, F+13.8), (ui, F+13.5)], NAVE_W, NAVE_E, 'roof')
        seams(uo, AISLE_TOP+0.1, ui, F+13.8, NAVE_W, NAVE_E)
    # clerestory: eight three-light windows a side, pilaster piers ending in pinnacles [LPC, PHOTO]
    for side, u in (('N', CL_N), ('S', CL_S)):
        face = Face(side, u)
        holes = [arch_hole(NAVE_E-BAY*(i+0.5)-1.15, NAVE_E-BAY*(i+0.5)+1.15, F+14.2, F+16.2, 1.0) for i in range(NB)]
        wall_face(face, NAVE_W, NAVE_E, F+10.5, CLER_TOP, holes, 0.7)
        for h in holes:
            dress(face, h, 0.7, lights=3)
        parapet_top(face, CH_W, NAVE_E, CLER_TOP, -0.7, 0, crenel=True)
        for i in range(NB+1):
            vb = NAVE_E-BAY*i
            if 0 < i < NB:
                buttress(face, vb, 0.6, F+13.6, [(CLER_TOP, 0.42)], cap=0)
            c = face.P(vb, 0, 0.2)
            pinnacle(c[0], c[2], CLER_TOP+0.2, 0.6, 2.2, 2.8, 3)
    # nave and chancel roof: one steep standing-seam roof from the tower to the altar gable
    ri = 6.6-0.7
    pitch = (RIDGE-CLER_TOP)/ri
    prism(Face('E', 0), [(NU-ri, CLER_TOP-0.35), (NU-ri, CLER_TOP), (NU, RIDGE), (NU+ri, CLER_TOP), (NU+ri, CLER_TOP-0.35), (NU, RIDGE-0.35)],
          CH_W+0.5, NAVE_E, 'roof')
    for sgn in (-1, 1):
        seams(NU+sgn*ri, CLER_TOP, NU, RIDGE, CH_W+0.5, NAVE_E)
    box(NU-0.18, NU+0.18, RIDGE-0.1, RIDGE+0.22, CH_W+0.5, NAVE_E, 'carved')


def chancel():
    # the one-bay chancel, as tall as the nave, rising out of the low rear block [PHOTO c.1912]
    for side, u in (('N', CL_N), ('S', CL_S)):
        face = Face(side, u)
        h = arch_hole((CH_W+NAVE_W)/2-1.2, (CH_W+NAVE_W)/2+1.2, F+9.5, F+14.5, 1.0)
        wall_face(face, CH_W, NAVE_W, FL-0.2, CLER_TOP, [h], 0.8)
        dress(face, h, 0.8, lights=3)
        # quadrant flyer from the chancel wall down to the parapet of the low block
        uo = AI_N-0.5 if side == 'N' else AI_S+0.5
        N = 8; vf = NAVE_W-0.5
        path = [(u+(uo-u)*i/N, vf) for i in range(N+1)]
        tops = [F+17.0-(F+17.0-LOW_TOP-0.9)*i/N for i in range(N+1)]
        bots = [tp-0.6-2.5*(1-i/N)**1.8 for i, tp in enumerate(tops)]
        ribbon(path, tops, bots, 0.5, 'stone')
    # the altar gable: huge five-light window, a roundel in the gable, crocketed coping, cross [PHOTO]
    face = Face('W', CH_W)
    gy = RIDGE+0.9
    big = arch_hole(NU-2.7, NU+2.7, F+8.0, F+15.8, 1.0, 10)
    rose = circle_hole(NU, F+24.6, 0.8, 20)
    wall_face(face, CL_S, CL_N, FL-0.2, [(CL_S, CLER_TOP), (NU, gy), (CL_N, CLER_TOP)], [big, rose], 1.0)
    dress(face, big, 1.0, lights=5)
    dress(face, rose, 1.0, lights=1)
    gable_coping(face, CL_S, CL_N, CLER_TOP, gy, -1.2, 0.15)
    for a, b in (((CL_S, CLER_TOP+0.3), (NU, gy+0.35)), ((CL_N, CLER_TOP+0.3), (NU, gy+0.35))):
        pa, pb = face.P(a[0], a[1], 0.1), face.P(b[0], b[1], 0.1)
        crocket_line(pa, pb, 0.75, 0.42, math.pi)
    for sb in (CL_S+0.55, CL_N-0.55):
        top = buttress(face, sb, 1.3, FL-0.2, [(LOW_TOP+0.9, 1.9), (F+13.0, 1.4), (CLER_TOP-0.5, 1.0)], cap=0)
        c = face.P(sb, 0, 0.45)
        turret(c[0], c[2], top-0.2, 0.95, CLER_TOP+3.4, F+30.6)
    # the low rear block: Withers's extension round the altar end and the sacristies either side of
    # the chancel, one storey, crenellated, buttresses with pinnacles [PHOTO, WIKI]
    face = Face('W', EXT_W)
    bays = 5; s0, s1 = -13.04, 7.73; bw = (s1-s0)/bays
    holes = [arch_hole(s0+bw*(i+0.5)-0.8, s0+bw*(i+0.5)+0.8, F+2.0, F+4.3, 1.0) for i in range(bays)]
    wall_face(face, s0, s1, FL-0.2, LOW_TOP, holes, 0.6)
    for h in holes:
        dress(face, h, 0.6, lights=2)
    parapet_top(face, s0, s1, LOW_TOP, -0.6, 0, crenel=True)
    for i in range(bays+1):
        sb = min(max(s0+bw*i, s0+0.45), s1-0.45)
        top = buttress(face, sb, 0.8, FL-0.2, [(F+3.0, 0.8), (LOW_TOP-0.3, 0.5)], cap=0)
        c = face.P(sb, 0, 0.25)
        pinnacle(c[0], c[2], top, 0.6, 1.9, 2.2, 3)
    box(-13.04+0.5, AI_N-0.1, FL-0.2, LOW_TOP-0.4, EXT_W+0.5, NAVE_W, 'stone')
    box(-13.04+0.5, AI_N-0.1, LOW_TOP-0.4, LOW_TOP-0.2, EXT_W+0.5, NAVE_W, 'roof')
    box(-13.04+0.2, AI_S, FL-0.2, LOW_TOP-0.4, NAVE_W, 0.45, 'stone')
    box(-13.04+0.2, AI_S, LOW_TOP-0.4, LOW_TOP-0.2, NAVE_W, 0.45, 'roof')


def chapel():
    # All Saints' Chapel (1913) along the north side of the rear: gabled, its west gable between two
    # octagonal turrets with stone caps [PHOTO Trinity Place]
    u0, u1, v0, v1 = AI_N, 20.15, -23.6, 1.4
    face = Face('N', u1)
    bays = 5; bw = (v1-v0)/bays
    holes = [arch_hole(v0+bw*(i+0.5)-0.85, v0+bw*(i+0.5)+0.85, F+2.4, F+4.4, 1.0) for i in range(bays)]
    wall_face(face, v0, v1, FL-0.2, LOW_TOP+0.6, holes, 0.7)
    for h in holes:
        dress(face, h, 0.7, lights=2)
    parapet_top(face, v0, v1, LOW_TOP+0.6, -0.7, 0, crenel=True)
    for i in range(bays+1):
        buttress(face, v0+bw*i if 0 < i < bays else (v0+0.45 if i == 0 else v1-0.45), 0.8, FL-0.2, [(F+3.2, 0.8), (LOW_TOP, 0.5)])
    mid = (u0+u1)/2; ri = (u1-u0)/2
    ya = LOW_TOP+0.6+ri*1.1
    prism(Face('E', 0), [(u0, LOW_TOP+0.4), (u0, LOW_TOP+0.7), (mid, ya+0.3), (u1-0.6, LOW_TOP+0.7), (u1-0.6, LOW_TOP+0.4), (mid, ya)],
          v0+0.4, v1, 'roof')
    face = Face('W', v0)
    h = arch_hole(mid-0.9, mid+0.9, F+3.0, F+5.1, 1.0)
    wall_face(face, u0, u1, FL-0.2, [(u0, LOW_TOP+0.6), (mid, ya+0.3), (u1, LOW_TOP+0.6)], [h], 0.7)
    dress(face, h, 0.7, lights=2)
    gable_coping(face, u0+0.6, u1-0.6, LOW_TOP+0.9, ya+0.3, -0.8, 0.15)
    for uc in (u0+0.6, u1-0.6):
        turret(uc, v0+0.2, FL, 0.85, F+8.4, F+10.8, lancet=True, crockets=False)


def loggia():
    # north-west block on Trinity Place: an open pointed arcade on the terrace, crenellated; the
    # footbridge lands in it [OSM outline, PHOTO]
    rects = [(7.72, 14.25, -26.82, -23.32), (14.25, 17.33, -31.1, -23.6), (17.33, 20.4, -31.3, -28.7)]
    top = W_TER+4.4
    for u0, u1, v0, v1 in rects:
        box(u0, u1, 0, W_TER, v0, v1, 'rubble')
        box(u0+0.4, u1-0.4, W_TER, top-0.3, v0+0.4, v1-0.4, 'shadow')
        box(u0+0.3, u1-0.3, top-0.3, top-0.1, v0+0.3, v1-0.3, 'roof')
    for face, s0, s1, n in [(Face('W', -26.82), 7.72, 14.25, 2), (Face('W', -31.1), 14.25, 17.33, 1),
                            (Face('W', -31.3), 17.33, 20.4, 1), (Face('N', 20.4), -31.3, -28.7, 1),
                            (Face('N', 17.33), -28.7, -23.6, 2), (Face('S', 7.72), -26.82, -23.32, 1),
                            (Face('S', 14.25), -31.1, -26.82, 1)]:
        bw = (s1-s0)/n
        holes = [arch_hole(s0+bw*(i+0.5)-min(1.1, bw/2-0.45), s0+bw*(i+0.5)+min(1.1, bw/2-0.45), W_TER, W_TER+2.0, 1.0, 7)
                 for i in range(n)]
        wall_face(face, s0, s1, W_TER, top, holes, 0.5)
        for h in holes:
            pts, _ = arch_pts(h['sl']-0.12, h['sr']+0.12, h['spring'], 1.0, 7)
            tube_face(face, pts, 0.06, 0.09, 'carved')
        parapet_top(face, s0, s1, top, -0.5, 0, crenel=True)
        for sb in (s0+0.3, s1-0.3):
            buttress(face, sb, 0.6, W_TER, [(W_TER+2.6, 0.5), (top-0.4, 0.3)])


def wing():
    # south-west wing (1960s, Gothic to match): two storeys, crenellated
    u0, u1, v0, v1 = -23.54, -13.04, -25.5, 0.42
    top = F+10.6
    for face, e0, e1, n in ((Face('W', v0), u0, u1, 2), (Face('S', u0), v0, v1, 5), (Face('E', v1), u0, u1, 2)):
        holes = []
        for i in range(n):
            sc = e0+(e1-e0)*(i+0.5)/n
            holes.append(arch_hole(sc-0.8, sc+0.8, F+1.9, F+3.9, 1.0))
            holes.append(arch_hole(sc-0.95, sc+0.95, F+5.6, F+8.2, 1.0))
        wall_face(face, e0, e1, FL-0.2, top, holes, 0.6)
        for h in holes:
            dress(face, h, 0.6, lights=2)
        fbox(face, e0, e1, F+5.0, F+5.25, 0, 0.16, 'carved')
        parapet_top(face, e0, e1, top, -0.6, 0, crenel=True)
        for i in range(n+1):
            s = e0+(e1-e0)*i/n
            s = min(max(s, e0+0.4), e1-0.4)
            buttress(face, s, 0.8, FL-0.2, [(F+5.0, 0.7), (F+9.5, 0.45)])
    box(u0+0.5, u1, FL-0.2, top-0.8, v0+0.5, v1-0.5, 'stone')
    box(u0+0.5, u1, top-0.8, top-0.6, v0+0.5, v1-0.5, 'roof')


def porches():
    # north and south porches beside the tower: gabled, the bronze-doored portal in the outer gable,
    # pinnacles at the corners [LPC, PHOTO c.1912]
    for u0, u1, v0, v1, outer in ((-17.12, AI_S, 15.21, 23.32, 'S'), (AI_N, 19.95, 16.11, 22.98, 'N')):
        top = F+7.2
        vm = (v0+v1)/2; half = (v1-v0)/2
        ya = top+half*1.15
        uo = u0 if outer == 'S' else u1
        oface = Face(outer, uo)
        dh = arch_hole(vm-1.0, vm+1.0, FL, F+3.2, 1.0, 8)
        wall_face(oface, v0, v1, FL-0.2, [(v0, top), (vm, ya), (v1, top)], [dh], 0.9)
        door(oface, dh, 0.9, orders=3)
        gable_coping(oface, v0+0.3, v1-0.3, top+0.2, ya, -1.0, 0.15, cross=False)
        c = oface.P(vm, ya+0.3, 0.0)
        finial(c[0], c[2], c[1], 0.7)
        for a, b in (((v0+0.3, top+0.5), (vm, ya+0.4)), ((v1-0.3, top+0.5), (vm, ya+0.4))):
            crocket_line(oface.P(a[0], a[1], 0.05), oface.P(b[0], b[1], 0.05), 0.7, 0.35, 0)
        g = G(*(oface.P(vm, 0, 2.0)[i] for i in (0, 2)))
        for i in range(4):
            y1 = FL-0.1875*i
            if y1 <= g:
                break
            p0 = oface.P(vm-1.6, 0, 0.9+0.4*i); p1 = oface.P(vm+1.6, 0, 0.0)
            box(min(p0[0], p1[0]), max(p0[0], p1[0]), max(0, g-0.4), y1, min(p0[2], p1[2]), max(p0[2], p1[2]), 'stone')
        eface = Face('E', v1)
        wh = arch_hole((u0+u1)/2-0.85, (u0+u1)/2+0.85, F+2.6, F+4.8, 1.0)
        wall_face(eface, u0, u1, FL-0.2, top, [wh], 0.7)
        dress(eface, wh, 0.7, lights=2)
        parapet_top(eface, u0, u1, top, -0.7, 0)
        wface = Face('W', v0)
        wall_face(wface, u0, u1, FL-0.2, top, [], 0.7)
        parapet_top(wface, u0, u1, top, -0.7, 0)
        box(u0+0.5, u1-0.5, FL-0.2, top-0.2, v0+0.5, v1-0.5, 'stone')
        um = u1+0.2 if outer == 'S' else u0-0.2
        prism(Face('N', 0), [(v0+0.3, top), (v0+0.3, top+0.3), (vm, ya+0.3), (v1-0.3, top+0.3), (v1-0.3, top), (vm, ya)],
              min(uo, um), max(uo, um), 'roof')
        for cu in (u0+0.35, u1-0.35):
            for cv in (v0+0.35, v1-0.35):
                pinnacle(cu, cv, top+0.2, 0.75, 1.8, 2.4, 3)
    # the Broadway steps up to the tower portal
    for i in range(4):
        box(TU-3.9, TU+3.9, max(0, F-0.4), FL-0.1875*i, TV+C-2.2, TV+C+0.45*(i+1), 'stone')
# ------------------------------------------------------------------ churchyard
def in_poly(p, poly):
    x, y = p; inside = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:]+poly[:1]):
        if (y0 > y) != (y1 > y) and x < x0+(y-y0)*(x1-x0)/(y1-y0):
            inside = not inside
    return inside


def seg_dist(p, a, b):
    ax, ay = b[0]-a[0], b[1]-a[1]; L2 = ax*ax+ay*ay
    t = 0 if L2 == 0 else max(0, min(1, ((p[0]-a[0])*ax+(p[1]-a[1])*ay)/L2))
    return math.hypot(p[0]-a[0]-t*ax, p[1]-a[1]-t*ay)


def poly_dist(p, poly, closed=True):
    pts = poly+poly[:1] if closed else poly
    return min(seg_dist(p, a, b) for a, b in zip(pts, pts[1:]))


def railing(line):
    """Cast-iron spear railing on a low brownstone curb that follows the ground."""
    bars = 0
    for a, b in zip(line, line[1:]):
        L = math.hypot(b[0]-a[0], b[1]-a[1])
        n = max(1, int(math.ceil(L/2.0)))
        for i in range(n):
            p = (a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n)
            q = (a[0]+(b[0]-a[0])*(i+1)/n, a[1]+(b[1]-a[1])*(i+1)/n)
            gp, gq = G(*p), G(*q)
            bot = max(0.0, min(gp, gq)-0.35)
            slab(p, q, 0.5, bot, gp+0.55, bot, gq+0.55, 'stone')
            slab(p, q, 0.6, gp+0.55, gp+0.66, gq+0.55, gq+0.66, 'carved')
            for y_off in (0.78, 1.95):
                slab(p, q, 0.05, gp+y_off, gp+y_off+0.06, gq+y_off, gq+y_off+0.06, 'iron')
        ang = math.atan2(b[1]-a[1], b[0]-a[0])
        k = max(1, int(L/0.15))
        for i in range(k):
            t = (i+0.5)/k
            u, v = a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t
            g = G(u, v)
            spear(u, v, g+0.66, 1.56, ang)
            bars += 1
        for i in range(0, int(L/2.6)+1):
            t = min(1, i*2.6/L) if L > 0 else 0
            u, v = a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t
            g = G(u, v)
            rbox((u, g+0.66+0.9, v), ang, (0.12, 1.8, 0.12), 'iron')
            lathe(u, v, g+2.46, [(0, 0.03), (0.06, 0.1), (0.16, 0.11), (0.26, 0.03)], 'iron', 8)
    return bars


def gate_pier(u, v, base=None):
    g = G(u, v) if base is None else base
    box(u-0.45, u+0.45, max(0, g-0.3), g+2.6, v-0.45, v+0.45, 'stone')
    box(u-0.55, u+0.55, g+2.6, g+2.8, v-0.55, v+0.55, 'carved')
    lathe(u, v, g+2.8, [(0, 0.35), (0.4, 0.02)], 'carved', 4, math.pi/4)


def headstone(u, v, rng, mat):
    g = G(u, v)
    w = rng.uniform(0.45, 0.95); h = rng.uniform(0.55, 1.25)*(0.8 if w < 0.6 else 1.0); t = rng.uniform(0.08, 0.14)
    kind = rng.random()
    if kind < 0.55:        # tympanum with shoulders, the colonial slate shape
        arc = [(0.3*w*math.cos(a), 0.86*h+0.14*h*math.sin(a)) for a in [k*math.pi/6 for k in range(7)]]
        out = [(-w/2, -0.3), (w/2, -0.3), (w/2, 0.8*h), (0.42*w, 0.88*h)]+arc+[(-0.42*w, 0.88*h), (-w/2, 0.8*h)]
    elif kind < 0.85:      # round-topped
        out = [(-w/2, -0.3), (w/2, -0.3)]+[(w/2*math.cos(a), h-w/2+w/2*math.sin(a)) for a in [k*math.pi/6 for k in range(7)]]
    else:                  # pointed / flat
        out = [(-w/2, -0.3), (w/2, -0.3), (w/2, h*0.85), (0, h), (-w/2, h*0.85)]
    out = dedupe([(x, y) for x, y in out])
    yaw = rng.uniform(-0.12, 0.12); lean = rng.uniform(-0.08, 0.08)
    ex = (math.cos(yaw), math.sin(yaw)); ez = (-math.sin(yaw), math.cos(yaw))
    base = max(0.0, g-0.3)+0.3
    verts = [(u+ex[0]*x+ez[0]*(-t/2+lean*max(y, 0)), max(base+y, 0.0), v+ex[1]*x+ez[1]*(-t/2+lean*max(y, 0))) for x, y in out]
    m.shell('headstone', verts, (ez[0]*t, 0, ez[1]*t), mat)


def table_tomb(u, v, rng):
    g = G(u, v); b = max(0.0, g-0.3)
    yaw = rng.uniform(-0.05, 0.05)
    rbox((u, (b+g+0.7)/2, v), yaw, (1.0, g+0.7-b, 2.0), 'granite')
    rbox((u, g+0.78, v), yaw, (1.2, 0.16, 2.2), 'marble')


def obelisk(u, v, h, mat):
    g = G(u, v); b = max(0.0, g-0.3)
    box(u-0.6, u+0.6, b, g+0.4, v-0.6, v+0.6, mat)
    box(u-0.42, u+0.42, g+0.4, g+1.2, v-0.42, v+0.42, mat)
    lathe(u, v, g+1.2, [(0, 0.3*1.414), (h, 0.18*1.414)], mat, 4, math.pi/4)
    lathe(u, v, g+1.2+h, [(0, 0.18*1.414), (0.4, 0.01)], mat, 4, math.pi/4)


def hamilton(u, v):
    """Alexander Hamilton's tomb: white marble, pyramid top with an urn at each corner (no inscription)."""
    g = G(u, v); b = max(0.0, g-0.3)
    box(u-1.7, u+1.7, b, g+0.35, v-1.7, v+1.7, 'marble')
    box(u-1.35, u+1.35, g+0.35, g+0.8, v-1.35, v+1.35, 'marble')
    box(u-1.1, u+1.1, g+0.8, g+2.9, v-1.1, v+1.1, 'marble')
    box(u-1.3, u+1.3, g+2.9, g+3.25, v-1.3, v+1.3, 'marble')
    lathe(u, v, g+3.25, [(0, 1.15*1.414), (1.9, 0.02)], 'marble', 4, math.pi/4)
    for su in (-1, 1):
        for sv in (-1, 1):
            lathe(u+su*1.08, v+sv*1.08, g+3.25, [(0, 0.12), (0.1, 0.1), (0.25, 0.2), (0.45, 0.2), (0.55, 0.08), (0.7, 0.12), (0.78, 0.02)],
                  'marble', 10, 0, True)


def soldiers_monument(u, v):
    """The Gothic brownstone Soldiers' Monument in the north churchyard (simplified)."""
    g = G(u, v); b = max(0.0, g-0.3)
    box(u-2.6, u+2.6, b, g+0.4, v-2.6, v+2.6, 'stone')
    box(u-2.2, u+2.2, g+0.4, g+0.8, v-2.2, v+2.2, 'stone')
    box(u-1.3, u+1.3, g+0.8, g+5.4, v-1.3, v+1.3, 'stone')
    for side in 'NSEW':
        face = Face(side, (v+1.3) if side == 'E' else (v-1.3) if side == 'W' else (u+1.3) if side == 'N' else (u-1.3))
        sc = u if side in 'EW' else v
        h = arch_hole(sc-0.75, sc+0.75, g+1.4, g+3.8, 1.0, 6)
        wall_face(face, sc-1.6, sc+1.6, g+0.8, [(sc-1.6, g+5.2), (sc, g+6.9), (sc+1.6, g+5.2)], [h], 0.6, d1=0.6)
        prism(face, h['bottom']+list(reversed(h['top'])), 0.0, 0.05, 'shadow')
        gable_coping(face, sc-1.6, sc+1.6, g+5.2, g+6.9, 0.0, 0.75, cross=False)
    for su in (-1, 1):
        for sv in (-1, 1):
            pinnacle(u+su*1.75, v+sv*1.75, g+0.8, 0.55, 5.0, 2.2, 3)
    lathe(u, v, g+5.4, [(0, 1.25), (8.2, 0.03)], 'stone', 8, math.pi/8)
    for k in range(8):
        a = math.pi/8+k*math.pi/4
        for j in range(1, 6):
            t = j/7
            rbox((u+(1.25*(1-t)+0.06)*math.cos(a), g+5.4+8.2*t, v+(1.25*(1-t)+0.06)*math.sin(a)), a, (0.22, 0.2, 0.18), 'carved')
    lathe(u, v, g+13.5, [(0, 0.05), (0.2, 0.16), (0.5, 0.02)], 'carved', 6)


CHURCH = [(-4.96, 8.7, 22.9, 36.68), (AI_S, AI_N, NAVE_W, NAVE_E), (-13.04, AI_N, EXT_W, NAVE_W),
          (-13.04, AI_S, NAVE_W, 0.45), (AI_N, 20.15, -23.6, 1.4), (-23.54, -13.04, -25.5, 0.42),
          (-17.12, AI_S, 15.21, 23.32), (AI_N, 19.95, 16.11, 22.98), (7.72, 14.25, -26.82, -23.32),
          (14.25, 17.33, -31.1, -23.6), (17.33, 20.4, -31.3, -28.7)]
HAMILTON = (-33.5, 4.0)
SOLDIERS = (70.0, 6.0)


def churchyard():
    yards = sorted(env['yards'], key=lambda r: -abs(area(r)))
    north = max(yards, key=lambda r: sum(p[0] for p in r)/len(r))
    south = min(yards, key=lambda r: sum(p[0] for p in r)/len(r))
    # railings: Broadway, Pine/Rector side, Trinity Place, and along the tower forecourt
    lines = []
    def edge(ring, a, b):
        """Vertices of ring from the one nearest a to the one nearest b, walking forward."""
        ia = min(range(len(ring)), key=lambda i: math.hypot(ring[i][0]-a[0], ring[i][1]-a[1]))
        ib = min(range(len(ring)), key=lambda i: math.hypot(ring[i][0]-b[0], ring[i][1]-b[1]))
        out = [ring[ia]]; i = ia
        while i != ib:
            i = (i+1) % len(ring); out.append(ring[i])
        return out
    def either(ring, a, b):
        e1, e2 = edge(ring, a, b), list(reversed(edge(ring, b, a)))
        L = lambda e: sum(math.hypot(q[0]-p[0], q[1]-p[1]) for p, q in zip(e, e[1:]))
        return e1 if L(e1) <= L(e2) else e2
    lines.append(either(north, (20.6, 41.4), (81.2, 43.7)))     # Broadway
    lines.append(either(north, (81.2, 43.7), (78.9, -35.9)))    # north side
    tp_north = either(north, (78.9, -35.9), (20.3, -31.4))      # Trinity Place: retaining wall
    lines.append(either(north, (20.4, 27.6), (20.6, 41.4)))     # forecourt, north
    tp_south = either(south, (-23.5, -28.2), (-48.8, -26.2))    # Trinity Place: retaining wall
    lines.append(either(south, (-48.8, -26.2), (-37.4, 41.7)))  # Rector Street
    lines.append(either(south, (-37.4, 41.7), (-14.6, 41.5)))   # Broadway
    lines.append(either(south, (-14.6, 41.5), (-17.1, 23.3)))   # forecourt, south
    bars = sum(railing(l) for l in lines)
    for line in (tp_north, tp_south):
        b, ends = retaining(line)
        bars += b
        for p, top in ends:
            if math.hypot(p[0]-20.3, p[1]+31.4) > 1.0:
                gate_pier(p[0], p[1], top)
    for p in [(20.6, 41.4), (-14.6, 41.5), (81.2, 43.7), (-37.4, 41.7)]:
        gate_pier(*p)
    hamilton(*HAMILTON)
    soldiers_monument(*SOLDIERS)
    rng = random.Random(1697)
    paths = env['paths']
    counts = dict(headstones=0, tombs=0, obelisks=0, bars=bars)
    for ring in (north, south):
        us = [p[0] for p in ring]; vs = [p[1] for p in ring]
        v = min(vs)+1.6
        row = 0
        while v < max(vs)-1.2:
            u = min(us)+1.4+(0.7 if row % 2 else 0)
            while u < max(us)-1.2:
                p = (u+rng.uniform(-0.35, 0.35), v+rng.uniform(-0.3, 0.3))
                u += rng.uniform(1.25, 1.9)
                if not in_poly(p, ring) or poly_dist(p, ring) < 1.6:
                    continue
                if any(c[0]-2.4 < p[0] < c[1]+2.4 and c[2]-2.4 < p[1] < c[3]+2.4 for c in CHURCH):
                    continue
                if any(poly_dist(p, pl, False) < 1.4 for pl in paths if len(pl) > 1):
                    continue
                if math.hypot(p[0]-HAMILTON[0], p[1]-HAMILTON[1]) < 3.2 or math.hypot(p[0]-SOLDIERS[0], p[1]-SOLDIERS[1]) < 4.5:
                    continue
                r = rng.random()
                if r < 0.4:
                    continue          # the yard is dense but patchy, with lawn between the groups
                if r < 0.42:
                    table_tomb(p[0], p[1], rng); counts['tombs'] += 1
                elif r < 0.43:
                    obelisk(p[0], p[1], rng.uniform(1.6, 3.2), rng.choice(['marble', 'granite'])); counts['obelisks'] += 1
                else:
                    q = rng.random()
                    headstone(p[0], p[1], rng, 'granite' if q < 0.6 else 'stone' if q < 0.85 else 'marble')
                    counts['headstones'] += 1
            v += rng.uniform(2.0, 2.5); row += 1
    print('CHURCHYARD', json.dumps(counts))



# ------------------------------------------------------------------ Trinity Place
def densify(line, step):
    out = []
    for a, b in zip(line, line[1:]):
        n = max(1, int(math.ceil(math.hypot(b[0]-a[0], b[1]-a[1])/step)))
        out += [(a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n) for i in range(n)]
    return out+[tuple(line[-1])]


def bars_on(path, tops):
    """Spear-topped cast-iron railing standing on given heights along a plan path."""
    bars = 0
    for (a, b), (ta, tb) in zip(zip(path, path[1:]), zip(tops, tops[1:])):
        L = math.hypot(b[0]-a[0], b[1]-a[1])
        if L < 1e-3:
            continue
        for y_off in (0.12, 1.3):
            slab(a, b, 0.05, ta+y_off, ta+y_off+0.06, tb+y_off, tb+y_off+0.06, 'iron')
        ang = math.atan2(b[1]-a[1], b[0]-a[0])
        k = max(1, int(L/0.15))
        for i in range(k):
            t = (i+0.5)/k
            u, v, y = a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, ta+(tb-ta)*t
            spear(u, v, y, 1.56, ang)
            bars += 1
    for i in range(0, len(path), 2):
        (u, v), y = path[i], tops[i]
        rbox((u, y+0.9, v), 0, (0.12, 1.8, 0.12), 'iron')
        lathe(u, v, y+1.8, [(0, 0.03), (0.06, 0.1), (0.16, 0.11), (0.26, 0.03)], 'iron', 8)
    return bars


def retaining(line, top_at=None, door_at=None):
    """Brownstone rubble retaining wall on the Trinity Place property line, about 3.5-4 m high on the
    street side with a moulded coping and the railing on top [PHOTO]. The churchyard behind it is lower
    in the game's terrain than in reality, so inside it stands as a parapet. Returns (bars, ends)."""
    pts = densify(line, 1.5)
    path, tops, bots = [], [], []
    for i, p in enumerate(pts):
        a, b = pts[max(i-1, 0)], pts[min(i+1, len(pts)-1)]
        du, dv = b[0]-a[0], b[1]-a[1]; L = math.hypot(du, dv) or 1
        n = (-dv/L, du/L)
        if n[1] < 0:
            n = (-n[0], -n[1])
        c = (p[0]+n[0]*0.45, p[1]+n[1]*0.45)
        g_out = G(p[0]-n[0]*1.2, p[1]-n[1]*1.2)
        g_in = G(p[0]+n[0]*2.5, p[1]+n[1]*2.5)
        top = top_at if top_at is not None else max(g_out+3.4, g_in+0.9)
        path.append(c); tops.append(top); bots.append(max(0.0, g_out-0.4))
    segs = [(0, len(path))]
    if door_at is not None:
        k = min(range(len(path)), key=lambda i: math.hypot(path[i][0]-door_at[0], path[i][1]-door_at[1]))
        segs = [(0, k), (k+1, len(path))]
    for i0, i1 in segs:
        if i1-i0 >= 2:
            ribbon(path[i0:i1], tops[i0:i1], bots[i0:i1], 0.9, 'rubble')
    ribbon(path, [t+0.22 for t in tops], [t-0.02 for t in tops], 1.15, 'carved')     # coping
    if door_at is not None:
        # arched doorway into the undercroft: a real recess with bronze doors at the back
        a, b = path[k-1], path[k+1]
        ang = math.atan2(b[1]-a[1], b[0]-a[0]); nrm = ang+math.pi/2
        if math.sin(nrm) < 0:
            nrm += math.pi
        face = LFace(nrm-math.pi, path[k][0], path[k][1], 0.45)     # outer (street) face of the wall
        gb = bots[k]+0.4
        hole = arch_hole(-1.1, 1.1, gb, gb+1.9, 1.0, 8)
        s0 = -math.hypot(path[k][0]-a[0], path[k][1]-a[1])+0.02
        s1 = math.hypot(b[0]-path[k][0], b[1]-path[k][1])-0.02
        wall_face(face, s0, s1, bots[k], tops[k], [hole], 0.9)
        door(face, hole, 0.9, orders=2)
    bars = bars_on(path, [t+0.2 for t in tops])
    return bars, [(line[0], tops[0]+0.2), (line[-1], tops[-1]+0.2)]


def terrace():
    """The raised terrace between the rear of the church and the Trinity Place wall, level with the
    loggia floor and the footbridge landing."""
    backs = [(-23.54, -13.04, -25.5), (-13.04, 7.72, EXT_W), (7.72, 14.25, -26.82)]
    for u0, u1, vb in backs:
        f0, f1 = street_v(u0)+0.9, street_v(u1)+0.9
        verts = [(u0, 0, f0), (u1, 0, f1), (u1, 0, vb), (u0, 0, vb),
                 (u0, W_TER, f0), (u1, W_TER, f1), (u1, W_TER, vb), (u0, W_TER, vb)]
        m.mesh('terrace', verts, BOXF, 'stone')
    line = [(-23.54, street_v(-23.54)), (14.25, street_v(14.25))]
    bars, _ = retaining(line, top_at=W_TER+0.05, door_at=(-0.5, street_v(-0.5)))
    # its south end drops to the churchyard: a short wall and railing
    p0, p1 = (-23.54+0.3, street_v(-23.54)+0.9), (-23.54+0.3, -25.5)
    ribbon([p0, p1], [W_TER+0.2]*2, [max(0.0, G(*p0)-0.4), max(0.0, G(*p1)-0.4)], 0.6, 'rubble')
    bars += bars_on([p0, p1], [W_TER+0.2]*2)
    gate_pier(-23.54+0.2, street_v(-23.54)+0.3, W_TER+0.25)
    return bars


def footbridge():
    """The church footbridge over Trinity Place (OSM way 112692315, bridge=yes, layer 1): from the
    north-west loggia to 76 Trinity Place. A shallow-arched steel deck with iron balustrades; about
    5 m clear over the roadway so the race passes under it."""
    a, b = (16.1, -31.1), (14.9, -56.1)
    N = 24
    path = [(a[0]+(b[0]-a[0])*i/N, a[1]+(b[1]-a[1])*i/N) for i in range(N+1)]
    tops = [W_TER+0.1+0.9*i/N+0.7*math.sin(math.pi*i/N) for i in range(N+1)]
    bots = [t-1.0+0.35*math.sin(math.pi*i/N) for i, t in enumerate(tops)]
    ribbon(path, tops, bots, 3.2, 'steel')
    ribbon(path, [t+0.02 for t in tops], [t-0.08 for t in tops], 2.9, 'stone')     # walking surface
    ang = math.atan2(b[1]-a[1], b[0]-a[0]); nu, nv = -math.sin(ang), math.cos(ang)
    bars = 0
    for sgn in (-1, 1):
        edge = [(p[0]+sgn*nu*1.5, p[1]+sgn*nv*1.5) for p in path]
        bars += bars_on(edge, tops)
    for i in range(1, N):      # cross ribs under the deck
        p = path[i]
        rbox((p[0], bots[i]+0.2, p[1]), ang+math.pi/2, (3.3, 0.4, 0.14), 'steel')
    return bars


def build():
    plinths()
    tower()
    spire()
    nave()
    chancel()
    chapel()
    loggia()
    wing()
    porches()
    bars = terrace()
    bars += footbridge()
    churchyard()
    print('WALL/BRIDGE BARS', bars)
    return m.finish(directory=SCRATCH)


build()
