import { expect, test } from '@playwright/test';

/**
 * The engine stops when the car does.
 *
 * `Audio.update` is only called while the car is live, so a paused game never tells the audio
 * anything -- and the oscillators are free-running, so they simply hold whatever gain they had.
 * Pause at full throttle and the engine howls that note behind the pause menu until you resume.
 * Nothing about that is visible on screen, which is why it survived until someone played the game.
 */

// 这个文件真的要开车，所以自己申请预算：默认档是 90 秒（playwright.config.ts），
// 那是「问浏览器一个问题」的价钱。要真的开起来才有引擎声：加载 + 起步 + 暂停 + 恢复。
test.describe.configure({ timeout: 180_000 });
const engineGain = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const g = window.game.audio.graph;
  return { engine: g?.engine.gain.value ?? -1, intake: g?.intakeGain.gain.value ?? -1,
           state: window.game.audio.ctx?.state ?? 'none' };
});

test('the engine goes quiet when the race is paused, and comes back when it resumes', async ({ page }) => {
  // A straight launch keeps this sound check off the guardrail while accelerating. The Golden Gate
  // stopped being one moved its start into the Presidio, onto a bend ~40 m in; the
  // freeway's first 300 m are dead straight.
  await page.goto('/?track=bayshore-101&dev=1');
  // The intro, not just a loaded track: the loading screen rests ~0.2 s at 100% with the
  // track already set, and an Enter there lands on its Back button.
  await page.waitForFunction(() => window.game?.report().phase === 'intro', null, { timeout: 60_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 60_000 });

  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.game.report().speedKmh > 60, null, { timeout: 30_000 });
  const running = await engineGain(page);
  test.skip(running.state !== 'running', 'this browser will not start an audio context');
  expect(running.engine, 'the engine should be making a noise while driving').toBeGreaterThan(0.05);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.game.report().phase === 'paused', null, { timeout: 10_000 });
  // Lift the foot behind the pause menu, as a player does: a key still held from before the pause only
  // repeats, and the keyboard ignores repeats, so "press it again" has to be a real new press.
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(600);          // the fade is 60 ms, with room to spare
  const paused = await engineGain(page);
  expect(paused.engine, 'and no noise at all behind the pause menu').toBeLessThan(0.005);
  expect(paused.intake, 'the intake too').toBeLessThan(0.005);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 10_000 });
  // Pause releases held controls; resume requires a fresh accelerator press.
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(400);
  expect((await engineGain(page)).engine, 'and back when the race resumes').toBeGreaterThan(0.05);
  await page.keyboard.up('ArrowUp');
});
