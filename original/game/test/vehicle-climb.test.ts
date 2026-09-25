import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Car, NO_INPUT } from '../src/physics/Car';
import { Trailer } from '../src/physics/Trailer';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { BUILT } from '../src/app/tracks';
import { VEHICLES, vehicleTuning, type VehicleDefinition } from '../src/vehicles/catalogue';
import type { CarKind } from '../src/track/types';

// The school bus, the retro van and the trailer rig could not pull away up Lombard's 15%
// in clear weather -- in this game's doubled gravity their low-speed wheel force was barely more than
// the slope's pull. Every vehicle must start from rest on the steepest built climb, with margin, and
// still reach a real road speed on the flat. (Snow is allowed to beat the big ones.)
const MARGIN = 1.2;
const MIN_CLIMB_MPH = 10;
const MIN_FLAT_MPH = 60;
const MPH = 2.23694;

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); }, 60_000);

/** Steepest rise over 50 m of centreline on any built route, either direction. */
function steepestBuiltGrade(): number {
  let steepest = .15;
  for (const id of BUILT) {
    const path = resolve('public/tracks', id, 'track.json');
    if (!existsSync(path)) continue;
    const points = (JSON.parse(readFileSync(path, 'utf8')) as { spline: { points: number[][] } }).spline.points;
    const along = [0];
    for (let i = 1; i < points.length; i++) {
      along.push(along[i - 1]! + Math.hypot(points[i]![0]! - points[i - 1]![0]!, points[i]![2]! - points[i - 1]![2]!));
    }
    for (let i = 0, j = 0; i < points.length; i++) {
      while (j < points.length - 1 && along[j]! - along[i]! < 50) j++;
      if (along[j]! - along[i]! >= 40) {
        steepest = Math.max(steepest, Math.abs(points[j]![1]! - points[i]![1]!) / (along[j]! - along[i]!));
      }
    }
  }
  return steepest;
}

/** Full throttle -- or held reverse -- from rest for `seconds` on a clear-weather ramp rising towards -z.
 *  Returns the road speed at the end and how far up the ramp the car went. */
function launch(vehicle: VehicleDefinition, grade: number, seconds: number,
  how: { reverse?: boolean; noseDown?: boolean; start?: number } = {}): number {
  return ramp(vehicle, grade, seconds, how).mph;
}
function ramp(vehicle: VehicleDefinition, grade: number, seconds: number,
  how: { reverse?: boolean; noseDown?: boolean; start?: number } = {}) {
  const tuning = vehicleTuning(vehicle, vehicle.tuning as CarKind);
  const physics = new PhysicsWorld(api, tuning.gravity);
  const length = 3000, width = 60, rise = length * grade;
  physics.add('ground', { trimeshes: [{
    vertices: new Float32Array([-width, 0, 200, width, 0, 200, width, 0, 20, -width, 0, 20,
      width, rise, -length, -width, rise, -length]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 3, 2, 4, 3, 4, 5]),
  }], boxes: [] });
  /* */
  const z = how.start ?? 20 + vehicle.size[2]! / 2 + .5;
  const car = new Car(physics, tuning, { pos: [0, (how.start === undefined ? 0 : (20 - z) * grade) + 1.5, z], yaw: how.noseDown ? Math.PI : 0 });
  const trailer = vehicle.trailer ? new Trailer(physics, car, vehicle) : null;
  const step = (frames: number, input: Partial<typeof NO_INPUT>) => {
    for (let i = 0; i < frames; i++) {
      car.update(1 / 60, { ...NO_INPUT, ...input }); trailer?.update(1 / 60); physics.world.step();
    }
  };
  // Held on the hill by the parking brake before a reverse, as a stopped player would be.
  step(60, how.reverse ? { parkingBrake: true, brake: 1 } : {});
  const from = car.position.z;
  step(seconds * 60, how.reverse ? { brake: 1 } : { throttle: 1 });
  const result = { mph: car.speed * MPH, forwardMph: car.forwardSpeed * MPH, uphill: from - car.position.z };
  physics.dispose();
  return result;
}

