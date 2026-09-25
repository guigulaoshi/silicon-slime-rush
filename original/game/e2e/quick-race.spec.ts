import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

/** The home page starts a race in one press, with the last race's settings or, on a first visit, the defaults. */
const OUT = evidencePath('quick-race');
test.describe.configure({ timeout: 180_000 });

test('a first visit: one press from home into the first route', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const quick = page.locator('.home-quick');
  await expect(quick).toBeVisible();
  await expect(quick).toContainText('Golden Gate Bridge');
  //A first visit's one press drives the Sedan, not the Golden Gate's own default car.
  await expect(quick).toContainText('Sedan');
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(OUT, 'home-first-visit.png') });
  await quick.click();
  await page.waitForFunction(() => ['intro', 'countdown', 'racing'].includes(window.game.report().phase), null, { timeout: 90_000 });
  const report = await page.evaluate(() => ({ track: window.game.report().track, vehicle: window.game.report().vehicle, time: (window.game as any).session.world.sky.timeOfDay }));
  // A first visit drives in daylight, even on a route authored at night like the Golden Gate.
  expect(report).toMatchObject({ track: 'goldengate', vehicle: 'micro-hatch', time: 'day' });
});

test('a returning player: one press repeats the last race', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 1, language: 'en', volume: 0, muted: true, best: {},
    lastRace: { trackId: 'lombard', direction: 'reverse', playerCount: 1, playerVehicles: ['micro-hatch'], timeOfDay: 'night',
      weather: 'rain', slimeDensity: 'none', ai: false, aiDifficulty: 'relaxed' } })));
  await page.goto('/');
  const quick = page.locator('.home-quick');
  await expect(quick).toContainText('Lombard');
  await quick.click();
  await page.waitForFunction(() => ['intro', 'countdown', 'racing'].includes(window.game.report().phase), null, { timeout: 90_000 });
  const report = await page.evaluate(() => { const r = window.game.report() as any; return { track: r.track, direction: r.direction, weather: r.sky?.weather, time: r.timeOfDay }; });
  expect(report).toMatchObject({ track: 'lombard', direction: 'reverse', weather: 'rain' });
});
