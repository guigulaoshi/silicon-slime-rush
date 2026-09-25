"""Original Hangar One model, using the player's 336-hangar-one-reference.webp.

Closed white barrel vault, aluminium orange-peel door ends, arcuate construction
joints, and four rows of separate glazing. No logos, marks, or photo textures.
Dimensions, placement and orientation come exclusively from landmarks.json.
Run: Blender --background --python assets-src/landmarks/build_hangar_one.py
Optional: -- --render-dir game/test-results/evidence/312-models
"""
import argparse
import math
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_landmark_tools import Model, ROOT


def build():
    m=Model('hangar-one')
    # Painted, weathered cladding: matte enough that the runtime's baked sky
    # (clouds included) blurs out instead of appearing as a photo on the skin.
    # Ribs, seams and doors are separated from the skin by value, not by gloss.
    for key,color,metal,rough in [
        ('shell',(.73,.75,.73),.12,.68),('shell_alternate',(.69,.72,.71),.14,.66),
        ('aluminium',(.59,.63,.65),.30,.60),('aluminium_alternate',(.64,.68,.70),.28,.62),
        ('rib',(.60,.64,.65),.35,.60),('joint',(.28,.34,.36),.30,.62),
        ('base',(.36,.40,.39),.12,.7),('frame',(.42,.49,.51),.35,.60)]:m.material(key,color,metal,rough)
    m.material('glass',(.055,.14,.18),.45,.16,'building_landmark_glass')
    lo,hi=m.spec['bounds'];width=hi[0]-lo[0];length=hi[1]-lo[1]
    uc=(lo[0]+hi[0])/2;vc=(lo[1]+hi[1])/2
    r=width/2;height=m.spec['entry']['heightM'];cap=width*.435
    start=vc-length/2+cap;end=vc+length/2-cap
    # The barrel is a smooth, closed half-ellipse. Its hidden end walls are
    # completely enclosed by the rounded doors, never visible as flat facades.
    n=128
    outline=[(uc+r*math.cos(i*math.pi/n),height*math.sin(i*math.pi/n),start) for i in range(n+1)]
    m.shell('White barrel vault',outline,(0,0,end-start),'shell')
    # Smooth only the long vault quads, preserving flat concealed closing faces.
    m.groups['shell'][2]=[False,False]+[True]*(n+1)
    def barrel(theta,v,lift=0):return (uc+(r+lift)*math.cos(theta),(height+lift)*math.sin(theta),v)
    for k in range(1,9):
        v=start+(end-start)*k/9
        m.tube('Arcuate major vault joint',[barrel(i*math.pi/n,v,.12) for i in range(n+1)],.17,'joint')
        m.tube('Raised joint flashing',[barrel(i*math.pi/n,v+.22,.19) for i in range(n+1)],.12,'rib')
    # Low relief standing seams run up the entire arch; no texture tiling.
    for k in range(1,65):
        v=start+(end-start)*k/65
        m.tube('Fine vault panel seam',[barrel(i*math.pi/48,v,.05) for i in range(49)],.032,'rib',6)
    def pane(label,point,u0,u1,v0,v1,mat,depth):
        rows=[[point(u0+(u1-u0)*i/4,v0+(v1-v0)*j/2) for i in range(5)] for j in range(3)]
        m.patch(label,rows,depth,mat)
    # Four small-window levels match the photo's strong horizontal rhythm.
    for side in (-1,1):
        for row,(fraction,hfrac) in enumerate([(.08,.045),(.205,.033),(.38,.036),(.72,.067)]):
            a0=math.asin(fraction-hfrac/2);a1=math.asin(fraction+hfrac/2)
            if side<0:a0,a1=math.pi-a1,math.pi-a0
            for j in range(27):
                v=start+(end-start)*(j+.5)/27
                half=(end-start)/27*.34
                point=lambda theta,z:barrel(theta,z,.22)
                pane('Individual vault window',point,a0,a1,v-half,v+half,'glass',(-side*.13,0,0))
                # Central mullions make glazing read as windows at close range.
                m.tube('Vault window mullion',[barrel(a0,v,.24),barrel(a1,v,.24)],.042,'frame',6)
    # Each orange-peel door is a half ellipsoid with its own closed back plane.
    # The single apex avoids duplicate/coincident vertices at the pole.
    for sign,base in [(-1,start),(1,end)]:
        nt,np=40,64
        def dome(theta,phi,lift=0):
            # Fit the door's ground arc to the real OSM perimeter. In particular,
            # the shoulders beside the road must not fill the bounding rectangle.
            dx,dz=r*math.sin(phi),sign*cap*math.cos(phi)
            extent=1.0
            ring=m.spec['ring']
            for a,b in zip(ring,ring[1:]+ring[:1]):
                ex,ez=b[0]-a[0],b[1]-a[1]
                denominator=dx*ez-dz*ex
                if abs(denominator)<1e-9:continue
                ax,az=a[0]-uc,a[1]-base
                t=(ax*ez-az*ex)/denominator
                u=(ax*dz-az*dx)/denominator
                if t>0 and 0<=u<=1:extent=min(extent,t)
            return (uc+(dx*extent+lift*math.sin(phi))*math.cos(theta),
                    (height+lift)*math.sin(theta),
                    base+(dz*extent+sign*lift*math.cos(phi))*math.cos(theta))
        vertices=[dome(j*math.pi/(2*nt),-math.pi/2+i*math.pi/np) for j in range(nt) for i in range(np+1)]
        apex=len(vertices);vertices.append((uc,height,base))
        faces=[(j*(np+1)+i,j*(np+1)+i+1,(j+1)*(np+1)+i+1,(j+1)*(np+1)+i) for j in range(nt-1) for i in range(np)]
        faces += [((nt-1)*(np+1)+i,(nt-1)*(np+1)+i+1,apex) for i in range(np)]
        # Floor arc and rear arc close this volume, with opposite winding fixed below.
        faces += [tuple(reversed(range(np+1))),tuple([j*(np+1) for j in range(nt)]+[apex]+[j*(np+1)+np for j in range(nt-1,-1,-1)])]
        m.mesh('Rounded orange peel end',vertices,faces,'aluminium',True)
        for i in range(45):
            phi=-math.pi/2+(i+.5)*math.pi/45
            m.tube('Vertical silver door rib',[dome(j*math.pi/(2*40),phi,.23) for j in range(40)],.14,'rib')
        for theta in [math.asin(.035),math.asin(.94)]:
            m.tube('Door perimeter flashing',[dome(theta,-math.pi/2+i*math.pi/96,.16) for i in range(97)],.14,'rib')
        for fraction in (.12,.31):
            a0=math.asin(fraction-.014);a1=math.asin(fraction+.014)
            for i in range(35):
                phi=-math.pi/2+(i+.5)*math.pi/35;half=math.pi/35*.29
                point=lambda theta,angle:dome(theta,angle,.31)
                pane('Door end glazing',point,a0,a1,phi-half,phi+half,'glass',(0,0,-sign*.12))
                m.tube('Door end window mullion',[dome(a0,phi,.34),dome(a1,phi,.34)],.035,'frame',6)
    # Ground seal is a closed strip: no flat oversized black hangar entrance.
    for side in (-1,1):
        m.box('Vault footing',(uc+side*(r-.15),.40,vc),(.7,.8,end-start),'base')
    m.box('Long ridge vent',(uc,height-.36,vc),(width*.048,.72,(end-start)*.90),'joint')
    for j in range(32):
        m.box('Ridge ventilator cover',(uc,height-.12,start+(end-start)*(j+1)/33),(width*.045,.24,(end-start)/45),'aluminium')
    return m


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--render-dir',type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    build().finish(ROOT/args.render_dir if args.render_dir else None)
