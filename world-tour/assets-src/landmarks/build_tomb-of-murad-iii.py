"""Tomb of Sultan Murad III (Sultan III. Murad Turbesi), Hagia Sophia precinct -- route `istanbul`.

Fact card
  OSM way      109836395 "Sultan III. Murad Turbesi" (footprint owned by pipeline/landmarks.json)
  what         sultan's tomb begun by Davud Aga, finished by Dalgic Ahmed Aga, 1599 (TDV Islam
               Ansiklopedisi "Murad III Turbesi"; site plaque)
  footprint    regular hexagon, 10.9 m sides (18.9 m across the flats), plus a 10.9 x 6.5 m portico
               on the north-east flat, the side facing Hagia Sophia (OSM outline)
  height       OSM height=17; built: walls 11.0 m, cornice to 11.9, short drum 12.1-12.9, dome crown
               17.4, alem top ~19.1 (proportions read off Commons photos of the south and east faces)
  seen from    the race line passes 35-45 m to the south-west/south across Sultanahmet square: the player
               sees the plain marble south and south-west faces, the three window rows and the dome over
               the precinct wall; the portico faces away, towards the church
  parts a local would name
    hexagonal marble body                         built
    three rows of windows (lower rectangular with marble frames, two upper rows pointed-arched,
      TDV: "uc sira ... alttakiler dikdortgen, ust siradakiler sivri kemerli")  built, 2 per face per row
    moulded string course giving the two-storey look   built
    stepped (muqarnas) cornice                    built as three corbelled steps
    lead dome with standing seams on a short drum built (ribs are geometry), six small dormer windows
      at its foot as the views from the Hagia Sophia gallery show
    gilded alem with crescent                     built
    three-bay portico rising to the cornice, pointed arches with red-and-white voussoirs on columns,
      central lunette window over the arcade (TDV; Commons "Tomb of Sultan Murad III - 02")
                                                  built: arcade, voussoir bands, lunette, tile panels,
                                                  door; columns simplified to square piers (the
                                                  portico faces the church, not the road)
    Iznik tile panels flanking the door           built as proud blue panels
    chamfered corners either side of the portico (TDV "bozuk sekizgen")  not built: not in the OSM
      outline and hidden behind the portico from the road
  style grammar (Ottoman classical): marble ashlar, string courses, corbelled cornice, dome on a drum,
    pointed arches with two-colour voussoirs, grilled windows set deep in the wall -- all built.
  unverified   exact window count per face (photos show two per row on the faces we see); drum height.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hs_precinct_kit import Kit, Fr, regular, offset_poly, ccw, TAU  # noqa: E402

K = Kit('tomb-of-murad-iii', ['marble', 'stone', 'lead', 'grille', 'gold', 'wood', 'tile', 'redstone'])

CU, CV = 0.0, 2.36                   # hexagon centre in the survey frame
FLAT = 9.42                          # inradius (10.9 m sides)
HEX = regular(CU, CV, 6, FLAT, -math.pi / 2)     # one flat faces -v: the portico side (north-east)
H_WALL, D = 11.0, 0.55
PV0, PV1, PU = -13.53, CV - FLAT, 5.45           # portico front, back (the hexagon flat), half width

# plinth on the datum (the lowest ground under the outline; higher ground buries it)
K.prism(offset_poly(ccw(HEX), 0.25), 0.0, 0.45, 'stone')


def openings(i, fr, L):
    n = fr.n
    if n[1] < -0.9:                                  # the flat behind the portico: the door only
        return [(L / 2, 1.5, 0.9, 3.2, 'round', 'wood')]
    ops = []
    for a in (L / 2 - 2.4, L / 2 + 2.4):
        ops.append((a, 1.3, 1.0, 3.2, 'rect'))
        ops.append((a, 1.3, 4.7, 6.5, 'pointed'))
        ops.append((a, 1.2, 8.1, 9.6, 'pointed'))
    return ops


frames = K.polygon_body(HEX, 0.45, H_WALL, D, openings)
# marble frames round the lower windows and a relieving arch over each upper one
for fr, L in frames:
    if fr.n[1] < -0.9:
        continue
    for a in (L / 2 - 2.4, L / 2 + 2.4):
        K.box(fr, a - 0.85, a + 0.85, 3.2, 3.45, 0.0, 0.12, 'marble')        # lintel
        K.box(fr, a - 0.85, a + 0.85, 0.8, 1.0, 0.0, 0.12, 'marble')         # sill
        K.arch_ring(fr, a, 0.65, 0.9, 6.5, -0.05, 0.1, 'marble', seg=8, kind='pointed')
        K.arch_ring(fr, a, 0.6, 0.85, 9.6, -0.05, 0.1, 'marble', seg=8, kind='pointed')
K.moulding(HEX, 4.0, 0.28, 0.12)                                             # the string course
top = K.corbel_cornice(HEX, H_WALL, [(0.3, 0.12), (0.3, 0.3), (0.3, 0.5)])
K.prism(offset_poly(ccw(HEX), 0.35), top, top + 0.2, 'lead')                  # lead-covered terrace
# short drum and the dome
DR = 8.0
K.revolve(CU, CV, [(DR, top + 0.1), (DR, top + 1.0)], 48, 'marble', smooth=True)
K.revolve(CU, CV, [(DR + 0.25, top + 0.95), (DR + 0.25, top + 1.2)], 48, 'marble', smooth=False)
crown = K.ribbed_dome(CU, CV, top + 1.15, DR + 0.1, 4.45, ribs=36)
for k in range(6):                     # small arched windows at the dome's foot (Hagia Sophia gallery views)
    K.dormer(CU, CV, TAU * k / 6 + math.pi / 6, DR, top + 1.1, 0.9, 0.9)
K.revolve(CU, CV, [(0.9, crown - 0.3), (0.55, crown + 0.2)], 12, 'lead')
K.finial(CU, CV, crown + 0.15, 0.38)

# ------------------------------------------------------------------ portico (north-east, towards the church)
PH = H_WALL - 0.4                    # rises to just under the main cornice
FRONT = Fr(-PU, PV0, (1.0, 0.0), (0.0, -1.0))    # a runs +u along the front, d outward (-v)
K.ubox(-PU, PU, 0.0, 0.9, PV0, PV1, 'stone')                                 # raised platform
for u0, u1 in ((-PU, -PU + 0.9), (PU - 0.9, PU)):                            # side walls
    K.ubox(u0, u1, 0.9, PH, PV0 + 0.8, PV1, 'marble')
bays = [(2.0, 3.0), (5.45, 3.0), (8.9, 3.0)]
K.wall(FRONT, 0.0, 2 * PU, 0.45, PH, 0.8,
       [(a, w, 0.9, 4.2, 'pointed', None) for a, w in bays] + [(5.45, 2.6, 6.2, 7.3, 'round')], 'marble')
for a, w in bays:                                                           # red-and-white voussoirs
    K.arch_ring(FRONT, a, w / 2, w / 2 + 0.3, 4.2, -0.1, 0.08, 'redstone', seg=10, kind='pointed')
K.ubox(-PU - 0.3, PU + 0.3, PH, PH + 0.35, PV0 - 0.3, PV1, 'marble')          # portico cornice
K.ubox(-PU - 0.2, PU + 0.2, PH + 0.35, PH + 0.55, PV0 - 0.2, PV1, 'lead')
for a in (-3.2, 3.2):                                                        # tile panels by the door
    K.ubox(a - 1.1, a + 1.1, 1.3, 3.6, PV1 - 0.06, PV1 + 0.02, 'tile')

K.finish()
