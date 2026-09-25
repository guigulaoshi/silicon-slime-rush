"""Small, deterministic Blender mesh tools; public coordinates use the game axes.

All dimensions and running-gear positions come from catalogue.json. Builders use
authoring units so their fixed bevels and other small details scale with the car;
export bakes the body's detail scale into mesh coordinates and node translations,
then packages losslessly with the glTF-Transform dependencies in game/node_modules.
Each body may carry its own ``detailScale`` (sizes every car at 0.7 of
its real counterpart, which needs a different factor per car); the catalogue root
value is the default.
"""

import json
import math
import struct
import subprocess
from decimal import Decimal
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
CATALOGUE = json.loads((ROOT / "game/src/vehicles/catalogue.json").read_text())


def detail_scale(spec):
    """The factor between this body's authored units and delivered game metres."""
    return spec.get("detailScale", CATALOGUE["detailScale"])


def modelling_spec(spec):
    """Keep authored geometry stable while catalogue owns the delivered dimensions."""
    scale = detail_scale(spec)

    def authoring_units(value):
        if isinstance(value, list):
            return [authoring_units(item) for item in value]
        # Decimal division recovers the original authored literals exactly rather
        # than perturbing boolean inputs with binary floating-point roundoff.
        return float(Decimal(str(value)) / Decimal(str(scale)))

    dimensions = ("size", "chassisHalf", "wheelRadius", "wheelWidth", "axles",
                  "track", "anchorY", "suspensionRest", "hitch")
    result = {key: authoring_units(value) if key in dimensions else value
              for key, value in spec.items()}
    result["detailScale"] = scale
    if "trailer" in spec:
        result["trailer"] = modelling_spec(spec["trailer"])
    return result


def xyz(p):
    return (p[0], -p[2], p[1])


