import { evidencePath } from './evidence';
import { expect, test, type Page } from '@playwright/test';
import { VEHICLES } from '../src/vehicles/catalogue';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureFrames, reportDesktopFrames, rendererFacts, SOFTWARE_RENDERER } from './frame-sample';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 240_000 });
test.skip(process.env.PERF_REAL_GPU !== '1', 'requires the real machine GPU, like the existing performance gate');
const out = process.env.MULTIRACER_PERF_OUTPUT
  ? resolve(process.env.MULTIRACER_PERF_OUTPUT)
  : evidencePath('multiracer-performance');
// bayshore-101 (a 64.8 km highway) is gone and no replacement track is that long; beijing is the
// only real track that is a closed loop, so arc lengths past its length wrap instead of clamping
// at the end -- the one real track where the `spread` teleport below still spreads racers apart
// instead of bunching them all at the same clamped finish point.
const scenarios = [1, 2].flatMap(humans => [false, true].flatMap(ai => ['day', 'night'].map(time => ({ humans, ai, time, track: 'beijing' }))));
// twin-peaks (a winding hill road) -> zhangjiajie (winding mountain road, no straights).
scenarios.push(...['day', 'night'].map(time => ({ humans: 2, ai: true, time, track: 'zhangjiajie' })));

async function positions(page: Page, spread: boolean): Promise<void> {
  await page.evaluate(spread => {
    const g = window.game, s = g.session;
    for (const [i, racer] of s.racers.entries()) {
      const at = spread ? 500 + i * 8000 : 500 + i * 20;
      const index = s.world.spline.indexAt(at), p = s.world.spline.point(index), t = s.world.spline.tangent(index);
      racer.car.reset([p[0], p[1] + 1.2, p[2]], Math.atan2(-t[0], -t[2]));
      racer.trailer?.syncReset(); racer.race.reacquire(p[0], p[2]); racer.bot.reset(); racer.chase.reset();
    }
    const p = s.car.position;
    s.world.follow(s.race.progress.value.s, p.x, p.y, p.z, s.racers.flatMap(r => [r.car, ...(r.trailer ? [r.trailer.car] : [])]
      .map(car => ({ s: r.race.progress.value.s, x: car.position.x, z: car.position.z }))));
  }, spread);
  await page.waitForFunction(() => {
    const s = window.game.session, p = s.car.position;
    const bodies = s.racers.flatMap(r => [r.car, ...(r.trailer ? [r.trailer.car] : [])]);
    s.world.follow(s.race.progress.value.s, p.x, p.y, p.z, s.racers.flatMap(r => [r.car, ...(r.trailer ? [r.trailer.car] : [])]
      .map(car => ({ s: r.race.progress.value.s, x: car.position.x, z: car.position.z }))));
    return s.world.streamer.stats.loading === 0 && bodies.every(car => {
      const half = car.tuning.chassisHalf;
      return s.world.streamer.collisionReady(car.position.x, car.position.z, Math.hypot(half[0], half[2]) + 2);
    });
  }, null, { timeout: 60_000 });
  await expectWorldLoaded(page, spread ? 'spread car collection' : 'regrouped car collection');
}

