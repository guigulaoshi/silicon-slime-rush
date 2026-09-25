import { expect, test, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { evidencePath } from './evidence';
import { SHOWCASE_SPIN } from '../src/app/showcase';

/** The home page keeps its instant picture, then fades in a live orbit of the Golden Gate. */
const OUT = evidencePath('home-scene');
test.describe.configure({ timeout: 240_000 });
/** The bay left of the home copy, below the header: the part of the page that is only picture. */
const OPEN_PICTURE = { x: 0, y: 90, width: 600, height: 540 };
/** Mean per-channel difference (0-255) under which two shots of that area show the same frame. */
const STILL_MATCH = 6;

async function meanDifference(a: Buffer, b: Buffer): Promise<number> {
  const [left, right] = await Promise.all([a, b].map(image => sharp(image).removeAlpha().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < left!.length; i++) sum += Math.abs(left![i]! - right![i]!);
  return sum / left!.length;
}

test('the scene is ready before the home page, and leaving home ends it', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  // The opening is quick on this machine; hold the tiles back so it is still on screen when looked at.
  // Tiles ship packed as `tiles.bin` beside the directory, so match the track's files, not a folder name.
  // Only the first few need holding: the screen stays up until all of them arrive.
  let held = 0;
  await page.route(/\/tracks\/goldengate\/(tiles|backdrop)/, async route => {
    if (held++ < 4) await new Promise(r => setTimeout(r, 3000));
    await route.continue();
  });
  await page.goto('/');
  // Retired 433's opening order on the player's word (. What is asserted now is the new order:
  // one compact progress shell first, then a home page whose scene is already turning -- never the
  // photograph and never Game's second route-loading screen in between.
  await expect(page.locator('#startup .loading-bar')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => (window.game as any)?.showcaseOpening === true, null, { timeout: 30_000 });
  const startupBar = await page.locator('#startup .loading-bar').boundingBox();
  expect(startupBar!.width, 'the one opening bar uses the compact global width').toBeLessThanOrEqual(420);
  expect(await page.evaluate(() => {
    const bar = document.querySelector('#startup .loading-bar')!.getBoundingClientRect();
    return document.elementFromPoint(bar.x + bar.width / 2, bar.y + bar.height / 2)?.closest('#startup') !== null;
  }), 'the compact startup bar remains the visible loading surface').toBe(true);
  // Nothing lies behind the opening, so it offers no way back -- neither the button nor the key.
  // Found by structure, not by its text (the label is written in `render()`), scoped to the loading screen
  // -- the only `.departure` with a retry button, since the race intro is a `.departure` too -- and read
  // without waiting: the opening finishes in about a second, and a waiting `toBeHidden` passes the moment
  // the whole screen goes away, fixed or not.
  const back = page.locator('.departure:has(.departure-retry) .actions > .cta:not(.departure-go):not(.departure-retry)');
  await expect(back).toHaveCount(1);
  expect(await page.evaluate(() => (window.game as any).showcaseOpening), 'still in the opening').toBe(true);
  expect(await back.isVisible(), 'no Back button on the opening').toBe(false);
  /* */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // The phase, not the opening flag: quitting switches to the menu at once, while the flag is only cleared
  // when the abandoned load comes back -- which, waiting on a held tile, can be seconds later.
  expect(await page.evaluate(() => window.game.report().phase), 'Esc does not abandon the opening').toBe('boot');
  await expect(page.locator('.home-go')).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#startup')).toHaveCount(0);
  await expect(page.locator('.departure-progress')).toBeHidden();
  const paint = await page.evaluate(() => {
    const entry = performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint');
    return { firstContentfulPaint: Math.round(entry?.startTime ?? -1), homeReady: Math.round(performance.now()) };
  });
  // The home page never appears without the scene behind it any more, so there is no moment at which
  // the still picture is what the player is looking at.
  await expect(page.locator('[data-showcase=live]')).toBeAttached();
  expect(await page.evaluate(() => !!(window.game as any).session), 'the scene is already loaded').toBe(true);
  expect(await page.locator('.home-scene').evaluate(node => getComputedStyle(node).opacity)).toBe('0');
  const live = await page.evaluate(() => Math.round(performance.now()));
  await page.waitForTimeout(1200);
  // The still page's own painted scenery steps aside too. Its ridge silhouette sits above
  // the canvas, so left on it read as a giant translucent triangle laid across the bay.
  const painted = await page.evaluate(() => {
    const frame = document.querySelector('.startup-frame')!;
    return ['::before', '::after'].map(part => getComputedStyle(frame, part).opacity);
  });
  expect(painted, 'the frame\'s painted ridge and ring are gone once the scene is live').toEqual(['0', '0']);
  const frames: number[] = [];
  for (const [index, wait] of [0, 4000, 4000].entries()) {
    if (wait) await page.waitForTimeout(wait);
    await page.screenshot({ path: resolve(OUT, `orbit-${index + 1}.png`) });
    frames.push(await page.evaluate(() => (window.game as any).showcase.angle));
  }
  // Along the spin, whichever way it turns: the angle falls when the spin is negative.
  const turned = (from: number, to: number) => (to - from) * Math.sign(SHOWCASE_SPIN);
  expect(turned(frames[0]!, frames[1]!), 'the camera keeps moving').toBeGreaterThan(0);
  expect(turned(frames[1]!, frames[2]!)).toBeGreaterThan(0);
  const facts = await page.evaluate(() => {
    const game = window.game as any, world = game.session.world;
    return { phase: game.phase, track: game.report().track, tiles: world.streamer.stats.loaded,
      drawCalls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles,
      raceTime: game.session.race.time, cameraY: Math.round(world.cameras[0].position.y) };
  });
  expect(facts).toMatchObject({ phase: 'menu', track: 'goldengate', raceTime: 0 });
  writeFileSync(resolve(OUT, 'facts.json'), JSON.stringify({ paint, liveAtMs: live, facts, frames }, null, 2));

  // The frame the player leaves on, held still so the page shown on the way back can be compared with it.
  await page.evaluate(() => { (window.game as any).timeScale = 0; });
  await page.waitForTimeout(300);
  const leftOn = await page.screenshot({ clip: OPEN_PICTURE });
  const leftAngle = await page.evaluate(() => (window.game as any).showcase.angle);

  // Stepping into the route pages drops the scene; the menu is what the player came for.
  await page.locator('.home-go').click();
  await expect(page.locator('[data-showcase]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!(window.game as any).session)).toBe(false);
  await expect(page.locator('.sm-item').first()).toBeVisible();

  /* */
  for (const round of [1, 2]) {
    await page.locator('.sm-back').click();
    await expect(page.locator('.home-go')).toBeVisible();
    if (round === 1) {
      // While the scene reloads, the page shows the frame it was
      // left on, not the shipped picture -- a render from long before today's bay -- and the orbit then
      // resumes from that same angle.
      await expect(page.locator('[data-showcase=still]')).toBeAttached();
      await page.locator('.sm').evaluate(node => Promise.all(node.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined))));
      expect(await page.locator('.home-scene').evaluate(node => getComputedStyle(node).opacity), 'the shipped picture stays out of sight').toBe('0');
      const cameBack = await page.screenshot({ clip: OPEN_PICTURE });
      const difference = await meanDifference(leftOn, cameBack);
      writeFileSync(resolve(OUT, 'still-on-return.json'), JSON.stringify({ difference }, null, 2));
      await page.screenshot({ path: resolve(OUT, 'still-on-return.png') });
      expect(difference, 'the page on the way back is the frame the player left').toBeLessThan(STILL_MATCH);
      await page.evaluate(() => { (window.game as any).timeScale = 1; });
    }
    await expect(page.locator('[data-showcase=live]'), `round ${round}: the orbit is back`).toBeAttached({ timeout: 60_000 });
    const before = await page.evaluate(() => (window.game as any).showcase.angle);
    if (round === 1) {
      expect(turned(leftAngle, before), 'the orbit resumes where it was left').toBeGreaterThanOrEqual(0);
      expect(turned(leftAngle, before)).toBeLessThan(.1);
    }
    await page.waitForTimeout(1500);
    expect(turned(before, await page.evaluate(() => (window.game as any).showcase.angle)), `round ${round}: and turning`).toBeGreaterThan(0);
    if (round === 1) await page.screenshot({ path: resolve(OUT, 'orbit-after-back.png') });
    await page.locator('.home-go').click();
    await expect(page.locator('[data-showcase]')).toHaveCount(0);
    await expect(page.locator('.sm-item').first()).toBeVisible();
  }
  // The same through settings, which leaves the menu phase altogether.
  await page.locator('.sm-back').click();
  await expect(page.locator('[data-showcase=live]')).toBeAttached({ timeout: 60_000 });
  await page.evaluate(() => { (window.game as any).show('settings'); });
  await expect(page.locator('[data-showcase]')).toHaveCount(0);
  await page.evaluate(() => { (window.game as any).show('menu'); });
  await expect(page.locator('.home-go')).toBeVisible();
  await expect(page.locator('[data-showcase=live]'), 'back from settings: the orbit is back').toBeAttached({ timeout: 60_000 });
});

test('reduced motion keeps the still picture', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 1, language: 'en', volume: 0, muted: true, best: {}, reducedMotion: true })));
  await page.goto('/');
  await expect(page.locator('.home-go')).toBeVisible();
  // The same measurement as the live test: reduced motion is the page exactly as it was before 433.
  const paint = await page.evaluate(() => {
    const entry = performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint');
    return { firstContentfulPaint: Math.round(entry?.startTime ?? -1), homeReady: Math.round(performance.now()) };
  });
  writeFileSync(resolve(OUT, 'still-paint.json'), JSON.stringify(paint, null, 2));
  await page.waitForTimeout(6000);
  expect(await page.evaluate(() => !!(window.game as any).session), 'no scene is loaded').toBe(false);
  await expect(page.locator('[data-showcase]')).toHaveCount(0);
  // And keeps the painted ridge it was designed with: with no scene behind it, it is the scenery.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.startup-frame')!, '::before').opacity)).toBe('1');
});

