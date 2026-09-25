"""Rebuild the first three reference-based cars with Blender 5.x, no downloads.

From the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \
      assets-src/vehicles/build_compact_cars.py -- --render-dir tmp/run-05-06/model
Omit --render-dir for export only. --ids accepts a comma-separated subset.
For the Sedan menu image add --sedan-reference docs/car-reference/micro-hatch.png.
"""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import (ROOT,CATALOGUE,detail_scale,modelling_spec,arch_cut,arch_cover,arch_lip,bevel,body_loft,box,consolidate,
                    prepare_glazing,curved_surface,curve_stations,round_section,glazing,crown_roof,empty,export,line,loft,material,mesh,panel,render_views,roof_light_bar,wheel,window,xyz)


def materials(color):
    return {
        "paint":material("Factory body paint",color,.22,.31),
        "rubber":material("Tyre rubber",(.019,.022,.026),0,.82),
        "tread":material("Off-road tread",(.031,.034,.038),0,.85),
        "trim":material("Black moulded trim",(.027,.033,.040),0,.58),
        "glass":glazing(),
        "alloy":material("Machined aluminium",(.46,.49,.52),.72,.29),
        "darkmetal":material("Graphite alloy",(.095,.11,.13),.72,.32),
        "brake":material("Recessed brake disc",(.13,.145,.16),.70,.52),
        "white":material("Headlight reflector",(.76,.86,.94),.32,.23,.12),
        "red":material("Red tail lamp",(.46,.012,.009),.12,.25,.12),
        "amber":material("Amber indicator",(.92,.31,.018),.05,.3,.08),
    }


def inset_face(corners,u0=.045,u1=.955,v0=.06,v1=.96,lift=.003,uv=None):
    """Inset a cabin face in its own plane, then move it toward the outside.

    Corners run bottom-left, bottom-right, top-right, top-left. Independent Y/Z
    offsets bury glass in the shallow sports-car windshield; face interpolation
    keeps every corner on the same manufactured panel at any windshield rake.
    """
    a,b,c,d=map(Vector,corners)
    normal=(b-a).cross(d-a).normalized()
    center=(a+b+c+d)/4
    if normal.dot(Vector((center.x,0,center.z)))<0:normal.negate()
    def point(u,v):
        return tuple(((1-u)*a+u*b)*(1-v)+((1-u)*d+u*c)*v+normal*lift)
    return [point(u,v) for u,v in (uv or [(u0,v0),(u1,v0),(u1,v1),(u0,v1)])]


def cabin(body,m,front_base,front_top,rear_top,rear_base,base_y,roof_y,base_w,roof_w,edge,
          rear_window_bottom=.06,side_window_rear_bottom=.06,front_window_bottom=.06,
          side_window_front_bottom=.06):
    vertices=[(-base_w,base_y,front_base),(base_w,base_y,front_base),
              (-roof_w,roof_y,front_top),(roof_w,roof_y,front_top),
              (-roof_w,roof_y,rear_top),(roof_w,roof_y,rear_top),
              (-base_w,base_y,rear_base),(base_w,base_y,rear_base)]
    obj=mesh("Sculpted cabin",vertices,[(0,1,3,2),(2,3,5,4),(4,5,7,6),
             (0,2,4,6),(1,7,5,3),(0,6,7,1)],m["paint"],body)
    bevel(obj,edge,4)
    obj["glazing_shell"] = True
    # Both the seal and glass follow their actual cabin face. The common window
    # helper adds another 1.5 mm to the glass, preserving single-sided visibility.
    window("Windscreen",inset_face([vertices[i] for i in (0,1,3,2)],v0=front_window_bottom),
           m["glass"],m["trim"],body,.95)
    window("Rear glass",inset_face([vertices[i] for i in (7,6,4,5)],v0=rear_window_bottom),
           m["glass"],m["trim"],body,.94)
    for sign in (-1,1):
        indices=(0,6,4,2) if sign<0 else (1,7,5,3)
        window("Side glazing",inset_face([vertices[i] for i in indices],
               uv=[(.045,side_window_front_bottom),(.955,side_window_rear_bottom),(.955,.96),(.045,.96)]),
               m["glass"],m["trim"],body,.94)
    return obj


def headlight(body,m,points):
    window("Headlamp",points,m["white"],m["trim"],body,.80)
    center=sum((Vector(p) for p in points),Vector())/len(points)
    normal=(Vector(points[1])-Vector(points[0])).cross(Vector(points[2])-Vector(points[0])).normalized()
    if normal.dot(Vector((center.x,0,center.z)))<0:normal.negate()
    rim=[center+(Vector(p)-center)*.63+normal*.003 for p in points]
    reflector_center=center+normal*.006
    for i in range(len(rim)):
        panel("Faceted headlamp reflector",[tuple(rim[i]),tuple(rim[(i+1)%len(rim)]),
              tuple(reflector_center)],m["alloy"] if i%2 else m["white"],body)


