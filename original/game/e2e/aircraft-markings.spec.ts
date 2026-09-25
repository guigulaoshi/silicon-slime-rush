import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {expectWorldLoaded} from './world';
import {captureFrames,rendererFacts,SOFTWARE_RENDERER,reportDesktopFrames} from './frame-sample';
import {checkMaximum} from '../test-support/resource-limit';

// Three separated display zones each stream their real models and sample two seconds of frames.
test.describe.configure({timeout:180_000});
test('aircraft markings load on the real display models and remain within scene limits',async({page})=>{
 const out=evidencePath('aircraft-markings');mkdirSync(out,{recursive:true});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?track=moffett-field&bot=1&dev=1&time=day');
 await page.waitForFunction(()=>window.game?.report().phase==='racing',null,{timeout:90_000});
 const rows=[];
 for(const [name,station] of [['runway',500],['hangar',2130],['south',2400]] as const){
  const models=await page.evaluate(async at=>{
   const g=window.game as any,s=g.session,w=s.world;g.phase='paused';g.autopilot=false;
   const index=w.spline.indexAt(at),p=w.spline.point(index),t=w.spline.tangent(index);
   p[1]+=1.2;s.car.reset(p,Math.atan2(-t[0],-t[2]));
   s.mesh.position.copy(s.car.position);s.mesh.quaternion.copy(s.car.quaternion);
   for(let pass=0;pass<10;pass++){
    w.follow(at,p[0],p[1],p[2]);while(w.streamer.stats.loading)await new Promise(r=>setTimeout(r,25));
   }
   await w.landmarks.prepare([{x:p[0],z:p[2]}]);
   s.chase.setMode('chase');s.chase.reset();
   s.chase.update(w.camera,s.car.position,s.car.quaternion,s.mesh.position.clone().set(0,0,0),1/60,{grounded:true,reducedMotion:true});
   w.render();document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(n=>n.style.display='none');
   return w.landmarks.root.children.filter((o:any)=>o.name.startsWith('moffett-')).map((o:any)=>{
    let markedVertices=0,texturedVertices=0,decodedPixels=0;o.traverse((mesh:any)=>{
     if(mesh.isMesh&&mesh.material?.name.startsWith('moffett_marking_'))markedVertices+=mesh.geometry.attributes.position.count;
     if(mesh.isMesh&&mesh.material?.map){
      texturedVertices+=mesh.geometry.attributes.uv?.count??0;
      const image=mesh.material.map.image;decodedPixels=Math.max(decodedPixels,(image?.width??0)*(image?.height??0));
     }
    });return {id:o.name,markedVertices,texturedVertices,decodedPixels};
   });
  },station);
  await expectWorldLoaded(page,`358 ${name}`);
  expect(models.length).toBeGreaterThan(3);
  expect(models.every((m:{markedVertices:number})=>m.markedVertices>50)).toBe(true);
  const raptors=models.filter((m:{id:string})=>m.id.startsWith('moffett-f22-raptor'));
  expect(raptors.length).toBeGreaterThan(0);
  expect(raptors.every((m:{texturedVertices:number;decodedPixels:number})=>m.texturedVertices>50&&m.decodedPixels>=1024*1024)).toBe(true);
  await page.screenshot({path:resolve(out,`${name}-chase.png`)});
  // Renderer and frame-rate lines are real-GPU facts; the default suite renders with SwiftShader on
  // purpose (playwright.config.ts), where they could only ever fail. Scene limits hold in both.
  const gpu=await rendererFacts(page);
  const frames=await captureFrames(page,station,2000);
  if(process.env.PERF_REAL_GPU==='1'){expect(gpu.renderer).not.toMatch(SOFTWARE_RENDERER);reportDesktopFrames(frames.fps,frames.p95Ms,`358 ${name}`);}
  checkMaximum(frames.triangles,'max_triangles',`358 ${name} triangles`);
  checkMaximum(frames.drawCalls,'max_draw_calls',`358 ${name} draws`);
  rows.push({name,station,models,gpu,frames});
 }
 expect(errors).toEqual([]);writeFileSync(resolve(out,'runtime.json'),JSON.stringify(rows,null,2));
});
