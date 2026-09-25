"""Walled Obelisk (Orme Dikilitas, "Constantine's obelisk"), Hippodrome / Sultanahmet Square -- route `istanbul`.

Fact card
  OSM object     way 1120852418 (man_made=obelisk, height=32; a nominal 2.3 m square) inside its railing,
                 way 1154702451 (barrier=fence, 14.7 x 14.1 m, turned 51 deg from east along the spina).
                 Registered (--level-ground: a flat square the elevation data tilts) as a point at the railing's centre, 14.7 x 14.1 m.
  Height         32 m [OSM height=32; en/tr.wikipedia "32 m"].  Like its neighbours it was dug out down to the
                 ancient level in 1856 (tr.wikipedia: "cukurda kalan sutunun etrafi ... kazilarak acigi
                 cikarilmistir"), so part of it stands in the pit: 2.5 m taken as below today's paving [photo
                 Dikilitas_Anitlari: the pit is shallower than Theodosius's] -> 29.5 m above the square.
  Plan           foot 3.6 m square, top 2.0 m [photo Constantine_Obelisk, frontal from ~60 m: 80 px foot, 45 px
                 top, 655 px tall for 32 m]; OSM's 2.3 m square is a placeholder, not a survey.
  Seen from      the race line passes 20 m from the railing (26 m from the shaft); it is the first tall thing on
                 the left after the start, and its rough grey silhouette against the smooth pink Theodosius
                 obelisk 70 m on is what tells the two apart.
  Parts a local would name
    - the rough-cut limestone masonry shaft, courses of uneven blocks, pocked with the holes left by
      the lost gilded bronze plates ................................................ built: every course
      is its own row of blocks standing unevenly proud of a core, some blocks missing, dark fixing holes
    - the small broken pyramidal top ............................................... built (a low, off-centre
      pyramid)
    - the base and inscription block (Constantine VII's verses) .................. not built: in the pit
    - the pit ............................................................................ simplified: dark disc
      (the terrain is not cut under a landmark)
    - the railing: stone posts with pyramidal caps, scrollwork iron, on a pink-rendered kerb .... built
  Style grammar  (late Roman rubble-and-ashlar pier): coursed blocks, joints, weathering -- geometry.
  Unverified     pit depth, foot and top widths (photo ratios), post count (photo).
"""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sultanahmet_kit import Kit, SF, rect  # noqa: E402

ID = 'walled-obelisk'
K = Kit(ID, ['stone', 'iron'])
K.M.material('limestone', (0.66, 0.64, 0.58), 0.0, 0.9, ID + '_limestone')     # pale courses [photo]
K.M.material('stone_dark', (0.43, 0.41, 0.37), 0.0, 0.9, ID + '_stone_dark')   # weathered blocks
K.M.material('hole', (0.10, 0.09, 0.08), 0.0, 1.0, ID + '_hole')               # fixing holes, breaks
K.M.material('plaster', (0.55, 0.33, 0.28), 0.0, 0.9, ID + '_plaster')         # pink-rendered kerb [photo]
K.M.material('pit', (0.28, 0.20, 0.17), 0.0, 0.95, ID + '_pit')
rng = random.Random(912)

HU, HV = 7.05, 7.35              # railing half sizes: u across the spina, v along it
KW, KH = 0.5, 0.38
F0, F1, TOP, APEX = 1.80, 1.00, 29.0, 29.5

# ------------------------------------------------------------------ enclosure
path = [(-HU + KW / 2, -HV + KW / 2), (HU - KW / 2, -HV + KW / 2), (HU - KW / 2, HV - KW / 2), (-HU + KW / 2, HV - KW / 2)]
K.loop_sweep(path, [(-KW / 2, 0.0), (KW / 2, 0.0), (KW / 2, KH - 0.08), (-KW / 2, KH - 0.08)], 'plaster')
K.loop_sweep(path, [(-KW / 2 - 0.03, KH - 0.08), (KW / 2 + 0.03, KH - 0.08), (KW / 2 + 0.03, KH), (-KW / 2 - 0.03, KH)], 'stone')
K.box(-HU + KW - 0.01, HU - KW + 0.01, 0.0, 0.05, -HV + KW - 0.01, HV - KW + 0.01, 'pit')
posts = []
for (u0, v0), (u1, v1) in zip(path, path[1:] + path[:1]):
    for k in range(3):
        posts.append((u0 + (u1 - u0) * k / 3, v0 + (v1 - v0) * k / 3))
for u, v in posts:
    K.box(u - 0.23, u + 0.23, KH, KH + 1.25, v - 0.23, v + 0.23, 'stone')
    K.box(u - 0.28, u + 0.28, KH + 1.25, KH + 1.36, v - 0.28, v + 0.28, 'stone')
    K.pyramid([(u - 0.22, v - 0.22), (u + 0.22, v - 0.22), (u + 0.22, v + 0.22), (u - 0.22, v + 0.22)], KH + 1.36,
              (u, KH + 1.66, v), 'stone')
for a, b in zip(posts, posts[1:] + posts[:1]):
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    t = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    K.railing([(a[0] + t[0] * 0.24, a[1] + t[1] * 0.24), (b[0] - t[0] * 0.24, b[1] - t[1] * 0.24)], KH, 1.05,
              closed=False, spacing=0.15, scroll_every=0.7)

# ------------------------------------------------------------------ the shaft


def half(y):
    return F0 + (F1 - F0) * y / TOP


sq = lambda h: [(-h, -h), (h, -h), (h, h), (-h, h)]
CORE = 0.09
K.frustum(sq(F0 - CORE), 0.0, sq(F1 - CORE), TOP, 'stone_dark')
FACES = [((0, -1), (-1, 0)), ((1, 0), (0, -1)), ((0, 1), (1, 0)), ((-1, 0), (0, 1))]
y = 0.0
course = 0
while y < TOP - 0.05:
    h = min(TOP - y, rng.uniform(0.34, 0.52))
    for n, t in FACES:
        w = half(y + h / 2)
        fr = SF((n[0] * w, n[1] * w), t, n)
        cuts = sorted(rng.uniform(-w * 0.8, w * 0.8) for _ in range(rng.choice((1, 2, 2, 3))))
        edges = [-w - 0.02] + cuts + [w + 0.02]
        for x0, x1 in zip(edges, edges[1:]):
            gap = 0.018
            r = rng.random()
            if r < 0.07 and 4.0 < y < TOP - 2:                       # a lost block: the core shows, dark
                K.prism(fr, rect(x0 + gap, x1 - gap, y + gap, y + h - gap), -CORE - 0.02, -0.05, 'hole')
                continue
            jut = rng.uniform(-0.03, 0.05)
            mat = 'limestone' if r < 0.62 else ('stone' if r < 0.9 else 'stone_dark')
            K.prism(fr, rect(x0 + gap, x1 - gap, y + gap, y + h - gap), -CORE - 0.01, jut, mat)
            if rng.random() < 0.22 and 3.0 < y < TOP - 1.5 and x1 - x0 > 0.5:   # a fixing hole
                hx = rng.uniform(x0 + 0.15, x1 - 0.15)
                hy = y + h * rng.uniform(0.35, 0.65)
                K.prism(fr, rect(hx - 0.07, hx + 0.07, hy - 0.06, hy + 0.06), jut - 0.02, jut + 0.006, 'hole')
    y += h
    course += 1

# the broken pyramidal top, a little off centre
K.pyramid(sq(F1 - 0.02), TOP, (0.12, APEX, -0.08), 'stone')

K.finish()