def material(name, color, metallic=0, roughness=0.4, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    mat.use_backface_culling = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission
    return mat


def glazing(name="Blue grey smoked glazing", alpha=.28):
    # A lightly smoked dielectric pane over a real hollow cabin. Environment
    # reflections supply the bright response while alpha reveals the upholstery.
    mat = material(name, (.012, .025, .029), metallic=0, roughness=.075)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["IOR"].default_value = 1.52
    shader.inputs["Coat Weight"].default_value = .35
    shader.inputs["Coat Roughness"].default_value = .055
    shader.inputs["Alpha"].default_value = alpha
    mat.diffuse_color = (.012, .025, .029, alpha)
    if alpha < 1:
        mat.surface_render_method = "BLENDED"
        mat.use_backface_culling = False
    return mat


def crown_roof(name, stations, width, base, rise, mat, parent):
    """A pressed roof's full transverse arch, with a rounded longitudinal end."""
    sections = []
    for z, fraction, height in curve_stations(stations, 3):
        half = width * fraction / 2
        cross = [(-half, base, z), (half, base, z)]
        cross += [(half*math.cos(math.pi*i/16),
                   base+rise*height*math.sin(math.pi*i/16), z) for i in range(17)]
        sections.append(cross)
    return loft(name, sections, mat, parent)


def empty(name, parent=None, position=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = xyz(position)
    obj.parent = parent
    return obj


def mesh(name, vertices, faces, mat, parent, recalculate=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(p) for p in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = parent
    # Closed solids have an unambiguous outside. Open single-sided panels do not:
    # Blender's volume-based recalculation can undo their explicitly outward
    # winding, so callers authoring a panel must preserve its vertex order.
    if recalculate:
        
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)
    return obj


def curved_surface(obj, angle=40, weighted=False):
    # Finish after boolean cuts and before joining: exported split normals are
    # permanent vertex data, with no runtime subdivision or extra draw calls.
    obj["surface_angle"] = angle
    obj["surface_weighted"] = weighted
    return obj


def finish_surface(obj):
    if "surface_angle" not in obj:
        return
    for face in obj.data.polygons:
        face.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(obj["surface_angle"]))
    if obj.get("surface_weighted"):
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new("Preserve manufactured panel normals", "WEIGHTED_NORMAL")
        mod.keep_sharp = True
        mod.weight = 50
        bpy.ops.object.modifier_apply(modifier=mod.name)


def bevel(obj, amount, segments=3):
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("Small manufactured edge", "BEVEL")
    mod.width = amount
    mod.segments = segments
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return curved_surface(obj, weighted=True)


def box(name, center, size, mat, parent, edge=0, segments=3):
    x, y, z = center
    a, b, c = (v / 2 for v in size)
    vertices = [(x+sx*a, y+sy*b, z+sz*c) for sx, sy, sz in
                [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                 (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    obj = mesh(name, vertices,
               [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],
               mat, parent)
    return bevel(obj, edge, segments) if edge else obj


def panel(name, points, mat, parent, outward=None):
    center=sum((Vector(p) for p in points),Vector())/len(points)
    normal=(Vector(points[1])-Vector(points[0])).cross(Vector(points[2])-Vector(points[0])).normalized()
    outward=Vector(outward) if outward is not None else (
        Vector((0,1,0)) if abs(normal.y)>.75 else Vector((center.x,0,center.z)))
    if normal.dot(outward)<0:
        points=list(reversed(points))
    return mesh(name, points, [tuple(range(len(points)))], mat, parent,recalculate=False)


def line(name, points, radius, mat, parent):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 0
    spline = curve.splines.new("POLY")
    spline.points.add(len(points)-1)
    for vertex, point in zip(spline.points, points):
        vertex.co = (*xyz(point), 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj


def window(name, points, glass, rubber, parent, inset=0.92):
    # Surface normals are authored by the caller. The inner glass is lifted toward
    # the viewer, avoiding coplanar trim/glass in the actual WebGL render.
    center = sum((Vector(p) for p in points), Vector()) / len(points)
    normal = (Vector(points[1])-Vector(points[0])).cross(Vector(points[2])-Vector(points[0])).normalized()
    if normal.dot(Vector((center.x,0,center.z))) < 0:
        normal.negate()
    # Automotive panes have radiused corners, not four knife-sharp vertices.
    if len(points) == 4 and glass.name.startswith("Blue grey smoked glazing"):
        points = round_section(points, .055, 3)
    seal = panel(name+" seal", points, rubber, parent,outward=normal)
    inner = [tuple(center+(Vector(p)-center)*inset+normal*0.0015) for p in points]
    pane = panel(name+" glass", inner, glass, parent,outward=normal)
    if glass.name.startswith("Blue grey smoked glazing"):
        pane["glazing_direction"] = list(-normal)
        seal["glazing_seal"] = True


def prepare_glazing(body, spec):
    """Open the authored window footprints without moving the exterior skin."""
    panes = [obj for obj in body.children if "glazing_direction" in obj]
    if not panes:
        return
    liner = material("Cabin charcoal lining", (.045,.052,.061), 0, .86)
    upholstery = material("Woven graphite upholstery", (.13,.15,.17), 0, .92)
    w,h,l = spec["size"]
    g = spec["anchorY"]-spec["suspensionRest"]
    shells = [obj for obj in body.children if obj.get("glazing_shell")]
    seals = [obj for obj in body.children if obj.get("glazing_seal")]
    obstacles = [obj for obj in body.children if obj.get("glazing_obstacle")]

    def thickness(obj, depth, interior=False):
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new("Manufactured inward wall thickness", "SOLIDIFY")
        mod.thickness = depth
        mod.offset = -1
        if interior:
            obj.data.materials.append(liner)
            mod.material_offset = len(obj.data.materials)-1
            mod.material_offset_rim = len(obj.data.materials)-1
        bpy.ops.object.modifier_apply(modifier=mod.name)

    for obj in shells:
        thickness(obj, .012, True)
    for obj in seals:
        thickness(obj, .002)

    def subtract(obj, cutter):
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new("Actual clear window aperture", "BOOLEAN")
        modifier.operation = "DIFFERENCE"
        modifier.solver = "EXACT"
        modifier.object = cutter
        bpy.ops.object.modifier_apply(modifier=modifier.name)

    for pane in panes:
        direction = Vector(xyz(pane["glazing_direction"])).normalized()
        points = [vertex.co.copy() for vertex in pane.data.vertices]
        n = len(points)
        faces = [tuple(face.vertices) for face in pane.data.polygons]
        edge_uses = {}
        for face in faces:
            for a,b in zip(face,face[1:]+face[:1]):
                key = tuple(sorted((a,b)))
                edge_uses.setdefault(key, []).append((a,b))
        boundary = [uses[0] for uses in edge_uses.values() if len(uses)==1]
        # Extrude the sampled pane itself, preserving its curved edge exactly.
        vertices = [p-direction*.02 for p in points]+[p+direction*.16 for p in points]
        cutter_faces = faces+[tuple(i+n for i in reversed(face)) for face in faces]
        cutter_faces += [(a,b,b+n,a+n) for a,b in boundary]
        cutter = mesh("Temporary window aperture cutter",
            [(p.x,p.z,-p.y) for p in vertices],cutter_faces,liner,body)
        for target in shells+seals+obstacles:
            subtract(target,cutter)
        bpy.data.objects.remove(cutter,do_unlink=True)
        thickness(pane,.0012)

    # Mirror inserts stay reflective and opaque, independent of cabin glazing.
    mirror = None
    for obj in body.children:
        if obj.type != "MESH" or "mirror" not in obj.name.lower():
            continue
        for index,mat in enumerate(obj.data.materials):
            if mat and mat.name.startswith("Blue grey smoked glazing"):
                if mirror is None:
                    mirror = material("Mirror reflective glass",(.16,.20,.23),.85,.10)
                obj.data.materials[index] = mirror

    # Visible furnishings live above the existing closed waist-level body. The
    # exterior deck below the window stays intact; no driver or added decoration.
    # front, rear, floor, seat-top and usable half-width fractions.
    layout = {
        "micro-hatch": (-.15,.28,.635,.88,.28),
        "sports-car": (-.12,.16,.62,.85,.25),
        "lightweight-sports": (-.12,.23,.58,.87,.25),
        "jeep": (-.04,.31,.685,.88,.32),
        "pickup-travel-trailer": (-.13,.025,.59,.88,.31),
        "monster-truck": (-.07,.073,.79,.93,.26),
        "retro-van": (-.33,.35,.605,.86,.34),
        "school-bus": (-.19,.445,.615,.83,.34),
        "travel-trailer": (-.38,.37,.30,.72,.35),
    }
    front,rear,floor,top,half = layout[spec["id"]]
    # Continue the dark lower cabin to the door cards and cowl so the seat
    # bases sit in a lined footwell rather than on an isolated floating plate.
    footwell = {
        "micro-hatch":(-.235,.355,.80),
        "sports-car":(-.195,.27,.74),
        "lightweight-sports":(-.195,.31,.77),
        "jeep":(-.065,.35,.75),
        "pickup-travel-trailer":(-.17,.05,.78),
        "monster-truck":(-.095,.09,.65),
        "retro-van":(-.35,.38,.79),
        "school-bus":(-.225,.455,.87),
        "travel-trailer":(-.40,.40,.85),
    }
    floor_front,floor_rear,floor_width = footwell[spec["id"]]
    box("Cabin floor lining",(0,g+h*(floor-.05),l*(floor_front+floor_rear)/2),
        (w*floor_width,h*.10,l*(floor_rear-floor_front)),liner,body,.008)
    if spec["id"] == "travel-trailer":
        for sign in (-1,1):
            box("Camper upholstered bench",(sign*w*.28,g+h*.47,l*.25),
                (w*.22,h*.25,l*.28),upholstery,body,.035,3)
        box("Camper table",(0,g+h*.52,l*.22),(w*.34,h*.018,l*.21),liner,body,.01)
        return
    rows = 8 if spec["id"] == "school-bus" else 3 if spec["id"] == "retro-van" else 2 if spec["id"] in ("micro-hatch","jeep") else 1
    seat_depth = min(w*.23,l*(rear-front)/(rows+1)*.64)
    height = h*(top-floor)
    for row in range(rows):
        z = l*(front+(rear-front)*(row+.65)/(rows+.35))
        for sign in (-1,1):
            x = sign*w*half*.60
            box("Cabin seat cushion",(x,g+h*floor+height*.16,z-seat_depth*.28),
                (w*half*.76,height*.19,seat_depth),upholstery,body,.018,3)
            box("Cabin seat backrest",(x,g+h*floor+height*.49,z+seat_depth*.20),
                (w*half*.76,height*.70,seat_depth*.23),upholstery,body,.02,3)
            box("Cabin seat headrest",(x,g+h*floor+height*.92,z+seat_depth*.20),
                (w*half*.47,height*.24,seat_depth*.26),upholstery,body,.012,3)
    box("Recessed charcoal dashboard",(0,g+h*floor+height*.30,l*front),
        (w*half*1.92,height*.23,seat_depth*.75),liner,body,.018,3)
    steering = empty("Interior steering column",body,(-w*half*.6,g+h*floor+height*.51,l*front+seat_depth*.49))
    radius = min(w*.08,height*.28)
    radial("Interior steering wheel",[(-.006,radius*.79),(.006,radius*.79),
        (.006,radius),(-.006,radius)],liner,steering,24,"z")
    print(json.dumps({"id":spec["id"],"clearWindowPanes":len(panes),
                      "hollowShells":len(shells),"seatRows":rows}),flush=True)


def loft(name, sections, mat, parent, smooth=True):
    """Join cross sections supplied as consistently ordered game-space vertices."""
    n = len(sections[0])
    vertices = [point for section in sections for point in section]
    faces = [tuple(reversed(range(n))), tuple((len(sections)-1)*n+i for i in range(n))]
    for j in range(len(sections)-1):
        faces.extend((j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i) for i in range(n))
    obj = mesh(name, vertices, faces, mat, parent)
    return curved_surface(obj) if smooth else obj


def roof_light_bar(parent, centers, radius, mount_y, mount_x, mats):
    """Closed forward-facing driving lamps, with lens centers in authoring units."""
    y, z = centers[0][1:]
    rail_y = y-radius*1.30
    rail_z = z+radius*.48
    width = centers[-1][0]-centers[0][0]+radius*2.24
    box("Roof lamp powder coated crossbar",(0,rail_y,rail_z),
        (width,radius*.28,radius*.48),mats["darkmetal"],parent,radius*.07,3)
    for sign in (-1,1):
        x = sign*mount_x
        box("Roof lamp mounting foot",(x,mount_y,rail_z),
            (radius*.66,radius*.17,radius*1.35),mats["trim"],parent,radius*.05,3)
        box("Roof lamp mounting riser",(x,(mount_y+rail_y)/2,rail_z),
            (radius*.25,rail_y-mount_y,radius*.47),mats["darkmetal"],parent,radius*.04,3)
    lens = material("Roof driving lamp clear reflector",(.80,.86,.91),.38,.18,.08)
    for x,y,z in centers:
        def round_solid(name, profile, mat):
            rings = [[(x+radius*r*math.cos(i*math.tau/32),
                       y+radius*r*math.sin(i*math.tau/32),z+radius*depth)
                      for i in range(32)] for depth,r in profile]
            return loft(name,rings,mat,parent)
        # The stepped rear cup gives each lamp a real side silhouette. The
        # silver bezel backs a smaller convex lens, leaving a visible dark rim.
        round_solid("Deep sealed roof lamp housing",[(.94,.56),(.80,.86),
                    (.48,1),(.12,1),(.06,.94)],mats["trim"])
        round_solid("Brushed roof lamp retaining bezel",[(.11,.91),(.025,.91)],mats["alloy"])
        round_solid("Convex roof driving lamp lens",[(.018,.80),(-.025,.73),
                    (-.05,.28)],lens)
        for sign in (-1,1):
            box("Roof lamp adjustable yoke cheek",(x+sign*radius*.91,y-radius*.64,z+radius*.48),
                (radius*.16,radius*1.14,radius*.33),mats["darkmetal"],parent,radius*.035,3)
            box("Roof lamp yoke pivot bolt",(x+sign*radius*1.015,y-radius*.29,z+radius*.48),
                (radius*.10,radius*.19,radius*.19),mats["alloy"],parent,radius*.025,2)
        # A closed foot ties both cheeks to the bar, including in the rear view.
        box("Roof lamp yoke bridge",(x,rail_y+radius*.20,rail_z),
            (radius*2.04,radius*.16,radius*.38),mats["darkmetal"],parent,radius*.035,3)


def curve_stations(stations, steps=4):
    """Monotone cubic stations stay within the authored width/height envelope."""
    xs = [row[0] for row in stations]
    columns = list(zip(*(row[1:] for row in stations)))
    slopes = []
    for ys in columns:
        secants = [(b-a)/(xb-xa) for a,b,xa,xb in zip(ys,ys[1:],xs,xs[1:])]
        tangent = [secants[0]]
        for i in range(1,len(xs)-1):
            left,right = secants[i-1:i+1]
            if left*right <= 0:
                tangent.append(0)
            else:
                h0,h1 = xs[i]-xs[i-1],xs[i+1]-xs[i]
                a,b = 2*h1+h0,h1+2*h0
                tangent.append((a+b)/(a/left+b/right))
        tangent.append(secants[-1])
        slopes.append(tangent)
    result = []
    for i in range(len(xs)-1):
        span = xs[i+1]-xs[i]
        for j in range(steps):
            t = j/steps
            row = [xs[i]+span*t]
            for ys,ms in zip(columns,slopes):
                row.append((2*t**3-3*t*t+1)*ys[i]+(t**3-2*t*t+t)*span*ms[i]
                           +(-2*t**3+3*t*t)*ys[i+1]+(t**3-t*t)*span*ms[i+1])
            result.append(row)
    return result+[stations[-1]]


def round_section(points, fraction=.18, steps=3):
    """Round local profile corners while retaining the broad stamped panels."""
    result = []
    for i,point in enumerate(points):
        a = tuple(p+(previous-p)*fraction for p,previous in zip(point,points[i-1]))
        b = tuple(p+(following-p)*fraction for p,following in zip(point,points[(i+1)%len(points)]))
        for j in range(steps+1):
            t = j/steps
            result.append(tuple((1-t)**2*start+2*t*(1-t)*p+t*t*end
                                for start,p,end in zip(a,point,b)))
    return result


def body_loft(name, stations, bottom, width, mat, parent, curved=True, rounding=.18, broad_wings=False):
    # z, half-width fraction, shoulder height, centre deck height.
    sections = []
    for z, fraction, shoulder, deck in curve_stations(stations) if curved else stations:
        w = width * fraction / 2
        sections.append([(-w*.90,bottom,z), (w*.90,bottom,z),
                         (w,bottom+(shoulder-bottom)*.30,z), (w,shoulder-.022,z),
                         (w*.91,shoulder,z), (w*.56,deck,z),
                         (-w*.56,deck,z),(-w*.91,shoulder,z),
                         (-w,shoulder-.022,z),(-w,bottom+(shoulder-bottom)*.30,z)])
    if broad_wings:
        # Keep the inner edges of the tyre wells under the raised fenders; a
        # narrow central bonnet must not slope down through a wheel-well cut.
        for section in sections:
            right,left=section[4],section[7]
            section[5]=(section[5][0]*.64,section[5][1],section[5][2])
            section[6]=(section[6][0]*.64,section[6][1],section[6][2])
            section.insert(7,(left[0]*.65,left[1]-.004,left[2]))
            section.insert(5,(right[0]*.65,right[1]-.004,right[2]))
    if rounding:
        sections = [round_section(section, rounding) for section in sections]
    return loft(name, sections, mat, parent)


def arch_cut(obj, spec, clearance=0.015):
    # Each well is cut only where its tyre lives. A cylinder across the full car
    # would also cut away a sports car's bonnet between the raised front wings.
    for axle in spec["axles"]:
        center_y = spec["anchorY"]-spec["suspensionRest"]+spec["wheelRadius"]
        for sign in (-1,1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=spec["wheelRadius"]+clearance,
                depth=spec["wheelWidth"]+.10, location=xyz((sign*spec["track"]/2,center_y,axle)),
                rotation=(0,math.pi/2,0))
            cutter = bpy.context.object
            bpy.context.view_layer.objects.active = obj
            mod = obj.modifiers.new("Open wheel arch", "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.solver = "EXACT"
            mod.object = cutter
            bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.data.objects.remove(cutter, do_unlink=True)


def arch_cover(spec, clearance, mat, parent, thickness=.012, name="Wheel arch cover"):
    """Roof over each wheel well, the full width of the tyre.

    arch_cut opens the skin all the way to the tyre top, so on any car whose bodywork above that
    line is narrower than its track the bare tyre is in plain sight from straight above -- which is
    what reported. A decorative arch_lip is a narrow band and only hides the strip it
    covers; this spans the tyre's whole width at the same radius the cut used, so it fills the cut
    instead of standing proud of it. Pass the clearance that car's arch_cut used.
    """
    center_y = spec["anchorY"]-spec["suspensionRest"]+spec["wheelRadius"]
    for axle in spec["axles"]:
        for sign in (-1,1):
            arch_lip(name, sign*spec["track"]/2, center_y, axle, spec["wheelRadius"]+clearance,
                     thickness, spec["wheelWidth"]+2*clearance, mat, parent)


def arch_lip(name, x, center_y, axle, radius, thickness, depth, mat, parent):
    sections = []
    # Outer wing extends down to axle level; lower tyre stays visibly free.
    for i in range(25):
        angle = math.pi*i/24
        cs, sn = math.cos(angle), math.sin(angle)
        sections.append([(x-depth/2,center_y+sn*radius,axle+cs*radius),
                         (x+depth/2,center_y+sn*radius,axle+cs*radius),
                         (x+depth/2,center_y+sn*(radius+thickness),axle+cs*(radius+thickness)),
                         (x-depth/2,center_y+sn*(radius+thickness),axle+cs*(radius+thickness))])
    return loft(name, sections, mat, parent)


def radial(name, profile, mat, parent, segments=32, axis="x"):
    # profile=(axial coordinate, radius), with a closed profile for tyres/rim rings.
    def point(a, r, angle):
        if axis == "x":
            return (a, math.sin(angle)*r, math.cos(angle)*r)
        return (math.cos(angle)*r, math.sin(angle)*r, a)
    sections = [[point(a,r,2*math.pi*i/segments) for a,r in profile] for i in range(segments)]
    n = len(profile)
    vertices = [p for row in sections for p in row]
    faces = [(i*n+j,i*n+(j+1)%n,((i+1)%segments)*n+(j+1)%n,((i+1)%segments)*n+j)
             for i in range(segments) for j in range(n)]
    return curved_surface(mesh(name,vertices,faces,mat,parent), angle=55)


def wheel_fasteners(parent, radius, axial, sign, mat, axis="x", count=5):
    """Recessed hex fasteners stay on the rotating wheel and inside its width."""
    vertices, faces = [], []
    for i in range(count):
        theta = i*math.tau/count
        cy, cz = radius*.29*math.sin(theta), radius*.29*math.cos(theta)
        start = len(vertices)
        for a, rr in [(axial-sign*.013,radius*.052),
                      (axial-sign*.003,radius*.052),(axial,radius*.041)]:
            for j in range(6):
                angle = j*math.tau/6
                y, z = cy+rr*math.sin(angle), cz+rr*math.cos(angle)
                vertices.append((a,y,z) if axis == "x" else (z,y,a))
        faces += [tuple(start+j for j in reversed(range(6))),
                  tuple(start+12+j for j in range(6))]
        faces += [(start+k*6+j,start+k*6+(j+1)%6,
                   start+(k+1)*6+(j+1)%6,start+(k+1)*6+j)
                  for k in range(2) for j in range(6)]
    mesh("Recessed hex wheel fasteners",vertices,faces,mat,parent)


def wheel(parent, radius, width, mats, offroad=False, sporty=False, axis="x", covered=False):
    r, w = radius, width/2
    profile = [(-w*.90,r*.65),(-w,r*.83),(-w*.72,r*.96),(-w*.45,r)]
    if not offroad:
        # Continuous moulded rain channels replace the old raised gear-like
        # blocks on highway tyres; only the utility tyre has exposed lugs.
        profile += [(-w*.30,r),(-w*.26,r*.986),(-w*.20,r*.986),(-w*.16,r),
                    (w*.16,r),(w*.20,r*.986),(w*.26,r*.986),(w*.30,r)]
    profile += [(w*.45,r),(w*.72,r*.96),(w,r*.83),(w*.90,r*.65)]
    radial("Tyre", profile,mats["rubber"],parent,64,axis)
    outer = r*(.66 if offroad else .76 if sporty else .70)
    for sign in (-1,1):
        a = sign*w*.97
        radial("Alloy rim",[(a,outer*.88),(a,outer),(a-sign*.007,outer),
                            (a-sign*.012,outer*.88)],mats["darkmetal"] if sporty or offroad else mats["alloy"],parent,48,axis)
        radial("Brake disc",[(a-sign*.018,0),(a-sign*.018,outer*.84),
                             (a-sign*.023,outer*.84),(a-sign*.023,0)],mats["brake"],parent,24,axis)
        if not covered:
            radial("Hub",[(a+sign*.002,0),(a+sign*.002,outer*.23),
                          (a-sign*.015,outer*.23),(a-sign*.015,0)],mats["darkmetal"] if offroad else mats["alloy"],parent,16,axis)
            wheel_fasteners(parent,outer,a-sign*.002,sign,mats["alloy"],axis,6 if offroad else 5)
            # The disc turns with the hub. Two narrow machined rings catch light
            # through the open spokes without adding a rotating brake caliper.
            for rr in [outer*.58,outer*.75]:
                radial("Machined brake friction ring",[(a-sign*.017,rr),
                    (a-sign*.017,rr+outer*.013),(a-sign*.019,rr+outer*.013),
                    (a-sign*.019,rr)],mats["alloy"],parent,48,axis)
        spokes = 0 if covered else 10 if sporty else 6 if offroad else 5
        for i in range(spokes):
            angle = 2*math.pi*i/spokes
            def point(rr, delta):
                yy, zz = math.sin(angle+delta)*rr,math.cos(angle+delta)*rr
                return (a,yy,zz) if axis=="x" else (zz,yy,a)
            spread=.065 if sporty else .11
            pts = [point(outer*.18,-.28),point(outer*.96,-spread),
                   point(outer*.96,spread),point(outer*.18,.28)]
            # A cast spoke has an actual side wall. The previous single polygon
            # disappeared at grazing angles in the rotating garage preview.
            vector = Vector((sign*.014,0,0) if axis=="x" else (0,0,sign*.014))
            vertices = pts+[tuple(Vector(p)-vector) for p in pts]
            obj=mesh("Cast spoke",vertices,[(0,1,2,3),(7,6,5,4),
                     (0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],
                     mats["darkmetal"] if sporty or offroad else mats["alloy"],parent)
            bevel(obj,.002,2)
    # Tread only belongs to this moving wheel. Off-road blocks remain within the
    # contract radius: the carcass is slightly below the lugs at each shoulder.
    for i in range(32 if offroad else 0):
        angle = 2*math.pi*i/(32 if offroad else 28)
        for side in (-1,1):
            aa = side*w*.46
            da = w*.40
            delta = .061 if offroad else .013
            vertices=[]
            for rr in (r*.97,r*1.002):
                for a,theta in [(aa-da,angle-delta),(aa+da,angle-delta+.027),
                                (aa+da,angle+delta+.027),(aa-da,angle+delta)]:
                    yy,zz=math.sin(theta)*rr,math.cos(theta)*rr
                    vertices.append((a,yy,zz) if axis=="x" else (zz,yy,a))
            mesh("Tread block" if offroad else "Tread groove",vertices,
                 [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],
                 mats["tread"] if offroad else mats["rubber"],parent)


def consolidate(parent, name):
    objects = [obj for obj in parent.children_recursive if obj.type=="MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        finish_surface(obj)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    obj.select_set(False)
    # Joining preserves vertex positions; the joined mesh is still local to the
    # identity pivot, and no geometry leaks into sibling moving parts.
    return obj


def bake_glb_scale(path, scale):
    """Scale exported coordinates without changing Blender's split-normal topology."""
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20:20+json_length])
    binary = bytearray(data[28+json_length:])
    positions = {primitive["attributes"]["POSITION"]
                 for item in document["meshes"] for primitive in item["primitives"]}
    for index in positions:
        accessor = document["accessors"][index]
        view = document["bufferViews"][accessor["bufferView"]]
        offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        stride = view.get("byteStride", 12)
        for vertex in range(accessor["count"]):
            address = offset + vertex*stride
            point = struct.unpack_from("<3f", binary, address)
            struct.pack_into("<3f", binary, address, *(v*scale for v in point))
        for bound in ("min", "max"):
            accessor[bound] = [value*scale for value in accessor[bound]]
    for node in document["nodes"]:
        if "translation" in node:
            node["translation"] = [value*scale for value in node["translation"]]
        if "matrix" in node:
            node["matrix"][12:15] = [value*scale for value in node["matrix"][12:15]]
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 28+len(encoded)+len(binary))
                     + struct.pack("<I4s", len(encoded), b"JSON") + encoded
                     + struct.pack("<I4s", len(binary), b"BIN\x00") + binary)


def export(root, path, scale):
    """Deliver ``root`` at ``path``; ``scale`` is the body's detail scale from modelling_spec."""
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    path.parent.mkdir(parents=True,exist_ok=True)
    raw = ROOT / "tmp/vehicle-exports" / path.name
    raw.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(raw),export_format="GLB",use_selection=True,
        export_yup=True,export_animations=False,export_cameras=False,export_lights=False,
        export_texcoords=False,export_normals=True,export_materials="EXPORT")
    bake_glb_scale(raw, scale)
    # Preserve every authored triangle, material and running-gear pivot. The
    # shared packer decodes its output and verifies these before writing it.
    subprocess.run(["node", str(ROOT / "assets-src/compress_models.mjs"),
                    str(raw), str(path)], check=True)
    # The preview scene must now match the delivered GLB. Scaling before export
    # would recompute split normals and change glTF vertex deduplication.
    # Scale each local translation and each mesh once. Parent scales remain
    # identity, keeping wheel rotation axes and hitch markers in physical units.
    matrix = Matrix.Scale(scale, 4)
    meshes = set()
    for obj in [root, *root.children_recursive]:
        obj.location *= scale
        if obj.type == "MESH" and obj.data not in meshes:
            obj.data.transform(matrix)
            meshes.add(obj.data)
    bpy.context.view_layer.update()
    triangles = 0
    for obj in root.children_recursive:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
    print(json.dumps({"id":path.stem,"bytes":path.stat().st_size,"triangles":triangles}),flush=True)


def render_views(root, spec, directory, center_z=0, distance_factor=1):
    directory.mkdir(parents=True,exist_ok=True)
    scene=bpy.context.scene
    scene.render.engine="CYCLES"
    scene.cycles.device="CPU"
    scene.cycles.samples=16
    scene.cycles.use_denoising=True
    scene.render.resolution_x=960
    scene.render.resolution_y=640
    scene.render.resolution_percentage=100
    scene.world.color=(.23,.23,.23)
    scene.view_settings.view_transform="AgX"
    ground=spec["anchorY"]-spec["suspensionRest"]
    floor=box("Studio floor",(0,ground-.027,0),(200,.05,200),
              material("Studio warm grey",(.24,.27,.30),roughness=.9),None)
    target=Vector(xyz((0,ground+spec["size"][1]*.45,center_z)))
    for name,location,power,size in [("Key",(-3,-4,6),600,5),("Fill",(4,1,4),450,4),("Rim",(-1,4,5),700,3)]:
        data=bpy.data.lights.new(name,"AREA")
        data.energy=power
        data.shape="DISK"
        data.size=size
        obj=bpy.data.objects.new(name,data)
        bpy.context.collection.objects.link(obj)
        obj.location=location
        obj.rotation_euler=(target-obj.location).to_track_quat("-Z","Y").to_euler()
    data=bpy.data.cameras.new("Studio camera")
    cam=bpy.data.objects.new("Studio camera",data)
    bpy.context.collection.objects.link(cam)
    scene.camera=cam
    length=spec["size"][2]
    for view,position in [("front-three-quarter",(1.9,1.05,-2.4)),
                          ("side",(2.8,.38,0)),("rear-three-quarter",(1.9,1,2.3)),
                          ("chase",(.25,1.45,4.0))]:
        offset=(.25,max(1.35,length*.40),max(3.6,length*1.40)) if view=="chase" else tuple(v*length*distance_factor for v in position)
        cam.location=target+Vector(xyz(offset))
        cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler()
        data.type="ORTHO" if view=="side" else "PERSP"
        data.ortho_scale=length*1.5
        data.lens=52 if view!="chase" else 45
        scene.render.filepath=str(directory/f"{spec['id']}-{view}.png")
        bpy.ops.render.render(write_still=True)
