import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VEHICLES } from '../src/vehicles/catalogue';
import { evidencePath, baselinePath } from './evidence';

test('all nine garage photographs match the delivered models', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const out = evidencePath('garage-thumbnails');
  mkdirSync(out, { recursive: true });
  const openGarage = async () => {
    await page.goto('/?dev=1');
    await page.locator('.home-go').click();
    for (let step = 1; step <= 2; step++) {
      await page.locator('.sm-go').click();
      await expect(page.locator('.sm')).toHaveAttribute('data-step', String(step));
    }
  };
  await page.route('**/garage/jeep.webp', route => route.fulfill({ contentType: 'image/webp',
    body: readFileSync(baselinePath('garage-thumbnails', 'jeep-before.webp')) }));
  await openGarage();
  await page.locator('[data-vehicle="jeep"]').click();
  await expect(page.locator('.sm-carhero')).toHaveAttribute('data-state', 'ready');
  await page.screenshot({ path: resolve(out, 'jeep-before.png') });
  await page.unroute('**/garage/jeep.webp');
  await openGarage();
  for (const vehicle of VEHICLES) {
    const card = page.locator(`[data-vehicle="${vehicle.id}"]`);
    await card.click();
    const hero = page.locator('.sm-carhero');
    await expect(hero).toHaveAttribute('data-state', 'ready');
    await expect(hero).toHaveAttribute('data-model-vehicle', vehicle.id);
    await expect(card.locator('img')).toHaveCSS('object-fit', 'contain');
    await expect.poll(() => card.locator('img').evaluate(image =>
      (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: resolve(out, `${vehicle.id}-after.png`) });
  }
});
