import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

test.skip(process.env.SLIME_DENSITY_QA !== '1', 'shipped density and size evidence');
test.describe.configure({ timeout: 240_000 });
const OUT = evidencePath('slime-density');

// Retargeted from goldengate (deleted, "the default/showcase track") to sydney, the new home
// showcase route. s=2600 sits well inside sydney's 3,115 m length, away from both ends.
// RETARGET-MEASURE: authoredRoad count at s=2600 on sydney (still > 50?) -- slime tile density is a
// build-pipeline output, not derivable from track.json alone.
test('the dense real window keeps every road slime and shows the full ordinary size spread', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 5, language: 'en', quality: 'low', muted: true, slimeDensity: 'many',
  })));
  await page.goto('/?track=sydney&bot=1&dev=1&time=day');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 120_000 });
  await page.evaluate(() => {
    const g = window.game as any, s = g.session, w = s.world;
    g.phase = 'paused'; g.autopilot = false;
    const at = 2600, i = w.spline.indexAt(at), p = w.spline.point(i), t = w.spline.tangent(i);
    s.car.reset([p[0], p[1] + .8, p[2]], Math.atan2(-t[0], -t[2]));
    s.race.reacquire(p[0], p[2]); s.chase.reset(); w.streamer.clear();
  });
  let previous = -1;
  for (let round = 0; round < 30; round++) {
    await page.evaluate(() => {
      const w = window.game.session.world, at = 2600, p = w.spline.point(w.spline.indexAt(at));
      w.follow(at, p[0], p[1], p[2]);
    });
    await page.waitForFunction(() => window.game.report().tiles?.loading === 0, null,
      { timeout: 120_000, polling: 100 });
    const loaded = await page.evaluate(() => window.game.report().tiles?.loaded ?? 0);
    if (loaded === previous) break;
    previous = loaded;
    await page.waitForTimeout(100);
  }
  await expectWorldLoaded(page, 'sydney dense window');
  const evidence = await page.evaluate(() => {
    const g = window.game as any, layer = g.session.slimes, w = g.session.world;
    const authored = [...layer.tileSpawns.values()].flat() as { scenery?: boolean }[];
    const road = layer.lives.filter((item: any) => item.active && !item.spawn.scenery);
    const scenery = layer.lives.filter((item: any) => item.active && item.spawn.scenery);
    const poppers = road.filter((item: any) => item.spawn.kind === 'popper')
      .map((item: any) => item.spawn.scale[0]);
    const p = g.session.car.position;
    w.camera.position.set(p.x + 22, p.y + 18, p.z + 22);
    w.camera.lookAt(p.x, p.y, p.z); w.camera.fov = 54; w.camera.updateProjectionMatrix(); w.render();
    return {
      authoredRoad: authored.filter(item => !item.scenery).length,
      authoredScenery: authored.filter(item => item.scenery).length,
      liveRoad: road.length, liveScenery: scenery.length, active: layer.stats.active,
      popperMin: Math.min(...poppers), popperMax: Math.max(...poppers),
      failed: w.streamer.stats.failed, loaded: w.streamer.stats.loaded,
    };
  });
  expect(evidence.authoredRoad).toBeGreaterThan(50);
  expect(evidence.liveRoad).toBe(evidence.authoredRoad);
  expect(evidence.active).toBeLessThanOrEqual(256);
  expect(evidence.liveRoad).toBeGreaterThan(evidence.liveScenery);
  expect(evidence.popperMin).toBeLessThan(1.15);
  expect(evidence.popperMax).toBeGreaterThan(2.4);
  expect(evidence.failed).toBe(0);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'sydney-window.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: resolve(OUT, 'sydney-many.png') });
});
