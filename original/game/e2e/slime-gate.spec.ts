import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectWorldLoaded } from './world';

test.skip(process.env.SLIME_GATE_QA !== '1', 'run with SLIME_GATE_QA=1');
test.describe.configure({ timeout: 240_000, mode: 'serial' });

const OUT = evidencePath('shots', '0.4-gate');

async function openInspection(page: Page, track: string,
  kind: 'colossus' | 'slimes' | 'boost' | 'flowers') {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true,
    obstacles: true, best: {},
  })));
  await page.goto(`/?track=${track}&bot=1&dev=1&time=day&inspect=${kind}`);
  const readout = page.locator('#inspection-ready');
  await expect(readout).toHaveAttribute('data-complete', 'true', { timeout: 120_000 });
  await expectWorldLoaded(page, `direct ${kind} view`);
  return readout;
}

test('direct colossus view shows a blue rounded shell, plain eyes and floating car parts', async ({ page }) => {
  await openInspection(page, 'synth-loop', 'colossus');
  const evidence = await page.evaluate(() => {
    const g = window.game as any;
    const layer = g.session.slimes;
    const live = layer.lives.find((item: any) => item.active && item.spawn.kind === 'colossus');
    return {
      scale: live.spawn.scale,
      colour: Array.from(layer.mesh.instanceColor.array.slice(
        live.index * 3, live.index * 3 + 3)) as number[],
      panels: layer.colossusDebris.count,
      wheels: layer.colossusWheels.count,
      seats: layer.colossusSeatBacks.count,
      eyes: layer.colossusEyes.count,
      collider: live.collider,
      failed: g.session.world.streamer.stats.failed,
    };
  });
  expect(evidence.scale[0]).toBeGreaterThanOrEqual(9.9);
  expect(evidence.scale[1]).toBeGreaterThan(9);
  expect(evidence.scale[2]).toBeLessThanOrEqual(21.6);
  expect(evidence).toMatchObject({ panels: 6, wheels: 4, seats: 2, collider: null, failed: 0 });
  expect(evidence.eyes).toBeGreaterThanOrEqual(2);
  expect(evidence.colour[2]!).toBeGreaterThan(evidence.colour[0]! * 2);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, 'colossus.png') });
});

test('direct ordinary slime view has a rounded surface-tension body and plain black eyes', async ({ page }) => {
  const readout = await openInspection(page, 'synth-loop', 'slimes');
  await expect(readout).toContainText(/surface-tension (popper|burst) slime/);
  const faces = await page.evaluate(() => {
    const layer = (window.game as any).session.slimes;
    const bodies = layer.lives.filter((item: any) => item.active
      && (item.spawn.kind === 'popper' || item.spawn.kind === 'burst')).length;
    return {
      bodies,
      eyes: layer.colossusEyes.count,
      highlights: layer.scene.getObjectByName('colossus-eye-highlights'),
      blush: layer.scene.getObjectByName('colossus-blush'),
    };
  });
  expect(faces.bodies).toBeGreaterThan(0);
  expect(faces.eyes).toBeGreaterThanOrEqual(faces.bodies * 2);
  expect(faces.highlights).toBeUndefined();
  expect(faces.blush).toBeUndefined();
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, 'fantasy-slime.png') });
});

test('boost slime accelerates on tyre contact with a yellow-white magic trail', async ({ page }) => {
  await openInspection(page, 'synth-loop', 'boost');
  const evidence = await page.evaluate(() => {
    const g = window.game as any;
    const layer = g.session.slimes;
    const boost = layer.lives.find((item: any) => item.active && item.spawn.kind === 'boost');
    const index = g.session.world.spline.indexAt(boost.spawn.s);
    const tangent = g.session.world.spline.tangent(index);
    const groundY = boost.spawn.position[1] - boost.spawn.scale[1];
    g.session.car.reset([boost.spawn.position[0], groundY + 0.45, boost.spawn.position[2]],
      Math.atan2(-tangent[0], -tangent[2]));
    g.session.car.body.setLinvel({ x: tangent[0] * 2, y: 0, z: tangent[2] * 2 }, true);
    let active = false;
    for (let i = 0; i < 18; i++) g.session.physics.step(g.session.physics.timestep, (dt: number) => {
      layer.prepareCar(g.session.car);
      g.session.car.update(dt, { throttle: 0, brake: 0, steer: 0 });
      layer.handleCar(g.session.car);
      layer.update(dt);
      active ||= layer.stats.boostActive;
    });
    const car = g.session.car.position;
    const right = { x: -tangent[2], z: tangent[0] };
    g.session.world.camera.position.set(car.x - tangent[0] * 6 + right.x * 4, car.y + 2.2,
      car.z - tangent[2] * 6 + right.z * 4);
    g.session.world.camera.lookAt(car.x, car.y + 0.15, car.z);
    g.session.world.camera.fov = 52;
    g.session.world.camera.updateProjectionMatrix();
    g.session.world.renderer.render(g.session.world.scene, g.session.world.camera);
    const sizes = layer.effects.particles.geometry.getAttribute('effectSize');
    const sparkleCount = Array.from({ length: sizes.count }, (_, i) => sizes.getX(i))
      .filter((size: number) => size < 0).length;
    return { active, sparkleCount, stats: layer.stats, speed: g.session.car.speed };
  });
  expect(evidence.active).toBe(true);
  expect(evidence.sparkleCount).toBeGreaterThanOrEqual(6);
  expect(evidence.stats.boostEntries).toBe(1);
  expect(evidence.stats.boostSpeedGain).toBeGreaterThan(0.5);
  expect(evidence.speed).toBeGreaterThan(2.5);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, 'boost-slime.png') });
});

