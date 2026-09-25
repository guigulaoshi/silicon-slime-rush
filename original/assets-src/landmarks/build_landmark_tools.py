"""Shared original landmark mesh tools; exported coordinates are east/up/south.

Metadata and projection remain owned by pipeline/landmarks.json and sr.geo.
Blender calls the project's Python environment for geographic calculations only.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_moffett_aircraft import audit_closed_primitives, xyz

ROOT = Path(__file__).resolve().parents[2]


def survey(identifier):
    code = '''
import json, sys
import numpy as np
from shapely.geometry import Polygon
from sr.geo import LocalFrame
from sr.landmark_data import model_anchor
entry = next(e for e in json.load(open('pipeline/landmarks.json'))['landmarks'] if e['id'] == sys.argv[1])
lat,lon = model_anchor(entry)
f = LocalFrame(lat,lon)
x,z = f.to_local(*np.asarray(entry['footprint']).T)
p = Polygon(zip(x,z))
c = np.zeros(2)
rect = np.asarray(p.minimum_rotated_rectangle.exterior.coords[:-1])
edges = np.roll(rect,-1,axis=0)-rect
axis = edges[np.argmax(np.linalg.norm(edges,axis=1))]
axis /= np.linalg.norm(axis)
if axis[1] < 0: axis = -axis
across = np.array([axis[1],-axis[0]])
ring = np.column_stack(((np.asarray(p.exterior.coords[:-1])-c)@across,(np.asarray(p.exterior.coords[:-1])-c)@axis))
print(json.dumps(dict(entry=entry,centre=[float(lat),float(lon)],axis=axis.tolist(),across=across.tolist(),ring=ring.tolist(),bounds=[ring.min(axis=0).tolist(),ring.max(axis=0).tolist()])))
'''
    return json.loads(subprocess.check_output([str(ROOT/'pipeline/.venv/bin/python'), '-c', code, identifier], cwd=ROOT, env={**__import__('os').environ, 'PYTHONPATH':str(ROOT/'pipeline')}, text=True))


class Model:
    def __init__(self, identifier):
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        self.identifier = identifier
        self.spec = survey(identifier)
        self.groups = {}
        self.materials = {}
        self.authored_components = 0

    def material(self, key, color, metal, rough, name=None):
        mat = bpy.data.materials.new(name or self.identifier+'_'+key)
        mat.diffuse_color = (*color, 1)
        mat.use_nodes = True
        node = mat.node_tree.nodes.get('Principled BSDF')
        node.inputs['Base Color'].default_value = (*color, 1)
        node.inputs['Metallic'].default_value = metal
        node.inputs['Roughness'].default_value = rough
        self.materials[key] = mat

    def point(self, p):
        u,y,v = p
        a,b = self.spec['across'], self.spec['axis']
        return (u*a[0]+v*b[0], y, u*a[1]+v*b[1])

    def mesh(self, label, vertices, faces, material, smooth=False):
        # Accumulate by material without joining thousands of separate objects.
        group = self.groups.setdefault(material, [[],[],[]])
        offset = len(group[0])
        group[0].extend(xyz(self.point(p)) for p in vertices)
        group[1].extend(tuple(i+offset for i in face) for face in faces)
        group[2].extend([smooth]*len(faces))
        self.authored_components += 1

    def shell(self, label, outline, offset, material):
        n = len(outline)
        self.mesh(label, outline+[tuple(p[k]+offset[k] for k in range(3)) for p in outline],
                  [tuple(reversed(range(n))),tuple(range(n,2*n))]+
                  [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)], material)

    def box(self, label, centre, size, material):
        x,y,z = centre
        a,b,c = (d/2 for d in size)
        self.shell(label, [(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y-b,z+c),(x-a,y-b,z+c)], (0,2*b,0), material)

    def tube(self, label, points, radius, material, sides=8):
        # One continuous closed tube avoids bright rings at every curve sample.
        vertices=[]
        for i,p in enumerate(points):
            tangent = (Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])).normalized()
            other = Vector((0,1,0)) if abs(tangent.y)<.9 else Vector((1,0,0))
            u=tangent.cross(other).normalized();v=tangent.cross(u).normalized()
            vertices.extend(tuple(Vector(p)+radius*(u*math.cos(j*math.tau/sides)+v*math.sin(j*math.tau/sides))) for j in range(sides))
        faces=[tuple(reversed(range(sides))),tuple((len(points)-1)*sides+j for j in range(sides))]
        faces += [(i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j) for i in range(len(points)-1) for j in range(sides)]
        self.mesh(label,vertices,faces,material,True)

    def patch(self, label, rows, depth, material, smooth=False):
        """Close a parameterized surface with matching inward offset samples."""
        nv,nu=len(rows),len(rows[0])
        front=[p for row in rows for p in row]
        back=[tuple(p[k]+depth[k] for k in range(3)) for p in front]
        n=len(front)
        faces=[]
        for j in range(nv-1):
            for i in range(nu-1):
                a=j*nu+i;b=a+1;c=a+nu+1;d=a+nu
                faces += [(a,b,c,d),(n+d,n+c,n+b,n+a)]
        boundary=list(range(nu))+[j*nu+nu-1 for j in range(1,nv)]+[(nv-1)*nu+i for i in range(nu-2,-1,-1)]+[j*nu for j in range(nv-2,0,-1)]
        faces += [(a,b,n+b,n+a) for a,b in zip(boundary,boundary[1:]+boundary[:1])]
        self.mesh(label,front+back,faces,material,smooth)

    def finish(self, directory=None):
        objects=[]
        for material,(vertices,faces,smooth) in self.groups.items():
            mesh=bpy.data.meshes.new(material)
            mesh.from_pydata(vertices,[],faces);mesh.update()
            bm=bmesh.new();bm.from_mesh(mesh)
            if any(not e.is_manifold for e in bm.edges):
                raise RuntimeError(material+': authored component is not closed')
            bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
            bm.to_mesh(mesh);bm.free()
            mesh.materials.append(self.materials[material])
            for p,s in zip(mesh.polygons,smooth):p.use_smooth=s
            obj=bpy.data.objects.new(material,mesh);bpy.context.collection.objects.link(obj);objects.append(obj)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.object.join()
        root=bpy.context.object;root.name=self.identifier
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        # Curved flashing can extend a few millimetres below its centreline.
        # Set the delivered lowest vertex precisely on the placement plane.
        floor=min(v.co.z for v in root.data.vertices)
        for vertex in root.data.vertices:vertex.co.z-=floor
        path=ROOT/'game/public/models/landmarks'/(self.identifier+'.glb')
        path.parent.mkdir(parents=True,exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,
            export_animations=False,export_cameras=False,export_lights=False,export_texcoords=False,
            export_normals=True,export_materials='EXPORT',export_attributes=False)
        audit=audit_closed_primitives(path)
        pts=[(v.co.x,v.co.z,-v.co.y) for v in root.data.vertices]
        bounds=[[min(p[i] for p in pts) for i in range(3)],[max(p[i] for p in pts) for i in range(3)]]
        info=dict(id=self.identifier,bytes=path.stat().st_size,triangles=sum(p['triangles'] for p in audit),
                  bounds=bounds,centre=self.spec['centre'],axis=self.spec['axis'],footprintBounds=self.spec['bounds'],
                  authoredComponents=self.authored_components,closedPrimitives=audit,axes='+X east, +Y up, +Z south; yaw=0')
        print(json.dumps(info),flush=True)
        if directory:
            directory.mkdir(parents=True,exist_ok=True)
            (directory/(self.identifier+'.json')).write_text(json.dumps(info,indent=2)+'\n')
            self.render(path,directory,bounds)
        return info

    def render(self,path,directory,bounds):
        bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
        bpy.ops.import_scene.gltf(filepath=str(path))
        scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
        scene.render.resolution_x=1440;scene.render.resolution_y=960;scene.render.resolution_percentage=100
        scene.world.use_nodes=True
        bg=scene.world.node_tree.nodes['Background'];bg.inputs[0].default_value=(.55,.66,.80,1);bg.inputs[1].default_value=.6
        scene.view_settings.view_transform='AgX'
        bpy.ops.object.light_add(type='SUN',location=(0,-30,100))
        bpy.context.object.data.energy=3;bpy.context.object.data.angle=.12
        bpy.context.object.rotation_euler=(.3,-.45,-.7)
        bpy.ops.mesh.primitive_plane_add(size=2000,location=(0,0,-.035))
        mat=bpy.data.materials.new('Preview ground');mat.diffuse_color=(.22,.25,.22,1)
        bpy.context.object.data.materials.append(mat)
        span=max(bounds[1][i]-bounds[0][i] for i in (0,2));height=bounds[1][1]
        target=Vector(xyz((0,height*.34,0)))
        for label,pos in [('front-quarter',(span*.88,span*.62,span*.86)),('street',(-span*.80,height*.58,-span*.84))]:
            position=self.point(pos)
            bpy.ops.object.camera_add(location=xyz(position));cam=bpy.context.object
            cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
            cam.data.type='ORTHO';cam.data.ortho_scale=span*1.36;scene.camera=cam
            scene.render.filepath=str(directory/(self.identifier+'-'+label+'.png'))
            bpy.ops.render.render(write_still=True);bpy.data.objects.remove(cam,do_unlink=True)


def clip_convex(subject, boundary):
    """Clip a roof sample to the actual convex OSM perimeter."""
    area=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(boundary,boundary[1:]+boundary[:1]))
    sign=1 if area>0 else -1
    out=subject
    for a,b in zip(boundary,boundary[1:]+boundary[:1]):
        previous=out;out=[]
        if not previous:break
        def side(p):return sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))
        for p,q in zip(previous,previous[1:]+previous[:1]):
            dp,dq=side(p),side(q)
            if dp>=0:out.append(p)
            if (dp<0)!=(dq<0):
                t=dp/(dp-dq);out.append((p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t))
    return out
