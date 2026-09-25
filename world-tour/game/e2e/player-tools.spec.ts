import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { evidencePath } from './evidence';

const out = evidencePath('player-tools');
test.describe.configure({ timeout: 180_000 });

for (const [name, viewport] of [['desktop', { width: 1280, height: 720 }], ['phone-landscape', { width: 844, height: 390 }]] as const) {
  test(`425 ${name}: no language button over the race, back on pause`, async ({ page }) => {
    mkdirSync(out, { recursive: true });
    await page.setViewportSize(viewport);
    await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
    await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan', slimeDensity: 'none', ai: false }));
    await page.locator('[data-screen=intro] .departure-go').click();
    await page.waitForFunction(() => ['countdown', 'racing'].includes(window.game.report().phase));
    await expect(page.locator('.player-tools')).toBeHidden();
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    await page.waitForTimeout(1500);
    await expect(page.locator('.player-tools')).toBeHidden();
    await page.screenshot({ path: `${out}/${name}-racing.png` });
    // The pause menu is a replica screen with its own language switch; the floating toolbar has
    // always been hidden behind those screens (game.css `.replica-screen:not([hidden]) ~ .player-tools`).
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.game.report().phase === 'paused');
    await expect(page.locator('[data-screen=pause] .lang-toggle')).toBeVisible();
    await page.screenshot({ path: `${out}/${name}-paused.png` });
    // The menu is a replica screen with its own language switch as well; it hides the floating
    // toolbar the same way, and it always did. Only the intro/first-drive screen shows the toolbar.
    await page.locator('[data-screen=pause] [data-action=quit]').click();
    await page.locator('dialog[open] [data-dialog-action=confirm]').click();
    await page.waitForFunction(() => window.game.report().phase === 'menu');
    await expect(page.locator('.sm .lang-toggle').first()).toBeVisible();
    expect(await page.evaluate(() => (document.querySelector('.player-tools') as HTMLElement).hidden)).toBe(false);
  });
}
