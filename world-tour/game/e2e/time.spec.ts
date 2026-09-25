import { expect, test } from '@playwright/test';

/**
 * `?time=day|night`, the switch every appearance screenshot is taken with.
 *
 * Its own file because it drives: `start.spec.ts` is the menu, and the menu is the one browser file
 * that stays under a minute. This one loads a world, so it asks for a world's budget.
 */
test.describe.configure({ timeout: 180_000 });

test('?time= changes the time of day and nothing else', async ({ page }) => {
  // The automated run and every screenshot go through this. It once built a whole `choice` to
  // carry the time, which also picked the car: `?time=day` turned sydney's convertible into a
  // sedan, so a picture taken with it was a different drive from one taken without.
  await page.goto('/?track=sydney&bot=1&speed=4');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  const original = await page.evaluate(() => ({ vehicle: window.game.report().vehicle,
    speed: window.game.session.car.tuning.maxSpeed }));
  await page.goto('/?track=sydney&bot=1&time=day&speed=4');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  const seen = await page.evaluate(() => ({
    lightsOn: window.game.session.world.headlights.on,
    car: window.game.session.car.tuning.maxSpeed,
    vehicle: window.game.report().vehicle,
    choice: window.game.report().choice,
  }));
  expect(seen.lightsOn, 'daylight means no headlights').toBe(false);
  expect(seen.choice, 'a URL time is not a player choice').toBeNull();
  // Compare the selected vehicle, not the retired placeholder car's speed.
  expect(seen.vehicle).toBe(original.vehicle);
  expect(seen.car).toBe(original.speed);
});
