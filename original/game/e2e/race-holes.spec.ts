import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePathOr } from './evidence';
import { expectWorldLoaded } from './world';

/**
 * The hole 455 measured on the home page, asked from the cameras a player actually has.
 * The corridor's ground and road live only in streamed tiles, the driving window keeps about a
 * kilometre of them, and the backdrop leaves the corridor to those tiles on purpose -- so beyond the
 * window there is no ground, and a camera that can see that far looks through the world at the sky.
 *
 * Two cameras: the chase camera, and photo mode's orbit at its farthest (35 m, the same maths as
 * `orbitOffset`), at three pitches, facing along the route and back along it. Photo mode is the one
 * that matters: it can hang the camera tens of metres above the car.
 *
 * The ruler is 455's: sky dome hidden, frame cleared to magenta, magenta counted below the camera's own
 * horizon line, where only ground and sea can be. Points are fixed distances along the route rather
 * than moments of a drive, so a number here can be run again.
 * HOLES460_BEFORE=1 records without asserting.
 */
const BEFORE = process.env.HOLES460_BEFORE === '1';
const TRACK = process.env.HOLES460_TRACK ?? 'goldengate';
const AT = (process.env.HOLES460_AT ?? '600,1500,2600').split(',').map(Number);
const OUT = evidencePathOr(process.env.HOLES460_OUT, 'race-holes', BEFORE ? 'before' : 'after');
test.describe.configure({ timeout: 900_000 });

test(`no sky under the horizon from the race and photo cameras on ${TRACK}`, { tag: '@version' }, async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?track=${TRACK}&bot=1&dev=1&time=day&speed=4`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing', undefined, { timeout: 300_000 });
  await expectWorldLoaded(page, 'race holes');
  const rows: { s: number; camera: string; sky: number }[] = [];
  for (const target of AT) {
    await page.waitForFunction(t => (window.game as any).session.race.progress.value.s >= t, target,
      { timeout: 600_000, polling: 100 });
    // Let the streamer settle on where the car now is, as it would for a player who stopped to look.
    await page.evaluate(() => { (window.game as any).timeScale = 0; });
    await page.waitForFunction(() => (window.game as any).session.world.streamer.pending.size === 0,
      undefined, { timeout: 60_000 });
    const measured = await page.evaluate(() => {
      const g = window.game as any, s = g.session, w = s.world, cam = w.cameras[0], gl = w.renderer.getContext();
      const T = cam.position.constructor;
      const chaseUpdate = s.racers[0].chase.update;
      s.racers[0].chase.update = () => {};
      const domes: any[] = [];
      w.scene.traverse((o: any) => {
        if (o.isMesh && o.geometry?.type === 'SphereGeometry' && (o.material?.name ?? '') === '') domes.push(o);
      });
      const clear = w.renderer.getClearColor(w.scene.fog.color.clone());
      const sky = () => {
        for (const d of domes) d.visible = false;
        w.renderer.setClearColor(0xff00ff, 1);
        w.renderer.render(w.scene, cam);
        const size = w.renderer.getDrawingBufferSize(cam.position.clone());
        const px = new Uint8Array(size.x * size.y * 4);
        gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (const d of domes) d.visible = true;
        w.renderer.setClearColor(clear, 1);
        const ahead = cam.getWorldDirection(new T()).setY(0);
        if (ahead.lengthSq() < 1e-6) return 0;          // looking straight down: no horizon in frame
        const level = cam.position.clone().add(ahead.normalize().multiplyScalar(2000)).project(cam);
        const rowsBelow = Math.max(0, Math.min(size.y, Math.floor((level.y + 1) / 2 * size.y) - 10));
        let n = 0;
        for (let y = 0; y < rowsBelow; y++) for (let x = 0; x < size.x; x++) {
          const a = (y * size.x + x) * 4;
          if (px[a]! > 200 && px[a + 1]! < 80 && px[a + 2]! > 200) n++;
        }
        return n;
      };
      const out: { camera: string; sky: number }[] = [];
      const fov = cam.fov, near = cam.near;
      out.push({ camera: 'chase', sky: sky() });
      // Photo mode's orbit: target a little above the car, camera at `orbitOffset(yaw, pitch, 35)`.
      const car = s.car.position, spline = w.spline, t = spline.tangent(spline.indexAt(s.race.progress.value.s));
      const target = new T(car.x, car.y + Math.max(1, (s.racers[0].vehicle.height ?? 1.5) * .6), car.z);
      for (const [facing, sign] of [['forward', -1], ['back', 1]] as const) {
        const yaw = Math.atan2(sign * t[0], sign * t[2]);
        for (const pitchDeg of [15, 30, 50]) {
          const p = pitchDeg * Math.PI / 180, r = 35;
          cam.position.set(target.x + Math.sin(yaw) * Math.cos(p) * r, target.y + Math.sin(p) * r,
            target.z + Math.cos(yaw) * Math.cos(p) * r);
          cam.fov = 55; cam.near = .1; cam.lookAt(target); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
          out.push({ camera: `photo-${facing}-${pitchDeg}deg`, sky: sky() });
        }
      }
      cam.fov = fov; cam.near = near; cam.updateProjectionMatrix();
      s.racers[0].chase.update = chaseUpdate;
      g.timeScale = 1;
      return { s: Math.round(s.race.progress.value.s), out };
    });
    for (const row of measured.out) rows.push({ s: measured.s, ...row });
  }
  const worst = rows.reduce((a, b) => (b.sky > a.sky ? b : a));
  writeFileSync(resolve(OUT, `${TRACK}.json`), JSON.stringify({ worst, rows }, null, 2));
  console.log('HOLES460', TRACK, JSON.stringify({ worst, rows }));
  if (BEFORE) return;
  // Measured on goldengate, the worst track: chase camera at most 2,606, photo mode at most 6,087
  // (35 m behind the car, 15 degrees up, facing along the bridge) -- a thin strip under the Marin
  // hills. The home page's hole before 455 was 21,349. Ten thousand separates the two.
  expect(worst.sky, `${worst.sky} pixels of sky below the horizon (${worst.camera} at ${worst.s} m)`).toBeLessThan(10_000);
});
