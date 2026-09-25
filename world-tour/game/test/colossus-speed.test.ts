import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from '../e2e/evidence';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Car, NO_INPUT } from '../src/physics/Car';
import { defaultVehicle, vehicleFor, vehicleTuning, type VehicleDefinition } from '../src/vehicles/catalogue';
import { SlimeLayer, colossusSpeedLimit, type SlimeSpawn } from '../src/world/Slimes';
import { slimeScale, slimeGroundFraction } from '../src/world/slimeShape';
import { Spline } from '../src/track/Spline';
import type { CarKind, TrackData } from '../src/track/types';
import { QUALITY_LIMITS } from '../src/world/quality';

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); });

const scale = slimeScale('colossus', .35);
const spawn: SlimeSpawn = { kind: 'colossus', s: 90, position: [90, scale[1] * slimeGroundFraction('colossus'), 0], scale, yaw: 0 };
const ENTRY = 16;

function crossAtFullThrottle(vehicle: VehicleDefinition) {
  const physics = new PhysicsWorld(api);
  const floor = physics.world.createCollider(api.ColliderDesc.cuboid(600, .1, 600).setTranslation(0, -.1, 0));
  physics.registerCollider(floor, 'ground');
  const spline = new Spline({ spline: { points: Array.from({ length: 151 }, (_, i) => [i * 2, 0, 0]),
    halfWidth: Array(151).fill(12), closed: false, length: 300 } } as TrackData);
  const layer = new SlimeLayer(new THREE.Scene(), physics, spline, document.createElement('div'), QUALITY_LIMITS.low, [spawn]);
  const car = new Car(physics, vehicleTuning(vehicle, vehicle.tuning as CarKind), { pos: [20, 1.6, 0], yaw: -Math.PI / 2 });
  const step = (throttle: number) => physics.step(1 / 60, h => {
    const input = { ...NO_INPUT, throttle };
    layer.prepareCar(car); car.update(h, input); layer.handleCar(car, input);
  }, 5, () => layer.finishPhysicsStep());
  for (let i = 0; i < 90; i++) { step(0); layer.update(1 / 60); }
  car.body.setLinvel({ x: ENTRY, y: 0, z: 0 }, true);
  const horizontal = () => Math.hypot(car.body.linvel().x, car.body.linvel().z);
  let before = 0; let inside = 0; let insideSettled: number[] = []; let transitTime = 0;
  let exitSpeed = 0; let exitStep = -1;
  for (let i = 0; i < 2400; i++) {
    const wasInside = layer.driverStats(car).colossusTransit;
    if (!wasInside && layer.stats.colossusEntries === 0) before = horizontal();
    step(1); layer.update(1 / 60);
    if (layer.driverStats(car).colossusTransit) {
      transitTime += 1 / 60; inside = Math.max(inside, horizontal());
      if (transitTime >= .75) insideSettled.push(horizontal());
    }
    if (layer.stats.colossusExits > 0) { exitSpeed = horizontal(); exitStep = i; break; }
  }
  expect(layer.stats.colossusEntries, `${vehicle.id} entered`).toBe(1);
  expect(layer.stats.colossusExits, `${vehicle.id} came out`).toBe(1);
  // Full throttle after release: the road wheels take over again once the car lands.
  let landedAt = -1;
  for (let i = 0; i < 600; i++) { step(1); layer.update(1 / 60); if (car.grounded && landedAt < 0) landedAt = i; if (landedAt >= 0 && i - landedAt > 20) break; }
  const afterLanding = horizontal();
  for (let i = 0; i < 120; i++) { step(1); layer.update(1 / 60); }
  const twoSecondsLater = horizontal();
  const settledMedian = insideSettled.sort((a, b) => a - b)[Math.floor(insideSettled.length / 2)] ?? inside;
  const result = { id: vehicle.id, before, insideMax: inside, insideSettledMedian: settledMedian,
    transitSeconds: transitTime, exitSpeed, exitStep, afterLanding, twoSecondsLater };
  layer.dispose(); physics.dispose();
  return result;
}

it('never lets a giant slime speed a car up: the glue holds speed below the arrival speed', () => {
  for (const mobility of [.8, 1, 1.6]) {
    for (const entry of [6, 12, 25]) expect(colossusSpeedLimit(entry, mobility)).toBeLessThan(entry);
  }
  expect(colossusSpeedLimit(25, 1.6)).toBeGreaterThan(colossusSpeedLimit(25, .8));
});

it('slows the school bus and the default car inside the giant, then gives normal acceleration back', () => {
  const rows = [vehicleFor('school-bus')!, defaultVehicle({ car: 'sedan' })].map(crossAtFullThrottle);
  for (const row of rows) {
    expect(row.before, `${row.id} arrival`).toBeGreaterThan(ENTRY - 1.5);
    // Never faster inside than on the way in, even flat out, and clearly slower once the glue bites.
    expect(row.insideMax, JSON.stringify(row)).toBeLessThanOrEqual(row.before + .25);
    expect(row.insideSettledMedian, JSON.stringify(row)).toBeLessThan(row.before * .75);
    expect(row.twoSecondsLater, JSON.stringify(row)).toBeGreaterThan(row.afterLanding + 1);
  }
  const out = evidencePath('colossus-speed'); mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'speeds.json'), JSON.stringify({ entry: ENTRY, spawn, rows }, null, 2) + '\n');
});