def on_deck(shell,xz_points,ceiling,lift=.003):
    points=[]
    for x,z in xz_points:
        hit,position,_,_=shell.ray_cast(Vector((x,-z,ceiling)),Vector((0,0,-1)))
        if not hit:raise ValueError(f"Deck decoration misses body at {(x,z)}")
        points.append((x,position.z+lift,z))
    return points


def deck_crease(shell, corners, ceiling, mat, parent):
    # A single four-corner panel bridges over a curved bonnet and sinks into it
    # between corners. Sample the actual shell along and across the pressed ridge.
    a,b,c,d = map(Vector,corners)
    vertices = []
    rows,columns = 16,4
    for i in range(rows+1):
        t = i/rows
        start,end = a.lerp(d,t),b.lerp(c,t)
        for j in range(columns+1):
            u = j/columns
            xz = start.lerp(end,u)
            vertices.extend(on_deck(shell,[xz],ceiling,.004+.004*math.sin(math.pi*u)))
    faces = []
    for i in range(rows):
        for j in range(columns):
            n = i*(columns+1)+j
            face = (n,n+1,n+columns+2,n+columns+1)
            a,b,c = (Vector(vertices[k]) for k in face[:3])
            if (b-a).cross(c-a).y < 0:
                face = tuple(reversed(face))
            faces.append(face)
    return curved_surface(mesh("Bonnet pressed crease",vertices,faces,mat,parent,recalculate=False))


def base(spec,color,sporty=False,offroad=False):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Delete unused data so the same IDs/material names recur on each rebuild.
    for collection in (bpy.data.meshes,bpy.data.curves,bpy.data.materials):
        for data in list(collection):
            if data.users==0: collection.remove(data)
    root=empty("vehicle-root")
    body=empty("body",root)
    m=materials(color)
    ground=spec["anchorY"]-spec["suspensionRest"]
    cy=ground+spec["wheelRadius"]
    for i,axle in enumerate(spec["axles"]):
        for j,sign in enumerate((-1,1)):
            pivot=empty(f"wheel-{2*i+j}",root,(sign*spec["track"]/2,cy,axle))
            wheel(pivot,spec["wheelRadius"],spec["wheelWidth"],m,offroad,sporty)
            consolidate(pivot,"Running wheel geometry")
    return root,body,m,ground,cy


def sedan_patch(name, shell, rows, mat, body, direction, lift=.0025):
    """Project a tessellated glazing/trim patch onto the manufactured shell."""
    vertices=[]
    for row in rows:
        for point in row:
            origin=Vector((point[0],-point[2],point[1]))
            ray=Vector((direction[0],-direction[2],direction[1]))
            hit,position,normal,_=shell.ray_cast(origin,ray)
            if not hit:raise ValueError(f"{name} misses shell at {point}")
            position-=ray*lift
            vertices.append((position.x,position.z,-position.y))
    count=len(rows[0])
    faces=[]
    for i in range(len(rows)-1):
        for j in range(count-1):
            n=i*count+j
            face=(n,n+1,n+1+count,n+count)
            a,b,c=(Vector(vertices[k]) for k in face[:3])
            if (b-a).cross(c-a).dot(Vector(direction))>0:face=tuple(reversed(face))
            faces.append(face)
    obj = curved_surface(mesh(name,vertices,faces,mat,body,recalculate=False))
    if mat.name.startswith("Blue grey smoked glazing"):
        shell["glazing_shell"] = True
        obj["glazing_direction"] = list(direction)
    elif "seal" in name.lower():
        obj["glazing_seal"] = True
    return obj


