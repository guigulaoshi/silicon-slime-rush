import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePathOr } from './evidence';

/**
 * The Bay locator fills its card instead of a round "radar", the route's own drawing is
 * twice its old 78 px diameter, the dashed link reads as dashed, and the World step previews the
 * route picked on the Route step. MENU_ROUTE_BEFORE=1 captures the same screens without the checks.
 */
const BEFORE = process.env.MENU_ROUTE_BEFORE === '1';
const OUT = evidencePathOr(process.env.MENU_ROUTE_OUT, 'menu-route', BEFORE ? 'before' : 'after');

for (const language of ['en', 'zh'] as const) for (const [width, height] of [[1440, 900], [844, 390]] as const)
  test(`route and world steps ${language} ${width}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height });
    await page.addInitScript(language => localStorage.setItem('silicon-rush-world-tour.save.v1',
      JSON.stringify({ language, muted: true, reducedMotion: true })), language);
    await page.goto('/?dev=1');
    await page.locator('.home-go').click();
    await expect(page.locator('.sm-loc')).toBeVisible();
    await page.locator('[data-track="dubai"]').click();
    await expect(page.locator('.sm-item.sel')).toHaveAttribute('data-track', 'dubai');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(OUT, `route-${language}-${width}.png`) });
    if (!BEFORE) {
      const shape = await page.evaluate(() => {
        const loc = document.querySelector('.sm-loc')!, box = document.querySelector('.sm-locbox')!.getBoundingClientRect();
        const svg = loc.getBoundingClientRect(), circuit = { width: document.querySelector<HTMLElement>('.sm-circuitbox')!.offsetWidth };  // layout px: the menu canvas is scaled as a whole
        const leader = document.querySelector('.sm-leader');
        return { clipped: loc.querySelector('clipPath') !== null, ring: loc.querySelector('.sm-locring') !== null,
          fill: [svg.width / box.width, svg.height / box.height], circuit: circuit.width,
          dash: leader ? getComputedStyle(leader).strokeDasharray : null,
          leaderShown: leader ? getComputedStyle(leader.closest('svg')!).display !== 'none' : false };
      });
      expect(shape.clipped, 'the Bay is no longer clipped to a disc').toBe(false);
      expect(shape.ring).toBe(false);
      expect(shape.fill[0]).toBeGreaterThan(.98);
      expect(shape.fill[1]).toBeGreaterThan(.98);
      expect(shape.circuit, 'route drawing is twice the old 78 px, desktop and phone').toBeCloseTo(156, 0);
      if (width === 1440) {
        expect(shape.leaderShown).toBe(true);
        expect(shape.dash).toMatch(/^9(px)?,? 6(px)?$/);
      }
    }
    if (width !== 1440) return;
    for (const track of ['dubai', 'sydney']) {
      await page.locator(`[data-track="${track}"]`).click();
      await page.locator('.sm-go').click();
      const shot = page.locator('.sm-world-shot');
      if (!BEFORE) await expect(shot).toHaveAttribute('src', new RegExp(`menu/world/${track}/`));
      await expect.poll(() => shot.evaluate(image => (image as HTMLImageElement).complete
        && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(OUT, `world-${track}-${language}.png`) });
      await page.locator('.sm-back, [data-action="back"]').first().click();
      await expect(page.locator('.sm-loc')).toBeVisible();
    }
  });
