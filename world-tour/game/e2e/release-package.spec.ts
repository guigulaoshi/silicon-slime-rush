import { expect, test } from '@playwright/test';
import { servePackage, stagedByThisRelease } from './packageServer';
import { CATALOGUE } from '../src/app/tracks';

/**
 * The thing that gets uploaded is the thing that was tested.
 *
 * `tools/release_package.py` stages the upload out of a release build, drops the synthetic test routes
 * and then runs this test: that package, not another build, is what is served here. Without a package
 * there is nothing to check, so the test skips -- which is why packaging runs it rather than leaving it
 * to a suite that has no package staged.
 */
test.describe.configure({ timeout: 300_000 });

test('the upload package boots, carries the public address and drives', async ({ page }) => {
  test.skip(!stagedByThisRelease(), 'not a release packaging run: python3 tools/release_package.py');
  const server = await servePackage();
  try {
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().replace(server.base, '')}`); });
    await page.goto(`${server.base}/`);
    await page.waitForFunction(() => window.game, null, { timeout: 120_000 });
    await expect(page.locator('.home-go')).toBeVisible({ timeout: 120_000 });
    // Styled, not just present: an obfuscation pass shipped a build with no stylesheet at
    // all, and every button was still "visible". game.css paints the page this colour; nothing else does.
    // The page behind the game is the theme's own opaque night colour (a remix re-themes it, so no fixed
    // value): an itch embed must never show a white or transparent page round the canvas.
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const channels = (background.match(/[\d.]+/g) ?? []).map(Number);
    const [r, g, b, a = 1] = background.startsWith('color(') ? channels.map((v, i) => i < 3 ? v * 255 : v) : channels;
    expect(a, background).toBe(1);
    expect(0.2126 * r! + 0.7152 * g! + 0.0722 * b!, background).toBeLessThan(60);
    expect(await page.evaluate(() => window.game.report().phase)).toBe('menu');
    // The release build knows its own address: the share meta and the creator cards point at the real page.
    expect(await page.evaluate(() => document.querySelector('meta[property="og:url"]')?.getAttribute('content')))
      .toBe('https://guigulaoshi.itch.io/silicon-slime-rush-world-tour');
    // Retargeted from shoreline (deleted, "an open flat campus route") to lhasa: a generic real
    // route check, any flat day track works.
    expect(await page.evaluate(() => window.game.startRace({ trackId: 'lhasa',
      playerVehicles: ['micro-hatch'], slimeDensity: 'normal', ai: false }, true))).toBe(true);
    await page.waitForFunction(() => ['intro', 'countdown', 'racing'].includes(window.game.report().phase), null, { timeout: 180_000 });
    await page.evaluate(() => { (window.game as any).autopilot = true; (window.game as any).beginCountdown?.(); });
    await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 60_000 });
    await page.waitForFunction(() => (window.game.report().tiles?.loaded ?? 0) > 2, null, { timeout: 60_000 });
    // Each pack is read whole, once, with no Range header: itch.io answers ranges with the whole file
    // uncompressed and the browser cache answers them with a 206 of its own.
    expect(server.ranges(), 'no tile was asked for as a byte range').toBe(0);
    expect(server.packs(), 'the home route and the raced route, one download each').toBeLessThanOrEqual(2);
    await page.screenshot({ path: 'test-results/release-package.png' });
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  } finally {
    await server.close();
  }
});

test('every route and every car loads the way itch.io serves them', async ({ page }) => {
  test.skip(!stagedByThisRelease(), 'not a release packaging run: python3 tools/release_package.py');
  test.setTimeout(900_000);
  // itch.io ignores Range (whole file, uncompressed), gzips everything else and, unlike the Mac this
  // is built on, matches file names case-sensitively -- the server below does all three. When tiles
  // were fetched as ranges a start on goldengate (deleted with the rest of the Bay Area
  // tracks) pulled the pack 101 times and, on the live page, some of those bodies arrived short and
  // the route would not load; a first fix that probed
  // for range support was then fooled by the browser cache.
  // Each option once, per the project's rule: every route with the default car, every car on a
  // short route. Retargeted from the 8 old Bay Area tracks to CATALOGUE (now 15 World Tour tracks) so
  // this list never goes stale again; rio (1,872 m) replaced lombard as the shortest route for the
  // every-car pass, and giza (1,957 m, game/public/tracks/giza/track.json spline.length) replaces rio
  // in turn now that rio is deleted too -- still the shortest of
  // the 13 remaining tracks.
  const runs = [
    ...CATALOGUE.map(t => t.id).map(trackId => ({ trackId, car: 'micro-hatch' })),
    ...['city-pod', 'jeep', 'lightweight-sports', 'sports-car', 'retro-van', 'school-bus',
      'monster-truck', 'pickup-travel-trailer'].map(car => ({ trackId: 'giza', car })),
  ];
  const server = await servePackage(undefined, 'itch');
  const missing: string[] = [];
  page.on('response', r => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url().replace(server.base, '')}`); });
  try {
    for (const run of runs) {
      await page.goto(`${server.base}/`);
      await page.waitForFunction(() => window.game, null, { timeout: 120_000 });
      const before = server.packs();
      expect(await page.evaluate(r => window.game.startRace({ trackId: r.trackId, playerVehicles: [r.car],
        slimeDensity: 'normal', ai: false }), run), `${run.trackId} with ${run.car} started`).toBe(true);
      await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 120_000,
        message: `${run.trackId} with ${run.car} reached the start` }).toMatch(/^(intro|countdown|racing)$/);
      // the home route's pack plus the raced route's pack: never one download per tile
      expect(server.packs() - before, `${run.trackId}: tile packs downloaded`).toBeLessThanOrEqual(2);
    }
    expect(server.ranges(), 'no tile was asked for as a byte range').toBe(0);
    expect(missing, 'files itch.io would not find (wrong case, or missing)').toEqual([]);
  } finally {
    await server.close();
  }
});
