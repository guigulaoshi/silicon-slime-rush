import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = evidencePath('share');
test.beforeEach(() => mkdirSync(out, {recursive: true}));

test('home preview saves a PNG, copies current language and handles cancelled system sharing', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: async (text: string) => { (window as any).copied = text; }}});
    Object.defineProperty(navigator, 'canShare', {value: () => true});
    Object.defineProperty(navigator, 'share', {value: async (data: ShareData) => { (window as any).shareData = {text: data.text, files: data.files?.map(f => ({size: f.size, type: f.type}))}; throw new DOMException('Cancelled', 'AbortError'); }});
  });
  await page.goto('/'); await page.locator('.home-share').click();
  const dialog = page.locator('.share-dialog');
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  await expect(dialog.locator('[data-share=link]')).toBeHidden();
  //The screenshot fills the card, the words are laid over it, and the preview is the card with no band around it.
  const preview = await dialog.locator('canvas').evaluate(canvas => {
    const c = canvas as HTMLCanvasElement, ctx = c.getContext('2d')!;
    const corner = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
    // Layout px, not screen px: the dialog is one scaled canvas.
    const shell = getComputedStyle(c.parentElement!), inner = c.parentElement!.clientWidth - parseFloat(shell.paddingLeft) - parseFloat(shell.paddingRight);
    return { size: [c.width, c.height], corners: [corner(2, 2), corner(c.width - 3, 2), corner(2, c.height - 3)],
      drawn: c.offsetWidth / (c.offsetHeight * c.width / c.height), gap: inner - c.offsetWidth };
  });
  expect(preview.size).toEqual([1200, 520]);
  // #0a1723 is the card's backing colour: a corner still that colour is a letterbox, not picture.
  for (const rgb of preview.corners) expect(rgb, 'picture reaches the corner').not.toEqual([10, 23, 35]);
  expect(preview.drawn, 'preview box has the card\'s shape').toBeCloseTo(1, 2);
  expect(preview.gap, 'preview fills the window width').toBeLessThan(4);
  await dialog.locator('[data-share=system]').click();
  await expect(dialog.locator('[role=status]')).toContainText('cancelled');
  expect(await page.evaluate(() => (window as any).shareData.files[0].size)).toBeGreaterThan(10_000);
  const downloading = page.waitForEvent('download'); await dialog.locator('[data-share=save]').click();
  const download = await downloading; await download.saveAs(resolve(out, 'home-en.png'));
  await dialog.locator('[data-share=language]').click();
  await expect(dialog.locator('[data-share=copy]')).toBeEnabled();
  await dialog.locator('[data-share=copy]').click();
  await expect(dialog.locator('[role=status]')).toContainText('已复制');
  expect(await page.evaluate(() => (window as any).copied)).toContain('史莱姆赛车');
  expect(await page.evaluate(() => (window as any).copied)).not.toContain('http');
  await page.screenshot({path: resolve(out, 'home-zh-preview.png')});
  await dialog.locator('[data-share=close]').click();
  await expect(page.locator('.home-go')).toBeVisible();
});

test('pause and about offer the same share card as the home page; settings no longer does', async ({page}) => {
  // moved it from Settings to the pause screen.
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  const dialog = page.locator('.share-dialog');
  await page.locator('.home-footer button').first().click();
  await expect(page.locator('[data-screen=settings] [data-setting=back]')).toBeVisible();
  await expect(page.locator('[data-screen=settings] [data-setting=share]')).toHaveCount(0);
  await page.locator('[data-screen=settings] [data-setting=back]').click();
  await page.locator('.home-footer button').nth(1).click();
  const about = page.locator('[data-screen=about]'); await expect(about).toBeVisible();
  // Enter on arrival still means back, so Back keeps the focus the screen gives its first button.
  await expect.poll(() => page.evaluate(() => document.activeElement?.className)).not.toContain('about-share');
  await about.locator('.about-share').click();
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('about');
  await page.evaluate(() => window.game.startRace({trackId: 'synth-p2p', car: 'sedan', slimeDensity: 'none', ai: false}));
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), {timeout: 15_000}).toBe('racing');
  await page.keyboard.press('Escape');
  const pause = page.locator('[data-screen=pause]');
  await pause.locator('[data-action=share]').click();
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  expect(await dialog.locator('canvas').evaluate(c => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height])).toEqual([1200, 520]);
  // Esc closes only the share card, first open included, and leaves the drive paused.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
});

