import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';

const OUT = evidencePath('lightweight-sports');
test.describe.configure({ timeout: 120_000 });

test('garage distinguishes both sports cars and the lightweight robot finishes', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?lang=en');
  await page.locator('.home-go').click();
  await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
  const hero = page.locator('[data-player="0"] .sm-carhero');

  await page.locator('[data-player="0"] [data-vehicle="sports-car"]').click();
  await expect(hero).toHaveAttribute('data-model-vehicle', 'sports-car');
  await expect(page.locator('[data-player="0"] .sm-headline')).toContainText('High-performance sports');
  const highPerformance = await hero.locator('canvas').screenshot();
  await page.screenshot({ path: resolve(OUT, 'high-performance-garage.png') });

  await page.locator('[data-player="0"] [data-vehicle="lightweight-sports"]').click();
  await expect(hero).toHaveAttribute('data-model-vehicle', 'lightweight-sports');
  await expect(page.locator('[data-player="0"] .sm-headline')).toContainText('Lightweight sports');
  await expect(page.locator('[data-player="0"] .sm-blurb')).toContainText('quick cornering rhythm');
  const lightweight = await hero.locator('canvas').screenshot();
  expect(lightweight.equals(highPerformance)).toBe(false);
  await page.screenshot({ path: resolve(OUT, 'lightweight-garage.png') });

  await page.goto('/?track=synth-loop&bot=1&dev=1&speed=6&vehicle=lightweight-sports&perfSlimes=none');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await page.waitForFunction(() => window.game.report().time > 3);
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('#ui,.touch-controls,.tuning-panel,#perf-readout')
      .forEach(node => { node.style.display = 'none'; });
  });
  await page.screenshot({ path: resolve(OUT, 'lightweight-on-road.png') });
  await page.waitForFunction(() => window.game.report().state === 'finished', null, { timeout: 90_000 });
  const report = await page.evaluate(() => window.game.report());
  expect(report.vehicle).toBe('lightweight-sports');
  expect(report.resets).toBe(0);
  expect(report.state).toBe('finished');
  writeFileSync(resolve(OUT, 'robot-report.json'), JSON.stringify(report, null, 2) + '\n');
});
