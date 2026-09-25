"""Original Gradient Canopy / Charleston East architectural model.

Visual reference: https://heatherwick.com/project/google-charleston-east/
The architect's aerial photograph shows a gently domed 8 by 8 draped canopy,
64 smile-shaped clerestories and silver photovoltaic shingles. This is original
geometry, not a downloaded building or photo texture; no trademarks are used.
Footprint and height remain owned by pipeline/landmarks.json.
Run: Blender --background --python assets-src/landmarks/build_charleston_canopy.py
Optional: -- --render-dir game/test-results/evidence/312-models
"""
import argparse
import math
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_landmark_tools import Model, ROOT, clip_convex


def build():
    m=Model('charleston-canopy')
    for key,color,metal,rough in [
        ('solar',(.30,.39,.46),.64,.28),('solar_light',(.31,.40,.47),.64,.30),
        ('solar_dark',(.29,.38,.45),.66,.27),('flashing',(.65,.70,.71),.72,.29),
        ('underside',(.55,.56,.51),.16,.62),('mullion',(.36,.42,.41),.55,.35),
        ('plinth',(.43,.42,.37),.05,.76),('timber',(.35,.25,.16),0,.68)]:m.material(key,color,metal,rough)
    m.material('glass',(.055,.14,.18),.44,.15,'building_landmark_glass')
    lo,hi=m.spec['bounds'];width=hi[0]-lo[0];length=hi[1]-lo[1]
    uc=(lo[0]+hi[0])/2;vc=(lo[1]+hi[1])/2
    wall=m.spec['entry']['wallHeightM'];height=m.spec['entry']['heightM']
    ring=m.spec['ring'];nx=nz=8;du=width/nx;dv=length/nz
    # Perimeter follows the OSM polygon. The continuous base is recessed from
    # the solar roof to expose the thin metal edge and timber soffit at street level.
    inner=[(uc+(x-uc)*.965,vc+(z-vc)*.965) for x,z in ring]
    m.shell('Low concrete podium',[(x,0,z) for x,z in inner],(0,.48,0),'plinth')
    m.shell('Glazed two storey podium',[(x,.45,z) for x,z in inner],(0,wall-.45,0),'glass')
    for i,(a,b) in enumerate(zip(inner,inner[1:]+inner[:1])):
        distance=math.dist(a,b);segments=max(1,round(distance/2.8))
        for j in range(segments):
            t=j/segments;x=a[0]+(b[0]-a[0])*t;z=a[1]+(b[1]-a[1])*t
            m.tube('Slender curtain wall mullion',[(x,.45,z),(x,wall,z)],.068,'mullion',6)
        for y in (.5,wall*.50,wall-.18):
            m.tube('Curtain wall transom',[(a[0],y,a[1]),(b[0],y,b[1])],.082,'mullion',6)
        if distance>9:
            mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
            # Close-up human scale: timber entrance portals interrupt long glass runs.
            if i%4==0:
                m.tube('Entrance jamb',[(mid[0],.48,mid[1]),(mid[0],3.6,mid[1])],.12,'timber')
    def envelope(x,z):
        a=(x-uc)/(width*.5);b=(z-vc)/(length*.5)
        # Broad low crown, smoothly descending towards all perimeter edges.
        dome=max(0,1-(abs(a)**3+abs(b)**3)*.50)
        return wall+(height-wall)*dome
    def surface(x,z,ix,iz):
        a=(x-(lo[0]+ix*du))/du;b=(z-(lo[1]+iz*dv))/dv
        # Catenary-like quadratic drape between mast intersections: no pointed peaks.
        sag=(du+dv)*.034*(4*a*(1-a)+4*b*(1-b))
        return envelope(x,z)-sag-.30
    # Glazing rises to the curving roofline; an empty gap above a fixed box would
    # make the canopy look detached when the driver approaches the facade.
    for a,b in zip(inner,inner[1:]+inner[:1]):
        edge_length=math.dist(a,b);segments=max(1,math.ceil(edge_length/2.8))
        inward=(-(b[1]-a[1])/edge_length*.13,0,(b[0]-a[0])/edge_length*.13)
        for j in range(segments):
            pair=[]
            for t in (j/segments,(j+1)/segments):
                x=a[0]+(b[0]-a[0])*t;z=a[1]+(b[1]-a[1])*t
                ix=min(nx-1,max(0,int((x-lo[0])/du)));iz=min(nz-1,max(0,int((z-lo[1])/dv)))
                pair.append((x,max(wall+.05,surface(x,z,ix,iz)-.20),z))
            p,q=pair
            m.shell('Roofline glazing infill',[(p[0],wall,p[2]),(q[0],wall,q[2]),q,p],inward,'glass')
            m.tube('Roofline curtain wall mullion',[(p[0],wall,p[2]),p],.068,'mullion',6)
            m.tube('Roofline curtain wall transom',[p,q],.082,'mullion',6)
    # Full geometric solar tiles, each with thickness, separated by narrow channels.
    # 64 structural fields carry 10 by 10 shaped panels, clipped at the footprint.
    # The shallow clerestory upstand occupies the final band of each field.
    for iz in range(nz):
        for ix in range(nx):
            x0=lo[0]+ix*du;z0=lo[1]+iz*dv
            for j in range(10):
                for i in range(10):
                    xa=x0+i*du/10+.024;xb=x0+(i+1)*du/10-.024
                    za=z0+j*dv/10+.024;zb=z0+(j+1)*dv/10-.024
                    poly=clip_convex([(xa,za),(xb,za),(xb,zb),(xa,zb)],ring)
                    if len(poly)<3:continue
                    if abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))<.003:continue
                    material=['solar','solar','solar_light','solar','solar_dark'][(ix*13+iz*7+i+j*3)%5]
                    m.shell('Curved photovoltaic tile',[(x,surface(x,z,ix,iz),z) for x,z in poly],(0,-.12,0),material)
            # Four thin bowed field edges establish the continuous draped grid.
            for edge in range(2):
                points=[]
                for k in range(21):
                    x=x0+(du*k/20 if edge==0 else 0)
                    z=z0+(0 if edge==0 else dv*k/20)
                    clipped=clip_convex([(x-.001,z-.001),(x+.001,z-.001),(x+.001,z+.001),(x-.001,z+.001)],ring)
                    if clipped:points.append((x,surface(x,z,ix,iz)+.08,z))
                    elif len(points)>1:
                        m.tube('Bow shaped field flashing',points,.13,'flashing');points=[]
                if len(points)>1:m.tube('Bow shaped field flashing',points,.13,'flashing')
            # A narrow raised smile of glazing along the back of each draped field.
            # It bends across the span and returns flush at its ends.
            z=z0+dv*.86
            lower=[];upper=[]
            for k in range(25):
                t=k/24;x=x0+du*(.06+.88*t)
                lower.append((x,surface(x,z,ix,iz)+.1,z))
                upper.append((x,surface(x,z,ix,iz)+.1+1.35*math.sin(math.pi*t),z+.40))
            # Perimeter fields have clipped eyebrows; interior fields remain 64
            # identifiable canopy modules, never oversized generic roof lanterns.
            for k in range(24):
                poly=clip_convex([(lower[k][0],z-.01),(lower[k+1][0],z-.01),(lower[k+1][0],z+.41),(lower[k][0],z+.41)],ring)
                if len(poly)<3:continue
                m.shell('Smile shaped clerestory pane',[lower[k],lower[k+1],upper[k+1],upper[k]],(0,0,.09),'glass')
                # Upper stainless lip is separate geometry, visible from the road.
                m.tube('Clerestory eyebrow',[upper[k],upper[k+1]],.105,'flashing')
                if k%2==0:m.tube('Clerestory glazing bar',[lower[k],upper[k]],.035,'mullion',6)
    # Scribed outer rim follows the actual footprint, with eaves at the local roof height.
    for a,b in zip(ring,ring[1:]+ring[:1]):
        steps=max(2,math.ceil(math.dist(a,b)/1.5));top=[];bottom=[]
        for j in range(steps+1):
            t=j/steps;x=a[0]+(b[0]-a[0])*t;z=a[1]+(b[1]-a[1])*t
            ix=min(nx-1,max(0,int((x-lo[0])/du)));iz=min(nz-1,max(0,int((z-lo[1])/dv)))
            y=surface(x,z,ix,iz)
            top.append((x,y,z));bottom.append((x,y-.30,z))
        m.tube('Continuous thin silver eave',top,.18,'flashing')
        edge_length=math.dist(a,b)
        m.patch('Warm roof edge fascia',[top,bottom],((b[1]-a[1])/edge_length*.035,0,-(b[0]-a[0])/edge_length*.035),'underside')
    # Slender branching supports at the eaves read as a real canopy rather than a solid mound.
    for i in range(0,len(inner),2):
        x,z=inner[i]
        ix=min(nx-1,max(0,int((x-lo[0])/du)));iz=min(nz-1,max(0,int((z-lo[1])/dv)))
        roof=surface(x,z,ix,iz)-.3
        m.tube('Canopy steel column',[(x,.48,z),(x,roof,z)],.19,'flashing')
        for dx in (-1,1):m.tube('Canopy fork brace',[(x,roof-3,z),(x+dx*2,roof-.12,z)],.10,'flashing')
    return m


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--render-dir',type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    build().finish(ROOT/args.render_dir if args.render_dir else None)
