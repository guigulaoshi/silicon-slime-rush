"""Rebuild the bus, retro van and separate pickup/travel trailer with Blender 5.x.

Run from the repository root with -- --render-dir tmp/vehicle for four views
of each complete vehicle. Pickup inspection views assemble the two exported GLBs
at their catalogue hitches; production exports always remain independent bodies.
"""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import (ROOT,CATALOGUE,modelling_spec,arch_cut,arch_cover,arch_lip,bevel,body_loft,box,
                    prepare_glazing,consolidate,crown_roof,curved_surface,curve_stations,empty,export,line,loft,material,mesh,panel,round_section,
                    radial,render_views,wheel,window,xyz)
from build_compact_cars import base,cabin,headlight,inset_face,deck_crease


def steel_hubs(root,spec,m,domed=False):
    """Pressed steel centres remain children of their running wheel pivots."""
    for pivot in [obj for obj in root.children if obj.name.startswith("wheel-")]:
        # Replace the generic open alloy centre, retaining the common tyre/rim
        # construction. Its spokes must not protrude through an inset hubcap.
        for obj in list(pivot.children):
            bpy.data.objects.remove(obj,do_unlink=True)
        wheel(pivot,spec["wheelRadius"],spec["wheelWidth"],m,covered=True)
        for sign in (-1,1):
            r=spec["wheelRadius"]
            bulge=r*.10 if domed else spec["wheelWidth"]*.06
            # Reserve the full cap relief inside the tyre sidewall envelope.
            a=sign*(spec["wheelWidth"]*.48-bulge)
            radial("Pressed wheel centre",[(a,0),(a,r*.53),(a-sign*.005,r*.58),
                   (a-sign*.012,r*.58),(a-sign*.013,0)],m["alloy"],pivot)
            if domed:
                radial("Polished domed hubcap",[(a+sign*r*.10,0),
                       (a+sign*r*.08,r*.25),(a+sign*r*.03,r*.43),
                       (a,r*.48),(a,0)],m["alloy"],pivot)
            else:
                for i in range(8):
                    angle=math.tau*i/8
                    y,z=math.sin(angle)*r*.42,math.cos(angle)*r*.42
                    panel("Steel wheel cooling hole",[(a+sign*.001,
                          y+math.sin(t)*r*.042,z+math.cos(t)*r*.042)
                          for t in [math.tau*j/8 for j in range(8)]],m["trim"],pivot,
                          outward=(sign,0,0))
                radial("Steel wheel hub",[(a+sign*bulge,0),(a+sign*bulge,r*.20),
                       (a,r*.22),(a,0)],m["darkmetal"],pivot,16)
        consolidate(pivot,"Running wheel geometry")


def side_window(body,m,x,y0,y1,z0,z1,name="Side window"):
    window(name,[(x,y0,z0),(x,y0,z1),(x,y1,z1),(x,y1,z0)],
           m["glass"],m["trim"],body,.91)


