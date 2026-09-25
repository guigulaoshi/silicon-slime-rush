import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { captureFrames } from './frame-sample';
import { expectWorldLoaded } from './world';

/**
 * Recording the drive costs no frame rate. Kept apart from video-clip, which runs off the
 * GPU so its recorders deliver bytes; this one measures compositing on the GPU config, which needs none.
 */
const OUT = evidencePath('video-clip');
test.describe.configure({ timeout: 300_000 });

test('recording costs no frame rate', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {} })));
  await page.goto('/?dev=1&track=synth-loop&bot=1&speed=1&time=day&weather=clear');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'recording cost');
  expect(await page.evaluate(() => (window.game as any).video.recording)).toBe(true);
  // Frame rate with the recorder running, then with it switched off, at the same place on the road.
  const recording = await captureFrames(page, 0, 6000);
  await page.evaluate(() => { const game = window.game as any; game.video.stop(); game.videoWanted = () => false; });
  const idle = await captureFrames(page, 0, 6000);
  writeFileSync(resolve(OUT, 'cost.json'), JSON.stringify({ recording, idle }, null, 2));
  expect(recording.fps).toBeGreaterThan(idle.fps * .9);
});
