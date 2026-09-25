import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('unpublished dual results retain both scores, usable cards and a real downloadable score image', async ({page}) => {
  test.skip(!!process.env.VITE_PUBLIC_GAME_URL, 'unpublished build coverage');
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(async () => { await window.game.startRace({trackId:'synth-loop',car:'sedan',slimeDensity:'normal',ai:false,playerVehicles:['micro-hatch','city-pod']}); });
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('racing');
  await page.evaluate(() => { const g=window.game as any;g.session.humans[0].race.time=83;g.session.humans[1].race.time=95;g.session.humans[0].race.score=1200;g.session.humans[1].race.score=2300;g.finish(83); });
  const result=page.locator('[data-screen=results]');
  await expect(result.locator('.result-player')).toHaveCount(2);
  await expect(result.locator('.result-standing.human')).toHaveCount(2);
  await expect(result.locator('.creator-links button:visible')).toHaveCount(2);
  await expect(result.locator('[data-action=share]')).toBeVisible();
  for (const action of ['homepage','coffee']) {
    await result.locator(`[data-action=${action}]`).click();
    const dialog=page.locator('dialog[open]');
    await expect(dialog).toContainText('Game page opening soon'); await dialog.locator('.modal-header button:not([data-share-kind])').click();
    expect(await page.evaluate(() => window.game.report().phase)).toBe('results');
  }
  await result.locator('[data-action=share]').click();
  const share=page.locator('.share-dialog');await expect(share.locator('[data-share=save]')).toBeEnabled();
  const downloading=page.waitForEvent('download');await share.locator('[data-share=save]').click();
  const download=await downloading;const png=readFileSync((await download.path())!);
  expect(png.subarray(1,4).toString()).toBe('PNG');expect(png.readUInt32BE(16)).toBe(1000);expect(png.readUInt32BE(20)).toBe(600);
  await share.locator('[data-share=copy]').click();await expect(share.locator('textarea')).toHaveValue(/Left driver.*1200.*Right driver.*2300/s);
  await share.locator('[data-share=close]').click();expect(await page.evaluate(() => window.game.report().phase)).toBe('results');
  await result.locator('[data-action=quit]').click();await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('menu');
});
