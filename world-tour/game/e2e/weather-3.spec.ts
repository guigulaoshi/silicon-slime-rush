import { DEV_URL } from './server';
import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
const out=evidencePath('weather');
test.use({video:'on'});
test('actual weather contacts produce water and snow sprays, ice stays clean, and a new clear race resets effects',async({page})=>{
 test.setTimeout(180_000);mkdirSync(out,{recursive:true});
 const errors:string[]=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+m.location().url);});
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const cases=[['rain','wet',20],['rain','puddle',5],['rain','puddle',25],['snow','snow',20],['snow','deepSnow',20],['snow','ice',20]] as const;
 const results=[];
 for(const [weather,kind,speed]of cases){
  const result=await page.evaluate(async({weather,kind,speed})=>{
   const g=window.game as any;
   await g.startRace({trackId:'lhasa',vehicleId:kind==='deepSnow'?'monster-truck':'micro-hatch',weather,timeOfDay:'day',ai:false,slimeDensity:'none'});g.phase='paused';cancelAnimationFrame(g.raf);g.uiHost.style.display='none';
   const s=g.session,w=s.world,e=w.weatherEffects;
   e.render(w.renderer);
   // Patch shapes vary (strips, clusters); drive through the one with the most covered sheet so all four wheels land on it.
   const covered=(p:any)=>p.mask?p.mask.filter((v:number,i:number)=>i%4===3&&v>128).length*p.radius**2:0;
   const patch=e.surface.patches.filter((p:any)=>p.kind===kind).sort((a:any,b:any)=>covered(b)-covered(a))[0];
   const index=patch?.index??w.spline.indexAt(100),p=w.spline.point(index),t=w.spline.tangent(index);
   const x=patch?.x??p[0],z=patch?.z??p[2],y=patch?.y??p[1];
   if(['puddle','deepSnow','ice'].includes(kind)&&!patch)throw Error('No actual patch '+kind);
   await w.streamer.prepareSpawn(x,z);s.physics.world.step();
   const ground=s.physics.surfaceAt(x,z,y+2,y-5);if(!ground)throw Error('No ground under '+kind);
   s.car.reset([x,ground.point.y+1.1,z],Math.atan2(-t[0],-t[2]));s.race.progress.reacquire(x,z);
   for(let i=0;i<90;i++)s.physics.step(1/60,(h:number)=>s.car.update(h,{throttle:0,brake:0,steer:0}));
   s.car.body.setLinvel({x:t[0]*speed,y:0,z:t[2]*speed},true);
   const contacts=[];let maxWater=0,maxSnow=0,iceEmitted=0,iceFrames=0,url='',iceUrl='';
   for(let i=0;i<45;i++){
    const before=e.emitted.snow;
    s.physics.step(1/60,(h:number)=>{s.car.update(h,{throttle:0,brake:0,steer:0});e.step(h,[s.car]);w.tireMarks.step(h,[s.car]);});
    const kinds=s.car.wheels.filter((a:any)=>a.grounded).map((a:any)=>a.weather?.kind);contacts.push(kinds);
    if(kinds.length&&kinds.every((a:string)=>a==='ice')){iceFrames++;iceEmitted+=e.emitted.snow-before;}
    maxWater=Math.max(maxWater,e.emitted.water);maxSnow=Math.max(maxSnow,e.emitted.snow);
    s.humans[0].advancePose();s.humans[0].render(1,1/60);const pos=s.car.position;
    w.camera.position.set(pos.x-t[0]*9-t[2]*5,pos.y+4,pos.z-t[2]*9+t[0]*5);w.camera.lookAt(pos.x,pos.y+.4,pos.z);w.sky.follow(pos.x,pos.y,pos.z);
    w.sky.update(1/60);w.sky.beforeCamera(w.camera,s.car.speed);
    w.renderer.setScissorTest(false);w.renderer.render(w.scene,w.camera);
    if(i===22)url=w.renderer.domElement.toDataURL();
    if(kind==='ice'&&iceFrames===1&&!iceUrl)iceUrl=w.renderer.domElement.toDataURL();
    await new Promise(requestAnimationFrame);
   }
   return {weather,kind,speed,contacts,maxWater,maxSnow,iceFrames,iceEmitted,url,iceUrl,marks:w.tireMarks.stats(),patches:e.surface.patches.length};
  },{weather,kind,speed});
  expect(result.contacts.flat()).toContain(kind);
  if(weather==='rain'){expect(result.maxWater).toBeGreaterThan(0);expect(result.maxSnow).toBe(0);}
  else if(kind!=='ice')expect(result.maxSnow).toBeGreaterThan(0);
  if(kind==='ice'){expect(result.iceFrames).toBeGreaterThan(0);expect(result.iceEmitted).toBe(0);}
  if(result.iceUrl)writeFileSync(resolve(out,'ice-contact.png'),Buffer.from(result.iceUrl.split(',')[1]!,'base64'));
  results.push({...result,url:undefined,iceUrl:undefined});writeFileSync(resolve(out,`${kind}-${speed}.png`),Buffer.from(result.url.split(',')[1]!,'base64'));
 }
 const clear=await page.evaluate(async()=>{const g=window.game as any;await g.startRace({trackId:'lhasa',weather:'clear',ai:false,slimeDensity:'none'});return g.session.world.weatherEffects.stats();});
 expect(clear).toEqual({active:0,water:0,snow:0,patches:0});
 writeFileSync(resolve(out,'contacts.json'),JSON.stringify({results,clear,errors},null,2));expect(errors).toEqual([]);
 await page.close();await page.video()!.saveAs(resolve(out,'weather-surfaces.webm'));
});

