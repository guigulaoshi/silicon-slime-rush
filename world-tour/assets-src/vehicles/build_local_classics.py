"""Build the classic local cars: the tin snail (Paris),
the boxy nineties saloon (Shanghai) and the stretch limousine (New York). Blender 5.x, no downloads.

From the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \
      assets-src/vehicles/build_local_classics.py -- --render-dir tmp/local-classics
--ids accepts a comma-separated subset. --lamps <file> writes each car's lamp centres in game
metres, ready to paste into its catalogue entry's `lights`.

Every glasshouse is a lofted solid whose side walls all lie in one plane per side (constant belt
line and tumblehome), so side windows of any outline -- the tin snail's door glass, the bubble
car's D-shaped quarter light, the limousine's row of passenger windows -- are real planar
openings cut by prepare_glazing, never paint. No brand shapes: no badges, emblems or lettering.
"""

import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (ROOT, CATALOGUE, modelling_spec, arch_cut, arch_cover, bevel, body_loft, box,
                    consolidate, curve_stations, empty, export, glazing, line, loft, material, panel,
                    prepare_glazing, radial, render_views, round_section, wheel, window)
from build_compact_cars import materials, on_deck


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if bpy.context.scene.world is None:
        bpy.context.scene.world = bpy.data.worlds.new("World")


def set_paint(mat, color, metallic, roughness):
    mat.diffuse_color = (*color, 1)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness


def start(spec, paint, metallic=0.0, roughness=.34):
    reset()
    root = empty("vehicle-root")
    body = empty("body", root)
    m = materials(paint)
    set_paint(m["paint"], paint, metallic, roughness)
    m["chrome"] = material("Polished chrome", (.80, .82, .85), 1.0, .11)
    m["mirror"] = material("Mirror reflective glass", (.16, .20, .23), .85, .10)
    g = spec["anchorY"]-spec["suspensionRest"]
    return root, body, m, g, g+spec["wheelRadius"]


def classic_wheel(pivot, spec, m, rim, cap, cap_radius, rim_radius=.66):
    """Tall tyre on a dished steel wheel with a domed hubcap, all inside the tyre's width."""
    r, half = spec["wheelRadius"], spec["wheelWidth"]/2
    radial("Tyre", [(-half*.90, r*.65), (-half, r*.83), (-half*.72, r*.96), (-half*.45, r),
                    (half*.45, r), (half*.72, r*.96), (half, r*.83), (half*.90, r*.65)],
           m["rubber"], pivot, 48)
    radial("Pressed steel wheel", [(-half*.84, 0), (-half*.84, r*rim_radius), (-half*.70, r*(rim_radius+.03)),
                                   (half*.70, r*(rim_radius+.03)), (half*.84, r*rim_radius), (half*.84, 0)],
           rim, pivot, 40)
    rc = r*cap_radius
    for sign in (-1, 1):
        # The flat crown is the wheel's outermost axial face and points outward.
        radial("Domed hubcap", [(sign*half*.80, 0), (sign*half*.80, rc), (sign*half*.88, rc*.96),
                                (sign*half*.95, rc*.78), (sign*half*.975, rc*.42), (sign*half*.975, 0)],
               cap, pivot, 40)
    consolidate(pivot, "Running wheel geometry")


def wheels(root, spec, build):
    cy = spec["anchorY"]-spec["suspensionRest"]+spec["wheelRadius"]
    for i, axle in enumerate(spec["axles"]):
        for j, sign in enumerate((-1, 1)):
            build(empty(f"wheel-{2*i+j}", root, (sign*spec["track"]/2, cy, axle)))


