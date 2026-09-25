import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { BASE_URL } from './server';

// Complete the synthetic sprint, including menu, repeated restart and result journeys.
test.describe.configure({ timeout: 180_000 });
const output = evidencePath('ui');
async function active(page: Page, name: string) {
  await expect(page.locator('.screen:not([inert])')).toHaveCount(1);
  await expect(page.locator(`.screen[data-screen="${name}"]`)).toBeVisible();
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.screen[hidden]')]
    .every(node => node.inert))).toBe(true);
}
async function settled(page: Page) {
  await page.locator('.screen:not([inert])').evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
}
async function panelFits(page: Page) {
  await settled(page);
  const nodes = page.locator('.screen:not([inert]) h1, .screen:not([inert]) h2, '
    + '.screen:not([inert]) p, .screen:not([inert]) button, .screen:not([inert]) .card-stats');
  expect(await nodes.count()).toBeGreaterThan(0);
  const failures: string[] = [];
  let inspected=0;
  for (const node of await nodes.all()) {
    if (!await node.isVisible()) continue;
    inspected++;
    await node.evaluate(element => element.scrollIntoView({ block: 'nearest' }));
    const failure = await node.evaluate(element => {
      const b = element.getBoundingClientRect();
      return b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1
        ? element.textContent ?? element.tagName : null;
    });
    if (failure) failures.push(failure);
  }
  await page.locator('.screen:not([hidden]) .panel').evaluateAll(panels => {
    for (const panel of panels) panel.scrollTop = 0;
  });
  expect(failures).toEqual([]);
  expect(inspected).toBeGreaterThan(0);
}
for (const setup of [
  { lang: 'en', width: 1280, height: 720, mobile: false },
  { lang: 'zh', width: 1920, height: 1080, mobile: false },
  { lang: 'en', width: 844, height: 390, mobile: true },
  { lang: 'zh', width: 844, height: 390, mobile: true },
]) test(`complete UI journey ${setup.lang} ${setup.width}x${setup.height}`, async ({ browser }) => {
  mkdirSync(output, { recursive: true });
  const name = `${setup.lang}-${setup.width}`;
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: setup,
    isMobile: setup.mobile, hasTouch: setup.mobile,
    recordVideo: { dir: output, size: { width: setup.width, height: setup.height } } });
  await context.addInitScript(lang => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 3, language: lang, muted: true, quality: 'high', slimeDensity: 'none', best: {},
  })), setup.lang);
  const page = await context.newPage(); const video = page.video()!;
  const tap = (target: Locator) => setup.mobile ? target.tap() : target.click();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/?dev=1&bot=1&speed=6'); await tap(page.locator('.home-go')); await active(page, 'menu');
    await tap(page.locator('.sm-item').filter({ hasText: setup.lang === 'en' ? 'Synthetic Sprint' : '合成点对点' }));
    for (const next of ['1', '2']) {
      await tap(page.locator('.sm-go')); await expect(page.locator('.sm')).toHaveAttribute('data-step', next);
      await expect(page.locator('.sm-go')).toBeFocused();
    }
    await page.evaluate(() => {
      const game = window.game as any; game.testCountdowns = 0;
      const show = game.show.bind(game);
      game.show = (phase: string) => { if (phase === 'countdown') game.testCountdowns++; show(phase); };
    });
    await page.locator('.sm-go').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
    expect(await page.evaluate(() => (window.game as any).testCountdowns)).toBe(1);
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    for (let i = 0; i < 2; i++) {
      // This checks keyboard entry selection; leave the pointer outside the arriving menu so
      // its independent hover selection does not replace the keyboard's default action.
      if (!setup.mobile) await page.mouse.move(0, 0);
      if (setup.mobile) await page.locator('.hud-pause').tap(); else await page.keyboard.press('Escape');
      await active(page, 'pause'); await panelFits(page);
      await expect(page.locator('[data-screen="pause"] [data-action="resume"]')).toBeFocused();
      await expect(page.locator('[data-screen="pause"] [data-action="resume"]')).toHaveAttribute('aria-selected', 'true');
      await tap(page.locator('[data-screen="pause"] [data-action="settings"]')); await active(page, 'settings');
      await page.locator('[data-setting="language"]').selectOption(setup.lang === 'en' ? 'zh' : 'en'); await panelFits(page);
      await page.locator('[data-setting="language"]').selectOption(setup.lang);
      await tap(page.locator('[data-screen="settings"] [data-setting="back"]')); await active(page, 'pause');
      await expect(page.locator('[data-screen="pause"] [data-action="resume"]')).toBeFocused();
      await expect(page.locator('[data-screen="pause"] [data-action="resume"]')).toHaveAttribute('aria-selected', 'true');
      await settled(page);
      await page.screenshot({ path: resolve(output, `${name}-pause.png`) });
      await page.locator('[data-screen="pause"] [data-action="restart"]').evaluate((node: HTMLButtonElement) => {
        node.click(); node.click();
      });
      await expect(page.locator('dialog[open] [data-dialog-action=confirm]')).toBeVisible();
      await tap(page.locator('dialog[open] [data-dialog-action=confirm]'));
      await expect.poll(()=>page.evaluate(() => (window.game as any).testCountdowns)).toBe(i + 2);
      await page.waitForFunction(() => window.game.report().phase === 'racing');
    }
    await page.evaluate(() => { window.game.autopilot = true; });
    await page.waitForFunction(() => window.game.report().phase === 'results', null, { timeout: 60_000 });
    await active(page, 'results'); await panelFits(page);
    expect(await page.evaluate(() => window.game.report().resets)).toBe(0);
    await page.screenshot({ path: resolve(output, `${name}-results.png`) });
    await tap(page.locator('[data-screen="results"] [data-action="quit"]'));
    await active(page, 'menu'); await expect(page.locator('.sm-go')).toBeFocused();
    expect(await page.evaluate(() => window.game.report().track)).toBeNull();
    await expect(page.locator('#app canvas')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); await video.saveAs(resolve(output, `${name}-journey.webm`)); await video.delete(); }
});

test('cancelled loading cannot return later and reduced motion disables page animation', async ({ page }) => {
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/tracks/synth-p2p/track.json', async route => { await wait; await route.continue(); });
  await page.goto('/?track=synth-p2p&dev=1'); await active(page, 'boot');
  await page.keyboard.press('Escape'); await active(page, 'menu'); release();
  await page.waitForTimeout(700); await active(page, 'menu');
  expect(await page.evaluate(() => window.game.report().track)).toBeNull();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.sm-link').first().click(); await active(page, 'settings');
  expect(await page.locator('[data-screen="settings"] .modal-shell').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await page.keyboard.press('Escape'); await active(page, 'menu');
});
