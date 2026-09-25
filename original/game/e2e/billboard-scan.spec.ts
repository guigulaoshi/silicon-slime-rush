import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * A phone held up to the screen must be able to scan every social billboard from where a
 * player actually looks at one -- on the road next to it, a few car lengths back. The pictures land
 * in the evidence folder and a decoder reads them afterwards (tools/billboard_scan_423.py).
 */
const OUT = evidencePath('billboards');
test.describe.configure({ timeout: 600_000 });

async function lookAtFace(page: import('@playwright/test').Page, material: string, lang: 'zh' | 'en', back: number) {
  return page.evaluate(async ({ wanted, language, back }) => {
    const game = window.game as unknown as { phase: string; session: any };
    const world = game.session.world;
    const length = game.session.track.spline.length as number;
    game.phase = 'paused';
    world.billboards.setLanguage(language);
    let hit: { object: any; index: number } | null = null;
    for (let step = 1; step <= 16 && !hit; step++) {
      const s = length * step / 17;
      const point = world.spline.point(world.spline.indexAt(s));
      for (let batch = 0; batch < 4 && !hit; batch++) {
        world.streamer.update(s, point[0], point[2]);
        for (let wait = 0; wait < 60 && world.streamer.stats.loading > 0; wait++) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 50));
        }
        world.streamer.root.updateMatrixWorld(true);
        world.streamer.root.traverse((object: any) => {
          if (hit || object.material?.name !== wanted || !object.isInstancedMesh) return;
          if (object.count > 0) hit = { object, index: 0 };
        });
      }
    }
    if (!hit) throw new Error(`could not stream a face using ${wanted}`);
    const object = (hit as { object: any }).object;
    const instance = object.matrixWorld.clone();
    object.getMatrixAt((hit as { index: number }).index, instance);
    const matrix = object.matrixWorld.clone().multiply(instance);
    const face = world.camera.position.clone(), rotation = world.camera.quaternion.clone(), scale = world.camera.position.clone();
    matrix.decompose(face, rotation, scale);
    const points = game.session.track.spline.points as [number, number, number][];
    let nearest = 0, nearestD2 = Infinity;
    points.forEach((p, i) => { const d2 = (p[0] - face.x) ** 2 + (p[2] - face.z) ** 2; if (d2 < nearestD2) { nearest = i; nearestD2 = d2; } });
    const closed = game.session.track.spline.closed as boolean;
    const approach = closed ? (nearest - back + points.length) % points.length : Math.max(0, nearest - back);
    const p = points[approach]!;
    world.camera.position.set(p[0], p[1] + 1.4, p[2]);
    world.camera.fov = 52; world.camera.updateProjectionMatrix(); world.camera.lookAt(face);
    document.querySelectorAll<HTMLElement>('#ui, .tuning-panel, .touch-controls').forEach((node) => { node.style.display = 'none'; });
    world.render();
    const distance = Math.hypot(p[0] - face.x, p[2] - face.z);
    return { material: wanted, distance: Math.round(distance) };
  }, { wanted: material, language: lang, back });
}

test('every social face photographed from the road beside it, day and night', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const distances: Record<string, number> = {};
  for (const time of ['day', 'night']) {
    await page.goto(`/?track=shoreline&bot=1&dev=1&time=${time}`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
    for (const lang of ['zh', 'en'] as const) {
      for (const slot of 'acegikm') {
        for (const back of [3, 8]) {
          const info = await lookAtFace(page, `billboard_face_${slot}`, lang, back);
          expect(info.material).toBe(`billboard_face_${slot}`);
          distances[`${time}-${lang}-${slot}-${back}`] = info.distance;
          await page.screenshot({ path: resolve(OUT, `${time}-${lang}-${slot}-back${back}.png`) });
        }
      }
    }
  }
  console.log('DISTANCES ' + JSON.stringify(distances));
});
