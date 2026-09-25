import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { presetForLatitude, withTint } from '../src/world/Sky';
import type { TimeOfDay } from '../src/track/types';
import { expectWorldLoaded } from './world';
import { recordKey } from '../src/app/Save';

test('player time persists, track defaults survive migration, and bot overrides stay isolated', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('silicon-rush-world-tour.save.v1')) localStorage.setItem('silicon-rush-world-tour.save.v1',
      JSON.stringify({ version: 2, language: 'en', best: { lhasa: 123 } }));
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
        zenith: s.world.sky.dome.material.uniforms.uZenith.value.getHex(),
        lat: s.track.origin?.lat as number | undefined,
        tint: s.track.sky as { zenithColor?: string; skyColor?: string; fogColor?: string } | undefined };
    });
    // World.ts builds the sky from the shared time-of-day preset mixed with the route's own latitude
    // (elevation/azimuth) and sky tint (a route's own daylight colour, task/Sky.withTint); replicate
    // that same composition rather than comparing against the untinted shared preset directly.
    const preset = withTint(presetForLatitude(time, actual.lat), time, actual.tint);
    expect({ lamps: actual.lamps, sun: actual.sun, fog: actual.fog, zenith: actual.zenith }).toEqual({
      lamps: time === 'night', sun: preset.sunIntensity, fog: preset.fogColor, zenith: preset.zenithColor });
    await expectWorldLoaded(page, `time-${time}`);
  };
  // dubai's own authored default is night (game/public/tracks/dubai/track.json); goldengate's was
  // too, and that -- not the bridge/showcase framing sydney is used for elsewhere -- is the one
  // property this line needs, since no player preference has been saved yet.
  await start('dubai');
  const defaultTime = await page.evaluate(() => (window.game as any).session.track.timeOfDay as TimeOfDay);
  expect(defaultTime).toBe('night');
  await assertTime(defaultTime);
  expect(await page.evaluate(() => (window.game as any).save.all.timeOfDay)).toBeNull();
  const shots = evidencePath('time'); mkdirSync(shots, { recursive: true });
  for (const time of ['day', 'night'] as const) {
    await start('dubai', time);
    await assertTime(time);
    // The countdown loads the road; no complete drive is needed for appearance QA.
    await page.screenshot({ path: resolve(shots, `${time}.png`) });
  }
  await page.reload(); await page.locator('.home-go').click();
  await page.waitForFunction(() => window.game?.report().phase === 'menu');
  // 'night' here comes from the player preference saved by the dubai loop above, not from lhasa's
  // own default (lhasa's own authored default is day) -- this is exactly the migration behaviour
  // under test: a saved time-of-day choice outlives a switch to an unrelated track.
  await start('lhasa');
  await assertTime('night');
  const saved = await page.evaluate(() => localStorage.getItem('silicon-rush-world-tour.save.v1'));
  const version = await page.evaluate(() => (window.game as any).save.all.version);
  // Keys records by route and vehicle; a pre route-only record moves to the garage's fallback car.
  expect(JSON.parse(saved!)).toMatchObject({ version, timeOfDay: 'night', best: { [recordKey('lhasa', 'micro-hatch')]: 123 } });
  await page.evaluate(() => window.game.autoRun('lhasa', 'day'));
  await assertTime('day');
  expect(await page.evaluate(() => localStorage.getItem('silicon-rush-world-tour.save.v1'))).toBe(saved);
  await start('lhasa', 'night');
  await assertTime('night');
  expect(await page.evaluate(() => window.game.autopilot)).toBe(false);
});
