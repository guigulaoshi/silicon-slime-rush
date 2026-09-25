import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { evidencePath } from './evidence';

// The pause and settings dimming sat inside #ui, which gives way to the phone's safe area,
// so a strip of undimmed road showed along the camera cutout (fullscreen) or the gesture bar (with
// the browser's bars). The dimming now reaches every edge; the buttons stay inside the safe area.
test.describe.configure({ timeout: 120_000 });
const out = evidencePath('pause-backdrop');

/** Mean brightness of a strip of the screenshot, 0..255, read in the page from a PNG. */
async function brightness(page: Page, png: Buffer, box: { x: number; y: number; w: number; h: number }) {
  return page.evaluate(async ({ data, box }) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const px = ctx.getImageData(box.x, box.y, box.w, box.h).data;
    let sum = 0; for (let i = 0; i < px.length; i += 4) sum += (px[i]! + px[i + 1]! + px[i + 2]!) / 3;
    return sum / (px.length / 4);
  }, { data: png.toString('base64'), box });
}

test.describe('pause dimming on a phone with safe-area insets', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 891, height: 411 } });
  for (const inset of [{ name: 'fullscreen camera cutout', left: 40, bottom: 0 }, { name: 'browser bars gesture strip', left: 0, bottom: 24 }]) {
    test(inset.name, async ({ page }) => {
      page.on('pageerror', error => { throw error; });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { left: inset.left, bottom: inset.bottom } } as never);
      await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
        version: 3, language: 'en', muted: true, quality: 'high', slimeDensity: 'none', best: {},
      })));
      // Retargeted from shoreline (deleted, "an open flat campus route"): lhasa is the new
      // flat, day track (a boulevard through a high valley), same quick, uncluttered load.
      await page.goto('/?track=lhasa&time=day');
      await page.waitForFunction(() => window.game?.report().phase === 'intro');
      await page.locator('[data-screen="intro"] button').first().tap();
      await page.waitForFunction(() => window.game.report().phase === 'racing');
      // Brightness of the unpaused road where the strip will be, for scale.
      const strip = inset.left ? { x: 4, y: 150, w: inset.left - 8, h: 200 } : { x: 100, y: 411 - inset.bottom + 4, w: 690, h: inset.bottom - 8 };
      const inner = inset.left ? { x: inset.left + 8, y: 150, w: inset.left - 8, h: 200 } : { x: 100, y: 411 - inset.bottom - 28, w: 690, h: inset.bottom - 8 };
      await page.locator('.hud-pause').tap();
      await page.waitForFunction(() => window.game.report().phase === 'paused');
      await page.waitForTimeout(400);
      const shot = await page.screenshot();
      mkdirSync(out, { recursive: true }); await page.screenshot({ path: resolve(out, `${inset.name.replace(/ /g, '-')}.png`) });
      const edge = await brightness(page, shot, strip), inside = await brightness(page, shot, inner);
      console.log(inset.name, { edge, inside });
      expect(edge, 'the safe-area strip is dimmed like the rest of the screen').toBeLessThan(inside + 12);
      // The menu itself stays out of the safe area.
      const buttons = await page.locator('[data-screen="pause"] button:visible').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect()).map(b => ({ l: b.left, b: b.bottom })));
      expect(buttons.length).toBeGreaterThan(3);
      for (const b of buttons) {
        expect(b.l).toBeGreaterThanOrEqual(inset.left);
        expect(b.b).toBeLessThanOrEqual(411 - inset.bottom);
      }
      // Settings opened from the pause sits over the pause's dimming.
      await page.locator('[data-screen="pause"] [data-action="settings"]').tap();
      await page.waitForFunction(() => window.game.report().phase === 'settings');
      await page.waitForTimeout(400);
      const settings = await page.screenshot();
      await page.screenshot({ path: resolve(out, `${inset.name.replace(/ /g, '-')}-settings.png`) });
      const settingsEdge = await brightness(page, settings, strip), settingsInside = await brightness(page, settings, inner);
      console.log(inset.name, 'settings', { settingsEdge, settingsInside });
      expect(settingsEdge, 'settings: the safe-area strip is dimmed too').toBeLessThan(settingsInside + 12);
    });
  }
});