class House:
    """A glasshouse loft: stations (z, side-top y, roof y, roof half-width), authoring units.

    Belt height and tumblehome are constant, so every side face lies in the plane
    x = xb - tumble*(y - yb) and any outline drawn in that plane is a flat window.
    """

    def __init__(self, stations, xb, yb, tumble, shoulder=.5, smooth=()):
        self.key, self.xb, self.yb, self.t, self.shoulder = stations, xb, yb, tumble, shoulder
        # Faces listed in `smooth` (by key index) get two Catmull-Rom stations so the roof reads as
        # a curve in silhouette; faces that carry a windscreen or rear window stay single and flat.
        self.stations = [stations[0]]
        n = len(stations)
        for i in range(n-1):
            if i in smooth:
                p0, p1, p2, p3 = stations[max(i-1, 0)], stations[i], stations[i+1], stations[min(i+2, n-1)]
                for t in (1/3, 2/3):
                    self.stations.append(tuple(.5*(2*b+(c-a)*t+(2*a-5*b+4*c-d)*t*t+(3*b-a-3*c+d)*t**3)
                                               for a, b, c, d in zip(p0, p1, p2, p3)))
            self.stations.append(stations[i+1])

    def x(self, y):
        return self.xb-self.t*(y-self.yb)

    def section(self, z, ys, yt, cw):
        rw = self.x(ys)
        # Two shoulder points round the roof edge; the top face between them stays flat.
        s1 = (rw-(rw-cw)*.22, ys+(yt-ys)*self.shoulder)
        s2 = (rw-(rw-cw)*.62, ys+(yt-ys)*(.5+self.shoulder*.9))
        right = [(rw, ys, z), (s1[0], min(s1[1], yt), z), (s2[0], min(s2[1], yt), z), (cw, yt, z)]
        left = [(-x, y, zz) for x, y, zz in reversed(right)]
        return [(-self.xb, self.yb, z), (self.xb, self.yb, z)]+right+left

    def build(self, name, mat, parent, edge):
        obj = loft(name, [self.section(*s) for s in self.stations], mat, parent, smooth=False)
        bevel(obj, edge, 3)
        obj["glazing_shell"] = True
        return obj

    def top(self, z):
        st = self.stations
        for a, b in zip(st, st[1:]):
            if a[0] <= z <= b[0]:
                return a[1]+(b[1]-a[1])*(z-a[0])/(b[0]-a[0])
        raise ValueError(f"side window outside the glasshouse at {z}")

    def side_point(self, sign, z, y, lift=.003):
        n = Vector((1, self.t, 0)).normalized()
        return (sign*(self.x(y)+n.x*lift), y+n.y*lift, z)

    def side_window(self, sign, bottom, top_margin, zb0, zb1, zt0=None, zt1=None, rounding=.22):
        zt0 = zb0 if zt0 is None else zt0
        zt1 = zb1 if zt1 is None else zt1
        tops = [zt1]+[s[0] for s in reversed(self.stations) if zt0 < s[0] < zt1]+[zt0]
        outline = [(zb0, bottom), (zb1, bottom)]+[(z, self.top(z)-top_margin) for z in tops]
        points = [self.side_point(sign, z, y) for z, y in outline]
        if sign < 0:
            points.reverse()
        return round_section(points, rounding, 3)

    def top_face(self, i, u0=.06, u1=.94, v0=.08, v1=.92):
        (za, _, ya, ca), (zb, _, yb, cb) = self.key[i], self.key[i+1]
        a, b = Vector((-ca, ya, za)), Vector((ca, ya, za))
        c, d = Vector((cb, yb, zb)), Vector((-cb, yb, zb))
        normal = (b-a).cross(d-a).normalized()
        centre = (a+b+c+d)/4
        if normal.dot(Vector((centre.x, 0, centre.z))) < 0:
            normal.negate()

        def point(u, v):
            return tuple(((1-u)*a+u*b)*(1-v)+((1-u)*d+u*c)*v+normal*.003)
        return [point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1)]


def roof_cover(name, house, first, last, inset, lift, thick, mat, parent):
    """A thin slab on the flat top faces between two key stations (canvas, vinyl)."""
    z0, z1 = house.key[first][0], house.key[last][0]
    sections = []
    for z, _, yt, cw in [s for s in house.stations if z0 <= s[0] <= z1]:
        c = cw*inset
        sections.append([(-c, yt+lift, z), (c, yt+lift, z), (c, yt+lift+thick, z), (-c, yt+lift+thick, z)])
    return loft(name, [round_section(s, .2, 2) for s in sections], mat, parent)


