"""Build the World Tour local buses and vans with Blender 5.x.

From the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \
      assets-src/vehicles/build_local_buses.py -- --render-dir tmp/local-buses
--ids takes a comma-separated subset. Every dimension, wheel and lamp position comes from the
catalogue entry; the builders only place details as fractions of the catalogue body.

Two constructions, both taken from build_large_cars.py:
- box buses (the double-decker and the mountain coach) stack a solid lower body under hollow
  glazed shells, like the school bus without its bonnet;
- vans (the scenic shuttle, the Cairo microbus and the dolmus) put a hollow glazed cabin on a
  lofted lower body, like the retro van, with a raised roof loft on top.
"""

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (ROOT, CATALOGUE, modelling_spec, arch_cut, arch_lip, body_loft, box,
                    prepare_glazing, consolidate, crown_roof, curve_stations, export, line, loft,
                    material, round_section, render_views, window, xyz)
from build_compact_cars import base, cabin, headlight, inset_face
from build_large_cars import steel_hubs, side_window


# ---------------------------------------------------------------- shared helpers

def lamps(spec, kind):
    """Catalogue lamp centres and sizes, converted to authoring units."""
    scale = spec["detailScale"]
    return [([v/scale for v in light["position"]], [v/scale for v in light["size"]])
            for light in spec["lights"][kind]]


def surface_z(obj, x, y, front=True):
    """Game-space z where a ray along the body axis first meets ``obj`` at (x, y)."""
    reach = 100
    origin = Vector(xyz((x, y, -reach if front else reach)))
    direction = Vector(xyz((0, 0, 1 if front else -1)))
    hit, point, _, _ = obj.ray_cast(origin, direction)
    if not hit:
        raise ValueError(f"{obj.name}: no surface at {(x, y)}")
    return -point.y


def surface_x(obj, sign, y, z):
    """Half-width of ``obj`` at game (y, z), measured from outside on the ``sign`` side."""
    hit, point, _, _ = obj.ray_cast(Vector((sign*100, -z, y)), Vector((-sign, 0, 0)))
    if not hit:
        raise ValueError(f"{obj.name}: no side surface at {(y, z)}")
    return abs(point.x)


def check_lamp(spec, kind, catalogue_z, surface):
    # The catalogue owns the lamp position the runtime lights use; the model must agree with it.
    if abs(catalogue_z-surface)*spec["detailScale"] > .06:
        raise ValueError(f"{spec['id']}: {kind} z {catalogue_z*spec['detailScale']:.3f} "
                         f"is not on the body surface {surface*spec['detailScale']:.3f}")


def front_lamps(spec, body, m, shell=None, face_z=None, indicator=True):
    for (x, y, z), (sx, sy) in lamps(spec, "headlights"):
        if shell is not None:
            face_z = min(surface_z(shell, x+dx*sx/2, y+dy*sy/2)
                         for dx in (-1, 1) for dy in (-1, 1))
        check_lamp(spec, "headlight", z, face_z)
        fz = face_z-.004
        headlight(body, m, [(x-sx/2, y-sy/2, fz), (x+sx/2, y-sy/2, fz),
                            (x+sx/2, y+sy/2, fz), (x-sx/2, y+sy/2, fz)])
        if indicator:
            sign = 1 if x > 0 else -1
            box("Front amber indicator", (x+sign*sx*.72, y, fz-.002),
                (sx*.30, sy*.9, .008), m["amber"], body, .003)


def rear_lamps(spec, body, m, shell=None, face_z=None):
    for (x, y, z), (sx, sy) in lamps(spec, "brakeLights"):
        if shell is not None:
            face_z = max(surface_z(shell, x+dx*sx/2, y+dy*sy/2, front=False)
                         for dx in (-1, 1) for dy in (-1, 1))
        check_lamp(spec, "brake light", z, face_z)
        box("Rear lamp red", (x, y, face_z+.006), (sx, sy, .012), m["red"], body, .004)
        box("Rear lamp amber", (x, y-sy*.72, face_z+.006), (sx, sy*.36, .012),
            m["amber"], body, .003)


