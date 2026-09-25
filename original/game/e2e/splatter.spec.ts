import { DEV_URL } from './server';
import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
const out=evidencePath('splatter');
function save(name:string,url:string){mkdirSync(out,{recursive:true});writeFileSync(resolve(out,name+'.png'),Buffer.from(url.split(',')[1]!,'base64'));}
test('GPU patterns vary by speed and seed and batch generation reports completed GPU time',async({page})=>{
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const result=await page.evaluate(async()=>{
  const threePath='/node_modules/three/build/three.module.js',T=await import(threePath);
  const generatorPath='/src/world/SplatterRenderer.ts';const {SplatterRenderer}=await import(generatorPath);
  const canvas=document.createElement('canvas'),r=new T.WebGLRenderer({canvas}),g=new SplatterRenderer(),target=new T.WebGLRenderTarget(256,256,{depthBuffer:false});
  const images=[];const pixels=new Uint8Array(256*256*4);
  for(const speed of [10,60,150,300]){
   g.generate(r,41,speed/3.6,target);r.readRenderTargetPixels(target,0,0,256,256,pixels);
   const c=document.createElement('canvas');c.width=c.height=256;c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels),256,256),0,0);
   images.push({speed,url:c.toDataURL(),wet:pixels.filter((v,i)=>i%4===3&&v>100).length,hash:pixels.reduce((a,v)=>Math.imul(a^v,16777619)>>>0,2166136261)});
  }
  const times=[];
  for(const n of [1,4,8,16]){const begin=performance.now();for(let i=0;i<n;i++)g.generate(r,91+i,30,target);r.getContext().finish();times.push({count:n,milliseconds:performance.now()-begin});}
  g.generate(r,42,300/3.6,target);r.readRenderTargetPixels(target,0,0,256,256,pixels);
  const otherHash=pixels.reduce((a,v)=>Math.imul(a^v,16777619)>>>0,2166136261);
  g.dispose();target.dispose();r.dispose();return {images,times,otherHash};
 });
 expect(new Set(result.images.map(i=>i.hash)).size).toBe(4);
 expect(result.otherHash).not.toBe(result.images[3]!.hash);
 for(const image of result.images){expect(image.wet).toBeGreaterThan(500);save(`speed-${image.speed}`,image.url);}
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'generation.json'),JSON.stringify({...result,images:result.images.map(({url,...rest})=>rest)},null,2));
});

test('real road tiles retain their first impact across later laps and reset with a new race',async({page})=>{
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const result=await page.evaluate(async()=>{
  const threePath='/node_modules/three/build/three.module.js',T=await import(threePath);const g=window.game as any;
  await g.startRace({trackId:'synth-p2p',vehicleId:'micro-hatch',ai:false,slimeDensity:'normal'});g.phase='paused';
  const s=g.session,layer=s.slimes,r=s.world.renderer,marks=layer.groundSplatter;
  s.physics.step(1/60,()=>{});
  const p=s.world.spline.point(s.world.spline.indexAt(60));
  const point=new T.Vector3(...p),normal=new T.Vector3(0,1,0),velocity=new T.Vector3(0,0,-30);
  marks.add(point,normal,velocity,new T.Color(0x63ff35));layer.renderEffects(r);
  const first=[...marks.tiles.values()];
  const hash=()=>first.map((tile:any)=>{const pixels=new Uint8Array(256*256*4);r.readRenderTargetPixels(tile.target,0,0,256,256,pixels);return pixels.reduce((a,v)=>Math.imul(a^v,16777619)>>>0,2166136261);});
  const before=hash(),laps=[];
  let wet=0;for(const tile of first as any[]){const pixels=new Uint8Array(256*256*4);r.readRenderTargetPixels(tile.target,0,0,256,256,pixels);for(let i=3;i<pixels.length;i+=4)if(pixels[i]!>100)wet++;}
  for(let lap=2;lap<=3;lap++){
   for(let i=0;i<180;i++)marks.add(point.clone().add(new T.Vector3(0,0,-40)),normal,velocity,new T.Color(0xf51d24));
   while(marks.stats.pending)layer.renderEffects(r);
   laps.push({lap,hash:hash(),stats:marks.stats});
  }
  const w=s.world;w.camera.position.copy(point).add(new T.Vector3(3,10,5));w.camera.lookAt(point);w.sky.follow(point.x,point.y,point.z);
  r.setScissorTest(false);r.render(w.scene,w.camera);const url=r.domElement.toDataURL();
  await g.startRace({trackId:'synth-p2p',vehicleId:'micro-hatch',ai:false});
  return {before,laps,url,wet,reset:g.session.slimes.groundSplatter.stats};
 });
 expect(result.wet).toBeGreaterThan(500);
 for(const lap of result.laps)expect(lap.hash).toEqual(result.before);
 expect(result.laps[1]!.stats.impacts).toBe(361);expect(result.reset.impacts).toBe(0);
 save('third-lap-first-mark',result.url);writeFileSync(resolve(out,'persistence.json'),JSON.stringify({...result,url:undefined},null,2));
});