def roof_strip(name, house, i, sign, inner, outer, lift, thick, mat, parent):
    """A strip of the same slab beside a window cut into one top face."""
    sections = []
    for z, _, yt, cw in house.key[i:i+2]:
        a, b = sign*cw*inner, sign*cw*outer
        sections.append([(a, yt+lift, z), (b, yt+lift, z), (b, yt+lift+thick, z), (a, yt+lift+thick, z)])
    return loft(name, sections, mat, parent)


def fender(name, stations, sign, g, h, w, l, mat, parent, rounding=.34):
    """(z, top, bottom, outer, inner) as fractions of length, height and width."""
    sections = []
    for z, top, bottom, outer, inner in curve_stations(stations, 3):
        pts = [(sign*w*inner, g+h*bottom, l*z), (sign*w*outer, g+h*bottom, l*z),
               (sign*w*outer, g+h*top, l*z), (sign*w*inner, g+h*top, l*z)]
        sections.append(round_section(pts, rounding, 3))
    return loft(name, sections, mat, parent)


def flank(shell, sign, points, lift=.002, reach=5):
    """Project (z, y) points onto the actual side of a shell, from outside."""
    result = []
    for z, y in points:
        hit, p, _, _ = shell.ray_cast(Vector((sign*reach, -z, y)), Vector((-sign, 0, 0)))
        if not hit:
            raise ValueError(f"flank detail misses the body at z={z}, y={y}")
        result.append((p.x+sign*lift, p.z, -p.y))
    return result


def seam(shell, sign, zy, g, mat, parent, radius=.0014):
    dense = []
    for a, b in zip(zy, zy[1:]):
        dense += [(a[0]+(b[0]-a[0])*i/6, g+a[1]+(b[1]-a[1])*i/6) for i in range(6)]
    line("Door shut line", flank(shell, sign, dense+[(zy[-1][0], g+zy[-1][1])]), radius, mat, parent)


def round_lamp(name, parent, centre, radius, facing, housing, lens, rim, depth=None):
    """A round lamp pod facing -z (facing=-1, headlamp) or +z (facing=1, tail lamp)."""
    pivot = empty(name+" pivot", parent, centre)
    d = depth or radius*1.1
    f = facing
    radial(name+" housing", [(-f*d, 0), (-f*d, radius*.55), (-f*d*.55, radius*.93), (0, radius),
                             (f*radius*.10, radius*1.02), (f*radius*.14, radius*.92), (f*radius*.14, 0)],
           housing, pivot, 36, "z")
    radial(name+" bezel", [(f*radius*.10, radius*1.04), (f*radius*.20, radius*1.0), (f*radius*.20, radius*.86),
                           (f*radius*.12, radius*.86)], rim, pivot, 36, "z")
    radial(name+" lens", [(f*radius*.13, 0), (f*radius*.13, radius*.88), (f*radius*.24, radius*.66),
                          (f*radius*.30, 0)], lens, pivot, 36, "z")
    return pivot


def record(lamps, kind, centre, size):
    lamps.setdefault(kind, []).append({"position": list(centre), "size": list(size)})


