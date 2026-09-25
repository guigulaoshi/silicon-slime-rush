import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

const RUN = process.env.NIGHT_LAMP_QA === '1';
// Its two reference images were recorded with SwiftShader; ordinary runs render on the GPU.
test.skip(!RUN || process.env.SR_E2E_SOFTWARE !== '1',
  'run with NIGHT_LAMP_QA=1 SR_E2E_SOFTWARE=1 for focused night-light evidence');
test.describe.configure({ timeout: 180_000 });

const OUT = evidencePath('road-light');

for (const quality of ['high', 'low'] as const) {
  test(`${quality} keeps the full pole-to-ground light chain`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript((selected) => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
      version: 1, language: 'en', quality: selected, volume: 0, muted: true, best: {},
    })), quality);
    // twin-peaks (winding hill road) -> new-york: this test is about the generic lamp-instancing
    // mechanism (pole/lens/cone/pool counts and shader flags), not route geometry, but it needs a
    // track with enough streetlights in view for facts.count>20 -- new-york is explicitly the
    // densest new city per the track table, the safest bet for lamp density.
    await page.goto('/?track=new-york&bot=1&dev=1&time=night&inspect=lights');
    await page.waitForFunction(() => document.querySelector<HTMLOutputElement>('#inspection-ready')
      ?.dataset.complete === 'true', null, { timeout: 90_000 });
    await expectWorldLoaded(page, `night lamps ${quality}`);

    const facts = await page.evaluate(() => {
      const scenery = window.game.session.world.nightScenery;
      const bodies = scenery.root.getObjectByName('night-lamp-bodies')! as any;
      const lenses = scenery.root.getObjectByName('night-lamp-lenses')! as any;
      const cones = scenery.root.getObjectByName('night-light-cones')! as any;
      const pools = scenery.root.getObjectByName('night-light-pools')! as any;
      bodies.geometry.computeBoundingBox();
      const bodyBounds = bodies.geometry.boundingBox!;
      return {
        count: scenery.count,
        drawCalls: scenery.drawCalls,
        dynamicLights: scenery.dynamicLights,
        instanceCounts: [bodies.count, lenses.count, cones.count, pools.count],
        bodyHeight: bodyBounds.max.y - bodyBounds.min.y,
        bodyReach: bodyBounds.max.x - bodyBounds.min.x,
        poolAcross: Math.hypot(...Array.from(pools.instanceMatrix.array.slice(0, 3)) as number[]),
        coneShader: cones.material.isShaderMaterial === true,
        poolShader: pools.material.isShaderMaterial === true,
        coneOpacity: cones.material.uniforms.uOpacity.value as number,
        poolOpacity: pools.material.uniforms.uOpacity.value as number,
        fadeNear: cones.material.uniforms.uFadeNear.value as number,
        fadeFar: cones.material.uniforms.uFadeFar.value as number,
      };
    });
    expect(facts.count).toBeGreaterThan(20);
    expect(facts.instanceCounts).toEqual(Array(4).fill(facts.count));
    expect(facts).toMatchObject({ drawCalls: 4, dynamicLights: 0, coneShader: true, poolShader: true });
    expect(facts.bodyHeight).toBeGreaterThan(6);
    expect(facts.bodyReach).toBeGreaterThan(1.9);
    expect(facts.poolAcross).toBeGreaterThanOrEqual(6.5);
    expect(facts.coneOpacity).toBeGreaterThan(0.07);
    expect(facts.poolOpacity).toBeGreaterThan(0.3);
    expect(facts.fadeFar).toBeGreaterThan(facts.fadeNear);

    mkdirSync(OUT, { recursive: true });
    const path = resolve(OUT, `night-lamps-${quality}.png`);
    const screenshot = await page.screenshot({ animations: 'disabled' });
    // RETARGET-MEASURE: this snapshot's baseline was recorded on twin-peaks; it isn't checked into this
    // tree (no game/e2e/night-lamps/142-night-lamps-*.png found), so it already needs a live
    // NIGHT_LAMP_QA=1 SR_E2E_SOFTWARE=1 run to record a fresh one for new-york regardless of this retarget.
    expect(screenshot).toMatchSnapshot(
      ['night-lamps', `night-lamps-${quality}.png`],
      { maxDiffPixelRatio: 0.015 },
    );
    writeFileSync(path, screenshot);
    writeFileSync(resolve(OUT, `night-lamps-${quality}.json`), JSON.stringify(facts, null, 2));
    console.log(`night lamps ${quality}: ${JSON.stringify(facts)} · ${path}`);
  });
}
