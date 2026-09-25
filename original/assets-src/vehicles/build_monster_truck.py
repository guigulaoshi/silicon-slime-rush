"""Original pickup-based monster truck, self-authored from the player's silhouette reference.

Blender --background --python-exit-code 1 --python assets-src/vehicles/build_monster_truck.py
  -- --render-dir tmp/260 --reference docs/car-reference/monster-truck.png

Reference: docs/car-reference/monster-truck.png. Only the
pickup cab/bed, exposed show-truck frame and giant treaded tyres inform geometry;
no reference branding, sponsor lettering or artwork is copied. Flame/skull paint
is original closed geometry, with no external models or image textures.

Catalogue dimensions remain the only running-gear source. common.py handles the
project detailScale and +Y up/-Z forward export. axle-front/axle-rear are identity
root children for runtime mean left/right compression translation; their lower
shock pistons slide inside body-mounted upper shock sleeves. The wheels retain
wheel-0..3 and rotate only their own tyres/hubs.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import (ROOT,CATALOGUE,modelling_spec,xyz,empty,material,mesh,box,line,
                    prepare_glazing,loft,radial,body_loft,arch_cut,curved_surface,consolidate,export,render_views,crown_roof,roof_light_bar)
from build_compact_cars import materials,cabin
from build_lightweight_sports import cylinder,close_surfaces
from render_garage_references import import_delivered,render_reference

ID='monster-truck'


def rod(name,a,b,radius,mat,parent,sides=10):
    av,bv=Vector(a),Vector(b)
    direction=(bv-av).normalized()
    across=direction.cross(Vector((0,1,0)) if abs(direction.y)<.9 else Vector((1,0,0))).normalized()
    up=direction.cross(across).normalized()
    vertices=[tuple(center+radius*(across*math.cos(i*math.tau/sides)+up*math.sin(i*math.tau/sides)))
              for center in [av,bv] for i in range(sides)]
    faces=[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]
    faces += [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
    return curved_surface(mesh(name,vertices,faces,mat,parent),55)


def coil(name,a,b,radius,wire,mat,parent,turns=7):
    av,bv=Vector(a),Vector(b);axis=(bv-av).normalized()
    across=axis.cross(Vector((0,0,1))).normalized();up=axis.cross(across).normalized()
    rings=[];count=turns*8
    for i in range(count+1):
        t=i/count;angle=t*turns*math.tau
        radial=across*math.cos(angle)+up*math.sin(angle)
        center=av.lerp(bv,t)+radial*radius
        rings.append([tuple(center+wire*(radial*math.cos(j*math.tau/4)+axis*math.sin(j*math.tau/4)))
                      for j in range(4)])
    return loft(name,rings,mat,parent)


def tyre(pivot,spec,m):
    r=spec['wheelRadius'];w=spec['wheelWidth']/2
    radial('Broad rounded giant tyre carcass',[(-w*.91,r*.49),(-w,r*.64),(-w*.92,r*.81),
        (-w*.71,r*.89),(-w*.34,r*.90),(w*.34,r*.90),(w*.71,r*.89),(w*.92,r*.81),
        (w,r*.64),(w*.91,r*.49)],m['rubber'],pivot,64)
    # Two staggered banks of full-depth tractor chevrons. The shoulder apex at
    # each quarter turn reaches the catalogue radius exactly, including ground.
    for i in range(24):
        theta=i*math.tau/24
        for sign in [-1,1]:
            outline=[(0,-.045),(sign*w*.87,-.13),(sign*w*.95,0),
                     (sign*w*.87,.04),(sign*w*.15,.12),(0,.07)]
            vertices=[(x,rr*math.sin(theta+delta),rr*math.cos(theta+delta))
                      for rr in [r*.875,r] for x,delta in outline]
            n=len(outline)
            faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
            faces += [(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)]
            obj=mesh('Deep chevron tread block',vertices,faces,m['tread'],pivot)
            curved_surface(obj,35)
    for sign in [-1,1]:
        # The beadlock, dish and hub sit at a fraction of the tyre width; the
        # 378 tyre is wider, so they moved outward to keep the hub studs flush
        # with the sidewall (the contract wants an exposed axial rim face).
        a=sign*w*.84
        radial('Reinforced wheel beadlock ring',[(a,r*.475),(a,r*.54),
               (a-sign*.025,r*.54),(a-sign*.025,r*.475)],m['alloy'],pivot,48)
        cylinder('Deep dished black wheel',(a-sign*.055,0,0),r*.49,.035,m['darkmetal'],pivot,sides=16)
        cylinder('Heavy axle hub',(a-sign*.011,0,0),r*.17,.075,m['alloy'],pivot,sides=16)
        for i in range(8):
            angle=i*math.tau/8
            cylinder('Beadlock fastener',(a+sign*.004,r*.51*math.sin(angle),r*.51*math.cos(angle)),
                     r*.020,.010,m['darkmetal'],pivot,sides=6)
        for i in range(6):
            angle=i*math.tau/6
            cylinder('Hub stud',(a+sign*.030,r*.113*math.sin(angle),r*.113*math.cos(angle)),
                     r*.024,.014,m['darkmetal'],pivot,sides=6)
    consolidate(pivot,'Running wheel geometry')


def decal(name,outline,project,mat,parent,lift=0):
    # Triangulate original vector art in its own 2D space, then sample its
    # interior too. Merely projecting an outline buries long chords in fenders.
    loop=[Vector((u,v,0)) for u,v in outline]
    triangles=tessellate_polygon([loop])
    if triangles and isinstance(triangles[0][0],int):
        triangles=[tuple(loop[i] for i in tri) for tri in triangles]
    vertices=[];faces=[];indices={};steps=2
    def index(uv):
        key=(round(uv.x,8),round(uv.y,8))
        if key not in indices:
            indices[key]=len(vertices);vertices.append(project(*key,lift))
        return indices[key]
    for a,b,c in triangles:
        rows={}
        for i in range(steps+1):
            for j in range(steps+1-i):
                rows[i,j]=index(a+(b-a)*(i/steps)+(c-a)*(j/steps))
        for i in range(steps):
            for j in range(steps-i):
                faces.append((rows[i,j],rows[i+1,j],rows[i,j+1]))
                if i+j<steps-1:
                    faces.append((rows[i+1,j],rows[i+1,j+1],rows[i,j+1]))
    center=sum((Vector(v) for v in vertices),Vector())/len(vertices)
    outward=Vector((center.x,0,center.z))
    for i,face in enumerate(faces):
        a,b,c=(Vector(vertices[n]) for n in face)
        if (b-a).cross(c-a).dot(outward)<0:faces[i]=tuple(reversed(face))
    obj=mesh(name,vertices,faces,mat,parent,recalculate=False)
    # Float32 tessellation can produce sub-micron seams between adjacent UV
    # triangles. Weld before adding thickness so every paint patch is one skin.
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm,edges=bm.edges,dist=1e-7)
    bm.to_mesh(obj.data);bm.free()
    return obj


def flames(name,project,mat_red,mat_orange,parent):
    outline=[(0,.18),(.20,.13),(.50,.09),(.78,0),(1,.17),(.81,.23),(.64,.32),
        (.94,.66),(.70,.51),(.52,.47),(.73,.96),(.45,.68),(.26,.62),(.42,.92),(.16,.69),(0,.72)]
    decal(name+' red edge',outline,project,mat_red,parent,.0015)
    inner=[(u*.90,.21+v*.64) for u,v in outline]
    decal(name+' orange core',inner,project,mat_orange,parent,.0035)


def skull(name,project,m,parent):
    outline=[(-.66,-.28),(-.87,.03),(-.88,.38),(-.68,.74),(-.31,.94),
        (.31,.94),(.68,.74),(.88,.38),(.87,.03),(.66,-.28),(.51,-.35),
        (.50,-.79),(-.50,-.79),(-.51,-.35)]
    decal(name+' ivory silhouette',outline,project,m['ivory'],parent,.005)
    for sign in [-1,1]:
        decal(name+' angular eye socket',[(sign*.14,.31),(sign*.57,.45),(sign*.69,.20),
              (sign*.57,-.04),(sign*.21,.015)],project,m['ink'],parent,.007)
    decal(name+' triangular nose',[(-.14,-.20),(.14,-.20),(0,-.43)],project,m['ink'],parent,.007)
    for u in [-.25,0,.25]:
        decal(name+' separated teeth',[(u-.025,-.79),(u+.025,-.79),(u+.025,-.51),(u-.025,-.51)],
              project,m['ink'],parent,.007)
    decal(name+' jaw break',[(-.48,-.43),(.48,-.43),(.48,-.49),(-.48,-.49)],project,m['ink'],parent,.007)


def build(spec):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes,bpy.data.curves,bpy.data.materials):
        for item in list(collection):
            if item.users==0:collection.remove(item)
    root=empty('vehicle-root');body=empty('body',root)
    m=materials((.018,.021,.026))
    m['frame']=material('Clean powder coated silver frame',(.34,.39,.43),.65,.32)
    m['orange']=material('Orange show flame enamel',(1,.20,.009),.18,.28)
    m['flameRed']=material('Red show flame enamel',(.68,.018,.007),.16,.3)
    m['ivory']=material('Ivory skull enamel',(.91,.94,.88),.08,.32)
    m['ink']=material('Matte black graphic ink',(.009,.012,.016),0,.60)
    m['mirrorHousing']=material('Independent mirror housing',(.025,.029,.034),.2,.35)
    m['mirror']=material('Reflective side mirror',(.14,.20,.24),.75,.13)
    m['shock']=material('Anodized orange shock body',(.92,.13,.014),.50,.31)
    w,_,l=spec['size']
    # `size[1]` is the delivered total height including the roof-lamp row. Feeding that
    # measured bound back in as the pickup body's construction height makes every rebuild grow the
    # cab, lamps and suspension by another 32.4 cm. Keep the authored body height that produced the
    # measured 2.58 m GLB; export() applies this vehicle's detail scale afterwards.
    h=1.88
    authored_body={**spec,'size':[w,h,l]}
    g=spec['anchorY']-spec['suspensionRest'];cy=g+spec['wheelRadius']
    # The pickup body is much narrower than the full wheel track. A separate bed
    # and a cab with proper front/rear panes remain legible above the structure.
    for i,axle in enumerate(spec['axles']):
        for j,sign in enumerate([-1,1]):
            pivot=empty(f'wheel-{2*i+j}',root,(sign*spec['track']/2,cy,axle))
            tyre(pivot,spec,m)
    frame_y=g+h*.448
    for sign in [-1,1]:
        box('Long rectangular ladder frame rail',(sign*w*.20,frame_y,0),(w*.052,h*.065,l*.79),m['frame'],body,.012,3)
        # Upper pickup mounting rail and diagonal cage have real gaps around them.
        rod('Raised body support rail',(sign*w*.29,g+h*.558,-l*.39),(sign*w*.29,g+h*.558,l*.43),w*.017,m['frame'],body)
        for z in [-.30,-.12,.10,.31]:
            rod('Triangulated pickup mounting brace',(sign*w*.20,frame_y,l*(z-.055)),
                (sign*w*.29,g+h*.56,l*(z+.055)),w*.019,m['frame'],body)
        rod('Forward cage diagonal',(sign*w*.20,frame_y,-l*.36),(sign*w*.30,g+h*.66,-l*.245),w*.019,m['frame'],body)
        rod('Rear cage diagonal',(sign*w*.20,frame_y,l*.35),(sign*w*.30,g+h*.63,l*.25),w*.019,m['frame'],body)
    for z in [-.35,-.16,.02,.20,.37]:
        box('Ladder frame crossmember',(0,frame_y,l*z),(w*.44,h*.040,l*.025),m['frame'],body,.008,3)
    for z0,z1 in [(-.33,-.17),(.035,.19),(.20,.36)]:
        rod('Underfloor X brace',(-w*.20,frame_y-h*.025,l*z0),(w*.20,frame_y-h*.025,l*z1),w*.014,m['darkmetal'],body)
        rod('Underfloor X brace',(w*.20,frame_y-h*.025,l*z0),(-w*.20,frame_y-h*.025,l*z1),w*.014,m['darkmetal'],body)
    box('Clean enclosed powertrain',(0,g+h*.505,-l*.045),(w*.31,h*.13,l*.15),m['darkmetal'],body,.025,4)
    box('Transfer case',(0,g+h*.404,0),(w*.16,h*.075,l*.072),m['alloy'],body,.012,3)
    for i,axle in enumerate(spec['axles']):
        group=empty('axle-front' if i==0 else 'axle-rear',root)
        rod('Heavy live axle tube',(-spec['track']/2,cy,axle),(spec['track']/2,cy,axle),w*.035,m['darkmetal'],group,12)
        cylinder('Differential housing',(0,cy,axle),spec['wheelRadius']*.30,l*.050,m['darkmetal'],group,axis='z',sides=12)
        cylinder('Differential bolted face',(0,cy,axle+(l*.028 if i else -l*.028)),spec['wheelRadius']*.23,
                 l*.009,m['alloy'],group,axis='z',sides=12)
        rod('Drive shaft',(0,g+h*.404,0),(0,cy,axle),w*.027,m['alloy'],body,12)
        for sign in [-1,1]:
            # The old show-truck shocks sat on the wheel centreline. Their coils and seats therefore
            # occupied the tyre's rubber torus, which was visible as springs passing through the tread.
            # Mount the paired shocks just outside the frame rail but wholly inside the tyre's inner face.
            x=sign*w*.220
            box('Axle suspension bracket',(x,cy+h*.037,axle),(w*.064,h*.068,l*.032),m['frame'],group,.007,3)
            for offset in [-l*.035,l*.035]:
                bottom=(x,cy+h*.06,axle+offset)
                upper=(sign*w*.240,g+h*.742,axle+offset+(l*.025 if i==0 else -l*.025))
                rod('Inboard upper shock tower',(sign*w*.20,g+h*.558,axle+offset),upper,w*.023,m['frame'],body)
                bv,uv=Vector(bottom),Vector(upper)
                rod('Sliding lower shock piston',bottom,tuple(bv.lerp(uv,.68)),w*.016,m['alloy'],group)
                rod('Body mounted upper shock sleeve',tuple(bv.lerp(uv,.42)),upper,w*.034,m['shock'],body)
                coil('Long travel coil spring',tuple(bv.lerp(uv,.43)),tuple(bv.lerp(uv,.95)),w*.048,w*.008,m['frame'],body,7)
                for t in [.40,.95]:
                    center=bv.lerp(uv,t);axis=(uv-bv).normalized()
                    rod('Coil spring seat',tuple(center-axis*h*.009),tuple(center+axis*h*.009),w*.061,m['darkmetal'],body)
            # Lower links lead into the frame well inside the giant wheel wells.
            inward=-1 if i else 1
            rod('Lower four link arm',(sign*w*.24,cy-h*.035,axle),
                (sign*w*.18,g+h*.387,axle+inward*l*.205),w*.023,m['frame'],body)
            rod('Upper four link arm',(sign*w*.12,cy+h*.10,axle),
                (sign*w*.17,g+h*.445,axle+inward*l*.155),w*.019,m['darkmetal'],body)
        consolidate(group,'Moving live axle geometry')
    hood=body_loft('Raised modern pickup hood and front fenders',[
        (-l*.478,.85,g+h*.660,g+h*.690),(-l*.440,.99,g+h*.735,g+h*.744),
        (-l*.28,1,g+h*.751,g+h*.762),(-l*.185,.96,g+h*.751,g+h*.769)],
        g+h*.48,w*.77,m['paint'],body,rounding=.16)
    arch_cut(hood,spec,.07)
    lower=box('Tall single cab lower door body',(0,g+h*.655,-l*.027),
              (w*.76,h*.245,l*.316),m['paint'],body,.024,4)
    cab=cabin(body,m,-l*.185,-l*.071,l*.082,l*.130,g+h*.745,g+h*.975,
              w*.377,w*.329,.010,front_window_bottom=.22,side_window_front_bottom=.19,
              rear_window_bottom=.09,side_window_rear_bottom=.09)
    crown_roof('Rounded closed pickup roof',[(-l*.078,.94,.45),(-l*.057,1,1),
               (l*.072,1,1),(l*.10,.94,.45)],w*.69,g+h*.967,h*.033,m['paint'],body)
    # Eight large round driving lamps echo the reference's full-width roof row.
    lamp_radius=w*.044
    roof_light_bar(body,[(w*(i-3.5)*.090,g+h*1.04+lamp_radius,-l*.085)
                        for i in range(8)],lamp_radius,g+h*.979,w*.305,m)
    # Open cargo bed: floor, front bulkhead, narrow side walls and separate gate.
    bed_sides=[]
    for sign in [-1,1]:
        side=box('Separate pickup cargo bed side',(sign*w*.360,g+h*.620,l*.322),
                 (w*.045,h*.250,l*.316),m['paint'],body,.018,3)
        arch_cut(side,spec,.065);bed_sides.append(side)
        box('Bed upper protective rail',(sign*w*.358,g+h*.747,l*.322),(w*.058,h*.022,l*.319),m['trim'],body,.008,3)
    box('Open cargo bed floor',(0,g+h*.536,l*.322),(w*.68,h*.033,l*.307),m['trim'],body,.008,3)
    for x in [-.27,-.18,-.09,0,.09,.18,.27]:
        box('Bed floor raised rib',(w*x,g+h*.557,l*.32),(w*.014,h*.014,l*.277),m['darkmetal'],body,.004,2)
    box('Cargo bed front bulkhead',(0,g+h*.626,l*.162),(w*.70,h*.23,l*.027),m['paint'],body)
    gate=box('Independent tailgate',(0,g+h*.620,l*.478),(w*.735,h*.25,l*.027),m['paint'],body,.015,3)
    box('Tailgate top rail',(0,g+h*.749,l*.478),(w*.74,h*.018,l*.032),m['trim'],body,.006)
    box('Tailgate recessed latch',(0,g+h*.697,l*.494),(w*.095,h*.028,.009),m['darkmetal'],body,.006)
    # A small roll hoop behind the cab is modern show-truck fabrication, clean
    # and symmetric. The open bed and unbroken cab roof remain visually separate.
    hoop=[(-w*.285,g+h*.565,l*.185),(-w*.285,g+h*.82,l*.185),
          (-w*.22,g+h*.87,l*.185),(w*.22,g+h*.87,l*.185),
          (w*.285,g+h*.82,l*.185),(w*.285,g+h*.565,l*.185)]
    for a,b in zip(hoop,hoop[1:]):rod('Open bed safety hoop',a,b,w*.018,m['frame'],body)
    for sign in [-1,1]:
        rod('Bed hoop diagonal',(sign*w*.275,g+h*.815,l*.185),(sign*w*.28,g+h*.56,l*.375),w*.016,m['frame'],body)
        
        x=sign*w*.383
        line('Pickup door shut line',[(x,g+h*.755,-l*.166),(x,g+h*.563,-l*.166),
              (x,g+h*.552,l*.068),(x,g+h*.755,l*.083)],.002,m['trim'],body)
        box('Door pull',(x+sign*.004,g+h*.734,l*.031),(.018,h*.025,l*.040),m['alloy'],body,.006)
        rod('Mirror mounting stalk',(sign*w*.37,g+h*.80,-l*.15),(sign*w*.437,g+h*.80,-l*.159),w*.008,m['trim'],body)
        box('Pickup mirror housing',(sign*w*.46,g+h*.823,-l*.153),(w*.062,h*.082,l*.038),m['mirrorHousing'],body,.014,4)
        box('Pickup mirror insert',(sign*w*.46,g+h*.825,-l*.132),(w*.046,h*.061,.004),m['mirror'],body,.007)
        box('High side step',(sign*w*.35,g+h*.51,-l*.025),(w*.08,h*.03,l*.21),m['frame'],body,.008)
        # Flame projection spans three distinct physical panels, preserving the
        # visible break between the driving cab and the independent pickup bed.
        for name,surface,z0,z1,y0,y1 in [
            ('Front fender flame',hood,-.463,-.197,.59,.73),
            ('Door flame',lower,-.17,.116,.562,.754),
            ('Bed side flame',bed_sides[0 if sign<0 else 1],.181,.467,.577,.730)]:
            def projection(u,v,lift,surface=surface,z0=z0,z1=z1,y0=y0,y1=y1,sign=sign):
                z=l*(z0+(z1-z0)*u);y=g+h*(y0+(y1-y0)*v)
                hit,p,_,_=surface.ray_cast(Vector(xyz((sign*w,y,z))),Vector((-sign,0,0)))
                if not hit:raise ValueError(f'{name} misses body at {u}, {v}')
                return (p.x+sign*lift,p.z,-p.y)
            flames(name,projection,m['flameRed'],m['orange'],body)
        def skull_projection(u,v,lift,sign=sign):
            z=l*(-.051+u*.072);y=g+h*(.671+v*.102)
            hit,p,_,_=lower.ray_cast(Vector(xyz((sign*w,y,z))),Vector((-sign,0,0)))
            if not hit:raise ValueError('Door skull misses body')
            return (p.x+sign*lift,p.z,-p.y)
        skull('Original door skull',skull_projection,m,body)
    def rear_skull(u,v,lift):
        x=w*u*.11;y=g+h*(.619+v*.080)
        hit,p,_,_=gate.ray_cast(Vector(xyz((x,y,l))),Vector((0,1,0)))
        if not hit:raise ValueError('Tailgate skull misses body')
        return (p.x,p.z,-p.y+lift)
    skull('Original tailgate skull',rear_skull,m,body)
    for sign in [-1,1]:
        def rear_flame(u,v,lift,sign=sign):
            x=sign*w*(.34-u*.20);y=g+h*(.535+v*.18)
            hit,p,_,_=gate.ray_cast(Vector(xyz((x,y,l))),Vector((0,1,0)))
            if not hit:raise ValueError('Tailgate flame misses body')
            return (p.x,p.z,-p.y+lift)
        flames('Tailgate flame',rear_flame,m['flameRed'],m['orange'],body)
    # A broad unbranded modern pickup grille, separated lamps and narrow steel
    # bumpers complete a normal pre-disaster show vehicle, not a scrapyard car.
    front=-l*.481
    box('Unbranded grille surround',(0,g+h*.660,front),(w*.56,h*.175,.023),m['darkmetal'],body,.018,4)
    box('Deep radiator aperture',(0,g+h*.663,front-.014),(w*.52,h*.137,.008),m['trim'],body,.012)
    for y in [.620,.655,.690]:
        box('Horizontal brushed grille bar',(0,g+h*y,front-.020),(w*.49,h*.009,.012),m['alloy'],body,.004)
    for sign in [-1,1]:
        x=sign*w*.324
        box('Independent headlamp black housing',(x,g+h*.669,front-.004),(w*.103,h*.150,.031),m['trim'],body,.015,4)
        for y in [.639,.699]:
            box('Stacked clear pickup headlamp',(x,g+h*y,front-.023),(w*.081,h*.042,.008),m['white'],body,.008,3)
        box('Front amber indicator',(sign*w*.373,g+h*.670,front-.014),(w*.025,h*.102,.012),m['amber'],body,.006)
        box('Vertical tail lamp housing',(sign*w*.335,g+h*.649,l*.496),(w*.044,h*.154,.018),m['trim'],body,.007)
        box('Vertical red tail lamp',(sign*w*.335,g+h*.659,l*.507),(w*.031,h*.113,.008),m['red'],body,.005)
    for z in [-l*.493,l*.493]:
        box('Narrow clean steel bumper',(0,g+h*.535,z),(w*.79,h*.065,l*.035),m['frame'],body,.014,3)
        for sign in [-1,1]:
            rod('Visible bumper mounting strut',(sign*w*.19,frame_y,z*.8),(sign*w*.26,g+h*.53,z),w*.021,m['frame'],body)
    box('Front perforated skid plate',(0,g+h*.410,-l*.27),(w*.42,h*.024,l*.19),m['darkmetal'],body,.008)
    prepare_glazing(body,authored_body)
    close_surfaces(root,m['trim'])
    consolidate(body,'Body geometry')
    return root


def inspect(path,spec,directory):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    root=import_delivered(ID);bpy.context.view_layer.update()
    points=[obj.matrix_world@v.co for obj in root.children_recursive if obj.type=='MESH' for v in obj.data.vertices]
    lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
    bounds=[[lo[0],lo[2],-hi[1]],[hi[0],hi[2],-lo[1]]]
    payload=path.read_bytes();length=int.from_bytes(payload[12:16],'little');doc=json.loads(payload[20:20+length])
    tris=sum(doc['accessors'][p['indices']]['count']//3 for item in doc['meshes'] for p in item['primitives'])
    wheels={obj.name:[obj.location.x,obj.location.z,-obj.location.y] for obj in root.children if obj.name.startswith('wheel-')}
    for i,z in enumerate(spec['axles']):
        for j,sign in enumerate([-1,1]):
            expected=[sign*spec['track']/2,spec['anchorY']-spec['suspensionRest']+spec['wheelRadius'],z]
            if any(abs(a-b)>1e-6 for a,b in zip(wheels[f'wheel-{2*i+j}'],expected)):
                raise RuntimeError('Wheel pivot differs from catalogue')
    if abs(bounds[0][1]-(spec['anchorY']-spec['suspensionRest']))>1e-6:
        raise RuntimeError('Giant tyre tread does not touch catalogue ground')
    for name in ['axle-front','axle-rear']:
        part=next(obj for obj in root.children if obj.name==name)
        if part.location.length>1e-7 or part.rotation_euler.to_quaternion().angle>1e-7:
            raise RuntimeError('Axle root must have identity transform')
    result={'id':ID,'bytes':len(payload),'triangles':tris,'bounds':bounds,
        'dimensions':[bounds[1][i]-bounds[0][i] for i in range(3)],'wheelPivots':wheels,
        'wheelRadius':spec['wheelRadius'],'wheelWidth':spec['wheelWidth'],
        'materials':[m['name'] for m in doc['materials']], 'sha256':hashlib.sha256(payload).hexdigest(),
        'axes':'+Y up, -Z forward','authoredNonManifoldEdges':0,
        'movingAxles':['axle-front','axle-rear'],'textures':len(doc.get('textures',[]))}
    print(json.dumps(result),flush=True)
    if directory:
        directory.mkdir(parents=True,exist_ok=True)
        (directory/(ID+'.json')).write_text(json.dumps(result,indent=2)+'\n')
    return root


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--render-dir',type=Path);parser.add_argument('--reference',type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    spec=next(item for item in CATALOGUE['vehicles'] if item['id']==ID)
    path=ROOT/'game/public/models/cars'/f'{ID}.glb'
    authored=modelling_spec(spec)
    root=build(authored);export(root,path,authored['detailScale'])
    directory=ROOT/args.render_dir if args.render_dir else None
    root=inspect(path,spec,directory)
    if directory:
        render_views(root,spec,directory)
        render_reference(spec,directory)
    if args.reference:
        target=ROOT/args.reference;target.parent.mkdir(parents=True,exist_ok=True)
        if directory:target.write_bytes((directory/(ID+'.png')).read_bytes())
        else:
            render_reference(spec,target.parent)
            generated=target.parent/(ID+'.png')
            if generated!=target:generated.replace(target)


if __name__=='__main__':main()
