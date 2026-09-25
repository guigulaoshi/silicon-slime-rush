"""Serpent Column (Yilanli Sutun, the Plataean tripod), Hippodrome / Sultanahmet Square -- route `istanbul`.

Fact card
  OSM object     node 415157636 (historic=column); its railing is way 1154702449 (barrier=fence), a
                 circle 7.2-7.3 m across.  Registered (--level-ground: a flat square the elevation data tilts) as a point at the railing's centre, 7.3 x 7.3 m.
  Height         bronze column 5.35 m surviving of an original 6.5 m (8 m with the gold cauldron) [tr.wikipedia
                 Yilanli Sutun: "5 metrelik bolumu", "6,5 m ... kazanla birlikte 8 metre"]; 29 coils survive
                 [same].  It stands in a pit dug down to the ancient arena floor (Newton 1855-56), so only
                 its upper part rises above today's paving: the tip is ~1.4 m above the railing [photo
                 Serpent_Column_Istanbul_1].  Pit depth taken as 2.4 m -> tip 2.95 m above the square.
  Plan           a circular sunken pit, a ring of kerb stones ~0.6 m wide and 0.4 m high, a scrollwork iron
                 railing ~1.15 m on the kerb, short stone stubs at its foot, the column in the middle.
  Seen from      the race line runs 20.8 m from the railing (27 m from the column) along the Hippodrome's
                 west side; the column is the low dark twist between the two obelisks.
  Parts a local would name
    - three intertwined bronze serpents, coiled (29 coils), heads lost .......... built (three helical
      tubes, green-bronze, tapering; the broken top narrows the way the photo does)
    - the pit round it ............................................................ simplified: the game's
      terrain is not cut under a landmark, so a hole would be hidden under the ground; a dark rubble disc
      inside the kerb stands for looking down into it (from the road the pit is not visible anyway)
    - the round kerb and wrought-iron railing ..................................... built
    - the stone stubs at the railing's foot ......................................... built (6)
    - the marble label plaque on the kerb ............................................ not built: text,
      and 0.4 m across at 25 m
  Style grammar  (a bronze votive column): coil bulges, tapering, patina -- built as geometry and colour.
  Unverified     pit depth (from the photo's proportions, not a survey); column diameter ~0.5 m [photo].
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sultanahmet_kit import Kit, TAU  # noqa: E402

ID = 'serpent-column'
K = Kit(ID, ['stone', 'iron'], extra=None)
K.M.material('bronze', (0.17, 0.25, 0.20), 0.55, 0.5, ID + '_bronze')          # green-black patina [photo]
K.M.material('pit', (0.23, 0.21, 0.19), 0.0, 0.95, ID + '_pit')               # shadowed rubble floor

R_FENCE = 3.62            # way 1154702449, 7.2-7.3 m across
KERB_IN, KERB_OUT, KERB_H = 3.30, 3.95, 0.38
TIP = 2.95                # 5.35 m column, 2.4 m of it below the square [see card]
PIT = 2.4

# kerb: a ring of dressed blocks with a chamfered top edge
K.lathe((0, 0), [(KERB_IN, 0.0), (KERB_OUT, 0.0), (KERB_OUT, KERB_H - 0.06), (KERB_OUT - 0.06, KERB_H),
                 (KERB_IN + 0.04, KERB_H), (KERB_IN, KERB_H - 0.04)], 72, 'stone', smooth=False)
# the view down into the pit
K.revolve((0, 0), [(KERB_IN + 0.01, 0.0), (KERB_IN + 0.01, 0.05), (0.0, 0.05)], 72, 'pit', smooth=False)
# stubs at the railing's foot
for k in range(6):
    a = TAU * (k + 0.25) / 6
    K.revolve((R_FENCE * math.cos(a), R_FENCE * math.sin(a)),
              [(0.19, KERB_H), (0.19, KERB_H + 0.30), (0.15, KERB_H + 0.36), (0.0, KERB_H + 0.36)], 10, 'stone', smooth=False)
# railing
circle = [(R_FENCE * math.cos(TAU * k / 64), R_FENCE * math.sin(TAU * k / 64)) for k in range(64)]
K.railing(circle, KERB_H, 1.15, closed=True, spacing=0.16, scroll_every=0.9)

# the three serpents: helices round a common axis, a full turn every 0.55 m (29 coils over 5.35 m seen
# from one side is three serpents x ~9.7 turns), from the pit floor to the broken necks
PITCH = 5.35 / (29 / 3)
for s in range(3):
    pts, radii = [], []
    n = 150
    for i in range(n + 1):
        h = (PIT + TIP) * i / n                 # height above the pit floor
        y = h - PIT
        if y < 0.12:
            continue
        t = h / (PIT + TIP)
        rc = 0.13 - 0.03 * t                    # the coil radius tapers upward
        if t > 0.94:                            # broken necks close in to the break
            rc *= max(0.25, 1 - (t - 0.94) / 0.06 * 0.75)
        a = TAU * h / PITCH + TAU * s / 3
        pts.append((rc * math.cos(a), y, rc * math.sin(a)))
        radii.append(0.14 - 0.035 * t)          # the bodies thin toward the top [photo]
    K.vtube(pts, radii, 'bronze', 10)

K.finish()
