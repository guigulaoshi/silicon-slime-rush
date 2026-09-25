import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';

// The game's name has one owner, the English locale; the wordmark spells it without the colon.
const WORDMARK = (JSON.parse(readFileSync(resolve('src/ui/locales/en.json'), 'utf8')) as Record<string, string>)['app.title']!.replace(':', '');
const out = evidencePath('brand-mark');
test.beforeEach(() => mkdirSync(out, { recursive: true }));

test('uses the slime race mark for the browser and compact UI while keeping the welcome wordmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.home-title .brand-mark')).toBeVisible();
  await expect(page.locator('.home-title .brand-wordmark')).toBeVisible();
  await expect(page.locator('.home-title .brand-wordmark')).toHaveText(WORDMARK);
  await expect(page.locator('.home-name')).toContainText('SILICON');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', './brand/slime-race-mark-64.png');
  expect(await page.locator('.home-title .brand-mark').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(180);
  expect(await page.locator('.home-title').evaluate(node => {
    const mark = node.querySelector<HTMLImageElement>('.brand-mark')!;
    const wordmark = node.querySelector<HTMLElement>('.brand-wordmark')!;
    return parseFloat(getComputedStyle(wordmark).fontSize) - parseFloat(getComputedStyle(mark).width);
  })).toBeLessThan(0);
  await page.screenshot({ path: `${out}/welcome.png` });

  await page.locator('.home-go').click();
  await expect(page.locator('.sm-name .brand-mark')).toBeVisible();
  await expect(page.locator('.sm-name .brand-wordmark')).toHaveText(WORDMARK);
  expect(await page.locator('.sm-name').evaluate(node => {
    const mark = node.querySelector<HTMLImageElement>('.brand-mark')!;
    const wordmark = node.querySelector<HTMLElement>('.brand-wordmark')!;
    return parseFloat(getComputedStyle(wordmark).fontSize) - parseFloat(getComputedStyle(mark).width);
  })).toBeLessThan(0);
  await page.screenshot({ path: `${out}/route-header.png` });
  await page.locator('.sm-go').click();
  await page.locator('.sm-go').click();
  await expect(page.locator('.sm')).toHaveAttribute('data-step', '2');
  await page.locator('.sm-garage-pane').evaluate(async pane => {
    await Promise.all(pane.getAnimations().map(animation => animation.finished));
  });
  await expect(page.locator('.sm-name .brand-wordmark')).toBeVisible();
  await page.screenshot({ path: `${out}/car-header.png` });

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.sm')).toHaveAttribute('data-device', 'mobile');
  const carWordmark = await page.locator('.sm-name .brand-wordmark').boundingBox();
  const carLanguage = await page.locator('.sm-stage .lang-toggle').boundingBox();
  expect(carWordmark!.x + carWordmark!.width).toBeLessThan(carLanguage!.x);
  await page.screenshot({ path: `${out}/mobile-car-header.png` });

  for (const step of ['1', '0', 'home']) {
    await page.locator('.sm-back').click();
    await expect(page.locator('.sm')).toHaveAttribute('data-step', step);
  }
  await expect(page.locator('.home-title .brand-wordmark')).toBeVisible();
  const homeWordmark = await page.locator('.home-title .brand-wordmark').boundingBox();
  const homeLanguage = await page.locator('.home-header .lang-toggle').boundingBox();
  expect(homeWordmark!.x + homeWordmark!.width).toBeLessThan(homeLanguage!.x);
  await page.screenshot({ path: `${out}/mobile-welcome.png` });
});
