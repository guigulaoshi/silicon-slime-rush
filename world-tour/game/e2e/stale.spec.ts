import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const writeShots = process.env.SHOTS === '1';

/**
 * A tree whose map data does not match its index has to say so on screen.
 *
 * we opened the game and got a car in a blue sky: no road, no buildings, and not one
 * word explaining it. `tools/assets.py` now stops that combination from being served at all, and
 * `app/dataHealth.ts` is the net under it -- but a net whose unit tests pass while nothing reaches
 * the screen is exactly the failure being fixed. So this one breaks the data for real, in a real
 * browser, and reads the sentence off the HUD.
 *
 * Failing the requests is how the shape is reproduced without wrecking the checkout: to the runtime
 * a 404 from a route handler and a 404 from a missing file are the same event, and the tree the
 * next test runs in is still intact.
 */
test.describe.configure({ timeout: 180_000 });

test('a missing starting road stays out of racing and shows a persistent recoverable error', async ({ page }) => {
  let failedRequests = 0;
  await page.route('**/tracks/**/tiles*', r => { failedRequests++; return r.fulfill({ status: 404, body: 'gone' }); });
  await page.goto('/?track=sydney&bot=1');
  const alert = page.locator('[data-screen=boot] [role=status]');
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText(/could not be loaded|没能加载/);
  expect(failedRequests).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('boot');
  expect(await page.evaluate(() => window.game.report().track)).toBeNull();
  await page.waitForTimeout(4000);
  await expect(alert).toBeVisible();
  if (writeShots) {
    const out = evidencePath();
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, 'stale-data.png'), await page.screenshot());
  }
  await page.unroute('**/tracks/**/tiles*');
  await page.locator('[data-screen=boot] .departure-retry').click();
  await page.waitForFunction(() => window.game.report().phase === 'intro');
  await expect(alert).toBeHidden();
});

test('says the textures are behind when only they are missing', async ({ page }) => {
  // The other half of the same fault, and the half the unit tests cannot reach: `staleAssetsKey`
  // is fed by a promise handler in `World`, and taking that handler out leaves every Node test
  // green. Only a browser notices, because only a browser actually loads a manifest.
  await page.route('**/textures/manifest.json', (r) => r.fulfill({ status: 404, body: 'gone' }));
  await page.goto('/?track=sydney&bot=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await page.waitForFunction(() => (window.game.report().tiles?.loaded ?? 0) > 0, null,
                             { timeout: 90_000 });

  // The build players get names the problem and carries no rebuild command;
  // `devHint` adds `tools/assets.py` only in a development build, and these tests run the production one.
  await expect(page.locator('.hud-alert')).toContainText(/textures could not be loaded|贴图没能加载/, { timeout: 60_000 });
  await expect(page.locator('.hud-alert')).not.toContainText('tools/assets.py');
  // The road is there -- this is the greybox, not the empty sky, and the sentence has to tell them
  // apart or it is worse than nothing.
  expect(await page.evaluate(() => window.game.report().tiles!.failed)).toBe(0);
  expect(await page.evaluate(() => window.game.report().textures)).toBe(0);
});
