import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';

/**
 * One look, one screenshot, no world.
 *
 * The suite
 * next door drives real routes in a software renderer and takes twenty minutes because that is what
 * driving costs; looking at a screen costs a build and half a second, and the two have nothing to
 * do with each other.
 *
 *   LOOK=menu npm run look          the opening screen
 *   LOOK=goldengate npm run look    that track, with the robot driving, once the world is up
 *
 * The file lands in tools/baselines/look.png and is overwritten every time -- it is a look, not a
 * baseline. Nothing compares it to anything.
 */
// `LOOK=menu` is a second and a half, but `LOOK=<track>` loads a real world in a software
// renderer, and that is the same money every driving file pays -- so it asks for the same budget.
test.describe.configure({ timeout: 180_000 });

const OUT = evidencePath();
const what = process.env.LOOK ?? '';
test.skip(!what, 'run it with LOOK=<menu|track id> npm run look');

test('look', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  if (what === 'menu') {
    await page.goto('/');
    await page.waitForSelector('.sm-item', { timeout: 30_000 });
  } else {
    await page.goto(`/?track=${what}&bot=1`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing', null,
                               { timeout: 60_000 });
    await page.waitForTimeout(1500);            // let a few tiles arrive, so the shot has a world
  }
  mkdirSync(OUT, { recursive: true });
  const at = resolve(OUT, 'look.png');
  writeFileSync(at, await page.screenshot());
  console.log(`look: ${at}`);
});
