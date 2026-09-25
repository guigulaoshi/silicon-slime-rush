import { devices, expect, test, type Page } from '@playwright/test';
import type { DriveType } from '../src/physics/CarTuning';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

const OUT = evidencePath('drivetrain');
test.describe.configure({ timeout: 120_000 });

async function begin(page: Page, choice: Record<string, unknown>): Promise<void> {
  expect(await page.evaluate(choice => (window.game as any).startRace(choice), choice)).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
}

test('garage labels and independent desktop instruments show the live drivetrains', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.locator('.home-go').click();
  await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
  await expect(page.locator('.sm-car')).toHaveCount(9);
  const labels = await page.locator('.sm-cardesc').allTextContents();
  expect(labels.every(label => /FWD|RWD|AWD/.test(label))).toBe(true);
  await page.locator('[data-vehicle="sports-car"]').click();
  await expect(page.locator('.sm-drive')).toContainText('Rear-wheel drive');
  await page.screenshot({ path: resolve(OUT, 'garage-en.png') });

  await begin(page, { trackId: 'synth-p2p', car: 'super', vehicleId: 'sports-car', slimeDensity: 'none' });
  await page.evaluate(() => (window.game as any).session.car.body.setLinvel({ x: 0, y: 0, z: -24 }, true));
  await expect(page.locator('.hud-drive')).toHaveText('RWD');
  await page.screenshot({ path: resolve(OUT, 'single-en.png') });

  await begin(page, { trackId: 'synth-p2p', car: 'sedan', slimeDensity: 'none',
    playerVehicles: ['sports-car', 'micro-hatch'] });
  await page.evaluate(() => {
    const racers = (window.game as any).session.racers;
    racers[0].car.body.setLinvel({ x: 0, y: 0, z: -17 }, true);
    racers[1].car.body.setLinvel({ x: 0, y: 0, z: -31 }, true);
  });
  await expect(page.locator('.player-hud')).toHaveCount(2);
  await expect(page.locator('[data-player="1"] .hud-drive')).toHaveText('RWD');
  await expect(page.locator('[data-player="2"] .hud-drive')).toHaveText('AWD');
  await expect.poll(() => page.locator('[data-player="1"] .hud-rpm').textContent()).not.toBe('0.9k');
  const states = await page.locator('.player-hud').evaluateAll(nodes => nodes.map(node => ({
    speed: node.querySelector('.hud-speed-line')?.textContent,
    power: node.querySelector('.hud-power-line')?.textContent,
    rev: (node.querySelector('.hud-rev-fill') as HTMLElement)?.style.width,
  })));
  expect(states[0]).not.toEqual(states[1]);
  writeFileSync(resolve(OUT, 'desktop-instruments.json'), JSON.stringify(states, null, 2) + '\n');
  await page.screenshot({ path: resolve(OUT, 'split-en.png') });
});

test('records the same car taking the same powered corner with all three drive layouts', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const video = page.video()!;
  try {
    await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
    for (const drive of ['fwd', 'rwd', 'awd'] as DriveType[]) {
      await begin(page, { trackId: 'synth-p2p', car: 'super', vehicleId: 'sports-car', slimeDensity: 'none' });
      await page.evaluate(drive => {
        const car = (window.game as any).session.car;
        car.tuning.drive = drive;
        car.body.setLinvel({ x: 0, y: 0, z: -18 }, true);
      }, drive);
      await expect(page.locator('.hud-drive')).toHaveText(drive.toUpperCase());
      await page.keyboard.down('w'); await page.keyboard.down('a');
      await page.waitForTimeout(1800);
      await page.keyboard.up('a'); await page.keyboard.up('w');
      await page.waitForTimeout(350);
    }
  } finally {
    await context.close();
  }
  await video.saveAs(resolve(OUT, 'same-car-drive-comparison.webm'));
});

test('Chinese phone instrument stays below navigation and away from the brake', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 844, height: 390 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      version: 10, language: 'zh', quality: 'low', muted: true,
    })));
    await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
    await begin(page, { trackId: 'shoreline', car: 'hatch', vehicleId: 'city-pod', slimeDensity: 'none' });
    await page.evaluate(() => (window.game as any).session.car.body.setLinvel({ x: 0, y: 0, z: -14 }, true));
    await expect(page.locator('.hud-drive')).toHaveText('前驱');
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      return { nav: box('.hud-nav'), instrument: box('.hud-speed'), brake: box('.touch-brake') };
    });
    expect(boxes.nav.right - boxes.nav.left).toBeGreaterThan(100);
    expect(boxes.nav.bottom - boxes.nav.top).toBeGreaterThan(100);
    expect(boxes.instrument.top).toBeGreaterThanOrEqual(boxes.nav.bottom);
    expect(boxes.instrument.bottom).toBeLessThan(boxes.brake.top);
    writeFileSync(resolve(OUT, 'phone-layout.json'), JSON.stringify(boxes, null, 2) + '\n');
    await page.screenshot({ path: resolve(OUT, 'phone-zh.png') });
  } finally { await context.close(); }
});
