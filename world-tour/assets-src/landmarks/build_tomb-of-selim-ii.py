"""Tomb of Sultan Selim II (Sultan II. Selim Turbesi), Hagia Sophia precinct -- route `istanbul`.

Fact card
  OSM way      709381141 "Sultan II. Selim Turbesi", height=16 (footprint owned by pipeline/landmarks.json)
  what         sultan's tomb by Mimar Sinan, finished 1577 (TDV Islam Ansiklopedisi "Selim II Turbesi")
  footprint    square with wide chamfered corners, ~20.1 x 20.6 m, chamfer legs ~3 m; a 14 x 7 m portico
               on the north side, towards the church (OSM outline)
  height       OSM height=16; built: walls 10.2 m, cornice 11.0, low octagonal drum to 12.5, dome crown
               ~17.0, alem top ~18.7 (proportions read off Commons "Exterior of Tomb of Sultan Selim II"
               and the views from the Hagia Sophia gallery)
  seen from    the race line passes ~45-60 m to the south across Sultanahmet square: the player sees the
               plain marble south face and its chamfers over the precinct wall, and the dome with its
               dormer windows; the portico and its tiles face the church
  parts a local would name
    marble-clad chamfered square body ("koseleri genisce pahli kare")   built
    torus moulding that makes the walls read as two storeys ("kaval silme iki katli bir gorunum")  built
    windows: two over two on the entrance side, four (2 + 2) on the others; lower ones rectangular
      under a two-colour pointed relieving arch, upper ones pointed-arched (TDV)   built; one over one
      on each chamfer as in the photo
    double dome: outer dome on a high drum resting on the walls (TDV)  built as a low octagonal drum and
      a ribbed lead dome with eight dormer windows (the dormers are what the gallery photos show)
    alem                                                   built
    three-bay portico with Iznik tile panels, eight-segment central dome, and a very wide lead eave
      (sacak) on slender posts with iron tie rods (TDV; Commons photo)
                                                            built: arcade with red-and-white voussoirs,
                                                            tile panels, door, central domelet, the
                                                            broad sloping eave with painted soffit, two
                                                            corner posts and six tie rods; columns
                                                            simplified to piers
    inner dome, inner octagonal gallery of columns          not built: interior
  style grammar (Ottoman classical): marble ashlar, string course, corbelled cornice, drum + dome,
    two-colour voussoirs, deep grilled windows -- all built.
  unverified   drum height (hidden by the dome's lead skirt in every photo); window count on the chamfers.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hs_precinct_kit import Kit, Fr, regular, offset_poly, ccw, chamfered_rect, TAU  # noqa: E402

K = Kit('tomb-of-selim-ii', ['marble', 'stone', 'lead', 'grille', 'gold', 'wood', 'tile', 'redstone'])

U0, U1, V0, V1, CH = -10.1, 10.0, -7.6, 13.0, 3.0
CU, CV = (U0 + U1) / 2, (V0 + V1) / 2
BODY = chamfered_rect(U0, U1, V0, V1, CH)
H_WALL, D = 10.2, 0.6
PU0, PU1, PV0 = -6.9, 7.1, -14.5            # portico span and front

K.prism(offset_poly(ccw(BODY), 0.25), 0.0, 0.45, 'stone')


def openings(i, fr, L):
    if L < 6.0:                                             # chamfer: one over one
        return [(L / 2, 1.1, 1.1, 3.2, 'rect'), (L / 2, 1.1, 6.0, 7.6, 'pointed')]
    if fr.n[1] < -0.9:                                      # entrance side: door behind the portico
        return [(L / 2, 1.6, 0.95, 3.4, 'round', 'wood'),
                (L / 2 - 4.4, 1.3, 6.0, 7.7, 'pointed'), (L / 2 + 4.4, 1.3, 6.0, 7.7, 'pointed')]
    ops = []
    for a in (L / 2 - 3.2, L / 2 + 3.2):
        ops.append((a, 1.4, 1.0, 3.4, 'rect'))
        ops.append((a, 1.4, 6.0, 7.7, 'pointed'))
    return ops


frames = K.polygon_body(BODY, 0.45, H_WALL, D, openings)
for fr, L in frames:
    if fr.n[1] < -0.9 and L > 6.0:
        continue
    places = (L / 2,) if L < 6.0 else (L / 2 - 3.2, L / 2 + 3.2)
    w = 1.1 if L < 6.0 else 1.4
    for a in places:
        K.box(fr, a - w / 2 - 0.2, a + w / 2 + 0.2, 3.2 if L < 6.0 else 3.4, (3.2 if L < 6.0 else 3.4) + 0.2, 0.0, 0.1, 'marble')
        # two-colour pointed relieving arch over the lower window
        K.arch_ring(fr, a, w / 2 + 0.05, w / 2 + 0.4, 3.65 if L >= 6.0 else 3.45, -0.05, 0.08, 'redstone', seg=8, kind='pointed')
        K.arch_ring(fr, a, w / 2, w / 2 + 0.25, 7.7 if L >= 6.0 else 7.6, -0.05, 0.1, 'marble', seg=8, kind='pointed')
K.moulding(BODY, 5.0, 0.3, 0.14)                            # kaval silme: the two-storey line
top = K.corbel_cornice(BODY, H_WALL, [(0.3, 0.12), (0.25, 0.3), (0.3, 0.5)])
K.prism(offset_poly(ccw(BODY), 0.35), top, top + 0.2, 'lead')

# ------------------------------------------------------------------ drum, dome and dormers
OCT = regular(CU, CV, 8, 8.7, 0.0)
K.prism(OCT, top + 0.1, top + 1.5, 'marble')
K.moulding(OCT, top + 1.4, 0.25, 0.2)
DR = 8.55
base = top + 1.6
crown = K.ribbed_dome(CU, CV, base, DR, 4.5, ribs=40)
for k in range(8):
    t = TAU * k / 8
    K.dormer(CU, CV, t, DR - 0.05, base - 0.1, 1.0, 1.0)
K.revolve(CU, CV, [(0.9, crown - 0.3), (0.55, crown + 0.2)], 12, 'lead')
K.finial(CU, CV, crown + 0.15, 0.4)

# ------------------------------------------------------------------ portico with its wide eave
PH = 6.6
K.ubox(PU0 - 0.4, PU1 + 0.4, 0.0, 0.95, PV0 - 1.2, V0, 'stone')                 # platform
K.ubox(PU0 - 0.4 + 2.0, PU1 + 0.4 - 2.0, 0.0, 0.5, PV0 - 2.1, PV0 - 1.2, 'stone')  # step
FRONT = Fr(PU0, PV0, (1.0, 0.0), (0.0, -1.0))
W = PU1 - PU0
bays = [(W / 6, 3.4), (W / 2, 3.4), (5 * W / 6, 3.4)]
K.wall(FRONT, 0.0, W, 0.5, PH, 0.7, [(a, w, 0.95, 4.0, 'pointed', None) for a, w in bays], 'marble')
for a, w in bays:
    K.arch_ring(FRONT, a, w / 2, w / 2 + 0.35, 4.0, -0.1, 0.08, 'redstone', seg=10, kind='pointed')
K.ubox(PU0 + 2.0, PU1 - 2.0, 5.4, 6.3, PV0 - 0.12, PV0 + 0.1, 'tile')               # inscription panel
for u0, u1 in ((PU0, PU0 + 0.8), (PU1 - 0.8, PU1)):
    K.ubox(u0, u1, 0.95, PH, PV0 + 0.7, V0, 'marble')
for a in (-3.6, 3.6):
    K.ubox(CU + a - 1.2, CU + a + 1.2, 1.4, 3.9, V0 - 0.06, V0 + 0.02, 'tile')
K.ubox(PU0, PU1, PH, PH + 0.3, PV0, V0, 'marble')
# the central eight-segment domelet
PC = ((PU0 + PU1) / 2, (PV0 + V0) / 2)
K.revolve(PC[0], PC[1], [(2.2, PH + 0.3), (2.2, PH + 0.9)], 16, 'marble', smooth=False)
K.ribbed_dome(PC[0], PC[1], PH + 0.9, 2.2, 1.3, ribs=8, rings=8, rib=0.05)
# the broad eave: a lead roof sloping out from the arcade to slender posts, painted soffit under it
outer = [(PU0 - 2.3, V0), (PU0 - 2.3, PV0 - 2.6), (PU1 + 2.3, PV0 - 2.6), (PU1 + 2.3, V0)]
inner = [(PU0, V0), (PU0, PV0), (PU1, PV0), (PU1, V0)]
K.roof_ring(outer, 5.0, inner, PH + 0.3, 0.22, 'lead', soffit='wood')
for u in (PU0 - 2.1, PU1 + 2.1):                                            # corner posts
    K.M.tube('post', [(u, 0.95, PV0 - 2.4), (u, 4.8, PV0 - 2.4)], 0.07, 'grille', sides=6)
for u in (PU0 + 0.3, PU0 + W / 3, PU0 + 2 * W / 3, PU1 - 0.3):                  # iron tie rods
    K.M.tube('rod', [(u, 4.3, PV0 - 0.05), (u, 4.95, PV0 - 2.3)], 0.035, 'grille', sides=4)
for u, s in ((PU0, -1), (PU1, 1)):
    K.M.tube('rod', [(u + 0.05 * s, 4.3, PV0 + 3.0), (u + 2.2 * s, 4.95, PV0 + 3.0)], 0.035, 'grille', sides=4)

K.finish()
