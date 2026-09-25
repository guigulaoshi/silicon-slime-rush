import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1280, height: 720 } });
const OUT = evidencePath('vehicle-effects');

test('all night racers carry per-lamp ground lighting and real braking brightens an AI tail', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?dev=1');
  await page.locator('.home-go').click();
  await page.waitForFunction(() => window.game?.report().phase === 'menu');
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'lhasa', car: 'sedan',
    vehicleId: 'sports-car', slimeDensity: 'none', timeOfDay: 'night', weather: 'clear', ai: true }, true)))
    .toBe(true);
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, 'vehicle-effects-night');
  await page.waitForTimeout(3500);
  const lighting = await page.evaluate(() => ({ report: window.game.report().vehicleLights,
    racers: (window.game as any).session.racers.length }));
  expect(lighting.report).toHaveLength(lighting.racers);
  expect(lighting.report.every(light => light.configured > 0 && light.pools > 0)).toBe(true);

  await page.evaluate(() => {
    const game = window.game as any, session = game.session;
    const racer = session.racers.find((candidate: any) => candidate.role === 'ai');
    game.phase = 'paused';
    racer.render(1, 1 / 60);
    const camera = session.world.camera;
    const forward = camera.position.clone().set(0, 0, -1).applyQuaternion(racer.mesh.quaternion);
    const side = camera.position.clone().set(1, 0, 0).applyQuaternion(racer.mesh.quaternion);
    camera.position.copy(racer.mesh.position).addScaledVector(forward, 10).addScaledVector(side, 4.5);
    camera.position.y += 2.8;
    camera.lookAt(racer.mesh.position.x, racer.mesh.position.y + .3, racer.mesh.position.z);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(OUT, 'ai-headlight-ground.png') });

  await brakeTail(page, 'ai');
});

/** The same AI tail with the brake off (dim lens, no halo) and on (brighter, larger, halo). */
async function brakeTail(page: Page, prefix: string) {
  const state = async (braking: number) => page.evaluate(braking => {
    const game = window.game as any, session = game.session;
    const racer = session.racers.find((candidate: any) => candidate.role === 'ai');
    const camera = session.world.camera;
    const backward = camera.position.clone().set(0, 0, 1).applyQuaternion(racer.mesh.quaternion);
    camera.position.copy(racer.mesh.position).addScaledVector(backward, 7);
    camera.position.y += 2.2;
    camera.lookAt(racer.mesh.position.x, racer.mesh.position.y + .2, racer.mesh.position.z);
    racer.car.braking = braking; racer.render(1, 1 / 60);
    const [lens, halo] = racer.model.brakeLights.children;
    return { visible: racer.model.brakeLights.visible, lens: lens.material.opacity, area: lens.scale.x * lens.scale.y,
      halo: halo.visible ? halo.material.opacity : 0 };
  }, braking);
  const dim = await state(0);
  await page.waitForTimeout(100);
  await page.screenshot({ path: resolve(OUT, `${prefix}-brake-off.png`) });
  const bright = await state(1);
  expect(dim.visible).toBe(true);
  expect(dim.lens).toBeGreaterThan(.2);
  expect(dim.halo).toBe(0);
  expect(bright.lens).toBeGreaterThan(dim.lens * 2);
  expect(bright.area).toBeGreaterThan(dim.area * 1.2);   // 379: thin light bars grow by area, not past the body
  expect(bright.halo).toBeGreaterThan(.5);
  await page.waitForTimeout(100);
  await page.screenshot({ path: resolve(OUT, `${prefix}-brake-on.png`) });
}

test('in daylight an AI tail lamp is dimly lit and braking brightens it with a halo', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?dev=1');
  await page.locator('.home-go').click();
  await page.waitForFunction(() => window.game?.report().phase === 'menu');
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'lhasa', car: 'sedan',
    vehicleId: 'sports-car', slimeDensity: 'none', timeOfDay: 'day', weather: 'clear', ai: true }, true)))
    .toBe(true);
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, 'vehicle-effects-day');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { (window.game as any).phase = 'paused'; });
  await brakeTail(page, 'day-ai');
});

test('normal snow driving lays two continuous wheel trails without dry cruise marks', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?dev=1&track=lhasa&bot=1&speed=8&time=day&weather=snow');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'vehicle-effects-snow');
  await page.waitForFunction(() => (window.game.report().tireMarks?.snow ?? 0) > 40,
    undefined, { timeout: 60_000 });
  const marks = await page.evaluate(() => window.game.report().tireMarks);
  expect(marks?.snow).toBeGreaterThan(40);
  expect(marks?.skid).toBe(0);
  await page.evaluate(() => {
    const game = window.game as any, session = game.session, racer = session.racers[0];
    game.phase = 'paused';
    racer.render(1, 1 / 60);
    const camera = session.world.camera;
    const backward = camera.position.clone().set(0, 0, 1).applyQuaternion(racer.mesh.quaternion);
    camera.position.copy(racer.mesh.position).addScaledVector(backward, 7);
    camera.position.y += 4.5;
    camera.lookAt(racer.mesh.position.x, racer.mesh.position.y, racer.mesh.position.z);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(OUT, 'snow-wheel-trails.png') });
});

test('dry cruising stays clean and a real hard brake lays black skid marks', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?dev=1');
  await page.locator('.home-go').click();
  await page.waitForFunction(() => window.game?.report().phase === 'menu');
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'lhasa', car: 'sedan',
    vehicleId: 'sports-car', slimeDensity: 'none', timeOfDay: 'day', weather: 'clear', ai: false }, true)))
    .toBe(true);
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, 'vehicle-effects-skid');
  await page.evaluate(() => {
    const car = window.game.session.car, forward = car.forward;
    const right = forward.clone().set(-forward.z, 0, forward.x), position = car.position;
    car.body.setTranslation({ x: position.x + right.x * 2.5, y: position.y,
      z: position.z + right.z * 2.5 }, true);
    car.body.setLinvel({ x: forward.x * 35, y: 0, z: forward.z * 35 }, true);
  });
  await page.waitForTimeout(300);
  expect((await page.evaluate(() => window.game.report().tireMarks))?.skid).toBe(0);
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => (window.game.report().tireMarks?.skid ?? 0) > 24);
  await page.keyboard.up('ArrowDown');
  await page.evaluate(() => {
    const game = window.game as any, session = game.session, racer = session.racers[0];
    game.phase = 'paused'; racer.render(1, 1 / 60);
    const camera = session.world.camera;
    const backward = camera.position.clone().set(0, 0, 1).applyQuaternion(racer.mesh.quaternion);
    camera.position.copy(racer.mesh.position).addScaledVector(backward, 5.5);
    camera.position.y += 3.4;
    camera.lookAt(racer.mesh.position.x, racer.mesh.position.y, racer.mesh.position.z);
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: resolve(OUT, 'dry-skid-marks.png') });
});
