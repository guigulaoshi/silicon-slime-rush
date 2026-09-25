import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Car } from '../src/physics/Car';
import { Trailer } from '../src/physics/Trailer';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { vehicleFor, vehicleTuning } from '../src/vehicles/catalogue';

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); });
const idle = { throttle: 0, brake: 0, steer: 0 };
function setup() {
  const world = new PhysicsWorld(api);
  world.add('floor', { trimeshes: [], boxes: [
    { center: [0, -.5, 0], half: [500, .5, 500], yaw: 0, role: 'ground' },
  ] });
  const vehicle = vehicleFor('pickup-travel-trailer')!;
  const car = new Car(world, vehicleTuning(vehicle, 'sedan'),
    { pos: [0, 1, 0], yaw: 0 });
  const trailer = new Trailer(world, car, vehicle);
  let maxGap = 0; let minUpright = 1;
  const step = (seconds: number, input = idle) => {
    for (let i = 0; i < seconds * 60; i++) {
      car.update(1 / 60, input); trailer.update(1 / 60); world.world.step();
      maxGap = Math.max(maxGap, trailer.hitchGap);
      minUpright = Math.min(minUpright, trailer.car.upright);
    }
  };
  step(2);
  return { world, car, trailer, step, envelope: () => ({ maxGap, minUpright }) };
}

describe('physical ball-hitch trailer', () => {
  it('starts with coincident anchors and two load-bearing wheels', () => {
    const s = setup();
    expect(s.trailer.hitchGap).toBeLessThan(.03);
    expect(s.trailer.car.wheels).toHaveLength(2);
    expect(s.trailer.car.wheels.every(wheel => wheel.grounded && wheel.load > 100)).toBe(true);
    expect(s.world.world.impulseJoints.len()).toBe(1);
    s.world.dispose();
  });

  for (const steer of [-.55, .55]) it(`follows an actual sharp turn ${steer} without pulling apart`, () => {
    const s = setup();
    s.step(2, { throttle: .45, brake: 0, steer: 0 });
    s.step(3, { throttle: .2, brake: 0, steer });
    expect(s.car.position.distanceTo(s.trailer.car.position)).toBeGreaterThan(2);
    expect(s.car.quaternion.angleTo(s.trailer.car.quaternion)).toBeGreaterThan(.03);
    expect(s.envelope().maxGap).toBeLessThan(.08);
    expect(s.envelope().minUpright).toBeGreaterThan(.4);
    expect(s.trailer.car.wheelSteeringAngle).toBe(0);
    s.world.dispose();
  });

  it('backs up with reproducible opposite articulation for opposite steering', () => {
    const angles: number[] = [];
    for (const steer of [-.5, .5]) {
      const s = setup();
      let reverseSpeed = 0;
      for (let i = 0; i < 180; i++) {
        s.step(1 / 60, { throttle: 0, brake: .7, steer });
        reverseSpeed = Math.min(reverseSpeed, s.car.forwardSpeed);
      }
      // Contact at the end of a jackknife may stop the rig; prove that it actually reversed
      // before reaching that contact rather than requiring it to drive through the trailer.
      expect(reverseSpeed).toBeLessThan(-.5);
      expect(s.car.position.z).toBeGreaterThan(1);
      const a = s.car.forward; const b = s.trailer.car.forward;
      angles.push(Math.atan2(a.x * b.z - a.z * b.x, a.dot(b)));
      expect(s.envelope().maxGap).toBeLessThan(.08);
      s.world.dispose();
    }
    expect(angles[0]! * angles[1]!).toBeLessThan(-.001);
    expect(Math.abs(angles[0]! + angles[1]!)).toBeLessThan(.05);
  });

  it('survives rail impact, brakes, then resets both bodies and recreates only one joint', () => {
    const s = setup();
    s.world.add('wall', { trimeshes: [], boxes: [
      { center: [0, 1, -12], half: [8, 1, .2], yaw: 0, role: 'wall' },
    ] });
    // The realistically slower towing launch needs time to reach the same wall.
    s.step(5, { throttle: .5, brake: 0, steer: 0 });
    expect(s.car.position.z).toBeLessThan(-8);
    expect(s.car.position.z).toBeGreaterThan(-12);
    expect(s.envelope().maxGap).toBeLessThan(.1);
    s.step(1, { throttle: 0, brake: 1, steer: 0 });
    const count = s.world.world.bodies.len();
    for (let i = 0; i < 4; i++) {
      s.car.reset([20 + i * 4, 1, 0], i * .5);
      s.trailer.syncReset();
      expect(s.trailer.hitchGap).toBeLessThan(.0001);
      expect(s.trailer.car.speed).toBe(0);
      expect(s.world.world.impulseJoints.len()).toBe(1);
      expect(s.world.world.bodies.len()).toBe(count);
    }
    s.trailer.dispose(); s.trailer.dispose();
    expect(s.car.body.isCcdEnabled()).toBe(true);
    expect(s.car.body.softCcdPrediction()).toBe(0);
    expect(s.world.world.impulseJoints.len()).toBe(0);
    expect(s.world.world.bodies.len()).toBe(count - 1);
    s.world.dispose();
  });

  it('folds against the towing body under sustained reverse instead of passing through it', () => {
    const s = setup();
    let contacts = 0; let penetration = 0;
    for (let i = 0; i < 20 * 60; i++) {
      s.step(1 / 60, { throttle: 0, brake: .8, steer: .8 });
      const contact = s.car.collider.contactCollider(s.trailer.car.collider, .01);
      if (contact) { contacts++; penetration = Math.max(penetration, -contact.distance); }
    }
    expect(contacts, 'the reverse sequence must reach an actual body-to-body contact').toBeGreaterThan(0);
    expect(penetration).toBeLessThan(.05);
    expect(s.envelope().maxGap).toBeLessThan(.1);
    s.world.dispose();
  });
});


