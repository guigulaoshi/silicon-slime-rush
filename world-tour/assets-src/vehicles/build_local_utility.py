"""Build the off-road and utility local cars with Blender 5.x, no downloads.

From the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \
      assets-src/vehicles/build_local_utility.py -- --render-dir tmp/local-utility
Omit --render-dir for export only. --ids accepts a comma-separated subset.

Four World Tour local cars, each standing in one garage slot on its own track only:
a plateau 4x4 (Lhasa), a long-wheelbase safari wagon with its pop-top raised (Amboseli),
a kei flat-bed truck (Fuji) and a car-based ute (Sydney). No brands, badges or text.
Dimensions, running gear and cabin furnishing all come from catalogue.json.
"""

import argparse
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import (ROOT,CATALOGUE,modelling_spec,arch_cut,arch_cover,arch_lip,body_loft,box,consolidate,
                    prepare_glazing,crown_roof,empty,export,line,material,radial,render_views,wheel,window)
from build_compact_cars import base,cabin,headlight,inset_face,sedan_patch
from build_large_cars import steel_hubs


def drop_panes(body,prefixes):
    """Remove cabin()'s generic panes so the real apertures can be authored instead."""
    for obj in list(body.children):
        if obj.name.startswith(prefixes):
            bpy.data.objects.remove(obj,do_unlink=True)


def cut_box(obj,center,size,mat):
    """Boolean a box out of one closed solid (a tub, an open roof)."""
    cutter=box("Temporary cutter",center,size,mat,None)
    bpy.context.view_layer.objects.active=obj
    mod=obj.modifiers.new("Open cavity","BOOLEAN")
    mod.operation="DIFFERENCE"
    mod.solver="EXACT"
    mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)


def side_panes(body,m,cabin_box,spans,v0,v1=.93,name="Side window"):
    """Separate door/quarter panes on both flanks of a cabin() box; pillars stay opaque."""
    fb,ft,rt,rb,by,ry,bw,rw=cabin_box
    for sign in (-1,1):
        corners=[(sign*bw,by,fb),(sign*bw,by,rb),(sign*rw,ry,rt),(sign*rw,ry,ft)]
        for u0,u1 in spans:
            window(name,inset_face(corners,u0=u0,u1=u1,v0=v0,v1=v1),m["glass"],m["trim"],body,.94)


def mirrors(body,m,x,y,z,size,housing):
    w,h,l=size
    for sign in (-1,1):
        box("Mirror stem",(sign*(x+w*.02),y-h*.02,z),(w*.05,h*.03,l*.012),m["trim"],body,.003)
        box("Mirror housing",(sign*(x+w*.07),y,z),(w*.07,h*.075,l*.02),housing,body,.008)
        box("Mirror glass",(sign*(x+w*.07),y,z+l*.0105),(w*.055,h*.058,.003),m["glass"],body,.004)


def round_lamp(body,name,x,y,z,radius,lens,bezel):
    points=[(x+math.cos(t)*radius,y+math.sin(t)*radius,z) for t in [math.tau*i/32 for i in range(32)]]
    window(name,points,lens,bezel,body,.84)


def spare_cover(parent,radius,width,cover,rim):
    """A hard spare-wheel cover on the rear door: the tyre inside is never seen."""
    a0,a1=-width/2-.004,width/2+.004
    radial("Spare wheel hard cover",[(a0,0),(a0,radius*1.01),(a1-.01,radius*1.01),
           (a1,radius*.94),(a1+.006,radius*.6),(a1+.008,0)],cover,parent,48,"z")
    radial("Spare cover dark rim band",[(a1-.03,radius*1.012),(a1-.02,radius*1.012),
           (a1-.02,radius*1.025),(a1-.03,radius*1.025)],rim,parent,48,"z")


def wipers(body,m,box_,v):
    fb,ft,rt,rb,by,ry,bw,rw=box_
    for sign in (-1,1):
        line("Front wiper",inset_face([(-bw,by,fb),(bw,by,fb),(rw,ry,ft),(-rw,ry,ft)],
             uv=[(.5+sign*.06,v),(.5+sign*.40,v+.01)],lift=.008),.003,m["trim"],body)


