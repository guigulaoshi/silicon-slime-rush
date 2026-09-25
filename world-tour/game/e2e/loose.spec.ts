import { expect, test } from '@playwright/test';
import { DEV_URL } from './server';
import { expectWorldLoaded } from './world';

/**
 * The shape `npm run dev` serves: one file per tile, no pack, no byte ranges.
 *
 * Two runtime paths ship: the pipeline writes `tiles/<name>.glb` and the web build packs them into `tiles.bin`
 * on the way into `dist/`. Every other spec here runs against `vite preview`, which serves the
 * packed one -- so without this file the loose path, the one every development day looks at, has no
 * browser test at all.
 */
test.describe.configure({ timeout: 180_000 });

test('drives a track whose tiles are loose files', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    const at = r.url().split('/tracks/')[1];
    if (at && at.includes('tile')) asked.push(at);
  });
  // Golden Gate was deleted with the Bay Area tracks; any real (non-synthetic) track ships loose
  // tiles the same way -- Sydney is the world-tour default track.
  await page.goto(`${DEV_URL}/?track=sydney&bot=1`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await page.waitForFunction(() => (window.game.report().tiles?.loaded ?? 0) > 3, null,
                             { timeout: 90_000 });
  await expectWorldLoaded(page, 'sydney');
  expect(asked.length).toBeGreaterThan(3);
  // Every request went to a file of its own, and none of them to a pack.
  for (const at of asked) expect(at).toMatch(/^sydney\/tiles\/t_-?\d+_-?\d+\.glb$/);
  expect(await page.evaluate(() => window.game.report().tiles!.failed)).toBe(0);
});
