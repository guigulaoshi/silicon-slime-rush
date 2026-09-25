import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { devices, expect, test, webkit, type CDPSession, type Page } from '@playwright/test';
import { evidencePath } from './evidence';
import { BASE_URL } from './server';

// IPhone and iPad now steer with two hold buttons built like
// the brake; Android keeps the drag stick.
test.describe.configure({ timeout: 180_000 });
const out = evidencePath('ios-hold-steer');
const SAVE = JSON.stringify({ version: 3, language: 'en', muted: true, quality: 'high', slimeDensity: 'none', best: {}, touchGuideRaces: 3 });
const strip = <T extends { defaultBrowserType?: unknown }>({ defaultBrowserType: _d, ...rest }: T) => rest;

async function race(page: Page) {
  await page.addInitScript(save => localStorage.setItem('silicon-rush-world-tour.save.v1', save), SAVE);
  // Any real track works here -- this file only exercises touch input, not route geometry.
  // shoreline (open flat campus route) -> lhasa, the closest new-track equivalent.
  await page.goto(`${BASE_URL}/?track=lhasa&time=day`);
  await page.waitForFunction(() => window.game?.report().phase === 'intro', null, { timeout: 90_000 });
  await page.locator('[data-screen="intro"] button').first().click();
  await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 60_000 });
}
const input = (page: Page) => page.evaluate(() => window.game.report().input as { steer: number; brake: number });
const box = (page: Page, s: string) => page.locator(s).first().evaluate(n => {
  const b = n.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom };
});
type Box = Awaited<ReturnType<typeof box>>;
const overlaps = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
/**
 * WebKit's driver can only tap, so a hold is a touch sequence dispatched on the drawn button, as
 * Safari's own would be, followed by what Safari in itch.io's frame is suspected of sending: a
 * pointercancel and a lostpointercapture right after the press. The button must stay held anyway.
 */
const SELECTOR = { left: '.touch-hold-left .touch-hold', right: '.touch-hold-right .touch-hold', brake: '.touch-brake' } as const;
const press = (page: Page, control: keyof typeof SELECTOR, id: number) => page.evaluate(({ selector, id }) => {
  const button = document.querySelector(selector)!;
  const event = new Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'changedTouches', { value: [{ identifier: id }] });
  button.dispatchEvent(event);
  for (const type of ['pointercancel', 'lostpointercapture']) {
    for (const target of [button, button.parentElement!, window]) target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', bubbles: true }));
  }
  return event.defaultPrevented;
}, { selector: SELECTOR[control], id });
const release = (page: Page, control: keyof typeof SELECTOR, id: number) => page.evaluate(({ selector, id }) => {
  const event = new Event('touchend', { bubbles: true });
  Object.defineProperty(event, 'changedTouches', { value: [{ identifier: id }] });
  document.querySelector(selector)!.dispatchEvent(event);
}, { selector: SELECTOR[control], id });

