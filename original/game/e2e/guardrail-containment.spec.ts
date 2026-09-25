import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

const OUT = evidencePath('guardrail');
test.describe.configure({ timeout: 240_000 });

type Sample = {
  trackId: string;
  vehicleId: string;
  label: string;
  alongSpeed: number;
  acrossSpeed: number;
  expected: 'contained' | 'breakout';
};

async function launchAcrossStartRail(page: Page, sample: Sample) {
  expect(await page.evaluate(({ trackId, vehicleId }) => (window.game as any).startRace({
    trackId, vehicleId, playerVehicles: [vehicleId], timeOfDay: 'day', weather: 'clear',
    slimeDensity: 'none', ai: false,
  }, true), sample)).toBe(true);
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await page.waitForFunction(() => {
    const tiles = window.game.report().tiles;
    return !!tiles && tiles.loaded > 0 && tiles.loading === 0;
  });
  await expectWorldLoaded(page, `475 ${sample.label}`);

  const setup = await page.evaluate(async () => {
    const game = window.game as any, racer = game.session.humans[0], spline = game.session.world.spline;
    const index = spline.indexAt(2), point = spline.point(index), right = spline.right(index);
    const halfWidth = spline.halfWidth[Math.round(index)]!;
    game.phase = 'paused';
    racer.car.reset([
      point[0] + right[0] * (halfWidth - 1.2), point[1] + .8,
      point[2] + right[2] * (halfWidth - 1.2),
    ], 0);
    racer.race.reacquire(racer.car.position.x, racer.car.position.z);
    racer.chase.reset();
    game.phase = 'racing';
    racer.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    return { halfWidth, raceTime: racer.race.time };
  });
  await page.waitForFunction(raceTime => {
    const racer = (window.game as any).session.humans[0];
    return racer.race.time - raceTime >= .35 && racer.car.grounded;
  }, setup.raceTime);
  const start = await page.evaluate(({ alongSpeed, acrossSpeed, halfWidth }) => {
    const game = window.game as any, racer = game.session.humans[0], spline = game.session.world.spline;
    const index = spline.indexAt(2), tangent = spline.tangent(index), right = spline.right(index);
    const dx = tangent[0] * alongSpeed + right[0] * acrossSpeed;
    const dz = tangent[2] * alongSpeed + right[2] * acrossSpeed;
    racer.car.body.setRotation({ x: 0, y: Math.sin(Math.atan2(-dx, -dz) / 2), z: 0,
      w: Math.cos(Math.atan2(-dx, -dz) / 2) }, true);
    racer.car.body.setLinvel({ x: dx, y: 0, z: dz }, true);
    return { halfWidth, raceTime: racer.race.time, resets: racer.resetLog.length,
      barrierImpacts: game.report().collisionFeedback.barrierImpacts };
  }, { ...sample, halfWidth: setup.halfWidth });
  await page.waitForFunction(raceTime => {
    const racer = (window.game as any).session.humans[0];
    return racer.race.time - raceTime >= .9;
  }, start.raceTime);
  return page.evaluate(({ resets, barrierImpacts, halfWidth }) => {
    const game = window.game as any, racer = game.session.humans[0];
    game.phase = 'paused';
    return { halfWidth, lateral: Math.abs(racer.race.progress.value.lateral),
      resets: racer.resetLog.length - resets,
      barrierImpacts: game.report().collisionFeedback.barrierImpacts - barrierImpacts };
  }, start);
}

test('roadside rails contain vehicles at point-to-point starts', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 13, language: 'en', quality: 'high', volume: 0, muted: true,
    slimeDensity: 'none', best: {},
  })));
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);

  const samples: Sample[] = [
    { trackId: 'goldengate', vehicleId: 'micro-hatch', label: 'Golden Gate sedan low-speed direct',
      alongSpeed: 0, acrossSpeed: 4, expected: 'contained' },
    { trackId: 'goldengate', vehicleId: 'school-bus', label: 'Golden Gate school bus low-speed direct',
      alongSpeed: 0, acrossSpeed: 4, expected: 'contained' },
    { trackId: 'shoreline', vehicleId: 'micro-hatch', label: 'Shoreline sedan low-speed direct',
      alongSpeed: 0, acrossSpeed: 4, expected: 'contained' },
    { trackId: 'goldengate', vehicleId: 'micro-hatch', label: 'Golden Gate sedan fast shallow rub',
      alongSpeed: 18, acrossSpeed: 4, expected: 'contained' },
    { trackId: 'goldengate', vehicleId: 'micro-hatch', label: 'Golden Gate sedan fast direct breakout',
      alongSpeed: 0, acrossSpeed: 11, expected: 'breakout' },
  ];
  const results = [];
  for (const sample of samples) {
    const result = await launchAcrossStartRail(page, sample);
    results.push({ ...sample, ...result });
    if (sample.label === 'Golden Gate sedan low-speed direct') {
      await page.evaluate(() => {
        const game = window.game as any;
        document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(node => { node.style.display = 'none'; });
        game.session.world.render();
      });
      await page.screenshot({ path: resolve(OUT, 'after.png') });
    }
  }
  writeFileSync(resolve(OUT, 'results.json'), JSON.stringify(results, null, 2));
  for (const result of results) {
    expect(result.barrierImpacts, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.resets, JSON.stringify(result)).toBe(0);
    if (result.expected === 'contained') {
      expect(result.lateral, JSON.stringify(result)).toBeLessThan(result.halfWidth + 1.2);
    } else {
      expect(result.lateral, JSON.stringify(result)).toBeGreaterThan(result.halfWidth + 2);
    }
  }
});
