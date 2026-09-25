import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { BUILT, CATALOGUE } from '../src/app/tracks';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

// A route may declare that no low-rise town stands on its horizon (`vista.density` 0 in its route file):
// a savanna, or a desert plateau whose town is all on one side. Those have no far district to find.
const ROUTES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'routes');
const noFarTown = (id: string): boolean =>
  (JSON.parse(readFileSync(resolve(ROUTES_DIR, `${id}.json`), 'utf8')).vista?.density ?? 1) === 0;

test.describe.configure({ timeout: 900_000 });

// wolfe-pruneridge's special under-canopy camera and its "Big Tech Rooftop" no-window top-band
// check were deleted here: both were about roofLoop, the rooftop ring
// loop under a specific Silicon Valley campus building, which has no track any more. Every route in
// CATALOGUE/BUILT -- including beijing, the new loop -- is still checked with the one standard
// roadside camera and the three general fascia/building assertions below.

const TRACKS = CATALOGUE.filter(track => BUILT.has(track.id)).map(track => track.id);

test('all official routes show finished rooflines by day and night', async ({ page }) => {
  const directory = evidencePath('building-roofs');
  mkdirSync(directory, { recursive: true });
  const report: unknown[] = [];

  for (const track of TRACKS) {
    for (const time of ['day', 'night']) {
      await page.goto(`/?track=${track}&bot=1&dev=1&time=${time}`);
      await page.waitForFunction(() => window.game?.report().phase === 'racing');
      await expectWorldLoaded(page, `290 ${track} ${time}`);
      const data = await page.evaluate(async ({ route }) => {
        const g = window.game as any, session = g.session, world = session.world;
        g.phase = 'paused'; g.autopilot = false; world.setQuality('high');
        const at = world.spline.length * .36;
        const index = world.spline.indexAt(at);
        const point = world.spline.point(index), tangent = world.spline.tangent(index);
        for (let pass = 0; pass < 10; pass++) {
          world.streamer.update(at, point[0], point[2]);
          while (world.streamer.stats.loading > 0) await new Promise(r => setTimeout(r, 25));
        }
        session.mesh.visible = false;
        world.camera.position.set(point[0] - tangent[0] * 24, point[1] + 16,
          point[2] - tangent[2] * 24);
        world.camera.lookAt(point[0] + tangent[0] * 95, point[1] + 8,
          point[2] + tangent[2] * 95);
        world.camera.fov = 68;
        world.camera.updateProjectionMatrix();
        document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(node => {
          node.style.display = 'none';
        });
        world.render();

        let buildingMeshes = 0, streamFasciaVertices = 0, backdropFasciaVertices = 0;
        const inspect = (root: any, backdrop: boolean) => root.traverse((object: any) => {
          if (!object.isMesh) return;
          const isBuilding = object.name.includes('buildings') || object.name.includes('vista')
            || object.name === 'roof_support';
          if (isBuilding) {
            buildingMeshes++;
            const uv = object.geometry.attributes.uv, normal = object.geometry.attributes.normal;
            for (let i = 0; uv && i < uv.count; i++) {
              if (Math.abs(uv.getX(i) - .02) < .0001 && Math.abs(uv.getY(i) - .02) < .0001
                  && normal && Math.abs(normal.getY(i)) < .1) {
                if (backdrop) backdropFasciaVertices++;
                else streamFasciaVertices++;
              }
            }
          }
        });
        inspect(world.streamer.root, false);
        inspect(world.backdrop.root, true);
        return { route, at, buildingMeshes, streamFasciaVertices, backdropFasciaVertices,
          tiles: world.streamer.stats.loaded, camera: world.camera.position.toArray() };
      }, { route: track });
      report.push({ track, time, ...data });
      writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
      await page.screenshot({ path: resolve(directory, `${track}-${time}.png`) });
      expect(data.tiles).toBeGreaterThan(0);
      expect(data.buildingMeshes, `${track}: building geometry reaches the browser`).toBeGreaterThan(0);
      expect(data.streamFasciaVertices, `${track}: streamed no-window fascia reaches the browser`)
        .toBeGreaterThan(0);
      if (!noFarTown(track)) expect(data.backdropFasciaVertices, `${track}: backdrop no-window fascia reaches the browser`)
        .toBeGreaterThan(0);
    }
  }
});