# ---------------------------------------------------------------- Lhasa plateau SUV

def plateau_suv(spec):
    paint=(.78,.79,.78)
    root,body,m,g,cy=base(spec,paint,offroad=True)
    w,h,l=spec["size"]
    r=spec["wheelRadius"]
    shell=body_loft("Upright body-on-frame lower body",[
        (-l*.50,.88,g+h*.555,g+h*.575),(-l*.484,.955,g+h*.585,g+h*.60),
        (-l*.42,.975,g+h*.60,g+h*.615),(-l*.19,.98,g+h*.612,g+h*.625),
        (l*.30,.98,g+h*.62,g+h*.628),(l*.465,.965,g+h*.61,g+h*.62),
        (l*.499,.91,g+h*.585,g+h*.60)],g+h*.17,w,m["paint"],body,rounding=.12)
    arch_cut(shell,spec,.03)
    arch_cover(spec,.03,m["trim"],body,name="Dark wheel well liner")
    # Tall glasshouse on a high belt, near-vertical tailgate: the silhouette of a plateau 4x4.
    box_=(-l*.19,-l*.045,l*.452,l*.474,g+h*.60,g+h*.955,w*.468,w*.418)
    fb,ft,rt,rb,by,ry,bw,rw=box_
    cabin(body,m,fb,ft,rt,rb,by,ry,bw,rw,.012,rear_window_bottom=.16,front_window_bottom=.10)
    drop_panes(body,("Side glazing",))
    side_panes(body,m,box_,((.035,.335),(.36,.625),(.65,.905)),.12)
    crown_roof("Pressed steel roof",[(-l*.052,.95,.35),(-l*.03,1,1),(l*.43,1,1),(l*.448,.95,.35)],
               w*.83,ry-.003,h*.018,m["paint"],body)
    for sign in (-1,1):
        x=sign*w*.36
        line("Roof rail",[(x,ry+h*.012,-l*.01),(x,ry+h*.036,l*.02),(x,ry+h*.036,l*.40),
             (x,ry+h*.012,l*.43)],.011,m["alloy"],body)
        for z in (-l*.005,l*.425):
            box("Roof rail foot",(x,ry+h*.012,z),(w*.03,h*.02,l*.025),m["trim"],body,.004)
        # Doors: front, then a rear door that steps around the rear wheel arch.
        xs=sign*w*.483
        line("Front door shut line",[(xs,g+h*.60,-l*.182),(xs,g+h*.25,-l*.17),(xs,g+h*.25,l*.035),
             (xs,g+h*.60,l*.038)],.0022,m["trim"],body)
        line("Rear door shut line",[(xs,g+h*.60,l*.045),(xs,g+h*.25,l*.043),(xs,g+h*.25,l*.13),
             (xs,g+h*.43,l*.155),(xs,g+h*.60,l*.21)],.0022,m["trim"],body)
        for z in (-l*.03,l*.17):
            box("Door pull",(sign*w*.487,g+h*.555,z),(.016,h*.022,l*.04),m["alloy"],body,.004)
        box("Side step",(sign*w*.47,g+h*.205,-l*.03),(w*.11,h*.03,l*.34),m["trim"],body,.008)
        box("Lower body cladding",(sign*w*.487,g+h*.26,0),(.012,h*.06,l*.32),m["trim"],body,.004)
        for axle in spec["axles"]:
            arch_lip("Moulded arch flare",sign*w*.478,cy,axle,r+.032,.022,w*.075,m["trim"],body)
        box("Side indicator",(sign*w*.487,g+h*.575,-l*.33),(.004,h*.018,l*.03),m["amber"],body,.002)
        # Tall vertical tail lamps wrap the rear corners.
        box("Vertical tail lamp",(sign*w*.43,g+h*.56,l*.497),(w*.07,h*.16,.02),m["red"],body,.008)
        box("Tail lamp side return",(sign*w*.452,g+h*.56,l*.485),(.012,h*.15,l*.025),m["red"],body,.004)
    mirrors(body,m,w*.47,g+h*.665,-l*.155,(w,h,l),m["paint"])
    # Front: upright face, broad bright grille with horizontal bars, square lamps either side.
    front=-l*.5
    box("Bright grille surround",(0,g+h*.49,front),(w*.46,h*.135,.03),m["alloy"],body,.012)
    box("Grille recess",(0,g+h*.49,front-.014),(w*.42,h*.105,.006),m["rubber"],body,.008)
    for i in range(4):
        box("Horizontal grille bar",(0,g+h*(.455+i*.024),front-.02),(w*.41,.006,.008),m["alloy"],body)
    for sign in (-1,1):
        x=sign*w*.335
        headlight(body,m,[(x-w*.07,g+h*.462,front-.004),(x+w*.07,g+h*.462,front-.004),
                  (x+w*.07,g+h*.538,front-.004),(x-w*.07,g+h*.538,front-.004)])
        box("Front corner indicator",(sign*w*.43,g+h*.50,front+.004),(w*.03,h*.06,.01),m["amber"],body,.003)
        box("Bumper fog lamp",(sign*w*.35,g+h*.30,front-l*.014),(w*.06,h*.025,.004),m["white"],body,.002)
    box("Front bumper",(0,g+h*.33,-l*.488),(w*.99,h*.15,l*.05),m["trim"],body,.02)
    box("Bright skid plate",(0,g+h*.22,-l*.47),(w*.5,h*.05,l*.05),m["alloy"],body,.01)
    for sign in (-1,1):
        line("Bonnet pressed ridge",[(sign*w*.22,g+h*.584,-l*.46),(sign*w*.24,g+h*.63,-l*.22)],
             .003,m["paint"],body)
    wipers(body,m,box_,.14)
    # Rear: side-hinged door carrying the spare in a hard body-colour cover.
    box("Rear bumper",(0,g+h*.29,l*.49),(w*.97,h*.10,l*.045),m["trim"],body,.014)
    line("Rear door shut line",[(w*.40,g+h*.30,l*.5),(w*.40,g+h*.60,l*.5),(w*.39,g+h*.93,l*.475)],
         .0022,m["trim"],body)
    box("Plate recess",(0,g+h*.37,l*.5),(w*.24,h*.06,.006),m["darkmetal"],body,.006)
    cover=material("Spare cover body colour",paint,.22,.31)
    spare=empty("Static spare carrier",body,(0,g+h*.505,l*.5+spec["wheelWidth"]*.5+.012))
    spare_cover(spare,r*.97,spec["wheelWidth"],cover,m["trim"])
    box("Spare carrier bracket",(0,g+h*.505,l*.5+.006),(w*.16,h*.12,.02),m["trim"],body,.006)
    return root,body


