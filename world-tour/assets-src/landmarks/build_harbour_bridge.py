"""Sydney Harbour Bridge: steel through-arch, hangers, deck steelwork, four granite pylons and
both approach viaducts, for the Sydney route that drives SOUTH across it on the Bradfield Highway.

Sources (every number below is tagged with one of these):
  [card]  the route's research card: 503 m arch span, crown 134 m above sea level, pylons 89 m,
          deck 48.8 m wide, pylon/abutment base 68 x 48 m.
  [osm]   the cached OSM data: the two pylon-pair outlines (ways 156584774, 382401361) fix the bridge
          axis and the pylon centres, 565 m apart; the approach piers mapped as buildings (e.g. ways
          156584791 / 156584815) are 6 x 5 m and put the approach trusses about 30 m apart.
  [photo] Wikimedia Commons reference photos (list in the report). The near-orthographic side view
          'Sydney (AU), Harbour Bridge -- 2019 -- 2179' was measured in pixels against the 89 m pylon
          top and the water line: top chord meets the end post ~62 m up, bearings ~5 m up, pylon
          ~32 m along the bridge at deck level (34-35 m at the water, ~25 m under the cap), the
          end post ~14 m in front of the pylon's arch-side face, pylon-centre spacing / span = 1.12
          (matches [osm] 565 / 503), web diagonals running from the top chord DOWN toward the crown,
          bottom chord about twice as deep as the top chord, approach deck trusses ~15 m deep
          (Warren with verticals). The 1932 Lavender Bay postcard gives the pylon's across width
          (~0.42 of its along length, so ~14 m).
  [pub]   commonly published structure: 28 panels per arch truss, truss depth 57 m at the bearings
          and 18 m at the crown, trusses 30 m apart.

The race surface itself is the pipeline's bridge ribbon. The road is read from
game/public/tracks/sydney/track.json and every deck part is laid RELATIVE TO THE RACING SPLINE, so
the steel follows the ribbon exactly on the straight span and on the curved northern approach.
Nothing solid is placed on the racing surface between 0 and 2 m above it (see UNDER_ROAD).
The pylons' deck-level features (arched openings, balconies) are placed relative to the BUILT deck
(41.2 m, the real one is 49 m) so the player sees them where they belong; the arch, hangers and the
pylons' 89 m tops keep real elevations above the sea.

Authoring frame (build_landmark_tools): u across (east-ish), y up, v along the bridge (south).
Model y = 0 is world -0.5: the registered footprint crosses the harbour, and the game stands a
model on the lowest finished ground round its footprint, which over water is clamped to
water level + SHORE_CLAMP = -0.5 (pipeline/sr/terrain.py).

Run: Blender --background --python assets-src/landmarks/build_harbour_bridge.py [-- --render-dir DIR]
"""
import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model, ROOT

ID = 'harbour-bridge'
ROUTE = 'sydney'
BASE = -0.5                 # world elevation of the model's y = 0 (see docstring)

# Arch (published structure; elevations above mean sea level)
SPAN = 503.0
PANELS = 28
CROWN_TOP = 134.0           # top of the top chord at the crown
TOP_HALF = 1.0              # half in-plane depth of the top chord  [photo: about half the bottom chord]
BOT_HALF = 2.2              # half in-plane depth of the bottom chord (the main arch rib)
PIN_E = 4.0                 # bearing pin
END_DEPTH = 57.0            # truss depth at the bearings (pin to top chord)
CROWN_DEPTH = 18.0          # truss depth at the crown
TRUSS_LAT = 15.0            # arch truss planes: 30 m apart about the bridge axis
DECK_HALF = 24.4            # 48.8 m deck
PYLON_TOP = 89.0

# Deck, relative to the racing spline (positive = east of the southbound race lanes)
DECK_W, DECK_E = -28.9, 19.9            # deck edges (abs -24.4 .. +24.4 on the span)
LINE_W, LINE_E = -19.5, 10.5            # truss lines = barrier lines (abs -15 / +15 on the span)
RACE_CLEAR = 6.25                        # plates beside the ribbon start here (half width 6.0)
# The build slices the placed model at 0.3/1.0/1.8 m above EVERY road level within 2.5 m of the
# racing surface, so under the ribbon the first slice can be 1.9 m below it (2.0 m on the small
# humps of the built profile). Under the ribbon nothing rises above this depth below the datum.
UNDER_ROAD = 2.6
ROAD_EDGE = 6.4                          # |rel| below which that rule applies
TOP_GAP = 0.5                            # stringer/cross-girder tops below the road datum
APP_DEPTH = 15.0                         # approach deck-truss depth [photo], less where the ground is high
APP_CLEAR = 6.0                          # kept between an approach truss and the ground/roads under it
GIRDER = 5.5                             # cross-girder depth at the arch panel points [photo: deep deck band]

# Pylons [photo, card, osm]. E = real elevation above the sea (m).
PY_IN = 25.0                             # inner face, abs from the axis (just outside the 24.4 m deck edge)
PY_R = 0.9                               # recess of the tall central field between the corner piers
PY_D = 3.0                               # depth of the deck-level arched openings behind the field

