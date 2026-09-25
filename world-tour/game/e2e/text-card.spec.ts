import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.describe.configure({timeout: 120_000});
for (const mobile of [false, true]) test.describe(mobile ? 'touch phone' : 'desktop', () => {
  test.use({isMobile: mobile, hasTouch: mobile, viewport: mobile ? {width: 844, height: 390} : {width: 1280, height: 720}});
test('copies localized independent driver cards and shows clipboard failure', async ({page, context}) => {
  const out = evidencePath('text-card');
  mkdirSync(out, {recursive: true});
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  await page.evaluate(async () => {
    await window.game.startRace({trackId: 'synth-loop', car: 'sedan', slimeDensity: 'normal', ai: false,
      playerVehicles: ['micro-hatch', 'city-pod']});
  });
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), {timeout: 15_000}).toBe('racing');
  await page.evaluate(() => {
    // Finish fixture after a real world load; no full-route driving claim.
    const game = window.game as any;
    const [a, b] = game.session.humans;
    a.race.time = 125.25; a.race.hitSlime('fixture-red', [2, 2, 2], 'burst');
    if (b) { b.race.time = 150; b.race.hitSlime('fixture-blue', [2, 2, 2], 'colossus'); }
    a.race.sections[0] = {seconds: 10, distance: 10};
    if (b) b.race.sections[0] = {seconds: 10, distance: 100};
    game.finish(a.race.time);
  });
  await page.getByRole('button', {name: 'Copy text card', exact: true}).click();
  await expect(page.locator('[data-screen=results] [role=status]')).toContainText('copied');
  const en = await page.evaluate(() => navigator.clipboard.readText());
  expect(en).toContain('⬛×1'); if (!mobile) expect(en).toContain('🟦×1');
  expect(en).toContain('2:05.25'); if (!mobile) expect(en).toContain('2:30.00');
  await page.screenshot({path: resolve(out, mobile ? 'touch-en.png' : 'desktop-en.png')});
  await page.setViewportSize({width: 844, height: 390});
  await page.evaluate(() => { const game = window.game as any; game.i18n.set('zh'); game.views.results.render(); });
  await page.getByRole('button', {name: '复制文字卡', exact: true}).click();
  const zh = await page.evaluate(() => navigator.clipboard.readText());
  expect(zh).not.toBe(en); expect(zh).toContain('⬛×1');
  const button = await page.getByRole('button', {name: '复制文字卡', exact: true}).boundingBox();
  expect(button!.y).toBeGreaterThanOrEqual(0); expect(button!.y + button!.height).toBeLessThanOrEqual(390);
  await page.screenshot({path: resolve(out, mobile ? 'touch-zh.png' : 'phone-zh.png')});
  // Both routes refused: the failure note stays honest.
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
    writeText: async () => {throw new Error('denied');},
  }}); Object.defineProperty(document, 'execCommand', {configurable: true, value: () => false}); });
  await page.getByRole('button', {name: '复制文字卡', exact: true}).click();
  await expect(page.locator('[data-screen=results] [role=status]')).toContainText('未能复制');
  writeFileSync(resolve(out, mobile ? 'touch-cards.json' : 'cards.json'), JSON.stringify({fixture: true, clipboard: 'Chromium clipboard write/read with granted permissions; denial stubbed', en, zh}, null, 2));
});
});
