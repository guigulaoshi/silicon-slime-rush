"""National Museum of China (中国国家博物馆), east side of Tiananmen Square, Beijing.

Original model from public photographs (Wikimedia Commons, category "National Museum of China").
The famous face is the WEST facade toward the square (-X in the export frame):
  - central recessed portico: two rusticated stone pylons with stepped caps and low pyramids,
    between them ten tall square columns in front of a second row and a glazed hall wall,
    an intermediate beam with blank medallions, green glazed frieze with bronze brackets,
    amber glazed-tile eave, tall stone attic;
  - the 1959 wings and end ranges: three window storeys between pilasters, green frieze,
    glazed-tile eave and a low parapet, on a granite plinth;
  - the monumental front stair between stepped cheek blocks;
  - the 2011 extension rising behind, capped by the two-tier bronze roof with sloped fascia.
No text, emblem, flags or signage: every tablet and medallion is a blank panel.
Dimensions: footprint and 42.5 m height from pipeline/landmarks.json; storey heights, bays and
the portico proportions measured off the photos against the 329 m west facade.

Author frame: u east, y up, v south (Model's across/along axes for this footprint).
Run: cd world-tour && Blender --background --python assets-src/landmarks/build_national_museum.py
Optional: -- --render-dir <dir>
"""
import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_landmark_tools import Model

ID = 'national-museum'

# --- main dimensions (metres) -------------------------------------------------------------
WEST = -95.8          # pylon / portico front line (the footprint's west edge)
WING = -93.6          # wing stone-grid front, set back behind the pylons
PORTICO = 39.0        # portico inner half-width (pylons at +-39..55)
PYLON = 55.0
NORTH, SOUTH = -164.6, 164.6
RANGE_EAST = 61.0     # east end of the retained 1959 north/south ranges
NEW_W, NEW_E, NEW_V = -70.0, 105.0, 129.0   # 2011 extension block
NOTCH_E, NOTCH_V = 95.5, 31.0
FLOOR = 3.6           # portico terrace level
COL_TOP = 23.6
EAVE_TOP = 26.5       # wing glazed-eave top


class Face:
    """An axis-aligned wall line: s runs along it, d is measured outward from it."""

    def __init__(self, axis, plane, out):
        self.axis, self.plane, self.out = axis, plane, out

    def p(self, s, y, d):
        w = self.plane+self.out*d
        return (w, y, s) if self.axis == 'v' else (s, y, w)


