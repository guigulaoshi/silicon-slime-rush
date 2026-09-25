import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkMaximum } from '../test-support/resource-limit';

const out = evidencePath('startup');
test.beforeEach(() => mkdirSync(out, { recursive: true }));

test('slow 3G paints the styled HTML before game modules arrive', async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', {
    offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024,
  });
  await page.route('**/assets/main-*.js', route => route.abort());
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#startup h1')).toHaveText(/Silicon|硅谷/);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0)).toBeGreaterThan(0);
  const facts = await page.evaluate(() => ({
    firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]!.startTime,
    background: getComputedStyle(document.getElementById('startup')!).backgroundColor,
    title: document.querySelector('#startup h1')!.textContent,
    gameReady: !!window.game,
  }));
  writeFileSync(resolve(out, 'slow-3g.json'), JSON.stringify(facts, null, 2));
  checkMaximum(facts.firstContentfulPaint, 'startup_fcp_ms', 'slow-3G first contentful paint');
  expect(facts.background).toBe('rgb(8, 15, 23)');
  expect(facts.gameReady).toBe(false);
  await page.screenshot({ path: resolve(out, 'slow-3g.png') });
});

for (const [name, resource] of [
  ['game module', '**/assets/main-*.js'],
  ['stylesheet', '**/assets/main-*.css'],
  ['entry module', '**/assets/index-*.js'],
] as const) test(`a failed ${name} keeps the page usable and reload retry creates one game`, async ({ page }) => {
  await page.route(resource, route => route.abort());
  await page.goto('/');
  await expect(page.locator('#startup button:not(.startup-language)')).toBeVisible();
  await expect(page.locator('#startup')).toHaveAttribute('data-failed', 'true');
  await page.screenshot({ path: resolve(out, `download-failed-${name.replace(' ', '-')}.png`) });
  await page.unroute(resource);
  await page.locator('#startup button:not(.startup-language)').click();
  await expect(page.locator('.home-go')).toBeVisible();
  await expect(page.locator('#startup')).toHaveCount(0);
  await expect(page.locator('[data-screen="menu"]')).toHaveCount(1);
  expect(await page.evaluate(() => !!window.game)).toBe(true);
});

test('unsupported graphics keeps a translated recovery page without constructing Game', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ language: 'zh' }));
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...args: unknown[]) {
      return id === 'webgl2' ? null : (original as Function).apply(this, [id, ...args]);
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.locator('#startup [role="status"]')).toContainText('3D');
  await expect(page.locator('#startup h1')).toHaveText('史莱姆赛车：硅谷');
  await page.screenshot({ path: resolve(out, 'graphics-failed-zh.png') });
  expect(await page.evaluate(() => !!window.game)).toBe(false);
});

test('route model decoding and scene preparation report actual phases', async ({ page }) => {
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  const stages = await page.evaluate(async () => {
    const game = window.game as any;
    const stages: string[] = [];
    const original = game.boot.setStage.bind(game.boot);
    game.boot.setStage = (stage: string) => { stages.push(stage); original(stage); };
    const ready = await game.startRace({ trackId: 'synth-p2p', car: 'sedan' });
    return { ready, stages, phase: game.report().phase };
  });
  expect(stages.ready).toBe(true);
  expect(stages.phase).toBe('intro');
  expect(stages.stages.slice(0, 3)).toEqual(['boot.vehicle.download', 'boot.vehicle.decode', 'boot.scene']);
  writeFileSync(resolve(out, 'route-phases.json'), JSON.stringify(stages, null, 2));
});
