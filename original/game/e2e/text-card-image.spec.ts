import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

/** The share window offers the emoji text card beside the score card, as a picture that saves and shares, with its text copied. */
const OUT = evidencePath('text-card-image');
test.describe.configure({ timeout: 180_000 });

test('the share window switches to the text card picture, saves and shares it, and copies the text card', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    if (!localStorage.getItem('silicon-rush.save.v1')) localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 1, language: 'en', volume: 0, muted: true, best: {}, names: ['Mia', ''] }));
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => { (window as any).shared = { text: data.text, files: data.files?.map(f => ({ name: f.name, type: f.type, size: f.size })) }; } });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).copied = text; } } });
  });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(async () => { await window.game.startRace({ trackId: 'synth-loop', car: 'sedan', slimeDensity: 'normal', ai: false, playerVehicles: ['micro-hatch'] }); });
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 15_000 }).toBe('racing');
  await page.evaluate(() => {
    const game = window.game as any, race = game.session.humans[0].race;
    race.time = 123.45; race.hitSlime('a', [1, 1, 1], 'popper'); race.hitSlime('b', [1, 1, 1], 'burst'); race.hitSlime('c', [1, 1, 1], 'slick'); race.hitSlime('d', [1, 1, 1], 'boost'); race.hitSlime('e', [1, 1, 1], 'colossus');
    race.slimeHits += 1;                                   // one hit of no known kind: the sixth colour
    race.sections = Array.from({ length: 8 }, (_, i) => i < 6 ? { seconds: 10, distance: i === 2 ? 20 : 200 } : { seconds: 0, distance: 0 });
    game.finish(123.45);
  });
  const dialog = page.locator('.share-dialog');
  for (const lang of ['en', 'zh']) {
    await page.evaluate(next => (window.game as any).pickSetting({ id: 'language', label: '' }, next), lang);
    await page.locator('[data-screen=results] button').filter({ hasText: lang === 'en' ? 'Share my run' : '分享战绩' }).first().click();
    await expect(dialog.locator('[data-share=save]')).toBeEnabled();
    await expect(dialog.locator('[data-share-kind=score]')).toHaveAttribute('aria-pressed', 'true');
    // With the score card chosen, the words are the score lines (score, stars, combo), as before.
    await dialog.locator('[data-share=system]').click();
    expect(await page.evaluate(() => (window as any).shared.text)).toContain(lang === 'en' ? 'points' : '分');
    await dialog.locator('[data-share-kind=text]').click();
    await expect(dialog.locator('[data-share-kind=text]')).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.locator('[data-share=save]')).toBeEnabled();
    expect(await dialog.locator('canvas').evaluate(canvas => [(canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height])).toEqual([1080, 1350]);
    const downloading = page.waitForEvent('download'); await dialog.locator('[data-share=save]').click();
    const download = await downloading;
    // Route and local time in the name, so two saves never collide.
    expect(download.suggestedFilename()).toMatch(/^silicon-slime-rush-text-card-synth-loop-\d{8}-\d{6}\.png$/);
    await download.saveAs(resolve(OUT, `text-card-${lang}.png`));
    await dialog.locator('[data-share=system]').click();
    const shared = await page.evaluate(() => (window as any).shared);
    expect(shared.files[0]).toMatchObject({ name: download.suggestedFilename(), type: 'image/png' });
    expect(shared.files[0].size).toBeGreaterThan(20_000);
    expect(shared.text).toContain('🟩×1 🟪×1 ⬛×1 🟥×1 🟦×1 ⚪×1');
    expect(shared.text).toContain('⏩⏩🐢⏩⏩⏩▫️▫️');
    // The copy button shows the text card's words, the same the results page copies.
    await dialog.locator('[data-share=copy]').click();
    const preview = await dialog.locator('textarea').inputValue();
    expect(preview).toContain('Mia · 2:03.45');
    expect(preview).toContain('🟩×1 🟪×1 ⬛×1 🟥×1 🟦×1 ⚪×1');
    await dialog.locator('[data-share=close]').click();
  }
});