describe('every vehicle climbs the steepest built road', () => {
  const grade = steepestBuiltGrade() * MARGIN;
  for (const vehicle of VEHICLES) it(`${vehicle.id} pulls away up ${(grade * 100).toFixed(0)}% and reaches road speed on the flat`, () => {
    expect(launch(vehicle, grade, 12), `${vehicle.id} up ${(grade * 100).toFixed(0)}%`).toBeGreaterThan(MIN_CLIMB_MPH);
    expect(launch(vehicle, 0, 40), `${vehicle.id} on the flat`).toBeGreaterThan(MIN_FLAT_MPH);
  }, 60_000);

  // Reverse is how a car gets off a rail, and on a hill that can mean backing up it. It used
  // to be one fixed 7000 N for every body, which left the bus, the monster truck and the trailer rig
  // rolling downhill with reverse held; and backing down the same hill ran every car past 45 mph.
  for (const vehicle of VEHICLES) it(`${vehicle.id} backs up the ${(grade * 100).toFixed(0)}% climb nose-down, and backs down a hill no faster than its reverse limit`, () => {
    const up = ramp(vehicle, grade, 8, { reverse: true, noseDown: true, start: -60 });
    expect(up.uphill, `${vehicle.id}: metres reversed up ${(grade * 100).toFixed(0)}%`).toBeGreaterThan(5);
    const tuning = vehicleTuning(vehicle, vehicle.tuning as CarKind);
    const down = ramp(vehicle, grade / MARGIN, 8, { reverse: true, start: -60 });
    expect(down.forwardMph, `${vehicle.id}: backing down the hill`).toBeGreaterThan(-(tuning.maxReverseSpeed + 1) * MPH);
  }, 60_000);
});

/** Stopped on a plane rising towards -z, facing `yaw`, pedals off, `grip` weather: metres the car moves
 *  over the ground in `seconds` once the springs have settled. */
function parkedOnHill(vehicle: VehicleDefinition, grade: number, grip: number, seconds: number, yaw: number): number {
  const tuning = vehicleTuning(vehicle, vehicle.tuning as CarKind);
  const physics = new PhysicsWorld(api, tuning.gravity);
  const size = 400;
  physics.add('ground', { trimeshes: [{
    vertices: new Float32Array([-size, size * grade, -size, size, size * grade, -size,
      size, -size * grade, size, -size, -size * grade, size]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
  }], boxes: [] });
  const car = new Car(physics, tuning, { pos: [0, 1.5, 0], yaw });
  const trailer = vehicle.trailer ? new Trailer(physics, car, vehicle) : null;
  car.setWeatherGrip(grip);
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) { car.update(1 / 60, NO_INPUT); trailer?.update(1 / 60); physics.world.step(); }
  };
  step(90);
  const from = car.position.clone();
  step(seconds * 60);
  const moved = Math.hypot(car.position.x - from.x, car.position.z - from.z);
  physics.dispose();
  return moved;
}

//
// Lateral grip answered sideways speed only, so every body crept 0.5-0.75 m/s down across this grade
// without end -- the school bus 4.5 m in six seconds -- and a car stopped a few degrees off square rolled
// along its nose until the sideways hold let go. Dry rubber at rest, in gear, does neither.
describe('a vehicle stopped on the steepest built road stays put in clear weather', () => {
  const grade = steepestBuiltGrade() * MARGIN;
  const facings: [string, number][] = [['across', Math.PI / 2], ['10° off square', Math.PI / 2 - .17],
    ['nose uphill', 0], ['nose downhill', Math.PI]];
  for (const vehicle of VEHICLES) it(`${vehicle.id} on ${(grade * 100).toFixed(0)}%`, () => {
    for (const [facing, yaw] of facings) {
      expect(parkedOnHill(vehicle, grade, 1, 6, yaw), `${vehicle.id} ${facing}: metres moved in 6 s`).toBeLessThan(.05);
    }
  }, 60_000);
});
