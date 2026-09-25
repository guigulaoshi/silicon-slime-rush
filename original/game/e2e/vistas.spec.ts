import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 600_000 });

const TRACKS = ['bayshore-101', 'fishermans-wharf', 'goldengate', 'lombard',
  'moffett-field', 'shoreline', 'twin-peaks', 'wolfe-pruneridge'];

test('every official route has a continuous local vista from two driving directions', async ({ page }) => {
  const directory = evidencePath('vistas');
  mkdirSync(directory, { recursive: true });
  const report: unknown[] = [];

  for (const track of TRACKS) {
    await page.goto(`/?track=${track}&bot=1&dev=1&time=day`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing');
    await expectWorldLoaded(page, `253 ${track}`);
    for (const [view, fraction] of [0.22, 0.68].entries()) {
      const data = await page.evaluate(async ({ part, atFraction }) => {
        const g = window.game as any, session = g.session, world = session.world;
        g.phase = 'paused'; g.autopilot = false; world.setQuality('high');
        const at = world.spline.length * atFraction;
        const index = world.spline.indexAt(at);
        const point = world.spline.point(index), tangent = world.spline.tangent(index);
        for (let pass = 0; pass < 10; pass++) {
          world.streamer.update(at, point[0], point[2]);
          while (world.streamer.stats.loading > 0) await new Promise(r => setTimeout(r, 25));
        }
        session.mesh.visible = false;
        world.camera.position.set(point[0] - tangent[0] * 10, point[1] + 5.5,
          point[2] - tangent[2] * 10);
        world.camera.lookAt(point[0] + tangent[0] * 120, point[1] + 3,
          point[2] + tangent[2] * 120);
        world.camera.fov = 68; world.camera.updateProjectionMatrix();
        document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(node => {
          node.style.display = 'none';
        });
        world.render();
        let meshes = 0, triangles = 0, vistaMeshes = 0, roadMeshes = 0;
        let visibleVistaVertices = 0, visibleContextVertices = 0;
        world.backdrop.root.traverse((object: any) => {
          if (!object.isMesh) return;
          meshes++;
          triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
          const isVista = object.name.includes('vista');
          const isContext = isVista || object.name.includes('terrain') || object.name.includes('water')
            || object.name.includes('buildings');
          if (isVista) vistaMeshes++;
          if (isContext) {
            const position = object.geometry.attributes.position;
            for (let vertex = 0; vertex < position.count; vertex += 3) {
              const projected = world.camera.position.clone().set(
                position.getX(vertex), position.getY(vertex), position.getZ(vertex));
              projected.applyMatrix4(object.matrixWorld).project(world.camera);
              if (Math.abs(projected.x) <= 1 && projected.y >= -.55 && projected.y <= .8
                  && projected.z >= -1 && projected.z <= 1) {
                visibleContextVertices++;
                if (isVista) visibleVistaVertices++;
              }
            }
          }
          if (object.name.includes('road')) roadMeshes++;
        });
        return { part, at, point, camera: world.camera.position.toArray(), meshes,
          triangles: Math.round(triangles), vistaMeshes, roadMeshes, visibleVistaVertices,
          visibleContextVertices,
          tiles: world.streamer.stats.loaded };
      }, { part: view, atFraction: fraction });
      report.push({ track, ...data });
      await page.screenshot({ path: resolve(directory, `${track}-${view + 1}.png`) });
      writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
      expect(data.tiles).toBeGreaterThan(0);
      expect(data.vistaMeshes, `${track}: low-rise vista nodes`).toBeGreaterThan(0);
      expect(data.roadMeshes, `${track}: real arterial road layer`).toBeGreaterThan(0);
      // Some protected directions (open water and airfield edges) should stay open. The
      // frame must still be filled by real local context: settlement, terrain, water, or skyline.
      expect(data.visibleContextVertices, `${track}: local context visible in driving frame`)
        .toBeGreaterThan(80);
    }
  }
});
