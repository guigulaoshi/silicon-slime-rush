import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

const OUT = evidencePath('rename');
test.describe.configure({ timeout: 120_000 });

test('shows Big Tech Rooftop in the menu, result and shared text without a company name', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?dev=1');
  await page.locator('.home-go').click();
  await expect(page.locator('.sm-item', { hasText: 'Big Tech Campus' })).toHaveCount(1);
  const row = page.locator('.sm-item', { hasText: 'Big Tech Rooftop' });
  await expect(row).toHaveCount(1);
  await expect(page.locator('.sm-list')).not.toContainText(/Wolfe.?Pruneridge Roof Ring|Apple/);
  await page.evaluate(async () => {
    await window.game.startRace({ trackId: 'wolfe-pruneridge', vehicleId: 'sports-car',
      slimeDensity: 'none', ai: false });
  });
  await page.locator('[data-screen=intro] .departure-go').click();
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, 'Big Tech Rooftop');
  await page.evaluate(() => (window.game as any).finish(20));
  await expect(page.locator('.result-track')).toHaveText('Big Tech Rooftop');
  await page.locator('[data-screen=results] [data-action=share]').click();
  await page.locator('[data-share=copy]').click();
  expect(await page.locator('.share-dialog textarea').inputValue()).toContain('Big Tech Rooftop');
  expect(await page.locator('.share-dialog textarea').inputValue()).not.toMatch(/Apple|Wolfe.?Pruneridge Roof Ring/);
  await page.screenshot({ path: resolve(OUT, 'big-tech-rooftop-en.png') });

  await page.locator('[data-share=close]').click();
  await page.locator('[data-screen=results] .language').click();
  await page.locator('[data-screen=results] [data-action=share]').click();
  await page.locator('[data-share=copy]').click();
  expect(await page.locator('.share-dialog textarea').inputValue()).toContain('大厂楼顶');
  await page.screenshot({ path: resolve(OUT, 'big-tech-rooftop-zh.png') });
});
