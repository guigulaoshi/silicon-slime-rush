"""Self-authored parked aircraft, metres, ground Y=0, nose toward -Z.

Run with Blender --background --python assets-src/landmarks/build_moffett_aircraft.py
Optional: -- --render-dir tmp/moffett-aircraft

Official factual/photo references consulted (no images redistributed):
https://www.moffettfieldmuseum.org/exhibits.html (F-18 in the local collection)
https://www.129rqw.ang.af.mil/About-Us/History/ (Moffett-based HH-60G and HC-130J)
https://www.nasa.gov/aeronautics/f-a-18-mission-support-aircraft/
https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104508/hh/hh-60g-pave-hawk/
https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104468/hc-130j-combat-king-ii/hc-130j-combat-king-ii/

These simplified original meshes depict F/A-18, HH-60G, and HC-130J silhouettes;
no manufacturer geometry or photographs are reused. Restrained military markings
are original geometry; illustrative identifiers do not assert museum inventory.
HH-60G fact-sheet metric conversions are inconsistent: rotor diameter uses the
53 ft 7 in figure converted to 16.33 m, not the page's erroneous 14.1 m value.
Military marking placement references:
https://static.e-publishing.af.mil/production/1/pacaf/publication/pacafi21/pacafi21.pdf
https://www.navy.mil/Resources/Photo-Gallery/igphoto/2002442444/
Static gear-down presentation, with intact day-one paint and opaque blue glazing.
"""
import argparse
import json
import math
import struct
import sys
from collections import Counter
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
MATS = {}
PARTS = []


