import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Loads a real world and completes the short synthetic course before rotating results.
test.describe.configure({ timeout: 120_000 });

const shots = evidencePath('mobile');
async function shot(page: Page, name: string) {
  mkdirSync(shots, { recursive: true }); await page.screenshot({ path: resolve(shots, `${name}.png`) });
}
async function finger(page: Page, type: string) {
  await page.locator('[data-touch-control="brake"]').dispatchEvent(type, {
    pointerId: 7, pointerType: 'touch', bubbles: true,
  });
}

test.describe('phone landscape', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 844, height: 390 } });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      version: 1, language: 'en', quality: 'high', muted: true, best: {},
    })));
    page.on('pageerror', error => { throw error; });
  });

  test('gates portrait and keeps menu steps and launch accessible in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
    await expect(page.locator('#landscape-guard')).toBeVisible();
    await expect(page.locator('#landscape-guard')).toContainText('Turn your device sideways');
    expect(await page.locator('#ui').evaluate(node => (node as HTMLElement).inert)).toBe(true);
    await shot(page, 'portrait');
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#landscape-guard')).toBeHidden();
    await page.locator('.home-go').click();
    await shot(page, 'menu');
    for (const next of ['1', '2']) {
      await page.locator('.sm-go').click(); await expect(page.locator('.sm')).toHaveAttribute('data-step', next);
      const bounds = await page.locator('.sm-go').boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(391);
      await shot(page, `menu-${next}`);
    }
    await page.locator('.sm-go').click();
    await page.waitForFunction(() => ['countdown','racing'].includes(window.game?.report().phase));
    await shot(page, 'countdown');
  });

  test('rotation pauses, clears held touch, preserves progress and waits for explicit resume', async ({ page }) => {
    await page.goto('/?track=shoreline&bot=1&dev=1&speed=6');
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    await finger(page, 'pointerdown');
    await page.waitForFunction(() => window.game.report().input.brake === 1);
    await expect(page.locator('.hud-pause')).toBeVisible();
    for (const hud of await page.locator('#hud > .player-hud:visible').all()) {
      for (const selector of ['.hud-map', '.hud-nav', '.hud-pause', '.hud-speed']) {
        const box = await hud.locator(selector).boundingBox();
        expect(box, selector).not.toBeNull();
        expect(box!.x, selector).toBeGreaterThanOrEqual(0); expect(box!.y, selector).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, selector).toBeLessThanOrEqual(845);
        expect(box!.y + box!.height, selector).toBeLessThanOrEqual(391);
      }
    }
    await shot(page, 'hud');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#landscape-guard')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('paused');
    const frozen = await page.evaluate(() => window.game.report());
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.game.report().time)).toBe(frozen.time);
    expect(await page.evaluate(() => window.game.report().input.brake)).toBe(0);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#landscape-guard')).toBeHidden();
    expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
    expect(await page.evaluate(() => window.game.report().progress)).toBe(frozen.progress);
    await shot(page, 'paused');
    await page.locator('[data-action="resume"]').click();
    await page.waitForFunction(time => window.game.report().time > time, frozen.time);
    expect(await page.evaluate(() => window.game.report().resets)).toBe(frozen.resets);
  });

  test('keeps the completed race and results when rotated', async ({ page }) => {
    await page.goto('/?track=synth-p2p&bot=1&dev=1&speed=6');
    await page.waitForFunction(() => window.game?.report().phase === 'results', null, { timeout: 90_000 });
    await shot(page, 'results');
    const time = await page.evaluate(() => window.game.report().time);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#landscape-guard')).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#landscape-guard')).toBeHidden();
    expect(await page.evaluate(() => window.game.report().phase)).toBe('results');
    expect(await page.evaluate(() => window.game.report().time)).toBe(time);
  });
});

test('a narrow desktop window can still drive without a rotation gate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?track=synth-p2p&bot=1&dev=1&speed=6');
  await expect(page.locator('#landscape-guard')).toBeHidden();
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
});
