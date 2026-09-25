import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

/**
 * How fast the driver gets round with nothing in its way. One car, no AI field, no slimes, so
 * the number moves only when the driving does -- a full grid swings a sports car's time by tens of
 * seconds from one contact (390), which is too noisy to tune a racing line against.
 */
const TRACK = process.env.SOLO_TRACK ?? 'fishermans-wharf';
const TIER = process.env.SOLO_TIER ?? 'rush';
const CAR = process.env.SOLO_CAR ?? 'sports-car';
test.describe.configure({ timeout: 900_000 });

test(`solo lap on ${TRACK} in a ${CAR} driven at ${TIER}`, async ({ page }) => {
  const out = evidencePath('solo-lap'); mkdirSync(out, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ muted: true })));
  await page.goto('/?dev=1&bot=1&speed=6'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(({ track, car }) => window.game.startRace({ trackId: track, playerVehicles: [car],
    ai: false, slimeDensity: 'none' } as any), { track: TRACK, car: CAR })).toBe(true);
  await page.evaluate(tier => {
    const w = window as any;
    w.game.setAutopilot(0, true, tier);
    // Where the driver actually spends its time: the ceiling that decided each lifted frame, and how far
    // from the centreline it runs -- a racing line shows up in both before it shows up in the lap time.
    const racer = w.game.session.racers[0];
    w.lap = { frames: 0, full: 0, limits: {} as Record<string, number>, lateral: 0, absLateral: 0, topSpeed: 0 };
    const update = racer.car.update.bind(racer.car);
    racer.car.update = (dt: number, input: any) => {
      update(dt, input);
      if (racer.race.state !== 'racing') return;
      const l = w.lap;
      l.frames++;
      l.lateral += racer.race.progress.value.lateral;
      l.absLateral += Math.abs(racer.race.progress.value.lateral);
      l.topSpeed = Math.max(l.topSpeed, racer.car.forwardSpeed);
      if (input.throttle >= 1 && !input.brake) l.full++;
      else { const why = input.brake ? `brake:${racer.bot.limit}` : racer.bot.limit; l.limits[why] = (l.limits[why] ?? 0) + 1; }
    };
    w.game.beginCountdown?.();
  }, TIER);
  await page.waitForFunction(() => window.game.report().phase === 'racing', undefined, { timeout: 120_000 });
  await page.waitForFunction(() => window.game.session.racers[0]?.race.state === 'finished', undefined, { timeout: 600_000 });
  const facts = await page.evaluate(({ track, tier, car }) => {
    const w = window as any, racer = w.game.session.racers[0], l = w.lap, lifted = l.frames - l.full;
    return { track, tier, car, time: +racer.race.time.toFixed(2), resets: w.game.report().players[0].resets.length,
      topSpeed: +l.topSpeed.toFixed(1), fullThrottleShare: +(l.full / l.frames).toFixed(3),
      meanLateral: +(l.lateral / l.frames).toFixed(2), meanAbsLateral: +(l.absLateral / l.frames).toFixed(2),
      liftReasons: Object.fromEntries(Object.entries(l.limits as Record<string, number>).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, +(v / Math.max(1, lifted)).toFixed(3)])) };
  }, { track: TRACK, tier: TIER, car: CAR });
  writeFileSync(resolve(out, `${TRACK}-${TIER}-${CAR}.json`), JSON.stringify(facts, null, 2));
  console.log('SOLO451', JSON.stringify(facts));
  expect(facts.resets, 'a solo lap needs no rescue').toBe(0);
});
