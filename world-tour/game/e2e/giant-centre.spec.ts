import { evidencePath } from './evidence';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,test} from '@playwright/test';

test.describe.configure({timeout:120_000});
test.skip(process.env.GIANT_CENTRE_QA!=='1','opt-in actual centreline giant driving evidence');
test('a car driving along the actual racing centre enters and leaves the continuously sized giant',async({page})=>{
 await page.goto('/?track=lhasa&bot=1&dev=1&time=day');
 await page.waitForFunction(()=>window.game?.report().phase==='racing');
 const before=await page.evaluate(()=>{
  const g=window.game as any,s=g.session,w=s.world;g.phase='paused';g.autopilot=false;
  const giant=s.slimes.lives.find((x:any)=>x.active&&x.spawn.kind==='colossus');
  if(!giant)throw new Error('No actual streamed giant');
  const spawn=giant.spawn;
  let index=0,distance=Infinity;
  for(let i=0;i<w.spline.count;i++){
   const p=w.spline.point(i),d=Math.hypot(p[0]-spawn.position[0],p[2]-spawn.position[2]);
   if(d<distance){index=i;distance=d;}
  }
  const at=w.spline.wrapIndex(index-12),p=w.spline.point(at),t=w.spline.tangent(at);
  s.car.reset([p[0],p[1]+.8,p[2]],Math.atan2(-t[0],-t[2]));
  s.race.reacquire(p[0],p[2]);s.chase.reset();
  w.camera.position.set(p[0]-t[0]*5,p[1]+5,p[2]-t[2]*5);
  w.camera.lookAt(...spawn.position);w.camera.updateProjectionMatrix();w.render();
  return {spawn,distance,entries:s.slimes.stats.colossusEntries,exits:s.slimes.stats.colossusExits,
   centre:p,failed:w.streamer.stats.failed};
 });
 expect(before.distance).toBeLessThan(.05);
 expect(before.spawn.scale[2]).toBeGreaterThanOrEqual(7.19);
 expect(before.spawn.scale[2]).toBeLessThanOrEqual(8.81);
 expect(before.spawn.scale[0]/before.spawn.scale[2]).toBeCloseTo(.625,2);
 expect(before.failed).toBe(0);
 const out=evidencePath('giant-centre');mkdirSync(out,{recursive:true});
 await page.screenshot({path:resolve(out,'approach.png')});
 await page.keyboard.down('KeyW');
 await page.evaluate(()=>{(window.game as any).phase='racing';});
 await page.waitForFunction(n=>(window.game.report().slimes?.colossusEntries??0)>n,before.entries);
 await page.screenshot({path:resolve(out,'inside.png')});
 await page.waitForFunction(n=>(window.game.report().slimes?.colossusExits??0)>n,before.exits);
 await page.keyboard.up('KeyW');
 await page.evaluate(()=>{(window.game as any).phase='paused';});
 const after=await page.evaluate(()=>window.game.report());
 expect(after.resets).toBe(0);expect(after.slimes!.colossusEntries).toBe(after.slimes!.colossusExits);
 await page.screenshot({path:resolve(out,'exit.png')});
 writeFileSync(resolve(out,'actual-transit.json'),JSON.stringify({before,after},null,2));
});


test('the sloping starting grid holds the car through countdown and releases it at go',async({page})=>{
 await page.goto('/?track=zhangjiajie&bot=1&dev=1');
 await page.waitForFunction(()=>window.game?.report().phase==='countdown');
 const before=await page.evaluate(()=>window.game.report());
 await page.waitForTimeout(1000);
 const during=await page.evaluate(()=>window.game.report());
 expect(during.phase).toBe('countdown');
 expect(Math.hypot(during.posX-before.posX,during.posZ-before.posZ)).toBeLessThan(.05);
 await page.waitForFunction(()=>window.game.report().progress>20,null,{timeout:30000});
 expect((await page.evaluate(()=>window.game.report())).resets).toBe(0);
});
