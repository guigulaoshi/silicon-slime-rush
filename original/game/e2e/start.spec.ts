import { evidencePath } from './evidence';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CATALOGUE } from '../src/app/tracks';

/* */
const SHOTS = evidencePath();
/**
 * Screenshots only when asked: `SHOTS=1 npx playwright test e2e/start.spec.ts`.
 *
 * These three files are tracked, and this spec is in `e2e:quick` -- so writing them on every run
 * means every quick check dirties the tree with a few hundred bytes of PNG that belong to nobody's
 * change. They are evidence for a delivery, produced when a delivery wants them.
 */
const writeShots = !!process.env.SHOTS;
const shot = async (page: Page, name: string): Promise<void> => {
  if (!writeShots) return;
  writeFileSync(resolve(SHOTS, name), await page.screenshot());
};

/**
 * One minute, not the repository's ten.
 *
 * `playwright.config.ts` sets a ten-minute ceiling because the driving specs really do drive whole
 * laps. A menu test inherits that and then *spends* it on any failure -- which is exactly what
 * happened: a click that could never land retried for ten minutes and reported one line. A test
 * that cannot pass in a minute here is broken, and it should say so in a minute.
 */
test.describe.configure({ timeout: 60_000 });

/**
 * Wait until the step that should be on screen actually is.
 *
 * The four-pane strip slides for 420 ms. Screenshotting straight after a click photographs the
 * previous step halfway out of frame -- which is what the first run of this file recorded, and it
 * reads as a bug in the screen rather than a race in the test. Asking where the pane *is* beats
 * timing the animation: it is the same question a person would ask looking at it.
 */
async function settled(page: Page, step: number): Promise<void> {
  await page.waitForFunction((i) => {
    const panes = document.querySelectorAll('.sm-pane');
    const pane = panes[i] as HTMLElement | undefined;
    const first = document.querySelector('.sm-viewport') as HTMLElement | undefined;
    if (!pane || !first) return false;
    // Against the first pane, not against the panel: the panel has a 1px left border, so the two
    // differ by exactly one pixel at rest and a `< 1` tolerance passes only by sub-pixel luck.
    return Math.abs(pane.getBoundingClientRect().left - first.getBoundingClientRect().left) < 1;
  }, step, { timeout: 5_000 });
}

test('the Bay map loads and a pick reaches the game', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    language: 'en', muted: true, best: {},
  })));
  await page.goto('/'); await page.locator('.home-go').click();
  // Adds the player's requested story opening before the existing map flow.
  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 20_000 })
    .toBe('menu');

  // The lap first: that drawing is the screen's answer to 「你都不知道选地图是为什么」.
  await expect.poll(() => page.locator('.sm-road').count(), { timeout: 10_000 }).toBe(1);
  expect(await page.locator('.sm-line').count()).toBe(1);
  expect(await page.locator('.sm-flag').count()).toBe(1);
  // Then the locator: the real Bay from the file the pipeline wrote, water filled, islands on top,
  // shoreline over both, small and round.
  // Every catalogue route is inside the frame (fitting it to the panel trims only the region's far
  // north and south edges, clear of every route), so two routes could go missing behind a floor.
  // Selection only highlights the matching locator line; it does not remove it from the map.
  await expect.poll(() => page.locator('.sm-route').count(), { timeout: 10_000 }).toBe(CATALOGUE.length);
  expect(await page.locator('.sm-water').count()).toBeGreaterThan(0);
  expect(await page.locator('.sm-land').count()).toBeGreaterThan(10);
  expect(await page.locator('.sm-coast').count()).toBeGreaterThan(0);
  // And the magnifier that ties the two together. This is
  // the only assertion the callout has: it is built entirely on live layout measurement, so nothing
  // in vitest can see it, and the screenshot beside it is overwritten on every run rather than
  // compared -- delete the drawing code and everything else here stays green.
  expect(await page.locator('.sm-lens').count()).toBe(1);
  expect(await page.locator('.sm-leader').count()).toBe(2);
  expect(await page.locator('.sm-context').count()).toBeGreaterThan(0);
  await shot(page, 'start-01-route.png');
  if (writeShots) {
    await page.setViewportSize({ width: 932, height: 430 });
    await page.waitForFunction(() => {
      const svg = document.querySelector('.sm-circuit');
      const width = Number(svg?.getAttribute('viewBox')?.split(' ')[2]);
      return svg && Math.abs(width - svg.clientWidth) < 2;
    }, null, { timeout: 5_000 });
    const phoneCircuit = await page.locator('.sm-circuit').boundingBox();
    expect(phoneCircuit?.width).toBeGreaterThan(70);
    expect(phoneCircuit?.height).toBeGreaterThan(70);
    await shot(page, 'start-01-route-phone-landscape.png');
    await page.setViewportSize({ width: 1440, height: 810 });
  }
  // The list, not the line. An SVG path's bounding-box centre is almost never on its own stroke,
  // so `.click()` on a curved route retries until the timeout and never lands; the unit tests
  // dispatch the click directly and cover that path. Here the point is the data, not the hit test.
  await page.locator('.sm-item').nth(4).click();   // the fifth row; the list is in the map's order
  await expect(page.locator('.sm-route.sel')).toHaveCount(1);
  await page.locator('.sm-go').click();
  await settled(page, 1);
  await shot(page, 'start-02-world.png');
  await page.setViewportSize({ width: 932, height: 430 });
  await page.locator('[data-time="night"]').click();
 
  await page.locator('[data-weather="rain"]').click();
  await expect(page.locator('.sm-world-preview')).toHaveAttribute('data-world-time', 'night');
  await expect(page.locator('.sm-world-preview')).toHaveAttribute('data-world-weather', 'rain');
  const slimeChoices = page.locator('[data-slime-density]');
  await expect(slimeChoices).toHaveCount(3);
  await expect(slimeChoices).toHaveText(['None', 'Normal', 'Many']);
  for (const choice of await slimeChoices.all()) {
    await expect(choice).toBeVisible();
    expect((await choice.boundingBox())?.height).toBeGreaterThan(30);
  }
  await shot(page, 'start-02-world-phone-landscape.png');
  await page.locator('[data-slime-density="none"]').click();
  await page.locator('[data-weather="clear"]').click();
  await page.setViewportSize({ width: 1440, height: 810 });
  if (writeShots) {
    await page.locator('.player-tools button').first().click();
    await shot(page, 'start-02-world-zh.png');
    await page.locator('.player-tools button').first().click();
  }
  await page.locator('.sm-go').click();
  await settled(page, 2);
  if (writeShots) {
    await page.locator('.startup-add-player').click();
    await shot(page, 'start-03-garage-split.png');
    await page.locator('.startup-remove-player').click();
  }
  await page.locator('[data-vehicle="jeep"]').click();
  await shot(page, 'start-03-garage.png');
  await page.locator('.sm-go').click();

  // The choice reached the game. Stopping here on purpose: whether a track then streams in is
  // `drive.spec.ts`'s question, and answering it again costs ninety seconds a run.
  await expect.poll(() => page.evaluate(() => window.game.report().choice), { timeout: 10_000 })
    // `ai: true` is the new player's default since 435.
    // This run never touches the AI switch, so what it asserts is that default arriving intact.
    .toEqual({ vehicleId: 'jeep', timeOfDay: 'night', weather: 'clear', slimeDensity: 'none', ai: true, aiDifficulty: 'relaxed',
      direction: 'forward', car: undefined, playerVehicles: undefined });
  expect(await page.evaluate(() => JSON.parse(
    localStorage.getItem('silicon-rush.save.v1') ?? 'null')?.slimeDensity)).toBe('none');
});