def micro(spec):
    # Keep the save-compatible id; its new silhouette is a four-door fastback.
    paint_color=(.012,.015,.020)
    root,body,m,g,cy=base(spec,paint_color,sporty=True)
    mirror_glass=material("Mirror reflective glass",(.10,.15,.19),.65,.14)
    mirror_paint=material("Mirror housing paint",paint_color,.22,.31)
    w,h,l=spec["size"]
    shell=body_loft("Rounded fastback lower body",[
        (-l*.498,.71,g+h*.36,g+h*.38),(-l*.477,.83,g+h*.43,g+h*.46),
        (-l*.40,.91,g+h*.49,g+h*.515),(-l*.29,.93,g+h*.55,g+h*.575),
        (-l*.20,.90,g+h*.585,g+h*.60),(l*.13,.90,g+h*.605,g+h*.61),
        (l*.31,.95,g+h*.635,g+h*.65),(l*.435,.87,g+h*.63,g+h*.655),
        (l*.485,.79,g+h*.565,g+h*.605),(l*.499,.73,g+h*.43,g+h*.47)],
        g+h*.135,w,m["paint"],body,rounding=.25)
    arch_cut(shell,spec,.016)
    # Upright hatch sides sit inboard of the tyres, so the cut exposed them overhead.
    arch_cover(spec,.016,m["paint"],body)
    # A varying crown continues from the windscreen into the sloping hatch.
    # These are silhouette stations, not a flat bevelled cabin box.
    roof_stations=[(-.29,.585,.395),(-.235,.73,.385),(-.16,.865,.371),
        (-.07,.97,.356),(.015,1.0,.35),(.12,.987,.35),(.23,.945,.354),
        (.32,.864,.363),(.40,.745,.374),(.457,.642,.381)]
    sections=[]
    for z,top,half in curve_stations(roof_stations,6):
        y=g+h*top
        # The tucked side wall and crowned roof share vertices around a round shoulder.
        sections.append(round_section([(-w*.433,g+h*min(.55,top-.11),l*z),(w*.433,g+h*min(.55,top-.11),l*z),
            (w*.435,g+h*min(.603,top-.075),l*z),(w*half,y-h*.055,l*z),(w*half*.72,y-h*.008,l*z),
            (0,y,l*z),(-w*half*.72,y-h*.008,l*z),(-w*half,y-h*.055,l*z),
            (-w*.435,g+h*min(.603,top-.075),l*z)],.16,4))
    upper=loft("Continuous crowned fastback cabin",sections,m["paint"],body)
    # Side glazing is sampled on that same curved skin. Leave two separate door
    # openings, a B pillar, and a rear quarter pane under the falling roof line.
    top_profile=curve_stations([(-.265,.635),(-.22,.728),(-.15,.846),(-.065,.918),
         (.015,.945),(.12,.93),(.23,.885),(.31,.806),(.37,.712)],6)
    def side_top(z):
        for (a,ya),(b,yb) in zip(top_profile,top_profile[1:]):
            if a<=z<=b:return ya+(yb-ya)*(z-a)/(b-a)
        return top_profile[-1][1] if z>0 else top_profile[0][1]
    def side_rows(sign,z0,z1,inset=0):
        rows=[]
        for i in range(13):
            z=z0+(z1-z0)*(inset+(1-2*inset)*i/12)
            low=.616+max(0,z-.16)*.22
            high=side_top(z)-.014
            rows.append([(sign*w,g+h*(low+(high-low)*(inset+(1-2*inset)*j/8)),l*z)
                         for j in range(9)])
        return rows
    for sign in (-1,1):
        for name,z0,z1 in [("Front door",-.261,.022),("Rear door",.040,.285),("Quarter",.297,.365)]:
            sedan_patch(name+" window seal",upper,side_rows(sign,z0,z1),m["trim"],body,(-sign,0,0),.005)
            sedan_patch(name+" smoked glass",upper,side_rows(sign,z0,z1,.048),m["glass"],body,(-sign,0,0),.009)
    def roof_rows(z0,z1,half0,half1,inset=0):
        rows=[]
        for i in range(13):
            t=inset+(1-2*inset)*i/12
            z=z0+(z1-z0)*t
            half=half0+(half1-half0)*t
            rows.append([(w*half*(-1+2*(inset+(1-2*inset)*j/12)),g+h*1.2,l*z)
                         for j in range(13)])
        return rows
    for name,z0,z1,a,b in [("Swept windscreen",-.275,-.105,.384,.314),
                           ("Panoramic roof",-.080,.238,.302,.303),
                           ("Sloping hatch glass",.256,.418,.314,.350)]:
        sedan_patch(name+" seal",upper,roof_rows(z0,z1,a,b),m["trim"],body,(0,-1,0),.005)
        sedan_patch(name,upper,roof_rows(z0,z1,a,b,.025),m["glass"],body,(0,-1,0),.009)
    # Door seams follow the lower skin, never hover as straight bars off a curved flank.
    def flank(sign,points,lift=.002):
        result=[]
        samples=[(a[0]+(b[0]-a[0])*i/8,a[1]+(b[1]-a[1])*i/8)
                 for a,b in zip(points,points[1:]) for i in range(8)]+[points[-1]]
        for z,y in samples:
            hit,p,_,_=shell.ray_cast(Vector((sign*w,-l*z,g+h*y)),Vector((-sign,0,0)))
            if not hit:raise ValueError("Door detail misses lower body")
            result.append((p.x+sign*lift,p.z,-p.y))
        return result
    def lamp_patch(name,quad,mat):
        a,b,c,d=(Vector((x,g+h,z)) for x,z in quad)
        def rows(inset):
            return [[tuple(a.lerp(b,u).lerp(d.lerp(c,u),t))
                     for u in [inset+(1-2*inset)*j/8 for j in range(9)]]
                    for t in [inset+(1-2*inset)*i/5 for i in range(6)]]
        sedan_patch(name+" seal",shell,rows(0),m["trim"],body,(0,-1,0),.003)
        sedan_patch(name, shell,rows(.12),mat,body,(0,-1,0),.005)
    for sign in (-1,1):
        for points in [[(-.265,.56),(-.26,.45),(-.253,.29),(-.23,.19),(.018,.19),(.028,.57)],
                       [(.038,.58),(.033,.19),(.183,.19),(.226,.29),(.25,.46),(.281,.61)]]:
            line("Four-door shut line",flank(sign,points),.00125,m["trim"],body)
        for z in (-.018,.219):
            line("Flush door pull",flank(sign,[(z-.035,.56),(z+.020,.56)],.004),.004,m["darkmetal"],body)
        box("Dark rocker trim",(sign*w*.419,g+h*.16,0),(w*.039,h*.049,l*.43),m["trim"],body,.008)
        box("Mirror stem",(sign*w*.443,g+h*.675,-l*.225),(w*.043,h*.024,l*.041),m["trim"],body,.004)
        box("Swept mirror housing",(sign*w*.475,g+h*.701,-l*.228),(w*.05,h*.057,l*.059),mirror_paint,body,.012,5)
        box("Mirror reflective face",(sign*w*.476,g+h*.70,-l*.197),(w*.041,h*.036,.003),mirror_glass,body,.006)
        for axle in spec["axles"]:
            arch_lip("Slim wheel arch moulding",sign*w*.441,cy,axle,spec["wheelRadius"]+.017,.009,.020,m["trim"],body)
        lamp_patch("Swept front lamp",[(sign*w*.22,-l*.482),(sign*w*.357,-l*.462),
                   (sign*w*.39,-l*.43),(sign*w*.26,-l*.459)],m["white"])
        deck_crease(shell,[(sign*w*.19,-l*.445),(sign*w*.211,-l*.445),
                           (sign*w*.31,-l*.285),(sign*w*.301,-l*.285)],g+h,m["paint"],body)
    # Clean closed nose, modest lower intake and an unbranded tapered rear fascia.
    box("Low front air intake",(0,g+h*.237,-l*.496),(w*.54,h*.085,.014),m["trim"],body,.018,5)
    box("Front lower lip",(0,g+h*.154,-l*.481),(w*.72,h*.026,l*.030),m["trim"],body,.008)
    valance=[[(w*(.29+.04*i/8)*(-1+2*j/16),g+h*(.145+.14*i/8),l)
              for j in range(17)] for i in range(9)]
    sedan_patch("Rear lower valance",shell,valance,m["trim"],body,(0,0,-1))
    for sign in (-1,1):
        lamp_patch("Rear swept red lamp",[(sign*w*.15,l*.487),(sign*w*.35,l*.463),
                   (sign*w*.375,l*.443),(sign*w*.17,l*.465)],m["red"])
    box("Rear plate recess",(0,g+h*.39,l*.498),(w*.23,h*.062,.008),m["darkmetal"],body,.009)
    return root,body

