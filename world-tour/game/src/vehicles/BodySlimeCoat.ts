import * as THREE from 'three';
import {transferRenderTargets} from '../world/transferRenderTargets';
import {coatingFadeRate} from '../world/SplatterPattern';
import type {SplatterRenderer} from '../world/SplatterRenderer';
import {COAT_EXPOSURE_DEPTH_M, COAT_EXPOSURE_GRID, coatExposureMap} from './coatExposure';
let nextCoatInstance=0;
const NORMALS=[new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)];
/** Colour the real shell triangles, so a coat follows bonnets and doors without floating decals. */
export class BodySlimeCoat {
 private readonly targets=NORMALS.map(()=>new THREE.WebGLRenderTarget(256,256,{depthBuffer:false}));
 private readonly inverse={value:new THREE.Matrix4()};
 private readonly opacity={value:0};
 private readonly color={value:new THREE.Color(0x8aff46)};
 private readonly impact={value:new THREE.Vector3()};
 private readonly reach={value:1000};
 private readonly direction={value:new THREE.Vector3(0,0,-1)};
 private readonly centre={value:new THREE.Vector3()};
 private readonly half={value:new THREE.Vector3()};
 private readonly exposure={value:null as THREE.DataTexture|null};
 /** 1 while the coat is a bomb's soot: matte, no wet sheen. */
 private readonly matte={value:0};
 private pending:{seed:number;speed:number;direction:THREE.Vector3;soot:boolean}|null=null;
 private serial=0;
 /** Whether the latest hit was a bomb's soot, before or after its GPU pass has run. */
 private soot=false;
 private readonly instanceSeed=++nextCoatInstance*7919;
 constructor(private readonly group:THREE.Group,wheels:readonly THREE.Object3D[]){
  group.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3().setFromObject(group).applyMatrix4(group.matrixWorld.clone().invert());
  bounds.getSize(this.half.value).multiplyScalar(.5);bounds.getCenter(this.centre.value);
  // Only the outer layer takes the coat: seats and floor under the roof and glass stay clean (380).
  this.exposure.value=coatExposureMap(group,wheels,this.centre.value,this.half.value);
  group.traverse(node=>{
   if(!(node instanceof THREE.Mesh))return;
   for(let parent:THREE.Object3D|null=node;parent&&parent!==group;parent=parent.parent)if(wheels.includes(parent))return;
   for(const material of Array.isArray(node.material)?node.material:[node.material]){
    if(!(material instanceof THREE.MeshStandardMaterial))continue;
    material.onBeforeCompile=shader=>{
     Object.assign(shader.uniforms,{coatExposure:this.exposure,coatInverse:this.inverse,coatOpacity:this.opacity,coatColor:this.color,coatHalf:this.half,coatCentre:this.centre,coatDirection:this.direction,coatImpact:this.impact,coatReach:this.reach,coatMatte:this.matte});
     this.targets.forEach((target,i)=>{shader.uniforms[`coat${i}`]={value:target.texture};});
     shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nuniform mat4 coatInverse;varying vec3 coatPosition;varying vec3 coatNormal;`)
      .replace('#include <project_vertex>',`#include <project_vertex>\ncoatPosition=(coatInverse*modelMatrix*vec4(transformed,1.0)).xyz;coatNormal=normalize(mat3(coatInverse*modelMatrix)*objectNormal);`);
     shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform float coatOpacity,coatReach,coatMatte;uniform vec3 coatColor,coatHalf,coatCentre,coatDirection,coatImpact;varying vec3 coatPosition,coatNormal;uniform sampler2D coat0,coat1,coat2,coat3,coat4,coat5,coatExposure;`)
      .replace('#include <color_fragment>',`#include <color_fragment>
       vec3 cn=normalize(coatNormal),an=abs(cn),cp=(coatPosition-coatCentre)/(2.0*coatHalf)+.5;float wet;
       if(an.x>an.y&&an.x>an.z)wet=cn.x>0.0?texture2D(coat0,cp.zy).a:texture2D(coat1,cp.zy).a;
       else if(an.y>an.z)wet=cn.y>0.0?texture2D(coat2,cp.zx).a:texture2D(coat3,cp.zx).a;
       else {vec2 frontUv=cp.xy;if(coatDirection.x>0.0)frontUv.x=1.0-frontUv.x;wet=cn.z>0.0?texture2D(coat4,frontUv).a:texture2D(coat5,frontUv).a;}
       float tile=an.x>an.y&&an.x>an.z?(cn.x>0.0?0.0:1.0):an.y>an.z?(cn.y>0.0?2.0:3.0):(cn.z>0.0?4.0:5.0);
       vec3 plane=tile<1.5?vec3(cp.z,cp.y,cp.x):tile<3.5?vec3(cp.z,cp.x,cp.y):cp;
       vec2 cell=(floor(clamp(plane.xy,0.0,.9999)*${COAT_EXPOSURE_GRID}.0)+.5)/${COAT_EXPOSURE_GRID}.0;
       float outer=texture2D(coatExposure,(vec2(mod(tile,3.0),floor(tile/3.0))+cell)/vec2(3.0,2.0)).r;
       float sideHalf=tile<1.5?coatHalf.x:tile<3.5?coatHalf.y:coatHalf.z;
       float inside=${COAT_EXPOSURE_DEPTH_M}/(2.0*sideHalf);
       wet*=mod(tile,2.0)<.5?step(outer-inside,plane.z):step(plane.z,outer+inside);
       wet*=1.0-smoothstep(coatReach*.75,coatReach*1.2,distance(coatPosition,coatImpact));
       diffuseColor.rgb=mix(diffuseColor.rgb,coatColor,wet*coatOpacity*.9);
       diffuseColor.a=mix(diffuseColor.a,1.0,wet*coatOpacity*.85);`)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,mix(.16,.97,coatMatte),wet*coatOpacity);')
      // metalnessFactor is declared by metalnessmap_fragment, which three.js emits after the roughness chunk.
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,0.0,wet*coatOpacity*coatMatte);');
    };
    material.customProgramCacheKey=()=> 'body-slime-coat';material.needsUpdate=true;
   }
  });
 }
 hit(origin:THREE.Vector3,speed:number,color:THREE.Color,reach=this.half.value.length()*5,soot=false):void{
  this.impact.value.copy(origin);this.reach.value=reach;
  const direction=origin.clone().setY(0);if(direction.lengthSq()<1e-5)direction.set(0,0,-1);direction.normalize();
  this.soot=soot;this.pending={seed:this.instanceSeed+(++this.serial)*1031,speed,direction,soot};this.color.value.copy(color);this.direction.value.copy(direction);
 }
 render(renderer:THREE.WebGLRenderer,generator:SplatterRenderer):void{
  if(!this.pending)return;
  const {seed,speed,direction,soot}=this.pending;
  NORMALS.forEach((normal,i)=>soot?generator.generateSoot(renderer,seed+i*97,this.targets[i]!)
   :generator.generate(renderer,seed+i*97,speed,this.targets[i]!,normal.dot(direction)));
  this.matte.value=soot?1:0;this.pending=null;this.opacity.value=1;
 }
 update(dt:number,speed:number):void{
  this.group.updateWorldMatrix(true,false);this.inverse.value.copy(this.group.matrixWorld).invert();
  this.opacity.value=Math.max(0,this.opacity.value-dt*coatingFadeRate(speed));
 }
 transferRenderer(previous:THREE.WebGLRenderer,next:THREE.WebGLRenderer):void{
  if(this.opacity.value>0)transferRenderTargets(previous,next,this.targets);
 }
 clear():void{this.opacity.value=0;this.pending=null;}
 get stats(){return {opacity:this.opacity.value,impacts:this.serial,pending:!!this.pending,soot:this.soot};}
 dispose():void{this.targets.forEach(target=>target.dispose());this.exposure.value?.dispose();}
}