def mirror_arm(body, m, side_x, y_top, y_mirror, z_face, reach, w, h, l, bus=True):
    """Forward-hanging bus mirror (bus=True) or a door-mounted van mirror."""
    for sign in (-1, 1):
        if bus:
            line("Bus mirror arm", [(sign*side_x, y_top, z_face+l*.02),
                 (sign*(side_x+reach), y_top+h*.01, z_face-l*.025),
                 (sign*(side_x+reach), y_mirror+h*.05, z_face-l*.03)], .008, m["trim"], body)
        else:
            line("Van mirror stalk", [(sign*side_x, y_mirror-h*.03, z_face),
                 (sign*(side_x+reach), y_mirror, z_face)], .006, m["darkmetal"], body)
        mz = z_face-(l*.03 if bus else 0)
        box("Bus mirror housing" if bus else "Van mirror housing",
            (sign*(side_x+reach), y_mirror, mz),
            (w*.06, h*(.085 if bus else .075), l*.012), m["trim"], body, .008)
        box("Bus mirror glass", (sign*(side_x+reach), y_mirror, mz+l*.0068),
            (w*.045, h*(.065 if bus else .055), .003), m["glass"], body, .003)


def deck_seats(body, spec, floor, top, front, rear, rows, half=.36):
    """A second deck's seats, matching the shared cabin furnishings."""
    w, h, l = spec["size"]
    g = spec["anchorY"]-spec["suspensionRest"]
    upholstery = bpy.data.materials["Woven graphite upholstery"]
    seat_depth = min(w*.23, l*(rear-front)/(rows+1)*.64)
    height = h*(top-floor)
    for row in range(rows):
        z = l*(front+(rear-front)*(row+.65)/(rows+.35))
        for sign in (-1, 1):
            x = sign*w*half*.60
            box("Upper deck seat cushion", (x, g+h*floor+height*.16, z-seat_depth*.28),
                (w*half*.76, height*.19, seat_depth), upholstery, body, .018, 3)
            box("Upper deck seat backrest", (x, g+h*floor+height*.49, z+seat_depth*.20),
                (w*half*.76, height*.70, seat_depth*.23), upholstery, body, .02, 3)


def raised_roof(name, stations, w, g, h, base_y, top_y, mat, body):
    """A pressed or moulded raised roof: near-vertical flanks rolling into a flat crown.

    ``stations`` are (z, width fraction, share of the base..top height)."""
    cross = [(-.49, 0), (.49, 0), (.49, .45), (.475, .72), (.42, .90), (.23, 1.0),
             (-.23, 1.0), (-.42, .90), (-.475, .72), (-.49, .45)]
    sections = []
    for z, fraction, rise in curve_stations(stations):
        sections.append(round_section([(x*w*fraction, g+h*(base_y+(top_y-base_y)*y*rise), z)
                                       for x, y in cross], .25, 3))
    return loft(name, sections, mat, body)


def replace_side_glazing(body):
    for obj in list(body.children):
        if obj.name.startswith("Side glazing"):
            bpy.data.objects.remove(obj, do_unlink=True)


def side_panes(body, m, corners, spans, v0=.07, v1=.93, name="Side pane"):
    for u0, u1 in spans:
        window(name, inset_face(corners, u0=u0, u1=u1, v0=v0, v1=v1), m["glass"], m["trim"], body, .92)


def wipers(body, m, face, name, v=.08):
    for sign in (-1, 1):
        pts = inset_face(face, uv=[(.5+sign*.04, v), (.5+sign*.40, v), (.5+sign*.40, v+.015),
                                   (.5+sign*.04, v+.015)], lift=.008)
        line(name, [pts[0], pts[1]], .004, m["trim"], body)


# ---------------------------------------------------------------- Beijing double-decker

