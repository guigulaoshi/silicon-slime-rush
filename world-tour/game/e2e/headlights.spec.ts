import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {VEHICLES} from '../src/vehicles/catalogue';
import {evidencePath} from './evidence';
import {expectWorldLoaded} from './world';
import {captureFrames,rendererFacts,reportDesktopFrames,SOFTWARE_RENDERER} from './frame-sample';

test.describe.configure({timeout:240_000});
test('capture each vehicle lighting on the same real bridge road',async({page})=>{
 const stage=process.env.LIGHT_STAGE??'after',out=evidencePath(`headlights/${stage}`);mkdirSync(out,{recursive:true});
 await page.setViewportSize({width:1280,height:720});await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const reports=[];
 for(const vehicle of VEHICLES){
  if(stage==='before'&&!['monster-truck','jeep','micro-hatch'].includes(vehicle.id))continue;
  await page.evaluate(async id=>{
   const g=window.game as any;await g.startRace({trackId:'sydney',vehicleId:id,timeOfDay:'night',weather:'clear',slimeDensity:'none',ai:false});
   // s=300: on the Harbour Bridge deck (see landmark-qa.spec.ts's derivation from game/public/tracks/sydney/track.json; the route's first ~600 m is the bridge crossing per pipeline/routes/sydney.json)
   const s=g.session,w=s.world,i=w.spline.indexAt(300),p=w.spline.point(i),t=w.spline.tangent(i),y=p[1]-s.vehicle.anchorY+s.vehicle.suspensionRest;
   g.phase='paused';s.physics.setBodyPosition(s.car.body,{x:p[0],y,z:p[2]});s.mesh.position.set(p[0],y,p[2]);s.mesh.rotation.y=Math.atan2(-t[0],-t[2]);
   for(let n=0;n<10;n++){w.streamer.update(1450,p[0],p[2]);while(w.streamer.stats.loading)await new Promise(r=>setTimeout(r,25));}
   w.camera.position.set(p[0]-t[0]*10,p[1]+5,p[2]-t[2]*10);w.camera.lookAt(p[0]+t[0]*25,p[1],p[2]+t[2]*25);w.camera.fov=60;w.camera.updateProjectionMatrix();
   for(const l of w.racerHeadlights)l.follow(s.mesh.position,s.mesh.quaternion);
   w.sky.follow(...p);w.render();
  },vehicle.id);
  await expectWorldLoaded(page,vehicle.id);
  const shot=await page.evaluate(()=>new Promise<string>(resolve=>{(window.game as any).captureNextFrame=(canvas:HTMLCanvasElement)=>resolve(canvas.toDataURL('image/png'));}));
  writeFileSync(resolve(out,vehicle.id+'.png'),Buffer.from(shot.split(',')[1]!,'base64'));
  reports.push(await page.evaluate(()=>{
   const s=window.game.session;
   return {id:s.vehicle.id,lights:window.game.report().vehicleLights,triangles:s.world.renderer.info.render.triangles,calls:s.world.renderer.info.render.calls};
  }));
 }
 if(stage==='after') for(const report of reports) {
  expect(report.lights.every(light=>light.configured>0&&light.pools>0),report.id).toBe(true);
 }
 expect(reports).toHaveLength(stage==='before'?3:VEHICLES.length);
 writeFileSync(resolve(out,'render.json'),JSON.stringify(reports,null,2));
});

test('both roof bars follow their own driver in a night split race',async({page})=>{
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 expect(await page.evaluate(()=>window.game.startRace({trackId:'synth-p2p',timeOfDay:'night',slimeDensity:'none',
  playerVehicles:['monster-truck','jeep'],ai:true},true))).toBe(true);
 await page.waitForFunction(()=>window.game.report().phase==='racing');
 await expectWorldLoaded(page,'split-roof-lights');
 const result=await page.evaluate(()=>{
  const s=window.game.session;
  return {humans:s.world.playerHeadlights.map((rig,i)=>({on:rig.on,
   lights:rig.configuredCount,distance:rig.group.position.distanceTo(s.racers[i]!.mesh.position)})),
   racers:window.game.report().vehicleLights};
 });
 expect(result.humans).toHaveLength(2);
 expect(result.humans.map(r=>r.lights)).toEqual([12,7]);
 expect(result.humans.every(r=>r.on&&r.distance<.01)).toBe(true);
 expect(result.racers).toHaveLength(VEHICLES.length);
 expect(result.racers.every(r=>r.pools>0)).toBe(true);
});


test('roof lights follow real hills and a full night split race stays playable',async({page})=>{
 const out=evidencePath('headlights/terrain');mkdirSync(out,{recursive:true});
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 await page.evaluate(async()=>{
  const g=window.game as any;await g.startRace({trackId:'zhangjiajie',vehicleId:'monster-truck',timeOfDay:'night',slimeDensity:'none',ai:false});
  // derived: sample index 141 is zhangjiajie's steepest local grade in the route's first quarter
  // (~15%, at s~283 m of 2556 m total -- game/public/tracks/zhangjiajie/track.json), the real-hill
  // equivalent of twin-peaks' index 186
  const s=g.session,w=s.world,i=141,p=w.spline.point(i),t=w.spline.tangent(i),at=w.spline.s[i];
  g.phase='paused';const y=p[1]-s.vehicle.anchorY+s.vehicle.suspensionRest;
  s.physics.setBodyPosition(s.car.body,{x:p[0],y,z:p[2]});s.mesh.position.set(p[0],y,p[2]);
  s.mesh.quaternion.setFromUnitVectors(s.mesh.position.clone().set(0,0,-1),s.mesh.position.clone().set(...t));
  for(let n=0;n<10;n++){w.streamer.update(at,p[0],p[2]);while(w.streamer.stats.loading)await new Promise(r=>setTimeout(r,25));}
  w.camera.position.set(p[0]-t[0]*10,p[1]+5,p[2]-t[2]*10);w.camera.lookAt(p[0]+t[0]*20,p[1]+t[1]*20,p[2]+t[2]*20);
  for(const rig of w.racerHeadlights)rig.follow(s.mesh.position,s.mesh.quaternion);
  w.sky.follow(...p);w.render();
 });
 await expectWorldLoaded(page,'hill-roof-lights');
 const shot=await page.evaluate(()=>new Promise<string>(resolve=>{(window.game as any).captureNextFrame=(canvas:HTMLCanvasElement)=>resolve(canvas.toDataURL('image/png'));}));
 writeFileSync(resolve(out,'zhangjiajie-slope.png'),Buffer.from(shot.split(',')[1]!,'base64'));
 expect(await page.evaluate(()=>window.game.report().vehicleLights.every(r=>r.pools>0))).toBe(true);
 if(process.env.PERF_REAL_GPU==='1'){
  await page.evaluate(()=>window.game.startRace({trackId:'zhangjiajie',playerVehicles:['monster-truck','jeep'],timeOfDay:'night',slimeDensity:'normal',ai:true},true));
  await page.waitForFunction(()=>window.game.report().phase==='racing');await expectWorldLoaded(page,'full-night-roof-bars');
  await page.evaluate(()=>{window.game.setAutopilot(0,true);window.game.setAutopilot(1,true);});
  const facts=await rendererFacts(page);expect(facts.renderer).not.toMatch(SOFTWARE_RENDERER);
  const sample=await captureFrames(page,0);
  writeFileSync(resolve(out,'full-night-split.json'),JSON.stringify({facts,sample},null,2));
  expect(sample.frames).toBeGreaterThan(100);reportDesktopFrames(sample.fps,sample.p95Ms,'night two roof bars plus AI');
 }
});
