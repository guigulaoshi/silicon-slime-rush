import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = evidencePath('settings');
test.beforeEach(() => mkdirSync(out, { recursive: true }));
for (const locale of ['zh-TW', 'en-US', 'fr-FR']) test(`first visit uses ${locale} and remembers a manual language`, async ({ browser }) => {
  const context = await browser.newContext({ locale }); const page = await context.newPage();
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  const expected = locale.startsWith('zh') ? 'zh' : 'en';
  await expect(page.locator('html')).toHaveAttribute('lang', expected);
  await page.locator('.home-language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', expected === 'zh' ? 'en' : 'zh');
  await page.reload(); await page.waitForFunction(() => window.game);
  await expect(page.locator('html')).toHaveAttribute('lang', expected === 'zh' ? 'en' : 'zh');
  await context.close();
});
test('settings persist, help follows both drivers, language does not restart a race', async ({ page }) => {
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.locator('.home-go').click();
  await page.locator('.sm').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('[data-screen=settings] [data-setting=reducedMotion]').selectOption('on');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  await page.reload(); await page.waitForFunction(() => window.game);
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  await page.evaluate(() => window.game.startRace({ trackId: 'synth-loop', car: 'sedan', slimeDensity: 'normal', playerVehicles: ['micro-hatch', 'city-pod'], ai: false }));
  await expect(page.locator('.first-drive-tip')).toBeVisible();
  await page.locator('.player-tools > button').nth(1).click();
  await expect(page.locator('.driving-help')).toContainText('WASD'); await expect(page.locator('.driving-help')).toContainText('/');
  await page.screenshot({ path: resolve(out, 'dual-help.png') });
  await page.locator('.driving-help .modal-header button').click();
  await page.locator('.first-drive-tip button').click();
  await expect(page.locator('.first-drive-tip')).toBeHidden();
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 15_000 }).toBe('racing');
  // Nothing floats over the race; the language switch lives on the pause menu, and
  // switching there must not restart the race or drop a driver.
  await expect(page.locator('.player-tools')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('paused');
  await page.locator('[data-screen=pause] .lang-toggle').click();
  expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
  expect(await page.evaluate(() => window.game.report().players.length)).toBe(2);
  await page.screenshot({ path: resolve(out, 'dual-language.png') });
  await page.locator('[data-screen=pause] [data-action=resume]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('racing');
  expect(await page.evaluate(() => window.game.report().players.length)).toBe(2);
});
test('startup language survives denied storage', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('denied'); }; });
  let release!: () => void; const held = new Promise<void>(r => { release = r; });
  await page.route('**/assets/main-*.js', async route => { await held; await route.continue(); });
  await page.goto('/?dev=1', { waitUntil: 'commit' });
  await page.locator('.startup-language').click();
  const language = await page.locator('html').getAttribute('lang');
  release(); await page.waitForFunction(() => window.game);
  await expect(page.locator('html')).toHaveAttribute('lang', language!);
  // The title text lives in the locale file (app.title); derive the expected brand strings from
  // there instead of pasting a copy, so a future rename does not need two edits.
  const messages = JSON.parse(readFileSync(`src/ui/locales/${language}.json`, 'utf8')) as Record<string, string>;
  const appTitle = messages['app.title']!;
  await expect(page.locator('.home-title')).toHaveAttribute('aria-label', language === 'zh' ? appTitle : appTitle.toUpperCase());
  // The wordmark is always the English name (renderBrandSignature keeps it untranslated), so its
  // expectation always comes from en.json even when the page itself is in zh.
  const enTitle = (JSON.parse(readFileSync('src/ui/locales/en.json', 'utf8')) as Record<string, string>)['app.title']!;
  await expect(page.locator('.home-title .brand-wordmark')).toHaveText(enTitle.replace(':', ''));
});
test('help consumes gamepad confirm and Start without starting a drive', async ({ page }) => {
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan', slimeDensity: 'normal', ai: false }));
  await page.locator('.player-tools > button').nth(1).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, axes: [0, 0], buttons: Array.from({length: 16}, (_, i) => ({ pressed: i === 0, value: i === 0 ? 1 : 0 })) }] });
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('intro');
  await expect(page.locator('.driving-help')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, axes: [0, 0], buttons: Array.from({length: 16}, (_, i) => ({ pressed: i === 9, value: i === 9 ? 1 : 0 })) }] });
  });
  await expect(page.locator('.driving-help')).toBeHidden();
  expect(await page.evaluate(() => window.game.report().phase)).toBe('intro');
});
test('phone help uses touch controls and saved motion preference covers loading', async ({ browser }) => {
  const context = await browser.newContext({ viewport: {width: 844, height: 390}, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ reducedMotion: true })));
  let release!: () => void; const held = new Promise<void>(r => { release = r; });
  await page.route('**/tracks/synth-p2p/track.json', async route => { await held; await route.continue(); });
  await page.goto('/?dev=1&track=synth-p2p');
  const mark = page.locator('[data-screen=boot] .loading-bar');
  await expect(mark).toBeVisible();
  expect(await mark.evaluate(node => node.getAnimations({subtree: true}).length)).toBe(0);
  await page.screenshot({path: resolve(out, 'phone-loading-static.png')});
  release(); await expect(page.locator('[data-screen=intro]')).toBeVisible();
  await expect(page.locator('.first-drive-tip')).not.toContainText('WASD');
  await page.locator('.player-tools > button').nth(1).click();
  await page.screenshot({path: resolve(out, 'phone-help.png')});
  await page.locator('.driving-help .modal-header button').click();
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), {timeout: 15_000}).toBe('racing');
  await expect(page.locator('.hud-pause')).toBeVisible();
  await expect(page.locator('[data-screen=hud]')).not.toContainText('WASD');
  await page.screenshot({path: resolve(out, 'phone-driving.png')});
  // The toolbar is gone while driving, so it cannot overlap the HUD any more.
  await expect(page.locator('.player-tools')).toBeHidden();
  await context.close();
});
test('portrait rotation instructions keep language accessible', async ({ browser }) => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, locale: 'en-US'});
  const page = await context.newPage(); await page.goto('/');
  await expect(page.locator('.orientation-language')).toBeVisible();
  await page.locator('.orientation-language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
  await page.screenshot({path: resolve(out, 'portrait-language.png')});
  await context.close();
});
