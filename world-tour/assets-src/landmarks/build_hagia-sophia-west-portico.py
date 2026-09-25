"""Colonnaded courtyard building west of the sadirvan, Hagia Sophia precinct -- route `istanbul`.

Fact card  (the least certain of the precinct buildings -- read "unverified")
  OSM way      312748431, `building=yes`, no name or other tags (footprint owned by pipeline/landmarks.json)
  what         a low single-storey building on the west side of the Hagia Sophia courtyard. Every photo of
               the courtyard taken towards the west or south-west front of the church shows, behind the
               sadirvan, a long white building with a lead hipped roof carried on a row of slender white
               columns, and a row of ablution taps along the foot of its back wall (Commons "Courtyard
               and Sadirvan of Hagia Sophia", "20180114 HagiaSophia 7499/7500", "Exterior of Hagia Sophia
               (1) - Istanbul (2022)"). This outline is the only long building there, so it is built as
               that colonnade; its name and date were not found.
  footprint    20.4 x 8.9 m rectangle along the courtyard's west edge
  height       no OSM height; photo estimate: columns and walls 4.0 m, eaves 4.3, hip ridge ~6.0
  seen from    the race line passes ~50-60 m to the south-west, behind the school; the player sees its
               lead roof and the south end over the railings, not the colonnade
  parts
    long hipped lead roof with wide eaves                      built
    row of slender white columns on the courtyard side         built (8 columns)
    white rendered back room with grilled windows              built
    ablution taps and basins along the wall                    not built: too small to read from the road
  unverified   identity, date, which long side carries the columns (built on the courtyard side, the
               side the photos show).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hs_precinct_kit import Kit, Fr, offset_poly, ccw  # noqa: E402

K = Kit('hagia-sophia-west-portico', ['stone', 'marble', 'lead', 'grille', 'wood'])

HU, HV = 4.45, 10.2
U_COL = 1.4                         # back room from -HU to U_COL, colonnade from U_COL to +HU
H = 4.0
ROOM = [(-HU, -HV), (U_COL, -HV), (U_COL, HV), (-HU, HV)]

K.ubox(-HU - 0.1, HU + 0.1, 0.0, 0.3, -HV - 0.1, HV + 0.1, 'stone')


def room_openings(i, fr, L):
    if L < 15:                                          # the short ends: one window
        return [(L / 2, 1.0, 1.1, 2.6, 'rect')]
    ops = [(L * (k + 0.5) / 5, 1.0, 1.1, 2.6, 'rect') for k in range(5)]
    if fr.n[0] > 0.9:                                   # behind the colonnade: a door in the middle bay
        ops[2] = (L / 2, 1.2, 0.3, 2.6, 'rect', 'wood')
    return ops


K.polygon_body(ROOM, 0.3, H, 0.35, room_openings, 'marble')
top = K.corbel_cornice(ROOM, H, [(0.15, 0.06), (0.15, 0.15)], 'marble')
for k in range(8):                                    # the colonnade
    v = -HV + 0.4 + k * (2 * HV - 0.8) / 7
    K.revolve(HU - 0.4, v, [(0.24, 0.3), (0.24, 0.5), (0.14, 0.6), (0.13, H - 0.3), (0.18, H - 0.2)], 10, 'marble')
    K.ubox(HU - 0.62, HU - 0.18, H - 0.2, H, v - 0.22, v + 0.22, 'marble')
K.ubox(HU - 0.65, HU - 0.15, H, H + 0.3, -HV + 0.1, HV - 0.1, 'marble')          # architrave
K.ubox(U_COL, HU - 0.4, H + 0.05, H + 0.3, -HV + 0.3, HV - 0.3, 'marble')        # colonnade ceiling
# hipped lead roof over the whole outline, wide eaves
EAVE = offset_poly(ccw([(-HU, -HV), (HU, -HV), (HU, HV), (-HU, HV)]), 0.6)
ridge = [(-0.05, -HV + 4.4), (0.05, -HV + 4.4), (0.05, HV - 4.4), (-0.05, HV - 4.4)]
K.prism(EAVE, H + 0.3, H + 0.42, 'lead')
K.frustum(EAVE, H + 0.42, ridge, H + 0.42 + 1.7, 'lead')

K.finish()
