import { expect, test } from '@playwright/test';

/* */
test.describe.configure({ timeout: 180_000 });
const sound = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const audio = (window.game as any).audio, graph = audio.graph;
  return { state: audio.ctx?.state ?? 'none', piece: audio.musicPiece, phase: window.game.report().phase,
    music: graph?.music.gain.value ?? -1, menuLoop: graph?.pieces[0]?.gain.value ?? -1, master: graph?.master.gain.value ?? -1 };
});

test('the home page music starts on the first key or tap there, and mute silences it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 1, language: 'en', best: {} })));
  await page.goto('/');
  await expect(page.locator('.home-go')).toBeVisible({ timeout: 180_000 });
  const before = await sound(page);
  expect(before.phase).toBe('menu');
  // A key that does nothing on the page: still a gesture, and the player is still on the home page.
  await page.keyboard.press('Shift');
  await expect.poll(async () => (await sound(page)).state, { timeout: 10_000 }).toBe('running');
  test.skip((await sound(page)).state !== 'running', 'this browser will not start an audio context');
  await page.waitForTimeout(1500);
  const playing = await sound(page);
  expect(playing.phase, 'still on the home page').toBe('menu');
  await expect(page.locator('.home-go')).toBeVisible();
  expect(playing.piece).toBe('menu');
  expect(playing.menuLoop, 'the menu loop is the audible one').toBeGreaterThan(.5);
  expect(playing.music, 'music is up').toBeGreaterThan(.05);
  expect(playing.master, 'and the output is not muted').toBeGreaterThan(.05);

  await page.evaluate(() => { (window.game as any).audio.setMuted(true); });
  await page.waitForTimeout(800);
  expect((await sound(page)).master, 'mute silences it').toBeLessThan(.005);
});
