import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

test.skip(process.env.BRAKE_AUDIO_QA !== '1', 'run with BRAKE_AUDIO_QA=1');
test.describe.configure({ timeout: 180_000 });

test('feeds a real keyboard brake into the existing tyre voice', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0.5, muted: false,
    obstacles: true, best: {},
  })));
  await page.goto('/?track=synth-loop&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'intro', null, { timeout: 90_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 15_000 });
  await expectWorldLoaded(page, 'brake audio integration');
  await page.evaluate(() => {
    const car = window.game.session.car;
    const forward = car.forward;
    car.body.setLinvel({ x: forward.x * 20, y: 0, z: forward.z * 20 }, true);
  });
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => window.game.report().input.brake === 1
    && window.game.audio.scrubAmount > 0.35);
  const braking = await page.evaluate(() => ({
    brake: window.game.report().input.brake,
    speedKmh: window.game.report().speedKmh,
    tyreVoice: window.game.audio.scrubAmount,
    sources: window.game.audio.graph ? 2 : 0,
  }));
  await page.keyboard.up('ArrowDown');
  expect(braking.brake).toBe(1);
  expect(braking.speedKmh).toBeGreaterThan(5);
  expect(braking.tyreVoice).toBeGreaterThan(0.35);
  expect(braking.sources, 'the existing engine graph is alive; braking did not add a second graph')
    .toBe(2);
});
