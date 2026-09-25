import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

// Four actual collision drives plus an eight-second close view; this is an opt-in visual delivery.
test.skip(process.env.SLIME_LIFE_QA !== '1', 'run with SLIME_LIFE_QA=1');
test.describe.configure({ timeout: 240_000 });
test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } }, viewport: { width: 1280, height: 720 } });
const OUT = evidencePath('slime-life');

test('records living faces, solid black bounce, red boost and attached slime', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?track=synth-p2p&bot=1&dev=1&time=day&vehicle=micro-hatch');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'living slime delivery');
  const results: unknown[] = [];
  for (const kind of ['slick', 'burst', 'boost', 'popper'] as const) {
    await page.keyboard.up('ArrowUp');
    const initial = await page.evaluate(kind => {
      const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
      g.autopilot = false;
      layer.fallingLimit = 0; // Isolate contact residue from unrelated background rain.
      for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
      for (const falling of [...layer.falling]) layer.removeFalling(falling);
      layer.update(10); // Expire fragments from the startup bot before arranging this encounter.
      layer.effects.puddleBorn.fill(-1);
      layer.effects.resizePuddles(layer.effects.puddleLimit);
      layer.effects.particleBorn.fill(-100);
      const p = spline.point(spline.indexAt(30)), start = spline.point(spline.indexAt(12));
      const t = spline.tangent(spline.indexAt(12));
      s.car.reset([start[0], start[1] + .8, start[2]], Math.atan2(-t[0], -t[2]));
      s.car.body.setLinvel({ x: t[0] * 8, y: 0, z: t[2] * 8 }, true);
      const radius = kind === 'slick' ? 3.5 : kind === 'popper' ? 2 : 2.6;
      layer.addTile(`life-demo-${kind}`,  [{ kind, position: [p[0], p[1] + radius * .82, p[2]],
        scale: [radius, radius * .82, radius], yaw: 0 }]);
      s.chase.reset();
      g.show('racing');
      return layer.stats.feedback.hits[kind];
    }, kind);
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(({ kind, initial }) =>
      (window.game as any).session.slimes.stats.feedback.hits[kind] > initial,
    { kind, initial }, { timeout: 15_000, polling: 'raf' });
    await page.screenshot({ path: resolve(OUT, `${kind}-impact.png`) });
    await page.waitForTimeout(kind === 'burst' ? 120 : 700);
    const result = await page.evaluate(kind => {
      const s = (window.game as any).session, layer = s.slimes;
      const live = layer.lives.find((item: any) => item.spawn.kind === kind);
      const colour = layer.mesh.instanceColor;
      return { kind, stats: layer.stats, coating: s.model.bodyCoat.stats.opacity,
        solid: live?.collider ? !live.collider.isSensor() : null,
        colour: live ? [colour.getX(live.index), colour.getY(live.index), colour.getZ(live.index)] : null };
    }, kind);
    if (kind === 'slick') {
      expect(result.solid).toBe(true); expect(result.stats.bounceHits).toBeGreaterThan(0);
      expect(result.stats.puddles).toBe(0); expect(result.stats.physicalFragments).toBe(0);
    }
    if (kind === 'boost') expect(result.stats.boostEntries).toBeGreaterThan(0);
    if (kind === 'popper') expect(result.coating).toBeGreaterThan(0);
    results.push(result);
    await page.waitForTimeout(1500);
  }
  await page.keyboard.up('ArrowUp');
  // Keep the real update/render loop running, with a camera facing two non-synchronous individuals.
  await page.evaluate(() => {
    const g = window.game as any, s = g.session, layer = s.slimes;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const p = s.world.spline.point(s.world.spline.indexAt(30));
    s.car.reset([p[0], p[1] + .8, p[2]], 0);
    layer.addTile('faces', [0, 5].map(offset => ({ kind: 'popper', position: [p[0] + offset, p[1] + 2, p[2] - 10],
      scale: [2, 2, 2], yaw: 0 })));
    const m = layer.mesh.instanceMatrix.array;
    const heading = Math.atan2(m[8], m[10]);
    const secondHeading = Math.atan2(m[24], m[26]);
    const first = layer.lives[0].spawn.position;
    const second = layer.lives[1].spawn;
    second.position = [first[0] + Math.cos(heading) * 6, first[1], first[2] - Math.sin(heading) * 6];
    second.yaw += heading - secondHeading + .35;
    const x = (first[0] + second.position[0]) / 2, y = first[1];
    const z = (first[2] + second.position[2]) / 2;
    s.chase.update = (camera: any) => {
      camera.position.set(x + Math.sin(heading) * 12, y + 2, z + Math.cos(heading) * 12);
      camera.lookAt(x, y, z); camera.fov = 55; camera.updateProjectionMatrix();
    };
  });
  await page.waitForTimeout(1000);
  const before = await page.evaluate(() => Array.from((window.game as any).session.slimes.colossusPupils.instanceMatrix.array));
  await page.screenshot({ path: resolve(OUT, 'living-faces.png') });
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => Array.from((window.game as any).session.slimes.colossusPupils.instanceMatrix.array));
  expect(after).not.toEqual(before);
  writeFileSync(resolve(OUT, 'encounters.json'), JSON.stringify(results, null, 2));
});
