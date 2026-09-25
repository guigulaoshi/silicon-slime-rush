import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePathOr } from './evidence';
import { captureFrames, rendererFacts } from './frame-sample';
import { expectWorldLoaded } from './world';
import { checkMaximum, checkMinimum } from '../test-support/resource-limit';

/**
 * A whole snow race on lhasa (shoreline's replacement, see the retarget brief) with
 * every AI. Ruts laid on the opening straight are photographed from one fixed camera early and
 * again at the finish, more than 60 s of race later, and the race reports what the kept marks
 * cost. TRAIL_LABEL names the build (before/after).
 */
const LABEL = process.env.TRAIL_LABEL ?? 'after';
const OUT = evidencePathOr(process.env.TRAIL_OUTPUT, 'trail-marks');
test.describe.configure({ timeout: 900_000 });

async function shot(page: Page, name: string): Promise<{ time: number; marks: unknown }> {
  const image = await page.evaluate(() => {
    const game = window.game as any, s = game.session, w = s.world, spline = w.spline;
    game.phase = 'paused';
    const at = 60, p = spline.point(spline.indexAt(at)), q = spline.point(spline.indexAt(at + 30));
    const camera = w.cameras[0];
    camera.position.set(p[0] + 7, p[1] + 9, p[2] + 7);
    camera.lookAt(q[0], q[1], q[2]);
    camera.updateMatrixWorld();
    w.render(() => {});
    camera.position.set(p[0] + 7, p[1] + 9, p[2] + 7); camera.lookAt(q[0], q[1], q[2]); camera.updateMatrixWorld();
    w.renderer.render(w.scene, camera);
    return w.renderer.domElement.toDataURL('image/png');
  });
  writeFileSync(resolve(OUT, `${LABEL}-${name}.png`), Buffer.from(image.split(',')[1]!, 'base64'));
  return page.evaluate(() => ({ time: (window.game as any).session.race.time, marks: window.game.report().tireMarks }));
}

interface Progress { s: number; lapS: number; lap: number; laps: number; length: number; time: number; raceState: string }
const rescues: { s: number; time: number }[] = [];
let lastS = 0, lastMoved = 0;

/** Lets the robot drive until `done`; a robot wedged for 15 s of race is lifted 30 m on and recorded. */
async function driveUntil(page: Page, done: (state: Progress) => boolean): Promise<void> {
  for (const started = Date.now(); ; ) {
    const state = await page.evaluate(() => {
      const game = window.game as any, s = game.session, r = game.report();
      const length = s.world.spline.length, lapS = s.race.progress.value.s;
      return { s: Math.round((s.race.lap - 1) * length + lapS), lapS: Math.round(lapS), laps: s.race.totalLaps,
        length: Math.round(length), time: Math.round(s.race.time),
        phase: r.phase, raceState: s.race.state, lap: s.race.lap, fps: r.fps, marks: r.tireMarks, speed: Math.round(s.car.speed) };
    });
    if (done(state)) return;
    if (Date.now() - started > 600_000) throw new Error(`never got there: ${JSON.stringify(state)}`);
    if (process.env.TRAIL_TRACE) console.log(JSON.stringify(state));
    // The robot can wedge itself on a tight point along the route. Marks are what is under test,
    // so after 15 s of race without progress it is lifted 30 m on; every lift is written into the facts.
    if (state.s <= lastS + 2 && state.time - lastMoved > 15) {
      if (!rescues.length) await page.screenshot({ path: resolve(OUT, `${LABEL}-stuck.png`) });
      rescues.push({ s: state.s, time: state.time });
      await page.evaluate(() => {
        const s = (window.game as any).session, spline = s.world.spline, index = spline.indexAt((s.race.progress.value.s + 30) % spline.length);
        const p = spline.point(index), t = spline.tangent(index);
        s.car.reset([p[0], p[1] + 1.2, p[2]], Math.atan2(-t[0], -t[2]));
        s.racers[0].race.reacquire(p[0], p[2]); s.racers[0].bot.reset(); s.racers[0].chase.reset();
      });
      lastMoved = state.time;
    } else if (state.s > lastS + 2) { lastS = state.s; lastMoved = state.time; }
    await page.waitForTimeout(5000);
  }
}

