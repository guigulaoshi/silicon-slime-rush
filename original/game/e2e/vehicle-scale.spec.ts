import { evidencePath } from './evidence';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const { vehicles, detailScale } = JSON.parse(readFileSync(resolve('src/vehicles/catalogue.json'), 'utf8'));
// Since each body carries its own detail scale; the root value is only the default.
// Six loaded road inspections with fixed-camera size comparisons.
test.describe.configure({ timeout: 240_000 });
test.skip(process.env.VEHICLE_SCALE_CAPTURE !== '1', 'opt-in six-car scale evidence');
test('shows every car and its connected trailer at old and enlarged sizes', async ({ page }) => {
  const output = evidencePath('scale'); mkdirSync(output, { recursive: true });
  const facts = [];
  for (const vehicle of vehicles) {
    await page.goto(`/?track=shoreline&bot=1&dev=1&time=day&vehicle=${vehicle.id}&inspect=vehicle&perf=1&perfSlimes=none`);
    await expect(page.locator('#inspection-ready')).toHaveAttribute('data-complete', 'true', { timeout: 40000 });
    const dimensions = await page.evaluate(({ factor }) => {
      const s = (window.game as any).session; const camera = s.world.camera;
      document.querySelector('#inspection-ready')?.remove();
      const meshes = [s.mesh, ...(s.trailerModel ? [s.trailerModel.group] : [])];
      const box = s.model.windshield.clone().makeEmpty();
      for (const mesh of meshes) box.union(box.clone().setFromObject(mesh));
      const centre = box.getCenter(camera.position.clone());
      const extent = box.getSize(camera.position.clone());
      const anchor = s.mesh.position.clone(); anchor.y = box.min.y;
      const offset = camera.position.clone().set(.8, .45, -.9).normalize()
        .applyQuaternion(s.mesh.quaternion).multiplyScalar(extent.length() * 1.25);
      camera.position.copy(centre).add(offset); camera.lookAt(centre);
      camera.fov = 45; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      (window as any).scaleComparison = { meshes, anchor,
        positions: meshes.map((m: any) => m.position.clone()) };
      // Exact vertex comparison separately proves these poses reproduce the original GLBs.
      for (const mesh of meshes) {
        mesh.scale.setScalar(1 / factor);
        mesh.position.sub(anchor).multiplyScalar(1 / factor).add(anchor);
      }
      s.world.render();
      return { after: extent.toArray(), before: extent.clone().divideScalar(factor).toArray(),
        vehicle: s.vehicle.id, grounded: s.car.grounded, resets: (window.game as any).report().resets };
    }, { factor: vehicle.detailScale ?? detailScale });
    expect(dimensions.grounded).toBe(true); expect(dimensions.resets).toBe(0);
    await page.screenshot({ path: resolve(output, `${vehicle.id}-before-size.png`) });
    await page.evaluate(() => {
      const c = (window as any).scaleComparison;
      c.meshes.forEach((mesh: any, i: number) => { mesh.scale.setScalar(1); mesh.position.copy(c.positions[i]); });
      (window.game as any).session.world.render(); delete (window as any).scaleComparison;
    });
    await page.screenshot({ path: resolve(output, `${vehicle.id}-after-size.png`) });
    facts.push(dimensions);
  }
  writeFileSync(resolve(output, 'dimensions.json'), JSON.stringify(facts, null, 2));
});