def build(render_dir=None):
    m = Model(ID)
    for key, color, metal, rough in [
            ('stone', (.78, .76, .70), 0, .74),
            ('stone_base', (.56, .55, .52), 0, .80),
            ('carved', (.83, .80, .73), 0, .70),
            ('tile_yellow', (.60, .37, .10), 0, .34),
            ('tile_green', (.10, .34, .28), 0, .36),
            ('paint_red', (.38, .17, .07), 0, .55),
            ('bronze', (.33, .22, .11), .55, .50),
            ('glass', (.07, .15, .23), .40, .14),
            ('steel', (.24, .27, .29), .60, .40),
            ('aluminium', (.80, .81, .80), .35, .45),
            ('roof', (.36, .36, .35), 0, .85)]:
        m.material(key, color, metal, rough, ID+'_'+key)

    def box(label, u0, u1, y0, y1, v0, v1, mat):
        u0, u1 = sorted((u0, u1)); v0, v1 = sorted((v0, v1))
        m.box(label, ((u0+u1)/2, (y0+y1)/2, (v0+v1)/2), (u1-u0, y1-y0, v1-v0), mat)

    def fb(face, label, s0, s1, y0, y1, d0, d1, mat):
        a, b = face.p(s0, y0, d0), face.p(s1, y1, d1)
        box(label, a[0], b[0], y0, y1, a[2], b[2], mat)

    def frustum(label, bottom, y0, top, y1, mat):
        (a0, a1, b0, b1), (c0, c1, e0, e1) = bottom, top
        vs = [(a0, y0, b0), (a1, y0, b0), (a1, y0, b1), (a0, y0, b1),
              (c0, y1, e0), (c1, y1, e0), (c1, y1, e1), (c0, y1, e1)]
        m.mesh(label, vs, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat)

    def pyramid(label, u0, u1, v0, v1, y0, apex):
        uc, vc = (u0+u1)/2, (v0+v1)/2
        vs = [(u0, y0, v0), (u1, y0, v0), (u1, y0, v1), (u0, y0, v1), (uc, apex, vc)]
        m.mesh(label, vs, [(3, 2, 1, 0), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], 'stone')

    def glazed_eave(face, label, s0, s1, y_top, d_top, y_bot, d_bot, pitch=.38):
        """Glazed pent eave: concave slope, a rolled tile every `pitch`, ridge roll and drip roll."""
        tiles = max(1, round((s1-s0)/pitch)); nu = 4*tiles+1
        rows = []
        for t in (0, .5, 1):
            y = y_top+(y_bot-y_top)*t-.14*math.sin(math.pi*t)
            d = d_top+(d_bot-d_top)*t
            rows.append([face.p(s0+(s1-s0)*i/(nu-1), y+.075*(.5+.5*math.cos(i*math.pi/2)), d) for i in range(nu)])
        m.patch(label, rows, (0, -.2, 0), 'tile_yellow')
        m.tube(label+' ridge roll', [face.p(s0, y_top+.1, d_top-.05), face.p(s1, y_top+.1, d_top-.05)], .16, 'tile_yellow', 8)
        m.tube(label+' drip roll', [face.p(s0, y_bot-.02, d_bot), face.p(s1, y_bot-.02, d_bot)], .1, 'tile_yellow', 8)

    # ------------------------------------------------------------------------------------
    # 1959 wing facade grammar: plinth, three window storeys in pilastered bays, green frieze
    # with bronze brackets, red rafter band, glazed eave, set-back parapet.
    def wing_face(face, s0, s1, bay, win=3.6):
        n = max(1, round((s1-s0)/bay)); bay = (s1-s0)/n
        fb(face, 'Granite plinth', s0, s1, 0, 1.2, -.5, .55, 'stone_base')
        fb(face, 'Base course', s0, s1, 1.2, 1.45, -.5, .38, 'stone')
        # Openings: (y0, y1, width, mullion columns, transom fraction)
        rows = [(1.9, 4.3, 2.4, 1, None), (5.9, 12.1, win, 2, .68), (16.0, 22.0, win, 2, .7)]
        for i in range(n):
            c = s0+(i+.5)*bay
            # Piers between openings are the wall itself; spandrels close each bay above/below.
            fb(face, 'Wing pier', c+win/2, c+bay/2, 1.45, 23.8, -.5, 0, 'stone')
            fb(face, 'Wing pier', c-bay/2, c-win/2, 1.45, 23.8, -.5, 0, 'stone')
            for y0, y1 in [(1.45, 1.9), (4.3, 5.9), (12.1, 16.0), (22.0, 23.8)]:
                fb(face, 'Spandrel', c-win/2, c+win/2, y0, y1, -.5, 0, 'stone')
            fb(face, 'Ground window jamb', c-win/2, c-1.2, 1.9, 4.3, -.5, 0, 'stone')
            fb(face, 'Ground window jamb', c+1.2, c+win/2, 1.9, 4.3, -.5, 0, 'stone')
            for y0, y1, w, ncols, tr in rows:
                fb(face, 'Window glass', c-w/2, c+w/2, y0, y1, -.5, -.42, 'glass')
                for k in range(1, ncols+1):
                    x = c-w/2+w*k/(ncols+1)
                    fb(face, 'Mullion', x-.06, x+.06, y0, y1, -.42, -.34, 'steel')
                if tr:
                    fb(face, 'Transom', c-w/2, c+w/2, y0+(y1-y0)*tr-.06, y0+(y1-y0)*tr+.06, -.42, -.34, 'steel')
                if w > 3:
                    fb(face, 'Window sill', c-w/2-.25, c+w/2+.25, y0-.3, y0, -.5, .2, 'stone')
            # Green glazed frieze panel for the bay.
            fb(face, 'Glazed frieze panel', c-bay/2+.5, c+bay/2-.5, 24.0, 25.15, .2, .28, 'tile_green')
        for k in range(n+1):
            x = s0+k*bay
            fb(face, 'Pilaster', max(s0, x-.55), min(s1, x+.55), 1.45, 23.3, 0, .3, 'stone')
            fb(face, 'Pilaster base', max(s0, x-.7), min(s1, x+.7), 1.45, 2.1, 0, .42, 'stone')
            fb(face, 'Pilaster capital', max(s0, x-.72), min(s1, x+.72), 23.3, 23.8, 0, .46, 'stone')
            fb(face, 'Bronze eave bracket', max(s0, x-.3), min(s1, x+.3), 23.9, 25.3, .2, .62, 'bronze')
        fb(face, 'String course', s0, s1, 5.45, 5.75, 0, .16, 'stone')
        fb(face, 'String course', s0, s1, 15.55, 15.85, 0, .16, 'stone')
        fb(face, 'Frieze', s0, s1, 23.8, 25.35, -.5, .2, 'paint_red')
        fb(face, 'Painted rafter band', s0, s1, 25.2, 25.55, .1, 1.15, 'paint_red')
        glazed_eave(face, 'Wing glazed eave', s0, s1, EAVE_TOP, .1, 25.55, 1.5)
        fb(face, 'Parapet', s0, s1, 26.2, 27.3, -.85, -.3, 'stone')
        fb(face, 'Parapet coping', s0, s1, 27.3, 27.45, -.92, -.22, 'stone')

    # --- west wings (north and south of the portico), end pavilions, return ranges ---------
    for sgn in (-1, 1):
        end = NORTH if sgn < 0 else SOUTH
        a, b = sgn*PYLON, sgn*150.0
        wing_face(Face('v', WING, -1), min(a, b), max(a, b), 6.35)
        a2, b2 = sgn*150.0, end
        wing_face(Face('v', WING-.7, -1), min(a2, b2), max(a2, b2), 7.3)
        # Wing masses (flat roofs) behind the stone grid.
        box('West wing mass', WING+.5, NEW_W+.5, 0, 26.5, sgn*(PYLON-.5), sgn*(NEW_V+1), 'roof')
        box('End range mass', WING+.5, RANGE_EAST-.5, 0, 26.5, sgn*(NEW_V-.5), end-sgn*.5, 'roof')
        wing_face(Face('u', end, sgn), WING-.7, RANGE_EAST, 6.44)
        wing_face(Face('v', RANGE_EAST, 1), min(sgn*NEW_V, end), max(sgn*NEW_V, end), 7.1)
        # Low forecourt terrace along the wings.
        box('Wing forecourt terrace', WING-2.6, WING, 0, .9, sgn*62, end, 'stone_base')
        box('Terrace coping', WING-2.7, WING-2.3, .9, 1.05, sgn*62, end, 'stone')

    # --- pylons -------------------------------------------------------------------------
    for sgn in (-1, 1):
        v0, v1 = sorted((sgn*PORTICO, sgn*PYLON)); u0, u1 = WEST, -74.0

        def wrap(label, y0, y1, e, mat='stone'):
            box(label, u0-e, u1+e, y0, y1, v0-e, v1+e, mat)
        faces = [(Face('v', u0, -1), v0, v1), (Face('u', v0, -1), u0, u1), (Face('u', v1, 1), u0, u1)]
        wrap('Pylon core', 0, 33.2, -.12)
        wrap('Pylon plinth', 0, .9, .35, 'stone_base')
        y = .95
        while y+1.15 <= 27.4:
            wrap('Rusticated course', y, y+1.15, 0)
            y += 1.25
        wrap('Pylon string course', 27.35, 27.9, .3)
        wrap('Pylon upper ashlar', 27.9, 33.2, 0)
        fb(faces[0][0], 'Blank relief tablet', v0+2.5, v1-2.5, 29.0, 32.4, 0, .16, 'carved')
        wrap('Pylon frieze band', 33.2, 35.4, -.05)
        for face, s0, s1 in faces:
            n = round((s1-s0)/3.1)
            for k in range(n):
                c = s0+(k+.5)*(s1-s0)/n
                fb(face, 'Blank frieze panel', c-1.15, c+1.15, 33.5, 35.1, 0, .12, 'carved')
            n = round((s1-s0)/.75)
            for k in range(n):
                c = s0+(k+.5)*(s1-s0)/n
                fb(face, 'Dentil', c-.18, c+.18, 35.4, 35.8, 0, .38, 'stone')
        wrap('Pylon cornice bed', 35.4, 35.8, 0)
        wrap('Pylon cornice corona', 35.8, 36.9, 1.0)
        wrap('Pylon cornice cyma', 36.9, 37.3, .65)
        wrap('Pylon cap block', 37.3, 39.2, -1.0)
        wrap('Pylon cap cornice', 39.2, 39.6, -.55)
        wrap('Pylon top block', 39.6, 40.2, -1.6)
        pyramid('Pylon low pyramid', u0+1.9, u1-1.9, v0+1.9, v1-1.9, 40.2, 41.3)
        # Windows on the pylon's inner (portico) face, deep in the portico's shade.
        inner = Face('u', v0 if sgn > 0 else v1, -sgn)
        for y0 in (6.0, 13.0):
            for c in (-91.0, -85.0):
                fb(inner, 'Portico side window frame', c-1.5, c+1.5, y0-.3, y0+5.3, 0, .3, 'stone')
                fb(inner, 'Portico side window', c-1.2, c+1.2, y0, y0+5.0, .3, .38, 'glass')

    # --- portico --------------------------------------------------------------------------
    bay = 2*PORTICO/11
    cols = [-PORTICO+bay*k for k in range(1, 11)]
    # Monumental stair: 19 treads up to the terrace (20 risers of 0.18 m).
    for k in range(19):
        box('Front stair tread', WEST-(19-k)*.42, WEST, 0, (k+1)*.18, -44, 44, 'stone_base')
    box('Portico terrace', WEST, -79.5, 0, FLOOR, -PORTICO, PORTICO, 'stone_base')
    for sgn in (-1, 1):
        v0, v1 = sorted((sgn*44, sgn*62))
        box('Stair cheek block', WEST-8.4, WEST, 0, 2.4, v0, v1, 'stone_base')
        box('Stair cheek upper tier', WEST-5.2, WEST, 2.4, 3.9, v0+1.5 if sgn > 0 else v0, v1 if sgn > 0 else v1-1.5, 'stone_base')
        box('Cheek coping', WEST-8.55, WEST-5.0, 2.4, 2.6, v0-.15, v1+.15, 'stone')

    def column(label, uc, vc):
        a, n = 1.0, .16
        ring = [(-a+n, -a), (a-n, -a), (a-n, -a+n), (a, -a+n), (a, a-n), (a-n, a-n), (a-n, a), (-a+n, a),
                (-a+n, a-n), (-a, a-n), (-a, -a+n), (-a+n, -a+n)]
        m.shell(label, [(uc+x, FLOOR+.6, vc+z) for x, z in ring], (0, COL_TOP-.7-FLOOR-.6, 0), 'stone')
        box(label+' base', uc-1.3, uc+1.3, FLOOR, FLOOR+.35, vc-1.3, vc+1.3, 'stone')
        box(label+' base torus', uc-1.15, uc+1.15, FLOOR+.35, FLOOR+.6, vc-1.15, vc+1.15, 'stone')
        box(label+' capital neck', uc-1.1, uc+1.1, COL_TOP-.7, COL_TOP-.35, vc-1.1, vc+1.1, 'stone')
        box(label+' capital abacus', uc-1.25, uc+1.25, COL_TOP-.35, COL_TOP, vc-1.25, vc+1.25, 'stone')

    front_u, back_u, hall_u = WEST+1.0, -87.4, -79.0
    for vc in cols:
        column('Portico front column', front_u, vc)
        column('Portico second-row column', back_u, vc)
        box('Coffer beam', front_u-.5, back_u+.5, COL_TOP-1.1, COL_TOP, vc-.5, vc+.5, 'stone')
        box('Coffer beam', back_u, hall_u, COL_TOP-1.1, COL_TOP, vc-.5, vc+.5, 'stone')
        box('Bronze column bracket', WEST-.45, WEST, COL_TOP+.05, 25.75, vc-.5, vc+.5, 'bronze')
    edges = [-PORTICO]+cols+[PORTICO]
    for a, b in zip(edges, edges[1:]):
        a0, b0 = a+(1.0 if a != -PORTICO else 0), b-(1.0 if b != PORTICO else 0)
        c = (a+b)/2
        box('Intermediate beam', WEST+.2, WEST+1.8, 20.3, 21.3, a0, b0, 'stone')
        box('Blank medallion', WEST+.35, WEST+.75, 21.3, 23.2, c-.85, c+.85, 'carved')
        box('Second-row beam', back_u-.8, back_u+.8, 16.6, 17.4, a0, b0, 'stone')
        box('Glazed frieze panel', WEST-.08, WEST, 23.9, 25.5, a0+.55, b0-.55, 'tile_green')
    # Portico ceiling, frieze, eave and attic.
    box('Portico ceiling', WEST+.3, hall_u, COL_TOP, 24.6, -PORTICO, PORTICO, 'stone')
    box('Portico frieze', WEST, WEST+2.2, COL_TOP, 25.9, -PORTICO, PORTICO, 'paint_red')
    box('Portico rafter band', WEST-1.2, WEST, 25.75, 26.1, -PORTICO, PORTICO, 'paint_red')
    glazed_eave(Face('v', WEST, -1), 'Portico glazed eave', -PORTICO, PORTICO, 27.55, -.5, 26.1, 1.55)
    box('Portico attic', WEST+.6, -74.0, 25.9, 32.5, -PORTICO, PORTICO, 'stone')
    box('Attic coping', WEST+.3, -74.0, 32.5, 32.9, -PORTICO, PORTICO, 'stone')
    box('Attic base course', WEST+.45, WEST+.6, 27.6, 28.0, -PORTICO, PORTICO, 'stone')
    for vc in cols:
        box('Blank attic tablet', WEST+.42, WEST+.6, 28.7, 30.9, vc-.7, vc+.7, 'carved')
    box('Blank central attic panel', WEST+.4, WEST+.6, 28.4, 31.9, -6, 6, 'carved')
    for vc in [-33, -24, -15, -6, 6, 15, 24, 33]:
        m.tube('Attic flagpole (no flag)', [(-92.5, 32.9, vc), (-92.5, 41.0, vc)], .09, 'steel', 8)
    # The glazed hall wall behind the columns, with white stone frames.
    box('Hall glass wall', hall_u, hall_u+.3, FLOOR, 19.4, -PORTICO, PORTICO, 'glass')
    n = 11
    for k in range(n+1):
        vc = -PORTICO+2*PORTICO*k/n
        box('Hall wall frame', hall_u-.35, hall_u, FLOOR, 19.4, vc-.3, vc+.3, 'stone')
    for y0 in (FLOOR, 12.0, 15.6):
        box('Hall wall transom', hall_u-.35, hall_u, y0, y0+.6, -PORTICO, PORTICO, 'stone')
    box('Hall wall lintel', hall_u-.2, hall_u+.3, 19.4, COL_TOP, -PORTICO, PORTICO, 'stone')
    box('West hall mass', hall_u+.3, NEW_W+.5, 0, 27.6, -PORTICO, PORTICO, 'roof')

    # --- 2011 extension -----------------------------------------------------------------
    box('Extension mass', NEW_W, NOTCH_E, 0, 36.5, -NEW_V, NEW_V, 'roof')
    for sgn in (-1, 1):
        box('Extension mass', NOTCH_E-.5, NEW_E, 0, 36.5, sgn*NOTCH_V, sgn*NEW_V, 'roof')

    def louvre_band(face, s0, s1, y0, y1):
        """Glazed clerestory above the old roofs, screened by horizontal aluminium louvres."""
        fb(face, 'Clerestory glass', s0, s1, y0, y1, -.1, 0, 'glass')
        y = y0+.5
        while y < y1-.3:
            fb(face, 'Aluminium louvre', s0, s1, y, y+.16, 0, .55, 'aluminium')
            y += .75
        n = round((s1-s0)/7.5)
        for k in range(n+1):
            x = s0+(s1-s0)*k/n
            fb(face, 'Louvre fin', max(s0, x-.2), min(s1, x+.2), y0, y1, 0, .6, 'steel')

    def modern_face(face, s0, s1, y0, y1):
        """New-building stone facade: tall stone fins, recessed glass slots, glazed ground floor."""
        n = max(1, round((s1-s0)/3.0)); w = (s1-s0)/n
        for k in range(n):
            c = s0+(k+.5)*w
            fb(face, 'Stone fin', c-w/2, c+w/2-.9, y0+6.5, y1-.8, -.2, .35, 'stone')
            fb(face, 'Glass slot', c+w/2-.9, c+w/2, y0+6.5, y1-.8, -.2, -.12, 'glass')
            fb(face, 'Ground-floor pier', c-w/2, c-w/2+.7, y0, y0+6.2, -.2, .35, 'stone')
        fb(face, 'Ground-floor glazing', s0, s1, y0, y0+6.2, -.2, -.12, 'glass')
        fb(face, 'Glass slot head band', s0, s1, y1-.8, y1, -.2, .35, 'stone')
        fb(face, 'Ground-floor lintel', s0, s1, y0+6.2, y0+7.0, -.2, .45, 'stone')

    louvre_band(Face('v', NEW_W, -1), -NEW_V, NEW_V, 26.5, 36.5)
    for sgn in (-1, 1):
        f = Face('u', sgn*NEW_V, sgn)
        louvre_band(f, NEW_W, RANGE_EAST, 26.5, 36.5)
        modern_face(f, RANGE_EAST, NEW_E, 0, 36.5)
        modern_face(Face('v', NEW_E, 1), min(sgn*NOTCH_V, sgn*NEW_V), max(sgn*NOTCH_V, sgn*NEW_V), 0, 36.5)
        modern_face(Face('u', sgn*NOTCH_V, -sgn), NOTCH_E, NEW_E, 0, 36.5)
    modern_face(Face('v', NOTCH_E, 1), -NOTCH_V, NOTCH_V, 0, 36.5)
    box('East entrance bronze canopy', NOTCH_E, NEW_E-.3, 13.0, 14.2, -NOTCH_V+.3, NOTCH_V-.3, 'bronze')

    # Two-tier bronze roof: sloped fascias, recessed glazed band between the tiers,
    # louvres in the recess. Its top is the building's 42.5 m.
    rect = (NEW_W, NEW_E, -NEW_V, NEW_V)

    def grow(r, e):
        return (r[0]-e, r[1]+e, r[2]-e, r[3]+e)

    def ring(label, g, y0, y1, w, mat):
        for (ua, ub, va, vb) in [(g[0], g[0]+w, g[2], g[3]), (g[1]-w, g[1], g[2], g[3]),
                                 (g[0], g[1], g[2], g[2]+w), (g[0], g[1], g[3]-w, g[3])]:
            box(label, ua, ub, y0, y1, va, vb, mat)
    frustum('Lower bronze roof tier', grow(rect, 0), 36.5, grow(rect, 2.5), 38.3, 'bronze')
    g = grow(rect, -.5)
    box('Recessed band between roof tiers', g[0], g[1], 38.3, 39.3, g[2], g[3], 'glass')
    frustum('Upper bronze roof tier', grow(rect, 1.0), 39.3, grow(rect, 6.5), 42.5, 'bronze')
    for y0 in (38.45, 38.85):
        ring('Roof-band louvre', grow(rect, 1.2), y0, y0+.15, .3, 'aluminium')
    # Underside ribs of the upper overhang (a banded soffit seen from the square).
    for k in range(1, 5):
        ring('Bronze soffit rib', grow(rect, 1.0+5.5*k/5-.1), 39.3+3.2*k/5-.4, 39.3+3.2*k/5, .3, 'bronze')

    directory = Path(render_dir) if render_dir else None
    return m.finish(directory)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--render-dir')
    build(parser.parse_args(argv).render_dir)
