import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.skip(process.env.PALM_CAPTURE !== '1', 'opt-in palm visual review');
test.describe.configure({ timeout: 360_000 });

test('Fisherman’s Wharf palms have feathered crowns and repeatable varied bends', async ({ page }) => {
  const directory = evidencePath('palms');
  mkdirSync(directory, { recursive: true });
  await page.goto('/?track=fishermans-wharf&bot=1&dev=1&time=day&perf=1&perfSlimes=none');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, '254 Fisherman’s Wharf');

  const facts = await page.evaluate(async () => {
    const game = window.game as any, world = game.session.world;
    game.phase = 'paused'; game.autopilot = false; game.session.mesh.visible = false;
    world.setQuality('high');
    let best: any = null;
    const observed = new Set<string>();
    for (let step = 0; step <= 24; step++) {
      const at = world.spline.length * step / 24;
      const point = world.spline.point(world.spline.indexAt(at));
      for (let pass = 0; pass < 5; pass++) {
        world.streamer.update(at, point[0], point[2]);
        while (world.streamer.stats.loading > 0) await new Promise(resolve => setTimeout(resolve, 25));
      }
      world.streamer.root.updateMatrixWorld(true);
      const palms: any[] = [];
      world.streamer.root.traverse((object: any) => {
        if (!object.isInstancedMesh || object.material?.name !== 'foliage_palm') return;
        const variant = /trees_palm_v(\d+)_/.exec(object.name)?.[1] ?? 'missing';
        observed.add(variant);
        object.geometry.computeBoundingBox();
        const triangles = (object.geometry.index?.count ?? 0) / 3;
        for (let index = 0; index < object.count; index++) {
          const matrix = object.matrixWorld.clone();
          object.getMatrixAt(index, matrix); matrix.premultiply(object.matrixWorld);
          const position = world.camera.position.clone();
          const rotation = world.camera.quaternion.clone();
          const scale = world.camera.position.clone();
          matrix.decompose(position, rotation, scale);
          const box = object.geometry.boundingBox.clone().applyMatrix4(matrix);
          const centre = box.getCenter(world.camera.position.clone());
          const size = box.getSize(world.camera.position.clone());
          palms.push({ position: position.toArray(), centre: centre.toArray(), size: size.toArray(),
            scale: scale.toArray(), variant, triangles, side: object.material.side });
        }
      });
      if (!best || palms.length > best.palms.length) best = { at, point, palms };
    }
    if (!best?.palms.length) throw new Error('No palm instance reached the browser');

    const neighbourhood = (centre: any) => best.palms.filter((p: any) =>
      Math.hypot(p.position[0] - centre.position[0], p.position[2] - centre.position[2]) < 55);
    let cluster = best.palms.slice(0, 1);
    for (const palm of best.palms) {
      const candidate = neighbourhood(palm);
      if (candidate.length > cluster.length) cluster = candidate;
    }
    const chosen = cluster[Math.floor(cluster.length / 2)]!;
    const target = chosen.centre;
    const road = best.point;
    const low: [number, number, number] = [Infinity, Infinity, Infinity];
    const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const palm of cluster) for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis]!, palm.centre[axis] - palm.size[axis] / 2);
      high[axis] = Math.max(high[axis]!, palm.centre[axis] + palm.size[axis] / 2);
    }
    const groupTarget = low.map((value, axis) => (value + high[axis]!) / 2) as [number, number, number];
    const groupSize = low.map((value, axis) => high[axis]! - value) as [number, number, number];
    const dx = road[0] - groupTarget[0], dz = road[2] - groupTarget[2];
    const length = Math.max(Math.hypot(dx, dz), 1);
    const distance = Math.max(groupSize[0], groupSize[2], 24) * 1.35;

    for (let pass = 0; pass < 5; pass++) {
      world.streamer.update(best.at, road[0], road[2]);
      while (world.streamer.stats.loading > 0) await new Promise(resolve => setTimeout(resolve, 25));
    }
    world.camera.position.set(groupTarget[0] + dx / length * distance, low[1] + 2.4,
      groupTarget[2] + dz / length * distance);
    world.camera.lookAt(groupTarget[0], groupTarget[1], groupTarget[2]);
    world.camera.fov = 58; world.camera.updateProjectionMatrix();
    document.querySelectorAll<HTMLElement>('#ui,.touch-controls,.tuning-panel,#perf-readout')
      .forEach(node => { node.style.display = 'none'; });
    world.render();
    const closeDistance = Math.max(...chosen.size) * 1.25;
    return { at: best.at, road, target, groupTarget, groupSize, cluster, observed: [...observed],
      camera: world.camera.position.toArray(), closeCamera: [
        target[0] + dx / length * closeDistance, target[1] + chosen.size[1] * .08,
        target[2] + dz / length * closeDistance,
      ] };
  });

  expect(facts.observed.sort()).toEqual(['0', '1', '2', '3', '4']);
  expect(facts.cluster.length).toBeGreaterThanOrEqual(3);
  expect(new Set(facts.cluster.map((p: any) => p.variant)).size).toBeGreaterThanOrEqual(2);
  expect(Math.min(...facts.cluster.map((p: any) => p.triangles))).toBeGreaterThanOrEqual(600);
  expect(facts.cluster.every((p: any) => p.side === 2)).toBe(true);
  await page.screenshot({ path: resolve(directory, 'driving-distance.png') });

  await page.evaluate(({ camera, target }) => {
    const world = (window.game as any).session.world;
    world.camera.position.set(camera[0], camera[1], camera[2]);
    world.camera.lookAt(target[0], target[1], target[2]);
    world.camera.fov = 48; world.camera.updateProjectionMatrix(); world.render();
  }, { camera: facts.closeCamera, target: facts.target });
  await page.screenshot({ path: resolve(directory, 'close-up.png') });
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(facts, null, 2));
});
