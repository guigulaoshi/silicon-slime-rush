import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 40_000 });
const SAVE_KEY = 'silicon-rush.save.v1';

test('saved clear-road mode constructs no slime layer, instances or ground effects', async ({ page }) => {
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({
    version: 1, language: 'en', quality: 'low', volume: 0, muted: true, obstacles: false, best: {},
  })), { key: SAVE_KEY });
  await page.goto('/?track=synth-loop&bot=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 30_000 });
  await expectWorldLoaded(page, 'clear-road mode');
  const report = await page.evaluate(() => window.game.report());
  expect(report.slimes, 'null means SlimeLayer itself was never constructed').toBeNull();
  expect(report.surface).toBe('dry');
  await expect(page.locator('.slime-windshield')).toHaveCount(0);
  const carriers = await page.evaluate(() => {
    const game = window.game as unknown as {
      session: { world: { streamer: { root: { traverse(fn: (node: {
        name: string; isInstancedMesh?: boolean; count?: number;
      }) => void): void } } } } | null;
    };
    let meshes = 0;
    let instances = 0;
    game.session?.world.streamer.root.traverse((node) => {
      if (!node.isInstancedMesh || !node.name.startsWith('props_slime_')) return;
      meshes++;
      instances += node.count ?? 0;
    });
    return { meshes, instances };
  });
  expect(carriers).toEqual({ meshes: 0, instances: 0 });
});

test('many loads exactly twice the normal population', async ({ page }) => {
  const load = async (density: 'normal' | 'many') => {
    await page.goto('/'); await page.locator('.home-go').click();
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify({
      version: 2, language: 'en', quality: 'low', volume: 0, muted: true,
      slimeDensity: value, best: {},
    })), { key: SAVE_KEY, value: density });
    await page.goto('/?track=synth-loop&bot=1');
    await page.waitForFunction(() => window.game?.report().phase === 'racing' &&
      window.game.report().tiles?.loading === 0, null, { timeout: 30_000 });
    await expectWorldLoaded(page, `${density} slime density`);
    return page.evaluate(() => window.game.report().slimes?.spawned ?? 0);
  };
  const normal = await load('normal');
  const many = await load('many');
  expect(normal).toBeGreaterThan(0);
  expect(many).toBe(normal * 2);
});
