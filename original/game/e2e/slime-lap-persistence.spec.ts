import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { BASE_URL } from './server';

test.describe.configure({ timeout: 180_000 });

test('a real collision stays consumed across later laps and returns only after restart', async ({ browser }) => {
  const output = evidencePath('slime-lap-persistence');
  mkdirSync(output, { recursive: true });
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 720 },
    recordVideo: { dir: output, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const video = page.video()!;
  try {
    await page.goto('/?track=synth-loop&bot=1&dev=1&time=day&vehicle=micro-hatch');
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    const target = await page.evaluate(() => {
      const game = window.game as any, session = game.session;
      game.autopilot = false; game.timeScale = 1; session.slimes.fallingLimit = 0;
      const live = session.slimes.lives.find((item: any) => item.active && !item.spawn.scenery
        && item.spawn.kind === 'popper');
      if (!live) throw new Error('No authored popper available for the collision');
      const at = session.world.spline.indexAt(live.spawn.s);
      const tangent = session.world.spline.tangent(at);
      const point = live.spawn.position;
      const ground = session.world.spline.point(at)[1];
      session.car.reset([point[0] - tangent[0] * 14, ground + .8, point[2] - tangent[2] * 14],
        Math.atan2(-tangent[0], -tangent[2]));
      session.race.reacquire(session.car.position.x, session.car.position.z);
      session.chase.reset();
      game.say('Lap 1 · target slime alive');
      return { key: live.key, tile: live.tile, kind: live.spawn.kind, s: live.spawn.s,
        position: [...live.spawn.position],
        startScore: session.race.score, startHits: session.race.slimeHits };
    });

    await page.keyboard.down('KeyW');
    await page.waitForFunction(key => (window.game as any).session.slimes.consumed.has(key), target.key,
      { timeout: 20_000 });
    await page.keyboard.up('KeyW');
    const afterHit = await page.evaluate(key => {
      const game = window.game as any, session = game.session;
      game.say('Destroyed · continuing for two more laps');
      return { score: session.race.score, hits: session.race.slimeHits,
        active: session.slimes.liveByKey.has(key), consumed: session.slimes.consumed.has(key) };
    }, target.key);
    expect(afterHit).toMatchObject({ hits: target.startHits + 1, active: false, consumed: true });
    expect(afterHit.score).toBeGreaterThan(target.startScore);
    await page.screenshot({ path: resolve(output, 'lap-1-destroyed.png') });

    await page.evaluate(() => { const game = window.game as any; game.autopilot = true; game.timeScale = 20; });
    await expect.poll(() => page.evaluate(() => window.game.report().lap), { timeout: 120_000 })
      .toBeGreaterThanOrEqual(2);
    const lapTwo = await page.evaluate(key => {
      const game = window.game as any, session = game.session;
      game.say('Lap 2 · destroyed slime still gone');
      return { lap: session.race.lap, score: session.race.score, hits: session.race.slimeHits,
        active: session.slimes.liveByKey.has(key), consumed: session.slimes.consumed.has(key) };
    }, target.key);
    expect(lapTwo).toMatchObject({ active: false, consumed: true });
    await page.screenshot({ path: resolve(output, 'lap-2-still-gone.png') });

    await expect.poll(() => page.evaluate(() => window.game.report().phase), { timeout: 120_000 })
      .toBe('results');
    const finished = await page.evaluate(key => {
      const game = window.game as any, session = game.session;
      return { lap: session.race.lap, score: session.race.score, hits: session.race.slimeHits,
        active: session.slimes.liveByKey.has(key), consumed: session.slimes.consumed.has(key) };
    }, target.key);
    expect(finished).toMatchObject({ lap: 3, active: false, consumed: true });
    await page.screenshot({ path: resolve(output, 'three-lap-results.png') });

    await page.evaluate(() => { const game = window.game as any; game.timeScale = 1; game.autopilot = false; game.restart(); });
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    await page.waitForFunction(({ key, tile, s, position }) => {
      const session = (window.game as any).session;
      if (!session.world.streamer.loaded.has(tile)) {
        session.world.streamer.update(s, position[0], position[2]);
      }
      return session.slimes.liveByKey.has(key);
    }, { key: target.key, tile: target.tile, s: target.s, position: target.position }, { timeout: 30_000 });
    const restarted = await page.evaluate(key => {
      const session = (window.game as any).session;
      return { score: session.race.score, hits: session.race.slimeHits,
        active: session.slimes.liveByKey.has(key), consumed: session.slimes.consumed.has(key) };
    }, target.key);
    expect(restarted).toEqual({ score: 0, hits: 0, active: true, consumed: false });
    await page.screenshot({ path: resolve(output, 'new-race-restored.png') });
    writeFileSync(resolve(output, 'facts.json'), JSON.stringify({ target, afterHit, lapTwo, finished, restarted }, null, 2));
  } finally {
    await context.close();
    await video.saveAs(resolve(output, 'two-plus-laps.webm'));
    await video.delete();
  }
});
