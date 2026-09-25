import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';
import { MIN_SPLIT_RADIUS } from '../src/world/Slimes';

// User: the smallest purple splitter does not vanish or split again; each hit bounces it away
// and scores.
test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 1280, height: 720 } });
const OUT = evidencePath('smallest-splitter');

test('the smallest purple splitter bounces away on every hit, stays on the road and scores each time', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ language: 'en', quality: 'high', muted: true })));
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'shoreline', car: 'sedan', playerVehicles: ['micro-hatch'],
    slimeDensity: 'normal', timeOfDay: 'day', ai: false }, true))).toBe(true);
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, 'smallest-splitter');
  await page.evaluate((radius) => {
    const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
    g.autopilot = false;
    for (const key of [...layer.tileSpawns.keys()]) layer.removeTile(key);
    layer.fallingLimit = 0;
    const p = spline.point(spline.indexAt(s.race.progress.value.s + 40));
    layer.addTile('smallest', [{ kind: 'slick', position: [p[0], p[1] + radius, p[2]], scale: [radius, radius, radius], yaw: 0 }]);
  }, MIN_SPLIT_RADIUS);
  const rows: { score: number; hits: number; alive: boolean; slicks: number; splitChildren: number }[] = [];
  const read = () => page.evaluate(() => {
    const s = (window.game as any).session, layer = s.slimes;
    const target = layer.lives.find((l: any) => l.tile === 'smallest');
    return { score: s.race.score, hits: s.race.slimeHits, alive: !!target?.active, slicks: layer.stats.byKind.slick, splitChildren: layer.stats.splitChildren };
  });
  rows.push(await read());
  for (let attempt = 0; attempt < 3; attempt++) {
    // Let the last bounce settle, then line the car up behind the slime along the road.
    await page.waitForTimeout(attempt ? 1200 : 0);
    await page.evaluate(() => {
      const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
      const target = layer.lives.find((l: any) => l.tile === 'smallest');
      // Where the last bounce sent it does not matter here: put it back on the road ahead and drive at it.
      g.__slime381 ??= s.race.progress.value.s + 40;
      const index = spline.indexAt(g.__slime381), p = spline.point(index), t = spline.tangent(index);
      s.physics.setBodyPosition(target.motion.body, { x: p[0], y: p[1] + target.spawn.scale[1] + .05, z: p[2] });
      target.motion.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      target.motion.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      s.car.reset([p[0] - t[0] * 9, p[1] + .8, p[2] - t[2] * 9], Math.atan2(-t[0], -t[2]));
      s.car.body.setLinvel({ x: t[0] * 11, y: 0, z: t[2] * 11 }, true);
      s.race.reacquire(p[0] - t[0] * 9, p[2] - t[2] * 9);
      s.chase.reset();
    });
    const before = rows.at(-1)!.hits;
    await page.waitForFunction(before => (window.game as any).session.race.slimeHits > before, before, { timeout: 8000 });
    await page.screenshot({ path: resolve(OUT, `hit-${attempt + 1}.png`) });
    await page.waitForTimeout(700);
    rows.push(await read());
  }
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i]!.alive, JSON.stringify(rows)).toBe(true);
    expect(rows[i]!.score).toBeGreaterThan(rows[i - 1]!.score);
    expect(rows[i]!.hits).toBe(rows[i - 1]!.hits + 1);
  }
  expect(rows.at(-1)!.slicks).toBe(1);
  expect(rows.at(-1)!.splitChildren).toBe(0);
});
