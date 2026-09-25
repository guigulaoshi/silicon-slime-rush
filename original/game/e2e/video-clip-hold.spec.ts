import { expect, test } from '@playwright/test';

/**
 *The saved file was 15 s of driving and 161 s of one still frame,
 * because the recorders kept stamping wall-clock time through the pause menu. The game loop has to hold
 * both recordings whenever it stops driving, and pick them up again when driving resumes. Only recorder
 * states are read, so this holds even on a machine whose encoder hands back no data.
 */
test.describe.configure({ timeout: 180_000 });

test('pausing holds both drive recordings and resuming picks them up again', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {} })));
  await page.goto('/?dev=1&track=synth-loop&bot=1&speed=1&time=day&weather=clear');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  const states = () => page.evaluate(() => {
    const g = window.game as any;
    return [...g.video.lanes, ...g.loopVideo.lanes].map((lane: any) => lane.recorder.state);
  });
  await expect.poll(async () => (await states()).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  expect(await states()).toEqual(expect.arrayContaining(['recording']));
  expect(await states()).not.toContain('paused');

  await page.evaluate(() => { (window.game as any).handleAction('pause'); });
  await page.waitForTimeout(1500);
  const held = await states();
  expect(held.length).toBeGreaterThanOrEqual(2);
  expect(held.every(state => state === 'paused'), JSON.stringify(held)).toBe(true);
  const seconds = await page.evaluate(() => (window.game as any).video.seconds);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window.game as any).video.seconds), 'the paused wait adds nothing').toBe(seconds);

  await page.evaluate(() => { (window.game as any).handleAction('pause'); });
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expect.poll(async () => (await states()).every(state => state === 'recording'), { timeout: 5_000 }).toBe(true);
});
