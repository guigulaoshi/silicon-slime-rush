import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';
import { driveBudgetGameSeconds } from './driveBudget';

const OUT = evidencePath('slime-distribution');
test.skip(process.env.SLIME_DISTRIBUTION_QA !== '1', 'density comparison and continuous drive evidence');
test.describe.configure({ timeout: 240_000 });
test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } } });

for (const density of ['none', 'normal', 'many'] as const) test(`211 ${density} road and scenery`, async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 5, language: 'en', quality: 'high', muted: true, slimeDensity: value,
  })), density);
  // Retargeted from shoreline (deleted, "an open flat campus route") to lhasa: a general density
  // comparison across a full drive, any flat day track works.
  await page.goto('/?track=lhasa&bot=1&dev=1&speed=3&time=day');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await page.evaluate(() => (window.game as any).show('paused'));
  await page.waitForFunction(() => window.game.report().tiles?.loading === 0);
  await expectWorldLoaded(page, `${density} distribution`);
  const population = await page.evaluate(() => {
    const layer = (window.game as any).session.slimes;
    const spawns = layer ? [...layer.tileSpawns.values()].flat() as { scenery?: boolean }[] : [];
    return { road: spawns.filter(s => !s.scenery).length, scenery: spawns.filter(s => s.scenery).length,
      rendered: layer?.mesh.count ?? 0 };
  });
  if (density === 'none') expect(population).toEqual({ road: 0, scenery: 0, rendered: 0 });
  else {
    expect(population.road).toBeGreaterThan(5);
    expect(population.scenery).toBeGreaterThan(5);
    expect(population.rendered).toBe(population.road + population.scenery);
  }
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, `${density}-start.png`) });
  await page.evaluate(() => (window.game as any).show('racing'));
  let report = await page.evaluate(() => window.game.report());
  const budget = driveBudgetGameSeconds(report.length, report.laps);
  test.setTimeout(Math.max(240_000, budget / 3 * 1000 + 60_000));
  const samples: typeof report[] = [];
  const pictures = new Set<number>();
  while (report.state !== 'finished' && report.time < budget) {
    await page.waitForTimeout(1000);
    report = await page.evaluate(() => window.game.report());
    samples.push(report);
    // Re-derived for lhasa's 2,047.7 m length (game/public/tracks/lhasa/track.json spline.length):
    // roughly the same 25%/55%/85%-of-route spacing as the original three shots.
    for (const distance of [500, 1100, 1700]) {
      if (report.progress >= distance && !pictures.has(distance)) {
        pictures.add(distance);
        await page.screenshot({ path: resolve(OUT, `${density}-${distance}m.png`) });
      }
    }
  }
  expect(report.state).toBe('finished');
  expect(report.resets).toBe(0);
  await expectWorldLoaded(page, `${density} finish`);
  writeFileSync(resolve(OUT, `${density}.json`), JSON.stringify({ density, population, report, samples }, null, 2));
  await page.screenshot({ path: resolve(OUT, `${density}-finish.png`) });
  const video = page.video();
  await page.close();
  await video?.saveAs(resolve(OUT, `${density}-drive.webm`));
});
