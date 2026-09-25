import { chromium, expect, firefox, test, webkit, type BrowserType } from '@playwright/test';
import { BASE_URL } from './server';

/**
 * The same short drive in each engine the game claims to support.
 *
 * It is deliberately short. What differs between engines is not the physics, it is whether the
 * page loads, whether the compressed geometry decodes, and whether WebGL and audio come up at all,
 * and all of that fails inside the first few seconds or not at all.
 */

// 这个文件真的要开车，所以自己申请预算：默认档是 90 秒（playwright.config.ts），
// 那是「问浏览器一个问题」的价钱。在两个浏览器引擎里各加载一次合成赛道。
test.describe.configure({ timeout: 180_000 });
const ENGINES: [string, BrowserType][] = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

for (const [name, engine] of ENGINES) {
  test(`${name} loads the menu and drives`, async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const browser = await engine.launch(name === 'firefox'
        ? { firefoxUserPrefs: { 'webgl.disabled': false, 'webgl.force-enabled': true } } : undefined);
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      try {
        await page.goto(`${BASE_URL}/?dev=1`);
        const startupFailure = page.locator('#startup[data-failed="true"]');
        await Promise.race([
          page.locator('.home-go').waitFor({ state: 'visible', timeout: 30_000 }),
          startupFailure.waitFor({ state: 'visible', timeout: 30_000 }),
        ]);
        if (await startupFailure.isVisible()) {
          const message = await startupFailure.getByRole('status').textContent();
          const reason = await startupFailure.getAttribute('data-failure');
          if (reason === 'graphics' && attempt === 0) continue;
          throw new Error(`${name} ${reason ?? 'unknown'} startup failed${attempt ? ' twice' : ''}: ${message}`);
        }
        await page.locator('.home-go').click();
        await expect(page).toHaveTitle(/^Silicon Slime Rush$/);
        /* */
        await expect(page.locator('.sm-item').first()).toBeVisible({ timeout: 30_000 });

        await page.goto(`${BASE_URL}/?track=synth-p2p&bot=1&dev=1`);
        await page.waitForFunction(() => window.game?.report().track != null, null, { timeout: 90_000 });
        await page.waitForFunction(() => window.game.report().progress > 60, null, { timeout: 120_000, polling: 500 });
        const report = await page.evaluate(() => window.game.report());
        expect(report.tiles?.failed ?? 0, 'tiles must decode').toBe(0);
        expect(report.speedKmh).toBeGreaterThan(5);
        expect(errors, errors.join('\n')).toHaveLength(0);
        console.log(`${name}: ${report.progress.toFixed(0)} m, ${report.speedKmh.toFixed(0)} km/h, `
          + `${report.tiles?.loaded} tiles`);
        return;
      } finally {
        await browser.close();
      }
    }
  });
}