def sports(spec):
    root,body,m,g,cy=base(spec,(.98,.38,.008),sporty=True)
    w,h,l=spec["size"]
    hull_stations=[
        (-l*.495,.86,g+h*.30,g+h*.33),(-l*.45,.98,g+h*.45,g+h*.40),
        (-l*.34,1,g+h*.69,g+h*.54),(-l*.245,.96,g+h*.62,g+h*.54),
        (-l*.08,.86,g+h*.50,g+h*.49),(l*.13,.90,g+h*.52,g+h*.50),
        (l*.30,1.0,g+h*.70,g+h*.61),(l*.405,.98,g+h*.65,g+h*.57),
        (l*.487,.88,g+h*.48,g+h*.47),(l*.499,.82,g+h*.40,g+h*.40)]
    shell=body_loft("Low nose flowing into muscular front and rear wings",hull_stations,
        g+h*.12,w,m["paint"],body,rounding=.15,broad_wings=True)
    arch_cut(shell,spec,.020)
    # A continuous teardrop cockpit replaces the box roof. The roof shoulder and
    # all three glazed aspects share this sampled doubly curved exterior skin.
    stations=[(-.265,.55,.365),(-.215,.67,.35),(-.12,.855,.312),
              (-.03,.955,.29),(.065,.968,.285),(.16,.90,.287),
              (.245,.795,.305),(.32,.69,.32),(.365,.605,.34)]
    sampled=curve_stations(stations,5)
    sections=[]
    for z,top,half in sampled:
        sections.append(round_section([(-w*.40,g+h*.46,l*z),(w*.40,g+h*.46,l*z),
            (w*.403,g+h*.515,l*z),(w*half,g+h*(top-.045),l*z),
            (w*half*.65,g+h*(top-.006),l*z),(0,g+h*top,l*z),
            (-w*half*.65,g+h*(top-.006),l*z),(-w*half,g+h*(top-.045),l*z),
            (-w*.403,g+h*.515,l*z)],.22,3))
    upper=loft("Teardrop double curvature cockpit",sections,m["paint"],body)
    def top_at(z):
        for (a,ya,_),(b,yb,_) in zip(sampled,sampled[1:]):
            if a<=z<=b:return ya+(yb-ya)*(z-a)/(b-a)
        raise ValueError("Cockpit station outside loft")
    belt_stations=curve_stations(hull_stations)
    def belt_at(z):
        # The glazing begins above the same shoulder profile used by the lower
        # shell. Raised wheel wings must never overlap its lower front/rear tips.
        for left,right in zip(belt_stations,belt_stations[1:]):
            if left[0]<=z*l<=right[0]:
                t=(z*l-left[0])/(right[0]-left[0])
                return (left[2]+(right[2]-left[2])*t-g)/h
        raise ValueError("Side window outside body stations")
    for sign in (-1,1):
        def side_rows(inset):
            rows=[]
            for i in range(17):
                t=inset+(1-2*inset)*i/16
                z=-.195+.442*t
                low=max(.556,belt_at(z)+.024)
                high=top_at(z)-.07
                rows.append([(sign*w,g+h*(low+(high-low)*(inset+(1-2*inset)*j/6)),l*z)
                             for j in range(7)])
            return rows
        sedan_patch("Swept side aperture seal",upper,side_rows(0),m["trim"],body,(-sign,0,0),.0015)
        sedan_patch("Curved side glass",upper,side_rows(.035),m["glass"],body,(-sign,0,0),.003)
    for name,z0,z1,a,b in [("Panoramic windscreen",-.239,-.068,.326,.243),
                           ("Recessed fastback glass",.116,.305,.234,.264)]:
        def rows(inset):
            result=[]
            for i in range(13):
                t=inset+(1-2*inset)*i/12
                half=a+(b-a)*t
                result.append([(w*half*(-1+2*(inset+(1-2*inset)*j/12)),g+h*1.2,l*(z0+(z1-z0)*t))
                               for j in range(13)])
            return result
        sedan_patch(name+" seal",upper,rows(0),m["trim"],body,(0,-1,0),.0015)
        sedan_patch(name,upper,rows(.035),m["glass"],body,(0,-1,0),.003)
    def flank(sign,zy,lift=.004):
        points=[]
        for z,y in zy:
            hit,p,_,_=shell.ray_cast(Vector((sign*w,-z*l,g+y*h)),Vector((-sign,0,0)))
            if not hit:raise ValueError(f"Sports flank detail misses shell at {z}, {y}")
            points.append((p.x+sign*lift,p.z,-p.y))
        return points
    for sign in (-1,1):
        # A deep-looking inlet over the concave waist leads air into the wide
        # rear haunch. The rim and centre are individually projected onto it.
        quad=[(.075,.25),(.23,.24),(.27,.49),(.17,.465)]
        rows=[]
        for i in range(9):
            t=i/8
            left=Vector(quad[0]).lerp(Vector(quad[3]),t)
            right=Vector(quad[1]).lerp(Vector(quad[2]),t)
            rows.append([tuple(left.lerp(right,j/8)) for j in range(9)])
        points=[p for row in rows for p in flank(sign,row,.006)]
        faces=[(i*9+j,i*9+j+1,(i+1)*9+j+1,(i+1)*9+j) for i in range(8) for j in range(8)]
        if sign<0:faces=[tuple(reversed(f)) for f in faces]
        curved_surface(mesh("Rear quarter air inlet",points,faces,m["trim"],body,recalculate=False))
        edge_points=[]
        for a,b in zip(quad,quad[1:]+quad[:1]):
            edge_points += [tuple(Vector(a).lerp(Vector(b),i/8)) for i in range(8)]
        line("Painted intake edge",flank(sign,edge_points+[quad[0]],.009),.003,m["paint"],body)
        sill=[]
        for z,x in [(-.24,.45),(-.17,.465),(.08,.44),(.23,.49)]:
            sill.append([(sign*w*(x-.035),g+h*.12,l*z),(sign*w*(x+.016),g+h*.09,l*z),
                         (sign*w*(x+.016),g+h*.127,l*z),(sign*w*(x-.035),g+h*.16,l*z)])
        loft("Swept carbon side sill",sill,m["trim"],body)
        door=[(-.205,.50),(-.18,.27),(-.15,.21),(.057,.21),(.10,.43)]
        detail=[]
        for a,b in zip(door,door[1:]):detail += [tuple(Vector(a).lerp(Vector(b),i/8)) for i in range(8)]
        line("Butterfly door lower seam",flank(sign,detail+[door[-1]]),.0017,m["trim"],body)
        line("Flush door pull",flank(sign,[(.04,.44),(.085,.44)],.008),.003,m["darkmetal"],body)
        line("Aerodynamic mirror stalk",[(sign*w*.355,g+h*.70,-l*.156),
              (sign*w*.476,g+h*.71,-l*.148)],.006,m["trim"],body)
        mirror=body_loft("Tapered mirror housing",[(-l*.171,.30,g+h*.718,g+h*.73),
              (-l*.151,1,g+h*.75,g+h*.76),(-l*.116,.70,g+h*.73,g+h*.743)],
              g+h*.697,w*.093,m["trim"],body)
        mirror.location.x=sign*w*.485
        deck_crease(shell,[(sign*w*.20,-l*.435),(sign*w*.235,-l*.427),
            (sign*w*.28,-l*.268),(sign*w*.26,-l*.268)],g+h,m["paint"],body)
        pts=on_deck(shell,[(sign*w*.23,-l*.479),(sign*w*.421,-l*.447),
            (sign*w*.435,-l*.418),(sign*w*.27,-l*.453)],g+h,.006)
        window("Swept blade headlamp",pts,m["white"],m["trim"],body,.58)
        # A diagonal brace frames the engine bay without covering its glazing.
        loft("Flying rear buttress",[[(sign*w*.273,g+h*.827,l*.214),
              (sign*w*.291,g+h*.829,l*.214),(sign*w*.302,g+h*.797,l*.214),
              (sign*w*.285,g+h*.79,l*.214)],
             [(sign*w*.359,g+h*.645,l*.404),(sign*w*.383,g+h*.649,l*.404),
              (sign*w*.381,g+h*.61,l*.404),(sign*w*.36,g+h*.607,l*.404)]],m["paint"],body)
        box("Thin rear light blade",(sign*w*.258,g+h*.375,l*.499),
            (w*.34,h*.025,.006),m["red"],body,.005)
        box("High exhaust outlet",(sign*w*.11,g+h*.318,l*.501),
            (w*.081,h*.073,.023),m["alloy"],body,.016,5)
        box("Exhaust dark bore",(sign*w*.11,g+h*.318,l*.514),
            (w*.060,h*.050,.003),m["trim"],body,.012,5)
    panel("Front central air intake",[(-w*.34,g+h*.145,-l*.501),(w*.34,g+h*.145,-l*.501),
        (w*.28,g+h*.267,-l*.503),(-w*.28,g+h*.267,-l*.503)],m["trim"],body)
    for sign in (-1,1):
        panel("Front outboard air intake",[(sign*w*.35,g+h*.145,-l*.494),
             (sign*w*.424,g+h*.17,-l*.484),(sign*w*.441,g+h*.316,-l*.474),
             (sign*w*.345,g+h*.267,-l*.494)],m["trim"],body)
    body_loft("Contoured front splitter",[(-l*.517,.74,g+h*.10,g+h*.115),
        (-l*.495,.99,g+h*.10,g+h*.115),(-l*.449,.98,g+h*.10,g+h*.115)],
        g+h*.075,w,m["trim"],body,rounding=.12)
    box("Rear diffuser",(0,g+h*.15,l*.48),(w*.82,h*.09,l*.064),m["trim"],body,.009)
    for x in (-.31,-.16,0,.16,.31):
        panel("Diffuser vertical vane",[(w*x,g+h*.075,l*.441),(w*x,g+h*.20,l*.461),
             (w*x,g+h*.18,l*.515),(w*x,g+h*.07,l*.515)],m["darkmetal"],body,outward=(1,0,0))
    box("Rear vent dark aperture",(0,g+h*.292,l*.498),(w*.66,h*.15,.007),m["trim"],body,.010)
    for sign in (-1,1):
        box("Swan neck wing support",(sign*w*.30,g+h*.67,l*.43),
            (.012,h*.21,l*.022),m["darkmetal"],body,.003)
    body_loft("Sculpted rear aerofoil",[(l*.389,.86,g+h*.773,g+h*.79),
        (l*.428,.97,g+h*.797,g+h*.819),(l*.48,.96,g+h*.80,g+h*.808)],
        g+h*.765,w,m["trim"],body,rounding=.18)
    return root,body


