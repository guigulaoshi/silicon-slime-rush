"""Original static aircraft for the game's expanded Moffett exhibition apron.

These are an imagined day-one display, not a claim about the museum inventory.
Metres; +Y up, -Z nose; extended landing gear rests on Y=0. Original restrained service markings; illustrative identifiers.
Upper paint atlas: original AI-generated artwork matched to the authored 20 m
projection template and user top-view reference.
Public silhouette and dimension references consulted:
https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104506/f22/f-22-raptor/
https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104505/f-16-fighting-falcon/
https://www.boeing.com/defense/military-rotorcraft/ah-64-apache
https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104531/cv-22-osprey/

Blender --background --python-exit-code 1 --python assets-src/landmarks/build_moffett_expansion.py
Optional -- --render-dir tmp/model-polish/expansion
"""
import argparse
import math
import sys

import bpy
from mathutils import Vector
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_moffett_aircraft import (ROOT, MATS, PARTS, setup, mesh, shell, loft, glazing,
                                    tube, wheel, horizontal, wing, seam, export, MarkingSurface)


def chined_body(name, rings):
    profile = [(-1,0),(-.7,-.66),(0,-1),(.7,-.66),(1,0),(.68,.70),(0,1),(-.68,.70)]
    vertices = [(x*rx,y+v*ry,z) for z,y,rx,ry in rings for x,v in profile]
    faces = [tuple(reversed(range(8))),tuple(range((len(rings)-1)*8,len(rings)*8))]
    faces += [(j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i)
              for j in range(len(rings)-1) for i in range(8)]
    mesh(name,vertices,faces)


def jet_gear(nose, mains, top=1.6, spread=1.4, radius=.38):
    tube('Nose oleo',(0,top,nose-.18),(0,.27,nose),.065,'metal',12)
    wheel('Nose gear',0,nose,.27,.19)
    for s in [-1,1]:
        tube('Main oleo',(s*.65,top,mains-.35),(s*spread,radius,mains),.085,'metal',16)
        tube('Main gear brace',(s*.57,top,mains+.35),(s*spread,radius+.15,mains),.052)
        wheel('Main gear',s*spread,mains,radius,.26)



def raptor_topcoat(image_path):
    """Project the unlit 20 m square paint atlas onto closed upper-skin patches.

    The original hull, vertical tails, side and underside PBR stay intact. The
    atlas nose points up: x maps left-to-right and -z maps bottom-to-top in UV.
    Closing each 8 mm paint patch also preserves the per-material GLB audit.
    """
    image=bpy.data.images.load(str(image_path),check_existing=True)
    image.colorspace_settings.name='sRGB'
    material=bpy.data.materials.new('moffett_topcoat_albedo')
    material.use_nodes=True
    shader=material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Metallic'].default_value=.18
    shader.inputs['Roughness'].default_value=.58
    texture=material.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image=image
    coordinates=material.node_tree.nodes.new('ShaderNodeUVMap')
    coordinates.uv_map='Top orthographic paint'
    material.node_tree.links.new(coordinates.outputs['UV'],texture.inputs['Vector'])
    material.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
    MATS['topcoat']=material
    names=('Raptor broad chined blended fuselage','Raptor diamond wing','Raptor diamond stabilator')
    for obj in list(PARTS):
        if not obj.name.startswith(names): continue
        obj.data.calc_loop_triangles()
        for triangle in obj.data.loop_triangles:
            points=[Vector((obj.data.vertices[i].co.x,obj.data.vertices[i].co.z,
                            -obj.data.vertices[i].co.y)) for i in triangle.vertices]
            normal=(points[1]-points[0]).cross(points[2]-points[0]).normalized()
            if normal.y < .30: continue
            patch=shell('Raptor conforming upper paint',[(p.x,p.y+.006,p.z) for p in points],
                        (0,-.008,0),'topcoat')
            uv=patch.data.uv_layers.new(name='Top orthographic paint')
            for loop in patch.data.loops:
                vertex=patch.data.vertices[loop.vertex_index].co
                uv.data[loop.index].uv=(.5+vertex.x/20,.5+vertex.y/20)

