import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

/** A personal best gets a banner, a fanfare and a mark on the shared picture; a slower lap gets none. */
const OUT = evidencePath('record');
test.describe.configure({ timeout: 180_000 });

test('a record run is announced and marked; a slower lap is not', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 1, language: 'en', volume: 0, muted: true, best: {}, names: ['Mia', ''] })));
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  // Count the record fanfare: the audio is muted in tests, so watch the cue itself.
  await page.evaluate(() => {
    const audio = (window.game as any).audio, ui = audio.ui.bind(audio);
    (window as any).cues = [] as string[];
    audio.ui = (kind: string) => { (window as any).cues.push(kind); ui(kind); };
  });
  const race = async (time: number) => {
    await page.evaluate(async () => { await window.game.startRace({ trackId: 'synth-loop', car: 'sedan', slimeDensity: 'normal', ai: false, playerVehicles: ['micro-hatch'] }); });
    await page.locator('[data-screen=intro] .departure-go').click();
    await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 15_000 }).toBe('racing');
    await page.evaluate(t => { const game = window.game as any; game.session.humans[0].race.time = t; game.finish(t); }, time);
    await expect(page.locator('[data-screen=results]')).toBeVisible();
  };

  await race(120);                                               // the route's first finish
  const banner = page.locator('.result-record');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-record', 'first');
  await expect(banner).toContainText('FIRST COMMUTE');
  // The fanfare lands about a second in, after the stars.
  const records = () => page.evaluate(() => (window as any).cues.filter((c: string) => c === 'record').length);
  await expect.poll(records, { timeout: 8000 }).toBe(1);
  await page.screenshot({ path: resolve(OUT, 'first-commute.png') });

  await race(105.5);                                             // a personal best, 14.50 s faster
  await expect(banner).toHaveAttribute('data-record', 'best');
  await expect(banner).toContainText('14.50s faster');
  await expect.poll(records, { timeout: 8000 }).toBe(2);
  await page.screenshot({ path: resolve(OUT, 'new-record.png') });
  await page.getByRole('button', { name: 'Share my run' }).click();
  const dialog = page.locator('.share-dialog');
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  await dialog.locator('[data-share=copy]').click();
  expect(await dialog.locator('textarea').inputValue()).toContain('New record: 14.50s faster');
  await dialog.locator('[data-share=close]').click();
  await page.getByRole('button', { name: 'Share my run' }).click();
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  let downloading = page.waitForEvent('download'); await dialog.locator('[data-share=save]').click();
  await (await downloading).saveAs(resolve(OUT, 'record-score-card.png'));
  await dialog.locator('[data-share-kind=text]').click();
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  downloading = page.waitForEvent('download'); await dialog.locator('[data-share=save]').click();
  await (await downloading).saveAs(resolve(OUT, 'record-text-card.png'));
  await dialog.locator('[data-share=close]').click();

  await race(140);                                               // slower: no banner, no fanfare, no mark
  await expect(banner).toBeHidden();
  await page.screenshot({ path: resolve(OUT, 'no-record.png') });
  await page.waitForTimeout(1600);
  expect(await records(), 'a slower lap plays no fanfare').toBe(2);
  await page.getByRole('button', { name: 'Share my run' }).click();
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  await dialog.locator('[data-share=copy]').click();
  expect(await dialog.locator('textarea').inputValue(), 'a slower lap is not called a record').not.toContain('New record');
});
