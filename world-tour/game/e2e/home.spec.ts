import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { evidencePath } from './evidence';
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const STORY = Object.fromEntries((['zh', 'en'] as const).map(lang =>
  [lang, (JSON.parse(readFileSync(resolve(`src/ui/locales/${lang}.json`), 'utf8')) as Record<string, string>)['home.story']!])) as Record<'zh' | 'en', string>;
const out = evidencePath('home');

for (const language of ['en', 'zh']) for (const viewport of [
  { width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 },
]) test(`home ${language} ${viewport.width}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.addInitScript(language => localStorage.setItem('silicon-rush-world-tour.save.v1',
    JSON.stringify({ language, muted: true })), language);
  await page.goto('/');
  const button = page.locator('.home-go');
  await expect(button).toBeVisible(); await expect(button).toBeEnabled();
  await expect(button).toBeFocused();
  // The story has one owner, the locale files; a remix rewrites it.
  await expect(page.locator('.home-story')).toHaveText(STORY[language as 'zh' | 'en']);
  await expect(page.locator('.home-scene')).toHaveClass(/ready/);
  await page.locator('.sm').evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished));
  });
  const bounds = (await button.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: `${out}/${language}-${viewport.width}.png` });
  const slogan = await page.locator('.home-slogan').textContent();
  await page.locator('.home-language').click();
  await expect(page.locator('.home-slogan')).not.toHaveText(slogan!);
  await page.locator('.home-language').click();
  await expect(page.locator('.home-slogan')).toHaveText(slogan!);
  await button.click();
  await expect(page.locator('.home')).toBeHidden();
  await expect(page.locator('.sm')).toHaveAttribute('data-step', '0');
  await expect(page.locator('.sm-go')).toBeEnabled();
});

test('missing home image never blocks keyboard entry to the map', async ({ page }) => {
  // SHOWCASE_IMAGE in showcase.ts is now './home/showcase.webp' (the showcase track is sydney, not goldengate).
  await page.route('**/home/showcase.webp', route => route.abort());
  await page.goto('/');
  await expect(page.locator('.home-go')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.home')).toBeHidden();
  await expect(page.locator('.sm')).toHaveAttribute('data-step', '0');
});
