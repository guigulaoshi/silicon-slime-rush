import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test.describe.configure({ timeout: 180_000 });

test('two drivers steer separately, clear held keys, and accept independent bots and rescue', async ({ page }) => {
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan', slimeDensity: 'none',
    playerVehicles: ['micro-hatch', 'micro-hatch'] }))).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await page.keyboard.down('w'); await page.keyboard.down('ArrowUp');
  await page.keyboard.down('a'); await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => {
    const [a, b] = window.game.report().players;
    return a!.input.throttle === 1 && b!.input.throttle === 1 && a!.input.steer < -.1 && b!.input.steer > .1;
  });
  for (const key of ['w', 'ArrowUp', 'a', 'ArrowRight']) await page.keyboard.up(key);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.game.report().phase === 'paused');
  await page.keyboard.down('w'); await page.keyboard.down('ArrowUp');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  expect(await page.evaluate(() => window.game.report().players.map(player => player.input.throttle))).toEqual([0, 0]);
  await page.keyboard.up('w'); await page.keyboard.up('ArrowUp');
  await page.keyboard.down('w'); await page.keyboard.down('ArrowUp');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => window.game.report().players.every(player => player.input.throttle === 0));
  await page.keyboard.up('w'); await page.keyboard.up('ArrowUp');
  // The starting road has a small passive roll: compare the same elapsed simulation with no reset.
  await page.evaluate(() => { const g = window.game as any; g.show('paused'); g.restart(); });
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  const controlStart = await page.evaluate(() => ({ x: window.game.session.car.position.x,
    z: window.game.session.car.position.z, time: window.game.report().time }));
  await page.waitForFunction(time => window.game.report().time > time + 1, controlStart.time);
  const passive = await page.evaluate(start => ({ x: window.game.session.car.position.x - start.x,
    z: window.game.session.car.position.z - start.z }), controlStart);
  await page.evaluate(() => { const g = window.game as any; g.show('paused'); g.restart(); });
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  const parked = await page.evaluate(() => ({ x: window.game.session.car.position.x, z: window.game.session.car.position.z, time: window.game.report().time }));
  const beforeReset = await page.evaluate(() => window.game.session.racers.map(racer => racer.car.poseRevision));
  await page.keyboard.press('/');
  await page.waitForFunction(before => window.game.session.racers[1]!.car.poseRevision > before[1]!, beforeReset);
  expect(await page.evaluate(() => window.game.session.racers[0]!.car.poseRevision)).toBe(beforeReset[0]);
  await page.waitForFunction(time => window.game.report().time > time + 1, parked.time);
  const afterReset = await page.evaluate(parked => ({ x: window.game.session.car.position.x - parked.x,
    z: window.game.session.car.position.z - parked.z }), parked);
  console.log('stationary driver drift without/with other rescue', { passive, afterReset });
  expect(Math.hypot(afterReset.x - passive.x, afterReset.z - passive.z)).toBeLessThan(.05);
  for (const bot of [1, 0]) {
    await page.evaluate(index => { window.game.setAutopilot(index, true); window.game.setAutopilot(1 - index, false); }, bot);
    const humanKey = bot === 1 ? 'w' : 'ArrowUp';
    await page.keyboard.down(humanKey);
    const start = await page.evaluate(() => window.game.report().players.map(player => ({ x: player.x, z: player.z })));
    await page.waitForFunction(({ start, bot }) => {
      const players = window.game.report().players;
      return players.every((player, i) => Math.hypot(player.x - start[i]!.x, player.z - start[i]!.z) > 2)
        && players[bot]!.autopilot && !players[1 - bot]!.autopilot;
    }, { start, bot });
    await page.keyboard.up(humanKey);
  }
  await page.evaluate(() => { window.game.setAutopilot(0, true); window.game.setAutopilot(1, true); });
  await page.waitForFunction(() => window.game.report().players.every(player => player.autopilot && player.speedKmh > 5));
  const out = evidencePath('dual-input'); mkdirSync(out, { recursive: true });
  await page.screenshot({ path: resolve(out, 'independent-drivers.png') });
});
