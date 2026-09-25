import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { evidencePath } from './evidence';

const out = evidencePath('ghost-setting');
test.describe.configure({ timeout: 180_000 });

test('a new player starts on the most slimes', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.goto('/'); await page.locator('.home-go').click();
  expect(await page.evaluate(() => (window as any).game.save.all.slimeDensity)).toBe('many');
  await page.locator('.sm-go').click();
  await expect(page.locator('.sm')).toHaveAttribute('data-step', '1');
  await expect(page.locator('[data-slime-density=many]')).toHaveClass(/\bon\b/);
  await page.screenshot({ path: `${out}/new-player-world.png` });
});

test('the ghost starts off; the settings switch shows and hides it at once and after a reload', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  // A real bot finish stores the ghost, the same way ghost makes one.
  await page.goto('/?track=synth-p2p&dev=1&bot=1&speed=6');
  await expect.poll(() => page.evaluate(() => window.game?.report().state), { timeout: 150_000, intervals: [500] }).toBe('finished');
  expect(await page.evaluate(() => (window.game as any).save.ghost('synth-p2p@micro-hatch'))).not.toBeNull();

  const race = async () => {
    await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan', slimeDensity: 'none', ai: false }));
    await page.locator('[data-screen=intro] .departure-go').click();
    await page.waitForFunction(() => window.game.report().phase === 'racing');
  };
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  //The ghost starts off, even with a best run stored.
  expect(await page.evaluate(() => (window.game as any).save.all.showGhost)).toBe(false);
  await race();
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.game.report().ghost.visible)).toBe(false);

  await page.keyboard.press('Escape'); await page.locator('[data-screen=pause] [data-action=settings]').click();
  const toggle = page.locator('[data-screen=settings] [data-setting=showGhost]');
  await expect(toggle).toBeVisible(); await expect(toggle).toHaveValue('off');
  await toggle.selectOption('on');
  await page.locator('[data-screen=settings] [data-setting=back]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().ghost.visible), { timeout: 15_000 }).toBe(true);

  // Back from settings lands on the pause menu again.
  await page.locator('[data-screen=pause] [data-action=settings]').click();
  await expect(toggle).toHaveValue('on');
  await toggle.selectOption('off');
  await page.screenshot({ path: `${out}/settings-off.png` });
  await expect.poll(() => page.evaluate(() => window.game.report().ghost.visible)).toBe(false);
  expect(await page.evaluate(() => (window.game as any).save.all.showGhost)).toBe(false);

  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => (window.game as any).save.all.showGhost)).toBe(false);
  await race();
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.game.report().ghost.visible)).toBe(false);
  // Switched off is not deleted: the stored best run is still there and comes back with the switch.
  expect(await page.evaluate(() => (window.game as any).save.ghost('synth-p2p@micro-hatch'))).not.toBeNull();
  await page.keyboard.press('Escape'); await page.locator('[data-screen=pause] [data-action=settings]').click();
  await expect(toggle).toHaveValue('off');
  await toggle.selectOption('on');
  await page.locator('[data-screen=settings] [data-setting=back]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().ghost.visible), { timeout: 15_000 }).toBe(true);
});