test('actual car shell receives front and side coats that fade faster while driving',async({page})=>{
 const errors:string[]=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const result=await page.evaluate(async()=>{
  const threePath='/node_modules/three/build/three.module.js',T=await import(threePath),g=window.game as any;
  await g.startRace({trackId:'synth-p2p',vehicleId:'jeep',ai:false});g.phase='paused';const s=g.session,r=s.world.renderer,m=s.model,coat=m.bodyCoat,layer=s.slimes;
  s.humans[0].render(1,1/60);const p=s.car.position,w=s.world;w.camera.position.copy(m.group.localToWorld(new T.Vector3(4,2.2,-4)));w.camera.lookAt(m.group.localToWorld(new T.Vector3(0,.4,0)));w.sky.follow(p.x,p.y,p.z);
  const images=[],coverage=[];
  r.setScissorTest(false);r.render(w.scene,w.camera);
  const gl=r.getContext(),width=r.domElement.width,height=r.domElement.height;
  const baseline=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,baseline);
  const upper=m.group.localToWorld(coat.centre.value.clone().add(new T.Vector3(coat.half.value.x*.8,coat.half.value.y*.72,0))).project(w.camera);
  let upperShellPixels=0;

  for(const [name,origin] of [['front',new T.Vector3(0,0,-8)],['side',new T.Vector3(8,0,0)]] as const){
   m.splashBody(origin,30,new T.Color(0x63ff35));layer.renderEffects(r);coat.update(0,30);
   const values=coat.targets.map((target:any)=>{const pixels=new Uint8Array(256*256*4);r.readRenderTargetPixels(target,0,0,256,256,pixels);let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]!>128)count++;return count/65536;});
   coverage.push({name,values});r.setScissorTest(false);r.render(w.scene,w.camera);
   if(name==='side'){
    const pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const cx=(upper.x*.5+.5)*width,cy=(upper.y*.5+.5)*height;
    for(let y=Math.max(0,Math.floor(cy-35));y<Math.min(height,cy+35);y++)for(let x=Math.max(0,Math.floor(cx-35));x<Math.min(width,cx+35);x++){
     const i=(y*width+x)*4;if(pixels[i+1]!>baseline[i+1]!+12&&pixels[i+1]!>pixels[i]!*1.3)upperShellPixels++;
    }
   }
   images.push({name,url:r.domElement.toDataURL()});
  }
  coat.update(3,0);const parked=coat.stats.opacity;
  m.splashBody(new T.Vector3(8,0,0),30,new T.Color(0x63ff35));layer.renderEffects(r);coat.update(3,80);const fast=coat.stats.opacity;
  return {images,coverage,parked,fast,upperShellPixels};
 });
 expect(errors.filter(e=>/shader|GL_INVALID|WebGLProgram/i.test(e))).toEqual([]);
 const front=result.coverage[0]!.values,side=result.coverage[1]!.values;
 expect(front[5]).toBeGreaterThan(.5);expect(front[4]).toBeLessThan(.15);
 expect(side[0]).toBeGreaterThan(.5);expect(side[1]).toBeLessThan(.15);
 expect(result.fast).toBeLessThan(result.parked);
 expect(result.upperShellPixels).toBeGreaterThan(20);
 for(const image of result.images)save(`body-${image.name}`,image.url);
 writeFileSync(resolve(out,'body.json'),JSON.stringify({...result,images:undefined},null,2));
});

test('a real collision remains on the road through three completed driving laps',async({page})=>{
 test.setTimeout(120_000);
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 await page.evaluate(async()=>{
  const g=window.game as any;await g.startRace({trackId:'synth-loop',vehicleId:'micro-hatch',ai:false,slimeDensity:'normal'},true);
  const s=g.session,layer=s.slimes;g.timeScale=6;g.setAutopilot(0,true);s.race.track.laps=3;layer.fallingLimit=0;
  for(const tile of [...layer.tileSpawns.keys()])layer.removeTile(tile);
  const p=s.car.position,f=s.car.forward;s.car.body.setLinvel({x:f.x*20,y:0,z:f.z*20},true);
  layer.addTile('persistent-collision',[{kind:'popper',position:[p.x,p.y,p.z],scale:[1.2,1,1.2],yaw:0}]);
 });
 await page.waitForFunction(()=>{const s=(window.game as any).session;return s.race.time>5&&s.slimes.groundSplatter.stats.pending===0;});
 const first=await page.evaluate(()=>{
  const s=(window.game as any).session,marks=s.slimes.groundSplatter,r=s.world.renderer;
  const entries=[...marks.tiles.entries()] as [string,any][];
  let wet=0;const hashes=entries.map(([key,tile])=>{const pixels=new Uint8Array(256*256*4);r.readRenderTargetPixels(tile.target,0,0,256,256,pixels);for(let i=3;i<pixels.length;i+=4)if(pixels[i]!>100)wet++;return {key,hash:pixels.reduce((a,v)=>Math.imul(a^v,16777619)>>>0,2166136261)};});
  return {hashes,wet,hits:s.slimes.stats.feedback.hits.popper};
 });
 expect(first.hits).toBeGreaterThan(0);expect(first.wet).toBeGreaterThan(100);
 const laps=[];
 for(const lap of [2,3]){
  await page.waitForFunction(lap=>(window.game as any).session.race.lap>=lap,lap);
  laps.push(await page.evaluate(({lap,keys})=>{
   const s=(window.game as any).session,r=s.world.renderer,marks=s.slimes.groundSplatter;
   return {lap,hashes:keys.map(key=>{const tile=marks.tiles.get(key),pixels=new Uint8Array(256*256*4);r.readRenderTargetPixels(tile.target,0,0,256,256,pixels);return {key,hash:pixels.reduce((a,v)=>Math.imul(a^v,16777619)>>>0,2166136261)};})};
  },{lap,keys:first.hashes.map(h=>h.key)}));
 }
 await page.waitForFunction(()=>window.game.report().state==='finished');
 const report=await page.evaluate(()=>window.game.report());expect(report.resets).toBe(0);
 for(const lap of laps)expect(lap.hashes).toEqual(first.hashes);
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'real-three-laps.json'),JSON.stringify({first,laps,report},null,2));
});

// These GPU probes import source modules; the full suite already starts this dev server.
test.use({ baseURL: DEV_URL });
