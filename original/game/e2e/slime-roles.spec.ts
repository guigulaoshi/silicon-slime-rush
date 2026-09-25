import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 180_000 });
test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } },
  viewport: { width: 1280, height: 720 } });
const OUT = evidencePath('slime-roles');

test('shows pure black bombs, deforming purple splits, red rocket exhaust and a ground-detonating airdrop', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?track=synth-p2p&bot=1&dev=1&time=day&vehicle=micro-hatch');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'slime roles');
  await page.evaluate(() => window.game.audio.unlock());
  await page.waitForFunction(() => (window.game.audio as any).ctx?.state === 'running');

  const palette = await page.evaluate(() => {
    const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
    g.autopilot = false; g.phase = 'paused'; layer.fallingLimit = 0;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    for (const falling of [...layer.falling]) layer.removeFalling(falling);
    const at = spline.indexAt(45), p = spline.point(at), t = spline.tangent(at), r = spline.right(at);
    const roles = [
      { kind: 'burst', radius: 2.5, offset: -4.2 },
      { kind: 'slick', radius: 1.75, offset: 0 },
      { kind: 'boost', radius: 2.5, offset: 4.2 },
    ];
    layer.addTile('roles', roles.map(role => ({ kind: role.kind,
      position: [p[0] + r[0] * role.offset, p[1] + role.radius * .82, p[2] + r[2] * role.offset],
      scale: [role.radius, role.radius * .82, role.radius], yaw: 0 })));
    const racer = s.racers[0];
    g.__originalChase283 = racer.chase.update.bind(racer.chase);
    racer.chase.update = (camera: any) => {
      camera.position.set(p[0] - t[0] * 14, p[1] + 6.5, p[2] - t[2] * 14);
      camera.lookAt(p[0], p[1] + 1.1, p[2]); camera.fov = 48; camera.updateProjectionMatrix();
    };
    const colours = layer.mesh.instanceColor;
    return Object.fromEntries(layer.lives.map((live: any) => [live.spawn.kind,
      [colours.getX(live.index), colours.getY(live.index), colours.getZ(live.index)]]));
  });
  expect(palette.burst[0]).toBeLessThan(.01);
  expect(palette.slick[0]).toBeGreaterThan(.25);
  expect(palette.slick[2]).toBeGreaterThan(palette.slick[0]);
  expect(palette.boost[0]).toBeGreaterThan(.8);
  expect(await page.evaluate(() => !(window.game as any).session.slimes.material.fragmentShader
    .includes('vec3(0.44, 0.008, 0.014)'))).toBe(true);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(OUT, '01-black-purple-red-roles.png') });

  const beforeBounce = await page.evaluate(() => {
    const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
    s.racers[0].chase.update = g.__originalChase283; g.phase = 'racing';
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const at = spline.indexAt(35), p = spline.point(at), t = spline.tangent(at);
    const start: [number, number, number] = [p[0] - t[0] * 5, p[1] + 1.75 * .82 - .8, p[2] - t[2] * 5];
    s.car.reset([start[0], start[1] + .8, start[2]], Math.atan2(-t[0], -t[2]));
    s.car.body.setLinvel({ x: t[0] * 14, y: 0, z: t[2] * 14 }, true);
    layer.addTile('purple-impact', [{ kind: 'slick', position: [p[0], p[1] + 1.75 * .82, p[2]],
      scale: [1.75, 1.75 * .82, 1.75], yaw: 0 }]);
    return { hits: layer.stats.bounceHits, direction: [t[0], t[2]],
      sounds: g.audio.slimeSoundPhaseCounts.slick.impact };
  });
  await page.waitForFunction(({ hits }) => (window.game as any).session.slimes.stats.bounceHits > hits,
    beforeBounce, { timeout: 15_000, polling: 'raf' });
  const impact = await page.evaluate(() => {
    const g = window.game as any, layer = g.session.slimes;
    return { stats: layer.stats, sound: g.audio.slimeSoundPhaseCounts.slick.impact };
  });
  expect(impact.stats.elasticDeforming).toBe(1);
  expect(impact.stats.elasticPeak).toBeGreaterThan(.2);
  expect(impact.sound).toBeGreaterThan(beforeBounce.sounds);
  await page.screenshot({ path: resolve(OUT, '02-purple-elastic-impact.png') });
  await page.waitForFunction(() => (window.game as any).session.slimes.stats.splitEvents > 0,
    undefined, { timeout: 3_000, polling: 'raf' });
  const splitPurple = await page.evaluate(() => {
    const layer = (window.game as any).session.slimes;
    return { stats: layer.stats, children: layer.lives.filter((live: any) => live.key.startsWith('split:'))
      .map((live: any) => ({ scale: live.spawn.scale, velocity: live.motion?.body.linvel() })) };
  });
  expect(splitPurple.stats.splitChildren).toBeGreaterThanOrEqual(2);
  expect(splitPurple.children.every((child: any) =>
    child.velocity.x * beforeBounce.direction[0] + child.velocity.z * beforeBounce.direction[1] > 0))
    .toBe(true);
  await page.screenshot({ path: resolve(OUT, '03-purple-split-children.png') });

  await page.evaluate(() => {
    const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const at = spline.indexAt(42), p = spline.point(at), t = spline.tangent(at);
    const start = spline.point(spline.indexAt(30));
    s.car.reset([start[0], start[1] + .8, start[2]], Math.atan2(-t[0], -t[2]));
    s.car.body.setLinvel({ x: t[0] * 12, y: 0, z: t[2] * 12 }, true);
    layer.addTile('red-rocket', [{ kind: 'boost', position: [p[0], p[1] + 1.8, p[2]],
      scale: [2.2, 1.8, 2.2], yaw: 0 }]);
  });
  await page.waitForFunction(() => (window.game as any).session.slimes.stats.boostActive,
    undefined, { timeout: 15_000, polling: 'raf' });
  await page.evaluate(() => {
    const s = (window.game as any).session, layer = s.slimes;
    layer.driver(s.car).boostUntil = layer.clock + 2;
  });
  await page.waitForTimeout(180);
  const rocket = await page.evaluate(() => {
    const g = window.game as any, s = g.session;
    return { stats: s.slimes.stats,
      opacity: getComputedStyle(document.querySelector('.camera-feedback') as HTMLElement).opacity,
      variable: (document.querySelector('.camera-feedback') as HTMLElement).style
        .getPropertyValue('--camera-feedback-opacity') };
  });
  expect(rocket.stats.boostActive).toBe(true);
  expect(Number(rocket.variable)).toBeGreaterThan(.1);
  await page.screenshot({ path: resolve(OUT, '04-red-rocket-tail-and-lines.png') });

  await page.evaluate(() => {
    const g = window.game as any, layer = g.session.slimes;
    layer.driver(g.session.car).boostUntil = layer.clock;
  });
  await page.waitForFunction(() => Number((document.querySelector('.camera-feedback') as HTMLElement).style
    .getPropertyValue('--camera-feedback-opacity')) < .05, undefined, { timeout: 2_000, polling: 'raf' });
  expect(Number(await page.locator('.camera-feedback').evaluate(node =>
    (node as HTMLElement).style.getPropertyValue('--camera-feedback-opacity')))).toBeLessThan(.05);

  await page.evaluate(() => {
    const g = window.game as any, s = g.session, layer = s.slimes;
    // Ordinary drops fell while the page was waiting for audio; count only what this bomb does.
    g.__survivorsBefore283 = layer.stats.fallingSurvivors;
    layer.fallingLimit = 1; layer.fallingSerial = 5; layer.fallingClock = 0; layer.update(.01);
    const drop = layer.falling[0];
    drop.motion.body.setTranslation({ x: drop.landing.x, y: drop.landing.y + 3, z: drop.landing.z }, true);
    drop.motion.body.setLinvel({ x: 0, y: -12, z: 0 }, true);
    s.car.reset([drop.landing.x - 15, drop.landing.y + .8, drop.landing.z], -Math.PI / 2);
    const camera = s.world.camera;
    s.racers[0].chase.update = () => {
      camera.position.set(drop.landing.x - 13, drop.landing.y + 6, drop.landing.z + 10);
      camera.lookAt(drop.landing.x, drop.landing.y + 2, drop.landing.z);
      camera.fov = 52; camera.updateProjectionMatrix();
    };
  });
  await page.waitForFunction(() => (window.game as any).session.slimes.stats.fallingExplosions > 0,
    undefined, { timeout: 10_000, polling: 'raf' });
  const final = await page.evaluate(() => {
    const g = window.game as any;
    return { slimes: g.session.slimes.stats, survivorsBefore: g.__survivorsBefore283, sounds: g.audio.slimeSoundPhaseCounts };
  });
  expect(final.slimes.fallingSurvivors - final.survivorsBefore).toBe(0);
  expect(final.sounds.burst.impact).toBeGreaterThan(0);
  await page.screenshot({ path: resolve(OUT, '05-black-airdrop-ground-explosion.png') });

  await page.reload(); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
    slimeDensity: 'normal', playerVehicles: ['micro-hatch', 'sports-car'], ai: false }))).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expectWorldLoaded(page, 'split rocket feedback');
  await page.evaluate(() => {
    const s = window.game.session as any, layer = s.slimes, spline = s.world.spline;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const a = spline.indexAt(20), b = spline.indexAt(90), hit = spline.indexAt(34);
    const pa = spline.point(a), pb = spline.point(b), ph = spline.point(hit), t = spline.tangent(a);
    s.racers[0].car.reset([pa[0], pa[1] + .8, pa[2]], Math.atan2(-t[0], -t[2]));
    s.racers[1].car.reset([pb[0], pb[1] + .8, pb[2]], Math.atan2(-t[0], -t[2]));
    s.racers[0].car.body.setLinvel({ x: t[0] * 12, y: 0, z: t[2] * 12 }, true);
    s.racers[1].car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    layer.addTile('split-red-rocket', [{ kind: 'boost', position: [ph[0], ph[1] + 1.8, ph[2]],
      scale: [2.2, 1.8, 2.2], yaw: 0 }]);
  });
  await page.waitForFunction(() => {
    const s = (window.game as any).session;
    return s.slimes.driverStats(s.racers[0].car).boostActive;
  }, undefined, { timeout: 15_000, polling: 'raf' });
  const split = await page.evaluate(() => {
    const s = (window.game as any).session;
    return { active: s.racers.slice(0, 2).map((racer: any) => s.slimes.driverStats(racer.car).boostActive),
      lines: [...document.querySelectorAll<HTMLElement>('.camera-feedback')]
        .map(node => Number(node.style.getPropertyValue('--camera-feedback-opacity'))) };
  });
  expect(split.active).toEqual([true, false]);
  expect(split.lines[0]).toBeGreaterThan(0);
  expect(split.lines[1]).toBe(0);
  await page.screenshot({ path: resolve(OUT, '06-split-independent-rocket.png') });
  writeFileSync(resolve(OUT, 'slime-roles.json'), JSON.stringify({ palette, impact, splitPurple,
    rocket, final, split }, null, 2));

  const video = page.video();
  await page.close();
  if (video) await video.saveAs(resolve(OUT, 'slime-roles-drive.webm'));
});