test('stationary water receives animated ripples without wheel spray',async({page})=>{
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const result=await page.evaluate(async()=>{
  const g=window.game as any;await g.startRace({trackId:'lhasa',weather:'rain',ai:false,slimeDensity:'none'});g.phase='paused';cancelAnimationFrame(g.raf);g.uiHost.style.display='none';
  const s=g.session,w=s.world,e=w.weatherEffects,p=e.surface.patches.find((p:any)=>p.kind==='puddle');if(!p)throw Error('Missing puddle');
  await w.streamer.prepareSpawn(p.x,p.z);s.physics.world.step();w.camera.position.set(p.x+1,p.y+5,p.z+1);w.camera.lookAt(p.x,p.y,p.z);e.render(w.renderer,w.camera);
  // Isolate the real patch materials to measure ripples rather than sky precipitation or camera changes.
  const meshes=e.root.children.filter((c:any)=>c.name==='weather-puddle');const path='/node_modules/three/build/three.module.js',T=await import(path);
  const scene=new T.Scene();scene.add(new T.AmbientLight(0xffffff,3));for(const m of meshes)scene.add(m.clone());
  const hashes=[];for(const time of [0,.8]){e.step(time,[]);w.renderer.setScissorTest(false);w.renderer.render(scene,w.camera);const gl=w.renderer.getContext(),pixels=new Uint8Array(w.renderer.domElement.width*w.renderer.domElement.height*4);gl.readPixels(0,0,w.renderer.domElement.width,w.renderer.domElement.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);hashes.push(pixels.reduce((a:number,v:number)=>Math.imul(a^v,16777619)>>>0,2166136261));}
  for(let i=0;i<60;i++){e.step(1/60,[]);w.renderer.render(scene,w.camera);await new Promise(requestAnimationFrame);}
  w.renderer.render(scene,w.camera);const url=w.renderer.domElement.toDataURL();
  // Puddle shapes are built on the CPU, so a renderer change must keep both the mask and the texture.
  w.setQuality('low');e.render(w.renderer,w.camera);const mask=e.surface.patches[0].mask;
  const afterRendererChange=e.patches[0].shaped?.image.data===mask?mask.filter((v:number,i:number)=>i%4===3&&v>128).length:0;
  return {hashes,stats:e.stats(),url,afterRendererChange};
 });
 expect(result.afterRendererChange).toBeGreaterThan(500);
 expect(new Set(result.hashes).size).toBe(2);expect(result.stats.water).toBe(0);
 writeFileSync(resolve(out,'stationary-ripples.json'),JSON.stringify({...result,url:undefined},null,2));
 writeFileSync(resolve(out,'stationary-ripples.png'),Buffer.from(result.url.split(',')[1]!,'base64'));
 await page.close();await page.video()!.saveAs(resolve(out,'stationary-ripples.webm'));
});

// These GPU probes import source modules; the full suite already starts this dev server.
test.use({ baseURL: DEV_URL });
