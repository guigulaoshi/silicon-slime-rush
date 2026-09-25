import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { evidencePath } from './evidence';

// On a short landscape phone screen (iPhone Safari with its bars, an Android phone that is
// not fullscreen) the drawn brake pedal rose out of its touch zone and over the speedometer, so a
// thumb on the pedal's centre did not brake. Each size is checked once, on the one short track
// (giza, 1957 m -- the shortest remaining route now that rio is deleted along with machu-picchu
//Game/public/tracks/giza/track.json spline.length).
test.describe.configure({ timeout: 120_000 });
const out = evidencePath('brake-short-screen');

const sizes = [
  { name: 'Pixel 7 Pro Chrome, not fullscreen', width: 850, height: 327, bottomInset: 24 },
  { name: 'iPhone 13 Safari with bars', width: 750, height: 342, bottomInset: 0 },
  { name: 'iPhone SE Safari with bars', width: 568, height: 320, bottomInset: 0 },
  { name: 'Android fullscreen', width: 891, height: 411, bottomInset: 0 },
];

async function layout(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const b = document.querySelector(selector)!.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
    };
    const pedal = box('.touch-brake'), zone = box('.touch-brake-zone'), speed = box('#hud .hud-speed');
    const hit = document.elementFromPoint(pedal.left + pedal.width / 2, pedal.top + pedal.height / 2);
    const upper = document.elementFromPoint(pedal.left + pedal.width / 2, pedal.top + 4);
    return {
      pedal, zone, speed, view: [innerWidth, innerHeight],
      centreBrakes: !!hit?.closest('[data-touch-control="brake"]'),
      topEdgeBrakes: !!upper?.closest('[data-touch-control="brake"]'),
    };
  });
}

test.describe('brake pedal on short phone screens', () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const size of sizes) test(`${size.name} ${size.width}x${size.height}`, async ({ page }) => {
    page.on('pageerror', error => { throw error; });
    await page.setViewportSize({ width: size.width, height: size.height });
    if (size.bottomInset) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { bottom: size.bottomInset } } as never);
    }
    await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
      version: 3, language: 'en', muted: true, quality: 'high', slimeDensity: 'none', best: {},
    })));
    await page.goto('/?track=giza&time=day');
    await page.waitForFunction(() => window.game?.report().phase === 'intro');
    await page.locator('[data-screen="intro"] button').first().tap();
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    const r = await layout(page);
    mkdirSync(out, { recursive: true });
    await page.screenshot({ path: resolve(out, `${size.width}x${size.height}.png`) });
    expect(r.pedal.top, 'pedal top inside the brake zone').toBeGreaterThanOrEqual(r.zone.top);
    expect(r.pedal.bottom, 'pedal bottom inside the brake zone').toBeLessThanOrEqual(r.zone.bottom);
    expect(r.centreBrakes, 'a thumb on the pedal centre lands on the brake zone').toBe(true);
    expect(r.topEdgeBrakes, 'a thumb on the pedal top edge lands on the brake zone').toBe(true);
    expect(r.pedal.top, 'pedal clears the speedometer').toBeGreaterThanOrEqual(r.speed.bottom);
    expect(r.zone.top, 'brake zone does not reach over the speedometer').toBeGreaterThanOrEqual(r.speed.bottom);
    expect(r.pedal.bottom, 'pedal stays on screen').toBeLessThanOrEqual(size.height - size.bottomInset);
    expect(r.pedal.height, 'pedal stays a comfortable thumb target').toBeGreaterThanOrEqual(64);
    // And the real input path: a finger on the pedal centre brakes.
    const cdp = await page.context().newCDPSession(page);
    const finger = { id: 3, x: r.pedal.left + r.pedal.width / 2, y: r.pedal.top + r.pedal.height / 2, radiusX: 5, radiusY: 5, force: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
    await page.waitForFunction(() => window.game.report().input.brake === 1);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => window.game.report().input.brake === 0);
  });
});
