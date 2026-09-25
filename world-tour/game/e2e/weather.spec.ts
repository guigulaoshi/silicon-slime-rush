import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';
import type { TimeOfDay } from '../src/track/types';
import { WEATHERS, type Weather } from '../src/world/Sky';

test.skip(process.env.WEATHER_QA !== '1', 'Opt-in weather evidence');
test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1280, height: 720 }, video: { mode: 'on', size: { width: 1280, height: 720 } } });
const OUT = evidencePath('weather');

test('shows every sky and weather point once, then proves fog and rain remain drivable', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const reports: Record<string, unknown> = {};
  const open = async (time: TimeOfDay, weather: Weather) => {
    await page.goto(`/?dev=1&track=lhasa&bot=1&speed=12&time=${time}&weather=${weather}`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    await expectWorldLoaded(page, `${time}-${weather}`);
    const report = await page.evaluate(() => window.game.report());
    expect(report.sky?.weather).toBe(weather);
    expect(report.weatherSound).toBe(weather);
    reports[`${time}-${weather}`] = report;
    await page.screenshot({ path: resolve(OUT, `${time}-${weather}.png`) });
  };

  await open('day', 'clear');
  await open('night', 'clear');

  await open('day', 'fog');
  expect(await page.evaluate(() => window.game.report().sky!.fogFar)).toBeLessThanOrEqual(220);
  await page.waitForFunction(() => window.game.report().state === 'finished', undefined, { timeout: 90_000 });
  reports['fog-finish'] = await page.evaluate(() => window.game.report());
  await open('night', 'fog');

  await open('day', 'rain');
  expect(await page.evaluate(() => window.game.report().sky!.rainStreaks)).toBeGreaterThan(200);
  await page.waitForFunction(() => window.game.report().thunderSounds > 0, undefined, { timeout: 15_000 });
  await page.waitForFunction(() => window.game.report().sky!.lightning > .5, undefined, { timeout: 15_000 });
  await page.screenshot({ path: resolve(OUT, 'day-rain-lightning.png') });

  await open('night', 'rain');
  await page.waitForFunction(() => window.game.report().state === 'finished', undefined, { timeout: 90_000 });
  reports['rain-finish'] = await page.evaluate(() => window.game.report());

  // One bilingual pass through the actual departure screen proves the weather axis is visible and
  // independent from the time selector. It does not drive another combination.
  await page.goto('/?dev=1');
  await page.locator('.home-go').click();
  await page.waitForFunction(() => window.game?.report().phase === 'menu');
  await page.locator('.sm-go').click();
  await expect(page.locator('[data-weather]')).toHaveCount(WEATHERS.length);
  await page.evaluate(() => { (window.game as any).i18n.set('en'); (window.game as any).start.render(); });
  await page.screenshot({ path: resolve(OUT, 'departure-en.png') });
  await page.evaluate(() => { (window.game as any).i18n.set('zh'); (window.game as any).start.render(); });
  await page.screenshot({ path: resolve(OUT, 'departure-zh.png') });

  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(reports, null, 2));
  const video = page.video(); await page.close();
  if (video) await video.saveAs(resolve(OUT, 'weather-demo.webm'));
});

test('captures the visible sun, moon, stars and lit cloud layer once', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  for (const time of ['day', 'night'] as const) {
    await page.goto(`/?dev=1&track=lhasa&bot=1&time=${time}&weather=clear`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    await expectWorldLoaded(page, `${time}-celestial`);
    await page.evaluate(() => {
      const game = window.game as any;
      cancelAnimationFrame(game.raf);
      const session = game.session;
      const camera = session.world.camera;
      const car = session.mesh.position;
      const light = session.world.sky.sun.position;
      const target = session.world.sky.sun.target.position;
      const dx = light.x - target.x, dy = light.y - target.y, dz = light.z - target.z;
      const length = Math.hypot(dx, dy, dz);
      camera.position.set(car.x, car.y + 4, car.z);
      camera.lookAt(car.x + dx / length * 100, car.y + dy / length * 100, car.z + dz / length * 100);
      session.world.render();
    });
    await page.screenshot({ path: resolve(OUT, `${time}-clear-celestial.png`) });
  }
});
