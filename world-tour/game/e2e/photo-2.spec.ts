import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {expectWorldLoaded} from './world';

test.describe.configure({timeout:90_000});
test('photo orbit reaches low and overhead views above real road geometry',async({page})=>{
 const out=evidencePath('photo');mkdirSync(out,{recursive:true});
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 await page.evaluate(async()=>{await window.game.startRace({trackId:'synth-p2p',vehicleId:'sports-car',ai:false,slimeDensity:'none',timeOfDay:'day'});});
 await expectWorldLoaded(page,'photo orbit');
 await page.locator('.departure-pause').click();
 // The synthetic start has no road behind its endpoint. Inspect the loaded straight instead.
 await page.evaluate(async()=>{
  const s=window.game.session,w=s.world,i=w.spline.indexAt(300),p=w.spline.point(i),t=w.spline.tangent(i);
  s.physics.setBodyPosition(s.car.body,{x:p[0],y:p[1]+.5,z:p[2]});s.mesh.position.set(p[0],p[1]+.5,p[2]);
  w.camera.position.set(p[0]-t[0]*8,p[1]+3,p[2]-t[2]*8);
  w.streamer.update(300,p[0],p[2]);while(w.streamer.stats.loading)await new Promise(r=>setTimeout(r,25));
 });
 await expectWorldLoaded(page,'photo straight');
 await page.locator('[data-action=photo]').click();
 const before=await page.evaluate(()=>window.game.session.world.cameras[0]!.position.toArray());
 await page.screenshot({path:resolve(out,'01-initial.png')});
 // Use the same public photo action invoked by keyboard and controller input.
 const low=await page.evaluate(()=>{
  const g=window.game as any;for(let i=0;i<4;i++)g.photo.action('down');
  const p=g.session.world.cameras[0].position,points=g.session.track.spline.points;
  return {position:p.toArray(),surface:points[0][1],flatRoad:points.every((q:number[])=>q[1]===points[0][1])};
 });
 expect(low.flatRoad).toBe(true);
 expect(low.position[1]-low.surface!).toBeGreaterThanOrEqual(.39);
 expect(low.position[1]-low.surface!).toBeLessThan(.6);
 expect(low.position[1]).toBeLessThan(before[1]!);
 await page.screenshot({path:resolve(out,'02-ground-level.png')});
 const high=await page.evaluate(()=>{
  const g=window.game as any;for(let i=0;i<30;i++)g.photo.action('up');
  const p=g.session.world.cameras[0].position,t=g.session.humans[0].mesh.position;
  return {position:p.toArray(),horizontal:Math.hypot(p.x-t.x,p.z-t.z),height:p.y-t.y};
 });
 expect(high.horizontal).toBeLessThan(.04);expect(high.height).toBeGreaterThan(8);
 await page.screenshot({path:resolve(out,'03-overhead.png')});
 writeFileSync(resolve(out,'positions.json'),JSON.stringify({before,low,high},null,2));
});
