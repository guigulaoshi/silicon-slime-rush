import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { evidencePath } from './evidence';

const out = evidencePath('menu-preview');

test('obstacle previews stay bright and direction changes are visible', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.goto('/');
  await page.locator('.home-go').click();
  await page.locator('.sm-go').click();

  const preview = page.locator('.sm-world-preview');
  const shot = page.locator('.sm-world-shot');
  for (const density of ['none', 'normal', 'many']) {
    await page.locator(`[data-slime-density="${density}"]`).click();
    await expect(shot).toHaveAttribute('src', new RegExp(`slimes-${density}\\.webp`));
    await expect.poll(() => shot.evaluate(image => (image as HTMLImageElement).complete)).toBe(true);
    // The image now fills the screen behind the controls. Check its loaded source, not the
    // menu cards covering it: the regression was a pause veil baked into the picture itself.
    const source = await shot.evaluate(image => (image as HTMLImageElement).currentSrc);
    const response = await page.request.get(source);
    expect(response.ok()).toBe(true);
    const stats = await sharp(await response.body()).stats();
    const brightness = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
    expect(brightness, `${density} preview must not contain the old pause veil`).toBeGreaterThan(70);
  }

 
  await page.locator('button[data-direction="forward"]').click();
  await expect(preview).toHaveAttribute('data-world-direction', 'forward');
  await expect(page.locator('button[data-direction="forward"]')).toHaveClass(/on/);
  await expect(page.locator('.sm-direction-cue')).toHaveCount(0);
  await page.screenshot({ path: resolve(out, '01-forward.png') });

  await page.locator('button[data-direction="reverse"]').click();
  await expect(preview).toHaveAttribute('data-world-direction', 'reverse');
  await expect(page.locator('button[data-direction="reverse"]')).toHaveClass(/on/);
  await page.screenshot({ path: resolve(out, '02-reverse.png') });
});