def bus(spec):
    root,body,m,g,cy=base(spec,(1.0,.61,.015))
    w,h,l=spec["size"]
    steel_hubs(root,spec,m)
    roof_white=material("School bus white enamel roof",(.88,.90,.88),.08,.36)
    # Move the passenger shell forward, keeping catalogue wheels and bumpers.
    # The visible bonnet now spans .149 of the body length instead of .223.
    cabin_front=-l*.335
    cabin_rear=l*.49
    cabin_center=(cabin_front+cabin_rear)/2
    cabin_length=cabin_rear-cabin_front
    lower=box("Long passenger body",(0,g+h*.365,cabin_center),
              (w*.95,h*.47,cabin_length),m["paint"],body,.022)
    arch_cut(lower,spec,.025)
    upper=box("Upright bus cabin",(0,g+h*.73,cabin_center),
              (w*.95,h*.37,cabin_length),m["paint"],body,.025)
    upper["glazing_shell"] = True
    crown_roof("Full arched school bus roof",[(-l*.338,.96,.70),(-l*.320,1,1),
        (l*.468,1,1),(l*.493,.96,.70)],w*.96,g+h*.9,h*.10,roof_white,body)
    hood=body_loft("Short conventional school bus bonnet",[
        (-l*.482,.70,g+h*.445,g+h*.485),(-l*.447,.78,g+h*.515,g+h*.557),
        (-l*.338,.76,g+h*.568,g+h*.595)],g+h*.23,w,m["paint"],body)
    arch_cut(hood,spec,.025)
    for sign in (-1,1):
        arch_lip("Broad front school bus fender",sign*w*.421,cy,spec["axles"][0],
                 spec["wheelRadius"]+.027,.052,w*.18,m["paint"],body)
        arch_lip("Rear stamped arch",sign*w*.471,cy,spec["axles"][1],
                 spec["wheelRadius"]+.026,.022,.028,m["paint"],body)
        x=sign*w*.477
        # A separate driver pane followed by ten regularly spaced passenger bays.
        windows=[(-.325,-.252)]+[(-.238+i*.0708,-.175+i*.0708) for i in range(10)]
        for index,(start,end) in enumerate(windows):
            z0,z1=l*start,l*end
            side_window(body,m,x,g+h*.571,g+h*.889,z0,z1,
                        "Driver side window" if index==0 else "Passenger side window")
            box("Sliding window cross rail",(x+sign*.003,g+h*.697,(z0+z1)/2),
                (.008,.011,z1-z0),m["darkmetal"],body)
        for height in (.145,.285,.435,.553):
            rail=box("Black body rub rail",(sign*w*.480,g+h*height,cabin_center),
                     (.019,h*.023,cabin_length-.018),m["trim"],body,.004)
            if height<.4:arch_cut(rail,spec,.027)
        line("Mirror support",[(sign*w*.474,g+h*.85,-l*.325),
             (sign*w*.605,g+h*.85,-l*.35),(sign*w*.605,g+h*.53,-l*.35),
             (sign*w*.47,g+h*.53,-l*.325)],.008,m["trim"],body)
        box("Tall bus mirror",(sign*w*.605,g+h*.704,-l*.352),
            (w*.075,h*.205,l*.020),m["trim"],body,.009)
        box("Bus mirror glass",(sign*w*.605,g+h*.704,-l*.340),
            (w*.053,h*.167,.003),m["glass"],body,.003)
        box("Rear lamp red",(sign*w*.355,g+h*.32,l*.492),
            (w*.075,h*.053,.010),m["red"],body,.007)
        box("Rear lamp amber",(sign*w*.355,g+h*.397,l*.492),
            (w*.075,h*.041,.010),m["amber"],body,.006)
    # A front door is articulated by a tall glazed upper pair and a clear lower seam.
    x=w*.489
    line("Folding entry door seam",[(x,g+h*.14,-l*.325),(x,g+h*.54,-l*.325),
         (x,g+h*.54,-l*.252),(x,g+h*.14,-l*.252),(x,g+h*.14,-l*.325)],.002,m["trim"],body)
    line("Folding door centre",[(x,g+h*.145,-l*.2885),(x,g+h*.88,-l*.2885)],.003,m["trim"],body)
    front=cabin_front-.001
    # The bonnet must remain below the real clear opening of the windscreen.
    # Derive its real clear opening from the finished bonnet geometry so future
    # bonnet shaping cannot leave glass buried behind the raised cowl again.
    windshield_bottom=max(vertex.co.z for vertex in hood.data.vertices)+h*.022
    windshield_top=g+h*.884
    window("Broad divided bus windshield",[(-w*.433,windshield_bottom,front),
         (w*.433,windshield_bottom,front),(w*.433,windshield_top,front),
         (-w*.433,windshield_top,front)],m["glass"],m["trim"],body,.95)
    box("Windshield centre divider",(0,(windshield_bottom+windshield_top)/2,front-.005),
        (.013,windshield_top-windshield_bottom,.011),m["trim"],body)
    window("Rear emergency door glazing",[(-w*.24,g+h*.59,l*.492),
         (w*.24,g+h*.59,l*.492),(w*.24,g+h*.857,l*.492),
         (-w*.24,g+h*.857,l*.492)],m["glass"],m["trim"],body,.92)
    line("Emergency exit door seam",[(-w*.27,g+h*.20,l*.493),
         (-w*.27,g+h*.88,l*.493),(w*.27,g+h*.88,l*.493),
         (w*.27,g+h*.20,l*.493),(-w*.27,g+h*.20,l*.493)],.0024,m["trim"],body)
    box("Emergency door handle",(w*.18,g+h*.47,l*.497),(.058,.014,.010),m["trim"],body,.002)
    for z in (-l*.340,l*.495):
        for x in (-.37,-.12,0,.12,.37):
            box("Roof warning lamp black bezel",(w*x,g+h*.941,z),
                (w*.073,h*.044,.014),m["trim"],body,.004)
            box("Amber roof warning lamp",(w*x,g+h*.943,z),
                (w*.055,h*.029,.020),m["amber"],body,.004)
    nose=-l*.484
    box("School bus grille surround",(0,g+h*.40,nose),
        (w*.59,h*.233,.026),m["alloy"],body,.019)
    box("School bus dark grille",(0,g+h*.40,nose-.015),
        (w*.55,h*.205,.006),m["trim"],body,.014)
    for i in range(7):
        box("Horizontal radiator grille bar",(0,g+h*(.314+i*.028),nose-.021),
            (w*.527,.009,.009),m["darkmetal"],body)
    for sign in (-1,1):
        box("Front wing lamp housing",(sign*w*.409,g+h*.325,nose+.035),
            (w*.197,h*.122,l*.055),m["paint"],body,.021)
        x=sign*w*.386
        headlight(body,m,[(x-w*.057,g+h*.292,nose-.113),
             (x+w*.057,g+h*.292,nose-.113),(x+w*.057,g+h*.366,nose-.113),
             (x-w*.057,g+h*.366,nose-.113)])
        box("Front amber indicator",(sign*w*.474,g+h*.328,nose-.114),
            (w*.049,h*.076,.009),m["amber"],body,.004)
        line("Front bus wiper",[(sign*w*.05,windshield_bottom+h*.023,front-.008),
            (sign*w*.33,windshield_bottom+h*.044,front-.009)],.004,m["trim"],body)
    for z in (-l*.499,l*.495):
        box("Full width factory bumper",(0,g+h*.20,z),
            (w*1.02,h*.098,l*.041),m["trim"],body,.018)
    # A folded traffic paddle on the driver's side, below the first passenger
    # window. All layers are closed thin solids; the text faces outward (-X).
    stop_white=material("STOP sign reflective white",(.95,.95,.91),.04,.42)
    stop_red=material("STOP sign enamel red",(.67,.008,.014),.05,.36)
    stop_x=-w*.491
    stop_y=g+h*.481
    stop_z=-l*.228
    radius=h*.082/math.cos(math.pi/8)
    box("STOP paddle hinge backing",(-w*.482,stop_y,stop_z-l*.024),
        (.028,h*.115,l*.035),m["trim"],body,.004)
    for height in (-.050,.050):
        box("STOP paddle folded hinge",(-w*.482,stop_y+h*height,stop_z-l*.025),
            (.020,h*.015,l*.027),m["darkmetal"],body,.002)
    def octagon(name,x,r,depth,mat):
        outline=[(stop_y+r*math.sin(math.pi/8+math.tau*i/8),
                  stop_z+r*math.cos(math.pi/8+math.tau*i/8)) for i in range(8)]
        points=[(face_x,y,z) for face_x in (x,x+depth) for y,z in outline]
        return mesh(name,points,[tuple(range(8)),tuple(range(15,7,-1))]+
                    [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)],mat,body)
    octagon("STOP octagonal metal backing",stop_x,radius,.010,m["darkmetal"])
    octagon("STOP octagonal white border",stop_x-.003,radius*.976,.003,stop_white)
    octagon("STOP octagonal red face",stop_x-.005,radius*.873,.002,stop_red)
    lettering=bpy.data.curves.new("STOP traffic lettering","FONT")
    lettering.body="STOP"
    lettering.align_x="CENTER"
    lettering.align_y="CENTER"
    lettering.size=radius*.66
    lettering.extrude=.0008
    lettering.resolution_u=5
    text=bpy.data.objects.new("STOP traffic lettering",lettering)
    bpy.context.collection.objects.link(text)
    text.parent=body
    text.location=xyz((stop_x-.006,stop_y,stop_z))
    text.rotation_euler=(math.pi/2,0,-math.pi/2)
    lettering.materials.append(stop_white)
    bpy.ops.object.select_all(action="DESELECT")
    text.select_set(True)
    bpy.context.view_layer.objects.active=text
    bpy.ops.object.convert(target="MESH")
    return root,body


