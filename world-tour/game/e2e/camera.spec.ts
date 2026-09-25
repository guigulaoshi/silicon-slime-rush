import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.skip(process.env.CAMERA_QA !== '1', 'Opt-in camera evidence');
test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 1280, height: 720 }, video: { mode: 'on', size: { width: 1280, height: 720 } } });
const OUT = evidencePath('camera');

test('records every view, speed event, accessibility setting and independent split camera', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?dev=1&time=day');
  await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
    slimeDensity: 'normal', playerVehicles: ['micro-hatch'], ai: false }))).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, 'camera evidence');

  const modes: string[] = [];
  for (const [mode, key] of [['chase', null], ['close', 'KeyC'], ['hood', 'KeyC']] as const) {
    if (key) await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => window.game.report().players[0]!.cameraMode)).toBe(mode);
    modes.push(mode);
    await page.screenshot({ path: resolve(OUT, `${mode}.png`) });
  }

  await page.evaluate(() => {
    const s = window.game.session, tangent = s.world.spline.tangent(s.race.progress.value.index);
    s.car.body.setLinvel({ x: tangent[0] * 58, y: 0, z: tangent[2] * 58 }, true);
  });
  await expect.poll(() => page.evaluate(() => window.game.report().players[0]!.cameraFeedback.speed))
    .toBeGreaterThan(.45);
  await page.screenshot({ path: resolve(OUT, 'high-speed.png') });

  const boostBefore = await page.evaluate(() => window.game.report().slimes!.boostEntries);
  await page.evaluate(() => {
    const s = window.game.session as any, layer = s.slimes;
    const index = s.world.spline.indexAt(30), start = s.world.spline.point(index);
    const tangent = s.world.spline.tangent(index), radius = 2.6;
    const boost = [start[0] + tangent[0] * 7, start[1] + radius * .82,
      start[2] + tangent[2] * 7];
    layer.addTile('camera-boost', [{ kind: 'boost', position: boost,
      scale: [radius, radius * .82, radius], yaw: 0 }]);
    s.car.reset([start[0], start[1] + .8, start[2]],
      Math.atan2(-tangent[0], -tangent[2]));
    s.car.body.setLinvel({ x: tangent[0] * 5, y: 0, z: tangent[2] * 5 }, true);
    s.chase.reset();
  });
  await expect.poll(() => page.evaluate(() => window.game.report().slimes!.boostEntries), { timeout: 15_000 })
    .toBeGreaterThan(boostBefore);
  await expect.poll(() => page.evaluate(() => window.game.report().players[0]!.cameraFeedback.boost))
    .toBeGreaterThan(.2);
  await page.screenshot({ path: resolve(OUT, 'yellow-boost.png') });

  const landingBefore = await page.evaluate(() => window.game.report().collisionFeedback.cameraKicks);
  await page.evaluate(() => {
    const s = window.game.session, index = s.world.spline.indexAt(45);
    const p = s.world.spline.point(index), tangent = s.world.spline.tangent(index);
    s.car.reset([p[0], p[1] + 8, p[2]], Math.atan2(-tangent[0], -tangent[2]));
    s.car.body.setLinvel({ x: 0, y: -12, z: 0 }, true); s.chase.reset();
  });
  await expect.poll(() => page.evaluate(() => window.game.report().collisionFeedback.cameraKicks),
    { timeout: 15_000 }).toBeGreaterThan(landingBefore);
  await page.screenshot({ path: resolve(OUT, 'hard-landing.png') });

  await page.keyboard.press('Escape');
  await page.locator('[data-screen=pause] [data-action=settings]').click();
  await page.screenshot({ path: resolve(OUT, 'settings-en.png') });
  await page.locator('[data-screen=settings] [data-setting=language]').selectOption('zh');
  await page.screenshot({ path: resolve(OUT, 'settings-zh.png') });
  await page.locator('[data-screen=settings] [data-setting=reducedMotion]').selectOption('on');
  await page.locator('[data-screen=settings] [data-setting=back]').click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const s = window.game.session;
    s.chase.hit(1); s.car.body.setLinvel({ x: 0, y: 0, z: -60 }, true);
  });
  await expect.poll(() => page.evaluate(() => {
    const f = window.game.report().players[0]!.cameraFeedback;
    return Math.max(f.speed, f.boost, f.shake);
  })).toBeLessThan(.03);
  await page.evaluate(() => (window.game as any).pickSetting({ id: 'reducedMotion', label: '' }));

  // The phone HUD has no camera button; the choice lives in pause -> settings.
  await page.evaluate(() => { document.documentElement.dataset.mobile = 'true'; });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.touch-camera')).toHaveCount(0);
  await page.screenshot({ path: resolve(OUT, 'touch-no-camera-zh.png') });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload(); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
    slimeDensity: 'none', playerVehicles: ['micro-hatch', 'sports-car'], ai: false }))).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  expect(await page.evaluate(() => window.game.report().players.slice(0, 2).map(player => player.cameraMode)))
    .toEqual(['chase', 'chase']);
  await page.keyboard.press('KeyC');
  expect(await page.evaluate(() => window.game.report().players.slice(0, 2).map(player => player.cameraMode)))
    .toEqual(['close', 'chase']);
  await page.keyboard.press('Period');
  expect(await page.evaluate(() => window.game.report().players.slice(0, 2).map(player => player.cameraMode)))
    .toEqual(['close', 'close']);

  const impactBefore = await page.evaluate(() => window.game.report().collisionFeedback.cameraKicks);
  await page.evaluate(() => {
    const s = window.game.session, index = s.world.spline.indexAt(80);
    const centre = s.world.spline.point(index), tangent = s.world.spline.tangent(index);
    const [a, b] = s.humans;
    a!.car.reset([centre[0] - tangent[0] * 5, centre[1] + 1, centre[2] - tangent[2] * 5],
      Math.atan2(-tangent[0], -tangent[2]));
    b!.car.reset([centre[0] + tangent[0] * 5, centre[1] + 1, centre[2] + tangent[2] * 5],
      Math.atan2(tangent[0], tangent[2]));
    a!.car.body.setLinvel({ x: tangent[0] * 12, y: 0, z: tangent[2] * 12 }, true);
    b!.car.body.setLinvel({ x: -tangent[0] * 12, y: 0, z: -tangent[2] * 12 }, true);
    a!.chase.reset(); b!.chase.reset();
  });
  await expect.poll(() => page.evaluate(() => window.game.report().collisionFeedback.cameraKicks),
    { timeout: 15_000 }).toBeGreaterThanOrEqual(impactBefore + 2);
  await page.screenshot({ path: resolve(OUT, 'split-independent-impact.png') });
  const report = await page.evaluate(() => window.game.report());
  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ modes, report }, null, 2));
  const video = page.video(); await page.close();
  if (video) await video.saveAs(resolve(OUT, 'camera-events.webm'));
});
