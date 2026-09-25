import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { devices, expect, test, type CDPSession, type Frame, type Page } from '@playwright/test';
import { evidencePath } from './evidence';
import { BASE_URL } from './server';

// From the player's own iPad mini on the live build: pressing the drawn ◀ / ▶ did not steer,
// holding a control a while brought up the iOS long-press menu, and dragging did not steer inside
// itch.io's scrolling page. Chromium drives real multi-finger touch; WebKit checks the iPad layouts.
test.describe.configure({ timeout: 180_000 });
const out = evidencePath('ipad-touch');
const SAVE = JSON.stringify({ version: 3, language: 'en', muted: true, quality: 'high', slimeDensity: 'none', best: {}, touchGuideRaces: 3 });
const { defaultBrowserType: _ignored, ...ipadMini } = devices['iPad Mini landscape'];

type Game = Page | Frame;
const input = (game: Game) => game.evaluate(() => window.game.report().input as { steer: number; brake: number });
async function race(game: Game) {
  await game.waitForFunction(() => window.game?.report().phase === 'intro', null, { timeout: 90_000 });
  await game.locator('[data-screen="intro"] button').first().click();
  await game.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 60_000 });
}
const finger = (id: number, x: number, y: number) => ({ id, x, y, radiusX: 5, radiusY: 5, force: 1 });
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: ReturnType<typeof finger>[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

// Moved iPhone and iPad to two hold buttons, so the drag stick and its
// ◀ / ▶ ends (536) now live on Android only: the hold test below runs as an Android tablet, and the
// WebKit iPad layout checks that were here moved to ios-hold-steer.spec.ts. The host-page test
// keeps the iPad user agent, so it now holds the ◀ button inside a scrolling itch-like page.
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
test.describe('Android tablet drag stick in Chromium', () => {
  test.use({ ...ipadMini, userAgent: ANDROID_TABLET });
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', error => { throw error; });
    await page.addInitScript(save => localStorage.setItem('silicon-rush.save.v1', save), SAVE);
  });

  test('holding ◀ or ▶ steers for as long as it is held, alongside the brake, and dragging still steers', async ({ page }) => {
    await page.goto('/?track=shoreline&time=day');
    await race(page);
    const bar = (await page.locator('.touch-stick').boundingBox())!;
    const brake = (await page.locator('.touch-brake').boundingBox())!;
    const cy = bar.y + bar.height / 2, left = finger(1, bar.x + 14, cy), right = finger(1, bar.x + bar.width - 14, cy);
    const pedal = finger(2, brake.x + brake.width / 2, brake.y + brake.height / 2);
    const cdp = await page.context().newCDPSession(page);

    await touch(cdp, 'touchStart', [left]);
    await page.waitForFunction(() => window.game.report().input.steer === -1, null, { timeout: 5000 });
    await page.waitForTimeout(2500);                                   // a long press
    expect(await input(page), '◀ still held after 2.5 s').toMatchObject({ steer: -1 });
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction(() => window.game.report().input.steer === 0);

    await touch(cdp, 'touchStart', [right]);
    await page.waitForFunction(() => window.game.report().input.steer === 1);
    await touch(cdp, 'touchStart', [right, pedal]);
    await page.waitForFunction(() => window.game.report().input.brake === 1);
    await page.waitForTimeout(2500);
    expect(await input(page), '▶ and brake still held after 2.5 s').toMatchObject({ steer: 1, brake: 1 });
    mkdirSync(out, { recursive: true }); await page.screenshot({ path: resolve(out, 'chromium-ipad-mini-right-and-brake.png') });
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction(() => window.game.report().input.steer === 0 && window.game.report().input.brake === 0);

    // A thumb resting on the middle of the bar, off the knob, does not steer by itself.
    const resting = finger(1, bar.x + bar.width / 2 + 30, cy);
    await touch(cdp, 'touchStart', [resting]);
    await page.waitForTimeout(300);
    expect((await input(page)).steer, 'a thumb resting mid-bar steers nothing').toBe(0);
    await touch(cdp, 'touchMove', [{ ...resting, x: resting.x - 40 }]);
    await page.waitForFunction(() => window.game.report().input.steer < -.3);
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction(() => window.game.report().input.steer === 0);

    // A finger away from the bar is still the centre of a floating stick.
    const zone = (await page.locator('[data-touch-control="steer"]').boundingBox())!;
    const thumb = finger(1, bar.x + bar.width + 120, zone.y + zone.height / 2);
    await touch(cdp, 'touchStart', [thumb]);
    expect((await input(page)).steer, 'a press off the bar does not steer by itself').toBe(0);
    await touch(cdp, 'touchMove', [{ ...thumb, x: thumb.x - 40 }]);
    await page.waitForFunction(() => window.game.report().input.steer < -.3 && window.game.report().input.steer > -.7);
    await touch(cdp, 'touchEnd', []);
  });
});

test.describe('iPad in a scrolling host page in Chromium', () => {
  test.use({ ...ipadMini });
  // Chromium honours touch-action inside frames, so this passes with or without the touch
  // listeners: it guards against a regression here, it does not reproduce iOS Safari on itch.io.
  test.beforeEach(async ({ page }) => { page.on('pageerror', error => { throw error; }); });

  test('inside a scrolling host page, like itch.io on an iPad, holding ◀ steers and the host does not scroll', async ({ page }) => {
    // about:blank hosts a cross-origin frame, as itch.io hosts the game from its own CDN domain.
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0"><div style="height:60px">host</div>
      <iframe id="game" src="${BASE_URL}/?track=shoreline&time=day" width="960" height="540"
        allow="autoplay; fullscreen *; geolocation; microphone; camera; midi; monetization; xr-spatial-tracking; gamepad; gyroscope; accelerometer; xr; cross-origin-isolated; web-share"
        style="border:0;display:block"></iframe><div style="height:2500px">more host page</div></body>`);
    const frame = page.frameLocator('#game').owner();
    const game = (await (await frame.elementHandle())!.contentFrame())!;
    await game.evaluate(save => localStorage.setItem('silicon-rush.save.v1', save), SAVE);
    await game.goto(`${BASE_URL}/?track=shoreline&time=day`);
    await race(game);
    const cdp = await page.context().newCDPSession(page);
    // Real touch scroll gestures (touch events plus the browser's own scrolling), not bare touch events.
    const swipe = (x: number, y: number, xDistance: number, yDistance: number) => cdp.send('Input.synthesizeScrollGesture',
      { x, y, xDistance, yDistance, gestureSourceType: 'touch', speed: 400, preventFling: true });
    // Positive control: a swipe on the host page outside the game does scroll it.
    // Chromium takes the frame fullscreen on the first tap; a player who leaves it (or an iPad that
    // never enters it) is back in the scrolling host page, which is the case this checks.
    await game.evaluate(() => document.fullscreenElement && document.exitFullscreen());
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await swipe(500, 690, 0, -150);   // CDP gestures must stay inside the 1280x720 headless window
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(40);
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    // The same swipe, now diagonal, starting on the ◀ hold button: it steers and the host stays put.
    await game.evaluate(() => {
      (window as any).leftmost = 0;
      const sample = () => { (window as any).leftmost = Math.min((window as any).leftmost, window.game.report().input.steer); requestAnimationFrame(sample); };
      sample();
    });
    await swipe(100, 60 + 470, -60, -150);
    expect(await game.evaluate(() => (window as any).leftmost), 'the drag steered left').toBeLessThan(-.5);
    expect(await page.evaluate(() => scrollY), 'the host page stayed put').toBe(0);
    await game.waitForFunction(() => window.game.report().input.steer === 0);
  });
});
