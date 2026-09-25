import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { VEHICLES, forTrack } from '../src/vehicles/catalogue';
import { evidencePath } from './evidence';

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
  // The original also shot the old jeep picture from a local reference file (tools/baselines, never in
  // the repository) for a before/after pair; a clone has no such file, so only the delivered pictures are checked.
  await openGarage();
  // A route with its own car shows it in that car's slot (the button keeps the slot's id).
  const track = (await page.locator('.sm-item.sel').getAttribute('data-track'))!;
  for (const vehicle of VEHICLES) {
    const card = page.locator(`[data-vehicle="${vehicle.id}"]`);
    await card.click();
    const hero = page.locator('.sm-carhero');
    await expect(hero).toHaveAttribute('data-state', 'ready');
    await expect(hero).toHaveAttribute('data-model-vehicle', forTrack(vehicle, track).id);
    await expect(card.locator('img')).toHaveCSS('object-fit', 'contain');
    await expect.poll(() => card.locator('img').evaluate(image =>
      (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: resolve(out, `${vehicle.id}-after.png`) });
  }
});