PREP = r'''
import json, sys
import numpy as np
from shapely.geometry import Polygon, LineString, Point
from sr.geo import LocalFrame
from sr.routes import load_route
from sr.fetch_osm import load_layer
from sr.route import build_route
from sr.dem import DemSampler
spec = json.loads(sys.argv[1])
route = load_route('sydney')
frame = LocalFrame(route['origin']['lat'], route['origin']['lon'])
cx, cz = frame.to_local(np.array([spec['centre'][0]]), np.array([spec['centre'][1]]))
cx, cz = float(cx[0]), float(cz[0])
AX = np.array(spec['axis']); AC = np.array(spec['across'])
def uv(x, z):
    d = np.stack([np.asarray(x, float) - cx, np.asarray(z, float) - cz], -1)
    return d @ AC, d @ AX
def xz(u, v):
    u = np.asarray(u, float); v = np.asarray(v, float)
    return cx + u * AC[0] + v * AX[0], cz + u * AC[1] + v * AX[1]
dem = DemSampler()
def ground(u, v):
    x, z = xz(u, v); lat, lon = frame.to_latlon(np.atleast_1d(x), np.atleast_1d(z))
    return [float(h) for h in dem.heights(lat, lon)]
track = json.load(open('game/public/tracks/sydney/track.json'))
P = np.array(track['spline']['points']); S = np.array(track['spline']['s']); HW = np.array(track['spline']['halfWidth'])
res = build_route('sydney')
# the first bridged run only: the route has later, unrelated viaducts (the York Street off-ramp)
idx = np.flatnonzero(res.bridge)
brk = np.flatnonzero(np.diff(idx) > 3)
first = idx[:brk[0] + 1] if len(brk) else idx
s0, s1 = float(res.S[first[0]]), float(res.S[first[-1]])
m = (S >= s0 - 1e-6) & (S <= s1 + 1e-6)
u, v = uv(P[m, 0], P[m, 2])
spline = [[float(a), float(y), float(b), float(s), float(h)] for a, y, b, s, h in zip(u, P[m, 1], v, S[m], HW[m])]
pyl = {}
for e in load_layer('sydney', 'buildings')['elements']:
    if e['id'] in (156584774, 382401361):
        g = e['geometry']
        x, z = frame.to_local(np.array([p['lat'] for p in g]), np.array([p['lon'] for p in g]))
        c = Polygon(np.c_[x, z]).centroid
        pu, pv = uv(c.x, c.y)
        pyl['north' if e['id'] == 156584774 else 'south'] = [float(pu), float(pv)]
KEEP = {'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service', 'pedestrian',
        'living_street', 'motorway_link', 'trunk', 'footway', 'steps', 'cycleway'}
lines = []
for e in load_layer('sydney', 'roads')['elements']:
    t = e.get('tags', {})
    if e.get('type') != 'way' or t.get('highway') not in KEEP:
        continue
    if t.get('bridge') or t.get('tunnel') or str(t.get('layer', '0')) not in ('0', ''):
        continue
    g = e.get('geometry') or []
    if len(g) < 2:
        continue
    x, z = frame.to_local(np.array([p['lat'] for p in g]), np.array([p['lon'] for p in g]))
    a, b = uv(x, z)
    if np.min(np.abs(a)) > 150:
        continue
    w = 2.0 if t['highway'] in ('footway', 'steps', 'cycleway') else 5.0
    lines.append((LineString(np.c_[a, b]), w))
US = np.array([p[0] for p in spline]); VS = np.array([p[2] for p in spline]); SS = np.array([p[3] for p in spline])
def point(s):
    return np.interp(s, SS, US), np.interp(s, SS, VS)
def normal(s):
    a0, b0 = point(s - 2); a1, b1 = point(s + 2)
    t = np.array([a1 - a0, b1 - b0]); t /= np.linalg.norm(t)
    return np.array([t[1], -t[0]])
def columns(s, rels):
    a, b = point(s); n = normal(s)
    return [(a + n[0] * r, b + n[1] * r) for r in rels]
def clear(s, rels):
    worst = 1e9
    for cu, cv in columns(s, rels):
        for line, w in lines:
            worst = min(worst, line.distance(Point(cu, cv)) - w)
    return worst
def stations(sa, sb, span, rels):
    n = max(1, int(round((sb - sa) / span)))
    out = [sa]
    for k in range(1, n):
        nominal = sa + (sb - sa) * k / n
        best = nominal
        for shift in sorted(np.arange(-14, 14.1, 1.0), key=abs):
            if clear(nominal + shift, rels) > 3.5:
                best = nominal + shift; break
        out.append(float(best))
    out.append(sb)
    return out
def s_at_v(target):
    return float(np.interp(target, VS, SS))
RELS = json.loads(sys.argv[2])
vn, vs = pyl['north'][1], pyl['south'][1]
# approach trusses run right up to the pylons' landward faces (~16.5 m from the centres) [photo]
north = stations(s0, s_at_v(vn - 17.0), 51.0, RELS)
south = stations(s_at_v(vs + 17.0), s1, 53.0, RELS)
def span_info(stns):
    out = []
    for sa, sb in zip(stns, stns[1:]):
        ss = np.linspace(sa, sb, max(3, int((sb - sa) / 5.0) + 1))
        us, vs_ = [], []
        for s in ss:
            for cu, cv in columns(s, RELS + [0.0]):
                us.append(cu); vs_.append(cv)
        g = ground(us, vs_)
        out.append({'sa': sa, 'sb': sb, 'ground': max(g), 'datum': float(np.min(np.interp(ss, S, P[:, 1])))})
    return out
piers = []
for s in north + south:
    cols = columns(s, RELS)
    piers.append({'s': s, 'ground': ground([c[0] for c in cols], [c[1] for c in cols]),
                  'clear': clear(s, RELS)})
pylon_ground = {k: ground([c[0] - 31, c[0] + 31, c[0]], [c[1], c[1], c[1]]) for k, c in pyl.items()}
print(json.dumps(dict(spline=spline, pylons=pyl, north=north, south=south, piers=piers,
                      pylon_ground=pylon_ground, s0=s0, s1=s1,
                      north_spans=span_info(north), south_spans=span_info(south))))
'''


def prep(spec, rels):
    out = subprocess.check_output(
        [str(ROOT / 'pipeline/.venv/bin/python'), '-c', PREP,
         json.dumps(dict(centre=spec['centre'], axis=spec['axis'], across=spec['across'])), json.dumps(rels)],
        cwd=ROOT, env={**os.environ, 'PYTHONPATH': str(ROOT / 'pipeline')}, text=True)
    return json.loads(out)


def Y(E):
    return E - BASE


V = Vector
X_AX, Y_AX, Z_AX = V((1, 0, 0)), V((0, 1, 0)), V((0, 0, 1))


