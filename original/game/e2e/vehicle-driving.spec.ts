import { evidencePath } from './evidence';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { driveBudgetGameSeconds } from './driveBudget';

const { vehicles } = JSON.parse(readFileSync(resolve('src/vehicles/catalogue.json'), 'utf8')) as {
  vehicles: { id: string; handling: { mass: number; maxSpeed: number } }[];
};
test.describe.configure({ timeout: 240_000 });
for (const vehicle of vehicles) test(`${vehicle.id} completes the same real-road course with its own calibration`, async ({ page }) => {
  await page.goto(`/?track=shoreline&bot=1&dev=1&time=day&speed=6&vehicle=${vehicle.id}`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  const tuning = await page.evaluate(() => {
    const s = (window.game as any).session;
    return { mass: s.car.tuning.mass, speed: s.car.tuning.maxSpeed, physicalMass: s.car.body.mass() };
  });
  expect(tuning.mass).toBe(vehicle.handling.mass);
  expect(tuning.speed).toBe(vehicle.handling.maxSpeed);
  expect(tuning.physicalMass).toBeCloseTo(vehicle.handling.mass, 3);
  let screenshot = false;
  let minUpright = 1;
  let peakHitchGap = 0;
  while (true) {
    const report = await page.evaluate(() => {
      const g = window.game as any;
      return { ...g.report(), upright: g.session.car.upright };
    });
    minUpright = Math.min(minUpright, report.upright);
    if (vehicle.id === 'pickup-travel-trailer')
      peakHitchGap = Math.max(peakHitchGap, report.trailer?.hitchGap ?? Infinity);
    if (!screenshot && report.time > 4) {
      const directory = evidencePath('vehicles'); mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: resolve(directory, `${vehicle.id}.png`) });
      screenshot = true;
    }
    if (report.state === 'finished' || report.time > driveBudgetGameSeconds(report.length, report.laps)) {
      const directory = evidencePath('vehicles'); mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, `${vehicle.id}-drive.json`),
        JSON.stringify({ report, tuning, minUpright, peakHitchGap }, null, 2));
      expect(report.state, JSON.stringify(report.resetLog)).toBe('finished');
      expect(report.resets, JSON.stringify(report.resetLog)).toBe(0); expect(report.tiles?.failed).toBe(0);
      expect(minUpright).toBeGreaterThan(.5);
      if (vehicle.id === 'pickup-travel-trailer') {
        expect(report.trailer).toBeTruthy();
        expect(peakHitchGap).toBeLessThan(.15);
      }
      console.log(`${vehicle.id}: ${report.time.toFixed(1)}s, ${report.resets} resets, min upright ${minUpright.toFixed(3)}`);
      break;
    }
    await page.waitForTimeout(500);
  }
});

test('records clear road-view evidence of all calibrated vehicles', async ({ page }) => {
  const directory = evidencePath('vehicles'); mkdirSync(directory, { recursive: true });
  for (const vehicle of vehicles) {
    // Appearance and full-route validation are separate. Remove optional slime occluders only
    // for these model views; the six complete drives above use the ordinary density.
    await page.goto(`/?track=shoreline&bot=1&dev=1&time=day&vehicle=${vehicle.id}&inspect=vehicle&perf=1&perfSlimes=none`);
    await expect(page.locator('#inspection-ready')).toHaveAttribute('data-complete', 'true', { timeout: 40_000 });
    expect(await page.evaluate(() => window.game.report().time)).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(directory, `${vehicle.id}-clear.png`) });
  }
});


test('keeps the car out of physics until delayed starting road collisions arrive', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/tracks/wolfe-pruneridge/tiles.bin', async route => {
    requests++; await held; await route.continue();
  });
  await page.goto('/?track=wolfe-pruneridge&bot=1&dev=1&speed=6');
  await expect.poll(() => requests).toBeGreaterThan(0);
  expect(await page.evaluate(() => ({ phase: window.game.report().phase,
    time: window.game.report().time, hasCar: !!(window.game as any).session?.car })))
    .toEqual({ phase: 'boot', time: 0, hasCar: false });
  release();
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  expect(await page.evaluate(() => window.game.report().tiles!.loaded)).toBeGreaterThan(0);
  await page.waitForFunction(() => window.game.report().progress > 350, null, { timeout: 90_000 });
  expect(await page.evaluate(() => window.game.report().resets)).toBe(0);
});
