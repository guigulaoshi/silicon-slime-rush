import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectWorldLoaded } from './world';
import { VEHICLES } from '../src/vehicles/catalogue';

test.describe.configure({ timeout: 240_000 });
for (const { track, density, difficulty } of [{ track: 'synth-p2p', density: 'none', difficulty: 'relaxed' },
  { track: 'synth-p2p', density: 'none', difficulty: 'rush' },
  { track: 'synth-stops', density: 'none', difficulty: 'relaxed' }, { track: 'synth-p2p', density: 'many', difficulty: 'relaxed' }] as const)
  test(`full AI roster finishes ${track} ${density} ${difficulty} while human remains free to leave @long`, async ({ page }) => {
  const out = evidencePath('ai-driving'); mkdirSync(out, { recursive: true });
  await page.goto('/?dev=1&bot=1&speed=6'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(({ track, density, difficulty }) => window.game.startRace({ trackId: track, car: 'sedan', ai: true,
    playerVehicles: ['micro-hatch'], slimeDensity: density, aiDifficulty: difficulty }), { track, density, difficulty })).toBe(true);
  await expectWorldLoaded(page, track);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  expect(await page.evaluate(() => window.game.timeScale)).toBe(6);
  expect(await page.evaluate(() => window.game.report().players[0]!.autopilot)).toBe(false);
  await page.keyboard.press('Escape');
  const paused = await page.evaluate(() => window.game.report().players.map(p => ({ x: p.x, z: p.z, time: p.time })));
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.game.report().players.map(p => ({ x: p.x, z: p.z, time: p.time })))).toEqual(paused);
  await page.keyboard.press('Escape');
  try {
    await page.waitForFunction(() => {
      const ai = window.game.report().players.filter(p => p.role === 'ai');
      return ai.every(p => p.state === 'finished') || ai.some(p => p.time > 180);
    },
      null, { timeout: 180_000 });
  } finally {
    writeFileSync(resolve(out, `${track}-${density}-${difficulty}.json`), JSON.stringify(await page.evaluate(() => window.game.report()), null, 2));
    await page.screenshot({ path: resolve(out, `${track}-${density}-${difficulty}.png`), animations: 'disabled' });
  }
  const report = await page.evaluate(() => window.game.report());
  const ai = report.players.filter(p => p.role === 'ai');
  expect(ai).toHaveLength(VEHICLES.length - 1); expect(ai.every(p => p.state === 'finished')).toBe(true);
  if (density === 'many') expect(ai.reduce((total, p) => total + p.score, 0)).toBeGreaterThan(0);
  expect(ai.every(p => p.resets.length === 0)).toBe(true);
  expect(Math.max(...ai.map(p => p.time))).toBeLessThan(180);
  expect(report.phase).toBe('racing');
  if (track === 'synth-p2p' && density === 'none') {
    try {
      await page.waitForFunction(() => window.game.report().players.filter(p => p.role === 'ai')
        .every(p => p.parking?.stopped), null, { timeout: 60_000 });
    } finally {
      writeFileSync(resolve(out, `parking-end-${difficulty}.json`),
        JSON.stringify(await page.evaluate(() => window.game.report()), null, 2));
    }
    const parked = await page.evaluate(() => window.game.report().players.filter(p => p.role === 'ai'));
    expect(parked.map(p => p.parking!.slot).sort((a, b) => a - b))
      .toEqual(Array.from({ length: VEHICLES.length - 1 }, (_, i) => i));
    expect(parked.every(p => p.speedKmh < 1 && p.parking!.distance < 3)).toBe(true);
    for (let i = 0; i < parked.length; i++) for (let j = i + 1; j < parked.length; j++) {
      expect(Math.hypot(parked[i]!.x - parked[j]!.x, parked[i]!.z - parked[j]!.z)).toBeGreaterThan(2.5);
    }
    const parkingOut = evidencePath('ai-difficulty'); mkdirSync(parkingOut, { recursive: true });
    writeFileSync(resolve(parkingOut, `parked-roster-${difficulty}.json`), JSON.stringify({ track, difficulty, players: parked }, null, 2));
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const s = window.game.session;
      const cars = s.racers.filter(r => r.role === 'ai').map(r => r.mesh.position);
      const sum = cars.reduce((total, p) => ({ x: total.x + p.x, y: total.y + p.y, z: total.z + p.z }),
        { x: 0, y: 0, z: 0 });
      const centre = { x: sum.x / cars.length, y: sum.y / cars.length, z: sum.z / cars.length };
      s.world.camera.position.set(centre.x + 14, centre.y + 8, centre.z + 14);
      s.world.camera.lookAt(centre.x, centre.y, centre.z); s.world.renderer.render(s.world.scene, s.world.camera);
      document.querySelector<HTMLElement>('#ui')!.hidden = true;
    });
    await page.locator('#app canvas').screenshot({ path: resolve(parkingOut, `parked-roster-${difficulty}.png`), animations: 'disabled' });
  }
  await page.evaluate(() => (window.game as any).quit());
  expect(await page.evaluate(() => window.game.report().phase)).toBe('menu');
});