class Builder:
    def __init__(self, model):
        self.m = model

    # ------------------------------------------------------------------ primitives
    def hexa(self, label, c, mat, smooth=False):
        """Eight corners: bottom ring 0..3, top ring 4..7 (any consistent orientation). Thin bars are
        exported smooth: shared vertices halve their bytes and a 10 cm bar shows no shading seam."""
        self.m.mesh(label, [tuple(p) for p in c],
                    [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], mat, smooth)

    def obox(self, label, c, a, b, d, ha, hb, hd, mat):
        c = V(c)
        pts = [c + a * sa * ha + b * sb * hb + d * sd * hd
               for sd in (-1, 1) for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        self.hexa(label, pts, mat)

    def box(self, label, lo, hi, mat):
        lo, hi = V(lo), V(hi)
        if min(hi[i] - lo[i] for i in range(3)) <= 1e-4:
            return
        self.obox(label, (lo + hi) / 2, X_AX, Z_AX, Y_AX, (hi.x - lo.x) / 2, (hi.z - lo.z) / 2, (hi.y - lo.y) / 2, mat)

    def beam(self, label, p0, p1, side, w, h, mat, smooth=False):
        """Box from p0 to p1: `w` along `side` (made perpendicular), `h` along t x side."""
        p0, p1 = V(p0), V(p1)
        t = p1 - p0
        L = t.length
        if L < 1e-4:
            return
        t /= L
        s = V(side) - t * V(side).dot(t)
        if s.length < 1e-5:
            s = X_AX - t * X_AX.dot(t) if abs(t.x) < .9 else Y_AX - t * Y_AX.dot(t)
        s.normalize()
        q = t.cross(s)
        pts = [p + s * a * w / 2 + q * b * h / 2 for p in (p0, p1) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        self.hexa(label, pts, mat, smooth)

    def loft(self, label, sections, mat):
        """Closed sweep through 4-corner sections."""
        n = len(sections)
        verts = [tuple(p) for sec in sections for p in sec]
        faces = [(0, 1, 2, 3), tuple(4 * (n - 1) + k for k in (3, 2, 1, 0))]
        for i in range(n - 1):
            a, b = 4 * i, 4 * (i + 1)
            for k in range(4):
                faces.append((a + k, a + (k + 1) % 4, b + (k + 1) % 4, b + k))
        self.m.mesh(label, verts, faces, mat)

    def chord(self, label, pts, side, hw, hh, mat):
        """Mitred rectangular sweep through a polyline (arch chords, curved rails)."""
        pts = [V(p) for p in pts]
        secs = []
        for i, p in enumerate(pts):
            if i == 0:
                t = (pts[1] - pts[0]).normalized(); scale = 1
            elif i == len(pts) - 1:
                t = (pts[-1] - pts[-2]).normalized(); scale = 1
            else:
                a = (pts[i] - pts[i - 1]).normalized(); b = (pts[i + 1] - pts[i]).normalized()
                t = (a + b).normalized(); scale = 1 / max(.5, t.dot(b))
            s = V(side) - t * V(side).dot(t); s.normalize()
            q = t.cross(s)
            secs.append([p + s * a * hw + q * b * hh * scale for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        self.loft(label, secs, mat)

    def laced(self, label, p0, p1, side, ws, wq, mat, lace_mat=None, f=.32, bar=(.10, .22), pitch=1.8, battens=True):
        """Built-up latticed member: four corner angles, zigzag lacing on the two faces normal to
        `side`, batten plates at both ends. This is what makes the SHB steel read as riveted lattice."""
        p0, p1 = V(p0), V(p1)
        t = p1 - p0; L = t.length
        if L < 1e-3:
            return
        t /= L
        s = V(side) - t * V(side).dot(t); s.normalize()
        q = t.cross(s)
        es, eq = ws / 2 - f / 2, wq / 2 - f / 2
        for a in (-1, 1):
            for b in (-1, 1):
                off = s * a * es + q * b * eq
                self.beam(label, p0 + off, p1 + off, s, f, f, mat, True)
        lace_mat = lace_mat or mat
        n = max(2, int(round(L / pitch)))
        for a in (-1, 1):
            face = s * a * (ws / 2 - f * .45)
            for k in range(n):
                qa = eq * (1 if k % 2 == 0 else -1)
                pa = p0 + t * (L * k / n) + q * qa + face
                pb = p0 + t * (L * (k + 1) / n) - q * qa + face
                self.beam(label, pa, pb, s, bar[0], bar[1], lace_mat, True)
            if battens:
                for e in (0.0, 1.0):
                    c = p0 + t * (L * e + (.6 if e == 0 else -.6)) + s * a * (ws / 2 - .02)
                    self.obox(label, c, s, q, t, .05, wq / 2, .55, mat)

    def prism(self, label, outline2d, origin, h_axis, v_axis, n_axis, depth, mat):
        """Planar polygon (h, v) extruded `depth` along n_axis."""
        o = V(origin)
        pts = [tuple(o + h_axis * h + v_axis * vv) for h, vv in outline2d]
        self.m.shell(label, pts, tuple(n_axis * depth), mat)

    def arch_face(self, label, origin, h_axis, n_axis, h0, h1, y0, y1, oh0, oh1, sill, spring, depth, mat,
                  ring_mat=None, segments=10, ring=0.0, outer_at_origin=False):
        """A wall slab [h0,h1] x [y0,y1] with a round-headed opening [oh0,oh1] x [sill, spring+r],
        extruded `depth` along n_axis. The head is cut into voussoir wedges; `ring` > 0 adds a
        projecting archivolt of that width on the outer face."""
        va = Y_AX
        P = lambda h, y: (h, y)
        if oh0 > h0:
            self.prism(label, [P(h0, y0), P(oh0, y0), P(oh0, y1), P(h0, y1)], origin, h_axis, va, n_axis, depth, mat)
        if h1 > oh1:
            self.prism(label, [P(oh1, y0), P(h1, y0), P(h1, y1), P(oh1, y1)], origin, h_axis, va, n_axis, depth, mat)
        if sill > y0:
            self.prism(label, [P(oh0, y0), P(oh1, y0), P(oh1, sill), P(oh0, sill)], origin, h_axis, va, n_axis, depth, mat)
        r = (oh1 - oh0) / 2
        c = ((oh0 + oh1) / 2, spring)
        top = min(y1, spring + r + max(.6, r * .35))
        if top < spring + r:
            top = spring + r + .3
        for k in range(segments):
            a0 = math.pi * (1 - k / segments); a1 = math.pi * (1 - (k + 1) / segments)
            inner = [(c[0] + r * math.cos(a), c[1] + r * math.sin(a)) for a in (a0, a1)]

            def hit(a):
                dx, dy = math.cos(a), math.sin(a)
                cand = []
                if dx < -1e-9:
                    cand.append((oh0 - c[0]) / dx)
                if dx > 1e-9:
                    cand.append((oh1 - c[0]) / dx)
                if dy > 1e-9:
                    cand.append((top - c[1]) / dy)
                tt = min(x for x in cand if x > 0)
                return (c[0] + dx * tt, c[1] + dy * tt)
            o0, o1 = hit(a0), hit(a1)
            poly = [inner[0], inner[1], o1]
            corners = [(oh0, top), (oh1, top)]
            # a wedge whose rays land on two different edges keeps the corner between them
            for cx_, cy_ in corners:
                ang = math.atan2(cy_ - c[1], cx_ - c[0])
                if a1 < ang < a0:
                    poly.append((cx_, cy_))
            poly.append(o0)
            # order: inner0, inner1, outer1, [corner], outer0 -- convex, planar
            self.prism(label, [P(*p) for p in poly], origin, h_axis, va, n_axis, depth, mat)
        if y1 > top:
            self.prism(label, [P(oh0, top), P(oh1, top), P(oh1, y1), P(oh0, y1)], origin, h_axis, va, n_axis, depth, mat)
        if ring > 0:
            rm = ring_mat or mat
            for k in range(segments):
                a0 = math.pi * (1 - k / segments); a1 = math.pi * (1 - (k + 1) / segments)
                pts = [(c[0] + r * math.cos(a0), c[1] + r * math.sin(a0)), (c[0] + r * math.cos(a1), c[1] + r * math.sin(a1)),
                       (c[0] + (r + ring) * math.cos(a1), c[1] + (r + ring) * math.sin(a1)),
                       (c[0] + (r + ring) * math.cos(a0), c[1] + (r + ring) * math.sin(a0))]
                ro = V(origin) - n_axis * .2 if outer_at_origin else V(origin) + n_axis * (depth - .1)
                self.prism(label, [P(*p) for p in pts], ro, h_axis, va, n_axis, .3, rm)


def render_views(model, out_dir, views):
    import bpy
    from build_moffett_aircraft import xyz
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'game/public/models/landmarks' / (ID + '.glb')))
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 16
    scene.render.resolution_x = 1280; scene.render.resolution_y = 800
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes['Background']; bg.inputs[0].default_value = (.55, .66, .80, 1); bg.inputs[1].default_value = .7
    scene.view_settings.view_transform = 'AgX'
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 300))
    sun = bpy.context.object; sun.data.energy = 3.2; sun.data.angle = .1; sun.rotation_euler = (.75, .2, 2.4)
    bpy.ops.mesh.primitive_plane_add(size=8000, location=(0, 0, .5))
    water = bpy.data.materials.new('preview water'); water.diffuse_color = (.10, .22, .30, 1)
    water.use_nodes = True; water.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.08, .18, .26, 1)
    bpy.context.object.data.materials.append(water)
    for label, eye, target, lens in views:
        e = V(xyz(model.point(tuple(eye)))); g = V(xyz(model.point(tuple(target))))
        bpy.ops.object.camera_add(location=e); cam = bpy.context.object
        cam.rotation_euler = (g - e).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens; cam.data.clip_start = .1; cam.data.clip_end = 8000; scene.camera = cam
        scene.render.filepath = str(out_dir / (ID + '-' + label + '.png'))
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render-dir')
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    model = Model(ID)
    spec = model.spec
    data = prep(spec, [LINE_W, LINE_E])
    B = Builder(model)

    # [photo] daylight shots: a warm mid grey on the steel, buff/honey granite on the pylons
    model.material('steel', (.40, .40, .38), .55, .5, ID + '_steel')              # Harbour Bridge grey
    model.material('lace', (.35, .35, .33), .55, .55, ID + '_steel_lacing')
    model.material('web', (.24, .24, .23), .35, .75, ID + '_steel_web')              # rule 7 inner panel
    model.material('deck', (.20, .20, .21), 0, .95, ID + '_deck')
    model.material('granite', (.70, .63, .51), 0, .85, ID + '_granite')
    model.material('granite_dark', (.61, .55, .45), 0, .88, ID + '_granite_dressed')
    model.material('concrete', (.52, .51, .49), 0, .9, ID + '_concrete')
    model.material('ballast', (.30, .28, .26), 0, 1, ID + '_ballast')
    model.material('rail', (.33, .31, .29), .8, .45, ID + '_rail_steel')
    model.material('fence', (.34, .36, .37), .5, .55, ID + '_steel_fence')

    # -------------------------------------------------------------- racing spline
    SP = data['spline']                     # [u, y_world, v, s, halfWidth]
    SS = [p[3] for p in SP]

    import bisect

    def at(s):
        i = max(0, min(len(SP) - 2, bisect.bisect_right(SS, s) - 1))
        a, b = SP[i], SP[i + 1]
        f = (s - a[3]) / (b[3] - a[3])
        p = V((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f))
        t = V((b[0] - a[0], 0, b[2] - a[2])).normalized()
        return p, t

    def frame(s):
        """Road datum point (model y), unit tangent (horizontal), unit lateral (east of heading)."""
        p, _ = at(s)
        p0, _ = at(s - 2.0); p1, _ = at(s + 2.0)
        t = V((p1.x - p0.x, 0, p1.z - p0.z)).normalized()
        n = V((t.z, 0, -t.x))
        return V((p.x, Y(p.y), p.z)), t, n

    def off(s, rel, dy):
        p, t, n = frame(s)
        return p + n * rel + Y_AX * dy

    # simplified stations along the deck (Douglas-Peucker on u, y, v), plus fixed stations
    def simplify(idx, tol=.03):
        pts = [V((SP[i][0], SP[i][1], SP[i][2])) for i in idx]
        keep = {0, len(pts) - 1}
        stack = [(0, len(pts) - 1)]
        while stack:
            a, b = stack.pop()
            best, bi = 0, None
            ab = pts[b] - pts[a]
            for k in range(a + 1, b):
                ap_ = pts[k] - pts[a]
                d = (ap_ - ab * (ap_.dot(ab) / max(ab.length_squared, 1e-9))).length
                if d > best:
                    best, bi = d, k
            if bi is not None and best > tol:
                keep.add(bi); stack += [(a, bi), (bi, b)]
        return [SP[idx[k]][3] for k in sorted(keep)]

    s0, s1 = data['s0'], data['s1']
    deck_s = simplify(list(range(len(SP))))
    # stations never further apart than 40 m so long sweeps stay straight-sided on the flat span
    dense = []
    for a, b in zip(deck_s, deck_s[1:]):
        n = max(1, int(math.ceil((b - a) / 40.0)))
        dense += [a + (b - a) * k / n for k in range(n)]
    deck_s = dense + [deck_s[-1]]

    def strip(label, rel0, rel1, top, bot, mat, sa=None, sb=None, stations=None):
        """Deck-parallel slab between two offsets from the spline; `top`/`bot` relative to datum."""
        sa = s0 if sa is None else sa; sb = s1 if sb is None else sb
        st = stations or ([sa] + [s for s in deck_s if sa < s < sb] + [sb])
        secs = []
        for s in st:
            secs.append([off(s, rel0, bot), off(s, rel1, bot), off(s, rel1, top), off(s, rel0, top)])
        B.loft(label, secs, mat)

    # -------------------------------------------------------------- bridge frame
    pn, ps = data['pylons']['north'], data['pylons']['south']
    AXU = (pn[0] + ps[0]) / 2                     # bridge axis (u) -- the pylon centres
    VN, VS_ = pn[1], ps[1]
    VC = (VN + VS_) / 2                           # arch centre, midway between the pylon pairs
    HALF = SPAN / 2
    DECK_E_WORLD = SP[len(SP) // 3][1]            # datum on the span (flat in the built route)
    DECKY = Y(DECK_E_WORLD)
    print('bridge frame', AXU, VN, VS_, 'pylon spacing', VS_ - VN, 'deck', DECK_E_WORLD, flush=True)

    def E_top(x):
        t = x / HALF
        top_end = PIN_E + END_DEPTH
        return top_end + (CROWN_TOP - TOP_HALF - top_end) * (1 - t * t)

    def E_bot(x):
        t = x / HALF
        crown_b = CROWN_TOP - CROWN_DEPTH
        return PIN_E + (crown_b - PIN_E) * (1 - t * t)

    xs = [-HALF + SPAN * i / PANELS for i in range(PANELS + 1)]

    def T(i, side):
        return V((AXU + side * TRUSS_LAT, Y(E_top(xs[i])), VC + xs[i]))

    def Bt(i, side):
        return V((AXU + side * TRUSS_LAT, Y(E_bot(xs[i])), VC + xs[i]))

    clear_y = DECKY + 8.0                          # bracing between trusses only above this

    # ============================================================== ARCH TRUSSES
    for side in (-1, 1):
        lab = 'arch truss %s' % ('east' if side > 0 else 'west')
        top = [T(i, side) for i in range(PANELS + 1)]
        bot = [Bt(i, side) for i in range(PANELS + 1)]
        B.chord(lab + ' top chord', top, X_AX, 1.4, TOP_HALF, 'steel')
        B.chord(lab + ' bottom chord', bot, X_AX, 1.7, BOT_HALF, 'steel')
        # chord cover plates / top-chord walkway kerbs (the climb walkway on the top chord)
        for sgn in (-1, 1):
            B.chord(lab + ' top chord kerb', [p + V((sgn * 1.25, TOP_HALF + .25, 0)) for p in top], X_AX, .08, .25, 'lace')
            B.chord(lab + ' bottom chord flange', [p + V((sgn * 1.78, 0, 0)) for p in bot], X_AX, .08, BOT_HALF * .55, 'lace')
        # rule 7: dark inner web panel in the truss plane, members in front on both sides
        for i in range(PANELS):
            a, b = bot[i], bot[i + 1]; c, d = top[i + 1], top[i]
            a, b = a + V((0, BOT_HALF * .6, 0)), b + V((0, BOT_HALF * .6, 0))
            c, d = c - V((0, TOP_HALF * .6, 0)), d - V((0, TOP_HALF * .6, 0))
            w = V((.07, 0, 0))
            B.hexa(lab + ' web panel', [a - w, b - w, c - w, d - w, a + w, b + w, c + w, d + w], 'web')
        # verticals, end posts, diagonals
        for i in range(PANELS + 1):
            if i in (0, PANELS):
                # end post: pin to top chord end, a heavy closed member
                p0 = V((AXU + side * TRUSS_LAT, Y(PIN_E), VC + xs[i]))
                B.beam(lab + ' end post', p0, top[i] + V((0, TOP_HALF, 0)), X_AX, 3.4, 3.6, 'steel')
                for sgn in (-1, 1):
                    B.beam(lab + ' end post flange', p0 + V((sgn * 1.75, 0, 0)), top[i] + V((sgn * 1.75, 0, 0)), X_AX, .1, 3.9, 'lace')
                continue
            # [photo] the verticals are the broadest web members, about twice a diagonal in the truss plane
            B.laced(lab + ' vertical', bot[i] + V((0, BOT_HALF, 0)), top[i] - V((0, TOP_HALF, 0)), X_AX, 2.4, 2.6, 'steel', 'lace', pitch=2.4)
        for i in range(PANELS):
            # [photo] every diagonal runs from the top chord DOWN toward the crown: top chord at the
            # panel point nearer the bearing, bottom chord at the one nearer the crown ("\ /" at the crown)
            if i < PANELS // 2:
                p0, p1 = top[i] - V((0, TOP_HALF * .5, 0)), bot[i + 1] + V((0, BOT_HALF * .5, 0))
            else:
                p0, p1 = bot[i] + V((0, BOT_HALF * .5, 0)), top[i + 1] - V((0, TOP_HALF * .5, 0))
            B.laced(lab + ' diagonal', p0, p1, X_AX, 2.0, 1.5, 'steel', 'lace', pitch=2.6)
        # gusset plates at every panel point, both faces of both chords
        for i in range(PANELS + 1):
            for p, hh in ((top[i], TOP_HALF + .9), (bot[i], BOT_HALF + 1.1)):
                tt = ((top if p is top[i] else bot)[min(i + 1, PANELS)] - (top if p is top[i] else bot)[max(i - 1, 0)]).normalized()
                q = tt.cross(X_AX)
                for sgn in (-1, 1):
                    c = p + V((sgn * (1.75 if hh > 3 else 1.45), 0, 0))
                    B.obox(lab + ' gusset', c, X_AX, tt, q, .06, 2.4, hh, 'steel')
        # bearings: granite skewback and the steel shoe on the pin
        for i in (0, PANELS):
            v = VC + xs[i]
            sgn_v = -1 if i == 0 else 1
            u = AXU + side * TRUSS_LAT
            B.box(lab + ' skewback', (u - 6, 0, v - 7 + sgn_v * 3), (u + 6, Y(PIN_E) - 1.6, v + 7 + sgn_v * 3), 'granite')
            B.box(lab + ' skewback cap', (u - 6.4, Y(PIN_E) - 2.4, v - 7.4 + sgn_v * 3), (u + 6.4, Y(PIN_E) - 1.6, v + 7.4 + sgn_v * 3), 'granite_dark')
            B.box(lab + ' bearing shoe', (u - 2.4, Y(PIN_E) - 1.6, v - 3), (u + 2.4, Y(PIN_E) + .6, v + 3), 'steel')
            B.obox(lab + ' pin', V((u, Y(PIN_E), v)), X_AX, Y_AX, Z_AX, 2.6, .9, .9, 'steel')

    # ============================================================== BRACING BETWEEN TRUSSES
    for i in range(PANELS + 1):
        a, b = T(i, -1), T(i, 1)
        B.beam('top lateral strut', a, b, Y_AX, 1.3, 1.5, 'steel')
    for i in range(PANELS):
        B.beam('top lateral', T(i, -1), T(i + 1, 1), Y_AX, .9, .9, 'steel')
        B.beam('top lateral', T(i, 1), T(i + 1, -1), Y_AX, .9, .9, 'steel')
    for i in range(PANELS + 1):
        bl, br = Bt(i, -1), Bt(i, 1)
        above = bl.y - BOT_HALF > clear_y
        below = bl.y + BOT_HALF + 1.0 < DECKY - 3.0
        if not (above or below):
            continue
        B.laced('bottom lateral strut', bl, br, Y_AX, 1.5, 1.8, 'steel', 'lace', pitch=3.0, battens=False)
        if above:
            # sway frame: X between bottom and top chords at each panel point (seen from the road)
            tl, tr = T(i, -1), T(i, 1)
            B.laced('sway brace', bl + V((0, BOT_HALF, 0)), tr - V((0, TOP_HALF, 0)), Z_AX, 1.1, 1.3, 'steel', 'lace', pitch=3.0, battens=False)
            B.laced('sway brace', br + V((0, BOT_HALF, 0)), tl - V((0, TOP_HALF, 0)), Z_AX, 1.1, 1.3, 'steel', 'lace', pitch=3.0, battens=False)
    for i in range(PANELS):
        ok = all((Bt(k, -1).y - BOT_HALF > clear_y) or (Bt(k, -1).y + BOT_HALF + 1.0 < DECKY - 3.0) for k in (i, i + 1))
        same = (Bt(i, -1).y > DECKY) == (Bt(i + 1, -1).y > DECKY)
        if ok and same:
            B.beam('bottom lateral', Bt(i, -1), Bt(i + 1, 1), Y_AX, 1.0, 1.2, 'steel')
            B.beam('bottom lateral', Bt(i, 1), Bt(i + 1, -1), Y_AX, 1.0, 1.2, 'steel')
    # the two flagpoles on the summit
    for sgn in (-1, 1):
        base = V((AXU + sgn * 6.0, Y(CROWN_TOP) + .1, VC))
        B.beam('summit flagpole', base, base + V((0, 13.0, 0)), X_AX, .28, .28, 'fence')
        B.box('summit flagpole footing', base + V((-.7, -.4, -.7)), base + V((.7, .5, .7)), 'steel')

    # ============================================================== HANGERS AND SPANDREL POSTS
    for i in range(1, PANELS):
        s_here = None
        for side in (-1, 1):
            b = Bt(i, side)
            foot_y = DECKY - TOP_GAP - 3.0
            if b.y - BOT_HALF > DECKY + .5:
                # hanger: bottom chord to the cross girder under the deck
                B.laced('hanger', b - V((0, BOT_HALF, 0)), V((b.x, foot_y, b.z)), X_AX, .9, 1.9, 'steel', 'lace', f=.3, pitch=2.0)
            elif b.y + BOT_HALF < foot_y - .3:
                B.beam('spandrel post', b + V((0, BOT_HALF, 0)), V((b.x, foot_y, b.z)), X_AX, 1.6, 1.8, 'steel')
                for sgn in (-1, 1):
                    B.beam('spandrel post flange', b + V((sgn * .82, BOT_HALF, 0)), V((b.x + sgn * .82, foot_y, b.z)), X_AX, .08, 2.0, 'lace')

    # ============================================================== DECK
    # station of each arch panel point on the spline (the span is straight: match by v)
    def s_at_v(v):
        best = min(range(len(SP)), key=lambda k: abs(SP[k][2] - v))
        return SP[best][3]

    span_s = [s_at_v(VC + x) for x in xs]
    s_pyl_n, s_pyl_s = s_at_v(VN), s_at_v(VS_)
    # plates beside the ribbon, the plate under it (closes the underside), footway, cycleway, rail beds
    strip('deck plate west', DECK_W, -RACE_CLEAR, -.10, -.35, 'deck')
    strip('deck plate east', RACE_CLEAR, DECK_E, -.10, -.35, 'deck')
    strip('soffit plate under race lanes', -ROAD_EDGE, ROAD_EDGE, -UNDER_ROAD, -UNDER_ROAD - .2, 'deck')
    strip('footway', DECK_E - 2.9, DECK_E - .3, .12, -.10, 'concrete')
    strip('cycleway', DECK_W + .3, DECK_W + 2.6, .12, -.10, 'concrete')
    for rc in (-25.0, -21.4):
        strip('rail bed', rc - 1.5, rc + 1.5, .18, -.10, 'ballast')
        for g in (-.72, .72):
            strip('rail', rc + g - .04, rc + g + .04, .34, .18, 'rail')
    # kerbs at the deck edges and barriers on the truss lines
    for rel in (DECK_W + .15, DECK_E - .15):
        strip('edge kerb', rel - .15, rel + .15, .45, -.10, 'concrete')
    for rel in (LINE_W, LINE_E):
        strip('truss-line barrier', rel - .22, rel + .22, .85, -.10, 'steel')
        strip('truss-line barrier rail', rel - .08, rel + .08, 1.25, 1.05, 'fence')
    # edge girders (fascia) under both deck edges
    for rel in (DECK_W + .4, DECK_E - .4):
        # [photo] the deck edge reads as a deep band: fascia girder, and a bottom edge chord at the
        # foot of the cross girders on the arch span
        strip('edge girder', rel - .35, rel + .35, -.35, -3.6, 'steel')
        strip('edge girder flange', rel - .6, rel + .6, -3.45, -3.75, 'steel')
    for rel in (DECK_W + 1.2, DECK_E - 1.2):
        strip('deck bottom edge chord', rel - .45, rel + .45, -TOP_GAP - GIRDER + .9, -TOP_GAP - GIRDER - .1, 'steel',
              sa=span_s[0], sb=span_s[-1])
    # stringers
    for rel in (-26.0, -22.0, -16.5, -12.0, -7.5, 7.5, 13.5, 17.5):
        strip('stringer', rel - .25, rel + .25, -TOP_GAP, -TOP_GAP - 1.1, 'steel')
    for rel in (-4.0, 0.0, 4.0):
        strip('stringer under race lanes', rel - .25, rel + .25, -UNDER_ROAD - .2, -UNDER_ROAD - 1.0, 'steel')

    # high safety fences on both deck edges: posts, rails
    total = s1 - s0
    nposts = int(total / 4.0)
    for rel, lean in ((DECK_W + .05, -1), (DECK_E - .05, 1)):
        for k in range(nposts + 1):
            s = s0 + total * k / nposts
            p, t, n = frame(s)
            q0 = p + n * rel + Y_AX * .4
            q1 = q0 + Y_AX * 2.6 + n * lean * .25
            B.beam('edge fence post', q0, q1, t, .10, .14, 'fence', True)
        for h in (1.0, 1.9, 2.95):
            strip('edge fence rail', rel - .05 + lean * .1 * (h / 3), rel + .05 + lean * .1 * (h / 3), h + .05, h - .05, 'fence')

    # cross girders: arch panel points and between the pylons
    def cross_girder(s, depth, lab='cross girder'):
        """Full-width girder under the deck. Under the ribbon only the part deeper than UNDER_ROAD
        is kept (see UNDER_ROAD), so a shallow floor beam simply stops at the road edges."""
        p, t, n = frame(s)
        pieces = [(DECK_W + .6, -ROAD_EDGE, -TOP_GAP, -TOP_GAP - depth), (ROAD_EDGE, DECK_E - .6, -TOP_GAP, -TOP_GAP - depth)]
        if TOP_GAP + depth > UNDER_ROAD + .4:
            pieces.append((-ROAD_EDGE, ROAD_EDGE, -UNDER_ROAD, -TOP_GAP - depth))
        for r0, r1, top, bot in pieces:
            mid = (top + bot) / 2; d = top - bot
            a = p + n * r0 + Y_AX * mid
            b = p + n * r1 + Y_AX * mid
            B.beam(lab, a, b, t, .8, d, 'steel')
            for sgn in (-1, 1):
                # flanges stay inside the girder's depth
                B.beam(lab + ' flange', a + Y_AX * sgn * (d / 2 - .07), b + Y_AX * sgn * (d / 2 - .07), t, 1.3, .12, 'steel')
            if top == -TOP_GAP:
                k = int((r1 - r0 - 1.0) / 3.2)
                for j in range(k + 1):
                    c = p + n * (r0 + .5 + (r1 - r0 - 1.0) * j / max(k, 1)) + Y_AX * mid
                    B.obox(lab + ' stiffener', c, t, n, Y_AX, .55, .07, d / 2 - .05, 'lace')

    for k, s in enumerate(span_s):
        cross_girder(s, GIRDER)
    for k in range(len(span_s) - 1):
        # lateral X bracing in plan under the deck, between truss lines
        a0 = off(span_s[k], LINE_W, -TOP_GAP - 2.7); a1 = off(span_s[k + 1], LINE_E, -TOP_GAP - 2.7)
        b0 = off(span_s[k], LINE_E, -TOP_GAP - 2.7); b1 = off(span_s[k + 1], LINE_W, -TOP_GAP - 2.7)
        B.beam('deck lateral', a0, a1, Y_AX, .5, .5, 'steel')
        B.beam('deck lateral', b0, b1, Y_AX, .5, .5, 'steel')
        # intermediate cross girder at mid panel
        cross_girder((span_s[k] + span_s[k + 1]) / 2, 2.4, 'floor beam')
    for s in (s_pyl_n - 10, s_pyl_n, s_pyl_n + 10, s_pyl_s - 10, s_pyl_s, s_pyl_s + 10):
        cross_girder(s, 2.4)

    # ============================================================== PYLONS (granite-faced)
    # [photo] Each pylon is ONE battered granite tower from the abutment to the 89 m top: no podium,
    # no open lookout storey. Every face is framed by broad corner piers around a shallow recessed
    # central field; at deck level the field holds a round-headed arched opening with an archivolt,
    # a projecting balcony under it and a panel below that; the field is closed by a solid top band,
    # and the tower ends in a stepped, narrower flat cap. Under the deck an abutment block runs from
    # the pylon's arch-side face to just behind the bearing. The courses are built as separate,
    # slightly smaller blocks, so the batter reads as stepped ashlar coursing.
    ED = DECK_E_WORLD                                  # built deck elevation (feature datum)
    SILL = ED + 1.5                                    # opening sill just above the roadway [photo]
    OPEN_TOP = SILL + 11.5                             # opening zone: 10 m opening + archivolt band
    HEAD = 80.5                                        # top of the recessed field [photo]
    CAP = 85.0                                         # top of the tower body, cap above [photo]

    def lerp3(E, a, b, c):
        """Plan size at elevation E: a at the water, b at the deck, c under the cap."""
        if E <= ED:
            return a + (b - a) * max(E, 0.0) / ED
        return b + (c - b) * min(E - ED, CAP - ED) / (CAP - ED)

    def HV(E):                                          # half length along the bridge [photo]
        return lerp3(E, 17.4, 16.3, 12.6)

    def WA(E):                                          # across width [photo 1932: ~0.42 of the length]
        return lerp3(E, 15.2, 14.0, 11.0)

    def course(lab, lo, hi, mat, joint=True):
        """A course block with a 0.14 m joint recessed 0.12 m at its foot (reads as ashlar coursing)."""
        lo, hi = V(lo), V(hi)
        if joint and hi.y - lo.y > .6:
            B.box(lab, (lo.x + .12, lo.y, lo.z + .12), (hi.x - .12, lo.y + .14, hi.z - .12), mat)
            B.box(lab, (lo.x, lo.y + .14, lo.z), hi, mat)
        else:
            B.box(lab, lo, hi, mat)

    def plan(E, side, vc):
        hv, wa = HV(E), WA(E)
        a, b = AXU + side * PY_IN, AXU + side * (PY_IN + wa)
        return min(a, b), max(a, b), vc - hv, vc + hv

    def zones():
        """(E0, E1, kind) courses up the tower, course boundaries on the zone edges."""
        out = []
        for e0, e1, kind, step in ((BASE, SILL - 5.8, 'solid', 2.2), (SILL - 5.8, SILL, 'field', 1.45),
                                   (SILL, OPEN_TOP, 'open', 99), (OPEN_TOP, HEAD, 'field', 2.0),
                                   (HEAD, CAP, 'solid', 1.5)):
            n = max(1, int(math.ceil((e1 - e0) / step)))
            out += [(e0 + (e1 - e0) * k / n, e0 + (e1 - e0) * (k + 1) / n, kind) for k in range(n)]
        return out

    def pylon(vc, side, ground_e, arch_dir):
        lab = 'pylon'
        # ---- tower body, course by course
        for e0, e1, kind in zones():
            ulo, uhi, vlo, vhi = plan(e0, side, vc)
            y0, y1 = Y(e0), Y(e1)
            if kind == 'solid':
                course(lab + ' course', (ulo, y0, vlo), (uhi, y1, vhi), 'granite')
                continue
            inset = PY_R + (PY_D if kind == 'open' else 0.0)
            B.box(lab + ' core', (ulo + inset, y0, vlo + inset), (uhi - inset, y1, vhi - inset), 'granite')
            pl, pe = .21 * (vhi - vlo), .23 * (uhi - ulo)          # corner pier widths [photo]
            cu, cv = pe, pl          # any pocket left behind the walls is sealed and never seen
            for u0, u1 in ((ulo, ulo + cu), (uhi - cu, uhi)):
                for v0, v1 in ((vlo, vlo + cv), (vhi - cv, vhi)):
                    course(lab + ' corner pier', (u0, y0, v0), (u1, y1, v1), 'granite', joint=kind != 'open')
            if kind != 'open':
                continue
            # the arched openings, one in the field of every face
            for face_u, nrm in ((ulo, X_AX), (uhi, -X_AX)):           # long faces, wall extruded inward
                org = V((face_u + nrm.x * PY_R, 0, vc))
                B.arch_face(lab + ' opening wall', org, Z_AX, nrm, -(vhi - vlo) / 2 + pl - .05, (vhi - vlo) / 2 - pl + .05,
                            y0, y1, -2.75, 2.75, y0, y0 + 7.25, PY_D, 'granite', 'granite_dark',
                            segments=10, ring=.55, outer_at_origin=True)
            uc = (ulo + uhi) / 2
            for face_v, nrm in ((vlo, Z_AX), (vhi, -Z_AX)):           # end faces
                org = V((uc, 0, face_v + nrm.z * PY_R))
                hw = (uhi - ulo) / 2 - pe + .05
                B.arch_face(lab + ' opening wall', org, X_AX, nrm, -hw, hw, y0, y1, -2.0, 2.0, y0, y0 + 7.8,
                            PY_D, 'granite', 'granite_dark', segments=8, ring=.45, outer_at_origin=True)
        # ---- balconies under the openings, the panel below them and the field-head lintel
        def face_slabs(E):
            ulo, uhi, vlo, vhi = plan(E, side, vc)
            uc = (ulo + uhi) / 2
            return [(V((ulo, 0, vc)), -X_AX, Z_AX, 5.5, .58 * (vhi - vlo) / 2),
                    (V((uhi, 0, vc)), X_AX, Z_AX, 5.5, .58 * (vhi - vlo) / 2),
                    (V((uc, 0, vlo)), -Z_AX, X_AX, 4.0, .54 * (uhi - ulo) / 2),
                    (V((uc, 0, vhi)), Z_AX, X_AX, 4.0, .54 * (uhi - ulo) / 2)]

        def slab(label, o, n, h, hw, e0, e1, out0, out1, mat):
            """Box on a face: half width hw, from `out0` to `out1` metres proud of the face plane."""
            a = o + n * out0 - h * hw; b = o + n * out1 + h * hw
            B.box(label, (min(a.x, b.x), Y(e0), min(a.z, b.z)), (max(a.x, b.x), Y(e1), max(a.z, b.z)), mat)

        for o, n, h, w, fh in face_slabs(SILL - 1.45):
            slab(lab + ' balcony', o, n, h, w / 2 + 1.2, SILL - 1.1, SILL, -PY_R - .3, .6, 'granite_dark')
            slab(lab + ' balcony corbel', o, n, h, w / 2 + .6, SILL - 2.0, SILL - 1.1, -PY_R - .3, .15, 'granite_dark')
        for o, n, h, w, fh in face_slabs(SILL - 5.8):
            slab(lab + ' panel', o, n, h, w / 2 + .5, SILL - 5.3, SILL - 2.5, -PY_R - .1, -PY_R + .45, 'granite_dark')
        for o, n, h, w, fh in face_slabs(HEAD - 2.0):
            slab(lab + ' field lintel', o, n, h, fh + .05, HEAD - .9, HEAD, -PY_R - .1, -.35, 'granite_dark')
        # ---- string course at the top of the body, stepped narrower cap and the flat top [photo]
        ulo, uhi, vlo, vhi = plan(CAP, side, vc)
        uc, vcc = (ulo + uhi) / 2, (vlo + vhi) / 2
        hu, hv = (uhi - ulo) / 2, (vhi - vlo) / 2
        B.box(lab + ' cornice', (ulo - .35, Y(CAP - .7), vlo - .35), (uhi + .35, Y(CAP), vhi + .35), 'granite_dark')
        for e0, e1, f, pad in ((CAP, 86.9, .90, 0), (86.9, 88.5, .74, 0), (88.5, PYLON_TOP, .74, .25)):
            B.box(lab + ' cap', (uc - hu * f - pad, Y(e0), vcc - hv * f - pad), (uc + hu * f + pad, Y(e1), vcc + hv * f + pad),
                  'granite' if pad == 0 else 'granite_dark')
        # ---- ground-level doorway on the outer long face: portal jambs and hood proud of the wall,
        # so the door leaf sits 1.3 m deep between them [photo]
        gE = max(ground_e, 1.0)
        if gE + 9.0 < SILL - 6.0:
            ulo, uhi, _, _ = plan(gE, side, vc)
            face = uhi if side > 0 else ulo
            n = side
            for dv in (-3.4, 3.4):
                B.box(lab + ' portal jamb', (min(face, face + n * 1.3), Y(gE), vc + dv - .55),
                      (max(face, face + n * 1.3), Y(gE + 6.2), vc + dv + .55), 'granite_dark')
            B.box(lab + ' portal hood', (min(face, face + n * 1.9), Y(gE + 6.2), vc - 4.6),
                  (max(face, face + n * 1.9), Y(gE + 7.1), vc + 4.6), 'granite_dark')
        # ---- low abutment between the pylon's arch-side face and the skewbacks. [photo] Seen from the
        # side there is open sky / dark steel between the pylon and the end post all the way down to
        # the bearings, so the granite here stops at bearing level (ref: the hinge close-up shows the
        # pin shoe on a granite skewback with the pylon's ashlar right behind it).
        top_e = PIN_E - .4
        n = 2
        for k in range(n):
            e0 = BASE + (top_e - BASE) * k / n; e1 = BASE + (top_e - BASE) * (k + 1) / n
            ulo, uhi, _, _ = plan(e0, side, vc)
            ua = AXU + side * 9.0
            u0, u1 = min(ua, uhi if side > 0 else ulo), max(ua, uhi if side > 0 else ulo)
            if side > 0:
                u1 -= .8 * k
            else:
                u0 += .8 * k
            v0, v1 = sorted((vc + arch_dir * 12.0, vc + arch_dir * (33.0 - 1.2 * k)))
            course(lab + ' abutment', (u0, Y(e0), v0), (u1, Y(e1), v1), 'granite')

    gN = data['pylon_ground']['north']; gS = data['pylon_ground']['south']
    for vc, g, arch_dir in ((VN, gN, 1 if VS_ > VN else -1), (VS_, gS, -1 if VS_ > VN else 1)):
        pylon(vc, -1, g[0], arch_dir)
        pylon(vc, 1, g[1], arch_dir)

    # ============================================================== APPROACH VIADUCTS
    # [photo] Deck trusses about 15 m deep, Warren web with a vertical at every panel point, on
    # granite piers under both truss lines; the first span on each side runs into the pylon face.
    # Over high ground (The Rocks) a span is made shallower so it keeps APP_CLEAR above the ground.
    north, south = data['north'], data['south']
    piers = {round(p['s'], 3): p for p in data['piers']}

    def span_depths(info):
        out = []
        for sp in info:
            room = sp['datum'] - TOP_GAP - (sp['ground'] + APP_CLEAR)
            out.append(max(4.0, min(APP_DEPTH, room)))
        return out

    def approach(stations, lab, depths):
        for (sa, sb), D in zip(zip(stations, stations[1:]), depths):
            L = sb - sa
            npan = max(4, int(round(L / 8.5)))
            if npan % 2:
                npan += 1
            for rel in (LINE_W, LINE_E):
                tops, bots = [], []
                for k in range(npan + 1):
                    s = sa + L * k / npan
                    # straight chord between the two piers, in plan, at the datum of each station
                    pa, pb = off(sa, rel, 0), off(sb, rel, 0)
                    f = k / npan
                    base = pa + (pb - pa) * f
                    dat = off(s, rel, 0).y
                    tops.append(V((base.x, dat - TOP_GAP - .55, base.z)))
                    bots.append(V((base.x, dat - TOP_GAP - D + .6, base.z)))
                side = (tops[-1] - tops[0]).cross(Y_AX).normalized()
                B.chord(lab + ' top chord', tops, side, .55, .55, 'steel')
                B.chord(lab + ' bottom chord', bots, side, .55, .6, 'steel')
                for k in range(npan):
                    a, b, c, d = bots[k], bots[k + 1], tops[k + 1], tops[k]
                    w = side * .05
                    B.hexa(lab + ' web panel', [a - w, b - w, c - w, d - w, a + w, b + w, c + w, d + w], 'web')
                for k in range(npan + 1):
                    B.beam(lab + ' vertical', bots[k], tops[k], side, .7, .75, 'steel')
                    for sg in (-1, 1):
                        B.beam(lab + ' vertical flange', bots[k] + side * sg * .38, tops[k] + side * sg * .38, side, .06, 1.0, 'lace')
                for k in range(npan):
                    # Warren: diagonals alternate / \ / \ between the panel points
                    p0, p1 = (bots[k], tops[k + 1]) if k % 2 == 0 else (tops[k], bots[k + 1])
                    B.beam(lab + ' diagonal', p0, p1, side, .6, .7, 'steel')
                for k in (0, npan):
                    B.beam(lab + ' end post', bots[k], tops[k], side, .9, 1.1, 'steel')
            # floor beams at every panel point of the deck truss; cross frames at the piers
            for k in range(npan + 1):
                cross_girder(sa + L * k / npan, 1.2, 'floor beam')
            for s in (sa + .8, sb - .8):
                a, b = off(s, LINE_W, -UNDER_ROAD - .4), off(s, LINE_E, -UNDER_ROAD - .4)
                c, d = off(s, LINE_W, -TOP_GAP - D + .7), off(s, LINE_E, -TOP_GAP - D + .7)
                p, t, n = frame(s)
                B.beam(lab + ' cross frame', a, d, t, .45, .45, 'steel')
                B.beam(lab + ' cross frame', b, c, t, .45, .45, 'steel')
                B.beam(lab + ' cross frame', c, d, t, .55, .55, 'steel')
            # mid-span sway frame and bottom lateral X per span
            sm = (sa + sb) / 2
            B.beam(lab + ' sway strut', off(sm, LINE_W, -TOP_GAP - D + .7), off(sm, LINE_E, -TOP_GAP - D + .7), frame(sm)[1], .45, .45, 'steel')
            B.beam(lab + ' lateral', off(sa, LINE_W, -TOP_GAP - D + .6), off(sb, LINE_E, -TOP_GAP - D + .6), Y_AX, .4, .4, 'steel')
            B.beam(lab + ' lateral', off(sa, LINE_E, -TOP_GAP - D + .6), off(sb, LINE_W, -TOP_GAP - D + .6), Y_AX, .4, .4, 'steel')
        # granite piers under both truss lines at every interior station, abutments at the ends
        for k, s in enumerate(stations):
            end = k == 0 and lab.startswith('north') or k == len(stations) - 1 and lab.startswith('south')
            at_pylon = (k == len(stations) - 1 and lab.startswith('north')) or (k == 0 and lab.startswith('south'))
            if at_pylon:
                continue
            p, t, n = frame(s)
            info = piers.get(round(s, 3))
            near = [depths[j] for j in (k - 1, k) if 0 <= j < len(depths)]
            deep, shallow = max(near), min(near)
            top_y = p.y - TOP_GAP - deep - .2
            if end:
                # land abutment: a granite wall across the whole deck, kept UNDER_ROAD below the ribbon
                wall_top = p.y - TOP_GAP - .4
                for r0, r1, top in ((DECK_W - .5, -ROAD_EDGE, wall_top), (ROAD_EDGE, DECK_E + .5, wall_top),
                                    (-ROAD_EDGE, ROAD_EDGE, p.y - UNDER_ROAD - .2)):
                    a = p + n * r0; b = p + n * r1; c = (a + b) / 2
                    B.obox(lab + ' abutment', V((c.x, top / 2, c.z)), n, t, Y_AX, (b - a).length / 2, 2.5, top / 2, 'granite')
                    B.obox(lab + ' abutment coping', V((c.x, top - .4, c.z)), n, t, Y_AX, (b - a).length / 2 + .01, 2.9, .4, 'granite_dark')
                continue
            for j, rel in enumerate((LINE_W, LINE_E)):
                c = p + n * rel
                g = info['ground'][j] if info else 0.0
                gy = min(max(Y(g), 0.5), top_y - 3.0)
                hw_n, hw_t = 2.9, 2.5                   # [osm] approach piers are 6 x 5 m
                B.obox(lab + ' pier', V((c.x, top_y / 2, c.z)), n, t, Y_AX, hw_n, hw_t, top_y / 2, 'granite')
                B.obox(lab + ' pier plinth', V((c.x, (gy + 1.8) / 2, c.z)), n, t, Y_AX, hw_n + .5, hw_t + .5, (gy + 1.8) / 2, 'granite_dark')
                B.obox(lab + ' pier cap', V((c.x, top_y - .6, c.z)), n, t, Y_AX, hw_n + .6, hw_t + .6, .6, 'granite_dark')
                y = gy + 3.4
                while y < top_y - 2.5:
                    B.obox(lab + ' pier course', V((c.x, y, c.z)), n, t, Y_AX, hw_n + .1, hw_t + .1, .15, 'granite_dark')
                    y += 2.0
                # bearing shoes; a steel pedestal lifts the shallower truss onto the same pier
                B.obox(lab + ' bearing', V((c.x, top_y + .1, c.z)), n, t, Y_AX, .9, 1.2, .3, 'steel')
                if deep - shallow > .3:
                    h = deep - shallow
                    B.obox(lab + ' pedestal', V((c.x, top_y + .4 + h / 2, c.z)), n, t, Y_AX, .8, 1.0, h / 2, 'steel')

    nd, sd = span_depths(data['north_spans']), span_depths(data['south_spans'])
    print('approach depths north', [round(d, 1) for d in nd], 'south', [round(d, 1) for d in sd], flush=True)
    approach(north, 'north approach', nd)
    approach(south, 'south approach', sd)

    out_dir = Path(args.render_dir) if args.render_dir else None
    info = model.finish(directory=out_dir)
    if out_dir:
        # The shared preview cameras sit ~1.3 km out with Blender's default 100 m clip, which shows
        # nothing of a 1.4 km bridge; add perspective views from where the player and the harbour see it.
        views = []
        sm = s_at_v(VC - 150.0)
        p, t, n = frame(sm)
        views.append(('deck-chase', p + Y_AX * 2.2 - t * 5 + n * 0.0, p + t * 60 + Y_AX * 9.0, 28))
        p2, t2, n2 = frame(s_at_v(VS_ - 60.0))
        views.append(('deck-south-pylons', p2 + Y_AX * 2.2, p2 + t2 * 80 + Y_AX * 14, 24))
        p3, t3, n3 = frame(s_at_v(VC))
        views.append(('deck-crown-up', p3 + Y_AX * 2.0, p3 + t3 * 25 + Y_AX * 40, 16))
        views.append(('harbour-east', V((AXU + 900, Y(12), VC + 250)), V((AXU, Y(60), VC)), 35))
        views.append(('north-start', off(s0 + 3, 0, 2.2) - frame(s0 + 3)[1] * 5, off(s0 + 120, 0, 6.0), 24))
        views.append(('north-top', off(s0 + 130, 0, 400), off(s0 + 130, 0, 0) + V((0, 0, .01)), 30))
        views.append(('aerial', V((AXU + 700, Y(420), VC - 700)), V((AXU, Y(40), VC + 80)), 30))
        # the photo comparison views: the near-orthographic side view from the west (ref11), the
        # pylon pair from the harbour (ref06), and the deck-level approach into the south pylons
        views.append(('harbour-west', V((AXU - 1150, Y(8), VC + 60)), V((AXU, Y(62), VC)), 35))
        views.append(('pylon-close', V((AXU + 150, Y(20), VS_ - 150)), V((AXU + 30, Y(55), VS_)), 35))
        p4, t4, n4 = frame(s_at_v(VS_ + 120.0))
        views.append(('deck-south-approach', p4 + Y_AX * 2.2 - t4 * 6, p4 + t4 * 80 + Y_AX * 3, 28))
        render_views(model, out_dir, views)
    print('HB', json.dumps({k: info[k] for k in ('triangles', 'bytes', 'bounds')}), flush=True)
    print('HB stations', json.dumps(dict(north=north, south=south, clear=[round(p['clear'], 1) for p in data['piers']])), flush=True)


main()