def finish_bus_interior(body,spec):
    """Keep the shared open-window furnishings aligned with the shorter nose."""
    w,h,l=spec["size"]
    g=spec["anchorY"]-spec["suspensionRest"]
    for obj in body.children:
        if obj.name.startswith(("Recessed charcoal dashboard","Interior steering column")):
            obj.location.y+=l*.115
    liner=bpy.data.materials["Cabin charcoal lining"]
    upholstery=bpy.data.materials["Woven graphite upholstery"]
    box("Forward driver footwell",(0,g+h*.565,-l*.268),
        (w*.87,h*.10,l*.106),liner,body,.008)
    x,z=-w*.204,-l*.281
    box("School bus driver cushion",(x,g+h*.65,z),
        (w*.25,h*.038,w*.23),upholstery,body,.018,3)
    box("School bus driver backrest",(x,g+h*.72,z+w*.07),
        (w*.25,h*.15,w*.055),upholstery,body,.020,3)
    box("School bus driver headrest",(x,g+h*.815,z+w*.07),
        (w*.16,h*.045,w*.055),upholstery,body,.012,3)


def van(spec):
    root,body,m,g,cy=base(spec,(.20,.48,.38))
    w,h,l=spec["size"]
    steel_hubs(root,spec,m,domed=True)
    cream=material("Factory body paint warm white",(.84,.80,.69),.15,.34)
    shell=body_loft("Rounded forward control van body",[
        (-l*.485,.80,g+h*.556,g+h*.565),(-l*.458,.94,g+h*.560,g+h*.57),
        (-l*.38,.98,g+h*.56,g+h*.57),(l*.37,.98,g+h*.56,g+h*.57),
        (l*.47,.89,g+h*.56,g+h*.57)],g+h*.13,w,m["paint"],body)
    arch_cut(shell,spec,.018)
    for sign in (-1,1):
        points=[]
        for i in range(33):
            z=l*(-.39+.79*i/32)
            hit,p,_,_=shell.ray_cast(Vector((sign*w,-z,g+h*.548)),Vector((-sign,0,0)))
            if not hit:raise ValueError("Van waist trim misses body")
            points.append((p.x+sign*.002,p.z,-p.y))
        line("Polished two tone waist trim",points,.0025,m["alloy"],body)
    cm={**m,"paint":cream}
    cabin(body,cm,-l*.464,-l*.366,l*.371,l*.461,g+h*.565,g+h*.939,
          w*.454,w*.411,.012)
    # Replace the cabin's generic full panes with actual separate apertures. The
    # opaque shell supplies the pillars; no painted divider sits over any glass.
    for obj in list(body.children):
        if obj.name.startswith(("Side glazing","Windscreen")):
            bpy.data.objects.remove(obj,do_unlink=True)
    front_corners=[(-w*.454,g+h*.565,-l*.464),(w*.454,g+h*.565,-l*.464),
          (w*.411,g+h*.939,-l*.366),(-w*.411,g+h*.939,-l*.366)]
    for u0,u1 in ((.045,.485),(.515,.955)):
        window("Split van windscreen",inset_face(front_corners,u0=u0,u1=u1),
               m["glass"],m["trim"],body,.94)
    for sign in (-1,1):
        corners=[(sign*w*.454,g+h*.565,-l*.464),
                 (sign*w*.454,g+h*.565,l*.461),
                 (sign*w*.411,g+h*.939,l*.371),
                 (sign*w*.411,g+h*.939,-l*.366)]
        for u0,u1 in ((.045,.29),(.32,.51),(.54,.73),(.76,.955)):
            window("Separate van side pane",inset_face(corners,u0=u0,u1=u1),
                   m["glass"],m["trim"],body,.92)
        line("Driver door seam",[(sign*w*.487,g+h*.54,-l*.18),
            (sign*w*.487,g+h*.17,-l*.18),(sign*w*.487,g+h*.17,-l*.29)],.0018,m["trim"],body)
        box("Van door handle",(sign*w*.491,g+h*.50,-l*.211),
            (.014,.018,l*.058),m["darkmetal"],body,.004)
        for axle in spec["axles"]:
            arch_lip("Van stamped wheel arch",sign*w*.475,cy,axle,
                spec["wheelRadius"]+.020,.015,.022,m["paint"],body)
        for j in range(4):
            box("Rear engine cooling slot",(sign*w*.487,g+h*(.47-j*.027),l*.354),
                (.004,h*.012,l*.086),m["trim"],body,.003)
        line("Van mirror stalk",[(sign*w*.456,g+h*.615,-l*.39),
              (sign*w*.56,g+h*.722,-l*.39)],.005,m["darkmetal"],body)
        box("Rounded van mirror",(sign*w*.554,g+h*.748,-l*.39),
            (w*.081,h*.097,l*.022),m["trim"],body,.024)
        box("Van mirror glass",(sign*w*.554,g+h*.748,-l*.376),
            (w*.059,h*.071,.003),m["glass"],body,.015)
        box("Rear vertical lamp",(sign*w*.342,g+h*.33,l*.474),
            (w*.064,h*.125,.013),m["red"],body,.013)
    # Low pressed roof with rounded front and rear shoulders, not a raised camper roof.
    sections=[]
    # Roll the rear crown down to the cabin's rear roof station. A projecting
    # full-height cap at .417*l stood in front of the backlight's outward rays.
    # Every point of the inset rear glass lies aft of this .371*l termination.
    for z,fraction,rise in curve_stations([(-l*.417,.77,1),(-l*.394,.95,1),
            (-l*.35,1,1),(l*.31,1,1),(l*.345,.99,.70),(l*.371,.94,.20)]):
        cross=[(-.44,.925),(.44,.925),(.44,.947),(.412,.974),
               (.32,.991),(.15,1.0),(-.15,1.0),(-.32,.991),(-.412,.974),(-.44,.947)]
        sections.append(round_section([(x*w*fraction,g+(.925+(y-.925)*rise)*h,z)
                                       for x,y in cross],.30,4))
    loft("Low warm white rounded roof",sections,cream,body)
    for sign in (-1,1):
        points=inset_face(front_corners,uv=[(.5+sign*.05,.08),(.5+sign*.38,.08),
                                          (.5+sign*.38,.095),(.5+sign*.05,.095)],lift=.008)
        panel("Front wiper blade",points,m["trim"],body)
        x=sign*w*.303
        pts=[(x+math.cos(t)*w*.083,g+h*.385+math.sin(t)*w*.083,-l*.487)
             for t in [math.tau*i/32 for i in range(32)]]
        window("Round van headlamp",pts,m["white"],m["alloy"],body,.84)
        box("Front van amber lamp",(sign*w*.375,g+h*.234,-l*.481),
            (w*.079,h*.040,.009),m["amber"],body,.005)
    for row in range(3):
        for sign in (-1,1):
            box("Van nose air slot",(sign*w*.107,g+h*(.49-row*.023),-l*.488),
                (w*.188,h*.012,.005),m["trim"],body,.004)
    for z in (-l*.492,l*.477):
        box("Van black bumper",(0,g+h*.161,z),(w*.995,h*.082,l*.045),m["trim"],body,.016)
        for sign in (-1,1):
            box("Van bumper overrider",(sign*w*.265,g+h*.187,z),
                (w*.048,h*.145,l*.050),m["trim"],body,.008)
    box("Rear engine access seam",(0,g+h*.322,l*.473),
        (w*.48,h*.16,.004),m["trim"],body,.016)
    box("Rear engine access cover",(0,g+h*.322,l*.477),
        (w*.46,h*.14,.004),m["paint"],body,.014)
    return root,body


