import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Car, NO_INPUT } from '../src/physics/Car';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { Spline, buildSafetyNet } from '../src/track/Spline';
import { parseTrack } from '../src/track/schema';
import { VEHICLES, vehicleTuning } from '../src/vehicles/catalogue';
import type { CarKind } from '../src/track/types';

// the player set these top speeds and asked for power to be raised until each car really
// reaches its own on a Bayshore 101 straight at full throttle. Gravity stays at the game's 19.6.
const TARGET_MPH: Record<string, number> = {
  'city-pod': 90, 'sports-car': 220, 'lightweight-sports': 180, jeep: 112, 'school-bus': 80,
};
const MPH = 2.23694;
/** Lateral acceleration a car may hold at full throttle without the straight counting as a bend. */
const STRAIGHT_LATERAL = 6;

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); }, 60_000);

const path = resolve(process.cwd(), 'public/tracks/bayshore-101/track.json');
const track = existsSync(path) ? parseTrack(JSON.parse(readFileSync(path, 'utf-8'))) : null;

/** Longest run of Bayshore 101 gentle enough to hold `speed` flat out, as [start, end] sample indices. */
function longestStraight(spline: Spline, speed: number): [number, number] {
  const limit = STRAIGHT_LATERAL / speed / speed;
  let best: [number, number] = [0, 0], start = 0;
  for (let i = 0; i < spline.count; i++) {
    if (Math.abs(spline.curvature[i] ?? 0) > limit) start = i + 1;
    else if (spline.s[i]! - spline.s[start]! > spline.s[best[1]]! - spline.s[best[0]]!) best = [start, i];
  }
  return best;
}

/** From rest at the start of that straight: full throttle, pure-pursuit steering, peak speed in mph. */
function flatOut(id: string): { peak: number; metres: number } {
  const spline = new Spline(track!);
  const vehicle = VEHICLES.find(v => v.id === id)!;
  const tuning = vehicleTuning(vehicle, vehicle.tuning as CarKind);
  const [first, last] = longestStraight(spline, TARGET_MPH[id]! / MPH);
  const physics = new PhysicsWorld(api, tuning.gravity);
  physics.add('net', { trimeshes: [buildSafetyNet(spline, undefined, 10)], boxes: [] });
  const p = spline.point(first), q = spline.point(first + 2);
  const car = new Car(physics, tuning, { pos: [p[0], p[1] + 1.5, p[2]], yaw: Math.atan2(-(q[0] - p[0]), -(q[2] - p[2])) });
  let index = first, peak = 0;
  for (let step = 0; step < 60 * 400 && index < last; step++) {
    const x = car.position.x, z = car.position.z;
    while (index < spline.count - 1) {
      const a = spline.point(index), b = spline.point(index + 1);
      if (Math.hypot(b[0] - x, b[2] - z) > Math.hypot(a[0] - x, a[2] - z)) break;
      index++;
    }
    const aim = spline.indexAt(spline.s[index]! + Math.max(20, car.speed));
    const t = spline.point(aim), qn = car.quaternion;
    const hx = -2 * (qn.x * qn.z + qn.w * qn.y), hz = -(1 - 2 * (qn.x * qn.x + qn.y * qn.y));
    const dx = t[0] - x, dz = t[2] - z, len = Math.hypot(dx, dz) || 1;
    const lateral = (dx * -hz + dz * hx) / len;
    car.update(1 / 60, { ...NO_INPUT, throttle: 1, steer: car.steeringInputForCurvature(2 * lateral / len) });
    physics.world.step();
    peak = Math.max(peak, car.forwardSpeed * MPH);
  }
  physics.dispose();
  return { peak, metres: spline.s[last]! - spline.s[first]! };
}

describe('user top speeds are reachable on a Bayshore 101 straight', () => {
  for (const id of Object.keys(TARGET_MPH)) it.skipIf(!track)(`${id} reaches ${TARGET_MPH[id]} mph`, () => {
    const { peak, metres } = flatOut(id);
    expect(peak, `${id} peak over ${metres.toFixed(0)} m`).toBeGreaterThan(TARGET_MPH[id]! - 1);
    expect(peak, `${id} holds its cap`).toBeLessThan(TARGET_MPH[id]! + 1);
  }, 120_000);
});
