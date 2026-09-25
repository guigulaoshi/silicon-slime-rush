import { expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from '../e2e/evidence';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { Car } from '../src/physics/Car';
import { vehicleFor, vehicleTuning } from '../src/vehicles/catalogue';
// Measured 15-25 percent with the 0.6-scale sports car on a 0.48 m rail. sized it at
// 0.7 of a real coupe; its higher chassis cleared that beam more often (13 percent), so the airfield
// rail rose to 0.50 m, which restores 21 percent (38 exits to 30).
it('Moffett low rails reduce identical road exits by 15–25 percent without sealing the course', async () => {
  const api = await initPhysics();
  const mesh = JSON.parse(readFileSync('test/fixtures/moffett-rail.json', 'utf8'));
  const vehicle = vehicleFor('sports-car')!;
  const tuning = vehicleTuning(vehicle, vehicle.tuning as any);
  const rows: { rails: boolean; side: number; speed: number; degrees: number; escaped: boolean; maxX: number }[] = [];
  for (const rails of [false, true]) for (const side of [-1, 1]) for (const speed of [15, 25, 35, 45, 55]) for (const degrees of [5, 15, 30, 60]) {
    const physics = new PhysicsWorld(api, tuning.gravity);
    physics.add('ground', { boxes: [{ center: [0, -.5, 0], half: [100, .5, 500], yaw: 0 }], trimeshes: [] });
    if (rails) physics.add('rails', { boxes: [], trimeshes: [{ vertices: new Float32Array(mesh.vertices), indices: new Uint32Array(mesh.indices), role: 'wall' }] });
    const angle = degrees * Math.PI / 180;
    const car = new Car(physics, tuning, { pos: [side * 26, 1, 0], yaw: -side * angle });
    for (let i = 0; i < 120; i++) { car.update(1 / 60, { throttle: 0, steer: 0, brake: 0 }); physics.world.step(); }
    car.body.setLinvel({ x: side * Math.sin(angle) * speed, y: 0, z: -Math.cos(angle) * speed }, true);
    let maxX = side * car.position.x;
    for (let i = 0; i < 300; i++) { car.update(1 / 60, { throttle: 0, steer: 0, brake: 0 }); physics.world.step(); maxX = Math.max(maxX, side * car.position.x); }
    rows.push({ rails, side, speed, degrees, escaped: maxX > 30.8 + tuning.chassisHalf[0], maxX }); physics.dispose();
  }
  const before = rows.filter(row => !row.rails && row.escaped).length;
  const after = rows.filter(row => row.rails && row.escaped).length;
  const reduction = (before - after) / before;
  const out = evidencePath('moffett-rails'); mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'strikes.json'), JSON.stringify({ vehicle: vehicle.id, trialsPerVersion: 40,
    before, after, reduction, rows }, null, 2));
  expect(rows).toHaveLength(80);
  expect(before).toBeGreaterThan(0);
  expect(after).toBeGreaterThan(0);
  expect(reduction).toBeGreaterThanOrEqual(.15);
  expect(reduction).toBeLessThanOrEqual(.25);
});
