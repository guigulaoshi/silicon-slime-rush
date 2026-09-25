import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';

test('a shipped clean corner awards the live HUD and the finish reveals stars', async ({ page }) => {
  const out = evidencePath('scoring-stars');
  mkdirSync(out, { recursive: true });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  await page.evaluate(async () => {
    await window.game.startRace({ trackId: 'synth-p2p', car: 'sedan', vehicleId: 'micro-hatch',
      slimeDensity: 'none', ai: false });
  });
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 15_000 }).toBe('racing');
  await page.evaluate(() => { const game = window.game as any; game.autopilot = true; game.timeScale = 8; });
  await expect.poll(() => page.evaluate(() => (window.game as any).session.race.cleanCorners),
    { timeout: 60_000 }).toBeGreaterThan(0);
  const live = await page.evaluate(() => {
    const race = (window.game as any).session.race;
    return { score: race.score, hits: race.slimeHits, cleanCorners: race.cleanCorners,
      awards: race.scoreAwards };
  });
  expect(live).toMatchObject({ hits: 0, cleanCorners: 1 });
  expect(live.awards.at(-1)).toMatchObject({ points: 300, source: 'clean-corner' });
  await expect(page.locator('.hud-notice')).toContainText('Clean corner');
  await expect(page.locator('.hud-hits')).toContainText('0');
  await page.screenshot({ path: resolve(out, 'clean-corner-hud.png') });

  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 90_000 }).toBe('results');
  const result = await page.evaluate(() => (window.game as any).lastResult);
  expect(result.cleanCorners).toBeGreaterThan(0);
  expect(result.rating).toBeGreaterThanOrEqual(1);
  expect(result.rating).toBeLessThanOrEqual(5);
  await expect(page.locator('.result-stars .earned')).toHaveCount(result.rating);
  await expect(page.locator('.result-stars .empty')).toHaveCount(5 - result.rating);
  await expect(page.locator('.result-rating-meta')).toContainText('Clean corners');
  await page.screenshot({ path: resolve(out, 'star-results.png') });
  writeFileSync(resolve(out, 'facts.json'), JSON.stringify({ live, result }, null, 2));
});
