import { evidencePath } from './evidence';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,test} from '@playwright/test';

test.describe.configure({timeout:120_000});
test.skip(process.env.SLIME_SIZE_QA!=='1','opt-in authored slime size evidence');
test('the shipped larger slime is visible and hit through its actual Rapier sensor',async({page})=>{
 await page.goto('/?track=shoreline&bot=1&dev=1&time=day');
 await page.waitForFunction(()=>window.game?.report().phase==='racing');
 const facts=await page.evaluate(()=>{
  const g=window.game as any,s=g.session,w=s.world;g.phase='paused';g.autopilot=false;
  const live=s.slimes.lives.find((x:any)=>x.active&&!x.spawn.scenery&&x.spawn.kind==='popper');
  if(!live)throw new Error('No streamed ordinary slime');
  const p=live.spawn.position,ground=p[1]-live.spawn.scale[1];
  const at=w.spline.indexAt(live.spawn.s),t=w.spline.tangent(at);
  s.car.reset([p[0]-t[0]*5,ground+.75,p[2]-t[2]*5],Math.atan2(-t[0],-t[2]));
  w.camera.position.set(p[0]+7,p[1]+4,p[2]+7);w.camera.lookAt(...p);w.camera.fov=48;w.camera.updateProjectionMatrix();
  document.querySelectorAll<HTMLElement>('#ui,.touch-controls,#perf-readout').forEach(n=>n.style.display='none');
  w.render();
  g.__slimeSizeTarget={p,ground,t};
  return {scale:live.spawn.scale,vertices:Array.from(live.collider.vertices()) as number[],position:p,
   hits:s.slimes.stats.feedback.hits.popper,failed:w.streamer.stats.failed};
 });
 expect(facts.scale[0]).toBeGreaterThanOrEqual(.9);expect(facts.scale[0]).toBeLessThanOrEqual(2.64);
 expect(Math.max(...facts.vertices.filter((_:number,i:number)=>i%3===0) as number[])).toBeCloseTo(facts.scale[0]);expect(facts.failed).toBe(0);
 const out=evidencePath('slime-size');mkdirSync(out,{recursive:true});
 await page.screenshot({path:resolve(out,'actual-larger-slime.png')});
 await page.evaluate(()=>{
  const g=window.game as any,{p,ground,t}=g.__slimeSizeTarget;
  g.session.car.reset([p[0],ground+.75,p[2]],Math.atan2(-t[0],-t[2]));
  g.session.car.body.setLinvel({x:t[0]*15,y:0,z:t[2]*15},true);g.phase='racing';
 });
 await page.waitForFunction(before=>window.game.report().slimes!.feedback.hits.popper>before,facts.hits);
 await page.evaluate(()=>{(window.game as any).phase='paused';});
 await page.screenshot({path:resolve(out,'actual-impact.png')});
 writeFileSync(resolve(out,'actual-collision.json'),JSON.stringify(facts,null,2));
});