test('dual result preview retains both results and exposes selectable text without clipboard support', async ({page}) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', {value: undefined}); Object.defineProperty(navigator, 'share', {value: undefined}); });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(async () => {
    await window.game.startRace({ trackId: 'synth-loop', car: 'sedan', slimeDensity: 'normal', ai: false, playerVehicles: ['micro-hatch', 'city-pod'] });
  });
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), {timeout: 15_000}).toBe('racing');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    // Result fixture after rendering the real two-player drive; not a full-route driver test.
    const game = window.game as any;
    game.session.humans[0].race.time = 83.4; game.session.humans[1].race.time = 90;
    game.finish(83.4);
  });
  await page.locator('[data-screen=results] [data-action=share]').click();
  const dialog = page.locator('.share-dialog');
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  await expect(dialog.locator('[data-share=system]')).toBeVisible();
  await dialog.locator('[data-share=copy]').click();
  await expect(dialog.locator('textarea')).toHaveValue(/Left driver.*1:23/s);
  await expect(dialog.locator('textarea')).toHaveValue(/Right driver.*1:30/s);
  expect(await dialog.locator('textarea').evaluate((el: HTMLTextAreaElement) => el.selectionEnd-el.selectionStart)).toBeGreaterThan(20);
  await dialog.locator('[data-share=close]').click();
  await page.locator('[data-screen=results] [data-action=share]').click();
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  const downloading = page.waitForEvent('download'); await dialog.locator('[data-share=save]').click();
  await (await downloading).saveAs(resolve(out, 'dual-result-fixture.png'));
  await page.screenshot({path: resolve(out, 'dual-preview.png')});
  await dialog.locator('[data-share=close]').click();
  expect(await page.evaluate(() => window.game.report().phase)).toBe('results');
  const result = await page.evaluate(() => (window.game as any).lastResult);
  expect(result.players.map((player: {time:number}) => player.time)).toEqual([83.4,90]);
  writeFileSync(resolve(out, 'dual-fixture.json'), JSON.stringify({fixture: true, result}, null, 2));
});

test('phone preview hands prepared image to system sharing and stays usable', async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 844, height: 390}, isMobile: true, hasTouch: true, locale: 'zh-CN'});
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', {value: () => true});
    Object.defineProperty(navigator, 'share', {value: async (data: ShareData) => { (window as any).sharedType = data.files?.[0]?.type; }});
  });
  await page.goto('/'); await page.locator('.home-share').click();
  const dialog = page.locator('.share-dialog'); await expect(dialog.locator('[data-share=system]')).toBeEnabled();
  await dialog.locator('[data-share=system]').click();
  await expect(dialog.locator('[role=status]')).toContainText('已交给系统');
  expect(await page.evaluate(() => (window as any).sharedType)).toBe('image/png');
  await page.screenshot({path: resolve(out, 'phone-share.png')});
  await dialog.locator('[data-share=close]').click();
  await expect(page.locator('.home-go')).toBeVisible(); await context.close();
});

// Chrome encodes the card's toBlob in the main thread's idle time. A results screen that kept
// redrawing the world behind the card left a phone none, and the card took 4 s to become usable.
test('the world is not redrawn behind an open result card, and is again once it closes', async ({page}) => {
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(async () => {
    await window.game.startRace({ trackId: 'synth-loop', car: 'sedan', slimeDensity: 'normal', ai: false, playerVehicles: ['micro-hatch'] });
  });
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), {timeout: 15_000}).toBe('racing');
  await page.evaluate(() => { const game = window.game as any; game.session.humans[0].race.time = 83.4; game.finish(83.4); });
  const frame = () => page.evaluate(() => (window.game as any).session.world.renderer.info.render.frame as number);
  const drawnOnResults = await frame();
  await expect.poll(frame).toBeGreaterThan(drawnOnResults);
  await page.locator('[data-screen=results] [data-action=share]').click();
  const dialog = page.locator('.share-dialog');
  await expect(dialog.locator('[data-share=save]')).toBeEnabled();
  const held = await frame();
  await page.waitForTimeout(500);
  expect(await frame(), 'the scene was redrawn behind the open card').toBe(held);
  await dialog.locator('[data-share=close]').click();
  await expect.poll(frame).toBeGreaterThan(held);
});
