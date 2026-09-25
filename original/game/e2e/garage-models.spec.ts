import { evidencePath } from './evidence';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { VehicleDefinition } from '../src/vehicles/catalogue';
const { vehicles: VEHICLES } = JSON.parse(readFileSync('src/vehicles/catalogue.json', 'utf8')) as { vehicles: VehicleDefinition[] };

const OUT = evidencePath('garage-models');
test.describe.configure({ timeout: 120_000 });

for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
  test('production garage models at ' + viewport.width, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      language: 'en', muted: true, best: {},
    })));
    const models = new Set<string>();
    const pictures: string[] = [];
    page.on('request', request => {
      if (/\/models\/cars\/.*\.glb$/.test(request.url())) models.add(request.url().split('/').pop()!);
      if (/\/garage\/.*\.webp$/.test(request.url())) pictures.push(request.url());
    });
    await page.goto('/');
    await page.waitForFunction(() => window.game?.report().phase === 'menu');
    // Opening loads the home page's Golden Gate scene, car and all, before the menu exists.
    // What this guards is the garage: stepping into the menu must not fetch a single garage model.
    const opening = [...models];
    await page.locator('.home-go').click();
    expect([...models]).toEqual(opening);
    await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
    await page.locator('.sm-pane[aria-hidden=false]').evaluate(pane =>
      Promise.all(pane.getAnimations().map(animation => animation.finished)));
    const hero = page.locator('.sm-carhero');
    const thumbnails = page.locator('[data-player="0"] .sm-car .sm-carthumb');
    await expect(thumbnails).toHaveCount(VEHICLES.length);
    await expect.poll(() => thumbnails.evaluateAll(images => images.every(image =>
      (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    for (const vehicle of VEHICLES) await expect(page.locator(
      `[data-player="0"] [data-vehicle="${vehicle.id}"] .sm-carthumb`))
      .toHaveAttribute('src', `./garage/${vehicle.id}.webp`);
    for (const vehicle of VEHICLES) {
      await page.locator('[data-vehicle="' + vehicle.id + '"]').click();
      await expect(hero).toHaveAttribute('data-state', 'ready');
      await expect(hero).toHaveAttribute('data-model-vehicle', vehicle.id);
      await expect(hero).toHaveAttribute('data-bodies',
        [vehicle.id, ...(vehicle.trailer ? [vehicle.trailer.id] : [])].join(','));
      await expect(hero.locator('canvas')).toHaveCount(1);
      await expect(hero.locator('img')).toHaveCount(0);
      const bounds = (await hero.boundingBox())!;
      expect(bounds.width).toBeGreaterThan(100);
      expect(bounds.height).toBeGreaterThanOrEqual(100);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      if (vehicle.id === 'pickup-travel-trailer') await page.screenshot({
        path: resolve(OUT, viewport.width + '-' + vehicle.id + '-front.png'),
      });
      const before = await hero.locator('canvas').screenshot();
      await page.waitForTimeout(350);
      const spun = await hero.locator('canvas').screenshot();
      expect(before.equals(spun)).toBe(false);
      await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .4);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .45, { steps: 8 });
      await page.mouse.up();
      const after = await hero.locator('canvas').screenshot();
      expect(before.equals(after)).toBe(false);
      if (vehicle.id === 'pickup-travel-trailer') await page.screenshot({
        path: resolve(OUT, viewport.width + '-' + vehicle.id + '.png'),
      });
    }
    expect(models.size).toBe(VEHICLES.flatMap(vehicle =>
      [vehicle, ...(vehicle.trailer ? [vehicle.trailer] : [])]).length);
    expect(new Set(pictures.map(url => url.split('/').pop())).size).toBe(VEHICLES.length);
    await page.locator('.sm-back').click();
    await expect(hero.locator('canvas')).toHaveCount(0);
    await expect(hero).not.toHaveAttribute('data-model-vehicle', /.+/);
    await expect(hero).toHaveAttribute('aria-label', /City Pod/);
    await page.locator('.sm-go').click();
    await page.locator('.sm-go').click();
    await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
    expect(await page.evaluate(() => window.game.report().vehicle)).toBe('city-pod');
    await expect(hero.locator('canvas')).toHaveCount(0);
  });
}

test('failed and superseded model loads never show another selected car', async ({ page }) => {
  await page.route('**/models/cars/micro-hatch.glb', route => route.fulfill({ status: 503, body: '' }));
  await page.goto('/'); await page.locator('.home-go').click();
  await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
  await page.locator('[data-vehicle="micro-hatch"]').click();
  const hero = page.locator('.sm-carhero');
  await expect(hero).toHaveAttribute('data-state', 'failed');
  await expect(hero.locator('canvas')).toHaveCount(0);
  await expect(page.locator('.sm-go')).toBeDisabled();
  await page.unroute('**/models/cars/micro-hatch.glb');
  await page.route('**/models/cars/micro-hatch.glb', route => route.fulfill({ status: 200, body: 'invalid GLB' }));
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/micro-hatch.glb')),
    page.locator('.sm-model-retry').click()]);
  await expect(hero).toHaveAttribute('data-state', 'failed');
  await page.unroute('**/models/cars/micro-hatch.glb');
  await page.locator('.sm-model-retry').click();
  await expect(hero).toHaveAttribute('data-model-vehicle', 'micro-hatch');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const requested = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/models/cars/sports-car.glb', async route => {
    entered();
    await held;
    await route.continue().catch(() => {});
  });
  await page.locator('[data-vehicle="sports-car"]').click();
  await requested;
  await page.locator('[data-vehicle="jeep"]').click();
  await expect(hero).toHaveAttribute('data-model-vehicle', 'jeep');
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(hero).toHaveAttribute('data-model-vehicle', 'jeep');
  await expect(hero.locator('canvas')).toHaveCount(1);
  await page.locator('.sm-go').click();
  await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
  expect(await page.evaluate(() => window.game.report().vehicle)).toBe('jeep');
});