def tin_snail(spec, lamps):
    """Narrow, tall, arched two-box on tiny wheels: ribbed bonnet, lamps on stalks, canvas roof."""
    root, body, m, g, cy = start(spec, (.36, .47, .54), 0, .36)
    w, h, l = spec["size"]
    m["canvas"] = material("Woven canvas roof", (.028, .030, .033), 0, .92)
    steel = material("Pale grey painted steel wheel", (.42, .44, .45), .25, .42)
    wheels(root, spec, lambda p: classic_wheel(p, spec, m, steel, m["chrome"], .34))
    hull = body_loft("Narrow tin body and bonnet", [(l*z, f, g+h*s, g+h*d) for z, f, s, d in [
        (-.478, .60, .41, .46), (-.44, .68, .46, .505), (-.36, .76, .51, .55), (-.27, .82, .555, .585),
        (-.20, .88, .585, .60), (-.08, .88, .59, .60), (.20, .88, .59, .60), (.30, .875, .588, .60),
        (.36, .86, .575, .595), (.41, .81, .52, .545), (.45, .75, .445, .47), (.48, .68, .36, .38),
        (.494, .62, .30, .31)]],
        g+h*.17, w, m["paint"], body, rounding=.22)
    arch_cut(hull, spec, .02)
    for sign in (-1, 1):
        front = fender("Separate swept front wing", [
            (-.49, .30, .26, .44, .36), (-.465, .40, .245, .48, .35), (-.42, .445, .235, .50, .35),
            (-.34, .46, .23, .50, .35), (-.27, .445, .23, .50, .35), (-.225, .39, .22, .49, .36),
            (-.195, .28, .19, .465, .38)], sign, g, h, w, l, m["paint"], body)
        arch_cut(front, spec, .02)
        rear = fender("Flat rear wing", [
            (.13, .30, .21, .47, .40), (.17, .42, .19, .49, .39), (.24, .465, .18, .495, .39),
            (.33, .465, .18, .495, .39), (.40, .44, .20, .49, .39), (.45, .37, .24, .47, .40),
            (.478, .30, .27, .445, .41)], sign, g, h, w, l, m["paint"], body)
        arch_cut(rear, spec, .02)
        # The rear wing's skirt hides the top half of the tyre: the classic tin-snail rear.
        axle = spec["axles"][1]
        box("Rear wheel skirt", (sign*w*.487, g+h*.335, axle), (w*.018, h*.21, l*.215), m["paint"], body, .006, 3)
        box("Wing piping", (sign*w*.497, g+h*.44, axle), (w*.006, h*.012, l*.20), m["trim"], body, .002)
    house = House([(l*z, g+h*ys, g+h*yt, w*cw) for z, ys, yt, cw in [
        (-.215, .595, .60, .37), (-.155, .925, .945, .355), (-.12, .945, .975, .31), (-.05, .955, .995, .30),
        (.04, .95, 1.0, .30), (.12, .925, .985, .30), (.19, .86, .935, .295), (.25, .77, .855, .29),
        (.30, .675, .74, .28), (.35, .575, .59, .27)]], w*.398, g+h*.56, .10, smooth=(1, 2, 3, 4, 5, 7, 8))
    house.build("Arched cabin", m["paint"], body, .012)
    window("Upright windscreen", house.top_face(0, .05, .95, .07, .93), m["glass"], m["trim"], body, .95)
    window("Small rear window", house.top_face(6, .14, .86, .12, .86), m["glass"], m["trim"], body, .93)
    for sign in (-1, 1):
        window("Front door glass", house.side_window(sign, g+h*.625, h*.03, l*-.172, l*.012, l*-.14),
               m["glass"], m["trim"], body, .94)
        window("Rear door glass", house.side_window(sign, g+h*.625, h*.03, l*.034, l*.172),
               m["glass"], m["trim"], body, .94)
        window("Rear quarter glass", house.side_window(sign, g+h*.63, h*.035, l*.19, l*.25, zt1=l*.235),
               m["glass"], m["trim"], body, .92)
    # Canvas roll-back roof over the flat roof, stopping above and below the small rear window.
    roof_cover("Rolled canvas roof", house, 1, 6, .94, .002, .010, m["canvas"], body)
    roof_cover("Canvas roof tail", house, 7, 9, .94, .002, .008, m["canvas"], body)
    for sign in (-1, 1):
        roof_strip("Canvas beside rear window", house, 6, sign, .88, .94, .002, .008, m["canvas"], body)
    # Corrugated bonnet: raised ribs that follow the real bonnet surface.
    for x in (-.20, -.12, -.04, .04, .12, .20):
        pts = on_deck(hull, [(w*x*(1-.25*(1-t)), l*(-.452+.22*t)) for t in [i/10 for i in range(11)]], g+h*1.5, .002)
        line("Pressed bonnet rib", pts, .0055, m["paint"], body)
    # Grille: tall rounded opening with horizontal chrome slats, no emblem.
    front_z = -l*.478
    panel("Grille opening", [(x, y, front_z-.004) for x, y in round_section(
        [(-w*.17, g+h*.21), (w*.17, g+h*.21), (w*.15, g+h*.44), (-w*.15, g+h*.44)], .28, 3)],
        m["trim"], body, outward=(0, 0, -1))
    for i in range(6):
        y = g+h*(.235+i*.037)
        box("Grille slat", (0, y, front_z-.009), (w*(.30-.012*i), h*.009, .006), m["chrome"], body, .002)
    # Headlamps on stalks above the wings, either side of the bonnet.
    for sign in (-1, 1):
        x, y, z = sign*w*.335, g+h*.575, -l*.405
        round_lamp("Stalk headlamp", body, (x, y, z), h*.058, -1, m["paint"], m["white"], m["chrome"])
        line("Headlamp stalk", [(x, g+h*.44, z+h*.02), (x, y-h*.04, z+h*.01)], h*.012, m["trim"], body)
        record(lamps, "headlights", (x, y, z-h*.058*.30), (h*.058*1.76, h*.058*1.76))
        # Small round tail lamps on the rear wings.
        tx, ty, tz = sign*w*.42, g+h*.345, l*.474
        round_lamp("Wing tail lamp", body, (tx, ty, tz), h*.032, 1, m["trim"], m["red"], m["chrome"], h*.03)
        record(lamps, "brakeLights", (tx, ty, tz+h*.032*.30), (h*.032*1.76, h*.032*1.76))
        for z in (-.20, .025, .19):
            seam(hull, sign, [(l*z, h*.58), (l*z, h*.20)], g, m["trim"], body)
        for z in (-.02, .15):
            line("Door handle", flank(hull, sign, [(l*z, g+h*.52), (l*(z+.03), g+h*.52)], .006), .004, m["chrome"], body)
        for y in (.30, .48):
            box("Door hinge", (sign*w*.442, g+h*y, -l*.195), (.014, h*.03, l*.02), m["chrome"], body, .003)
        box("Painted sill", (sign*w*.43, g+h*.19, 0), (w*.03, h*.04, l*.36), m["paint"], body, .006)
    # Thin tube bumpers with small over-riders.
    for end in (-1, 1):
        zz = end*l*.497
        line("Tube bumper", [(-w*.44, g+h*.27, zz-end*l*.012), (-w*.40, g+h*.27, zz), (w*.40, g+h*.27, zz),
                             (w*.44, g+h*.27, zz-end*l*.012)], h*.013, m["chrome"], body)
        for sign in (-1, 1):
            line("Bumper over-rider", [(sign*w*.22, g+h*.235, zz+end*.004), (sign*w*.22, g+h*.33, zz+end*.004)],
                 h*.011, m["chrome"], body)
    box("Boot handle", (0, g+h*.47, l*.456), (w*.10, h*.018, .012), m["chrome"], body, .003)
    box("Plate recess", (0, g+h*.33, l*.488), (w*.22, h*.07, .006), m["trim"], body, .004)
    return root, body


