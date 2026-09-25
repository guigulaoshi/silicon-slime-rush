import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });
const out = evidencePath('collision-feedback');

test('a real two-player car collision reaches both cameras, sparks and the shared crash voice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
    slimeDensity: 'none', playerVehicles: ['micro-hatch', 'sports-car'] }))).toBe(true);
  await page.evaluate(async () => {
    const game = window.game as any;
    await game.audio.unlock();
    game.beginCountdown();
  });
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  const before = await page.evaluate(() => window.game.report().collisionFeedback);
  await page.evaluate(() => {
    const game = window.game as any, s = game.session;
    const index = s.world.spline.indexAt(80), centre = s.world.spline.point(index);
    const tangent = s.world.spline.tangent(index);
    const a = s.racers[0], b = s.racers[1];
    a.car.reset([centre[0] - tangent[0] * 5, centre[1] + 1, centre[2] - tangent[2] * 5],
      Math.atan2(-tangent[0], -tangent[2]));
    b.car.reset([centre[0] + tangent[0] * 5, centre[1] + 1, centre[2] + tangent[2] * 5],
      Math.atan2(tangent[0], tangent[2]));
    a.race.reacquire(a.car.position.x, a.car.position.z);
    b.race.reacquire(b.car.position.x, b.car.position.z);
    a.chase.reset(); b.chase.reset();
    a.car.body.setLinvel({ x: tangent[0] * 12, y: 0, z: tangent[2] * 12 }, true);
    b.car.body.setLinvel({ x: -tangent[0] * 12, y: 0, z: -tangent[2] * 12 }, true);
  });
  // Pause and read in the same frame the impact is seen: sparks live for a fraction of a second, and a
  // separate read two page calls later found none on a busy machine.
  const after = await (await page.waitForFunction(before => {
    const game = window.game as any, feedback = game.report().collisionFeedback;
    if (feedback.vehicleImpacts < before.vehicleImpacts + 2 || feedback.sparkBursts < before.sparkBursts + 2) return false;
    game.phase = 'paused';
    return { report: feedback, cameraKicks: game.session.humans.map((racer: any) => racer.chase.hits),
      positions: game.session.racers.map((racer: any) => racer.car.position) };
  }, before)).jsonValue() as { report: any; cameraKicks: number[]; positions: any[] };
  expect(after.report.heavyImpacts).toBeGreaterThanOrEqual(before.heavyImpacts + 2);
  expect(after.report.impactSounds).toBeGreaterThan(before.impactSounds);
  expect(after.report.activeSparks).toBeGreaterThan(0);
  expect(after.cameraKicks.every(count => count > 0)).toBe(true);
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: resolve(out, 'car-to-car.png') });
  await page.evaluate(() => {
    const game = window.game as any, s = game.session;
    const a = s.racers[0].car.position, b = s.racers[1].car.position;
    const target = a.clone().add(b).multiplyScalar(.5);
    for (const camera of s.world.cameras) {
      camera.position.set(target.x + 5, target.y + 2.2, target.z + 4);
      camera.lookAt(target);
    }
    s.world.render();
  });
  await page.screenshot({ path: resolve(out, 'car-to-car-sparks.png') });
  writeFileSync(resolve(out, 'car-to-car.json'), JSON.stringify({ before, after }, null, 2));
});

test('an impact on a player trailer reaches that player instead of disappearing in the tow rig', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
    slimeDensity: 'none', playerVehicles: ['pickup-travel-trailer', 'sports-car'] }))).toBe(true);
  await page.evaluate(async () => {
    const game = window.game as any; await game.audio.unlock(); game.beginCountdown();
  });
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  const before = await page.evaluate(() => window.game.report().collisionFeedback);
  await page.evaluate(() => {
    const game = window.game as any, s = game.session;
    const index = s.world.spline.indexAt(100), centre = s.world.spline.point(index);
    const tangent = s.world.spline.tangent(index), right = { x: -tangent[2], z: tangent[0] };
    const tow = s.racers[0], hitter = s.racers[1];
    tow.car.reset([centre[0], centre[1] + 1, centre[2]], Math.atan2(-tangent[0], -tangent[2]));
    tow.trailer.syncReset(); tow.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    tow.trailer.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const target = tow.trailer.car.position;
    hitter.car.reset([target.x + right.x * 5, target.y, target.z + right.z * 5],
      Math.atan2(right.x, right.z));
    hitter.car.body.setLinvel({ x: -right.x * 12, y: 0, z: -right.z * 12 }, true);
    for (const racer of s.racers) { racer.race.reacquire(racer.car.position.x, racer.car.position.z); racer.chase.reset(); }
  });
  await page.waitForFunction(before => window.game.report().collisionFeedback.vehicleImpacts
    >= before.vehicleImpacts + 2, before);
  const after = await page.evaluate(() => ({ report: window.game.report().collisionFeedback,
    cameraKicks: window.game.session.humans.map(racer => racer.chase.hits),
    hitchGap: window.game.session.racers[0]!.trailer!.hitchGap }));
  // A side hit can also lift and land the striking car. ChaseCamera counts that landing kick
  // too; the contract is that both players receive feedback, not one total kick per camera.
  expect(after.cameraKicks).toHaveLength(2);
  for (const kicks of after.cameraKicks) expect(kicks).toBeGreaterThanOrEqual(1);
  expect(after.report.sparkBursts).toBeGreaterThanOrEqual(before.sparkBursts + 2);
  expect(after.report.impactSounds).toBeGreaterThan(before.impactSounds);
  expect(after.hitchGap).toBeLessThan(.35);
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: resolve(out, 'trailer-impact.png') });
  writeFileSync(resolve(out, 'trailer-impact.json'), JSON.stringify({ before, after }, null, 2));
});
