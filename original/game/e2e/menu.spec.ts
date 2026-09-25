import { expect, test, type Page } from '@playwright/test';


// 这个文件真的要开车，所以自己申请预算：默认档是 90 秒（playwright.config.ts），
// 那是「问浏览器一个问题」的价钱。从菜单一路开进去，要等世界加载。
test.describe.configure({ timeout: 180_000 });
const phase = (page: Page) => page.evaluate(() => window.game.report().phase);

/**
 * Getting out of a race, by keyboard and by pointer.
 *
 * Everything here is one click or one key away from the player at any moment, and none of it is
 * exercised by the driving tests: those start a race and watch it to the flag.
 */
test('pauses, resumes, and goes back to the menu', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?track=goldengate');
  await page.waitForFunction(() => window.game?.report().phase === 'intro', null, { timeout: 60_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 60_000 });

  await page.keyboard.press('Escape');
  await expect.poll(() => phase(page), { timeout: 5000 }).toBe('paused');

  // Escape again resumes
  await page.keyboard.press('Escape');
  await expect.poll(() => phase(page), { timeout: 5000 }).toBe('racing');

  // and the pause menu's own rows work by pointer, which is the only way in on a phone
  await page.keyboard.press('Escape');
  await expect.poll(() => phase(page), { timeout: 5000 }).toBe('paused');
  await page.locator('[data-screen=pause] [data-action=quit]').click();
  await page.locator('dialog[open] [data-dialog-action=confirm]').click();
  await expect.poll(() => phase(page), { timeout: 10_000 }).toBe('menu');
});
