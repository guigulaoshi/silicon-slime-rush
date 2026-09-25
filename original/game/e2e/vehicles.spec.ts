import { evidencePath } from './evidence';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { VehicleDefinition } from '../src/vehicles/catalogue';
import { expectWorldLoaded } from './world';

const { vehicles: VEHICLES } = JSON.parse(readFileSync(resolve('src/vehicles/catalogue.json'), 'utf8')) as
  { vehicles: VehicleDefinition[] };
// Short real-road drives and their loading/countdowns, not complete races.
test.describe.configure({ timeout: 240_000 });

test('production cars drive with aligned models and survive restart and replacement', async ({ page }) => {
  await page.goto('/?track=shoreline&bot=1&dev=1&time=day&vehicle=micro-hatch');
  await page.waitForFunction(() => window.game);
  const shots = evidencePath('vehicles'); mkdirSync(shots, { recursive: true });
  for (const vehicle of VEHICLES) {
    await page.evaluate(async id => {
      const game = window.game as any;
      game.save.useForSession({ slimeDensity: 'none' });
      await game.autoRun('shoreline', 'day', id);
    }, vehicle.id);
    const startProgress = await page.evaluate(() => window.game.report().progress);
    await page.waitForFunction(start => {
      const report = window.game.report();
      const travelled = (report.progress - start + report.length) % report.length;
      return report.phase === 'racing' && travelled > 25 && travelled < report.length / 2;
    }, startProgress, { timeout: 40_000 });
    await expectWorldLoaded(page, vehicle.id);
    const facts = await page.evaluate(() => {
      const game = window.game as any; const s = game.session;
      const count = s.physics.world.bodies.len();
      const sceneCars = s.world.scene.children.filter((node: any) => node.name.startsWith('car-')).length;
      const revision = s.car.poseRevision;
      const model = s.model;
      const wheelYawMatches = Math.abs(model.wheels[0].rotation.y - s.car.wheelSteeringAngle) < .0001;
      game.show('paused');
      game.restart();
      return { id: s.vehicle.id, sceneCars, wheels: s.model.wheels.length,
        half: s.car.tuning.chassisHalf, modelSame: s.model === model,
        reset: s.car.poseRevision === revision + 1, bodyCountStable: s.physics.world.bodies.len() === count,
        wheelYawMatches };
    });
    expect(facts).toEqual({ id: vehicle.id, sceneCars: vehicle.trailer ? 2 : 1, wheels: 4, half: vehicle.chassisHalf,
      modelSame: true, reset: true, bodyCountStable: true, wheelYawMatches: true });
    expect(await page.locator('#app > canvas').count()).toBe(1);
    await page.screenshot({ path: resolve(shots, `${vehicle.id}.png`) });
  }
  await page.evaluate(async () => {
    const game = window.game as any;
    await Promise.all([game.autoRun('synth-loop', 'day', 'sports-car'),
      game.autoRun('synth-loop', 'day', 'school-bus')]);
  });
  expect(await page.evaluate(() => window.game.report().vehicle)).toBe('school-bus');
  expect(await page.locator('#app > canvas').count()).toBe(1);
  await page.evaluate(() => (window.game as any).dispose());
  expect(await page.locator('#app > canvas').count()).toBe(0);
});

test('missing model stays on departure and a later retry still works', async ({ page }) => {
  await page.route('**/models/cars/school-bus.glb', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/?track=synth-loop&bot=1&dev=1&vehicle=school-bus');
  const boot = page.locator('[data-screen="boot"]');
  await expect(boot.locator('.departure-retry')).toBeVisible();
  await page.unroute('**/models/cars/school-bus.glb');
  await boot.locator('.departure-retry').click();
  await page.waitForFunction(() => window.game.report().phase === 'intro');
  await page.locator('[data-screen="intro"] .departure-go').click();
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  expect(await page.evaluate(() => window.game.report().vehicle)).toBe('school-bus');
});

test('vehicle inspection waits for a real drive and keeps the car visible', async ({ page }) => {
  await page.goto('/?track=shoreline&bot=1&dev=1&time=day&vehicle=school-bus&inspect=vehicle');
  await expect(page.locator('#inspection-ready')).toHaveAttribute('data-complete', 'true', { timeout: 40_000 });
  expect(await page.evaluate(() => {
    const game = window.game as any;
    return { time: game.report().time, visible: game.session.mesh.visible,
      grounded: game.session.car.grounded, id: game.report().vehicle };
  })).toMatchObject({ visible: true, grounded: true, id: 'school-bus', time: expect.any(Number) });
  expect(await page.evaluate(() => window.game.report().time)).toBeGreaterThan(0);
});
