import { expect, test, type Page } from '@playwright/test';

// Leaving the page mid-race (a phone's Home button, another tab) waits on the pause page,
// the same as turning the phone upright does, instead of coming back to a car already moving.
test.describe.configure({ timeout: 90_000 });

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('a hidden page pauses the race and it stays paused after coming back', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ language: 'en', muted: true, best: {} }));
  });
  await page.goto('/?track=synth-p2p&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await page.waitForFunction(() => window.game.report().time > .5);
  await setHidden(page, true);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
  await setHidden(page, false);
  const frozen = await page.evaluate(() => window.game.report().time);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
  expect(await page.evaluate(() => window.game.report().time)).toBe(frozen);
  await expect(page.locator('[data-screen=pause]')).toBeVisible();
  await page.locator('[data-screen=pause] [data-action=resume]').click();
  await page.waitForFunction(time => window.game.report().time > time, frozen);

  // The countdown is part of the race too: it resumes where it was, not from the start.
  await page.keyboard.press('Escape');
  await page.locator('[data-screen=pause] [data-action=restart]').click();
  await page.locator('dialog[open] [data-dialog-action=confirm]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('countdown');
  await setHidden(page, true);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
  await setHidden(page, false);
  await page.locator('[data-screen=pause] [data-action=resume]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toMatch(/countdown|racing/);

  // Nothing to pause outside a race: the menu is left alone.
  await page.keyboard.press('Escape');
  await page.locator('[data-screen=pause] [data-action=quit]').click();
  await page.locator('dialog[open] [data-dialog-action=confirm]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('menu');
  await setHidden(page, true);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('menu');
});