def beijing_bus(spec):
    """Red double-decker sightseeing bus: closed lower deck, big-windowed upper deck."""
    root, body, m, g, cy = base(spec, (.56, .018, .016))
    w, h, l = spec["size"]
    steel_hubs(root, spec, m)
    cream = material("Cream deck band enamel", (.82, .76, .58), .08, .36)
    zf, zr = -l*.488, l*.490
    bw, length, zc = w*.98, zr-zf, (zf+zr)/2
    skirt = box("Low floor lower skirt", (0, g+h*.20, zc), (bw, h*.26, length), m["paint"], body, .02)
    arch_cut(skirt, spec, .025)
    lower = box("Lower deck saloon", (0, g+h*.435, zc), (bw, h*.22, length), m["paint"], body, .02)
    lower["glazing_shell"] = True
    box("Cream band between decks", (0, g+h*.5675, zc), (bw+.004, h*.065, length-.004),
        cream, body, .01)
    upper = box("Upper deck saloon", (0, g+h*.7725, zc), (bw, h*.365, length), m["paint"], body, .025)
    upper["glazing_shell"] = True
    crown_roof("Red rounded double deck roof", [(zf-.001, .95, .55), (zf+l*.018, 1, 1),
               (zr-l*.018, 1, 1), (zr+.001, .95, .55)], bw, g+h*.95, h*.045, m["paint"], body)
    front_door, middle_door = (-.475, -.405), (-.035, .055)
    lower_right = [(-.39, -.29), (-.275, -.175), (-.16, -.05), (.07, .17), (.185, .285),
                   (.30, .40), (.415, .475)]
    lower_left = [front_door, *lower_right[:3], middle_door, *lower_right[3:]]
    upper_bays = [(-.475, -.345), (-.33, -.20), (-.185, -.055), (-.04, .09), (.105, .235),
                  (.25, .38), (.395, .475)]
    for sign in (-1, 1):
        x = sign*(bw/2+.003)
        for start, end in (lower_right if sign > 0 else lower_left):
            side_window(body, m, x, g+h*.365, g+h*.515, l*start, l*end, "Lower deck window")
        for start, end in upper_bays:
            side_window(body, m, x, g+h*.625, g+h*.925, l*start, l*end, "Upper deck window")
        rub = box("Black lower rub strip", (sign*(bw/2+.002), g+h*.12, zc), (.012, h*.018, length-.03),
                  m["trim"], body, .003)
        arch_cut(rub, spec, .03)
        for axle in spec["axles"]:
            arch_lip("Bus wheel arch trim", sign*(bw/2-.012), cy, axle,
                     spec["wheelRadius"]+.028, .02, .03, m["trim"], body)
    # Right-hand traffic: both folding doors on the kerb (+X) side, glazed above a dark lower leaf.
    x = bw/2+.004
    for start, end in (front_door, middle_door):
        z0, z1 = l*start, l*end
        line("Folding door seam", [(x, g+h*.075, z0), (x, g+h*.525, z0), (x, g+h*.525, z1),
             (x, g+h*.075, z1), (x, g+h*.075, z0)], .0025, m["trim"], body)
        line("Folding door centre", [(x, g+h*.075, (z0+z1)/2), (x, g+h*.525, (z0+z1)/2)],
             .003, m["trim"], body)
        box("Door lower dark glass leaf", (bw/2+.002, g+h*.21, (z0+z1)/2),
            (.004, h*.24, z1-z0-.01), m["trim"], body, .002)
        for a, b in ((z0, (z0+z1)/2), ((z0+z1)/2, z1)):
            side_window(body, m, x, g+h*.365, g+h*.515, a+.008, b-.008, "Door glass")
    # Front: lower windscreen over a dark fascia, destination box, upper panoramic window.
    front = zf-.002
    window("Lower deck windscreen", [(-bw*.46, g+h*.345, front), (bw*.46, g+h*.345, front),
           (bw*.46, g+h*.515, front), (-bw*.46, g+h*.515, front)], m["glass"], m["trim"], body, .96)
    box("Black windscreen fascia", (0, g+h*.265, zf-.004), (bw*.90, h*.13, .006), m["trim"], body, .004)
    box("Destination display housing", (0, g+h*.5675, zf-.006), (bw*.78, h*.045, .01),
        m["trim"], body, .004)
    box("Amber destination display glow", (0, g+h*.5675, zf-.012), (bw*.62, h*.014, .004),
        material("Amber display glow", (.95, .45, .03), 0, .4, 1.2), body)
    window("Upper deck panoramic window", [(-bw*.465, g+h*.625, front), (bw*.465, g+h*.625, front),
           (bw*.465, g+h*.925, front), (-bw*.465, g+h*.925, front)], m["glass"], m["trim"], body, .97)
    for sign in (-1, 1):
        line("Front bus wiper", [(sign*bw*.05, g+h*.36, zf-.008), (sign*bw*.34, g+h*.40, zf-.009)],
             .004, m["trim"], body)
    front_lamps(spec, body, m, face_z=zf)
    box("Front black bumper", (0, g+h*.10, zf-.012), (bw, h*.07, l*.022), m["trim"], body, .012)
    mirror_arm(body, m, bw/2, g+h*.60, g+h*.47, zf, w*.07, w, h, l)
    # Rear: engine louvres, upper rear window, tall lamps.
    window("Upper deck rear window", [(-bw*.40, g+h*.66, zr+.002), (bw*.40, g+h*.66, zr+.002),
           (bw*.40, g+h*.90, zr+.002), (-bw*.40, g+h*.90, zr+.002)], m["glass"], m["trim"], body, .95)
    for i in range(6):
        box("Rear engine louvre", (0, g+h*(.15+i*.03), zr+.004), (bw*.62, h*.012, .006),
            m["trim"], body, .003)
    rear_lamps(spec, body, m, face_z=zr)
    box("Rear black bumper", (0, g+h*.10, zr+.012), (bw, h*.07, l*.022), m["trim"], body, .012)
    return root, body


