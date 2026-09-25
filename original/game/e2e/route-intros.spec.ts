import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOGUE } from '../src/app/tracks';

for (const language of ['en', 'zh'] as const) for (const [width, height] of [[1280, 720], [1920, 1080], [844, 390]] as const) {
  test(`${language} route introductions remain readable at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(language => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      language, quality: 'high', muted: true, best: {},
    })), language);
    await page.goto('/'); await page.locator('.home-go').click();
    await expect(page.locator('.sm-go')).toBeEnabled();
    // The details are always shown, no disclosure to open.
    await expect(page.locator('.startup-route-details summary')).toHaveCount(0);
    const messages = JSON.parse(readFileSync(resolve(`src/ui/locales/${language}.json`), 'utf8')) as Record<string, string>;
    const rows = page.locator('.sm-item');
    await expect(rows).toHaveCount(CATALOGUE.length);
    for (let i = 0; i < CATALOGUE.length; i++) {
      const row = rows.nth(i), id = CATALOGUE[i]!.id;
      const description = page.locator('.sm-pane').first().locator('.sm-blurb');
      if (i) await page.keyboard.press('ArrowDown');
      await expect(row).toHaveClass(/sel/);
      await expect(description).toHaveText(messages[`track.${id}.blurb`]!);
      const bounds = await description.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.height).toBeGreaterThan(12);
      const pane = await page.locator('.sm-pane').first().boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(pane!.y - 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(pane!.y + pane!.height + 1);
      await expect(page.locator('.sm-pane').first().locator('.sm-headline')).toHaveText(messages[`track.${id}.name`]!);
    }
    const stadium = rows.filter({ has: page.locator('.sm-nm', {
      hasText: language === 'en' ? '101 Rush Hour' : '101通勤',
    }) });
    await expect(stadium).toHaveCount(1);
    await stadium.scrollIntoViewIfNeeded(); await stadium.click();
    await expect(page.locator('.sm-go')).toBeEnabled();
    mkdirSync(evidencePath('route-intros'), { recursive: true });
    await page.screenshot({ path: evidencePath('route-intros', `${language}-${width}.png`) });
  });
}
