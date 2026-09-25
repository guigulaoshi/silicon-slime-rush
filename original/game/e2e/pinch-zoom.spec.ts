import { expect, test, type CDPSession, type Page } from '@playwright/test';

// On a phone a pinch on the menus zoomed the whole page, and the zoom rode into the race,
// where the canvas blocks the pinch that would undo it.
test.describe.configure({ timeout: 120_000 });

const scale = (page: Page) => page.evaluate(() => Math.round(visualViewport!.scale * 100) / 100);
async function pinch(cdp: CDPSession, page: Page, x: number, y: number) {
  await cdp.send('Input.synthesizePinchGesture', { x, y, scaleFactor: 2.5, relativeSpeed: 400, gestureSourceType: 'touch' });
  await page.waitForTimeout(500);
}

test.describe('phone pinch zoom', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 891, height: 411 } });
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', error => { throw error; });
    await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      version: 3, language: 'en', muted: true, quality: 'high', slimeDensity: 'none', best: {},
    })));
  });

  test('the home screen and every menu step refuse a pinch', async ({ page }) => {
    await page.goto('/');
    await page.locator('.home-go').waitFor({ state: 'visible' });
    const cdp = await page.context().newCDPSession(page);
    await pinch(cdp, page, 445, 200);
    expect(await scale(page), 'home').toBe(1);
    await page.locator('.home-go').tap();
    for (const step of ['0', '1', '2']) {
      await expect(page.locator('.sm')).toHaveAttribute('data-step', step);
      // On the scrolling list half and on the picture half of each step.
      for (const x of [220, 660]) {
        await pinch(cdp, page, x, 220);
        expect(await scale(page), `step ${step} at x=${x}`).toBe(1);
      }
      if (step !== '2') await page.locator('.sm-go').tap();
    }
  });

  // Chrome honours the scale cap in index.html, Safari ignores it and only honours touch-action, so
  // each guard is checked alone: removing either one turns one of these red.
  for (const [guard, strip] of [
    ['touch-action alone', () => {
      document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    }],
    ['the viewport scale cap alone', () => {
      const style = document.createElement('style'); style.textContent = 'html, body, #ui, .landscape-guard { touch-action: auto !important; }';
      document.head.append(style);
    }],
  ] as const) test(`${guard} refuses a pinch on the home screen`, async ({ page }) => {
    await page.goto('/');
    await page.locator('.home-go').waitFor({ state: 'visible' });
    await page.evaluate(strip);
    const cdp = await page.context().newCDPSession(page);
    await pinch(cdp, page, 445, 200);
    expect(await scale(page)).toBe(1);
  });

  test('the results screen refuses a pinch', async ({ page }) => {
    await page.goto('/?track=shoreline&bot=1&dev=1&speed=6');
    await page.waitForFunction(() => window.game?.report().phase === 'results', null, { timeout: 90_000 });
    await page.waitForTimeout(800);
    const cdp = await page.context().newCDPSession(page);
    await pinch(cdp, page, 445, 200);
    expect(await scale(page)).toBe(1);
  });

  test('a page that did get zoomed is back to scale 1 once the race starts', async ({ page }) => {
    await page.goto('/');
    await page.locator('.home-go').waitFor({ state: 'visible' });
    // Stand in for a browser that ignores both guards (Safari accessibility zoom, Chrome "force enable zoom").
    await page.evaluate(() => {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!;
      meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
      const style = document.createElement('style'); style.textContent = '* { touch-action: auto !important; }';
      document.head.append(style);
    });
    const cdp = await page.context().newCDPSession(page);
    await pinch(cdp, page, 445, 200);
    expect(await scale(page), 'the stand-in really zooms').toBeGreaterThan(1.5);
    await page.evaluate(() => window.game.startRace({ trackId: 'shoreline', playerVehicles: ['micro-hatch'], slimeDensity: 'none', ai: false }));
    await page.waitForFunction(() => /intro|countdown|racing/.test(window.game.report().phase));
    await expect.poll(() => scale(page), { timeout: 10_000 }).toBe(1);
  });
});