def pickup(spec):
    root,body,m,g,cy=base(spec,(.052,.22,.54))
    w,h,l=spec["size"]
    steel_hubs(root,spec,m)
    empty("hitch",root,spec["hitch"])
    shell=body_loft("Long pickup bonnet and chassis",[
        (-l*.482,.88,g+h*.51,g+h*.545),(-l*.43,.97,g+h*.555,g+h*.575),
        (-l*.25,.98,g+h*.56,g+h*.581),(-l*.09,.97,g+h*.52,g+h*.53),
        (l*.47,.97,g+h*.27,g+h*.27)],g+h*.17,w,m["paint"],body)
    arch_cut(shell,spec,.027)
    # The flared wing is a narrow band, so the tyre still showed from straight above.
    arch_cover(spec,.027,m["paint"],body)
    cabin(body,m,-l*.252,-l*.134,l*.035,l*.082,g+h*.545,g+h*.974,
          w*.454,w*.387,.012)
    crown_roof("Crowned pickup cab roof",[(-l*.14,.94,.3),(-l*.115,1,1),
        (l*.015,1,1),(l*.044,.94,.3)],w*.80,g+h*.969,h*.029,m["paint"],body)
    for sign in (-1,1):
        deck_crease(shell,[(sign*w*.21,-l*.449),(sign*w*.24,-l*.449),
            (sign*w*.30,-l*.279),(sign*w*.28,-l*.279)],g+h,m["paint"],body)
    # A genuinely empty cargo bed: floor plus three walls, no hidden solid deck.
    box("Open long cargo bed floor",(0,g+h*.277,l*.284),
        (w*.875,h*.034,l*.388),m["trim"],body,.004)
    for sign in (-1,1):
        wall=box("Long cargo bed side",(sign*w*.458,g+h*.427,l*.282),
            (w*.068,h*.326,l*.396),m["paint"],body,.009)
        arch_cut(wall,spec,.028)
        box("Bed top protective rail",(sign*w*.458,g+h*.598,l*.282),
            (w*.072,h*.014,l*.40),m["trim"],body,.003)
        box("Bed inner wheel housing",(sign*w*.372,g+h*.346,spec["axles"][1]),
            (w*.14,h*.115,spec["wheelRadius"]*2.36),m["trim"],body,.035)
        for axle in spec["axles"]:
            arch_lip("Pickup flared stamped wing",sign*w*.475,cy,axle,
                spec["wheelRadius"]+.03,.027,.033,m["paint"],body)
        line("Single pickup door seam",[(sign*w*.482,g+h*.54,-l*.233),
             (sign*w*.483,g+h*.23,-l*.19),(sign*w*.483,g+h*.23,l*.058),
             (sign*w*.483,g+h*.52,l*.057)],.002,m["trim"],body)
        box("Pickup door handle",(sign*w*.49,g+h*.499,l*.02),
            (.017,h*.026,l*.056),m["trim"],body,.004)
        box("Pickup mirror stalk",(sign*w*.472,g+h*.668,-l*.188),
            (w*.060,h*.065,.024),m["trim"],body,.004)
        box("Pickup black mirror",(sign*w*.524,g+h*.701,-l*.18),
            (w*.123,h*.092,l*.04),m["trim"],body,.012)
        box("Pickup mirror glass",(sign*w*.524,g+h*.701,-l*.158),
            (w*.093,h*.065,.003),m["glass"],body,.005)
        box("Pickup rear lamp",(sign*w*.429,g+h*.46,l*.485),
            (w*.053,h*.224,.014),m["red"],body,.008)
    box("Bed front wall",(0,g+h*.43,l*.087),(w*.93,h*.30,l*.018),m["paint"],body,.005)
    box("Tailgate",(0,g+h*.43,l*.48),(w*.91,h*.31,l*.024),m["paint"],body,.008)
    box("Tailgate top rail",(0,g+h*.596,l*.48),(w*.94,.012,l*.026),m["trim"],body,.003)
    box("Tailgate handle",(0,g+h*.536,l*.494),(w*.20,h*.037,.006),m["trim"],body,.004)
    front=-l*.486
    box("Pickup grille chrome surround",(0,g+h*.418,front),
        (w*.56,h*.235,.023),m["alloy"],body,.011)
    box("Pickup radiator grille",(0,g+h*.418,front-.013),
        (w*.52,h*.196,.005),m["trim"],body,.009)
    for row in range(3):
        box("Pickup horizontal grille bar",(0,g+h*(.348+row*.066),front-.019),
            (w*.517,.009,.009),m["darkmetal"],body)
    for sign in (-1,1):
        for row in (0,1):
            x=sign*w*.365
            y=g+h*(.322+row*.108)
            headlight(body,m,[(x-w*.072,y,front-.004),(x+w*.072,y,front-.004),
                (x+w*.072,y+h*.086,front-.004),(x-w*.072,y+h*.086,front-.004)])
            box("Pickup stacked amber indicator",(sign*w*.462,y+h*.044,front-.011),
                (w*.038,h*.08,.008),m["amber"],body,.003)
    for z in (-l*.491,l*.485):
        box("Pickup steel bumper",(0,g+h*.22,z),
            (w*1.01,h*.119,l*.049),m["darkmetal"],body,.016)
        box("Pickup bumper bright upper edge",(0,g+h*.274,z),
            (w*.98,h*.023,l*.05),m["alloy"],body,.005)
    hx,hy,hz=spec["hitch"]
    box("Rear tow receiver",(hx,hy-.036,(l*.485+hz)/2),
        (w*.088,.051,hz-l*.485),m["darkmetal"],body,.006)
    line("Tow ball shank",[(hx,hy-.055,hz),(hx,hy,hz)],.021,m["alloy"],body)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.029,
        location=xyz(spec["hitch"]))
    ball=bpy.context.object
    ball.name="Ordinary tow ball"
    ball.parent=body
    ball.data.materials.append(m["alloy"])
    curved_surface(ball)
    return root,body


