import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { CATALOGUE } from '../src/app/tracks';

const out = evidencePath('menu-ui');
test.describe.configure({ timeout: 90_000 });

test('B3 route gallery and world choices use real game renders', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.goto('/');
  await expect(page.locator('.home-scene')).toHaveClass(/ready/);
  await page.screenshot({ path: resolve(out, '01-home-en.png') });
  await page.locator('.home-go').click();

  const open = page.locator('.sm-item');
  await expect(open).toHaveCount(CATALOGUE.length);
  expect(await open.evaluateAll(cards => cards.map(card => (card as HTMLElement).dataset.track)))
    .toEqual(CATALOGUE.map(track => track.id)); // Order is the catalogue order
  await expect.poll(() => page.locator('.sm-route-thumb').evaluateAll(images =>
    images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const gallery = await page.locator('.sm-list').evaluate(element => {
    const card = element.querySelector<HTMLElement>('.sm-item')!;
    return { rows: getComputedStyle(element).gridTemplateRows.split(' ').length,
      cardFraction: card.getBoundingClientRect().width / element.getBoundingClientRect().width };
  });
  expect(gallery.rows).toBe(2);
  expect(gallery.cardFraction).toBeGreaterThan(.23);
  expect(gallery.cardFraction).toBeLessThan(.32);

  for (const id of ['goldengate', 'twin-peaks', 'wolfe-pruneridge']) {
    await page.locator(`[data-track="${id}"]`).click();
    await expect(page.locator('.sm-item.sel')).toHaveAttribute('data-track', id);
    await expect(page.locator('.sm-go'), `${id} should prepare a playable race`).toBeEnabled();
  }
  await page.screenshot({ path: resolve(out, '02-routes-en.png') });

  await page.locator('[data-track="goldengate"]').click();
  await expect(page.locator('.sm-go')).toBeEnabled();
  await page.locator('.sm-go').click();
  const shot = page.locator('.sm-world-shot');
  // A first visit opens in daylight, even on a route authored at night.
  await expect(shot).toHaveAttribute('src', /menu\/world\/goldengate\/day-clear\.webp/);
 
  await page.locator('[data-time="day"]').click();
  await expect(shot).toHaveAttribute('src', /menu\/world\/goldengate\/day-clear\.webp/);
  await page.locator('[data-time="night"]').click();
  await expect(shot).toHaveAttribute('src', /menu\/world\/goldengate\/night-clear\.webp/);
  for (const weather of ['fog', 'rain', 'snow']) {
    await page.locator(`[data-weather="${weather}"]`).click();
    await expect(shot).toHaveAttribute('src', new RegExp(`menu/world/goldengate/night-${weather}\\.webp`));
  }
  for (const density of ['none', 'normal', 'many']) {
    await page.locator(`[data-slime-density="${density}"]`).click();
    await expect(shot).toHaveAttribute('src', new RegExp(`menu/world/goldengate/slimes-${density}\\.webp`));
  }
  for (const difficulty of ['relaxed', 'rush']) {
    await page.locator(`[data-ai-mode="${difficulty}"]`).click();
    await expect(shot).toHaveAttribute('src', new RegExp(`menu/world/goldengate/ai-${difficulty}\\.webp`));
  }
  await expect.poll(() => shot.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: resolve(out, '03-world-en.png') });

  await page.locator('.sm-go').click();
  await expect(page.locator('.sm')).toHaveAttribute('data-step', '2');
  await page.waitForTimeout(500);
  await expect(page.locator('.sm-carhero canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(out, '04-garage-en.png') });
});

test.describe('phone landscape', () => {
  test.use({ viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36' });

  test('keeps the B3 flow readable in Chinese', async ({ page }) => {
    mkdirSync(out, { recursive: true });
    await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      version: 13, language: 'zh',
    })));
    await page.goto('/');
    await expect(page.locator('.home-story')).toContainText('硅谷');
    await page.locator('.home-go').click();
    await expect(page.locator('.startup-recap-step[data-k="route"]')).toContainText('赛道');
    await expect(page.locator('.sm-item')).toHaveCount(CATALOGUE.length);
    await page.screenshot({ path: resolve(out, '06-routes-phone-zh.png') });
    await page.locator('.sm-go').click();
    await expect(page.locator('.sm')).toHaveAttribute('data-step', '1');
    await expect(page.locator('.sm-world-shot')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(out, '07-world-phone-zh.png') });
  });
});
