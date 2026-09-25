import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Quality } from '../src/world/World';
import { expectWorldLoaded } from './world';

test.skip(process.env.ENVIRONMENT_SHADOW_QA !== '1',
  'run with ENVIRONMENT_SHADOW_QA=1 for fixed road-view shadow evidence');
test.describe.configure({ timeout: 240_000, mode: 'serial' });

const OUT = evidencePath('shots', 'environment-shadows');
// beijing: the new loop (game/public/tracks/beijing/track.json, length 2225 m), replacing
// wolfe-pruneridge as the closed campus-style route this test drives around. wolfe-pruneridge's old
// AT=591 was chosen because that arc length had all four shadow-caster kinds (buildings, trees,
// guardrails, facility detail) in view together; that mix cannot be read from static track.json data,
// only from a real scene traversal.
// RETARGET-MEASURE: confirm beijing has buildings, trees, guardrails and a facility-detail caster all
// visible near s=600 (ENVIRONMENT_SHADOW_QA=1 run); move this value if any category is missing there.
const AT = 600;

async function settle(page: Page): Promise<void> {
  let previous = -1;
  for (let round = 0; round < 30; round++) {
    await page.evaluate(([at, clear]: number[]) => {
      const world = window.game.session.world;
      if (clear) world.streamer.clear();
      const point = world.spline.point(world.spline.indexAt(at!));
      world.follow(at!, point[0]!, point[1]!, point[2]!);
    }, [AT, round === 0 ? 1 : 0]);
    await page.waitForFunction(() => (window.game.report().tiles?.loading ?? 1) === 0,
      null, { timeout: 120_000, polling: 100 });
    const loaded = await page.evaluate(() => window.game.report().tiles?.loaded ?? 0);
    if (loaded === previous) return;
    previous = loaded;
  }
  throw new Error('shadow evidence tile window never settled');
}

