import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePathOr } from './evidence';
import { expectWorldLoaded } from './world';
import { slimeGroundFraction } from '../src/world/slimeShape';

/**
 * Rain and snow do not fall inside a giant's body, seen from outside or while driving
 * through it; outside the body they are unchanged. PRECIP_BEFORE=1 only captures.
 */
const BEFORE = process.env.PRECIP_BEFORE === '1';
const OUT = evidencePathOr(process.env.PRECIP_OUT, 'giant-precipitation', BEFORE ? 'before' : 'after');
test.describe.configure({ timeout: 180_000 });

async function stage(page: Page, weather: string) {
  await page.goto(`/?track=synth-p2p&bot=1&dev=1&time=day&weather=${weather}&vehicle=sedan`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, `387 ${weather}`);
  const centreHeight = 7.2 * slimeGroundFraction('colossus');
  return page.evaluate(centreHeight => {
    const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
    g.autopilot = false; layer.fallingLimit = 0;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const at = spline.indexAt(70), p = spline.point(at), t = spline.tangent(at);
    const startAt = spline.indexAt(27), start = spline.point(startAt), startT = spline.tangent(startAt);
    layer.addTile('giant-precipitation', [{ kind: 'colossus',
      position: [p[0], p[1] + centreHeight, p[2]], scale: [9.2, 7.2, 9.2], yaw: Math.atan2(-t[0], -t[2]) }]);
    s.car.reset([start[0], start[1] + .8, start[2]], Math.atan2(-startT[0], -startT[2]));
    s.race.reacquire(start[0], start[2]);
    return layer.stats.colossusEntries;
  }, centreHeight);
}

/** Pixels that change between drawing the frame with and without the giants handed to the sky. */
async function giantMask(page: Page) {
  return page.evaluate(() => {
    const s = (window.game as any).session, w = s.world, gl = w.renderer.getContext(), sky = w.sky;
    const size = w.renderer.getDrawingBufferSize(new (w.camera.position.constructor)());
    const giants = s.slimes.nearestColossi?.(w.camera.position) ?? [...s.slimes.liveByKey.values()].filter((l: any) => l.spawn.kind === 'colossus').map((l: any) => l.spawn);
    const grab = (list: unknown[]) => { if (sky.setGiants) sky.setGiants(list); w.renderer.render(w.scene, w.camera);
      const out = new Uint8Array(size.x * size.y * 4); gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, out); return out; };
    // The cloud is a ring 7-50 m round the camera and only its draw range is drawn, so a single frame
    // may hold no drawn drop inside the body at all.
    // Turning the cloud about the camera through twelve angles sweeps real drops through the body.
    const cloud = sky.weather === 'rain' ? sky.rain : sky.snow, pos = cloud.geometry.getAttribute('position');
    const drawn = Math.min(pos.count, cloud.geometry.drawRange.count);
    const g = giants[0], vertex = new (w.camera.position.constructor)();
    let changed = 0, inside = 0;
    const yaw = cloud.rotation.y;
    for (let turn = 0; turn < 12; turn++) {
      cloud.rotation.y = yaw + turn * Math.PI / 6; cloud.updateMatrixWorld(true);
      const without = grab([]), withGiants = grab(giants);
      for (let i = 0; i < without.length; i += 4)
        if (Math.abs(without[i]! - withGiants[i]!) + Math.abs(without[i + 1]! - withGiants[i + 1]!) + Math.abs(without[i + 2]! - withGiants[i + 2]!) > 30) changed++;
      // drawn drops actually inside the body at this angle (CPU check on the camera-local cloud)
      for (let i = 0; g && i < drawn; i++) {
        vertex.fromBufferAttribute(pos, i).applyMatrix4(cloud.matrixWorld);
        const dx = vertex.x - g.position[0], dy = vertex.y - g.position[1], dz = vertex.z - g.position[2];
        if ((dx / g.scale[0]) ** 2 + (dy / g.scale[1]) ** 2 + (dz / g.scale[2]) ** 2 < 1) inside++;
      }
    }
    cloud.rotation.y = yaw; cloud.updateMatrixWorld(true);
    const c = w.camera.position;
    const cameraDepth = g ? Math.sqrt(((c.x - g.position[0]) / g.scale[0]) ** 2 + ((c.y - g.position[1]) / g.scale[1]) ** 2 + ((c.z - g.position[2]) / g.scale[2]) ** 2) : null;
    return { changed, inside, giants: giants.length, cameraDepth };
  });
}

