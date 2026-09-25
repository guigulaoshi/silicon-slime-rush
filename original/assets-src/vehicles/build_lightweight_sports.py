"""Build an original closed-roof lightweight coupe; no external art or textures.

Blender --background --python-exit-code 1 --python
assets-src/vehicles/build_lightweight_sports.py -- --render-dir tmp/lightweight-sports

The catalogue owns all physical dimensions and moving-wheel positions. Geometry
uses common.modelling_spec/export, including the project's detailScale. Delivered
axes are +Y up, -Z forward, with the same body/wheel-0..3 rig as the other cars.
A narrow, rounded short-tail fastback, conventional doors, oval projector lamps,
and silver five-spoke wheels distinguish it from the orange mid-engine aero car.
The roof is painted and closed, with lightly smoked glazing and no visible people.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (ROOT, CATALOGUE, modelling_spec, xyz, empty, material, mesh,
                    box, line, loft, radial, body_loft, arch_cut, arch_cover, curve_stations,
                    prepare_glazing, round_section, curved_surface, consolidate, export, render_views, wheel_fasteners)
from build_compact_cars import materials, sedan_patch
from render_garage_references import render_reference, import_delivered

ID = 'lightweight-sports'


def cylinder(name, center, radius, depth, mat, parent, axis='x', sides=24):
    x, y, z = center
    vertices = []
    for a in [-depth/2, depth/2]:
        for i in range(sides):
            t = i*math.tau/sides
            vertices.append((x+a, y+radius*math.sin(t), z+radius*math.cos(t)) if axis == 'x'
                            else (x+radius*math.cos(t), y+radius*math.sin(t), z+a))
    faces = [tuple(reversed(range(sides))), tuple(range(sides, 2*sides))]
    faces += [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
    return curved_surface(mesh(name,vertices,faces,mat,parent),55)


def running_wheel(pivot, spec, m):
    r, w = spec['wheelRadius'], spec['wheelWidth']/2
    radial('Rounded low profile tyre', [(-w*.88,r*.68),(-w,r*.80),(-w*.79,r*.96),
        (-w*.53,r),(-w*.28,r),(-w*.20,r*.983),(-w*.12,r),
        (w*.12,r),(w*.20,r*.983),(w*.28,r),(w*.53,r),(w*.79,r*.96),(w,r*.80),(w*.88,r*.68)],
        m['rubber'],pivot,64)
    for sign in [-1,1]:
        a=sign*w*.98
        radial('Silver outer wheel rim',[(a,r*.66),(a,r*.755),(a-sign*.01,r*.755),
               (a-sign*.01,r*.66)],m['alloy'],pivot,48)
        cylinder('Recessed brake disc',(a-sign*.015,0,0),r*.635,.009,m['brake'],pivot)
        # The hub face stays flush with the spokes; at the 378 size a deeper
        # hub pushed the assembled wheel past the contract's width tolerance.
        cylinder('Five spoke hub',(a,0,0),r*.17,.010,m['alloy'],pivot,sides=16)
        wheel_fasteners(pivot,r*.755,a,sign,m['darkmetal'])
        for i in range(5):
            angle=i*math.tau/5
            points=[]
            for xx in [a-sign*.007,a+sign*.005]:
                for rr,delta in [(r*.14,-.27),(r*.70,-.085),(r*.70,.085),(r*.14,.27)]:
                    points.append((xx,rr*math.sin(angle+delta),rr*math.cos(angle+delta)))
            obj=mesh('Cast silver spoke',points,[(0,3,2,1),(4,5,6,7),
                (0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],m['alloy'],pivot)
            curved_surface(obj,55)
    consolidate(pivot,'Running wheel geometry')


def projected_nose_lamp(name,shell,x,y,rx,ry,mat,parent,lift,rings=((1,0),(.80,.003),(.16,.005))):
    """Concentric closed rings cast onto the nose along the surface normal at the
    lamp centre, so the lens faces the way the nose does there: mostly forward,
    with the slight upward rake of the bonnet roll. Casting straight down put
    the old lamps flat on the bonnet, looking at the sky. The crown is a raised
    closed lens. Returns the mesh, the lamp centre and its axis (Blender space)."""
    hit,centre,axis,_=shell.ray_cast(Vector(xyz((x,y,-3))),Vector((0,-1,0)))
    if not hit:raise ValueError(name+' misses nose')
    axis=axis.normalized()
    across=Vector((0,0,1)).cross(axis).normalized()
    upward=axis.cross(across)
    vertices=[];sides=24
    for fraction,extra in rings:
        for i in range(sides):
            t=i*math.tau/sides
            start=centre+axis*.5+across*(rx*fraction*math.cos(t))+upward*(ry*fraction*math.sin(t))
            hit,p,_,_=shell.ray_cast(start,-axis)
            if not hit:raise ValueError(name+' misses nose')
            p+=axis*(lift+extra)
            vertices.append((p.x,p.z,-p.y))
    faces=[(j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i)
           for j in range(len(rings)-1) for i in range(sides)]
    faces.append(tuple((len(rings)-1)*sides+i for i in range(sides)))
    obj=mesh(name,vertices,faces,mat,parent)
    # An open patch has no volume to orient by. A lens facing into the body is
    # culled, so check the crown against the lamp axis instead of trusting it.
    if Vector(obj.data.polygons[-1].normal).dot(axis)<0:
        bpy.context.view_layer.objects.active=obj;obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.flip_normals();bpy.ops.object.mode_set(mode='OBJECT');obj.select_set(False)
    return curved_surface(obj,60),centre,axis


def projected_rear_lamp(name,shell,x,y,radius,length,mat,parent,lift):
    vertices=[];sides=24
    for fraction,extra in [(1,0),(.78,.0015),(.16,.003)]:
        for i in range(sides):
            angle=i*math.tau/sides
            xx,yy=x+radius*fraction*math.cos(angle),y+radius*fraction*math.sin(angle)
            hit,p,_,_=shell.ray_cast(Vector(xyz((xx,yy,length))),Vector((0,1,0)))
            if not hit:raise ValueError(name+' misses rounded tail')
            vertices.append((xx,yy,-p.y+lift+extra))
    faces=[(j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i)
           for j in range(2) for i in range(sides)]
    faces.append(tuple(2*sides+i for i in range(sides)))
    return curved_surface(mesh(name,vertices,faces,mat,parent),60)


def close_surfaces(root, backing):
    """Give decorative patches real thickness; all delivered components close."""
    for obj in root.children_recursive:
        if obj.type!='MESH':continue
        bm=bmesh.new();bm.from_mesh(obj.data)
        boundary=any(e.is_boundary for e in bm.edges)
        bm.free()
        if boundary:
            bpy.context.view_layer.objects.active=obj
            modifier=obj.modifiers.new('Closed manufactured surface','SOLIDIFY')
            modifier.thickness=.0012
            modifier.offset=-1
            modifier.use_rim=True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        bm=bmesh.new();bm.from_mesh(obj.data)
        count=sum(not e.is_manifold for e in bm.edges)
        bm.free()
        if count:raise RuntimeError(f'{obj.name}: {count} non-manifold edges')


def build(spec):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes,bpy.data.curves,bpy.data.materials):
        for data in list(collection):
            if data.users==0:collection.remove(data)
    root=empty('vehicle-root');body=empty('body',root)
    m=materials((.018,.38,.46))
    m['mirror']=material('Reflective side mirror',(.16,.23,.26),.8,.12)
    # The independent mirror housing is a fitting, not the cabin shell.
    m['mirrorHousing']=material('Mirror housing paint',(.018,.38,.46),.22,.31)
    g=spec['anchorY']-spec['suspensionRest'];cy=g+spec['wheelRadius']
    w,h,l=spec['size']
    for i,axle in enumerate(spec['axles']):
        for j,sign in enumerate([-1,1]):
            pivot=empty(f'wheel-{2*i+j}',root,(sign*spec['track']/2,cy,axle))
            running_wheel(pivot,spec,m)
    # A rounded, near-constant-width lower body avoids the pinched waist and
    # oversized rear haunches of the existing mid-engine high-performance car.
    stations=[(-l*.50,.72,g+h*.325,g+h*.34),(-l*.475,.88,g+h*.45,g+h*.48),
        (-l*.40,.97,g+h*.54,g+h*.56),(-l*.30,1,g+h*.57,g+h*.57),
        (-l*.19,.96,g+h*.545,g+h*.55),(0,.965,g+h*.535,g+h*.54),
        (l*.25,1,g+h*.56,g+h*.57),(l*.40,.96,g+h*.52,g+h*.545),
        (l*.485,.87,g+h*.43,g+h*.45),(l*.50,.78,g+h*.34,g+h*.37)]
    shell=body_loft('Soft continuous compact coupe body',stations,g+h*.115,w,m['paint'],body,rounding=.23)
    arch_cut(shell,spec,.017)
    # The coupe's shoulder is narrower than its track, so the cut left the tyre open to
    # the sky. Same clearance as the cut, so the cover sits in it rather than proud of it.
    arch_cover(spec,.017,m['paint'],body)
    # A single closed glasshouse with a real painted roof: no open cabin, roof
    # cutout, exposed seats, engine window, buttresses, or racing wing.
    roof_stations=[(-.25,.55,.34),(-.19,.72,.33),(-.10,.93,.30),
                   (-.02,.997,.296),(.115,.982,.29),(.21,.895,.292),
                   (.30,.75,.315),(.37,.565,.345)]
    sampled=curve_stations(roof_stations,4)
    sections=[]
    for z,top,half in sampled:
        sections.append(round_section([(-w*.423,g+h*.49,l*z),(w*.423,g+h*.49,l*z),
            (w*.412,g+h*.565,l*z),(w*half,g+h*(top-.048),l*z),
            (w*half*.60,g+h*(top-.006),l*z),(0,g+h*top,l*z),
            (-w*half*.60,g+h*(top-.006),l*z),(-w*half,g+h*(top-.048),l*z),
            (-w*.412,g+h*.565,l*z)],.21,3))
    upper=loft('Rounded closed fastback glasshouse',sections,m['paint'],body)
    def top_at(z):
        for a,b in zip(sampled,sampled[1:]):
            if a[0]<=z<=b[0]:return a[1]+(b[1]-a[1])*(z-a[0])/(b[0]-a[0])
        raise ValueError('Glass sample outside roof')
    for sign in [-1,1]:
        def side_rows(inset,z0,z1):
            rows=[]
            for i in range(13):
                t=inset+(1-2*inset)*i/12;z=z0+(z1-z0)*t
                low=.586;high=top_at(z)-.105
                rows.append([(sign*w,g+h*(low+(high-low)*(inset+(1-2*inset)*j/5)),l*z)
                             for j in range(6)])
            return rows
        for name,z0,z1 in [('Door side window',-.177,.122),('Fixed quarter window',.141,.29)]:
            sedan_patch(name+' seal',upper,side_rows(0,z0,z1),m['trim'],body,(-sign,0,0),.0015)
            sedan_patch(name,upper,side_rows(.055,z0,z1),m['glass'],body,(-sign,0,0),.0035)
    for name,z0,z1,a,b in [('Curved front windscreen',-.226,-.070,.30,.235),
                           ('Sloping rear hatch glass',.155,.338,.231,.284)]:
        def rows(inset):
            result=[]
            for i in range(13):
                t=inset+(1-2*inset)*i/12;half=a+(b-a)*t
                result.append([(w*half*(-1+2*(inset+(1-2*inset)*j/10)),g+h*1.15,l*(z0+(z1-z0)*t))
                               for j in range(11)])
            return result
        sedan_patch(name+' seal',upper,rows(0),m['trim'],body,(0,-1,0),.0015)
        sedan_patch(name,upper,rows(.05),m['glass'],body,(0,-1,0),.0035)
    def flank(sign,zy,lift=.0025):
        points=[]
        for z,y in zy:
            hit,p,_,_=shell.ray_cast(Vector(xyz((sign*w,g+h*y,l*z))),Vector((-sign,0,0)))
            if not hit:raise ValueError(f'Coupe door misses body: {z}, {y}')
            points.append((p.x+sign*lift,p.z,-p.y))
        return points
    for sign in [-1,1]:
        corners=[(-.188,.54),(-.187,.28),(-.16,.18),(.096,.18),(.13,.29),(.13,.54)]
        seam=[]
        for a,b in zip(corners,corners[1:]):
            seam += [tuple(Vector(a).lerp(Vector(b),i/8)) for i in range(8)]
        line('Conventional two door shut line',flank(sign,seam+[corners[-1]]),.0012,m['trim'],body)
        line('Small flush door handle',flank(sign,[(.052,.49),(.103,.49)],.004),.0032,m['alloy'],body)
        box('Modest lower sill',(sign*w*.468,g+h*.135,0),(w*.035,h*.045,l*.43),m['trim'],body,.007,3)
        line('Short mirror stalk',[(sign*w*.375,g+h*.67,-l*.155),(sign*w*.472,g+h*.69,-l*.15)],.005,m['trim'],body)
        box('Compact painted mirror',(sign*w*.492,g+h*.715,-l*.149),(w*.075,h*.064,l*.05),m['mirrorHousing'],body,.014,4)
        box('Side mirror glass',(sign*w*.492,g+h*.712,-l*.121),(w*.060,h*.042,.003),m['mirror'],body,.007,3)
        # Headlamps sit on the front corners where the bonnet rolls down into the
        # nose, on the band whose surface already faces forward. The amber
        # indicator is a small matching oval on the front face under each lamp.
        projected_nose_lamp('Independent oval headlamp seal',shell,sign*w*.295,g+h*.406,w*.085,h*.0875,m['trim'],body,.004)
        _,centre,axis=projected_nose_lamp('Independent oval headlamp lens',shell,sign*w*.295,g+h*.406,w*.074,h*.074,m['white'],body,.0075)
        if sign>0:
            print(json.dumps({'headlampCentre':[round(v*spec['detailScale'],4) for v in (centre.x,centre.z,-centre.y)],
                              'headlampAxis':[round(v,3) for v in (axis.x,axis.z,-axis.y)]}),flush=True)
        projected_nose_lamp('Front amber turn indicator',shell,sign*w*.32,g+h*.285,w*.033,h*.019,m['amber'],body,.003,
                            rings=((1,0),(.5,.002),(.15,.003)))
        # Rear lamps sit on the very short tail, with two distinct round lenses
        # per side. Their filled bodies remain visible from the chase camera.
        for j in [0,1]:
            x=sign*w*(.235+j*.104)
            y=g+h*.417
            projected_rear_lamp('Round tail lamp bezel',shell,x,y,h*.064,l,m['trim'],body,.002)
            projected_rear_lamp('Round red tail lamp',shell,x,y,h*.050,l,m['red'],body,.004)
    box('Small lower front intake',(0,g+h*.248,-l*.497),(w*.49,h*.087,.013),m['trim'],body,.018,5)
    box('Single lower intake bar',(0,g+h*.237,-l*.505),(w*.42,.006,.007),m['darkmetal'],body,.002)
    box('Subtle front valance',(0,g+h*.142,-l*.465),(w*.70,h*.033,l*.055),m['trim'],body,.009,3)
    box('Rear lower valance',(0,g+h*.18,l*.474),(w*.69,h*.054,l*.045),m['trim'],body,.01,3)
    cylinder('Single modest exhaust',(w*.28,g+h*.15,l*.489),h*.031,.034,m['alloy'],body,axis='z',sides=16)
    cylinder('Exhaust dark bore',(w*.28,g+h*.15,l*.508),h*.023,.003,m['trim'],body,axis='z',sides=16)
    # A shallow rear deck lip is part of the pressed body, not a racing wing.
    body_loft('Integrated rounded hatch trailing edge',[(l*.387,.79,g+h*.533,g+h*.554),
              (l*.425,.82,g+h*.522,g+h*.545),(l*.447,.80,g+h*.498,g+h*.52)],
              g+h*.49,w,m['paint'],body,rounding=.22)
    prepare_glazing(body,spec)
    close_surfaces(root,m['trim'])
    consolidate(body,'Body geometry')
    return root


def inspect_export(path,spec,directory):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    root=import_delivered(ID)
    bpy.context.view_layer.update()
    points=[obj.matrix_world@v.co for obj in root.children_recursive if obj.type=='MESH' for v in obj.data.vertices]
    lower=[min(p[i] for p in points) for i in range(3)]
    upper=[max(p[i] for p in points) for i in range(3)]
    bounds=[[lower[0],lower[2],-upper[1]],[upper[0],upper[2],-lower[1]]]
    payload=path.read_bytes();length=int.from_bytes(payload[12:16],'little')
    doc=json.loads(payload[20:20+length])
    triangles=sum(doc['accessors'][p['indices']]['count']//3 for mesh in doc['meshes'] for p in mesh['primitives'])
    wheels={obj.name:list((obj.location.x,obj.location.z,-obj.location.y)) for obj in root.children if obj.name.startswith('wheel-')}
    for i,axle in enumerate(spec['axles']):
        for j,sign in enumerate([-1,1]):
            expected=(sign*spec['track']/2,spec['anchorY']-spec['suspensionRest']+spec['wheelRadius'],axle)
            if any(abs(a-b)>1e-6 for a,b in zip(wheels[f'wheel-{2*i+j}'],expected)):
                raise RuntimeError('Delivered wheel pivot differs from catalogue')
    result={'id':ID,'bytes':len(payload),'triangles':triangles,'bounds':bounds,
            'dimensions':[bounds[1][i]-bounds[0][i] for i in range(3)],'wheelPivots':wheels,
            'materials':[m['name'] for m in doc['materials']],
            'sha256':hashlib.sha256(payload).hexdigest(),'axes':'+Y up, -Z forward',
            'authoredNonManifoldEdges':0,'bodyClosed':True,'roofClosed':True,'visibleDriver':False}
    if abs(bounds[0][1]-(spec['anchorY']-spec['suspensionRest']))>1e-6:
        raise RuntimeError('Tyre ground differs from catalogue')
    print(json.dumps(result),flush=True)
    if directory:
        directory.mkdir(parents=True,exist_ok=True)
        (directory/(ID+'.json')).write_text(json.dumps(result,indent=2)+'\n')
    return root


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--render-dir',type=Path)
    parser.add_argument('--reference',type=Path,help='Write the delivered-GLB garage PNG')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    spec=next(spec for spec in CATALOGUE['vehicles'] if spec['id']==ID)
    output=ROOT/'game/public/models/cars'/f'{ID}.glb'
    authored=modelling_spec(spec)
    root=build(authored);export(root,output,authored['detailScale'])
    directory=ROOT/args.render_dir if args.render_dir else None
    root=inspect_export(output,spec,directory)
    if directory:
        render_views(root,spec,directory)
        render_reference(spec,directory)
        # Compare against the delivered high-performance model without rebuilding it.
        old=next(item for item in CATALOGUE['vehicles'] if item['id']=='sports-car')
        render_reference(old,directory)
    if args.reference:
        target=ROOT/args.reference
        target.parent.mkdir(parents=True,exist_ok=True)
        if directory:
            target.write_bytes((directory/(ID+'.png')).read_bytes())
        else:
            render_reference(spec,target.parent)
            generated=target.parent/(ID+'.png')
            if generated!=target:generated.replace(target)


if __name__=='__main__':main()