for (const [name, profile] of [
  ['iPad Mini landscape', devices['iPad Mini landscape']],
  ['iPhone 13 Safari with bars', devices['iPhone 13 landscape']],
  ['iPhone SE Safari with bars', devices['iPhone SE landscape']],
] as const) test(`WebKit ${name}: hold ◀ / ▶ steers, alongside the brake`, async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage(strip(profile));
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await race(page);
    await expect(page.locator('.touch-controls')).toHaveAttribute('data-steer', 'buttons');
    await expect(page.locator('.touch-stick')).toHaveCount(0);
    await expect(page.locator('.touch-hold')).toHaveCount(2);
    const { width, height } = page.viewportSize()!;
    const left = await box(page, '.touch-hold-left .touch-hold'), right = await box(page, '.touch-hold-right .touch-hold');
    const leftZone = await box(page, '.touch-hold-left'), rightZone = await box(page, '.touch-hold-right');
    const brakeZone = await box(page, '.touch-brake-zone'), speed = await box(page, '#hud .hud-speed');
    const pause = await box(page, '#hud .hud-pause'), board = await box(page, '#hud .hud-top');
    for (const [button, zone] of [[left, leftZone], [right, rightZone]] as const) {
      expect(button.t).toBeGreaterThanOrEqual(zone.t); expect(button.b).toBeLessThanOrEqual(zone.b);
      expect(button.l).toBeGreaterThanOrEqual(zone.l); expect(button.r).toBeLessThanOrEqual(zone.r);
      expect(button.b).toBeLessThanOrEqual(height); expect(button.b - button.t).toBeGreaterThanOrEqual(64);
      for (const other of [speed, pause, board, brakeZone]) expect(overlaps(zone, other), `${name}: hold zone clear of HUD`).toBe(false);
    }
    // iPad keeps the full minimap: the speedometer sits under it, and the brake zone under that (after launch).
    const map = await box(page, '#hud .hud-nav');
    expect(overlaps(speed, map), `${name}: speedometer clear of the minimap`).toBe(false);
    expect(overlaps(brakeZone, speed), `${name}: brake zone clear of the speedometer`).toBe(false);
    expect(left.r).toBeLessThan(right.l);
    expect(rightZone.r).toBeLessThan(width / 2);
    mkdirSync(out, { recursive: true }); await page.screenshot({ path: resolve(out, `webkit-${name.replace(/\W+/g, '-')}.png`) });
    // A real WebKit tap on ◀: its touchstart comes back cancelled, so iOS gets no gesture to start.
    await page.evaluate(() => {
      (window as any).touchStarts = [];
      window.addEventListener('touchstart', e => (window as any).touchStarts.push(e.defaultPrevented), { passive: true });
    });
    await page.touchscreen.tap((left.l + left.r) / 2, (left.t + left.b) / 2);
    expect(await page.evaluate(() => (window as any).touchStarts)).toEqual([true]);
    for (const [control, steer] of [['left', -1], ['right', 1]] as const) {
      expect(await press(page, control, 11), 'the button cancels its own touchstart').toBe(true);
      await page.waitForFunction(s => window.game.report().input.steer === s, steer);
      await expect(page.locator(`.touch-hold-${control}`)).toHaveAttribute('data-held', 'true');
      await page.waitForTimeout(1200);
      expect((await input(page)).steer, `${control} at 1.2 s`).toBe(steer);
      await page.waitForTimeout(1300);
      expect((await input(page)).steer, `${control} at 2.5 s`).toBe(steer);
      await release(page, control, 11);
      await page.waitForFunction(() => window.game.report().input.steer === 0);
    }
    // The drawn button is the whole hit area: the empty part of its zone does nothing.
    const hit = await page.evaluate(() => {
      const zone = document.querySelector('.touch-hold-left')!.getBoundingClientRect();
      return document.elementFromPoint(zone.left + 4, zone.top + 4)?.closest('.touch-controls') !== null;
    });
    expect(hit, 'the empty zone passes touches through').toBe(false);
    // One thumb on ◀, the other on the brake.
    await press(page, 'left', 11); await press(page, 'brake', 12);
    await page.waitForFunction(() => window.game.report().input.steer === -1 && window.game.report().input.brake === 1);
    await page.screenshot({ path: resolve(out, `webkit-${name.replace(/\W+/g, '-')}-left-and-brake.png`) });
    await page.waitForTimeout(1000);
    expect(await input(page)).toMatchObject({ steer: -1, brake: 1 });
    await release(page, 'left', 11); await release(page, 'brake', 12);
    await page.waitForFunction(() => window.game.report().input.steer === 0 && window.game.report().input.brake === 0);
    expect(errors, errors.join('\n')).toHaveLength(0);
  } finally {
    await browser.close();
  }
});

