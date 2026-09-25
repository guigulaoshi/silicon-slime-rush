import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { checkMaximum } from '../test-support/resource-limit';

// One real-road inspection plus two localized garage views.
test.describe.configure({ timeout: 120_000 });
const output = evidencePath('sedan');
test('Sedan has localized menu identity and a visible curved production body', async ({ page }) => {
  mkdirSync(output, { recursive: true });
  for (const language of ['en', 'zh']) {
    await page.addInitScript(lang => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      language: lang, muted: true, best: {},
    })), language);
    await page.goto('/'); await page.locator('.home-go').click();
    await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
    const choice = page.locator('[data-vehicle="micro-hatch"]');
    await expect(choice.locator('.sm-carnm')).toHaveText(language === 'en' ? 'Sedan' : '轿车');
    await choice.click();
    await expect(page.locator('.sm-carhero')).toHaveAttribute('data-model-vehicle', 'micro-hatch');
    await expect(page.locator('.sm-carhero canvas')).toBeVisible();
    await expect(page.locator('[data-screen="menu"]')).not.toContainText(/Tesla|Model Y|特斯拉/);
    await page.screenshot({ path: resolve(output, `menu-${language}.png`) });
  }
  await page.goto('/?track=shoreline&bot=1&dev=1&time=day&vehicle=micro-hatch&inspect=vehicle&perf=1&perfSlimes=none');
  await expect(page.locator('#inspection-ready')).toHaveAttribute('data-complete', 'true', { timeout: 40000 });
  expect(await page.evaluate(() => window.game.report().vehicle)).toBe('micro-hatch');
  expect(await page.evaluate(() => window.game.report().time)).toBeGreaterThan(0);
  const paint = await page.evaluate(() => {
    const paints = new Map<string, number[]>();
    (window.game as any).session.model.group.traverse((mesh: any) => {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (material && ['Factory body paint', 'Mirror housing paint'].includes(material.name)) {
          paints.set(material.name, material.color.toArray());
        }
      }
    });
    return Object.fromEntries(paints);
  });
  expect(Object.keys(paint).sort()).toEqual(['Factory body paint', 'Mirror housing paint']);
  for (const channels of Object.values(paint)) {
    expect(Math.max(...channels), 'production paint must read as black, including the mirrors').toBeLessThan(.03);
    expect(Math.min(...channels), 'retain highlights on the curved body').toBeGreaterThan(0);
  }
  expect(paint['Mirror housing paint']).toEqual(paint['Factory body paint']);
  writeFileSync(resolve(output, 'body-paint.json'), JSON.stringify(paint, null, 2));
  const splash = await page.evaluate(() => {
    const model = (window.game as any).session.model;
    const origin = model.windshield.getCenter(model.group.position.clone()); origin.z -= 1;
    const timings: number[] = []; let coverage = 0;
    for (let i = 0; i < 8; i++) {
      const start = performance.now(); coverage = model.splashCoverage(origin, 1.4);
      timings.push(performance.now() - start);
    }
    return { timings, coverage, samples: model.glassSamples.length };
  });
  // The former full-mesh scan stalls a collision for about 700 ms on this machine.
  if (process.env.PERF_REAL_GPU === '1') checkMaximum(
    Math.max(...splash.timings), 'splash_query_ms', 'sedan windshield splash query');
  expect(splash.samples).toBeGreaterThan(0);
  expect(splash.coverage).toBeGreaterThan(0);
  writeFileSync(resolve(output, 'splash-cost.json'), JSON.stringify(splash, null, 2));
  for (const view of ['front', 'side', 'rear']) {
    await page.evaluate(view => {
      const s = (window.game as any).session; const camera = s.world.camera;
      document.querySelector('#inspection-ready')?.remove();
      s.mesh.updateMatrixWorld(true);
      const bounds = s.model.windshield.clone().setFromObject(s.mesh);
      const centre = bounds.getCenter(camera.position.clone());
      const extent = bounds.getSize(camera.position.clone());
      const offset = camera.position.clone().set(view === 'side' ? 1 : 0.65, 0.32,
        view === 'front' ? -1 : view === 'rear' ? 1 : 0)
        .normalize().applyQuaternion(s.mesh.quaternion).multiplyScalar(extent.length() * 1.2);
      camera.position.copy(centre).add(offset); camera.lookAt(centre);
      camera.fov = 45; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      s.world.render();
    }, view);
    await page.screenshot({ path: resolve(output, `${view}.png`) });
  }
});
