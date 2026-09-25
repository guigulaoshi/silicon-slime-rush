import { DEV_URL } from './server';
import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {captureFrames,rendererFacts,reportDesktopFrames,SOFTWARE_RENDERER} from './frame-sample';
const out=evidencePath('splatter');
test('first and third lap accumulated marks keep a playable frame rate',async({page})=>{
 test.skip(process.env.PERF_REAL_GPU!=='1','requires real GPU');
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 await page.evaluate(async()=>{const g=window.game as any;await g.startRace({trackId:'synth-p2p',vehicleId:'jeep',ai:false,slimeDensity:'normal'});g.show('racing');g.phase='paused';const s=g.session,w=s.world,p=s.car.position.clone(),render=w.render.bind(w);w.render=(...args:any[])=>{w.camera.position.set(p.x+8,p.y+35,p.z+8);w.camera.lookAt(p.x,p.y,p.z-22);render(...args);};});
 const facts=await rendererFacts(page);expect(facts.renderer).not.toMatch(SOFTWARE_RENDERER);
 const before=await captureFrames(page,1,3000);
 const stats=await page.evaluate(async()=>{
  const path='/node_modules/three/build/three.module.js',T=await import(path),s=(window.game as any).session,marks=s.slimes.groundSplatter;
  const p=s.car.position;
  for(let i=0;i<360;i++)marks.add(new T.Vector3(p.x+(i%9-4)*1.5,p.y-.4,p.z-Math.floor(i/9)*1.5),new T.Vector3(0,1,0),new T.Vector3(0,0,-30),new T.Color(0x63ff35));
  while(marks.stats.pending)await new Promise<void>(r=>requestAnimationFrame(()=>r()));
  return marks.stats;
 });
 const after=await captureFrames(page,3,3000);
 expect(after.drawCalls).toBeGreaterThan(before.drawCalls+5);
 expect(after.triangles).toBeGreaterThan(before.triangles);
 for(const [name,sample] of [['first',before],['third',after]] as const){expect(sample.frames).toBeGreaterThan(50);reportDesktopFrames(sample.fps,sample.p95Ms,`326 ${name} lap`);}
 await page.evaluate(()=>(window.game as any).setSessionQuality('low'));
 const low=await captureFrames(page,3,3000,3);reportDesktopFrames(low.fps,low.p95Ms,'low detail, three rendering passes');
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'lap-performance.json'),JSON.stringify({facts,before,after,stats,low,lowProfile:'M4 with low detail and three complete rendering passes; not a physical weak GPU'},null,2));
});

test('GPU optical tile matches the analytic field and honours operating-system reduced motion',async({page})=>{
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const read=async()=>page.evaluate(async()=>{
  const path='/node_modules/three/build/three.module.js',T=await import(path),source='/src/world/SlimeCaustics.ts',{SlimeCaustics,causticIntensity}=await import(source);
  const r=new T.WebGLRenderer(),caustic=new SlimeCaustics(),scene=new T.Scene();
  const samples=[];const pixels=new Uint8Array(256*256*4);let gpuMs=0;
  for(const time of [0,.35]){
   const begin=performance.now();caustic.render(r,scene,time);r.getContext().finish();gpuMs+=performance.now()-begin;
   r.readRenderTargetPixels(caustic.target,0,0,256,256,pixels);
   const actual=[];for(let y=16;y<256;y+=32)for(let x=16;x<256;x+=32){
    const value=pixels[(y*256+x)*4]!;
    const expected=Math.round(Math.pow(Math.max(0,Math.min(1,(causticIntensity((x+.5)/256,(y+.5)/256,time)-.45)/8.5)),1.55)*255);
    actual.push({value,expected});
   }
   samples.push(actual);
  }
  caustic.prepare({position:[0,0,0],scale:[10,10,10],yaw:0,kind:'colossus',s:0});
  const strength=caustic.strength.value;caustic.dispose();r.dispose();return {samples,gpuMs,strength};
 });
 const normal=await read();for(const sample of normal.samples.flat())expect(Math.abs(sample.value-sample.expected)).toBeLessThanOrEqual(3);
 await page.emulateMedia({reducedMotion:'reduce'});const reduced=await read();
 expect(reduced.strength).toBe(.08);expect(reduced.samples[1]!.map(v=>v.value)).toEqual(reduced.samples[0]!.map(v=>v.value));
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'caustic-gpu.json'),JSON.stringify({normal,reduced},null,2));
});

// These GPU probes import source modules; the full suite already starts this dev server.
test.use({ baseURL: DEV_URL });