const finger = (id: number, x: number, y: number) => ({ id, x, y, radiusX: 5, radiusY: 5, force: 1 });
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: ReturnType<typeof finger>[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

test.describe('iPadOS desktop user agent in Chromium, real two-finger touch', () => {
  // iPadOS Safari says it is a Mac; five touch points give it away. Chromium carries real touches.
  test.use({ ...strip(devices['iPad Mini landscape']),
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15' });
  test('holding ◀ with one thumb and the brake with the other keeps both for 2.5 s', async ({ page }) => {
    page.on('pageerror', error => { throw error; });
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 }));
    await race(page);
    await expect(page.locator('.touch-controls')).toHaveAttribute('data-steer', 'buttons');
    const left = (await page.locator('.touch-hold-left .touch-hold').boundingBox())!;
    const right = (await page.locator('.touch-hold-right .touch-hold').boundingBox())!;
    const brake = (await page.locator('.touch-brake').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const l = finger(1, left.x + left.width / 2, left.y + left.height / 2), r = finger(1, right.x + right.width / 2, right.y + right.height / 2);
    const b = finger(2, brake.x + brake.width / 2, brake.y + brake.height / 2);
    await touch(cdp, 'touchStart', [l]);
    await touch(cdp, 'touchStart', [l, b]);
    await page.waitForFunction(() => window.game.report().input.steer === -1 && window.game.report().input.brake === 1, null, { timeout: 5000 });
    await page.waitForTimeout(2500);
    expect(await input(page)).toMatchObject({ steer: -1, brake: 1 });
    // A thumb that slides a little while holding stays on its button.
    await touch(cdp, 'touchMove', [{ ...l, x: l.x + 12, y: l.y - 10 }, b]);
    await page.waitForTimeout(300);
    expect((await input(page)).steer).toBe(-1);
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction(() => window.game.report().input.steer === 0 && window.game.report().input.brake === 0);
    await touch(cdp, 'touchStart', [r]);
    await page.waitForFunction(() => window.game.report().input.steer === 1, null, { timeout: 5000 });
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction(() => window.game.report().input.steer === 0);
    // What Safari in itch.io's frame is suspected of sending right after the press: the pointer path
    // released the controls on these, the native touch path keeps them until the finger lifts.
    await touch(cdp, 'touchStart', [l]);
    await touch(cdp, 'touchStart', [l, b]);
    await page.waitForFunction(() => window.game.report().input.steer === -1 && window.game.report().input.brake === 1, null, { timeout: 5000 });
    await page.evaluate(() => {
      for (const selector of ['.touch-hold-left .touch-hold', '.touch-brake']) {
        const button = document.querySelector(selector)!;
        for (const type of ['pointercancel', 'lostpointercapture']) for (let id = 0; id < 8; id++) {
          for (const target of [button, button.parentElement!, window]) target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', bubbles: true }));
        }
      }
    });
    await page.waitForTimeout(1000);
    expect(await input(page), 'still held after pointercancel and lostpointercapture').toMatchObject({ steer: -1, brake: 1 });
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction(() => window.game.report().input.steer === 0 && window.game.report().input.brake === 0);
    // The help names the buttons, not a drag.
    expect(await page.locator('#hud .hud-controls').textContent()).toContain('Hold ◀ ▶');
  });
});

test.describe('Android keeps the drag stick', () => {
  test.use({ ...strip(devices['Pixel 7 landscape']) });
  test('Pixel 7 drags to steer and has no hold buttons', async ({ page }) => {
    page.on('pageerror', error => { throw error; });
    await race(page);
    await expect(page.locator('.touch-controls')).toHaveAttribute('data-steer', 'drag');
    await expect(page.locator('.touch-hold')).toHaveCount(0);
    const zone = (await page.locator('[data-touch-control="steer"]').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const thumb = finger(1, zone.x + zone.width - 60, zone.y + zone.height / 2);
    await touch(cdp, 'touchStart', [thumb]);
    await touch(cdp, 'touchMove', [{ ...thumb, x: thumb.x - 40 }]);
    await page.waitForFunction(() => window.game.report().input.steer < -.3, null, { timeout: 5000 });
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction(() => window.game.report().input.steer === 0);
    expect(await page.locator('#hud .hud-controls').textContent()).toContain('Drag');
  });
});