def classic_sedan(spec, lamps):
    """Three-box nineties saloon: flat bonnet, upright glasshouse, square tail, black bumpers."""
    root, body, m, g, cy = start(spec, (.60, .52, .36), 0, .38)
    w, h, l = spec["size"]
    cover = material("Silver plastic wheel cover", (.52, .54, .56), .45, .35)
    wheels(root, spec, lambda p: classic_wheel(p, spec, m, m["darkmetal"], cover, .62, .64))
    hull = body_loft("Slab-sided three-box body", [(l*z, f, g+h*s, g+h*d) for z, f, s, d in [
        (-.50, .97, .525, .535), (-.49, 1.0, .535, .55), (-.40, 1.0, .545, .56), (-.20, 1.0, .56, .575),
        (.20, 1.0, .565, .58), (.29, 1.0, .575, .59), (.44, 1.0, .58, .595), (.49, 1.0, .575, .59),
        (.50, .97, .565, .575)]], g+h*.16, w, m["paint"], body, rounding=.12)
    arch_cut(hull, spec, .022)
    arch_cover(spec, .022, m["paint"], body)
    house = House([(l*z, g+h*ys, g+h*yt, w*cw) for z, ys, yt, cw in [
        (-.195, .575, .58, .43), (-.075, .93, .96, .36), (-.04, .945, .99, .34), (.06, .95, 1.0, .34),
        (.19, .93, .97, .34), (.30, .575, .585, .40)]], w*.445, g+h*.54, .22, shoulder=.4)
    house.build("Upright boxy glasshouse", m["paint"], body, .010)
    window("Windscreen", house.top_face(0, .04, .96, .06, .93), m["glass"], m["trim"], body, .96)
    window("Rear window", house.top_face(4, .05, .95, .08, .92), m["glass"], m["trim"], body, .95)
    for sign in (-1, 1):
        window("Front door glass", house.side_window(sign, g+h*.61, h*.03, l*-.165, l*-.008, l*-.10),
               m["glass"], m["trim"], body, .95)
        window("Rear door glass", house.side_window(sign, g+h*.61, h*.03, l*.01, l*.135), m["glass"], m["trim"], body, .95)
        window("Quarter glass", house.side_window(sign, g+h*.61, h*.035, l*.15, l*.24, zt1=l*.215, rounding=.18),
               m["glass"], m["trim"], body, .92)
        line("Belt chrome", [house.side_point(sign, l*z, g+h*.585, .004) for z in (-.19, 0, .25)], .0035, m["chrome"], body)
    front, tail = -l*.50, l*.50
    # Rectangular single lamps either side of a slatted grille; no emblem anywhere.
    for sign in (-1, 1):
        x = sign*w*.315
        window("Rectangular headlamp", [(x-w*.10, g+h*.415, front-.004), (x+w*.10, g+h*.415, front-.004),
               (x+w*.10, g+h*.505, front-.004), (x-w*.10, g+h*.505, front-.004)], m["white"], m["chrome"], body, .86)
        record(lamps, "headlights", (x, g+h*.46, front-.005), (w*.17, h*.075))
        box("Corner indicator", (sign*w*.455, g+h*.46, front+.012), (w*.055, h*.07, .02), m["amber"], body, .004)
        window("Tail lamp cluster", [(sign*w*.17, g+h*.44, tail+.004), (sign*w*.46, g+h*.44, tail+.004),
               (sign*w*.46, g+h*.54, tail+.004), (sign*w*.17, g+h*.54, tail+.004)], m["red"], m["trim"], body, .9)
        box("Tail amber band", (sign*w*.315, g+h*.455, tail+.007), (w*.26, h*.02, .004), m["amber"], body, .002)
        record(lamps, "brakeLights", (sign*w*.315, g+h*.505, tail+.006), (w*.26, h*.06))
        box("Black rubbing strip", (sign*w*.502, g+h*.40, 0), (.012, h*.035, l*.55), m["trim"], body, .004)
        for z in (-.19, .005, .14):
            seam(hull, sign, [(l*z, h*.55), (l*(z+.012), h*.19)], g, m["trim"], body)
        for z in (-.05, .10):
            box("Pull door handle", (sign*w*.502, g+h*.515, l*z), (.012, h*.022, l*.04), m["trim"], body, .003)
        box("Door mirror", (sign*w*.515, g+h*.64, -l*.175), (w*.05, h*.06, l*.03), m["trim"], body, .008)
        box("Mirror arm", (sign*w*.475, g+h*.635, -l*.175), (w*.07, h*.025, l*.015), m["trim"], body, .003)
    panel("Grille", [(-w*.20, g+h*.425, front-.004), (w*.20, g+h*.425, front-.004),
                     (w*.20, g+h*.50, front-.004), (-w*.20, g+h*.50, front-.004)], m["trim"], body, outward=(0, 0, -1))
    for i in range(4):
        box("Grille slat", (0, g+h*(.438+i*.019), front-.008), (w*.39, h*.006, .005), m["chrome"], body, .001)
    for end in (-1, 1):
        box("Black wraparound bumper", (0, g+h*.31, end*l*.494), (w*1.02, h*.10, l*.035), m["trim"], body, .012)
    box("Rear plate recess", (0, g+h*.36, tail+.004), (w*.24, h*.07, .006), m["darkmetal"], body, .004)
    return root, body


