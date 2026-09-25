import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

/**
 * At night, rain and snow crossing a headlight light up. Records the cost of the effect
 * switched on and off in the same frame, because the player asked for it to be dropped if it is too
 * expensive. Fog no longer throws an airborne beam: a lamp in fog is just
 * the same lens and road pool as any other weather.
 */
const OUT = evidencePath('lamp-precipitation');
test.describe.configure({ timeout: 300_000 });
const CASES = [['night', 'rain'], ['night', 'snow']] as const;

async function side(page: Page) {
  await page.evaluate(() => {
    const s = (window.game as any).session, car = s.racers[0].mesh, cam = s.world.camera;
    const fwd = new (car.position.constructor)(0, 0, -1).applyQuaternion(car.quaternion);
    const right = new (car.position.constructor)(1, 0, 0).applyQuaternion(car.quaternion);
    s.racers[0].chase.update = () => {
      cam.position.copy(car.position).addScaledVector(right, 11).addScaledVector(fwd, 2).setY(car.position.y + 2.2);
      cam.lookAt(car.position.x + fwd.x * 3, car.position.y + .8, car.position.z + fwd.z * 3);
    };
  });
  await page.waitForTimeout(400);
}

for (const [time, weather] of CASES) test(`lamps in ${time} ${weather}`, async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, obstacles: false, best: {} })));
  await page.goto(`/?dev=1&track=sydney&bot=1&speed=1&time=${time}&weather=${weather}`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await page.waitForFunction(() => window.game.report().progress > 120, null, { timeout: 90_000 });
  await expectWorldLoaded(page, `${time} ${weather}`);
  await page.evaluate(() => { (window.game as any).timeScale = 0; });
  await page.waitForTimeout(600);
  const name = `${time}-${weather}`;
  await page.screenshot({ path: resolve(OUT, `${name}-chase.png`) });
  const report = await page.evaluate(() => window.game.report().vehicleLights);
  expect(report.every(light => light.pools > 0), 'every car keeps its scene lights').toBe(true);
  const cost = await page.evaluate(() => {
    const w = (window.game as any).session.world; const gl = w.renderer.getContext();
    const px = new Uint8Array(4);
    const reach = w.sky.lampUniforms.uLampPosReach.value.map((v: any) => v.w);
    const time = (on: boolean) => {
      w.sky.lampUniforms.uLampPosReach.value.forEach((v: any, i: number) => { v.w = on ? reach[i] : 0; });
      w.renderer.render(w.scene, w.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // World turns info.autoReset off, so reset here and report per render rather than a running total.
      w.renderer.info.reset();
      const t0 = performance.now();
      for (let i = 0; i < 40; i++) { w.renderer.render(w.scene, w.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      return { ms: (performance.now() - t0) / 40, calls: w.renderer.info.render.calls / 40 };
    };
    const off = time(false), on = time(true), off2 = time(false), on2 = time(true);
    // Same chase frame, effect off then on: how many pixels the lamp-lit rain or snow brighten.
    const grab = (on: boolean) => {
      w.sky.lampUniforms.uLampPosReach.value.forEach((v: any, i: number) => { v.w = on ? reach[i] : 0; });
      w.renderer.render(w.scene, w.camera);
      const size = w.renderer.getDrawingBufferSize(new (w.camera.position.constructor)());
      const out = new Uint8Array(size.x * size.y * 4);
      gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    };
    const dark = grab(false), lit = grab(true);
    let litPixels = 0;
    for (let i = 0; i < dark.length; i += 4)
      if (lit[i]! + lit[i + 1]! + lit[i + 2]! - dark[i]! - dark[i + 1]! - dark[i + 2]! > 45) litPixels++;
    return { lampReach: reach, off, on, off2, on2, litPixels };
  });
  await side(page);
  await page.screenshot({ path: resolve(OUT, `${name}-side.png`) });
  writeFileSync(resolve(OUT, `${name}-cost.json`), JSON.stringify({ lights: report, ...cost }, null, 2));
  expect(cost.lampReach[0], 'the player headlight lights precipitation').toBeGreaterThan(0);
  expect(cost.litPixels, 'switching the effect on visibly brightens this frame').toBeGreaterThan(200);
});
