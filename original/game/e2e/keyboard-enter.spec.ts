import { expect, test } from '@playwright/test';

/* */
test.describe.configure({ timeout: 180_000 });

test('pressing Enter over and over from home reaches the race without cancelling the load', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ language: 'en', muted: true, best: {} }));
  });
  await page.goto('/');
  await page.locator('.home-go').waitFor({ state: 'visible' });
  const phases: string[] = [];
  let focusOnLoad = '';
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const now = await page.evaluate(() => ({ phase: window.game.report().phase,
      focus: `${document.activeElement?.tagName}:${document.activeElement?.textContent?.trim()}` }));
    if (now.phase === 'boot' && !focusOnLoad) focusOnLoad = now.focus;
    if (phases.at(-1) !== now.phase) phases.push(now.phase);
    if (/countdown|racing/.test(now.phase)) break;
  }
  expect(phases).toContain('boot');
  // Once loading starts it only goes forward: no bounce back to the garage.
  expect(phases.slice(phases.indexOf('boot'))).not.toContain('menu');
  expect(phases.at(-1)).toMatch(/countdown|racing/);
  expect(focusOnLoad).toBeTruthy();
  expect(focusOnLoad).not.toBe('BUTTON:Back');
});
