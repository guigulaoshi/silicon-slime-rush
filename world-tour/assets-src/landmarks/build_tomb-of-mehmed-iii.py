"""Tomb of Sultan Mehmed III (Sultan III. Mehmed Turbesi), Hagia Sophia precinct -- route `istanbul`.

Fact card
  OSM way      109836394 "Sultan III. Mehmet Turbesi", height=17 (footprint owned by pipeline/landmarks.json)
  what         sultan's tomb by Dalgic Ahmed Aga, 1608 (TDV Islam Ansiklopedisi "Mehmed III Turbesi")
  footprint    the south half is a regular octagon with 8.1 m sides (19.6 m across the flats); the OSM
               outline squares off the north half to 19.6 m wide and adds a 12.7 x 2.4 m projection:
               the portico block towards the church
  height       OSM height=17; built: walls 11.6 m, cornice 12.5, drumless dome crown ~17.4, alem ~19.1
               (wall-to-width proportion read off Commons photos of the faces along the street)
  seen from    the race line passes ~45-55 m to the south: the player sees three or four marble octagon
               faces, their three rows of paired windows and the dome over the precinct wall
  parts a local would name
    octagonal marble body ("sekizgen plan", "distan mermer kaplamali")      built
    three rows of paired windows: lower rectangular with frames, upper pointed (TDV "ikili duzen
      icinde uc sira pencere")                                             built, 2 per face per row
    string course and stepped cornice                                       built
    drumless outer dome with four round-arched windows (TDV "kasnaksiz ... dort pencere")  built as a
      ribbed lead dome with four dormers
    alem                                                                    built
    three-unit portico, renewed later (TDV)                                 simplified: the portico block
      of the OSM outline with three open arches and a lead roof; faces the church, never the road,
      and no photo in our set shows its outside clearly
    inner dome on eight columns, tiles, painted landscapes in the portico   not built: interior / portico
      interior, invisible from the road
  style grammar (Ottoman classical): marble ashlar, string course, corbelled cornice, dome, deep
    grilled windows, pointed arches -- all built.
  unverified   the north half of the plan (OSM squares it off; the building is octagonal per TDV, so the
               octagon is built whole and the portico block fills the OSM rectangle in front of it).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hs_precinct_kit import Kit, Fr, regular, offset_poly, ccw, TAU  # noqa: E402

K = Kit('tomb-of-mehmed-iii', ['marble', 'stone', 'lead', 'grille', 'gold', 'wood', 'redstone', 'tile'])

CU, CV, FLAT = -0.08, 4.3, 9.8
OCT = regular(CU, CV, 8, FLAT, math.pi / 2)        # one flat faces +v (south, the road)
H_WALL, D = 11.6, 0.55

K.prism(offset_poly(ccw(OCT), 0.25), 0.0, 0.45, 'stone')


def openings(i, fr, L):
    if fr.n[1] < -0.9:                              # north flat: inside the portico block
        return [(L / 2, 1.5, 0.9, 3.2, 'round', 'wood')]
    ops = []
    for a in (L / 2 - 1.75, L / 2 + 1.75):
        ops.append((a, 1.2, 1.0, 3.2, 'rect'))
        ops.append((a, 1.2, 4.7, 6.4, 'pointed'))
        ops.append((a, 1.1, 8.2, 9.7, 'pointed'))
    return ops


frames = K.polygon_body(OCT, 0.45, H_WALL, D, openings)
for fr, L in frames:
    if fr.n[1] < -0.9:
        continue
    for a in (L / 2 - 1.75, L / 2 + 1.75):
        K.box(fr, a - 0.8, a + 0.8, 3.2, 3.45, 0.0, 0.12, 'marble')
        K.box(fr, a - 0.8, a + 0.8, 0.8, 1.0, 0.0, 0.12, 'marble')
        K.arch_ring(fr, a, 0.6, 0.85, 6.4, -0.05, 0.1, 'marble', seg=8, kind='pointed')
        K.arch_ring(fr, a, 0.55, 0.8, 9.7, -0.05, 0.1, 'marble', seg=8, kind='pointed')
K.moulding(OCT, 4.05, 0.28, 0.12)
K.moulding(OCT, 7.6, 0.22, 0.1)
top = K.corbel_cornice(OCT, H_WALL, [(0.3, 0.12), (0.3, 0.3), (0.3, 0.5)])
K.prism(offset_poly(ccw(OCT), 0.35), top, top + 0.2, 'lead')
DR = 9.0
base = top + 0.15
K.revolve(CU, CV, [(DR + 0.2, base - 0.05), (DR + 0.2, base + 0.3)], 64, 'lead', smooth=False)
crown = K.ribbed_dome(CU, CV, base + 0.25, DR, 4.6, ribs=44)
for k in range(4):                                    # four round-arched windows in the drumless dome
    t = math.pi / 2 + TAU * k / 4 + math.pi / 4
    K.dormer(CU, CV, t, DR - 0.1, base + 0.25, 1.1, 1.2)
K.revolve(CU, CV, [(0.9, crown - 0.3), (0.55, crown + 0.2)], 12, 'lead')
K.finial(CU, CV, crown + 0.15, 0.4)

# ------------------------------------------------------------------ portico block (north, towards the church)
BU, BV0, BV1 = 9.8, -11.0, CV - FLAT + 0.6         # fills the OSM rectangle in front of the octagon
PH = 7.4
K.ubox(-BU, BU, 0.0, 0.9, BV0, BV1, 'stone')
for u0, u1 in ((-BU, -6.2), (6.2, BU)):              # the closed side rooms either side of the porch
    K.ubox(u0, u1, 0.9, PH, BV0, BV1, 'marble')
FRONT = Fr(-6.2, BV0, (1.0, 0.0), (0.0, -1.0))
bays = [(2.07, 3.1), (6.2, 3.1), (10.33, 3.1)]
K.wall(FRONT, 0.0, 12.4, 0.45, PH, 0.7, [(a, w, 0.9, 4.0, 'pointed', None) for a, w in bays], 'marble')
for a, w in bays:
    K.arch_ring(FRONT, a, w / 2, w / 2 + 0.35, 4.0, -0.1, 0.08, 'redstone', seg=10, kind='pointed')
for u0, u1 in ((-BU, -6.2), (6.2, BU)):              # a window each in the side rooms
    fr = Fr(u0, BV0, (1.0, 0.0), (0.0, -1.0))
    K.box(fr, (u1 - u0) / 2 - 0.6, (u1 - u0) / 2 + 0.6, 1.2, 3.2, -0.02, 0.06, 'grille')
K.ubox(-BU - 0.3, BU + 0.3, PH, PH + 0.35, BV0 - 0.3, BV1, 'marble')
K.ubox(-BU - 0.2, BU + 0.2, PH + 0.35, PH + 0.55, BV0 - 0.2, BV1, 'lead')
K.ubox(-6.2, 6.2, 0.0, 0.6, -13.45, BV0, 'stone')                              # front steps
for a in (-3.2, 3.2):
    K.ubox(CU + a - 1.1, CU + a + 1.1, 1.3, 3.6, CV - FLAT - 0.06, CV - FLAT + 0.02, 'tile')

K.finish()