# Moved here from the retired build_stadiums.py, which every aircraft build imported it from.
def audit_closed_primitives(path):
    """Check the delivered triangle soup, including glTF's split-normal vertices."""
    raw=path.read_bytes();json_length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+json_length]);binary=raw[28+json_length:]
    def read(index):
        accessor=doc['accessors'][index];view=doc['bufferViews'][accessor['bufferView']]
        fmt={5123:'H',5125:'I',5126:'f'}[accessor['componentType']]
        width={'SCALAR':1,'VEC3':3}[accessor['type']]
        size=struct.calcsize('<'+fmt*width)
        offset=view.get('byteOffset',0)+accessor.get('byteOffset',0)
        stride=view.get('byteStride',size)
        return [struct.unpack_from('<'+fmt*width,binary,offset+i*stride) for i in range(accessor['count'])]
    checked=[]
    for gltf_mesh in doc['meshes']:
        for primitive in gltf_mesh['primitives']:
            points=[tuple(round(c,5) for c in point) for point in read(primitive['attributes']['POSITION'])]
            indices=[row[0] for row in read(primitive['indices'])]
            edges=Counter()
            for i in range(0,len(indices),3):
                a,b,c=[points[index] for index in indices[i:i+3]]
                for edge in [(a,b),(b,c),(c,a)]:edges[tuple(sorted(edge))]+=1
            odd=[edge for edge,count in edges.items() if count%2]
            material=doc['materials'][primitive['material']]['name']
            if odd:raise RuntimeError(f'{path.name}: {material} has {len(odd)} open edges: {odd[:3]}')
            checked.append({'material':material,'triangles':len(indices)//3,'oddEdges':len(odd)})
    return checked


def xyz(p):
    return p[0], -p[2], p[1]


def setup(body_color):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for data in list(bpy.data.materials):
        bpy.data.materials.remove(data)
    PARTS.clear()
    MATS.clear()
    for name, color, metal, rough in [
        ('airframe', body_color, .18, .58),
        ('glass', (.065, .18, .23, 1), .35, .2),
        ('rubber', (.025, .033, .039, 1), 0, .86),
        ('metal', (.32, .36, .38, 1), .62, .36),
        ('radome', (.34, .39, .41, 1), .08, .62),
        ('panel', (.22, .27, .29, 1), .25, .48),
        ('exhaust', (.20, .22, .24, 1), .72, .42),
        ('marking_gray', (.17, .20, .20, 1), 0, .72),
        ('marking_light', tuple(min(c+.035, 1) for c in body_color[:3])+(1,), 0, .72),
        ('marking_black', (.045, .055, .047, 1), 0, .75),
        ('marking_white', (.76, .77, .73, 1), 0, .72),
        ('marking_red', (.42, .045, .035, 1), 0, .72),
        ('marking_blue', (.035, .065, .12, 1), 0, .72),
    ]:
        mat = bpy.data.materials.new('moffett_' + name)
        mat.diffuse_color = color
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        MATS[name] = mat


def mesh(name, vertices, faces, material='airframe', smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(p) for p in vertices], [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if any(not e.is_manifold for e in bm.edges):
        raise RuntimeError(name + ': non-manifold authored component')
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(MATS[material])
    for face in data.polygons:
        face.use_smooth = smooth
    PARTS.append(obj)
    return obj


def shell(name, outline, offset, material='airframe'):
    """Close a convex polygon with a parallel offset; no double-sided surfaces."""
    n = len(outline)
    vertices = outline + [tuple(p[i] + offset[i] for i in range(3)) for p in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return mesh(name, vertices, faces, material)


def loft(name, rings, material='airframe', sides=24):
    # Each ring is (z, centre_y, half_width_x, half_height_y, centre_x).
    vertices = [(cx + rx * math.cos(i * math.tau / sides),
                 y + ry * math.sin(i * math.tau / sides), z)
                for z, y, rx, ry, cx in rings for i in range(sides)]
    faces = [tuple(reversed(range(sides))),
             tuple((len(rings) - 1) * sides + i for i in range(sides))]
    faces += [(j * sides + i, j * sides + (i + 1) % sides,
               (j + 1) * sides + (i + 1) % sides, (j + 1) * sides + i)
              for j in range(len(rings) - 1) for i in range(sides)]
    return mesh(name, vertices, faces, material, True)


def glazing(name, rings, depths, angles, sides=24):
    """Place closed panes on the actual faceted loft, with a narrow frame gap."""
    # A pane crossing a hull facet chord otherwise cuts through the hull: only
    # its raised edges remain visible. Split at every actual surface boundary.
    depths = sorted(set(depths) | {row[0] for row in rings if depths[0] < row[0] < depths[-1]})
    angles = sorted(set(angles) | {i*360/sides for i in range(sides+1)
                                  if angles[0] < i*360/sides < angles[-1]})
    def point(z, angle, lift):
        a, b = next((a, b) for a, b in zip(rings, rings[1:]) if a[0] <= z <= b[0])
        t = (z-a[0])/(b[0]-a[0])
        y, rx, ry, cx = [a[i]+(b[i]-a[i])*t for i in range(1, 5)]
        step = 360/sides
        sector = math.floor(angle/step)
        u = angle/step-sector
        lo, hi = math.radians(sector*step), math.radians((sector+1)*step)
        c = math.cos(lo)*(1-u)+math.cos(hi)*u
        sn = math.sin(lo)*(1-u)+math.sin(hi)*u
        return (cx+(rx+lift)*c, y+(ry+lift)*sn, z)
    for z0, z1 in zip(depths, depths[1:]):
        for a0, a1 in zip(angles, angles[1:]):
            parameters = [(z0+.012,a0+.15),(z1-.012,a0+.15),
                          (z1-.012,a1-.15),(z0+.012,a1-.15)]
            vertices = [point(z,a,lift) for lift in [.045,.020] for z,a in parameters]
            mesh(name, vertices, [(0,3,2,1),(4,5,6,7),(0,1,5,4),
                                 (1,2,6,5),(2,3,7,6),(3,0,4,7)], 'glass')


def tube(name, a, b, radius, material='metal', sides=10, end_radius=None):
    av, bv = Vector(a), Vector(b)
    direction = (bv - av).normalized()
    other = Vector((0, 1, 0)) if abs(direction.y) < .9 else Vector((1, 0, 0))
    u = direction.cross(other).normalized()
    v = direction.cross(u).normalized()
    vertices = [tuple(center + (u * math.cos(i * math.tau / sides)
                               + v * math.sin(i * math.tau / sides)) * r)
                for center, r in [(av, radius), (bv, radius if end_radius is None else end_radius)]
                for i in range(sides)]
    faces = [tuple(reversed(range(sides))), tuple(range(sides, sides * 2))]
    faces += [(i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides)]
    return mesh(name, vertices, faces, material, True)


def wheel(name, x, z, radius, width=.24):
    tube(name + ' tire', (x-width/2, radius, z), (x+width/2, radius, z), radius, 'rubber', 24)
    tube(name + ' hub', (x-width*.53, radius, z), (x+width*.53, radius, z), radius*.48, 'metal', 24)


def horizontal(name, outline, y, thickness=.16, material='airframe'):
    return shell(name, [(x, y, z) for x, z in outline], (0, thickness, 0), material)


def wing(name, outline, y, thickness):
    """Closed tapered edge around a broad wing skin, retaining the planform."""
    cx = sum(x for x, _ in outline)/len(outline)
    cz = sum(z for _, z in outline)/len(outline)
    n = len(outline)
    vertices = [(cx+(x-cx)*scale, height, cz+(z-cz)*scale)
                for scale, height in [(0.98, y), (1, y+thickness*.24), (.965, y+thickness)]
                for x, z in outline]
    faces = [tuple(reversed(range(n))), tuple(range(2*n, 3*n))]
    faces += [(j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i)
              for j in range(2) for i in range(n)]
    return mesh(name, vertices, faces)


def seam(name, points, radius=.012, material='panel'):
    for a, b in zip(points, points[1:]):
        tube(name, a, b, radius, material, 6)


def nozzle(x):
    """A visible recessed bore, annular lip, and individually edged nozzle petals."""
    for i in range(24):
        lo, hi = i*math.tau/24+.003, (i+1)*math.tau/24-.003
        vertices = [(x+r*math.cos(a), 1.79+r*math.sin(a), z)
                    for z, r in [(7.28,.44),(8.53,.39),(8.53,.31),(7.28,.34)]
                    for a in [lo, hi]]
        mesh('Exhaust nozzle petal', vertices, [(0,1,3,2),(2,3,5,4),(4,5,7,6),
             (6,7,1,0),(0,2,4,6),(1,7,5,3)], 'metal' if i%3 else 'exhaust')
    tube('Recessed exhaust bore', (x,1.79,8.02), (x,1.79,8.05), .33, 'rubber', 32)



class MarkingSurface:
    """Clip original vector paint to existing hull facets, then close each patch.

    Coordinates in a side view are (screen right, up). On the starboard side
    screen right is toward the nose; switching sides never mirrors the lettering.
    Each patch crosses the hull by 2 mm and rises only 6 mm: no floating sheets,
    z-fighting, or interpolation across a curved hull's facet boundaries.
    """
    def __init__(self, name, side, center_z, center_y, outer_only=False):
        self.side, self.center_z, self.center_y = side, center_z, center_y
        self.facets = []
        for obj in list(PARTS):
            if not obj.name.startswith(name):
                continue
            points = [Vector((v.co.x, v.co.z, -v.co.y)) for v in obj.data.vertices]
            if outer_only and sum(p.x for p in points)*side < 0:
                continue
            obj.data.calc_loop_triangles()
            for tri in obj.data.loop_triangles:
                a,b,c = [points[i] for i in tri.vertices]
                normal = (b-a).cross(c-a)
                if normal.x*side <= 1e-8:
                    continue
                uv = [(-side*(v.z-center_z), v.y-center_y) for v in (a,b,c)]
                self.facets.append((a,b,c,uv))
        if not self.facets:
            raise RuntimeError('No paint surface: '+name)

    def polygon(self, name, outline, material='marking_gray', lift=.006):
        def cross(a,b): return a[0]*b[1]-a[1]*b[0]
        def sub(a,b): return (a[0]-b[0],a[1]-b[1])
        for a,b,c,clip in self.facets:
            area=cross(sub(clip[1],clip[0]),sub(clip[2],clip[0]))
            polygon=list(outline)
            for edge in range(3):
                q,r=clip[edge],clip[(edge+1)%3]
                result=[]
                for start,end in zip(polygon,polygon[1:]+polygon[:1]):
                    ds=cross(sub(r,q),sub(start,q))/area
                    de=cross(sub(r,q),sub(end,q))/area
                    if ds >= -1e-10: result.append(start)
                    if (ds >= 0) != (de >= 0):
                        t=ds/(ds-de)
                        result.append((start[0]+(end[0]-start[0])*t,start[1]+(end[1]-start[1])*t))
                polygon=result
                if len(polygon)<3: break
            # Clipping exactly at a hull corner can repeat a vertex.
            clean=[]
            for v in polygon:
                if not clean or sum((v[i]-clean[-1][i])**2 for i in range(2))>1e-14:
                    clean.append(v)
            if len(clean)>1 and sum((clean[0][i]-clean[-1][i])**2 for i in range(2))<1e-14:
                clean.pop()
            if len(clean)<3 or abs(sum(cross(u,v) for u,v in zip(clean,clean[1:]+clean[:1])))<1e-9:
                continue
            points=[]
            for v in clean:
                w1=cross(sub(v,clip[0]),sub(clip[2],clip[0]))/area
                w2=cross(sub(clip[1],clip[0]),sub(v,clip[0]))/area
                p=a+(b-a)*w1+(c-a)*w2
                points.append((p.x+self.side*lift,p.y,p.z))
            shell(name,points,(-self.side*(lift+.002),0,0),material)

    def text(self, text, height, material='marking_gray', y=0):
        curve=bpy.data.curves.new('Original identifier outline','FONT')
        curve.body=text;curve.size=1;curve.resolution_u=3
        obj=bpy.data.objects.new('Temporary identifier outline',curve)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
        bpy.ops.object.convert(target='MESH')
        data=obj.data;data.calc_loop_triangles()
        lo=[min(v.co[i] for v in data.vertices) for i in range(2)]
        hi=[max(v.co[i] for v in data.vertices) for i in range(2)]
        scale=height/(hi[1]-lo[1])
        for tri in data.loop_triangles:
            outline=[((data.vertices[i].co.x-(lo[0]+hi[0])/2)*scale,
                      (data.vertices[i].co.y-(lo[1]+hi[1])/2)*scale+y) for i in tri.vertices]
            self.polygon('Paint identifier '+text,outline,material)
        bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.meshes.remove(data)

    def insignia(self, width):
        # US star-and-bars proportions: circle plus outlined white side bars.
        r=width/3.6
        self.polygon('Paint insignia bars',[(-1.8*r,-.38*r),(1.8*r,-.38*r),
                     (1.8*r,.38*r),(-1.8*r,.38*r)])
        self.polygon('Paint insignia roundel',[(r*math.cos(i*math.tau/40),r*math.sin(i*math.tau/40)) for i in range(40)])
        for side in [-1,1]:
            self.polygon('Paint insignia bar inset',[(side*.92*r,-.23*r),(side*1.65*r,-.23*r),
                         (side*1.65*r,.23*r),(side*.92*r,.23*r)],'marking_light',.010)
        star=[((r*.90 if i%2==0 else r*.344)*math.cos(math.pi/2+i*math.pi/5),
               (r*.90 if i%2==0 else r*.344)*math.sin(math.pi/2+i*math.pi/5)) for i in range(10)]
        # Concave star is split into convex wedges before facet clipping.
        for a,b in zip(star,star[1:]+star[:1]):
            self.polygon('Paint insignia star',[(0,0),a,b],'marking_light',.010)

    def flag(self, width=1.2192, height=.6096):
        # PACAF C tail flag: 48 x 24 inches. Thirteen stripes, fifty stars.
        for row in range(13):
            top=height/2-row*height/13;bottom=top-height/13
            self.polygon('Paint flag stripe',[(-width/2,bottom),(width/2,bottom),
                         (width/2,top),(-width/2,top)],'marking_red' if row%2==0 else 'marking_white')
        # Canton points toward the aircraft nose on both sides.
        left=-width/2 if self.side<0 else width/2-width*.4
        right=left+width*.4;bottom=height/2-height*7/13
        self.polygon('Paint flag canton',[(left,bottom),(right,bottom),(right,height/2),(left,height/2)],'marking_blue',.010)
        for row in range(9):
            count=6 if row%2==0 else 5
            for col in range(count):
                cx=left+width*.4*(col+(.5 if count==6 else 1))/6
                cy=height/2-height*7/13*(row+.5)/9
                radius=height*.027
                star=[(cx+(radius if i%2==0 else radius*.382)*math.cos(math.pi/2+i*math.pi/5),
                       cy+(radius if i%2==0 else radius*.382)*math.sin(math.pi/2+i*math.pi/5)) for i in range(10)]
                for a,b in zip(star,star[1:]+star[:1]):
                    self.polygon('Paint flag star',[(cx,cy),a,b],'marking_white',.014)

def fighter():
    setup((.48, .54, .56, 1))
    loft('Contrasting radar nose', [(-8.53,1.9,.035,.035,0),(-7.8,1.95,.20,.18,0),
         (-6.5,2.0,.45,.40,0)], 'radome', sides=32)
    loft('Slender pointed fuselage', [(-6.5, 2.0, .45, .40, 0),
         (-4.2, 2.1, .64, .61, 0), (-1.6, 2.0, .86, .67, 0), (1.0, 1.85, 1.13, .66, 0),
         (5.6, 1.85, 1.02, .61, 0), (8.0, 1.8, .81, .48, 0)], sides=32)
    canopy = [(-5.5, 2.47, .07, .08, 0), (-4.65, 2.63, .47, .47, 0),
              (-3.15, 2.65, .54, .54, 0), (-1.7, 2.55, .24, .13, 0)]
    loft('Raised cockpit canopy', canopy, 'glass', sides=32)
    for z,y,rx,ry,_ in [canopy[1], canopy[-2]]:
        seam('Canopy transverse arch', [(rx*math.cos(i*math.pi/16),
             y+ry*math.sin(i*math.pi/16)+.014,z) for i in range(17)], .025, 'airframe')
    for s in [-1,1]:
        seam('Canopy sill', [(s*rx,y+.008,z) for z,y,rx,ry,_ in canopy], .032, 'airframe')
    for s in [-1, 1]:
        wing('Swept main wing', [(s*.72, -.8), (s*2.0, -.35), (s*5.95, 2.55),
                   (s*5.95, 4.38), (s*1.0, 3.85)], 1.97, .18)
        horizontal('Leading edge root extension', [(s*.49, -4.6), (s*1.06, -3.05),
                   (s*1.72, -.8), (s*1.45, 1.1), (s*.65, .7)], 2.16, .1)
        wing('Swept horizontal tail', [(s*.9, 4.9), (s*3.8, 6.1), (s*3.4, 8.15),
                   (s*.83, 7.7)], 1.86, .14)
        seam('Trailing flap hinge', [(s*1.4,2.16,3.24),(s*5.64,2.16,3.71)])
        seam('Aileron separation', [(s*4.1,2.16,3.53),(s*4.05,2.16,4.06)])
        seam('Leading edge slat joint', [(s*2.15,2.16,.13),(s*5.58,2.16,2.68)])
        shell('Outward canted vertical tail', [(s*.88, 2.2, 3.7), (s*1.54, 4.67, 5.7),
              (s*1.6, 4.67, 6.55), (s*1.06, 2.2, 7.65)], (s*.13, 0, 0))
        seam('Rudder hinge', [(s*1.17,2.45,6.89),(s*1.68,4.42,6.16)], .014)
        tube('Wingtip rail', (s*6.055, 2.1, 2.15), (s*6.055, 2.1, 4.66), .09)
        loft('Engine shoulder intake', [(-2.1, 1.77, .32, .40, s*.93),
             (-.7, 1.78, .44, .46, s*.91), (5.9, 1.81, .42, .45, s*.60)], sides=24)
        loft('Dark intake mouth', [(-2.13, 1.77, .25, .31, s*.93),
             (-2.10, 1.77, .25, .31, s*.93)], 'rubber')
        shell('Intake splitter plate', [(s*.66,1.42,-2.15),(s*.66,2.14,-2.15),
              (s*.64,2.16,-.6),(s*.64,1.41,-.6)], (s*.045,0,0))
        nozzle(s*.5)
        tube('Main landing leg', (s*.83, 1.65, 1.6), (s*1.42, .45, 2.1), .09)
        tube('Main oleo piston', (s*1.17,.97,1.91),(s*1.42,.45,2.1), .055, 'metal', 16)
        tube('Landing gear drag brace', (s*.67,1.52,.55),(s*1.30,.68,1.99), .044)
        shell('Main landing gear door', [(s*.92,1.57,1.04),(s*1.12,.91,1.13),
              (s*1.20,.88,2.20),(s*1.01,1.56,2.35)],(s*.035,0,0))
        wheel('Main wheel', s*1.47, 2.1, .40, .24)
    tube('Nose landing leg', (0, 1.65, -4.65), (0, .35, -4.45), .075)
    shell('Aft dorsal antenna', [(-.022,2.46,5.1),(-.022,2.86,5.32),
          (-.022,2.86,5.43),(-.022,2.46,5.59)],(.044,0,0))
    shell('Nose landing gear door', [(.11,.82,-4.87),(.11,1.58,-4.87),
          (.11,1.58,-4.08),(.11,.82,-4.08)],(.035,0,0))
    for x in [-.16, .16]:
        wheel('Paired nose wheel', x, -4.45, .28, .15)
    for side in [-1, 1]:
        MarkingSurface('Slender pointed fuselage', side, -5.65, 2.10).text('204', .23)
        MarkingSurface('Engine shoulder intake', side, 4.65, 1.64, True).insignia(.65)
        MarkingSurface('Slender pointed fuselage', side, 6.35, 1.60).text('NAVY', .18)
        tail = MarkingSurface('Outward canted vertical tail', side, 5.94, 3.82, True)
        tail.text('NE', .43)
        tail.text('164204', .14, y=-.43)
    return 'moffett-fighter'


def helicopter():
    setup((.19, .24, .22, 1))
    cabin_rings = [(-5.4, 1.64, .35, .42, 0), (-4.5, 1.85, .90, .88, 0),
         (-3.3, 2.0, 1.19, 1.10, 0), (.8, 2.08, 1.22, 1.14, 0),
         (2.6, 2.27, .65, .70, 0), (3.7, 2.47, .37, .37, 0)]
    loft('Pave Hawk cabin', cabin_rings)
    glazing('Cabin windscreen', cabin_rings, [-4.48, -3.36], [30, 60, 89])
    glazing('Cabin windscreen', cabin_rings, [-4.48, -3.36], [91, 120, 150])
    glazing('Pilot side glass', cabin_rings, [-3.26, -2.73], [2, 30, 53])
    glazing('Pilot side glass', cabin_rings, [-3.26, -2.73], [127, 150, 178])
    loft('Tapered rising tail boom', [(3.68, 2.47, .36, .36, 0), (4.1, 2.53, .35, .35, 0), (6.9, 2.93, .21, .26, 0),
         (8.9, 3.21, .14, .21, 0)], sides=8)
    for s in [-1, 1]:
        shell('Cabin door panel', [(s*1.20, 1.40, -2.65), (s*1.22, 1.40, -.35),
              (s*1.10, 2.77, -.35), (s*1.09, 2.77, -2.65)], (s*.025, 0, 0), 'airframe')
        shell('Cabin window', [(s*1.18, 2.03, -2.42), (s*1.19, 2.03, -.57),
              (s*1.12, 2.65, -.57), (s*1.11, 2.65, -2.42)], (s*.04, 0, 0), 'glass')
        loft('Upper engine pod', [(-2.0, 3.01, .30, .30, s*.59),
             (-1.3, 3.23, .37, .36, s*.61), (1.5, 3.12, .32, .32, s*.61)])
        tube('Engine exhaust', (s*.62, 3.1, 1.3), (s*.62, 3.1, 1.91), .25, 'rubber')
        tube('Main landing leg', (s*.89, 1.72, -2.45), (s*1.68, .48, -2.1), .12)
        wheel('Main wheel', s*1.70, -2.1, .43, .29)
    tube('Tail landing leg', (0, 2.75, 6.1), (0, .29, 5.95), .085)
    wheel('Tail wheel', 0, 5.95, .28, .2)
    shell('Tail fin', [(-.13, 2.91, 7.45), (-.13, 4.45, 8.68),
          (-.13, 4.45, 9.38), (-.13, 2.9, 8.87)], (.26, 0, 0))
    horizontal('Tail stabilator', [(-2.16, 5.68), (2.16, 5.68), (1.65, 7.36), (-1.65, 7.36)], 2.73, .12)
    tube('Rotor mast', (0, 2.9, -.77), (0, 4.34, -.77), .17)
    tube('Rotor hub', (0, 4.18, -.77), (0, 4.40, -.77), .44)
    for i in range(4):
        angle = math.radians(12 + i * 90)
        outline = []
        for r, w in [(.38, -.14), (7.72, -.21), (8.16, .16), (1.6, .37), (.38, .18)]:
            outline.append((r*math.cos(angle)-w*math.sin(angle),
                            -.77+r*math.sin(angle)+w*math.cos(angle)))
        horizontal('Stationary main rotor blade', outline, 4.33, .055, 'rubber')
    tube('Tail rotor axle', (-.17, 3.92, 8.62), (.53, 3.92, 8.62), .12)
    for i in range(4):
        angle = math.radians(25 + i * 90)
        outline = [( .53, 3.92 + r*math.cos(angle)-w*math.sin(angle),
                      8.62+r*math.sin(angle)+w*math.cos(angle))
                   for r, w in [(.12, -.11), (1.47, -.10), (1.50, .12), (.12, .12)]]
        shell('Stationary tail rotor blade', outline, (.055, 0, 0), 'rubber')
    # Rescue equipment makes the military utility silhouette distinct from a tour helicopter.
    tube('Refueling probe', (.74, 1.48, -3.1), (.74, 1.48, -7.05), .085)
    tube('Hoist arm', (1.0, 3.0, -.25), (1.72, 3.0, -.25), .095)
    tube('Stowed rescue hoist', (1.60, 2.71, -.25), (1.60, 3.09, -.25), .17)
    for side in [-1, 1]:
        MarkingSurface('Pave Hawk cabin', side, 1.05, 2.12).insignia(.61)
        MarkingSurface('Tapered rising tail boom', side, 4.94, 2.67).text('USAF', .20, 'marking_black')
        MarkingSurface('Tail fin', side, 8.75, 4.12).text('009', .18, 'marking_black')
    return 'moffett-rescue-helicopter'


def transport():
    setup((.39, .45, .46, 1))
    fuselage_rings = [(-14.895, 2.75, .12, .13, 0), (-13.6, 3.12, .97, 1.20, 0),
         (-11.5, 3.56, 1.63, 1.8, 0), (-8.5, 3.65, 1.87, 1.95, 0),
         (5.6, 3.65, 1.87, 1.95, 0), (8.1, 4.05, 1.55, 1.49, 0),
         (12.4, 5.03, .57, .52, 0), (14.895, 5.19, .06, .09, 0)]
    loft('Hercules fuselage', fuselage_rings)
    glazing('Flight deck glazing', fuselage_rings, [-12.85, -11.5, -10.75], [28, 30, 60, 78])
    glazing('Flight deck glazing', fuselage_rings, [-12.85, -11.5, -10.75], [102, 120, 150, 152])
    for s in [-1, 1]:
        horizontal('High mounted wing', [(s*.5, -5.65), (s*8.5, -5.48),
                   (s*20.2, -2.92), (s*20.2, -.6), (s*8.5, .36), (s*.5, .4)], 5.39, .37)
        horizontal('Horizontal tailplane', [(s*.32, 8.47), (s*8.1, 10.17),
                   (s*8.1, 12.29), (s*.31, 11.64)], 5.67, .20)
        loft('Main landing gear sponson', [(-2.35, 1.62, .32, .36, s*1.76),
             (-1.3, 1.59, .57, .45, s*1.78), (3.1, 1.59, .57, .45, s*1.78),
             (4.0, 1.66, .27, .26, s*1.76)], sides=8)
        for z in [.05, 1.47]:
            tube('Main gear leg', (s*1.83, 1.82, z), (s*1.83, .57, z), .13)
            wheel('Tandem main wheel', s*1.92, z, .56, .40)
        for xx in [5.1, 10.1]:
            x = s*xx
            loft('Turboprop nacelle', [(-7.2, 4.75, .46, .51, x), (-6.4, 4.81, .64, .70, x),
                 (-3.0, 4.83, .60, .62, x), (-1.2, 5.01, .23, .29, x)])
            tube('Propeller spinner', (x, 4.8, -7.65), (x, 4.8, -7.05), .05, 'metal', 10, .38)
            for i in range(6):
                angle = math.radians(15 + i*60)
                outline = [(x + r*math.cos(angle)-w*math.sin(angle),
                            4.8 + r*math.sin(angle)+w*math.cos(angle), -7.19)
                           for r, w in [(.27, -.12), (1.90, -.21), (2.03, .13), (.83, .32), (.27, .12)]]
                shell('Six blade scimitar propeller', outline, (0, 0, .07), 'rubber')
        # Dedicated rescue/refueling version: pods outside the four engines.
        loft('Refueling pod', [(-3.65, 4.82, .08, .10, s*13.85), (-2.8, 4.80, .34, .34, s*13.85),
             (.72, 4.80, .32, .33, s*13.85), (1.64, 4.82, .1, .1, s*13.85)], sides=10)
    shell('Tall swept vertical fin', [(-.15, 5.07, 6.19), (-.15, 11.81, 10.72),
          (-.15, 11.81, 13.1), (-.15, 5.13, 13.0)], (.30, 0, 0))
    tube('Nose gear leg', (0, 2.1, -10.4), (0, .46, -10.18), .13)
    for x in [-.29, .29]:
        wheel('Paired nose wheel', x, -10.18, .44, .24)
    for side in [-1, 1]:
        MarkingSurface('Hercules fuselage', side, -8.0, 3.95).text('U.S. AIR FORCE', .32)
        MarkingSurface('Hercules fuselage', side, 6.2, 4.13).insignia(1.45)
        tail = MarkingSurface('Tall swept vertical fin', side, 11.62, 10.65)
        tail.flag()
        tail.text('AF 12', .25, y=-.74)
        tail.text('579', .58, y=-1.40)
    return 'moffett-rescue-transport'


def export(name, directory):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in PARTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    root = bpy.context.object
    root.name = name
    if root.data.uv_layers:
        root.data.uv_layers.active_index = 0
        root.data.uv_layers[0].active_render = True
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    output = ROOT / 'game/public/models/landmarks' / (name + '.glb')
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
        export_yup=True, export_animations=False, export_cameras=False, export_lights=False,
        export_texcoords=True, export_normals=True, export_materials='EXPORT', export_attributes=False)
    closed = audit_closed_primitives(output)
    root.data.calc_loop_triangles()
    points = [Vector((v.co.x, v.co.z, -v.co.y)) for v in root.data.vertices]
    minimum = [min(p[i] for p in points) for i in range(3)]
    maximum = [max(p[i] for p in points) for i in range(3)]
    info = {'id': name, 'bytes': output.stat().st_size, 'triangles': len(root.data.loop_triangles),
            'bounds': [minimum, maximum], 'dimensions': [maximum[i]-minimum[i] for i in range(3)],
            'axes': '+X right, +Y up, -Z nose', 'closedPrimitives': closed}
    if abs(minimum[1]) > 1e-6:
        raise RuntimeError(name + ': wheels must rest on Y=0')
    print(json.dumps(info), flush=True)
    if directory:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / (name + '.json')).write_text(json.dumps(info, indent=2) + '\n')
        render(output, directory, info)


def render(output, directory, info):
    # Render the exported/reimported object so the preview covers the delivered data.
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(output))
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes['Background']
    background.inputs[0].default_value = (.55, .64, .74, 1)
    background.inputs[1].default_value = .65
    scene.view_settings.view_transform = 'AgX'
    bpy.ops.object.light_add(type='SUN', location=(0, -30, 50))
    sun = bpy.context.object
    sun.data.energy = 3
    sun.data.angle = .16
    sun.rotation_euler = (.35, -.6, -.5)
    bpy.ops.mesh.primitive_plane_add(size=250, location=(0, 0, -.025))
    ground = bpy.data.materials.new('Preview concrete')
    ground.diffuse_color = (.18, .20, .21, 1)
    bpy.context.object.data.materials.append(ground)
    span = max(info['dimensions'])
    target = Vector(xyz((0, info['dimensions'][1]*.38, 0)))
    for label, position in [('front-quarter', (span*.95, span*.62, -span)),
                             ('rear-quarter', (-span*.9, span*.48, span*.92))]:
        bpy.ops.object.camera_add(location=xyz(position))
        camera = bpy.context.object
        camera.rotation_euler = (target-camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = span*1.22
        scene.camera = camera
        scene.render.filepath = str(directory / (output.stem + '-' + label + '.png'))
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(camera, do_unlink=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--render-dir', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    for builder in [fighter, helicopter, transport]:
        export(builder(), ROOT / args.render_dir if args.render_dir else None)


if __name__ == '__main__':
    main()
