import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Car, NO_INPUT } from '../src/physics/Car';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { Spline, buildSafetyNet } from '../src/track/Spline';
import { VEHICLES, vehicleTuning } from '../src/vehicles/catalogue';
import type { CarKind, TrackData } from '../src/track/types';

// the player set these top speeds and asked for power to be raised until each car really
// reaches its own at full throttle. Gravity stays at the game's 19.6.
//
// Originally measured on bayshore-101's 64.8 km highway, deleted with the rest of the Bay Area set
//No built World Tour track has a straight anywhere
// close to long enough for this any more. The longest is sydney's harbour bridge deck, and even its
// best case (the school-bus's 1116 m run) only gives the fast cars room to reach part of their cap
// -- measured directly: sports-car peaked at 156.9 mph of its 220 mph target over sydney's longest
// 444 m straight, lightweight-sports at 164.6 of 180 over 608 m, jeep at 109.3 of 112 over 1112 m.
// This test's whole point is the governed cap itself, not any specific road, so it drives a straight
// synthetic strip long enough for every vehicle to actually spool up to its cap and hold it there --
// the same kind of in-memory fixture `direction.test.ts` and `autopilot.test.ts` build for cases a
// real track's geometry cannot serve on its own.
const TARGET_MPH: Record<string, number> = {
  'city-pod': 90, 'sports-car': 220, 'lightweight-sports': 180, jeep: 112, 'school-bus': 80,
};
const MPH = 2.23694;

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); }, 60_000);

/** A dead-straight, dead-flat strip with no bend anywhere -- long enough for every cap above to be reached. */
function straightTrack(length: number): TrackData {
  const step = 2;
  const n = Math.round(length / step) + 1;
  const points: [number, number, number][] = Array.from({ length: n }, (_, i) => [0, 0, -i * step]);
  return {
    id: 'flat-out-straight', version: 1, editions: ['full'], category: 'race', mode: 'p2p', laps: 1,
    name: { zh: '', en: '' }, blurb: { zh: '', en: '' },
    origin: { lat: 0, lon: 0 }, timeOfDay: 'day', car: 'sedan',
    spline: { points, halfWidth: new Array(n).fill(12), curvature: new Array(n).fill(0),
              closed: false, length: (n - 1) * step },
    start: { pos: [0, 0, 0], yaw: 0 }, checkpoints: [], tiles: [], attribution: [],
  } as unknown as TrackData;
}
// 4 km: comfortably past the distance any cap here needs, with headroom to spare.
const STRAIGHT_LENGTH_M = 4000;

/** From rest at the start of the straight: full throttle, pure-pursuit steering, peak speed in mph. */
function flatOut(id: string): { peak: number; metres: number } {
  const spline = new Spline(straightTrack(STRAIGHT_LENGTH_M));
  const vehicle = VEHICLES.find(v => v.id === id)!;
  const tuning = vehicleTuning(vehicle, vehicle.tuning as CarKind);
  const first = 0, last = spline.count - 1;
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

describe('user top speeds are reachable at full throttle', () => {
  for (const id of Object.keys(TARGET_MPH)) it(`${id} reaches ${TARGET_MPH[id]} mph`, () => {
    const { peak, metres } = flatOut(id);
    expect(peak, `${id} peak over ${metres.toFixed(0)} m`).toBeGreaterThan(TARGET_MPH[id]! - 1);
    expect(peak, `${id} holds its cap`).toBeLessThan(TARGET_MPH[id]! + 1);
  }, 120_000);
});
