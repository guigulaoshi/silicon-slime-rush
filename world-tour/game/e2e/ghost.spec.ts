import { evidencePath } from './evidence';
import { expect,test } from '@playwright/test';
import { mkdirSync,writeFileSync } from 'node:fs';
const out=evidencePath('ghost');
// One complete synthetic drive plus a reload and replay, accelerated with the normal fixed step.
test.describe.configure({ timeout: 180_000 });
test('a real bot finish survives reload as a non-colliding personal-best ghost',async({page})=>{
 mkdirSync(out,{recursive:true});
 await page.goto('/?track=synth-p2p&dev=1&bot=1&speed=6');
 await expect.poll(()=>page.evaluate(()=>window.game?.report().state),{timeout:150000,intervals:[500]}).toBe('finished');
 const finish=await page.evaluate(()=>window.game.report());expect(finish.resets).toBe(0);
 const stored=await page.evaluate(()=>(window.game as any).save.ghost('synth-p2p@micro-hatch'));
 expect(stored).not.toBeNull();expect(stored!.samples).toBeGreaterThan(10);
 writeFileSync(`${out}/trajectory.json`,JSON.stringify(stored));
 writeFileSync(`${out}/finish.json`,JSON.stringify(finish,null,2));
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 // The ghost starts off; this test is about the ghost itself.
 await page.evaluate(()=>(window.game as any).save.update({showGhost:true}));
 await page.evaluate(()=>window.game.startRace({trackId:'synth-p2p',car:'sedan',slimeDensity:'normal',ai:false}));
 await page.locator('[data-screen=intro] .departure-go').click();
 await expect.poll(()=>page.evaluate(()=>window.game.report().ghost.visible),{timeout:15000}).toBe(true);
 await page.waitForTimeout(4000);
 await page.screenshot({path:`${out}/replay-driving.png`});
 await page.keyboard.press('Escape');
 await expect.poll(()=>page.evaluate(()=>window.game.report().phase)).toBe('paused');
 const facts=await page.evaluate(()=>{
  const g=window.game as any,s=g.session;
  const shapes:number[]=[];s.physics.world.bodies.forEach((body:any)=>{if(body.isDynamic())shapes.push(body.handle);});
  return {racers:s.racers.length,dynamicBodies:shapes.length,ghostGroups:s.world.scene.children.filter((n:any)=>n.name==='personal-best-ghost').map((n:any)=>({visible:n.visible,position:n.position.toArray()})),report:g.report()};
 });
 expect(facts.racers).toBe(1);expect(facts.ghostGroups).toHaveLength(1);expect(facts.report.phase).toBe('paused');
 // The replay can be removed without taking a body out of Rapier.
 const after=await page.evaluate(()=>{const g=window.game as any;g.ghostReplay.dispose();let n=0;g.session.physics.world.bodies.forEach((b:any)=>{if(b.isDynamic())n++;});return n;});
 expect(after).toBe(facts.dynamicBodies);
 await page.evaluate(()=>{const g=window.game as any;return g.ghostReplay.set(g.save.ghost('synth-p2p@micro-hatch'));});
 await expect.poll(()=>page.evaluate(()=>window.game.report().ghost.visible)).toBe(true);
 await page.screenshot({path:`${out}/replay-paused.png`});
 writeFileSync(`${out}/replay.json`,JSON.stringify(facts,null,2));
 // Any real track other than synth-p2p proves the ghost clears on a track switch; Sydney is the world-tour default/showcase track (goldengate's old role).
 await page.evaluate(()=>window.game.startRace({trackId:'sydney',car:'sedan',slimeDensity:'normal',ai:false}));
 expect((await page.evaluate(()=>window.game.report())).ghost.samples).toBe(0);
 expect((await page.evaluate(()=>window.game.report())).ghost.visible).toBe(false);
});
