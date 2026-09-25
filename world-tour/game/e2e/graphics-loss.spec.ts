import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

// A lost 3D context mid-race is announced, recovers without a reload when the browser gives
// it back, and a phone on auto quality starts low instead of peaking GPU memory at high. The first two
// fix quality at high: auto swaps in a fresh renderer after its opening sample, which is its own recovery.
test.describe.configure({ timeout: 120_000 });
const out = evidencePath('graphics-loss');

test('a lost 3D context mid-race shows the recovery notice and the race carries on once restored', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ language: 'en', muted: true, quality: 'high' })));
  await page.goto('/?track=synth-p2p&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  const notice = page.locator('.graphics-loss');
  await expect(notice).toBeHidden();
  await page.evaluate(() => { const gl = (window.game as any).session.world.renderer.getContext();
    (window as any).__lose = gl.getExtension('WEBGL_lose_context'); (window as any).__lose.loseContext(); });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Recovering');
  await page.screenshot({ path: resolve(out, 'recovering.png') });
  const before = await page.evaluate(() => window.game.report().time);
  await page.evaluate(() => (window as any).__lose.restoreContext());
  await expect(notice).toBeHidden();
  await page.waitForFunction(t => window.game.report().time > t + 1, before);
  expect(await page.evaluate(() => (window.game as any).session.world.renderer.getContext().isContextLost())).toBe(false);
});

// Three.js re-uploads textures and buffers on restore because their pixels still live on
// the CPU; a render target's never did. The baked sky reflection came back empty, so every glass wall
// went black and the street lost its sky light for the rest of the race.
// Snow, because its deep drifts are drawn into render targets too and vanished the same way.
test('a restored context rebakes the sky reflection and the snow drifts', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ language: 'en', muted: true, quality: 'high' })));
  await page.goto('/?track=synth-p2p&bot=1&dev=1&weather=snow');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  const gpuPixels = () => page.evaluate(() => {
    const w = (window.game as any).session.world;
    const target = w.reflection;
    const half = new Uint16Array(target.width * 4);
    w.renderer.readRenderTargetPixels(target, 0, Math.floor(target.height / 2), target.width, 1, half);
    const drifts = (w.weatherEffects.patches as { target?: any }[]).filter(p => p.target).map(p => {
      const bytes = new Uint8Array(256 * 256 * 4);
      w.renderer.readRenderTargetPixels(p.target, 0, 0, 256, 256, bytes);
      return bytes.some((v: number) => v !== 0);
    });
    return { reflection: half.some((v: number) => v !== 0), drifts };
  });
  const before = await gpuPixels();
  expect(before.reflection, 'positive control: the reflection is readable before the loss').toBe(true);
  expect(before.drifts.length, 'positive control: this route has deep drifts in snow').toBeGreaterThan(0);
  expect(before.drifts.every(Boolean)).toBe(true);
  await page.evaluate(() => { const gl = (window.game as any).session.world.renderer.getContext();
    (window as any).__lose = gl.getExtension('WEBGL_lose_context'); (window as any).__lose.loseContext(); });
  await page.waitForTimeout(500);
  const time = await page.evaluate(() => window.game.report().time);
  await page.evaluate(() => (window as any).__lose.restoreContext());
  await page.waitForFunction(t => window.game.report().time > t + 1, time);
  const after = await gpuPixels();
  expect(after.reflection, 'the reflection is drawn again after the restore').toBe(true);
  expect(after.drifts, 'every deep drift is drawn again after the restore').toEqual(before.drifts);
});

test('a context that does not come back tells the player to restart the browser', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ language: 'zh', muted: true, quality: 'high' })));
  await page.goto('/?track=synth-p2p&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await page.evaluate(() => (window.game as any).session.world.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
  const notice = page.locator('.graphics-loss');
  await expect(notice).toContainText('彻底关闭浏览器', { timeout: 8000 });
  await expect(notice.locator('button')).toBeVisible();
  await page.screenshot({ path: resolve(out, 'failed-zh.png') });
});

test('leaving a race disposes its 3D context without a false loss notice', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ language: 'en', muted: true, quality: 'high' })));
  await page.goto('/?track=synth-p2p&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await page.evaluate(() => (window.game as any).quit());
  await page.waitForFunction(() => window.game.report().phase === 'menu');
  await page.waitForTimeout(6500);   // past the five-second guidance timer
  await expect(page.locator('.graphics-loss')).toBeHidden();
});

test('a phone on auto quality starts its race at low', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36' });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ language: 'en', muted: true, quality: 'auto' })));
    await page.goto('/?track=synth-p2p&dev=1');
    await page.waitForFunction(() => window.game);
    expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan', slimeDensity: 'none' }, true))).toBe(true);
    expect(await page.evaluate(() => window.game.report().renderQuality)).toBe('low');
    /* */
    await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 60_000 });
    const canvas = await page.evaluateHandle(() => (window.game as any).session.world.renderer.domElement);
    await page.waitForTimeout(5000);
    expect(await page.evaluate(() => window.game.report().phase)).toBe('racing');
    expect(await page.evaluate(() => window.game.report().renderQuality), 'still low after the opening sample').toBe('low');
    expect(await page.evaluate(c => (window.game as any).session.world.renderer.domElement === c, canvas), 'same renderer').toBe(true);
  } finally { await context.close(); }
});
