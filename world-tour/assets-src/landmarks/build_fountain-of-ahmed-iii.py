"""Fountain of Sultan Ahmed III (III. Ahmed Cesmesi, 1728), before Topkapi's Imperial Gate -- route `istanbul`.

Fact card
  OSM object     way 32396432 (amenity=fountain, building=yes), a 16.4 x 16.8 m square = the outline of the
                 great eaves.
  Height         ~12.2 m to the top of the central finial [photo estimate: Ahmed_III_Fountain_DSCF0349,
                 frontal; the body is 0.61 of the eaves' span (660 / 1075 px), so ~10.2 m: plinth 0.5 m,
                 body 5.1 m to the tile frieze, eaves 1.9 m, roof and drums 2.0 m, domes 1.1 m, finial 1.6 m].
                 No published height found.  Registered with --level-ground: the square is level in the photos,
                 the elevation data reads 3 m of fall across the 16 m outline.
  Plan           a square kiosk "on a rectangle with softened corners" [tr.wikipedia]: four faces, each with a
                 central fountain niche and two small side niches; a sebil at every corner (a rounded bay
                 with three grilled windows); a band of muqarnas and a tile frieze under very wide, curving,
                 painted wooden eaves; a low lead roof with five small domes -- four at the corners, one in
                 the middle -- "only for show" [tr.wikipedia]; gilded finials.
  Seen from      the race line never comes closer than ~170 m (from the west, past Hagia Sophia's east end, and
                 again from Kennedy Caddesi below): a far-tier landmark, 4 deg tall.  Its eaves and five domes
                 are what reads at that range; the surface ornament is colour, not geometry.
  Parts a local would name
    - the wide, sweeping painted eaves (the fountain's signature) ................. built: a thick curved
      sheet swept round the rounded plan, concave soffit, lead top
    - five small domes on octagonal drums, gilded finials ............................ built
    - four corner sebils with grilled windows ........................................... built (3 per corner)
    - central fountain niche per face, pointed arch in red and white voussoirs, and the two
      smaller side niches ................................................................. built as framed recesses
      proud of the wall (from 170 m a recess and a frame read the same)
    - calligraphy panels of the 14-stanza poem .......................................... built as blank
      green-and-gold panels (no text)
    - muqarnas band and tile frieze under the eaves ......................................... built as bands
    - the stepped plinth ....................................................................... built
    - the iron railing round it .............................................................. not built:
      sub-pixel at 170 m
  Style grammar  (Tulip-period Ottoman rococo): eaves, frieze, niches, sebil grilles -- listed above.
  Unverified     every height (photo ratios); the corner-bay radius; the eave's exact curve.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sultanahmet_kit import Kit, SF, CF, TAU, rect, arch  # noqa: E402

ID = 'fountain-of-ahmed-iii'
K = Kit(ID, ['marble', 'carved', 'lead', 'gold', 'iron', 'stone_red'])
K.M.material('panel', (0.05, 0.16, 0.12), 0.1, 0.4, ID + '_panel')              # green calligraphy grounds
K.M.material('gilt', (0.62, 0.48, 0.20), 0.8, 0.35, ID + '_gilt')               # gilt frames and panels
K.M.material('tile', (0.05, 0.25, 0.28), 0.0, 0.35, ID + '_tile')               # blue-green tile frieze
K.M.material('soffit', (0.38, 0.30, 0.18), 0.1, 0.55, ID + '_soffit')           # painted, gilded eave soffit
K.M.material('niche', (0.55, 0.54, 0.50), 0.0, 0.6, ID + '_marble_shadow')      # the recess backs

H = 5.15              # half side of the body
RC = 1.9              # corner bay radius
Y0, Y1 = 0.50, 5.60   # body from the plinth to the underside of the eaves
EAVE = 2.95           # how far the eaves reach out from the wall


def rounded(h, r, n=6):
    """A rounded square [(u, v)], counter-clockwise, corners of radius r."""
    pts = []
    for su, sv, a0 in ((1, 1, 0.0), (-1, 1, 0.5 * math.pi), (-1, -1, math.pi), (1, -1, 1.5 * math.pi)):
        cu, cv = su * (h - r), sv * (h - r)
        pts += [(cu + r * math.cos(a0 + 0.5 * math.pi * i / n), cv + r * math.sin(a0 + 0.5 * math.pi * i / n)) for i in range(n + 1)]
    return pts


# ------------------------------------------------------------------ plinth and body
K.extrude(rounded(H + 1.0, RC + 1.0, 8), 0.0, 0.25, 'marble')
K.extrude(rounded(H + 0.55, RC + 0.55, 8), 0.25, Y0, 'marble')
K.extrude(rounded(H, RC, 8), Y0, Y1, 'marble')
K.loop_sweep(rounded(H, RC, 8), [(-0.05, Y0), (0.12, Y0), (0.12, Y0 + 0.35), (-0.05, Y0 + 0.35)], 'carved')
K.loop_sweep(rounded(H, RC, 8), [(-0.05, 4.62), (0.10, 4.62), (0.10, 5.08), (-0.05, 5.08)], 'tile')
K.loop_sweep(rounded(H, RC, 8), [(-0.05, 5.08), (0.10, 5.08), (0.30, 5.60), (-0.05, 5.60)], 'carved')

# ------------------------------------------------------------------ the four faces
FACES = [SF((0, -H), (-1, 0), (0, -1)), SF((H, 0), (0, -1), (1, 0)), SF((0, H), (1, 0), (0, 1)), SF((-H, 0), (0, 1), (-1, 0))]
for fr in FACES:
    # central fountain niche: pointed arch with red and white voussoirs round a recessed back and a basin
    o = dict(c=0.0, w=1.45, sill=0.9, ys=2.75, kind='pointed')
    pts, crown = arch(0.0, 1.45, 2.75, 'pointed', 8)
    K.prism(fr, [(-0.95, Y0), (0.95, Y0), (0.95, crown + 0.55), (-0.95, crown + 0.55)], 0.0, 0.10, 'carved')
    K.prism(fr, [(-0.725, 0.9), (0.725, 0.9)] + list(reversed(pts)), 0.10, 0.11, 'niche')
    K.voussoirs(fr, o, 0.10, band=0.28, k=10, proud=0.05, mats=('marble', 'stone_red'))
    K.revolve(fr.p(0.0, 0.0, 0.10)[::2], [(0.30, Y0 + 0.05), (0.52, 0.72), (0.55, 0.95), (0.50, 1.0)], 10, 'marble',
              a0=math.atan2(fr.n[1], fr.n[0]) - math.pi / 2, a1=math.atan2(fr.n[1], fr.n[0]) + math.pi / 2, smooth=False)
    # side niches (mihrab-shaped, narrow)
    for x in (-1.85, 1.85):
        pts2, crown2 = arch(x, 0.72, 2.45, 'pointed', 6)
        K.prism(fr, [(x - 0.5, 0.9), (x + 0.5, 0.9), (x + 0.5, crown2 + 0.3), (x - 0.5, crown2 + 0.3)], 0.0, 0.07, 'carved')
        K.prism(fr, [(x - 0.36, 1.05), (x + 0.36, 1.05)] + list(reversed(pts2)), 0.07, 0.08, 'niche')
    # the poem panels: a long one over the niche, square ones over the side niches (blank grounds)
    K.prism(fr, rect(-1.35, 1.35, 3.30, 4.35), 0.0, 0.06, 'gilt')
    K.prism(fr, rect(-1.22, 1.22, 3.40, 4.25), 0.06, 0.08, 'panel')
    for x in (-2.35, 2.35):
        K.prism(fr, rect(x - 0.62, x + 0.62, 3.30, 4.35), 0.0, 0.06, 'gilt')
        K.prism(fr, rect(x - 0.5, x + 0.5, 3.42, 4.23), 0.06, 0.08, 'panel')

# ------------------------------------------------------------------ the corner sebils
for su, sv, a0 in ((1, 1, 0.0), (-1, 1, 0.5 * math.pi), (-1, -1, math.pi), (1, -1, 1.5 * math.pi)):
    c = (su * (H - RC), sv * (H - RC))
    fr = CF(c, RC, a0)
    L = 0.5 * math.pi * RC
    for i in range(3):
        x = L * (i + 0.5) / 3
        w = 0.72
        K.prism(fr, rect(x - w / 2, x + w / 2, 1.05, 3.35), 0.0, 0.05, 'iron')          # grille over dark glass
        for b in range(1, 5):
            bx = x - w / 2 + w * b / 5
            K.prism(fr, rect(bx - 0.025, bx + 0.025, 1.05, 3.35), 0.05, 0.09, 'gilt')
        for by in (1.6, 2.2, 2.8):
            K.prism(fr, rect(x - w / 2, x + w / 2, by - 0.025, by + 0.025), 0.05, 0.09, 'gilt')
    for i in range(4):                                                                  # colonnettes
        x = L * i / 3
        K.prism(fr, rect(x - 0.09, x + 0.09, Y0, 4.55), 0.0, 0.14, 'carved')
    K.prism(fr, rect(0.0, L, 3.45, 4.35), 0.0, 0.06, 'gilt')

# ------------------------------------------------------------------ the eaves, the roof, the domes
path = rounded(H, RC, 8)
soffit = [(-0.05, 5.52), (0.6, 5.60), (1.3, 5.78), (2.0, 6.05), (2.6, 6.38), (EAVE, 6.62)]
K.loop_sweep(path, soffit + [(EAVE + 0.08, 6.62), (EAVE + 0.08, 6.92), (EAVE - 0.05, 6.98)] +
             [(-0.05, 6.98)], 'soffit')
K.loop_sweep(path, [(-0.05, 6.98), (EAVE - 0.05, 6.98), (EAVE + 0.10, 6.95), (EAVE + 0.10, 7.08), (2.0, 7.25),
                    (0.0, 7.55), (-0.05, 7.55)], 'lead')
# the low roof over the body and the central drum's seat
K.frustum(rounded(H - 0.02, RC, 8), 7.50, rounded(2.2, 0.8, 8), 8.15, 'lead')
K.extrude(rounded(2.2, 0.8, 8), 8.10, 8.18, 'lead')


def domed_drum(c, apothem, y0, y1, r, rise, finial):
    K.poly_drum(c, apothem, 8, y0, y1, 0.3, mat='lead', glaze=False)
    K.revolve(c, [(apothem / math.cos(math.pi / 8) + 0.02, y1), (apothem / math.cos(math.pi / 8) + 0.14, y1 + 0.06),
                  (apothem / math.cos(math.pi / 8) + 0.14, y1 + 0.16), (0.0, y1 + 0.16)], 8, 'lead', smooth=False,
              phase=math.pi / 8)
    for i in range(8):                                                    # little arched lights in the drum
        a = TAU * i / 8
        fr = SF((c[0] + apothem * math.cos(a), c[1] + apothem * math.sin(a)), (-math.sin(a), math.cos(a)), (math.cos(a), math.sin(a)))
        pts, _ = arch(0.0, apothem * 0.5, y0 + (y1 - y0) * 0.55, 'pointed', 4)
        K.prism(fr, [(-apothem * 0.25, y0 + (y1 - y0) * 0.2), (apothem * 0.25, y0 + (y1 - y0) * 0.2)] + list(reversed(pts)),
                0.0, 0.02, 'iron')
    K.dome(c, r, y1 + 0.16, rise, 'lead', sides=24, rings=8, ribs=12, rib_r=0.03)
    K.alem(c, y1 + 0.16 + rise - 0.05, finial, crescent=False)


domed_drum((0.0, 0.0), 1.20, 8.15, 9.40, 1.30, 0.95, 0.85)
for su in (-1, 1):
    for sv in (-1, 1):
        domed_drum((su * (H - RC), sv * (H - RC)), 0.92, 7.35, 8.60, 1.02, 0.75, 0.66)

K.finish()