def jeep(spec):
    root,body,m,g,cy=base(spec,(.11,.225,.12),offroad=True)
    w,h,l=spec["size"]
    shell=body_loft("Short utility tub and raised bonnet",[
         (-l*.45,.78,g+h*.62,g+h*.64),(-l*.38,.83,g+h*.65,g+h*.665),
         (-l*.14,.85,g+h*.655,g+h*.665),(l*.40,.87,g+h*.60,g+h*.61)],
          g+h*.245,w,m["paint"],body,curved=True,rounding=.14)
    arch_cut(shell,spec,.033)
    # The raised bonnet meets a painted cowl below the real windscreen opening.
    # Its lower glazing must begin above the bonnet, not inside that solid.
    cabin(body,m,-l*.14,-l*.075,l*.36,l*.405,g+h*.61,g+h*.965,w*.414,w*.387,.006,
          front_window_bottom=.23,side_window_front_bottom=.20)
    crown_roof("Crowned removable hardtop",[(-l*.091,.95,.45),(-l*.06,1,1),
        (l*.345,1,1),(l*.387,.95,.45)],w*.85,g+h*.958,h*.045,m["trim"],body)
    # Five smaller auxiliary lamps retain the compact utility-car proportions.
    lamp_radius=w*.052
    roof_light_bar(body,[(w*(i-2)*.14,g+h*1.04+lamp_radius,-l*.095)
                        for i in range(5)],lamp_radius,g+h*.975,w*.33,m)
    for sign in (-1,1):
        box("Hardtop rain gutter",(sign*w*.424,g+h*.957,l*.148),
            (.012,.012,l*.475),m["trim"],body,.004)
    for obj in list(body.children):
        if obj.name.startswith("Side glazing"):
            bpy.data.objects.remove(obj,do_unlink=True)
    for sign in (-1,1):
        corners=[(sign*w*.414,g+h*.61,-l*.14),(sign*w*.414,g+h*.61,l*.405),
                 (sign*w*.387,g+h*.965,l*.36),(sign*w*.387,g+h*.965,-l*.075)]
        window("Front utility door window",inset_face(corners,u1=.52,v0=.20),
               m["glass"],m["trim"],body,.94)
    # The rear hardtop side is black around its fixed quarter glass.
    for sign in (-1,1):
        side=[(sign*w*.421,g+h*.638,l*.155),(sign*w*.421,g+h*.638,l*.384),
              (sign*w*.395,g+h*.945,l*.346),(sign*w*.395,g+h*.945,l*.155)]
        if sign<0:side.reverse()
        window("Hardtop quarter window",side,m["glass"],m["trim"],body,.79)
        line("Door B pillar",[(sign*w*.418,g+h*.63,l*.145),
              (sign*w*.394,g+h*.95,l*.14)],w*.013,m["paint"],body)
        x=sign*w*.432
        line("Utility door seam",[(x,g+h*.62,-l*.13),(x,g+h*.28,-l*.10),
              (x,g+h*.28,l*.135),(x,g+h*.62,l*.15)],.0023,m["trim"],body)
        for y in (.35,.55):
            box("Exposed door hinge",(x,g+h*y,-l*.105),(.017,h*.043,l*.023),m["paint"],body,.003)
        box("Door pull",(x+sign*.006,g+h*.55,l*.09),(.019,h*.028,l*.063),m["trim"],body,.004)
        box("Mirror arm",(sign*w*.451,g+h*.70,-l*.12),(w*.06,h*.07,.025),m["trim"],body,.003)
        box("Upright mirror",(sign*w*.497,g+h*.755,-l*.12),(w*.10,h*.118,l*.057),m["trim"],body,.010)
        box("Mirror glass",(sign*w*.497,g+h*.755,-l*.088),(w*.074,h*.089,.003),m["glass"],body,.004)
        box("Running board",(sign*w*.448,g+h*.25,.025),(w*.12,h*.041,l*.29),m["trim"],body,.009)
        for axle in spec["axles"]:
            arch_lip("Broad black wing",sign*w*.439,cy,axle,spec["wheelRadius"]+.034,
                     .044,w*.19,m["trim"],body)
        box("Side marker",(sign*w*.423,g+h*.594,-l*.32),(.005,h*.022,l*.047),m["amber"],body,.002)
        box("Rear tail lamp",(sign*w*.342,g+h*.49,l*.408),(w*.10,h*.115,.022),m["red"],body,.009)
    front=-l*.454
    # A broad horizontal aperture and square lamps: intentionally no branded
    # seven-slot grille or other manufacturer's signature front fascia.
    box("Horizontal grille surround",(0,g+h*.54,front),(w*.775,h*.187,.027),m["trim"],body,.015)
    box("Central grille recess",(0,g+h*.54,front-.016),(w*.43,h*.136,.006),m["rubber"],body,.012)
    for i in range(4):
        box("Horizontal grille bar",(0,g+h*(.49+i*.032),front-.022),(w*.405,.005,.008),m["darkmetal"],body)
    for sign in (-1,1):
        x=sign*w*.298
        headlight(body,m,[(x-w*.068,g+h*.485,front-.020),(x+w*.068,g+h*.485,front-.020),
             (x+w*.068,g+h*.595,front-.020),(x-w*.068,g+h*.595,front-.020)])
        box("Headlamp centre",(x,g+h*.54,front-.024),(w*.069,h*.060,.006),m["darkmetal"],body,.007)
        box("Amber fog lamp",(sign*w*.338,g+h*.332,-l*.478),(w*.063,h*.039,.006),m["amber"],body,.003)
    box("Front factory bumper",(0,g+h*.337,-l*.469),(w*1.03,h*.128,l*.09),m["trim"],body,.022)
    # Lamps mount ahead of the bumper, never hidden inside its bevelled volume.
    for sign in (-1,1):
        box("Bumper fog lamp bezel",(sign*w*.345,g+h*.34,-l*.517),(w*.097,h*.063,.013),m["darkmetal"],body,.006)
        box("Bumper fog lamp",(sign*w*.345,g+h*.34,-l*.525),(w*.063,h*.036,.003),m["amber"],body,.002)
    box("Rear factory bumper",(0,g+h*.285,l*.429),(w*.96,h*.094,l*.057),m["trim"],body,.013)
    panel("Clean skid plate",[(-w*.28,g+h*.285,-l*.44),(w*.28,g+h*.285,-l*.44),
          (w*.24,g+h*.18,-l*.37),(-w*.24,g+h*.18,-l*.37)],m["darkmetal"],body)
    spare=empty("Static spare carrier",body,(0,g+h*.59,l*.463))
    wheel(spare,spec["wheelRadius"],spec["wheelWidth"],m,offroad=True,axis="z")
    box("Spare mounting bracket",(0,g+h*.53,l*.431),(w*.15,h*.18,l*.06),m["trim"],body,.008)
    for sign in (-1,1):
        line("Front wiper",inset_face([(-w*.414,g+h*.61,-l*.14),(w*.414,g+h*.61,-l*.14),
              (w*.387,g+h*.965,-l*.075),(-w*.387,g+h*.965,-l*.075)],
              uv=[(.5+sign*.08,.25),(.5+sign*.39,.265)],lift=.008),.003,m["trim"],body)
        line("Hood pressed ridge",[(sign*w*.26,g+h*.666,-l*.36),
              (sign*w*.25,g+h*.671,-l*.16)],.003,m["paint"],body)
    return root,body


