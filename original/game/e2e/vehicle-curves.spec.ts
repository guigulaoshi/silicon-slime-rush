import { baselinePath, evidencePath } from './evidence';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { VehicleDefinition } from '../src/vehicles/catalogue';
const { vehicles: VEHICLES } = JSON.parse(readFileSync(resolve('src/vehicles/catalogue.json'), 'utf8')) as { vehicles: VehicleDefinition[] };

// Live-world inspections and fixed-pose renderer samples for the model comparison.
test.describe.configure({ timeout: 240_000 });
const capture = process.env.VEHICLE_CURVES_CAPTURE;
test.skip(!capture, 'opt-in fixed-pose model comparison');
test('captures all cars at identical model poses and camera angles', async ({ page }) => {
  const out = evidencePath('curves'); mkdirSync(out, { recursive: true });
  const before = capture === 'before' ? {}
    : JSON.parse(readFileSync(baselinePath('curves', 'before.json'), 'utf8'));
  const facts: Record<string, unknown> = {};
  for (const vehicle of VEHICLES) {
    await page.goto(`/?track=shoreline&bot=1&dev=1&time=day&vehicle=${vehicle.id}&inspect=vehicle&perf=1&perfSlimes=none`);
    await expect(page.locator('#inspection-ready')).toHaveAttribute('data-complete', 'true', { timeout: 40000 });
    const pose = await page.evaluate(previous => {
      const s = (window.game as any).session;
      const meshes = [s.mesh, ...(s.trailerModel ? [s.trailerModel.group] : [])];
      if (previous) meshes.forEach((mesh: any, i: number) => {
        mesh.position.fromArray(previous[i].position); mesh.quaternion.fromArray(previous[i].quaternion);
      });
      document.querySelector('#inspection-ready')?.remove();
      return meshes.map((mesh: any) => ({ position: mesh.position.toArray(), quaternion: mesh.quaternion.toArray() }));
    }, before[vehicle.id]?.pose);
    for (const view of ['front', 'rear']) {
      await page.evaluate(({ size, view }) => {
        const s = (window.game as any).session; const camera = s.world.camera;
        s.mesh.updateMatrixWorld(true);
        const bounds = s.model.windshield.clone().setFromObject(s.mesh);
        if (s.trailerModel) bounds.union(bounds.clone().setFromObject(s.trailerModel.group));
        const centre = bounds.getCenter(camera.position.clone());
        const extent = bounds.getSize(camera.position.clone());
        const offset = camera.position.clone().set(0.65, 0.4, view === 'front' ? -1 : 1)
          .normalize().applyQuaternion(s.mesh.quaternion).multiplyScalar(extent.length() * 1.25);
        camera.position.copy(centre).add(offset);
        camera.lookAt(centre);
        camera.fov = 45; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        s.world.render();
      }, { size: vehicle.size, view });
      await page.waitForTimeout(150);
      await page.screenshot({ path: resolve(out, `${capture}-${vehicle.id}-${view}.png`) });
    }
    const timing = await page.evaluate(async () => {
      const world = (window.game as any).session.world;
      const renderMs: number[] = []; const frameMs: number[] = []; let last = performance.now();
      const original = world.render.bind(world);
      world.render = () => { const start = performance.now(); original(); renderMs.push(performance.now() - start); };
      for (let i = 0; i < 180; i++) await new Promise<void>(resolve => requestAnimationFrame(now => {
        if (i > 20) frameMs.push(now - last); last = now; resolve();
      }));
      world.render = original;
      const summary = (values: number[]) => { values.sort((a, b) => a - b); return { count: values.length,
        p50: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)] }; };
      const gl = world.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { frame: summary(frameMs), render: summary(renderMs.slice(20)),
        calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles,
        gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    });
    expect(timing.frame.count).toBe(159);
    facts[vehicle.id] = { pose, ...timing };
  }
  writeFileSync(resolve(out, `${capture}.json`), JSON.stringify(facts, null, 2));
});
