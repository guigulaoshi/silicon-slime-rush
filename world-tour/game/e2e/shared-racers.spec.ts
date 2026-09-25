import { evidencePath } from './evidence';
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test.describe.configure({ timeout: 180_000 });

test('shared two-rig session restarts, cancels failed replacement and returns to single player', async ({ page }) => {
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  const choice = { trackId: 'synth-p2p', car: 'sedan' as const, slimeDensity: 'none' as const,
    playerVehicles: ['pickup-travel-trailer', 'pickup-travel-trailer'] };
  expect(await page.evaluate(choice => window.game.startRace(choice), choice)).toBe(true);
  const facts = await page.evaluate(() => {
    const game = window.game as any, s = game.session;
    const count = s.physics.world.bodies.len();
    const owners = s.racers.map((r: any) => ({ id: r.id, vehicle: r.vehicle.id, trailer: !!r.trailer }));
    const distance = s.racers[0].car.position.distanceTo(s.racers[1].car.position);
    for (let i = 0; i < 3; i++) { game.show('paused'); game.restart(); }
    return { owners, distance, stable: count === s.physics.world.bodies.len(),
      joints: s.physics.world.impulseJoints.len(), sceneCars: s.world.scene.children.filter((n: any) => n.name.startsWith('car-')).length };
  });
  expect(facts.owners).toEqual([1, 2].map(n => ({ id: `player-${n}`, vehicle: 'pickup-travel-trailer', trailer: true })));
  expect(facts.distance).toBeGreaterThan(10);
  expect(facts).toMatchObject({ stable: true, joints: 2, sceneCars: 4 });
  await expect(page.locator('#app > canvas')).toHaveCount(1);
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  const out = evidencePath('shared-racers'); mkdirSync(out, { recursive: true });
  await page.screenshot({ path: resolve(out, 'two-rigs.png') });
  await page.route('**/models/cars/school-bus.glb', route => route.fulfill({ status: 404, body: '' }));
  expect(await page.evaluate(choice => window.game.startRace({ ...choice,
    playerVehicles: ['pickup-travel-trailer', 'school-bus'] }), choice)).toBe(false);
  await expect(page.locator('#app > canvas')).toHaveCount(0);
  expect(await page.evaluate(choice => window.game.startRace({ ...choice, playerVehicles: undefined,
    vehicleId: 'micro-hatch' }), choice)).toBe(true);
  expect(await page.evaluate(() => ({ count: window.game.session.racers.length,
    joints: window.game.session.physics.world.impulseJoints.len(), vehicle: window.game.report().vehicle })))
    .toEqual({ count: 1, joints: 0, vehicle: 'micro-hatch' });
  await page.evaluate(() => (window.game as any).dispose());
  await expect(page.locator('#app > canvas')).toHaveCount(0);
});
