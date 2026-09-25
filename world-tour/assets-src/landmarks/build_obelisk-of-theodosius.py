"""Obelisk of Theodosius (Dikilitas), Hippodrome / Sultanahmet Square -- route `istanbul`.

Fact card
  OSM object     way 1120852417 (man_made=obelisk; a 2.3 x 2.2 m square = the shaft's foot) inside its
                 railing, way 1154702452 (barrier=fence, material=stone, 9.6 x 9.9 m, turned 52 deg from east
                 like the Hippodrome's spina).  Registered (--level-ground: a flat square the elevation data tilts) as a point at the railing's centre, 9.6 x 9.9 m.
  Height         red Aswan granite shaft 18.45-18.54 m (the lower third broke off in antiquity), 24.87-25.6 m with
                 its pedestal [tr/en.wikipedia]; the pedestal stands in a pit down to the ancient arena level
                 ("cemberle cevrili alanin toprak boyu eskideki topragin boyudur" [tr.wikipedia]), so today's
                 paving meets it at the foot of the upper, sculpted marble block [photos Dado_di_teodosio,
                 Dikili_Taslar].  Built: relief block 0 -> 2.35 m, cornice to 2.7, four bronze cubes to 3.45,
                 shaft 18.5 m (pyramidion 1.5 m) -> apex 21.95 m above the square.
  Plan           shaft 2.26 m square at the foot, 1.56 m under the pyramidion [OSM 2.3 m; photo taper];
                 relief block 3.2 m square [photo: 1.4 x the shaft]; railing 9.6 x 9.9 m on a stone kerb.
  Seen from      the race line passes 18.9 m from the railing (24.9 m from the shaft), heading NE up the
                 Hippodrome; the obelisk is the tall pink needle on the left of the first straight.
  Parts a local would name
    - the granite shaft with its hieroglyph columns and pyramidion ............. built; each face's
      column of glyphs is a stack of shallow darker plates (no legible signs)
    - the four bronze cubes it rests on (the gap under the shaft) ................ built
    - the marble pedestal with the Theodosian reliefs (emperor in the kathisma, rows of
      courtiers and spectators) ....................................................... built as relief:
      a framed panel per face with a row of standing figures under the imperial box above two rows of
      heads -- figure-scale geometry, not a sculpture
    - the lower pedestal (chariot race, the obelisk's raising, the Latin/Greek inscriptions) and the
      granite blocks between ....................................................... not built: below
      today's paving, in the pit
    - the sunken pit with pink rendered walls ...................................... simplified: the
      terrain is not cut under a landmark; a dark disc inside the kerb stands for the view into it
    - the wrought-iron railing between stone posts on a stone kerb .................. built
  Style grammar  (Roman imperial monument): framed relief panels, a moulded cornice slab -- built.
  Unverified     relief block height (photo), pit depth (photo), post spacing (photo).
"""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sultanahmet_kit import Kit, SF, rect  # noqa: E402

ID = 'obelisk-of-theodosius'
K = Kit(ID, ['stone', 'marble', 'carved', 'iron'])
K.M.material('granite', (0.36, 0.27, 0.23), 0.0, 0.6, ID + '_granite')     # pink-grey Aswan granite [photo]
K.M.material('glyph', (0.20, 0.145, 0.125), 0.0, 0.8, ID + '_glyph')         # the cut glyphs read darker
K.M.material('bronze', (0.12, 0.13, 0.11), 0.6, 0.5, ID + '_bronze')       # the four cubes, black-green
K.M.material('pit', (0.30, 0.20, 0.18), 0.0, 0.95, ID + '_pit')            # shadowed pink render
rng = random.Random(390)

HU, HV = 4.8, 4.95                     # railing half sizes (way 1154702452)
KW, KH = 0.45, 0.35                    # kerb width and height
B = 1.60                               # relief block half side
B_TOP, CORN_TOP = 2.35, 2.70
CUBE_TOP = 3.45
S0, S1, SHAFT_TOP, APEX = 1.13, 0.78, 3.45 + 17.0, 3.45 + 18.5

# ------------------------------------------------------------------ enclosure
path = [(-HU + KW / 2, -HV + KW / 2), (HU - KW / 2, -HV + KW / 2), (HU - KW / 2, HV - KW / 2), (-HU + KW / 2, HV - KW / 2)]
K.loop_sweep(path, [(-KW / 2, 0.0), (KW / 2, 0.0), (KW / 2, KH - 0.05), (KW / 2 - 0.05, KH), (-KW / 2 + 0.05, KH),
                    (-KW / 2, KH - 0.05)], 'stone')
K.box(-HU + KW - 0.01, HU - KW + 0.01, 0.0, 0.05, -HV + KW - 0.01, HV - KW + 0.01, 'pit')
posts = []
for (u0, v0), (u1, v1) in zip(path, path[1:] + path[:1]):
    for k in range(4):
        posts.append((u0 + (u1 - u0) * k / 4, v0 + (v1 - v0) * k / 4))
for u, v in posts:
    K.box(u - 0.21, u + 0.21, KH, KH + 1.30, v - 0.21, v + 0.21, 'stone')
    K.box(u - 0.26, u + 0.26, KH + 1.30, KH + 1.40, v - 0.26, v + 0.26, 'stone')
    K.pyramid([(u - 0.2, v - 0.2), (u + 0.2, v - 0.2), (u + 0.2, v + 0.2), (u - 0.2, v + 0.2)], KH + 1.40, (u, KH + 1.62, v), 'stone')
for a, b in zip(posts, posts[1:] + posts[:1]):
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    t = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    K.railing([(a[0] + t[0] * 0.22, a[1] + t[1] * 0.22), (b[0] - t[0] * 0.22, b[1] - t[1] * 0.22)], KH, 1.05,
              closed=False, spacing=0.15, scroll_every=0.62)