# ---------------------------------------------------------------- Amboseli safari wagon

def safari(spec):
    root,body,m,g,cy=base(spec,(.50,.39,.20),offroad=True)
    w,h,l=spec["size"]
    r=spec["wheelRadius"]
    canvas=material("Olive safari canvas",(.035,.042,.018),0,.92)
    shell=body_loft("Long wheelbase utility body",[
        (-l*.50,.90,g+h*.435,g+h*.45),(-l*.488,.955,g+h*.458,g+h*.466),
        (-l*.30,.965,g+h*.465,g+h*.47),(-l*.265,.985,g+h*.468,g+h*.472),
        (l*.46,.99,g+h*.468,g+h*.472),(l*.498,.96,g+h*.455,g+h*.462)],g+h*.15,w,m["paint"],body,rounding=.09)
    arch_cut(shell,spec,.03)
    arch_cover(spec,.03,m["paint"],body)
    box_=(-l*.272,-l*.238,l*.487,l*.493,g+h*.458,g+h*.81,w*.487,w*.47)
    fb,ft,rt,rb,by,ry,bw,rw=box_
    shell_top=cabin(body,m,fb,ft,rt,rb,by,ry,bw,rw,.008,front_window_bottom=.09)
    # The pop-top: the roof behind the driver is opened right through, leaving a rim.
    cut_box(shell_top,(0,g+h*.70,l*.182),(w*.86,h*.62,l*.586),m["trim"])
    drop_panes(body,("Side glazing","Rear glass"))
    side_panes(body,m,box_,((.02,.17),(.205,.425),(.455,.675),(.705,.95)),.10,.90)
    for u0,u1 in ((.06,.47),(.53,.94)):
        window("Barn door window",inset_face([(bw,by,rb),(-bw,by,rb),(-rw,ry,rt),(rw,ry,rt)],
               u0=u0,u1=u1,v0=.14,v1=.90),m["glass"],m["trim"],body,.94)
    # Raised canvas roof on corner and mid posts; the sides under it stay open for viewing.
    top=g+h*.953
    crown_roof("Raised canvas pop-top roof",[(-l*.135,.96,.5),(-l*.118,1,1),(l*.472,1,1),(l*.49,.96,.5)],
               w*.97,top,h*.03,canvas,body)
    box("Pop-top roof frame",(0,top-h*.008,l*.177),(w*.975,h*.016,l*.622),m["darkmetal"],body,.004)
    for sign in (-1,1):
        for z in (-.11,.10,.29,.465):
            box("Pop-top lifting post",(sign*w*.448,(ry+top)/2,l*z),(w*.02,top-ry+h*.01,w*.02),
                m["darkmetal"],body,.003)
        line("Pop-top gas strut",[(sign*w*.44,ry+h*.005,l*.02),(sign*w*.44,top-h*.012,l*.19)],.006,
             m["alloy"],body)
        box("Roof gutter rim",(sign*w*.475,ry+h*.004,l*.10),(w*.03,h*.012,l*.76),m["trim"],body,.003)
        xs=sign*w*.497
        line("Front door shut line",[(xs,g+h*.46,-l*.262),(xs,g+h*.20,-l*.245),(xs,g+h*.20,-l*.115),
             (xs,g+h*.46,-l*.113)],.0022,m["trim"],body)
        line("Rear side door shut line",[(xs,g+h*.46,-l*.105),(xs,g+h*.20,-l*.105),(xs,g+h*.20,l*.062),
             (xs,g+h*.46,l*.062)],.0022,m["trim"],body)
        for z in (-l*.13,l*.04):
            box("Door handle",(sign*w*.498,g+h*.43,z),(.015,h*.016,l*.035),m["darkmetal"],body,.003)
        box("Side step",(sign*w*.47,g+h*.17,-l*.18),(w*.10,h*.025,l*.12),m["darkmetal"],body,.005)
        for axle in spec["axles"]:
            arch_lip("Black fender flare",sign*w*.49,cy,axle,r+.033,.03,w*.07,m["trim"],body)
        box("Tail lamp",(sign*w*.43,g+h*.29,l*.498),(w*.06,h*.10,.018),m["red"],body,.006)
        box("Rear indicator",(sign*w*.43,g+h*.225,l*.498),(w*.06,h*.03,.018),m["amber"],body,.004)
    mirrors(body,m,w*.49,g+h*.55,-l*.24,(w,h,l),m["trim"])
    # Front: flat upright grille between round lamps, black bumper, tubular bull bar, snorkel.
    front=-l*.5
    box("Upright grille panel",(0,g+h*.365,front),(w*.44,h*.12,.02),m["trim"],body,.008)
    for i in range(5):
        box("Grille slat",(0,g+h*(.318+i*.024),front-.012),(w*.40,.006,.008),m["darkmetal"],body)
    for sign in (-1,1):
        round_lamp(body,"Round headlamp",sign*w*.33,g+h*.37,front-.006,w*.062,m["white"],m["alloy"])
        box("Headlamp square surround",(sign*w*.33,g+h*.37,front+.002),(w*.16,h*.095,.012),m["trim"],body,.006)
        box("Front indicator",(sign*w*.43,g+h*.31,front-.004),(w*.05,h*.025,.008),m["amber"],body,.003)
    box("Front steel bumper",(0,g+h*.25,-l*.493),(w*1.0,h*.08,l*.04),m["darkmetal"],body,.012)
    bar_z=-l*.528
    for sign in (-1,1):
        line("Bull bar upright",[(sign*w*.20,g+h*.21,-l*.51),(sign*w*.20,g+h*.21,bar_z),
             (sign*w*.20,g+h*.44,bar_z),(0,g+h*.46,bar_z)],.022,m["darkmetal"],body)
        line("Bull bar wing",[(sign*w*.20,g+h*.33,bar_z),(sign*w*.44,g+h*.33,-l*.515),
             (sign*w*.47,g+h*.29,-l*.505)],.018,m["darkmetal"],body)
    xs=w*.505
    line("Raised air intake snorkel",[(w*.46,g+h*.45,-l*.36),(xs,g+h*.47,-l*.34),(xs,g+h*.77,-l*.262),
         (xs,g+h*.845,-l*.258)],.03,m["trim"],body)
    box("Snorkel ram head",(xs,g+h*.855,-l*.265),(w*.06,h*.04,l*.03),m["trim"],body,.01)
    wipers(body,m,box_,.12)
    # Rear: split barn doors, spare wheel on the right-hand door, step bumper.
    box("Rear step bumper",(0,g+h*.20,l*.492),(w*.98,h*.06,l*.035),m["darkmetal"],body,.01)
    line("Barn door split",[(0,g+h*.18,l*.4995),(0,g+h*.46,l*.4995)],.0024,m["trim"],body)
    for sign in (-1,1):
        for y in (.24,.40):
            box("Barn door hinge",(sign*w*.46,g+h*y,l*.5),(w*.03,h*.02,.012),m["darkmetal"],body,.003)
    spare=empty("Static spare carrier",body,(w*.23,g+h*.37,l*.5+spec["wheelWidth"]*.5+.012))
    wheel(spare,r,spec["wheelWidth"],m,offroad=True,axis="z")
    box("Spare carrier bracket",(w*.23,g+h*.37,l*.5+.006),(w*.12,h*.06,.02),m["darkmetal"],body,.004)
    return root,body


