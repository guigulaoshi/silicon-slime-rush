import {test,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath,baselinePath} from './evidence';
import {expectWorldLoaded} from './world';
import {captureFrames,rendererFacts,SOFTWARE_RENDERER,reportDesktopFrames} from './frame-sample';
import {checkMaximum} from '../test-support/resource-limit';
const out=evidencePath('buildings');
const stage=process.env.BUILDING_CAPTURE==='before'?'before':'after';
test.describe.configure({timeout:240_000});
test('landmarks and residential streets retain their real locations with distinct architecture',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:1440,height:900});
 await page.addInitScript(()=>localStorage.setItem('silicon-rush.save.v1',JSON.stringify({slimeDensity:'none',direction:'forward',language:'en'})));
 const oldWindows=JSON.parse(readFileSync(baselinePath('windows/views.json'),'utf8'));
 const home=JSON.parse(readFileSync(baselinePath('glass/after-performance.json'),'utf8')).find((r:any)=>r.track==='wolfe-pruneridge'&&r.view).view;
 const shots=[
  {id:'canopy',track:'shoreline',at:1900,target:[-1732.5,17,-1341.5],fov:62,up:5},
  {id:'hangar',track:'moffett-field',at:2400,target:[-173.961,30,5.485],fov:85,up:5},
  {id:'overlook',track:'twin-peaks',at:3,target:[20.67,258,-283.09],fov:45,up:5},
  {id:'alcatraz',track:'fishermans-wharf',at:1212,target:[-880.4,56,-2075.6],fov:8,position:[46.94,11.42,-62.67]},
  {id:'cupertino-homes',track:'wolfe-pruneridge',at:home.at,target:home.centre,fov:62,
   position:[home.centre[0]+home.normal[0]*24,home.centre[1]+5,home.centre[2]+home.normal[2]*24]},
  {id:'twin-peaks-homes',track:'twin-peaks',at:oldWindows['twin-peaks'].at,target:oldWindows['twin-peaks'].centre,fov:62,
   position:[oldWindows['twin-peaks'].centre[0]+oldWindows['twin-peaks'].normal[0]*25,oldWindows['twin-peaks'].centre[1]+4,oldWindows['twin-peaks'].centre[2]+oldWindows['twin-peaks'].normal[2]*25]},
 ];
 const requested=process.env.BUILDING_IDS?.split(',');
 const selected=shots.filter(s=>!requested||requested.includes(s.id));
 expect(selected.length).toBe(requested?.length??shots.length);
 expect(selected.length).toBeGreaterThan(0);
 const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
 const frames=[];
 for(const shot of selected){
  await page.goto(`/?track=${shot.track}&bot=1&dev=1&time=day&direction=forward`);
  await page.waitForFunction(()=>window.game?.report().phase==='racing');
  await page.evaluate(async spec=>{
   const g=window.game as any,w=g.session.world;g.phase='paused';g.autopilot=false;
   const p=w.spline.point(w.spline.indexAt(spec.at));g.session.mesh.visible=false;g.session.mesh.position.set(...p);
   for(let pass=0;pass<10;pass++){
    w.follow(spec.at,p[0],p[1],p[2]);while(w.streamer.stats.loading)await new Promise(r=>setTimeout(r,25));
   }
   await w.landmarks.prepare([{x:p[0],z:p[2]}]);
   const position=spec.position??[p[0],p[1]+(spec.up??5),p[2]];
   w.camera.position.fromArray(position);w.camera.lookAt(...spec.target);w.camera.fov=spec.fov;
   w.camera.updateProjectionMatrix();w.render();
   document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(n=>n.style.display='none');
  },shot);
  await expectWorldLoaded(page,`312 ${shot.id}`);
  if(stage==='after'&&(shot.id==='canopy'||shot.id==='hangar')){
   const wanted=shot.id==='canopy'?'charleston-canopy':'hangar-one';
   expect(await page.evaluate(id=>!!window.game.session.world.landmarks.root.getObjectByName(id),wanted)).toBe(true);
  }
  if(stage==='after'&&shot.id.endsWith('homes')){
   expect(await page.evaluate(()=>{let trim=0;window.game.session.world.scene.traverse((o:any)=>{
    if(o.isMesh&&o.material?.name==='house_trim')trim+=o.geometry.attributes.position.count;
   });return trim;})).toBeGreaterThan(100);
  }
  await page.screenshot({path:resolve(out,`${stage}-${shot.id}.png`)});
  if(stage==='after'){
   // Renderer and frame-rate lines are real-GPU facts; the default suite renders with SwiftShader on
   // purpose (playwright.config.ts), where they could only ever fail. Scene limits hold in both.
   const gpu=await rendererFacts(page);
   const performance=await captureFrames(page,shot.at,2000);
   if(process.env.PERF_REAL_GPU==='1'){expect(gpu.renderer).not.toMatch(SOFTWARE_RENDERER);reportDesktopFrames(performance.fps,performance.p95Ms,`312 ${shot.id}`);}
   checkMaximum(performance.triangles,'max_triangles',`312 ${shot.id} triangles`);
   checkMaximum(performance.drawCalls,'max_draw_calls',`312 ${shot.id} draws`);
   frames.push({id:shot.id,gpu,performance});
  }
  frames.push(await page.evaluate(id=>({id,draws:window.game.session.world.renderer.info.render.calls,
   triangles:window.game.session.world.renderer.info.render.triangles,position:window.game.session.world.camera.position.toArray()}),shot.id));
 }
 expect(failures).toEqual([]);writeFileSync(resolve(out,`${stage}-frames.json`),JSON.stringify(frames,null,2));
});
