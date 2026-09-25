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
  // Retargeted from goldengate (deleted, "the default/showcase track"): beijing is CATALOGUE[0]
  // (game/src/app/tracks.ts: "Beijing leads because it is the default track (remix brief)"), so it is
  // what `pick = 0` resolves to on a true first visit. track.beijing.name = "Tiananmen Square".
  await expect(quick).toContainText('Tiananmen');
  //The quick button's car slot starts at a fixed index (carAt = 0 -> micro-hatch),
  // not the route's own local default car (`defaultVehicle`) -- for beijing (legacy car "sedan") the
  // two happen to coincide (both resolve to micro-hatch/"Sedan"), unlike goldengate before it.
  await expect(quick).toContainText('Sedan');
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(OUT, 'home-first-visit.png') });
  await quick.click();
  await page.waitForFunction(() => ['intro', 'countdown', 'racing'].includes(window.game.report().phase), null, { timeout: 90_000 });
  const report = await page.evaluate(() => ({ track: window.game.report().track, vehicle: window.game.report().vehicle, time: (window.game as any).session.world.sky.timeOfDay }));
  // A first visit drives in daylight. beijing is itself authored for day
  // (game/public/tracks/beijing/track.json timeOfDay), so this no longer exercises a night-to-day
  // override the way goldengate (authored at night) did -- but the observed behaviour is still correct.
  // RETARGET-MEASURE: is there a CATALOGUE track authored at night that could become CATALOGUE[0] in a
  // future remix, to restore an actual override case for this test?
  expect(report).toMatchObject({ track: 'beijing', vehicle: 'micro-hatch', time: 'day' });
});

test('a returning player: one press repeats the last race', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  // Retargeted from lombard (deleted, "steep switchbacks/hairpins") to rio
  // and now to zhangjiajie, the remaining switchback/hairpin mountain road (track.zhangjiajie.name =
  // "Zhangjiajie Pillars").
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ version: 1, language: 'en', volume: 0, muted: true, best: {},
    lastRace: { trackId: 'zhangjiajie', direction: 'reverse', playerCount: 1, playerVehicles: ['micro-hatch'], timeOfDay: 'night',
      weather: 'rain', slimeDensity: 'none', ai: false, aiDifficulty: 'relaxed' } })));
  await page.goto('/');
  const quick = page.locator('.home-quick');
  await expect(quick).toContainText('Zhangjiajie');
  await quick.click();
  await page.waitForFunction(() => ['intro', 'countdown', 'racing'].includes(window.game.report().phase), null, { timeout: 90_000 });
  const report = await page.evaluate(() => { const r = window.game.report() as any; return { track: r.track, direction: r.direction, weather: r.sky?.weather, time: r.timeOfDay }; });
  expect(report).toMatchObject({ track: 'zhangjiajie', direction: 'reverse', weather: 'rain' });
});