def render_sedan_reference(spec,path):
    """Render the delivered GLB itself, so the menu cannot show a different car."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/"game/public/models/cars/micro-hatch.glb"))
    scene=bpy.context.scene
    scene.render.engine="CYCLES"
    scene.cycles.device="CPU"
    scene.cycles.samples=64
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1280
    scene.render.resolution_y=853
    scene.render.resolution_percentage=100
    scene.world.color=(.3,.3,.3)
    scene.view_settings.view_transform="AgX"
    ground=spec["anchorY"]-spec["suspensionRest"]
    box("Reference studio floor",(0,ground-.011,0),(200,.020,200),
        material("Reference studio grey",(.40,.43,.46),roughness=.85),None)
    target=Vector(xyz((0,ground+spec["size"][1]*.46,0)))
    for name,location,power,size in [("Key",(-3,4,6),700,5),("Fill",(4,1,4),450,4),
                                     ("Rim",(-1,-4,5),800,3)]:
        data=bpy.data.lights.new(name,"AREA")
        data.energy=power
        data.shape="DISK"
        data.size=size
        obj=bpy.data.objects.new(name,data)
        bpy.context.collection.objects.link(obj)
        obj.location=location
        obj.rotation_euler=(target-obj.location).to_track_quat("-Z","Y").to_euler()
    data=bpy.data.cameras.new("Reference camera")
    cam=bpy.data.objects.new("Reference camera",data)
    bpy.context.collection.objects.link(cam)
    scene.camera=cam
    cam.location=target+Vector(xyz((2.4,1.15,-3.3)))*detail_scale(spec)
    cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler()
    data.lens=52
    path.parent.mkdir(parents=True,exist_ok=True)
    scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)


BUILDERS={"micro-hatch":micro,"sports-car":sports,"jeep":jeep}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--ids",default=",".join(BUILDERS))
    parser.add_argument("--render-dir",type=Path)
    parser.add_argument("--sedan-reference",type=Path,help="Render the exported Sedan GLB for the menu")
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    specs={spec["id"]:spec for spec in CATALOGUE["vehicles"]}
    for vehicle_id in args.ids.split(","):
        spec=specs[vehicle_id]
        authored=modelling_spec(spec)
        root,body=BUILDERS[vehicle_id](authored)
        prepare_glazing(body,authored)
        consolidate(body,"Body geometry")
        # Discard only empty modelling groups; the static spare geometry has
        # already been baked into the body, while wheel pivots remain separate.
        for child in list(body.children):
            if child.type=="EMPTY":bpy.data.objects.remove(child,do_unlink=True)
        export(root,ROOT/f"game/public/models/cars/{vehicle_id}.glb",authored["detailScale"])
        if args.render_dir:render_views(root,spec,ROOT/args.render_dir)
        if vehicle_id=="micro-hatch" and args.sedan_reference:
            render_sedan_reference(spec,ROOT/args.sedan_reference)


if __name__=="__main__":
    main()
