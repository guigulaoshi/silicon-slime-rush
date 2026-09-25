import { expect, test } from '@playwright/test';

// Menu actions do not need a full-route timeout.
test.describe.configure({ timeout: 90_000 });

test('pause cards and confirmations work without a published URL', async ({ page }) => {
  test.skip(!!process.env.VITE_PUBLIC_GAME_URL, 'covers the unpublished build');
  await page.addInitScript(() => {
    localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ language: 'en', muted: true, best: {} }));
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  await page.goto('/?track=synth-p2p&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await page.waitForFunction(() => window.game.report().time > .5);
  await page.keyboard.press('Escape');
  const pause = page.locator('[data-screen=pause]');
  await expect(pause.locator('.creator-links button:visible')).toHaveCount(2);
  const dialog = page.locator('dialog[open]');
  for (const action of ['homepage', 'coffee']) {
    // No confirm step; a build without a verified page says so straight away.
    await pause.locator(`[data-action=${action}]`).click();
    await expect(dialog).toContainText('Game page opening soon');
    await dialog.locator('.modal-header button:not([data-share-kind])').click();
    expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
  }
  /* */
  await pause.locator('[data-action=restart]').click();
  await dialog.locator('.modal-header button:not([data-share-kind])').click();
  expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
  await pause.locator('[data-action=restart]').click();
  await dialog.locator('[data-dialog-action=confirm]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('countdown');
  await page.keyboard.press('Escape');
  await pause.locator('[data-action=quit]').click();
  await dialog.locator('.confirm-actions button').first().click();
  expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
  await pause.locator('[data-action=quit]').click();
  await dialog.locator('[data-dialog-action=confirm]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('menu');
});