def finish_beijing(body, spec):
    deck_seats(body, spec, .60, .84, -.43, .44, 7)


# ---------------------------------------------------------------- Zhangjiajie shuttle

def zhangjiajie_shuttle(spec):
    """White coach-class minibus with a leaf-green belt: rounded nose, one-piece windscreen."""
    root, body, m, g, cy = base(spec, (.86, .88, .86))
    w, h, l = spec["size"]
    steel_hubs(root, spec, m)
    green = material("Factory body paint leaf green livery", (.09, .40, .05), .2, .32)
    shell = body_loft("Rounded shuttle lower body", [
        (-l*.496, .82, g+h*.40, g+h*.42), (-l*.475, .95, g+h*.47, g+h*.48),
        (-l*.43, .99, g+h*.49, g+h*.50), (l*.45, .99, g+h*.49, g+h*.50),
        (l*.494, .93, g+h*.48, g+h*.49)], g+h*.10, w, m["paint"], body)
    arch_cut(shell, spec, .02)
    cabin(body, m, -l*.472, -l*.405, l*.476, l*.488, g+h*.49, g+h*.925, w*.485, w*.455, .014)
    replace_side_glazing(body)
    raised_roof("Shuttle roof cap", [(-l*.405, .93, .55), (-l*.38, .97, 1), (l*.44, .97, 1),
                (l*.476, .93, .55)], w, g, h, .905, .995, m["paint"], body)
    for sign in (-1, 1):
        corners = [(sign*w*.485, g+h*.49, -l*.472), (sign*w*.485, g+h*.49, l*.488),
                   (sign*w*.455, g+h*.925, l*.476), (sign*w*.455, g+h*.925, -l*.405)]
        side_panes(body, m, corners, [(.03, .15), (.18, .32), (.345, .485), (.51, .65),
                                      (.675, .815), (.84, .965)], name="Shuttle side window")
        half = surface_x(shell, sign, g+h*.30, 0)
        for y0, y1 in ((.13, .30), (.44, .47)):
            band = box("Green livery band", (sign*(half+.003), g+h*(y0+y1)/2, l*.005),
                       (.006, h*(y1-y0), l*.87), green, body, .002)
            arch_cut(band, spec, .026)
        for axle in spec["axles"]:
            arch_lip("Shuttle wheel arch trim", sign*(half-.004), cy, axle,
                     spec["wheelRadius"]+.022, .016, .024, m["trim"], body)
    x = w*.497
    z0, z1 = -l*.455, -l*.345
    line("Shuttle door seam", [(x, g+h*.13, z0), (x, g+h*.49, z0), (x, g+h*.49, z1),
         (x, g+h*.13, z1), (x, g+h*.13, z0)], .0025, m["trim"], body)
    box("Shuttle door handle", (x+.004, g+h*.36, z1-l*.012), (.01, h*.05, .012), m["darkmetal"], body, .003)
    front_lamps(spec, body, m, shell=shell)
    nose = surface_z(shell, 0, g+h*.28)
    box("Shuttle grille", (0, g+h*.28, nose-.004), (w*.42, h*.07, .008), m["trim"], body, .004)
    box("Green front bumper band", (0, g+h*.16, nose-.006), (w*.96, h*.07, l*.022), green, body, .01)
    wipers(body, m, [(-w*.485, g+h*.49, -l*.472), (w*.485, g+h*.49, -l*.472),
                     (w*.455, g+h*.925, -l*.405), (-w*.455, g+h*.925, -l*.405)], "Shuttle wiper")
    mirror_arm(body, m, w*.485, g+h*.80, g+h*.64, -l*.44, w*.08, w, h, l)
    tail = surface_z(shell, 0, g+h*.30, front=False)
    rear_lamps(spec, body, m, shell=shell)
    box("Shuttle rear bumper", (0, g+h*.15, tail+.008), (w*.97, h*.07, l*.024), m["trim"], body, .01)
    box("Green rear panel", (0, g+h*.33, tail+.003), (w*.70, h*.09, .006), green, body, .004)
    return root, body


