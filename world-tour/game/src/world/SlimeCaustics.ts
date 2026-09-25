import { reducedMotion } from '../ui/reducedMotion';
import * as THREE from 'three';
import type {SlimeSpawn} from './Slimes';
/** Integer spatial/time frequencies reproduce the approved seed-11 optical tile exactly. */
export const CAUSTIC_WAVES=[
 [1.17200763,2,2,4,3.77932564],[.36408322,4,1,5,5.83212186],[.17554303,5,2,6,5.95852340],
 [.1223469,-5,-4,7,3.21315827],[.08525566,-4,-6,7,.86687897],[.06965788,2,-8,8,3.21939302],
 [.05339475,4,-8,8,6.16326217],[.04562838,3,9,8,3.03870359],[.04016563,-6,8,8,1.47844124],
] as const;
export function causticIntensity(x:number,y:number,time:number):number{
 let xx=0,yy=0,xy=0;
 for(const [a,mx,my,p,phase] of CAUSTIC_WAVES){const kx=mx*2*Math.PI,ky=my*2*Math.PI,s=Math.sin(kx*x+ky*y+2*Math.PI*p*time/8+phase)*a;xx-=kx*kx*s;yy-=ky*ky*s;xy-=kx*ky*s;}
 return 1/(Math.abs((1+.0031*xx)*(1+.0031*yy)-(.0031*xy)**2)+.11);
}
/**
 * How opaque the ripple is before the world's own light scales it. One owner, because
 * the driver's own feedback reports the same base and a second copy would drift from this one.
 */
export function causticBase(): number { return reducedMotion() ? .08 : .7; }

