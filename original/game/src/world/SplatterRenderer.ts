import * as THREE from 'three';
import {splatterPattern} from './SplatterPattern';

/** One reusable scratch field; each call rasterizes newly sampled droplets on the GPU. */
export class SplatterRenderer {
 private readonly field=new THREE.WebGLRenderTarget(256,256,{type:THREE.HalfFloatType,depthBuffer:false});
 private readonly scene=new THREE.Scene();
 private readonly camera=new THREE.Camera();
 private readonly geometry=new THREE.InstancedBufferGeometry();
 private readonly material=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,
  blending:THREE.AdditiveBlending,
  vertexShader:`attribute vec4 blob;attribute vec2 shape;varying vec2 local;varying float weight;
   void main(){local=position.xy*2.4;weight=shape.y;
    vec2 d=local*blob.z*vec2(blob.w,1.0);float c=cos(shape.x),s=sin(shape.x);
    vec2 p=blob.xy+mat2(c,s,-s,c)*d;gl_Position=vec4(p/128.0-1.0,0.0,1.0);}`,
  fragmentShader:`varying vec2 local;varying float weight;void main(){float v=exp(-2.6*dot(local,local));
   gl_FragColor=vec4(weight>0.0?v:0.0,weight<0.0?v*(-weight):0.0,0.0,1.0);}`});
 private readonly finishScene=new THREE.Scene();
 private readonly finishMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,
  uniforms:{field:{value:this.field.texture},seed:{value:0}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
  fragmentShader:`uniform sampler2D field;uniform float seed;varying vec2 vUv;
   float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1))+seed)*43758.5453);}
   float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
   float fbm(vec2 p){return noise(p)*.6+noise(p*2.3)*.3+noise(p*5.1)*.1;}
   void main(){vec2 warp=vec2(fbm(vUv*5.0),fbm(vUv*5.0+19.3))-.5;
    vec2 sampleUv=vUv+warp*.047;vec2 f=texture2D(field,clamp(sampleUv,0.0,1.0)).rg;
    float wet=smoothstep(.36,.54,f.r-f.g);
    wet*=smoothstep(0.0,.015,vUv.x)*smoothstep(0.0,.015,vUv.y)*smoothstep(0.0,.015,1.0-vUv.x)*smoothstep(0.0,.015,1.0-vUv.y);
    gl_FragColor=vec4(vec3(wet),wet);}`});
 private readonly sootScene=new THREE.Scene();
 /** A bomb's mark on a car is a matte soot cloud, not a droplet splash. */
 private readonly sootMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,
  uniforms:{seed:{value:0}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
  fragmentShader:`uniform float seed;varying vec2 vUv;
   float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1))+seed)*43758.5453);}
   float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
   float fbm(vec2 p){return noise(p)*.55+noise(p*2.3)*.3+noise(p*5.1)*.15;}
   void main(){float soot=smoothstep(.28,.72,fbm(vUv*6.0))*.8+.2*noise(vUv*38.0);
    gl_FragColor=vec4(vec3(soot),soot);}`});
 private readonly quad=new THREE.PlaneGeometry(2,2);
 generated=0;
 lastMilliseconds=0;
 constructor(){
  this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,-1,1,0,1,1,0],3));
  this.geometry.setIndex([0,1,2,2,1,3]);
  const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene.add(mesh);
  this.finishScene.add(new THREE.Mesh(this.quad,this.finishMaterial));
  this.sootScene.add(new THREE.Mesh(this.quad,this.sootMaterial));
 }
 /** Fill `target` with blotchy soot; the body coat's distance falloff shapes it into a burn round the blast. */
 generateSoot(renderer:THREE.WebGLRenderer,seed:number,target:THREE.WebGLRenderTarget):void{
  const previous=renderer.getRenderTarget(),auto=renderer.autoClear;
  renderer.autoClear=true;this.sootMaterial.uniforms.seed!.value=seed;
  renderer.setRenderTarget(target);renderer.render(this.sootScene,this.camera);
  renderer.setRenderTarget(previous);renderer.autoClear=auto;this.generated++;
 }
 generate(renderer:THREE.WebGLRenderer,seed:number,speed:number,target:THREE.WebGLRenderTarget,exposure?:number):void{
  const begin=performance.now(),pattern=splatterPattern(seed,speed,exposure);
  const blobs=new Float32Array(pattern.blobs.length*4),shapes=new Float32Array(pattern.blobs.length*2);
  pattern.blobs.forEach((b,i)=>{blobs.set([b.x,b.y,b.radius,b.aspect],i*4);shapes.set([b.angle,b.weight],i*2);});
  this.geometry.dispose();
  this.geometry.setAttribute('blob',new THREE.InstancedBufferAttribute(blobs,4));
  this.geometry.setAttribute('shape',new THREE.InstancedBufferAttribute(shapes,2));this.geometry.instanceCount=pattern.blobs.length;
  const previous=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),test=renderer.getScissorTest();
  const clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),auto=renderer.autoClear;
  renderer.setScissorTest(false);renderer.autoClear=true;renderer.setClearColor(0,0);
  renderer.setRenderTarget(this.field);renderer.render(this.scene,this.camera);
  this.finishMaterial.uniforms.seed!.value=seed;
  renderer.setRenderTarget(target);renderer.render(this.finishScene,this.camera);
  renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);
  renderer.setClearColor(clear,alpha);renderer.autoClear=auto;
  this.generated++;this.lastMilliseconds=performance.now()-begin;
 }
 dispose():void{this.field.dispose();this.geometry.dispose();this.material.dispose();this.quad.dispose();this.finishMaterial.dispose();this.sootMaterial.dispose();}
}
