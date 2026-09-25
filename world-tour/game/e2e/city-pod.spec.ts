import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

// Two localized desktop/phone garage journeys, each loading one real road start.
test.describe.configure({ timeout: 90_000 });
for (const [language, name, width, height] of [['en', 'City Pod', 1440, 810], ['zh', '胶囊小车', 932, 430]] as const) {
  test(`City Pod is selectable, remembered and drivable in ${language}`, async ({ page }) => {
    const out = evidencePath('city-pod'); mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height });
    await page.addInitScript(lang => {
      if (!localStorage.getItem('silicon-rush-world-tour.save.v1')) localStorage.setItem('silicon-rush-world-tour.save.v1',
        JSON.stringify({ language: lang, muted: true, slimeDensity: 'none', best: {} }));
    }, language);
    await page.goto('/'); await page.locator('.home-go').click();
    await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
    const choice = page.locator('[data-vehicle="city-pod"]');
    await expect(choice.locator('.sm-carnm')).toHaveText(name);
    await choice.click();
    await expect(page.locator('.sm-carhero')).toHaveAttribute('aria-label', new RegExp(name));
    await expect(page.locator('.sm-carhero')).toHaveAttribute('data-model-vehicle', 'city-pod');
    await expect(page.locator('.sm-carhero canvas')).toBeVisible();
    const bounds = await choice.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: resolve(out, `garage-${language}.png`) });
    await page.locator('.sm-go').click();
    await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
    expect(await page.evaluate(() => window.game.report().vehicle)).toBe('city-pod');
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    const start = await page.evaluate(() => {
      const game = window.game as any; game.autopilot = true;
      const report = game.report(); return [report.posX, report.posZ];
    });
    await page.waitForFunction(([x, z]) => {
      const report = window.game.report(); return Math.hypot(report.posX - x!, report.posZ - z!) > 12;
    }, start, { timeout: 15000 });
    await expectWorldLoaded(page, 'City Pod');
    await page.screenshot({ path: resolve(out, `road-${language}.png`) });
    await page.reload(); await page.locator('.home-go').click();
    await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
    await expect(page.locator('.sm-car.sel')).toHaveAttribute('data-vehicle', 'city-pod');
  });
}