for (const weather of ['rain', 'snow']) test(`no ${weather} inside the giant`, async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const entries = await stage(page, weather);
  await page.evaluate(() => {
    const g = window.game as any, s = g.session, cam = s.world.camera, spline = s.world.spline;
    g.timeScale = 0;
    const at = spline.indexAt(40), p = spline.point(at), t = spline.tangent(at);
    s.racers[0].chase.update = () => { cam.position.set(p[0] - t[0] * 4, p[1] + 3.2, p[2] - t[2] * 4); cam.lookAt(p[0] + t[0] * 30, p[1] + 3, p[2] + t[2] * 30); };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUT, `${weather}-outside.png`) });
  const outside = await giantMask(page);
  // drive through it
  await page.evaluate(() => {
    const g = window.game as any, s = g.session, spline = s.world.spline;
    g.timeScale = 1; delete s.racers[0].chase.update;
    const startAt = spline.indexAt(40), start = spline.point(startAt), t = spline.tangent(startAt);
    s.car.reset([start[0], start[1] + .8, start[2]], Math.atan2(-t[0], -t[2]));
    s.car.body.setLinvel({ x: t[0] * 12, y: 0, z: t[2] * 12 }, true);
  });
  await page.waitForFunction(e => (window.game as any).session.slimes.stats.colossusTransit
    && (window.game as any).session.slimes.stats.colossusEntries > e, entries, { timeout: 20_000, polling: 'raf' });
  // Wait for the camera itself to be inside the body, not a fixed time after the car entered: how far
  // behind the car the chase camera trails depends on the car's size, and 378 shrank every car to 0.7x,
  // which left the camera on the membrane 0.7 s in with no rain in view to compare.
  await page.waitForFunction(() => {
    const s = (window.game as any).session, c = s.world.camera.position;
    const g = s.slimes.nearestColossi(c)[0];
    return g && ((c.x - g.position[0]) / g.scale[0]) ** 2 + ((c.y - g.position[1]) / g.scale[1]) ** 2
      + ((c.z - g.position[2]) / g.scale[2]) ** 2 < .6 ** 2;
  }, null, { timeout: 20_000, polling: 'raf' });
  await page.evaluate(() => { (window.game as any).timeScale = 0; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `${weather}-inside.png`) });
  // The game's own frames, with nothing set by this test, must have handed the giant to the sky.
  const handed = BEFORE ? null : await page.evaluate(async () => {
    const s = (window.game as any).session;
    s.world.sky.setGiants([]);   // clear what this test set earlier, then let the game draw
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const slot = s.world.sky.giantUniforms.uGiantCentre.value[0];
    const nearest = s.slimes.nearestColossi(s.world.camera.position)[0];
    return { active: slot.w, offset: Math.hypot(slot.x - nearest.position[0], slot.y - nearest.position[1], slot.z - nearest.position[2]) };
  });
  const inside = await giantMask(page);
  writeFileSync(resolve(OUT, `${weather}.json`), JSON.stringify({ outside, inside }, null, 2));
  expect(outside.giants).toBeGreaterThan(0);
  if (BEFORE) return;
  expect(handed!.active, 'the render loop hands the nearest giant to the precipitation').toBe(1);
  expect(handed!.offset).toBeLessThan(.01);
  expect(inside.cameraDepth!, 'the inside frame is taken from inside the body').toBeLessThan(1);
  expect(inside.inside, 'the camera-local cloud really overlaps the body').toBeGreaterThan(0);
  expect(inside.changed, 'handing the giant to the sky removes the particles inside it').toBeGreaterThan(20);
});
