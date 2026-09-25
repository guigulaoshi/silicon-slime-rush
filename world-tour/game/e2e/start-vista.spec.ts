import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 180_000 });

// The old Golden Gate route began on a distant approach; sydney (its replacement, see
// game/src/app/showcase.ts) instead starts already south-bound across the Harbour Bridge, so the
// bridge fills the very first frame rather than growing into view. What this test actually checks
// -- the bridge is real geometry and it is on screen from frame one -- still holds either way.
test('the Harbour Bridge fills the view from the very first frame', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true,
    slimeDensity: 'none', best: {},
  })));
  await page.goto('/?track=sydney&bot=1&dev=1&time=day');
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
      // The original's procedural bridge wore `bridge_steel`; an authored bridge model names it `<id>_steel`... as `harbour-bridge_steel`.
      if (!materials.some((material: any) => /(^|-)bridge_steel$/.test(material?.name ?? ''))) return;
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

  await expectWorldLoaded(page, 'Sydney start vista');
  expect(facts.failed).toBe(0);
  // sydney's spline.length is 3273.95 m since the lap round the Opera House;
  // +-100 m tolerance, the same proportional margin the old goldengate bounds kept.
  expect(facts.length).toBeGreaterThan(3_170);
  expect(facts.length).toBeLessThan(3_370);
  expect(facts.bridgeMeshes, `bridge materials: ${facts.materialNames.join(', ')}`).toBeGreaterThan(0);
  expect(facts.bridgeMeshesInView, 'the bridge must be visible in the first chase-camera frame').toBeGreaterThan(0);

  const out = evidencePath('start-vista');
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: resolve(out, 'after.png') });
});
