import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { evidencePath } from './evidence';

// The menu and the departure card read the
// selected car's own record; a record set in another car on the same route never shows.
const out = evidencePath('records-by-vehicle');
test.describe.configure({ timeout: 120_000 });

const seed = (page: Page, vehicles: Record<string, string>) => page.addInitScript(remembered =>
  localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 14, language: 'en', muted: true,
    best: { 'goldengate@sports-car': 150.5, 'goldengate@monster-truck': 222.25, 'synth-p2p@monster-truck': 61 },
    ratings: { 'goldengate@sports-car': 5, 'goldengate@monster-truck': 3 }, vehicles: remembered })), vehicles);

for (const [car, shown] of [['sports-car', '2:30.50'], ['monster-truck', '3:42.25'], ['jeep', '—']] as const) {
  test(`the route card shows the ${car}'s own best`, async ({ page }) => {
    mkdirSync(out, { recursive: true });
    await seed(page, { goldengate: car });
    await page.goto('/'); await page.locator('.home-go').click();
    await expect(page.locator('.sm')).toHaveAttribute('data-step', '0');
    const best = page.locator('.sm-stats .sm-stat').filter({ hasText: 'Best' }).locator('b').first();
    await expect(best).toHaveText(shown, { timeout: 30_000 });
    await page.screenshot({ path: `${out}/menu-${car}.png` });
  });
}

test('the departure card shows the best of the car about to drive', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await seed(page, {});
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  for (const [vehicleId, shown] of [['monster-truck', 'Best 1:01.00'], ['sports-car', 'No time yet']] as const) {
    await page.evaluate(id => window.game.startRace({ trackId: 'synth-p2p', vehicleId: id, slimeDensity: 'none', ai: false }), vehicleId);
    await expect(page.locator('.departure:visible')).toContainText(shown);
    await page.screenshot({ path: `${out}/departure-${vehicleId}.png` });
    await page.locator('.departure:visible').getByRole('button', { name: 'Back' }).click();
    await page.waitForFunction(() => window.game.report().phase === 'menu');
  }
});
