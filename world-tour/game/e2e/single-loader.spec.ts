import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

const OUT = evidencePath('single-loader');
test.describe.configure({ timeout: 240_000 });

// Retargeted from goldengate (deleted, "the default/showcase track") to sydney, the new home
// showcase route (game/src/app/showcase.ts).
test('one compact loader hands directly to the fresh sydney home scene', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  let held = 0;
  await page.route(/\/tracks\/sydney\/(tiles|backdrop)/, async route => {
    if (held++ < 4) await new Promise(resolveDelay => setTimeout(resolveDelay, 2500));
    await route.continue();
  });

  // The full bar is on screen for LOADING_COMPLETE_HOLD_MS (210 ms) and then the shell is removed
  // on purpose. Polling for it from here lands about once a second by then, so it caught that
  // window only when a loaded machine stretched it. Record the hand-off inside the page instead.
  await page.addInitScript(() => {
    const seen: { complete?: { busy: string | null; fill: string }; removedAfterComplete?: boolean } = {};
    (window as any).__startup483 = seen;
    new MutationObserver(records => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        if (record.type === 'attributes' && target.id === 'startup' && target.dataset.complete === 'true' && !seen.complete) {
          seen.complete = {
            busy: target.getAttribute('aria-busy'),
            fill: target.querySelector<HTMLElement>('.loading-bar-fill')?.style.width ?? '',
          };
        }
        for (const node of record.removedNodes) {
          if ((node as Element).id === 'startup') seen.removedAfterComplete = !!seen.complete;
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-complete'] });
  });
  await page.goto('/');
  const shell = page.locator('#startup');
  const bar = shell.locator('.loading-bar');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => (window.game as any)?.showcaseOpening === true, null, { timeout: 30_000 });
  expect((await bar.boundingBox())!.width).toBeLessThanOrEqual(420);
  await page.screenshot({ path: resolve(OUT, 'loading.png') });

  await expect(page.locator('.home-go')).toBeVisible({ timeout: 180_000 });
  await expect(shell).toHaveCount(0);
  const seen = await page.evaluate(() => (window as any).__startup483);
  expect(seen).toEqual({ complete: { busy: 'false', fill: '100%' }, removedAfterComplete: true });
  await expect(page.locator('.departure-progress')).toBeHidden();
  await expect(page.locator('[data-showcase=live]')).toBeAttached();
  await page.screenshot({ path: resolve(OUT, 'home.png') });
});