for (const vehicle of ['sports-car', 'pickup-travel-trailer']) test(`${vehicle} backs away from a close parked human then passes without rescue @long`, async ({ page }) => {
  const out = evidencePath('ai-driving'); mkdirSync(out, { recursive: true });
  await page.goto('/?dev=1&bot=1&speed=3'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan', ai: true, aiDifficulty: 'rush',
    playerVehicles: ['micro-hatch'], slimeDensity: 'none' }))).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  const setup = await page.evaluate(vehicle => {
    const s = window.game.session;
    const target = s.racers.find(r => r.vehicle.id === vehicle)!;
    const human = s.humans[0]!;
    const place = (r: typeof target, distance: number) => {
      const i = s.world.spline.indexAt(distance), p = s.world.spline.point(i), t = s.world.spline.tangent(i);
      r.car.reset([p[0], p[1] + 1, p[2]], Math.atan2(-t[0], -t[2])); r.trailer?.syncReset();
      r.race.reacquire(p[0], p[2]); r.bot.reset(); r.resetLog.length = 0;
    };
    for (const [i, r] of s.racers.entries()) {
      if (r === target || r === human) continue;
      place(r, 600 + i * 20); r.race.state = 'finished';
    }
    place(target, 100);
    const ahead = 100 + target.car.tuning.chassisHalf[2] + human.car.tuning.chassisHalf[2] + 2;
    place(human, ahead); human.race.state = 'finished';
    // A finished player's parked car is a real persistent blocker, without wedged auto-rescue.
    const samples: Record<string, number>[] = [];
    const sample = () => {
      if (window.game.session !== s) return;
      samples.push({ s: target.race.progress.value.s, lateral: target.race.progress.value.lateral, speed: target.car.forwardSpeed,
        offset: (target.bot as any).avoidOffset, reversing: (target.bot as any).reversing, limit: (target.bot as any).limit,
        halfWidth: target.trafficBodies()[0]!.halfWidth });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample); (window as any).trafficSamples = samples;
    return { ahead: human.race.progress.value.s, id: target.id };
  }, vehicle);
  try {
    await page.waitForFunction(({ ahead, id }) => {
      const target = window.game.session.racers.find(r => r.id === id)!;
      return target.race.progress.value.s > ahead + 15;
    }, setup, { timeout: 45_000 });
  } finally {
    writeFileSync(resolve(out, `blocked-${vehicle}.json`), JSON.stringify(await page.evaluate(() => ({
      report: window.game.report(), samples: (window as any).trafficSamples,
      bodies: window.game.session.racers.flatMap(r => r.trafficBodies()),
      plans: window.game.session.racers.map(r => ({ id: r.id, offset: (r.bot as any).avoidOffset, reverse: (r.bot as any).reversing })) })), null, 2));
  }
  const result = await page.evaluate(id => ({ player: window.game.report().players.find(r => r.id === id),
    minimum: Math.min(...(window as any).trafficSamples.map((s: { speed: number }) => s.speed)) }), setup.id);
  expect(result.minimum).toBeLessThan(-.5); expect(result.player!.resets).toHaveLength(0);
  // Three clean single-browser runs of the current sports-car manoeuvre take 45.7-46.0 simulated
  // seconds. Fifty still catches a stalled pass while allowing the calibrated drivetrain to turn.
  expect(result.player!.time).toBeLessThan(50);
  await page.screenshot({ path: resolve(out, `blocked-${vehicle}.png`), animations: 'disabled' });
});

test('an AI off-road rescue records its own cause without resetting another driver', async ({ page }) => {
  await page.goto('/?dev=1&bot=1&speed=3'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan', ai: true, aiDifficulty: 'rush',
    playerVehicles: ['micro-hatch'], slimeDensity: 'none' }))).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  const before = await page.evaluate(() => {
    const s = window.game.session, target = s.racers.find(r => r.vehicle.id === 'jeep')!;
    const i = s.world.spline.indexAt(100), p = s.world.spline.point(i), right = s.world.spline.right(i);
    target.car.reset([p[0] + right[0] * 30, p[1] + 1, p[2] + right[2] * 30], target.spawn.yaw);
    target.race.reacquire(target.car.position.x, target.car.position.z);
    return { id: target.id, revision: target.car.poseRevision, humanRevision: s.humans[0]!.car.poseRevision };
  });
  await page.waitForFunction(({ id, revision }) => window.game.session.racers.find(r => r.id === id)!.car.poseRevision > revision, before);
  const result = await page.evaluate(() => ({ report: window.game.report(),
    humanRevision: window.game.session.humans[0]!.car.poseRevision }));
  const target = result.report.players.find(r => r.id === before.id)!;
  expect(target.resets).toHaveLength(1);
  expect(target.resets[0]!.reason).toBe('off-track');
  expect(Math.abs(target.resets[0]!.lateral!)).toBeGreaterThan(20);
  expect(result.humanRevision).toBe(before.humanRevision);
  expect(result.report.players.filter(r => r.id !== before.id).every(r => r.resets.length === 0)).toBe(true);
  const out = evidencePath('ai-driving'); mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'independent-ai-rescue.json'), JSON.stringify({ before, result }, null, 2));
});