test('direct Lombard road view contains dense four-colour flower beds', async ({ page }) => {
  await openInspection(page, 'lombard', 'flowers');
  const evidence = await page.evaluate(() => {
    const w = (window.game as any).session.world;
    const counts: Record<string, number> = {};
    w.scene.traverse((object: any) => {
      if (object.name.startsWith('flowers_')) counts[object.name] = (counts[object.name] ?? 0)
        + (object.count ?? 1);
    });
    return { counts, failed: w.streamer.stats.failed };
  });
  expect(Object.keys(evidence.counts).filter((name) => name.startsWith('flowers_flower_')))
    .toHaveLength(4);
  expect(Object.values(evidence.counts).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(500);
  expect(evidence.failed).toBe(0);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, 'lombard-flowers.png') });
});

test('a deliberate giant entry lifts, carries, spins the wheels and releases the car', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true,
    obstacles: true, best: {},
  })));
  await page.goto('/?track=synth-p2p&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null,
    { timeout: 90_000 });
  await expectWorldLoaded(page, 'deliberate colossus transit');
  const started = await page.evaluate(() => {
    const g = window.game as any;
    const layer = g.session.slimes;
    const giant = layer.lives.find((item: any) => item.active && item.spawn.kind === 'colossus');
    layer.avoidableColossi.length = 0;
    const index = g.session.world.spline.indexAt(giant.spawn.s);
    const tangent = g.session.world.spline.tangent(index);
    const groundY = g.session.world.spline.point(index)[1];
    g.session.car.reset([giant.spawn.position[0], groundY + 0.8, giant.spawn.position[2]],
      Math.atan2(-tangent[0], -tangent[2]));
    g.session.car.body.setLinvel({ x: tangent[0] * 10, y: 0, z: tangent[2] * 10 }, true);
    g.session.race.reacquire(giant.spawn.position[0], giant.spawn.position[2]);
    return g.session.model.wheels[0].rotation.x as number;
  });
  await page.waitForFunction(() => window.game.report().slimes?.colossusTransit === true, null,
    { timeout: 10_000 });
  expect(Number.isFinite(started)).toBe(true);
  const during = await (await page.waitForFunction(start => {
    const g = window.game as any;
    const spin = g.session.model.wheels[0].rotation.x as number;
    const delta = Math.abs(Math.atan2(Math.sin(spin - start), Math.cos(spin - start)));
    return g.report().slimes.colossusTransit && !g.session.car.grounded && delta > 1
      ? { delta, grounded: g.session.car.grounded } : null;
  }, started, { timeout: 10_000 })).jsonValue();
  await page.waitForFunction(() => {
    const stats = window.game.report().slimes;
    return !!stats && stats.colossusEntries > 0 && stats.colossusTransit === false
      && stats.colossusExits === stats.colossusEntries;
  }, null, { timeout: 20_000 });
  await page.waitForFunction(() => (window.game.report().slimes?.colossusDrop ?? 0) > 0.7,
    null, { timeout: 5_000 });
  const stats = (await page.evaluate(() => window.game.report().slimes))!;
  expect(during!.delta).toBeGreaterThan(1);
  expect(during!.grounded).toBe(false);
  expect(stats.colossusFloatHeight).toBeGreaterThan(2.4);
  expect(stats.colossusForwardSpeed).toBeGreaterThan(4.4);
  expect(stats.colossusMinUpright).toBeGreaterThan(0.88);
  expect(stats.colossusDrop).toBeGreaterThan(0.7);
});
