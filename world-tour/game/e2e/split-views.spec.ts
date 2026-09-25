import { evidencePath } from './evidence';
import { expect, test, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.describe.configure({ timeout: 180_000 });
const proof = evidencePath('split-views');

test('desktop views, HUDs and giant immersion remain independent and return to single', async ({ page }) => {
  mkdirSync(proof, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  // shoreline was retired; lhasa is this suite's default stand-in for "any flat, open, everyday
  // route" (see the private repo's retarget mapping table).
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'lhasa', car: 'sedan',
    timeOfDay: 'day', slimeDensity: 'normal', playerVehicles: ['micro-hatch', 'pickup-travel-trailer'] }))).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  const layout = await page.evaluate(() => {
    const s = (window.game as any).session;
    return { aspects: s.world.cameras.map((camera: any) => camera.aspect),
      hud: [...document.querySelectorAll('.player-hud')].map(node => {
        const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
      }), hosts: s.world.viewHosts.length };
  });
  expect(layout).toEqual({ aspects: [640 / 720, 640 / 720], hud: [[0, 0, 640, 720], [640, 0, 640, 720]], hosts: 2 });
  await page.waitForFunction(() => !!(window.game as any).streets);
  const ink = await page.locator('.player-hud .hud-nav').evaluateAll(nodes => nodes.map(node => {
    const canvas = node as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let pixels = 0; for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) pixels++;
    return pixels;
  }));
  expect(ink).toHaveLength(2);
  expect(Math.min(...ink)).toBeGreaterThan(200);
  writeFileSync(resolve(proof, 'map-ink.json'), JSON.stringify(ink));
  await page.screenshot({ path: resolve(proof, 'day.png') });
  await page.evaluate(() => {
    const s = (window.game as any).session;
    const giant = s.slimes.lives.find((live: any) => live.active && live.spawn.kind === 'colossus');
    if (!giant) throw new Error('No real streamed giant for split feedback check');
    const p = giant.spawn.position;
    s.racers[1].car.reset([p[0], p[1], p[2]], Math.PI / 2);
    s.racers[1].trailer?.syncReset(); s.racers[1].race.reacquire(p[0], p[2]);
    s.racers[1].chase.reset();
  });
  await page.waitForFunction(() => {
    const s = (window.game as any).session;
    return s.slimes.driverStats(s.racers[1].car).colossusTransit;
  });
  expect(await page.locator('.race-viewport[data-player="1"] .slime-immersion').evaluate(node => (node as HTMLElement).style.opacity)).toBe('0');
  expect(await page.locator('.race-viewport[data-player="2"] .slime-immersion').evaluate(node => (node as HTMLElement).style.opacity)).toBe('0.55');
  await page.screenshot({ path: resolve(proof, 'right-giant.png') });
  writeFileSync(resolve(proof, 'layout.json'), JSON.stringify(layout, null, 2));
  await page.setViewportSize({ width: 900, height: 900 });
  expect(await page.locator('.player-hud[data-player="2"]').evaluate(node => node.getBoundingClientRect().width)).toBe(450);
  await expect.poll(() => page.evaluate(() => window.game.session.world.cameras.map(c => c.aspect))).toEqual([.5, .5]);
  await page.screenshot({ path: resolve(proof, 'narrow-desktop.png') });
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan', slimeDensity: 'none' }))).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  expect(await page.evaluate(() => (window.game as any).session.world.cameras.length)).toBe(1);
  await expect(page.locator('.player-hud[data-player="2"]')).toBeHidden();
  await expect(page.locator('.race-viewport')).toHaveCount(1);
});

for (const device of ['Pixel 7', 'iPad Pro 11']) test(`${device} refuses direct split entry`, async ({ browser }) => {
  const context = await browser.newContext({ ...devices[device]! });
  try {
    const page = await context.newPage(); await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
    expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
      slimeDensity: 'none', playerVehicles: ['micro-hatch', 'pickup-travel-trailer'] }))).toBe(true);
    expect(await page.evaluate(() => ({ cars: window.game.report().players.length,
      cameras: (window.game as any).session.world.cameras.length }))).toEqual({ cars: 1, cameras: 1 });
  } finally { await context.close(); }
});

test('night views keep both headlights and distant viewpoints', async ({ page }) => {
  mkdirSync(proof, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  // bayshore-101 (a 64.8 km highway) was deleted along with the long-highway feature; this test
  // only ever needed "some long distance to place two cars far apart", so new-york (3273 m,
  // also a night track) stands in as the longest available route.
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'new-york', car: 'sedan',
    timeOfDay: 'night', slimeDensity: 'none', playerVehicles: ['micro-hatch', 'pickup-travel-trailer'] }))).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await page.evaluate(() => {
    const s = window.game.session, racer = s.racers[1]!;
    // 8000 m does not fit new-york's 3273 m spline. Measured directly from
    // game/public/tracks/new-york/track.json: the point at arc-length 2500 m sits ~1218 m in a
    // straight line from the start position (start [-95.14, ..., -166.35] vs the point at
    // 2500 m, [769.43, 11.03, -1024.64]) -- comfortably over the >1000 m separation this test
    // checks for below, with margin for racer[0] creeping forward while racer[1] is placed.
    const i = s.world.spline.indexAt(2500), p = s.world.spline.point(i), t = s.world.spline.tangent(i);
    racer.car.reset([p[0], p[1] + 1.3, p[2]], Math.atan2(t[0], t[2]));
    racer.trailer?.syncReset(); racer.race.reacquire(p[0], p[2]); racer.chase.reset();
  });
  await page.waitForFunction(() => window.game.report().players.every(p => !p.waitingForRoad));
  await page.waitForFunction(() => {
    const s = window.game.session;
    return s.world.cameras[0]!.position.distanceTo(s.world.cameras[1]!.position) > 1000;
  });
  await page.waitForFunction(() => {
    const s = window.game.session;
    return s.world.cameras.every((camera, index) => camera.position.distanceTo(s.racers[index]!.car.position) < 60)
      && s.world.streamer.stats.loading === 0;
  });
  const details = await page.evaluate(() => {
    const s = window.game.session;
    return { lights: s.world.playerHeadlights.map((light, i) => ({ on: light.on,
      distance: light.group.position.distanceTo(s.racers[i]!.mesh.position) })),
      aspects: s.world.cameras.map(c => c.aspect), tiles: s.world.streamer.stats };
  });
  expect(details.lights).toEqual([{ on: true, distance: 0 }, { on: true, distance: 0 }]);
  await page.screenshot({ path: resolve(proof, 'night-separated.png') });
  writeFileSync(resolve(proof, 'night.json'), JSON.stringify(details, null, 2));
});