def trailer(spec):
    root,body,m,g,cy=base(spec,(.82,.82,.77))
    w,h,l=spec["size"]
    steel_hubs(root,spec,m)
    empty("hitch",root,spec["hitch"])
    blue=material("Factory body paint blue accent",(.052,.22,.54),.22,.31)
    sections=[]
    for z,fraction in curve_stations([(-l*.487,.90),(-l*.453,.98),(-l*.415,1),
                                      (l*.415,1),(l*.453,.98),(l*.487,.90)]):
        cross=[(-.445,.142),(.445,.142),(.486,.19),(.486,.82)]
        cross += [(.486*math.cos(math.pi*i/16),.82+.148*math.sin(math.pi*i/16))
                  for i in range(1,17)]
        cross += [(-.486,.19)]
        sections.append(round_section([(x*w*fraction,g+y*h,z) for x,y in cross],.14,3))
    shell=loft("Continuous curved crown travel trailer",sections,m["paint"],body)
    shell["glazing_shell"] = True
    arch_cut(shell,spec,.026)
    for sign in (-1,1):
        x=sign*w*.488
        # The accent stripe and lower rail follow the closed white shell.
        box("Blue trailer belt stripe",(x,g+h*.354,0),
            (.005,h*.049,l*.828),blue,body,.002)
        rail=box("Trailer lower protective rail",(x,g+h*.158,0),
            (.013,h*.032,l*.828),m["trim"],body,.005)
        arch_cut(rail,spec,.028)
        arch_lip("Trailer wheel arch trim",sign*w*.484,cy,spec["axles"][0],
            spec["wheelRadius"]+.027,.023,.027,m["trim"],body)
        side_window(body,m,x+.004*sign,g+h*.57,g+h*.79,-l*.392,-l*.25)
        side_window(body,m,x+.004*sign,g+h*.57,g+h*.79,-l*.02,l*.11)
        side_window(body,m,x+.004*sign,g+h*.56,g+h*.79,l*.17,l*.391)
        line("Rear trailer window mullion",[(x+sign*.008,g+h*.572,l*.28),
              (x+sign*.008,g+h*.777,l*.28)],.004,m["trim"],body)
        for z in (-l*.41,l*.41):
            for height in (.19,.81):
                box("Trailer amber clearance light",(x+sign*.005,g+h*height,z),
                    (.01,h*.025,l*.028),m["amber"],body,.004)
    # Door projects only millimetres from the right wall; a window and step explain entry.
    door_z=-l*.157
    door_seal = box("Trailer entry door seal",(w*.493,g+h*.501,door_z),
        (.006,h*.651,l*.161),m["darkmetal"],body,.013)
    door = box("Trailer entry door",(w*.498,g+h*.501,door_z),
        (.007,h*.631,l*.148),m["paint"],body,.012)
    door_seal["glazing_obstacle"] = True
    door["glazing_obstacle"] = True
    side_window(body,m,w*.506,g+h*.605,g+h*.775,door_z-l*.045,door_z+l*.045,"Door glass")
    box("Trailer entry handle",(w*.510,g+h*.475,door_z+l*.048),
        (.014,h*.065,l*.014),m["trim"],body,.004)
    box("Retracted trailer entry step",(w*.505,g+h*.141,door_z),
        (w*.11,h*.023,l*.16),m["darkmetal"],body,.005)
    for z in (-l*.489,l*.489):
        window("Trailer end window",[(-w*.30,g+h*.58,z),(w*.30,g+h*.58,z),
             (w*.30,g+h*.80,z),(-w*.30,g+h*.80,z)],m["glass"],m["trim"],body,.91)
        box("Trailer end blue stripe",(0,g+h*.354,z),
            (w*.85,h*.049,.005),blue,body,.002)
    box("Low roof air conditioner",(0,g+h*.982,l*.06),
        (w*.35,h*.035,l*.20),m["paint"],body,.016)
    for sign in (-1,1):
        for i in range(3):
            box("Roof unit ventilation slot",(sign*w*.177,g+h*(.975+i*.006),l*.06),
                (.003,h*.003,l*.135),m["trim"],body)
        box("Trailer red rear lamp",(sign*w*.36,g+h*.21,l*.489),
            (w*.098,h*.060,.012),m["red"],body,.006)
    box("Rear trailer bumper",(0,g+h*.132,l*.481),
        (w*.97,h*.047,l*.035),m["trim"],body,.010)
    hx,hy,hz=spec["hitch"]
    for sign in (-1,1):
        line("A frame trailer tongue",[(sign*w*.33,hy-.032,-l*.456),
             (hx,hy-.018,hz+.043)],.024,m["darkmetal"],body)
    # The socket sits over the ball at the marker and leaves the A-frame gap open.
    box("Ordinary ball coupler",(hx,hy+.015,hz+.038),
        (.073,.040,.122),m["alloy"],body,.017)
    box("Coupler latch",(hx,hy+.043,hz+.062),(.025,.016,.052),m["darkmetal"],body,.004)
    line("Raised tongue jack",[(w*.078,hy-.12,hz+.19),
         (w*.078,hy+.095,hz+.19)],.013,m["alloy"],body)
    box("Tongue jack foot",(w*.078,hy-.117,hz+.19),(.07,.013,.055),m["darkmetal"],body,.005)
    # Chains belong to the trailer and hang inside the open coupling gap.
    for sign in (-1,1):
        line("Trailer safety chain",[(sign*.032,hy-.03,hz+.065),
            (sign*.061,hy-.12,hz+.14),(sign*.11,hy-.11,hz+.24),
            (sign*.15,hy-.026,hz+.29)],.005,m["darkmetal"],body)
    return root,body