def limousine(spec, lamps):
    """Black stretch: a full-size saloon front and tail with a long inserted passenger section."""
    root, body, m, g, cy = start(spec, (.010, .011, .013), .35, .20)
    w, h, l = spec["size"]
    chrome_wheel = dict(m, alloy=m["chrome"])

    def limo_wheel(p):
        wheel(p, spec["wheelRadius"], spec["wheelWidth"], chrome_wheel)
        consolidate(p, "Running wheel geometry")
    wheels(root, spec, limo_wheel)
    rear_glass = glazing("Blue grey smoked glazing canopy", alpha=.56)
    hull = body_loft("Stretched full-size body", [(l*z, f, g+h*s, g+h*d) for z, f, s, d in [
        (-.50, .96, .50, .51), (-.49, 1.0, .53, .545), (-.40, 1.0, .545, .56), (-.28, 1.0, .56, .575),
        (.34, 1.0, .565, .58), (.36, 1.0, .57, .585), (.49, 1.0, .575, .585), (.50, .96, .55, .56)]],
        g+h*.15, w, m["paint"], body, rounding=.12)
    arch_cut(hull, spec, .022)
    arch_cover(spec, .022, m["paint"], body)
    house = House([(l*z, g+h*ys, g+h*yt, w*cw) for z, ys, yt, cw in [
        (-.285, .57, .575, .43), (-.195, .93, .955, .37), (-.17, .95, .985, .35), (.26, .95, .985, .35),
        (.285, .93, .96, .36), (.355, .57, .575, .42)]], w*.445, g+h*.535, .20, shoulder=.4)
    house.build("Long formal glasshouse", m["paint"], body, .012)
    window("Windscreen", house.top_face(0, .04, .96, .06, .93), m["glass"], m["trim"], body, .96)
    window("Rear window", house.top_face(4, .06, .94, .08, .90), rear_glass, m["trim"], body, .95)
    for sign in (-1, 1):
        window("Driver door glass", house.side_window(sign, g+h*.61, h*.03, l*-.245, l*-.115, l*-.19),
               m["glass"], m["trim"], body, .95)
        for name, z0, z1 in [("Divider window", -.10, -.02), ("Stretch window", .0, .115),
                             ("Stretch window", .135, .205)]:
            window(name, house.side_window(sign, g+h*.61, h*.03, l*z0, l*z1), rear_glass, m["trim"], body, .95)
        window("Rear door glass", house.side_window(sign, g+h*.61, h*.03, l*.225, l*.29, zt1=l*.265, rounding=.18),
               rear_glass, m["trim"], body, .93)
        line("Belt chrome", [house.side_point(sign, l*z, g+h*.585, .004) for z in (-.28, 0, .33)], .004, m["chrome"], body)
        line("Rocker chrome", flank(hull, sign, [(l*z, g+h*.22) for z in (-.28, 0, .28)], .003), .004, m["chrome"], body)
        line("Roof drip rail", [house.side_point(sign, l*z, house.top(l*z)+h*.012, .006) for z in (-.17, .05, .26)],
             .004, m["chrome"], body)
        for z in (-.25, -.11, .015, .12, .22, .30):
            seam(hull, sign, [(l*z, h*.55), (l*z, h*.19)], g, m["trim"], body)
        for z in (-.13, .10, .29):
            box("Chrome door handle", (sign*w*.505, g+h*.52, l*(z-.018)), (.012, h*.02, l*.022), m["chrome"], body, .003)
        box("Door mirror", (sign*w*.525, g+h*.66, -l*.265), (w*.055, h*.07, l*.018), m["paint"], body, .008)
        box("Mirror arm", (sign*w*.48, g+h*.645, -l*.265), (w*.07, h*.025, l*.008), m["chrome"], body, .003)
        box("Mirror face", (sign*w*.525, g+h*.66, -l*.2555), (w*.045, h*.056, .003), m["mirror"], body, .003)
    front, tail = -l*.50, l*.50
    # A tall chrome grille of vertical bars between rectangular lamps.
    box("Grille surround", (0, g+h*.41, front-.004), (w*.40, h*.17, .006), m["chrome"], body, .003)
    panel("Grille backing", [(-w*.18, g+h*.34, front-.0085), (w*.18, g+h*.34, front-.0085),
                             (w*.18, g+h*.48, front-.0085), (-w*.18, g+h*.48, front-.0085)], m["trim"], body, outward=(0, 0, -1))
    for i in range(13):
        box("Grille bar", (w*(-.165+i*.0275), g+h*.41, front-.012), (w*.008, h*.14, .006), m["chrome"], body, .001)
    for sign in (-1, 1):
        x = sign*w*.345
        window("Rectangular headlamp", [(x-w*.12, g+h*.41, front-.004), (x+w*.12, g+h*.41, front-.004),
               (x+w*.12, g+h*.49, front-.004), (x-w*.12, g+h*.49, front-.004)], m["white"], m["chrome"], body, .88)
        record(lamps, "headlights", (x, g+h*.45, front-.005), (w*.21, h*.07))
        box("Parking lamp", (x, g+h*.385, front-.003), (w*.2, h*.02, .004), m["amber"], body, .002)
    # Two separate tail lamp clusters (a limo has two, not one light bar) flanking a
    # chrome centre trim strip over the plate recess.
    for sign in (-1, 1):
        window("Tail lamp cluster", [(sign*(w*.33+w*.12), g+h*.45, tail+.004), (sign*(w*.33-w*.12), g+h*.45, tail+.004),
               (sign*(w*.33-w*.12), g+h*.535, tail+.004), (sign*(w*.33+w*.12), g+h*.535, tail+.004)],
               m["red"], m["chrome"], body, .96)
        record(lamps, "brakeLights", (sign*w*.33, g+h*.49, tail+.006), (w*.24, h*.07))
    box("Tail centre trim", (0, g+h*.49, tail+.003), (w*.42, h*.07, .004), m["chrome"], body, .003)
    for end in (-1, 1):
        box("Body colour bumper", (0, g+h*.30, end*l*.4985), (w*1.0, h*.12, l*.02), m["paint"], body, .012)
        box("Bumper chrome strip", (0, g+h*.31, end*(l*.4985+l*.01+.003)), (w*.94, h*.022, .006), m["chrome"], body, .002)
    box("Rear plate recess", (0, g+h*.37, tail+.004), (w*.2, h*.06, .006), m["darkmetal"], body, .004)
    return root, body