# ---------------------------------------------------------------- Cairo microbus

def giza_microbus(spec):
    """White high-roof cab-over microbus with a blue waist stripe and a sliding door."""
    root, body, m, g, cy = base(spec, (.88, .89, .88))
    w, h, l = spec["size"]
    steel_hubs(root, spec, m)
    blue = material("Factory body paint blue stripe", (.02, .11, .46), .2, .32)
    shell = body_loft("Flat nosed microbus lower body", [
        (-l*.497, .90, g+h*.50, g+h*.51), (-l*.487, .97, g+h*.52, g+h*.53),
        (-l*.45, .99, g+h*.53, g+h*.54), (l*.46, .99, g+h*.53, g+h*.54),
        (l*.495, .95, g+h*.52, g+h*.53)], g+h*.12, w, m["paint"], body)
    arch_cut(shell, spec, .018)
    cabin(body, m, -l*.490, -l*.445, l*.484, l*.492, g+h*.535, g+h*.80, w*.488, w*.470, .012)
    replace_side_glazing(body)
    raised_roof("Moulded high roof", [(-l*.44, .93, .35), (-l*.40, .98, 1), (l*.45, .98, 1),
                (l*.483, .95, .8)], w, g, h, .785, .995, m["paint"], body)
    for sign in (-1, 1):
        corners = [(sign*w*.488, g+h*.535, -l*.490), (sign*w*.488, g+h*.535, l*.492),
                   (sign*w*.470, g+h*.80, l*.484), (sign*w*.470, g+h*.80, -l*.445)]
        side_panes(body, m, corners, [(.02, .17), (.20, .40), (.42, .62), (.64, .82), (.84, .975)],
                   v0=.10, v1=.92, name="Microbus side window")
        half = surface_x(shell, sign, g+h*.43, 0)
        band = box("Blue waist stripe", (sign*(half+.003), g+h*.43, 0), (.006, h*.07, l*.90),
                   blue, body, .002)
        arch_cut(band, spec, .024)
        rub = box("Black side rub strip", (sign*(half+.003), g+h*.24, 0), (.008, h*.025, l*.90),
                  m["trim"], body, .003)
        arch_cut(rub, spec, .024)
        line("Cab door seam", [(sign*(half+.002), g+h*.53, -l*.30), (sign*(half+.002), g+h*.14, -l*.30)],
             .0022, m["trim"], body)
        box("Cab door handle", (sign*(half+.004), g+h*.47, -l*.33), (.012, .016, l*.04), m["darkmetal"], body, .003)
        for axle in spec["axles"]:
            arch_lip("Microbus wheel arch", sign*(half-.004), cy, axle,
                     spec["wheelRadius"]+.02, .014, .022, m["paint"], body)
    x = surface_x(shell, 1, g+h*.40, 0)+.002
    line("Sliding door seam", [(x, g+h*.14, -l*.10), (x, g+h*.53, -l*.10), (x, g+h*.53, l*.16),
         (x, g+h*.14, l*.16), (x, g+h*.14, -l*.10)], .0025, m["trim"], body)
    line("Sliding door rail", [(x, g+h*.50, l*.16), (x, g+h*.50, l*.40)], .004, m["darkmetal"], body)
    box("Sliding door handle", (x+.002, g+h*.47, -l*.08), (.012, .02, l*.04), m["darkmetal"], body, .003)
    nose = surface_z(shell, 0, g+h*.35)
    box("Blue nose stripe", (0, g+h*.43, surface_z(shell, 0, g+h*.43)-.002), (w*.80, h*.07, .006),
        blue, body, .003)
    box("Microbus black grille", (0, g+h*.34, nose-.004), (w*.46, h*.06, .006), m["trim"], body, .004)
    for i in range(3):
        box("Grille slat", (0, g+h*(.325+i*.016), nose-.008), (w*.44, .006, .005), m["alloy"], body)
    front_lamps(spec, body, m, shell=shell)
    wipers(body, m, [(-w*.488, g+h*.535, -l*.490), (w*.488, g+h*.535, -l*.490),
                     (w*.470, g+h*.80, -l*.445), (-w*.470, g+h*.80, -l*.445)], "Microbus wiper")
    box("Microbus front bumper", (0, g+h*.17, nose-.01), (w*.99, h*.08, l*.04), m["alloy"], body, .012)
    mirror_arm(body, m, w*.49, None, g+h*.64, -l*.44, w*.07, w, h, l, bus=False)
    tail = surface_z(shell, 0, g+h*.30, front=False)
    line("Rear hatch seam", [(-w*.42, g+h*.16, tail+.003), (-w*.42, g+h*.52, tail+.003),
         (w*.42, g+h*.52, tail+.003), (w*.42, g+h*.16, tail+.003), (-w*.42, g+h*.16, tail+.003)],
         .0022, m["trim"], body)
    rear_lamps(spec, body, m, shell=shell)
    box("Microbus rear bumper", (0, g+h*.17, tail+.01), (w*.99, h*.08, l*.04), m["alloy"], body, .012)
    return root, body


