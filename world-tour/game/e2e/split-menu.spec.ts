import { evidencePath } from './evidence';
import { expect, test, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VEHICLES } from '../src/vehicles/catalogue';
import { MOBILE_AI_RIVALS } from '../src/app/roster';

test.describe.configure({ timeout: 120_000 });
const proof = evidencePath('split-menu');
for (const humans of [1, 2]) for (const ai of [false, true])
  test(`menu starts ${humans} humans with AI ${ai} and returns through restart`, async ({ page }) => {
    mkdirSync(proof, { recursive: true });
    await page.goto('/?dev=1'); await page.locator('.home-go').click(); await page.waitForFunction(() => window.game);
    await page.locator('.sm-item').filter({ hasText: 'Synthetic Sprint' }).click();
    await page.locator('.sm-go').click();
    await page.locator(`[data-ai-mode="${ai ? 'rush' : 'none'}"]`).click();
    await page.locator('[data-time="night"]').click();
    await page.locator('[data-slime-density="none"]').click();
    await page.screenshot({ path: resolve(proof, `conditions-${humans}-${ai}.png`) });
    await page.locator('.sm-go').click();
    if(humans===2)await page.locator('.startup-add-player').click();
    await page.locator('[data-player="0"] [data-vehicle="sports-car"]').click();
    await expect(page.locator('[data-player="0"] .sm-carhero')).toHaveAttribute('data-state', 'ready');
    if (humans === 2) {
      await page.locator('[data-player="1"] [data-vehicle="pickup-travel-trailer"]').click();
      await expect(page.locator('[data-player="1"] .sm-carhero')).toHaveAttribute('data-state', 'ready');
      await expect(page.locator('.sm-go')).toBeEnabled();
      await page.screenshot({ path: resolve(proof, `garage-${ai}.png`) });
    }
    await page.locator('.sm-go').click();
    await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
    const roster = await page.evaluate(() => window.game.session.racers.map(r => ({ role: r.role, vehicle: r.vehicle.id, difficulty: r.difficulty })));
    expect(roster.filter(r => r.role === 'human').map(r => r.vehicle)).toEqual(humans === 1 ? ['sports-car'] : ['sports-car', 'pickup-travel-trailer']);
    expect(roster.filter(r => r.role === 'ai')).toHaveLength(ai ? VEHICLES.length - humans : 0);
    expect(await page.evaluate(() => window.game.report().choice)).toMatchObject({ timeOfDay: 'night', slimeDensity: 'none', ai, ...(ai ? { aiDifficulty: 'rush' } : {}) });
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    expect(await page.evaluate(() => window.game.session.world.cameras.length)).toBe(humans);
    await page.screenshot({ path: resolve(proof, `race-${humans}-${ai}.png`) });
    await page.keyboard.press('Escape');
    await page.locator('[data-action="restart"]').filter({ visible: true }).click();
    await page.locator('dialog[open] [data-dialog-action=confirm]').click();
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    expect(await page.evaluate(() => window.game.session.racers.length)).toBe(roster.length);
    await page.keyboard.press('Escape');
    await page.locator('[data-action="quit"]').filter({ visible: true }).click();
    await page.locator('dialog[open] [data-dialog-action=confirm]').click();
    await page.waitForFunction(() => window.game.report().phase === 'menu');
    await page.locator('.sm-go').click(); await page.locator('[data-ai-mode="none"]').click();
    await page.locator('.sm-go').click(); if(await page.locator('.startup-remove-player').count())await page.locator('.startup-remove-player').click();
    await expect(page.locator('[data-player="0"] .sm-carhero')).toHaveAttribute('data-state', 'ready');
    await page.locator('.sm-go').click();
    await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
    expect(await page.evaluate(() => window.game.session.racers.map(r => r.role))).toEqual(['human']);
    writeFileSync(resolve(proof, `roster-${humans}-${ai}.json`), JSON.stringify(roster, null, 2));
  });

for (const device of ['Pixel 7', 'iPad Pro 11']) test(`${device} offers AI but no split menu`, async ({ browser }) => {
  const context = await browser.newContext({ ...devices[device]!, viewport: { width: devices[device]!.viewport.height, height: devices[device]!.viewport.width }, locale: 'zh-CN' });
  const page = await context.newPage();
  try {
    await page.goto('/?dev=1'); await page.locator('.home-go').click(); await page.waitForFunction(() => window.game);
    await expect(page.locator('.startup-add-player')).toHaveCount(0);
    await page.locator('.sm-go').click(); await page.locator('[data-ai-mode="relaxed"]').click();
    await expect(page.locator('[data-ai-mode="rush"]')).toHaveText('困难');
    mkdirSync(proof, { recursive: true }); await page.screenshot({ path: resolve(proof, `${device.replaceAll(' ', '-')}.png`) });
    await page.locator('.sm-go').click();
    await expect(page.locator('[data-player="0"] .sm-carhero')).toHaveAttribute('data-state', 'ready');
    await page.locator('.sm-go').click(); await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
    expect(await page.evaluate(() => window.game.session.humans.length)).toBe(1);
    // Phones and tablets race MOBILE_AI_RIVALS rivals, not the whole garage.
    expect(await page.evaluate(() => window.game.session.racers.filter(r => r.role === 'ai').length))
      .toBe(MOBILE_AI_RIVALS);
  } finally { await context.close(); }
});


test('simultaneous keyboard choices keep left and right identities and start one race', async ({ page }) => {
  await page.goto('/?dev=1'); await page.locator('.home-go').click(); await page.waitForFunction(() => window.game);
  await page.locator('.sm-item').filter({ hasText: 'Synthetic Sprint' }).click();
  await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
  await page.locator('.startup-add-player').click();
  await expect(page.locator('[data-player="0"] .sm-carhero')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('[data-player="1"] .sm-carhero')).toHaveAttribute('data-state', 'ready');
  const before = await page.locator('.sm-player .sm-car.sel').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).dataset.vehicle));
  await page.keyboard.press('KeyD');
  await expect(page.locator('[data-player="0"] .sm-car.sel')).not.toHaveAttribute('data-vehicle', before[0]!);
  await expect(page.locator('[data-player="0"] .sm-carhero')).toHaveAttribute('data-state', 'ready');
  expect(await page.locator('[data-player="1"] .sm-car.sel').getAttribute('data-vehicle')).toBe(before[1]);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-player="1"] .sm-car.sel')).not.toHaveAttribute('data-vehicle', before[1]!);
  await expect(page.locator('[data-player="1"] .sm-carhero')).toHaveAttribute('data-state', 'ready');
  const selected = await page.locator('.sm-player .sm-car.sel').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).dataset.vehicle));
  expect(selected[0]).not.toBe(before[0]); expect(selected[1]).not.toBe(before[1]);
  // Two real DOM key events in one frame exercise the shared edge sample, not a direct menu call.
  await page.evaluate(() => {
    for (const code of ['Space', 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : 'Enter', bubbles: true }));
    for (const code of ['Space', 'Enter']) window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  });
  await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
  expect(await page.evaluate(() => window.game.session.humans.map(r => r.vehicle.id))).toEqual(selected);
});
