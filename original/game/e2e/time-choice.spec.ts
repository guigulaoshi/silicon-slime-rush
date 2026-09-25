import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { SKY_PRESETS } from '../src/world/Sky';
import type { TimeOfDay } from '../src/track/types';
import { expectWorldLoaded } from './world';
import { recordKey } from '../src/app/Save';

test('player time persists, track defaults survive migration, and bot overrides stay isolated', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('silicon-rush.save.v1')) localStorage.setItem('silicon-rush.save.v1',
      JSON.stringify({ version: 2, language: 'en', best: { shoreline: 123 } }));
  });
  await page.goto('/?dev=1'); await page.locator('.home-go').click();
  await page.waitForFunction(() => window.game?.report().phase === 'menu');
  const start = async (trackId: string, timeOfDay?: TimeOfDay) => {
    expect(await page.evaluate(args => window.game.startRace({ ...args, car: 'sedan',
      slimeDensity: 'none' }), { trackId, timeOfDay })).toBe(true);
    await page.evaluate(() => (window.game as any).beginCountdown());
  };
  const assertTime = async (time: TimeOfDay) => {
    await page.waitForFunction(() => (window.game.report().tiles?.loaded ?? 0) > 0);
    const actual = await page.evaluate(() => {
      const s = (window.game as any).session;
      return { lamps: s.world.headlights.on, sun: s.world.sky.sun.intensity,
        fog: s.world.scene.fog.color.getHex(),
        zenith: s.world.sky.dome.material.uniforms.uZenith.value.getHex() };
    });
    expect(actual).toEqual({ lamps: time === 'night', sun: SKY_PRESETS[time].sunIntensity,
      fog: SKY_PRESETS[time].fogColor, zenith: SKY_PRESETS[time].zenithColor });
    await expectWorldLoaded(page, `time-${time}`);
  };
  await start('goldengate');
  const defaultTime = await page.evaluate(() => (window.game as any).session.track.timeOfDay as TimeOfDay);
  expect(defaultTime).toBe('night');
  await assertTime(defaultTime);
  expect(await page.evaluate(() => (window.game as any).save.all.timeOfDay)).toBeNull();
  const shots = evidencePath('time'); mkdirSync(shots, { recursive: true });
  for (const time of ['day', 'night'] as const) {
    await start('goldengate', time);
    await assertTime(time);
    // The countdown loads the road; no complete drive is needed for appearance QA.
    await page.screenshot({ path: resolve(shots, `${time}.png`) });
  }
  await page.reload(); await page.locator('.home-go').click();
  await page.waitForFunction(() => window.game?.report().phase === 'menu');
  await start('shoreline');
  await assertTime('night');
  const saved = await page.evaluate(() => localStorage.getItem('silicon-rush.save.v1'));
  const version = await page.evaluate(() => (window.game as any).save.all.version);
  // Keys records by route and vehicle; a pre route-only record moves to the garage's fallback car.
  expect(JSON.parse(saved!)).toMatchObject({ version, timeOfDay: 'night', best: { [recordKey('shoreline', 'micro-hatch')]: 123 } });
  await page.evaluate(() => window.game.autoRun('shoreline', 'day'));
  await assertTime('day');
  expect(await page.evaluate(() => localStorage.getItem('silicon-rush.save.v1'))).toBe(saved);
  await start('shoreline', 'night');
  await assertTime('night');
  expect(await page.evaluate(() => window.game.autopilot)).toBe(false);
});