# ------------------------------------------------------------------ the sculpted marble block
K.box(-B, B, 0.0, B_TOP, -B, B, 'marble')
faces = [SF((0, -B), (-1, 0), (0, -1)), SF((B, 0), (0, -1), (1, 0)), SF((0, B), (1, 0), (0, 1)), SF((-B, 0), (0, 1), (-1, 0))]
for f in faces:
    # moulded frame round the panel and a base band
    for x0, x1, y0, y1 in [(-B, -B + 0.12, 0.12, B_TOP), (B - 0.12, B, 0.12, B_TOP), (-B, B, 0.0, 0.14),
                           (-B, B, 1.08, 1.16), (-B, B, B_TOP - 0.1, B_TOP)]:
        K.prism(f, rect(x0, x1, y0, y1), 0.0, 0.07, 'marble')
    # upper register: courtiers and guards standing under the imperial box (kathisma)
    for i in range(15):
        x = -B + 0.3 + (2 * B - 0.6) * i / 14
        if abs(x) < 0.42:
            continue
        h = 0.72 + rng.uniform(-0.05, 0.05)
        K.prism(f, rect(x - 0.075, x + 0.075, 1.18, 1.18 + h), 0.0, 0.07, 'carved')
        K.revolve(f.p(x, 1.18 + h + 0.08, 0.03)[::2], [(0.07, 1.18 + h), (0.08, 1.18 + h + 0.08), (0.06, 1.18 + h + 0.16),
                                                     (0.0, 1.18 + h + 0.18)], 6, 'carved', smooth=False)
    for x in (-0.4, 0.4):                                   # the kathisma's two columns and its lintel
        K.prism(f, rect(x - 0.05, x + 0.05, 1.16, 2.1), 0.0, 0.09, 'carved')
    K.prism(f, rect(-0.46, 0.46, 2.1, 2.2), 0.0, 0.09, 'carved')
    for x in (-0.17, 0.0, 0.17):                            # the emperor and his family
        K.prism(f, rect(x - 0.07, x + 0.07, 1.25, 1.95 + (0.08 if x == 0 else 0)), 0.0, 0.06, 'carved')
    # lower register: two rows of spectators' heads
    for row, y in enumerate((0.42, 0.78)):
        n = 17
        for i in range(n):
            x = -B + 0.25 + (2 * B - 0.5) * (i + 0.5 * row) / n
            K.revolve(f.p(x, y, 0.0)[::2], [(0.085, y - 0.12), (0.095, y), (0.07, y + 0.1), (0.0, y + 0.13)], 6, 'carved',
                      smooth=False)
            K.prism(f, rect(x - 0.1, x + 0.1, y - 0.3, y - 0.1), 0.0, 0.05, 'carved')
# the heads and bodies above are revolved round points on the face, so half of each sits in the block:
# a relief, not free-standing figures.

# cornice slab over the block
K.frustum([(-B - 0.03, -B - 0.03), (B + 0.03, -B - 0.03), (B + 0.03, B + 0.03), (-B - 0.03, B + 0.03)], B_TOP,
          [(-B - 0.18, -B - 0.18), (B + 0.18, -B - 0.18), (B + 0.18, B + 0.18), (-B - 0.18, B + 0.18)], B_TOP + 0.15, 'marble')
K.box(-B - 0.18, B + 0.18, B_TOP + 0.15, CORN_TOP, -B - 0.18, B + 0.18, 'marble')

# ------------------------------------------------------------------ the bronze cubes and the shaft
for su in (-1, 1):
    for sv in (-1, 1):
        cu, cv = su * (S0 - 0.32), sv * (S0 - 0.32)
        K.box(cu - 0.32, cu + 0.32, CORN_TOP, CUBE_TOP, cv - 0.32, cv + 0.32, 'bronze')
sq = lambda h: [(-h, -h), (h, -h), (h, h), (-h, h)]
K.frustum(sq(S0), CUBE_TOP, sq(S1), SHAFT_TOP, 'granite')
K.pyramid(sq(S1), SHAFT_TOP, (0.0, APEX, 0.0), 'granite')


def half_width(y):
    return S0 + (S1 - S0) * (y - CUBE_TOP) / (SHAFT_TOP - CUBE_TOP)


# hieroglyphs: one central column of cut signs per face, and the offering scene under the pyramidion
for k, f in enumerate([((0, -1), (-1, 0)), ((1, 0), (0, -1)), ((0, 1), (1, 0)), ((-1, 0), (0, 1))]):
    n, t = f
    y = CUBE_TOP + 0.9
    while y < SHAFT_TOP - 1.9:
        h = rng.uniform(0.18, 0.55)
        if rng.random() < 0.25:                             # a cartouche: a tall framed oval block
            h = rng.uniform(0.7, 1.1)
        w = rng.uniform(0.22, 0.42) * (half_width(y) / S0) ** 0.5
        x = rng.uniform(-0.05, 0.05)
        d = half_width(y + h / 2)
        fr = SF((n[0] * d, n[1] * d), t, n)
        K.prism(fr, rect(x - w / 2, x + w / 2, y, y + h), -0.02, 0.012, 'glyph')
        y += h + rng.uniform(0.06, 0.16)
    d = half_width(SHAFT_TOP - 0.9)
    fr = SF((n[0] * d, n[1] * d), t, n)
    K.prism(fr, rect(-0.55, 0.55, SHAFT_TOP - 1.55, SHAFT_TOP - 0.3), -0.02, 0.012, 'glyph')

K.finish()