for (const scenario of scenarios) test(`whole frame ${scenario.track} ${scenario.humans} humans AI ${scenario.ai} ${scenario.time}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await context.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ quality: 'high', language: 'en', muted: true })));
  const page = await context.newPage();
  try {
    await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
    expect(await page.evaluate(c => window.game.startRace({ trackId: c.track, playerVehicles: Array(c.humans).fill('pickup-travel-trailer'),
      ai: c.ai, aiDifficulty: 'rush', timeOfDay: c.time as 'day' | 'night', slimeDensity: 'many' }), scenario)).toBe(true);
    const facts = await rendererFacts(page); expect(facts.renderer).not.toMatch(SOFTWARE_RENDERER);
    const roster = await page.evaluate(() => window.game.session.racers.map(r => ({ id: r.vehicle.id, role: r.role, trailer: !!r.trailer })));
    expect(roster).toHaveLength(scenario.ai ? scenario.humans + VEHICLES.length - 1 : scenario.humans);
    expect(roster.filter(r => r.trailer)).toHaveLength(scenario.humans);
    await page.evaluate(() => { const g = window.game; for (let i = 0; i < g.session.humans.length; i++) g.setAutopilot(i, true); (g as any).beginCountdown(); });
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    const samples = [];
    for (const spread of scenario.track === 'beijing' && roster.length > 1 ? [false, true] : [false]) {
      await positions(page, spread);
      await page.waitForFunction(() => window.game.report().players.every(p => !p.waitingForRoad));
      await page.waitForTimeout(1000);
      const sample = await captureFrames(page, spread ? 8000 : 500);
      const state = await page.evaluate(() => ({ players: window.game.report().players, tiles: window.game.report().tiles,
        views: window.game.session.world.cameras.length, slimes: window.game.report().slimes, quality: window.game.report().renderQuality, memory: window.game.session.world.renderer.info.memory }));
      samples.push({ spread, sample, state });
      mkdirSync(out, { recursive: true });
      const label = `${scenario.track}-${scenario.humans}-${scenario.ai}-${scenario.time}`;
      writeFileSync(resolve(out, label + '.json'), JSON.stringify({ scenario, facts, roster, samples }, null, 2));
      await page.screenshot({ path: resolve(out, label + (spread ? '-spread' : '-near') + '.png') });
      expect(sample.frames).toBeGreaterThan(100); expect(sample.drawCalls).toBeGreaterThan(0);
      expect(state.views).toBe(scenario.humans); expect(state.quality).toBe('high');
      expect(state.slimes!.active).toBeGreaterThan(0);
      // derived: beijing's spline (game/public/tracks/beijing/track.json) is a closed 2225.4 m loop, so
      // `positions()`'s `500 + i*8000` arc lengths wrap via Spline.wrapS instead of clamping at the end.
      // Replaying that wrap+lookup against the real spline points gives a worst-case (2-racer) bounding-box
      // sum of ~733 m -- far short of the old bayshore-101 highway's 4000 m, since no remaining track is
      // anywhere near 64.8 km. 700 keeps a safety margin under that measured worst case.
      if (spread) expect(Math.max(...state.players.map(r => r.x)) - Math.min(...state.players.map(r => r.x))
        + Math.max(...state.players.map(r => r.z)) - Math.min(...state.players.map(r => r.z))).toBeGreaterThan(700);
      reportDesktopFrames(sample.fps, sample.p95Ms, label + (spread ? ' spread' : ' near'));
    }
  } finally { await context.close(); }
});

test('full roster releases resources across repeated separation, restart and exit', async ({ page }) => {
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  const cycles = [];
  for (let run = 0; run < 3; run++) {
    expect(await page.evaluate(() => window.game.startRace({ trackId: 'beijing', playerVehicles: ['pickup-travel-trailer', 'pickup-travel-trailer'],
      ai: true, slimeDensity: 'many', timeOfDay: 'night' }))).toBe(true);
    await page.evaluate(() => (window.game as any).beginCountdown());
    await page.waitForFunction(() => window.game.report().phase === 'racing'); await page.keyboard.press('Escape');
    const groups = [];
    for (let i = 0; i < 3; i++) {
      await positions(page, true); await positions(page, false);
      await page.waitForTimeout(500);
      groups.push(await page.evaluate(() => { const s = window.game.session; return {
        geometries: s.world.renderer.info.memory.geometries, textures: s.world.renderer.info.memory.textures,
        programs: s.world.renderer.info.programs?.length, tiles: s.world.streamer.stats.loaded,
        joints: s.physics.world.impulseJoints.len(), racers: s.racers.length,
      }; }));
    }
    mkdirSync(out, { recursive: true }); writeFileSync(resolve(out, `groups-${run}.json`), JSON.stringify(groups, null, 2));
    expect(groups[1]).toEqual(groups[2]);
    await page.evaluate(() => (window.game as any).restart());
    expect(await page.evaluate(() => window.game.session.racers.length)).toBe(VEHICLES.length + 1);
    const disposed = await page.evaluate(async () => {
      const s = window.game.session, renderer = s.world.renderer;
      const geometries = new Set<any>(), textures = new Set<any>();
      s.world.scene.traverse((object: any) => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!material) continue;
          for (const value of Object.values(material) as any[]) if (value?.isTexture) textures.add(value);
          for (const uniform of Object.values(material.uniforms ?? {}) as any[]) if (uniform.value?.isTexture) textures.add(uniform.value);
        }
      });
      const gl = renderer.getContext();
      const programs = (renderer.info.programs ?? []).map(program => program.program as WebGLProgram);
      const counts = { geometries: geometries.size, textures: textures.size, programs: programs.filter(program => gl.isProgram(program)).length };
      for (const geometry of geometries) geometry.addEventListener('dispose', () => geometries.delete(geometry));
      for (const texture of textures) texture.addEventListener('dispose', () => textures.delete(texture));
      (window.game as any).quit();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      return { memory: renderer.info.memory, programWrappers: renderer.info.programs?.length ?? 0, counts,
        livePrograms: programs.filter(program => gl.isProgram(program)).length, contextLost: gl.isContextLost(),
        remainingGeometries: geometries.size, remainingTextures: textures.size,
        canvasRemoved: !renderer.domElement.isConnected, sessionGone: window.game.session === null,
        viewNodes: document.querySelectorAll('.race-viewport').length };
    });
    writeFileSync(resolve(out, `disposed-${run}.json`), JSON.stringify(disposed, null, 2));
    expect(disposed.counts.geometries).toBeGreaterThan(20); expect(disposed.counts.textures).toBeGreaterThan(0);
    expect(disposed.remainingGeometries).toBe(0); expect(disposed.remainingTextures).toBe(0); expect(disposed.counts.programs).toBeGreaterThan(0); expect(disposed.livePrograms).toBe(0); expect(disposed.contextLost).toBe(true);
    expect(disposed.canvasRemoved).toBe(true); expect(disposed.sessionGone).toBe(true); expect(disposed.viewNodes).toBe(0);
    cycles.push({ groups, disposed });
  }
  expect(cycles[1]!.disposed).toEqual(cycles[2]!.disposed);
  mkdirSync(out, { recursive: true }); writeFileSync(resolve(out, 'resource-cycles.json'), JSON.stringify(cycles, null, 2));
});
