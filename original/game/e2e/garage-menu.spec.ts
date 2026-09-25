import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectWorldLoaded } from './world';
import { CATALOGUE } from '../src/app/tracks';
import { VEHICLES } from '../src/vehicles/catalogue';

// A menu journey loads one real world and reaches the start, but never drives a full race.
test.describe.configure({ timeout: 60_000 });

const shots = evidencePath('menu');
async function step(page: Page, index: number) {
  await expect(page.locator('.sm')).toHaveAttribute('data-step', String(index));
  await page.waitForFunction(i => {
    const pane = document.querySelectorAll('.sm-pane')[i]!;
    const view = document.querySelector('.sm-viewport')!;
    return Math.abs(pane.getBoundingClientRect().left - view.getBoundingClientRect().left) < 1;
  }, index, { timeout: 5_000 });
}

for (const viewport of [{ width: 1440, height: 810 }, { width: 390, height: 844 }, { width: 932, height: 430 }]) {
  test(`three centered pages work at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/'); await page.locator('.home-go').click();
    await expect(page.locator('.sm-go')).toBeEnabled();
    await expect(page.locator('.sm-route')).toHaveCount(CATALOGUE.length);
    const map = await page.locator('.sm-locbox').boundingBox();
    const route = await page.locator('.sm-circuitbox').boundingBox();
    expect(route!.width).toBeLessThan(map!.width);
    expect(route!.height).toBeLessThan(map!.height);
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: resolve(shots, `${viewport.width}-route.png`) });
    await page.locator('.sm-go').click(); await step(page, 1);
    await expect(page.locator('.sm-locbox')).toBeHidden();
   
    await page.locator('[data-time="night"]').click();
    await page.locator('[data-slime-density="none"]').click();
    await step(page, 1);
    const condition = await page.locator('[data-time="day"]').boundingBox();
    expect(condition!.x).toBeGreaterThan(0);
    for (const control of await page.locator('.sm-seg button:visible, .sm-go:visible').all()) {
      const bounds = await control.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    }
    await page.screenshot({ path: resolve(shots, `${viewport.width}-conditions.png`) });
    await page.locator('.sm-go').click(); await step(page, 2);
    await expect(page.locator('.sm-car')).toHaveCount(VEHICLES.length);
    await page.locator('[data-vehicle="pickup-travel-trailer"]').click();
    await expect(page.locator('.sm-carhero')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.sm-carhero')).toHaveAttribute('data-bodies', 'pickup-travel-trailer,travel-trailer');
    await expect(page.locator('.sm-carhero canvas')).toBeVisible();
    const hero = await page.locator('.sm-carhero').boundingBox();
    const frame = await page.locator('.sm-viewport').boundingBox();
    expect(hero!.y).toBeGreaterThanOrEqual(frame!.y);
    expect(hero!.y + hero!.height).toBeLessThanOrEqual(frame!.y + frame!.height);
    await page.screenshot({ path: resolve(shots, `${viewport.width}-car.png`) });
    await page.locator('.sm-back').click(); await step(page, 1);
    await page.locator('.sm-go').click(); await step(page, 2);
    await expect(page.locator('.sm-car.sel')).toHaveAttribute('data-vehicle', 'pickup-travel-trailer');
    await expect(page.locator('[data-time="night"]')).toHaveClass(/on/);
    await page.locator('.sm-go').click();
    await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
    expect(await page.evaluate(() => window.game.report().vehicle)).toBe('pickup-travel-trailer');
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    await expectWorldLoaded(page, 'menu-selected trailer');
    expect(await page.evaluate(() => ({ night: window.game.session.world.headlights.on,
      slimes: window.game.report().slimes, trailer: !!window.game.session.trailer })))
      .toEqual({ night: true, slimes: null, trailer: true });
  });
}

test('menu remembers different cars per route after reload and migrates invalid ids', async ({ page }) => {
  await page.goto('/'); await page.locator('.home-go').click();
  await page.evaluate(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 3,
    language: 'zh', timeOfDay: 'night', vehicles: { goldengate: 'retired-car' }, best: { shoreline: 123 } })));
  await page.reload(); await page.locator('.home-go').click();
  await page.locator('.sm-go').click(); await step(page, 1);
  await page.locator('.sm-go').click(); await step(page, 2);
  await expect(page.locator('.sm-car.sel')).toHaveAttribute('data-vehicle', 'micro-hatch');
  await page.locator('.sm-back').click(); await page.locator('.sm-back').click(); await step(page, 0);
  const choose = async (trackId: string, vehicle: string) => {
    await page.locator(`.sm-item[data-track="${trackId}"]`).click();
    await page.locator('.sm-go').click(); await step(page, 1);
    await page.locator('.sm-go').click(); await step(page, 2);
    await page.locator(`[data-vehicle="${vehicle}"]`).click();
    await page.locator('.sm-go').click();
    await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
    await page.reload(); await page.locator('.home-go').click();
    await expect(page.locator('.sm-go')).toBeEnabled();
  };
  await choose('goldengate', 'school-bus');
  await choose('shoreline', 'retro-van');
  for (const [trackId, vehicle] of [['goldengate', 'school-bus'], ['shoreline', 'retro-van']]) {
    await page.locator(`.sm-item[data-track="${trackId}"]`).click();
    await page.locator('.sm-go').click(); await step(page, 1);
    await page.locator('.sm-go').click(); await step(page, 2);
    await expect(page.locator('.sm-car.sel')).toHaveAttribute('data-vehicle', vehicle!);
    await page.locator('.sm-back').click(); await page.locator('.sm-back').click(); await step(page, 0);
  }
  // Files records by route and car: the old route-only time, with no car remembered for it,
  // moves onto the catalogue's fallback car instead of being dropped.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('silicon-rush.save.v1')!).best))
    .toEqual({ 'shoreline@micro-hatch': 123 });
});
