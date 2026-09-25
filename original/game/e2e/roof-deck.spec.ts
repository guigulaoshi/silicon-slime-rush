import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

const out = evidencePath('roof-deck');
test.describe.configure({ timeout: 180_000 });

/* */
test('the flat roof past the Big Tech Rooftop rail holds a car up', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({ version: 13, language: 'en' })));
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  await page.evaluate(async () => {
    await (window.game as any).startRace({ trackId: 'wolfe-pruneridge', vehicleId: 'school-bus',
      playerVehicles: ['school-bus'], timeOfDay: 'day', weather: 'clear', slimeDensity: 'none', ai: false }, true);
  });
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, 'roof loop');

  // Every sampled station, both sides, from just past the rail to 20 m out: physics finds the roof.
  const surface = await page.evaluate(async () => {
    const g = window.game as any, s = g.session, sp = s.world.spline, rows: any[] = [];
    for (let d = 0; d < sp.length; d += 90) {
      const i = sp.indexAt(d), p = sp.point(i), r = sp.right(i), hw = sp.halfWidth[Math.round(i)]!;
      s.humans[0].car.reset([p[0], p[1] + 1, p[2]], 0);
      await new Promise(done => setTimeout(done, 400));
      for (const side of [1, -1]) for (const off of [1.5, 4, 8, 14, 20]) {
        const x = p[0] + r[0] * side * (hw + off), z = p[2] + r[2] * side * (hw + off);
        const hit = s.physics.surfaceAt(x, z, p[1] + 10, p[1] - 80);
        rows.push({ d, side, off, road: p[1], ground: hit?.point.y ?? null });
      }
    }
    return rows;
  });
  expect(surface.length).toBeGreaterThan(100);
  const holes = surface.filter(row => row.ground === null || Math.abs(row.ground - row.road) > .6);
  expect(holes, JSON.stringify(holes.slice(0, 5))).toEqual([]);

  // A bus parked and rolling on the roof outside the rail stays on the roof for the whole second
  // before roadside rescue would take it back.
  const drive = await page.evaluate(async () => {
    const g = window.game as any, racer = g.session.humans[0], sp = g.session.world.spline;
    const i = sp.indexAt(420), p = sp.point(i), r = sp.right(i), t = sp.tangent(i);
    const hw = sp.halfWidth[Math.round(i)]!;
    const priorResets = racer.resetLog.length;
    racer.car.reset([p[0] + r[0] * (hw + 8), p[1] + .9, p[2] + r[2] * (hw + 8)], Math.atan2(-t[0], -t[2]));
    racer.car.body.setLinvel({ x: t[0] * 6, y: 0, z: t[2] * 6 }, true);
    racer.race.reacquire(racer.car.position.x, racer.car.position.z);
    racer.chase.reset();
    const heights: number[] = [];
    // Real frames: the game loop steps physics; stop sampling before the 1.15 s rescue could fire.
    const start = racer.race.time;
    while (racer.race.time - start < 1) {
      await new Promise(done => requestAnimationFrame(done));
      heights.push(racer.car.position.y - p[1]);
    }
    return { heights, grounded: racer.car.grounded, resets: racer.resetLog.length - priorResets,
      log: racer.resetLog.slice(priorResets), raceTime: racer.race.time, phase: g.phase };
  });
  expect(drive.heights.length, JSON.stringify(drive)).toBeGreaterThan(5);
  expect(drive.resets, JSON.stringify(drive)).toBe(0);
  expect(Math.min(...drive.heights), JSON.stringify(drive)).toBeGreaterThan(0);
  expect(Math.max(...drive.heights), JSON.stringify(drive)).toBeLessThan(2.5);
  expect(drive.grounded).toBe(true);
  // For the picture: park the bus back on the roof and shoot before rescue's 1.15 s clock runs out.
  const parked = await page.evaluate(async () => {
    const g = window.game as any, racer = g.session.humans[0], sp = g.session.world.spline;
    const i = sp.indexAt(420), p = sp.point(i), r = sp.right(i), t = sp.tangent(i);
    const hw = sp.halfWidth[Math.round(i)]!;
    // Back on the road for a few frames first, so the rescue clock from the sample above is cleared.
    racer.car.reset([p[0], p[1] + .9, p[2]], Math.atan2(-t[0], -t[2]));
    racer.race.reacquire(p[0], p[2]);
    for (let k = 0; k < 10; k++) await new Promise(done => requestAnimationFrame(done));
    racer.car.reset([p[0] + r[0] * (hw + 6), p[1] + .9, p[2] + r[2] * (hw + 6)], Math.atan2(-t[0], -t[2]));
    racer.race.reacquire(racer.car.position.x, racer.car.position.z);
    racer.chase.reset();
    const start = racer.race.time;
    while (racer.race.time - start < .6) await new Promise(done => requestAnimationFrame(done));
    g.timeScale = 0;   // freeze the drive so the picture is taken before rescue, however slow the frame
    return racer.car.position.y - p[1];
  });
  expect(parked).toBeGreaterThan(0);
  await page.screenshot({ path: resolve(out, 'bus-on-roof-past-rail.png'), animations: 'disabled' });
  await page.evaluate(() => { (window.game as any).timeScale = 1; });

  // Past the building's real edge a car can still fall to the ground; it lands on the terrain there.
  const dropped = await page.evaluate(async () => {
    const g = window.game as any, racer = g.session.humans[0], sp = g.session.world.spline;
    const i = sp.indexAt(420), p = sp.point(i), r = sp.right(i), t = sp.tangent(i);
    const hw = sp.halfWidth[Math.round(i)]!;
    const rows: { side: number; road: number; ground: number; lowest: number; settled: number }[] = [];
    for (const side of [1, -1]) {
      let off = hw + 20;
      while (off < hw + 120 && Math.abs((g.session.physics.surfaceAt(p[0] + r[0] * side * off,
        p[2] + r[2] * side * off, p[1] + 5, p[1] - 80)?.point.y ?? p[1]) - p[1]) < 5) off += 2;
      const x = p[0] + r[0] * side * (off + 6), z = p[2] + r[2] * side * (off + 6);
      const ground = g.session.physics.surfaceAt(x, z, p[1] + 5, p[1] - 80)!.point.y;
      racer.car.reset([x, p[1] + 1, z], Math.atan2(-t[0], -t[2]));
      racer.race.reacquire(x, z);
      let lowest = Infinity; const start = racer.race.time;
      while (racer.race.time - start < 3) {
        await new Promise(done => requestAnimationFrame(done));
        lowest = Math.min(lowest, racer.car.position.y);
      }
      rows.push({ side, road: p[1], ground, lowest, settled: racer.car.position.y });
    }
    return rows;
  });
  for (const row of dropped) {
    expect(row.ground, JSON.stringify(dropped)).toBeLessThan(row.road - 10);
    expect(row.lowest, JSON.stringify(dropped)).toBeGreaterThan(row.ground - .5);
  }
  writeFileSync(resolve(out, 'roof-deck.json'), JSON.stringify({ surface, drive, dropped }, null, 2));
});