# ---------------------------------------------------------------- Istanbul dolmus

def istanbul_dolmus(spec):
    """Yellow high-roof minibus: short bonnet, raked screen, route card, sliding door."""
    root, body, m, g, cy = base(spec, (1.0, .68, .0))
    w, h, l = spec["size"]
    steel_hubs(root, spec, m)
    shell = body_loft("Short bonnet minibus lower body", [
        (-l*.497, .80, g+h*.38, g+h*.40), (-l*.47, .93, g+h*.44, g+h*.46),
        (-l*.40, .98, g+h*.50, g+h*.51), (-l*.36, .99, g+h*.52, g+h*.53),
        (l*.46, .99, g+h*.52, g+h*.53), (l*.495, .95, g+h*.51, g+h*.52)], g+h*.11, w, m["paint"], body)
    arch_cut(shell, spec, .018)
    cabin(body, m, -l*.372, -l*.275, l*.485, l*.493, g+h*.52, g+h*.845, w*.488, w*.468, .012)
    replace_side_glazing(body)
    raised_roof("Raised minibus roof", [(-l*.275, .92, .3), (-l*.235, .98, 1), (l*.45, .98, 1),
                (l*.484, .95, .8)], w, g, h, .83, .995, m["paint"], body)
    for sign in (-1, 1):
        corners = [(sign*w*.488, g+h*.52, -l*.372), (sign*w*.488, g+h*.52, l*.493),
                   (sign*w*.468, g+h*.845, l*.485), (sign*w*.468, g+h*.845, -l*.275)]
        side_panes(body, m, corners, [(.02, .17), (.20, .40), (.42, .60), (.62, .80), (.82, .975)],
                   v0=.10, v1=.92, name="Dolmus side window")
        half = surface_x(shell, sign, g+h*.30, 0)
        rub = box("Black side rub strip", (sign*(half+.004), g+h*.30, l*.04), (.009, h*.035, l*.82),
                  m["trim"], body, .003)
        arch_cut(rub, spec, .024)
        line("Cab door seam", [(sign*(half+.002), g+h*.52, -l*.20), (sign*(half+.002), g+h*.13, -l*.20)],
             .0022, m["trim"], body)
        box("Cab door handle", (sign*(half+.004), g+h*.46, -l*.23), (.012, .016, l*.035), m["darkmetal"], body, .003)
        for axle in spec["axles"]:
            arch_lip("Dolmus black wheel arch", sign*(half-.004), cy, axle,
                     spec["wheelRadius"]+.022, .02, .03, m["trim"], body)
    x = surface_x(shell, 1, g+h*.40, 0)+.002
    line("Sliding door seam", [(x, g+h*.13, -l*.17), (x, g+h*.52, -l*.17), (x, g+h*.52, l*.08),
         (x, g+h*.13, l*.08), (x, g+h*.13, -l*.17)], .0025, m["trim"], body)
    line("Sliding door rail", [(x, g+h*.50, l*.08), (x, g+h*.50, l*.40)], .004, m["darkmetal"], body)
    box("Sliding door handle", (x+.002, g+h*.46, -l*.15), (.012, .02, l*.035), m["darkmetal"], body, .003)
    nose = surface_z(shell, 0, g+h*.31)
    box("Dolmus black grille", (0, g+h*.31, nose-.004), (w*.50, h*.10, .008), m["trim"], body, .005)
    for i in range(3):
        box("Grille slat", (0, g+h*(.285+i*.025), nose-.009), (w*.48, .007, .005), m["darkmetal"], body)
    front_lamps(spec, body, m, shell=shell, indicator=False)
    box("Dolmus front bumper", (0, g+h*.16, nose-.01), (w*.99, h*.10, l*.035), m["trim"], body, .014)
    screen = [(-w*.488, g+h*.52, -l*.372), (w*.488, g+h*.52, -l*.372),
              (w*.468, g+h*.845, -l*.275), (-w*.468, g+h*.845, -l*.275)]
    wipers(body, m, screen, "Dolmus wiper", .07)
    # A blank route card stands inside the windscreen on the kerb side, like the real ones (no text).
    card = inset_face(screen, uv=[(.60, .12), (.90, .12), (.90, .34), (.60, .34)], lift=-.03)
    box("Route card", tuple(sum(p[i] for p in card)/4 for i in range(3)),
        (w*.27, h*.07, .006), material("Route card white board", (.90, .90, .86), 0, .6), body, .002)
    mirror_arm(body, m, w*.49, None, g+h*.62, -l*.36, w*.08, w, h, l, bus=False)
    tail = surface_z(shell, 0, g+h*.30, front=False)
    line("Rear barn door seam", [(0, g+h*.14, tail+.003), (0, g+h*.51, tail+.003)], .0025, m["trim"], body)
    line("Rear barn door outline", [(-w*.43, g+h*.14, tail+.003), (-w*.43, g+h*.51, tail+.003),
         (w*.43, g+h*.51, tail+.003), (w*.43, g+h*.14, tail+.003), (-w*.43, g+h*.14, tail+.003)],
         .0022, m["trim"], body)
    rear_lamps(spec, body, m, shell=shell)
    box("Dolmus rear bumper", (0, g+h*.16, tail+.01), (w*.99, h*.10, l*.035), m["trim"], body, .014)
    return root, body


BUILDERS = {"beijing-sightseeing-bus": beijing_bus,
            "zhangjiajie-shuttle": zhangjiajie_shuttle, "giza-microbus": giza_microbus,
            "istanbul-dolmus": istanbul_dolmus}
FINISH = {"beijing-sightseeing-bus": finish_beijing}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", default=",".join(BUILDERS))
    parser.add_argument("--render-dir", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    specs = {spec["id"]: spec for spec in CATALOGUE["vehicles"]}
    for vehicle_id in args.ids.split(","):
        spec = specs[vehicle_id]
        authored = modelling_spec(spec)
        root, body = BUILDERS[vehicle_id](authored)
        prepare_glazing(body, authored)
        if vehicle_id in FINISH:
            FINISH[vehicle_id](body, authored)
        consolidate(body, "Body geometry")
        export(root, ROOT/f"game/public/models/cars/{vehicle_id}.glb", authored["detailScale"])
        if args.render_dir:
            render_views(root, spec, ROOT/args.render_dir, distance_factor=.56)


if __name__ == "__main__":
    main()