BUILDERS={"school-bus":bus,"retro-van":van,"pickup-travel-trailer":pickup,
          "travel-trailer":trailer}


def assembled_views(spec,directory):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for body_spec in (spec,spec["trailer"]):
        before=set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(ROOT/f"game/public/models/cars/{body_spec['id']}.glb"))
        roots=[obj for obj in set(bpy.data.objects)-before if obj.parent is None]
        if body_spec is spec:pickup_root=roots[0]
        else:trailer_root=roots[0]
    offset=Vector(spec["hitch"])-Vector(spec["trailer"]["hitch"])
    trailer_root.location=xyz(offset)
    length=spec["size"][2]/2+offset.z+spec["trailer"]["size"][2]/2
    center_z=(offset.z+spec["trailer"]["size"][2]/2-spec["size"][2]/2)/2
    ground=min(spec["anchorY"]-spec["suspensionRest"],
               offset.y+spec["trailer"]["anchorY"]-spec["trailer"]["suspensionRest"])
    height=max(spec["anchorY"]-spec["suspensionRest"]+spec["size"][1],
               offset.y+spec["trailer"]["anchorY"]-spec["trailer"]["suspensionRest"]+
               spec["trailer"]["size"][1])-ground
    render_spec={**spec,"size":[spec["trailer"]["size"][0],height,length],
                 "anchorY":ground,"suspensionRest":0}
    render_views(pickup_root,render_spec,directory,center_z=center_z,distance_factor=.56)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--ids",default=",".join(BUILDERS))
    parser.add_argument("--render-dir",type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    specs={spec["id"]:spec for spec in CATALOGUE["vehicles"]}
    specs["travel-trailer"]=specs["pickup-travel-trailer"]["trailer"]
    requested=args.ids.split(",")
    for vehicle_id in requested:
        spec=specs[vehicle_id]
        authored=modelling_spec(spec)
        root,body=BUILDERS[vehicle_id](authored)
        prepare_glazing(body,authored)
        if vehicle_id=="school-bus":
            finish_bus_interior(body,authored)
        consolidate(body,"Body geometry")
        export(root,ROOT/f"game/public/models/cars/{vehicle_id}.glb",authored["detailScale"])
        if args.render_dir and vehicle_id in ("school-bus","retro-van"):
            render_views(root,spec,ROOT/args.render_dir,distance_factor=.56)
    if args.render_dir and any(i in requested for i in ("pickup-travel-trailer","travel-trailer")):
        assembled_views(specs["pickup-travel-trailer"],ROOT/args.render_dir)


if __name__=="__main__":
    main()