# ---------------------------------------------------------------- Fuji kei flat-bed truck

def kei_truck(spec):
    root,body,m,g,cy=base(spec,(.80,.81,.80))
    steel_hubs(root,spec,m)
    w,h,l=spec["size"]
    r=spec["wheelRadius"]
    front_axle,rear_axle=spec["axles"]
    cab_rear=-l*.205
    shell=body_loft("Cab-over lower cab",[
        (-l*.50,.93,g+h*.50,g+h*.51),(-l*.488,.975,g+h*.518,g+h*.528),
        (-l*.44,.99,g+h*.528,g+h*.535),(cab_rear,.99,g+h*.528,g+h*.535)],
        g+h*.15,w,m["paint"],body,rounding=.10)
    arch_cut(shell,spec,.03)
    for sign in (-1,1):
        arch_lip("Front wheel arch cover",sign*spec["track"]/2,cy,front_axle,r+.03,.012,
                 spec["wheelWidth"]+.06,m["paint"],body)
        # Rear wheels sit under the flat bed behind black rubber mudguards.
        arch_lip("Rear rubber mudguard",sign*spec["track"]/2,cy,rear_axle,r+.035,.01,
                 spec["wheelWidth"]+.07,m["trim"],body)
    box_=(-l*.478,-l*.425,-l*.216,cab_rear,g+h*.525,g+h*.962,w*.49,w*.458)
    fb,ft,rt,rb,by,ry,bw,rw=box_
    cabin(body,m,fb,ft,rt,rb,by,ry,bw,rw,.014,rear_window_bottom=.34,front_window_bottom=.07)
    drop_panes(body,("Side glazing",))
    side_panes(body,m,box_,((.10,.93),),.07,.94,"Door window")
    crown_roof("Cab roof",[(-l*.43,.95,.4),(-l*.415,1,1),(-l*.228,1,1),(-l*.218,.95,.4)],
               w*.90,ry-.003,h*.016,m["paint"],body)
    # Flat bed: steel floor above the rear axle, three fold-down gates and a head guard.
    bed_front,bed_rear=-l*.196,l*.497
    floor=g+h*.37
    mid=(bed_front+bed_rear)/2
    length=bed_rear-bed_front
    box("Flat steel bed floor",(0,floor-h*.015,mid),(w*.975,h*.03,length),m["paint"],body,.004)
    for i in range(7):
        box("Bed floor rib",(0,floor+.002,bed_front+length*(i+1)/8),(w*.93,.006,.012),m["paint"],body)
    gate_h=h*.17
    for sign in (-1,1):
        box("Drop side gate",(sign*w*.482,floor+gate_h/2,mid),(w*.03,gate_h,length),m["paint"],body,.004)
        for y in (.35,.65):
            line("Gate pressed rib",[(sign*w*.498,floor+gate_h*y,bed_front+.02),
                 (sign*w*.498,floor+gate_h*y,bed_rear-.02)],.004,m["paint"],body)
        for z in (bed_front+length*.33,bed_front+length*.66):
            box("Gate latch",(sign*w*.499,floor+gate_h*.8,z),(.01,h*.02,l*.02),m["darkmetal"],body,.002)
            box("Gate hinge",(sign*w*.499,floor+h*.01,z),(.01,h*.015,l*.03),m["darkmetal"],body,.002)
        box("Bed side rail",(sign*w*.40,floor-h*.05,mid),(w*.05,h*.05,length*.98),m["darkmetal"],body,.004)
        box("Chassis frame rail",(sign*w*.30,g+h*.27,(front_axle+bed_rear)/2),(w*.06,h*.07,bed_rear-front_axle),
            m["darkmetal"],body,.005)
        box("Rear lamp cluster",(sign*w*.38,g+h*.28,bed_rear-.012),(w*.10,h*.06,.02),m["red"],body,.004)
        box("Rear lamp indicator",(sign*w*.28,g+h*.28,bed_rear-.012),(w*.05,h*.06,.02),m["amber"],body,.004)
    box("Tail gate",(0,floor+gate_h/2,bed_rear-w*.015),(w*.99,gate_h,w*.03),m["paint"],body,.004)
    for y in (.35,.65):
        line("Tail gate rib",[(-w*.47,floor+gate_h*y,bed_rear+.001),(w*.47,floor+gate_h*y,bed_rear+.001)],
             .004,m["paint"],body)
    box("Rear cross member",(0,g+h*.28,bed_rear-.03),(w*.84,h*.07,.04),m["darkmetal"],body,.004)
    box("Plate recess",(0,g+h*.28,bed_rear-.006),(w*.16,h*.06,.006),m["trim"],body,.004)
    box("Head board",(0,floor+h*.10,bed_front),(w*.975,h*.20,.02),m["paint"],body,.004)
    # The bent-tube gate guard above the head board, up to cab-roof height.
    gz=bed_front+.012
    for sign in (-1,1):
        line("Head guard post",[(sign*w*.46,floor+h*.19,gz),(sign*w*.46,ry+h*.005,gz),
             (sign*w*.40,ry+h*.03,gz)],.012,m["darkmetal"],body)
    line("Head guard top rail",[(-w*.40,ry+h*.03,gz),(w*.40,ry+h*.03,gz)],.012,m["darkmetal"],body)
    for x in (-.24,-.08,.08,.24):
        line("Head guard bar",[(w*x,floor+h*.19,gz),(w*x,ry+h*.03,gz)],.007,m["darkmetal"],body)
    # Cab details.
    for sign in (-1,1):
        xs=sign*w*.498
        line("Cab door shut line",[(xs,g+h*.53,-l*.458),(xs,g+h*.355,-l*.458),(xs,g+h*.355,-l*.215),
             (xs,g+h*.53,-l*.215)],.002,m["trim"],body)
        box("Door handle",(sign*w*.499,g+h*.49,-l*.24),(.012,h*.014,l*.03),m["darkmetal"],body,.003)
        box("Cab step",(sign*w*.47,g+h*.24,-l*.215),(w*.08,h*.02,l*.05),m["darkmetal"],body,.003)
    mirrors(body,m,w*.49,g+h*.60,-l*.465,(w,h,l),m["trim"])
    front=-l*.5
    for sign in (-1,1):
        x=sign*w*.335
        headlight(body,m,[(x-w*.075,g+h*.33,front-.004),(x+w*.075,g+h*.33,front-.004),
                  (x+w*.075,g+h*.41,front-.004),(x-w*.075,g+h*.41,front-.004)])
        box("Front indicator",(sign*w*.44,g+h*.37,front-.002),(w*.035,h*.06,.008),m["amber"],body,.003)
    box("Front grille slot",(0,g+h*.37,front-.002),(w*.40,h*.05,.008),m["trim"],body,.005)
    box("Front bumper",(0,g+h*.22,-l*.494),(w*.98,h*.07,l*.03),m["darkmetal"],body,.01)
    box("Lower front apron",(0,g+h*.46,front+.001),(w*.86,h*.012,.006),m["trim"],body,.002)
    wipers(body,m,box_,.10)
    return root,body


