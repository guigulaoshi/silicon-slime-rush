import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

/**
 * How hard the AI leans on its throttle, and what lifts it. Drives one real route with slimes
 * and a full grid at the chosen tier (AI_PACE_DIFFICULTY), counts the fastest AI car's racing frames
 * at full throttle, and attributes every frame below full throttle to the autopilot's deciding speed
 * ceiling. The human car is driven by the acceptance autopilot so it also finishes.
 */
const TRACK = process.env.AI_PACE_TRACK ?? 'fishermans-wharf';
const DIFFICULTY = process.env.AI_PACE_DIFFICULTY ?? 'rush';
const PLAYER = process.env.AI_PACE_PLAYER ?? 'sedan';
const WATCH = process.env.AI_PACE_WATCH ?? 'sports-car';
/** Standing still longer than this is a car that is stuck, not one that is slow: measured, the worst
 * honest wait in a full grid is about 6 s of queueing behind a bus. */
const STUCK_SECONDS = 15;
test.describe.configure({ timeout: 900_000 });

test(`AI throttle use on ${TRACK} at ${DIFFICULTY}`, { tag: '@version' }, async ({ page }) => {
  const out = evidencePath('ai-pace'); mkdirSync(out, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ muted: true })));
  if (process.env.AI_PACE_DUMP) await page.addInitScript(() => { (window as any).__dump = true; });
  await page.goto('/?dev=1&bot=1&speed=6'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(({ track, difficulty, player, weather }) => window.game.startRace({ trackId: track, playerVehicles: [player],
    ai: true, aiDifficulty: difficulty as any, slimeDensity: 'normal', ...(weather ? { weather: weather as any } : {}) }),
  { track: TRACK, difficulty: DIFFICULTY, player: PLAYER, weather: process.env.AI_PACE_WEATHER ?? '' })).toBe(true);
  await page.evaluate(watch => {
    const s = (window.game as any).session, w = window as any;
    w.pace = { frames: 0, full: 0, limits: {} as Record<string, number>, straight: 0, straightFull: 0 };
    const racer = s.racers.find((r: any) => r.role === 'ai' && r.vehicle.id === watch) ?? s.racers.find((r: any) => r.role === 'ai');
    w.pace.watch = racer.vehicle.id;
    const update = racer.car.update.bind(racer.car);
    racer.car.update = (dt: number, input: any) => {
      update(dt, input);
      if (racer.race.state !== 'racing') return;
      w.pace.frames++;
      const spline = s.world.spline, at = racer.race.progress.value.index;
      let bend = 0; for (let k = -10; k <= 40; k++) bend = Math.max(bend, spline.curvature[spline.wrapIndex(at + k)] ?? 0);
      const straight = bend < 1 / 400;
      if (straight) w.pace.straight++;
      if (input.throttle >= 1 && !input.brake) { w.pace.full++; if (straight) w.pace.straightFull++; }
      else { const why = input.brake ? `brake:${racer.bot.limit}` : racer.bot.limit; w.pace.limits[why] = (w.pace.limits[why] ?? 0) + 1; }
    };
    // Reliability, as the player judges it (not rescues but how
    // long a car stands still on the road with the race on, and the longest single stand.
    w.stall = {} as Record<string, { total: number; worst: number; run: number; at: number }>;
    for (const r of s.racers) {
      const tick = r.car.update.bind(r.car);
      r.car.update = (dt: number, input: any) => {
        tick(dt, input);
        if (r.race.state !== 'racing') return;
        const st = (w.stall[r.vehicle.id] ??= { total: 0, worst: 0, run: 0, at: r.race.time });
        // Race time, not the step's dt: a car's update runs more than once per race second (the player's
        // ran sixteen times), and counting dt made a 290 s race report 4757 s of standing still.
        const elapsed = Math.max(0, r.race.time - st.at); st.at = r.race.time;
        if (Math.abs(r.car.forwardSpeed) < .5) { st.run += elapsed; st.total += elapsed; st.worst = Math.max(st.worst, st.run); }
        else st.run = 0;
      };
    }
    // Driving decisions cost, every AI together, per physics step: an upper bound on the traffic planner.
    w.plan = { steps: 0, ms: 0, worst: 0, last: -1, stepMs: 0 };
    const dump = (window as any).__dump === true; w.last = {};
    for (const r of s.racers.filter((x: any) => x.role === 'ai')) {
      const drive = r.bot.drive.bind(r.bot);
      r.bot.drive = (...args: any[]) => { const t0 = performance.now(); const out = drive(...args); const ms = performance.now() - t0;
        const step = r.race.time; if (step !== w.plan.last) { w.plan.worst = Math.max(w.plan.worst, w.plan.stepMs); w.plan.stepMs = 0; w.plan.steps++; w.plan.last = step; }
        w.plan.stepMs += ms; w.plan.ms += ms;
        if (dump) w.last[r.vehicle.id] = { car: args[1], at: args[2], traffic: args[4] ? { own: args[4].own, bodies: args[4].bodies } : null,
          avoidOffset: r.bot.avoidOffset, brakingAccel: r.bot.settings.brakingAccel, trafficHeadway: r.bot.settings.trafficHeadway, out };
        return out; };
    }
    (window.game as any).autopilot = true;
    (window.game as any).beginCountdown?.();
  }, WATCH);
  // A skilled human stand-in: the player's own car driven by an AI tier's plan, with no catch-up.
  if (process.env.AI_PACE_PLAYER_DRIVER) await page.evaluate(tier => window.game.setAutopilot(0, true, tier as any), process.env.AI_PACE_PLAYER_DRIVER);
  await page.waitForFunction(() => window.game.report().phase === 'racing', undefined, { timeout: 120_000 });
  const cdp = await page.context().newCDPSession(page);
  const deadline = Date.now() + 840_000;
  const stuckSeen = new Map<string, { metres: string; count: number }>(); let stuckSaved = false;
  while (Date.now() < deadline) {
    const probe = page.evaluate(() => {
      const w = window as any, racers = w.game.session.racers;
      w.maxAssist = Math.max(w.maxAssist ?? 1, ...racers.map((r: any) => r.car.assist));
      // A solo race ends when the player crosses the line; the AI still out there stops where it is.
      return { done: racers.every((r: any) => r.race.state === 'finished') || racers.filter((r: any) => r.role === 'human').every((r: any) => r.race.state === 'finished'),
        scale: w.game.timeScale,
        racers: racers.map((r: any) => `${r.vehicle.id}:${r.role[0]}:${r.race.state[0]}:${r.race.time.toFixed(0)}s:${Math.round(r.raceDistance())}m:${r.race.progress.value.lateral.toFixed(1)}:${r.car.forwardSpeed.toFixed(1)}:${r.bot.limit}:${(r.bot as any).reversing?.toFixed?.(1) ?? ''}`) };
    });
    const done = await Promise.race([probe, new Promise<'hung'>(ok => setTimeout(() => ok('hung'), 20_000))]);
    if (done !== 'hung' && process.env.AI_PACE_BEAT) console.log('BEAT', new Date().toISOString().slice(11, 19), JSON.stringify(done));
    if (done !== 'hung' && done.done) break;
    // Stuck snapshot: an AI still racing that has not moved a metre over three probes.
    if (done !== 'hung' && process.env.AI_PACE_DUMP && !stuckSaved) {
      for (const line of done.racers) {
        const [id, role, state, , metres] = line.split(':');
        if (role !== 'a' || state !== 'r') continue;
        const seen = stuckSeen.get(id) ?? { metres, count: 0 };
        seen.count = seen.metres === metres ? seen.count + 1 : 0; seen.metres = metres; stuckSeen.set(id, seen);
        if (seen.count >= 3 && !stuckSaved) {
          stuckSaved = true;
          writeFileSync(`${process.env.AI_PACE_DUMP}.stuck.json`, JSON.stringify({ id, racers: done.racers, last: await page.evaluate(() => (window as any).last) }));
          console.log('STUCK', id, metres);
        }
      }
    }
    if (done === 'hung') {
      await cdp.send('Debugger.enable');
      const paused = new Promise<any>(ok => cdp.once('Debugger.paused', ok));
      await cdp.send('Debugger.pause');
      const event = await paused;
      console.log('HUNG', JSON.stringify(event.callFrames.slice(0, 12).map((f: any) => `${f.functionName} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}:${f.location.columnNumber}`)));
      throw new Error('page hung');
    }
    await page.waitForTimeout(5000);
  }
  const facts = await page.evaluate(() => {
    const s = (window.game as any).session, w = window as any, reported = window.game.report().players;
    const frames = w.pace.frames, lifted = frames - w.pace.full;
    return { watch: w.pace.watch, maxAssistSeen: w.maxAssist ?? 1,
      stalls: Object.fromEntries(Object.entries(w.stall as Record<string, { total: number; worst: number }>)
        .map(([id, st]) => [id, [+st.total.toFixed(1), +st.worst.toFixed(1)]]).filter(([, v]) => (v as number[])[0]! > 1)),
      planMsPerStep: w.plan.steps ? +(w.plan.ms / w.plan.steps).toFixed(4) : null, planWorstStepMs: +w.plan.worst.toFixed(3), racers: s.racers.map((r: any, i: number) => ({ id: r.vehicle.id, role: r.role, state: r.race.state,
      time: +r.race.time.toFixed(2), metres: Math.round(r.raceDistance()), resets: reported[i]?.resets.length ?? null, resetLog: reported[i]?.resets ?? [] })),
      fullThrottleShare: frames ? w.pace.full / frames : null,
      straightFullShare: w.pace.straight ? w.pace.straightFull / w.pace.straight : null,
      liftReasons: Object.fromEntries(Object.entries(w.pace.limits as Record<string, number>).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, +(v / Math.max(1, lifted)).toFixed(3)])) };
  });
  writeFileSync(resolve(out, `${TRACK}-${DIFFICULTY}-${process.env.AI_PACE_LABEL ?? 'run'}.json`), JSON.stringify(facts, null, 2));
  console.log('PACE390', JSON.stringify(facts));
  if (process.env.AI_PACE_DUMP) writeFileSync(process.env.AI_PACE_DUMP, JSON.stringify(await page.evaluate(() => (window as any).last)));
  if (!process.env.AI_PACE_PLAYER_DRIVER) {
    // A solo race ends when the player crosses the line, so an unfinished AI is not news: a school bus is
    // half a lap behind a quick field on Lombard's hairpins and has done nothing wrong. What would be news
    // is a car that stood still, so that is what this asks. Distance called slow cars stuck, which is a
    // different thing and not one a pace run may fail on.
    const stuck = Object.entries(facts.stalls as Record<string, [number, number]>)
      .filter(([, [, worst]]) => worst > STUCK_SECONDS).map(([id]) => id);
    expect(stuck, `no car stood still for more than ${STUCK_SECONDS}s`).toEqual([]);
  }
  expect(facts.racers.map((r: any) => r.resets), 'no racer needed a rescue').toEqual(facts.racers.map(() => 0));
});
