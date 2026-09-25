import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 180_000 });

const cases = [
  { name: 'desktop', width: 1280, height: 720, mobile: false },
  { name: 'desktop-narrow', width: 390, height: 844, mobile: false },
  { name: 'desktop-wide', width: 1920, height: 1080, mobile: false },
  { name: 'phone', width: 844, height: 390, mobile: true },
  { name: 'tablet', width: 1194, height: 834, mobile: true },
];
for (const device of cases) test(`${device.name} navigation expansion follows device identity`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: device.width, height: device.height },
    isMobile: device.mobile, hasTouch: device.mobile,
    ...(device.mobile ? { userAgent: `Mozilla/5.0 (${device.name === 'phone' ? 'iPhone' : 'iPad'}; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1` } : {}) });
  const page = await context.newPage();
  try {
    await page.goto('/?track=shoreline&bot=1&dev=1&time=day');
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    await expectWorldLoaded(page, device.name);
    const nav = page.locator('.hud-nav'); await expect(nav).toBeVisible();
    const small = (await nav.boundingBox())!;
    const directory = evidencePath('nav-expand'); mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, `${device.name}-normal.png`) });
    if (device.mobile) {
      await expect(nav).not.toHaveAttribute('role', 'button');
      await page.touchscreen.tap(small.x + small.width / 2, small.y + small.height / 2);
      const after = (await nav.boundingBox())!;
      expect(after.width).toBe(small.width); expect(after.height).toBe(small.height);
    } else {
      const start = await page.evaluate(() => window.game.report());
      await nav.click(); await expect(nav).toHaveAttribute('aria-pressed', 'true');
      const big = (await nav.boundingBox())!;
      expect(big.width).toBe(small.width * 2); expect(big.height).toBe(small.height * 2);
      expect(big.x).toBeGreaterThanOrEqual(0);
      expect(big.x + big.width).toBeLessThanOrEqual(device.width);
      expect(big.y + big.height).toBeLessThan(device.height - 60);
      const top = (await page.locator('.hud-top').boundingBox())!;
      expect(big.x >= top.x + top.width || big.y + big.height <= top.y || top.y + top.height <= big.y).toBe(true);
      await page.waitForFunction(([x, z]) => {
        const report = window.game.report();
        return Math.hypot(report.posX - x!, report.posZ - z!) > 1;
      }, [start.posX, start.posZ], { timeout: 10_000 });
      const after = await page.evaluate(() => window.game.report());
      expect(Math.hypot(after.posX - start.posX, after.posZ - start.posZ)).toBeGreaterThan(1);
      expect(after.resets).toBe(start.resets);
      await page.screenshot({ path: resolve(directory, `${device.name}-expanded.png`) });
      await nav.click(); await expect(nav).toHaveAttribute('aria-pressed', 'false');
      expect((await nav.boundingBox())!.width).toBe(small.width);
      await nav.focus(); await page.keyboard.press('Space');
      await expect(nav).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.down('Space'); await page.keyboard.down('Space');
      await expect(nav).toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.up('Space'); await page.keyboard.press('Space');
      await expect(nav).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Enter'); await expect(nav).toHaveAttribute('aria-pressed', 'false');
    }
  } finally { await context.close(); }
});
