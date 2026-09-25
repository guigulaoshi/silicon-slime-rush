import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

test.skip(process.env.SLIME_APPEARANCE_QA !== '1', 'run with SLIME_APPEARANCE_QA=1');
test.describe.configure({ timeout: 180_000 });

const SHOT = evidencePath('shots', 'synth-loop',
  'slime-appearance.png');
const LATER_SHOT = evidencePath('shots', 'synth-loop',
  'slime-appearance-later.png');

test('shows all five slime bodies through the shipped one-draw material', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true,
    obstacles: true, best: {},
  })));
  await page.goto('/?track=synth-loop&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  await expectWorldLoaded(page, 'five-slime appearance gallery');
  const report = await page.evaluate(() => window.game.report());
  expect(Object.values(report.slimes?.byKind ?? {}).every((count) => count > 0)).toBe(true);

  const gallery = await page.evaluate(() => {
    const game = window.game as unknown as { session: any; phase: string };
    const layer = game.session.slimes;
    const camera = game.session.world.camera;
    const mesh = layer.mesh;
    const forward = camera.getWorldDirection(layer.position).clone();
    const right = forward.clone().cross(camera.up).normalize();
    const centre = camera.position.clone().addScaledVector(forward, 12);
    const placements: Record<string, [number, number, number, number]> = {
      popper: [-2.9, 0.65, 0.50, 0.54],
      burst: [-1.55, 0.55, 0.72, 0.82],
      boost: [-0.35, -0.55, 0.92, 0.28],
      slick: [0.75, -1.05, 1.25, 0.08],
      colossus: [2.2, 0.05, 2.1, 1.42],
    };
    layer.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, layer.matrix);
    const shown: string[] = [];
    for (const [kind, [x, y, width, height]] of Object.entries(placements)) {
      const live = layer.lives.find((item: any) => item.spawn.kind === kind);
      if (!live) continue;
      const position = centre.clone().addScaledVector(right, x);
      position.y = camera.position.y + y;
      const depth = kind === 'slick' ? width * 0.8
        : kind === 'boost' ? width * 1.9
        : kind === 'colossus' ? 1.7 : width;
      layer.rotation.identity();
      layer.matrix.compose(position, layer.rotation, layer.scale.set(width, height, depth));
      mesh.setMatrixAt(live.index, layer.matrix);
      shown.push(kind);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // The production bounds describe the streamed road positions. This QA-only gallery moves six
    // matrices in front of the camera, so do not let those stale bounds cull the evidence frame.
    mesh.frustumCulled = false;
    game.phase = 'paused';
    document.querySelectorAll<HTMLElement>('#ui, .tuning-panel, .touch-controls')
      .forEach((node) => { node.style.display = 'none'; });
    const renderer = game.session.world.renderer;
    renderer.info.autoReset = false;
    renderer.info.reset();
    renderer.render(game.session.world.scene, camera);
    const withSlimes = renderer.info.render.calls;
    mesh.visible = false;
    renderer.info.reset();
    renderer.render(game.session.world.scene, camera);
    const withoutSlimes = renderer.info.render.calls;
    mesh.visible = true;
    renderer.info.autoReset = true;
    layer.shaderTime.value = 1;
    renderer.render(game.session.world.scene, camera);
    return { shown, drawMesh: mesh.name, materialCount: Array.isArray(mesh.material) ? mesh.material.length : 1,
      drawCalls: withSlimes - withoutSlimes,
      parallaxSamples: (layer.material.fragmentShader.match(/viewDirection \* 0\./g) ?? []).length };
  });
  expect(gallery).toEqual({
    shown: ['popper', 'burst', 'boost', 'slick', 'colossus'],
    drawMesh: 'slimes', materialCount: 1, drawCalls: 1, parallaxSamples: 3,
  });
  mkdirSync(resolve(SHOT, '..'), { recursive: true });
  const first = await page.screenshot({ path: SHOT });
  await page.evaluate(() => {
    const game = window.game as unknown as { session: any };
    const layer = game.session.slimes;
    // 0.58 s is almost half of the burst's 5.4-radian pulse cycle, so the two evidence frames
    // deliberately show opposite brightness rather than depending on a lucky capture moment.
    layer.shaderTime.value = 1.58;
    game.session.world.renderer.render(game.session.world.scene, game.session.world.camera);
  });
  const later = await page.screenshot({ path: LATER_SHOT });
  expect(later.equals(first), 'fixed camera pixels must change when jelly and burst time advance').toBe(false);
});
