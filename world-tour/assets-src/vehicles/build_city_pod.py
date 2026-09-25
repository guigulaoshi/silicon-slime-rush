"""Build the B-reference City Pod; Blender 5.x, deterministic and self-contained.

  Blender --background --python assets-src/vehicles/build_city_pod.py -- \
      --render-dir tmp/model --reference docs/car-reference/city-pod.png

The door openings are actual holes. Glazing is a separate thin surface and the
menu and diagnostic images re-import the delivered GLB before rendering.
"""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (ROOT, CATALOGUE, modelling_spec, arch_cut, arch_cover, box, consolidate,
                    curved_surface, glazing, empty, export, line, material, mesh, panel,
                    radial, wheel, xyz)
from build_compact_cars import materials

N = 64


def ribbon(name, rings, mat, parent, smooth=True):
    """Concentric closed loops joined as an open annular surface."""
    count = len(rings[0])
    verts = [p for ring in rings for p in ring]
    faces = [(j*count+i,j*count+(i+1)%count,(j+1)*count+(i+1)%count,(j+1)*count+i)
             for j in range(len(rings)-1) for i in range(count)]
    obj = mesh(name, verts, faces, mat, parent, recalculate=False)
    return curved_surface(obj, 65) if smooth else obj


def build(spec):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes,bpy.data.curves,bpy.data.materials):
        for data in list(collection):
            if data.users == 0: collection.remove(data)
    root = empty("vehicle-root")
    body = empty("body", root)
    m = materials((.86,.875,.88))
    m["cyan"] = material("Cyan door perimeter light",(.015,.58,.95),.1,.23,1.3)
    m["seat"] = material("Blue slate seat upholstery",(.19,.28,.35),0,.81)
    m["seatInset"] = material("Light blue seat centre fabric",(.32,.42,.48),0,.86)
    m["interior"] = material("Interior graphite moulding",(.036,.054,.064),0,.75)
    m["mirror"] = material("Mirror reflective glass",(.13,.23,.30),.75,.13)
    m["mirrorHousing"] = material("Mirror housing paint",(.78,.81,.83),.22,.31)
    bpy.data.materials.remove(m["glass"])
    glass = glazing(alpha=.24)
    m["glass"] = glass
    canopy = glazing("Blue grey smoked glazing canopy",alpha=.34)
    ground = spec["anchorY"]-spec["suspensionRest"]
    cy = ground+spec["wheelRadius"]
    width,height,length = spec["size"]
    # Ratios to the catalogue preserve the reference silhouette across rescaling.
    sy,sz,sx = height/.85,length/1.25,width/.8
    def P(x,y,z): return (x*sx,y*sy,z*sz)
    def outer(t):
        c,s=math.cos(t),math.sin(t)
        y=.02+.369*c-.042*max(-s,0)**3
        y=max(-.335,y)
        z=.615*math.copysign(abs(s)**(.20 if c<0 else 1),s)
        nose=max(0,min(1,(abs(z)-.46)/.12))
        y=max(y,-.335+.065*nose*nose*(3-2*nose))
        x=.363-.052*max(c,0)**2-.044*abs(s)**4
        return x,y,z
    def door(t,scale=1,offset=0):
        c,s=math.cos(t),math.sin(t)
        return .368-.050*max(c*scale,0)**2+offset,.052+.303*scale*c,.038+.297*scale*s
    angles=[2*math.pi*i/N for i in range(N)]
    # Author both door rings as open sheets; they join the central body before
    # thickness and wheel cutouts are applied to the single connected shell.
    side_shells=[]
    for sign in (-1,1):
        rings=[]
        for j in range(5):
            u=j/4
            ring=[]
            for t in angles:
                ox,oy,oz=outer(t); ix,iy,iz=door(t,1.07)
                ring.append(P(sign*(ox*(1-u)+ix*u+.007*math.sin(math.pi*u)),oy*(1-u)+iy*u,oz*(1-u)+iz*u))
            rings.append(ring)
        vertices=[p for ring in rings for p in ring]
        faces=[]
        for j in range(4):
            for i in range(N):
                a=j*N+i;b=j*N+(i+1)%N;c=(j+1)*N+(i+1)%N;d=(j+1)*N+i
                face=(a,b,c,d)
                faces.append(face if sign>0 else tuple(reversed(face)))
        side_shells.append(mesh("Open door shell surface",vertices,faces,m["paint"],body,recalculate=False))
        for name,scales,offset,mat in [
            ("Circular door black seal",[1.068,1.010],.003,m["trim"]),
            ("Circular cyan door light",[1.010,.996],.007,m["cyan"]),
            ("Inner glazing surround",[.992,.969],.008,m["darkmetal"])]:
            rr=[]
            for scale in scales:
                rr.append([P(sign*x,y,z) for x,y,z in (door(t,scale,offset) for t in angles)])
            if sign<0: rr.reverse()
            ribbon(name,rr,mat,body)
        # Slightly convex transparent disc; opposing doors are visible from the
        # inside too. No transmission extension is required by the game renderer.
        rings=[]
        for j in range(9):
            scale=.97*(1-j/9)
            rings.append([P(sign*x,y,z) for x,y,z in
                          (door(t,scale,.010+.011*(1-scale*scale)) for t in angles)])
        rings.append([P(sign*(.368+.021),.052,.038)]*N)
        if sign<0: rings.reverse()
        ribbon("Transparent blue circular door",rings,glass,body)
    # Continuous transverse body band: white bumper and bonnet flow into the
    # actual smoked front screen/roof. The upper middle is glazing, not paint.
    cols=16
    vertices=[]
    for t in angles:
        ox,oy,oz=outer(t)
        for j in range(cols+1):
            u=j/cols
            vertices.append(P((2*u-1)*ox,oy+.018*math.sin(math.pi*u)*max(math.cos(t),0),oz))
    paint_faces=[];glass_faces=[];under_faces=[]
    for i,t in enumerate(angles):
        is_glass=(t<math.radians(61) or t>=math.radians(281))
        for j in range(cols):
            a=i*(cols+1)+j;b=a+1;d=((i+1)%N)*(cols+1)+j;c=d+1
            target_faces=(glass_faces if is_glass and 2<=j<cols-2 else
                          under_faces if outer(t)[1]<-.31 and outer(angles[(i+1)%N])[1]<-.31 else paint_faces)
            target_faces.append((a,d,c,b))
    shell=mesh("Unified eggshell body",vertices,paint_faces+under_faces,m["paint"],body,recalculate=False)
    shell.data.materials.append(m["interior"])
    for face in list(shell.data.polygons)[len(paint_faces):]:face.material_index=1
    # The shared perimeter is welded BEFORE solidification and boolean cutting.
    # Independent thickened panels leave doubled walls and torn-looking slivers
    # at a wheel cut. One manifold shell has no internal join wall to expose.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [shell,*side_shells]:obj.select_set(True)
    bpy.context.view_layer.objects.active=shell
    bpy.ops.object.join()
    bpy.ops.object.mode_set(mode="EDIT");bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=.000001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    mod=shell.modifiers.new("Unified manufactured shell thickness","SOLIDIFY")
    mod.thickness=.012;mod.offset=-1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    arch_cut(shell,spec,.013)
    # The pod's tall narrow shoulder left most of each tyre visible from overhead.
    arch_cover(spec,.013,m['paint'],body)
    curved_surface(shell,65)
    shell.select_set(False)
    curved_surface(mesh("Continuous panoramic front glass and roof",vertices,glass_faces,canopy,body,recalculate=False),65)
    # The floor remains below the circular door opening. Two separate seats are
    # deliberately legible through the blue glazing, including their headrests.
    box("Cabin floor",P(0,-.283,.05),P(.63,.036,.68),m["interior"],body,.015)
    for sign in (-1,1):
        x=sign*.158
        box("Individual seat base",P(x,-.177,.099),P(.248,.070,.274),m["seat"],body,.031,4)
        box("Light seat cushion",P(x,-.138,.075),P(.188,.018,.224),m["seatInset"],body,.018,3)
        obj=box("Individual high seat back",P(x,.019,.205),P(.24,.32,.076),m["seat"],body,.032,4)
        obj=box("Light backrest insert",P(x,.019,.162),P(.183,.25,.018),m["seatInset"],body,.025,4)
        box("Individual headrest",P(x,.215,.205),P(.159,.126,.075),m["seatInset"],body,.03,4)
        line("Seat belt",[P(x-sign*.085,.17,.155),P(x+sign*.075,-.125,.045)],.008,m["trim"],body)
    box("Low sculpted dashboard",P(0,-.012,-.276),P(.55,.075,.121),m["interior"],body,.025,4)
    box("Dashboard display",P(0,.032,-.259),P(.105,.009,.067),m["darkmetal"],body,.004)
    box("Display cyan indicator",P(0,.038,-.252),P(.078,.002,.004),m["cyan"],body)
    steering=empty("Steering column",body,P(-.155,.005,-.175))
    radial("Steering wheel",[(-.008,.062),(.008,.062),(.008,.073),(-.008,.073)],m["trim"],steering,24,"z")
    line("Steering lower spokes",[(-.05,0,0),(0,-.035,0),(.05,0,0)],.008,m["darkmetal"],steering)
    # Sample the manufactured nose instead of placing a planar lamp through a
    # curved body. Every lens/ring vertex has a measured outward clearance.
    def nose_point(x,y,lift=.004,rear=False):
        origin=Vector(xyz(P(x,y,2 if rear else -2)))
        hit,point,normal,_=shell.ray_cast(origin,Vector((0,1 if rear else -1,0)))
        if not hit:raise ValueError(f"Front decoration misses shell: {x}, {y}")
        point.y+=-lift if rear else lift
        return (point.x,point.z,-point.y)
    def nose_ellipse(name,cx,yt,rx,ry,scales,lift,mat):
        rings=[[nose_point(cx+rx*scale*math.cos(t),yt+ry*scale*math.sin(t),lift)
                for t in angles] for scale in scales]
        return ribbon(name,list(reversed(rings)),mat,body)
    for sign in (-1,1):
        nose_ellipse("Oval headlamp graphite bezel",sign*.225,-.075,.057,.070,[1,.86],.004,m["trim"])
        nose_ellipse("Oval headlamp cyan outline",sign*.225,-.075,.057,.070,[.86,.70],.006,m["cyan"])
        nose_ellipse("Oval headlamp dark lens",sign*.225,-.075,.057,.070,[.70,.5,.25,0],.007,m["darkmetal"])
        rings=[[nose_point(sign*.24+.036*scale*math.cos(t),-.070+.054*scale*math.sin(t),.006,True)
                for t in angles] for scale in (1,.75,.50,.25,0)]
        ribbon("Rear oval lamp",rings,m["red"],body)
    nose_ellipse("Rounded lower front intake",0,-.231,.193,.073,[1,.8,.6,.4,.2,0],.005,m["trim"])
    line("Front cyan running light",[nose_point(-.137+i*.274/16,-.246,.009) for i in range(17)],.004,m["cyan"],body)
    box("Rear bumper insert",P(0,-.266,.565),P(.40,.080,.043),m["trim"],body,.03,4)
    box("Rear red running light",P(0,-.247,.590),P(.27,.008,.004),m["red"],body,.003,3)
    for sign in (-1,1):
        # Mirrors have their own materials: they are opaque attachments, not
        # cabin glazing or an extension of the body paint's window footprint.
        line("Short mirror stalk",[P(sign*.319,.084,-.345),P(sign*.381,.084,-.35)],.009,m["trim"],body)
        box("Small mirror housing",P(sign*.385,.094,-.357),P(.040,.043,.071),m["mirrorHousing"],body,.014,3)
        box("Mirror reflective lens",P(sign*.385,.094,-.319),P(.028,.028,.003),m["mirror"],body,.004,2)
    for i,axle in enumerate(spec["axles"]):
        for j,sign in enumerate((-1,1)):
            pivot=empty(f"wheel-{2*i+j}",root,(sign*spec["track"]/2,cy,axle))
            radius=spec["wheelRadius"];half=spec["wheelWidth"]/2
            radial("Continuous road tyre",[(-half*.90,radius*.65),(-half,radius*.83),
                (-half*.72,radius*.96),(-half*.45,radius),(half*.45,radius),
                (half*.72,radius*.96),(half,radius*.83),(half*.90,radius*.65)],
                m["rubber"],pivot,64)
            # The wheel cover and hub share the tyre's axial envelope. Keep the
            # complete assembled wheel below the catalogue width tolerance; the
            # decorative centre must not extend another rim thickness outward.
            r=spec["wheelRadius"]*.77; a=sign*spec["wheelWidth"]*.48
            radial("White closed aero wheel disc",[(a-sign*.01,0),(a-sign*.01,r*.88),
                (a,r),(a+sign*.003,r*.80),(a+sign*.006,r*.19),(a+sign*.006,0)],m["paint"],pivot,64)
            # Hidden back caps sit inside the opaque wheel cover. Only outward
            # faces may occupy the exposed outer wheel-disc region.
            radial("Graphite circular wheel centre",[(a-sign*.010,0),(a-sign*.010,r*.19),
                (a+sign*.0085,r*.19),(a+sign*.0085,0)],m["darkmetal"],pivot,24)
            radial("Inset inner wheel closure",[(-a,0),(-a,r*.89),
                (-a+sign*.008,r*.89),(-a+sign*.008,0)],m["darkmetal"],pivot,24)
            radial("Small silver hub pin",[(a-sign*.009,0),(a-sign*.009,r*.075),
                (a+sign*.0105,r*.075),(a+sign*.0105,0)],m["alloy"],pivot,16)
            consolidate(pivot,"Running wheel geometry")
    joined=consolidate(body,"Body geometry")
    # Shared shoulder coordinates must share normals too. Weld only coincident
    # surface vertices; no geometric simplification or post-export editing.
    bpy.ops.object.select_all(action="DESELECT")
    joined.select_set(True);bpy.context.view_layer.objects.active=joined
    bpy.ops.object.mode_set(mode="EDIT");bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=.000001)
    bpy.ops.object.mode_set(mode="OBJECT");joined.select_set(False)
    for child in list(body.children):
        if child.type=="EMPTY":bpy.data.objects.remove(child,do_unlink=True)
    return root


