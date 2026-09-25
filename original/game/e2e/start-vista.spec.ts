import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 180_000 });

test('464 Golden Gate starts on a scenic distant approach to the bridge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true,
    slimeDensity: 'none', best: {},
  })));
  await page.goto('/?track=goldengate&bot=1&dev=1&time=day');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });

  const facts = await page.evaluate(async () => {
    const game = window.game as any;
    const session = game.session;
    const world = session.world;
    game.phase = 'paused';
    game.autopilot = false;

    const point = [...session.track.start.pos];
    session.car.reset(point, session.track.start.yaw);
    session.mesh.position.copy(session.car.position);
    session.mesh.quaternion.copy(session.car.quaternion);
    for (let i = 0; i < 10; i++) {
      world.follow(0, ...point);
      while (world.streamer.stats.loading) await new Promise(resolve => setTimeout(resolve, 25));
    }
    await world.landmarks.prepare([{ x: point[0], z: point[2] }]);
    session.physics.step(1 / 60);
    session.chase.setMode('chase');
    session.chase.reset();
    session.chase.update(world.camera, session.car.position, session.car.quaternion,
      session.mesh.position.clone().set(0, 0, 0), 1 / 60,
      { grounded: true, reducedMotion: true });

    world.camera.updateMatrixWorld(true);
    world.scene.updateMatrixWorld(true);
    const materialNames = new Set<string>();
    let bridgeMeshes = 0;
    let bridgeMeshesInView = 0;
    world.scene.traverse((object: any) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material?.name) materialNames.add(material.name);
      if (!materials.some((material: any) => material?.name === 'bridge_steel')) return;
      bridgeMeshes++;
      object.geometry.computeBoundingSphere();
      const projected = object.geometry.boundingSphere.center.clone()
        .applyMatrix4(object.matrixWorld).project(world.camera);
      if (Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1
        && projected.z >= -1 && projected.z <= 1) bridgeMeshesInView++;
    });
    document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(node => { node.style.display = 'none'; });
    world.render();
    return {
      bridgeMeshes,
      bridgeMeshesInView,
      failed: world.streamer.stats.failed,
      length: world.spline.length,
      materialNames: [...materialNames].filter(name => name.includes('bridge')),
    };
  });

  await expectWorldLoaded(page, 'Golden Gate start vista');
  expect(facts.failed).toBe(0);
  expect(facts.length).toBeGreaterThan(5_300);
  expect(facts.length).toBeLessThan(5_500);
  expect(facts.bridgeMeshes, `bridge materials: ${facts.materialNames.join(', ')}`).toBeGreaterThan(0);
  expect(facts.bridgeMeshesInView, 'the bridge must be visible in the first chase-camera frame').toBeGreaterThan(0);

  const out = evidencePath('start-vista');
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: resolve(out, 'after.png') });
});
