import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });
// Retargeted from shoreline (deleted, "an open flat campus route") to lhasa throughout this file:
// these are generic authored-slime physics checks, any flat day track with streamed slimes works.
test.skip(process.env.SLIME_PHYSICS_QA !== '1', 'opt-in actual streamed slime physics evidence');
const out = evidencePath('slime-physics');
for (const kind of ['popper', 'slick', 'burst', 'boost']) {
  test(`the shipped ${kind} has a living body and its requested impact response`, async ({ page }) => {
    await page.goto('/?track=lhasa&bot=1&dev=1&time=day');
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    const before = await page.evaluate(kind => {
      const g = window.game as any, s = g.session, w = s.world;
      g.phase = 'paused'; g.autopilot = false;
      const live = s.slimes.lives.find((x: any) => x.active && !x.spawn.scenery && x.spawn.kind === kind);
      if (!live) throw new Error(`No streamed ${kind}`);
      const p = live.spawn.position, ground = p[1] - live.spawn.scale[1];
      const t = w.spline.tangent(w.spline.indexAt(live.spawn.s));
      s.car.reset([p[0] - t[0] * 12, ground + .8, p[2] - t[2] * 12], Math.atan2(-t[0], -t[2]));
      s.race.reacquire(s.car.position.x, s.car.position.z); s.chase.reset();
      g.__physicsSlime = { key: live.key, p: [...p], t };
      w.camera.position.set(p[0] + 9, p[1] + 6, p[2] + 9);
      w.camera.lookAt(...p); w.camera.updateProjectionMatrix(); w.render();
      return { key: live.key, spawn: live.spawn, stats: s.slimes.stats, failed: w.streamer.stats.failed };
    }, kind);
    expect(before.failed).toBe(0);
    expect(before.spawn.scale[1] / Math.max(before.spawn.scale[0], before.spawn.scale[2])).toBeGreaterThan(.4);
    mkdirSync(out, { recursive: true });
    await page.screenshot({ path: resolve(out, `${kind}-alive.png`) });
    await page.keyboard.down('KeyW');
    await page.evaluate(() => { (window.game as any).phase = 'racing'; });
    await page.waitForFunction(({ kind, hits }) =>
      (window.game.report().slimes!.feedback.hits as any)[kind] > hits,
    { kind, hits: before.stats.feedback.hits[kind] });
    await page.keyboard.up('KeyW');
    await page.screenshot({ path: resolve(out, `${kind}-impact.png`) });
    if (kind === 'slick') await page.evaluate(() => {
      const s = (window.game as any).session;
      s.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => {
      const g = window.game as any, s = g.session, w = s.world;
      g.phase = 'paused';
      const target = g.__physicsSlime;
      const live = s.slimes.liveByKey.get(target.key);
      const p = live?.spawn.position ?? target.p;
      w.camera.position.set(p[0] + 10, p[1] + 8, p[2] + 10);
      w.camera.lookAt(...p); w.render();
      return { report: g.report(), active: !!live?.active, solid: live?.collider ? !live.collider.isSensor() : false,
        motion: live?.motion ? { position: live.motion.body.translation(), velocity: live.motion.body.linvel() } : null };
    });
    writeFileSync(resolve(out, `${kind}.json`), JSON.stringify({ before, after }, null, 2));
    if (kind === 'slick') {
      expect(after.active).toBe(true);
      expect(after.motion).not.toBeNull();
      expect(after.solid).toBe(true);
      expect(after.report.slimes.bounceHits).toBeGreaterThan(before.stats.bounceHits);
    } else {
      expect(after.active).toBe(false);
      expect(after.report.slimes.fragmentLandings).toBeGreaterThan(before.stats.fragmentLandings);
      expect(after.report.slimes.puddles).toBeGreaterThan(before.stats.puddles);
    }
    await page.screenshot({ path: resolve(out, `${kind}-landed.png`) });
    writeFileSync(resolve(out, `${kind}.json`), JSON.stringify({ before, after }, null, 2));
  });
}


test('off-road growth uses the same rounded living body and visible eyes', async ({page}) => {
  await page.goto('/?track=lhasa&bot=1&dev=1&time=day');
  await page.waitForFunction(()=>window.game?.report().phase==='racing');
  const facts=await page.evaluate(()=>{
    const g=window.game as any,s=g.session,w=s.world;g.phase='paused';
    const scenery=s.slimes.lives.filter((x:any)=>x.active&&x.spawn.scenery);
    const live=scenery.find((x:any)=>x.spawn.position[1]<15)??scenery[0];
    if(!live)throw new Error('No actual off-road live carrier');
    const p=live.spawn.position,r=Math.max(...live.spawn.scale);
    w.camera.position.set(p[0]+r*1.5,p[1]+r,p[2]+r*2.5);
    w.camera.lookAt(...p);w.camera.updateProjectionMatrix();w.render();
    return {count:scenery.length,spawn:live.spawn,eyes:s.slimes.colossusEyes.count,
      active:s.slimes.stats.active,failed:w.streamer.stats.failed};
  });
  expect(facts.count).toBeGreaterThan(0);expect(facts.eyes).toBeGreaterThanOrEqual(facts.active*2);
  expect(facts.failed).toBe(0);
  mkdirSync(out,{recursive:true});
  await page.screenshot({path:resolve(out,'off-road-alive.png')});
  writeFileSync(resolve(out,'off-road.json'),JSON.stringify(facts,null,2));
});
