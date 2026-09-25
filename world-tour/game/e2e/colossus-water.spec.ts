import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

const OUT = evidencePath('colossus-water');
test.describe.configure({ timeout: 180_000 });
test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } },
  viewport: { width: 1280, height: 720 } });

async function stageCrossing(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
    g.autopilot = false; layer.fallingLimit = 0;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const at = spline.indexAt(46), p = spline.point(at), t = spline.tangent(at);
    const startAt = spline.indexAt(27), start = spline.point(startAt), startT = spline.tangent(startAt);
    layer.addTile('colossus-water', [{ kind: 'colossus',
      position: [p[0], p[1] + 7.2, p[2]], scale: [9.2, 7.2, 9.2],
      yaw: Math.atan2(-t[0], -t[2]) }]);
    s.car.reset([start[0], start[1] + .8, start[2]], Math.atan2(-startT[0], -startT[2]));
    s.car.body.setLinvel({ x: startT[0] * 13, y: 0, z: startT[2] * 13 }, true);
    s.race.reacquire(start[0], start[2]);
    return layer.stats.colossusEntries;
  });
}

test('keeps immersion local and emits surface rings, forward spray and a fading wet trail', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?track=synth-p2p&bot=1&dev=1&time=day&vehicle=sedan');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'day underwater effects');
  const beforeEntries = await stageCrossing(page);
  const before = await page.evaluate(() => (window.game as any).session.slimes.stats);
  expect(before.colossusBubbles).toBe(0);
  expect(before.colossusCausticOpacity).toBe(0);
  await page.screenshot({ path: resolve(OUT, '01-outside-no-bubbles.png') });

  await page.waitForFunction(entries => {
    const stats = (window.game as any).session.slimes.stats;
    return stats.colossusEntries > entries;
  }, beforeEntries, { timeout: 20_000, polling: 'raf' });
  await page.waitForTimeout(90);
  await page.screenshot({ path: resolve(OUT, '02-inside-colour-and-bubbles.png') });

  await page.waitForFunction(() => {
    const stats = (window.game as any).session.slimes.stats;
    return stats.colossusTransit && stats.colossusBubbles === 18;
  }, undefined, { timeout: 10_000, polling: 'raf' });
  const insideA = await page.evaluate(() => {
    const g = window.game as any;
    const bubbles = [...document.querySelectorAll<HTMLElement>('.slime-bubbles span')];
    const styled = bubbles.filter(node => {
      const style = getComputedStyle(node);
      return style.backgroundImage !== 'none' && parseFloat(style.borderTopWidth) >= 1
        && style.borderTopColor !== 'rgba(0, 0, 0, 0)';
    }).length;
    const visible = bubbles.filter(node => parseFloat(node.style.opacity) > .08).length;
    const nearCar = bubbles.filter(node => {
      const x = parseFloat(node.style.left), y = parseFloat(node.style.top);
      return x >= 32 && x <= 68 && y >= 8 && y <= 84;
    }).length;
    return { stats: g.session.slimes.stats, styledBubbles: styled, visibleBubbles: visible,
      bubblesNearCar: nearCar };
  });
  await page.waitForTimeout(420);
  const insideB = await page.evaluate(() => ({ stats: (window.game as any).session.slimes.stats }));
  expect(insideA.styledBubbles).toBe(18);
  expect(insideA.visibleBubbles).toBeGreaterThan(8);
  expect(insideA.bubblesNearCar).toBe(18);
  expect(insideB.stats.feedback.causticTime).toBeGreaterThan(insideA.stats.feedback.causticTime);
  expect(insideA.stats.colossusCausticOpacity).toBeGreaterThan(0);
  expect(insideA.stats.colossusCausticSurfaces).toBeGreaterThan(0);
  expect(await page.locator('.slime-boundary-ripple').count()).toBe(0);

  const surfacePixels = await page.evaluate(() => {
    const g = window.game as any, s = g.session;
    const renderer = s.world.renderer, canvas = renderer.domElement as HTMLCanvasElement;
    const gl = renderer.getContext();
    const render = (strength: number) => {
      s.slimes.prepareView(s.car, strength);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
      renderer.render(s.world.scene, s.world.camera);
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    // The wrecks float inside the colossus (panels, wheels, seats) and may drift into the top band;
    // caustics lighting them is correct, so they sit out this sky check instead of being counted as
    // light leaking into the sky. Since 368 the car floats at its full height sooner, so more of them
    // share the frame with the sky.
    const floating = ['colossus-floating-body-panels', 'colossus-floating-car-wheels',
      'colossus-floating-car-seat-backs', 'colossus-floating-car-seat-cushions']
      .map(name => s.world.scene.getObjectByName(name)).filter(Boolean);
    const shown = floating.map((node: any) => node.visible);
    floating.forEach((node: any) => { node.visible = false; });
    const lit = render(1), unlit = render(0);
    floating.forEach((node: any, i: number) => { node.visible = shown[i]; });
    render(1);
    let surfaces = 0, sky = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const delta = Math.abs(lit[i]! - unlit[i]!) + Math.abs(lit[i + 1]! - unlit[i + 1]!)
        + Math.abs(lit[i + 2]! - unlit[i + 2]!);
      if (delta < 12) continue;
      if (y < canvas.height * .72) surfaces++;
      if (y > canvas.height * .88) sky++;
    }
    return { surfaces, sky, width: canvas.width, height: canvas.height };
  });
  expect(surfacePixels.surfaces).toBeGreaterThan(100);
  expect(surfacePixels.sky).toBe(0);
  await page.screenshot({ path: resolve(OUT, '03-inside-contained-caustics.png') });

  await page.waitForFunction(() => {
    const stats = (window.game as any).session.slimes.stats;
    return stats.colossusExits > 0 && !stats.colossusTransit && stats.colossusSplashes >= 1;
  }, undefined, { timeout: 20_000, polling: 'raf' });
  await page.waitForTimeout(90);
  // Removed the ripple rings at the membrane; the exit splash remains.
  expect(await page.evaluate(() => { let rings = 0; (window.game as any).session.world.scene.traverse((node: any) => {
    if (String(node.name).includes('ripple')) rings++; }); return rings; })).toBe(0);
  await page.screenshot({ path: resolve(OUT, '04-exit-splash.png') });
  await page.waitForFunction(() => (window.game as any).session.slimes.stats.colossusWetMarks > 3,
    undefined, { timeout: 8_000, polling: 'raf' });
  const after = await page.evaluate(() => (window.game as any).session.slimes.stats);
  expect(after.colossusBubbles).toBe(0);
  expect(after.colossusCausticOpacity).toBe(0);
  expect(after.colossusSplashes).toBe(1);
  expect(after.colossusRippleSurfaceError).toBeLessThan(1e-6);
  expect(after.colossusSprayForward).toBeGreaterThan(.7);
  await page.screenshot({ path: resolve(OUT, '05-wet-wheel-trail-after-exit.png') });

  await page.goto('/?track=synth-p2p&bot=1&dev=1&time=night&vehicle=sedan');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'night underwater effects');
  await stageCrossing(page);
  await page.waitForFunction(() => {
    const stats = (window.game as any).session.slimes.stats;
    return stats.colossusTransit && stats.colossusBubbles === 18;
  }, undefined, { timeout: 20_000, polling: 'raf' });
  const night = await page.evaluate(() => (window.game as any).session.slimes.stats);
  expect(night.colossusCausticOpacity).toBeGreaterThan(0);
  await page.screenshot({ path: resolve(OUT, '06-night-immersed-colour.png') });

  const reduced = await page.evaluate(async () => {
    document.documentElement.dataset.reducedMotion = 'true';
    await new Promise(resolve => setTimeout(resolve, 220));
    const first = (window.game as any).session.slimes.stats.feedback.causticTime;
    await new Promise(resolve => setTimeout(resolve, 220));
    return { stats: (window.game as any).session.slimes.stats,
      first, second: (window.game as any).session.slimes.stats.feedback.causticTime };
  });
  expect(reduced.stats.colossusCausticOpacity).toBeLessThan(.1);
  expect(reduced.second).toBe(reduced.first);
  writeFileSync(resolve(OUT, 'colossus-water.json'), JSON.stringify({ before, insideA, insideB,
    surfacePixels, after, night, reduced }, null, 2));

  const video = page.video();
  await page.close();
  if (video) await video.saveAs(resolve(OUT, 'colossus-water-drive.webm'));
});