# ---------------------------------------------------------------- Sydney car-based ute

def ute(spec):
    root,body,m,g,cy=base(spec,(.46,.018,.02),sporty=True)
    w,h,l=spec["size"]
    # A distinct name from the headlamp reflector, or the runtime headlight rig
    # (which drives a spotlight from every "Headlight reflector" face) mounts a forward beam
    # at the tail.
    m["reverse"]=material("Reversing lamp lens",(.76,.86,.94),.32,.23,.12)
    shell=body_loft("Saloon front with integrated tray sides",[
        (-l*.499,.80,g+h*.40,g+h*.43),(-l*.478,.93,g+h*.52,g+h*.555),
        (-l*.41,.975,g+h*.59,g+h*.615),(-l*.26,.985,g+h*.625,g+h*.64),
        (-l*.14,.99,g+h*.645,g+h*.655),(l*.10,.99,g+h*.66,g+h*.662),
        (l*.47,.985,g+h*.665,g+h*.665),(l*.499,.94,g+h*.61,g+h*.615)],
        g+h*.15,w,m["paint"],body,rounding=.2)
    arch_cut(shell,spec,.022)
    # The open tub is a cavity in the same pressed body: one continuous flank, cab to tail.
    cut_box(shell,(0,g+h*.83,l*.293),(w*.88,h*.66,l*.385),m["trim"])
    arch_cover(spec,.022,m["paint"],body)
    box_=(-l*.162,-l*.038,l*.078,l*.094,g+h*.64,g+h*.975,w*.465,w*.39)
    fb,ft,rt,rb,by,ry,bw,rw=box_
    cabin(body,m,fb,ft,rt,rb,by,ry,bw,rw,.014,rear_window_bottom=.14,front_window_bottom=.10)
    drop_panes(body,("Side glazing",))
    side_panes(body,m,box_,((.05,.90),),.10,.92,"Door window")
    crown_roof("Cab roof",[(-l*.046,.94,.4),(-l*.03,1,1),(l*.066,1,1),(l*.076,.94,.4)],
               w*.77,ry-.003,h*.02,m["paint"],body)
    box("Tub floor liner",(0,g+h*.506,l*.293),(w*.86,h*.012,l*.38),m["trim"],body,.004)
    for sign in (-1,1):
        box("Tub rail cap",(sign*w*.468,g+h*.668,l*.293),(w*.05,h*.014,l*.385),m["trim"],body,.004)
        xs=sign*w*.497
        line("Long door shut line",[(xs,g+h*.64,-l*.148),(xs,g+h*.20,-l*.13),(xs,g+h*.20,l*.07),
             (xs,g+h*.64,l*.085)],.0018,m["trim"],body)
        box("Door pull",(sign*w*.497,g+h*.585,l*.045),(.014,h*.02,l*.035),m["darkmetal"],body,.004)
        box("Side skirt",(sign*w*.482,g+h*.17,-l*.02),(w*.04,h*.05,l*.44),m["trim"],body,.008)
        box("Tail lamp dark bezel",(sign*w*.425,g+h*.51,l*.499),(w*.095,h*.23,.016),m["trim"],body,.006)
        box("Vertical tail lamp",(sign*w*.425,g+h*.535,l*.499+.006),(w*.075,h*.15,.012),m["red"],body,.005)
        box("Reversing lamp",(sign*w*.425,g+h*.43,l*.499+.006),(w*.075,h*.045,.012),m["reverse"],body,.004)
        box("Twin exhaust",(sign*w*.30,g+h*.18,l*.49),(w*.07,h*.05,l*.04),m["alloy"],body,.01)
        box("Exhaust bore",(sign*w*.30,g+h*.18,l*.51),(w*.05,h*.03,.004),m["trim"],body,.006)
        for axle in spec["axles"]:
            arch_lip("Slim arch moulding",sign*w*.49,cy,axle,spec["wheelRadius"]+.024,.008,.02,m["trim"],body)
    mirrors(body,m,w*.46,g+h*.70,-l*.12,(w,h,l),m["paint"])
    # Tailgate seams and a rear bumper under it; the tub cavity reads from any chase camera.
    line("Tailgate shut line",[(-w*.40,g+h*.40,l*.5),(w*.40,g+h*.40,l*.5)],.0018,m["trim"],body)
    box("Tailgate handle",(0,g+h*.58,l*.5),(w*.14,h*.03,.006),m["darkmetal"],body,.004)
    box("Rear bumper",(0,g+h*.26,l*.49),(w*.90,h*.10,l*.03),m["trim"],body,.01)
    # Swept lamps set into the bonnet corners, twin grille openings, no badge.
    for sign in (-1,1):
        # Projected onto the rounded nose, so the lamp wraps the corner instead of sinking into it.
        def rows(inset):
            return [[(sign*w*(.19+.25*(inset+(1-2*inset)*j/8)),g+h*(.37+.10*(inset+(1-2*inset)*i/5)),-l*.6)
                     for j in range(9)] for i in range(6)]
        sedan_patch("Headlamp dark bezel",shell,rows(0),m["trim"],body,(0,0,1),.003)
        sedan_patch("Swept headlamp lens",shell,rows(.10),m["white"],body,(0,0,1),.006)
        box("Bumper fog lamp",(sign*w*.34,g+h*.26,-l*.499),(w*.07,h*.03,.006),m["white"],body,.003)
    box("Upper grille",(0,g+h*.42,-l*.496),(w*.34,h*.05,.02),m["trim"],body,.008)
    box("Lower air intake",(0,g+h*.27,-l*.497),(w*.52,h*.10,.02),m["trim"],body,.012)
    box("Front lower lip",(0,g+h*.16,-l*.485),(w*.72,h*.025,l*.03),m["trim"],body,.006)
    for sign in (-1,1):
        line("Bonnet crease",[(sign*w*.22,g+h*.60,-l*.43),(sign*w*.25,g+h*.66,-l*.20)],.003,m["paint"],body)
    wipers(body,m,box_,.10)
    return root,body


BUILDERS={"lhasa-plateau-suv":plateau_suv,"amboseli-safari":safari,
          "fuji-kei-truck":kei_truck,"sydney-ute":ute}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--ids",default=",".join(BUILDERS))
    parser.add_argument("--render-dir",type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    specs={spec["id"]:spec for spec in CATALOGUE["vehicles"]}
    for vehicle_id in args.ids.split(","):
        spec=specs[vehicle_id]
        authored=modelling_spec(spec)
        root,body=BUILDERS[vehicle_id](authored)
        prepare_glazing(body,authored)
        consolidate(body,"Body geometry")
        for child in list(body.children):
            if child.type=="EMPTY":bpy.data.objects.remove(child,do_unlink=True)
        export(root,ROOT/f"game/public/models/cars/{vehicle_id}.glb",authored["detailScale"])
        if args.render_dir:render_views(root,spec,ROOT/args.render_dir,distance_factor=.62)


if __name__=="__main__":
    main()
