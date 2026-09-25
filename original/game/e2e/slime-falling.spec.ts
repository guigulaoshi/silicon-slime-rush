import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

test.skip(process.env.SLIME_FALLING_QA !== '1', 'run with SLIME_FALLING_QA=1');
test.describe.configure({ timeout: 180_000 });

const SHOT = evidencePath('slime-falling',
  'airdrop-first-bounce.png');

test('an airdropped slime bounces repeatedly and settles intact', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true,
    obstacles: true, best: {},
  })));
  await page.goto('/?track=synth-loop&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'falling-slime bounce');

  const first = await page.evaluate(() => {
    const game = window.game as unknown as { session: any; phase: string };
    const layer = game.session.slimes;
    const car = game.session.car;
    const physics = game.session.physics;
    [...layer.falling].forEach((candidate: any) => layer.removeFalling(candidate));
    // Start at the production scheduler's due edge so this isolated three-second window sees the
    // cue instead of inheriting whichever point in the 14-second cycle page loading reached.
    layer.fallingClock = 0;
    // Three seconds of production time must show one source cue, not fill the high-tier pool.
    let scheduledHigh = layer.falling.length;
    for (let i = 0; i < 180; i++) {
      layer.update(1 / 60);
      scheduledHigh = Math.max(scheduledHigh, layer.falling.length);
    }
    const forward = car.forward.clone().setY(0).normalize();
    const up = car.position.clone().set(0, 1, 0);
    const right = forward.clone().cross(up).normalize();
    const drop = layer.falling.at(-1);
    if (!drop) throw new Error('The production scheduler did not create a falling slime');
    const productionStart = physics.bodyPosition(drop.motion.body);
    const productionOffset = Math.hypot(productionStart.x - drop.landing.x,
      productionStart.z - drop.landing.z);
    layer.falling.filter((candidate: any) => candidate !== drop)
      .forEach((candidate: any) => layer.removeFalling(candidate));
    layer.fallingClock = 999;
    const landing = car.position.clone().addScaledVector(forward, 18).addScaledVector(right, 5);
    const surface = physics.surfaceAt(landing.x, landing.z);
    if (!surface) throw new Error('The staged bounce must hit loaded road geometry');
    landing.y = surface.point.y;
    drop.landing.copy(landing);
    drop.normal.set(surface.normal.x, surface.normal.y, surface.normal.z);
    drop.elapsed = 0;
    drop.contacted = drop.touching = false;
    drop.bounces = 0;
    drop.settledFrames = 0;
    physics.setBodyPosition(drop.motion.body, landing.clone().addScaledVector(up, drop.scale[1] + 6));
    drop.motion.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
    for (const driver of layer.drivers.keys()) {
      driver.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      driver.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    const bouncesBefore = window.game.report().slimes!.fallingBounces;
    const survivorsBefore = window.game.report().slimes!.fallingSurvivors;
    game.phase = 'paused';
    for (let i = 0; i < 240; i++) {
      physics.step(1 / 60);
      layer.updateFalling(1 / 60);
      layer.effects.update(1 / 60);
      if (window.game.report().slimes!.fallingBounces > bouncesBefore
        && drop.motion.body.linvel().y > 2) break;
    }
    // The first contact already exercised production safety and feedback. Freeze this paused QA
    // scene after that point so nearby roster cars cannot cancel the isolated settling proof.
    layer.drivers.clear();
    document.querySelectorAll<HTMLElement>('#ui, .tuning-panel, .touch-controls')
      .forEach((node) => { node.style.display = 'none'; });
    game.session.world.renderer.render(game.session.world.scene, game.session.world.camera);
    return {
      scheduledHigh,
      productionOffset,
      active: layer.falling.length,
      addedBounces: window.game.report().slimes!.fallingBounces - bouncesBefore,
      upwardSpeed: drop.motion.body.linvel().y,
      height: drop.motion.body.translation().y - landing.y,
      target: { x: landing.x, z: landing.z },
      survivorsBefore,
    };
  });
  expect(first).toMatchObject({ scheduledHigh: 1, active: 1, addedBounces: 1 });
  expect(first.productionOffset).toBeLessThan(.01);
  expect(first.upwardSpeed).toBeGreaterThan(2);
  expect(first.height).toBeGreaterThan(0);
  mkdirSync(resolve(SHOT, '..'), { recursive: true });
  await page.screenshot({ path: SHOT });

  const settled = await page.evaluate(({ target, survivorsBefore }) => {
    const game = window.game as unknown as { session: any };
    const layer = game.session.slimes;
    const physics = game.session.physics;
    for (let i = 0; i < 600 && layer.falling.length; i++) {
      physics.step(1 / 60);
      layer.updateFalling(1 / 60);
      layer.effects.update(1 / 60);
    }
    const landed = layer.lives.find((live: any) => live.tile === '__falling__');
    const remaining = layer.falling[0];
    const stats = window.game.report().slimes!;
    return {
      bounces: stats.fallingBounces,
      survivors: stats.fallingSurvivors - survivorsBefore,
      falling: stats.falling,
      fragments: stats.physicalFragments,
      puddles: stats.puddles,
      distance: landed ? Math.hypot(landed.spawn.position[0] - target.x,
        landed.spawn.position[2] - target.z) : null,
      remaining: remaining ? {
        elapsed: remaining.elapsed,
        bounces: remaining.bounces,
        contacted: remaining.contacted,
        touching: remaining.touching,
        settledFrames: remaining.settledFrames,
        position: physics.bodyPosition(remaining.motion.body),
        velocity: remaining.motion.body.linvel(),
        angular: remaining.motion.body.angvel(),
      } : null,
    };
  }, { target: first.target, survivorsBefore: first.survivorsBefore });
  expect(settled, JSON.stringify(settled)).toMatchObject({
    survivors: 1, falling: 0, fragments: 0, puddles: 0,
  });
  expect(settled.bounces).toBeGreaterThanOrEqual(3);
  expect(settled.distance).not.toBeNull();
  expect(settled.distance!).toBeLessThan(1);
});
