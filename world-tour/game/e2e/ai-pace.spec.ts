import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

/**
 * With slimes on, on a real route over 3 km, the hard AI sports car must beat the school bus
 * by at least 20 %. The bus is driven by the same hard AI -- the fastest this code can take a bus --
 * because a bus with its throttle pinned and no brakes pins itself against the first rail early into a
 * dense course. // RETARGET-MEASURE: metres into new-york where the hard AI school bus stalls
 * Records every racer's finish time and the sports car's throttle use on straights.
 * AI_PACE_TRACK and AI_PACE_DIFFICULTY pick the route and tier; evidence goes to ai-pace.
 */
// new-york: p2p, 3273 m (game/public/tracks/new-york/track.json spline.length) -- over the 3 km this
// test requires, and a dense city route like fishermans-wharf was (deleted with the Bay Area tracks).
const TRACK = process.env.AI_PACE_TRACK ?? 'new-york';
const DIFFICULTY = process.env.AI_PACE_DIFFICULTY ?? 'rush';
test.describe.configure({ timeout: 900_000 });

// @version: a whole real route with a full grid takes about a minute and loads the machine, so it
// belongs to the version and full tiers rather than every delivery.
test(`hard AI sports car beats the hard AI school bus on ${TRACK} with slimes`, { tag: '@version' }, async ({ page }) => {
  const out = evidencePath('ai-pace'); mkdirSync(out, { recursive: true });
  await page.goto('/?dev=1&bot=1&speed=6'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(({ track, difficulty }) => window.game.startRace({ trackId: track, car: 'sedan',
    playerVehicles: ['micro-hatch'], ai: true, aiDifficulty: difficulty as any, slimeDensity: 'normal' }),
  { track: TRACK, difficulty: DIFFICULTY })).toBe(true);
  await page.evaluate(() => {
    const s = (window.game as any).session, w = window as any;
    w.pace = { straight: 0, straightFull: 0, following: 0, frames: 0, edge: 0, samples: [] as number[][] };
    const sports = s.racers.find((r: any) => r.role === 'ai' && r.vehicle.id === 'sports-car');
    const updateSports = sports.car.update.bind(sports.car);
    sports.car.update = (dt: number, input: any) => {
      updateSports(dt, input);
      if (sports.race.state !== 'racing') return;
      w.pace.frames++; if (sports.bot.trafficFollowing) w.pace.following++;
      if (Math.abs(sports.race.progress.value.lateral) > (s.world.spline.halfWidth[sports.race.progress.value.index] ?? 6) * .55) w.pace.edge++;
      const at = sports.race.progress.value.index, spline = s.world.spline;
      let bend = 0; for (let k = -10; k <= 40; k++) bend = Math.max(bend, spline.curvature[spline.wrapIndex(at + k)] ?? 0);
      if (bend < 1 / 400) { w.pace.straight++; if (input.throttle >= 1 && !input.brake) w.pace.straightFull++; }
      if (w.pace.samples.length < 20000) w.pace.samples.push([sports.race.time, sports.car.speed, input.throttle, input.brake]);
    };
    // The player's car stays on the grid. It starts behind every AI car, so it blocks nobody, and a solo
    // race ends when the player crosses the line: an automated player that finished first froze the
    // city pod 5 m short of the line and failed "every AI finishes" (full tier on e733b82a).
    (window.game as any).beginCountdown?.();
  });
  await page.waitForFunction(() => window.game.report().phase === 'racing', undefined, { timeout: 120_000 });
  const deadline = Date.now() + 840_000;
  for (let beat = 0; Date.now() < deadline; beat++) {
    const state = await page.evaluate(() => {
      const s = (window.game as any).session;
      const pick = (r: any) => ({ id: r.vehicle.id, state: r.race.state, t: +r.race.time.toFixed(1),
        m: Math.round(r.race.progress.value.s ?? 0), v: +r.car.speed.toFixed(1), resets: r.race.resetLog?.length ?? 0 });
      const sports = s.racers.find((r: any) => r.vehicle.id === 'sports-car' && r.role === 'ai');
      const bus = s.racers.find((r: any) => r.vehicle.id === 'school-bus' && r.role === 'ai');
      return { all: s.racers.map((r: any) => `${r.vehicle.id}:${r.race.state[0]}:${Math.round(r.race.progress.value.s ?? 0)}:${r.car.speed.toFixed(0)}`).join(' '), bus: pick(bus), sports: pick(sports), scale: (window.game as any).timeScale, phase: window.game.report().phase };
    });
    if (beat % 6 === 0) console.log('BEAT', JSON.stringify(state));
    if (state.all.split(' ').slice(1).every((x: string) => x.split(':')[1] === 'f')) break;
    await page.waitForTimeout(5000);
  }
  const facts = await page.evaluate(() => {
    const s = (window.game as any).session, w = window as any;
    const reported = window.game.report().players;
    return { racers: s.racers.map((r: any, i: number) => ({ id: r.vehicle.id, role: r.role, state: r.race.state,
      time: r.race.time, resets: reported[i]?.resets.length ?? null })),
    straightShare: w.pace.straight ? w.pace.straightFull / w.pace.straight : null,
    followingShare: w.pace.frames ? w.pace.following / w.pace.frames : null, edgeShare: w.pace.frames ? w.pace.edge / w.pace.frames : null,
    topSpeed: Math.max(...w.pace.samples.map((x: number[]) => x[1])) };
  });
  const bus = facts.racers.find((r: any) => r.id === 'school-bus' && r.role === 'ai')!, sports = facts.racers.find((r: any) => r.id === 'sports-car' && r.role === 'ai')!;
  writeFileSync(resolve(out, `${TRACK}-${DIFFICULTY}-${process.env.AI_PACE_LABEL ?? 'run'}.json`), JSON.stringify(facts, null, 2));
  console.log('PACE', JSON.stringify({ track: TRACK, difficulty: DIFFICULTY, bus: bus.time, sports: sports.time,
    ratio: sports.time / bus.time, straightShare: facts.straightShare, followingShare: facts.followingShare, edgeShare: facts.edgeShare, topSpeed: facts.topSpeed }));
  if (process.env.AI_PACE_ASSERT !== '0') {
    expect(facts.racers.filter((r: any) => r.role === 'ai').every((r: any) => r.state === 'finished'), 'every AI finishes').toBe(true);
    expect(facts.racers.filter((r: any) => r.role === 'ai').map((r: any) => r.resets), 'no AI needed a rescue').toEqual(
      facts.racers.filter((r: any) => r.role === 'ai').map(() => 0));
    expect(sports.time).toBeLessThanOrEqual(bus.time * 0.8);
  }
});
