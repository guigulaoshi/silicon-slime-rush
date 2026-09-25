import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

/** A nickname set in settings is remembered and printed on the share image, text card and results card. */
const OUT = evidencePath('player-name');
test.describe.configure({ timeout: 180_000 });
test.beforeEach(() => mkdirSync(OUT, { recursive: true }));

test('the nickname is typed in settings, cleaned and remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.locator('.home-footer button').first().click();                 // Settings
  const field = page.locator('input[data-setting=name]');
  await expect(field).toBeVisible();
  await field.fill('  Mia‮  the fast  ');
  await field.press('Enter');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('silicon-rush.save.v1')!).names)).toEqual(['Mia the fast', '']);
  await page.screenshot({ path: resolve(OUT, 'settings.png') });
  await page.reload();
  await page.locator('.home-footer button').first().click();
  await expect(page.locator('input[data-setting=name]')).toHaveValue('Mia the fast');
});

async function finishWith(page: Page, vehicles: string[], times: number[]) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    if (!localStorage.getItem('silicon-rush.save.v1')) localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 1, language: 'en', volume: 0, muted: true, best: {}, names: ['Mia', 'Kai'] }));
    Object.defineProperty(navigator, 'share', { value: undefined });
  });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(async v => { await window.game.startRace({ trackId: 'synth-loop', car: 'sedan', slimeDensity: 'normal', ai: false, playerVehicles: v }); }, vehicles);
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 15_000 }).toBe('racing');
  await page.waitForTimeout(300);
  await page.evaluate(t => { const game = window.game as any; game.session.humans.forEach((h: any, i: number) => { h.race.time = t[i]; }); game.finish(t[0]); }, times);
  await expect(page.locator('[data-screen=results]')).toBeVisible();
}

for (const players of [1, 2]) test(`428 ${players === 1 ? 'solo' : 'two-player'} share image, text card and results card carry the nicknames`, async ({ page }) => {
  await finishWith(page, players === 1 ? ['micro-hatch'] : ['micro-hatch', 'city-pod'], [83.4, 90]);
  const cards = page.locator('[data-screen=results] .card-brand-wordmark');
  await expect(cards.first()).toContainText('Mia');
  if (players === 2) await expect(cards.nth(1)).toContainText('Kai');
  const dialog = page.locator('.share-dialog');
  for (const lang of ['en', 'zh']) {
    // The results share window has no language button of its own: switch the game's language, then share.
    await page.evaluate(next => (window.game as any).pickSetting({ id: 'language', label: '' }, next), lang);
    await page.locator('[data-screen=results] .share-cta, [data-screen=results] button').filter({ hasText: lang === 'en' ? 'Share my run' : '分享战绩' }).first().click();
    await expect(dialog.locator('[data-share=save]')).toBeEnabled();
    const downloading = page.waitForEvent('download'); await dialog.locator('[data-share=save]').click();
    await (await downloading).saveAs(resolve(OUT, `share-${players}p-${lang}.png`));
    await expect(dialog).toContainText('Mia');
    if (players === 2) await expect(dialog).toContainText('Kai');
    await dialog.locator('[data-share=close]').click();
  }
});

test('the share dialog offers the nickname as an optional press, and the card and dare pick it up', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => { if (!localStorage.getItem('silicon-rush.save.v1')) localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 1, language: 'en', volume: 0, muted: true, best: {} })); });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(async () => { await window.game.startRace({ trackId: 'synth-loop', car: 'sedan', slimeDensity: 'normal', ai: false, playerVehicles: ['micro-hatch'] }); });
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 15_000 }).toBe('racing');
  await page.evaluate(() => { const game = window.game as any; game.session.humans[0].race.time = 83.4; game.finish(83.4); });
  await page.getByRole('button', { name: 'Share my run' }).click();
  const dialog = page.locator('.share-dialog');
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  // Sharing needs no name: every share button works before the nickname is touched.
  await expect(dialog.locator('[data-share-name]')).toHaveCount(0);
  await dialog.locator('[data-share=name]').click();
  const field = dialog.locator('[data-share-name="0"]');
  await field.fill('Mia'); await field.press('Enter');
  await expect(dialog.locator('[data-share=name]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window.game as any).lastResult.name)).toBe('Mia');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('silicon-rush.save.v1')!).names)).toEqual(['Mia', '']);
  expect(await page.evaluate(() => (window.game as any).lastResult.challengeCode)).toContain('~Mia~');
  await page.screenshot({ path: resolve(OUT, 'share-dialog-name.png') });
  await dialog.locator('[data-share=close]').click();
  await expect(page.locator('[data-screen=results] .card-brand-wordmark').first()).toContainText('Mia');
});
