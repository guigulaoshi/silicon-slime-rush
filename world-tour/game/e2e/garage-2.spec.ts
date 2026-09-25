import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { devices, expect, test, webkit, type Frame, type Locator, type Page } from '@playwright/test';
import { evidencePath } from './evidence';
import { BASE_URL } from './server';

// The garage card after a lost WebGL context, and a finger dragging the car on an iPad.
test.describe.configure({ timeout: 180_000 });
const out = evidencePath('garage');
const SAVE = JSON.stringify({ language: 'en', muted: true, quality: 'high' });
const { defaultBrowserType: _ignored, ...ipadMini } = devices['iPad Mini landscape'];

async function garage(game: Page | Frame): Promise<Locator> {
  await game.locator('.home-go').click({ timeout: 90_000 });
  await game.locator('.sm-go').click(); await game.locator('.sm-go').click();
  const hero = game.locator('[data-player="0"] .sm-carhero');
  await expect(hero).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  return hero;
}
/** Mean brightness of the middle of the card, where the car stands. */
async function brightness(page: Page, hero: Locator): Promise<number> {
  const png = await hero.screenshot();
  return page.evaluate(async data => {
    const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height), g = canvas.getContext('2d')!;
    g.drawImage(image, 0, 0);
    const { data: px } = g.getImageData(image.width * .25, image.height * .25, image.width * .5, image.height * .5);
    let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i]! + px[i + 1]! + px[i + 2]!;
    return sum / (px.length / 4) / 3;
  }, png.toString('base64'));
}

test('after a lost and restored WebGL context the garage car keeps its reflections', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });   // a still car, so before and after are the same picture
  await page.addInitScript(save => localStorage.setItem('silicon-rush-world-tour.save.v1', save), SAVE);
  await page.goto('/');
  const hero = await garage(page);
  await page.waitForTimeout(300);
  const before = await brightness(page, hero);
  await hero.screenshot({ path: resolve(out, 'before-loss.png') });
  await hero.locator('canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!;
    (window as any).__lose = gl.getExtension('WEBGL_lose_context');
    (window as any).__lose.loseContext();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).__lose.restoreContext());
  await page.waitForTimeout(1000);
  await hero.screenshot({ path: resolve(out, 'after-restore.png') });
  const after = await brightness(page, hero);
  console.log(JSON.stringify({ before, after }));
  expect(before, 'positive control: the car is lit before the loss').toBeGreaterThan(25);
  expect(Math.abs(after - before), `brightness ${before.toFixed(1)} -> ${after.toFixed(1)}`).toBeLessThan(before * .03);
});

test('WebKit iPad: a finger on the car cancels the touch, so iOS cannot turn the drag into a page scroll', async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage(ipadMini);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(save => localStorage.setItem('silicon-rush-world-tour.save.v1', save), SAVE);
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 }));
    await page.goto(`${BASE_URL}/`);
    const hero = await garage(page);
    await page.evaluate(() => {
      (window as any).touchStarts = [];
      window.addEventListener('touchstart', e => (window as any).touchStarts.push(
        [(e.target as Element).tagName, e.defaultPrevented]), { passive: true });
    });
    const box = (await hero.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const card = (await page.locator('[data-player="0"] [data-vehicle]:visible').first().boundingBox())!;
    await page.touchscreen.tap(card.x + card.width / 2, card.y + card.height / 2);   // control: an ordinary button
    const starts = await page.evaluate(() => (window as any).touchStarts as [string, boolean][]);
    expect(starts[0], 'on the car').toEqual(['CANVAS', true]);
    expect(starts[1]![1], 'on a car card, as before').toBe(false);
    expect(starts).toHaveLength(2);
    expect(errors, errors.join('\n')).toHaveLength(0);
  } finally {
    await browser.close();
  }
});

test.describe('iPad-sized Chromium', () => {
  test.use({ ...ipadMini });
  // Chromium honours touch-action inside frames, so this passes with or without the listeners:
  // it guards the drag against a regression here, the WebKit case above checks the cancelling.
  test('inside a scrolling host page, like itch.io on an iPad, dragging the car turns it and the host stays put', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0"><div style="height:60px">host</div>
      <iframe id="game" src="about:blank" width="960" height="600" style="border:0;display:block"></iframe>
      <div style="height:2500px">more host page</div></body>`);
    const game = (await (await page.locator('#game').elementHandle())!.contentFrame())!;
    await game.goto(`${BASE_URL}/`);
    await game.evaluate(save => localStorage.setItem('silicon-rush-world-tour.save.v1', save), SAVE);
    await game.goto(`${BASE_URL}/`);
    const hero = await garage(game);
    await game.evaluate(() => document.fullscreenElement && document.exitFullscreen());
    const box = (await hero.boundingBox())!;
    const before = await hero.screenshot();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2,
      xDistance: -160, yDistance: -120, gestureSourceType: 'touch', speed: 400, preventFling: true });
    await page.waitForTimeout(300);
    mkdirSync(out, { recursive: true });
    await page.screenshot({ path: resolve(out, 'chromium-ipad-host-drag.png') });
    expect(await page.evaluate(() => scrollY), 'the host page stayed put').toBe(0);
    expect((await hero.screenshot()).equals(before), 'the drag turned the car').toBe(false);
  });
});
