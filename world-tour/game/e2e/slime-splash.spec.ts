import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';
import { checkMaximum, checkMinimum } from '../test-support/resource-limit';

test.skip(process.env.SLIME_SPLASH_QA !== '1', 'run with SLIME_SPLASH_QA=1');
test.describe.configure({ timeout: 180_000 });
const REAL_GPU = process.env.PERF_REAL_GPU === '1';

const SHOT = evidencePath('shots', 'synth-loop',
  'slime-splash-puddles.png');

test('renders three coloured GPU splashes and survives a dense recycled burst', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true,
    obstacles: true, best: {},
  })));
  await page.goto('/?track=synth-loop&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'slime splash gallery');

  const result = await page.evaluate(() => {
    const game = window.game as unknown as { session: any; phase: string };
    const layer = game.session.slimes;
    const effects = layer.effects;
    const camera = game.session.world.camera;
    const car = game.session.car;
    const forward = car.forward.clone().setY(0).normalize();
    const normal = car.position.clone().set(0, 1, 0);
    const right = forward.clone().cross(normal).normalize();
    // The production collision supplies the authored ground point. This staged evidence puts the
    // same discs a little above the synthetic road so the three colours remain readable at a
    // shallow chase-camera angle instead of being hidden by the track's broad safety surface.
    const centre = car.position.clone().addScaledVector(forward, 10).setY(car.position.y - 0.4);
    for (const [kind, offset] of [['popper', -2.8], ['burst', 0], ['boost', 2.8]] as const) {
      const ground = centre.clone().addScaledVector(right, offset);
      ground.y = centre.y;
      const impact = ground.clone().addScaledVector(normal, 1.15);
      effects.emit(kind, impact, ground, normal);
    }
    // Fill and wrap both fixed pools. This is deliberately harsher than a real cluster collision.
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      const ground = centre.clone().addScaledVector(right, ((i % 9) - 4) * 0.35).setY(-1000);
      effects.emit(i % 3 === 0 ? 'popper' : i % 3 === 1 ? 'burst' : 'boost',
        ground.clone().addScaledVector(normal, 1.15), ground, normal);
    }
    const emitMs = performance.now() - start;
    for (const [kind, offset] of [['popper', -2.8], ['burst', 0], ['boost', 2.8]] as const) {
      const ground = centre.clone().addScaledVector(right, offset);
      effects.emit(kind, ground.clone().addScaledVector(normal, 1.15), ground, normal);
    }
    effects.update(0.13);
    game.phase = 'paused';
    document.querySelectorAll<HTMLElement>('#ui, .tuning-panel, .touch-controls')
      .forEach((node) => { node.style.display = 'none'; });
    game.session.world.renderer.render(game.session.world.scene, camera);
    const shader = effects.particles.material;
    return {
      emitMs,
      particles: window.game.report().slimes!.particles,
      puddles: window.game.report().slimes!.puddles,
      particleCap: effects.particles.count,
      puddleCap: effects.puddles.count,
      gpuMotion: shader.vertexShader.includes('effectVelocity * age'),
    };
  });
  expect(result).toMatchObject({ particles: 2000, puddles: 300, particleCap: 2000,
    puddleCap: 300, gpuMotion: true });
  checkMaximum(result.emitMs, 'slime_emit_ms', 'dense slime impacts');
  mkdirSync(resolve(SHOT, '..'), { recursive: true });
  await page.screenshot({ path: SHOT });

  const denseFps = await page.evaluate(async () => {
    const game = window.game as unknown as { session: any };
    const effects = game.session.slimes.effects;
    const particles = effects.particles;
    const origin = particles.geometry.getAttribute('effectOrigin');
    const velocity = particles.geometry.getAttribute('effectVelocity');
    const born = particles.geometry.getAttribute('effectBorn');
    const car = game.session.car;
    const forward = car.forward.clone().setY(0).normalize();
    const right = forward.clone().cross(car.position.clone().set(0, 1, 0)).normalize();
    for (let i = 0; i < particles.count; i++) {
      const p = car.position.clone().addScaledVector(forward, 7 + (i % 25) * 0.16)
        .addScaledVector(right, ((i % 41) - 20) * 0.16);
      p.y = car.position.y + ((i % 17) - 8) * 0.08;
      origin.setXYZ(i, p.x, p.y, p.z);
      velocity.setXYZ(i, 0, 0, 0);
      born.setX(i, effects.particleTime.value - 0.13);
    }
    origin.needsUpdate = true;
    velocity.needsUpdate = true;
    born.needsUpdate = true;
    const renderer = game.session.world.renderer;
    const scene = game.session.world.scene;
    const camera = game.session.world.camera;
    const start = performance.now();
    await new Promise<void>((resolveFrame) => {
      let frames = 0;
      const frame = () => {
        renderer.render(scene, camera);
        if (++frames >= 60) resolveFrame();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return 60_000 / (performance.now() - start);
  });
  console.log(`dense 2,000-particle browser render: ${denseFps.toFixed(1)} fps (${REAL_GPU ? 'Metal' : 'SwiftShader'})`);
  if (REAL_GPU) checkMinimum(denseFps, 'phone_min_fps', 'high-tier 2,000-particle pool on the real GPU');
  else expect(denseFps, 'the deterministic software renderer must stay above its measured floor')
    .toBeGreaterThanOrEqual(8);
});
