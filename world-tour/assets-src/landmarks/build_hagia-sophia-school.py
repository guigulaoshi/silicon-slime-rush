"""Primary school of Mahmud I (Sibyan Mektebi), Hagia Sophia precinct -- route `istanbul`.

Fact card
  OSM way      109738924, `building=yes historic=yes`, unnamed (footprint owned by pipeline/landmarks.json).
               OSM puts the name "Sibyan Mektebi" on the square way 109738926 next to it, but Wikidata
               Q132530378 (Commons "Sibyan Maktab of Hagia Sophia") places the school exactly on this way,
               and the courtyard photos agree: seen from the museum exit the striped school stands
               south-west of the sadirvan, and the muvakkithane faces it across the exit path.
  what         elementary school built for Sultan Mahmud I, 1740 (site plaque, Commons photo)
  footprint    13.4 x 10.2 m rectangle; a long side faces south-west, onto the square and the race line
  height       no OSM height; photo estimate: two storeys, walls 7.4 m, cornice 7.8, octagonal drum to
               10.0, dome crown ~12.2, alem ~13.3 (Commons "Building in the courtyard of Hagia Sophia",
               "Hagia Sophia Courtyard view from usual exit")
  seen from    the race line passes ~40 m to the south-west: the player sees the long south-west face
               and the drum and dome over the courtyard railings
  parts a local would name
    striped walls: alternating courses of stone and brick (almasik)        built as alternating
      stone and brick courses (geometry bands, 0.42 m stone / 0.30 m brick)
    two storeys of rectangular windows in stone frames, brick relieving arches over them   built
    small door with a tiled hood                                             built (door, hood)
    low hipped lead roof round a red-rendered octagonal drum with small windows   built
    lead dome with alem                                                      built
    chimney on the roof                                                      built
  style grammar (18th-century Ottoman): striped masonry, stone window frames, brick relieving arches,
    wide cornice, drum and dome -- built.
  unverified   which short side has the door (put on the south-east side, towards the exit path); window
               count on the long sides (three per storey assumed from the 13.4 m length).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hs_precinct_kit import Kit, Fr, regular, offset_poly, ccw  # noqa: E402

K = Kit('hagia-sophia-school', ['stone', 'brick', 'plaster', 'lead', 'grille', 'gold', 'wood'])

HU, HV = 5.1, 6.7
RECT = [(-HU, -HV), (HU, -HV), (HU, HV), (-HU, HV)]
H, D = 7.4, 0.45
BANDS = [(0.8, 'stone')]
y = 0.8
while y < H + 0.5:
    BANDS.append((round(y + 0.30, 3), 'brick'))
    BANDS.append((round(y + 0.72, 3), 'stone'))
    y += 0.72

K.prism(offset_poly(ccw(RECT), 0.15), 0.0, 0.3, 'stone')


def openings(i, fr, L):
    long = L > 12
    xs = (L / 2 - 4.0, L / 2, L / 2 + 4.0) if long else (L / 2 - 2.7, L / 2 + 2.7)
    ops = [(a, 1.25, 4.2, 6.1, 'rect') for a in xs]
    if not long and fr.n[1] > 0.9:                         # door side (south-east, the exit path)
        ops += [(a, 0.9, 1.2, 2.5, 'rect') for a in xs]
        ops.append((L / 2, 1.1, 0.3, 2.5, 'round', 'wood'))
    else:
        ops += [(a, 0.9, 1.2, 2.5, 'rect') for a in xs]
    return ops


frames = K.polygon_body(RECT, 0.3, H, D, openings, 'stone', bands=BANDS)
for fr, L in frames:
    long = L > 12
    xs = (L / 2 - 4.0, L / 2, L / 2 + 4.0) if long else (L / 2 - 2.7, L / 2 + 2.7)
    for a in xs:
        # stone frames and brick relieving arches, as in the photos
        K.box(fr, a - 0.8, a + 0.8, 6.1, 6.3, 0.0, 0.1, 'stone')
        K.box(fr, a - 0.8, a + 0.8, 4.0, 4.2, 0.0, 0.1, 'stone')
        K.arch_ring(fr, a, 0.35, 0.85, 6.3, -0.05, 0.06, 'brick', seg=8, kind='pointed')
        K.arch_ring(fr, a, 0.2, 0.6, 2.7, -0.05, 0.06, 'brick', seg=8, kind='pointed')
        K.box(fr, a - 0.6, a + 0.6, 2.5, 2.7, 0.0, 0.1, 'stone')
    if not long and fr.n[1] > 0.9:                     # tiled hood over the door
        K.box(fr, L / 2 - 1.0, L / 2 + 1.0, 3.0, 3.15, 0.0, 0.9, 'lead')
top = K.corbel_cornice(RECT, H, [(0.2, 0.1), (0.2, 0.3)], 'stone')
# low hipped lead roof rising to the drum
RIN = [(-3.2, -3.2), (3.2, -3.2), (3.2, 3.2), (-3.2, 3.2)]
K.frustum(offset_poly(ccw(RECT), 0.5), top, RIN, top + 1.2, 'lead')
K.prism(offset_poly(ccw(RECT), 0.5), top - 0.12, top, 'lead')
DRUM = regular(0.0, 0.0, 8, 3.0, 0.0)
K.polygon_body(DRUM, top + 0.2, top + 2.4, 0.3,
               lambda i, fr, L: [(L / 2, 0.5, top + 1.3, top + 1.9, 'round')], 'plaster')
t2 = K.corbel_cornice(DRUM, top + 2.4, [(0.15, 0.08), (0.12, 0.2)], 'stone')
crown = K.ribbed_dome(0.0, 0.0, t2, 3.2, 2.1, ribs=20, rings=10, rib=0.05)
K.revolve(0.0, 0.0, [(0.45, crown - 0.2), (0.3, crown + 0.1)], 10, 'lead')
K.finial(0.0, 0.0, crown + 0.06, 0.24)
# chimney near the north-east corner
K.ubox(3.3, 3.9, top, top + 2.6, -5.2, -4.6, 'stone')
K.ubox(3.2, 4.0, top + 2.6, top + 2.8, -5.3, -4.5, 'stone')

K.finish()
