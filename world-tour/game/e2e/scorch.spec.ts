import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

/**
 * A bomb the robot drives into leaves a soot burn on the road for the rest of the race, and
 * a matte soot patch on the car instead of a splash pattern. Photographed from above the blast before
 * it goes off and after, by day and by night.
 */
const OUT = evidencePath('scorch');
test.describe.configure({ timeout: 240_000 });

for (const time of ['day', 'night'] as const) test(`a bomb scorches the road and the car at ${time}`, async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {} })));
  await page.goto(`/?dev=1&track=synth-p2p&bot=1&speed=1&time=${time}&weather=clear&vehicle=retro-van`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, `scorch ${time}`);
  await page.waitForFunction(() => window.game.report().speedKmh > 30, null, { timeout: 60_000 });

  // Put a bomb on the centreline 40 m ahead and a camera above that spot, looking down.
  const spot = await page.evaluate(() => {
    const s = (window.game as any).session, spline = s.world.spline;
    const car = s.car.body.translation();
    const index = spline.indexAt(Math.min(spline.length - 20, s.race.progress.value.s + 40));
    const p = spline.point(index);
    s.slimes.addTile('scorch', [{ kind: 'burst', position: [p[0], p[1] + .9, p[2]], scale: [1.2, 1.2, 1.2], yaw: 0 }]);
    return { x: p[0], y: p[1], z: p[2], car: [car.x, car.y, car.z] };
  });
  const aerial = async (name: string) => {
    await page.evaluate(({ x, y, z }) => {
      const s = (window.game as any).session, camera = s.world.camera;
      s.chase.update = () => { camera.position.set(x + 7, y + 11, z + 7); camera.lookAt(x, y, z); };
    }, spot);
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(OUT, `${time}-${name}.png`) });
  };
  await aerial('before');
  const before = await page.evaluate(() => (window.game as any).session.slimes.effects.persistent.stats);

  // Give the chase camera back until the robot has driven through the bomb.
  await page.evaluate(() => { delete (window.game as any).session.chase.update; });
  await page.waitForFunction(() => window.game.report().slimes!.feedback.hits.burst > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(250);
  const coat = await page.evaluate(() => (window.game as any).session.model.bodyCoat.stats);
  // Freeze the world (so the soot does not wear off) and look at the car's nose from ahead and to one side.
  // Pause the game (so the soot does not wear off) and look at the car's nose from ahead and to one side.
  await page.evaluate(() => {
    const game = window.game as any, s = game.session, world = s.world, camera = world.camera;
    game.phase = 'paused';
    const car = s.mesh;
    car.updateMatrixWorld(true);
    const p = car.position.clone(), q = car.quaternion.clone();
    const forward = p.clone().set(0, 0, -1).applyQuaternion(q), right = p.clone().set(1, 0, 0).applyQuaternion(q);
    camera.position.copy(p).addScaledVector(forward, 5.5).addScaledVector(right, 3.2).setY(p.y + 1.8);
    camera.lookAt(p.x, p.y + .5, p.z);
    document.querySelectorAll<HTMLElement>('#ui,.slime-windshield,.slime-immersion,.slime-burst-flash').forEach(node => { node.style.display = 'none'; });
    // Live slime bodies and sparks would stand between the camera and the paint; the road marks stay.
    const hidden: any[] = [];
    world.scene.traverse((o: any) => { if (o.isMesh && /slime|particle|fragment/i.test(o.name) && !/splatter|ground/i.test(o.name) && o.visible) { o.visible = false; hidden.push(o); } });
    s.slimes.group && (s.slimes.group.visible = false);
    world.render();
    (window as any).__hidden388 = hidden;
  });
  await page.screenshot({ path: resolve(OUT, `${time}-car-after.png`) });
  await page.evaluate(() => {
    (window.game as any).phase = 'racing';
    for (const o of (window as any).__hidden388 ?? []) o.visible = true;
    const layer = (window.game as any).session.slimes; if (layer.group) layer.group.visible = true;
    document.querySelectorAll<HTMLElement>('#ui').forEach(node => { node.style.display = ''; });
  });
  await page.waitForTimeout(1500);
  await aerial('after');
  const after = await page.evaluate(() => (window.game as any).session.slimes.effects.persistent.stats);

  expect(after.scorches - before.scorches, 'one burn on the road').toBe(1);
  expect(after.pending, 'the burn has been drawn').toBe(0);
  expect(coat.soot, 'the car carries soot, not a splash').toBe(true);
});
