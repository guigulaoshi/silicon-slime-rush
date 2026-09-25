import { DEV_URL } from './server';
import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
const out=evidencePath('renderer');
test('formal high-low-high quality changes retain nonempty ground and body GPU pixels and fade state',async({page})=>{
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const result=await page.evaluate(async()=>{
  const path='/node_modules/three/build/three.module.js',T=await import(path),g=window.game as any;
  await g.startRace({trackId:'shoreline',vehicleId:'jeep',slimeDensity:'normal',ai:false,timeOfDay:'day'});g.phase='paused';cancelAnimationFrame(g.raf);
  const s=g.session,w=s.world,l=s.slimes,coat=s.model.bodyCoat,p=s.car.position;
  s.humans[0].render(1,0);
  l.groundSplatter.add(new T.Vector3(p.x,p.y-1,p.z-6),new T.Vector3(0,1,0),new T.Vector3(0,0,-25),new T.Color(0x69ff38),2);
  s.model.splashBody(new T.Vector3(8,0,0),25,new T.Color(0x69ff38));l.renderEffects(w.renderer);coat.update(1,10);
  const targets=()=>[...[...l.groundSplatter.tiles.values()].map((t:any)=>t.target),...coat.targets];
  const snapshot=()=>targets().map((target:any)=>{w.renderer.initRenderTarget(target);const bytes=new Uint8Array(target.width*target.height*4);w.renderer.readRenderTargetPixels(target,0,0,target.width,target.height,bytes);return {hash:bytes.reduce((a,v)=>Math.imul(a^v,16777619)>>>0,2166136261),wet:bytes.filter((v,i)=>i%4===3&&v>100).length};});
  const before=snapshot(),opacity=coat.stats.opacity,impacts=l.groundSplatter.stats.impacts,states=[];
  for(const quality of ['low','high']){
   const old=w.renderer,begin=performance.now();g.setSessionQuality(quality);l.renderEffects(w.renderer);w.renderer.getContext().finish();
   const milliseconds=performance.now()-begin;s.humans[0].render(1,0);
   w.camera.position.set(p.x+5,p.y+4,p.z+7);w.camera.lookAt(p.x,p.y,p.z-2);w.sky.follow(p.x,p.y,p.z);
   w.renderer.setScissorTest(false);w.renderer.render(w.scene,w.camera);
   states.push({quality,replaced:old!==w.renderer,values:snapshot(),opacity:coat.stats.opacity,impacts:l.groundSplatter.stats.impacts,
    milliseconds,url:w.renderer.domElement.toDataURL(),bytes:targets().reduce((sum:number,t:any)=>sum+t.width*t.height*4,0)});
  }
  return {before,groundCount:l.groundSplatter.tiles.size,opacity,impacts,states};
 });
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'preservation.json'),JSON.stringify({...result,states:result.states.map(({url,...s})=>s)},null,2));
 expect(result.groundCount).toBeGreaterThan(0);
 expect(result.before.slice(0,result.groundCount).reduce((sum,t)=>sum+t.wet,0)).toBeGreaterThan(500);
 expect(result.before.slice(result.groundCount)).toHaveLength(6);
 expect(result.before.slice(result.groundCount).reduce((sum,t)=>sum+t.wet,0)).toBeGreaterThan(1000);
 for(const state of result.states){expect(state.replaced).toBe(true);expect(state.values).toEqual(result.before);expect(state.opacity).toBe(result.opacity);expect(state.impacts).toBe(result.impacts);writeFileSync(resolve(out,`${state.quality}.png`),Buffer.from(state.url.split(',')[1]!,'base64'));}
});

// These GPU probes import source modules; the full suite already starts this dev server.
test.use({ baseURL: DEV_URL });
