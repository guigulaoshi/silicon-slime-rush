"""German Fountain (Alman Cesmesi, Kaiser-Wilhelm-Brunnen), north end of the Hippodrome -- route `istanbul`.

Fact card
  OSM object     way 109874498 (amenity=fountain, building=yes), an octagon-ish ring 9.2 m across = the
                 stepped platform.
  Height         ~11.65 m to the top of the finial [photo estimate: German_Fountain_(Istanbul).jpg, frontal,
                 scaled to the 7.2 m base: base 2.4 m, columns 2.85 m, arcade and cornice 2.3 m, dome band and
                 dome 3.1 m, finial 1.0 m].  No published height found.
  Registered     with --level-ground (a flat square; harmless here, the data reads it level already).
  Plan           neo-Byzantine octagonal pavilion built in Germany 1898-1900: an octagonal marble base on low
                 steps with seven bronze spouts over basins and a stair to the gate on the eighth side; eight
                 porphyry columns with bronze capitals carry round arches edged in mosaic, a cornice and a
                 green bronze dome over a central domed reservoir [en/tr.wikipedia; photos].
  Orientation    the gate side faces south-west, toward the Hippodrome [photo Alman_Cesmesi_(The German
                 Fountain): gate centred with Hagia Sophia's minarets behind].
  Seen from      the race line passes 10.3 m from the platform (16.3 m from the centre), coming up the
                 Hippodrome from the south-west: the gate side and the dome are what the driver sees first.
  Parts a local would name
    - the green bronze dome, ribbed at its eight angles, with a pinecone finial ..... built
    - eight dark porphyry columns with bronze capitals and bases ................... built
    - round arches with mosaic borders; medallions over the arches (tughra / "W II") .. built: mosaic bands
      and medallion discs in green and Prussian blue, no letters
    - the golden mosaic ceiling inside the dome ...................................... built (gold inner cupola)
    - the domed marble reservoir in the middle ......................................... built
    - the octagonal marble base with a carved frieze, seven basins under bronze spouts .. built
    - the stair and iron gate on the south-west side .................................... built
    - the low stepped platform ................................................................ built
    - the lost bronze fence ........................................................................ not built: gone
  Style grammar  (neo-Byzantine): round arches, arch borders, cornice with a dentil course, ribbed dome.
  Unverified     all heights are photo ratios; the arch springing height; the stair's run.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sultanahmet_kit import Kit, SF, TAU, rect  # noqa: E402

ID = 'german-fountain'
K = Kit(ID, ['marble', 'carved', 'iron', 'gold'])
K.M.material('porphyry', (0.035, 0.028, 0.028), 0.0, 0.25, ID + '_porphyry')     # polished dark shafts [photo]
K.M.material('bronze', (0.16, 0.36, 0.29), 0.6, 0.45, ID + '_bronze')           # green-patinated bronze [photo]
K.M.material('copper', (0.13, 0.40, 0.30), 0.7, 0.35, ID + '_copper')           # the dome's green skin
K.M.material('mosaic', (0.50, 0.40, 0.20), 0.3, 0.45, ID + '_mosaic')           # gold-and-blue arch borders
K.M.material('mosaic_gold', (0.72, 0.52, 0.18), 0.8, 0.35, ID + '_mosaic_gold') # the ceiling
K.M.material('bronze_dark', (0.07, 0.15, 0.12), 0.35, 0.6, ID + '_bronze_dark')     # the relief band under the dome
K.M.material('enamel_green', (0.05, 0.28, 0.10), 0.1, 0.3, ID + '_enamel_green')
K.M.material('enamel_blue', (0.03, 0.08, 0.30), 0.1, 0.3, ID + '_enamel_blue')

C = (0.0, 0.0)
F0 = math.radians(46.0)            # outward normal of the gate face: south-west in this model frame
OCT = [F0 + TAU * k / 8 for k in range(8)]


def octagon(apothem, rot=0.0):
    """Vertices of an octagon whose faces have outward normals at OCT."""
    R = apothem / math.cos(math.pi / 8)
    return [(R * math.cos(a + math.pi / 8 + rot), R * math.sin(a + math.pi / 8 + rot)) for a in OCT]


def face(apothem, k):
    a = OCT[k]
    n = (math.cos(a), math.sin(a))
    return SF((apothem * n[0], apothem * n[1]), (-n[1], n[0]), n)


# ------------------------------------------------------------------ platform, base
K.extrude(octagon(4.50), 0.0, 0.12, 'marble')
K.extrude(octagon(4.22), 0.12, 0.24, 'marble')
BASE_A, BASE_TOP = 3.60, 2.40
SLOT_W = 1.3                          # the stair slot in the gate face
# the base as eight sector wedges so the gate sector can be cut for the stair
ring = octagon(BASE_A)
for k in range(8):
    p0, p1 = ring[k - 1], ring[k]
    if k != 0:
        K.extrude([(0.0, 0.0), p0, p1], 0.24, BASE_TOP, 'marble')
        continue
    fr = face(BASE_A, 0)
    half = BASE_A * math.tan(math.pi / 8)
    depth = 2.4                                         # the slot runs this far into the base
    # the sector in face coordinates: x along the face, d outward (0 at the face)
    xa = SLOT_W / 2
    d_meet = -BASE_A + xa / math.tan(math.pi / 8)       # where the sector's sides reach the slot's width
    for s in (-1, 1):
        pts = [(s * half, 0.0), (s * xa, 0.0), (s * xa, d_meet)]
        K.extrude([fr.p(x, 0, d)[::2] for x, d in pts], 0.24, BASE_TOP, 'marble')
    inner = -depth
    tip_half = (BASE_A - depth) * math.tan(math.pi / 8)
    K.extrude([fr.p(x, 0, d)[::2] for x, d in [(-tip_half, inner), (tip_half, inner), (0.0, -BASE_A)]], 0.24, BASE_TOP, 'marble')
    steps = 8
    for i in range(steps):
        d1 = -depth * i / steps + 0.35
        d0 = -depth * (i + 1) / steps
        K.extrude([fr.p(x, 0, d)[::2] for x, d in [(-xa, d0), (xa, d0), (xa, d1), (-xa, d1)]], 0.24,
                  0.24 + (BASE_TOP - 0.24) * (i + 1) / steps, 'marble')
# plinth band, carved frieze, top slab
K.loop_sweep(octagon(BASE_A), [(-0.05, 0.24), (0.08, 0.24), (0.08, 0.52), (0.02, 0.58), (-0.05, 0.58)], 'marble')
for k in range(1, 8):
    fr = face(BASE_A, k)
    half = BASE_A * math.tan(math.pi / 8)
    K.prism(fr, rect(-half, half, 1.78, 2.12), 0.0, 0.035, 'carved')
    # basin under a bronze spout plaque
    c = fr.p(0.0, 0.0, 0.0)[::2]
    a = OCT[k]
    K.revolve(c, [(0.30, 0.24), (0.45, 0.30), (0.55, 0.50), (0.60, 0.74), (0.54, 0.80)], 12, 'marble',
              a0=a - math.pi / 2, a1=a + math.pi / 2, smooth=False)
    K.prism(fr, [(0.0, 1.10), (0.30, 1.42), (0.0, 1.74), (-0.30, 1.42)], 0.0, 0.05, 'bronze')
    K.revolve(fr.p(0.0, 0.0, 0.08)[::2], [(0.03, 1.2), (0.03, 1.28), (0.0, 1.29)], 6, 'bronze')
# the moulded top slab, run face by face so the stair slot stays open to the sky
LIP = [(-0.3, BASE_TOP - 0.05), (0.02, BASE_TOP - 0.05), (0.16, BASE_TOP + 0.05), (0.16, BASE_TOP + 0.12),
       (-0.3, BASE_TOP + 0.12)]
hb = BASE_A * math.tan(math.pi / 8)
for k in range(8):
    fr = face(BASE_A, k)
    spans = [(-hb - 0.066, hb + 0.066)] if k else [(-hb - 0.066, -SLOT_W / 2), (SLOT_W / 2, hb + 0.066)]
    for x0, x1 in spans:
        K.run(fr, [x0, x1], LIP, 'marble')

# ------------------------------------------------------------------ reservoir, gate
K.revolve(C, [(1.45, BASE_TOP), (1.50, BASE_TOP + 0.35), (1.42, BASE_TOP + 0.55), (1.15, BASE_TOP + 0.95),
              (0.70, BASE_TOP + 1.20), (0.32, BASE_TOP + 1.30), (0.0, BASE_TOP + 1.31)], 32, 'marble')
K.revolve(C, [(0.22, BASE_TOP + 1.25), (0.20, BASE_TOP + 1.9), (0.42, BASE_TOP + 2.05), (0.44, BASE_TOP + 2.2),
              (0.0, BASE_TOP + 2.2)], 16, 'bronze')

# ------------------------------------------------------------------ columns
COL_R = 3.18                                # column axis radius, at the octagon's corners
COL_BASE, SHAFT0, SHAFT1, CAP_TOP = BASE_TOP + 0.12, BASE_TOP + 0.40, 5.05, 5.50
corners = [(COL_R * math.cos(a + math.pi / 8), COL_R * math.sin(a + math.pi / 8)) for a in OCT]
for c in corners:
    K.revolve(c, [(0.30, COL_BASE), (0.30, COL_BASE + 0.1), (0.26, COL_BASE + 0.16), (0.25, SHAFT0 - 0.05),
                  (0.21, SHAFT0)], 16, 'bronze', smooth=False)
    K.cylinder(c, 0.21, SHAFT0, SHAFT1, 16, 'porphyry')
    K.revolve(c, [(0.23, SHAFT1), (0.26, SHAFT1 + 0.1), (0.33, CAP_TOP - 0.12), (0.37, CAP_TOP - 0.1),
                  (0.37, CAP_TOP), (0.0, CAP_TOP)], 8, 'bronze', smooth=False, phase=math.pi / 8)
# gate between the two south-west columns
g0, g1 = corners[-1], corners[0]
gate = [(g0[0] + (g1[0] - g0[0]) * t, g0[1] + (g1[1] - g0[1]) * t) for t in (0.12, 0.88)]
K.railing(gate, BASE_TOP, 1.1, closed=False, spacing=0.12, scroll_every=0.5)

# ------------------------------------------------------------------ arcade, cornice
ARC_A = COL_R * math.cos(math.pi / 8)       # apothem of the arcade walls
WALL_TOP = 7.15
half = COL_R * math.sin(math.pi / 8)
for k in range(8):
    fr = face(ARC_A, k)
    o = dict(c=0.0, w=2 * half - 0.62, sill=CAP_TOP, ys=CAP_TOP, kind='round')
    K.arched_wall(fr, -half - 0.12, half + 0.12, CAP_TOP, WALL_TOP, -0.26, 0.26, [o], 'marble', n=8)
    K.voussoirs(fr, o, 0.26, band=0.20, k=14, proud=0.03, mats=('mosaic', 'mosaic'))
    K.voussoirs(fr, o, -0.26 - 0.03, band=0.20, k=14, proud=0.03, mats=('mosaic', 'mosaic'))
    # medallion over the crown: a gilt ring round an enamel disc (tughra / "W II" -- no letters here)
    c = fr.p(0.0, 0.0, 0.26)
    ax, az = math.cos(OCT[k]), math.sin(OCT[k])
    K.prism(SF(c[::2], (-az, ax), (ax, az)), [(0.26 * math.cos(TAU * i / 16), 6.80 + 0.26 * math.sin(TAU * i / 16)) for i in range(16)],
            0.0, 0.04, 'gold')
    K.prism(SF(c[::2], (-az, ax), (ax, az)), [(0.2 * math.cos(TAU * i / 16), 6.80 + 0.2 * math.sin(TAU * i / 16)) for i in range(16)],
            0.04, 0.07, 'enamel_green' if k % 2 == 0 else 'enamel_blue')
# cornice with a dentil course
K.loop_sweep(octagon(ARC_A + 0.26), [(-0.02, 7.05), (0.10, 7.05), (0.10, 7.15), (0.40, 7.40), (0.46, 7.40),
                                     (0.46, 7.55), (-0.02, 7.55)], 'marble')
for k in range(8):
    fr = face(ARC_A + 0.26, k)
    hw = (ARC_A + 0.26) * math.tan(math.pi / 8)
    n = 14
    for i in range(n):
        x = -hw + 2 * hw * (i + 0.5) / n
        K.prism(fr, rect(x - 0.05, x + 0.05, 6.93, 7.05), -0.02, 0.07, 'carved')
# the ceiling: a golden cupola seen from below, and the drum band outside
K.lathe(C, [(2.60, 7.10), (2.95, 7.10), (2.95, 7.60), (2.2, 8.55), (1.2, 9.05), (0.08, 9.2), (0.08, 9.0),
            (1.1, 8.85), (2.0, 8.40), (2.60, 7.60)], 32, 'mosaic_gold')
K.frustum(octagon(ARC_A + 0.18), 7.55, octagon(ARC_A + 0.12), 8.15, 'bronze_dark')
for y0 in (7.58, 8.02):                           # thin gilt fillets framing the relief band
    K.loop_sweep(octagon(ARC_A + 0.12), [(-0.02, y0), (0.06, y0), (0.06, y0 + 0.06), (-0.02, y0 + 0.06)], 'gold')

# ------------------------------------------------------------------ the dome
DOME0, RISE = 8.15, 2.5
RD = (ARC_A + 0.12) / math.cos(math.pi / 8)       # circumradius at the springing
rings = 10
prof = [(RD * math.cos(0.5 * math.pi * i / rings) ** 0.8, DOME0 + RISE * math.sin(0.5 * math.pi * i / rings)) for i in range(rings)]
K.revolve(C, prof + [(0.0, DOME0 + RISE)], 8, 'copper', smooth=False, phase=OCT[0] + math.pi / 8)
K.frustum(octagon(ARC_A + 0.16), DOME0 - 0.02, octagon(ARC_A + 0.14), DOME0 + 0.45, 'bronze_dark')
for a in OCT:                                      # ribs on the eight angles
    pts = [((r + 0.03) * math.cos(a + math.pi / 8), y + 0.02, (r + 0.03) * math.sin(a + math.pi / 8)) for r, y in prof[:-1]]
    K.M.tube('rib', pts, 0.06, 'copper', 5)
for i in (3, 6):                                   # two horizontal seams of the panel grid
    r, y = prof[i]
    K.loop_sweep([(r * math.cos(a + math.pi / 8), r * math.sin(a + math.pi / 8)) for a in OCT],
                 [(-0.02, y - 0.03), (0.035, y - 0.03), (0.035, y + 0.03), (-0.02, y + 0.03)], 'copper')
# pinecone finial
top = DOME0 + RISE
K.revolve(C, [(0.22, top - 0.1), (0.14, top + 0.12), (0.10, top + 0.30), (0.16, top + 0.38), (0.19, top + 0.55),
              (0.16, top + 0.75), (0.08, top + 0.92), (0.0, top + 1.0)], 12, 'bronze')

K.finish()
