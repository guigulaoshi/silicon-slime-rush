"""Tomb of Sultan Ahmed I (Sultan Ahmet Turbesi, 1617-19) and its enclosure, north corner of the Blue Mosque
complex -- route `istanbul`.

Fact card
  OSM object     way 103953125 (historic=tomb, Q114749), 72 x 26 m.  It is not the tomb alone: resampling the
                 satellite imagery into the model frame shows, from north-east to south-west, the tomb with its
                 portico, a smaller domed hall, a flat-roofed block and a building with a red tiled hip roof.  The
                 tomb's low marble enclosure (the wall with grilled windows along the road and in front of the
                 portico, and a corner pavilion with a tiled roof) lies just outside the mapped outline.
  Height         ~21.9 m to the top of the alem [photo estimates, scaled to the 17 m body taken from the
                 imagery: Istanbul_Oct_2019_12_23 (the north-west face from the road), Mausoleum_of_Sultan_Ahmed_I,
                 Tomb_of_Ahmed_I_Fatih: body 12 m to the cornice, drum 1.5 m, dome 13.6 m across rising 5 m,
                 alem ~3.2 m].  No published height found.
  Plan           a square marble tomb (17 x 17 m) under one lead dome on a sixteen-sided drum; a three-bay
                 portico on its north-east side with pointed arches in red and white voussoirs, three small
                 domes and a broad flat eave with a painted soffit; two tiers of windows on every free face
                 (rectangular grilled lights under relieving arches below, tall pointed lattice windows above).
  Seen from      the race line runs 8-12 m off the complex's north-west side for 70 m, heading north-east: the
                 driver sees the enclosure wall with its grilled windows, the tomb's north-west face rising
                 behind it with the dome and alem, the corner pavilion and the portico's eave at the far end,
                 then turns past the portico side toward Hagia Sophia.
  Road clearance the enclosure's north-west line is drawn 3 m inside where the imagery puts it (u -16 instead
                 of about -19/-20): the game's road is 12 m wide there, wider than the real lane, and the wall
                 would otherwise stand on it.
  Parts a local would name
    - the lead dome with standing seams, on its drum with round windows, and the gilded alem ... built
    - the marble body, two tiers of windows (grilled lower lights, lattice upper windows) ..... built
    - the muqarnas cornice under the drum ......................................................... built
    - the portico: three pointed arches in red-and-white voussoirs, columns, three small domes .. built
    - the broad eave (sachak) with its red-brown painted soffit ....................................... built
    - the portal into the tomb under the portico ...................................................... built
    - the low enclosure wall with big grilled windows and its gate ................................... built
    - the corner pavilion with the tiled hip roof ....................................................... built
    - the domed hall south-west of the tomb ........................................................... built
      (its identity is not verified -- probably the complex's Quran school; its form is from the imagery)
    - the flat-roofed block and the tiled building at the south-west end of the outline .............. built
    - the graves in the enclosed garden ................................................................ not built:
      hidden behind the 4.6 m enclosure wall
    - the calligraphic panels and the tiles inside ................................................... not built:
      interior / text
  Style grammar  (classical Ottoman): pointed arches, ablaq voussoirs, muqarnas cornice, lead domes on drums,
                 grilled lower windows, pierced lattice upper windows, flat projecting eaves -- built.
  Unverified     the annex's use; the heights of every part (photo ratios); the enclosure's exact line.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sultanahmet_kit import Kit, SF, TAU, face_frames, rect, arch  # noqa: E402

ID = 'tomb-of-ahmed-i'
K = Kit(ID, ['marble', 'stone', 'stone_red', 'carved', 'lead', 'gold', 'glass', 'iron', 'wood', 'tile', 'soffit'],
        extra={'tile': ((0.42, 0.15, 0.08), 0.0, 0.75),          # weathered red tiles [photo 12_45]
               'soffit': ((0.22, 0.07, 0.04), 0.0, 0.7)})      # the eave's dark red-brown paint [photos]

# ------------------------------------------------------------------ plan (model frame: u + = south-east, away from
# the road; v + = south-west, down the Hippodrome)
TU0, TU1, TV0, TV1 = -13.2, 3.8, -28.0, -11.0          # the tomb's body [imagery: dome centre (-4.7, -19.5)]
BODY_TOP = 12.0
WALL = 1.0                                             # wall thickness: windows are real recesses
PV0 = -35.3                                            # the portico's front
ENC_U = -16.0                                          # the enclosure's road-side face (see card)
ENC_H = 4.6


def tier_windows(fr, half, n, x_skip=()):
    """Two tiers of windows across a wall of half-length `half` (frame x from -half to half)."""
    step = 2 * half / n
    xs = [-half + step * (i + 0.5) for i in range(n)]
    xs = [x for x in xs if all(abs(x - s) > 0.8 for s in x_skip)]
    lower = [dict(c=x, w=1.3, sill=1.25, ys=3.55, kind='pointed') for x in xs]
    upper = [dict(c=x, w=1.3, sill=5.3, ys=8.3, kind='pointed') for x in xs]
    K.arched_wall(fr, -half, half, 0.6, 4.7, -WALL, 0.0, lower, 'marble')
    K.arched_wall(fr, -half, half, 4.7, 10.3, -WALL, 0.0, upper, 'marble')
    K.prism(fr, rect(-half, half, 10.3, BODY_TOP - 0.55), -WALL, 0.0, 'marble')
    for o in lower:
        K.window(fr, o['c'], o['w'], o['sill'], o['ys'], -WALL, 0.0, 'lower', mats=('marble', 'stone_red'), wall='marble')
    for o in upper:
        K.window(fr, o['c'], o['w'], o['sill'], o['ys'], -WALL, 0.0, 'lattice', wall='marble')
    K.string_course(fr, -half - 0.1, half + 0.1, 4.7, h=0.24, proj=0.1, mat='marble')
    return xs


# ------------------------------------------------------------------ the tomb's body
K.box(TU0 + WALL, TU1 - WALL, 0.0, BODY_TOP, TV0 + WALL, TV1 - WALL, 'marble')          # core
F = face_frames(TU0, TU1, TV0, TV1)
for key in ('-u', '+u', '+v', '-v'):
    fr, half = F[key]
    K.prism(fr, rect(-half - 0.15, half + 0.15, 0.0, 0.6), -WALL, 0.15, 'marble')        # plinth course
    if key == '-v':
        # the portico wall: the portal in the middle, one window tier each side
        K.prism(fr, rect(-half, half, 0.6, BODY_TOP - 0.55), -WALL, 0.0, 'marble')
        K.prism(fr, rect(-1.6, 1.6, 0.0, 5.2), 0.0, 0.25, 'marble')                      # portal frame
        K.prism(fr, rect(-0.85, 0.85, 0.0, 3.2), 0.25, 0.3, 'wood')                      # doors
        K.voussoirs(fr, dict(c=0.0, w=2.2, sill=0.0, ys=3.3, kind='pointed'), 0.25, band=0.3, k=10, proud=0.05,
                    mats=('marble', 'stone_red'))
        for x in (-5.5, 5.5):
            K.prism(fr, rect(x - 0.7, x + 0.7, 1.25, 3.3), -0.05, 0.02, 'glass')
            K.voussoirs(fr, dict(c=x, w=1.4, sill=1.25, ys=3.3, kind='pointed'), 0.0, band=0.3, k=8, mats=('marble', 'stone_red'))
    else:
        tier_windows(fr, half, 5)
    K.cornice(fr, -half, half, BODY_TOP, proj=0.55, mat='marble', muq=True)

# roof of the square, the corner slopes up to the drum, the drum, the dome
K.box(TU0 + 0.2, TU1 - 0.2, BODY_TOP - 0.05, BODY_TOP + 0.15, TV0 + 0.2, TV1 - 0.2, 'lead')
DC = ((TU0 + TU1) / 2, (TV0 + TV1) / 2)
DRUM_A, DRUM_TOP = 7.05, BODY_TOP + 1.55
for su in (-1, 1):
    for sv in (-1, 1):
        cu, cv = DC[0] + su * 8.3, DC[1] + sv * 8.3
        K.pyramid([(cu, cv), (cu - su * 4.8, cv), (cu, cv - sv * 4.8)], BODY_TOP + 0.1,
                  (cu - su * 2.3, BODY_TOP + 1.25, cv - sv * 2.3), 'lead')
K.poly_drum(DC, DRUM_A, 16, BODY_TOP, DRUM_TOP, 0.8, mat='marble', glaze=False, phase=math.pi / 16)
for i in range(16):
    a = math.pi / 16 + TAU * i / 16
    fr = SF((DC[0] + DRUM_A * math.cos(a), DC[1] + DRUM_A * math.sin(a)), (-math.sin(a), math.cos(a)), (math.cos(a), math.sin(a)))
    ring = [(0.42 * math.cos(TAU * k / 14), BODY_TOP + 0.78 + 0.42 * math.sin(TAU * k / 14)) for k in range(14)]
    K.prism(fr, ring, -0.03, 0.02, 'glass')
    K.prism(fr, [(0.52 * math.cos(TAU * k / 14), BODY_TOP + 0.78 + 0.52 * math.sin(TAU * k / 14)) for k in range(14)], -0.01, 0.0, 'carved')
    for bx in (-0.2, 0.0, 0.2):
        K.prism(fr, rect(bx - 0.025, bx + 0.025, BODY_TOP + 0.4, BODY_TOP + 1.16), 0.02, 0.05, 'marble')
R_DRUM = DRUM_A / math.cos(math.pi / 16)
K.revolve(DC, [(R_DRUM - 0.3, DRUM_TOP - 0.02), (R_DRUM + 0.25, DRUM_TOP - 0.02), (R_DRUM + 0.25, DRUM_TOP + 0.2),
               (0.0, DRUM_TOP + 0.2)], 16, 'marble', smooth=False, phase=math.pi / 16)
DOME_R, DOME_RISE = 6.8, 5.0
K.dome(DC, DOME_R, DRUM_TOP + 0.2, DOME_RISE, 'lead', sides=64, rings=14, ribs=32, rib_r=0.05)
K.alem(DC, DRUM_TOP + 0.2 + DOME_RISE - 0.08, 1.4)

# ------------------------------------------------------------------ the portico
PF = face_frames(TU0, TU1, PV0, TV0)
fr, half = PF['-v']                                     # the front, facing north-east (x = -u)
bays = 3
step = 2 * half / bays
ops = [dict(c=-half + step * (i + 0.5), w=step - 1.0, sill=0.0, ys=3.9, kind='pointed') for i in range(bays)]
PORT_TOP = 7.35
K.arched_wall(fr, -half, half, 0.0, PORT_TOP, -0.8, 0.0, ops, 'marble', n=8)
for o in ops:
    K.voussoirs(fr, o, 0.0, band=0.42, k=14, proud=0.06, mats=('marble', 'stone_red'))
for i in range(bays + 1):                               # columns with muqarnas capitals, in front of the piers
    x = -half + step * i
    x = max(-half + 0.45, min(half - 0.45, x))
    c = fr.p(x, 0.0, 0.2)[::2]
    K.cylinder(c, 0.36, 0.3, 3.4, 16, 'marble')
    K.box(c[0] - 0.46, c[0] + 0.46, 0.0, 0.3, c[1] - 0.46, c[1] + 0.46, 'marble')
    K.revolve(c, [(0.36, 3.4), (0.42, 3.55), (0.55, 3.9), (0.55, 4.0), (0.0, 4.0)], 8, 'carved', smooth=False, phase=math.pi / 8)
# the portico's north-west end (toward the road) is an open arch; its south-east end a wall
fr_nw, h_nw = PF['-u']
o = dict(c=0.0 - 0.4, w=4.3, sill=0.0, ys=3.9, kind='pointed')
K.arched_wall(fr_nw, -h_nw, h_nw, 0.0, PORT_TOP, -0.8, 0.0, [o], 'marble', n=8)
K.voussoirs(fr_nw, o, 0.0, band=0.42, k=14, proud=0.06, mats=('marble', 'stone_red'))
fr_se, h_se = PF['+u']
K.prism(fr_se, rect(-h_se, h_se, 0.0, PORT_TOP), -0.8, 0.0, 'marble')
# floor, ceiling slab, the three small domes
K.box(TU0, TU1, 0.0, 0.3, PV0, TV0, 'marble')
K.box(TU0, TU1, PORT_TOP - 0.4, PORT_TOP, PV0, TV0, 'marble')
K.box(TU0 - 0.05, TU1 + 0.05, PORT_TOP, PORT_TOP + 0.15, PV0 - 0.05, TV0, 'lead')
for i in range(bays):
    c = fr.p(-half + step * (i + 0.5), 0.0, -(TV0 - PV0) / 2)[::2]
    K.poly_drum(c, 2.05, 12, PORT_TOP + 0.1, PORT_TOP + 0.75, 0.4, mat='marble', glaze=False)
    K.dome(c, 2.2, PORT_TOP + 0.75, 1.75, 'lead', sides=32, rings=9, ribs=16, rib_r=0.035)
    K.revolve(c, [(0.1, PORT_TOP + 2.45), (0.06, PORT_TOP + 3.0), (0.0, PORT_TOP + 3.05)], 6, 'gold')
# the broad eave: a painted soffit under a lead-sheathed slab, round the portico's three open sides
EAVE_OUT = 1.7
eave = [(TU0 - EAVE_OUT, TV0), (TU0 - EAVE_OUT, PV0 - EAVE_OUT), (TU1 + EAVE_OUT, PV0 - EAVE_OUT), (TU1 + EAVE_OUT, TV0)]
K.frustum(eave, PORT_TOP - 0.3, eave, PORT_TOP - 0.18, 'soffit')
inner = [(TU0 - 0.05, TV0), (TU0 - 0.05, PV0 - 0.05), (TU1 + 0.05, PV0 - 0.05), (TU1 + 0.05, TV0)]
K.frustum(eave, PORT_TOP - 0.18, inner, PORT_TOP + 0.2, 'lead')

# ------------------------------------------------------------------ the enclosure: road-side wall, front wall,
# corner pavilion, gate
def enclosure_wall(fr, x0, x1, xs, gate=None):
    holes = [(x, 1.5, 1.1, 3.3) for x in xs]
    K.punched_wall(fr, x0, x1, 0.0, ENC_H, -0.8, 0.0, holes, 'marble')
    K.prism(fr, rect(x0, x1, 0.0, 0.5), 0.0, 0.12, 'stone')                        # base course
    for x in xs:
        K.grille_window(fr, x, 1.5, 1.1, 3.3, -0.8, 0.0, frame='marble', bars=0.2)
    piers = [x0 + 0.3, x1 - 0.3] + [(a + b) / 2 for a, b in zip(xs, xs[1:])]
    for x in piers:                                                                # pilasters between the bays
        if gate is None or abs(x - gate) > 1.5:
            K.prism(fr, rect(x - 0.28, x + 0.28, 0.5, ENC_H - 0.35), 0.0, 0.1, 'marble')
    K.run(fr, [x0 - 0.1, x1 + 0.1], [(-0.9, ENC_H - 0.3), (0.2, ENC_H - 0.3), (0.2, ENC_H), (-0.9, ENC_H + 0.15)], 'marble')
    if gate is not None:
        K.prism(fr, rect(gate - 1.3, gate + 1.3, 0.0, ENC_H + 0.7), -0.9, 0.35, 'marble')
        K.prism(fr, rect(gate - 0.8, gate + 0.8, 0.0, 3.4), 0.35, 0.4, 'wood')
        K.run(fr, [gate - 1.55, gate + 1.55], [(-0.9, ENC_H + 0.55), (0.6, ENC_H + 0.55), (0.6, ENC_H + 0.85), (-0.9, ENC_H + 0.85)],
              'marble')


PAV = (ENC_U, ENC_U + 6.0, -40.2, -34.2)                # the corner pavilion
# the road-side wall, from the pavilion to the domed hall (frame facing -u, x = v)
nw = SF((ENC_U, 0.0), (0, 1), (-1, 0))
nw_xs = [PAV[3] + 1.6 + 3.05 * i for i in range(8)]
enclosure_wall(nw, PAV[3], -10.4, [x for x in nw_xs if x < -11.6])
ret = SF((0.0, -10.4), (1, 0), (0, 1))                  # its short return to the domed hall
enclosure_wall(ret, ENC_U, -7.4, [-13.6, -9.9])
# the front wall before the portico (frame facing -v, x = -u)
fw = SF((0.0, -37.4), (-1, 0), (0, -1))
x0, x1 = -TU1, -(PAV[1])                               # from the south-east wing to the pavilion
fw_xs = [x for x in [x0 + 1.2 + 2.9 * i for i in range(8)] if x < x1 - 1.0 and abs(x + 0.5) > 2.1]
enclosure_wall(fw, x0, x1, fw_xs, gate=-0.5)
# the pavilion: marble walls with grilled windows, a red tiled hip roof
pf = face_frames(*PAV)
K.box(PAV[0] + 0.8, PAV[1] - 0.8, 0.0, 4.8, PAV[2] + 0.8, PAV[3] - 0.8, 'marble')
for key, (fr, half) in pf.items():
    xs = [-1.9, 0.0, 1.9]
    K.punched_wall(fr, -half, half, 0.0, 4.8, -0.8, 0.0, [(x, 1.25, 1.2, 3.4) for x in xs], 'marble')
    for x in xs:
        K.grille_window(fr, x, 1.25, 1.2, 3.4, -0.8, 0.0, frame='marble', bars=0.2)
    for x in (-half + 0.2, -0.95, 0.95, half - 0.2):
        K.prism(fr, rect(x - 0.2, x + 0.2, 0.4, 4.5), 0.0, 0.1, 'marble')
    K.prism(fr, rect(-half - 0.12, half + 0.12, 0.0, 0.45), 0.0, 0.12, 'stone')
    K.cornice(fr, -half, half, 4.8, proj=0.3, mat='marble', muq=False)
K.hip_roof(*PAV[:2], *PAV[2:], 4.75, 1.5, 'tile', over=0.55, thick=0.2)

# the south-east wing along the tomb (low, flat-roofed, grilled windows on the lane)
SE = (TU1, 8.1, -37.4, TV1)
K.box(SE[0], SE[1], 0.0, 5.0, SE[2], SE[3], 'marble')
K.box(SE[0] - 0.05, SE[1] + 0.15, 5.0, 5.3, SE[2] - 0.15, SE[3], 'lead')
fr, half = face_frames(*SE)['+u']
xs = [-half + 1.8 + 3.2 * i for i in range(8) if -half + 1.8 + 3.2 * i < half - 1.0]
for x in xs:
    K.surface_grille(fr, x, 1.4, 1.2, 3.2, frame='marble')
fr, half = face_frames(*SE)['-v']                       # its end on the square, in line with the front wall
K.surface_grille(fr, 0.0, 1.5, 1.1, 3.3, frame='marble')
K.run(fr, [-half - 0.1, half + 0.1], [(-0.3, 4.7), (0.2, 4.7), (0.2, 5.0), (-0.3, 5.0)], 'marble')

# ------------------------------------------------------------------ the domed hall south-west of the tomb
HU0, HU1, HV0, HV1 = -7.4, 3.4, -10.8, 0.0
HALL_TOP = 8.6
K.box(HU0 + 0.9, HU1 - 0.9, 0.0, HALL_TOP, HV0, HV1 - 0.9, 'stone')
HF = face_frames(HU0, HU1, HV0, HV1)
for key in ('-u', '+v', '+u'):
    fr, half = HF[key]
    xs = [-2.6, 0.0, 2.6]
    lower = [dict(c=x, w=1.2, sill=1.2, ys=3.3, kind='pointed') for x in xs]
    upper = [dict(c=x, w=1.1, sill=5.0, ys=6.6, kind='pointed') for x in xs]
    K.arched_wall(fr, -half, half, 0.0, 4.4, -0.9, 0.0, lower, 'stone')
    K.arched_wall(fr, -half, half, 4.4, HALL_TOP, -0.9, 0.0, upper, 'stone')
    for o in lower:
        K.window(fr, o['c'], o['w'], o['sill'], o['ys'], -0.9, 0.0, 'lower', mats=('stone', 'stone_red'))
    for o in upper:
        K.window(fr, o['c'], o['w'], o['sill'], o['ys'], -0.9, 0.0, 'upper', mats=('stone', 'stone'))
    K.string_course(fr, -half - 0.1, half + 0.1, 0.0, h=0.5, proj=0.12)
    K.cornice(fr, -half, half, HALL_TOP, proj=0.45, muq=False)
HC = ((HU0 + HU1) / 2, (HV0 + HV1) / 2)
K.box(HU0 + 0.1, HU1 - 0.1, HALL_TOP - 0.05, HALL_TOP + 0.1, HV0 + 0.1, HV1 - 0.1, 'lead')
for su in (-1, 1):
    for sv in (-1, 1):
        cu, cv = HC[0] + su * 5.3, HC[1] + sv * 5.3
        K.pyramid([(cu, cv), (cu - su * 3.0, cv), (cu, cv - sv * 3.0)], HALL_TOP + 0.05,
                  (cu - su * 1.4, HALL_TOP + 0.8, cv - sv * 1.4), 'lead')
K.poly_drum(HC, 4.4, 8, HALL_TOP, HALL_TOP + 0.95, 0.6, mat='stone', glaze=False, phase=math.pi / 8)
K.dome(HC, 4.5, HALL_TOP + 0.95, 3.4, 'lead', sides=48, rings=11, ribs=24, rib_r=0.04)
K.alem(HC, HALL_TOP + 0.95 + 3.4 - 0.06, 0.9)

# ------------------------------------------------------------------ the flat-roofed block and the tiled building


def plain_block(u0, u1, v0, v1, top, faces, roof='lead', tiled=False, rise=1.6):
    K.box(u0, u1, 0.0, top, v0, v1, 'stone')
    FF = face_frames(u0, u1, v0, v1)
    for key in faces:
        fr, half = FF[key]
        n = max(1, int((2 * half) / 3.2))
        step = 2 * half / n
        for i in range(n):
            x = -half + step * (i + 0.5)
            K.surface_grille(fr, x, 1.1, 1.2, 2.8, frame='stone')
            if top > 7:
                K.prism(fr, rect(x - 0.5, x + 0.5, 4.6, 6.2), -0.05, 0.005, 'glass')
                K.prism(fr, rect(x - 0.62, x + 0.62, 4.5, 4.6), 0.0, 0.08, 'stone')
        K.string_course(fr, -half - 0.1, half + 0.1, 0.0, h=0.45, proj=0.1)
    if tiled:
        K.hip_roof(u0, u1, v0, v1, top, rise, 'tile', over=0.6, thick=0.22)
    else:
        K.box(u0 - 0.1, u1 + 0.1, top, top + 0.35, v0 - 0.1, v1 + 0.1, roof)


plain_block(-5.69, 12.27, HV1, 11.2, 5.4, ('-u', '+u'))
plain_block(-9.05, 12.27, 11.2, 17.5, 5.4, ('-u', '+u'))
plain_block(3.6, 12.27, -5.83, HV1, 5.4, ('+u',))
plain_block(-9.05, 6.5, 17.5, 35.1, 8.0, ('-u', '+v'), tiled=True, rise=2.2)
plain_block(-13.7, -9.05, 27.6, 35.1, 6.5, ('-u', '+v'), tiled=True, rise=1.2)
plain_block(6.5, 12.27, 17.5, 35.1, 6.0, ('+u', '+v'))

K.finish()
