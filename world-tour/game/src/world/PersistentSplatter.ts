import * as THREE from 'three';
import type {PhysicsWorld} from '../physics/PhysicsWorld';
import {transferRenderTargets} from './transferRenderTargets';
import {SplatterRenderer} from './SplatterRenderer';
const TILE=8,RES=256;
interface Stamp {point:THREE.Vector3;normal:THREE.Vector3;velocity:THREE.Vector3;color:THREE.Color;seed:number;span:number;scorch:boolean}
/** The soot a bomb leaves on the road: near-black, not a liquid colour. */
export const SCORCH_COLOR=0x050403;
interface Tile {target:THREE.WebGLRenderTarget;mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;x:number;z:number;count:number}
/** Impacts are composited once into local road patches; laps never recycle prior marks. */
export class PersistentSplatter {
 readonly group=new THREE.Group();
 private readonly tiles=new Map<string,Tile>();
 private readonly pending:Stamp[]=[];
 private readonly scratch=new THREE.WebGLRenderTarget(256,256,{depthBuffer:false});
 private readonly scene=new THREE.Scene();
 private readonly camera=new THREE.Camera();
 private readonly quad=new THREE.PlaneGeometry(2,2);
 private readonly material=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,
  uniforms:{pattern:{value:this.scratch.texture},origin:{value:new THREE.Vector2()},forward:{value:new THREE.Vector2()},tile:{value:new THREE.Vector2()},color:{value:new THREE.Color()},span:{value:7.5},scorch:{value:0},seed:{value:0}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}`,
  fragmentShader:`uniform sampler2D pattern;uniform vec2 origin,forward,tile;uniform vec3 color;uniform float span,scorch,seed;varying vec2 vUv;
   float hash(vec2 q){return fract(sin(dot(q,vec2(41.3,289.1))+seed)*43758.5453);}
   float noise(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
   float fbm(vec2 q){return noise(q)*.55+noise(q*2.1)*.3+noise(q*4.7)*.15;}
   void main(){vec2 d=tile+vUv*8.0-origin;vec2 local=vec2(dot(d,forward),dot(d,vec2(-forward.y,forward.x)))/span;
    if(scorch>.5){
     // A soot blot: darkest in the middle, a ragged edge from warped noise, streaks thrown outward.
     // Noise is sampled on the unit direction, not the angle: atan jumps from pi to -pi on one ray and
     // left a straight cut through the ragged edge.
     vec2 c=local*2.0;float r=length(c);vec2 dir=c/max(r,1e-4);
     float edge=.48+.5*fbm(dir*1.9+vec2(seed*.013,seed*.029)+c*1.2);
     float streak=.5+.5*noise(dir*6.5+vec2(seed*.007,seed*.011));
     float soot=1.0-smoothstep(edge*.55,edge*(1.0+.25*streak),r);
     soot*=.6+.4*fbm(c*3.4+seed*.01);
     if(soot<.004)discard;
     // Unlit like every road mark, so it is kept darker than any lit asphalt: a burn must never glow at night.
     gl_FragColor=vec4(color,soot*.9);return;}
    vec2 p=local+vec2(.17,.5);
    if(any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1))))discard;
    float wet=texture2D(pattern,p).a;gl_FragColor=vec4(color,wet*.68);}`});
 count=0;
 generationMilliseconds=0;
 /** Never drawn: gives the loading-screen compile the road-patch material before the first impact creates one. */
 private readonly prototype=new THREE.Mesh(new THREE.PlaneGeometry(1,1),PersistentSplatter.patchMaterial(this.scratch.texture));
 constructor(private readonly physics:PhysicsWorld){this.group.name='persistent-slime-splatter';this.scene.add(new THREE.Mesh(this.quad,this.material));this.prototype.visible=false;this.group.add(this.prototype);}
 private static patchMaterial(map:THREE.Texture):THREE.MeshBasicMaterial{return new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});}
 /** Compile the offscreen composite and splatter passes behind the loading screen. */
 prepareGpu(renderer:THREE.WebGLRenderer,generator:SplatterRenderer):void{
  const previous=renderer.getRenderTarget();
  // Compile against a road-patch target: the colour space of the destination is part of the program.
  const probe=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
  generator.generate(renderer,1,12,this.scratch);generator.generateSoot(renderer,1,this.scratch);
  renderer.setRenderTarget(probe);renderer.compile(this.scene,this.camera);
  renderer.setRenderTarget(previous);probe.dispose();
 }
 add(point:THREE.Vector3,normal:THREE.Vector3,velocity:THREE.Vector3,color:THREE.Color,radius=2):void{
  if(normal.y<.55)return;
  this.pending.push({point:point.clone(),normal:normal.clone(),velocity:velocity.clone(),color:color.clone(),seed:++this.count,span:7.5*THREE.MathUtils.clamp(radius/2,.12,1.4),scorch:false});
 }
 /** A bomb's burn on the road, centred on the blast and `radius` metres across its dark core. */
 scorch(point:THREE.Vector3,normal:THREE.Vector3,radius:number):void{
  if(normal.y<.55)return;
  this.scorches++;
  this.pending.push({point:point.clone(),normal:normal.clone(),velocity:new THREE.Vector3(0,0,-1),color:new THREE.Color(SCORCH_COLOR),
   seed:++this.count,span:THREE.MathUtils.clamp(radius*4.2,2.5,28),scorch:true});
 }
 scorches=0;
 private tile(x:number,z:number,stamp:Stamp,renderer:THREE.WebGLRenderer):Tile{
  const key=`${x},${z},${Math.floor(stamp.point.y/16)}`;
  const old=this.tiles.get(key);if(old)return old;
  const target=new THREE.WebGLRenderTarget(RES,RES,{depthBuffer:false});
  const geometry=new THREE.PlaneGeometry(TILE,TILE,8,8);geometry.rotateX(-Math.PI/2);geometry.translate(x+TILE/2,0,z+TILE/2);
  const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  for(let i=0;i<positions.count;i++){
   const px=positions.getX(i),pz=positions.getZ(i);
   const planeY=stamp.point.y-(stamp.normal.x*(px-stamp.point.x)+stamp.normal.z*(pz-stamp.point.z))/stamp.normal.y;
   const hit=this.physics.surfaceAt(px,pz,planeY+1.5,planeY-1.5);
   positions.setY(i,hit&&hit.normal.y>.55?hit.point.y+.03:planeY+.03);
   uv.setXY(i,(px-x)/TILE,(pz-z)/TILE);
  }
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,PersistentSplatter.patchMaterial(target.texture));
  mesh.name=`slime-ground-${key}`;this.group.add(mesh);
  renderer.setRenderTarget(target);renderer.clear();
  const tile={target,mesh,x,z,count:0};this.tiles.set(key,tile);return tile;
 }
 render(renderer:THREE.WebGLRenderer,generator:SplatterRenderer):void{
  if(!this.pending.length)return;
  const begin=performance.now(),previous=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),test=renderer.getScissorTest();
  const clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),auto=renderer.autoClear;
  renderer.setScissorTest(false);renderer.setClearColor(0,0);renderer.autoClear=false;
  // Bound the spike, not the lifetime: queued unique impacts continue on following frames.
  for(let i=0;i<4&&this.pending.length;i++){
   const stamp=this.pending.shift()!;if(!stamp.scorch)generator.generate(renderer,stamp.seed,stamp.velocity.length(),this.scratch);
   const forward=new THREE.Vector2(stamp.velocity.x,stamp.velocity.z);if(forward.lengthSq()<1e-6)forward.set(0,-1);forward.normalize();
   this.material.uniforms.origin!.value.set(stamp.point.x,stamp.point.z);
   this.material.uniforms.span!.value=stamp.span;this.material.uniforms.scorch!.value=stamp.scorch?1:0;this.material.uniforms.seed!.value=stamp.seed;
   this.material.uniforms.forward!.value.copy(forward);this.material.uniforms.color!.value.copy(stamp.color);
   const box=stamp.scorch?[[-.5,-.5],[-.5,.5],[.5,-.5],[.5,.5]]:[[-.17,-.5],[-.17,.5],[.83,-.5],[.83,.5]];
   const corners=box.map(([x,z])=>new THREE.Vector2(stamp.point.x,stamp.point.z)
    .addScaledVector(forward,x!*stamp.span).addScaledVector(new THREE.Vector2(-forward.y,forward.x),z!*stamp.span));
   const minX=Math.min(...corners.map(p=>p.x)),maxX=Math.max(...corners.map(p=>p.x)),minZ=Math.min(...corners.map(p=>p.y)),maxZ=Math.max(...corners.map(p=>p.y));
   for(let tx=Math.floor(minX/TILE);tx<=Math.floor(maxX/TILE);tx++)
    for(let tz=Math.floor(minZ/TILE);tz<=Math.floor(maxZ/TILE);tz++){
     const tile=this.tile(tx*TILE,tz*TILE,stamp,renderer);
     this.material.uniforms.tile!.value.set(tile.x,tile.z);renderer.setRenderTarget(tile.target);renderer.render(this.scene,this.camera);tile.count++;
    }
  }
  renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);renderer.setClearColor(clear,alpha);renderer.autoClear=auto;
  this.generationMilliseconds=performance.now()-begin;
 }
 transferRenderer(previous:THREE.WebGLRenderer,next:THREE.WebGLRenderer):void{
  transferRenderTargets(previous,next,[...this.tiles.values()].map(tile=>tile.target));
 }
 get stats(){return {impacts:this.count,scorches:this.scorches,pending:this.pending.length,tiles:this.tiles.size,bytes:this.tiles.size*RES*RES*4,generationMilliseconds:this.generationMilliseconds};}
 dispose():void{for(const tile of this.tiles.values()){tile.target.dispose();tile.mesh.geometry.dispose();tile.mesh.material.dispose();}this.tiles.clear();this.group.removeFromParent();this.prototype.geometry.dispose();this.prototype.material.dispose();this.scratch.dispose();this.quad.dispose();this.material.dispose();}
}
