import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

const out = evidencePath('rail-bounce');
test.describe.configure({ timeout: 180_000 });

test('a school bus driven into the Big Tech Rooftop rail is turned back onto the road', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 13, language: 'en' })));
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  await page.evaluate(async () => {
    await (window.game as any).startRace({ trackId: 'wolfe-pruneridge', vehicleId: 'school-bus',
      playerVehicles: ['school-bus'], timeOfDay: 'day', weather: 'clear', slimeDensity: 'none', ai: false }, true);
  });
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, 'rail bounce');

  await page.evaluate(async () => {
    const g = window.game as any, racer = g.session.humans[0], sp = g.session.world.spline;
    const i = sp.indexAt(300), p = sp.point(i), r = sp.right(i), t = sp.tangent(i);
    const hw = sp.halfWidth[Math.round(i)]!, angle = 25 * Math.PI / 180, speed = 18;
    const v = [t[0] * Math.cos(angle) + r[0] * Math.sin(angle), t[2] * Math.cos(angle) + r[2] * Math.sin(angle)];
    racer.car.reset([p[0] + r[0] * (hw - 3), p[1] + .9, p[2] + r[2] * (hw - 3)], Math.atan2(-v[0]!, -v[1]!));
    racer.race.reacquire(racer.car.position.x, racer.car.position.z);
    racer.chase.reset();
    // A reset lands on the next frame and zeroes velocity, so launch after it has taken effect.
    await new Promise(done => requestAnimationFrame(done));
    await new Promise(done => requestAnimationFrame(done));
    racer.car.body.setLinvel({ x: v[0]! * speed, y: 0, z: v[1]! * speed }, true);
    (g as any).__rail354 = { start: racer.race.time, resets: racer.resetLog.length, hw, maxLateral: -Infinity, minUpright: 1, contacts: 0 };
    const sample = () => {
      const s = (g as any).__rail354;
      s.maxLateral = Math.max(s.maxLateral, Math.abs(racer.race.progress.value.lateral));
      s.contacts += racer.car.scrape ? 1 : 0;
      s.minUpright = Math.min(s.minUpright, racer.car.upright);
      if (racer.race.time - s.start < 3) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const at = (seconds: number) => page.waitForFunction(s => {
    const g = window.game as any; return g.session.humans[0].race.time - g.__rail354.start >= s;
  }, seconds);
  await at(.05); await page.screenshot({ path: resolve(out, '01-approach.png'), animations: 'disabled' });
  await at(.35); await page.screenshot({ path: resolve(out, '02-contact.png'), animations: 'disabled' });
  await at(1.2); await page.screenshot({ path: resolve(out, '03-back-on-road.png'), animations: 'disabled' });
  await at(3);
  const result = await page.evaluate(() => {
    const g = window.game as any, racer = g.session.humans[0], s = g.__rail354;
    return { ...s, resets: racer.resetLog.length - s.resets, lateral: racer.race.progress.value.lateral,
      upright: racer.car.upright, speedKmh: racer.car.speed * 3.6 };
  });
  writeFileSync(resolve(out, 'bounce.json'), JSON.stringify(result, null, 2));
  expect(result.contacts, JSON.stringify(result)).toBeGreaterThan(0);
  expect(result.resets, JSON.stringify(result)).toBe(0);
  // The body never got past the rail line (half width .708 outside hw + .3) and stayed on its wheels.
  expect(result.maxLateral, JSON.stringify(result)).toBeLessThan(result.hw + .3 + .708);
  expect(result.minUpright, JSON.stringify(result)).toBeGreaterThan(.6);
  expect(Math.abs(result.lateral), JSON.stringify(result)).toBeLessThan(result.hw + .3);
});