test('a phone keeps the still picture', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await expect(page.locator('.home-go')).toBeVisible();
    await page.waitForTimeout(6000);
    expect(await page.evaluate(() => !!(window.game as any).session), 'no scene is loaded').toBe(false);
    await expect(page.locator('[data-showcase]')).toHaveCount(0);
  } finally { await page.close(); await context.close(); }
});

test('a race asked for while the opening loads owns the screen, and settings frees the world', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  // The load in flight is now the opening one, in front of the home page. Asking for a
  // race in the middle of it must take the screen -- and keep it when the abandoned load returns.
  await page.waitForFunction(() => (window.game as any)?.showcaseLoading === true, null, { timeout: 30_000 });
  await page.evaluate(() => { void window.game.startRace({ trackId: 'synth-loop', car: 'sedan', slimeDensity: 'none' }, true); });
  // Kept this one: a race's loading screen has somewhere to go back to. Read while that screen
  // is up -- synth-loop loads quickly, and a check that waits can arrive after it has gone.
  await page.waitForFunction(() => window.game.report().phase === 'boot', null, { timeout: 30_000, polling: 'raf' });
  const raceProgress = await page.locator('.departure-progress').boundingBox();
  expect(raceProgress!.width, 'race loads use the same compact global width').toBeLessThanOrEqual(420);
  // The rest at 100% lasts ~0.2 s (LOADING_COMPLETE_HOLD_MS), shorter than an assertion's polling step, so the
  // phase and the Back button are read inside the page in the very frame the bar first reports 100%.
  const atFull = await (await page.waitForFunction(() => {
    const bar = document.querySelector('.departure [role=progressbar]');
    if (bar?.getAttribute('aria-valuenow') !== '100') return null;
    const back = document.querySelector('.departure:has(.departure-retry) .actions > .cta:not(.departure-go):not(.departure-retry)') as HTMLElement | null;
    return { phase: window.game.report().phase, back: !!back && !back.hidden && back.offsetParent !== null };
  }, null, { timeout: 30_000, polling: 'raf' })).jsonValue();
  expect(atFull?.phase, '100% rests before the next screen').toBe('boot');
  expect(atFull?.back, 'Back stays on a race\'s loading screen').toBe(true);
  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 30_000 }).not.toBe('menu');
  await page.waitForFunction(() => ['intro', 'countdown', 'racing'].includes(window.game.report().phase), null, { timeout: 120_000 });
  expect(await page.evaluate(() => window.game.report().track)).toBe('synth-loop');
  expect(await page.evaluate(() => (window.game as any).showcaseLoading)).toBe(false);
  expect(await page.evaluate(() => (window.game as any).showcase)).toBeNull();

  // Back at the home page the scene returns; settings then frees its world.
  await page.goto('/');
  await expect(page.locator('.home-go')).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('[data-showcase=live]')).toBeAttached({ timeout: 120_000 });
  await page.locator('.home-footer button').first().click();
  await expect(page.locator('input[data-setting=name]')).toBeVisible();
  expect(await page.evaluate(() => !!(window.game as any).session), 'the showcase world is freed').toBe(false);
  await expect(page.locator('[data-showcase]')).toHaveCount(0);
});
