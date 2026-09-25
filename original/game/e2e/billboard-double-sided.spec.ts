import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const SHOT_DIR = evidencePath('billboard-double-sided');
// Two real route loads plus four rendered viewpoints buy the evidence this file records.
test.describe.configure({ timeout: 120_000 });

interface BoardEvidence {
  route: string;
  style: 'ground' | 'pole';
  time: 'day' | 'night';
  faceUvRanges: { front: [number, number, number, number]; back: [number, number, number, number] };
  lampZ: { min: number; max: number; frontVertices: number; backVertices: number };
  glow: { face: number; lamp: number };
  approaches: { forward: number; reverse: number };
  assemblyHorizontalGap: number;
}

async function inspectBothDirections(page: import('@playwright/test').Page, route: string,
  style: 'ground' | 'pole', time: 'day' | 'night'): Promise<BoardEvidence> {
  await page.goto(`/?track=${route}&bot=1&dev=1&time=${time}`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await page.waitForFunction(() => window.game.session.world.billboards.ready);
  mkdirSync(SHOT_DIR, { recursive: true });

  const evidence = await page.evaluate(async ({ expectedStyle }) => {
    const game = window.game as unknown as { phase: string; session: any };
    const world = game.session.world;
    game.phase = 'paused';
    let lamps: any = null;
    const length = game.session.track.spline.length as number;
    for (let step = 1; step <= 16 && !lamps; step++) {
      const at = length * step / 17;
      const road = world.spline.point(world.spline.indexAt(at));
      for (let batch = 0; batch < 4 && !lamps; batch++) {
        world.streamer.update(at, road[0], road[2]);
        for (let wait = 0; wait < 80 && world.streamer.stats.loading > 0; wait++) {
          await new Promise((done) => setTimeout(done, 25));
        }
        world.streamer.root.updateMatrixWorld(true);
        world.streamer.root.traverse((object: any) => {
          if (!lamps && object.isInstancedMesh && object.count > 0
            && object.name === `props_billboard_lamplens_${expectedStyle}`) lamps = object;
        });
      }
    }
    if (!lamps) throw new Error(`${expectedStyle} billboard not found`);

    const lampLocal = lamps.matrixWorld.clone();
    lamps.getMatrixAt(0, lampLocal);
    const lampMatrix = lamps.matrixWorld.clone().multiply(lampLocal);
    const lampCentre = world.camera.position.clone().setFromMatrixPosition(lampMatrix);
    let face: { object: any; index: number } | null = null;
    let faceDistance2 = Infinity;
    world.streamer.root.traverse((object: any) => {
      if (!object.isInstancedMesh || !object.material?.name?.startsWith('billboard_face_')) return;
      for (let index = 0; index < object.count; index++) {
        const local = object.matrixWorld.clone();
        object.getMatrixAt(index, local);
        const centre = world.camera.position.clone().setFromMatrixPosition(object.matrixWorld.clone().multiply(local));
        const distance2 = centre.distanceToSquared(lampCentre);
        if (distance2 < faceDistance2) { faceDistance2 = distance2; face = { object, index }; }
      }
    });
    if (!face) throw new Error(`${expectedStyle} billboard face not found beside its lamps`);

    const board = face as { object: any; index: number };
    const local = new world.camera.matrixWorld.constructor();
    board.object.getMatrixAt(board.index, local);
    const matrix = board.object.matrixWorld.clone().multiply(local);
    const centre = world.camera.position.clone();
    const rotation = world.camera.quaternion.clone();
    const scale = world.camera.position.clone();
    matrix.decompose(centre, rotation, scale);
    const localZ = world.camera.position.clone().set(0, 0, 1).applyQuaternion(rotation).normalize();

    const points = game.session.track.spline.points as [number, number, number][];
    let nearest = 0;
    let nearestD2 = Infinity;
    points.forEach((point, i) => {
      const d2 = (point[0] - centre.x) ** 2 + (point[2] - centre.z) ** 2;
      if (d2 < nearestD2) { nearest = i; nearestD2 = d2; }
    });
    const centreS = world.spline.s[nearest] as number;
    const roadView = (distance: number) => world.spline.point(world.spline.indexAt(
      Math.max(0, Math.min(length, centreS + distance))));
    const sideFrom = (road: [number, number, number]) => localZ.dot(
      world.camera.position.clone().set(road[0], road[1] + 2.1, road[2]).sub(centre));

    const position = board.object.geometry.getAttribute('position');
    const uv = board.object.geometry.getAttribute('uv');
    const zValues = Array.from({ length: position.count }, (_, i) => position.getZ(i));
    const minZ = Math.min(...zValues), maxZ = Math.max(...zValues);
    const uvRange = (back: boolean): [number, number, number, number] => {
      const indices = zValues.map((z, i) => ({ z, i })).filter(({ z }) => back ? z > minZ : z < maxZ)
        .map(({ i }) => i);
      const us = indices.map(i => uv.getX(i)), vs = indices.map(i => uv.getY(i));
      return [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    };
    const lampPosition = lamps.geometry.getAttribute('position');
    const lampZ = Array.from({ length: lampPosition.count }, (_, i) => lampPosition.getZ(i));
    const faceMaterial = board.object.material;
    const lampMaterial = lamps.material;
    const approaches = { forward: sideFrom(roadView(-35)), reverse: sideFrom(roadView(35)) };

    document.querySelectorAll<HTMLElement>('#ui, .tuning-panel, .touch-controls')
      .forEach((node) => { node.style.display = 'none'; });
    const setView = (distance: number) => {
      const road = roadView(distance);
      world.camera.position.set(road[0], road[1] + 2.1, road[2]);
      world.camera.fov = 52;
      world.camera.updateProjectionMatrix();
      world.camera.lookAt(centre);
      world.render();
    };
    Object.assign(window as unknown as Record<string, unknown>, { setBillboardEvidenceView: setView });
    setView(-35);
    return {
      faceUvRanges: { front: uvRange(false), back: uvRange(true) },
      lampZ: { min: Math.min(...lampZ), max: Math.max(...lampZ),
        frontVertices: lampZ.filter(z => z < 0).length, backVertices: lampZ.filter(z => z > 0).length },
      glow: { face: faceMaterial.emissive.r, lamp: lampMaterial.emissive.r }, approaches,
      assemblyHorizontalGap: Math.hypot(centre.x - lampCentre.x, centre.z - lampCentre.z),
    };
  }, { expectedStyle: style });

  await page.screenshot({ path: resolve(SHOT_DIR, `${style}-${time}-forward.png`) });
  await page.evaluate(() => (window as unknown as { setBillboardEvidenceView(distance: number): void })
    .setBillboardEvidenceView(35));
  await page.screenshot({ path: resolve(SHOT_DIR, `${style}-${time}-reverse.png`) });
  return { route, style, time, ...evidence };
}

for (const [style, route] of [['ground', 'fishermans-wharf'], ['pole', 'fishermans-wharf']] as const) {
  test(`${style} billboard shows the same lit advert in both travel directions`, async ({ page }) => {
    const day = await inspectBothDirections(page, route, style, 'day');
    const night = await inspectBothDirections(page, route, style, 'night');
    for (const evidence of [day, night]) {
      expect(evidence.faceUvRanges.front).toEqual([0, 1, 0, 1]);
      expect(evidence.faceUvRanges.back).toEqual([0, 1, 0, 1]);
      // Export normalises each instanced mesh by its culling extents, so these are local ratios,
      // not metres. The pipeline test owns the 1.5 m placement; runtime must retain both sides.
      expect(evidence.lampZ.min).toBeLessThan(-0.1);
      expect(evidence.lampZ.max).toBeGreaterThan(0.1);
      expect(evidence.lampZ.frontVertices).toBe(evidence.lampZ.backVertices);
      expect(evidence.assemblyHorizontalGap).toBeLessThan(0.05);
      expect(Math.sign(evidence.approaches.forward)).toBe(-Math.sign(evidence.approaches.reverse));
    }
    expect(night.glow.face).toBeGreaterThan(day.glow.face);
    expect(night.glow.lamp).toBeGreaterThan(day.glow.lamp);
    writeFileSync(resolve(SHOT_DIR, `${style}.json`), JSON.stringify({ day, night }, null, 2));
  });
}