test('high, medium and low show the same place with deliberate shadow tiers', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const results: Record<string, { casters: Record<string, number>; radius: number;
    rendererShadows: boolean; sunCasts: boolean; castingDirectionalLights: number;
    environmentShadowPixels: number; carShadowPixels: number }> = {};

  for (const quality of ['high', 'medium', 'low'] as const) {
    await page.addInitScript((selected: Quality) => localStorage.setItem(
      'silicon-rush-world-tour.save.v1', JSON.stringify({
        version: 2, language: 'en', quality: selected, volume: 0, muted: true,
        slimeDensity: 'none', best: {},
      })), quality);
    await page.goto('/?track=beijing&bot=1&dev=1&time=day');
    await page.waitForFunction(() => window.game?.report().phase === 'racing', null,
      { timeout: 90_000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.game.report().phase === 'paused');
    await settle(page);
    await expectWorldLoaded(page, `environment shadows ${quality}`);

    const facts = await page.evaluate(({ selected, at }) => {
      const game = window.game;
      const world = game.session.world;
      world.setQuality(selected);
      const i = world.spline.indexAt(at);
      const point = world.spline.point(i);
      const tangent = world.spline.tangent(i);
      const side = [-tangent[2]!, 0, tangent[0]!] as [number, number, number];
      world.follow(at, point[0]!, point[1]!, point[2]!);
      world.camera.position.set(
        point[0]! - tangent[0]! * 12 + side[0] * 1.4,
        point[1]! + 6.2,
        point[2]! - tangent[2]! * 12 + side[2] * 1.4,
      );
      world.camera.lookAt(
        point[0]! + tangent[0]! * 60,
        point[1]! + 0.8,
        point[2]! + tangent[2]! * 60,
      );
      world.camera.updateMatrixWorld(true);
      game.session.gates.group.visible = false;
      game.session.sparks.mesh.visible = false;
      document.querySelectorAll<HTMLElement>('#ui, .tuning-panel, .touch-controls')
        .forEach((node) => { node.style.display = 'none'; });
      const car = game.session.mesh;
      car.visible = true;
      car.position.set(point[0]! + tangent[0]! * 24, point[1]! + 0.72,
        point[2]! + tangent[2]! * 24);
      car.rotation.set(0, Math.atan2(-tangent[0]!, -tangent[2]!), 0);
      world.scene.updateMatrixWorld(true);

      const casters = { buildings: 0, trees: 0, guardrails: 0, facilities: 0 };
      const environmentMeshes: any[] = [];
      world.streamer.root.traverse((object: any) => {
        if (!object.isMesh || !object.castShadow) return;
        environmentMeshes.push(object);
        const role = object.userData.environmentShadowRole;
        const name = object.name || object.parent?.name || '';
        if (name.startsWith('buildings') || name.startsWith('landmark_')
            || name === 'roof_support') casters.buildings++;
        else if (name.startsWith('trees_')) casters.trees++;
        else if (name === 'guardrail') casters.guardrails++;
        else if (role === 'detail') casters.facilities++;
      });
      const directional = world.scene.children.filter((object: any) => object.isDirectionalLight
        && object.castShadow).length;
      const carMeshes: any[] = [];
      car.traverse((object: any) => { if (object.isMesh && object.castShadow) carMeshes.push(object); });
      const pixels = (): Uint8Array => {
        world.render();
        const canvas = world.renderer.domElement;
        const gl = world.renderer.getContext();
        const out = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return out;
      };
      const changed = (a: Uint8Array, b: Uint8Array): number => {
        let count = 0;
        for (let px = 0; px < a.length; px += 4) {
          if (Math.abs(a[px]! - b[px]!) + Math.abs(a[px + 1]! - b[px + 1]!)
              + Math.abs(a[px + 2]! - b[px + 2]!) >= 12) count++;
        }
        return count;
      };
      const full = pixels();
      for (const mesh of environmentMeshes) mesh.castShadow = false;
      const noEnvironment = pixels();
      for (const mesh of environmentMeshes) mesh.castShadow = true;
      for (const mesh of carMeshes) mesh.castShadow = false;
      const noCar = pixels();
      for (const mesh of carMeshes) mesh.castShadow = true;
      pixels();
      return {
        casters,
        radius: world.sky.shadowRadius,
        rendererShadows: world.renderer.shadowMap.enabled,
        sunCasts: world.sky.sun.castShadow,
        castingDirectionalLights: directional,
        environmentShadowPixels: changed(full, noEnvironment),
        carShadowPixels: changed(full, noCar),
      };
    }, { selected: quality, at: AT });
    results[quality] = facts;
    const png = await page.screenshot({ animations: 'disabled' });
    writeFileSync(resolve(OUT, `206-${quality}.png`), png);
    console.log(`environment shadows ${quality}: ${JSON.stringify(facts)}`);
  }

  expect(results.high!.casters.buildings).toBeGreaterThan(0);
  expect(results.high!.casters.trees).toBeGreaterThan(0);
  expect(results.high!.casters.guardrails).toBeGreaterThan(0);
  expect(results.high!.casters.facilities).toBeGreaterThan(0);
  expect(results.medium!.casters.buildings).toBeGreaterThan(0);
  expect(results.medium!.casters.trees).toBeGreaterThan(0);
  expect(results.medium!.casters.guardrails).toBeGreaterThan(0);
  expect(results.medium!.casters.facilities).toBe(0);
  expect(results.low!.casters).toEqual({ buildings: 0, trees: 0, guardrails: 0, facilities: 0 });
  expect(results.high!.radius).toBeGreaterThan(results.medium!.radius);
  expect(results.medium!.radius).toBeGreaterThan(0);
  expect(results.low!.radius).toBe(0);
  expect(results.high).toMatchObject({ rendererShadows: true, sunCasts: true,
    castingDirectionalLights: 1 });
  expect(results.medium).toMatchObject({ rendererShadows: true, sunCasts: true,
    castingDirectionalLights: 1 });
  expect(results.low).toMatchObject({ rendererShadows: false, sunCasts: false,
    castingDirectionalLights: 0 });
  expect(results.high!.environmentShadowPixels).toBeGreaterThan(500);
  expect(results.high!.carShadowPixels).toBeGreaterThan(20);
  expect(results.medium!.environmentShadowPixels).toBeGreaterThan(500);
  expect(results.medium!.carShadowPixels).toBeGreaterThan(20);
  expect(results.low!.environmentShadowPixels).toBe(0);
  expect(results.low!.carShadowPixels).toBe(0);
});