def raptor():
    setup((.43,.48,.48,1))
    marking_color=(.29,.34,.34,1)
    MATS['marking_gray'].diffuse_color=marking_color
    MATS['marking_gray'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=marking_color
    canopy_color=(.18,.145,.065,1)
    MATS['glass'].diffuse_color=canopy_color
    MATS['glass'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=canopy_color
    chined_body('Raptor broad chined blended fuselage',[
        (-9.45,1.92,.03,.025),(-7.7,2.00,.65,.28),(-5.5,2.12,1.10,.51),
        (-2.3,2.08,1.28,.55),(1.0,2.02,2.10,.68),(5.5,1.96,1.63,.60),
        (8.2,1.92,1.48,.41),(9.1,1.93,1.39,.24)])
    loft('Gold smoked raptor bubble',[(-6.65,2.43,.06,.05,0),(-5.8,2.66,.43,.43,0),
         (-4.42,2.70,.48,.51,0),(-3.15,2.53,.26,.16,0)],'glass',32)
    for s in [-1,1]:
        wing('Raptor diamond wing',[(s*1.2,-2.65),(s*6.8,1.35),(s*6.38,3.5),
             (s*2.0,4.75)],2.0,.23)
        wing('Raptor diamond stabilator',[(s*1.37,4.77),(s*4.47,6.2),
             (s*3.90,9.02),(s*1.35,8.27)],2.03,.15)
        shell('Raptor swept canted fin',[(s*1.05,2.22,3.52),(s*2.11,5.10,5.22),
              (s*2.28,5.10,6.31),(s*1.48,2.22,7.62)],(s*.11,0,0))
        shell('Angular shoulder intake casing',[(s*.89,1.64,-2.52),(s*.97,2.47,-2.52),
              (s*1.89,2.35,-2.52),(s*1.80,1.55,-2.52)],(0,0,2.2))
        shell('Angular intake mouth',[(s*1.28,1.73,-2.55),(s*1.30,2.30,-2.55),
              (s*1.76,2.28,-2.55),(s*1.70,1.64,-2.55)],(0,0,.045),'rubber')
        seam('Diamond wing control hinge',[(s*2.65,2.24,3.52),(s*5.91,2.24,2.80)],.016)
        # Rectangular exhaust flaps make this distinguishable from the F/A-18.
        x=s*.76
        for yy in [1.63,2.18]:
            shell('Rectangular vectoring nozzle flap',[(x-.62,yy,7.97),(x+.62,yy,7.97),
                  (x+.57,yy,9.45),(x-.57,yy,9.45)],(0,.065,0),'exhaust')
        shell('Rectangular exhaust deep shadow',[(x-.55,1.69,8.88),(x+.55,1.69,8.88),
              (x+.55,2.18,8.88),(x-.55,2.18,8.88)],(0,0,.035),'rubber')
        seam('Raptor canopy sill',[(s*.11,2.48,-6.48),(s*.43,2.66,-5.8),
             (s*.48,2.70,-4.42),(s*.26,2.53,-3.15)],.023,'airframe')
    jet_gear(-5.3,2.24,1.5,1.36,.39)
    for side in [-1, 1]:
        MarkingSurface('Raptor broad chined blended fuselage', side, 6.65, 1.72).insignia(.70)
        tail=MarkingSurface('Raptor swept canted fin', side, 5.82, 4.25, True)
        tail.text('AK', .59)
        tail.text('AF 09', .16, y=-.46)
        tail.text('181', .30, y=-.77)
    raptor_topcoat(Path(__file__).resolve().parent/'textures/f22-top-albedo.png')
    return 'moffett-f22-raptor'


def falcon():
    setup((.52,.57,.58,1))
    loft('Falcon slender single engine fuselage',[(-7.40,1.74,.03,.035,0),
         (-5.85,1.84,.39,.34,0),(-3.6,1.93,.59,.52,0),(-.35,1.86,.67,.60,0),
         (2.8,1.85,.63,.56,0),(5.9,1.88,.57,.52,0),(7.15,1.88,.48,.43,0)],sides=32)
    loft('Falcon raised bubble canopy',[(-4.85,2.25,.04,.07,0),(-3.95,2.50,.47,.52,0),
         (-2.58,2.52,.43,.50,0),(-1.15,2.24,.18,.09,0)],'glass',32)
    loft('Falcon chin intake casing',[(-3.48,1.31,.46,.36,0),(-2.7,1.25,.51,.43,0),
         (1.8,1.44,.52,.40,0)],sides=32)
    loft('Falcon chin intake deep opening',[(-3.50,1.31,.36,.28,0),
         (-3.46,1.31,.36,.28,0)],'rubber',32)
    for s in [-1,1]:
        wing('Falcon cropped delta wing',[(s*.53,-1.82),(s*4.90,1.00),
             (s*4.79,2.48),(s*.57,2.74)],1.77,.15)
        wing('Falcon rear stabilator',[(s*.53,3.74),(s*2.78,5.29),
             (s*2.58,6.82),(s*.51,6.20)],1.78,.13)
        tube('Falcon wingtip rail',(s*4.88,1.89,.52),(s*4.88,1.89,2.96),.07)
        shell('Falcon ventral fin',[(s*.45,1.59,4.3),(s*.77,.83,5.66),
              (s*.81,.83,6.11),(s*.54,1.59,5.92)],(s*.075,0,0))
        seam('Falcon wing flap hinge',[(s*.86,1.93,2.02),(s*4.45,1.93,1.86)])
    shell('Falcon single swept tail', [(-.065,2.25,1.80),(-.065,4.80,4.18),
          (-.065,4.80,5.48),(-.065,2.25,6.28)],(.13,0,0))
    # The opening faces aft: model the annular nozzle along reversed Z.
    sides=32
    rings=[(6.37,.56),(7.40,.46),(7.40,.35),(6.37,.41)]
    vertices=[(r*math.cos(i*math.tau/sides),1.88+r*math.sin(i*math.tau/sides),z)
              for z,r in rings for i in range(sides)]
    faces=[(j*sides+i,j*sides+(i+1)%sides,((j+1)%4)*sides+(i+1)%sides,
            ((j+1)%4)*sides+i) for j in range(4) for i in range(sides)]
    mesh('Falcon single annular exhaust',vertices,faces,'exhaust',True)
    tube('Falcon recessed exhaust shadow',(0,1.88,6.94),(0,1.88,6.97),.36,'rubber',32)
    jet_gear(-3.50,1.12,1.45,1.05,.34)
    for side in [-1, 1]:
        MarkingSurface('Falcon slender single engine fuselage', side, 4.45, 1.98).insignia(.66)
        tail=MarkingSurface('Falcon single swept tail', side, 4.82, 4.05)
        tail.text('OS', .49)
        tail.text('AF 90', .15, y=-.43)
        tail.text('795', .29, y=-.72)
    return 'moffett-f16-falcon'


def rotor(name,x,y,z,radius,blades,phase=0):
    tube(name+' mast',(x,y-.52,z),(x,y,z),.13,'metal',16)
    tube(name+' hub',(x,y-.10,z),(x,y+.09,z),.36,'metal',24)
    for i in range(blades):
        angle=phase+i*math.tau/blades
        outline=[(x+r*math.cos(angle)-w*math.sin(angle),
                  z+r*math.sin(angle)+w*math.cos(angle))
                 for r,w in [(.24,-.13),(radius*.92,-.22),(radius,-.04),
                              (radius,.14),(1.4,.32),(.24,.16)]]
        horizontal(name+' stationary blade',outline,y,.055,'rubber')


def apache():
    setup((.22,.28,.20,1))
    rings=[(-6.2,1.57,.18,.27,0),(-4.8,1.73,.57,.68,0),
           (-3.2,1.83,.63,.73,0),(-.4,1.91,.69,.82,0),
           (1.9,2.05,.52,.61,0),(3.5,2.31,.25,.31,0),
           (7.6,2.71,.11,.14,0)]
    loft('Apache narrow tandem fuselage',rings,sides=16)
    cockpit=[(-4.85,2.13,.29,.25,0),(-3.72,2.54,.51,.52,0),
             (-2.70,2.53,.51,.54,0),(-1.87,2.90,.48,.52,0),
             (-.66,2.87,.43,.47,0),(.10,2.44,.28,.15,0)]
    loft('Apache stepped two seat canopy shell',cockpit,sides=8)
    glazing('Apache front pilot canopy',cockpit,[-4.55,-3.73],[20,45,88],8)
    glazing('Apache front pilot canopy',cockpit,[-4.55,-3.73],[92,135,160],8)
    glazing('Apache tandem side windows',cockpit,[-3.68,-2.73,-1.89,-.69],[5,40,65],8)
    glazing('Apache tandem side windows',cockpit,[-3.68,-2.73,-1.89,-.69],[115,140,175],8)
    for s in [-1,1]:
        loft('Apache elevated side engine',[(-.62,2.69,.33,.39,s*.77),
             (.25,2.79,.48,.42,s*.84),(2.36,2.73,.39,.33,s*.81)],sides=24)
        tube('Apache engine exhaust',(s*.80,2.73,2.2),(s*.80,2.73,2.85),.27,'exhaust',24)
        wing('Apache short store wing',[(s*.54,-.6),(s*2.62,.08),
             (s*2.62,1.12),(s*.53,.72)],1.88,.14)
        loft('Apache cylindrical external pod',[(-1.04,1.54,.29,.29,s*1.95),
             (1.07,1.54,.29,.29,s*1.95)],sides=24)
        for dy,dx in [(0,0),(.14,0),(-.14,0),(0,.14),(0,-.14)]:
            tube('Pod dark end aperture',(s*1.95+dx,1.54+dy,-1.06),
                 (s*1.95+dx,1.54+dy,-1.04),.044,'rubber',10)
        tube('Apache wide main gear',(s*.53,1.69,-1.59),(s*1.40,.39,-1.9),.09)
        wheel('Apache main tire',s*1.42,-1.90,.37,.25)
    tube('Apache tail gear',(0,2.39,6.57),(0,.24,6.7),.07)
    wheel('Apache tail tire',0,6.7,.23,.16)
    shell('Apache tall tail fin',[(-.10,2.56,6.57),(-.10,4.3,7.78),
          (-.10,4.3,8.02),(-.10,2.55,7.9)],(.20,0,0))
    wing('Apache rear stabilator',[(-2.0,5.13),(2.0,5.13),(1.61,6.21),(-1.61,6.21)],2.48,.10)
    loft('Apache raised transmission housing',[(-1.2,2.86,.39,.40,0),
         (-.45,3.02,.53,.58,0),(.48,2.82,.31,.34,0)],sides=16)
    rotor('Apache four blade main rotor',0,4.10,-.5,7.30,4,math.radians(8))
    tube('Apache mast mounted radar pedestal',(0,4.16,-.5),(0,4.41,-.5),.12)
    tube('Apache Longbow radar disc',(0,4.41,-.5),(0,4.70,-.5),.53,'radome',32)
    # Distinct scissors tail rotor. Static blades, not an animated disc.
    tube('Apache tail rotor axle',(-.11,3.65,7.65),(.34,3.65,7.65),.075,'metal',16)
    for angle in [0,.98,math.pi,math.pi+.98]:
        points=[(.28,3.65+r*math.cos(angle)-w*math.sin(angle),
                 7.65+r*math.sin(angle)+w*math.cos(angle))
                for r,w in [(.13,-.085),(1.19,-.085),(1.20,.085),(.13,.085)]]
        shell('Apache scissors tail rotor blade',points,(.055,0,0),'rubber')
    tube('Apache nose sensor turret',(-.32,1.46,-5.95),(.32,1.46,-5.95),.38,'radome',24)
    tube('Apache nose optical lens',(0,1.51,-6.30),(0,1.51,-6.36),.19,'glass',24)
    tube('Apache chin equipment mount',(0,1.11,-4.59),(0,.74,-4.59),.19,'metal',16)
    tube('Apache chin cannon silhouette',(0,.78,-4.59),(0,.78,-5.94),.062,'exhaust',16)
    for side in [-1, 1]:
        MarkingSurface('Apache narrow tandem fuselage', side, 4.37, 2.43).text('UNITED STATES ARMY', .115, 'marking_black')
        MarkingSurface('Apache tall tail fin', side, 7.49, 3.05).text('731', .16, 'marking_black')
    return 'moffett-ah64-apache'


def osprey():
    setup((.48,.54,.54,1))
    rings=[(-8.74,1.8,.17,.22,0),(-7.36,2.20,.92,.92,0),
           (-5.18,2.34,1.13,1.35,0),(3.98,2.42,1.20,1.43,0),
           (6.61,2.71,.77,.92,0),(8.74,3.01,.37,.45,0)]
    loft('Osprey square section cargo cabin',rings,sides=16)
    glazing('Osprey broad cockpit panes',rings,[-7.13,-5.90,-5.22],[20,45,78],16)
    glazing('Osprey broad cockpit panes',rings,[-7.13,-5.90,-5.22],[102,135,160],16)
    for s in [-1,1]:
        wing('Osprey high straight wing',[(s*.77,-1.28),(s*6.97,-.91),
             (s*6.97,1.31),(s*.77,1.29)],3.72,.30)
        # Upright nacelles and two huge three-blade rotors are the aircraft's
        # distinctive parked helicopter-mode outline; no aircraft mesh scaling.
        tube('Osprey upright tilt nacelle',(s*6.97,2.66,.04),(s*6.97,6.52,.04),.65,'airframe',24,.54)
        tube('Osprey nacelle intake',(s*6.97,3.51,-.62),(s*6.97,4.94,-.62),.27,'rubber',16)
        rotor('Osprey three blade proprotor',s*6.97,6.61,.04,5.79,3,
              math.radians(15 if s<0 else 75))
        wing('Osprey tailplane',[(s*.2,5.50),(s*2.6,5.95),(s*2.6,7.38),(s*.2,7.17)],3.73,.13)
        shell('Osprey twin upright tail',[(s*2.49,3.70,5.11),(s*2.49,5.57,6.06),
              (s*2.49,5.57,7.30),(s*2.49,3.70,7.80)],(s*.14,0,0))
        loft('Osprey gear sponson',[(-1.68,1.02,.38,.45,s*1.10),
             (2.66,1.02,.46,.44,s*1.18),(3.59,1.21,.15,.24,s*1.11)],sides=16)
        tube('Osprey landing gear',(s*1.24,1.07,2.49),(s*1.38,.39,2.50),.10)
        wheel('Osprey main tire',s*1.38,2.50,.38,.25)
    tube('Osprey nose gear',(0,1.32,-6.05),(0,.31,-6.10),.09)
    for x in [-.17,.17]: wheel('Osprey twin nose tire',x,-6.10,.30,.19)
    for side in [-1, 1]:
        MarkingSurface('Osprey square section cargo cabin', side, -5.12, 2.22).text('12', .25)
        MarkingSurface('Osprey square section cargo cabin', side, 2.55, 2.51).insignia(.74)
        MarkingSurface('Osprey square section cargo cabin', side, 5.00, 2.73).text('USAF', .20)
        tail=MarkingSurface('Osprey twin upright tail', side, 6.64, 4.83, True)
        tail.text('USAF', .20)
        tail.text('0074', .21, y=-.36)
    return 'moffett-v22-osprey'


BUILDERS = [raptor, falcon, apache, osprey]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--render-dir',type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    for builder in BUILDERS:
        export(builder(),ROOT/args.render_dir if args.render_dir else None)


if __name__ == '__main__':
    main()
