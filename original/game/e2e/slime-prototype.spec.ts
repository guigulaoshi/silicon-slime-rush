import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 480_000, mode: 'serial' });
test.skip(process.env.SLIME_PROTOTYPE_QA !== '1', 'run with SLIME_PROTOTYPE_QA=1');

const SAVE_KEY = 'silicon-rush.save.v1';
const ROOT = evidencePath();
const SHOT = resolve(ROOT, 'shots', 'synth-loop', 'slime-physics.png');
const VIDEO_DIR = resolve(ROOT, 'video');

async function open(browser: Browser, video = false): Promise<{ page: Page; close(): Promise<void> }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(video ? { recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } } } : {}),
  });
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SAVE_KEY,
    value: { version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {} },
  });
  const page = await context.newPage();
  await page.goto('/?track=synth-loop&bot=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'slime prototype high');
  return {
    page,
    async close() {
      const capture = page.video();
      await context.close();
      if (capture) await capture.saveAs(resolve(VIDEO_DIR, 'slime-physics.webm'));
    },
  };
}

test('six-kind vertical slice screenshot, video and robot finish', async ({ browser }) => {
  mkdirSync(resolve(ROOT, 'shots', 'synth-loop'), { recursive: true });
  mkdirSync(VIDEO_DIR, { recursive: true });
  const run = await open(browser, true);
  const initial = await run.page.evaluate(() => window.game.report());
  expect(initial.slimes?.spawned).toBeGreaterThan(0);
  expect(initial.slimes?.spawned).toBeLessThanOrEqual(200);
  expect(Object.values(initial.slimes?.byKind ?? {}).every((count) => count > 0)).toBe(true);
  expect(initial.slimes?.colossi).toBeLessThanOrEqual(6);
  // Pipeline placement starts the first visible cluster around 12% of this loop. At 20 m the old
  // procedural prototype had creatures in frame; streamed route-aware placement correctly does not.
  await run.page.waitForFunction(() => window.game.report().progress >= 155, null, { timeout: 90_000 });
  await run.page.screenshot({ path: SHOT });
  await run.close();
  if (process.env.SLIME_VISUAL_ONLY === '1') return;

  const finishContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await finishContext.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SAVE_KEY,
    value: { version: 1, language: 'en', quality: 'low', volume: 0, muted: true, best: {} },
  });
  const finish = await finishContext.newPage();
  await finish.goto('/?track=synth-loop&bot=1&speed=2');
  await finish.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(finish, 'slime prototype robot');
  await finish.waitForFunction(() => window.game.report().state === 'finished', null, { timeout: 240_000 });
  const final = await finish.evaluate(() => window.game.report());
  expect(final.resets, JSON.stringify(final.resetLog)).toBe(0);
  expect(final.slimes?.spawned).toBeGreaterThan(0);
  expect(final.slimes?.spawned).toBeLessThanOrEqual(60);
  expect(final.slimes?.active).toBeLessThan(final.slimes?.spawned ?? 0);
  expect(Object.values(final.slimes?.feedback.hits ?? {}).reduce((sum, hits) => sum + hits, 0)).toBeGreaterThan(0);
  await finishContext.close();
});
