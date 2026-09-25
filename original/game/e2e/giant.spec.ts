import { evidencePath } from './evidence';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

const shapes = JSON.parse(readFileSync('../pipeline/sr/schema/slime-shapes.json', 'utf8')) as
  Record<'popper' | 'boost' | 'colossus', { radius: [number, number] }>;

const OUT = evidencePath('slime');
test.describe.configure({ timeout: 120_000 });

for (const [label, inspect, kind] of [
  ['small', 'slimes', 'popper'], ['medium', 'boost', 'boost'], ['giant', 'colossus', 'colossus'],
] as const) test(`202 ${label} has a road size reference`, async ({ page }) => {
  await page.goto(`/?track=shoreline&bot=1&dev=1&time=day&inspect=${inspect}`);
  const inspectionStarted = Date.now();
  // Inspection begins after the ordinary race boot; its readiness deadline starts there.
  await page.waitForFunction(() => window.game?.report().phase === 'paused');
  await page.waitForFunction(kind => {
    const session = window.game?.session as any;
    return session?.slimes?.lives.some((live: any) => live.active && !live.spawn.scenery && live.spawn.kind === kind);
  }, kind);
  // A live body can precede the inspector's fully streamed frame. Wait for its own terminal state.
  await page.waitForFunction(() => ['true', 'error'].includes(
    (document.querySelector('#inspection-ready') as HTMLElement | null)?.dataset.complete ?? ''),
  null, { timeout: 30_000 });
  await expect(page.locator('#inspection-ready')).toHaveAttribute('data-complete', 'true');
  const readinessMs = Date.now() - inspectionStarted;
  await expectWorldLoaded(page, `202 ${label}`);
  const facts = await page.evaluate(kind => {
    const g = window.game as any, s = g.session, w = s.world;
    const live = s.slimes.lives.find((x: any) => x.active && !x.spawn.scenery && x.spawn.kind === kind);
    if (!live) throw new Error(`No authored ${kind}`);
    const p = live.spawn.position, scale = live.spawn.scale;
    const index = w.spline.indexAt(live.spawn.s), right = w.spline.right(index), tangent = w.spline.tangent(index);
    const ground = w.spline.point(index)[1];
    const span = Math.max(...scale);
    s.car.reset([p[0] - tangent[0] * (scale[2] + 5), ground + .8,
      p[2] - tangent[2] * (scale[2] + 5)], Math.atan2(-tangent[0], -tangent[2]));
    s.model.group.position.copy(s.car.position); s.model.group.quaternion.copy(s.car.quaternion);
    w.camera.position.set(p[0] + right[0] * span * 1.5 - tangent[0] * span * 2.4,
      ground + span * 1.7, p[2] + right[2] * span * 1.5 - tangent[2] * span * 2.4);
    w.camera.lookAt(p[0], ground + scale[1] * .6, p[2]);
    w.camera.fov = 52; w.camera.updateProjectionMatrix();
    document.querySelectorAll<HTMLElement>('#ui,.touch-controls,#perf-readout,#inspection-ready')
      .forEach(node => { node.style.display = 'none'; });
    w.render();
    return { kind, scale, position: p, roadWidth: w.spline.halfWidth[index] * 2,
      laneWidths: scale[0] * 2 / 3.6, failed: w.streamer.stats.failed };
  }, kind);
  expect(facts.scale[0] * 2).toBeGreaterThanOrEqual(shapes[kind].radius[0] * 2);
  if (kind === 'colossus') {
    expect(facts.scale[0] * 2).toBeGreaterThan(facts.roadWidth);
  }
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, `${label}.png`) });
  writeFileSync(resolve(OUT, `${label}.json`), JSON.stringify({ ...facts, readinessMs }, null, 2));
});

test('real giant immersion persists through the crossing and clears on exit', async ({ page }) => {
  await page.goto('/?track=synth-p2p&bot=1&dev=1&time=day');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'real transit');
  await page.evaluate(() => {
    const g = window.game as any, s = g.session;
    const giant = s.slimes.lives.find((x: any) => x.active && x.spawn.kind === 'colossus');
    if (!giant) throw new Error('No authored giant');
    const at = s.world.spline.indexAt(giant.spawn.s), p = s.world.spline.point(at), t = s.world.spline.tangent(at);
    s.car.reset([p[0], p[1] + .8, p[2]], Math.atan2(-t[0], -t[2]));
    s.car.body.setLinvel({ x: t[0] * 10, y: 0, z: t[2] * 10 }, true);
    s.race.reacquire(p[0], p[2]);
  });
  await page.waitForFunction(() => window.game.report().slimes?.colossusTransit === true);
  await page.waitForTimeout(750);
  expect(await page.locator('.slime-immersion').evaluate(n => Number((n as HTMLElement).style.opacity))).toBe(.55);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, 'inside.png') });
  await page.waitForFunction(() => {
    const s = window.game.report().slimes;
    return s && s.colossusEntries > 0 && s.colossusExits > 0 && !s.colossusTransit;
  });
  expect(await page.locator('.slime-immersion').evaluate(n => Number((n as HTMLElement).style.opacity))).toBe(0);
  const report = await page.evaluate(() => window.game.report());
  expect(report.slimes!.colossusFloatHeight).toBeLessThan(5.5);
  await page.screenshot({ path: resolve(OUT, 'outside.png') });
  writeFileSync(resolve(OUT, 'transit.json'), JSON.stringify(report, null, 2));
});
