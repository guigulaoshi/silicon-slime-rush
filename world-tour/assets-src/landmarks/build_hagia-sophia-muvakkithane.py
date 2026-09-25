"""Timekeeper's house (Muvakkithane) of Hagia Sophia -- route `istanbul`.

Fact card
  OSM way      109738926, tagged `name=Sibyan Mektebi height=12` (footprint owned by
               pipeline/landmarks.json). The name is on the wrong building: Wikidata Q132530378 puts the
               school on way 109738924, and this square building across the exit path from it is the one
               the Commons category "Muvakkithane of Hagia Sophia" shows on the square in front of the
               church: three big grilled arched windows towards the square, a red drum and a small dome.
  what         the mosque timekeeper's room, built 1853 by the Fossati brothers for Abdulmecid
               (hagiasophiaturkey.com "Muvakkithane"; Wikipedia "Hagia Sophia")
  footprint    10.2 m square; the window front faces south-west onto Ayasofya square and the race line
  height       OSM height=12; built: walls 5.6 m, cornice 6.2, red octagonal drum to 8.7, dome crown ~10.7,
               alem ~11.9 (Commons "Muvakkithane building - prayer timing room", "Istanbul - panoramio (77)")
  seen from    the race line passes ~35-40 m away: the player sees the window front square-on, then its
               south-east side
  parts a local would name
    grey ashlar front with three tall round-arched windows behind iron grilles   built, real recesses
    heavy projecting cornice and a low hipped lead roof with wide eaves           built
    red-rendered octagonal drum with one small arched window per face             built
    small lead dome with a gilded alem                                            built
    red-rendered rear wall and lean-to porch on columns, facing the courtyard     built simply: red
      rear wall with a door and a lead lean-to on three posts
  style grammar (19th-century Ottoman): ashlar, arched windows with grilles, strong cornice, drum and
    dome -- built.
  unverified   the side walls (built with one arched window each, as the oblique photos suggest).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hs_precinct_kit import Kit, Fr, regular, offset_poly, ccw  # noqa: E402

K = Kit('hagia-sophia-muvakkithane', ['stone', 'plaster', 'lead', 'grille', 'gold', 'wood'])

HU, HV = 5.08, 5.15
RECT = [(-HU, -HV), (HU, -HV), (HU, HV), (-HU, HV)]
H, D = 5.6, 0.5

K.prism(offset_poly(ccw(RECT), 0.15), 0.0, 0.5, 'stone')


def openings(i, fr, L):
    if fr.n[1] > 0.9:                                  # the front, onto the square
        return [(L / 2 + k * 3.2, 1.75, 1.0, 3.6, 'round') for k in (-1, 0, 1)]
    if fr.n[1] < -0.9:                                 # the rear, onto the courtyard: a door
        return [(L / 2, 1.2, 0.5, 2.6, 'rect', 'wood'), (L / 2 + 3.0, 1.0, 1.4, 3.2, 'rect')]
    return [(L / 2, 1.5, 1.2, 3.4, 'round')]


frames = K.polygon_body(RECT, 0.5, H, D, openings, 'stone',
                        mat_for=lambda i, fr, L: 'plaster' if fr.n[1] < -0.9 else 'stone')   # red-rendered rear
for fr, L in frames:
    if fr.n[1] > 0.9:
        for k in (-1, 0, 1):                           # moulded arch surrounds of the front windows
            K.arch_ring(fr, L / 2 + k * 3.2, 0.875, 1.15, 3.6, -0.05, 0.1, 'stone', seg=10, legs=2.6)
top = K.corbel_cornice(RECT, H, [(0.25, 0.12), (0.2, 0.3), (0.15, 0.55)], 'stone')
RIN = [(-2.6, -2.6), (2.6, -2.6), (2.6, 2.6), (-2.6, 2.6)]
K.prism(offset_poly(ccw(RECT), 0.75), top, top + 0.12, 'lead')
K.frustum(offset_poly(ccw(RECT), 0.75), top + 0.12, RIN, top + 0.95, 'lead')
DRUM = regular(0.0, 0.0, 8, 2.35, 0.0)
K.polygon_body(DRUM, top + 0.3, top + 2.4, 0.25,
               lambda i, fr, L: [(L / 2, 0.45, top + 1.1, top + 1.7, 'round')], 'plaster')
t2 = K.corbel_cornice(DRUM, top + 2.4, [(0.12, 0.08), (0.12, 0.18)], 'stone')
crown = K.ribbed_dome(0.0, 0.0, t2, 2.45, 1.9, ribs=16, rings=9, rib=0.05)
K.revolve(0.0, 0.0, [(0.35, crown - 0.15), (0.22, crown + 0.08)], 10, 'lead')
K.finial(0.0, 0.0, crown + 0.05, 0.26)

# ------------------------------------------------------------------ red rear wall and lean-to porch (courtyard)
K.ubox(-HU, HU, 0.0, 0.3, -HV - 2.4, -HV, 'stone')
V = [(-HU, 3.3, -HV - 2.6), (HU, 3.3, -HV - 2.6), (HU, 4.1, -HV), (-HU, 4.1, -HV),
     (-HU, 3.5, -HV - 2.6), (HU, 3.5, -HV - 2.6), (HU, 4.3, -HV), (-HU, 4.3, -HV)]
K.hexa(V, 'lead')
for u in (-HU + 0.3, 0.0, HU - 0.3):
    K.M.tube('post', [(u, 0.3, -HV - 2.35), (u, 3.35, -HV - 2.35)], 0.09, 'stone', sides=8)

K.finish()
