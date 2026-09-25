import { CATALOGUE } from '../src/app/tracks';
import { VEHICLES } from '../src/vehicles/catalogue';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';

test.describe.configure({ timeout: 90_000 });
const out = evidencePath('progression');

test('nothing is locked and remembered choices work through the real menu', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.goto('/'); await page.locator('.home-go').click();
  // No locks anywhere -- every route and every car is open on day one.
  await expect(page.locator('.sm-item')).toHaveCount(CATALOGUE.length);
  await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
  await expect(page.locator('.sm-player[data-player="0"] .sm-car')).toHaveCount(VEHICLES.length);
  await expect(page.locator('.sm-car[aria-disabled="true"]')).toHaveCount(0);
  await page.screenshot({ path: resolve(out, 'garage-all-open.png') });
  await page.locator('.sm-back').click(); await page.locator('.sm-back').click();

  await page.locator('[data-track="shoreline"]').click();
  await page.locator('.sm-go').click();
 
  await page.locator('[data-time="night"]').click();
  await page.locator('[data-slime-density="many"]').click();
  await page.locator('[data-direction="reverse"]').click();
  await page.locator('[data-ai-mode="rush"]').click();
  await page.locator('.sm-go').click();
  await page.locator('.startup-add-player').click();
  await page.locator('.sm-player[data-player="0"] [data-vehicle="sports-car"]').click();
  await page.locator('.sm-player[data-player="1"] [data-vehicle="jeep"]').click();
  await page.locator('.sm-go').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('silicon-rush.save.v1') ?? '{}').lastRace))
    .toMatchObject({ trackId: 'shoreline', direction: 'reverse', playerCount: 2,
      playerVehicles: ['sports-car', 'jeep'], timeOfDay: 'night', slimeDensity: 'many', ai: true,
      aiDifficulty: 'rush' });

  await page.reload(); await page.locator('.home-go').click();
  await expect(page.locator('.sm')).toHaveAttribute('data-players', '2');
  await expect(page.locator('[data-track="shoreline"]')).toHaveClass(/sel/);
  await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
  await expect(page.locator('.sm-player[data-player="0"] [data-vehicle="sports-car"]')).toHaveClass(/sel/);
  await expect(page.locator('.sm-player[data-player="1"] [data-vehicle="jeep"]')).toHaveClass(/sel/);
  await page.screenshot({ path: resolve(out, 'remembered-dual-choice.png') });

  await expect(page.getByRole('button', { name: 'Progress' }), 'the progress dialog is gone').toHaveCount(0);
  writeFileSync(resolve(out, 'facts.json'), JSON.stringify({ lastRace: await page.evaluate(() =>
    JSON.parse(localStorage.getItem('silicon-rush.save.v1') ?? '{}').lastRace) }, null, 2));
});

test('only destructible slime hits earn the in-race achievement toast', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', vehicleId: 'micro-hatch',
    slimeDensity: 'normal', ai: false }));
  await page.locator('[data-screen="intro"] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 15_000 }).toBe('racing');
  const facts = await page.evaluate(() => {
    const game = window.game as any, hit = game.session.slimes.onHit, car = game.session.car;
    for (let i = 0; i < 14; i++) hit(`green-${i}`, [1, 1, 1], car, 'popper');
    hit('black', [1, 1, 1], car, 'slick'); hit('giant', [4, 4, 4], car, 'colossus');
    hit('green-14', [1, 1, 1], car, 'popper');
    return { total: game.save.all.totalSlimeHits, best: game.save.all.bestRunSlimeHits,
      achievements: game.save.all.achievements, raceHits: game.session.race.slimeHits };
  });
  expect(facts).toEqual({ total: 15, best: 15, achievements: ['slime-run-15'], raceHits: 17 });
  await expect(page.locator('.hud-notice')).toContainText('Achievement unlocked');
  await page.screenshot({ path: resolve(out, 'achievement-toast.png') });
  await page.evaluate(() => { const game = window.game as any; game.save.recordFinish(true); game.quit(); });
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('menu');
  expect(await page.evaluate(() => (window.game as any).save.all.achievements)).toEqual(['slime-run-15', 'no-rescue']);
});
