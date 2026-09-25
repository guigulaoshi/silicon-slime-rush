import { expect, test } from '@playwright/test';
import { DEV_URL, PORT } from './server';

/**
 * Itch.io runs the game in a cross-origin iframe whose allow list has no clipboard-write,
 * so Chrome refuses navigator.clipboard.writeText there. The page below embeds the game the way
 * itch.io does from a second
 * origin (the dev server's, so Chrome's private-network rule sees two local pages); only that outer
 * origin may read the clipboard back, the frame gets nothing extra.
 */
const ITCH_ALLOW = 'autoplay; fullscreen *; geolocation; microphone; camera; midi; monetization; xr-spatial-tracking; gamepad; gyroscope; accelerometer; xr; cross-origin-isolated; web-share';
const EMBED_ORIGIN = DEV_URL;

test('copy buttons reach the clipboard inside an itch.io-style embed', async ({page, context}) => {
  test.setTimeout(120_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: EMBED_ORIGIN});
  const refused: string[] = [];
  page.on('console', message => { if (/Permissions policy/i.test(message.text())) refused.push(message.text()); });
  await page.goto(`${EMBED_ORIGIN}/credits.txt`);
  await page.setContent(`<!doctype html><body style="margin:0"><iframe src="http://localhost:${PORT}/?dev=1" allow="${ITCH_ALLOW}" allowfullscreen width=960 height=540 style="border:0"></iframe>`);
  const frame = page.frameLocator('iframe');
  await frame.locator('.home-share').waitFor();
  const game = page.frames().find(f => f.url().startsWith(`http://localhost:${PORT}/`))!;
  await game.waitForFunction(() => window.game);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const clear = () => page.evaluate(() => navigator.clipboard.writeText('CLEARED'));

  // Home share window: "Copy text".
  await frame.locator('.home-share').click();
  const dialog = frame.locator('.share-dialog');
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  await clear();
  await dialog.locator('[data-share=copy]').click();
  await expect(dialog.locator('[role=status]')).toContainText('copied');
  expect(await clipboard()).toContain('Silicon Slime Rush');
  await dialog.locator('[data-share=close]').click();

  await game.evaluate(() => window.game.startRace({trackId: 'synth-p2p', car: 'sedan', slimeDensity: 'none', ai: false}));
  await frame.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => game.evaluate(() => window.game.report().phase), {timeout: 15_000}).toBe('racing');
  // Finish fixture after a real world load; this spec is about the copy buttons, not the drive.
  await game.evaluate(() => { const g = window.game as any; g.session.humans[0].race.time = 83.4; g.finish(83.4); });

  // Results: "Copy text card".
  await clear();
  await frame.locator('[data-screen=results] [data-action=text]').click();
  await expect(frame.locator('[data-screen=results] [role=status]')).toContainText('copied');
  expect(await clipboard()).toContain('1:23.40');

  // Results share window: "Copy text" shows the words and copies them too.
  await frame.locator('[data-screen=results] [data-action=share]').click();
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  await clear();
  await dialog.locator('[data-share=copy]').click();
  await expect(dialog.locator('[role=status]')).toContainText('copied');
  expect(await clipboard()).toContain('1:23.40');
  // The embed really refused the modern API, so what passed above is the fallback.
  expect(refused.length).toBeGreaterThan(0);
});