BUILDERS = {"paris-tin-snail": tin_snail,
            "shanghai-classic-sedan": classic_sedan, "new-york-limo": limousine}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", default=",".join(BUILDERS))
    parser.add_argument("--render-dir", type=Path)
    parser.add_argument("--lamps", type=Path, help="write each car's lamp centres (game metres) here")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    specs = {spec["id"]: spec for spec in CATALOGUE["vehicles"]}
    written = json.loads(args.lamps.read_text()) if args.lamps and args.lamps.exists() else {}
    for vehicle_id in args.ids.split(","):
        spec = specs[vehicle_id]
        authored = modelling_spec(spec)
        lamps = {}
        root, body = BUILDERS[vehicle_id](authored, lamps)
        prepare_glazing(body, authored)
        consolidate(body, "Body geometry")
        for child in list(body.children):
            if child.type == "EMPTY":
                bpy.data.objects.remove(child, do_unlink=True)
        export(root, ROOT/f"game/public/models/cars/{vehicle_id}.glb", authored["detailScale"])
        s = authored["detailScale"]
        written[vehicle_id] = {kind: [{"position": [round(v*s, 5) for v in lamp["position"]],
                                       "size": [round(v*s, 5) for v in lamp["size"]]} for lamp in items]
                               for kind, items in lamps.items()}
        if args.render_dir:
            render_views(root, spec, ROOT/args.render_dir)
    if args.lamps:
        args.lamps.write_text(json.dumps(written, indent=1)+"\n")


if __name__ == "__main__":
    main()
