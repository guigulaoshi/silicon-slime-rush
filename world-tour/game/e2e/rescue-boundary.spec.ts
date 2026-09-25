import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

const out = evidencePath('rescue-boundary');
test.describe.configure({ timeout: 120_000 });

// Retargeted from shoreline (deleted, "an open flat campus route") to lhasa: at s=650 lhasa's
// halfWidth is 7.75 m (game/public/tracks/lhasa/track.json spline.checkpoints), well short of the
// 12-20 m lateral offsets this test drives to, so "off route" still means off route.
async function start(page: Page, vehicle: string): Promise<void> {
  await page.evaluate(async id => {
    const game = window.game as any;
    await game.startRace({ trackId: 'lhasa', vehicleId: id, playerVehicles: [id],
      timeOfDay: 'day', weather: 'clear', slimeDensity: 'none', ai: false }, true);
  }, vehicle);
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, vehicle);
}

async function place(page: Page, lateral: number, dt: number): Promise<{
  revision: number; resets: number; warning: boolean; lateral: number;
  speedKmh: number;
}> {
  return page.evaluate(({ lateral, dt }) => {
    const game = window.game as any, racer = game.session.humans[0], spline = game.session.world.spline;
    const index = spline.indexAt(650), point = spline.point(index), right = spline.right(index);
    const tangent = spline.tangent(index), yaw = Math.atan2(-tangent[0], -tangent[2]);
    racer.car.reset([point[0] + right[0] * lateral, point[1] + 1,
      point[2] + right[2] * lateral], yaw);
    racer.car.body.setLinvel({ x: tangent[0] * 8, y: 0, z: tangent[2] * 8 }, true);
    racer.race.reacquire(racer.car.position.x, racer.car.position.z);
    racer.chase.reset();
    (game as any).advanceRace(dt, false, racer.car.position, racer.car.quaternion, racer);
    return { revision: racer.car.poseRevision, resets: racer.resetLog.length,
      warning: racer.race.rescueWarning,
      lateral: racer.race.progress.value.lateral, speedKmh: racer.car.speed * 3.6 };
  }, { lateral, dt });
}

async function step(page: Page, dt: number) {
  return page.evaluate(dt => {
    const game = window.game as any, racer = game.session.humans[0];
    (game as any).advanceRace(dt, false, racer.car.position, racer.car.quaternion, racer);
    return { revision: racer.car.poseRevision, resets: racer.resetLog,
      warning: racer.race.rescueWarning };
  }, dt);
}

// Once gave the monster truck a 32 m shortcut boundary; the player withdrew it during 354,
// so every vehicle now shares the ordinary rescue boundary.
test('one real route rescues a monster truck and an ordinary car on the same boundary, and cancels on return', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 13, language: 'zh',
  })));
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);

  await start(page, 'monster-truck');
  const far = await place(page, 20, .2);
  expect(far).toMatchObject({ resets: 0, warning: true });
  expect(Math.abs(far.lateral)).toBeGreaterThan(15);
  await expect(page.locator('.hud-notice')).toHaveText('已偏离区域，救援车马上就到');
  await page.screenshot({ path: resolve(out, '02-monster-far-warning-zh.png'), animations: 'disabled' });
  await page.evaluate(() => (window.game as any).i18n.set('en'));
  await expect(page.locator('.hud-notice')).toHaveText('Off route — roadside rescue is almost here');
  const monsterRescue = await step(page, 1);
  expect(monsterRescue.resets.at(-1)).toMatchObject({ reason: 'off-track' });

  await start(page, 'micro-hatch');
  const ordinary = await place(page, 12, .2);
  expect(ordinary).toMatchObject({ resets: 0, warning: true });
  await expect(page.locator('.hud-notice')).toHaveText('Off route — roadside rescue is almost here');
  await page.screenshot({ path: resolve(out, '03-ordinary-warning-en.png'), animations: 'disabled' });

  const returned = await place(page, 0, .1);
  expect(returned.warning).toBe(false);
  const afterReturn = await step(page, 2);
  expect(afterReturn.resets).toHaveLength(0);
  expect(afterReturn.revision).toBe(returned.revision);
  await page.screenshot({ path: resolve(out, '04-returned-before-rescue.png'), animations: 'disabled' });

  await place(page, 12, .2);
  const ordinaryRescue = await step(page, 1);
  expect(ordinaryRescue.resets.at(-1)).toMatchObject({ reason: 'off-track' });
  writeFileSync(resolve(out, 'rescue-boundaries.json'), JSON.stringify({
    route: 'lhasa', far, monsterRescue, ordinary, returned, afterReturn, ordinaryRescue,
  }, null, 2));
});