export class SlimeCaustics {
 // Shared by every layer: a restart re-patches surfaces with the same program key, and three then reuses the
 // compiled program together with the uniform objects the first layer bound, so those must stay the live ones.
 private static readonly shared={target:new THREE.WebGLRenderTarget(256,256,{depthBuffer:false}),time:{value:0},strength:{value:0},
  centre:{value:new THREE.Vector3()},size:{value:new THREE.Vector3(1,1,1)},yaw:{value:0}};
 private readonly target=SlimeCaustics.shared.target;
 private readonly scene=new THREE.Scene();
 private readonly camera=new THREE.Camera();
 private readonly geometry=new THREE.PlaneGeometry(2,2);
 private readonly time=SlimeCaustics.shared.time;
 private readonly strength=SlimeCaustics.shared.strength;
 private readonly centre=SlimeCaustics.shared.centre;
 private readonly size=SlimeCaustics.shared.size;
 private readonly yaw=SlimeCaustics.shared.yaw;
 private readonly patched=new Map<THREE.Material,{compile:THREE.Material['onBeforeCompile'];key:THREE.Material['customProgramCacheKey']}>();
 private readonly material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{time:this.time},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}`,
  fragmentShader:`uniform float time;varying vec2 vUv;void main(){vec3 h=vec3(0);${CAUSTIC_WAVES.map(([a,x,y,p,phase])=>`{vec2 k=6.28318530718*vec2(${x.toFixed(1)},${y.toFixed(1)});float s=${a}*sin(dot(k,vUv)+6.28318530718*${p.toFixed(1)}*time/8.0+${phase});h-=s*vec3(k.x*k.x,k.y*k.y,k.x*k.y);}`).join('')}
   float det=(1.0+.0031*h.x)*(1.0+.0031*h.y)-(.0031*h.z)*(.0031*h.z);
   float glow=pow(clamp((1.0/(abs(det)+.11)-.45)/8.5,0.0,1.0),1.55);gl_FragColor=vec4(vec3(glow),1);}`});
 milliseconds=0;
 constructor(){this.target.texture.wrapS=this.target.texture.wrapT=THREE.RepeatWrapping;this.scene.add(new THREE.Mesh(this.geometry,this.material));}
 /** What the shader is multiplying by right now: the base opacity times the world's own light. */
 get opacity():number{return this.strength.value;}
 prepare(spawn:SlimeSpawn|null,strength=1):void{
  this.strength.value=spawn ? strength*causticBase() : 0;
  if(spawn){this.centre.value.set(...spawn.position);this.size.value.set(...spawn.scale);this.yaw.value=spawn.yaw;}
 }
 render(renderer:THREE.WebGLRenderer,world:THREE.Scene,time:number):void{
  const begin=performance.now();this.time.value=reducedMotion() ? 0 : time;
  this.attach(world);
  const previous=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),test=renderer.getScissorTest();
  renderer.setScissorTest(false);renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);
  renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);this.milliseconds=performance.now()-begin;
 }
 /** Patch every surface before its first compile: patching a compiled material recompiles all of them at once. */
 attach(world:THREE.Object3D):void{
  world.traverse(node=>{
   if(!(node instanceof THREE.Mesh))return;
   for(const material of Array.isArray(node.material)?node.material:[node.material]){
    if(material instanceof THREE.ShaderMaterial||this.patched.has(material))continue;
    const old={compile:material.onBeforeCompile,key:material.customProgramCacheKey};this.patched.set(material,old);
    material.addEventListener('dispose',()=>this.patched.delete(material));
    material.onBeforeCompile=(shader:Parameters<THREE.Material['onBeforeCompile']>[0],r:THREE.WebGLRenderer)=>{
     old.compile.call(material,shader,r);
     // A far-atmosphere clone runs its base's callback first; when both are patched, inject once only.
     if(shader.vertexShader.includes('vSlimeCausticWorld'))return;
     Object.assign(shader.uniforms,{uSlimeCausticStrength:this.strength,causticMap:{value:this.target.texture},causticCentre:this.centre,causticSize:this.size,causticYaw:this.yaw});
     shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSlimeCausticWorld;').replace('#include <project_vertex>','#include <project_vertex>\nvec4 causticPosition=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\ncausticPosition=instanceMatrix*causticPosition;\n#endif\nvSlimeCausticWorld=(modelMatrix*causticPosition).xyz;');
     // The lit area is the body's actual cut through this surface, not its widest ring projected
     // straight down. In normalised space the body is the unit sphere, so at
     // the surface's own height its cross-section has radius sqrt(1 - y*y) -- zero once the surface is
     // past the body's top or bottom, which keeps anything outside the real footprint dark and replaces
     // 374's separate height bounds. The soft edge stays proportional (the last 18% of the patch)
     // rather than absolute, so it does not turn back into the hard arc 374 was fixing: on a wide giant
     // it is still metres of fade, on a narrow cut it shrinks with the cut instead of swallowing it.
     // Shader comments would ship in the build, where task numbers have no business.
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vSlimeCausticWorld;uniform sampler2D causticMap;uniform vec3 causticCentre,causticSize;uniform float causticYaw,uSlimeCausticStrength;`)
      .replace('#include <opaque_fragment>',`if(uSlimeCausticStrength>0.0){vec3 d=vSlimeCausticWorld-causticCentre;float c=cos(causticYaw),s=sin(causticYaw);
       vec3 inside=vec3(c*d.x-s*d.z,d.y,s*d.x+c*d.z)/causticSize;
       float causticCut=sqrt(max(0.0,1.0-inside.y*inside.y));
       float causticRadial=length(inside.xz);
       float slimeCausticBand=causticCut>0.0
        ? (1.0-smoothstep(.82*causticCut,causticCut,causticRadial))*uSlimeCausticStrength
        : 0.0;
       vec2 cuv=vSlimeCausticWorld.xz/6.0;
       float light=texture2D(causticMap,cuv).r+.27*texture2D(causticMap,mat2(.857,.515,-.515,.857)*cuv*.617).r;
       outgoingLight+=vec3(.38,.8,1.0)*light*slimeCausticBand;}
       #include <opaque_fragment>`);
    };
    material.customProgramCacheKey=()=>old.key.call(material)+'-volume-caustics';material.needsUpdate=true;
   }
  });

 }
 get surfaces(){return this.patched.size;}
 dispose():void{for(const [m,old]of this.patched){m.onBeforeCompile=old.compile;m.customProgramCacheKey=old.key;m.needsUpdate=true;}this.patched.clear();this.strength.value=0;this.geometry.dispose();this.material.dispose();}
}
