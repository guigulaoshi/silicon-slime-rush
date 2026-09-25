"""Build the two local sports cars: Dubai's mid-engined supercar and Rome's classic roadster.

Blender --background --python-exit-code 1 --python assets-src/vehicles/build_local_sports.py
    -- [--ids dubai-supercar,rome-roadster] [--render-dir tmp/local-sports]

The catalogue owns every physical dimension and moving-wheel position; geometry is authored in
common.modelling_spec units and exported through common.export, like every other car. Neither car
carries a brand, badge, logo or lettering.

- dubai-supercar: a low, wide wedge. The nose is the lowest point of the body and the bonnet rises
  in one line into a steep, far-forward (cab-forward) canopy; big dark intakes are cut into the
  flanks ahead of the rear haunches, a louvred engine cover falls to a flat cut-off tail with a
  full-width light bar and a small ducktail lip. Pearl white paint, gloss black aero parts.
- rome-roadster: a small red 1960s-style two-seater. Long bonnet with round lamps in the wing tips,
  an oval mouth, slim chrome bumpers, an open cockpit set back toward the rear axle (two tan seats,
  a thin wood-rim wheel) behind a small chrome-framed windscreen and raised wind-up side glass, the black hood folded behind the
  seats, and a short rounded tail with round lamps.
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (ROOT, CATALOGUE, modelling_spec, xyz, empty, material, mesh, box, line, loft,
                    radial, body_loft, arch_cut, arch_cover, curve_stations, prepare_glazing,
                    round_section, curved_surface, consolidate, export, render_views, wheel)
from build_compact_cars import materials, sedan_patch
from build_lightweight_sports import projected_nose_lamp, projected_rear_lamp, close_surfaces


def reset():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes,bpy.data.curves,bpy.data.materials):
        for data in list(collection):
            if data.users==0:collection.remove(data)


def rig(spec,m,sporty):
    root=empty('vehicle-root');body=empty('body',root)
    g=spec['anchorY']-spec['suspensionRest'];cy=g+spec['wheelRadius']
    for i,axle in enumerate(spec['axles']):
        for j,sign in enumerate((-1,1)):
            pivot=empty(f'wheel-{2*i+j}',root,(sign*spec['track']/2,cy,axle))
            wheel(pivot,spec['wheelRadius'],spec['wheelWidth'],m,sporty=sporty)
            consolidate(pivot,'Running wheel geometry')
    return root,body,g,cy


def flat_glass(obj):
    """Triangulate and flat-shade a glass patch: every exported shading normal is its face normal,
    so each pane reads as real flat glass rather than a smoothed blob."""
    if 'surface_angle' in obj:del obj['surface_angle']
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm,faces=bm.faces[:])
    bm.to_mesh(obj.data);bm.free()
    for face in obj.data.polygons:face.use_smooth=False
    return obj


def slab(name,corners,thickness,mat,parent,outward,nu=4,nv=2):
    """A closed flat pane: a grid on the four corners (bottom-left, bottom-right, top-right,
    top-left) and a parallel back face ``thickness`` behind it. Flat shaded."""
    a,b,c,d=map(Vector,corners);n=Vector(outward).normalized()
    front=[tuple((a.lerp(b,u/nu)).lerp(d.lerp(c,u/nu),v/nv)) for v in range(nv+1) for u in range(nu+1)]
    back=[tuple(Vector(p)-n*thickness) for p in front]
    k=len(front);row=nu+1
    faces=[]
    for v in range(nv):
        for u in range(nu):
            q=(v*row+u,v*row+u+1,(v+1)*row+u+1,(v+1)*row+u)
            faces.append(q);faces.append(tuple(i+k for i in reversed(q)))
    ring=list(range(nu+1))+[v*row+nu for v in range(1,nv+1)]+[nv*row+u for u in range(nu-1,-1,-1)]\
        +[v*row for v in range(nv-1,0,-1)]
    for i,j in zip(ring,ring[1:]+ring[:1]):faces.append((i,j,j+k,i+k))
    obj=mesh(name,front+back,faces,mat,parent)
    for face in obj.data.polygons:face.use_smooth=False
    return obj


def game_point(v,scale):
    """Blender local vector -> delivered game metres."""
    return [round(v.x*scale,5),round(v.z*scale,5),round(-v.y*scale,5)]


def light_record(objs,scale):
    """Centre and visible (width, height) of a lamp lens, in game metres, from its real mesh."""
    points=[o.matrix_world@v.co for o in objs for v in o.data.vertices]
    lo=Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi=Vector(tuple(max(p[i] for p in points) for i in range(3)))
    return {'position':game_point((lo+hi)/2,scale),
            'size':[round((hi.x-lo.x)*scale,5),round((hi.z-lo.z)*scale,5)]}


def finish(root,body,m,lamps,scale):
    close_surfaces(root,m['trim'])
    lights={kind:sorted([light_record(objs,scale) for objs in lamps[key]],key=lambda r:r['position'][0])
            for kind,key in (('headlights','head'),('brakeLights','brake'))}
    consolidate(body,'Body geometry')
    for child in list(body.children):
        if child.type=='EMPTY':bpy.data.objects.remove(child,do_unlink=True)
    return root,lights


# --------------------------------------------------------------------------------------------
# Dubai: mid-engined wedge supercar


def dubai(spec):
    reset()
    m=materials((.80,.795,.765))
    # Pearl white: a light metallic flake under a glossy coat. The name stays "Factory body paint"
    # so the shared checks find the painted shell.
    shader=m['paint'].node_tree.nodes.get('Principled BSDF')
    shader.inputs['Metallic'].default_value=.38
    shader.inputs['Roughness'].default_value=.2
    shader.inputs['Coat Weight'].default_value=.6
    shader.inputs['Coat Roughness'].default_value=.05
    m['carbon']=material('Gloss black carbon',(.012,.013,.016),.35,.22)
    m['mirror']=material('Reflective side mirror',(.16,.23,.26),.8,.12)
    root,body,g,cy=rig(spec,m,True)
    w,h,l=spec['size']
    # z, half-width fraction, shoulder (wing) height, centre deck height. The nose is the lowest
    # point; wings rise over the wheels while the centre bonnet climbs in a straight wedge.
    hull=[(-l*.500,.78,g+h*.235,g+h*.245),(-l*.468,.92,g+h*.36,g+h*.305),
          (-l*.40,.985,g+h*.53,g+h*.37),(-l*.29,1,g+h*.665,g+h*.435),
          (-l*.20,.965,g+h*.63,g+h*.49),(-l*.10,.90,g+h*.545,g+h*.525),
          (l*.05,.905,g+h*.545,g+h*.55),(l*.17,.975,g+h*.63,g+h*.595),
          (l*.29,1,g+h*.69,g+h*.62),(l*.40,.99,g+h*.665,g+h*.62),
          (l*.475,.955,g+h*.61,g+h*.60),(l*.500,.915,g+h*.555,g+h*.565)]
    shell=body_loft('Wedge nose rising to wide rear haunches',hull,g+h*.10,w,m['paint'],body,
                    rounding=.15,broad_wings=True)
    # Clearance plus cover thickness must exceed wheelLift, or the lifted tyre shows through.
    arch_cut(shell,spec,.035)
    arch_cover(spec,.035,m['paint'],body)
    # Cab-forward canopy: the windscreen starts just behind the front axle and the roof peaks
    # ahead of the car's middle; behind it the long engine cover falls toward the tail.
    stations=[(-.305,.50,.455),(-.25,.61,.445),(-.17,.785,.415),(-.085,.93,.385),
              (.0,.99,.36),(.075,1.0,.35),(.15,.955,.35),(.24,.85,.365),
              (.33,.735,.385),(.405,.655,.40)]
    sampled=curve_stations(stations,4)
    sections=[]
    for z,top,half in sampled:
        sections.append(round_section([(-w*.40,g+h*.46,l*z),(w*.40,g+h*.46,l*z),
            (w*.405,g+h*.52,l*z),(w*half,g+h*(top-.05),l*z),
            (w*half*.64,g+h*(top-.007),l*z),(0,g+h*top,l*z),
            (-w*half*.64,g+h*(top-.007),l*z),(-w*half,g+h*(top-.05),l*z),
            (-w*.405,g+h*.52,l*z)],.22,3))
    upper=loft('Cab forward canopy and engine cover',sections,m['paint'],body)
    def top_at(z):
        for (a,ya,_),(b,yb,_) in zip(sampled,sampled[1:]):
            if a<=z<=b:return ya+(yb-ya)*(z-a)/(b-a)
        raise ValueError('Canopy station outside loft')
    belt=curve_stations(hull)
    def belt_at(z):
        for left,right in zip(belt,belt[1:]):
            if left[0]<=z*l<=right[0]:
                t=(z*l-left[0])/(right[0]-left[0])
                return (left[2]+(right[2]-left[2])*t-g)/h
        raise ValueError('Side glass outside hull')
    # Coarse glass grids: each pane is a handful of large flat triangles.
    for sign in (-1,1):
        def side_rows(inset,nz=6,ny=3):
            rows=[]
            for i in range(nz+1):
                t=inset+(1-2*inset)*i/nz
                z=-.158+.283*t
                low=max(.575,belt_at(z)+.03)
                high=top_at(z)-.075
                rows.append([(sign*w,g+h*(low+(high-low)*(inset+(1-2*inset)*j/ny)),l*z) for j in range(ny+1)])
            return rows
        # Seals are sampled finely (the aperture cut runs through them); glass stays coarse.
        sedan_patch('Canopy side glass seal',upper,side_rows(0,18,8),m['trim'],body,(-sign,0,0),.0015)
        flat_glass(sedan_patch('Canopy side glass',upper,side_rows(.04),m['glass'],body,(-sign,0,0),.003))
    def roof_rows(z0,z1,a,b,inset,nu=6,nv=4):
        rows=[]
        for i in range(nv+1):
            t=inset+(1-2*inset)*i/nv;half=a+(b-a)*t
            rows.append([(w*half*(-1+2*(inset+(1-2*inset)*j/nu)),g+h*1.2,l*(z0+(z1-z0)*t)) for j in range(nu+1)])
        return rows
    sedan_patch('Wrapped windscreen seal',upper,roof_rows(-.25,-.05,.285,.255,0,16,10),m['trim'],body,(0,-1,0),.0015)
    flat_glass(sedan_patch('Wrapped windscreen',upper,roof_rows(-.25,-.05,.285,.255,.035),m['glass'],body,(0,-1,0),.003))
    # Louvred engine cover: a dark vented panel with painted slats across it.
    sedan_patch('Engine cover vent',upper,roof_rows(.215,.385,.25,.30,0,8,8),m['carbon'],body,(0,-1,0),.002)
    for i in range(6):
        zf=.235+.027*i;z=l*zf;half=w*(.25+.05*(zf-.215)/.17)*.92
        pts=[]
        for j in range(9):
            x=-half+2*half*j/8
            hit,p,_,_=upper.ray_cast(Vector((x,-z,g+h*1.3)),Vector((0,0,-1)))
            if not hit:raise ValueError('Louvre misses engine cover')
            pts.append((x,p.z+.006,z))
        line('Engine cover louvre slat',pts,.0045,m['paint'],body)
    def flank(sign,zy,lift=.004):
        points=[]
        for z,y in zy:
            hit,p,_,_=shell.ray_cast(Vector((sign*w,-z*l,g+y*h)),Vector((-sign,0,0)))
            if not hit:raise ValueError(f'Flank detail misses shell at {z}, {y}')
            points.append((p.x+sign*lift,p.z,-p.y))
        return points
    for sign in (-1,1):
        # The big side intake: a deep black scoop from the door to the rear wheel.
        quad=[(-.03,.20),(.183,.19),(.188,.60),(.07,.53)]
        rows=[]
        for i in range(9):
            t=i/8
            a=Vector(quad[0]).lerp(Vector(quad[3]),t);b=Vector(quad[1]).lerp(Vector(quad[2]),t)
            rows.append([tuple(a.lerp(b,j/8)) for j in range(9)])
        pts=[p for row in rows for p in flank(sign,row,.006)]
        faces=[(i*9+j,i*9+j+1,(i+1)*9+j+1,(i+1)*9+j) for i in range(8) for j in range(8)]
        if sign<0:faces=[tuple(reversed(f)) for f in faces]
        curved_surface(mesh('Side air intake',pts,faces,m['carbon'],body,recalculate=False))
        edge=[]
        for a,b in zip(quad,quad[1:]+quad[:1]):edge+=[tuple(Vector(a).lerp(Vector(b),i/8)) for i in range(8)]
        line('Intake painted lip',flank(sign,edge+[quad[0]],.011),.0035,m['paint'],body)
        # A sharp painted blade runs forward from the intake along the door.
        line('Door blade crease',flank(sign,[(-.175,.40),(-.10,.38),(-.02,.36),(.08,.39)],.004),.004,m['paint'],body)
        door=[(-.185,.56),(-.18,.30),(-.15,.20),(-.01,.20),(.01,.30),(.05,.55)]
        seam=[]
        for a,b in zip(door,door[1:]):seam+=[tuple(Vector(a).lerp(Vector(b),i/8)) for i in range(8)]
        line('Scissor door shut line',flank(sign,seam+[door[-1]]),.0015,m['trim'],body)
        sill=[]
        for z,x in [(-.23,.455),(-.15,.47),(.10,.47),(.21,.49)]:
            sill.append([(sign*w*(x-.03),g+h*.10,l*z),(sign*w*(x+.018),g+h*.085,l*z),
                         (sign*w*(x+.018),g+h*.135,l*z),(sign*w*(x-.03),g+h*.165,l*z)])
        loft('Carbon side skirt',sill,m['carbon'],body)
        line('Mirror stalk',[(sign*w*.36,g+h*.68,-l*.205),(sign*w*.47,g+h*.71,-l*.20)],.006,m['carbon'],body)
        mirror=body_loft('Winged mirror housing',[(-l*.222,.30,g+h*.715,g+h*.725),
            (-l*.203,1,g+h*.745,g+h*.755),(-l*.17,.65,g+h*.725,g+h*.735)],g+h*.69,w*.09,m['paint'],body)
        mirror.location.x=sign*w*.48
        box('Side mirror glass',(sign*w*.48,g+h*.72,-l*.170),(w*.07,h*.04,.003),m['mirror'],body,.006,3)
    # Thin swept headlamp blades on the wing tips, with a short downward leg.
    lamps={'head':[],'brake':[]}
    def lamp_patch(name,quad,mat,lift=.004):
        a,b,c,d=(Vector((x,g+h,z)) for x,z in quad)
        rows=[[tuple(a.lerp(b,u).lerp(d.lerp(c,u),t)) for u in [j/8 for j in range(9)]] for t in [i/4 for i in range(5)]]
        return sedan_patch(name,shell,rows,mat,body,(0,-1,0),lift)
    for sign in (-1,1):
        # A dark smoked housing with a bright slim lens inside it, so the lamp reads on white paint.
        housing=[(sign*w*.19,-l*.49),(sign*w*.445,-l*.452),(sign*w*.46,-l*.405),(sign*w*.22,-l*.458)]
        lamp_patch('Smoked headlamp housing',housing,m['carbon'],.004)
        lens=lamp_patch('Headlamp blade lens',[(sign*w*.23,-l*.482),(sign*w*.43,-l*.450),
                        (sign*w*.44,-l*.428),(sign*w*.25,-l*.468)],m['white'],.007)
        leg=lamp_patch('Headlamp lower leg',[(sign*w*.30,-l*.476),(sign*w*.322,-l*.473),
                       (sign*w*.312,-l*.490),(sign*w*.29,-l*.492)],m['white'],.007)
        lamps['head'].append([lens,leg])
    # Front: three large black intakes projected onto the nose, and a shallow splitter.
    def nose_patch(name,x0,x1,y0,y1,mat,lift):
        rows=[[(w*(x0+(x1-x0)*j/8),g+h*(y0+(y1-y0)*i/4),-l) for j in range(9)] for i in range(5)]
        return sedan_patch(name,shell,rows,mat,body,(0,0,1),lift)
    nose_patch('Central front air intake',-.27,.27,.125,.215,m['carbon'],.004)
    for sign in (-1,1):
        a,b=sorted((sign*.31,sign*.43))
        nose_patch('Outboard front air intake',a,b,.13,.26,m['carbon'],.004)
    body_loft('Front splitter',[(-l*.505,.76,g+h*.085,g+h*.095),(-l*.49,.95,g+h*.085,g+h*.095),
              (-l*.44,.97,g+h*.085,g+h*.095)],g+h*.055,w,m['carbon'],body,rounding=.12)
    # Flat cut-off tail: a full-width light bar, black lower panel, four central tailpipes.
    for sign in (-1,1):
        lamps['brake'].append([box('Full width tail light bar',(sign*w*.215,g+h*.515,l*.5+.004),(w*.40,h*.028,.008),m['red'],body,.003)])
        box('Tail lamp outer hook',(sign*w*.40,g+h*.47,l*.5+.004),(w*.028,h*.08,.008),m['red'],body,.003)
    box('Black rear panel',(0,g+h*.33,l*.5+.003),(w*.84,h*.20,.006),m['carbon'],body,.01)
    box('Rear diffuser',(0,g+h*.16,l*.47),(w*.80,h*.10,l*.05),m['carbon'],body,.009)
    for x in (-.31,-.155,.155,.31):
        box('Diffuser fin',(w*x,g+h*.14,l*.478),(.008,h*.08,l*.04),m['darkmetal'],body,.002)
    for x in (-.09,-.03,.03,.09):
        radial('Tailpipe',[(l*.49,h*.036),(l*.515,h*.036),(l*.515,h*.028),(l*.49,h*.028)],m['alloy'],
               empty('Tailpipe mount',body,(w*x,g+h*.26,0)),24,'z')
    # Small ducktail lip rather than a racing wing.
    body_loft('Ducktail lip',[(l*.43,.90,g+h*.625,g+h*.63),(l*.475,.93,g+h*.645,g+h*.665),
              (l*.503,.92,g+h*.64,g+h*.672)],g+h*.56,w,m['paint'],body,rounding=.2)
    prepare_glazing(body,spec)
    return finish(root,body,m,lamps,spec['detailScale'])


# --------------------------------------------------------------------------------------------
# Rome: small classic open two-seat roadster


def rome(spec):
    reset()
    m=materials((.50,.018,.016))
    m['chrome']=material('Polished chrome',(.80,.82,.85),1.0,.1)
    m['leather']=material('Tan leather upholstery',(.36,.16,.07),0,.62)
    m['hood']=material('Black canvas hood',(.028,.028,.032),0,.92)
    m['wood']=material('Varnished wood rim',(.22,.09,.03),0,.35)
    m['liner']=material('Cabin charcoal lining',(.045,.052,.061),0,.86)
    root,body,g,cy=rig(spec,m,False)
    w,h,l=spec['size']
    # Long bonnet, scuttle, cockpit, short rounded tail. Wings rise gently over the wheels.
    hull=[(-l*.500,.66,g+h*.33,g+h*.34),(-l*.475,.84,g+h*.45,g+h*.44),
          (-l*.41,.95,g+h*.555,g+h*.53),(-l*.30,1,g+h*.61,g+h*.575),
          (-l*.17,.985,g+h*.615,g+h*.60),(-l*.07,.975,g+h*.64,g+h*.635),
          (l*.10,.975,g+h*.655,g+h*.645),(l*.24,1,g+h*.645,g+h*.635),
          (l*.37,.975,g+h*.615,g+h*.615),(l*.455,.89,g+h*.56,g+h*.57),
          (l*.500,.74,g+h*.45,g+h*.47)]
    shell=body_loft('Long bonnet roadster body',hull,g+h*.13,w,m['paint'],body,rounding=.26)
    # The open cockpit is a tub cut down into the body; its walls take the dark lining.
    cutter=box('Cockpit tub cutter',(0,g+h*.85,l*.075),(w*.80,h*.84,l*.30),m['liner'],None,.05,4)
    bpy.context.view_layer.objects.active=shell
    mod=shell.modifiers.new('Open cockpit','BOOLEAN')
    mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;mod.material_mode='TRANSFER'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
    # Clearance plus cover thickness must exceed wheelLift, or the lifted tyre shows through.
    arch_cut(shell,spec,.024)
    arch_cover(spec,.024,m['paint'],body)
    # Cockpit furnishing: carpeted floor, two tan buckets, a painted dash with a black top.
    box('Cockpit carpet',(0,g+h*.46,l*.075),(w*.76,h*.04,l*.28),m['liner'],body,.006)
    for sign in (-1,1):
        x=sign*w*.20
        box('Bucket seat cushion',(x,g+h*.53,l*.125),(w*.28,h*.10,l*.10),m['leather'],body,.02,3)
        box('Bucket seat back',(x,g+h*.655,l*.19),(w*.27,h*.25,l*.035),m['leather'],body,.03,3)
        # Above the door tops the cockpit is open at the sides too, so
        # the backrest's own flanks were the outermost x surface there. A wrap-around shell -- realistic
        # on a bucket seat, whose hard shell usually shows past the padded insert on both sides -- spans
        # the same depth as the backrest itself, not just its rear face, so it is what a sideways sweep
        # meets first.
        box('Seat back shell',(x,g+h*.655,l*.19),(w*.40,h*.27,l*.10),m['trim'],body,.008,2)
    box('Painted dashboard',(0,g+h*.60,-l*.062),(w*.78,h*.14,l*.035),m['paint'],body,.012,3)
    box('Black dash top roll',(0,g+h*.672,-l*.062),(w*.78,h*.03,l*.04),m['trim'],body,.012,3)
    for x in (-.26,-.14):
        radial('Round dial',[(-l*.043,h*.034),(-l*.041,h*.034),(-l*.041,0)],m['chrome'],
               empty('Dial mount',body,(w*x,g+h*.61,0)),20,'z')
    column=empty('Steering column',body,(-w*.20,g+h*.67,-l*.02))
    radial('Thin wood rim steering wheel',[(-.005,h*.085),(.005,h*.085),(.005,h*.10),(-.005,h*.10)],m['wood'],column,28,'z')
    line('Steering spoke',[(-w*.20-h*.09,g+h*.67,-l*.02),(-w*.20+h*.09,g+h*.67,-l*.02)],.004,m['chrome'],body)
    line('Steering column shaft',[(-w*.20,g+h*.67,-l*.02),(-w*.20,g+h*.61,-l*.055)],.008,m['trim'],body)
    # The hood, folded into a soft black roll across the deck behind the seats.
    body_loft('Folded canvas hood',[(l*.215,.60,g+h*.64,g+h*.65),(l*.235,.78,g+h*.70,g+h*.71),
              (l*.26,.80,g+h*.705,g+h*.72),(l*.285,.74,g+h*.67,g+h*.68),(l*.30,.58,g+h*.635,g+h*.64)],
              g+h*.58,w,m['hood'],body,rounding=.3)
    # The open cockpit left both bucket seats the outermost surface
    # under the sky, so the body coat painted the leather. A real convertible top, raised from the
    # windscreen header back past the seat backs, covers them the way the roof does on every closed
    # body; it hands off to the folded hood's own rising curve just behind the seats.
    # The 5 cm coat-exposure depth band means "above the seat" is not enough; the top has to
    # clear the seat back by more than that or the seat still reads as the outer layer.
    top_a=[(-w*.36,g+h*.93,-l*.035),(w*.36,g+h*.93,-l*.035),(w*.40,g+h*.90,l*.225),(-w*.40,g+h*.90,l*.225)]
    slab('Canvas top raised',top_a,.006,m['hood'],body,(0,.95,-.15),4,3)
    # Small raked windscreen in a chrome frame, standing on the scuttle.
    z0,z1,y0,y1=-l*.10,-l*.035,g+h*.625,g+h*.93
    bottom,top=w*.40,w*.36
    pane=[(-bottom,y0,z0),(bottom,y0,z0),(top,y1,z1),(-top,y1,z1)]
    normal=(Vector(pane[1])-Vector(pane[0])).cross(Vector(pane[3])-Vector(pane[0])).normalized()
    if normal.z>0:normal.negate()
    slab('Small raked windscreen',pane,.004,m['glass'],body,normal,4,2)
    front=[tuple(Vector(p)+normal*.004) for p in pane]
    for a,b in zip(front,front[1:]+front[:1]):
        line('Chrome windscreen frame',[a,b],.007,m['chrome'],body)
    for sign in (-1,1):
        line('Windscreen side post',[(sign*bottom,y0-.02,z0),(sign*top,y1,z1)],.009,m['chrome'],body)
        # Wind-up side glass, raised: frameless panes rising out of the door tops behind the posts.
        x0,x1=sign*w*.455,sign*w*.44
        side=[(x0,g+h*.672,-l*.089),(x0,g+h*.672,l*.115),(x1,g+h*.86,l*.075),(x1,y1-.012,z1+.006)]
        if sign<0:side=[side[1],side[0],side[3],side[2]]
        slab('Wind-up side glass',side,.004,m['glass'],body,(sign,0,0),4,2)
        line('Door top window seal',[(sign*w*.456,g+h*.668,-l*.089),(sign*w*.456,g+h*.668,l*.115)],.006,m['trim'],body)
        line('Side glass chrome top edge',[(x1+sign*.003,y1-.010,z1+.006),(x1+sign*.003,g+h*.862,l*.075)],.0035,m['chrome'],body)
    # Round lamps in the wing tips, an oval mouth with a chrome surround.
    lamps={'head':[],'brake':[]}
    for sign in (-1,1):
        projected_nose_lamp('Chrome headlamp bezel',shell,sign*w*.30,g+h*.47,w*.078,w*.078,m['chrome'],body,.004,
                            rings=((1,0),(.84,.004),(.2,.006)))
        lens,_,_=projected_nose_lamp('Round glass headlamp',shell,sign*w*.30,g+h*.47,w*.066,w*.066,m['white'],body,.009,
                                     rings=((1,0),(.7,.006),(.15,.01)))
        lamps['head'].append([lens])
        projected_nose_lamp('Amber sidelight',shell,sign*w*.33,g+h*.34,w*.03,h*.02,m['amber'],body,.004,
                            rings=((1,0),(.5,.002),(.15,.003)))
    # The dark mouth sits clearly proud of the chrome surround's crown, so nothing shows through it.
    projected_nose_lamp('Oval mouth chrome surround',shell,0,g+h*.33,w*.20,h*.085,m['chrome'],body,.003,
                        rings=((1,0),(.9,.001),(.2,.001)))
    projected_nose_lamp('Oval mouth',shell,0,g+h*.33,w*.18,h*.07,m['trim'],body,.009,
                        rings=((1,0),(.6,.001),(.1,.001)))
    def nose_points(xs,y,lift):
        pts=[]
        for x in xs:
            hit,p,_,_=shell.ray_cast(Vector(xyz((x,y,-3))),Vector((0,-1,0)))
            if not hit:raise ValueError('Bumper misses nose')
            pts.append((p.x,p.z,-p.y-lift))
        return pts
    def tail_points(xs,y,lift):
        pts=[]
        for x in xs:
            hit,p,_,_=shell.ray_cast(Vector(xyz((x,y,3))),Vector((0,1,0)))
            if not hit:raise ValueError('Bumper misses tail')
            pts.append((p.x,p.z,-p.y+lift))
        return pts
    for sign in (-1,1):
        xs=[sign*w*(.22+.23*i/8) for i in range(9)]
        line('Chrome front bumper blade',nose_points(xs,g+h*.28,.014),.012,m['chrome'],body)
        for j,dx in enumerate((.25,.37)):
            x=sign*w*dx;y=g+h*.47
            projected_rear_lamp('Round tail lamp bezel',shell,x,y,h*.058,l,m['chrome'],body,.003)
            lamp=projected_rear_lamp('Round red tail lamp',shell,x,y,h*.046,l,m['red'] if j else m['amber'],body,.006)
            if j:lamps['brake'].append([lamp])
    line('Chrome rear bumper',tail_points([w*(-.44+.88*i/16) for i in range(17)],g+h*.33,.014),.012,m['chrome'],body)
    box('Rear plate recess',(0,g+h*.40,l*.5-.004),(w*.26,h*.07,.012),m['darkmetal'],body,.006)
    radial('Single chrome tailpipe',[(l*.47,h*.026),(l*.52,h*.026),(l*.52,h*.019),(l*.47,h*.019)],m['chrome'],
           empty('Tailpipe mount',body,(w*.25,g+h*.19,0)),20,'z')
    def flank(sign,zy,lift=.003):
        pts=[]
        for z,y in zy:
            hit,p,_,_=shell.ray_cast(Vector((sign*w,-z*l,g+y*h)),Vector((-sign,0,0)))
            if not hit:raise ValueError(f'Flank misses body at {z},{y}')
            pts.append((p.x+sign*lift,p.z,-p.y))
        return pts
    for sign in (-1,1):
        door=[(-.07,.60),(-.075,.30),(-.05,.19),(.14,.19),(.16,.30),(.155,.60)]
        seam=[]
        for a,b in zip(door,door[1:]):seam+=[tuple(Vector(a).lerp(Vector(b),i/8)) for i in range(8)]
        line('Door shut line',flank(sign,seam+[door[-1]]),.0012,m['trim'],body)
        line('Chrome door handle',flank(sign,[(.105,.56),(.14,.56)],.006),.004,m['chrome'],body)
        line('Chrome waist strip',flank(sign,[(-.165+.32*i/12,.43) for i in range(13)],.003),.0025,m['chrome'],body)
    # One small round chrome mirror on the driver's wing, low and ahead of the windscreen.
    line('Mirror stem',[(-w*.40,g+h*.60,-l*.16),(-w*.405,g+h*.665,-l*.16)],.005,m['chrome'],body)
    radial('Round wing mirror',[(-.006,0),(-.006,h*.04),(.012,h*.04),(.016,0)],m['chrome'],
           empty('Mirror mount',body,(-w*.405,g+h*.69,-l*.16)),20,'z')
    return finish(root,body,m,lamps,spec['detailScale'])


BUILDERS={'dubai-supercar':dubai,'rome-roadster':rome}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--ids',default=','.join(BUILDERS))
    parser.add_argument('--render-dir',type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    specs={spec['id']:spec for spec in CATALOGUE['vehicles']}
    for vehicle_id in args.ids.split(','):
        spec=specs[vehicle_id]
        authored=modelling_spec(spec)
        root,lights=BUILDERS[vehicle_id](authored)
        # Lamp centres are measured on the built mesh; the catalogue's lights must match them.
        print(json.dumps({'id':vehicle_id,'measuredLights':lights}),flush=True)
        export(root,ROOT/f'game/public/models/cars/{vehicle_id}.glb',authored['detailScale'])
        if args.render_dir:render_views(root,spec,ROOT/args.render_dir)


if __name__=='__main__':
    main()