def render_delivered(spec,directory=None,reference=None):
    bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/"game/public/models/cars/city-pod.glb"))
    scene=bpy.context.scene
    scene.render.engine="CYCLES";scene.cycles.device="CPU";scene.cycles.samples=48
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1280;scene.render.resolution_y=853;scene.render.resolution_percentage=100
    scene.world.color=(.30,.30,.30);scene.view_settings.view_transform="AgX"
    ground=spec["anchorY"]-spec["suspensionRest"]
    box("Studio floor",(0,ground-.011,0),(200,.020,200),material("Studio grey",(.30,.33,.36),roughness=.85),None)
    target=Vector(xyz((0,ground+spec["size"][1]*.48,0)))
    for name,location,power,size in [("Key",(-3,4,6),700,5),("Fill",(4,1,4),500,4),("Rim",(-1,-4,5),750,3)]:
        data=bpy.data.lights.new(name,"AREA");data.energy=power;data.shape="DISK";data.size=size
        obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
        obj.location=location;obj.rotation_euler=(target-obj.location).to_track_quat("-Z","Y").to_euler()
    data=bpy.data.cameras.new("Camera");cam=bpy.data.objects.new("Camera",data)
    bpy.context.collection.objects.link(cam);scene.camera=cam
    views=[("front-three-quarter",(2.3,1.04,-3.0)),("side",(3,.24,0)),
           ("rear-three-quarter",(2.3,1.04,3.0)),("front",(0,.36,-3.2))]
    for name,offset in views:
        if directory is None and name!="front-three-quarter":continue
        cam.location=target+Vector(xyz(offset));cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler()
        data.type="ORTHO" if name in ("side","front") else "PERSP";data.ortho_scale=1.95;data.lens=58
        out=reference if name=="front-three-quarter" and reference else directory/f"city-pod-{name}.png"
        out.parent.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(out);bpy.ops.render.render(write_still=True)
        if reference and directory and name=="front-three-quarter":
            import shutil
            directory.mkdir(parents=True,exist_ok=True);shutil.copyfile(out,directory/f"city-pod-{name}.png")


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--render-dir",type=Path);parser.add_argument("--reference",type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    spec=next(v for v in CATALOGUE["vehicles"] if v["id"]=="city-pod")
    authored=modelling_spec(spec)
    root=build(authored);export(root,ROOT/"game/public/models/cars/city-pod.glb",authored["detailScale"])
    if args.render_dir or args.reference:render_delivered(spec,ROOT/args.render_dir if args.render_dir else None,ROOT/args.reference if args.reference else None)


if __name__=="__main__":main()
