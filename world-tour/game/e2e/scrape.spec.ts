import { expect, test } from '@playwright/test';
import type { GameReport } from '../src/app/Game';

/**
 * Drive straight down a curving corridor and let the outer rail catch the car.
 *
 * This is the whole point of the change. Before it, touching a rail threw the car across the road
 * and set it spinning; the fix is only real if the car keeps going, keeps roughly pointing where
 * the driver pointed it, and pays for the rub in speed alone.
 *
 * The synthetic loop is the honest place to measure it: a flat ellipse, a continuous rail on both
 * sides, no junctions and no gaps. Holding the throttle with the wheel centred means the car runs
 * wide and stays leaning on the outer rail for as long as we care to watch -- and because no
 * steering is applied while sampling, every degree the car turns is the wall's doing.
 */

// 这个文件真的要开车，所以自己申请预算：默认档是 90 秒（playwright.config.ts），
// 那是「问浏览器一个问题」的价钱。加载合成赛道并开起来。
test.describe.configure({ timeout: 180_000 });
test('the car slides along the rail instead of being turned by it', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Keep the original high-power rub scenario explicit after legacy sedan became the micro car.
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  // This isolates rail contact: enlarged elastic slimes are a different collision surface.
  await page.evaluate(() => window.game.startRace({trackId: 'synth-loop', car: 'sedan',
    playerVehicles: ['sports-car'], slimeDensity: 'none'}));
  // The intro, not just a loaded track: the loading screen rests at 100% first, Back focused.
  await page.waitForFunction(() => window.game?.report().phase === 'intro', null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.game.report().vehicle)).toBe('sports-car');
  await page.keyboard.press('Enter');   // the intro waits for a driver, and this test is the driver
  await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 60_000 });
  await page.evaluate(() => window.game.audio.unlock());
  const collisionBefore = await page.evaluate(() => window.game.report().collisionFeedback);

  // Throttle only. The corridor turns; the car does not; the outer rail is where it ends up.
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.game.report().scraping, null,
    { timeout: 60_000, polling: 30 });

  const samples: (GameReport & { at: number; metalScrape: number })[] = [];
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(80);
    samples.push({ ...(await page.evaluate(() => window.game.report())), at: Date.now(),
      metalScrape: await page.evaluate(() => window.game.audio.metalScrapeAmount) });
  }
  await page.keyboard.up('ArrowUp');

  const turnBetween = (a: GameReport, b: GameReport) => Math.abs(Math.atan2(
    a.headingX * b.headingZ - a.headingZ * b.headingX,
    a.headingX * b.headingX + a.headingZ * b.headingZ,
  )) * 180 / Math.PI;

  // Rates, not per-sample amounts: under load the sampling interval stretches, and an interval
  // twice as long is not the wall turning the car twice as hard.
  const rates: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const secs = (b.at - a.at) / 1000;
    if (a.scraping && b.scraping && secs > 0) rates.push(turnBetween(a, b) / secs);
  }
  const rubbed = samples.filter((s) => s.scraping).length;
  const slowest = Math.min(...samples.map((s) => s.speedKmh));
  const worst = rates.length ? Math.max(...rates) : 0;

  console.log(`against the rail for ${rubbed}/${samples.length} samples, worst turn ${worst.toFixed(0)}°/s; `
    + `${samples[0]!.speedKmh.toFixed(0)} -> ${samples[samples.length - 1]!.speedKmh.toFixed(0)} km/h `
    + `(slowest ${slowest.toFixed(0)}), ${samples[samples.length - 1]!.resets} resets`);

  // The rail is sticky, not bouncy: the car should still be leaning on it thirty samples later.
  expect(rubbed, 'the car should stay against the rail rather than bounce off it').toBeGreaterThan(25);
  // Following this corridor at this speed is about 26 degrees a second on its own; a wall that
  // grabs the car and spins it is an order of magnitude more than that.
  expect(worst, 'the wall must not spin the car').toBeLessThan(60);
  expect(slowest, 'and must not stop it dead: it is a rub, not a wall to hit').toBeGreaterThan(15);
  expect(samples[samples.length - 1]!.resets, 'and must not throw it off the road').toBe(0);
  // Rubbing is not free either. Flat out and clear of the rail this car passes 170 km/h; leaning
  // on it, the drag holds it well under that however long the throttle is held.
  expect(Math.max(...samples.map((s) => s.speedKmh)), 'and rubbing costs speed').toBeLessThan(150);
  expect(Math.max(...samples.filter((s) => s.scraping).map((s) => s.metalScrape)),
    'visible sparks and the continuous metal voice must share the same rail contact')
    .toBeGreaterThan(0.2);
  const collisionAfter = samples[samples.length - 1]!.collisionFeedback;
  expect(collisionAfter.barrierImpacts).toBeGreaterThan(collisionBefore.barrierImpacts);
  expect(collisionAfter.sparkBursts).toBeGreaterThan(collisionBefore.sparkBursts);
  expect(collisionAfter.impactSounds).toBeGreaterThan(collisionBefore.impactSounds);
  expect(errors, errors.join('\n')).toHaveLength(0);
});
