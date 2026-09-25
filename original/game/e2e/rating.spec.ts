import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('real finish wiring gives independent stars, persists them and renders phone results', async ({page}) => {
  const out = evidencePath('rating');
  mkdirSync(out, {recursive: true});
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  await page.evaluate(async () => {
    await window.game.startRace({trackId: 'synth-loop', car: 'sedan', slimeDensity: 'normal', ai: false,
      playerVehicles: ['micro-hatch', 'city-pod']});
  });
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), {timeout: 15_000}).toBe('racing');
  await page.evaluate(() => {
    // Deliberate finish fixture after real world load, not an end-to-end driving claim.
    const game = window.game as any;
    const distance = game.session.world.spline.length * game.session.humans[0].race.totalLaps;
    const [a, b] = game.session.humans;
    a.race.time = distance / 9; a.race.score = 0; a.race.maxCombo = 0;
    // Far ahead of any car's AI yardstick:
    // this fixture is about the wiring, not about where the five-star line sits.
    b.race.time = distance / 60; b.race.score = distance * 6.5; b.race.maxCombo = 7; b.race.slimeHits = 7;
    game.finish(a.race.time);
  });
  const result = await page.evaluate(() => (window.game as any).lastResult);
  expect(result.players.map((p: any) => p.rating)).toEqual([1, 5]);
  await expect(page.locator('.result-player .result-rating-meta')).toHaveText([
    'Best ★☆☆☆☆ · Max combo 0 · Clean corners 0', 'Best ★★★★★ · Max combo 7 · Clean corners 0',
  ]);
  await page.screenshot({path: resolve(out, 'dual-en.png')});
  await page.setViewportSize({width: 844, height: 390});
  await page.evaluate(() => { const game = window.game as any; game.i18n.set('zh'); game.views.results.render(); });
  await expect(page.locator('.result-player .result-rating-meta').last()).toContainText('最高连击 7');
  for (const card of await page.locator('.result-player').all()) {
    const box = await card.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(390);
    for (const content of await card.locator('.card-stats, .result-rating-meta').all()) {
      const inner = await content.boundingBox();
      expect(inner!.y + inner!.height).toBeLessThanOrEqual(box!.y + box!.height);
    }
  }
  await page.screenshot({path: resolve(out, 'dual-phone-zh.png')});
  writeFileSync(resolve(out, 'result-fixture.json'), JSON.stringify({fixture: true, result}, null, 2));
  await page.reload(); await page.waitForFunction(() => window.game);
  // Each car keeps its own best stars.
  expect(await page.evaluate(() => (window.game as any).save.all.ratings)).toEqual({'synth-loop@micro-hatch': 1, 'synth-loop@city-pod': 5});
});