async function race(page: Page): Promise<void> {
  rescues.length = 0; lastS = 0; lastMoved = 0;
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {} })));
  await page.goto('/?dev=1&bot=1&speed=8'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'lhasa', car: 'sedan', timeOfDay: 'day',
    weather: 'snow', ai: true, aiDifficulty: 'rush', slimeDensity: 'normal' } as any, true))).toBe(true);
  await page.evaluate(() => { (window.game as any).autopilot = true; });
  await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 120_000 });
  await driveUntil(page, state => state.s > 400);
  await expectWorldLoaded(page, 'trail-marks-early');
  const early = await shot(page, 'early');
  await page.evaluate(() => { (window.game as any).phase = 'racing'; });
  // Stop just short of the final line, so the world is still the race's and every AI has driven the whole road.
  // A 5 s poll at 8x covers well over 250 m in the faster cars, so the race can finish between
  // two looks; the finished race still has every mark and every AI's full drive behind it.
  await driveUntil(page, state => (state.lap >= state.laps && state.lapS > state.length - 250) || state.raceState === 'finished');
  const late = await shot(page, 'late');
  const cost = await page.evaluate(() => {
    const w = (window.game as any).session.world, info = w.renderer.info;
    const memory = (performance as any).memory;
    return { geometries: info.memory.geometries, textures: info.memory.textures,
      jsHeapMb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
      trackMetres: Math.round(w.spline.length), racers: (window.game as any).session.racers.length };
  });
  // Real-time frames with every mark of the race behind the car: back to 1x, the robot still driving.
  await page.evaluate(() => {
    const game = window.game as any, s = game.session, spline = s.world.spline, index = spline.indexAt(90);
    const p = spline.point(index), t = spline.tangent(index);
    Object.defineProperty(game, 'timeScale', { value: 1 });
    s.car.reset([p[0], p[1] + 1.2, p[2]], Math.atan2(-t[0], -t[2]));
    s.racers[0].race.reacquire(p[0], p[2]); s.racers[0].bot.reset(); s.racers[0].chase.reset();
    game.phase = 'racing';
  });
  await expectWorldLoaded(page, 'trail-marks-frames');
  const frames = await captureFrames(page, 90, 6000);
  // One still frame rendered twice, marks on and off: the only triangle and draw-call numbers that
  // are not a maximum over a moving scene.
  const still = await page.evaluate(() => {
    const w = (window.game as any).session.world, root = w.tireMarks?.root;
    const render = () => { w.render(() => {}); return { triangles: w.renderer.info.render.triangles, drawCalls: w.renderer.info.render.calls }; };
    const withMarks = render(); if (root) root.visible = false; const withoutMarks = render(); if (root) root.visible = true;
    return { withMarks, withoutMarks };
  });
  // Same session, same spot, marks switched off: what the kept marks alone cost this frame.
  const hid = await page.evaluate(() => { const root = (window.game as any).session.world.tireMarks?.root; if (root) root.visible = false; return !!root; });
  const framesWithoutMarks = hid ? await captureFrames(page, 90, 6000) : null;
  await page.evaluate(() => { const root = (window.game as any).session.world.tireMarks?.root; if (root) root.visible = true; });
  const framesAgain = await captureFrames(page, 90, 6000);
  const facts = { label: LABEL, renderer: await rendererFacts(page), early, late, gameSecondsBetween: late.time - early.time, cost, still, frames, framesWithoutMarks, framesAgain, rescues };
  writeFileSync(resolve(OUT, `${LABEL}.json`), JSON.stringify({ ...facts,
    quality: await page.evaluate(() => window.game.report().renderQuality) }, null, 2));
  expect(late.time - early.time).toBeGreaterThan(60);
  checkMinimum(frames.fps, 'desktop_min_fps', `393 ${LABEL} snow race with every mark kept`);
  checkMaximum(frames.p95Ms, 'desktop_max_p95_ms', `393 ${LABEL} snow race p95`);
  if (LABEL === 'after') {
    const [a, b] = [early.marks as { snow: number }, late.marks as { snow: number }];
    expect(b.snow).toBeGreaterThan(a.snow);
  }
}

test('snow race with every AI keeps the opening ruts to the finish', async ({ page }) => {
  await race(page);
});

test('restarting the race wipes the previous race\'s ruts', async ({ page }) => {
  await page.goto('/?dev=1&track=synth-loop&bot=1&speed=8&time=day&weather=snow');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await page.waitForFunction(() => (window.game.report().tireMarks?.snow ?? 0) > 40, null, { timeout: 60_000 });
  await page.evaluate(() => { const game = window.game as any; game.phase = 'paused'; game.restart(); });
  expect(await page.evaluate(() => window.game.report().tireMarks?.snow)).toBe(0);
  await page.waitForFunction(() => (window.game.report().tireMarks?.snow ?? 0) > 0, null, { timeout: 60_000 });
});
