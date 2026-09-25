"""Ablution fountain of Mahmud I (Sadirvan) in the Hagia Sophia courtyard -- route `istanbul`.

Fact card
  OSM way      109738930, `building=roof historic=yes`, Wikidata Q135430309, Commons "Sadirvan in Hagia
               Sophia" (footprint owned by pipeline/landmarks.json)
  what         the octagonal ablution fountain commissioned by Sultan Mahmud I, 1740-41, a mix of classical
               Ottoman and Baroque ("Ottoman baroque"): a gilded cage over a marble basin under a wide roof
  footprint    regular octagon, 6.3 m sides, 15.2 m across the flats: the outline of the roof's eaves
  height       no OSM height; photo estimate: marble columns to 3.3 m, arcade to 5.45, frieze to 6.0,
               eaves 6.2 at the rim, roof up to 7.4, lead drum to 8.2, dome crown ~10.2, alem ~12.0
               (Commons "Ayasofya sadirvan genel gorunt", "DSC03812 Istanbul - Aya Sophia - Fontana")
  seen from    the race line passes ~55-60 m to the south-west, behind the school and the muvakkithane:
               the player sees the broad roof and the dome over them, and the arcade through the gap
  parts a local would name
    eight slender marble columns carrying pointed (ogee) arches            built: columns with bases
      and capitals, a pointed arcade between them
    frieze of gilded inscription panels on green                           built as a green band with
      a gold line (the calligraphy itself is surface detail, not geometry)
    very wide octagonal eave, lead on top, painted green-and-gold soffit    built: lead roof ring with
      a green soffit skin under it
    small lead dome on a low drum with a tall gilded finial                 built
    gilded bronze grille cage over the marble ablution basin                simplified: marble basin
      with taps band and a gilt cage of real openings would be thousands of triangles, so the cage is
      a gilt octagonal screen with a domed top
  style grammar (Ottoman baroque): columns and pointed arches, wide eaves, gilded detail, lead dome
    and alem -- built.
  unverified   exact column height and the eave rim height (photo proportions).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hs_precinct_kit import Kit, Fr, regular, offset_poly, ccw, TAU  # noqa: E402

K = Kit('hagia-sophia-sadirvan', ['marble', 'stone', 'lead', 'paint', 'gold'])

EAVE = regular(0.0, 0.0, 8, 7.62, 0.0)               # the OSM octagon (flats at u = +-7.62, v = +-7.62)
COL = regular(0.0, 0.0, 8, 4.3, 0.0)                 # the column ring
Y_COL, Y_FRIEZE = 3.3, 5.45

K.prism(offset_poly(ccw(COL), 0.9), 0.0, 0.35, 'stone')           # paved platform with a step
K.prism(offset_poly(ccw(COL), 0.4), 0.35, 0.6, 'marble')
# columns at the octagon's corners
for (cu, cv) in COL:
    K.revolve(cu, cv, [(0.34, 0.6), (0.34, 0.9), (0.2, 1.05), (0.19, Y_COL - 0.4), (0.24, Y_COL - 0.3)], 12, 'marble')
    K.ubox(cu - 0.34, cu + 0.34, Y_COL - 0.3, Y_COL, cv - 0.34, cv + 0.34, 'marble')        # capital
# pointed arches spanning between the columns, with the frieze above
pts = ccw(COL)
for i in range(8):
    p, q = pts[i], pts[(i + 1) % 8]
    L = math.hypot(q[0] - p[0], q[1] - p[1])
    t = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
    fr = Fr(p[0], p[1], t, (t[1], -t[0]))
    K.pierced(fr, 0.0, L, Y_COL - 0.3, Y_FRIEZE, -0.18, 0.18, (L / 2, L - 0.6, Y_COL - 0.25, Y_COL - 0.2), 'marble',
              pane=None, kind='pointed')
K.prism(offset_poly(ccw(COL), 0.2), Y_FRIEZE, Y_FRIEZE + 0.55, 'paint')          # inscription frieze
K.prism(offset_poly(ccw(COL), 0.24), Y_FRIEZE + 0.02, Y_FRIEZE + 0.1, 'gold')
K.prism(offset_poly(ccw(COL), 0.24), Y_FRIEZE + 0.45, Y_FRIEZE + 0.53, 'gold')
# the broad roof: lead on top, painted soffit under it, from the eave rim up to the drum
INNER = regular(0.0, 0.0, 8, 3.6, 0.0)
K.roof_ring(EAVE, 6.2, INNER, 7.4, 0.28, 'lead', soffit='paint')
K.roof_ring(offset_poly(ccw(EAVE), 0.04), 5.92, offset_poly(ccw(EAVE), -0.3), 5.92, 0.1, 'gold')   # gilt rim moulding
K.prism(offset_poly(ccw(COL), 0.15), Y_FRIEZE + 0.55, 7.1, 'paint')             # closes the ceiling
DRUM = regular(0.0, 0.0, 8, 3.3, 0.0)
K.prism(DRUM, 7.1, 8.1, 'lead')
K.moulding(DRUM, 8.05, 0.15, 0.15, 'lead')
crown = K.ribbed_dome(0.0, 0.0, 8.2, 3.25, 2.0, ribs=16, rings=10, rib=0.05)
K.revolve(0.0, 0.0, [(0.4, crown - 0.15), (0.25, crown + 0.1)], 10, 'lead')
K.finial(0.0, 0.0, crown + 0.05, 0.42)

# ------------------------------------------------------------------ basin and gilt cage
BASIN = regular(0.0, 0.0, 8, 2.9, 0.0)
K.prism(BASIN, 0.6, 1.55, 'marble')
K.moulding(BASIN, 1.5, 0.12, 0.1)
CAGE = regular(0.0, 0.0, 8, 2.7, 0.0)
K.prism(CAGE, 1.62, 3.3, 'gold')
K.ribbed_dome(0.0, 0.0, 3.3, 2.9, 1.0, 'gold', ribs=8, rings=6, rib=0.05)

K.finish()