it('stops a boosted towing rig at a four-centimetre rail', () => {
  const s = setup();
  s.world.add('thin-wall', { trimeshes: [], boxes: [
    { center: [0, 2, -4], half: [8, 2, .02], yaw: 0, role: 'wall' },
  ] });
  const speed = s.car.tuning.maxSpeed + 8;
  for (const car of [s.car, s.trailer.car]) car.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
  let nearest = Infinity;
  for (let i = 0; i < 30; i++) {
    s.step(1 / 60);
    nearest = Math.min(nearest, s.car.position.z);
  }
  expect(nearest).toBeLessThan(-1);
  expect(nearest).toBeGreaterThan(-4 + s.car.tuning.chassisHalf[2] - .05);
  expect(s.envelope().maxGap).toBeLessThan(.1);
  s.world.dispose();
});

for (const x of [0, -2003.058]) it(`keeps a hard rig landing bounded at world x=${x}`, () => {
  const s = setup();
  if (x) s.world.add('far-floor', { trimeshes: [], boxes: [
    { center: [x, -.5, 0], half: [500, .5, 500], yaw: 0, role: 'ground' },
  ] });
  s.car.reset([x, 4, 0], Math.PI / 2);
  s.trailer.syncReset();
  for (const car of [s.car, s.trailer.car]) car.body.setLinvel({ x: -20, y: -12, z: 2 }, true);
  let maxPlanar = 0, maxGap = 0;
  for (let i = 0; i < 180; i++) {
    s.world.step(1 / 60, h => { s.car.update(h, idle); s.trailer.update(h); });
    for (const car of [s.car, s.trailer.car]) {
      const v = car.body.linvel(); maxPlanar = Math.max(maxPlanar, Math.hypot(v.x, v.z));
    }
    maxGap = Math.max(maxGap, s.trailer.hitchGap);
  }
  expect(s.car.grounded).toBe(true);
  expect(maxPlanar).toBeLessThan(35);
  expect(maxGap).toBeLessThan(.1);
  s.world.dispose();
});
