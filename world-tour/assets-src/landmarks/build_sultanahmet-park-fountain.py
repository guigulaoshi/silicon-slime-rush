"""The fountain in Sultanahmet Park, between the Blue Mosque and Hagia Sophia -- route `istanbul`.

Fact card
  OSM object     way 308464130 (amenity=fountain, natural=water, barrier=kerb, kerb=raised, lit=yes), a
                 circle 26.0 m across (528 m2).  Registered with --level-ground: the pool is level water and
                 the elevation data reads 1.2 m of fall across it.
  Height         the jets: ~8.2 m for the central column when it runs [photo "Hagia Sophia - 04sep2005
                 (fontains)": the central jets stand about as high as the park's lamp posts are tall twice
                 over; photo estimate].  Rim ~0.55 m [photo "Hagia Sophia from the Sultanahmet Square 2017"].
  Plan           a round basin with a raised white marble rim ~0.75 m wide whose inner face carries a row of
                 nozzles; a turquoise-tiled floor with a dark blue eight-pointed star laid in it [satellite,
                 photo 2017]; nozzles over the floor; when running, a tall central column, a ring of shorter
                 jets round it and arcs thrown inward from the rim [photo 2005].
  Seen from      the race line goes round the park on its north-west and north-east sides, 50-65 m from the
                 rim, with the fountain between the car and Hagia Sophia / the Blue Mosque for ~200 m.
  What the pipeline does with the water  natural=water polygons become inland water only above 2000 m2
                 (pipeline/sr/landcover.py INLAND_MIN_AREA) and `water` is not a ground-cover value, so
                 nothing is drawn for this pool: the model brings its own water surface and floor.
  Parts a local would name
    - the round marble rim .................................................. built
    - the turquoise floor with the blue star ................................ built (seen through the water)
    - the water ............................................................... built: a translucent surface
    - the jets: central column, inner ring, arcs from the rim ............... built static, translucent white
    - the nozzles in the floor and rim ....................................... not built: 10 cm stubs at 50 m
    - the flower beds and the paved ring round it .......................... not built: ground, outside the
      mapped pool
  Unverified     jet heights (the display varies; photo estimate), rim height.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sultanahmet_kit import Kit, TAU  # noqa: E402

ID = 'sultanahmet-park-fountain'
K = Kit(ID, ['marble'])
K.M.material('tile', (0.10, 0.40, 0.42), 0.0, 0.35, ID + '_tile')          # turquoise floor tiles [photo]
K.M.material('tile_blue', (0.02, 0.05, 0.22), 0.0, 0.35, ID + '_tile_blue')  # the star
K.M.material('water', (0.22, 0.46, 0.52), 0.0, 0.04, ID + '_water')
K.M.material('spray', (0.86, 0.90, 0.94), 0.0, 0.25, ID + '_spray')
K.translucent('water', 0.55)
K.translucent('spray', 0.42)

R = 12.96                                   # sqrt(528 m2 / pi)
RIN = R - 0.75
WATER = 0.40

# rim, floor, the star in the floor
K.lathe((0, 0), [(RIN, 0.0), (R, 0.0), (R, 0.42), (R - 0.12, 0.55), (RIN + 0.1, 0.55), (RIN, 0.46)], 96, 'marble', smooth=False)
K.revolve((0, 0), [(RIN + 0.01, 0.0), (RIN + 0.01, 0.08), (0.0, 0.08)], 96, 'tile', smooth=False)
for rot in (0.0, math.pi / 4):
    sq = [(10.6 * math.cos(rot + math.pi / 4 + k * math.pi / 2), 10.6 * math.sin(rot + math.pi / 4 + k * math.pi / 2)) for k in range(4)]
    for a, b in zip(sq, sq[1:] + sq[:1]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = (-(b[1] - a[1]) / L * 0.35, (b[0] - a[0]) / L * 0.35)
        K.extrude([(a[0] - n[0], a[1] - n[1]), (b[0] - n[0], b[1] - n[1]), (b[0] + n[0], b[1] + n[1]), (a[0] + n[0], a[1] + n[1])],
                  0.08, 0.095, 'tile_blue')
K.annulus((0, 0), 3.7, 4.3, 0.08, 0.095, 48, 'tile_blue')

# the water surface
K.revolve((0, 0), [(RIN + 0.02, WATER - 0.06), (RIN + 0.02, WATER), (0.0, WATER)], 96, 'water', smooth=False)

# the jets, frozen: a central cluster -- one tall column and four shorter ones leaning out a little ...
for k, (cu, cv, top) in enumerate([(0.0, 0.0, 8.2)] + [(0.55 * math.cos(TAU * i / 4), 0.55 * math.sin(TAU * i / 4), 6.4)
                                                        for i in range(4)]):
    pts, radii = [], []
    for i in range(11):
        t = i / 10
        pts.append((cu * (1 + 0.8 * t), WATER + (top - WATER) * t, cv * (1 + 0.8 * t)))
        radii.append((0.30 if k == 0 else 0.20) * (1 - 0.35 * t) + 0.18 * math.sin(math.pi * t) ** 2)
    radii[-1] = 0.04
    K.vtube(pts, radii, 'spray', 10)
K.revolve((0, 0), [(1.5, WATER), (1.1, WATER + 0.4), (0.0, WATER + 0.5)], 24, 'spray')   # foam round its foot
# ... a ring of eight jets round it ...
for k in range(8):
    a = TAU * (k + 0.5) / 8
    c = (2.6 * math.cos(a), 2.6 * math.sin(a))
    pts, radii = [], []
    for i in range(9):
        t = i / 8
        r = 2.6 - 0.5 * t
        pts.append((r * math.cos(a), WATER + 4.3 * t, r * math.sin(a)))
        radii.append(0.12 + 0.16 * t * t)
    K.vtube(pts, radii, 'spray', 8)
    K.revolve(c, [(0.55, WATER), (0.4, WATER + 0.25), (0.0, WATER + 0.3)], 10, 'spray')
# ... and arcs thrown inward from the rim
for k in range(32):
    a = TAU * k / 32
    pts, radii = [], []
    for i in range(13):
        t = i / 12
        r = RIN - 0.2 - 4.6 * t
        y = WATER + 0.15 + 3.1 * 4 * t * (1 - t)
        pts.append((r * math.cos(a), y, r * math.sin(a)))
        radii.append(0.05 + 0.07 * t)
    K.vtube(pts, radii, 'spray', 6)
    land = RIN - 4.8
    K.revolve((land * math.cos(a), land * math.sin(a)), [(0.45, WATER), (0.3, WATER + 0.18), (0.0, WATER + 0.22)], 8, 'spray')

K.finish()
