"""Tomb of the Princes (Sehzadeler Turbesi), Hagia Sophia precinct -- route `istanbul`.

Fact card
  OSM way      132277807 "Sehzadeler Turbesi" (footprint owned by pipeline/landmarks.json)
  what         tomb of four sons and a daughter of Murad III, attributed to Mimar Sinan, late 16th century
               (site plaque: "simple square appearance from outside and an octagonal plan inside ...
               covered by sandstone ... a three-arched marble portico (revak) at the front")
  footprint    OSM draws a regular octagon, 3.45 m sides, 8.3 m across the flats. The photos show a square
               lower storey whose corners are chamfered off higher up, so the lower storey is built as
               the 8.3 m square (its corners stand ~1.2 m outside the OSM octagon) and the upper storey as
               the OSM octagon; the portico stands on the north side, in front of the door, outside the
               OSM outline (Commons "Tomb of Princes -at Hagia Sophia - 02", "... porch in 2009 6794")
  height       no OSM height; photo estimate: square storey 4.8 m, octagonal storey to 7.4, cornice 7.8,
               dome crown ~10.2, alem ~11.4 (relative to the 8.3 m width and the neighbouring Murad III)
  seen from    the race line passes ~50 m to the south-east: the player sees the south and east faces
               and the dome between Murad III's tomb and the school
  parts a local would name
    small domed tomb of kufeki sandstone, square below, chamfered above       built
    three grilled round-arched windows on each main face of the upper storey, one on each chamfer
      (Commons photo 02)                                                      built
    rectangular lower windows                                                 built, two per side face
    lead dome with alem                                                       built
    three-arched marble portico in front of the door                          built: three round arches,
      piers, flat lead roof
  style grammar: ashlar, cornice, dome, deep grilled windows, arched portico -- built.
  unverified   lower-storey windows on the faces we see (interior photos show two per wall).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hs_precinct_kit import Kit, Fr, regular, offset_poly, ccw, chamfered_rect  # noqa: E402

K = Kit('tomb-of-the-princes', ['stone', 'marble', 'lead', 'grille', 'gold', 'wood'])

HALF = 4.15
SQUARE = [(-HALF, -HALF), (HALF, -HALF), (HALF, HALF), (-HALF, HALF)]
OCT = chamfered_rect(-HALF, HALF, -HALF, HALF, HALF - 1.72)       # the OSM octagon (3.45 m sides)
D = 0.45
Y1, Y2 = 4.8, 7.4

K.prism(offset_poly(ccw(SQUARE), 0.2), 0.0, 0.35, 'stone')


def lower(i, fr, L):
    if fr.n[0] < -0.9:                                  # north side: the door under the portico
        return [(L / 2, 1.3, 0.6, 2.7, 'round', 'wood')]
    return [(L / 2 - 1.6, 0.9, 1.0, 2.6, 'rect'), (L / 2 + 1.6, 0.9, 1.0, 2.6, 'rect')]


def upper(i, fr, L):
    if L < 3.0:
        return [(L / 2, 0.55, Y1 + 0.5, Y1 + 1.6, 'round')]
    return [(L / 2 + k * 0.95, 0.55, Y1 + 0.5, Y1 + 1.6, 'round') for k in (-1, 0, 1)]


K.polygon_body(SQUARE, 0.35, Y1, D, lower, 'stone')
# the corners are cut off above the lower storey: sloping triangular chamfers from square to octagon
for (px, pz) in SQUARE:
    sx, sz = math.copysign(1, px), math.copysign(1, pz)
    c = 1.72
    K.raw([(px, Y1, pz), (px - sx * c, Y1, pz), (px, Y1, pz - sz * c), (px - sx * c, Y1 + 0.6, pz), (px, Y1 + 0.6, pz - sz * c)],
          [(0, 2, 1), (1, 3, 0), (0, 3, 4), (0, 4, 2), (1, 2, 4, 3)], 'stone')
K.polygon_body(OCT, Y1, Y2, D, upper, 'stone')
K.moulding(OCT, Y1 - 0.1, 0.2, 0.08)
top = K.corbel_cornice(OCT, Y2, [(0.2, 0.1), (0.2, 0.25)])
K.prism(offset_poly(ccw(OCT), 0.1), top, top + 0.15, 'lead')
DR = 3.7
crown = K.ribbed_dome(0.0, 0.0, top + 0.1, DR, 2.3, ribs=20, rings=10, rib=0.05)
K.revolve(0.0, 0.0, [(0.5, crown - 0.2), (0.3, crown + 0.12)], 10, 'lead')
K.finial(0.0, 0.0, crown + 0.08, 0.26)

# ------------------------------------------------------------------ three-arched marble portico (north)
PU0, PH = -HALF - 3.0, 4.2
K.ubox(PU0, -HALF, 0.0, 0.6, -3.3, 3.3, 'stone')
FRONT = Fr(PU0, 3.3, (0.0, -1.0), (-1.0, 0.0))       # a runs -v along the front, d outward (-u)
K.wall(FRONT, 0.0, 6.6, 0.3, PH, 0.45, [(a, 1.7, 0.6, 2.9, 'round', None) for a in (1.2, 3.3, 5.4)], 'marble')
for v0, v1 in ((-3.3, -2.85), (2.85, 3.3)):
    K.ubox(PU0 + 0.45, -HALF, 0.6, PH, v0, v1, 'marble')
K.ubox(PU0 - 0.15, -HALF, PH, PH + 0.3, -3.45, 3.45, 'marble')
K.ubox(PU0 - 0.1, -HALF, PH + 0.3, PH + 0.45, -3.4, 3.4, 'lead')

K.finish()
