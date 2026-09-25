"""Sultan Ahmed Madrasa (Sultanahmet Medresesi, 1610-17), north of the Blue Mosque -- route `istanbul`.

Fact card
  OSM object     way 103953128 (historic=building, start_date=1610; source: Fatih municipality's restoration
                 survey), 35.5 x 43.9 m with a 10.5 x 8.8 m projection at its north corner.
  Height         ~7.2 m to the eaves of the cells, ~15 m to the lecture hall's dome, ~16.9 m to its finial
                 [photo estimates: Sultan_Ahmed_I_medrese_DSCF4929 (long side), Sultan_Ahmet_Medresesi_01
                 (lecture hall from the lane)].  No published height found.
  Plan           [satellite imagery resampled into the model frame, plus the photos] a classical Ottoman
                 madrasa: a ring of domed student cells, each with its chimney, round an arcaded court; the
                 domed lecture hall (dershane) is the projecting block at the north corner, next to the Tomb
                 of Ahmed I.  Today the court is roofed over (a low hipped roof on the imagery; the building is
                 used as a library).  The long south-east side is lined by a lower outer wall with grilled
                 windows; the upper wall above it has small pointed windows.
  Seen from      the race line passes 37 m off its north-west side, with the tomb between: from the road the
                 madrasa is the row of small lead domes and pointed chimneys above the tomb's enclosure and
                 the lecture hall's dome beside the tomb's; its south-east side faces the park.
  Parts a local would name
    - the domed cells with their tall capped chimneys ................ built (23 cells, 23 chimneys)
    - the lecture hall: a stone cube, two tiers of windows, octagonal drum, lead dome, alem .... built
    - the arcaded court with small domes over the portico bays ...... built (columns, pointed arches, domes)
    - the modern roof over the court ................................... built (low hipped, light metal)
    - the lower outer wall with grilled windows, the upper wall with pointed windows ... built
    - the entrance portal (from the court side of the Blue Mosque) .. simplified: a framed doorway on
      the south-west face; its muqarnas hood is not built (it faces away from the road)
  Style grammar  (classical Ottoman): pointed arches, ablaq-free ashlar, lead domes on drums, muqarnas
                 cornice on the lecture hall, grilled lower windows / pointed upper windows -- built.
  Unverified     cell count per side (imagery), court size (imagery), all heights (photo ratios).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sultanahmet_kit import Kit, SF, TAU, rect, arch  # noqa: E402

ID = 'sultan-ahmed-madrasa'
K = Kit(ID, ['stone', 'marble', 'carved', 'lead', 'gold', 'glass', 'iron', 'wood'])
K.M.material('zinc', (0.58, 0.60, 0.62), 0.3, 0.5, ID + '_zinc')        # the modern roof over the court

U0, U1, V0, V1 = -17.04, 18.45, -20.50, 23.40          # main block [OSM]
DU0, DU1, DV0 = -17.03, -6.48, -29.25                  # lecture hall block [OSM]
DV1 = DV0 + (DU1 - DU0)                                # it is square: to v = -18.70
CELL = 7.0                                             # depth of the cell ring
PORT = 3.5                                             # depth of the court's portico
EAVE = 7.2
CU0, CU1, CV0, CV1 = U0 + CELL + PORT, U1 - CELL - PORT, V0 + CELL + PORT, V1 - CELL - PORT   # the court

# ------------------------------------------------------------------ the cell ring
strips = {                                      # (u0, u1, v0, v1, outward face, cells)
    'se': (U1 - CELL, U1, V0, V1, '+u', 8),
    'nw': (U0, U0 + CELL, DV1, V1, '-u', 8),
    'ne': (U0 + CELL, U1 - CELL, V0, V0 + CELL, '-v', 3),
    'sw': (U0 + CELL, U1 - CELL, V1 - CELL, V1, '+v', 4),
}
K.box(U0 + CELL - 3.56, U0 + CELL, 0.0, EAVE, DV1, V0 + CELL, 'stone')          # the corner by the lecture hall
cells = []
for key, (u0, u1, v0, v1, out, n) in strips.items():
    K.box(u0, u1, 0.0, EAVE, v0, v1, 'stone')
    K.box(u0 - 0.05, u1 + 0.05, EAVE, EAVE + 0.18, v0 - 0.05, v1 + 0.05, 'lead')
    along_u = out in ('-v', '+v')
    L0, L1 = (u0, u1) if along_u else (v0, v1)
    for i in range(n):
        m = L0 + (L1 - L0) * (i + 0.5) / n
        c = (m, (v0 + v1) / 2) if along_u else ((u0 + u1) / 2, m)
        cells.append((c, out, (L1 - L0) / n))

# outer faces: grilled lower windows in the thicker lower wall, small pointed windows above
LOWER_TOP = 4.4


def outer_face(fr, x0, x1, xs, lower=True):
    if lower:
        # the lower wall stands 0.7 m proud; its windows are real openings with the grille set in them
        K.punched_wall(fr, x0, x1, 0.0, LOWER_TOP, 0.0, 0.7, [(x, 1.15, 1.25, 3.05) for x in xs], 'stone')
        K.run(fr, [x0, x1], [(0.0, LOWER_TOP), (0.85, LOWER_TOP), (0.85, LOWER_TOP + 0.08), (0.0, LOWER_TOP + 0.45)], 'lead')
        K.string_course(fr, x0, x1, 0.0, dface=0.7, h=0.35, proj=0.08)
        for x in xs:
            K.grille_window(fr, x, 1.15, 1.25, 3.05, 0.0, 0.7, frame='stone')
    for x in xs:
        o = dict(c=x, w=0.62, sill=5.25, ys=5.95, kind='pointed')
        pts, crown = arch(x, 0.62, 5.95, 'pointed')
        K.prism(fr, [(x - 0.31, 5.25), (x + 0.31, 5.25)] + list(reversed(pts)), -0.02, 0.02, 'glass')
        K.voussoirs(fr, o, 0.0, band=0.18, k=8, proud=0.05, mats=('stone', 'stone'))
    K.cornice(fr, x0, x1, EAVE, proj=0.35, muq=False)


FACADES = [  # (frame, x0, x1, windows, lower wall)
    (SF((U1, 0.0), (0, -1), (1, 0)), -V1, -V0, 8, True),          # south-east, toward the park
    (SF((0.0, V1), (1, 0), (0, 1)), U0, U1, 6, True),             # south-west, toward the mosque
    (SF((0.0, V0), (-1, 0), (0, -1)), -U1, -DU1, 4, True),        # north-east, on the lane
    (SF((U0, 0.0), (0, 1), (-1, 0)), DV1, V1, 8, False),          # north-west, by the tomb
]
for fr, x0, x1, n, lower in FACADES:
    step = (x1 - x0) / n
    xs = [x0 + step * (i + 0.5) for i in range(n)]
    if fr.t == (1, 0):
        # the entrance portal in the middle of the south-west face
        K.prism(fr, rect(-1.5, 1.5, 0.0, 5.6), 0.0, 0.9, 'marble')
        K.prism(fr, rect(-0.8, 0.8, 0.0, 2.9), 0.9, 0.95, 'wood')
        K.voussoirs(fr, dict(c=0.0, w=2.0, sill=0.0, ys=3.1, kind='pointed'), 0.9, band=0.3, k=10, proud=0.06,
                    mats=('marble', 'stone'))
        xs = [x for x in xs if abs(x) > 2.2]
    outer_face(fr, x0 - (0.6 if lower else 0.0), x1 + (0.6 if lower else 0.0), xs, lower=lower)
    if not lower:                                     # the lane side by the tomb: a thinner skin, same windows
        K.punched_wall(fr, x0, x1, 0.0, 3.6, 0.0, 0.3, [(x, 1.0, 1.4, 2.9) for x in xs], 'stone')
        K.string_course(fr, x0, x1, 0.0, dface=0.3, h=0.5, proj=0.08)
        for x in xs:
            K.grille_window(fr, x, 1.0, 1.4, 2.9, 0.0, 0.3, frame='stone')

# cell domes and chimneys
for (cu, cv), out, pitch in cells:
    r = min(2.2, pitch * 0.42)
    K.poly_drum((cu, cv), r * 0.98, 8, EAVE + 0.1, EAVE + 0.55, 0.3, mat='lead', glaze=False)
    K.dome((cu, cv), r, EAVE + 0.55, r * 0.7, 'lead', sides=16, rings=6)   # seams are sub-pixel at 40 m: left out
    K.revolve((cu, cv), [(0.08, EAVE + 0.5 + r * 0.7), (0.05, EAVE + 0.95 + r * 0.7), (0.0, EAVE + 1.0 + r * 0.7)], 6, 'lead')
    # the chimney stands on the outer wall line, capped by a little pyramid
    d = CELL / 2 - 0.9
    ch = {'+u': (cu + d, cv), '-u': (cu - d, cv), '-v': (cu, cv - d), '+v': (cu, cv + d)}[out]
    K.box(ch[0] - 0.32, ch[0] + 0.32, EAVE, EAVE + 2.8, ch[1] - 0.32, ch[1] + 0.32, 'stone')
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):              # the smoke vents
        cx, cz = ch[0] + dx * 0.32, ch[1] + dz * 0.32
        hx, hz = (0.02 if dx else 0.12), (0.02 if dz else 0.12)
        K.box(cx - hx, cx + hx, EAVE + 2.25, EAVE + 2.6, cz - hz, cz + hz, 'glass')
    K.box(ch[0] - 0.4, ch[0] + 0.4, EAVE + 2.8, EAVE + 2.92, ch[1] - 0.4, ch[1] + 0.4, 'stone')
    K.pyramid([(ch[0] - 0.36, ch[1] - 0.36), (ch[0] + 0.36, ch[1] - 0.36), (ch[0] + 0.36, ch[1] + 0.36), (ch[0] - 0.36, ch[1] + 0.36)],
              EAVE + 2.92, (ch[0], EAVE + 3.55, ch[1]), 'lead')

# ------------------------------------------------------------------ the court: portico, arches, domes, roof
PU0, PU1, PV0, PV1 = U0 + CELL, U1 - CELL, V0 + CELL, V1 - CELL
PORT_TOP = 5.3
for u0, u1, v0, v1 in [(PU0, PU1, PV0, CV0), (PU0, PU1, CV1, PV1), (PU0, CU0, CV0, CV1), (CU1, PU1, CV0, CV1)]:
    K.box(u0, u1, PORT_TOP - 0.45, PORT_TOP, v0, v1, 'stone')
    K.box(u0 - 0.03, u1 + 0.03, PORT_TOP, PORT_TOP + 0.12, v0 - 0.03, v1 + 0.03, 'lead')
# columns and arches along the four sides of the court
sides = [(SF((0.0, CV0), (-1, 0), (0, 1)), CU0, CU1), (SF((0.0, CV1), (1, 0), (0, -1)), CU0, CU1),
         (SF((CU0, 0.0), (0, 1), (1, 0)), CV0, CV1), (SF((CU1, 0.0), (0, -1), (-1, 0)), CV0, CV1)]
bays = []
for fr, a0, a1 in sides:
    if fr.t == (-1, 0) or fr.t == (0, -1):
        a0, a1 = -a1, -a0
    n = max(3, round((a1 - a0) / 3.2))
    step = (a1 - a0) / n
    ops = [dict(c=a0 + step * (i + 0.5), w=step - 0.55, sill=0.0, ys=2.55, kind='pointed') for i in range(n)]
    K.arched_wall(fr, a0, a1, 0.3, PORT_TOP - 0.45, -0.25, 0.25, ops, 'stone')
    for i in range(n + 1):
        c = fr.p(a0 + step * i, 0.0, 0.0)[::2]
        K.cylinder(c, 0.26, 0.0, 2.25, 12, 'marble')
        K.box(c[0] - 0.33, c[0] + 0.33, 2.25, 2.6, c[1] - 0.33, c[1] + 0.33, 'carved')
        K.box(c[0] - 0.34, c[0] + 0.34, 0.0, 0.3, c[1] - 0.34, c[1] + 0.34, 'marble')
    for i in range(n):
        bays.append((fr.p(a0 + step * (i + 0.5), 0.0, -PORT / 2)[::2], min(step, PORT) * 0.42))
for (bu, bv), r in bays:
    K.dome((bu, bv), r, PORT_TOP + 0.1, r * 0.75, 'lead', sides=12, rings=5)
K.hip_roof(CU0 + 0.2, CU1 - 0.2, CV0 + 0.2, CV1 - 0.2, PORT_TOP + 0.05, 1.5, 'zinc', over=0.2, thick=0.15)

# ------------------------------------------------------------------ the lecture hall (dershane)
HALL_TOP = 10.2
K.box(DU0, DU1, 0.0, HALL_TOP, DV0, DV1, 'stone')
hc = ((DU0 + DU1) / 2, (DV0 + DV1) / 2)
half = (DU1 - DU0) / 2
faces = [SF((hc[0], DV0), (-1, 0), (0, -1)), SF((DU0, hc[1]), (0, 1), (-1, 0)), SF((DU1, hc[1]), (0, -1), (1, 0))]
for fr in faces:
    K.punched_wall(fr, -half - 0.3, half + 0.3, 0.0, 4.4, 0.0, 0.3, [(-2.2, 1.3, 1.3, 3.3), (2.2, 1.3, 1.3, 3.3)], 'stone')
    K.string_course(fr, -half - 0.3, half + 0.3, 0.0, dface=0.3, h=0.55, proj=0.1)
    K.string_course(fr, -half - 0.3, half + 0.3, 4.4, dface=0.0, h=0.22, proj=0.4)
    for x in (-2.2, 2.2):
        K.grille_window(fr, x, 1.3, 1.3, 3.3, 0.0, 0.3, frame='stone')
        o = dict(c=x, w=1.35, sill=5.4, ys=7.6, kind='pointed')
        pts, crown = arch(x, 1.35, 7.6, 'pointed')
        K.prism(fr, [(x - 0.675, 5.4), (x + 0.675, 5.4)] + list(reversed(pts)), -0.02, 0.01, 'glass')
        nb = 4
        for b in range(1, nb):
            bx = x - 0.675 + 1.35 * b / nb
            K.prism(fr, rect(bx - 0.03, bx + 0.03, 5.4, 7.6 + (crown - 7.6) * 0.8), 0.01, 0.05, 'stone')
        for by in (5.9, 6.5, 7.1, 7.7, 8.2):
            if by < crown - 0.1:
                K.prism(fr, rect(x - 0.6, x + 0.6, by - 0.03, by + 0.03), 0.01, 0.05, 'stone')
        K.voussoirs(fr, o, 0.0, band=0.25, k=8, proud=0.06, mats=('stone', 'stone'))
    K.cornice(fr, -half, half, HALL_TOP, proj=0.45, muq=True)
# the drum: octagon on the square, the corners covered by little lead slopes, round windows
K.poly_drum(hc, half - 0.9, 8, HALL_TOP - 0.1, HALL_TOP + 1.3, 0.5, mat='stone', glaze=False)
for i in range(8):
    a = TAU * i / 8
    ap = half - 0.9
    fr = SF((hc[0] + ap * math.cos(a), hc[1] + ap * math.sin(a)), (-math.sin(a), math.cos(a)), (math.cos(a), math.sin(a)))
    K.prism(fr, [(0.32 * math.cos(TAU * k / 12), HALL_TOP + 0.62 + 0.32 * math.sin(TAU * k / 12)) for k in range(12)], -0.02, 0.03, 'glass')
for su in (-1, 1):
    for sv in (-1, 1):
        cu, cv = hc[0] + su * half, hc[1] + sv * half
        K.pyramid([(cu, cv), (cu - su * 3.2, cv), (cu, cv - sv * 3.2)], HALL_TOP, (cu - su * 1.4, HALL_TOP + 1.1, cv - sv * 1.4), 'lead')
R = (half - 0.9) / math.cos(math.pi / 8) - 0.05
K.revolve(hc, [(R + 0.25, HALL_TOP + 1.3), (R + 0.25, HALL_TOP + 1.5), (0.0, HALL_TOP + 1.5)], 8, 'stone', smooth=False,
          phase=math.pi / 8)
K.dome(hc, R, HALL_TOP + 1.5, R * 0.8, 'lead', sides=40, rings=10, ribs=24, rib_r=0.04)
K.alem(hc, HALL_TOP + 1.5 + R * 0.8 - 0.05, 1.0)

K.finish()
